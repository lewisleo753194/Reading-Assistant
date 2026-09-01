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

test('the original OpenAI-compatible model path still handles models, tests, and document answers', async () => {
  const requests = []
  const requestBodies = []
  const upstream = http.createServer(async (request, response) => {
    requests.push(request.url)
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/v1/models') return response.end(JSON.stringify({ data: [{ id: 'legacy-model' }] }))
    if (request.url === '/v1/chat/completions') {
      let body = ''
      for await (const chunk of request) body += chunk
      requestBodies.push(JSON.parse(body))
      return response.end(JSON.stringify({ model: 'legacy-model', choices: [{ message: { content: '原 API 模式回答 [[PAGE:2]]' } }] }))
    }
    response.statusCode = 404
    response.end('{}')
  })
  const upstreamPort = await listen(upstream)
  const raid = await startServer(0)
  const aiConfig = {
    provider: 'openai-compatible',
    apiKey: 'local-test-key',
    baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    model: 'legacy-model',
    visionEnabled: false,
    reasoningEnabled: false,
  }
  try {
    const modelsResponse = await fetch(`http://127.0.0.1:${raid.port}/api/ai/models`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aiConfig, mode: 'default' }),
    })
    assert.deepEqual((await modelsResponse.json()).models, ['legacy-model'])
    const testResponse = await fetch(`http://127.0.0.1:${raid.port}/api/ai/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aiConfig }),
    })
    assert.equal(testResponse.ok, true)
    const answerResponse = await fetch(`http://127.0.0.1:${raid.port}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiConfig,
        action: 'explain',
        selectedText: '测试材料',
        documentText: '[第 2 页]\n测试材料',
        includeContext: true,
        anchorPages: [2],
        responseLanguage: '简体中文',
      }),
    })
    const answer = await answerResponse.json()
    assert.equal(answerResponse.ok, true)
    assert.equal(answer.content, '原 API 模式回答 [[PAGE:2]]')
    assert.equal(answer.model, 'legacy-model')
    const generalResponse = await fetch(`http://127.0.0.1:${raid.port}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiConfig,
        action: 'custom',
        instruction: '用一个例子解释什么是贝叶斯定理',
        contextMode: 'general',
        includeContext: false,
        responseLanguage: '简体中文',
      }),
    })
    assert.equal(generalResponse.ok, true)
    await generalResponse.json()
    const generalRequest = requestBodies.at(-1)
    assert.match(generalRequest.messages[0].content, /当前是自由问答/)
    assert.doesNotMatch(generalRequest.messages[0].content, /优先依据用户项目内的来源/)
    assert.match(generalRequest.messages.at(-1).content, /贝叶斯定理/)
    assert.doesNotMatch(generalRequest.messages.at(-1).content, /\[\[PAGE:/)
    const followUpResponse = await fetch(`http://127.0.0.1:${raid.port}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiConfig,
        action: 'custom',
        instruction: '那它在医学检测中是什么意思？',
        contextMode: 'general',
        includeContext: false,
        history: [
          { role: 'user', content: '用一个例子解释什么是贝叶斯定理', status: 'completed', contextSnapshot: { mode: 'document', sourceNames: ['概率教材.pdf'], anchorPages: [12], attachmentNames: [] } },
          { role: 'assistant', content: '贝叶斯定理用于根据新证据更新概率。' },
          { role: 'assistant', content: '⚠️ 已停止生成。', status: 'stopped' },
        ],
        responseLanguage: '简体中文',
      }),
    })
    assert.equal(followUpResponse.ok, true)
    await followUpResponse.json()
    const followUpRequest = requestBodies.at(-1)
    assert.deepEqual(followUpRequest.messages.slice(1, -1), [
      { role: 'user', content: '【该轮资料范围】全文；来源：概率教材.pdf；页码：12\n用一个例子解释什么是贝叶斯定理' },
      { role: 'assistant', content: '贝叶斯定理用于根据新证据更新概率。' },
    ])
    assert.match(followUpRequest.messages.at(-1).content, /医学检测/)
    const longDocument = `[第 1 页]\n${'普通背景材料。'.repeat(4500)}\n光合作用暗反应依靠卡尔文循环固定二氧化碳，关键标记是 RUBISCO-ANCHOR。\n${'其他背景材料。'.repeat(4500)}`
    const retrievalFollowUpResponse = await fetch(`http://127.0.0.1:${raid.port}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiConfig,
        action: 'custom',
        instruction: '为什么？',
        documentText: longDocument,
        contextMode: 'document',
        includeContext: true,
        history: [
          { role: 'user', content: '光合作用暗反应是怎样固定二氧化碳的？', status: 'completed' },
          { role: 'assistant', content: '它通过卡尔文循环完成。', status: 'completed' },
        ],
        responseLanguage: '简体中文',
      }),
    })
    assert.equal(retrievalFollowUpResponse.ok, true)
    await retrievalFollowUpResponse.json()
    assert.match(requestBodies.at(-1).messages.at(-1).content, /RUBISCO-ANCHOR/)
    const notebookResponse = await fetch(`http://127.0.0.1:${raid.port}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiConfig,
        action: 'custom',
        instruction: '比较两份教材',
        documentText: '【来源：教材上册.pdf】\n[第 2 页]\n上册材料\n\n【来源：教材下册.pdf】\n[第 2 页]\n下册材料',
        contextMode: 'notebook',
        includeContext: true,
        responseLanguage: '简体中文',
      }),
    })
    const notebookAnswer = await notebookResponse.json()
    assert.equal(notebookResponse.ok, true)
    assert.match(notebookAnswer.content, /\[\[SOURCE:教材(上|下)册\.pdf\|2\]\]/)
    const attachmentResponse = await fetch(`http://127.0.0.1:${raid.port}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiConfig,
        action: 'custom',
        instruction: '附件里的验证码是什么？',
        conversationAttachmentText: '【本次对话临时附件：临时资料.txt】\n[第 1 页]\n验证码 7319',
        conversationAttachmentNames: ['临时资料.txt'],
        responseLanguage: '简体中文',
      }),
    })
    assert.equal(attachmentResponse.ok, true)
    await attachmentResponse.json()
    const attachmentPrompt = requestBodies.at(-1).messages.at(-1).content
    assert.match(attachmentPrompt, /本次对话附件材料/)
    assert.match(attachmentPrompt, /验证码 7319/)
    assert.match(attachmentPrompt, /不要把对话附件称为项目来源/)
    assert.deepEqual(requests, ['/v1/models', '/v1/models', '/v1/chat/completions', '/v1/chat/completions', '/v1/chat/completions', '/v1/chat/completions', '/v1/chat/completions', '/v1/chat/completions'])
  } finally {
    await close(raid.server)
    await close(upstream)
  }
})
