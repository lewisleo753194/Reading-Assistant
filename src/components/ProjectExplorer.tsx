import { ChevronDown, ChevronRight, FileImage, FileText, FolderPlus, MessageSquareText, Pencil, Plus, Trash2, X } from 'lucide-react'

type Source = { id: string; name: string; kind: 'pdf' | 'image' | 'text'; busy: boolean; selected: boolean; indexStatus?: 'local' | 'uploading' | 'ready' | 'error' }
type Project = { id: string; name: string; sources: Source[]; conversations: Array<{ id: string; title: string }>; activeConversationId: string }

type Props = {
  projects: Project[]
  activeProjectId: string | null
  activeSourceId: string | null
  onCreateProject: () => void
  onOpenProject: (id: string) => void
  onRenameProject: (id: string) => void
  onDeleteProject: (id: string) => void
  onOpenSource: (id: string) => void
  onDeleteSource: (id: string) => void
  onToggleSource: (id: string, selected: boolean) => void
  onSelectAllSources: () => void
  onSelectCurrentSource: () => void
  onAddSources: (projectId: string, files: File[]) => void
  onCreateConversation: () => void
  onOpenConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
}

export default function ProjectExplorer({ projects, activeProjectId, activeSourceId, onCreateProject, onOpenProject, onRenameProject, onDeleteProject, onOpenSource, onDeleteSource, onToggleSource, onSelectAllSources, onSelectCurrentSource, onAddSources, onCreateConversation, onOpenConversation, onDeleteConversation }: Props) {
  const pickSources = (projectId: string, input: HTMLInputElement) => {
    const files = Array.from(input.files || [])
    if (files.length) onAddSources(projectId, files)
    input.value = ''
  }

  return <div className="project-explorer notebook-explorer">
    <div className="notebook-explorer-heading"><span>项目</span><button type="button" onClick={onCreateProject} title="新建项目"><FolderPlus size={15} /></button></div>
    {projects.length === 0 && <div className="notebook-empty"><FolderPlus size={24} /><p>新建一个学习项目，然后加入教材和资料。</p><button type="button" onClick={onCreateProject}>新建项目</button></div>}
    {projects.map((project) => {
      const active = project.id === activeProjectId
      return <section className={`notebook-project ${active ? 'active' : ''}`} key={project.id}>
        <div className="notebook-project-row">
          <button type="button" className="notebook-project-main" onClick={() => onOpenProject(project.id)}>{active ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<strong>{project.name}</strong><small>{project.sources.length}</small></button>
          <div className="notebook-project-actions">
            <label title="添加来源"><Plus size={13} /><input hidden multiple type="file" accept="application/pdf,image/*,.txt,.md,.markdown,.csv,.json,.html,.xml" onChange={(event) => pickSources(project.id, event.target)} /></label>
            <button type="button" onClick={() => onRenameProject(project.id)} title={`重命名 ${project.name}`} aria-label="重命名项目"><Pencil size={12} /></button>
            <button type="button" onClick={() => onDeleteProject(project.id)} title={`删除 ${project.name}`} aria-label="删除项目"><Trash2 size={12} /></button>
          </div>
        </div>
        {active && <><div className="notebook-source-heading"><span>用于项目问答 · {project.sources.filter((source) => source.selected).length}/{project.sources.length}</span><div><button type="button" onClick={onSelectAllSources} disabled={project.sources.length === 0}>全选</button><button type="button" onClick={onSelectCurrentSource} disabled={!activeSourceId}>仅当前</button></div></div><div className="notebook-source-list">{project.sources.length === 0
          ? <label className="notebook-add-first"><Plus size={14} />添加第一份来源<input hidden multiple type="file" accept="application/pdf,image/*,.txt,.md,.markdown,.csv,.json,.html,.xml" onChange={(event) => pickSources(project.id, event.target)} /></label>
          : project.sources.map((source) => <div key={source.id} className={`notebook-source-row ${source.id === activeSourceId ? 'active' : ''}`}>
              <label className="notebook-source-check" title={source.selected ? `项目问答会使用 ${source.name}` : `项目问答不会使用 ${source.name}`}><input type="checkbox" checked={source.selected} onChange={(event) => onToggleSource(source.id, event.target.checked)} /><span /></label>
              <button type="button" className="notebook-source-main" onClick={() => onOpenSource(source.id)} title={source.name}>{source.kind === 'image' ? <FileImage size={13} /> : <FileText size={13} />}<span>{source.name}</span>{source.busy || source.indexStatus === 'uploading' ? <i className="source-index-dot busy" title="正在处理" /> : source.indexStatus === 'ready' ? <i className="source-index-dot ready" title="原文件全文索引就绪" /> : source.indexStatus === 'error' ? <i className="source-index-dot error" title="原文件索引失败" /> : null}</button>
              <button type="button" className="notebook-source-delete" disabled={source.busy || source.indexStatus === 'uploading'} onClick={() => onDeleteSource(source.id)} title={source.busy || source.indexStatus === 'uploading' ? '处理完成后才能删除' : `从项目中删除 ${source.name}`} aria-label={`删除文件 ${source.name}`}><Trash2 size={11} /></button>
            </div>)}</div><div className="notebook-conversations"><header><span>对话 · {project.conversations.length}</span><button type="button" onClick={onCreateConversation} title="新对话"><Plus size={12} /></button></header>{project.conversations.map((conversation) => <div className={conversation.id === project.activeConversationId ? 'active' : ''} key={conversation.id}><button type="button" className="notebook-conversation-main" onClick={() => onOpenConversation(conversation.id)}><MessageSquareText size={12} /><span>{conversation.title}</span></button><button type="button" className="notebook-conversation-delete" onClick={() => onDeleteConversation(conversation.id)} title="删除对话"><X size={11} /></button></div>)}</div></>}
      </section>
    })}
    {projects.length > 0 && <button type="button" className="new-project-footer" onClick={onCreateProject}><Plus size={14} />新建项目</button>}
  </div>
}
