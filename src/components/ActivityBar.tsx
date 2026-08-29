import { BookOpen, BrainCircuit, FolderOpen, Moon, MousePointer2, Plus, Settings2, StickyNote, Sun } from 'lucide-react'
import type { PanelId } from '../types'

type Props = {
  openPanels: Record<PanelId, boolean>
  hasSource: boolean
  dark: boolean
  labels: {
    openFile: string
    selection: string
    conversations: string
    light: string
    dark: string
    settings: string
  }
  onOpenFile: (file: File) => void
  onTogglePanel: (id: PanelId) => void
  onToggleTheme: () => void
  onOpenSettings: () => void
}

export default function ActivityBar({ openPanels, hasSource, dark, labels, onOpenFile, onTogglePanel, onToggleTheme, onOpenSettings }: Props) {
  return <nav className="activity-bar">
    <div className="activity-logo"><BookOpen size={24} /></div>
    <button className={openPanels.projects ? 'active' : ''} onClick={() => onTogglePanel('projects')} title="项目"><FolderOpen /></button>
    <button className={openPanels.selection ? 'active' : ''} disabled={!hasSource} onClick={() => onTogglePanel('selection')} title={labels.selection}><MousePointer2 /></button>
    <button className={openPanels.notes ? 'active' : ''} disabled={!hasSource} onClick={() => onTogglePanel('notes')} title="笔记"><StickyNote /></button>
    <button className={openPanels.chat ? 'active' : ''} disabled={!hasSource} onClick={() => onTogglePanel('chat')} title={labels.conversations}><BrainCircuit /></button>
    <label title={labels.openFile}><Plus /><input hidden type="file" accept="application/pdf,image/*" onChange={(event) => event.target.files?.[0] && onOpenFile(event.target.files[0])} /></label>
    <span className="activity-spacer" />
    <button onClick={onToggleTheme} title={dark ? labels.light : labels.dark}>{dark ? <Sun /> : <Moon />}</button>
    <button onClick={onOpenSettings} title={labels.settings}><Settings2 /></button>
  </nav>
}
