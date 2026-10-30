import test from 'node:test'
import assert from 'node:assert/strict'
import { createFetchProvider } from '../runtime/fetch.mjs'

const limits = { timeoutMs: 30000, maxResponseBytes: 5000000, maxBodyChars: 100000, maxRedirects: 5, userAgent: 'blueprint-test' }
const signal = () => new AbortController().signal
const address = value => [{ address: value, family: 4 }]

test('代理 Fake-IP 通过公网 DNS 获取真实地址，仍交给原生公网校验', async () => {
  const calls = []
  const provider = createFetchProvider(limits, {
    resolver: async () => address('198.18.1.246'),
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init })
      return Response.json({ Status: 0, Answer: [{ type: 5, data: 'example.org' }, { type: 1, data: '93.184.215.14' }] })
    },
  })
  const abort = signal()
  assert.deepEqual(await provider.resolveAddresses('example.org', abort), address('93.184.215.14'))
  assert.equal(calls.length, 1)
  assert.equal(new URL(calls[0].url).searchParams.get('name'), 'example.org')
  assert.equal(calls[0].init.signal, abort)
  assert.equal(calls[0].init.redirect, 'error')
})

test('真实公网解析保持原路径，真实内网和混合解析不能触发 Fake-IP 兼容', async () => {
  let queries = 0
  for (const answers of [address('93.184.215.14'), address('10.0.0.1'), [...address('198.18.1.1'), ...address('127.0.0.1')]]) {
    const provider = createFetchProvider(limits, { resolver: async () => answers, fetcher: async () => { queries++; throw new Error('不应请求') } })
    if (answers[0].address === '93.184.215.14') assert.deepEqual(await provider.resolveAddresses('example.org', signal()), answers)
    else await assert.rejects(provider.resolveAddresses('example.org', signal()), { code: 'WEB_BLOCKED_URL' })
  }
  assert.equal(queries, 0)
})

test('公网 DNS 的内网结果和无地址结果仍被拦截，不直接放行代理地址', async () => {
  for (const [Answer, code] of [[[{ type: 1, data: '127.0.0.1' }], 'WEB_BLOCKED_URL'], [[], 'WEB_PROVIDER_ERROR']]) {
    const provider = createFetchProvider(limits, { resolver: async () => address('198.19.0.1'), fetcher: async () => Response.json({ Status: 0, Answer }) })
    await assert.rejects(provider.resolveAddresses('example.org', signal()), { code })
  }
})

test('直接写入内网或 Fake-IP 字面地址不能使用公共 DNS 兜底', async () => {
  let queries = 0
  const provider = createFetchProvider(limits, { resolver: async () => [], fetcher: async () => { queries++; throw new Error('不应请求') } })
  for (const host of ['127.0.0.1', '198.18.1.1', '[::1]']) await assert.rejects(provider.resolveAddresses(host, signal()), { code: 'WEB_BLOCKED_URL' })
  assert.equal(queries, 0)
})

test('公网 DNS 失败、截断和超大响应不会变成有效解析', async () => {
  for (const response of [new Response('error', { status: 503 }), Response.json({ Status: 3 }), Response.json({ Status: 0, TC: true }), new Response('x'.repeat(65537))]) {
    const provider = createFetchProvider(limits, { resolver: async () => address('198.18.1.1'), fetcher: async () => response })
    await assert.rejects(provider.resolveAddresses('example.org', signal()))
  }
})

test('等待 DNS 时停止会立即取消，不继续联网', async () => {
  const controller = new AbortController()
  const provider = createFetchProvider(limits, { resolver: () => new Promise(() => {}) })
  const pending = provider.resolveAddresses('example.org', controller.signal)
  controller.abort()
  await assert.rejects(pending, /aborted/)
})
