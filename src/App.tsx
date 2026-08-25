import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { createWorker } from 'tesseract.js'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import {
  BookOpen, BrainCircuit, ChevronLeft, ChevronRight, Copy, FileText, Languages,
  Lightbulb, LoaderCircle, MessageSquareText, Minus, Moon, PanelRightClose,
  PanelRightOpen, Plus, Puzzle, Send, Settings2, Sparkles, Sun, Upload, MousePointer2, TextCursorInput, X,
} from 'lucide-react'
import DropZone from './components/DropZone'
import DocumentViewer from './components/DocumentViewer'
import AiSettingsModal from './components/AiSettingsModal'
import { extractPdfRegionText, extractPdfText, getSampledPageNumbers } from './lib/pdf'
import type { AiConfig, ChatMessage, ImportedSkill, MemorySettings, SelectionResult, SourceFile } from './types'
import { getLanguagePacks, registerLanguagePack, useI18n, type AppLanguage, type LanguagePack } from './i18n'
import { parseLanguageImport, parseSkillImport } from './lib/imports'
import { clearFileMemories, deleteFileMemory, getFileMemory, getFileMemoryId, listFileMemories, saveFileMemory, type FileMemoryRecord, type FileMemorySummary } from './lib/memory'

type AiAction = 'translate' | 'explain' | 'insight' | 'summarize' | 'custom'
type CapturedSelection = SelectionResult & { id: string; text: string; textParts: string[]; loading: boolean }
type Conversation = { id: string; title: string; history: ChatMessage[] }
type WorkArea = {
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
}
type OcrWorker = Awaited<ReturnType<typeof createWorker>>

const makeId = () => crypto.randomUUID()
const getCurrentTimestamp = () => Date.now()
const normalizeAssistantMarkdown = (content: string) => content
  .replace(/```(?:latex|tex)\s*([\s\S]*?)```/gi, (_match, formula: string) => `\n$$\n${formula.trim()}\n$$\n`)
  .replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) => `\n$$\n${formula.trim()}\n$$\n`)
  .replace(/\\\((.*?)\\\)/g, (_match, formula: string) => `$${formula.trim()}$`)
const defaultAiConfig: AiConfig = {
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

const loadAiConfig = (): AiConfig => {
  try {
    const saved = localStorage.getItem('reading-assistant-ai-config')
    return saved ? { ...defaultAiConfig, ...JSON.parse(saved) } : defaultAiConfig
  } catch {
    return defaultAiConfig
  }
}

const loadDarkTheme = () => localStorage.getItem('reading-assistant-theme') === 'dark'
const defaultMemorySettings: MemorySettings = { fileMemoryEnabled: true, userMemoryEnabled: false }
const loadMemorySettings = (): MemorySettings => {
  try {
    const saved = JSON.parse(localStorage.getItem('reading-assistant-memory-settings') || '{}')
    return { ...defaultMemorySettings, ...saved }
  } catch {
    return defaultMemorySettings
  }
}
const loadUserMemory = () => localStorage.getItem('reading-assistant-user-memory') || ''
const loadSkills = (): ImportedSkill[] => {
  try {
    const value = JSON.parse(localStorage.getItem('reading-assistant-skills') || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export default function App({ onLanguageChange }: { onLanguageChange: (language: AppLanguage) => void }) {
  const { t, pack } = useI18n()
  const [workAreas, setWorkAreas] = useState<WorkArea[]>([])
  const [activeWorkAreaId, setActiveWorkAreaId] = useState<string | null>(null)
  const [homeVisible, setHomeVisible] = useState(true)
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
  const [zoom, setZoom] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [areaSelectionEnabled, setAreaSelectionEnabled] = useState(false)
  const [scope, setScope] = useState<'selection' | 'document'>('selection')
  const [dark, setDark] = useState(loadDarkTheme)
  const [panelOpen, setPanelOpen] = useState(true)
  const [selectionPanelOpen, setSelectionPanelOpen] = useState(true)
  const [selectionPanelWidth, setSelectionPanelWidth] = useState(260)
  const [aiPanelWidth, setAiPanelWidth] = useState(390)
  const [selectionSplit, setSelectionSplit] = useState(0.5)
  const [promptHeight, setPromptHeight] = useState(78)
  const [busy, setBusy] = useState<'ocr' | 'extract' | ''>('')
  const [aiTasks, setAiTasks] = useState<Set<string>>(() => new Set())
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiConfig, setAiConfig] = useState<AiConfig>(loadAiConfig)
  const [skills, setSkills] = useState<ImportedSkill[]>(loadSkills)
  const [memorySettings, setMemorySettings] = useState<MemorySettings>(loadMemorySettings)
  const [userMemory, setUserMemory] = useState(loadUserMemory)
  const [fileMemorySummaries, setFileMemorySummaries] = useState<FileMemorySummary[]>([])
  const [deepThinking, setDeepThinking] = useState(false)
  const hasVisualSelection = aiConfig.visionEnabled && selections.some((item) => item.images.length > 0)
  const selectionReady = Boolean(selectedText || hasVisualSelection)
  const workerRef = useRef<OcrWorker | null>(null)
  const workerPromiseRef = useRef<Promise<OcrWorker> | null>(null)
  const showOcrProgressRef = useRef(false)
  const resultsEndRef = useRef<HTMLDivElement>(null)
  const panelScrollRef = useRef<HTMLDivElement>(null)
  const readerScrollRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const resizeRef = useRef<
    | { kind: 'panel'; panel: 'selection' | 'ai'; startX: number; startWidth: number }
    | { kind: 'selection-split'; startY: number; startRatio: number; containerHeight: number }
    | { kind: 'prompt'; startY: number; startHeight: number }
    | null
  >(null)
  const selectionBodyRef = useRef<HTMLDivElement>(null)
  const activeWorkAreaIdRef = useRef<string | null>(null)
  const activeConversationIdRef = useRef(activeConversationId)
  const selectionsRef = useRef<CapturedSelection[]>([])
  const pendingPageRestoreRef = useRef<number | null>(null)
  const userMemoryRef = useRef(userMemory)
  const memorySettingsRef = useRef(memorySettings)
  const memoryUpdateQueueRef = useRef<Promise<void>>(Promise.resolve())
  const forgottenFileKeysRef = useRef(new Set<string>())
  const currentAiTaskKey = activeWorkAreaId ? `${activeWorkAreaId}:${activeConversationId}` : ''
  const currentAiBusy = aiTasks.has(currentAiTaskKey)
  const slashSkillQuery = customPrompt.match(/^\/([^\s]*)$/)?.[1].toLocaleLowerCase()
  const skillSuggestions = slashSkillQuery === undefined ? [] : skills.filter((skill) => skill.command.toLocaleLowerCase().includes(slashSkillQuery) || skill.name.toLocaleLowerCase().includes(slashSkillQuery)).slice(0, 8)

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const resize = resizeRef.current
      if (!resize) return
      if (resize.kind === 'panel') {
        const delta = event.clientX - resize.startX
        if (resize.panel === 'selection') setSelectionPanelWidth(Math.max(210, Math.min(440, resize.startWidth + delta)))
        if (resize.panel === 'ai') setAiPanelWidth(Math.max(300, Math.min(680, resize.startWidth - delta)))
      }
      if (resize.kind === 'selection-split') {
        const minimum = Math.min(0.42, 96 / resize.containerHeight)
        const ratio = resize.startRatio + (event.clientY - resize.startY) / resize.containerHeight
        setSelectionSplit(Math.max(minimum, Math.min(1 - minimum, ratio)))
      }
      if (resize.kind === 'prompt') {
        const nextHeight = Math.max(54, Math.min(window.innerHeight * 0.45, resize.startHeight - (event.clientY - resize.startY)))
        setPromptHeight(nextHeight)
        window.requestAnimationFrame(() => {
          const container = panelScrollRef.current
          if (container) container.scrollTop = container.scrollHeight
        })
      }
    }
    const stop = () => {
      if (!resizeRef.current) return
      resizeRef.current = null
      document.body.classList.remove('resizing-panels')
      document.body.classList.remove('resizing-vertical')
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

  const startResize = (panel: 'selection' | 'ai', startWidth: number, event: ReactPointerEvent) => {
    event.preventDefault()
    resizeRef.current = { kind: 'panel', panel, startX: event.clientX, startWidth }
    document.body.classList.add('resizing-panels')
  }

  const startSelectionSplitResize = (event: ReactPointerEvent) => {
    const containerHeight = selectionBodyRef.current?.clientHeight || 0
    if (!containerHeight) return
    event.preventDefault()
    resizeRef.current = { kind: 'selection-split', startY: event.clientY, startRatio: selectionSplit, containerHeight }
    document.body.classList.add('resizing-vertical')
    document.body.classList.add('resizing-selection-split')
  }

  const startPromptResize = (event: ReactPointerEvent) => {
    event.preventDefault()
    resizeRef.current = { kind: 'prompt', startY: event.clientY, startHeight: promptHeight }
    document.body.classList.add('resizing-vertical')
    document.body.classList.add('resizing-prompt')
    const container = panelScrollRef.current
    if (container) container.scrollTop = container.scrollHeight
  }

  useEffect(() => { activeWorkAreaIdRef.current = activeWorkAreaId }, [activeWorkAreaId])
  useEffect(() => { activeConversationIdRef.current = activeConversationId }, [activeConversationId])
  useEffect(() => { selectionsRef.current = selections }, [selections])

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

  const refreshFileMemorySummaries = useCallback(async () => {
    try { setFileMemorySummaries(await listFileMemories()) } catch { setFileMemorySummaries([]) }
  }, [])

  const openSettings = () => {
    setSettingsOpen(true)
    void refreshFileMemorySummaries()
  }

  useEffect(() => {
    if (!memorySettings.fileMemoryEnabled || !source) return
    const memoryKey = getFileMemoryId(source.file)
    if (forgottenFileKeysRef.current.has(memoryKey)) return
    const timer = window.setTimeout(() => {
      const syncedConversations = conversations.map((item) => item.id === activeConversationId ? { ...item, history } : item)
      const record: FileMemoryRecord = {
        id: memoryKey,
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
      }
      void saveFileMemory(record).then(refreshFileMemorySummaries).catch(() => undefined)
    }, 700)
    return () => window.clearTimeout(timer)
  }, [memorySettings.fileMemoryEnabled, source, conversations, activeConversationId, history, currentPage, zoom, areaSelectionEnabled, scope, refreshFileMemorySummaries])

  useEffect(() => {
    if (!memorySettings.fileMemoryEnabled) return
    const inactiveAreas = workAreas.filter((area) => area.id !== activeWorkAreaId && !forgottenFileKeysRef.current.has(area.memoryKey))
    if (!inactiveAreas.length) return
    const timer = window.setTimeout(() => {
      inactiveAreas.forEach((area) => {
        const record: FileMemoryRecord = {
          id: area.memoryKey,
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
        }
        void saveFileMemory(record).catch(() => undefined)
      })
    }, 700)
    return () => window.clearTimeout(timer)
  }, [memorySettings.fileMemoryEnabled, workAreas, activeWorkAreaId])

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((data) => setConfigured(data.configured)).catch(() => setConfigured(false))
  }, [])

  useEffect(() => () => { workerRef.current?.terminate() }, [])

  useEffect(() => {
    const container = panelScrollRef.current
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }, [history, busy])

  const snapshotCurrent = (): WorkArea | null => source && activeWorkAreaId ? {
    id: activeWorkAreaId, memoryKey: getFileMemoryId(source.file), source, pdf, documentText, selectedText, selections,
    conversations: conversations.map((item) => item.id === activeConversationId ? { ...item, history } : item),
    activeConversationId, customPrompt,
    zoom, currentPage, areaSelectionEnabled, scope,
  } : null

  const loadWorkArea = (area: WorkArea) => {
    setSource(area.source); setPdf(area.pdf); setDocumentText(area.documentText); setSelectedText(area.selectedText)
    setSelections(area.selections); setConversations(area.conversations); setActiveConversationId(area.activeConversationId)
    selectionsRef.current = area.selections
    setHistory(area.conversations.find((item) => item.id === area.activeConversationId)?.history || [])
    setCustomPrompt(area.customPrompt); setZoom(area.zoom)
    setCurrentPage(area.currentPage); setAreaSelectionEnabled(area.areaSelectionEnabled); setScope(area.scope); setError('')
    activeWorkAreaIdRef.current = area.id
    activeConversationIdRef.current = area.activeConversationId
    pendingPageRestoreRef.current = area.currentPage
  }

  const saveCurrent = () => {
    const snapshot = snapshotCurrent()
    if (snapshot) setWorkAreas((items) => items.map((item) => item.id === snapshot.id ? snapshot : item))
  }

  const openFile = async (file: File) => {
    if (!(file.type === 'application/pdf' || file.type.startsWith('image/'))) {
      setError(t('invalidFile'))
      return
    }
    const memoryKey = getFileMemoryId(file)
    const alreadyOpen = workAreas.find((area) => area.memoryKey === memoryKey)
    if (alreadyOpen) {
      openWorkArea(alreadyOpen.id)
      return
    }
    const snapshot = snapshotCurrent()
    const id = makeId()
    let remembered: FileMemoryRecord | undefined
    if (memorySettings.fileMemoryEnabled) {
      try { remembered = await getFileMemory(memoryKey) } catch { remembered = undefined }
    }
    forgottenFileKeysRef.current.delete(memoryKey)
    const conversation: Conversation = { id: makeId(), title: t('untitledConversation'), history: [] }
    const restoredConversations = remembered?.conversations?.length ? remembered.conversations : [conversation]
    const restoredActiveConversationId = restoredConversations.some((item) => item.id === remembered?.activeConversationId)
      ? remembered!.activeConversationId
      : restoredConversations[0].id
    const next: WorkArea = {
      id, memoryKey, source: { name: file.name, kind: file.type === 'application/pdf' ? 'pdf' : 'image', url: URL.createObjectURL(file), file },
      pdf: null, documentText: '', selectedText: '', selections: [], conversations: restoredConversations, activeConversationId: restoredActiveConversationId, customPrompt: '', zoom: remembered?.zoom || 1,
      currentPage: remembered?.currentPage || 1, areaSelectionEnabled: remembered?.areaSelectionEnabled || false, scope: remembered?.scope || 'selection',
    }
    setWorkAreas((items) => [...items.map((item) => snapshot && item.id === snapshot.id ? snapshot : item), next])
    setActiveWorkAreaId(id)
    activeWorkAreaIdRef.current = id
    setHomeVisible(false)
    loadWorkArea(next)
  }

  const openWorkArea = (id: string) => {
    if (id === activeWorkAreaId) { pendingPageRestoreRef.current = currentPage; setHomeVisible(false); return }
    const snapshot = snapshotCurrent()
    const target = workAreas.find((item) => item.id === id)
    if (!target) return
    setWorkAreas((items) => items.map((item) => snapshot && item.id === snapshot.id ? snapshot : item))
    setActiveWorkAreaId(id)
    activeWorkAreaIdRef.current = id
    setHomeVisible(false)
    loadWorkArea(target)
  }

  const showHome = () => { saveCurrent(); setHomeVisible(true) }

  const closeWorkArea = (event: ReactMouseEvent, id: string) => {
    event.stopPropagation()
    const target = id === activeWorkAreaId ? snapshotCurrent() : workAreas.find((item) => item.id === id)
    if (target && memorySettings.fileMemoryEnabled && !forgottenFileKeysRef.current.has(target.memoryKey)) {
      const record: FileMemoryRecord = {
        id: target.memoryKey,
        fileName: target.source.file.name,
        fileSize: target.source.file.size,
        fileType: target.source.file.type,
        lastModified: target.source.file.lastModified,
        updatedAt: getCurrentTimestamp(),
        conversations: target.conversations,
        activeConversationId: target.activeConversationId,
        currentPage: target.currentPage,
        zoom: target.zoom,
        areaSelectionEnabled: target.areaSelectionEnabled,
        scope: target.scope,
      }
      void saveFileMemory(record).catch(() => undefined)
    }
    if (target) URL.revokeObjectURL(target.source.url)
    const remaining = workAreas.filter((item) => item.id !== id)
    setWorkAreas(remaining)
    if (id !== activeWorkAreaId) return
    const next = remaining.at(-1)
    if (next) { setActiveWorkAreaId(next.id); loadWorkArea(next); setHomeVisible(homeVisible) }
    else { setActiveWorkAreaId(null); activeWorkAreaIdRef.current = null; setSource(null); setHomeVisible(true) }
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

  const deleteConversation = (event: ReactMouseEvent, id: string) => {
    event.stopPropagation()
    const synced = syncCurrentConversation().filter((item) => item.id !== id)
    if (id !== activeConversationId) { setConversations(synced); return }
    const next = synced.at(-1) || { id: makeId(), title: t('untitledConversation'), history: [] }
    const nextItems = synced.length ? synced : [next]
    setConversations(nextItems)
    setActiveConversationId(next.id)
    activeConversationIdRef.current = next.id
    setHistory(next.history)
    setError('')
  }

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const image = Array.from(event.clipboardData?.files || []).find((file) => file.type.startsWith('image/'))
      if (image) openFile(new File([image], `${t('pastedImage')}-${new Date().toLocaleTimeString().replaceAll(':', '-')}.png`, { type: image.type }))
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  })

  const onPdfReady = useCallback((document: PDFDocumentProxy) => setPdf(document), [])

  useEffect(() => {
    if (homeVisible || source?.kind !== 'pdf' || !pdf || pendingPageRestoreRef.current === null) return
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
  }, [homeVisible, pdf, source?.kind, source?.url])

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

  const getWorker = useCallback(async () => {
    if (!workerPromiseRef.current) {
      workerPromiseRef.current = createWorker(['chi_sim', 'eng'], 1, {
        logger: (message) => {
          if (showOcrProgressRef.current && message.status === 'recognizing text') setProgress(`${t('recognizing')} ${Math.round((message.progress || 0) * 100)}%`)
        },
      }).then((worker) => {
        workerRef.current = worker
        return worker
      }).catch((reason) => {
        workerPromiseRef.current = null
        throw reason
      })
    }
    return workerPromiseRef.current
  }, [t])

  useEffect(() => {
    if (!source) return
    const timer = setTimeout(() => { void getWorker().catch(() => undefined) }, 500)
    return () => clearTimeout(timer)
  }, [source, getWorker])

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
    const captured: CapturedSelection = { ...result, id: selectionId, text: '', textParts: result.images.map(() => ''), loading: true }
    setSelections((items) => { const next = [...items, captured]; selectionsRef.current = next; return next })
    setScope('selection')
    setBusy('ocr')
    setError('')
    try {
      const textParts: string[] = result.images.map(() => '')
      for (let index = 0; index < result.regions.length; index += 1) {
        const selectedRegion = result.regions[index]
        let part = ''
        if (source?.kind === 'pdf' && pdf) {
          setProgress(t('readingPdfText'))
          part = await extractPdfRegionText(pdf, selectedRegion.page, selectedRegion.region)
        }
        if (!part && !aiConfig.visionEnabled) part = await recognize(result.images[index])
        textParts[index] = part
      }
      const current = selectionsRef.current.find((item) => item.id === selectionId)
      if (!current) return
      const survivingParts = current.images.map((image) => textParts[result.images.indexOf(image)] || '')
      const text = survivingParts.filter(Boolean).join('\n\n')
      setSelections((items) => { const next = items.map((item) => item.id === selectionId ? { ...item, text, textParts: survivingParts, loading: false } : item); selectionsRef.current = next; return next })
      if (text) setSelectedText((previous) => [previous, text].filter(Boolean).join('\n\n'))
      if (!text && !aiConfig.visionEnabled) setError(t('noText'))
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

  const buildDocumentContext = async (workspaceId: string) => {
    if (documentText) return documentText
    if (!source) return ''
    const report = (message: string) => { if (activeWorkAreaIdRef.current === workspaceId) setProgress(message) }
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
          const pageNumbers = getSampledPageNumbers(pdf.numPages, 24)
          for (let index = 0; index < pageNumbers.length; index += 1) {
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
  }

  const updateConversationRoute = (workspaceId: string, conversationId: string, update: (conversation: Conversation) => Conversation) => {
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

  const forgetFileMemory = async (id: string) => {
    forgottenFileKeysRef.current.add(id)
    await deleteFileMemory(id)
    await refreshFileMemorySummaries()
  }

  const forgetAllFileMemories = async () => {
    workAreas.forEach((area) => forgottenFileKeysRef.current.add(area.memoryKey))
    await clearFileMemories()
    await refreshFileMemorySummaries()
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

  const runAi = async (action: AiAction, instruction = '') => {
    setError('')
    if (!source || !activeWorkAreaId) return
    if (scope === 'selection' && !selectionReady) {
      setError(t('selectFirst'))
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
    const workspaceId = activeWorkAreaId
    const conversationId = activeConversationId
    const taskKey = `${workspaceId}:${conversationId}`
    if (aiTasks.has(taskKey)) return
    const targetIsDocument = scope === 'document'
    const selectionImages = targetIsDocument ? [] : selections.flatMap((item) => item.images).slice(0, 4)
    const reasoningActive = deepThinking && aiConfig.reasoningEnabled
    if (reasoningActive && selectionImages.length > 0) {
      setError(t('reasoningImageUnsupported'))
      return
    }
    const actionLabel = (requestedSkillId ? skills.find((skill) => skill.id === requestedSkillId)?.name : effectiveInstruction) || ({ translate: t('translate'), explain: t('explain'), insight: t('insight'), summarize: t('summarize'), custom: 'AI' }[action])
    const userLabel = `${targetIsDocument ? t('documentScope') : t('selectedScope')} · ${actionLabel}`
    const targetText = targetIsDocument ? (documentText || source.name) : (selectedText || `视觉选区 · ${selections.flatMap((item) => item.images).length} 张图片`)
    const userMessage: ChatMessage = { id: makeId(), role: 'user', content: targetText, label: userLabel }
    const previousHistory = history
    const requestHistory = [...history, userMessage]
    setHistory(requestHistory)
    setConversations((items) => items.map((item) => item.id === conversationId ? {
      ...item,
      title: item.history.length ? item.title : actionLabel.slice(0, 32),
      history: requestHistory,
    } : item))
    setAiTasks((items) => new Set(items).add(taskKey))
    setCustomPrompt('')
    try {
      const context = await buildDocumentContext(workspaceId)
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          selectedText: targetIsDocument ? '' : selectedText,
          documentText: context,
          instruction: effectiveInstruction,
          includeContext: true,
          history: previousHistory.map(({ role, content }) => ({ role, content })),
          aiConfig,
          deepThinking: reasoningActive,
          responseLanguage: pack.aiLanguage,
          userMemory: memorySettings.userMemoryEnabled ? userMemoryRef.current : '',
          selectionHasImages: selectionImages.length > 0,
          selectionImages: aiConfig.visionEnabled ? selectionImages : [],
          skills: skills.map(({ id, name, command, description, instructions }) => ({ id, name, command, description, instructions })),
          requestedSkillId,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || t('requestFailed'))
      const assistantMessage: ChatMessage = { id: makeId(), role: 'assistant', content: data.content, label: data.skillName ? `${t('skillUsed')} · ${data.skillName}` : undefined }
      updateConversationRoute(workspaceId, conversationId, (conversation) => ({ ...conversation, history: [...conversation.history, assistantMessage] }))
      learnUserMemory(effectiveInstruction || actionLabel, data.content)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : t('processFailed')
      const errorMessage: ChatMessage = { id: makeId(), role: 'assistant', content: `⚠️ ${message}` }
      updateConversationRoute(workspaceId, conversationId, (conversation) => ({ ...conversation, history: [...conversation.history, errorMessage] }))
    } finally {
      setAiTasks((items) => { const next = new Set(items); next.delete(taskKey); return next })
    }
  }

  const addTextToAi = (text: string) => {
    const selectionId = makeId()
    setSelections((items) => { const next = [...items, { id: selectionId, image: '', images: [], page: currentPage, regions: [], text, textParts: [text], loading: false }]; selectionsRef.current = next; return next })
    setSelectedText((previous) => [previous, text].filter(Boolean).join('\n\n'))
    setScope('selection')
    setPanelOpen(true)
  }

  const translateTextInline = async (text: string) => {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'translate',
        selectedText: text,
        documentText: '',
        includeContext: false,
        history: [],
        aiConfig,
        deepThinking: deepThinking && aiConfig.reasoningEnabled,
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={showHome} title={t('home')}><div className="brand-mark"><BookOpen size={21} /></div><span>Reading Assistant</span></button>
        <div className="workspace-tabs">{workAreas.map((area) => <button key={area.id} className={!homeVisible && activeWorkAreaId === area.id ? 'active' : ''} onClick={() => openWorkArea(area.id)} title={area.source.name}>{Array.from(aiTasks).some((key) => key.startsWith(`${area.id}:`)) ? <LoaderCircle className="spin" size={13} /> : <FileText size={13} />}<span>{area.source.name}</span><i onClick={(event) => closeWorkArea(event, area.id)} title={t('closeTab')}><X size={12} /></i></button>)}</div>
        <div className="top-actions">
          <label className="compact-upload" title={t('openFile')}><Upload size={17} /><input hidden type="file" accept="application/pdf,image/*" onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])} /></label>
          <button className="icon-button" onClick={() => setDark((value) => !value)} title={dark ? t('light') : t('dark')}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          {source && <button className="icon-button mobile-panel-toggle" onClick={() => setPanelOpen((value) => !value)}>{panelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button>}
          <button className="icon-button" onClick={openSettings} title={t('settings')}><Settings2 size={18} /></button>
        </div>
      </header>

      {homeVisible || !source ? (
        <main className="welcome">
          <div className="welcome-copy"><h1>{t('appName')}</h1></div>
          <DropZone onFile={openFile} />
          <div className="welcome-credit"><span>Created by xyLee</span><a href="https://github.com/lxymol/Reading-Assistant" target="_blank" rel="noreferrer">GitHub · Reading-Assistant</a></div>
        </main>
      ) : (
        <main className="workspace" style={{
          '--selection-width': `${selectionPanelOpen ? selectionPanelWidth : 28}px`,
          '--ai-width': `${panelOpen ? aiPanelWidth : 28}px`,
        } as CSSProperties}>
          <aside className={`selection-panel ${selectionPanelOpen ? 'open' : 'collapsed'}`}>
            {selectionPanelOpen ? <>
              <div className="side-panel-header"><span><MousePointer2 size={15} />{t('selection')}</span><button onClick={() => setSelectionPanelOpen(false)}><ChevronLeft size={16} /></button></div>
              <div className="selection-panel-body" ref={selectionBodyRef} style={{ gridTemplateRows: `${selectionSplit}fr 7px ${1 - selectionSplit}fr` }}>
                <section className="selection-content-section">
                  <div className="section-label"><span>{t('selectedContent')} · {selections.length}</span>{selections.length > 0 && <button onClick={() => { selectionsRef.current = []; setSelections([]); setSelectedText('') }}><X size={14} /> {t('clear')}</button>}</div>
                  {selections.length === 0 ? <div className="selection-empty"><MousePointer2 size={22} /><p>{t('selectionEmpty')}</p></div> : <>
                    {selections.some((selection) => selection.images.length > 0) && <div className="selection-strip">{selections.flatMap((selection) => selection.images.map((image, imageIndex) => <div className="selection-thumb" key={`${selection.id}-${imageIndex}`}>
                      <img src={image} alt="选区预览" />
                      {selection.loading && <span><LoaderCircle className="spin" size={10} /></span>}
                      <button className="remove-selection-image" onClick={() => removeSelectionImage(selection.id, imageIndex)} title={t('deleteSelection')}><X size={11} /></button>
                    </div>))}</div>}
                    {busy === 'ocr' ? <div className="inline-loading"><LoaderCircle className="spin" size={16} /> {progress}</div> : <textarea value={selectedText} onChange={(e) => setSelectedText(e.target.value)} placeholder={hasVisualSelection ? t('visualPlaceholder') : t('textPlaceholder')} />}
                  </>}
                </section>
                <div className="section-resizer" onPointerDown={startSelectionSplitResize} role="separator" aria-orientation="horizontal" aria-label="调整选区与对话区域高度" />
                <section className="conversation-sidebar">
                  <div className="section-label"><span>{t('conversations')}</span></div>
                  <div className="conversation-list">{conversations.map((conversation) => {
                    const taskRunning = Boolean(activeWorkAreaId && aiTasks.has(`${activeWorkAreaId}:${conversation.id}`))
                    return <button key={conversation.id} className={conversation.id === activeConversationId ? 'active' : ''} onClick={() => openConversation(conversation.id)}>
                      {taskRunning ? <LoaderCircle className="spin" size={13} /> : <MessageSquareText size={13} />}
                      <span>{conversation.title}</span>
                      <i className={taskRunning ? 'disabled' : ''} onClick={(event) => { if (!taskRunning) deleteConversation(event, conversation.id) }} title={t('deleteConversation')}><X size={12} /></i>
                    </button>
                  })}</div>
                </section>
              </div>
              <div className="panel-resizer right" onPointerDown={(event) => startResize('selection', selectionPanelWidth, event)} />
            </> : <button className="collapsed-panel-button left" onClick={() => setSelectionPanelOpen(true)} title="展开选区"><ChevronRight size={17} /></button>}
          </aside>

          <section className="reader-pane">
            <div className="reader-toolbar">
              <div className="reader-status-group">
                {statusText && <div className="status"><span className={busy ? 'status-dot active' : 'status-dot'} /> {statusText}</div>}
              </div>
              {source.kind === 'pdf' && <div className="page-control">
                <button disabled={currentPage <= 1} onClick={() => turnPage(-1)} title={t('previousPage')}><ChevronLeft size={16} /></button>
                <span><strong>{currentPage}</strong> / {pdf?.numPages || '…'}</span>
                <button disabled={!pdf || currentPage >= pdf.numPages} onClick={() => turnPage(1)} title={t('nextPage')}><ChevronRight size={16} /></button>
              </div>}
              <div className="reader-tools">
                <div className="selection-mode-switch" role="group" aria-label="选择方式">
                  <button className={!areaSelectionEnabled ? 'active' : ''} onClick={() => setAreaSelectionEnabled(false)}><TextCursorInput size={14} /><span>{t('chooseText')}</span></button>
                  <button className={areaSelectionEnabled ? 'active' : ''} onClick={() => setAreaSelectionEnabled(true)}><MousePointer2 size={14} /><span>{t('chooseArea')}</span></button>
                </div>
                <div className="zoom-control"><button onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}><Minus size={15} /></button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((z) => Math.min(3, z + 0.1))}><Plus size={15} /></button></div>
              </div>
            </div>
            <div className="reader-scroll" ref={readerScrollRef} onScroll={onReaderScroll}><DocumentViewer key={source.url} source={source} zoom={zoom} currentPage={currentPage} inverted={dark} areaSelectionEnabled={areaSelectionEnabled} onPdfReady={onPdfReady} onSelect={onSelect} onTextAi={addTextToAi} onTextTranslate={translateTextInline} /></div>
          </section>

          <aside className={`ai-panel ${panelOpen ? 'open' : 'collapsed'}`}>
            {panelOpen ? <>
              <div className="panel-resizer left" onPointerDown={(event) => startResize('ai', aiPanelWidth, event)} />
              <div className="panel-header"><div className="assistant-title"><h2><BrainCircuit size={17} /> {t('aiAssistant')}</h2><button className={`reasoning-toggle ${deepThinking && aiConfig.reasoningEnabled ? 'active' : ''}`} disabled={!aiConfig.reasoningEnabled} onClick={() => setDeepThinking((value) => !value)} title={aiConfig.reasoningEnabled ? t('deepThinking') : t('configureDeepThinking')}><Sparkles size={12} />{t('deepThinking')}</button></div><div className="panel-header-actions"><button className="new-conversation-button" onClick={createConversation}><Plus size={14} />{t('newConversation')}</button><button className="panel-collapse-button" onClick={() => setPanelOpen(false)}><ChevronRight size={17} /></button></div></div>
              <section className="ai-fixed-controls">
                <div className="scope-switch" role="group" aria-label="AI 处理范围">
                  <button className={scope === 'selection' ? 'active' : ''} onClick={() => setScope('selection')} disabled={!selections.length}>{t('selectedScope')}{selections.length > 0 && <span>{selections.length}</span>}</button>
                  <button className={scope === 'document' ? 'active' : ''} onClick={() => setScope('document')}>{t('documentScope')}</button>
                </div>
                <div className="action-grid">
                  <button disabled={!!busy || currentAiBusy || (scope === 'selection' && !selectionReady)} onClick={() => runAi('translate')}><Languages /><span>{t('translate')}</span></button>
                  <button disabled={!!busy || currentAiBusy || (scope === 'selection' && !selectionReady)} onClick={() => runAi('explain')}><MessageSquareText /><span>{t('explain')}</span></button>
                  <button disabled={!!busy || currentAiBusy || (scope === 'selection' && !selectionReady)} onClick={() => runAi('insight')}><Lightbulb /><span>{t('insight')}</span></button>
                  <button disabled={!!busy || currentAiBusy || (scope === 'selection' && !selectionReady)} onClick={() => runAi('summarize')}><FileText /><span>{t('summarize')}</span></button>
                </div>
              </section>
              <div className="panel-scroll" ref={panelScrollRef}>
              {history.length > 0 && <div className="section-label result-label">{t('analysisHistory')}</div>}
              <section className="conversation">
                {history.map((message) => message.role === 'user' ? (
                  <div className="user-event" key={message.id}><span>{message.label}</span><small>{message.content.slice(0, 80)}{message.content.length > 80 ? '…' : ''}</small></div>
                ) : (
                  <article className="answer-card" key={message.id}>
                    <div className="answer-heading"><span><Sparkles size={15} /> {message.label || t('aiAnalysis')}</span><button onClick={() => navigator.clipboard.writeText(message.content)} title={t('copy')}><Copy size={14} /></button></div>
                    <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{normalizeAssistantMarkdown(message.content)}</ReactMarkdown></div>
                  </article>
                ))}
                {currentAiBusy && <div className="thinking"><LoaderCircle className="spin" size={18} /><span>{t('thinking')}</span></div>}
                <div ref={resultsEndRef} />
              </section>
              {error && <div className="error-banner"><X size={15} /><span>{error}</span></div>}
              </div>
              <div className="prompt-area">
                <div className="prompt-height-resizer" onPointerDown={startPromptResize} role="separator" aria-orientation="horizontal" aria-label="调整输入框高度" />
                {!aiConfig.apiKey && !configured && <button className="config-warning" onClick={openSettings}>{t('notConfigured')}</button>}
                {skillSuggestions.length > 0 && <div className="skill-command-menu">{skillSuggestions.map((skill) => <button key={skill.id} onClick={() => setCustomPrompt(`/${skill.command} `)}><Puzzle size={14} /><span><strong>/{skill.command}</strong><small>{skill.name}</small></span></button>)}</div>}
                <div className="prompt-box" style={{ height: promptHeight }}><textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (customPrompt.trim()) runAi('custom', customPrompt.trim()) } }} placeholder={scope === 'document' ? t('promptDocument') : t('promptSelection')} /><button disabled={!!busy || currentAiBusy || !customPrompt.trim() || (scope === 'selection' && !selectionReady)} onClick={() => runAi('custom', customPrompt.trim())}><Send size={17} /></button></div>
                <small className="prompt-hint">{t('sendHint')} · <button onClick={() => setCustomPrompt('/')}>{t('chooseSkillHint')}</button></small>
              </div>
            </> : <button className="collapsed-panel-button right" onClick={() => setPanelOpen(true)} title="展开 AI 助手"><ChevronLeft size={17} /></button>}
          </aside>
        </main>
      )}
      {settingsOpen && <AiSettingsModal
          value={aiConfig}
          serverConfigured={Boolean(configured)}
          skills={skills}
          language={pack.code}
          languages={getLanguagePacks()}
          memorySettings={memorySettings}
          userMemory={userMemory}
          fileMemories={fileMemorySummaries}
          onClose={() => setSettingsOpen(false)}
          onImportSkill={importSkillFolder}
          onRemoveSkill={removeSkill}
          onImportLanguage={importLanguageFolder}
          onLanguageChange={changeLanguage}
          onMemorySettingsChange={changeMemorySettings}
          onUserMemoryChange={changeUserMemory}
          onDeleteFileMemory={forgetFileMemory}
          onDeleteAllFileMemories={forgetAllFileMemories}
          onSave={(config) => {
            setAiConfig(config)
            if (!config.reasoningEnabled) setDeepThinking(false)
            localStorage.setItem('reading-assistant-ai-config', JSON.stringify(config))
          }}
        />}
    </div>
  )
}
