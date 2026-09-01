import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Codex chat requests consume NDJSON incrementally and preserve partial output on stop', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const server = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8')

  assert.match(app, /Accept: aiConfig\.provider === 'codex' \? 'application\/x-ndjson'/)
  assert.match(app, /response\.body\.getReader\(\)/)
  assert.match(app, /streamedContent \+= event\.delta/)
  assert.match(app, /> ⚠️ \$\{message\}/)
  assert.match(server, /'Content-Type': 'application\/x-ndjson; charset=utf-8'/)
  assert.match(server, /onDelta: streamRequested/)
  assert.match(server, /type: 'done'/)
})
