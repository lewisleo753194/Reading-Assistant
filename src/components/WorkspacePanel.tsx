import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { PanelLayout } from '../types'

type Props = {
  id: string
  title: string
  icon: ReactNode
  layout: PanelLayout
  onChange: (layout: PanelLayout) => void
  onFocus: () => void
  children: ReactNode
  actions?: ReactNode
}

export default function WorkspacePanel({ id, title, icon, layout, onChange, onFocus, children, actions }: Props) {
  const frameRef = useRef<HTMLElement>(null)
  const popupRef = useRef<Window | null>(null)
  const layoutRef = useRef(layout)
  const onChangeRef = useRef(onChange)
  const moveRef = useRef<{ pointerId: number; mode: 'dock' | 'float'; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [floatingDragActive, setFloatingDragActive] = useState(false)
  const [dockHint, setDockHint] = useState<'left' | 'right' | null>(null)

  /* The portal target is created by an external browser window, so it must be
     synchronized back into React after that window exists. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    layoutRef.current = layout
    onChangeRef.current = onChange
  }, [layout, onChange])

  useEffect(() => {
    if (layout.dock !== 'float') {
      popupRef.current?.close()
      popupRef.current = null
      setPortalTarget(null)
      return
    }

    const current = layoutRef.current
    const features = `popup=yes,left=${Math.round(current.x)},top=${Math.round(current.y)},width=${Math.round(current.width)},height=${Math.round(current.height)}`
    const popup = window.open('', `reading-assistant-panel-${id}`, features)
    if (!popup) {
      setPortalTarget(document.body)
      return
    }

    popupRef.current = popup
    popup.document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light'
    popup.document.body.className = 'panel-window-body'
    popup.document.head.replaceChildren()
    document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style').forEach((node) => {
      const clone = node.cloneNode(true) as HTMLLinkElement | HTMLStyleElement
      if (clone instanceof HTMLLinkElement) clone.href = node instanceof HTMLLinkElement ? node.href : ''
      popup.document.head.appendChild(clone)
    })
    popup.document.title = title
    const root = popup.document.createElement('div')
    root.id = 'panel-window-root'
    popup.document.body.replaceChildren(root)
    setPortalTarget(root)
    popup.focus()

    const syncLayout = () => {
      const latest = layoutRef.current
      const width = popup.outerWidth
      const height = popup.outerHeight
      const x = popup.screenX
      const y = popup.screenY
      if (width !== latest.width || height !== latest.height || x !== latest.x || y !== latest.y) {
        onChangeRef.current({ ...latest, width, height, x, y })
      }
    }
    const handleClose = () => onChangeRef.current({ ...layoutRef.current, open: false })
    const themeObserver = new MutationObserver(() => {
      popup.document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light'
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    popup.addEventListener('resize', syncLayout)
    popup.addEventListener('blur', syncLayout)
    popup.addEventListener('beforeunload', handleClose)
    return () => {
      themeObserver.disconnect()
      popup.removeEventListener('resize', syncLayout)
      popup.removeEventListener('blur', syncLayout)
      popup.removeEventListener('beforeunload', handleClose)
      if (!popup.closed) popup.close()
      if (popupRef.current === popup) popupRef.current = null
    }
  }, [id, layout.dock, title])
  /* eslint-enable react-hooks/set-state-in-effect */

  const dockAtPointer = (screenX: number, screenY: number): 'left' | 'right' | null => {
    const zoneWidth = 18
    const left = window.screenX
    const top = window.screenY
    const right = left + window.outerWidth
    const bottom = top + window.outerHeight
    if (screenY < top || screenY > bottom) return null
    if (screenX >= left && screenX <= left + zoneWidth) return 'left'
    if (screenX <= right && screenX >= right - zoneWidth) return 'right'
    return null
  }

  const startMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const popup = popupRef.current
    moveRef.current = {
      pointerId: event.pointerId,
      mode: layout.dock === 'float' ? 'float' : 'dock',
      startX: event.screenX,
      startY: event.screenY,
      x: popup?.screenX ?? layout.x,
      y: popup?.screenY ?? layout.y,
      moved: false,
    }
    document.body.classList.add('moving-workspace-panel')
    popup?.document.body.classList.add('moving-workspace-panel')
    if (layout.dock === 'float') setFloatingDragActive(true)
  }

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const moving = moveRef.current
    if (!moving || moving.pointerId !== event.pointerId) return
    if (Math.hypot(event.screenX - moving.startX, event.screenY - moving.startY) > 4) moving.moved = true
    if (moving.mode !== 'float' || !moving.moved) return
    popupRef.current?.readingAssistant?.movePanelWindow(id, moving.x + event.screenX - moving.startX, moving.y + event.screenY - moving.startY)
    setDockHint(dockAtPointer(event.screenX, event.screenY))
  }

  const stopMove = (event: ReactPointerEvent<HTMLElement>, allowDock = true) => {
    const moving = moveRef.current
    if (!moving || moving.pointerId !== event.pointerId) return
    moveRef.current = null
    document.body.classList.remove('moving-workspace-panel')
    popupRef.current?.document.body.classList.remove('moving-workspace-panel')
    setFloatingDragActive(false)
    setDockHint(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (moving.mode === 'float') {
      const targetDock = allowDock ? dockAtPointer(event.screenX, event.screenY) : null
      const popup = popupRef.current
      if (targetDock) onChange({ ...layout, dock: targetDock })
      else if (popup) {
        const x = moving.moved ? moving.x + event.screenX - moving.startX : popup.screenX
        const y = moving.moved ? moving.y + event.screenY - moving.startY : popup.screenY
        popup.readingAssistant?.movePanelWindow(id, x, y)
        onChange({ ...layout, x, y, width: popup.outerWidth, height: popup.outerHeight })
      }
      return
    }
    if (!moving.moved) return
    const edge = 90
    if (event.clientX <= edge) onChange({ ...layout, dock: 'left' })
    else if (event.clientX >= window.innerWidth - edge) onChange({ ...layout, dock: 'right' })
    else onChange({
      ...layout,
      dock: 'float',
      x: Math.round(window.screenX + event.clientX - layout.width / 2),
      y: Math.round(window.screenY + event.clientY - 20),
    })
  }

  const panel = <aside ref={frameRef} className={`workspace-panel panel-${id} dock-${layout.dock}`} onPointerDownCapture={onFocus} style={layout.dock === 'float' && portalTarget === document.body ? { left: layout.x, top: layout.y, width: layout.width, height: layout.height, zIndex: layout.z } : layout.dock !== 'float' ? { flexGrow: layout.dockSize } : undefined}>
    <header className="workspace-panel-header" onPointerDown={startMove} onPointerMove={move} onPointerUp={(event) => stopMove(event)} onPointerCancel={(event) => stopMove(event, false)}>
      <span>{icon}<strong>{title}</strong></span><div>{actions}{layout.dock === 'float' && <><button onClick={() => onChange({ ...layout, dock: 'left' })} title="停靠到左侧"><ChevronLeft size={15} /></button><button onClick={() => onChange({ ...layout, dock: 'right' })} title="停靠到右侧"><ChevronRight size={15} /></button></>}<button onClick={() => onChange({ ...layout, open: false })} title="关闭"><X size={15} /></button></div>
    </header>
    <div className="workspace-panel-content">{children}</div>
  </aside>
  const renderedPanel = layout.dock === 'float' && portalTarget ? createPortal(panel, portalTarget) : layout.dock === 'float' ? null : panel
  return <>{renderedPanel}{floatingDragActive && createPortal(<div className="dock-drop-zones" aria-hidden="true"><i className={dockHint === 'left' ? 'active' : ''} /><i className={dockHint === 'right' ? 'active' : ''} /></div>, document.body)}</>
}
