import { Bot, BrainCircuit, CheckCircle2, Database, Eye, EyeOff, FolderOpen, Languages, LoaderCircle, Puzzle, Settings2, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { LanguagePack } from '../i18n'
import { useI18n, type AppLanguage } from '../i18n'
import type { AiConfig, ImportedSkill, MemorySettings } from '../types'
import type { FileMemorySummary } from '../lib/memory'

type SettingsTab = 'models' | 'skills' | 'memory' | 'language'

type Props = {
  value: AiConfig
  serverConfigured: boolean
  skills: ImportedSkill[]
  language: AppLanguage
  languages: LanguagePack[]
  memorySettings: MemorySettings
  userMemory: string
  projects: FileMemorySummary[]
  onClose: () => void
  onSave: (config: AiConfig) => void
  onImportSkill: () => Promise<boolean>
  onRemoveSkill: (id: string) => void
  onImportLanguage: () => Promise<boolean>
  onLanguageChange: (language: AppLanguage) => void
  onMemorySettingsChange: (settings: MemorySettings) => void
  onUserMemoryChange: (memory: string) => void
  onDeleteProject: (id: string) => Promise<void>
}

export default function AiSettingsModal({ value, serverConfigured, skills, language, languages, memorySettings, userMemory, projects, onClose, onSave, onImportSkill, onRemoveSkill, onImportLanguage, onLanguageChange, onMemorySettingsChange, onUserMemoryChange, onDeleteProject }: Props) {
  const { t, pack } = useI18n()
  const [tab, setTab] = useState<SettingsTab>('models')
  const [draft, setDraft] = useState(value)
  const [showKey, setShowKey] = useState(false)
  const [showVisionKey, setShowVisionKey] = useState(false)
  const [showReasoningKey, setShowReasoningKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

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
    if (!draft.apiKey.trim() && !serverConfigured) return setMessage({ type: 'error', text: pack.code === 'en-US' ? 'Enter an API key.' : '请填写 API Key。' })
    if (!draft.baseUrl.trim() || !draft.model.trim()) return setMessage({ type: 'error', text: pack.code === 'en-US' ? 'The API URL and model are required.' : '接口地址和模型名称不能为空。' })
    if (draft.visionEnabled && !draft.visionModel.trim()) return setMessage({ type: 'error', text: pack.code === 'en-US' ? 'Enter a vision model.' : '启用公式与图表理解后，请填写视觉模型名称。' })
    if (draft.reasoningEnabled && !draft.reasoningModel.trim()) return setMessage({ type: 'error', text: pack.code === 'en-US' ? 'Enter a deep-thinking model.' : '启用深度思考后，请填写深度思考模型名称。' })
    onSave({
      apiKey: draft.apiKey.trim(), baseUrl: draft.baseUrl.trim().replace(/\/$/, ''), model: draft.model.trim(),
      visionEnabled: draft.visionEnabled, visionApiKey: draft.visionApiKey.trim(), visionBaseUrl: draft.visionBaseUrl.trim().replace(/\/$/, ''), visionModel: draft.visionModel.trim(),
      reasoningEnabled: draft.reasoningEnabled, reasoningApiKey: draft.reasoningApiKey.trim(), reasoningBaseUrl: draft.reasoningBaseUrl.trim().replace(/\/$/, ''), reasoningModel: draft.reasoningModel.trim(),
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
          <label className="field-label">{t('apiUrl')}</label><input className="settings-input" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://your-provider.example/v1" autoComplete="url" />
          <label className="field-label">{t('model')}</label><input className="settings-input" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="model-name" />
          <label className="field-label">{t('apiKey')}</label><div className="key-input"><input type={showKey ? 'text' : 'password'} value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={serverConfigured ? t('serverFallback') : 'sk-…'} autoComplete="off" /><button onClick={() => setShowKey((value) => !value)} aria-label={showKey ? t('hideKey') : t('showKey')}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>

          <section className="vision-config"><label className="vision-toggle"><input type="checkbox" checked={draft.visionEnabled} onChange={(event) => setDraft({ ...draft, visionEnabled: event.target.checked })} /><span className="vision-switch" aria-hidden="true" /><span><strong>{t('visual')}</strong></span></label>{draft.visionEnabled && <div className="vision-fields">
            <label className="field-label">{t('visualUrl')}</label><input className="settings-input" value={draft.visionBaseUrl} onChange={(event) => setDraft({ ...draft, visionBaseUrl: event.target.value })} placeholder={t('inheritUrl')} autoComplete="url" />
            <label className="field-label">{t('visualModel')}</label><input className="settings-input" value={draft.visionModel} onChange={(event) => setDraft({ ...draft, visionModel: event.target.value })} placeholder="vision-model-name" />
            <label className="field-label">{t('visualKey')}</label><div className="key-input"><input type={showVisionKey ? 'text' : 'password'} value={draft.visionApiKey} onChange={(event) => setDraft({ ...draft, visionApiKey: event.target.value })} placeholder={t('inheritKey')} autoComplete="off" /><button onClick={() => setShowVisionKey((value) => !value)} aria-label={showVisionKey ? t('hideKey') : t('showKey')}>{showVisionKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          </div>}</section>

          <section className="vision-config"><label className="vision-toggle"><input type="checkbox" checked={draft.reasoningEnabled} onChange={(event) => setDraft({ ...draft, reasoningEnabled: event.target.checked })} /><span className="vision-switch" aria-hidden="true" /><span><strong>{t('enableDeepThinking')}</strong></span></label>{draft.reasoningEnabled && <div className="vision-fields">
            <label className="field-label">{t('reasoningUrl')}</label><input className="settings-input" value={draft.reasoningBaseUrl} onChange={(event) => setDraft({ ...draft, reasoningBaseUrl: event.target.value })} placeholder={t('inheritUrl')} autoComplete="url" />
            <label className="field-label">{t('reasoningModel')}</label><input className="settings-input" value={draft.reasoningModel} onChange={(event) => setDraft({ ...draft, reasoningModel: event.target.value })} placeholder="reasoning-model-name" />
            <label className="field-label">{t('reasoningKey')}</label><div className="key-input"><input type={showReasoningKey ? 'text' : 'password'} value={draft.reasoningApiKey} onChange={(event) => setDraft({ ...draft, reasoningApiKey: event.target.value })} placeholder={t('inheritKey')} autoComplete="off" /><button onClick={() => setShowReasoningKey((value) => !value)} aria-label={showReasoningKey ? t('hideKey') : t('showKey')}>{showReasoningKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          </div>}</section>
        </>}

        {tab === 'skills' && <section className="import-settings"><div className="import-header"><div><h3>{t('skillSettings')}</h3><p>{t('skillImportHelp')}</p></div><button className="import-button" disabled={importing} onClick={() => runImport('skill')}>{importing ? <LoaderCircle className="spin" size={15} /> : <FolderOpen size={15} />}{t('importSkill')}</button></div>
          <div className="import-list">{skills.length ? skills.map((skill) => <article key={skill.id} className="import-card"><div><strong>{skill.name}</strong><code>/{skill.command}</code><p>{skill.description}</p><small>{skill.sourcePath}</small></div><button onClick={() => onRemoveSkill(skill.id)} title={t('removeSkill')}><Trash2 size={15} /></button></article>) : <div className="import-empty"><Puzzle size={24} /><p>{t('noSkills')}</p></div>}</div>
        </section>}

        {tab === 'memory' && <section className="memory-settings">
          <section className="project-memory-list"><div className="memory-section-heading"><span>{pack.code === 'en-US' ? 'Project memory' : '项目记忆'} · {projects.length}</span></div><div className="memory-file-list">{projects.map((project) => <article key={project.id}><Database size={15} /><div><strong>{project.fileName}</strong><small>{project.conversationCount} {t('memoryConversations')} · {new Date(project.updatedAt).toLocaleString()}</small></div><button onClick={() => { if (window.confirm(pack.code === 'en-US' ? 'Delete this project and all of its data?' : '确定删除此项目及其全部数据吗？')) void onDeleteProject(project.id) }}><Trash2 size={14} /></button></article>)}</div></section>
          <section className="memory-card">
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
