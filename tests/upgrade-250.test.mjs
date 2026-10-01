import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadTs(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}

test('PDF geometry stays identical across virtualized rendering, mixed page sizes and zoom', async () => {
  const { loadPageSizes, scalePageSize } = await loadTs('../src/lib/pdf-layout.ts')
  let inFlight = 0, peak = 0
  const pdf = { numPages: 65, async getPage(number) {
    peak = Math.max(peak, ++inFlight)
    await new Promise(resolve => setImmediate(resolve))
    inFlight--
    return { getViewport: ({ scale }) => ({ width: (number % 2 ? 612 : 842) * scale, height: (number % 2 ? 792 : 595) * scale }) }
  } }
  const sizes = await loadPageSizes(pdf, () => true)
  assert.equal(Object.keys(sizes).length, 65)
  assert.ok(peak <= 16)
  for (const zoom of [0.5, 1, 1.7, 2.5]) {
    for (let page = 1; page <= 65; page++) {
      const viewport = (await pdf.getPage(page)).getViewport({ scale: 0.82 * zoom })
      const reserved = scalePageSize(sizes[page], zoom)
      assert.ok(Math.abs(reserved.height - viewport.height) < 1e-9)
      assert.ok(Math.abs(reserved.width - viewport.width) < 1e-9)
    }
  }
  assert.equal(await loadPageSizes(pdf, () => false), null)
})

test('GPT-6 models sort first without dropping custom or account models', async () => {
  const { orderModels, openAiModelPresets } = await loadTs('../src/lib/models.ts')
  assert.deepEqual(openAiModelPresets, ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'])
  assert.deepEqual(orderModels(['custom', 'gpt-6-sol', 'gpt-6.1-sol', 'custom']), ['gpt-6.1-sol', 'gpt-6-sol', 'custom'])
})

test('legacy selection layout migrates into the unified chat panel', async () => {
  const { loadPanelLayouts } = await loadTs('../src/lib/preferences.ts')
  const previous = globalThis.localStorage
  globalThis.localStorage = { getItem: () => JSON.stringify({ selection: { open: true, dock: 'right', width: 380 }, chat: { open: false } }) }
  try {
    const layouts = loadPanelLayouts()
    assert.equal(layouts.chat.open, true)
    assert.equal(layouts.chat.dock, 'right')
    assert.equal(layouts.selection.open, false)
  } finally { globalThis.localStorage = previous }
})
