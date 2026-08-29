import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Worker as OcrWorker } from 'tesseract.js'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import {
  BrainCircuit, ChevronLeft, ChevronRight, Copy, FileText, Languages, FolderOpen,
  Lightbulb, LoaderCircle, MessageSquareText, Minus,
  Plus, Puzzle, Send, Sparkles, MousePointer2, TextCursorInput, X, StickyNote, Square,
} from 'lucide-react'
import ActivityBar from './components/ActivityBar'
import DocumentViewer from './components/DocumentViewer'
import AiSettingsModal from './components/AiSettingsModal'
import NoteEditor from './components/NoteEditor'
import ProjectExplorer from './components/ProjectExplorer'
import WorkspacePanel from './components/WorkspacePanel'
import { extractPdfRegionText, extractPdfText } from './lib/pdf'
import type { AiAction, AiConfig, CapturedSelection, ChatMessage, Conversation, DocumentHighlight, ImportedSkill, MemorySettings, PanelId, PanelLayout, SelectionResult, SourceFile, WorkArea } from './types'
import { getLanguagePacks, registerLanguagePack, useI18n, type AppLanguage, type LanguagePack } from './i18n'
import { parseLanguageImport, parseSkillImport } from './lib/imports'
import { deleteFileMemory, getFileMemory, getFileMemoryId, listFileMemories, listFileMemoryRecords, saveFileMemory, type FileMemoryRecord, type FileMemorySummary } from './lib/memory'
import { loadAiConfig, loadDarkTheme, loadMemorySettings, loadPanelLayouts, loadSkills, loadUserMemory } from './lib/preferences'


const makeId = () => crypto.randomUUID()
const getCurrentTimestamp = () => Date.now()
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
  .replace(/\[\[SOURCE:(\d+)\|[\s\S]*?\]\]/g, (_match, page: string) => `[第 ${page} 页](page:${page})`)
  .replace(/\[\[PAGE:(\d+)\]\]/g, (_match, page: string) => `[第 ${page} 页](page:${page})`)

type HighlightRegion = NonNullable<DocumentHighlight['regions']>[number]
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

export default function App({ onLanguageChange }: { onLanguageChange: (language: AppLanguage) => void }) {
  const { t, pack } = useI18n()
  const [workAreas, setWorkAreas] = useState<WorkArea[]>([])
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
  const [zoom, setZoom] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [areaSelectionEnabled, setAreaSelectionEnabled] = useState(false)
  const [scope, setScope] = useState<'selection' | 'document'>('selection')
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectMemories, setProjectMemories] = useState<FileMemorySummary[]>([])
  const [aiConfig, setAiConfig] = useState<AiConfig>(loadAiConfig)
  const [skills, setSkills] = useState<ImportedSkill[]>(loadSkills)
  const [memorySettings, setMemorySettings] = useState<MemorySettings>(loadMemorySettings)
  const [userMemory, setUserMemory] = useState(loadUserMemory)
  const [deepThinking, setDeepThinking] = useState(false)
  const [note, setNote] = useState('')
  const [noteAssets, setNoteAssets] = useState<Record<string, string>>({})
  const [highlights, setHighlights] = useState<DocumentHighlight[]>([])
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set())
  const [panelLayouts, setPanelLayouts] = useState(() => normalizePanelZ(loadPanelLayouts()))
  const abortControllersRef = useRef(new Map<string, AbortController>())
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
  useEffect(() => { activeConversationIdRef.current = activeConversationId }, [activeConversationId])
  useEffect(() => { selectionsRef.current = selections }, [selections])

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
    const memoryKey = getFileMemoryId(source.file)
    if (forgottenFileKeysRef.current.has(memoryKey)) return
    const timer = window.setTimeout(() => {
      if (forgottenFileKeysRef.current.has(memoryKey)) return
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
        fileBlob: source.file,
        documentText,
        documentTextVersion: 2,
        note,
        noteAssets,
        highlights,
      }
      void saveFileMemory(record).catch(() => undefined)
    }, 700)
    return () => window.clearTimeout(timer)
  }, [source, conversations, activeConversationId, history, currentPage, zoom, areaSelectionEnabled, scope, documentText, note, noteAssets, highlights])

  useEffect(() => {
    const inactiveAreas = workAreas.filter((area) => area.id !== activeWorkAreaId && !forgottenFileKeysRef.current.has(area.memoryKey))
    if (!inactiveAreas.length) return
    const timer = window.setTimeout(() => {
      inactiveAreas.forEach((area) => {
        if (forgottenFileKeysRef.current.has(area.memoryKey)) return
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
          fileBlob: area.source.file,
          documentText: area.documentText,
          documentTextVersion: 2,
          note: area.note,
          noteAssets: area.noteAssets,
          highlights: area.highlights,
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
    let active = true
    void listFileMemoryRecords().then((records) => {
      if (!active) return
      const restored = records.filter((record) => record.fileBlob).map((record): WorkArea => {
        const file = new File([record.fileBlob!], record.fileName, { type: record.fileType, lastModified: record.lastModified })
        const savedConversations = record.conversations || []
        const savedActiveConversationId = savedConversations.some((item) => item.id === record.activeConversationId) ? record.activeConversationId : savedConversations[0]?.id || ''
        return { id: makeId(), memoryKey: record.id, source: { name: file.name, kind: file.type === 'application/pdf' ? 'pdf' : 'image', url: URL.createObjectURL(file), file }, pdf: null, documentText: record.documentTextVersion === 2 ? record.documentText || '' : '', selectedText: '', selections: [], conversations: savedConversations, activeConversationId: savedActiveConversationId, customPrompt: '', zoom: record.zoom || 1, currentPage: record.currentPage || 1, areaSelectionEnabled: record.areaSelectionEnabled || false, scope: record.scope || 'selection', note: record.note || '', noteAssets: record.noteAssets || {}, highlights: record.highlights || [] }
      })
      setWorkAreas(restored)
    }).catch(() => undefined)
    return () => { active = false }
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
    zoom, currentPage, areaSelectionEnabled, scope, note, noteAssets, highlights,
  } : null

  const loadWorkArea = (area: WorkArea) => {
    setSource(area.source); setPdf(area.pdf); setDocumentText(area.documentText); setSelectedText(area.selectedText)
    setSelections(area.selections); setConversations(area.conversations); setActiveConversationId(area.activeConversationId)
    selectionsRef.current = area.selections
    setHistory(area.conversations.find((item) => item.id === area.activeConversationId)?.history || [])
    setCustomPrompt(area.customPrompt); setZoom(area.zoom)
    setCurrentPage(area.currentPage); setAreaSelectionEnabled(area.areaSelectionEnabled); setScope(area.scope); setError('')
    setNote(area.note || ''); setNoteAssets(area.noteAssets || {}); setHighlights(area.highlights || [])
    activeWorkAreaIdRef.current = area.id
    activeConversationIdRef.current = area.activeConversationId
    pendingPageRestoreRef.current = area.currentPage
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
    try { remembered = await getFileMemory(memoryKey) } catch { remembered = undefined }
    forgottenFileKeysRef.current.delete(memoryKey)
    const conversation: Conversation = { id: makeId(), title: t('untitledConversation'), history: [] }
    const restoredConversations = remembered ? remembered.conversations || [] : [conversation]
    const restoredActiveConversationId = restoredConversations.some((item) => item.id === remembered?.activeConversationId)
      ? remembered!.activeConversationId
      : restoredConversations[0]?.id || ''
    const next: WorkArea = {
      id, memoryKey, source: { name: file.name, kind: file.type === 'application/pdf' ? 'pdf' : 'image', url: URL.createObjectURL(file), file },
      pdf: null, documentText: remembered?.documentTextVersion === 2 ? remembered.documentText || '' : '', selectedText: '', selections: [], conversations: restoredConversations, activeConversationId: restoredActiveConversationId, customPrompt: '', zoom: remembered?.zoom || 1,
      currentPage: remembered?.currentPage || 1, areaSelectionEnabled: remembered?.areaSelectionEnabled || false, scope: remembered?.scope || 'selection', note: remembered?.note || '', noteAssets: remembered?.noteAssets || {}, highlights: remembered?.highlights || [],
    }
    setWorkAreas((items) => [...items.map((item) => snapshot && item.id === snapshot.id ? snapshot : item), next])
    setActiveWorkAreaId(id)
    activeWorkAreaIdRef.current = id
    loadWorkArea(next)
  }

  const openWorkArea = (id: string) => {
    if (id === activeWorkAreaId) { pendingPageRestoreRef.current = currentPage; return }
    const snapshot = snapshotCurrent()
    const target = workAreas.find((item) => item.id === id)
    if (!target) return
    setWorkAreas((items) => items.map((item) => snapshot && item.id === snapshot.id ? snapshot : item))
    setActiveWorkAreaId(id)
    activeWorkAreaIdRef.current = id
    loadWorkArea(target)
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

  const createConversationForArea = (areaId: string) => {
    setCollapsedProjectIds((items) => { const next = new Set(items); next.delete(areaId); return next })
    if (areaId === activeWorkAreaId) createConversation()
    else {
      const target = workAreas.find((item) => item.id === areaId)
      if (!target) return
      const snapshot = snapshotCurrent()
      const conversation: Conversation = { id: makeId(), title: t('untitledConversation'), history: [] }
      const next = { ...target, conversations: [...target.conversations, conversation], activeConversationId: conversation.id }
      setWorkAreas((items) => items.map((item) => snapshot && item.id === snapshot.id ? snapshot : item).map((item) => item.id === areaId ? next : item))
      setActiveWorkAreaId(areaId); activeWorkAreaIdRef.current = areaId; loadWorkArea(next)
    }
    setPanelLayouts((items) => ({ ...items, chat: { ...items.chat, open: true, z: nextPanelZ(items) } }))
  }

  const deleteConversation = (id: string) => {
    const synced = syncCurrentConversation().filter((item) => item.id !== id)
    if (id !== activeConversationId) { setConversations(synced); return }
    const next = synced.at(-1)
    setConversations(synced)
    setActiveConversationId(next?.id || '')
    activeConversationIdRef.current = next?.id || ''
    setHistory(next?.history || [])
    setError('')
  }

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest('.note-editor')) return
      const image = Array.from(event.clipboardData?.files || []).find((file) => file.type.startsWith('image/'))
      if (image) openFile(new File([image], `${t('pastedImage')}-${new Date().toLocaleTimeString().replaceAll(':', '-')}.png`, { type: image.type }))
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
          const pageNumbers = Array.from({ length: pdf.numPages }, (_, index) => index + 1)
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

  useEffect(() => {
    if (!source || documentText || (source.kind === 'pdf' && !pdf)) return
    const timer = window.setTimeout(() => { if (activeWorkAreaId) void buildDocumentContext(activeWorkAreaId).catch(() => undefined) }, 250)
    return () => window.clearTimeout(timer)
    // Indexing intentionally starts once per opened source as soon as its renderer is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.url, pdf])

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

  const deleteProject = async (memoryKey: string) => {
    forgottenFileKeysRef.current.add(memoryKey)
    await deleteFileMemory(memoryKey)
    const target = workAreas.find((area) => area.memoryKey === memoryKey)
    if (target) URL.revokeObjectURL(target.source.url)
    const remaining = workAreas.filter((area) => area.memoryKey !== memoryKey)
    setWorkAreas(remaining)
    if (target?.id === activeWorkAreaId) {
      const next = remaining.at(-1)
      if (next) { setActiveWorkAreaId(next.id); loadWorkArea(next) }
      else { setActiveWorkAreaId(null); activeWorkAreaIdRef.current = null; setSource(null) }
    }
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

  const runAi = async (action: AiAction, instruction = '') => {
    setError('')
    if (!source || !activeWorkAreaId) return
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
    const targetIsDocument = scope === 'document' || !selectionReady
    const selectionImages = targetIsDocument ? [] : selections.flatMap((item) => item.images).slice(0, 4)
    const reasoningActive = deepThinking && aiConfig.reasoningEnabled
    const actionLabel = (requestedSkillId ? skills.find((skill) => skill.id === requestedSkillId)?.name : effectiveInstruction) || ({ translate: t('translate'), explain: t('explain'), insight: t('insight'), summarize: t('summarize'), custom: 'AI' }[action])
    const userLabel = `${targetIsDocument ? t('documentScope') : t('selectedScope')} · ${actionLabel}`
    const targetText = targetIsDocument ? (documentText || source.name) : (selectedText || `视觉选区 · ${selections.flatMap((item) => item.images).length} 张图片`)
    const userMessage: ChatMessage = { id: makeId(), role: 'user', content: targetText, label: userLabel, sourcePage: currentPage }
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
    try {
      const context = await buildDocumentContext(workspaceId)
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: requestController.signal,
        body: JSON.stringify({
          action,
          selectedText: targetIsDocument ? '' : selectedText,
          documentText: context,
          instruction: effectiveInstruction,
          includeContext: true,
          contextMode: targetIsDocument ? 'document' : 'selection',
          anchorPages: targetIsDocument ? [] : Array.from(new Set(selections.flatMap((item) => item.regions.map((region) => region.page)).concat(currentPage))),
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
      const message = requestController.signal.aborted ? (pack.code === 'en-US' ? 'Generation stopped.' : '已停止生成。') : reason instanceof Error ? reason.message : t('processFailed')
      const errorMessage: ChatMessage = { id: makeId(), role: 'assistant', content: `⚠️ ${message}` }
      updateConversationRoute(workspaceId, conversationId, (conversation) => ({ ...conversation, history: [...conversation.history, errorMessage] }))
    } finally {
      abortControllersRef.current.delete(taskKey)
      setAiTasks((items) => { const next = new Set(items); next.delete(taskKey); return next })
      selectionsRef.current = []; setSelections([]); setSelectedText('')
    }
  }

  const stopAi = () => {
    if (currentAiTaskKey) abortControllersRef.current.get(currentAiTaskKey)?.abort()
  }

  const deleteMessage = (id: string) => {
    const next = history.filter((message) => message.id !== id)
    setHistory(next)
    setConversations((items) => items.map((item) => item.id === activeConversationId ? { ...item, history: next } : item))
  }

  const jumpToPage = (page: number) => {
    const container = readerScrollRef.current
    const target = container?.querySelector<HTMLElement>(`[data-page-number="${page}"]`)
    if (container && target) container.scrollTo({ top: target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 20, behavior: 'smooth' })
    setCurrentPage(page)
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

  const updatePanel = (id: PanelId, layout: PanelLayout) => setPanelLayouts((items) => ({ ...items, [id]: layout }))
  const raisePanel = (id: PanelId) => setPanelLayouts((items) => ({ ...items, [id]: { ...items[id], z: nextPanelZ(items) } }))
  const togglePanel = (id: PanelId) => setPanelLayouts((items) => ({ ...items, [id]: { ...items[id], open: !items[id].open, z: nextPanelZ(items) } }))
  const visiblePanelIds = (Object.keys(panelLayouts) as PanelId[]).filter((id) => panelLayouts[id].open && (id === 'projects' || Boolean(source)))
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

  const openProjectNotes = (areaId: string) => {
    openWorkArea(areaId)
    setPanelLayouts((items) => ({ ...items, notes: { ...items.notes, open: true, z: nextPanelZ(items) } }))
  }
  const toggleProjectConversations = (areaId: string) => {
    if (areaId !== activeWorkAreaId) openWorkArea(areaId)
    setCollapsedProjectIds((items) => {
      const next = new Set(items)
      if (areaId === activeWorkAreaId && !next.has(areaId)) next.add(areaId)
      else next.delete(areaId)
      return next
    })
  }
  const openProjectConversation = (conversationId: string) => {
    openConversation(conversationId)
    setPanelLayouts((items) => ({ ...items, chat: { ...items.chat, open: true, z: nextPanelZ(items) } }))
  }
  const projectContent = <ProjectExplorer
    projects={workAreas.map((area) => ({ id: area.id, name: area.source.name, busy: Array.from(aiTasks).some((key) => key.startsWith(`${area.id}:`)) }))}
    activeProjectId={activeWorkAreaId}
    activeConversationId={activeConversationId}
    conversations={conversations}
    collapsedProjectIds={collapsedProjectIds}
    onOpenProject={openWorkArea}
    onCreateConversation={createConversationForArea}
    onOpenNotes={openProjectNotes}
    onToggleProject={toggleProjectConversations}
    onOpenConversation={openProjectConversation}
    onDeleteConversation={deleteConversation}
  />

  const selectionHasImages = selections.some((selection) => selection.images.length > 0)
  const selectionContent = <div className="selection-panel-body single" ref={selectionBodyRef}><section className="selection-content-section">
    <div className="section-label"><span>{t('selectedContent')} · {selections.length}</span>{selections.length > 0 && <button onClick={() => { selectionsRef.current = []; setSelections([]); setSelectedText('') }}><X size={14} /> {t('clear')}</button>}</div>
    {selections.length === 0 ? <div className="selection-empty"><MousePointer2 size={22} /></div> : <div className={`selection-result-split ${selectionHasImages ? 'with-images' : 'text-only'}`} ref={selectionSplitRef} style={selectionHasImages ? { gridTemplateRows: `minmax(72px, ${selectionSplitRatio}fr) 7px minmax(72px, ${1 - selectionSplitRatio}fr)` } : undefined}>{selectionHasImages && <div className="selection-image-pane" ref={selectionImagesRef}><div className="selection-strip">{selections.flatMap((selection) => selection.images.map((image, imageIndex) => <div className="selection-thumb" key={`${selection.id}-${imageIndex}`}><img src={image} alt="选区预览" />{selection.loading && <span><LoaderCircle className="spin" size={10} /></span>}<button className="remove-selection-image" onClick={() => removeSelectionImage(selection.id, imageIndex)}><X size={11} /></button></div>))}</div></div>}{selectionHasImages && <div className="section-resizer" role="separator" aria-label="调整选区图片与识别文字高度" aria-orientation="horizontal" title="拖动调整图片与识别文字高度" onPointerDown={startSelectionSplit} onPointerMove={moveSelectionSplit} onPointerUp={stopSelectionSplit} onPointerCancel={stopSelectionSplit} />}{busy === 'ocr' ? <div className="inline-loading selection-text-pane"><LoaderCircle className="spin" size={16} /> {progress}</div> : <textarea className="selection-text-pane" ref={selectionTextRef} value={selectedText} onChange={(e) => setSelectedText(e.target.value)} />}</div>}
  </section></div>

  const chatContent = <div className="chat-panel-layout">
    <section className="ai-fixed-controls">
      <div className="scope-switch" role="group" aria-label="AI 处理范围"><button className={scope === 'selection' ? 'active' : ''} onClick={() => setScope('selection')}>{t('selectedScope')}{selections.length > 0 && <span>{selections.length}</span>}</button><button className={scope === 'document' ? 'active' : ''} onClick={() => setScope('document')}>{t('documentScope')}</button></div>
      <div className="action-grid"><button disabled={!!busy || currentAiBusy} onClick={() => runAi('translate')}><Languages /><span>{t('translate')}</span></button><button disabled={!!busy || currentAiBusy} onClick={() => runAi('explain')}><MessageSquareText /><span>{t('explain')}</span></button><button disabled={!!busy || currentAiBusy} onClick={() => runAi('insight')}><Lightbulb /><span>{t('insight')}</span></button><button disabled={!!busy || currentAiBusy} onClick={() => runAi('summarize')}><FileText /><span>{t('summarize')}</span></button></div>
    </section>
    <div className="panel-scroll" ref={panelScrollRef}><section className="conversation">{history.map((message) => message.role === 'user' ? <div className="user-event" key={message.id}><span>{message.label}</span><small>{message.content.slice(0, 80)}{message.content.length > 80 ? '…' : ''}</small><button className="delete-message" onClick={() => deleteMessage(message.id)}><X size={12} /></button></div> : <article className="answer-card" key={message.id}><div className="answer-heading"><span><Sparkles size={15} /> {message.label || t('aiAnalysis')}</span><div><button onClick={() => navigator.clipboard.writeText(message.content)} title={t('copy')}><Copy size={14} /></button><button onClick={() => deleteMessage(message.id)}><X size={14} /></button></div></div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} urlTransform={(url) => url.startsWith('page:') ? url : defaultUrlTransform(url)} components={{ a: ({ href, children }) => href?.startsWith('page:') ? <button className="citation-page-link" onClick={() => jumpToPage(Number(href.slice(5)))}>{children}</button> : <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{normalizeAssistantMarkdown(message.content)}</ReactMarkdown></div></article>)}{currentAiBusy && <div className="thinking"><LoaderCircle className="spin" size={18} /><span>{t('thinking')}</span><button onClick={stopAi}><Square size={13} />停止</button></div>}<div ref={resultsEndRef} /></section>{error && <div className="error-banner"><X size={15} /><span>{error}</span></div>}</div>
    <div className="prompt-area"><div className="prompt-height-resizer" onPointerDown={startPromptResize} role="separator" aria-orientation="horizontal" />{!aiConfig.apiKey && !configured && <button className="config-warning" onClick={openSettings}>{t('notConfigured')}</button>}{skillSuggestions.length > 0 && <div className="skill-command-menu">{skillSuggestions.map((skill) => <button key={skill.id} onClick={() => setCustomPrompt(`/${skill.command} `)}><Puzzle size={14} /><span><strong>/{skill.command}</strong><small>{skill.name}</small></span></button>)}</div>}<div className="prompt-box" style={{ height: promptHeight }}><textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (customPrompt.trim()) runAi('custom', customPrompt.trim()) } }} placeholder={scope === 'document' || !selectionReady ? t('promptDocument') : t('promptSelection')} /><button disabled={!!busy || currentAiBusy || !customPrompt.trim()} onClick={() => runAi('custom', customPrompt.trim())}><Send size={17} /></button></div><small className="prompt-hint"><label className="reasoning-switch"><input type="checkbox" checked={deepThinking && aiConfig.reasoningEnabled} disabled={!aiConfig.reasoningEnabled} onChange={(event) => setDeepThinking(event.target.checked)} /><span className="switch-track"><i /></span><Sparkles size={12} />{t('deepThinking')}</label><span>{t('sendHint')} · <button onClick={() => setCustomPrompt('/')}>{t('chooseSkillHint')}</button></span></small></div>
  </div>

  const panelContent: Record<PanelId, ReactNode> = { projects: projectContent, selection: selectionContent, chat: chatContent, notes: source ? <NoteEditor fileName={source.name} value={note} onChange={setNote} assets={noteAssets} onAssetsChange={setNoteAssets} /> : null }
  const panelMeta: Record<PanelId, { title: string; icon: ReactNode; actions?: ReactNode }> = {
    projects: { title: '项目', icon: <FolderOpen size={15} /> }, selection: { title: t('selection'), icon: <MousePointer2 size={15} /> },
    chat: { title: t('aiAssistant'), icon: <BrainCircuit size={16} />, actions: <button onClick={createConversation} title={t('newConversation')}><Plus size={14} /></button> }, notes: { title: '笔记', icon: <StickyNote size={15} /> },
  }
  const renderPanel = (id: PanelId) => <WorkspacePanel key={id} id={id} title={panelMeta[id].title} icon={panelMeta[id].icon} actions={panelMeta[id].actions} layout={panelLayouts[id]} onChange={(layout) => updatePanel(id, layout)} onFocus={() => raisePanel(id)}>{panelContent[id]}</WorkspacePanel>
  const renderDockPanels = (ids: PanelId[]) => ids.map((id, index) => <Fragment key={id}>{renderPanel(id)}{index < ids.length - 1 && <div className="dock-splitter" onPointerDown={(event) => startDockSplitResize(id, ids[index + 1], event)} />}</Fragment>)

  return (
    <div className="app-shell modern-shell">
      <ActivityBar
        openPanels={{ projects: panelLayouts.projects.open, selection: panelLayouts.selection.open, notes: panelLayouts.notes.open, chat: panelLayouts.chat.open }}
        hasSource={Boolean(source)}
        dark={dark}
        labels={{ openFile: t('openFile'), selection: t('selection'), conversations: t('conversations'), light: t('light'), dark: t('dark'), settings: t('settings') }}
        onOpenFile={openFile}
        onTogglePanel={togglePanel}
        onToggleTheme={() => setDark((value) => !value)}
        onOpenSettings={openSettings}
      />
      <main className="workspace" style={{ '--selection-width': `${leftPanelIds.length ? leftDockWidth : 0}px`, '--ai-width': `${rightPanelIds.length ? rightDockWidth : 0}px` } as CSSProperties}>
        {leftPanelIds.length > 0 && <div className="dock-column dock-column-left">{renderDockPanels(leftPanelIds)}<div className="panel-resizer right" onPointerDown={(event) => startResize('left', leftDockWidth, event)} /></div>}

        <section className="reader-pane">
          {!source ? <div className="empty-reader"><img src="/app-icon.svg" alt="Raid" /><p>打开或新建一个项目</p></div> : <>
            <div className="reader-toolbar">
              <div className="reader-status-group">
                <div className="selection-mode-switch" role="group" aria-label="选择方式">
                  <button className={!areaSelectionEnabled ? 'active' : ''} onClick={() => setAreaSelectionEnabled(false)}><TextCursorInput size={14} /><span>{t('chooseText')}</span></button>
                  <button className={areaSelectionEnabled ? 'active' : ''} onClick={() => setAreaSelectionEnabled(true)}><MousePointer2 size={14} /><span>{t('chooseArea')}</span></button>
                </div>
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
            <div className="reader-scroll" ref={readerScrollRef} onScroll={onReaderScroll}><DocumentViewer key={source.url} source={source} zoom={zoom} currentPage={currentPage} inverted={dark} areaSelectionEnabled={areaSelectionEnabled} onPdfReady={onPdfReady} onSelect={onSelect} onTextAi={addTextToAi} onTextTranslate={translateTextInline} highlights={highlights} onHighlight={toggleHighlight} /></div>
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
          projects={projectMemories}
          onClose={() => setSettingsOpen(false)}
          onImportSkill={importSkillFolder}
          onRemoveSkill={removeSkill}
          onImportLanguage={importLanguageFolder}
          onLanguageChange={changeLanguage}
          onMemorySettingsChange={changeMemorySettings}
          onUserMemoryChange={changeUserMemory}
          onDeleteProject={deleteProject}
          onSave={(config) => {
            setAiConfig(config)
            if (!config.reasoningEnabled) setDeepThinking(false)
            localStorage.setItem('reading-assistant-ai-config', JSON.stringify(config))
          }}
        />}
    </div>
  )
}
