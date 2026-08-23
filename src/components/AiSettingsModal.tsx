import { CheckCircle2, Eye, EyeOff, LoaderCircle, Settings2, X } from 'lucide-react'
import { useState } from 'react'
import type { AiConfig } from '../types'
import { useI18n } from '../i18n'

type Props = {
  value: AiConfig
  serverConfigured: boolean
  onClose: () => void
  onSave: (config: AiConfig) => void
}

export default function AiSettingsModal({ value, serverConfigured, onClose, onSave }: Props) {
  const { t, pack } = useI18n()
  const [draft, setDraft] = useState(value)
  const [showKey, setShowKey] = useState(false)
  const [showVisionKey, setShowVisionKey] = useState(false)
  const [showReasoningKey, setShowReasoningKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const testConnection = async () => {
    setTesting(true)
    setMessage(null)
    try {
      const response = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiConfig: draft }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || t('connectionFailed'))
      setMessage({ type: 'ok', text: pack.code === 'en-US' ? 'Connection successful.' : '连接成功。' })
    } catch (reason) {
      setMessage({ type: 'error', text: reason instanceof Error ? reason.message : t('connectionFailed') })
    } finally {
      setTesting(false)
    }
  }

  const save = () => {
    if (!draft.apiKey.trim() && !serverConfigured) {
      setMessage({ type: 'error', text: pack.code === 'en-US' ? 'Enter an API key.' : '请填写 API Key。' })
      return
    }
    if (!draft.baseUrl.trim() || !draft.model.trim()) {
      setMessage({ type: 'error', text: pack.code === 'en-US' ? 'The API URL and model are required.' : '接口地址和模型名称不能为空。' })
      return
    }
    if (draft.visionEnabled && !draft.visionModel.trim()) {
      setMessage({ type: 'error', text: pack.code === 'en-US' ? 'Enter a vision model.' : '启用公式与图表理解后，请填写视觉模型名称。' })
      return
    }
    if (draft.reasoningEnabled && !draft.reasoningModel.trim()) {
      setMessage({ type: 'error', text: pack.code === 'en-US' ? 'Enter a deep-thinking model.' : '启用深度思考后，请填写深度思考模型名称。' })
      return
    }
    onSave({
      apiKey: draft.apiKey.trim(),
      baseUrl: draft.baseUrl.trim().replace(/\/$/, ''),
      model: draft.model.trim(),
      visionEnabled: draft.visionEnabled,
      visionApiKey: draft.visionApiKey.trim(),
      visionBaseUrl: draft.visionBaseUrl.trim().replace(/\/$/, ''),
      visionModel: draft.visionModel.trim(),
      reasoningEnabled: draft.reasoningEnabled,
      reasoningApiKey: draft.reasoningApiKey.trim(),
      reasoningBaseUrl: draft.reasoningBaseUrl.trim().replace(/\/$/, ''),
      reasoningModel: draft.reasoningModel.trim(),
    })
    onClose()
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
        <div className="settings-heading">
          <div className="settings-icon"><Settings2 size={20} /></div>
          <div><h2 id="ai-settings-title">{t('configTitle')}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label={t('close')}><X size={18} /></button>
        </div>

        <div className="settings-body">
          <div className="model-section-title">{t('defaultModel')}</div>
          <label className="field-label">{t('apiUrl')}</label>
          <input className="settings-input" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://your-provider.example/v1" autoComplete="url" />

          <label className="field-label">{t('model')}</label>
          <input className="settings-input" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="model-name" />

          <label className="field-label">{t('apiKey')}</label>
          <div className="key-input">
            <input type={showKey ? 'text' : 'password'} value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={serverConfigured ? '留空则使用服务端配置' : 'sk-…'} autoComplete="off" />
            <button onClick={() => setShowKey((value) => !value)} aria-label={showKey ? t('hideKey') : t('showKey')}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>

          <section className="vision-config">
            <label className="vision-toggle">
              <input type="checkbox" checked={draft.visionEnabled} onChange={(event) => setDraft({ ...draft, visionEnabled: event.target.checked })} />
              <span className="vision-switch" aria-hidden="true" />
              <span><strong>{t('visual')}</strong></span>
            </label>
            {draft.visionEnabled && <div className="vision-fields">
              <label className="field-label">{t('visualUrl')}</label>
              <input className="settings-input" value={draft.visionBaseUrl} onChange={(event) => setDraft({ ...draft, visionBaseUrl: event.target.value })} placeholder={t('inheritUrl')} autoComplete="url" />

              <label className="field-label">{t('visualModel')}</label>
              <input className="settings-input" value={draft.visionModel} onChange={(event) => setDraft({ ...draft, visionModel: event.target.value })} placeholder="vision-model-name" />

              <label className="field-label">{t('visualKey')}</label>
              <div className="key-input">
                <input type={showVisionKey ? 'text' : 'password'} value={draft.visionApiKey} onChange={(event) => setDraft({ ...draft, visionApiKey: event.target.value })} placeholder={t('inheritKey')} autoComplete="off" />
                <button onClick={() => setShowVisionKey((value) => !value)} aria-label={showVisionKey ? t('hideKey') : t('showKey')}>{showVisionKey ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
            </div>}
          </section>

          <section className="vision-config">
            <label className="vision-toggle">
              <input type="checkbox" checked={draft.reasoningEnabled} onChange={(event) => setDraft({ ...draft, reasoningEnabled: event.target.checked })} />
              <span className="vision-switch" aria-hidden="true" />
              <span><strong>{t('enableDeepThinking')}</strong></span>
            </label>
            {draft.reasoningEnabled && <div className="vision-fields">
              <label className="field-label">{t('reasoningUrl')}</label>
              <input className="settings-input" value={draft.reasoningBaseUrl} onChange={(event) => setDraft({ ...draft, reasoningBaseUrl: event.target.value })} placeholder={t('inheritUrl')} autoComplete="url" />

              <label className="field-label">{t('reasoningModel')}</label>
              <input className="settings-input" value={draft.reasoningModel} onChange={(event) => setDraft({ ...draft, reasoningModel: event.target.value })} placeholder="reasoning-model-name" />

              <label className="field-label">{t('reasoningKey')}</label>
              <div className="key-input">
                <input type={showReasoningKey ? 'text' : 'password'} value={draft.reasoningApiKey} onChange={(event) => setDraft({ ...draft, reasoningApiKey: event.target.value })} placeholder={t('inheritKey')} autoComplete="off" />
                <button onClick={() => setShowReasoningKey((value) => !value)} aria-label={showReasoningKey ? t('hideKey') : t('showKey')}>{showReasoningKey ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
            </div>}
          </section>

          {message && <div className={`settings-message ${message.type}`}>
            {message.type === 'ok' ? <CheckCircle2 size={15} /> : <X size={15} />}<span>{message.text}</span>
          </div>}
        </div>

        <div className="settings-footer">
          <button className="secondary-button" disabled={testing} onClick={testConnection}>{testing && <LoaderCircle className="spin" size={15} />}{t('test')}</button>
          <button className="save-button" onClick={save}>{t('save')}</button>
        </div>
      </section>
    </div>
  )
}
