import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { CodexAppServer } from '../server/codex-app-server.mjs'

function fakeCodexProcess(onRequest) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
  child.killed = false
  child.kill = () => { child.killed = true; child.emit('exit', 0, null) }
  child.stdin.on('finish', () => child.emit('exit', 0, null))
  let buffer = ''
  const send = (message) => child.stdout.write(`${JSON.stringify(message)}\n`)
  child.stdin.on('data', (chunk) => {
    buffer += String(chunk)
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines.filter(Boolean)) onRequest(JSON.parse(line), send)
  })
  return child
}

test('Codex bridge initializes, reads Plus status, lists models, and returns the final answer', async () => {
  const requests = []
  const deltas = []
  let imagePath = ''
  const spawnImpl = (command, args) => {
    assert.match(command.toLocaleLowerCase(), /cmd\.exe$/)
    assert.deepEqual(args, ['/d', '/s', '/c', 'codex app-server'])
    return fakeCodexProcess((message, send) => {
      requests.push(message)
      if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'fake' } })
      if (message.method === 'account/read') send({ id: message.id, result: { account: { type: 'chatgpt', email: 'reader@example.com', planType: 'plus' }, requiresOpenaiAuth: true } })
      if (message.method === 'model/list') send({ id: message.id, result: { data: [{ id: 'model-1', model: 'model-1', displayName: 'Model 1', hidden: false }], nextCursor: null } })
      if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: 'thread-1' }, model: message.params.model } })
      if (message.method === 'turn/start') {
        imagePath = message.params.input.find((item) => item.type === 'localImage')?.path || ''
        send({ id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress', items: [] } } })
        setImmediate(() => {
          send({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '' } } })
          send({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'final', delta: 'final reading ' } })
          send({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'final', delta: 'answer' } })
          send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'commentary', type: 'agentMessage', phase: 'commentary', text: 'working' } } })
          send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'final', type: 'agentMessage', phase: 'final_answer', text: 'final reading answer' } } })
          send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [{ id: 'final', type: 'agentMessage', phase: 'final_answer', text: 'final reading answer' }] } } })
        })
      }
    })
  }
  const bridge = new CodexAppServer({ spawnImpl, platform: 'win32', requestTimeout: 1000 })
  const account = await bridge.getAccount()
  assert.equal(account.account.planType, 'plus')
  assert.deepEqual((await bridge.listModels()).map((item) => item.model), ['model-1'])
  const result = await bridge.complete({
    model: 'model-1',
    effort: 'high',
    webSearch: true,
    prompt: 'Explain this selection.',
    images: ['data:image/png;base64,aGVsbG8='],
    onDelta: (delta) => deltas.push(delta),
  })
  assert.equal(result.content, 'final reading answer')
  assert.deepEqual(deltas, ['final reading ', 'answer'])
  assert.ok(imagePath)
  assert.equal(existsSync(imagePath), false)
  const threadStart = requests.find((item) => item.method === 'thread/start')
  assert.equal(threadStart.params.ephemeral, true)
  assert.equal(threadStart.params.approvalPolicy, 'never')
  assert.equal(threadStart.params.sandbox, 'read-only')
  assert.equal(threadStart.params.config.web_search, 'live')
  assert.equal(threadStart.params.config.tools.web_search.context_size, 'medium')
  assert.match(threadStart.params.developerInstructions, /网页搜索工具/)
  const turnStart = requests.find((item) => item.method === 'turn/start')
  assert.equal(turnStart.params.effort, 'high')
  assert.deepEqual(turnStart.params.sandboxPolicy, { type: 'readOnly', networkAccess: false })
  bridge.shutdown()
})

test('Codex bridge starts hosted ChatGPT login without handling credentials itself', async () => {
  const spawnImpl = () => fakeCodexProcess((message, send) => {
    if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'fake' } })
    if (message.method === 'account/login/start') {
      assert.deepEqual(message.params, { type: 'chatgpt', appBrand: 'chatgpt', useHostedLoginSuccessPage: true, codexStreamlinedLogin: false })
      send({ id: message.id, result: { type: 'chatgpt', authUrl: 'https://auth.example.test/', loginId: 'login-1' } })
    }
  })
  const bridge = new CodexAppServer({ spawnImpl, platform: 'linux', requestTimeout: 1000 })
  const login = await bridge.startChatGptLogin()
  assert.equal(login.authUrl, 'https://auth.example.test/')
  bridge.shutdown()
})

test('Codex bridge supports ChatGPT membership login with a device code', async () => {
  const spawnImpl = () => fakeCodexProcess((message, send) => {
    if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'fake' } })
    if (message.method === 'account/login/start') {
      assert.deepEqual(message.params, { type: 'chatgptDeviceCode' })
      send({ id: message.id, result: { type: 'chatgptDeviceCode', loginId: 'device-login-1', userCode: 'ABCD-EFGH', verificationUrl: 'https://auth.example.test/device' } })
    }
  })
  const bridge = new CodexAppServer({ spawnImpl, platform: 'linux', requestTimeout: 1000 })
  const login = await bridge.startChatGptLogin('device')
  assert.equal(login.userCode, 'ABCD-EFGH')
  assert.equal(login.verificationUrl, 'https://auth.example.test/device')
  bridge.shutdown()
})

test('Codex bridge omits the web search tool configuration when search is disabled', async () => {
  let threadConfig
  const spawnImpl = () => fakeCodexProcess((message, send) => {
    if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'fake' } })
    if (message.method === 'account/read') send({ id: message.id, result: { account: { type: 'chatgpt', planType: 'plus' }, requiresOpenaiAuth: true } })
    if (message.method === 'thread/start') {
      threadConfig = message.params.config
      send({ id: message.id, result: { thread: { id: 'thread-disabled-search' }, model: message.params.model } })
    }
    if (message.method === 'turn/start') {
      send({ id: message.id, result: { turn: { id: 'turn-disabled-search', status: 'inProgress', items: [] } } })
      setImmediate(() => send({ method: 'turn/completed', params: { threadId: 'thread-disabled-search', turn: { id: 'turn-disabled-search', status: 'completed', items: [{ id: 'final', type: 'agentMessage', phase: 'final_answer', text: 'vision ok' }] } } }))
    }
  })
  const bridge = new CodexAppServer({ spawnImpl, platform: 'linux', requestTimeout: 1000 })
  const result = await bridge.complete({ model: 'model-1', webSearch: false, prompt: 'Inspect the image.' })
  assert.equal(result.content, 'vision ok')
  assert.deepEqual(threadConfig, { web_search: 'disabled' })
  bridge.shutdown()
})
