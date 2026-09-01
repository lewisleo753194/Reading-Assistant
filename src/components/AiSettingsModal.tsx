import { Bot, BrainCircuit, CheckCircle2, CircleHelp, Copy, Database, ExternalLink, Eye, EyeOff, FolderOpen, Languages, LoaderCircle, LogIn, LogOut, Puzzle, Settings2, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { LanguagePack } from '../i18n'
import { useI18n, type AppLanguage } from '../i18n'
import type { AiConfig, CodexAccountStatus, ImportedSkill, MemorySettings } from '../types'
import type { FileMemorySummary } from '../lib/memory'

type SettingsTab = 'models' | 'skills' | 'memory' | 'language'
type CodexLoginAttempt = { loginId: string; type: 'chatgpt' | 'chatgptDeviceCode'; authUrl?: string; verificationUrl?: string; userCode?: string }
type ProjectMemorySummary = { id: string; name: string; sourceCount: number; conversationCount: number; updatedAt: number }

type Props = {
  value: AiConfig
  serverConfigured: boolean
  skills: ImportedSkill[]
  language: AppLanguage
  languages: LanguagePack[]
  memorySettings: MemorySettings
  userMemory: string
  projects: ProjectMemorySummary[]
  sourceCaches: FileMemorySummary[]
  onClose: () => void
  onSave: (config: AiConfig) => void
  onImportSkill: () => Promise<boolean>
  onRemoveSkill: (id: string) => void
  onImportLanguage: () => Promise<boolean>
  onLanguageChange: (language: AppLanguage) => void
  onMemorySettingsChange: (settings: MemorySettings) => void
  onUserMemoryChange: (memory: string) => void
  onDeleteProject: (id: string) => Promise<void>
  onDeleteSourceCache: (id: string) => Promise<void>
}

export default function AiSettingsModal({ value, serverConfigured, skills, language, languages, memorySettings, userMemory, projects, sourceCaches, onClose, onSave, onImportSkill, onRemoveSkill, onImportLanguage, onLanguageChange, onMemorySettingsChange, onUserMemoryChange, onDeleteProject, onDeleteSourceCache }: Props) {
  const { t, pack } = useI18n()
  const [tab, setTab] = useState<SettingsTab>('models')
  const [draft, setDraft] = useState(value)
  const [showKey, setShowKey] = useState(false)
  const [showVisionKey, setShowVisionKey] = useState(false)
  const [showReasoningKey, setShowReasoningKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [loadingModels, setLoadingModels] = useState<'default' | 'vision' | 'reasoning' | null>(null)
  const [modelMenu, setModelMenu] = useState<'default' | 'vision' | 'reasoning' | null>(null)
  const [availableModels, setAvailableModels] = useState<Record<'default' | 'vision' | 'reasoning', string[]>>({ default: [], vision: [], reasoning: [] })
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const [codexStatus, setCodexStatus] = useState<CodexAccountStatus | null>(null)
  const [codexLoading, setCodexLoading] = useState(false)
  const [loginPending, setLoginPending] = useState(false)
  const [loginAttempt, setLoginAttempt] = useState<CodexLoginAttempt | null>(null)

  const readCodexStatus = useCallback(async (silent = false) => {
    if (!silent) setCodexLoading(true)
    try {
      const response = await fetch('/api/codex/account')
      const data = await response.json().catch(() => ({})) as CodexAccountStatus
      setCodexStatus(data)
      if (data.account) setLoginPending(false)
      return data
    } catch (reason) {
      const data: CodexAccountStatus = { available: false, account: null, error: reason instanceof Error ? reason.message : (pack.code === 'en-US' ? 'Codex is unavailable.' : 'Codex 不可用。') }
      setCodexStatus(data)
      return data
    } finally {
      if (!silent) setCodexLoading(false)
    }
  }, [pack.code])

  useEffect(() => {
    if (draft.provider !== 'codex') return
    const timer = window.setTimeout(() => void readCodexStatus(), 0)
    return () => window.clearTimeout(timer)
  }, [draft.provider, readCodexStatus])

  useEffect(() => {
    if (!loginPending) return
    const check = async () => {
      if (!loginAttempt?.loginId) return void readCodexStatus(true)
      try {
        const response = await fetch(`/api/codex/login/status?loginId=${encodeURIComponent(loginAttempt.loginId)}`)
        const data = await response.json().catch(() => ({}))
        if (data.account) {
          setCodexStatus({ available: true, account: data.account })
          setLoginPending(false)
          setLoginAttempt(null)
          setMessage({ type: 'ok', text: pack.code === 'en-US' ? 'ChatGPT membership connected. Images will be sent to the selected Codex model as originals.' : 'ChatGPT 会员已连接；图片会以原图发送给所选 Codex 模型识别。' })
        } else if (data.result && !data.result.success) {
          setLoginPending(false)
          setMessage({ type: 'error', text: data.result.error || (pack.code === 'en-US' ? 'ChatGPT sign-in failed. Try device-code sign-in.' : 'ChatGPT 登录失败，请改用设备码登录重试。') })
        }
      } catch {
        // A temporary status-read failure should not cancel a browser login already in progress.
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 1500)
    return () => window.clearInterval(timer)
  }, [loginPending, loginAttempt, pack.code, readCodexStatus])

  useEffect(() => {
    if (!codexStatus?.account || draft.provider !== 'codex' || draft.codexModel.trim()) return
    let active = true
    void fetch('/api/ai/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aiConfig: draft, mode: 'default' }) })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!active || !ok || !Array.isArray(data.models) || !data.models.length) return
        setAvailableModels((items) => ({ ...items, default: data.models }))
        setDraft((current) => current.codexModel.trim() ? current : { ...current, codexModel: String(data.models[0]) })
      }).catch(() => undefined)
    return () => { active = false }
  }, [codexStatus?.account, draft])

  const fetchModels = async (mode: 'default' | 'vision' | 'reasoning') => {
    if (modelMenu === mode && availableModels[mode].length) return setModelMenu(null)
    setLoadingModels(mode)
    setMessage(null)
    try {
      const response = await fetch('/api/ai/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aiConfig: draft, mode }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || (pack.code === 'en-US' ? 'Could not load models.' : '无法获取模型列表。'))
      setAvailableModels((items) => ({ ...items, [mode]: data.models }))
      setModelMenu(mode)
    } catch (reason) {
      setMessage({ type: 'error', text: reason instanceof Error ? reason.message : t('connectionFailed') })
    } finally {
      setLoadingModels(null)
    }
  }

  const modelPicker = (mode: 'default' | 'vision' | 'reasoning', field: 'model' | 'visionModel' | 'reasoningModel' | 'codexModel', placeholder: string) => <div className="model-picker">
    <input className="settings-input" value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} placeholder={placeholder} />
    <button type="button" className="model-help" onClick={() => void fetchModels(mode)} title={pack.code === 'en-US' ? 'Show available models' : '获取并显示可用模型'}>{loadingModels === mode ? <LoaderCircle className="spin" size={15} /> : <CircleHelp size={15} />}</button>
    {modelMenu === mode && <div className="model-options">{availableModels[mode].map((model) => <button type="button" key={model} className={draft[field] === model ? 'active' : ''} onClick={() => { setDraft({ ...draft, [field]: model }); setModelMenu(null) }}>{model}</button>)}</div>}
  </div>

  const testConnection = async () => {
    setTesting(true)
    setMessage(null)
    try {
      const response = await fetch('/api/ai/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aiConfig: draft }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || t('connectionFailed'))
      setMessage({ type: 'ok', text: pack.code === 'en-US' ? 'Connection successful.' : '连接成功。' })
    } catch (reason) {
      setMessage({ type: 'error', text: reason instanceof Error ? reason.message : t('connectionFailed') })
    } finally {
      setTesting(false)
    }
  }

  const loginCodex = async (mode: 'device' | 'browser' = 'device') => {
    setCodexLoading(true)
    setMessage(null)
    try {
      const response = await fetch('/api/codex/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) })
      const data = await response.json().catch(() => ({}))
      const targetUrl = mode === 'device' ? data.verificationUrl : data.authUrl
      if (!response.ok || !data.loginId || !targetUrl) throw new Error(data.error || (pack.code === 'en-US' ? 'Could not start ChatGPT sign-in.' : '无法启动 ChatGPT 会员登录。'))
      const attempt: CodexLoginAttempt = { loginId: String(data.loginId), type: data.type, authUrl: data.authUrl, verificationUrl: data.verificationUrl, userCode: data.userCode }
      setLoginAttempt(attempt)
      window.open(targetUrl, '_blank', 'noopener,noreferrer')
      setLoginPending(true)
      setMessage({ type: 'ok', text: mode === 'device'
        ? (pack.code === 'en-US' ? `Sign in with ChatGPT and enter code ${data.userCode}. Raid will update automatically.` : `请使用 ChatGPT 会员登录，并输入设备码 ${data.userCode}；完成后 Raid 会自动更新。`)
        : (pack.code === 'en-US' ? 'Continue signing in in the browser. This page will update automatically.' : '请在浏览器中继续登录；完成后 Raid 会自动更新。') })
    } catch (reason) {
      setMessage({ type: 'error', text: reason instanceof Error ? reason.message : t('connectionFailed') })
    } finally {
      setCodexLoading(false)
    }
  }

  const logoutCodex = async () => {
    setCodexLoading(true)
    setMessage(null)
    try {
      const response = await fetch('/api/codex/logout', { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || (pack.code === 'en-US' ? 'Sign-out failed.' : '退出登录失败。'))
      setLoginPending(false)
      setLoginAttempt(null)
      await readCodexStatus(true)
      setMessage({ type: 'ok', text: pack.code === 'en-US' ? 'Signed out of Codex.' : '已退出 Codex 登录。' })
    } catch (reason) {
      setMessage({ type: 'error', text: reason instanceof Error ? reason.message : t('connectionFailed') })
    } finally {
      setCodexLoading(false)
    }
  }

  const runImport = async (kind: 'skill' | 'language') => {
    setImporting(true)
    setMessage(null)
    try {
      const imported = await (kind === 'skill' ? onImportSkill() : onImportLanguage())
      if (!imported) return
      setMessage({ type: 'ok', text: kind === 'skill' ? t('skillImported') : t('languageImported') })
    } catch (reason) {
      setMessage({ type: 'error', text: reason instanceof Error ? reason.message : t('importFailed') })
    } finally {
      setImporting(false)
    }
  }

  const save = () => {
    if (draft.provider === 'codex') {
      if (!codexStatus?.account) return setMessage({ type: 'error', text: pack.code === 'en-US' ? 'Sign in to ChatGPT first.' : '请先登录 ChatGPT 账户。' })
      if (!draft.codexModel.trim()) return setMessage({ type: 'error', text: pack.code === 'en-US' ? 'Choose a Codex model.' : '请选择 Codex 模型。' })
    } else {
      if (!draft.apiKey.trim() && !serverConfigured) return setMessage({ type: 'error', text: pack.code === 'en-US' ? 'Enter an API key.' : '请填写 API Key。' })
      if (!draft.baseUrl.trim() || !draft.model.trim()) return setMessage({ type: 'error', text: pack.code === 'en-US' ? 'The API URL and model are required.' : '接口地址和模型名称不能为空。' })
      if (draft.visionEnabled && !draft.visionModel.trim()) return setMessage({ type: 'error', text: pack.code === 'en-US' ? 'Enter a vision model.' : '启用公式与图表理解后，请填写视觉模型名称。' })
      if (draft.reasoningEnabled && !draft.reasoningModel.trim()) return setMessage({ type: 'error', text: pack.code === 'en-US' ? 'Enter a deep-thinking model.' : '启用深度思考后，请填写深度思考模型名称。' })
    }
    onSave({
      provider: draft.provider,
      apiKey: draft.apiKey.trim(), baseUrl: draft.baseUrl.trim().replace(/\/$/, ''), model: draft.model.trim(),
      visionEnabled: draft.visionEnabled, visionApiKey: draft.visionApiKey.trim(), visionBaseUrl: draft.visionBaseUrl.trim().replace(/\/$/, ''), visionModel: draft.visionModel.trim(),
      reasoningEnabled: draft.reasoningEnabled, reasoningApiKey: draft.reasoningApiKey.trim(), reasoningBaseUrl: draft.reasoningBaseUrl.trim().replace(/\/$/, ''), reasoningModel: draft.reasoningModel.trim(),
      codexModel: draft.codexModel.trim(), webSearchEnabled: draft.webSearchEnabled, codexDeepThinkingEnabled: draft.codexDeepThinkingEnabled, codexReasoningEffort: draft.codexReasoningEffort,
    })
    onClose()
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="settings-heading"><div className="settings-icon"><Settings2 size={20} /></div><div><h2 id="settings-title">{t('settingsTitle')}</h2></div><button className="icon-button" onClick={onClose} aria-label={t('close')}><X size={18} /></button></div>
      <nav className="settings-tabs">
        <button className={tab === 'models' ? 'active' : ''} onClick={() => { setTab('models'); setMessage(null) }}><Bot size={15} />{t('modelSettings')}</button>
        <button className={tab === 'skills' ? 'active' : ''} onClick={() => { setTab('skills'); setMessage(null) }}><Puzzle size={15} />{t('skillSettings')}</button>
        <button className={tab === 'memory' ? 'active' : ''} onClick={() => { setTab('memory'); setMessage(null) }}><BrainCircuit size={15} />{t('memorySettings')}</button>
        <button className={tab === 'language' ? 'active' : ''} onClick={() => { setTab('language'); setMessage(null) }}><Languages size={15} />{t('languageSettings')}</button>
      </nav>

      <div className="settings-body">
        {tab === 'models' && <>
          <div className="model-section-title">{t('defaultModel')}</div>
          <div className="provider-picker">
            <button type="button" className={draft.provider === 'codex' ? 'active' : ''} onClick={() => { setDraft({ ...draft, provider: 'codex' }); setMessage(null); setModelMenu(null) }}><Bot size={17} /><span><strong>ChatGPT Plus / Codex</strong><small>{pack.code === 'en-US' ? 'Use your ChatGPT subscription through the local Codex CLI' : '通过本机 Codex CLI 使用你的 ChatGPT 会员'}</small></span></button>
            <button type="button" className={draft.provider === 'openai-responses' ? 'active' : ''} onClick={() => { setDraft({ ...draft, provider: 'openai-responses', visionEnabled: true }); setMessage(null); setModelMenu(null) }}><Database size={17} /><span><strong>OpenAI Responses API</strong><small>{pack.code === 'en-US' ? 'Upload original files, build a project index, and search the live web' : '上传原文件、建立项目全文索引，并可联网搜索'}</small></span></button>
            <button type="button" className={draft.provider === 'openai-compatible' ? 'active' : ''} onClick={() => { setDraft({ ...draft, provider: 'openai-compatible' }); setMessage(null); setModelMenu(null) }}><Settings2 size={17} /><span><strong>{pack.code === 'en-US' ? 'API-compatible service' : '兼容 API 服务'}</strong><small>{pack.code === 'en-US' ? 'Keep using the original API URL and key configuration' : '保留原来的接口地址与 API Key 配置'}</small></span></button>
          </div>
          {draft.provider === 'codex' ? <section className="codex-config">
            <div className="codex-account-row">
              <div className={`codex-status-dot ${codexStatus?.account ? 'connected' : ''}`} />
              <div><strong>{codexStatus?.account ? (codexStatus.account.email || (pack.code === 'en-US' ? 'ChatGPT account connected' : 'ChatGPT 账户已连接')) : (pack.code === 'en-US' ? 'ChatGPT account not connected' : '尚未连接 ChatGPT 账户')}</strong><small>{codexStatus?.account?.planType ? `${codexStatus.account.planType.toUpperCase()} · Codex` : codexStatus?.error || (pack.code === 'en-US' ? 'Your credentials stay in the Codex CLI, not in Raid.' : '登录凭据由 Codex CLI 保存，不会写入 Raid。')}</small></div>
              {codexStatus?.account
                ? <button type="button" className="codex-account-button secondary" disabled={codexLoading} onClick={logoutCodex}>{codexLoading ? <LoaderCircle className="spin" size={14} /> : <LogOut size={14} />}{pack.code === 'en-US' ? 'Sign out' : '退出'}</button>
                : <div className="codex-login-buttons"><button type="button" className="codex-account-button" disabled={codexLoading || loginPending} onClick={() => void loginCodex('device')}>{codexLoading || loginPending ? <LoaderCircle className="spin" size={14} /> : <LogIn size={14} />}{loginPending ? (pack.code === 'en-US' ? 'Waiting…' : '等待登录…') : (pack.code === 'en-US' ? 'ChatGPT sign-in' : 'ChatGPT 会员登录')}</button><button type="button" className="codex-browser-login" disabled={codexLoading || loginPending} onClick={() => void loginCodex('browser')}>{pack.code === 'en-US' ? 'Browser callback' : '浏览器回调登录'}</button></div>}
            </div>
            {loginPending && loginAttempt?.type === 'chatgptDeviceCode' && <div className="codex-device-code"><span>{pack.code === 'en-US' ? 'Device code' : '设备码'}</span><code>{loginAttempt.userCode}</code><button type="button" onClick={() => void navigator.clipboard.writeText(loginAttempt.userCode || '')} title={t('copy')}><Copy size={13} /></button><a href={loginAttempt.verificationUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} />{pack.code === 'en-US' ? 'Open sign-in page' : '打开登录页面'}</a></div>}
            <label className="field-label">{pack.code === 'en-US' ? 'Codex model' : 'Codex 模型'}</label>{modelPicker('default', 'codexModel', pack.code === 'en-US' ? 'Use ? to load available models' : '点击右侧 ? 获取可用模型')}
            <section className="vision-config"><label className="vision-toggle"><input type="checkbox" checked={draft.webSearchEnabled} onChange={(event) => setDraft({ ...draft, webSearchEnabled: event.target.checked })} /><span className="vision-switch" aria-hidden="true" /><span><strong>{pack.code === 'en-US' ? 'Web search' : '联网搜索'}</strong><small>{pack.code === 'en-US' ? 'Allow Codex to search the live web when local sources are insufficient or current information is requested.' : '当项目资料不足或问题需要最新信息时，允许 Codex 搜索实时网页。'}</small></span></label></section>
            <section className="vision-config"><label className="vision-toggle"><input type="checkbox" checked={draft.codexDeepThinkingEnabled} onChange={(event) => setDraft({ ...draft, codexDeepThinkingEnabled: event.target.checked })} /><span className="vision-switch" aria-hidden="true" /><span><strong>{t('enableDeepThinking')}</strong><small>{pack.code === 'en-US' ? 'The prompt switch controls when the higher effort is used.' : '开启后，可在输入框下方按任务切换深度思考。'}</small></span></label>{draft.codexDeepThinkingEnabled && <div className="vision-fields">
              <label className="field-label">{pack.code === 'en-US' ? 'Reasoning effort' : '推理强度'}</label><select className="settings-input" value={draft.codexReasoningEffort} onChange={(event) => setDraft({ ...draft, codexReasoningEffort: event.target.value as AiConfig['codexReasoningEffort'] })}><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option><option value="low">low</option></select>
            </div>}</section>
            <p className="codex-note">{pack.code === 'en-US' ? 'This mode uses your ChatGPT membership through Codex, without an API key. Visual selections are sent immediately as original images; full-document extraction or scanned-PDF OCR runs only when you explicitly ask about the whole document or all sources.' : '此模式直接使用你的 ChatGPT 会员与 Codex，不需要 API Key。视觉选区会立即以原图发送；只有明确选择“对全文”或“全部来源”时，才进行全文提取或扫描 PDF OCR。'}</p>
          </section> : <>
          <label className="field-label">{t('apiUrl')}</label><input className="settings-input" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://your-provider.example/v1" autoComplete="url" />
          <label className="field-label">{t('model')}</label>{modelPicker('default', 'model', 'model-name')}
          <label className="field-label">{t('apiKey')}</label><div className="key-input"><input type={showKey ? 'text' : 'password'} value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={serverConfigured ? t('serverFallback') : 'sk-…'} autoComplete="off" /><button onClick={() => setShowKey((value) => !value)} aria-label={showKey ? t('hideKey') : t('showKey')}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>

          {draft.provider === 'openai-responses' ? <section className="codex-config responses-config">
            <p className="codex-note">{pack.code === 'en-US' ? 'PDF and text sources are sent as original files and indexed per project. Images are sent as original images. OpenAI API usage is billed separately from ChatGPT Plus.' : 'PDF 和文本资料会以原文件上传，并按项目建立独立全文索引；图片会以原图发送。OpenAI API 用量与 ChatGPT Plus 分开计费。'}</p>
            <section className="vision-config"><label className="vision-toggle"><input type="checkbox" checked={draft.webSearchEnabled} onChange={(event) => setDraft({ ...draft, webSearchEnabled: event.target.checked })} /><span className="vision-switch" aria-hidden="true" /><span><strong>{pack.code === 'en-US' ? 'Web search' : '联网搜索'}</strong><small>{pack.code === 'en-US' ? 'Use OpenAI web search when current or external information is needed.' : '需要最新信息或项目外资料时，允许使用 OpenAI 网页搜索。'}</small></span></label></section>
          </section> : <section className="vision-config"><label className="vision-toggle"><input type="checkbox" checked={draft.visionEnabled} onChange={(event) => setDraft({ ...draft, visionEnabled: event.target.checked })} /><span className="vision-switch" aria-hidden="true" /><span><strong>{t('visual')}</strong></span></label>{draft.visionEnabled && <div className="vision-fields">
            <label className="field-label">{t('visualUrl')}</label><input className="settings-input" value={draft.visionBaseUrl} onChange={(event) => setDraft({ ...draft, visionBaseUrl: event.target.value })} placeholder={t('inheritUrl')} autoComplete="url" />
            <label className="field-label">{t('visualModel')}</label>{modelPicker('vision', 'visionModel', 'vision-model-name')}
            <label className="field-label">{t('visualKey')}</label><div className="key-input"><input type={showVisionKey ? 'text' : 'password'} value={draft.visionApiKey} onChange={(event) => setDraft({ ...draft, visionApiKey: event.target.value })} placeholder={t('inheritKey')} autoComplete="off" /><button onClick={() => setShowVisionKey((value) => !value)} aria-label={showVisionKey ? t('hideKey') : t('showKey')}>{showVisionKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          </div>}</section>}

          <section className="vision-config"><label className="vision-toggle"><input type="checkbox" checked={draft.reasoningEnabled} onChange={(event) => setDraft({ ...draft, reasoningEnabled: event.target.checked })} /><span className="vision-switch" aria-hidden="true" /><span><strong>{t('enableDeepThinking')}</strong></span></label>{draft.reasoningEnabled && <div className="vision-fields">
            <label className="field-label">{t('reasoningUrl')}</label><input className="settings-input" value={draft.reasoningBaseUrl} onChange={(event) => setDraft({ ...draft, reasoningBaseUrl: event.target.value })} placeholder={t('inheritUrl')} autoComplete="url" />
            <label className="field-label">{t('reasoningModel')}</label>{modelPicker('reasoning', 'reasoningModel', 'reasoning-model-name')}
            <label className="field-label">{t('reasoningKey')}</label><div className="key-input"><input type={showReasoningKey ? 'text' : 'password'} value={draft.reasoningApiKey} onChange={(event) => setDraft({ ...draft, reasoningApiKey: event.target.value })} placeholder={t('inheritKey')} autoComplete="off" /><button onClick={() => setShowReasoningKey((value) => !value)} aria-label={showReasoningKey ? t('hideKey') : t('showKey')}>{showReasoningKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          </div>}</section>
          </>}
        </>}

        {tab === 'skills' && <section className="import-settings"><div className="import-header"><div><h3>{t('skillSettings')}</h3><p>{t('skillImportHelp')}</p></div><button className="import-button" disabled={importing} onClick={() => runImport('skill')}>{importing ? <LoaderCircle className="spin" size={15} /> : <FolderOpen size={15} />}{t('importSkill')}</button></div>
          <div className="import-list">{skills.length ? skills.map((skill) => <article key={skill.id} className="import-card"><div><strong>{skill.name}</strong><code>/{skill.command}</code><p>{skill.description}</p><small>{skill.sourcePath}</small></div><button onClick={() => onRemoveSkill(skill.id)} title={t('removeSkill')}><Trash2 size={15} /></button></article>) : <div className="import-empty"><Puzzle size={24} /><p>{t('noSkills')}</p></div>}</div>
        </section>}

        {tab === 'memory' && <section className="memory-settings">
          <section className="memory-subsection project-memory-list">
            <div className="memory-section-heading"><span>{pack.code === 'en-US' ? 'Project management' : '项目管理'} · {projects.length}</span></div>
            <p className="memory-section-description">{pack.code === 'en-US' ? 'Manage complete reading projects. Deleting a project removes all of its locally stored content.' : '管理完整的阅读项目。删除项目会移除该项目在本机保存的全部内容。'}</p>
            <div className="memory-file-list">{projects.length ? projects.map((project) => <article key={project.id}><FolderOpen size={15} /><div><strong>{project.name}</strong><small>{pack.code === 'en-US' ? `${project.sourceCount} sources · ${project.conversationCount} conversations` : `${project.sourceCount} 份来源 · ${project.conversationCount} 个对话`} · {new Date(project.updatedAt).toLocaleString()}</small></div><button aria-label={pack.code === 'en-US' ? `Delete project ${project.name}` : `删除项目 ${project.name}`} onClick={() => { if (window.confirm(pack.code === 'en-US' ? `Delete project “${project.name}”? This permanently removes all of its locally saved sources, conversations, attachments, notes, highlights, and annotations. This cannot be undone.` : `确定删除项目“${project.name}”吗？这会永久删除该项目在本机保存的全部来源、对话、附件、笔记、高亮与批注，且无法撤销。`)) void onDeleteProject(project.id) }}><Trash2 size={14} /></button></article>) : <div className="memory-empty-row">{pack.code === 'en-US' ? 'No projects' : '暂无项目'}</div>}</div>
          </section>
          <section className="memory-subsection project-memory-list">
            <div className="memory-section-heading"><span>{pack.code === 'en-US' ? 'Local sources & cache' : '本地来源与缓存'} · {sourceCaches.length}</span></div>
            <p className="memory-section-description">{pack.code === 'en-US' ? 'Remove one locally stored source without deleting its project or project conversations.' : '可单独清除一份本地来源记录，不会删除所属项目和项目对话。'}</p>
            <div className="memory-file-list">{sourceCaches.length ? sourceCaches.map((source) => <article key={source.id}><Database size={15} /><div><strong>{source.fileName}</strong><small>{source.conversationCount} {t('memoryConversations')} · {new Date(source.updatedAt).toLocaleString()}</small></div><button aria-label={pack.code === 'en-US' ? `Remove local source ${source.fileName}` : `清除本地来源 ${source.fileName}`} onClick={() => { if (window.confirm(pack.code === 'en-US' ? `Remove the local source “${source.fileName}”? Its local file copy and source-specific notes, highlights, and annotations will be removed. The project and project conversations will remain.` : `确定清除本地来源“${source.fileName}”吗？这会移除该文件的本地副本，以及仅属于这份来源的笔记、高亮与批注；项目和项目对话会保留。`)) void onDeleteSourceCache(source.id) }}><Trash2 size={14} /></button></article>) : <div className="memory-empty-row">{pack.code === 'en-US' ? 'No local source records' : '暂无本地来源记录'}</div>}</div>
          </section>
          <section className="memory-card">
            <div className="memory-card-title">{pack.code === 'en-US' ? 'User memory' : '用户记忆'}</div>
            <label className="vision-toggle"><input type="checkbox" checked={memorySettings.userMemoryEnabled} onChange={(event) => onMemorySettingsChange({ ...memorySettings, userMemoryEnabled: event.target.checked })} /><span className="vision-switch" aria-hidden="true" /><span><strong>{t('userMemory')}</strong><small>{t('userMemoryHelp')}</small></span></label>
            <textarea className="user-memory-editor" value={userMemory} onChange={(event) => onUserMemoryChange(event.target.value)} placeholder={t('userMemoryPlaceholder')} />
            <div className="memory-editor-footer"><small>{userMemory.length} / 12000</small>{userMemory && <button onClick={() => { if (window.confirm(t('confirmClearUserMemory'))) onUserMemoryChange('') }}><Trash2 size={13} />{t('clearUserMemory')}</button>}</div>
          </section>
        </section>}

        {tab === 'language' && <section className="import-settings"><div className="import-header"><div><h3>{t('languageSettings')}</h3><p>{t('languageImportHelp')}</p></div><button className="import-button" disabled={importing} onClick={() => runImport('language')}>{importing ? <LoaderCircle className="spin" size={15} /> : <FolderOpen size={15} />}{t('importLanguage')}</button></div>
          <div className="language-list">{languages.map((item) => <button key={item.code} className={language === item.code ? 'active' : ''} onClick={() => onLanguageChange(item.code)}><span>{item.label}</span><small>{item.code}</small>{language === item.code && <CheckCircle2 size={16} />}</button>)}</div>
        </section>}

        {message && <div className={`settings-message ${message.type}`}>{message.type === 'ok' ? <CheckCircle2 size={15} /> : <X size={15} />}<span>{message.text}</span></div>}
      </div>
      {tab === 'models' && <div className="settings-footer"><button className="secondary-button" disabled={testing} onClick={testConnection}>{testing && <LoaderCircle className="spin" size={15} />}{t('test')}</button><button className="save-button" onClick={save}>{t('save')}</button></div>}
    </section>
  </div>
}
