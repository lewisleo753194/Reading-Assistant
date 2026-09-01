import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const activityBarSource = await readFile(new URL('../src/components/ActivityBar.tsx', import.meta.url), 'utf8')
const memorySource = await readFile(new URL('../src/lib/memory.ts', import.meta.url), 'utf8')
const serverSource = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8')

test('chat attachments stay in the conversation instead of becoming project sources', () => {
  assert.match(appSource, /prompt-attachment-button/)
  assert.match(appSource, /待发送 · 不加入项目/)
  assert.match(appSource, /saveConversationAttachment\(/)
  assert.match(appSource, /conversationAttachmentText:/)
  assert.match(appSource, /chatImageToDataUrl\(/)
  assert.match(memorySource, /conversation-attachments/)
  assert.match(memorySource, /createIndex\('conversationId'/)
})

test('chat can open for an empty project and the server accepts attachment-only requests', () => {
  assert.match(activityBarSource, /disabled=\{!hasProject\}/)
  assert.match(serverSource, /conversationAttachmentText/)
  assert.match(serverSource, /本次对话附件材料/)
  assert.match(serverSource, /添加项目文件或添加对话附件/)
})

test('conversation attachment citations do not masquerade as indexed project citations', () => {
  assert.match(serverSource, /（附件：文件名 · 第 N 页）/)
  assert.doesNotMatch(serverSource, /conversationAttachmentText[^\n]*indexSourceForResponses/)
})
