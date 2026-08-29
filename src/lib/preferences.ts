import type { AiConfig, ImportedSkill, MemorySettings, PanelId, PanelLayout } from '../types'

export const defaultAiConfig: AiConfig = {
  apiKey: '',
  baseUrl: '',
  model: '',
  visionEnabled: false,
  visionApiKey: '',
  visionBaseUrl: '',
  visionModel: '',
  reasoningEnabled: false,
  reasoningApiKey: '',
  reasoningBaseUrl: '',
  reasoningModel: '',
}

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key)
    return saved ? JSON.parse(saved) as T : fallback
  } catch {
    return fallback
  }
}

export const loadAiConfig = (): AiConfig => ({ ...defaultAiConfig, ...readJson<Partial<AiConfig>>('reading-assistant-ai-config', {}) })
export const loadDarkTheme = () => localStorage.getItem('reading-assistant-theme') === 'dark'
export const loadMemorySettings = (): MemorySettings => ({ userMemoryEnabled: false, ...readJson<Partial<MemorySettings>>('reading-assistant-memory-settings', {}) })
export const loadUserMemory = () => localStorage.getItem('reading-assistant-user-memory') || ''
export const loadSkills = (): ImportedSkill[] => {
  const value = readJson<unknown>('reading-assistant-skills', [])
  return Array.isArray(value) ? value as ImportedSkill[] : []
}

const defaultPanels: Record<PanelId, PanelLayout> = {
  projects: { open: true, dock: 'left', x: 90, y: 70, width: 310, height: 620, dockSize: 1, z: 40 },
  selection: { open: false, dock: 'left', x: 130, y: 90, width: 340, height: 560, dockSize: 1, z: 41 },
  chat: { open: false, dock: 'left', x: 720, y: 65, width: 420, height: 720, dockSize: 1, z: 42 },
  notes: { open: false, dock: 'left', x: 640, y: 100, width: 430, height: 650, dockSize: 1, z: 43 },
}

export const loadPanelLayouts = (): Record<PanelId, PanelLayout> => {
  const parsed = readJson<unknown>('reading-assistant-panel-layouts', {})
  const saved = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Partial<Record<PanelId, Partial<PanelLayout>>>
    : {}
  return Object.fromEntries(Object.entries(defaultPanels).map(([id, layout]) => [id, { ...layout, ...(saved[id as PanelId] || {}), dockSize: 1 }])) as Record<PanelId, PanelLayout>
}
