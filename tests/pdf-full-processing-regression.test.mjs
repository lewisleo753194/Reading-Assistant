import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('scanned PDFs process every missing-text page in bounded resumable batches', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.match(app, /const pdfOcrBatchSize = 6/)
  assert.match(app, /pagesNeedingOcr = Array\.from\(\{ length: targetPdf\.numPages/)
  assert.match(app, /batchStart < pagesNeedingOcr\.length; batchStart \+= pdfOcrBatchSize/)
  assert.match(app, /commitDocumentProcessing\(workspaceId,[\s\S]*?false\)/)
  assert.match(app, /commitDocumentProcessing\(workspaceId, completeText, nextOcrPages, true\)/)
  assert.doesNotMatch(app, /representative|代表页|scannedPdfContext|getScannedPdfPreviewPages/)
})

test('PDF text selection supports native and OCR-generated text layers', async () => {
  const viewer = await readFile(new URL('../src/components/DocumentViewer.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  const memory = await readFile(new URL('../src/lib/memory.ts', import.meta.url), 'utf8')

  assert.match(viewer, /hasNativeText/)
  assert.match(viewer, /span\.className = 'ocr-word'/)
  assert.match(viewer, /onNeedOcrPage\(pageNumber\)/)
  assert.match(viewer, /navigator\.clipboard\.writeText\(textAction\.text\)/)
  assert.match(styles, /\.text-selection-mode \.selectable-page \{[^}]*user-select: text/)
  assert.match(memory, /ocrPages\?: Record<string, OcrPage>/)
})

test('PDF.js packages and configures its WASM image decoders', async () => {
  const pdf = await readFile(new URL('../src/lib/pdf.ts', import.meta.url), 'utf8')
  const vite = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')

  assert.match(pdf, /pdfjs-dist\/wasm\/jbig2\.wasm\?url/)
  assert.match(pdf, /pdfjs-dist\/wasm\/openjpeg\.wasm\?url/)
  assert.match(pdf, /pdfjs-dist\/wasm\/qcms_bg\.wasm\?url/)
  assert.match(pdf, /pdfjs-dist\/wasm\/quickjs-eval\.wasm\?url/)
  assert.match(pdf, /new URL\(url, window\.location\.href\)/)
  assert.match(pdf, /wasmUrl: pdfWasmUrl/)
  assert.match(pdf, /cMapUrl: pdfCMapUrl/)
  assert.match(pdf, /standardFontDataUrl: pdfStandardFontDataUrl/)
  assert.match(vite, /assetInfo\.names\[0\]\?\.endsWith\('\.wasm'\)/)
  assert.match(vite, /assets\/\[name\]\[extname\]/)
})

test('PDF and OCR resources are released instead of accumulating across sources', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const viewer = await readFile(new URL('../src/components/DocumentViewer.tsx', import.meta.url), 'utf8')
  const canvas = await readFile(new URL('../src/components/SelectableCanvas.tsx', import.meta.url), 'utf8')

  assert.match(app, /source, pdf: null, documentText/)
  assert.match(app, /setSource\(area\.source\); setPdf\(null\)/)
  assert.match(app, /scheduleOcrWorkerRelease/)
  assert.match(app, /workerPromiseRef\.current = null/)
  assert.match(app, /canvas\.width = 0[\s\S]{0,80}canvas\.height = 0/)
  assert.match(app, /await loadedPdf\.loadingTask\.destroy\(\)/)
  assert.match(viewer, /document\.loadingTask\.destroy\(\)/)
  assert.match(viewer, /page\.cleanup\(\)/)
  assert.match(viewer, /const renderRadius = zoom > 1\.2 \? 1 : 2/)
  assert.match(canvas, /buffer\.width = 0[\s\S]{0,80}buffer\.height = 0/)
})

test('release packaging has dedicated portable and setup outputs', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/)
  assert.equal(packageJson.scripts['desktop:portable'], 'npm run build && electron-builder --win portable --config.win.artifactName=Raid-Portable-${version}.${ext}')
  assert.equal(packageJson.scripts['desktop:pack'], 'npm run build && electron-builder --win nsis')
  assert.equal(packageJson.build.directories.output, `release-${packageJson.version}`)
  assert.equal(packageJson.build.win.artifactName, 'Raid-Setup-${version}.${ext}')
})

test('Windows main, floating, installer, and shortcut surfaces use the packaged Raid icon', async () => {
  const [main, packageJson] = await Promise.all([
    readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
  ])

  assert.match(main, /nativeImage/)
  assert.match(main, /path\.join\(process\.resourcesPath, process\.platform === 'win32' \? 'app-icon\.ico'/)
  assert.match(main, /icon: appIconPath/)
  assert.match(main, /mainWindow\.setIcon\(appIconImage\)/)
  assert.deepEqual(packageJson.build.extraResources, [{ from: 'electron/app-icon.ico', to: 'app-icon.ico' }])
  assert.equal(packageJson.build.win.icon, 'electron/app-icon.ico')
  assert.equal(packageJson.build.nsis.installerIcon, 'electron/app-icon.ico')
  assert.equal(packageJson.build.nsis.uninstallerIcon, 'electron/app-icon.ico')
  assert.equal(packageJson.build.nsis.installerHeaderIcon, 'electron/app-icon.ico')
})
