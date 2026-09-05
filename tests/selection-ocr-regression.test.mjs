import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('area selections stay visual and never become annotation-only text prompts', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.match(app, /Area selections are visual inputs/)
  assert.match(app, /text: '', textParts: result\.images\.map\(\(\) => ''\), loading: false/)
  assert.doesNotMatch(app, /extractPdfRegionText/)
  assert.doesNotMatch(app, /annotationText && `批注：/)
  assert.doesNotMatch(app, /textarea className="selection-text-pane"/)
  assert.match(app, /区域选取会作为图片发送，不会自动转成文字/)
  assert.match(app, /currentSourceExtras = targetIsDocument/)
})

test('selection images are saved as message attachments but are not silently reused by later turns', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.match(app, /selectionAttachments: RuntimeChatAttachment\[\]/)
  assert.match(app, /origin: 'selection' as const/)
  assert.match(app, /attachments: messageAttachments\.map/)
  assert.match(app, /origin: attachment\.origin/)
  assert.match(app, /conversationAttachmentsRef\.current\.filter\(\(attachment\) => attachment\.origin !== 'selection'\)/)
  assert.match(app, /runtimeAttachment\?\.previewUrl/)
})

test('general questions explicitly bypass selections and document extraction', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.match(app, /useState<WorkArea\['scope'\]>\('general'\)/)
  assert.match(app, /targetIsGeneral = effectiveScope === 'general'/)
  assert.match(app, /includeContext: !targetIsGeneral/)
  assert.match(app, /contextMode: targetIsGeneral \? 'general'/)
  assert.match(app, /selectedText: targetIsSelection \? selectedText : ''/)
  assert.doesNotMatch(app, /effectiveScope === 'document' \|\| !selectionReady/)
})

test('scope validation allows source-free general chat and keeps material scopes isolated', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(app, /\(!source \|\| !activeWorkAreaId\) && !pendingForMessage\.length/)
  assert.match(app, /effectiveScope === 'document' && \(!source \|\| !activeWorkAreaId\)/)
  assert.match(app, /currentSourceFileId = targetIsDocument && !usingNotebookSubset/)
  assert.match(app, /effectiveScope === 'notebook' && notebookAreas\.length === 0/)
})
