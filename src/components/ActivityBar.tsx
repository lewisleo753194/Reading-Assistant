import { BookOpen, BrainCircuit, FolderOpen, Moon, MousePointer2, PencilRuler, Plus, Settings2, Sparkles, StickyNote, Sun } from 'lucide-react'
import type { PanelId } from '../types'

type Props = {
  openPanels: Record<PanelId, boolean>
  hasSource: boolean
  hasProject: boolean
  dark: boolean
  annotationActive: boolean
  labels: {
    openFile: string
    selection: string
    conversations: string
    light: string
    dark: string
    settings: string
  }
  onOpenFile: (file: File) => void | Promise<void>
  onTogglePanel: (id: PanelId) => void
  onToggleAnnotation: () => void
  onToggleTheme: () => void
  onOpenSettings: () => void
}

export default function ActivityBar({ openPanels, hasSource, hasProject, dark, annotationActive, labels, onOpenFile, onTogglePanel, onToggleAnnotation, onToggleTheme, onOpenSettings }: Props) {
  return <nav className="activity-bar">
    <div className="activity-logo"><BookOpen size={28} strokeWidth={2.3} /></div>
    <button className={openPanels.projects ? 'active' : ''} onClick={() => onTogglePanel('projects')} title="项目"><FolderOpen /></button>
    <button className={openPanels.selection ? 'active' : ''} disabled={!hasSource} onClick={() => onTogglePanel('selection')} title={labels.selection}><MousePointer2 /></button>
    <button className={openPanels.notes ? 'active' : ''} disabled={!hasSource} onClick={() => onTogglePanel('notes')} title="笔记"><StickyNote /></button>
    <button className={openPanels.chat ? 'active' : ''} disabled={!hasProject} onClick={() => onTogglePanel('chat')} title={labels.conversations}><BrainCircuit /></button>
    <button className={openPanels.studio ? 'active' : ''} disabled={!hasSource} onClick={() => onTogglePanel('studio')} title="Studio"><Sparkles /></button>
    <button className={annotationActive ? 'active' : ''} disabled={!hasSource} onClick={onToggleAnnotation} title="批注"><PencilRuler /></button>
    <label title={labels.openFile}><Plus /><input hidden multiple type="file" accept="application/pdf,image/*,.txt,.md,.markdown,.csv,.json,.html,.xml" onChange={async (event) => { for (const file of Array.from(event.target.files || [])) await onOpenFile(file); event.target.value = '' }} /></label>
    <span className="activity-spacer" />
    <button onClick={onToggleTheme} title={dark ? labels.light : labels.dark}>{dark ? <Sun /> : <Moon />}</button>
    <button onClick={onOpenSettings} title={labels.settings}><Settings2 /></button>
  </nav>
}
