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
  assert.match(app, /className="selection-image-open"/)
  assert.match(app, /setImagePreview\(\{ url: image/)
})

test('long and partial-page visual selections use exact PDF regions and readable tiles', async () => {
  const [app, viewer, styles] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/DocumentViewer.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ])

  assert.match(viewer, /splitTallSelection/)
  assert.match(viewer, /querySelectorAll<HTMLElement>\('\[data-page-number\]'\)/)
  assert.match(viewer, /await pdf\.getPage\(selected\.page\)/)
  assert.match(viewer, /transform: \[1, 0, 0, 1, -selected\.region\.left \* viewport\.width, -selected\.region\.top \* viewport\.height\]/)
  assert.match(app, /const maxConversationImages = 12/)
  assert.doesNotMatch(app, /regions\.map\(\(region\) => region\.page\)\)\.concat\(currentPage\)/)
  assert.match(styles, /\.markdown \.katex :is\(\.fbox,\.fcolorbox\) \{ border: 0 !important; \}/)
})

test('PDF.js loads packaged character maps and standard fonts for CJK formula books', async () => {
  const [pdf, packageJson] = await Promise.all([
    readFile(new URL('../src/lib/pdf.ts', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ])

  assert.match(pdf, /cMapUrl: pdfCMapUrl/)
  assert.match(pdf, /cMapPacked: true/)
  assert.match(pdf, /standardFontDataUrl: pdfStandardFontDataUrl/)
  assert.match(packageJson, /prepare:pdf-assets/)
  assert.match(packageJson, /sync-pdfjs-assets\.mjs/)
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
