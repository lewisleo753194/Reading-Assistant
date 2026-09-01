import { BookOpenCheck, Clock3, FileQuestion, Files, LoaderCircle } from 'lucide-react'

type Props = {
  sourceCount: number
  busy: boolean
  onGenerate: (title: string, instruction: string) => void
}

const outputs = [
  { title: '学习指南', description: '提炼概念、重点与复习问题', icon: BookOpenCheck, instruction: '请综合全部来源生成一份学习指南：先给出学习目标和核心概念，再按主题解释重点，最后给出复习问题与参考答案。所有事实都要标注来源。' },
  { title: '简报', description: '快速掌握材料的结论与分歧', icon: Files, instruction: '请综合全部来源生成一份结构清晰的简报，包括执行摘要、关键发现、来源之间的一致与分歧、证据局限和下一步建议。所有事实都要标注来源。' },
  { title: 'FAQ', description: '生成常见问题与材料内答案', icon: FileQuestion, instruction: '请基于全部来源生成一份 FAQ。选择最值得理解的 10 个问题，给出简明但完整的答案，并为每个答案标注来源；材料无法回答的内容不要补写。' },
  { title: '时间线', description: '按时间整理事件和因果关系', icon: Clock3, instruction: '请从全部来源中提取有明确时间依据的事件，生成时间线并解释关键因果关系。若材料没有足够的时间信息，请明确说明，不要推测日期。所有事件都要标注来源。' },
]

export default function StudioPanel({ sourceCount, busy, onGenerate }: Props) {
  return <section className="studio-panel">
    <div className="studio-intro"><strong>从来源生成</strong><span>{sourceCount} 份来源 · 结果保存到当前对话</span></div>
    <div className="studio-grid">{outputs.map((output) => {
      const Icon = output.icon
      return <button key={output.title} disabled={busy || sourceCount === 0} onClick={() => onGenerate(output.title, output.instruction)}><i>{busy ? <LoaderCircle className="spin" size={18} /> : <Icon size={18} />}</i><span><strong>{output.title}</strong><small>{output.description}</small></span></button>
    })}</div>
    <p>Studio 会同时检索项目内的全部来源；生成内容仍以原始资料为依据，并保留可跳转引用。</p>
  </section>
}
