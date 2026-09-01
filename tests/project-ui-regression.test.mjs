import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('project create, rename and delete use an in-app dialog', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(app, /window\.prompt/)
  assert.match(app, /className="project-dialog-backdrop"/)
  assert.match(app, /mode: 'rename'/)
  assert.match(app, /mode: 'delete'/)
})

test('project action controls are explicit buttons', async () => {
  const explorer = await readFile(new URL('../src/components/ProjectExplorer.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(explorer, /<button type="button"[\s\S]{0,220}aria-label="重命名项目"/)
  assert.match(explorer, /<button type="button"[\s\S]{0,220}aria-label="删除项目"/)
  assert.match(styles, /\.notebook-project-actions\s*\{[^}]*opacity:\.72/)
})

test('each project source has its own delete action and confirmation', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const explorer = await readFile(new URL('../src/components/ProjectExplorer.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(explorer, /onDeleteSource/)
  assert.match(explorer, /className="notebook-source-delete"/)
  assert.match(explorer, /aria-label=\{`删除文件/)
  assert.match(app, /mode: 'delete-source'/)
  assert.match(app, /removeSourceFromProject/)
  assert.match(app, /只从当前项目删除/)
  assert.match(styles, /\.notebook-source-delete\s*\{/)
})

test('each conversation keeps an explicit project-source subset and shows the effective context', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const explorer = await readFile(new URL('../src/components/ProjectExplorer.tsx', import.meta.url), 'utf8')
  const types = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(types, /sourceMemoryKeys\?: string\[\]/)
  assert.match(explorer, /className="notebook-source-check"/)
  assert.match(explorer, /onSelectAllSources/)
  assert.match(explorer, /onSelectCurrentSource/)
  assert.match(app, /sourceMemoryKeys: normalizedKeys/)
  assert.match(app, /notebookAreas\.map\(\(area\) => area\.id\)/)
  assert.match(app, /className="context-status-bar"/)
  assert.match(app, /项目来源 · 已选 \$\{selectedProjectAreas\.length\}\/\$\{activeProjectAreas\.length\} 份/)
  assert.match(styles, /\.context-status-bar\s*\{/)
})

test('conversation history stores the actual question for contextual follow-ups', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const server = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8')
  const memory = await readFile(new URL('../src/lib/memory.ts', import.meta.url), 'utf8')

  assert.match(app, /const targetText = \[effectiveInstruction \|\| implicitRequest, attachmentLine\]/)
  assert.match(app, /contextSnapshot: ChatContextSnapshot/)
  assert.match(app, /history: previousHistory\.map\(\(\{ role, content, turnId:/)
  assert.match(app, /message\.turnId === target\.turnId/)
  assert.match(app, /status: failureStatus/)
  assert.match(server, /prepareConversationHistory\(history\)/)
  assert.match(server, /recentUserQuestions[\s\S]{0,300}buildDocumentContext/)
  assert.match(server, /【较早对话摘要】/)
  assert.match(server, /item\.status === 'completed'/)
  assert.match(server, /同一对话中的此前消息属于连续上下文/)
  assert.match(memory, /preparedText\?: string/)
  assert.match(app, /preparedText: attachment\.preparedText/)
})

test('free questions do not expose source-processing shortcuts', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(app, /scope === 'general'[\s\S]{0,240}scope-action-hint/)
  assert.match(app, /自由提问请直接在下方输入问题/)
  assert.match(app, /materialActionsUnavailable/)
  assert.match(styles, /\.scope-action-hint\s*\{/)
})

test('memory settings separate projects, local sources and user memory with accurate delete scopes', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const modal = await readFile(new URL('../src/components/AiSettingsModal.tsx', import.meta.url), 'utf8')

  assert.match(app, /sourceCaches=\{projectMemories\}/)
  assert.match(app, /onDeleteProject=\{removeStudyProject\}/)
  assert.match(app, /onDeleteSourceCache=\{clearSourceCache\}/)
  assert.match(modal, /项目管理/)
  assert.match(modal, /本地来源与缓存/)
  assert.match(modal, /用户记忆/)
  assert.match(modal, /项目和项目对话会保留/)
  assert.match(modal, /onDeleteSourceCache\(source\.id\)/)
})
