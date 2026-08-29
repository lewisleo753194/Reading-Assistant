import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { PanelLayout } from '../types'

type Props = {
  id: string
  title: string
  icon: ReactNode
  layout: PanelLayout
  onChange: (layout: PanelLayout) => void
  children: ReactNode
  actions?: ReactNode
}

export default function WorkspacePanel({ id, title, icon, layout, onChange, children, actions }: Props) {
  const frameRef = useRef<HTMLElement>(null)
  const moveRef = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number } | null>(null)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || layout.dock !== 'float') return
    const observer = new ResizeObserver(() => {
      const bounds = frame.getBoundingClientRect()
      const width = Math.round(bounds.width)
      const height = Math.round(bounds.height)
      if (Math.abs(width - layout.width) > 1 || Math.abs(height - layout.height) > 1) onChange({ ...layout, width, height })
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [layout, onChange])

  const finishDock = (clientX: number) => {
    const edge = 90
    if (clientX <= edge) onChange({ ...layout, dock: 'left' })
    else if (clientX >= window.innerWidth - edge) onChange({ ...layout, dock: 'right' })
  }

  const startMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (layout.dock !== 'float' || event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    moveRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: layout.x, y: layout.y }
  }

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const moving = moveRef.current
    if (!moving || moving.pointerId !== event.pointerId) return
    onChange({ ...layout, x: moving.x + event.clientX - moving.startX, y: moving.y + event.clientY - moving.startY })
  }

  const stopMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!moveRef.current) return
    moveRef.current = null
    finishDock(event.clientX)
  }

  const panel = <aside ref={frameRef} className={`workspace-panel panel-${id} dock-${layout.dock}`} onPointerDownCapture={() => { if (layout.dock === 'float') onChange({ ...layout, z: Math.max(Date.now(), layout.z + 1) }) }} style={layout.dock === 'float' ? { left: layout.x, top: layout.y, width: layout.width, height: layout.height, zIndex: layout.z } : { flexGrow: layout.dockSize }}>
    <header className="workspace-panel-header" draggable={layout.dock !== 'float'} onDragEnd={(event) => {
      const edge = 90
      if (event.clientX <= edge) onChange({ ...layout, dock: 'left' })
      else if (event.clientX >= window.innerWidth - edge) onChange({ ...layout, dock: 'right' })
      else onChange({ ...layout, dock: 'float', x: Math.max(12, event.clientX - layout.width / 2), y: Math.max(12, event.clientY - 20) })
    }} onPointerDown={startMove} onPointerMove={move} onPointerUp={stopMove} onPointerCancel={stopMove}>
      <span>{icon}<strong>{title}</strong></span><div>{actions}{layout.dock !== 'float' ? <button onClick={() => onChange({ ...layout, open: false })}>{layout.dock === 'left' ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}</button> : <button onClick={() => onChange({ ...layout, open: false })}><X size={15} /></button>}</div>
    </header>
    <div className="workspace-panel-content">{children}</div>
  </aside>
  return layout.dock === 'float' ? createPortal(panel, document.body) : panel
}
