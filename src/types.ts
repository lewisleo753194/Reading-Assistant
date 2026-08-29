import type { PDFDocumentProxy } from 'pdfjs-dist'

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
  regions?: SelectionResult['regions']
}

export type FolderImportResult = {
  canceled?: boolean
  folderPath?: string
  files?: Array<{ path: string; content: string }>
  error?: string
}

export type AiAction = 'translate' | 'explain' | 'insight' | 'summarize' | 'custom'

export type CapturedSelection = SelectionResult & {
  id: string
  text: string
  textParts: string[]
  loading: boolean
}

export type Conversation = {
  id: string
  title: string
  history: ChatMessage[]
}

export type WorkArea = {
  id: string
  memoryKey: string
  source: SourceFile
  pdf: PDFDocumentProxy | null
  documentText: string
  selectedText: string
  selections: CapturedSelection[]
  conversations: Conversation[]
  activeConversationId: string
  customPrompt: string
  zoom: number
  currentPage: number
  areaSelectionEnabled: boolean
  scope: 'selection' | 'document'
  note: string
  noteAssets: Record<string, string>
  highlights: DocumentHighlight[]
}

export type PanelId = 'projects' | 'selection' | 'chat' | 'notes'
export type PanelDock = 'left' | 'right' | 'float'
export type PanelLayout = { open: boolean; dock: PanelDock; x: number; y: number; width: number; height: number; dockSize: number; z: number }

declare global {
  interface Window {
    readingAssistant?: {
      selectSkillFolder: () => Promise<FolderImportResult>
      selectLanguageFolder: () => Promise<FolderImportResult>
      movePanelWindow: (id: string, x: number, y: number) => void
      preparePanelDrag: () => void
      setPanelDragging: (active: boolean) => void
      setDockZones: (visible: boolean, active: 'left' | 'right' | null) => void
    }
  }
}
