import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Worker as OcrWorker } from 'tesseract.js'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import {
  BrainCircuit, ChevronLeft, ChevronRight, Copy, FileText, Languages, FolderOpen,
  Eraser, Lightbulb, LoaderCircle, MessageSquareText, Minus, Palette, PenLine,
  Paperclip, Plus, Puzzle, Send, Sparkles, MousePointer2, TextCursorInput, Type, X, StickyNote, Square,
} from 'lucide-react'
import ActivityBar from './components/ActivityBar'
import DocumentViewer from './components/DocumentViewer'
import AiSettingsModal from './components/AiSettingsModal'
import NoteEditor from './components/NoteEditor'
import ProjectExplorer from './components/ProjectExplorer'
import StudioPanel from './components/StudioPanel'
import WorkspacePanel from './components/WorkspacePanel'
import { extractPdfRegionText, extractPdfText, loadPdf } from './lib/pdf'
import type { AiAction, AiConfig, AnnotationTool, CapturedSelection, ChatAttachmentKind, ChatAttachmentSummary, ChatContextSnapshot, ChatMessage, Conversation, DocumentAnnotation, DocumentHighlight, ImportedSkill, MemorySettings, PanelId, PanelLayout, SelectionResult, SourceFile, StudyProject, TextAnnotation, WorkArea } from './types'
import { getLanguagePacks, registerLanguagePack, useI18n, type AppLanguage, type LanguagePack } from './i18n'
import { parseLanguageImport, parseSkillImport } from './lib/imports'
import { deleteConversationAttachment, deleteConversationAttachments, deleteFileMemory, deleteProjectConversationAttachments, deleteProjectMemory, getFileMemory, getFileMemoryId, listConversationAttachments, listFileMemories, listFileMemoryRecords, listProjectMemories, saveConversationAttachment, saveFileMemory, saveProjectMemory, type ConversationAttachmentRecord, type FileMemoryRecord, type FileMemorySummary } from './lib/memory'
import { loadAiConfig, loadDarkTheme, loadMemorySettings, loadPanelLayouts, loadSkills, loadUserMemory } from './lib/preferences'


const makeId = () => crypto.randomUUID()
const getCurrentTimestamp = () => Date.now()
const legacyProjectId = 'raid-default-project'
const textFilePattern = /\.(txt|md|markdown|csv|json|html|xml)$/i
const chatAttachmentAccept = 'image/*,application/pdf,.txt,.md,.markdown,.csv,.json,.html,.xml'
const maxConversationAttachments = 8
const maxConversationImages = 4
const maxTemporaryAttachmentCharacters = 160_000
const safeSourceLabel = (name: string) => name.replace(/[|[\]\r\n】]/g, ' ').trim()
const getSourceKind = (file: File): SourceFile['kind'] => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  ? 'pdf'
  : file.type.startsWith('image/') ? 'image' : 'text'
const isSupportedSource = (file: File) => getSourceKind(file) !== 'text' || file.type.startsWith('text/') || textFilePattern.test(file.name) || ['application/json', 'application/xml'].includes(file.type)
const fileToDataUrl = async (file: File) => {
  if (/^image\/(png|jpeg|webp)$/.test(file.type)) return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('无法读取图片。'))
    reader.readAsDataURL(file)
  })
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas.toDataURL('image/png')
}
const chatImageToDataUrl = async (file: File) => {
  if (file.size <= 4 * 1024 * 1024 && /^image\/(png|jpeg|webp)$/.test(file.type)) return fileToDataUrl(file)
  const bitmap = await createImageBitmap(file)
  const maximumDimension = 2400
  const scale = Math.min(1, maximumDimension / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', .88)
}
type RuntimeChatAttachment = ChatAttachmentSummary & {
  file: File
  mimeType: string
  lastModified: number
  createdAt: number
  messageId: string
  previewUrl: string
  preparedText?: string
  preparedImages?: string[]
}
const getChatAttachmentKind = (file: File): ChatAttachmentKind | null => file.type.startsWith('image/')
  ? 'image'
  : file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    ? 'pdf'
    : file.type.startsWith('text/') || textFilePattern.test(file.name) || ['application/json', 'application/xml'].includes(file.type)
      ? 'text'
      : null
const formatFileSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
const attachmentFromRecord = (record: ConversationAttachmentRecord): RuntimeChatAttachment => {
  const file = new File([record.fileBlob], record.name, { type: record.mimeType, lastModified: record.lastModified })
  return { id: record.id, name: record.name, kind: record.kind, size: record.size, file, mimeType: record.mimeType, lastModified: record.lastModified, createdAt: record.createdAt, messageId: record.messageId, previewUrl: record.kind === 'image' ? URL.createObjectURL(file) : '', preparedText: record.preparedText }
}
const contextSnapshotLabel = (snapshot?: ChatContextSnapshot) => {
  if (!snapshot) return ''
  const scope = snapshot.mode === 'general' ? '自由提问' : snapshot.mode === 'notebook' ? `项目来源 ${snapshot.selectedSourceCount || snapshot.sourceNames.length}/${snapshot.totalSourceCount || snapshot.sourceNames.length}` : snapshot.mode === 'document' ? '全文' : '选区'
  const sources = snapshot.sourceNames.length ? snapshot.sourceNames.join('、') : ''
  const pages = snapshot.anchorPages.length ? `第 ${snapshot.anchorPages.join('、')} 页` : ''
  const attachments = snapshot.attachmentNames.length ? `附件 ${snapshot.attachmentNames.join('、')}` : ''
  return [scope, sources, pages, attachments].filter(Boolean).join(' · ')
}
const revokeAttachmentPreviews = (attachments: RuntimeChatAttachment[]) => attachments.forEach((attachment) => { if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl) })
const nextPanelZ = (items: Record<PanelId, PanelLayout>) => Math.max(40, ...Object.values(items).map((item) => item.z)) + 1
const normalizePanelZ = (items: Record<PanelId, PanelLayout>) => Object.fromEntries(
  (Object.entries(items) as [PanelId, PanelLayout][])
    .sort(([, first], [, second]) => first.z - second.z)
    .map(([id, layout], index) => [id, { ...layout, z: 41 + index }]),
) as Record<PanelId, PanelLayout>
const normalizeAssistantMarkdown = (content: string) => content
  .replace(/```(?:latex|tex)\s*([\s\S]*?)```/gi, (_match, formula: string) => `\n$$\n${formula.trim()}\n$$\n`)
  .replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) => `\n$$\n${formula.trim()}\n$$\n`)
  .replace(/\\\((.*?)\\\)/g, (_match, formula: string) => `$${formula.trim()}$`)
  .replace(/\[\[SOURCE:([^|\]]+)\|(\d+)\]\]/g, (_match, sourceName: string, page: string) => `[${sourceName.trim()} · 第 ${page} 页](source:${encodeURIComponent(sourceName.trim())}:${page})`)
  .replace(/\[\[PAGE:(\d+)\]\]/g, (_match, page: string) => `[第 ${page} 页](page:${page})`)

type HighlightRegion = NonNullable<DocumentHighlight['regions']>[number]
type ProjectDialogState = { mode: 'create' | 'rename' | 'delete' | 'delete-source'; projectId?: string; sourceId?: string; value: string }
const highlightRegionOverlap = (a: HighlightRegion, b: HighlightRegion) => {
  if (a.page !== b.page) return false
  const left = Math.max(a.region.left, b.region.left)
  const top = Math.max(a.region.top, b.region.top)
  const right = Math.min(a.region.left + a.region.width, b.region.left + b.region.width)
  const bottom = Math.min(a.region.top + a.region.height, b.region.top + b.region.height)
  if (right <= left || bottom <= top) return false
  const intersection = (right - left) * (bottom - top)
  const smaller = Math.min(a.region.width * a.region.height, b.region.width * b.region.height)
  return intersection / Math.max(smaller, .000001) >= .35
}

const waitForAbort = <T,>(promise: Promise<T>, signal?: AbortSignal) => {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export default function App({ onLanguageChange }: { onLanguageChange: (language: AppLanguage) => void }) {
  const { t, pack } = useI18n()
  const [workAreas, setWorkAreas] = useState<WorkArea[]>([])
  const [projects, setProjects] = useState<StudyProject[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [projectDialog, setProjectDialog] = useState<ProjectDialogState | null>(null)
  const [activeWorkAreaId, setActiveWorkAreaId] = useState<string | null>(null)
  const [source, setSource] = useState<SourceFile | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [documentText, setDocumentText] = useState('')
  const [selectedText, setSelectedText] = useState('')
  const [selections, setSelections] = useState<CapturedSelection[]>([])
  const [initialConversationId] = useState<string>(() => makeId())
  const [conversations, setConversations] = useState<Conversation[]>(() => [{ id: initialConversationId, title: t('untitledConversation'), history: [] }])
  const [activeConversationId, setActiveConversationId] = useState(initialConversationId)
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [customPrompt, setCustomPrompt] = useState('')
  const [pendingChatAttachments, setPendingChatAttachments] = useState<RuntimeChatAttachment[]>([])
  const [conversationAttachments, setConversationAttachments] = useState<RuntimeChatAttachment[]>([])
  const [zoom, setZoom] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [areaSelectionEnabled, setAreaSelectionEnabled] = useState(false)
  const [scope, setScope] = useState<WorkArea['scope']>('general')
  const [dark, setDark] = useState(loadDarkTheme)
  const [leftDockWidth, setLeftDockWidth] = useState(() => Number(localStorage.getItem('reading-assistant-left-width')) || 300)
  const [rightDockWidth, setRightDockWidth] = useState(() => Number(localStorage.getItem('reading-assistant-right-width')) || 390)
  const [promptHeight, setPromptHeight] = useState(78)
  const [selectionSplitRatio, setSelectionSplitRatio] = useState(() => {
    const saved = Number(localStorage.getItem('reading-assistant-selection-split'))
    return Number.isFinite(saved) && saved >= .15 && saved <= .85 ? saved : .46
  })
  const [busy, setBusy] = useState<'ocr' | 'extract' | ''>('')
  const [aiTasks, setAiTasks] = useState<Set<string>>(() => new Set())
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [codexConnected, setCodexConnected] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectMemories, setProjectMemories] = useState<FileMemorySummary[]>([])
  const [aiConfig, setAiConfig] = useState<AiConfig>(loadAiConfig)
  const [skills, setSkills] = useState<ImportedSkill[]>(loadSkills)
  const [memorySettings, setMemorySettings] = useState<MemorySettings>(loadMemorySettings)
  const [userMemory, setUserMemory] = useState(loadUserMemory)
  const [deepThinking, setDeepThinking] = useState(false)
  const reasoningAvailable = aiConfig.provider === 'codex' ? aiConfig.codexDeepThinkingEnabled : aiConfig.reasoningEnabled
  const [note, setNote] = useState('')
  const [noteAssets, setNoteAssets] = useState<Record<string, string>>({})
  const [highlights, setHighlights] = useState<DocumentHighlight[]>([])
  const [annotations, setAnnotations] = useState<DocumentAnnotation[]>([])
  const [annotationMode, setAnnotationMode] = useState(false)
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('ink')
  const [annotationColor, setAnnotationColor] = useState('#2f6fed')
  const [panelLayouts, setPanelLayouts] = useState(() => normalizePanelZ(loadPanelLayouts()))
  const abortControllersRef = useRef(new Map<string, AbortController>())
  const documentContextPromisesRef = useRef(new Map<string, Promise<string>>())
  const hasVisualSelection = (aiConfig.provider === 'codex' || aiConfig.visionEnabled) && selections.some((item) => item.images.length > 0)
  const selectionReady = Boolean(selectedText || hasVisualSelection)
  const workerRef = useRef<OcrWorker | null>(null)
  const workerPromiseRef = useRef<Promise<OcrWorker> | null>(null)
  const showOcrProgressRef = useRef(false)
  const resultsEndRef = useRef<HTMLDivElement>(null)
  const panelScrollRef = useRef<HTMLDivElement>(null)
  const readerScrollRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const resizeRef = useRef<
    | { kind: 'panel'; panel: 'left' | 'right'; startX: number; startWidth: number }
    | { kind: 'dock-split'; first: PanelId; second: PanelId; startY: number; firstSize: number; secondSize: number; containerHeight: number; bottomLocks: HTMLElement[] }
    | { kind: 'prompt'; startY: number; startHeight: number }
    | null
  >(null)
  const selectionBodyRef = useRef<HTMLDivElement>(null)
  const selectionSplitRef = useRef<HTMLDivElement>(null)
  const selectionImagesRef = useRef<HTMLDivElement>(null)
  const selectionTextRef = useRef<HTMLTextAreaElement>(null)
  const selectionSplitRatioRef = useRef(selectionSplitRatio)
  const selectionSplitDragRef = useRef<{ imagesAtBottom: boolean; textAtBottom: boolean } | null>(null)
  const activeWorkAreaIdRef = useRef<string | null>(null)
  const activeProjectIdRef = useRef<string | null>(null)
  const activeConversationIdRef = useRef(activeConversationId)
  const pendingChatAttachmentsRef = useRef<RuntimeChatAttachment[]>([])
  const conversationAttachmentsRef = useRef<RuntimeChatAttachment[]>([])
  const deletedTurnIdsRef = useRef<Set<string>>(new Set())
  const selectionsRef = useRef<CapturedSelection[]>([])
  const pendingPageRestoreRef = useRef<number | null>(null)
  const userMemoryRef = useRef(userMemory)
  const memorySettingsRef = useRef(memorySettings)
  const memoryUpdateQueueRef = useRef<Promise<void>>(Promise.resolve())
  const forgottenFileKeysRef = useRef(new Set<string>())
  const vectorStoreIdsRef = useRef(new Map<string, string>())
  const vectorStoreCreationRef = useRef(new Map<string, Promise<string>>())
  const currentConversationRouteId = activeWorkAreaId || (activeProjectId ? `project:${activeProjectId}` : '')
  const currentAiTaskKey = currentConversationRouteId && activeConversationId ? `${currentConversationRouteId}:${activeConversationId}` : ''
  const currentAiBusy = aiTasks.has(currentAiTaskKey)
  const slashSkillQuery = customPrompt.match(/^\/([^\s]*)$/)?.[1].toLocaleLowerCase()
  const skillSuggestions = slashSkillQuery === undefined ? [] : skills.filter((skill) => skill.command.toLocaleLowerCase().includes(slashSkillQuery) || skill.name.toLocaleLowerCase().includes(slashSkillQuery)).slice(0, 8)

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const resize = resizeRef.current
      if (!resize) return
      if (resize.kind === 'panel') {
        const delta = event.clientX - resize.startX
        if (resize.panel === 'left') setLeftDockWidth(Math.max(220, Math.min(680, resize.startWidth + delta)))
        if (resize.panel === 'right') setRightDockWidth(Math.max(220, Math.min(680, resize.startWidth - delta)))
      }
      if (resize.kind === 'prompt') {
        const nextHeight = Math.max(54, Math.min(window.innerHeight * 0.45, resize.startHeight - (event.clientY - resize.startY)))
        setPromptHeight(nextHeight)
        window.requestAnimationFrame(() => {
          const container = panelScrollRef.current
          if (container) container.scrollTop = container.scrollHeight
        })
      }
      if (resize.kind === 'dock-split') {
        const total = resize.firstSize + resize.secondSize
        const delta = (event.clientY - resize.startY) / Math.max(1, resize.containerHeight) * total
        const firstSize = Math.max(.25, resize.firstSize + delta)
        const secondSize = Math.max(.25, resize.secondSize - delta)
        setPanelLayouts((items) => ({ ...items, [resize.first]: { ...items[resize.first], dockSize: firstSize }, [resize.second]: { ...items[resize.second], dockSize: secondSize } }))
        window.requestAnimationFrame(() => resize.bottomLocks.forEach((element) => { element.scrollTop = element.scrollHeight }))
      }
    }
    const stop = () => {
      if (!resizeRef.current) return
      resizeRef.current = null
      document.body.classList.remove('resizing-panels')
      document.body.classList.remove('resizing-vertical')
      document.body.classList.remove('resizing-dock-split')
      document.body.classList.remove('resizing-selection-split')
      document.body.classList.remove('resizing-prompt')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [])

  const startResize = (panel: 'left' | 'right', startWidth: number, event: ReactPointerEvent) => {
    event.preventDefault()
    resizeRef.current = { kind: 'panel', panel, startX: event.clientX, startWidth }
    document.body.classList.add('resizing-panels')
  }

  const startPromptResize = (event: ReactPointerEvent) => {
    event.preventDefault()
    resizeRef.current = { kind: 'prompt', startY: event.clientY, startHeight: promptHeight }
    document.body.classList.add('resizing-vertical')
    document.body.classList.add('resizing-prompt')
    const container = panelScrollRef.current
    if (container) container.scrollTop = container.scrollHeight
  }

  const startDockSplitResize = (first: PanelId, second: PanelId, event: ReactPointerEvent) => {
    const container = event.currentTarget.parentElement
    if (!container) return
    event.preventDefault()
    const panels = [event.currentTarget.previousElementSibling, event.currentTarget.nextElementSibling]
    const bottomLocks = panels.flatMap((panel) => panel ? [panel, ...panel.querySelectorAll<HTMLElement>('*')] : []).filter((element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false
      const scrollable = element instanceof HTMLTextAreaElement || /auto|scroll/.test(window.getComputedStyle(element).overflowY)
      return scrollable && element.scrollHeight - element.scrollTop - element.clientHeight <= 16
    })
    resizeRef.current = { kind: 'dock-split', first, second, startY: event.clientY, firstSize: panelLayouts[first].dockSize, secondSize: panelLayouts[second].dockSize, containerHeight: container.clientHeight, bottomLocks }
    document.body.classList.add('resizing-vertical')
    document.body.classList.add('resizing-dock-split')
  }

  const selectionPaneAtBottom = (element: HTMLElement | null) => !element || element.scrollHeight - element.scrollTop - element.clientHeight <= 16
  const startSelectionSplit = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    selectionSplitDragRef.current = { imagesAtBottom: selectionPaneAtBottom(selectionImagesRef.current), textAtBottom: selectionPaneAtBottom(selectionTextRef.current) }
    document.body.classList.add('resizing-selection-split')
  }
  const moveSelectionSplit = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectionSplitDragRef.current || !selectionSplitRef.current) return
    const bounds = selectionSplitRef.current.getBoundingClientRect()
    const available = Math.max(1, bounds.height - 7)
    const minimum = Math.min(86, available * .4)
    const imageHeight = Math.max(minimum, Math.min(available - minimum, event.clientY - bounds.top - 3.5))
    const next = imageHeight / available
    selectionSplitRatioRef.current = next
    setSelectionSplitRatio(next)
    window.requestAnimationFrame(() => {
      const dragging = selectionSplitDragRef.current
      if (!dragging) return
      if (dragging.imagesAtBottom && selectionImagesRef.current) selectionImagesRef.current.scrollTop = selectionImagesRef.current.scrollHeight
      if (dragging.textAtBottom && selectionTextRef.current) selectionTextRef.current.scrollTop = selectionTextRef.current.scrollHeight
    })
  }
  const stopSelectionSplit = () => {
    if (!selectionSplitDragRef.current) return
    selectionSplitDragRef.current = null
    document.body.classList.remove('resizing-selection-split')
    localStorage.setItem('reading-assistant-selection-split', String(selectionSplitRatioRef.current))
  }

  useEffect(() => { activeWorkAreaIdRef.current = activeWorkAreaId }, [activeWorkAreaId])
  useEffect(() => { activeProjectIdRef.current = activeProjectId }, [activeProjectId])
  useEffect(() => { activeConversationIdRef.current = activeConversationId }, [activeConversationId])
  useEffect(() => { pendingChatAttachmentsRef.current = pendingChatAttachments }, [pendingChatAttachments])
  useEffect(() => { conversationAttachmentsRef.current = conversationAttachments }, [conversationAttachments])
  useEffect(() => { selectionsRef.current = selections }, [selections])
  useEffect(() => {
    let active = true
    revokeAttachmentPreviews(pendingChatAttachmentsRef.current)
    pendingChatAttachmentsRef.current = []
    revokeAttachmentPreviews(conversationAttachmentsRef.current)
    conversationAttachmentsRef.current = []
    void (async () => {
      await Promise.resolve()
      if (!active) return
      setPendingChatAttachments([])
      setConversationAttachments([])
      if (!activeConversationId || !activeProjectId) return
      const records = await listConversationAttachments(activeConversationId)
      if (!active) return
      const attachments = records.filter((record) => record.projectId === activeProjectId).sort((a, b) => a.createdAt - b.createdAt).map(attachmentFromRecord)
      conversationAttachmentsRef.current = attachments
      setConversationAttachments(attachments)
    })().catch(() => undefined)
    return () => { active = false }
  }, [activeConversationId, activeProjectId])
  useEffect(() => {
    if (!activeProjectId) return
    const sharedConversations = conversations.map((item) => item.id === activeConversationId ? { ...item, history } : item)
    const timer = window.setTimeout(() => {
      setWorkAreas((items) => items.map((area) => area.projectId === activeProjectId ? { ...area, conversations: sharedConversations, activeConversationId } : area))
      setProjects((items) => items.map((project) => project.id === activeProjectId ? { ...project, conversations: sharedConversations, activeConversationId, updatedAt: getCurrentTimestamp() } : project))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [conversations, activeConversationId, history, activeProjectId])

  useEffect(() => {
    if (!projects.length) return
    const timer = window.setTimeout(() => projects.forEach((project) => { void saveProjectMemory(project).catch(() => undefined) }), 500)
    return () => window.clearTimeout(timer)
  }, [projects])

  useEffect(() => {
    const persistentLayouts = Object.fromEntries(Object.entries(panelLayouts).map(([id, layout]) => [id, { ...layout, dockSize: 1 }]))
    localStorage.setItem('reading-assistant-panel-layouts', JSON.stringify(persistentLayouts))
  }, [panelLayouts])
  useEffect(() => { localStorage.setItem('reading-assistant-left-width', String(leftDockWidth)) }, [leftDockWidth])
  useEffect(() => { localStorage.setItem('reading-assistant-right-width', String(rightDockWidth)) }, [rightDockWidth])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('reading-assistant-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    memorySettingsRef.current = memorySettings
    localStorage.setItem('reading-assistant-memory-settings', JSON.stringify(memorySettings))
  }, [memorySettings])

  useEffect(() => {
    userMemoryRef.current = userMemory
    localStorage.setItem('reading-assistant-user-memory', userMemory)
  }, [userMemory])

  const openSettings = () => {
    setSettingsOpen(true)
    void listFileMemories().then(setProjectMemories).catch(() => setProjectMemories([]))
  }

  useEffect(() => {
    if (!source) return
    const projectId = workAreas.find((area) => area.id === activeWorkAreaId)?.projectId || activeProjectId || legacyProjectId
    const memoryKey = getFileMemoryId(source.file, projectId)
    if (forgottenFileKeysRef.current.has(memoryKey)) return
    const timer = window.setTimeout(() => {
      if (forgottenFileKeysRef.current.has(memoryKey)) return
      const syncedConversations = conversations.map((item) => item.id === activeConversationId ? { ...item, history } : item)
      const record: FileMemoryRecord = {
        id: memoryKey,
        projectId,
        fileName: source.file.name,
        fileSize: source.file.size,
        fileType: source.file.type,
        lastModified: source.file.lastModified,
        updatedAt: getCurrentTimestamp(),
        conversations: syncedConversations,
        activeConversationId,
        currentPage,
        zoom,
        areaSelectionEnabled,
        scope,
        fileBlob: source.file,
        documentText,
        documentTextVersion: 3,
        note,
        noteAssets,
        highlights,
        annotations,
        openaiFileId: source.openaiFileId,
        indexStatus: source.indexStatus,
      }
      void saveFileMemory(record).catch(() => undefined)
    }, 700)
    return () => window.clearTimeout(timer)
  }, [source, conversations, activeConversationId, history, currentPage, zoom, areaSelectionEnabled, scope, documentText, note, noteAssets, highlights, annotations, activeProjectId, activeWorkAreaId, workAreas])

  useEffect(() => {
    const inactiveAreas = workAreas.filter((area) => area.id !== activeWorkAreaId && !forgottenFileKeysRef.current.has(area.memoryKey))
    if (!inactiveAreas.length) return
    const timer = window.setTimeout(() => {
      inactiveAreas.forEach((area) => {
        if (forgottenFileKeysRef.current.has(area.memoryKey)) return
        const record: FileMemoryRecord = {
          id: area.memoryKey,
          projectId: area.projectId,
          fileName: area.source.file.name,
          fileSize: area.source.file.size,
          fileType: area.source.file.type,
          lastModified: area.source.file.lastModified,
          updatedAt: getCurrentTimestamp(),
          conversations: area.conversations,
          activeConversationId: area.activeConversationId,
          currentPage: area.currentPage,
          zoom: area.zoom,
          areaSelectionEnabled: area.areaSelectionEnabled,
          scope: area.scope,
          fileBlob: area.source.file,
          documentText: area.documentText,
          documentTextVersion: 3,
          note: area.note,
          noteAssets: area.noteAssets,
          highlights: area.highlights,
          annotations: area.annotations,
          openaiFileId: area.source.openaiFileId,
          indexStatus: area.source.indexStatus,
        }
        void saveFileMemory(record).catch(() => undefined)
      })
    }, 700)
    return () => window.clearTimeout(timer)
  }, [workAreas, activeWorkAreaId])

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((data) => setConfigured(data.configured)).catch(() => setConfigured(false))
  }, [])

  useEffect(() => {
    if (aiConfig.provider !== 'codex') return
    let active = true
    fetch('/api/codex/account').then((response) => response.json()).then((data) => { if (active) setCodexConnected(Boolean(data.account)) }).catch(() => { if (active) setCodexConnected(false) })
    return () => { active = false }
  }, [aiConfig.provider])

  useEffect(() => {
    let active = true
    void Promise.all([listFileMemoryRecords(), listProjectMemories()]).then(([records, savedProjects]) => {
      if (!active) return
      const projectMap = new Map(savedProjects.map((project) => [project.id, project]))
      const recordProjectIds = [...new Set(records.map((record) => record.projectId || legacyProjectId))]
      recordProjectIds.forEach((projectId, index) => {
        if (projectMap.has(projectId)) return
        const latest = records.filter((record) => (record.projectId || legacyProjectId) === projectId).sort((a, b) => b.updatedAt - a.updatedAt)[0]
        const fallbackConversation: Conversation = { id: makeId(), title: '新对话', history: [] }
        const project: StudyProject = {
          id: projectId,
          name: projectId === legacyProjectId ? '我的学习项目' : `项目 ${index + 1}`,
          createdAt: latest?.updatedAt || getCurrentTimestamp(),
          updatedAt: latest?.updatedAt || getCurrentTimestamp(),
          conversations: latest?.conversations?.length ? latest.conversations : [fallbackConversation],
          activeConversationId: latest?.activeConversationId || fallbackConversation.id,
        }
        projectMap.set(projectId, project)
      })
      const restoredProjects = [...projectMap.values()].sort((a, b) => b.updatedAt - a.updatedAt)
      vectorStoreIdsRef.current = new Map(restoredProjects.flatMap((project) => project.vectorStoreId ? [[project.id, project.vectorStoreId] as const] : []))
      const restored = records.filter((record) => record.fileBlob).map((record): WorkArea => {
        const file = new File([record.fileBlob!], record.fileName, { type: record.fileType, lastModified: record.lastModified })
        const savedConversations = record.conversations || []
        const savedActiveConversationId = savedConversations.some((item) => item.id === record.activeConversationId) ? record.activeConversationId : savedConversations[0]?.id || ''
        const projectId = record.projectId || legacyProjectId
        const memoryKey = getFileMemoryId(file, projectId)
        if (memoryKey !== record.id) {
          void saveFileMemory({ ...record, id: memoryKey, projectId }).then(() => deleteFileMemory(record.id)).catch(() => undefined)
        }
        const project = projectMap.get(projectId)
        return { id: makeId(), projectId, memoryKey, source: { name: file.name, kind: getSourceKind(file), url: URL.createObjectURL(file), file, openaiFileId: record.openaiFileId, indexStatus: record.indexStatus || 'local' }, pdf: null, documentText: record.documentTextVersion === 3 ? record.documentText || '' : '', selectedText: '', selections: [], conversations: project?.conversations || savedConversations, activeConversationId: project?.activeConversationId || savedActiveConversationId, customPrompt: '', zoom: record.zoom || 1, currentPage: record.currentPage || 1, areaSelectionEnabled: record.areaSelectionEnabled || false, scope: record.scope === 'selection' ? 'general' : record.scope || 'general', note: record.note || '', noteAssets: record.noteAssets || {}, highlights: record.highlights || [], annotations: record.annotations || [] }
      })
      setProjects(restoredProjects)
      setWorkAreas(restored)
      const firstProject = restoredProjects[0]
      if (firstProject) {
        setActiveProjectId(firstProject.id)
        setConversations(firstProject.conversations)
        setActiveConversationId(firstProject.activeConversationId)
        setHistory(firstProject.conversations.find((item) => item.id === firstProject.activeConversationId)?.history || [])
      }
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => () => { workerRef.current?.terminate() }, [])
  useEffect(() => () => {
    revokeAttachmentPreviews(pendingChatAttachmentsRef.current)
    revokeAttachmentPreviews(conversationAttachmentsRef.current)
  }, [])

  useEffect(() => {
    const container = panelScrollRef.current
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: history.at(-1)?.streaming ? 'auto' : 'smooth' })
  }, [history, busy])

  const snapshotCurrent = (): WorkArea | null => source && activeWorkAreaId ? {
    id: activeWorkAreaId,
    projectId: workAreas.find((area) => area.id === activeWorkAreaId)?.projectId || activeProjectId || legacyProjectId,
    memoryKey: getFileMemoryId(source.file, workAreas.find((area) => area.id === activeWorkAreaId)?.projectId || activeProjectId || legacyProjectId),
    source, pdf, documentText, selectedText, selections,
    conversations: conversations.map((item) => item.id === activeConversationId ? { ...item, history } : item),
    activeConversationId, customPrompt,
    zoom, currentPage, areaSelectionEnabled, scope, note, noteAssets, highlights, annotations,
  } : null

  const loadWorkArea = (area: WorkArea) => {
    setSource(area.source); setPdf(area.pdf); setDocumentText(area.documentText); setSelectedText(area.selectedText)
    setSelections(area.selections); setConversations(area.conversations); setActiveConversationId(area.activeConversationId)
    selectionsRef.current = area.selections
    setHistory(area.conversations.find((item) => item.id === area.activeConversationId)?.history || [])
    setCustomPrompt(area.customPrompt); setZoom(area.zoom)
    setCurrentPage(area.currentPage); setAreaSelectionEnabled(area.areaSelectionEnabled); setScope(area.scope); setError('')
    setNote(area.note || ''); setNoteAssets(area.noteAssets || {}); setHighlights(area.highlights || []); setAnnotations(area.annotations || []); setAnnotationMode(false)
    activeWorkAreaIdRef.current = area.id
    activeConversationIdRef.current = area.activeConversationId
    pendingPageRestoreRef.current = area.currentPage
  }

  const clearReader = () => {
    setSource(null); setPdf(null); setDocumentText(''); setSelectedText(''); setSelections([])
    setActiveWorkAreaId(null); activeWorkAreaIdRef.current = null; setNote(''); setNoteAssets({}); setHighlights([]); setAnnotations([]); setError('')
  }

  const createStudyProject = (requestedName?: string) => {
    const name = (requestedName || `学习项目 ${projects.length + 1}`).trim()
    const conversation: Conversation = { id: makeId(), title: t('untitledConversation'), history: [] }
    const project: StudyProject = { id: makeId(), name: name.slice(0, 80), createdAt: getCurrentTimestamp(), updatedAt: getCurrentTimestamp(), conversations: [conversation], activeConversationId: conversation.id }
    const snapshot = snapshotCurrent()
    if (snapshot) setWorkAreas((items) => items.map((item) => item.id === snapshot.id ? snapshot : item))
    setProjects((items) => [project, ...items])
    clearReader()
    setActiveProjectId(project.id); setConversations(project.conversations); setActiveConversationId(conversation.id); activeConversationIdRef.current = conversation.id; setHistory([])
    return project
  }

  const openProject = (projectId: string) => {
    if (projectId === activeProjectId) return
    const project = projects.find((item) => item.id === projectId)
    if (!project) return
    const snapshot = snapshotCurrent()
    if (snapshot) setWorkAreas((items) => items.map((item) => item.id === snapshot.id ? snapshot : item))
    const target = workAreas.find((area) => area.projectId === projectId)
    if (target) {
      setActiveProjectId(projectId)
      setActiveWorkAreaId(target.id); activeWorkAreaIdRef.current = target.id
      loadWorkArea({ ...target, conversations: project.conversations, activeConversationId: project.activeConversationId })
    } else {
      clearReader()
      setActiveProjectId(projectId); setConversations(project.conversations); setActiveConversationId(project.activeConversationId); activeConversationIdRef.current = project.activeConversationId
      setHistory(project.conversations.find((item) => item.id === project.activeConversationId)?.history || [])
    }
  }

  const renameStudyProject = (projectId: string) => {
    const project = projects.find((item) => item.id === projectId)
    if (!project) return
    setProjectDialog({ mode: 'rename', projectId, value: project.name })
  }

  const ensureProjectVectorStore = async (projectId: string) => {
    const known = vectorStoreIdsRef.current.get(projectId) || projects.find((project) => project.id === projectId)?.vectorStoreId
    if (known) return known
    const inFlight = vectorStoreCreationRef.current.get(projectId)
    if (inFlight) return inFlight
    const promise = (async () => {
      const projectName = projects.find((project) => project.id === projectId)?.name || 'Raid 学习项目'
      const response = await fetch('/api/openai/vector-stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiConfig, name: `Raid · ${projectName}` }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.id) throw new Error(data.error || '无法创建项目文件索引。')
      const vectorStoreId = String(data.id)
      vectorStoreIdsRef.current.set(projectId, vectorStoreId)
      setProjects((items) => items.map((project) => project.id === projectId ? { ...project, vectorStoreId, updatedAt: getCurrentTimestamp() } : project))
      return vectorStoreId
    })()
    vectorStoreCreationRef.current.set(projectId, promise)
    try { return await promise } finally { vectorStoreCreationRef.current.delete(projectId) }
  }

  const updateSourceIndex = (areaId: string, patch: Pick<SourceFile, 'indexStatus'> & Partial<Pick<SourceFile, 'openaiFileId'>>) => {
    setWorkAreas((items) => items.map((area) => area.id === areaId ? { ...area, source: { ...area.source, ...patch } } : area))
    if (activeWorkAreaIdRef.current === areaId) setSource((current) => current ? { ...current, ...patch } : current)
  }

  const indexSourceForResponses = async (area: WorkArea, signal?: AbortSignal) => {
    if (area.source.kind === 'image') return ''
    const vectorStoreId = await ensureProjectVectorStore(area.projectId)
    let indexedFileId = area.source.openaiFileId
    updateSourceIndex(area.id, { indexStatus: 'uploading', ...(area.source.openaiFileId ? { openaiFileId: area.source.openaiFileId } : {}) })
    try {
      if (area.source.openaiFileId) {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const response = await fetch('/api/openai/files/status', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
            body: JSON.stringify({ aiConfig, vectorStoreId, fileId: area.source.openaiFileId }),
          })
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.error || '无法查询文件索引状态。')
          if (data.status === 'completed') {
            updateSourceIndex(area.id, { openaiFileId: area.source.openaiFileId, indexStatus: 'ready' })
            return area.source.openaiFileId
          }
          if (data.status === 'failed') throw new Error(data.error || 'OpenAI 无法解析这份文件。')
          await new Promise((resolve) => window.setTimeout(resolve, 1000))
        }
        throw new Error(`“${area.source.name}”仍在建立全文索引，请稍后重试。`)
      }
      const response = await fetch('/api/openai/files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-raid-api-key': aiConfig.apiKey,
          'x-raid-base-url': aiConfig.baseUrl,
          'x-raid-vector-store-id': vectorStoreId,
          'x-raid-file-name': encodeURIComponent(area.source.file.name),
          'x-raid-file-type': encodeURIComponent(area.source.file.type || 'application/octet-stream'),
        },
        body: area.source.file,
        signal,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.fileId) throw new Error(data.error || `无法识别“${area.source.name}”。`)
      indexedFileId = String(data.fileId)
      const indexStatus = data.status === 'completed' ? 'ready' : 'uploading'
      updateSourceIndex(area.id, { openaiFileId: indexedFileId, indexStatus })
      if (indexStatus !== 'ready') throw new Error(`“${area.source.name}”仍在建立全文索引，请稍后重试。`)
      return indexedFileId
    } catch (reason) {
      updateSourceIndex(area.id, { openaiFileId: indexedFileId, indexStatus: 'error' })
      throw reason
    }
  }

  const removeStudyProject = async (projectId: string) => {
    const project = projects.find((item) => item.id === projectId)
    if (!project) return
    const projectAreas = workAreas.filter((area) => area.projectId === projectId)
    await Promise.all(projectAreas.map((area) => deleteFileMemory(area.memoryKey).catch(() => undefined)))
    await deleteProjectMemory(projectId).catch(() => undefined)
    await deleteProjectConversationAttachments(projectId).catch(() => undefined)
    vectorStoreIdsRef.current.delete(projectId)
    vectorStoreCreationRef.current.delete(projectId)
    projectAreas.forEach((area) => URL.revokeObjectURL(area.source.url))
    const remainingProjects = projects.filter((item) => item.id !== projectId)
    setProjects(remainingProjects); setWorkAreas((items) => items.filter((area) => area.projectId !== projectId))
    if (activeProjectId === projectId) {
      setActiveProjectId(null); clearReader(); setConversations([]); setActiveConversationId(''); activeConversationIdRef.current = ''
      const next = remainingProjects[0]
      if (next) {
        const target = workAreas.find((area) => area.projectId === next.id)
        setActiveProjectId(next.id); setConversations(next.conversations); setActiveConversationId(next.activeConversationId); activeConversationIdRef.current = next.activeConversationId
        setHistory(next.conversations.find((item) => item.id === next.activeConversationId)?.history || [])
        if (target) { setActiveWorkAreaId(target.id); activeWorkAreaIdRef.current = target.id; loadWorkArea({ ...target, conversations: next.conversations, activeConversationId: next.activeConversationId }) }
      }
    }
    setProjectMemories(await listFileMemories())
  }

  const removeSourceFromProject = async (sourceId: string) => {
    const target = workAreas.find((area) => area.id === sourceId)
    if (!target) return
    if (target.source.indexStatus === 'uploading' || Array.from(aiTasks).some((key) => key.startsWith(`${sourceId}:`))) {
      setError('这个文件仍在处理中，请停止或等待处理完成后再删除。')
      return
    }
    forgottenFileKeysRef.current.add(target.memoryKey)
    try {
      await deleteFileMemory(target.memoryKey)
    } catch {
      forgottenFileKeysRef.current.delete(target.memoryKey)
      setError(`无法删除“${target.source.name}”，请稍后重试。`)
      return
    }
    URL.revokeObjectURL(target.source.url)
    const project = projects.find((item) => item.id === target.projectId)
    const shouldResetProjectIndex = Boolean(target.source.openaiFileId || project?.vectorStoreId || vectorStoreIdsRef.current.has(target.projectId))
    const remaining = workAreas.filter((area) => area.id !== sourceId).map((area) => area.projectId === target.projectId && shouldResetProjectIndex
      ? { ...area, source: { ...area.source, openaiFileId: undefined, indexStatus: 'local' as const } }
      : area)
    if (shouldResetProjectIndex) vectorStoreIdsRef.current.delete(target.projectId)
    setWorkAreas(remaining)
    setProjects((items) => items.map((item) => item.id === target.projectId
      ? { ...item, vectorStoreId: shouldResetProjectIndex ? undefined : item.vectorStoreId, updatedAt: getCurrentTimestamp() }
      : item))
    if (target.id === activeWorkAreaId) {
      const previousProjectAreas = workAreas.filter((area) => area.projectId === target.projectId)
      const removedIndex = previousProjectAreas.findIndex((area) => area.id === sourceId)
      const remainingProjectAreas = remaining.filter((area) => area.projectId === target.projectId)
      const next = remainingProjectAreas[Math.min(Math.max(0, removedIndex), Math.max(0, remainingProjectAreas.length - 1))]
      if (next) {
        const sharedConversations = conversations.map((item) => item.id === activeConversationId ? { ...item, history } : item)
        setActiveWorkAreaId(next.id)
        activeWorkAreaIdRef.current = next.id
        loadWorkArea({ ...next, conversations: sharedConversations, activeConversationId })
      } else {
        clearReader()
      }
    } else if (shouldResetProjectIndex && activeProjectId === target.projectId) {
      const current = remaining.find((area) => area.id === activeWorkAreaId)
      if (current) setSource(current.source)
    }
    setProjectMemories(await listFileMemories())
  }

  const submitProjectDialog = () => {
    if (!projectDialog) return
    const value = projectDialog.value.trim()
    if (projectDialog.mode === 'create') {
      if (!value) return
      createStudyProject(value)
    } else if (projectDialog.mode === 'rename' && projectDialog.projectId) {
      if (!value) return
      setProjects((items) => items.map((item) => item.id === projectDialog.projectId ? { ...item, name: value.slice(0, 80), updatedAt: getCurrentTimestamp() } : item))
    } else if (projectDialog.mode === 'delete' && projectDialog.projectId) {
      void removeStudyProject(projectDialog.projectId)
    } else if (projectDialog.mode === 'delete-source' && projectDialog.sourceId) {
      void removeSourceFromProject(projectDialog.sourceId)
    }
    setProjectDialog(null)
  }

  const openFile = async (file: File, requestedProjectId?: string) => {
    if (!isSupportedSource(file)) {
      setError(t('invalidFile'))
      return
    }
    let projectId = requestedProjectId || activeProjectId
    let project = projects.find((item) => item.id === projectId)
    if (!projectId || !project) {
      const created = createStudyProject()
      if (!created) return
      projectId = created.id
      project = created
    }
    const memoryKey = getFileMemoryId(file, projectId)
    const alreadyOpen = workAreas.find((area) => area.memoryKey === memoryKey)
    if (alreadyOpen) {
      openWorkArea(alreadyOpen.id)
      return
    }
    const snapshot = snapshotCurrent()
    const id = makeId()
    let remembered: FileMemoryRecord | undefined
    try { remembered = await getFileMemory(memoryKey) } catch { remembered = undefined }
    forgottenFileKeysRef.current.delete(memoryKey)
    const conversation: Conversation = { id: makeId(), title: t('untitledConversation'), history: [] }
    const restoredConversations = project?.conversations?.length ? project.conversations : snapshot?.projectId === projectId && snapshot.conversations.length ? snapshot.conversations : remembered ? remembered.conversations || [] : [conversation]
    const restoredActiveConversationId = restoredConversations.some((item) => item.id === remembered?.activeConversationId)
      ? remembered!.activeConversationId
      : project?.activeConversationId || (snapshot?.projectId === projectId ? snapshot.activeConversationId : '') || restoredConversations[0]?.id || ''
    const kind = getSourceKind(file)
    let initialDocumentText = remembered?.documentTextVersion === 3 ? remembered.documentText || '' : ''
    if (kind === 'text' && !initialDocumentText) initialDocumentText = `[第 1 页]\n${await file.text()}`
    const next: WorkArea = {
      id, projectId, memoryKey, source: { name: file.name, kind, url: URL.createObjectURL(file), file, openaiFileId: remembered?.openaiFileId, indexStatus: remembered?.indexStatus || 'local' },
      pdf: null, documentText: initialDocumentText, selectedText: '', selections: [], conversations: restoredConversations, activeConversationId: restoredActiveConversationId, customPrompt: '', zoom: remembered?.zoom || 1,
      currentPage: remembered?.currentPage || 1, areaSelectionEnabled: remembered?.areaSelectionEnabled || false, scope: remembered?.scope === 'selection' ? 'general' : remembered?.scope || 'general', note: remembered?.note || '', noteAssets: remembered?.noteAssets || {}, highlights: remembered?.highlights || [], annotations: remembered?.annotations || [],
    }
    setWorkAreas((items) => [...items.map((item) => snapshot && item.id === snapshot.id ? snapshot : item), next])
    setActiveProjectId(projectId)
    setActiveWorkAreaId(id)
    activeWorkAreaIdRef.current = id
    loadWorkArea(next)
    if (aiConfig.provider === 'openai-responses' && next.source.kind !== 'image') {
      void indexSourceForResponses(next).catch((reason) => setError(reason instanceof Error ? reason.message : '原文件索引失败。'))
    }
  }

  const addSourcesToProject = async (projectId: string, files: File[]) => {
    if (projectId !== activeProjectId) openProject(projectId)
    for (const file of files) await openFile(file, projectId)
  }

  const addChatAttachments = (files: File[]) => {
    if (!activeProjectId) {
      setError('请先新建或打开一个项目，再添加对话附件。')
      return
    }
    const nextPending = [...pendingChatAttachmentsRef.current]
    const rejected: string[] = []
    for (const file of files) {
      const kind = getChatAttachmentKind(file)
      if (!kind) { rejected.push(`${file.name}：暂不支持此格式`); continue }
      const combined = [...conversationAttachmentsRef.current, ...nextPending]
      if (combined.length >= maxConversationAttachments) { rejected.push(`每个对话最多 ${maxConversationAttachments} 个附件`); break }
      if (combined.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) continue
      const imageCount = combined.filter((item) => item.kind === 'image').length
      if (kind === 'image' && imageCount >= maxConversationImages) { rejected.push(`每个对话最多 ${maxConversationImages} 张图片`); continue }
      const maximumBytes = kind === 'text' ? 5 * 1024 * 1024 : kind === 'image' ? 12 * 1024 * 1024 : 40 * 1024 * 1024
      if (file.size > maximumBytes) { rejected.push(`${file.name}：文件过大`); continue }
      nextPending.push({ id: makeId(), name: file.name, kind, size: file.size, file, mimeType: file.type || (kind === 'pdf' ? 'application/pdf' : 'text/plain'), lastModified: file.lastModified, createdAt: getCurrentTimestamp(), messageId: '', previewUrl: kind === 'image' ? URL.createObjectURL(file) : '' })
    }
    pendingChatAttachmentsRef.current = nextPending
    setPendingChatAttachments(nextPending)
    setError(rejected.join('；'))
    setPanelLayouts((items) => ({ ...items, chat: { ...items.chat, open: true, z: nextPanelZ(items) } }))
  }

  const removePendingChatAttachment = (id: string) => {
    const target = pendingChatAttachmentsRef.current.find((attachment) => attachment.id === id)
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
    const next = pendingChatAttachmentsRef.current.filter((attachment) => attachment.id !== id)
    pendingChatAttachmentsRef.current = next
    setPendingChatAttachments(next)
  }

  const removeConversationAttachment = (id: string) => {
    const target = conversationAttachmentsRef.current.find((attachment) => attachment.id === id)
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
    const nextAttachments = conversationAttachmentsRef.current.filter((attachment) => attachment.id !== id)
    conversationAttachmentsRef.current = nextAttachments
    setConversationAttachments(nextAttachments)
    const removeSummary = (messages: ChatMessage[]) => messages.map((message) => message.attachments?.some((attachment) => attachment.id === id)
      ? { ...message, attachments: message.attachments.filter((attachment) => attachment.id !== id) }
      : message)
    setHistory((items) => removeSummary(items))
    setConversations((items) => items.map((conversation) => conversation.id === activeConversationId ? { ...conversation, history: removeSummary(conversation.history) } : conversation))
    void deleteConversationAttachment(id).catch(() => undefined)
  }

  const prepareChatAttachment = async (attachment: RuntimeChatAttachment, signal: AbortSignal): Promise<RuntimeChatAttachment> => {
    if (attachment.preparedText !== undefined || attachment.preparedImages) return attachment
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (attachment.kind === 'image') {
      setProgress(`正在读取对话图片：${attachment.name}`)
      return { ...attachment, preparedText: `【本次对话临时图片：${safeSourceLabel(attachment.name)}】`, preparedImages: [await chatImageToDataUrl(attachment.file)] }
    }
    if (attachment.kind === 'text') {
      setProgress(`正在读取对话附件：${attachment.name}`)
      const raw = await attachment.file.text()
      const truncated = raw.length > maxTemporaryAttachmentCharacters
      const text = raw.slice(0, maxTemporaryAttachmentCharacters)
      return { ...attachment, preparedText: `【本次对话临时附件：${safeSourceLabel(attachment.name)}】\n[第 1 页]\n${text}${truncated ? '\n\n（附件内容较长，本次读取已在 160000 字符处截断。）' : ''}`, preparedImages: [] }
    }
    setProgress(`正在读取临时 PDF：${attachment.name}`)
    const url = URL.createObjectURL(attachment.file)
    let attachedPdf: PDFDocumentProxy | null = null
    try {
      attachedPdf = await loadPdf(url)
      const text = await extractPdfText(attachedPdf, (done, total) => setProgress(`正在读取临时 PDF：${attachment.name} · ${done}/${total}`), maxTemporaryAttachmentCharacters, signal)
      const readableCharacters = text.replace(/\[第 \d+ 页\]|\s/g, '').length
      if (readableCharacters >= 80) {
        const truncated = text.length >= maxTemporaryAttachmentCharacters
        return { ...attachment, preparedText: `【本次对话临时附件：${safeSourceLabel(attachment.name)}】\n${text}${truncated ? '\n\n（附件内容较长，本次读取已在 160000 字符处截断。）' : ''}`, preparedImages: [] }
      }
      if (attachedPdf.numPages > maxConversationImages) throw new Error(`“${attachment.name}”是 ${attachedPdf.numPages} 页扫描型 PDF；会员通道无法把它作为单个原文件直接发送。请把需要的页面导出为图片，或将 PDF 添加为项目来源。`)
      const images: string[] = []
      for (let pageNumber = 1; pageNumber <= attachedPdf.numPages; pageNumber += 1) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        setProgress(`正在准备扫描 PDF：${attachment.name} · ${pageNumber}/${attachedPdf.numPages}`)
        const page = await attachedPdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 1.4 })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法创建 PDF 页面图像。')
        await page.render({ canvasContext: context, viewport, canvas }).promise
        images.push(canvas.toDataURL('image/jpeg', .9))
        page.cleanup()
      }
      return { ...attachment, preparedText: `【本次对话临时扫描 PDF：${safeSourceLabel(attachment.name)}】\n以下 ${attachedPdf.numPages} 张图片依次对应第 1 至 ${attachedPdf.numPages} 页。`, preparedImages: images }
    } finally {
      URL.revokeObjectURL(url)
      if (attachedPdf) await attachedPdf.loadingTask.destroy().catch(() => undefined)
    }
  }

  const openWorkArea = (id: string) => {
    if (id === activeWorkAreaId) { pendingPageRestoreRef.current = currentPage; return }
    const snapshot = snapshotCurrent()
    const target = workAreas.find((item) => item.id === id)
    if (!target) return
    const project = projects.find((item) => item.id === target.projectId)
    setWorkAreas((items) => items.map((item) => snapshot && item.id === snapshot.id ? snapshot : item))
    setActiveProjectId(target.projectId)
    setActiveWorkAreaId(id)
    activeWorkAreaIdRef.current = id
    loadWorkArea(project ? { ...target, conversations: project.conversations, activeConversationId: project.activeConversationId } : target)
  }

  const syncCurrentConversation = () => conversations.map((item) => item.id === activeConversationId ? { ...item, history } : item)

  const openConversation = (id: string) => {
    if (id === activeConversationId) return
    const synced = syncCurrentConversation()
    const target = synced.find((item) => item.id === id)
    if (!target) return
    setConversations(synced)
    setActiveConversationId(id)
    activeConversationIdRef.current = id
    setHistory(target.history)
    setError('')
    setPanelLayouts((items) => ({ ...items, chat: { ...items.chat, open: true, z: nextPanelZ(items) } }))
  }

  const createConversation = () => {
    const conversation: Conversation = { id: makeId(), title: t('untitledConversation'), history: [] }
    setConversations([...syncCurrentConversation(), conversation])
    setActiveConversationId(conversation.id)
    activeConversationIdRef.current = conversation.id
    setHistory([])
    setCustomPrompt('')
    setError('')
  }

  const deleteConversation = (id: string) => {
    void deleteConversationAttachments(id).catch(() => undefined)
    let synced = syncCurrentConversation().filter((item) => item.id !== id)
    if (synced.length === 0) synced = [{ id: makeId(), title: t('untitledConversation'), history: [] }]
    if (id !== activeConversationId) { setConversations(synced); return }
    const next = synced.at(-1)!
    setConversations(synced)
    setActiveConversationId(next.id)
    activeConversationIdRef.current = next.id
    setHistory(next.history)
    setError('')
  }

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.note-editor')) return
      const image = Array.from(event.clipboardData?.files || []).find((file) => file.type.startsWith('image/'))
      if (!image) return
      const namedImage = new File([image], `${t('pastedImage')}-${new Date().toLocaleTimeString().replaceAll(':', '-')}.png`, { type: image.type })
      if (target?.closest('.prompt-area')) addChatAttachments([namedImage])
      else void openFile(namedImage)
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  })

  const onPdfReady = useCallback((document: PDFDocumentProxy) => setPdf(document), [])

  useEffect(() => {
    if (source?.kind !== 'pdf' || !pdf || pendingPageRestoreRef.current === null) return
    const pageNumber = pendingPageRestoreRef.current
    const frame = requestAnimationFrame(() => {
      const container = readerScrollRef.current
      const target = container?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`)
      if (!container || !target) return
      const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 20
      container.scrollTo({ top })
      setCurrentPage(pageNumber)
      pendingPageRestoreRef.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [pdf, source?.kind, source?.url])

  const turnPage = (direction: 1 | -1) => {
    if (!pdf) return false
    const nextPage = Math.max(1, Math.min(pdf.numPages, currentPage + direction))
    if (nextPage === currentPage) return false
    const container = readerScrollRef.current
    const target = container?.querySelector<HTMLElement>(`[data-page-number="${nextPage}"]`)
    if (container && target) {
      const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 20
      container.scrollTo({ top, behavior: 'smooth' })
    }
    setCurrentPage(nextPage)
    return true
  }

  const onReaderScroll = () => {
    if (scrollFrameRef.current !== null) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      const container = readerScrollRef.current
      if (!container) return
      const targetY = container.getBoundingClientRect().top + container.clientHeight * 0.38
      let closestPage = currentPage
      let closestDistance = Number.POSITIVE_INFINITY
      container.querySelectorAll<HTMLElement>('[data-page-number]').forEach((page) => {
        const bounds = page.getBoundingClientRect()
        const distance = targetY < bounds.top ? bounds.top - targetY : targetY > bounds.bottom ? targetY - bounds.bottom : 0
        if (distance < closestDistance) {
          closestDistance = distance
          closestPage = Number(page.dataset.pageNumber)
        }
      })
      if (closestPage !== currentPage) setCurrentPage(closestPage)
    })
  }

  const onReaderWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (source?.kind !== 'pdf' || (!event.ctrlKey && !event.metaKey)) return
    event.preventDefault()
    const container = readerScrollRef.current
    const bounds = container?.getBoundingClientRect()
    const previousZoom = zoom
    const nextZoom = Math.max(.25, Math.min(5, previousZoom * Math.exp(-event.deltaY * .0025)))
    if (!container || !bounds || Math.abs(nextZoom - previousZoom) < .001) return
    const anchorX = event.clientX - bounds.left
    const anchorY = event.clientY - bounds.top
    const contentX = container.scrollLeft + anchorX
    const contentY = container.scrollTop + anchorY
    setZoom(nextZoom)
    requestAnimationFrame(() => {
      const ratio = nextZoom / previousZoom
      container.scrollLeft = contentX * ratio - anchorX
      container.scrollTop = contentY * ratio - anchorY
    })
  }

  const getWorker = useCallback(async () => {
    if (!workerPromiseRef.current) {
      workerPromiseRef.current = import('tesseract.js').then(({ createWorker }) => createWorker(['chi_sim', 'eng'], 1, {
        logger: (message) => {
          if (showOcrProgressRef.current && message.status === 'recognizing text') setProgress(`${t('recognizing')} ${Math.round((message.progress || 0) * 100)}%`)
        },
      })).then((worker) => {
        workerRef.current = worker
        return worker
      }).catch((reason) => {
        workerPromiseRef.current = null
        throw reason
      })
    }
    return workerPromiseRef.current
  }, [t])

  const recognize = async (image: string) => {
    showOcrProgressRef.current = true
    setProgress(t('preparingOcr'))
    const worker = await getWorker()
    try {
      const result = await worker.recognize(image)
      return result.data.text.trim()
    } finally {
      showOcrProgressRef.current = false
    }
  }

  const onSelect = async (result: SelectionResult) => {
    const selectionId = makeId()
    const modelCanReadSelectionImage = aiConfig.provider === 'codex' || aiConfig.visionEnabled
    const annotationParts = result.images.map((_, index) => {
      const annotationText = result.annotationTexts?.[index]?.trim() || ''
      return annotationText ? `批注：${annotationText}` : ''
    })
    const annotationText = annotationParts.filter(Boolean).join('\n\n')
    const captured: CapturedSelection = { ...result, id: selectionId, text: annotationText, textParts: annotationParts, loading: !modelCanReadSelectionImage }
    setSelections((items) => { const next = [...items, captured]; selectionsRef.current = next; return next })
    setScope('selection')
    setError('')
    if (modelCanReadSelectionImage) {
      if (annotationText) setSelectedText((previous) => [previous, annotationText].filter(Boolean).join('\n\n'))
      return
    }
    setBusy('ocr')
    try {
      const textParts: string[] = result.images.map(() => '')
      for (let index = 0; index < result.regions.length; index += 1) {
        const selectedRegion = result.regions[index]
        let part = ''
        if (source?.kind === 'pdf' && pdf) {
          setProgress(t('readingPdfText'))
          part = await extractPdfRegionText(pdf, selectedRegion.page, selectedRegion.region)
        }
        if (!part) part = await recognize(result.images[index])
        const annotationText = result.annotationTexts?.[index]?.trim() || ''
        textParts[index] = [part, annotationText && `批注：${annotationText}`].filter(Boolean).join('\n')
      }
      const current = selectionsRef.current.find((item) => item.id === selectionId)
      if (!current) return
      const survivingParts = current.images.map((image) => textParts[result.images.indexOf(image)] || '')
      const text = survivingParts.filter(Boolean).join('\n\n')
      setSelections((items) => { const next = items.map((item) => item.id === selectionId ? { ...item, text, textParts: survivingParts, loading: false } : item); selectionsRef.current = next; return next })
      if (text) setSelectedText((previous) => [previous, text].filter(Boolean).join('\n\n'))
      if (!text) setError(t('noText'))
    } catch (reason) {
      setSelections((items) => { const next = items.map((item) => item.id === selectionId ? { ...item, loading: false } : item); selectionsRef.current = next; return next })
      setError(reason instanceof Error ? `${t('ocrFailed')}: ${reason.message}` : t('ocrFailed'))
    } finally {
      setBusy('')
      setProgress('')
    }
  }

  const removeSelectionImage = (selectionId: string, imageIndex: number) => {
    const target = selectionsRef.current.find((item) => item.id === selectionId)
    if (!target) return
    const removedText = target.textParts[imageIndex] || ''
    const images = target.images.filter((_, index) => index !== imageIndex)
    const regions = target.regions.filter((_, index) => index !== imageIndex)
    const textParts = target.textParts.filter((_, index) => index !== imageIndex)
    const text = textParts.filter(Boolean).join('\n\n')
    const nextSelection = { ...target, image: images[0] || '', images, regions, textParts, text }
    const nextSelections = images.length || text ? selectionsRef.current.map((item) => item.id === selectionId ? nextSelection : item) : selectionsRef.current.filter((item) => item.id !== selectionId)
    selectionsRef.current = nextSelections
    setSelections(nextSelections)
    if (removedText) setSelectedText((previous) => {
      const index = previous.indexOf(removedText)
      if (index < 0) return previous
      return `${previous.slice(0, index)}${previous.slice(index + removedText.length)}`.replace(/\n{3,}/g, '\n\n').trim()
    })
  }

  const buildDocumentContext = async (workspaceId: string, signal?: AbortSignal) => {
    const existingText = documentText
    if (existingText) return existingText
    if (!source) return ''
    const promiseKey = `${workspaceId}:complete-document`
    const inFlight = documentContextPromisesRef.current.get(promiseKey)
    if (inFlight) return waitForAbort(inFlight, signal)
    const report = (message: string) => { if (activeWorkAreaIdRef.current === workspaceId) setProgress(message) }
    const task = (async () => {
      report(source.kind === 'pdf' ? t('readingDocument') : t('readingImage'))
      try {
        let text = ''
        if (source.kind === 'image') {
          text = await recognize(source.url)
        } else if (pdf) {
          text = await extractPdfText(pdf, (done, total) => report(`${t('extracting')} ${done}/${total}`))
          const contentLength = text.replace(/\[第 \d+ 页\]|\s/g, '').length
          if (contentLength < 80) {
            const ocrPages: string[] = []
            const pageNumbers = Array.from({ length: pdf.numPages }, (_, index) => index + 1)
            for (let index = 0; index < pageNumbers.length; index += 1) {
              if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
              const pageNumber = pageNumbers[index]
              report(`${t('scannedOcr')} ${index + 1}/${pageNumbers.length}`)
              const page = await pdf.getPage(pageNumber)
              const viewport = page.getViewport({ scale: 1.25 })
              const canvas = document.createElement('canvas')
              canvas.width = viewport.width
              canvas.height = viewport.height
              const context = canvas.getContext('2d')
              if (!context) continue
              await page.render({ canvasContext: context, viewport, canvas }).promise
              ocrPages.push(`[第 ${pageNumber} 页]\n${await recognize(canvas.toDataURL('image/jpeg', 0.9))}`)
              page.cleanup()
            }
            text = ocrPages.join('\n\n')
          }
        }
        if (activeWorkAreaIdRef.current === workspaceId) setDocumentText(text)
        else setWorkAreas((items) => items.map((item) => item.id === workspaceId ? { ...item, documentText: text } : item))
        return text
      } finally {
        if (activeWorkAreaIdRef.current === workspaceId) setProgress('')
      }
    })()
    documentContextPromisesRef.current.set(promiseKey, task)
    void task.finally(() => documentContextPromisesRef.current.delete(promiseKey)).catch(() => undefined)
    return waitForAbort(task, signal)
  }

  const buildNotebookContext = async (workspaceId: string, areaIds: string[], signal?: AbortSignal) => {
    const selectedAreaIds = new Set(areaIds)
    const activeContext = selectedAreaIds.has(workspaceId) ? await buildDocumentContext(workspaceId, signal) : ''
    const currentSnapshot = snapshotCurrent()
    const areas = workAreas
      .filter((area) => area.projectId === activeProjectId && selectedAreaIds.has(area.id))
      .map((area) => currentSnapshot && area.id === currentSnapshot.id ? { ...currentSnapshot, documentText: activeContext } : area)
    const sections: string[] = []
    for (let index = 0; index < areas.length; index += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const area = areas[index]
      let text = area.documentText
      let loadedPdf = area.pdf
      if (!text && area.source.kind === 'text') text = `[第 1 页]\n${await area.source.file.text()}`
      if (!text && area.source.kind === 'image') {
        setProgress(`正在识别来源 ${index + 1}/${areas.length}：${area.source.name}`)
        text = `[第 1 页]\n${await recognize(area.source.url)}`
      }
      if (!text && area.source.kind === 'pdf') {
        setProgress(`正在索引来源 ${index + 1}/${areas.length}：${area.source.name}`)
        loadedPdf = loadedPdf || await loadPdf(area.source.url)
        text = await extractPdfText(loadedPdf)
        if (text.replace(/\[第 \d+ 页\]|\s/g, '').length < 80) {
          const ocrPages: string[] = []
          for (let pageIndex = 0; pageIndex < loadedPdf.numPages; pageIndex += 1) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
            const pageNumber = pageIndex + 1
            setProgress(`正在逐页识别 ${index + 1}/${areas.length}：${area.source.name} · ${pageNumber}/${loadedPdf.numPages}`)
            const page = await loadedPdf.getPage(pageNumber)
            const viewport = page.getViewport({ scale: 1.25 })
            const canvas = document.createElement('canvas')
            canvas.width = viewport.width
            canvas.height = viewport.height
            const context = canvas.getContext('2d')
            if (!context) continue
            await page.render({ canvasContext: context, viewport, canvas }).promise
            ocrPages.push(`[第 ${pageNumber} 页]\n${await recognize(canvas.toDataURL('image/jpeg', 0.9))}`)
            page.cleanup()
          }
          text = ocrPages.join('\n\n')
        }
      }
      if (text !== area.documentText || loadedPdf !== area.pdf) {
        setWorkAreas((items) => items.map((item) => item.id === area.id ? { ...item, documentText: text, pdf: loadedPdf } : item))
      }
      sections.push(`【来源：${safeSourceLabel(area.source.name)}】\n${text || '（此来源尚未提取出可检索文字。）'}`)
    }
    setProgress('')
    return { text: sections.join('\n\n') }
  }

  const updateConversationRoute = (workspaceId: string, conversationId: string, update: (conversation: Conversation) => Conversation) => {
    if (workspaceId.startsWith('project:')) {
      const projectId = workspaceId.slice('project:'.length)
      setProjects((items) => items.map((project) => project.id === projectId
        ? { ...project, conversations: project.conversations.map((item) => item.id === conversationId ? update(item) : item), updatedAt: getCurrentTimestamp() }
        : project))
      if (activeProjectIdRef.current === projectId) {
        setConversations((items) => items.map((item) => item.id === conversationId ? update(item) : item))
        if (activeConversationIdRef.current === conversationId) setHistory((items) => update({ id: conversationId, title: '', history: items }).history)
      }
      return
    }
    if (activeWorkAreaIdRef.current === workspaceId) {
      setConversations((items) => items.map((item) => item.id === conversationId ? update(item) : item))
      if (activeConversationIdRef.current === conversationId) {
        setHistory((items) => update({ id: conversationId, title: '', history: items }).history)
      }
      return
    }
    setWorkAreas((items) => items.map((area) => area.id === workspaceId
      ? { ...area, conversations: area.conversations.map((item) => item.id === conversationId ? update(item) : item) }
      : area))
  }

  const importSkillFolder = async () => {
    if (!window.readingAssistant) throw new Error(t('desktopImportOnly'))
    const result = await window.readingAssistant.selectSkillFolder()
    if (result.canceled) return false
    const skill = parseSkillImport(result)
    const next = [...skills.filter((item) => item.sourcePath !== skill.sourcePath && item.command !== skill.command), skill].slice(-12)
    localStorage.setItem('reading-assistant-skills', JSON.stringify(next))
    setSkills(next)
    return true
  }

  const removeSkill = (id: string) => {
    setSkills((items) => {
      const next = items.filter((item) => item.id !== id)
      localStorage.setItem('reading-assistant-skills', JSON.stringify(next))
      return next
    })
  }

  const importLanguageFolder = async () => {
    if (!window.readingAssistant) throw new Error(t('desktopImportOnly'))
    const result = await window.readingAssistant.selectLanguageFolder()
    if (result.canceled) return false
    const languagePack = parseLanguageImport(result)
    let imported: LanguagePack[]
    try {
      const saved = JSON.parse(localStorage.getItem('reading-assistant-language-packs') || '[]')
      imported = Array.isArray(saved) ? saved : []
    } catch { imported = [] }
    const next = [...imported.filter((item) => item.code !== languagePack.code), languagePack]
    localStorage.setItem('reading-assistant-language-packs', JSON.stringify(next))
    registerLanguagePack(languagePack)
    localStorage.setItem('reading-assistant-language', languagePack.code)
    onLanguageChange(languagePack.code)
    return true
  }

  const changeLanguage = (language: AppLanguage) => {
    localStorage.setItem('reading-assistant-language', language)
    onLanguageChange(language)
  }

  const changeMemorySettings = (settings: MemorySettings) => setMemorySettings(settings)
  const changeUserMemory = (value: string) => setUserMemory(value.slice(0, 12000))

  const clearSourceCache = async (memoryKey: string) => {
    const target = workAreas.find((area) => area.memoryKey === memoryKey)
    if (target) await removeSourceFromProject(target.id)
    else await deleteFileMemory(memoryKey)
    setProjectMemories(await listFileMemories())
  }

  const learnUserMemory = (userRequest: string, assistantResponse: string) => {
    if (!memorySettingsRef.current.userMemoryEnabled) return
    memoryUpdateQueueRef.current = memoryUpdateQueueRef.current.then(async () => {
      if (!memorySettingsRef.current.userMemoryEnabled) return
      const response = await fetch('/api/ai/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiConfig,
          currentMemory: userMemoryRef.current,
          userRequest,
          assistantResponse,
          responseLanguage: pack.aiLanguage,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!memorySettingsRef.current.userMemoryEnabled || !response.ok || typeof data.memory !== 'string') return
      const nextMemory = data.memory.trim().slice(0, 12000)
      userMemoryRef.current = nextMemory
      setUserMemory(nextMemory)
    }).catch(() => undefined)
  }

  const runAi = async (action: AiAction, instruction = '', requestedScope?: WorkArea['scope']) => {
    setError('')
    const pendingForMessage = pendingChatAttachmentsRef.current
    const existingConversationAttachments = conversationAttachmentsRef.current
    if ((!source || !activeWorkAreaId) && !pendingForMessage.length && !existingConversationAttachments.length) {
      setError('请先添加项目来源，或在输入框中添加本次对话附件。')
      return
    }
    const workspaceId = activeWorkAreaId || (activeProjectId ? `project:${activeProjectId}` : '')
    if (!workspaceId || !activeProjectId) {
      setError('请先新建或打开一个项目。')
      return
    }
    let effectiveInstruction = instruction.trim()
    let requestedSkillId = ''
    if (action === 'custom' && effectiveInstruction.startsWith('/')) {
      const commandMatch = effectiveInstruction.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/)
      const requestedSkill = commandMatch && skills.find((skill) => skill.command.toLocaleLowerCase() === commandMatch[1].toLocaleLowerCase())
      if (!requestedSkill) {
        setError(t('unknownSkill'))
        return
      }
      requestedSkillId = requestedSkill.id
      effectiveInstruction = commandMatch?.[2]?.trim() || (pack.code === 'en-US' ? 'Apply this skill to the current material.' : '请使用此 Skill 处理当前材料。')
    }
    let conversationId = activeConversationId
    let previousHistory = history
    if (!conversationId || !conversations.some((item) => item.id === conversationId)) {
      const conversation: Conversation = { id: makeId(), title: t('untitledConversation'), history: [] }
      conversationId = conversation.id
      previousHistory = []
      setConversations((items) => [...items, conversation])
      setActiveConversationId(conversationId)
      activeConversationIdRef.current = conversationId
      setHistory([])
    }
    const taskKey = `${workspaceId}:${conversationId}`
    if (aiTasks.has(taskKey)) return
    const effectiveScope = requestedScope || scope
    if (effectiveScope === 'selection' && !selectionReady) {
      setError('当前没有可用选区。请先选择内容，或切换到“自由提问”、“对全文”或“全部来源”。')
      return
    }
    const projectAreas = workAreas.filter((area) => area.projectId === activeProjectId)
    const conversationSourceKeys = conversations.find((item) => item.id === conversationId)?.sourceMemoryKeys
    const notebookAreas = conversationSourceKeys
      ? projectAreas.filter((area) => conversationSourceKeys.includes(area.memoryKey))
      : projectAreas
    const targetIsGeneral = effectiveScope === 'general'
    if (effectiveScope === 'notebook' && notebookAreas.length === 0) {
      setError('当前对话没有勾选任何项目来源。请在项目面板中至少勾选一份来源。')
      return
    }
    const targetIsNotebook = effectiveScope === 'notebook' && notebookAreas.length > 0
    const usingNotebookSubset = targetIsNotebook && notebookAreas.length < projectAreas.length
    const targetIsDocument = Boolean(source && (targetIsNotebook || effectiveScope === 'document'))
    const targetIsSelection = effectiveScope === 'selection' && selectionReady
    const currentArea = projectAreas.find((area) => area.id === activeWorkAreaId)
    const selectionImages = targetIsSelection ? selections.flatMap((item) => item.images).slice(0, 4) : []
    const reasoningActive = deepThinking && reasoningAvailable
    const actionLabel = (requestedSkillId ? skills.find((skill) => skill.id === requestedSkillId)?.name : effectiveInstruction) || ({ translate: t('translate'), explain: t('explain'), insight: t('insight'), summarize: t('summarize'), custom: 'AI' }[action])
    const scopeLabel = targetIsGeneral ? t('generalScope') : targetIsNotebook ? (pack.code === 'en-US' ? `${notebookAreas.length} selected sources` : `已选 ${notebookAreas.length} 份来源`) : targetIsDocument ? t('documentScope') : !source && (pendingForMessage.length || existingConversationAttachments.length) ? '对话附件' : t('selectedScope')
    const userLabel = `${scopeLabel} · ${actionLabel}`
    const attachmentLine = pendingForMessage.length ? `附件：${pendingForMessage.map((attachment) => attachment.name).join('、')}` : ''
    const implicitRequest = targetIsNotebook
      ? `${actionLabel}（已选 ${notebookAreas.length}/${projectAreas.length} 份来源）`
      : targetIsDocument
        ? `${actionLabel}（当前来源：${source?.name || '文档'}）`
        : targetIsSelection
          ? `${actionLabel}：${selectedText ? selectedText.slice(0, 1200) : `视觉选区 · ${selections.flatMap((item) => item.images).length} 张图片`}`
          : actionLabel
    // Conversation history must remember what the user asked, not replace it with the
    // document body. Follow-up questions depend on the exact earlier request.
    const targetText = [effectiveInstruction || implicitRequest, attachmentLine].filter(Boolean).join('\n')
    const turnId = makeId()
    const requestAnchorPages = source ? (targetIsGeneral || targetIsNotebook ? [] : targetIsDocument ? [currentPage] : Array.from(new Set(selections.flatMap((item) => item.regions.map((region) => region.page)).concat(currentPage)))) : []
    const contextSnapshot: ChatContextSnapshot = {
      mode: targetIsGeneral ? 'general' : targetIsNotebook ? 'notebook' : targetIsDocument ? 'document' : 'selection',
      sourceNames: targetIsNotebook ? notebookAreas.map((area) => area.source.name) : source && !targetIsGeneral ? [source.name] : [],
      anchorPages: requestAnchorPages,
      attachmentNames: [...existingConversationAttachments, ...pendingForMessage].map((attachment) => attachment.name),
      selectedSourceCount: targetIsNotebook ? notebookAreas.length : undefined,
      totalSourceCount: targetIsNotebook ? projectAreas.length : undefined,
    }
    const userMessage: ChatMessage = { id: makeId(), turnId, status: 'completed', role: 'user', content: targetText, contextSnapshot, label: `${actionLabel} · ${contextSnapshotLabel(contextSnapshot) || userLabel}`, sourcePage: source ? currentPage : undefined, attachments: pendingForMessage.map(({ id, name, kind, size }) => ({ id, name, kind, size })) }
    const sentAttachments = pendingForMessage.map((attachment) => ({ ...attachment, messageId: userMessage.id }))
    const requestAttachments = [...existingConversationAttachments, ...sentAttachments]
    pendingChatAttachmentsRef.current = []
    setPendingChatAttachments([])
    conversationAttachmentsRef.current = requestAttachments
    setConversationAttachments(requestAttachments)
    const requestHistory = [...previousHistory, userMessage]
    setHistory(requestHistory)
    setConversations((items) => items.map((item) => item.id === conversationId ? {
      ...item,
      title: item.history.length ? item.title : actionLabel.slice(0, 32),
      history: requestHistory,
    } : item))
    setAiTasks((items) => new Set(items).add(taskKey))
    const requestController = new AbortController()
    abortControllersRef.current.set(taskKey, requestController)
    setCustomPrompt('')
    let assistantMessageId = ''
    let streamedContent = ''
    let finalContent = ''
    const updateStreamingMessage = (content: string, streaming: boolean, label?: string, status: ChatMessage['status'] = streaming ? 'streaming' : 'completed') => {
      if (deletedTurnIdsRef.current.has(turnId)) return
      if (!assistantMessageId) assistantMessageId = makeId()
      const message: ChatMessage = { id: assistantMessageId, turnId, status, role: 'assistant', content, contextSnapshot, label, streaming }
      updateConversationRoute(workspaceId, conversationId, (conversation) => {
        const exists = conversation.history.some((item) => item.id === assistantMessageId)
        return { ...conversation, history: exists ? conversation.history.map((item) => item.id === assistantMessageId ? message : item) : [...conversation.history, message] }
      })
    }
    try {
      await Promise.all(sentAttachments.map((attachment) => saveConversationAttachment({
        id: attachment.id,
        projectId: activeProjectId,
        conversationId,
        messageId: userMessage.id,
        name: attachment.name,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        size: attachment.size,
        lastModified: attachment.lastModified,
        createdAt: attachment.createdAt,
        fileBlob: attachment.file,
      }))).catch(() => undefined)
      let projectVectorStoreId = ''
      let currentSourceFileId = targetIsGeneral || usingNotebookSubset ? '' : source?.openaiFileId || ''
      let context = ''
      if (aiConfig.provider === 'openai-responses' && source && !targetIsGeneral && !usingNotebookSubset) {
        const indexTargets = (targetIsNotebook ? notebookAreas : currentArea ? [currentArea] : []).filter((area) => area.source.kind !== 'image')
        for (let index = 0; index < indexTargets.length; index += 1) {
          const area = indexTargets[index]
          setProgress(`正在确认原文件索引 ${index + 1}/${indexTargets.length}：${area.source.name}`)
          const fileId = await indexSourceForResponses(area.id === currentArea?.id ? { ...area, source } : area, requestController.signal)
          if (area.id === activeWorkAreaId) currentSourceFileId = fileId
        }
        projectVectorStoreId = vectorStoreIdsRef.current.get(activeProjectId || '') || ''
        context = targetIsNotebook
          ? notebookAreas.map((area) => `【项目来源】${safeSourceLabel(area.source.name)} · ${area.source.kind === 'image' ? '原始图片' : '已上传原文件并建立全文索引'}`).join('\n')
          : `【当前来源】${safeSourceLabel(source.name)} · ${source.kind === 'image' ? '原始图片' : '已上传原文件'}`
        setProgress('')
      } else if (source && activeWorkAreaId) {
        if (targetIsNotebook) context = (await buildNotebookContext(activeWorkAreaId, notebookAreas.map((area) => area.id), requestController.signal)).text
        else if (targetIsDocument) context = await buildDocumentContext(activeWorkAreaId, requestController.signal)
      }
      const notebookImageSources = targetIsNotebook ? notebookAreas.filter((area) => area.source.kind === 'image').slice(0, 4) : []
      const notebookImages = targetIsNotebook
        ? await Promise.all(notebookImageSources.map((area) => fileToDataUrl(area.source.file)))
        : targetIsDocument && source?.kind === 'image' ? [await fileToDataUrl(source.file)] : []
      const preparedAttachments: RuntimeChatAttachment[] = []
      for (const attachment of requestAttachments) preparedAttachments.push(await prepareChatAttachment(attachment, requestController.signal))
      await Promise.all(preparedAttachments.filter((attachment) => attachment.kind !== 'image' && !attachment.preparedImages?.length && attachment.preparedText).map((attachment) => saveConversationAttachment({
        id: attachment.id, projectId: activeProjectId, conversationId, messageId: attachment.messageId, name: attachment.name, kind: attachment.kind,
        mimeType: attachment.mimeType, size: attachment.size, lastModified: attachment.lastModified, createdAt: attachment.createdAt,
        fileBlob: attachment.file, preparedText: attachment.preparedText,
      }))).catch(() => undefined)
      conversationAttachmentsRef.current = preparedAttachments
      setConversationAttachments(preparedAttachments)
      const attachmentImages = preparedAttachments.flatMap((attachment) => attachment.preparedImages || [])
      const attachmentContext = preparedAttachments.map((attachment) => attachment.preparedText || '').filter(Boolean).join('\n\n')
      if (attachmentImages.length + selectionImages.length + notebookImages.length > maxConversationImages) throw new Error(`本次请求共有 ${attachmentImages.length + selectionImages.length + notebookImages.length} 张图片，最多支持 ${maxConversationImages} 张。请删除部分对话图片或选区后再试。`)
      const requestImages = [...attachmentImages, ...selectionImages, ...notebookImages]
      const annotationContext = annotations.filter((annotation): annotation is TextAnnotation => annotation.type === 'text' && Boolean(annotation.text.trim())).map((annotation) => `[第 ${annotation.page} 页批注]\n${annotation.text.trim()}`).join('\n\n')
      const currentSourceExtras = targetIsGeneral || (targetIsNotebook && !notebookAreas.some((area) => area.id === activeWorkAreaId)) ? '' : annotationContext
      const notebookImageMap = notebookImageSources.map((area, index) => `附件图像 ${index + 1} 对应来源：${safeSourceLabel(area.source.name)}`).join('\n')
      const temporaryAttachmentNotice = preparedAttachments.length ? '【附件范围】以下材料仅属于当前对话，不是项目来源；回答时请明确称为“对话附件”。' : ''
      if (requestImages.length && aiConfig.provider === 'openai-compatible' && !aiConfig.visionEnabled) throw new Error('当前兼容模型未启用图片识别。请在 AI 设置中启用视觉模型，或切换到 ChatGPT Plus / Codex。')
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: aiConfig.provider === 'codex' ? 'application/x-ndjson' : 'application/json' },
        signal: requestController.signal,
        body: JSON.stringify({
          action,
          selectedText: targetIsSelection ? selectedText : '',
          documentText: [context, notebookImageMap, targetIsNotebook && source && currentSourceExtras ? `【来源：${safeSourceLabel(source.name)}】\n${currentSourceExtras}` : currentSourceExtras].filter(Boolean).join('\n\n'),
          conversationAttachmentText: [temporaryAttachmentNotice, attachmentContext].filter(Boolean).join('\n\n'),
          conversationAttachmentNames: preparedAttachments.map((attachment) => attachment.name),
          instruction: effectiveInstruction,
          includeContext: !targetIsGeneral,
          contextMode: targetIsGeneral ? 'general' : targetIsNotebook ? 'notebook' : targetIsDocument ? 'document' : 'selection',
          anchorPages: requestAnchorPages,
          history: previousHistory.map(({ role, content, turnId: historyTurnId, status, contextSnapshot: historyContext }) => ({ role, content, turnId: historyTurnId, status, contextSnapshot: historyContext })),
          aiConfig,
          webSearchEnabled: aiConfig.provider !== 'openai-compatible' && aiConfig.webSearchEnabled,
          deepThinking: reasoningActive,
          responseLanguage: pack.aiLanguage,
          userMemory: memorySettings.userMemoryEnabled ? userMemoryRef.current : '',
          selectionHasImages: requestImages.length > 0,
          selectionImages: aiConfig.provider !== 'openai-compatible' || aiConfig.visionEnabled ? requestImages : [],
          projectVectorStoreId,
          currentSourceFileId,
          skills: skills.map(({ id, name, command, description, instructions }) => ({ id, name, command, description, instructions })),
          requestedSkillId,
          stream: aiConfig.provider === 'codex',
        }),
      })
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/x-ndjson') && response.body) {
        if (!response.ok) throw new Error(t('requestFailed'))
        updateStreamingMessage('', true)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let pending = ''
        let completed = false
        const consumeLine = (line: string) => {
          if (!line.trim()) return
          const event = JSON.parse(line) as { type?: string; message?: string; delta?: string; content?: string; error?: string; skillName?: string }
          if (event.type === 'status' && event.message) setProgress(event.message)
          if (event.type === 'delta' && event.delta) {
            streamedContent += event.delta
            updateStreamingMessage(streamedContent, true)
          }
          if (event.type === 'error') throw new Error(event.error || t('requestFailed'))
          if (event.type === 'done') {
            completed = true
            finalContent = event.content || streamedContent
            updateStreamingMessage(finalContent, false, event.skillName ? `${t('skillUsed')} · ${event.skillName}` : undefined)
          }
        }
        while (true) {
          const { done, value } = await reader.read()
          pending += decoder.decode(value || new Uint8Array(), { stream: !done })
          const lines = pending.split('\n')
          pending = lines.pop() || ''
          lines.forEach(consumeLine)
          if (done) break
        }
        if (pending.trim()) consumeLine(pending)
        if (!completed) throw new Error(pack.code === 'en-US' ? 'The response stream ended early.' : '回答流意外中断。')
      } else {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || t('requestFailed'))
        finalContent = data.content
        if (!deletedTurnIdsRef.current.has(turnId)) {
          const assistantMessage: ChatMessage = { id: makeId(), turnId, status: 'completed', role: 'assistant', content: finalContent, contextSnapshot, label: data.skillName ? `${t('skillUsed')} · ${data.skillName}` : undefined }
          updateConversationRoute(workspaceId, conversationId, (conversation) => ({ ...conversation, history: [...conversation.history, assistantMessage] }))
        }
      }
      setProgress('')
      if (!deletedTurnIdsRef.current.has(turnId)) learnUserMemory(effectiveInstruction || actionLabel, finalContent)
    } catch (reason) {
      const message = requestController.signal.aborted ? (pack.code === 'en-US' ? 'Generation stopped.' : '已停止生成。') : reason instanceof Error ? reason.message : t('processFailed')
      const failureStatus: ChatMessage['status'] = requestController.signal.aborted ? 'stopped' : 'error'
      if (deletedTurnIdsRef.current.has(turnId)) {
        // The user deleted this turn while it was generating; do not recreate it with a late response.
      } else if (assistantMessageId) updateStreamingMessage(streamedContent ? `${streamedContent}\n\n> ⚠️ ${message}` : `⚠️ ${message}`, false, undefined, failureStatus)
      else {
        const errorMessage: ChatMessage = { id: makeId(), turnId, status: failureStatus, role: 'assistant', content: `⚠️ ${message}`, contextSnapshot }
        updateConversationRoute(workspaceId, conversationId, (conversation) => ({ ...conversation, history: [...conversation.history, errorMessage] }))
      }
    } finally {
      abortControllersRef.current.delete(taskKey)
      deletedTurnIdsRef.current.delete(turnId)
      setAiTasks((items) => { const next = new Set(items); next.delete(taskKey); return next })
      selectionsRef.current = []; setSelections([]); setSelectedText('')
    }
  }

  const stopAi = () => {
    if (currentAiTaskKey) abortControllersRef.current.get(currentAiTaskKey)?.abort()
  }

  const deleteMessage = (id: string) => {
    const targetIndex = history.findIndex((message) => message.id === id)
    if (targetIndex < 0) return
    const target = history[targetIndex]
    const legacyStart = target.role === 'assistant' && history[targetIndex - 1]?.role === 'user' ? targetIndex - 1 : targetIndex
    const legacyEnd = history[legacyStart]?.role === 'user' && history[legacyStart + 1]?.role === 'assistant' ? legacyStart + 2 : legacyStart + 1
    const removedMessages = target.turnId ? history.filter((message) => message.turnId === target.turnId) : history.slice(legacyStart, legacyEnd)
    if (target.turnId && currentAiBusy && history.at(-1)?.turnId === target.turnId) {
      deletedTurnIdsRef.current.add(target.turnId)
      if (currentAiTaskKey) abortControllersRef.current.get(currentAiTaskKey)?.abort()
    }
    const removedIds = new Set(removedMessages.map((message) => message.id))
    const attachmentIds = removedMessages.flatMap((message) => message.attachments?.map((attachment) => attachment.id) || [])
    if (attachmentIds.length) {
      const removed = conversationAttachmentsRef.current.filter((attachment) => attachmentIds.includes(attachment.id))
      revokeAttachmentPreviews(removed)
      const nextAttachments = conversationAttachmentsRef.current.filter((attachment) => !attachmentIds.includes(attachment.id))
      conversationAttachmentsRef.current = nextAttachments
      setConversationAttachments(nextAttachments)
      attachmentIds.forEach((attachmentId) => { void deleteConversationAttachment(attachmentId).catch(() => undefined) })
    }
    const next = history.filter((message) => !removedIds.has(message.id))
    setHistory(next)
    setConversations((items) => items.map((item) => item.id === activeConversationId ? { ...item, history: next } : item))
  }

  const jumpToPage = (page: number) => {
    const container = readerScrollRef.current
    const target = container?.querySelector<HTMLElement>(`[data-page-number="${page}"]`)
    if (container && target) container.scrollTo({ top: target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 20, behavior: 'smooth' })
    setCurrentPage(page)
  }

  const jumpToSourcePage = (href: string) => {
    const match = href.match(/^source:(.+):(\d+)$/)
    if (!match) return
    const sourceName = decodeURIComponent(match[1])
    const page = Number(match[2])
    const target = workAreas.find((area) => area.projectId === activeProjectId && safeSourceLabel(area.source.name) === sourceName)
    if (!target) return
    if (target.id !== activeWorkAreaId) openWorkArea(target.id)
    pendingPageRestoreRef.current = page
    setCurrentPage(page)
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => jumpToPage(page)))
  }

  const addTextToAi = (text: string) => {
    const selectionId = makeId()
    setSelections((items) => { const next = [...items, { id: selectionId, image: '', images: [], page: currentPage, regions: [], text, textParts: [text], loading: false }]; selectionsRef.current = next; return next })
    setSelectedText((previous) => [previous, text].filter(Boolean).join('\n\n'))
    setScope('selection')
    setPanelLayouts((items) => ({ ...items, chat: { ...items.chat, open: true, z: nextPanelZ(items) } }))
  }

  const translateTextInline = async (text: string, signal: AbortSignal) => {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        action: 'translate',
        selectedText: text,
        documentText: '',
        includeContext: false,
        history: [],
        aiConfig,
        deepThinking: deepThinking && reasoningAvailable,
        responseLanguage: pack.aiLanguage,
      }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || t('translatingFailed'))
    return String(data.content || '')
  }

  const statusText = useMemo(() => {
    if (busy) return progress || t('processing')
    if (selectedText) return t('selectedStatus').replace('{count}', String(selections.length)).replace('{chars}', String(selectedText.length))
    if (hasVisualSelection) return t('visualStatus').replace('{count}', String(selections.length))
    return ''
  }, [busy, progress, selectedText, selections.length, hasVisualSelection, t])

  const updatePanel = (id: PanelId, layout: PanelLayout) => setPanelLayouts((items) => ({ ...items, [id]: layout }))
  const raisePanel = (id: PanelId) => setPanelLayouts((items) => ({ ...items, [id]: { ...items[id], z: nextPanelZ(items) } }))
  const togglePanel = (id: PanelId) => setPanelLayouts((items) => ({ ...items, [id]: { ...items[id], open: !items[id].open, z: nextPanelZ(items) } }))
  const toggleAnnotationMode = () => {
    setAnnotationMode((active) => {
      if (!active) {
        setAreaSelectionEnabled(false)
        window.getSelection()?.removeAllRanges()
      }
      return !active
    })
  }
  const visiblePanelIds = (Object.keys(panelLayouts) as PanelId[]).filter((id) => panelLayouts[id].open && (
    id === 'projects' || ((id === 'chat' || id === 'studio') ? Boolean(activeProjectId) : Boolean(source))
  ))
  const leftPanelIds = visiblePanelIds.filter((id) => panelLayouts[id].dock === 'left')
  const rightPanelIds = visiblePanelIds.filter((id) => panelLayouts[id].dock === 'right')
  const floatingPanelIds = visiblePanelIds.filter((id) => panelLayouts[id].dock === 'float')

  const toggleHighlight = (item: Omit<DocumentHighlight, 'id'>) => setHighlights((items) => {
    const normalizedText = item.text.replace(/\s+/g, ' ').trim()
    let removed = false
    const withoutSelectedRegions = items.flatMap((existing) => {
      if (item.regions?.length && existing.regions?.length) {
        const regions = existing.regions.filter((region) => !item.regions!.some((selected) => highlightRegionOverlap(region, selected)))
        if (regions.length !== existing.regions.length) removed = true
        return regions.length ? [{ ...existing, regions }] : []
      }
      if (existing.page === item.page && existing.text.replace(/\s+/g, ' ').trim() === normalizedText) { removed = true; return [] }
      return [existing]
    })
    if (removed) return withoutSelectedRegions
    return [...items, { ...item, id: makeId() }]
  })

  const activeProjectAreas = workAreas.filter((area) => area.projectId === activeProjectId)
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId)
  const activeConversationSourceKeys = activeConversation?.sourceMemoryKeys
  const selectedProjectAreas = activeConversationSourceKeys
    ? activeProjectAreas.filter((area) => activeConversationSourceKeys.includes(area.memoryKey))
    : activeProjectAreas
  const updateConversationSources = (sourceMemoryKeys?: string[]) => {
    const allSourceKeys = activeProjectAreas.map((area) => area.memoryKey)
    const validKeys = sourceMemoryKeys?.filter((key) => allSourceKeys.includes(key))
    const normalizedKeys = validKeys && validKeys.length < allSourceKeys.length ? validKeys : undefined
    setConversations((items) => items.map((conversation) => conversation.id === activeConversationId
      ? { ...conversation, sourceMemoryKeys: normalizedKeys }
      : conversation))
    setScope('notebook')
    setError('')
  }
  const toggleConversationSource = (sourceId: string, selected: boolean) => {
    const target = activeProjectAreas.find((area) => area.id === sourceId)
    if (!target) return
    const currentKeys = activeConversationSourceKeys || activeProjectAreas.map((area) => area.memoryKey)
    const nextKeys = selected
      ? [...new Set([...currentKeys, target.memoryKey])]
      : currentKeys.filter((key) => key !== target.memoryKey)
    updateConversationSources(nextKeys)
  }
  const contextSourceNames = selectedProjectAreas.map((area) => area.source.name)
  const contextStatus = scope === 'general'
    ? '不使用项目资料'
    : scope === 'selection'
      ? selectionReady ? `选区 · ${selections.length} 组` : '选区 · 尚未选择内容'
      : scope === 'document'
        ? `当前来源 · ${source?.name || '未打开文件'}`
        : `项目来源 · 已选 ${selectedProjectAreas.length}/${activeProjectAreas.length} 份`
  const contextStatusTitle = scope === 'notebook'
    ? contextSourceNames.length ? `本次使用：${contextSourceNames.join('、')}` : '尚未选择项目来源'
    : contextStatus
  const materialActionsUnavailable = scope === 'selection' && !selectionReady
    || scope === 'notebook' && selectedProjectAreas.length === 0
  const projectContent = <ProjectExplorer
    projects={projects.map((project) => ({
      id: project.id,
      name: project.name,
      conversations: (project.id === activeProjectId ? conversations : project.conversations).map(({ id, title }) => ({ id, title })),
      activeConversationId: project.id === activeProjectId ? activeConversationId : project.activeConversationId,
      sources: workAreas.filter((area) => area.projectId === project.id).map((area) => ({
        id: area.id,
        name: area.source.name,
        kind: area.source.kind,
        busy: Array.from(aiTasks).some((key) => key.startsWith(`${area.id}:`)),
        selected: !activeConversationSourceKeys || activeConversationSourceKeys.includes(area.memoryKey),
        indexStatus: area.source.indexStatus,
      })),
    }))}
    activeProjectId={activeProjectId}
    activeSourceId={activeWorkAreaId}
    onCreateProject={() => setProjectDialog({ mode: 'create', value: `学习项目 ${projects.length + 1}` })}
    onOpenProject={openProject}
    onRenameProject={renameStudyProject}
    onDeleteProject={(projectId) => setProjectDialog({ mode: 'delete', projectId, value: projects.find((project) => project.id === projectId)?.name || '' })}
    onOpenSource={openWorkArea}
    onDeleteSource={(sourceId) => { const area = workAreas.find((item) => item.id === sourceId); if (area) setProjectDialog({ mode: 'delete-source', projectId: area.projectId, sourceId, value: area.source.name }) }}
    onToggleSource={toggleConversationSource}
    onSelectAllSources={() => updateConversationSources()}
    onSelectCurrentSource={() => { const current = activeProjectAreas.find((area) => area.id === activeWorkAreaId); if (current) updateConversationSources([current.memoryKey]) }}
    onAddSources={(projectId, files) => { void addSourcesToProject(projectId, files) }}
    onCreateConversation={createConversation}
    onOpenConversation={openConversation}
    onDeleteConversation={deleteConversation}
  />

  const selectionHasImages = selections.some((selection) => selection.images.length > 0)
  const selectionContent = <div className="selection-panel-body single" ref={selectionBodyRef}><section className="selection-content-section">
    <div className="section-label"><span>{t('selectedContent')} · {selections.length}</span>{selections.length > 0 && <button onClick={() => { selectionsRef.current = []; setSelections([]); setSelectedText('') }}><X size={14} /> {t('clear')}</button>}</div>
    {selections.length === 0 ? <div className="selection-empty"><MousePointer2 size={22} /></div> : <div className={`selection-result-split ${selectionHasImages ? 'with-images' : 'text-only'}`} ref={selectionSplitRef} style={selectionHasImages ? { gridTemplateRows: `minmax(72px, ${selectionSplitRatio}fr) 7px minmax(72px, ${1 - selectionSplitRatio}fr)` } : undefined}>{selectionHasImages && <div className="selection-image-pane" ref={selectionImagesRef}><div className="selection-strip">{selections.flatMap((selection) => selection.images.map((image, imageIndex) => <div className="selection-thumb" key={`${selection.id}-${imageIndex}`}><img src={image} alt="选区预览" />{selection.loading && <span><LoaderCircle className="spin" size={10} /></span>}<button className="remove-selection-image" onClick={() => removeSelectionImage(selection.id, imageIndex)}><X size={11} /></button></div>))}</div></div>}{selectionHasImages && <div className="section-resizer" role="separator" aria-label="调整选区图片与识别文字高度" aria-orientation="horizontal" title="拖动调整图片与识别文字高度" onPointerDown={startSelectionSplit} onPointerMove={moveSelectionSplit} onPointerUp={stopSelectionSplit} onPointerCancel={stopSelectionSplit} />}{busy === 'ocr' ? <div className="inline-loading selection-text-pane"><LoaderCircle className="spin" size={16} /> {progress}</div> : <textarea className="selection-text-pane" ref={selectionTextRef} value={selectedText} onChange={(e) => setSelectedText(e.target.value)} />}</div>}
  </section></div>

  const chatContent = <div className="chat-panel-layout">
    <section className="ai-fixed-controls">
      <div className="context-status-bar" title={contextStatusTitle}><strong>{contextStatus}</strong>{conversationAttachments.length + pendingChatAttachments.length > 0 && <span>对话附件 {conversationAttachments.length + pendingChatAttachments.length}</span>}<span>{aiConfig.provider !== 'openai-compatible' && aiConfig.webSearchEnabled ? '联网开启' : '联网关闭'}</span></div>
      <div className="scope-switch" role="group" aria-label="AI 处理范围"><button className={scope === 'general' ? 'active' : ''} onClick={() => setScope('general')} title="不读取选区、当前来源或项目文件；仍会延续对话并使用你主动添加的附件">{t('generalScope')}</button><button className={scope === 'selection' ? 'active' : ''} onClick={() => setScope('selection')}>{t('selectedScope')}{selections.length > 0 && <span>{selections.length}</span>}</button><button className={scope === 'document' ? 'active' : ''} onClick={() => setScope('document')}>当前来源</button><button className={scope === 'notebook' ? 'active' : ''} onClick={() => setScope('notebook')}>项目来源 <span>{selectedProjectAreas.length}/{activeProjectAreas.length}</span></button></div>
      {scope === 'general'
        ? <div className="scope-action-hint">自由提问请直接在下方输入问题；需要翻译、解释、洞察或总结资料时，请切换到选区、当前来源或项目来源。</div>
        : <div className="action-grid"><button disabled={!!busy || currentAiBusy || materialActionsUnavailable} title={materialActionsUnavailable ? '请先选择可用内容' : undefined} onClick={() => runAi('translate')}><Languages /><span>{t('translate')}</span></button><button disabled={!!busy || currentAiBusy || materialActionsUnavailable} title={materialActionsUnavailable ? '请先选择可用内容' : undefined} onClick={() => runAi('explain')}><MessageSquareText /><span>{t('explain')}</span></button><button disabled={!!busy || currentAiBusy || materialActionsUnavailable} title={materialActionsUnavailable ? '请先选择可用内容' : undefined} onClick={() => runAi('insight')}><Lightbulb /><span>{t('insight')}</span></button><button disabled={!!busy || currentAiBusy || materialActionsUnavailable} title={materialActionsUnavailable ? '请先选择可用内容' : undefined} onClick={() => runAi('summarize')}><FileText /><span>{t('summarize')}</span></button></div>}
    </section>
    <div className="panel-scroll" ref={panelScrollRef}><section className="conversation">{history.map((message) => message.role === 'user' ? <div className="user-event" key={message.id}><span>{message.label}</span><small>{message.content.slice(0, 80)}{message.content.length > 80 ? '…' : ''}</small>{Boolean(message.attachments?.length) && <div className="user-event-attachments">{message.attachments!.map((attachment) => <em key={attachment.id}>{attachment.kind === 'image' ? '图片' : attachment.kind === 'pdf' ? 'PDF' : '文件'} · {attachment.name}</em>)}</div>}<button className="delete-message" onClick={() => deleteMessage(message.id)}><X size={12} /></button></div> : <article className={`answer-card ${message.streaming ? 'streaming' : ''}`} key={message.id}><div className="answer-heading"><span><Sparkles size={15} /> {message.label || t('aiAnalysis')}</span><div><button onClick={() => navigator.clipboard.writeText(message.content)} title={t('copy')}><Copy size={14} /></button><button onClick={() => deleteMessage(message.id)}><X size={14} /></button></div></div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} urlTransform={(url) => url.startsWith('page:') || url.startsWith('source:') ? url : defaultUrlTransform(url)} components={{ a: ({ href, children }) => href?.startsWith('page:') ? <button className="citation-page-link" onClick={() => jumpToPage(Number(href.slice(5)))}>{children}</button> : href?.startsWith('source:') ? <button className="citation-page-link source-citation-link" onClick={() => jumpToSourcePage(href)}>{children}</button> : <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{normalizeAssistantMarkdown(message.content)}</ReactMarkdown>{message.streaming && <span className="stream-cursor" aria-label="正在生成" />}</div></article>)}{currentAiBusy && <div className="thinking"><LoaderCircle className="spin" size={18} /><span>{progress || t('thinking')}</span><button onClick={stopAi}><Square size={13} />停止</button></div>}<div ref={resultsEndRef} /></section>{error && <div className="error-banner"><X size={15} /><span>{error}</span></div>}</div>
    <div className="prompt-area"><div className="prompt-height-resizer" onPointerDown={startPromptResize} role="separator" aria-orientation="horizontal" />{((aiConfig.provider === 'codex' && !codexConnected) || (aiConfig.provider !== 'codex' && !aiConfig.apiKey && !configured)) && <button className="config-warning" onClick={openSettings}>{t('notConfigured')}</button>}{skillSuggestions.length > 0 && <div className="skill-command-menu">{skillSuggestions.map((skill) => <button key={skill.id} onClick={() => setCustomPrompt(`/${skill.command} `)}><Puzzle size={14} /><span><strong>/{skill.command}</strong><small>{skill.name}</small></span></button>)}</div>}{conversationAttachments.length > 0 && <div className="conversation-attachment-context"><strong>本对话附件</strong><div>{conversationAttachments.map((attachment) => <span key={attachment.id} title={`${attachment.name} · ${formatFileSize(attachment.size)}`}>{attachment.kind === 'image' && attachment.previewUrl ? <img src={attachment.previewUrl} alt="" /> : <FileText size={12} />}<i>{attachment.name}</i><button type="button" onClick={() => removeConversationAttachment(attachment.id)} title="从本对话移除"><X size={11} /></button></span>)}</div></div>}{pendingChatAttachments.length > 0 && <div className="pending-chat-attachments"><strong>待发送 · 不加入项目</strong><div>{pendingChatAttachments.map((attachment) => <span key={attachment.id} title={`${attachment.name} · ${formatFileSize(attachment.size)}`}>{attachment.kind === 'image' && attachment.previewUrl ? <img src={attachment.previewUrl} alt="" /> : <FileText size={12} />}<i>{attachment.name}</i><button type="button" onClick={() => removePendingChatAttachment(attachment.id)} title="移除附件"><X size={11} /></button></span>)}</div></div>}<div className="prompt-box" style={{ height: promptHeight }}><label className="prompt-attachment-button" title="添加仅当前对话使用的图片或文件"><Paperclip size={16} /><input hidden multiple type="file" accept={chatAttachmentAccept} onChange={(event) => { addChatAttachments(Array.from(event.target.files || [])); event.target.value = '' }} /></label><textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (customPrompt.trim()) runAi('custom', customPrompt.trim()) } }} placeholder={!source && (conversationAttachments.length || pendingChatAttachments.length) ? '针对本对话附件提问…' : scope === 'general' ? t('promptGeneral') : scope === 'notebook' ? '针对全部来源提问；需要最新资料时会联网搜索…' : scope === 'document' ? t('promptDocument') : t('promptSelection')} /><button disabled={!!busy || currentAiBusy || !customPrompt.trim()} onClick={() => runAi('custom', customPrompt.trim())}><Send size={17} /></button></div><small className="prompt-hint"><label className="reasoning-switch"><input type="checkbox" checked={deepThinking && reasoningAvailable} disabled={!reasoningAvailable} onChange={(event) => setDeepThinking(event.target.checked)} /><span className="switch-track"><i /></span><Sparkles size={12} />{t('deepThinking')}</label><span>{aiConfig.provider === 'codex' && aiConfig.webSearchEnabled ? '联网搜索已启用 · ' : ''}附件仅属于当前对话 · {t('sendHint')} · <button onClick={() => setCustomPrompt('/')}>{t('chooseSkillHint')}</button></span></small></div>
  </div>

  const generateStudioOutput = (_title: string, instruction: string) => {
    setScope('notebook')
    setPanelLayouts((items) => ({ ...items, chat: { ...items.chat, open: true, z: nextPanelZ(items) } }))
    void runAi('custom', instruction, 'notebook')
  }
  const panelContent: Record<PanelId, ReactNode> = {
    projects: projectContent,
    selection: selectionContent,
    chat: chatContent,
    studio: <StudioPanel sourceCount={activeProjectAreas.length} busy={currentAiBusy || Boolean(busy)} onGenerate={generateStudioOutput} />,
    notes: source ? <NoteEditor fileName={source.name} value={note} onChange={setNote} assets={noteAssets} onAssetsChange={setNoteAssets} /> : null,
  }
  const panelMeta: Record<PanelId, { title: string; icon: ReactNode; actions?: ReactNode }> = {
    projects: { title: `项目 · ${projects.length}`, icon: <FolderOpen size={15} /> }, selection: { title: t('selection'), icon: <MousePointer2 size={15} /> },
    chat: { title: t('aiAssistant'), icon: <BrainCircuit size={16} />, actions: <button onClick={createConversation} title={t('newConversation')}><Plus size={14} /></button> },
    studio: { title: 'Studio', icon: <Sparkles size={15} /> }, notes: { title: '笔记', icon: <StickyNote size={15} /> },
  }
  const renderPanel = (id: PanelId) => <WorkspacePanel key={id} id={id} title={panelMeta[id].title} icon={panelMeta[id].icon} actions={panelMeta[id].actions} layout={panelLayouts[id]} onChange={(layout) => updatePanel(id, layout)} onFocus={() => raisePanel(id)}>{panelContent[id]}</WorkspacePanel>
  const renderDockPanels = (ids: PanelId[]) => ids.map((id, index) => <Fragment key={id}>{renderPanel(id)}{index < ids.length - 1 && <div className="dock-splitter" onPointerDown={(event) => startDockSplitResize(id, ids[index + 1], event)} />}</Fragment>)

  return (
    <div className="app-shell modern-shell">
      <ActivityBar
        openPanels={{ projects: panelLayouts.projects.open, selection: panelLayouts.selection.open, notes: panelLayouts.notes.open, chat: panelLayouts.chat.open, studio: panelLayouts.studio.open }}
        hasSource={Boolean(source)}
        hasProject={Boolean(activeProjectId)}
        dark={dark}
        annotationActive={annotationMode}
        labels={{ openFile: t('openFile'), selection: t('selection'), conversations: t('conversations'), light: t('light'), dark: t('dark'), settings: t('settings') }}
        onOpenFile={openFile}
        onTogglePanel={togglePanel}
        onToggleAnnotation={toggleAnnotationMode}
        onToggleTheme={() => setDark((value) => !value)}
        onOpenSettings={openSettings}
      />
      <main className="workspace" style={{ '--selection-width': `${leftPanelIds.length ? leftDockWidth : 0}px`, '--ai-width': `${rightPanelIds.length ? rightDockWidth : 0}px` } as CSSProperties}>
        {leftPanelIds.length > 0 && <div className="dock-column dock-column-left">{renderDockPanels(leftPanelIds)}<div className="panel-resizer right" onPointerDown={(event) => startResize('left', leftDockWidth, event)} /></div>}

        <section className="reader-pane">
          {!source ? <div className="empty-reader"><img src="/app-icon.svg" alt="Raid" /><p>添加教材、图片或补充资料，开始一个学习项目</p></div> : <>
            <div className="reader-toolbar">
              <div className="reader-status-group">
                {annotationMode ? <div className="annotation-tools" role="toolbar" aria-label="批注工具">
                  <label className="annotation-color" title="批注颜色"><Palette size={13} /><input type="color" value={annotationColor} onChange={(event) => setAnnotationColor(event.target.value)} /></label>
                  <button className={annotationTool === 'text' ? 'active' : ''} onClick={() => setAnnotationTool('text')} title="文本批注"><Type size={14} /><span>文本</span></button>
                  <button className={annotationTool === 'ink' ? 'active' : ''} onClick={() => setAnnotationTool('ink')} title="墨迹"><PenLine size={14} /><span>墨迹</span></button>
                  <button className={annotationTool === 'eraser' ? 'active' : ''} onClick={() => setAnnotationTool('eraser')} title="擦除整条笔画"><Eraser size={14} /><span>橡皮</span></button>
                </div> : <div className="selection-mode-switch" role="group" aria-label="选择方式">
                  <button className={!areaSelectionEnabled ? 'active' : ''} onClick={() => setAreaSelectionEnabled(false)}><TextCursorInput size={14} /><span>{t('chooseText')}</span></button>
                  <button className={areaSelectionEnabled ? 'active' : ''} onClick={() => setAreaSelectionEnabled(true)}><MousePointer2 size={14} /><span>{t('chooseArea')}</span></button>
                </div>}
                {statusText && <div className="status"><span className={busy ? 'status-dot active' : 'status-dot'} /> {statusText}</div>}
              </div>
              {source.kind === 'pdf' && <div className="page-control">
                <button disabled={currentPage <= 1} onClick={() => turnPage(-1)} title={t('previousPage')}><ChevronLeft size={16} /></button>
                <input aria-label="页码" type="number" min={1} max={pdf?.numPages || 1} value={currentPage} onChange={(e) => jumpToPage(Math.max(1, Math.min(pdf?.numPages || 1, Number(e.target.value))))} /><span>/ {pdf?.numPages || '…'}</span>
                <button disabled={!pdf || currentPage >= pdf.numPages} onClick={() => turnPage(1)} title={t('nextPage')}><ChevronRight size={16} /></button>
              </div>}
              <div className="reader-tools">
                <div className="zoom-control"><button onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))}><Minus size={15} /></button><input aria-label="缩放倍率" type="number" min="25" max="500" value={Math.round(zoom * 100)} onChange={(e) => setZoom(Math.max(.25, Math.min(5, Number(e.target.value) / 100)))} /><span>%</span><button onClick={() => setZoom((z) => Math.min(5, z + 0.1))}><Plus size={15} /></button></div>
              </div>
            </div>
            <div className="reader-scroll" ref={readerScrollRef} onScroll={onReaderScroll} onWheel={onReaderWheel}>{source.kind === 'text'
              ? <article className="text-source-view"><header>{source.name}</header><pre>{documentText.replace(/^\[第 1 页\]\s*/, '')}</pre></article>
              : <DocumentViewer key={source.url} source={source} zoom={zoom} currentPage={currentPage} inverted={dark} areaSelectionEnabled={areaSelectionEnabled} onPdfReady={onPdfReady} onSelect={onSelect} onTextAi={addTextToAi} onTextTranslate={translateTextInline} highlights={highlights} onHighlight={toggleHighlight} annotationMode={annotationMode} annotationTool={annotationTool} annotationColor={annotationColor} annotations={annotations} onAnnotationsChange={setAnnotations} />}</div>
          </>}</section>
        {rightPanelIds.length > 0 && <div className="dock-column dock-column-right"><div className="panel-resizer left" onPointerDown={(event) => startResize('right', rightDockWidth, event)} />{renderDockPanels(rightPanelIds)}</div>}
        {floatingPanelIds.map(renderPanel)}
        </main>
      {settingsOpen && <AiSettingsModal
          value={aiConfig}
          serverConfigured={Boolean(configured)}
          skills={skills}
          language={pack.code}
          languages={getLanguagePacks()}
          memorySettings={memorySettings}
          userMemory={userMemory}
          projects={projects.map((project) => ({ id: project.id, name: project.name, sourceCount: workAreas.filter((area) => area.projectId === project.id).length, conversationCount: project.conversations.length, updatedAt: project.updatedAt }))}
          sourceCaches={projectMemories}
          onClose={() => setSettingsOpen(false)}
          onImportSkill={importSkillFolder}
          onRemoveSkill={removeSkill}
          onImportLanguage={importLanguageFolder}
          onLanguageChange={changeLanguage}
          onMemorySettingsChange={changeMemorySettings}
          onUserMemoryChange={changeUserMemory}
          onDeleteProject={removeStudyProject}
          onDeleteSourceCache={clearSourceCache}
          onSave={(config) => {
            setAiConfig(config)
            if (config.provider === 'codex') fetch('/api/codex/account').then((response) => response.json()).then((data) => setCodexConnected(Boolean(data.account))).catch(() => setCodexConnected(false))
            else setCodexConnected(false)
            if (!(config.provider === 'codex' ? config.codexDeepThinkingEnabled : config.reasoningEnabled)) setDeepThinking(false)
            localStorage.setItem('reading-assistant-ai-config', JSON.stringify(config))
          }}
        />}
      {projectDialog && <div className="project-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setProjectDialog(null)}><section className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title"><header><div><strong id="project-dialog-title">{projectDialog.mode === 'create' ? '新建项目' : projectDialog.mode === 'rename' ? '重命名项目' : projectDialog.mode === 'delete-source' ? '删除文件' : '删除项目'}</strong><small>{projectDialog.mode === 'delete' ? `将删除“${projectDialog.value}”中的全部来源、对话、笔记与批注。` : projectDialog.mode === 'delete-source' ? `只从当前项目删除“${projectDialog.value}”；项目、其他文件和对话会保留。` : '项目之间的来源、对话和笔记彼此独立。'}</small></div><button type="button" onClick={() => setProjectDialog(null)} aria-label="关闭"><X size={16} /></button></header>{(projectDialog.mode === 'create' || projectDialog.mode === 'rename') && <input autoFocus maxLength={80} value={projectDialog.value} onChange={(event) => setProjectDialog({ ...projectDialog, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') submitProjectDialog(); if (event.key === 'Escape') setProjectDialog(null) }} placeholder="输入项目名称" />}<footer><button type="button" className="secondary-button" onClick={() => setProjectDialog(null)}>取消</button><button type="button" className={projectDialog.mode === 'delete' || projectDialog.mode === 'delete-source' ? 'danger-button' : 'save-button'} disabled={(projectDialog.mode === 'create' || projectDialog.mode === 'rename') && !projectDialog.value.trim()} onClick={submitProjectDialog}>{projectDialog.mode === 'delete' || projectDialog.mode === 'delete-source' ? '确认删除' : '确认'}</button></footer></section></div>}
    </div>
  )
}
