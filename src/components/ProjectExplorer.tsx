import { ChevronDown, ChevronUp, FileText, LoaderCircle, MessageSquareText, Plus, StickyNote, X } from 'lucide-react'

type Project = {
  id: string
  name: string
  busy: boolean
}

type Conversation = {
  id: string
  title: string
}

type Props = {
  projects: Project[]
  activeProjectId: string | null
  activeConversationId: string
  conversations: Conversation[]
  collapsedProjectIds: ReadonlySet<string>
  onOpenProject: (id: string) => void
  onCreateConversation: (projectId: string) => void
  onOpenNotes: (projectId: string) => void
  onToggleProject: (projectId: string) => void
  onOpenConversation: (conversationId: string) => void
  onDeleteConversation: (conversationId: string) => void
}

export default function ProjectExplorer({ projects, activeProjectId, activeConversationId, conversations, collapsedProjectIds, onOpenProject, onCreateConversation, onOpenNotes, onToggleProject, onOpenConversation, onDeleteConversation }: Props) {
  return <div className="project-explorer">
    {projects.map((project) => {
      const active = project.id === activeProjectId
      const expanded = active && !collapsedProjectIds.has(project.id)
      return <section className={`project-item ${active ? 'active' : ''}`} key={project.id}>
        <button className="project-title" onClick={() => onOpenProject(project.id)}>
          {project.busy ? <LoaderCircle className="spin" size={14} /> : <FileText size={14} />}
          <span>{project.name}</span>
          <i onClick={(event) => { event.stopPropagation(); onCreateConversation(project.id) }} title="新对话"><Plus size={13} /></i>
          <i onClick={(event) => { event.stopPropagation(); onOpenNotes(project.id) }} title="打开笔记"><StickyNote size={13} /></i>
          <i onClick={(event) => { event.stopPropagation(); onToggleProject(project.id) }} title={expanded ? '收起对话' : '展开对话'}>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</i>
        </button>
        {expanded && <div className="project-conversations">{conversations.map((conversation) => <button key={conversation.id} className={conversation.id === activeConversationId ? 'active' : ''} onClick={() => onOpenConversation(conversation.id)}>
          <MessageSquareText size={12} /><span>{conversation.title}</span><i onClick={(event) => { event.stopPropagation(); onDeleteConversation(conversation.id) }}><X size={11} /></i>
        </button>)}</div>}
      </section>
    })}
  </div>
}
