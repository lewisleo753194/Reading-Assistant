import { GripHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import type { AnnotationPoint, AnnotationTool, DocumentAnnotation, InkAnnotation, TextAnnotation } from '../types'

type Props = {
  pageNumber: number
  active: boolean
  tool: AnnotationTool
  color: string
  annotations: DocumentAnnotation[]
  onChange: Dispatch<SetStateAction<DocumentAnnotation[]>>
}

const makeId = () => crypto.randomUUID()
const pathData = (points: AnnotationPoint[]) => points.map((point, index) => `${index ? 'L' : 'M'} ${point.x * 1000} ${point.y * 1000}`).join(' ')
const defaultTextFontSize = 12
const minimumTextWidth = 52
const minimumTextHeight = 40

export default function AnnotationLayer({ pageNumber, active, tool, color, annotations, onChange }: Props) {
  const layerRef = useRef<HTMLDivElement>(null)
  const drawRef = useRef<{ pointerId: number; points: AnnotationPoint[] } | null>(null)
  const moveRef = useRef<{ pointerId: number; id: string; clientX: number; clientY: number; x: number; y: number } | null>(null)
  const resizeRef = useRef<{ pointerId: number; id: string; clientX: number; clientY: number; width: number; height: number; fontSize: number } | null>(null)
  const [draftPoints, setDraftPoints] = useState<AnnotationPoint[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const pageAnnotations = annotations.filter((item) => item.page === pageNumber)

  useEffect(() => {
    if (active && tool === 'text') return
    const timeout = window.setTimeout(() => setSelectedId(null), 0)
    return () => window.clearTimeout(timeout)
  }, [active, tool])

  const pointFromEvent = (event: ReactPointerEvent): AnnotationPoint => {
    const bounds = layerRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    }
  }

  const replaceAnnotation = (id: string, update: (annotation: DocumentAnnotation) => DocumentAnnotation) => {
    onChange((items) => items.map((annotation) => annotation.id === id ? update(annotation) : annotation))
  }

  const updateText = (id: string, text: string) => {
    const bounds = layerRef.current?.getBoundingClientRect()
    if (!bounds) return
    replaceAnnotation(id, (annotation) => {
      if (annotation.type !== 'text') return annotation
      const fontSize = annotation.fontSize ?? defaultTextFontSize
      const context = document.createElement('canvas').getContext('2d')
      if (context) context.font = `${fontSize}px ${getComputedStyle(layerRef.current || document.documentElement).fontFamily}`
      const lines = text.split('\n')
      const fontScale = fontSize / defaultTextFontSize
      const contentWidth = Math.max(0, ...lines.map((line) => context?.measureText(line).width || line.length * fontSize * .6))
      const desiredWidth = Math.max(minimumTextWidth * fontScale, Math.ceil(contentWidth + 12 * fontScale))
      const desiredHeight = Math.ceil(minimumTextHeight * fontScale + Math.max(0, lines.length - 1) * fontSize * 1.35)
      const width = Math.min(1, desiredWidth / bounds.width)
      const height = Math.min(1, desiredHeight / bounds.height)
      return {
        ...annotation, text, fontSize,
        x: Math.min(annotation.x, 1 - width),
        y: Math.min(annotation.y, 1 - height),
        width,
        height,
      }
    })
  }

  const eraseAt = (point: AnnotationPoint) => {
    const threshold = .018
    const target = pageAnnotations.find((annotation) => annotation.type === 'ink' && annotation.points.some((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= threshold))
    if (target) onChange((items) => items.filter((annotation) => annotation.id !== target.id))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!active || event.button !== 0 || (event.target as HTMLElement).closest('.annotation-text')) return
    event.preventDefault()
    event.stopPropagation()
    const point = pointFromEvent(event)
    if (tool === 'text') {
      if (selectedId) {
        setSelectedId(null)
        return
      }
      const bounds = layerRef.current?.getBoundingClientRect()
      if (!bounds) return
      const width = Math.min(1, minimumTextWidth / bounds.width)
      const height = Math.min(1, minimumTextHeight / bounds.height)
      const annotation: TextAnnotation = {
        id: makeId(), type: 'text', page: pageNumber, color,
        x: Math.min(point.x, 1 - width), y: Math.min(point.y, 1 - height), width, height,
        fontSize: defaultTextFontSize, text: '',
      }
      onChange((items) => [...items, annotation])
      setSelectedId(annotation.id)
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'eraser') return eraseAt(point)
    drawRef.current = { pointerId: event.pointerId, points: [point] }
    setDraftPoints([point])
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drawing = drawRef.current
    if (drawing?.pointerId === event.pointerId) {
      event.preventDefault(); event.stopPropagation()
      const point = pointFromEvent(event)
      const previous = drawing.points.at(-1)
      if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > .002) {
        drawing.points.push(point)
        setDraftPoints([...drawing.points])
      }
      return
    }
    if (active && tool === 'eraser' && event.buttons === 1) eraseAt(pointFromEvent(event))
  }

  const finishInk = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drawing = drawRef.current
    drawRef.current = null
    setDraftPoints([])
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!drawing || drawing.pointerId !== event.pointerId || drawing.points.length < 2) return
    const annotation: InkAnnotation = { id: makeId(), type: 'ink', page: pageNumber, color, strokeWidth: .004, points: drawing.points }
    onChange((items) => [...items, annotation])
  }

  const startTextMove = (event: ReactPointerEvent<HTMLButtonElement>, annotation: TextAnnotation) => {
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    moveRef.current = { pointerId: event.pointerId, id: annotation.id, clientX: event.clientX, clientY: event.clientY, x: annotation.x, y: annotation.y }
    setSelectedId(annotation.id)
  }

  const moveText = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const moving = moveRef.current
    const bounds = layerRef.current?.getBoundingClientRect()
    if (!moving || moving.pointerId !== event.pointerId || !bounds) return
    event.preventDefault(); event.stopPropagation()
    replaceAnnotation(moving.id, (annotation) => annotation.type === 'text' ? {
      ...annotation,
      x: Math.max(0, Math.min(1 - annotation.width, moving.x + (event.clientX - moving.clientX) / bounds.width)),
      y: Math.max(0, Math.min(1 - (annotation.height ?? .1), moving.y + (event.clientY - moving.clientY) / bounds.height)),
    } : annotation)
  }

  const stopTextMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (moveRef.current?.pointerId === event.pointerId) moveRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const startTextResize = (event: ReactPointerEvent<HTMLButtonElement>, annotation: TextAnnotation) => {
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeRef.current = {
      pointerId: event.pointerId, id: annotation.id, clientX: event.clientX, clientY: event.clientY,
      width: annotation.width, height: annotation.height ?? .1, fontSize: annotation.fontSize ?? defaultTextFontSize,
    }
    setSelectedId(annotation.id)
  }

  const resizeText = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resizing = resizeRef.current
    const bounds = layerRef.current?.getBoundingClientRect()
    if (!resizing || resizing.pointerId !== event.pointerId || !bounds) return
    event.preventDefault(); event.stopPropagation()
    replaceAnnotation(resizing.id, (annotation) => {
      if (annotation.type !== 'text') return annotation
      const baseWidth = resizing.width * bounds.width
      const baseHeight = resizing.height * bounds.height
      const nextWidth = baseWidth + event.clientX - resizing.clientX
      const nextHeight = baseHeight + event.clientY - resizing.clientY
      const projectedScale = (baseWidth * nextWidth + baseHeight * nextHeight) / (baseWidth ** 2 + baseHeight ** 2)
      const minimumScale = Math.max(minimumTextWidth / baseWidth, minimumTextHeight / baseHeight, 8 / resizing.fontSize)
      const maximumScale = Math.min((1 - annotation.x) * bounds.width / baseWidth, (1 - annotation.y) * bounds.height / baseHeight, 72 / resizing.fontSize)
      const scale = Math.max(minimumScale, Math.min(maximumScale, projectedScale))
      return {
        ...annotation,
        width: resizing.width * scale,
        height: resizing.height * scale,
        fontSize: resizing.fontSize * scale,
      }
    })
  }

  const stopTextResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <div ref={layerRef} className={`annotation-layer ${active ? `active tool-${tool}` : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishInk} onPointerCancel={finishInk}>
    <svg className="annotation-ink" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
      {pageAnnotations.filter((item): item is InkAnnotation => item.type === 'ink').map((item) => <path key={item.id} d={pathData(item.points)} stroke={item.color} strokeWidth={item.strokeWidth * 1000} />)}
      {draftPoints.length > 1 && <path d={pathData(draftPoints)} stroke={color} strokeWidth={4} />}
    </svg>
    {pageAnnotations.filter((item): item is TextAnnotation => item.type === 'text').map((item) => {
      const selected = active && selectedId === item.id
      return <div key={item.id} className={`annotation-text ${selected ? 'selected' : ''}`} style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${(item.height ?? .1) * 100}%`, color: item.color, fontSize: `${item.fontSize ?? defaultTextFontSize}px` }} onPointerDown={(event) => { event.stopPropagation(); if (active && tool === 'text') setSelectedId(item.id) }}>
        {selected ? <><div className="annotation-text-controls"><button title="移动文本批注" onPointerDown={(event) => startTextMove(event, item)} onPointerMove={moveText} onPointerUp={stopTextMove} onPointerCancel={stopTextMove}><GripHorizontal size={12} /></button><button title="删除文本批注" onClick={() => onChange((items) => items.filter((annotation) => annotation.id !== item.id))}><Trash2 size={11} /></button></div><textarea autoFocus rows={1} wrap="off" value={item.text} placeholder="输入批注" onChange={(event) => updateText(item.id, event.target.value)} /><button className="annotation-text-resize" title="调整文本框和文字大小" onPointerDown={(event) => startTextResize(event, item)} onPointerMove={resizeText} onPointerUp={stopTextResize} onPointerCancel={stopTextResize} /></> : <div className="annotation-text-readonly">{item.text}</div>}
      </div>
    })}
  </div>
}
