import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Download, PenLine, RotateCcw } from 'lucide-react'

type Props = { fileName: string; value: string; onChange: (value: string) => void; assets: Record<string, string>; onAssetsChange: (assets: Record<string, string>) => void }

const cropInk = (canvas: HTMLCanvasElement, dark: boolean) => {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return ''
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const background = dark ? [30, 30, 30] : [255, 255, 255]
  let left = canvas.width; let top = canvas.height; let right = -1; let bottom = -1
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4
      const distance = Math.abs(pixels.data[index] - background[0]) + Math.abs(pixels.data[index + 1] - background[1]) + Math.abs(pixels.data[index + 2] - background[2])
      if (pixels.data[index + 3] > 20 && distance > 36) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
      }
    }
  }
  if (right < left || bottom < top) return ''
  const padding = Math.round(12 * (window.devicePixelRatio || 1))
  left = Math.max(0, left - padding); top = Math.max(0, top - padding)
  right = Math.min(canvas.width - 1, right + padding); bottom = Math.min(canvas.height - 1, bottom + padding)
  const cropped = document.createElement('canvas')
  cropped.width = right - left + 1; cropped.height = bottom - top + 1
  const croppedContext = cropped.getContext('2d')
  if (!croppedContext) return ''
  croppedContext.fillStyle = dark ? '#1e1e1e' : '#ffffff'
  croppedContext.fillRect(0, 0, cropped.width, cropped.height)
  croppedContext.drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height)
  return cropped.toDataURL('image/png')
}

export default function NoteEditor({ fileName, value, onChange, assets, onAssetsChange }: Props) {
  const [inking, setInking] = useState(false)
  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = Number(localStorage.getItem('reading-assistant-note-split'))
    return Number.isFinite(saved) && saved >= .15 && saved <= .85 ? saved : .42
  })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const noteLiveRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const splitRatioRef = useRef(splitRatio)
  const splitDragRef = useRef<{ sourceAtBottom: boolean; previewAtBottom: boolean } | null>(null)
  const drawing = useRef(false)
  const dark = document.documentElement.dataset.theme === 'dark'

  const prepareCanvas = useCallback((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')
    if (!context) return
    context.fillStyle = dark ? '#1e1e1e' : '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }, [dark])

  useEffect(() => {
    if (!inking) return
    const canvas = canvasRef.current
    if (!canvas) return
    const scale = window.devicePixelRatio || 1
    canvas.width = Math.max(320, canvas.clientWidth) * scale
    canvas.height = Math.max(180, canvas.clientHeight) * scale
    const context = canvas.getContext('2d')
    context?.scale(scale, scale)
    prepareCanvas(canvas)
  }, [inking, dark, prepareCanvas])

  useEffect(() => () => document.body.classList.remove('resizing-note-split'), [])

  const isAtBottom = (element: HTMLElement | null) => !element || element.scrollHeight - element.scrollTop - element.clientHeight <= 16
  const keepVisibleBottoms = () => window.requestAnimationFrame(() => {
    const dragging = splitDragRef.current
    if (!dragging) return
    if (dragging.sourceAtBottom && sourceRef.current) sourceRef.current.scrollTop = sourceRef.current.scrollHeight
    if (dragging.previewAtBottom && previewRef.current) previewRef.current.scrollTop = previewRef.current.scrollHeight
  })

  const startSplit = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    splitDragRef.current = { sourceAtBottom: isAtBottom(sourceRef.current), previewAtBottom: isAtBottom(previewRef.current) }
    document.body.classList.add('resizing-note-split')
  }

  const moveSplit = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!splitDragRef.current || !noteLiveRef.current) return
    const bounds = noteLiveRef.current.getBoundingClientRect()
    const available = Math.max(1, bounds.height - 7)
    const minimum = Math.min(82, available * .4)
    const sourceHeight = Math.max(minimum, Math.min(available - minimum, event.clientY - bounds.top - 3.5))
    const next = sourceHeight / available
    splitRatioRef.current = next
    setSplitRatio(next)
    keepVisibleBottoms()
  }

  const stopSplit = () => {
    if (!splitDragRef.current) return
    splitDragRef.current = null
    document.body.classList.remove('resizing-note-split')
    localStorage.setItem('reading-assistant-note-split', String(splitRatioRef.current))
  }

  const addAsset = (data: string, label: string) => {
    const id = crypto.randomUUID()
    onAssetsChange({ ...assets, [id]: data })
    onChange(`${value}\n\n![${label}](asset:${id})\n`)
  }

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'))
    if (!image) return
    event.preventDefault()
    const reader = new FileReader()
    reader.onload = () => addAsset(String(reader.result), '粘贴图片')
    reader.readAsDataURL(image)
  }

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }

  const startInk = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    const p = point(event)
    const context = event.currentTarget.getContext('2d')
    if (!context) return
    context.beginPath(); context.moveTo(p.x, p.y)
  }

  const moveInk = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const context = event.currentTarget.getContext('2d')
    if (!context) return
    const p = point(event)
    context.strokeStyle = dark ? '#ffffff' : '#111111'; context.lineWidth = 2.5; context.lineCap = 'round'
    context.lineTo(p.x, p.y); context.stroke()
  }

  const insertInk = () => {
    const image = canvasRef.current ? cropInk(canvasRef.current, dark) : ''
    if (image) { addAsset(image, '墨迹'); setInking(false) }
  }

  const download = () => {
    const exported = value.replace(/asset:([0-9a-f-]+)/gi, (_match, id: string) => assets[id] || '')
    const blob = new Blob([exported], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${fileName.replace(/\.[^.]+$/, '')}-笔记.md`; anchor.click()
    URL.revokeObjectURL(url)
  }

  return <section className="note-editor">
    <header><span /> <div>
      <button onClick={() => setInking(true)}><PenLine size={14} />墨迹</button>
      <button onClick={download}><Download size={14} />导出</button>
    </div></header>
    <div className="note-live" ref={noteLiveRef} style={{ gridTemplateRows: `minmax(68px, ${splitRatio}fr) 7px minmax(68px, ${1 - splitRatio}fr)` }}><textarea ref={sourceRef} value={value} onChange={(e) => onChange(e.target.value)} onPaste={paste} placeholder="Markdown" /><div className="note-split-resizer" role="separator" aria-label="调整源码与预览高度" aria-orientation="horizontal" title="拖动调整源码与预览高度" onPointerDown={startSplit} onPointerMove={moveSplit} onPointerUp={stopSplit} onPointerCancel={stopSplit} /><div className="note-preview" ref={previewRef}><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(url) => url.startsWith('asset:') ? assets[url.slice(6)] || '' : url}>{value || '*暂无笔记*'}</ReactMarkdown></div></div>
    {inking && <div className="ink-editor"><div className="ink-toolbar"><span /><button onClick={() => { const c = canvasRef.current; if (c) prepareCanvas(c) }}><RotateCcw size={14} />清空</button><button onClick={insertInk}>插入笔记</button><button onClick={() => setInking(false)}>取消</button></div><canvas ref={canvasRef} onPointerDown={startInk} onPointerMove={moveInk} onPointerUp={() => { drawing.current = false }} /></div>}
  </section>
}
