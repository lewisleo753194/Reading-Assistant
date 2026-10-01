import type { PDFDocumentProxy } from 'pdfjs-dist'

export type SourceFile = {
  name: string
  kind: 'pdf' | 'image' | 'text'
  url: string
  file: File
  openaiFileId?: string
  indexStatus?: 'local' | 'uploading' | 'ready' | 'error'
}

export type OcrWord = {
  text: string
  left: number
  top: number
  width: number
  height: number
}

export type OcrPage = {
  page: number
  text: string
  words: OcrWord[]
}

export type SelectionResult = {
  image: string
  images: string[]
  page: number
  regions: Array<{
    page: number
    region: { left: number; top: number; width: number; height: number }
  }>
  annotationTexts?: string[]
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  turnId?: string
  status?: 'completed' | 'streaming' | 'stopped' | 'error'
  contextSnapshot?: ChatContextSnapshot
  label?: string
  sourcePage?: number
  streaming?: boolean
  attachments?: ChatAttachmentSummary[]
}

export type ChatContextSnapshot = {
  mode: 'general' | 'selection' | 'document' | 'notebook'
  sourceNames: string[]
  anchorPages: number[]
  attachmentNames: string[]
  selectedSourceCount?: number
  totalSourceCount?: number
}

export type ChatAttachmentKind = 'image' | 'pdf' | 'text'

export type ChatAttachmentSummary = {
  id: string
  name: string
  kind: ChatAttachmentKind
  size: number
  origin?: 'upload' | 'selection'
  page?: number
}

export type AiConfig = {
  provider: 'openai-compatible' | 'openai-responses' | 'codex'
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
  codexModel: string
  webSearchEnabled: boolean
  codexDeepThinkingEnabled: boolean
  codexReasoningEffort: 'low' | 'medium' | 'high' | 'xhigh'
}

export type CodexAccountStatus = {
  available: boolean
  account: null | { type: 'chatgpt' | 'apiKey'; email?: string | null; planType?: string }
  requiresOpenaiAuth?: boolean
  error?: string
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

export type AnnotationPoint = { x: number; y: number }

export type InkAnnotation = {
  id: string
  type: 'ink'
  page: number
  color: string
  strokeWidth: number
  points: AnnotationPoint[]
}

export type TextAnnotation = {
  id: string
  type: 'text'
  page: number
  color: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  text: string
}

export type DocumentAnnotation = InkAnnotation | TextAnnotation
export type AnnotationTool = 'text' | 'ink' | 'eraser'

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
  /** Undefined means every source in the project; an array keeps a per-conversation custom subset. */
  sourceMemoryKeys?: string[]
}

export type WorkArea = {
  id: string
  projectId: string
  memoryKey: string
  source: SourceFile
  pdf: PDFDocumentProxy | null
  documentText: string
  documentProcessingComplete: boolean
  ocrPages: Record<string, OcrPage>
  selectedText: string
  selections: CapturedSelection[]
  conversations: Conversation[]
  activeConversationId: string
  customPrompt: string
  zoom: number
  currentPage: number
  areaSelectionEnabled: boolean
  scope: 'general' | 'selection' | 'document' | 'notebook'
  note: string
  noteAssets: Record<string, string>
  highlights: DocumentHighlight[]
  annotations: DocumentAnnotation[]
}

export type StudyProject = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  conversations: Conversation[]
  activeConversationId: string
  vectorStoreId?: string
}

export type PanelId = 'projects' | 'selection' | 'chat' | 'studio' | 'notes'
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
      setDockZones: (visible: boolean, active: 'left' | 'right' | null, dark?: boolean) => void
      setModalOverlayActive: (active: boolean) => void
    }
  }
}
