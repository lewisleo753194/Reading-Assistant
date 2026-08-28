export type SourceFile = {
  name: string
  kind: 'pdf' | 'image'
  url: string
  file: File
}

export type SelectionResult = {
  image: string
  images: string[]
  page: number
  regions: Array<{
    page: number
    region: { left: number; top: number; width: number; height: number }
  }>
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  label?: string
  sourcePage?: number
}

export type AiConfig = {
  apiKey: string
  baseUrl: string
  model: string
  visionEnabled: boolean
  visionApiKey: string
  visionBaseUrl: string
  visionModel: string
  reasoningEnabled: boolean
  reasoningApiKey: string
  reasoningBaseUrl: string
  reasoningModel: string
}

export type ImportedSkill = {
  id: string
  name: string
  command: string
  description: string
  instructions: string
  sourcePath: string
}

export type MemorySettings = {
  userMemoryEnabled: boolean
}

export type DocumentHighlight = {
  id: string
  page: number
  text: string
  color: string
}

export type FolderImportResult = {
  canceled?: boolean
  folderPath?: string
  files?: Array<{ path: string; content: string }>
  error?: string
}

declare global {
  interface Window {
    readingAssistant?: {
      selectSkillFolder: () => Promise<FolderImportResult>
      selectLanguageFolder: () => Promise<FolderImportResult>
    }
  }
}
