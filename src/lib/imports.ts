import type { LanguagePack } from '../i18n'
import type { FolderImportResult, ImportedSkill } from '../types'

const stripQuotes = (value: string) => value.trim().replace(/^['"]|['"]$/g, '')

function frontmatterValue(markdown: string, key: string) {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return ''
  const line = match[1].split(/\r?\n/).find((item) => item.trim().toLowerCase().startsWith(`${key.toLowerCase()}:`))
  return line ? stripQuotes(line.slice(line.indexOf(':') + 1)) : ''
}

export function parseSkillImport(result: FolderImportResult): ImportedSkill {
  if (result.error) throw new Error(result.error)
  const skillFile = result.files?.find((file) => file.path.toLowerCase() === 'skill.md')
  if (!skillFile || !result.folderPath) throw new Error('所选文件夹根目录中没有 SKILL.md。')
  const folderName = result.folderPath.split(/[\\/]/).filter(Boolean).at(-1) || 'skill'
  const name = frontmatterValue(skillFile.content, 'name') || folderName
  const description = frontmatterValue(skillFile.content, 'description') || skillFile.content
    .replace(/^---[\s\S]*?---\s*/, '')
    .split(/\r?\n/)
    .find((line) => line.trim() && !line.trim().startsWith('#'))?.trim() || name
  const command = name.toLocaleLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 48) || 'skill'
  const supportingFiles = (result.files || []).filter((file) => file !== skillFile)
  const instructions = [
    skillFile.content,
    ...supportingFiles.map((file) => `\n\n---\nReference file: ${file.path}\n---\n${file.content}`),
  ].join('').slice(0, 250000)
  return { id: crypto.randomUUID(), name: name.slice(0, 80), command, description: description.slice(0, 600), instructions, sourcePath: result.folderPath }
}

export function parseLanguageImport(result: FolderImportResult): LanguagePack {
  if (result.error) throw new Error(result.error)
  const candidates = result.files || []
  const preferred = candidates.find((file) => file.path.toLowerCase() === 'language.json') || candidates[0]
  if (!preferred) throw new Error('所选文件夹中没有 JSON 语言包。')
  let value: unknown
  try {
    value = JSON.parse(preferred.content)
  } catch {
    throw new Error(`${preferred.path} 不是有效的 JSON。`)
  }
  if (!value || typeof value !== 'object') throw new Error('语言包格式不正确。')
  const pack = value as Partial<LanguagePack>
  if (!pack.code || !pack.label || !pack.aiLanguage || !pack.strings || typeof pack.strings !== 'object') {
    throw new Error('语言包必须包含 code、label、aiLanguage 和 strings。')
  }
  return { code: String(pack.code), label: String(pack.label), aiLanguage: String(pack.aiLanguage), strings: pack.strings as Record<string, string> }
}
