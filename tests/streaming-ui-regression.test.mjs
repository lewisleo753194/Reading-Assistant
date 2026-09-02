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

test('streaming respects a reader who scrolls away from the latest answer', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /chatFollowsLatestRef = useRef\(true\)/)
  assert.match(app, /scrollHeight - container\.scrollTop - container\.clientHeight <= 48/)
  assert.match(app, /container && chatFollowsLatestRef\.current/)
  assert.match(app, /addEventListener\('scroll', onScroll/)
})

test('page navigation waits for the intended document and commits typed pages', async () => {
  const [app, viewer] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/DocumentViewer.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(app, /attemptsRemaining = 20/)
  assert.match(app, /stack\?\.dataset\.sourceUrl !== expectedSourceUrl/)
  assert.match(app, /onBlur=\{commitPageInput\}/)
  assert.match(viewer, /data-source-url=\{source\.url\}/)
})
