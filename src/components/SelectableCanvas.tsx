import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { SelectionResult } from '../types'

type Point = { x: number; y: number }
type Rect = { left: number; top: number; width: number; height: number }

type Props = {
  pageNumber: number
  className?: string
  render: (canvas: HTMLCanvasElement) => Promise<void>
  onSelect: (selection: SelectionResult) => void
  selectionEnabled?: boolean
  inverted?: boolean
  overlay?: ReactNode
}

export default function SelectableCanvas({ pageNumber, className = '', render, onSelect, selectionEnabled = true, inverted = false, overlay }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hasContentRef = useRef(false)
  const startRef = useRef<Point | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [rendering, setRendering] = useState(true)
  const [renderError, setRenderError] = useState('')

  useEffect(() => {
    let active = true
    const canvas = canvasRef.current
    if (!canvas) return
    if (!hasContentRef.current) setRendering(true)
    const buffer = document.createElement('canvas')
    Promise.resolve()
      .then(() => { if (active) setRenderError(''); return render(buffer) })
      .then(() => {
        if (!active) return
        canvas.width = buffer.width
        canvas.height = buffer.height
        canvas.style.width = buffer.style.width
        canvas.style.height = buffer.style.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法创建页面画布')
        context.drawImage(buffer, 0, 0)
        hasContentRef.current = true
      })
      .catch((reason) => active && setRenderError(reason instanceof Error ? reason.message : '页面渲染失败'))
      .finally(() => active && setRendering(false))
    return () => { active = false }
  }, [render])

  const pointFromEvent = (event: ReactPointerEvent) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (rendering || !selectionEnabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointFromEvent(event)
    startRef.current = point
    setRect({ left: point.x, top: point.y, width: 0, height: 0 })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return
    const point = pointFromEvent(event)
    const start = startRef.current
    setRect({
      left: Math.min(start.x, point.x),
      top: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!startRef.current || !rect || rect.width < 8 || rect.height < 8) {
      startRef.current = null
      setRect(null)
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const scaleX = canvas.width / bounds.width
    const scaleY = canvas.height / bounds.height
    try {
      const sourceWidth = Math.max(1, Math.round(rect.width * scaleX))
      const sourceHeight = Math.max(1, Math.round(rect.height * scaleY))
      const outputScale = Math.min(1, 2200 / Math.max(sourceWidth, sourceHeight))
      const crop = document.createElement('canvas')
      crop.width = Math.max(1, Math.round(sourceWidth * outputScale))
      crop.height = Math.max(1, Math.round(sourceHeight * outputScale))
      crop.getContext('2d')?.drawImage(
        canvas,
        rect.left * scaleX,
        rect.top * scaleY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        crop.width,
        crop.height,
      )
      const image = crop.toDataURL('image/jpeg', 0.92)
      const region = {
        left: rect.left / bounds.width,
        top: rect.top / bounds.height,
        width: rect.width / bounds.width,
        height: rect.height / bounds.height,
      }
      onSelect({
        image,
        images: [image],
        page: pageNumber,
        regions: [{ page: pageNumber, region }],
      })
    } catch (reason) {
      setRenderError(reason instanceof Error ? reason.message : '无法截取当前选区')
    }
    startRef.current = null
    setRect(null)
  }

  return (
    <div
      className={`selectable-page ${selectionEnabled ? 'selection-enabled' : ''} ${inverted ? 'file-inverted' : ''} ${className}`}
      data-page-number={pageNumber}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { startRef.current = null; setRect(null) }}
    >
      <canvas ref={canvasRef} />
      {overlay}
      {rendering && <div className="page-loader"><span /></div>}
      {renderError && <div className="canvas-error">选区处理失败：{renderError}</div>}
      {rect && <div className="selection-rect" style={rect} />}
      <div className="page-number">{pageNumber}</div>
    </div>
  )
}
