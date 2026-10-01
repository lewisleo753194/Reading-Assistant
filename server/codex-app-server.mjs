import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveCodexProcessSpec } from './codex-runtime.mjs'

const CLIENT_INFO = { name: 'raid-reading-assistant', title: 'Raid Reading Assistant', version: '2.5.1' }
const DEFAULT_TIMEOUT = 30_000
const TURN_TIMEOUT = 10 * 60_000

function appServerError(error, fallback) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : fallback
  const wrapped = new Error(message || fallback)
  if (error && typeof error === 'object' && 'code' in error) wrapped.code = error.code
  return wrapped
}

function finalAgentMessage(params, completedMessages) {
  const turnItems = Array.isArray(params?.turn?.items) ? params.turn.items : []
  const messages = turnItems.filter((item) => item?.type === 'agentMessage' && typeof item.text === 'string')
  const final = [...messages].reverse().find((item) => item.phase === 'final_answer')
    || [...messages].reverse().find((item) => item.phase !== 'commentary')
    || [...completedMessages].reverse().find((item) => item.phase === 'final_answer')
    || [...completedMessages].reverse().find((item) => item.phase !== 'commentary')
  return String(final?.text || '').trim()
}

async function materializeImages(dataUrls, runtimeDirectory = os.tmpdir()) {
  if (!Array.isArray(dataUrls) || !dataUrls.length) return { directory: '', inputs: [] }
  const directory = await mkdtemp(path.join(runtimeDirectory, 'raid-codex-images-'))
  const inputs = []
  try {
    for (const [index, value] of dataUrls.entries()) {
      const match = String(value).match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/)
      if (!match) continue
      const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
      const filePath = path.join(directory, `selection-${index + 1}.${extension}`)
      await writeFile(filePath, Buffer.from(match[2], 'base64'))
      inputs.push({ type: 'localImage', path: filePath, detail: 'high' })
    }
    return { directory, inputs }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

export class CodexAppServer extends EventEmitter {
  constructor({ spawnImpl = spawn, platform = process.platform, requestTimeout = DEFAULT_TIMEOUT, runtimeDirectory = os.tmpdir() } = {}) {
    super()
    this.spawnImpl = spawnImpl
    this.platform = platform
    this.requestTimeout = requestTimeout
    this.runtimeDirectory = runtimeDirectory
    this.child = null
    this.starting = null
    this.nextId = 1
    this.pending = new Map()
    this.stderr = []
    this.expectedClose = false
  }

  async ensureStarted() {
    if (this.child && !this.child.killed) return
    if (this.starting) return this.starting
    this.starting = this.start()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  async start() {
    const { command, args } = await resolveCodexProcessSpec({ platform: this.platform })
    this.expectedClose = false
    this.stderr = []
    let child
    try {
      child = this.spawnImpl(command, args, {
        cwd: this.runtimeDirectory,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      throw appServerError(error, '无法启动 Codex CLI')
    }
    this.child = child
    const output = createInterface({ input: child.stdout })
    output.on('line', (line) => this.handleLine(line))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      this.stderr.push(...String(chunk).split(/\r?\n/).filter(Boolean))
      this.stderr = this.stderr.slice(-12)
    })
    child.once('error', (error) => this.handleExit(error))
    child.once('exit', (code, signal) => {
      const detail = this.stderr.at(-1)
      const suffix = detail ? `：${detail}` : code !== null ? `（退出码 ${code}）` : signal ? `（${signal}）` : ''
      this.handleExit(this.expectedClose ? null : new Error(`Codex App Server 已退出${suffix}`))
    })

    try {
      await this.rawRequest('initialize', {
        clientInfo: CLIENT_INFO,
        capabilities: { experimentalApi: true },
      })
      this.notify('initialized', {})
    } catch (error) {
      this.shutdown()
      if (error?.code === 'ENOENT') throw new Error('未找到 Codex CLI。请先安装 Codex CLI，或通过 CODEX_CLI_PATH 指定可执行文件。')
      throw error
    }
  }

  handleLine(line) {
    const source = String(line || '').trim()
    if (!source) return
    let message
    try {
      message = JSON.parse(source)
    } catch {
      return
    }
    if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(appServerError(message.error, 'Codex App Server 请求失败'))
      else pending.resolve(message.result)
      return
    }
    if (message.method && Object.prototype.hasOwnProperty.call(message, 'id')) {
      this.write({ id: message.id, error: { code: -32601, message: `Raid 不支持 App Server 请求：${message.method}` } })
      return
    }
    if (message.method) this.emit('notification', { method: message.method, params: message.params || {} })
  }

  handleExit(error) {
    if (!this.child && !this.pending.size) return
    this.child = null
    const reason = error || new Error('Codex App Server 已关闭')
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(reason)
    }
    this.pending.clear()
  }

  write(message) {
    if (!this.child?.stdin?.writable) throw new Error('Codex App Server 未运行')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  rawRequest(method, params = {}, timeout = this.requestTimeout) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex App Server 请求超时：${method}`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.write({ method, id, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  async request(method, params = {}, timeout = this.requestTimeout) {
    await this.ensureStarted()
    return this.rawRequest(method, params, timeout)
  }

  notify(method, params = {}) {
    this.write({ method, params })
  }

  getAccount() {
    return this.request('account/read', {})
  }

  startChatGptLogin(mode = 'browser') {
    if (mode === 'device') {
      return this.request('account/login/start', { type: 'chatgptDeviceCode' }, 60_000)
    }
    return this.request('account/login/start', {
      type: 'chatgpt',
      appBrand: 'chatgpt',
      useHostedLoginSuccessPage: true,
      codexStreamlinedLogin: false,
    }, 60_000)
  }

  logout() {
    return this.request('account/logout', {})
  }

  async listModels() {
    const models = []
    let cursor = null
    do {
      const result = await this.request('model/list', { cursor, limit: 100, includeHidden: false })
      models.push(...(Array.isArray(result?.data) ? result.data : []))
      cursor = result?.nextCursor || null
    } while (cursor && models.length < 500)
    return models
  }

  async complete({ prompt, developerInstructions = '', model, effort = 'low', images = [], webSearch = false, signal, onDelta } = {}) {
    const account = await this.getAccount()
    if (!account?.account) throw new Error('Codex 尚未登录。请在 AI 设置中选择“ChatGPT Plus / Codex”并完成登录。')
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const localImages = await materializeImages(images, this.runtimeDirectory)
    let threadId = ''
    let turnId = ''
    let turnTimer
    const completedMessages = []
    const finalMessageIds = new Set()
    let completionResolve
    let completionReject
    const completion = new Promise((resolve, reject) => { completionResolve = resolve; completionReject = reject })
    void completion.catch(() => undefined)
    const onNotification = ({ method, params }) => {
      if (!threadId || params?.threadId !== threadId) return
      if (method === 'item/started' && params?.item?.type === 'agentMessage' && params.item.phase !== 'commentary') finalMessageIds.add(params.item.id)
      if (method === 'item/agentMessage/delta' && finalMessageIds.has(params?.itemId) && typeof params?.delta === 'string') onDelta?.(params.delta)
      if (method === 'item/completed' && params?.item?.type === 'agentMessage') completedMessages.push(params.item)
      if (method !== 'turn/completed') return
      const status = params?.turn?.status
      if (status === 'failed') completionReject(new Error(params?.turn?.error?.message || 'Codex 生成失败'))
      else if (status === 'interrupted') completionReject(new DOMException('Aborted', 'AbortError'))
      else completionResolve(params)
    }
    this.on('notification', onNotification)
    const onAbort = () => {
      if (threadId && turnId) void this.request('turn/interrupt', { threadId, turnId }).catch(() => undefined)
      completionReject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      const started = await this.request('thread/start', {
        ephemeral: true,
        model: model || null,
        config: webSearch
          ? { web_search: 'live', tools: { web_search: { context_size: 'medium' } } }
          : { web_search: 'disabled' },
        cwd: this.runtimeDirectory,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        serviceName: 'raid-reading-assistant',
        developerInstructions: `${developerInstructions}\n\n你在阅读助手中作为回答引擎工作。不要运行命令、修改文件或创建任务；${webSearch ? '仅可在确有必要时使用内置网页搜索工具，并在最终回答中保留可点击来源链接。' : '不要调用工具，直接依据用户提供的材料回答。'}`,
      }, 60_000)
      threadId = String(started?.thread?.id || '')
      if (!threadId) throw new Error('Codex App Server 未返回线程 ID')
      const turn = await this.request('turn/start', {
        threadId,
        model: model || null,
        effort: effort || null,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        input: [{ type: 'text', text: String(prompt || '') }, ...localImages.inputs],
      }, 60_000)
      turnId = String(turn?.turn?.id || '')
      if (!turnId) throw new Error('Codex App Server 未返回生成任务 ID')
      if (signal?.aborted) onAbort()
      const params = await Promise.race([
        completion,
        new Promise((_, reject) => { turnTimer = setTimeout(() => reject(new Error('Codex 生成超时')), TURN_TIMEOUT) }),
      ])
      const content = finalAgentMessage(params, completedMessages)
      if (!content) throw new Error('Codex 未返回回答内容')
      return { content, model: started?.model || model || '' }
    } finally {
      clearTimeout(turnTimer)
      signal?.removeEventListener('abort', onAbort)
      this.off('notification', onNotification)
      if (localImages.directory) await rm(localImages.directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  shutdown() {
    if (!this.child) return
    this.expectedClose = true
    this.child.stdin?.end()
    const child = this.child
    setTimeout(() => { if (!child.killed) child.kill() }, 1000).unref()
  }

  setRuntimeDirectory(directory) {
    if (directory) this.runtimeDirectory = directory
  }
}

export const codexAppServer = new CodexAppServer()
