import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Download, Eye, PenLine, RotateCcw } from 'lucide-react'

type Props = { fileName: string; value: string; onChange: (value: string) => void }

export default function NoteEditor({ fileName, value, onChange }: Props) {
  const [preview, setPreview] = useState(false)
  const [inking, setInking] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  useEffect(() => {
    if (!inking) return
    const canvas = canvasRef.current
    if (!canvas) return
    const scale = window.devicePixelRatio || 1
    canvas.width = Math.max(320, canvas.clientWidth) * scale
    canvas.height = Math.max(180, canvas.clientHeight) * scale
    canvas.getContext('2d')?.scale(scale, scale)
  }, [inking])

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'))
    if (!image) return
    event.preventDefault()
    const reader = new FileReader()
    reader.onload = () => onChange(`${value}\n\n![粘贴图片](${String(reader.result)})\n`)
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
    context.strokeStyle = '#2878ff'; context.lineWidth = 2.5; context.lineCap = 'round'
    context.lineTo(p.x, p.y); context.stroke()
  }

  const insertInk = () => {
    const image = canvasRef.current?.toDataURL('image/png')
    if (image) onChange(`${value}\n\n![墨迹](${image})\n`)
    setInking(false)
  }

  const download = () => {
    const blob = new Blob([value], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${fileName.replace(/\.[^.]+$/, '')}-笔记.md`; anchor.click()
    URL.revokeObjectURL(url)
  }

  return <section className="note-editor">
    <header><strong>{fileName} · 笔记</strong><div>
      <button onClick={() => setPreview((v) => !v)}><Eye size={14} />{preview ? '编辑' : '预览'}</button>
      <button onClick={() => setInking(true)}><PenLine size={14} />墨迹</button>
      <button onClick={download}><Download size={14} />导出</button>
    </div></header>
    {preview ? <div className="note-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{value || '*暂无笔记*'}</ReactMarkdown></div> : <textarea value={value} onChange={(e) => onChange(e.target.value)} onPaste={paste} placeholder="使用 Markdown 记录笔记，可直接粘贴图片……" />}
    {inking && <div className="ink-editor"><div className="ink-toolbar"><span>墨迹画布（拖动右下角可调整大小）</span><button onClick={() => { const c = canvasRef.current; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height) }}><RotateCcw size={14} />清空</button><button onClick={insertInk}>插入笔记</button><button onClick={() => setInking(false)}>取消</button></div><canvas ref={canvasRef} onPointerDown={startInk} onPointerMove={moveInk} onPointerUp={() => { drawing.current = false }} /></div>}
  </section>
}
