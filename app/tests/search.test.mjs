import test from 'node:test'
import assert from 'node:assert/strict'
import { createSearchProvider, parseSearchResults, apply, inject } from '../runtime/search.mjs'

const result = (href, title = '真实来源', snippet = '网页摘要', extra = '') => `<div class="result web-result ${extra}"><h2><a class="result__a" href="${href}">${title}</a></h2><a class="result__snippet">${snippet}</a></div>`
const page = (...results) => `<!DOCTYPE html><html><body>${results.join('')}</body></html>`
const html = page(result('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.test%2Fpage%3Fa%3D1%26b%3D2&amp;rut=tracking', '标题 &amp; 中文', '片段 <b>加粗</b> &#x27;引用&#x27;'))

test('解析真实来源、解开搜索跳转和 HTML 实体，保留标题与摘要', () => {
  assert.deepEqual(parseSearchResults(html), {
    sources: [{ url: 'https://example.test/page?a=1&b=2', title: '标题 & 中文', snippet: "片段 加粗 '引用'" }], truncated: false, content: '搜索来源：DuckDuckGo',
  })
})

test('去重，排除广告、非法链接、含凭据的地址和搜索站内部链接', () => {
  const response = page(result('https://example.test/page'), result('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.test%2Fpage'),
    result('https://ad.test', '广告', '广告', 'result--ad'), result('javascript:alert(1)'), result('https://secret@example.test'),
    result('/settings'), result('//duckduckgo.com/l/?other=bad'), result('https://duckduckgo.com.evil.test/page'))
  assert.deepEqual(parseSearchResults(response).sources.map(s => s.url), ['https://example.test/page', 'https://duckduckgo.com.evil.test/page'])
})

test('按结果上限截断并明示，正常无结果与未知页面分别处理', () => {
  const limited = parseSearchResults(page(result('https://one.test'), result('https://two.test')), 1)
  assert.equal(limited.sources.length, 1)
  assert.equal(limited.truncated, true)
  assert.deepEqual(parseSearchResults('<html><body><div class="no-results">No results found</div></body></html>').sources, [])
  assert.throws(() => parseSearchResults('<html><body>service unavailable</body></html>'), { code: 'WEB_PROVIDER_ERROR' })
})

test('验证页面明确报错，不当作无结果或伪造来源', () => {
  assert.throws(() => parseSearchResults('<html><body><form id="challenge-form" action="//duckduckgo.com/anomaly.js"></form></body></html>'), { code: 'WEB_SEARCH_RATE_LIMITED' })
})

test('任意模型和无模型会话共用同一后台，不读取模型连接、凭据或会话', async t => {
  const original = globalThis.fetch, calls = []
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(html) }
  let provider
  const ctx = { web: { registerSearchProvider: value => { provider = value } }, get() { throw new Error('不应读取模型或会话服务') },
    get settings() { throw new Error('不应读取模型配置') }, get credentials() { throw new Error('不应读取模型 Key') } }
  apply(ctx)
  assert.deepEqual(inject, ['web'])
  for (const actor of ['MiMo', 'DeepSeek', '新增兼容 API', '无模型会话']) {
    ctx.actor = actor
    const query = '卡牌游戏 & a=1 # 中文'
    assert.equal((await provider.search({ query })).sources.length, 1)
    const request = calls.at(-1)
    assert.equal(new URL(request.url).origin, 'https://html.duckduckgo.com')
    assert.equal(new URL(request.url).searchParams.get('q'), query)
    assert.equal(request.init.body, undefined)
    assert.equal(request.init.headers.authorization, undefined)
    assert.equal(request.init.redirect, 'error')
  }
  assert.equal(provider.id, 'blueprint-search')
})

test('多个项目并行搜索保留各自查询与结果', async () => {
  const provider = createSearchProvider({ fetcher: async url => {
    const query = new URL(url).searchParams.get('q')
    await Promise.resolve()
    return new Response(page(result(`https://${query}.test`, query)))
  } })
  const results = await Promise.all(['one', 'two'].map(query => provider.search({ query })))
  assert.deepEqual(results.map(r => r.sources[0].title), ['one', 'two'])
})

test('HTTP 错误和限流明确报告，不返回有效结果', async () => {
  for (const status of [429, 403, 503]) {
    const provider = createSearchProvider({ fetcher: async () => new Response(html, { status }) })
    await assert.rejects(provider.search({ query: 'test' }), error => error.code === (status === 429 ? 'WEB_SEARCH_RATE_LIMITED' : 'WEB_PROVIDER_ERROR') && error.message.includes(String(status)))
  }
})

test('取消后不发请求，传输途中取消和超时都停止搜索', async () => {
  const before = new AbortController(); before.abort()
  const stopped = createSearchProvider({ fetcher: () => { throw new Error('不应发请求') } })
  await assert.rejects(stopped.search({ query: 'test' }, before.signal), { code: 'WEB_ABORTED' })
  const during = new AbortController()
  const interrupted = createSearchProvider({ fetcher: async (_, init) => { during.abort(); init.signal.throwIfAborted() } })
  await assert.rejects(interrupted.search({ query: 'test' }, during.signal), { code: 'WEB_ABORTED' })
  const expired = createSearchProvider({ timeoutMs: 5, fetcher: (_, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 1000)
    init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason) }, { once: true })
  }) })
  await assert.rejects(expired.search({ query: 'test' }), { code: 'WEB_SEARCH_TIMEOUT' })
})

test('响应大小有限制，超大内容释放传输流且不解析', async () => {
  let released = false
  const provider = createSearchProvider({ fetcher: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)) }, cancel() { released = true },
  })) })
  await assert.rejects(provider.search({ query: 'test' }), { code: 'WEB_PROVIDER_ERROR' })
  assert.equal(released, true)
})

test('空查询不发请求', async () => {
  const provider = createSearchProvider({ fetcher: () => { throw new Error('不应发请求') } })
  await assert.rejects(provider.search({ query: '  ' }), { code: 'WEB_SEARCH_INVALID_QUERY' })
})
