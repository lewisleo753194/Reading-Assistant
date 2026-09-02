import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Codex selection questions do not wait for full-document OCR', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(app, /setTimeout\(\(\) => \{ if \(activeWorkAreaId\) void buildDocumentContext/)
  assert.match(app, /modelCanReadSelectionImage = aiConfig\.provider === 'codex' \|\| aiConfig\.visionEnabled/)
  assert.match(app, /loading: !modelCanReadSelectionImage/)
  assert.match(app, /if \(modelCanReadSelectionImage\) \{[\s\S]*?return[\s\S]*?\}\r?\n    setBusy\('ocr'\)/)
  assert.doesNotMatch(app, /setTimeout\(\(\) => \{ void getWorker\(\)/)
  assert.match(app, /else if \(targetIsDocument\) context = await buildDocumentContext/)
  assert.doesNotMatch(app, /context = notebookContext\?\.text \|\| await buildDocumentContext/)
})

test('general questions explicitly bypass selections and document extraction', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.match(app, /useState<WorkArea\['scope'\]>\('general'\)/)
  assert.match(app, /targetIsGeneral = effectiveScope === 'general'/)
  assert.match(app, /if \(aiConfig\.provider === 'openai-responses' && source && targetIsDocument && !usingNotebookSubset\)/)
  assert.match(app, /includeContext: !targetIsGeneral/)
  assert.match(app, /contextMode: targetIsGeneral \? 'general'/)
  assert.match(app, /selectedText: targetIsSelection \? selectedText : ''/)
  assert.match(app, /scope === 'general'.*?setScope\('general'\)/s)
  assert.doesNotMatch(app, /effectiveScope === 'document' \|\| !selectionReady/)
})

test('scope validation allows source-free general chat and keeps material scopes isolated', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(app, /\(!source \|\| !activeWorkAreaId\) && !pendingForMessage\.length/)
  assert.match(app, /effectiveScope === 'document' && \(!source \|\| !activeWorkAreaId\)/)
  assert.match(app, /currentSourceFileId = targetIsDocument && !usingNotebookSubset/)
  assert.match(app, /selectedText: targetIsSelection \? selectedText : ''/)
  assert.match(app, /effectiveScope === 'notebook' && notebookAreas\.length === 0/)
})
