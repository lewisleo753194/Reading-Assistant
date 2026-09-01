import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { startServer } from '../server/index.mjs'

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function close(server) {
  return new Promise((resolve) => server.close(resolve))
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

test('Responses mode uploads the original file and searches only its project vector store', async () => {
  const requests = []
  let responseBody
  const upstream = http.createServer(async (request, response) => {
    const body = await readBody(request)
    requests.push({ method: request.method, url: request.url, body, contentType: request.headers['content-type'] })
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'POST' && request.url === '/v1/vector_stores') return response.end(JSON.stringify({ id: 'vs_project_a' }))
    if (request.method === 'POST' && request.url === '/v1/files') return response.end(JSON.stringify({ id: 'file_textbook_a' }))
    if (request.method === 'POST' && request.url === '/v1/vector_stores/vs_project_a/files') return response.end(JSON.stringify({ id: 'file_textbook_a', status: 'completed' }))
    if (request.method === 'POST' && request.url === '/v1/responses') {
      responseBody = JSON.parse(body.toString('utf8'))
      return response.end(JSON.stringify({
        model: 'gpt-test',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '这是基于整份教材的回答。', annotations: [{ type: 'file_citation', filename: '教材.pdf' }] }] }],
      }))
    }
    response.statusCode = 404
    response.end('{}')
  })
  const upstreamPort = await listen(upstream)
  const raid = await startServer(0)
  const aiConfig = {
    provider: 'openai-responses',
    apiKey: 'responses-test-key',
    baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    model: 'gpt-test',
    visionEnabled: true,
    reasoningEnabled: false,
  }
  try {
    const vectorResponse = await fetch(`http://127.0.0.1:${raid.port}/api/openai/vector-stores`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aiConfig, name: '教材项目' }),
    })
    assert.equal(vectorResponse.ok, true)
    assert.equal((await vectorResponse.json()).id, 'vs_project_a')

    const fileResponse = await fetch(`http://127.0.0.1:${raid.port}/api/openai/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-raid-api-key': aiConfig.apiKey,
        'x-raid-base-url': aiConfig.baseUrl,
        'x-raid-vector-store-id': 'vs_project_a',
        'x-raid-file-name': encodeURIComponent('教材.pdf'),
        'x-raid-file-type': encodeURIComponent('application/pdf'),
      },
      body: Buffer.from('%PDF complete original file'),
    })
    const uploaded = await fileResponse.json()
    assert.equal(fileResponse.ok, true)
    assert.deepEqual(uploaded, { fileId: 'file_textbook_a', status: 'completed' })

    const answerResponse = await fetch(`http://127.0.0.1:${raid.port}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiConfig,
        action: 'custom',
        instruction: '综合整份教材说明核心观点',
        contextMode: 'notebook',
        projectVectorStoreId: 'vs_project_a',
        currentSourceFileId: 'file_textbook_a',
        webSearchEnabled: true,
        responseLanguage: '简体中文',
      }),
    })
    const answer = await answerResponse.json()
    assert.equal(answerResponse.ok, true)
    assert.match(answer.content, /整份教材/)
    assert.match(answer.content, /项目文件：教材\.pdf/)
    assert.deepEqual(responseBody.tools, [
      { type: 'file_search', vector_store_ids: ['vs_project_a'], max_num_results: 20 },
      { type: 'web_search_preview' },
    ])
    assert.equal(responseBody.input.at(-1).role, 'user')
    assert.ok(requests.find((item) => item.url === '/v1/files')?.contentType?.startsWith('multipart/form-data; boundary='))

    const subsetResponse = await fetch(`http://127.0.0.1:${raid.port}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiConfig,
        action: 'custom',
        instruction: '只比较勾选的上册',
        contextMode: 'notebook',
        documentText: '【来源：上册.pdf】\n[第 3 页]\n只属于上册的材料',
        includeContext: true,
        responseLanguage: '简体中文',
      }),
    })
    assert.equal(subsetResponse.ok, true)
    await subsetResponse.json()
    assert.deepEqual(responseBody.tools, [])
    assert.match(responseBody.input.at(-1).content[0].text, /只属于上册的材料/)
    assert.doesNotMatch(responseBody.input.at(-1).content[0].text, /下册\.pdf/)
  } finally {
    await close(raid.server)
    await close(upstream)
  }
})
