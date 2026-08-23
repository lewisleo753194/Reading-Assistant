import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'
import { Check, Copy, ImageOff, Languages, LoaderCircle, Sparkles, X } from 'lucide-react'
import SelectableCanvas from './SelectableCanvas'
import type { SelectionResult, SourceFile } from '../types'
import { loadPdf } from '../lib/pdf'
import { useI18n } from '../i18n'

type Props = {
  source: SourceFile
  zoom: number
  currentPage: number
  inverted: boolean
  areaSelectionEnabled: boolean
  onPdfReady: (pdf: PDFDocumentProxy) => void
  onSelect: (selection: SelectionResult) => void
  onTextAi: (text: string) => void
  onTextTranslate: (text: string) => Promise<string>
}

function PdfPage({ pdf, pageNumber, zoom, inverted, textSelectionEnabled }: { pdf: PDFDocumentProxy; pageNumber: number; zoom: number; inverted: boolean; textSelectionEnabled: boolean }) {
  const textLayerRef = useRef<HTMLDivElement>(null)
  const render = useCallback(async (canvas: HTMLCanvasElement) => {
    const page = await pdf.getPage(pageNumber)
    const displayViewport = page.getViewport({ scale: 0.82 * zoom })
    const outputScale = Math.min(window.devicePixelRatio || 1, 1.6)
    const viewport = page.getViewport({ scale: 0.82 * zoom * outputScale })
    const context = canvas.getContext('2d')
    if (!context) return
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.width = `${displayViewport.width}px`
    canvas.style.height = `${displayViewport.height}px`
    await page.render({ canvasContext: context, viewport, canvas }).promise
  }, [pdf, pageNumber, zoom])

  useEffect(() => {
    const container = textLayerRef.current
    if (!container) return
    container.replaceChildren()
    if (!textSelectionEnabled) return
    let active = true
    let layer: TextLayer | null = null
    void pdf.getPage(pageNumber).then(async (page) => {
      if (!active) return
      const viewport = page.getViewport({ scale: 0.82 * zoom })
      container.style.setProperty('--total-scale-factor', String(0.82 * zoom))
      container.style.setProperty('--scale-round-x', '1px')
      container.style.setProperty('--scale-round-y', '1px')
      layer = new TextLayer({ textContentSource: await page.getTextContent(), container, viewport })
      await layer.render()
    }).catch(() => undefined)
    return () => { active = false; layer?.cancel(); container.replaceChildren() }
  }, [pdf, pageNumber, textSelectionEnabled, zoom])

  return <SelectableCanvas pageNumber={pageNumber} render={render} onSelect={() => undefined} selectionEnabled={false} inverted={inverted} overlay={<div ref={textLayerRef} className={`text-layer ${textSelectionEnabled ? 'enabled' : ''}`} />} />
}

function ImagePage({ source, zoom, inverted }: { source: SourceFile; zoom: number; inverted: boolean }) {
  const render = useCallback(async (canvas: HTMLCanvasElement) => {
    const image = new Image()
    image.src = source.url
    await image.decode()
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    canvas.style.width = `${Math.min(1100, image.naturalWidth) * zoom}px`
    contextSafe(canvas)?.drawImage(image, 0, 0)
  }, [source.url, zoom])
  return <SelectableCanvas pageNumber={1} className="image-page" render={render} onSelect={() => undefined} selectionEnabled={false} inverted={inverted} />
}

const contextSafe = (canvas: HTMLCanvasElement) => canvas.getContext('2d')

type SelectionRect = { left: number; top: number; width: number; height: number }

export default function DocumentViewer({ source, zoom, currentPage, inverted, areaSelectionEnabled, onPdfReady, onSelect, onTextAi, onTextTranslate }: Props) {
  const { t, pack } = useI18n()
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const rectRef = useRef<SelectionRect | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const autoScrollFrameRef = useRef<number | null>(null)
  const [textAction, setTextAction] = useState<{ text: string; left: number; top: number } | null>(null)
  const [translation, setTranslation] = useState('')
  const [translating, setTranslating] = useState(false)
  const [copied, setCopied] = useState(false)
  const renderRadius = zoom > 1.8 ? 1 : zoom > 1.2 ? 2 : 3

  useEffect(() => {
    if (source.kind !== 'pdf') return
    loadPdf(source.url)
      .then((document) => { setPdf(document); onPdfReady(document) })
      .catch((reason) => setError(reason instanceof Error ? reason.message : (pack.code === 'en-US' ? 'Failed to load PDF' : 'PDF 加载失败')))
  }, [source, onPdfReady, pack.code])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setTextAction(null)
      setTranslation('')
      window.getSelection()?.removeAllRanges()
    })
    return () => cancelAnimationFrame(frame)
  }, [areaSelectionEnabled])

  if (error) return <div className="viewer-state"><ImageOff /><p>{error}</p></div>
  if (source.kind === 'pdf' && !pdf) return <div className="viewer-state"><span className="spinner" /><p>{t('loadingPdf')}</p></div>

  const pointFromClient = (clientX: number, clientY: number) => {
    const stack = stackRef.current
    if (!stack) return { x: 0, y: 0 }
    const bounds = stack.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(bounds.width, clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, clientY - bounds.top)),
    }
  }

  const updateSelection = (clientX: number, clientY: number) => {
    if (!startRef.current) return
    const point = pointFromClient(clientX, clientY)
    const start = startRef.current
    const next = {
      left: Math.min(start.x, point.x),
      top: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    }
    rectRef.current = next
    setSelectionRect(next)
  }

  const stopAutoScroll = () => {
    if (autoScrollFrameRef.current !== null) cancelAnimationFrame(autoScrollFrameRef.current)
    autoScrollFrameRef.current = null
  }

  const runAutoScroll = () => {
    stopAutoScroll()
    const step = () => {
      if (!startRef.current || !lastPointerRef.current) return stopAutoScroll()
      const container = stackRef.current?.closest<HTMLElement>('.reader-scroll')
      if (!container) return stopAutoScroll()
      const bounds = container.getBoundingClientRect()
      const edge = 64
      const pointerY = lastPointerRef.current.y
      let speed = 0
      if (pointerY < bounds.top + edge) speed = -Math.min(18, (bounds.top + edge - pointerY) * 0.3)
      if (pointerY > bounds.bottom - edge) speed = Math.min(18, (pointerY - (bounds.bottom - edge)) * 0.3)
      if (speed) {
        container.scrollTop += speed
        updateSelection(lastPointerRef.current.x, lastPointerRef.current.y)
        autoScrollFrameRef.current = requestAnimationFrame(step)
      } else {
        autoScrollFrameRef.current = null
      }
    }
    autoScrollFrameRef.current = requestAnimationFrame(step)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!areaSelectionEnabled || event.button !== 0 || !(event.target as HTMLElement).closest('.selectable-page')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointFromClient(event.clientX, event.clientY)
    startRef.current = point
    lastPointerRef.current = { x: event.clientX, y: event.clientY }
    const next = { left: point.x, top: point.y, width: 0, height: 0 }
    rectRef.current = next
    setSelectionRect(next)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!areaSelectionEnabled || !startRef.current) return
    lastPointerRef.current = { x: event.clientX, y: event.clientY }
    updateSelection(event.clientX, event.clientY)
    runAutoScroll()
  }

  const finishSelection = () => {
    stopAutoScroll()
    const stack = stackRef.current
    const rect = rectRef.current
    startRef.current = null
    lastPointerRef.current = null
    rectRef.current = null
    setSelectionRect(null)
    if (!stack || !rect || rect.width < 8 || rect.height < 8) return

    const stackBounds = stack.getBoundingClientRect()
    const images: string[] = []
    const regions: SelectionResult['regions'] = []
    stack.querySelectorAll<HTMLElement>('.selectable-page').forEach((pageElement) => {
      const canvas = pageElement.querySelector('canvas')
      if (!canvas) return
      const bounds = pageElement.getBoundingClientRect()
      const pageBox = {
        left: bounds.left - stackBounds.left,
        top: bounds.top - stackBounds.top,
        right: bounds.right - stackBounds.left,
        bottom: bounds.bottom - stackBounds.top,
      }
      const intersection = {
        left: Math.max(rect.left, pageBox.left),
        top: Math.max(rect.top, pageBox.top),
        right: Math.min(rect.left + rect.width, pageBox.right),
        bottom: Math.min(rect.top + rect.height, pageBox.bottom),
      }
      if (intersection.right <= intersection.left || intersection.bottom <= intersection.top) return

      const cssWidth = bounds.width
      const cssHeight = bounds.height
      const relative = {
        left: (intersection.left - pageBox.left) / cssWidth,
        top: (intersection.top - pageBox.top) / cssHeight,
        width: (intersection.right - intersection.left) / cssWidth,
        height: (intersection.bottom - intersection.top) / cssHeight,
      }
      const sourceWidth = Math.max(1, Math.round(relative.width * canvas.width))
      const sourceHeight = Math.max(1, Math.round(relative.height * canvas.height))
      const outputScale = Math.min(1, 2600 / Math.max(sourceWidth, sourceHeight))
      const crop = document.createElement('canvas')
      crop.width = Math.max(1, Math.round(sourceWidth * outputScale))
      crop.height = Math.max(1, Math.round(sourceHeight * outputScale))
      crop.getContext('2d')?.drawImage(
        canvas,
        relative.left * canvas.width,
        relative.top * canvas.height,
        sourceWidth,
        sourceHeight,
        0,
        0,
        crop.width,
        crop.height,
      )
      images.push(crop.toDataURL('image/jpeg', 0.94))
      regions.push({ page: Number(pageElement.dataset.pageNumber), region: relative })
    })
    if (images.length) onSelect({ image: images[0], images, page: regions[0].page, regions })
  }

  const showTextActions = () => {
    setTimeout(() => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.rangeCount) return setTextAction(null)
      const range = selection.getRangeAt(0)
      const stack = stackRef.current
      if (!stack?.contains(range.commonAncestorContainer)) return setTextAction(null)
      const text = selection.toString().trim()
      if (!text) return setTextAction(null)
      const bounds = range.getBoundingClientRect()
      setTranslation('')
      setCopied(false)
      setTextAction({
        text,
        left: Math.max(12, Math.min(window.innerWidth - 250, bounds.left + bounds.width / 2 - 110)),
        top: Math.max(12, Math.min(window.innerHeight - 150, bounds.bottom + 9)),
      })
    }, 0)
  }

  const onPointerUp = () => {
    if (areaSelectionEnabled) finishSelection()
    else showTextActions()
  }

  const translateSelectedText = async () => {
    if (!textAction) return
    setTranslating(true)
    setTranslation('')
    try {
      setTranslation(await onTextTranslate(textAction.text))
    } catch (reason) {
      setTranslation(reason instanceof Error ? reason.message : t('translatingFailed'))
    } finally {
      setTranslating(false)
    }
  }

  return (
    <div className={`document-stack ${areaSelectionEnabled ? 'continuous-selection' : 'text-selection-mode'}`} ref={stackRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => areaSelectionEnabled && finishSelection()}>
      {source.kind === 'image'
        ? <ImagePage source={source} zoom={zoom} inverted={inverted} />
        : pdf && Array.from({ length: pdf.numPages }, (_, index) => {
          const pageNumber = index + 1
          return Math.abs(pageNumber - currentPage) <= renderRadius
            ? <PdfPage key={pageNumber} pdf={pdf} pageNumber={pageNumber} zoom={zoom} inverted={inverted} textSelectionEnabled={!areaSelectionEnabled} />
            : <div key={pageNumber} className="pdf-page-placeholder" data-page-number={pageNumber} style={{ width: 500 * zoom, height: 710 * zoom }}><span>{pageNumber}</span></div>
        })}
      {selectionRect && <div className="document-selection-rect" style={selectionRect} />}
      {!areaSelectionEnabled && textAction && <div className="text-action-popover" style={{ left: textAction.left, top: textAction.top }} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
        <div className="text-action-buttons">
          <button onClick={async () => { await navigator.clipboard.writeText(textAction.text); setCopied(true) }}>{copied ? <Check size={14} /> : <Copy size={14} />}{t('copy')}</button>
          <button onClick={translateSelectedText} disabled={translating}><Languages size={14} />{t('translate')}</button>
          <button onClick={() => { onTextAi(textAction.text); setTextAction(null); window.getSelection()?.removeAllRanges() }}><Sparkles size={14} />AI</button>
          <button className="close-text-action" onClick={() => { setTextAction(null); window.getSelection()?.removeAllRanges() }}><X size={14} /></button>
        </div>
        {(translating || translation) && <div className="inline-translation">
          {translating ? <><LoaderCircle className="spin" size={15} /> {pack.code === 'en-US' ? 'Translating…' : '正在翻译…'}</> : translation}
        </div>}
      </div>}
    </div>
  )
}
