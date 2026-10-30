import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Config, HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import { WebError } from '@deepseek-ai/dsh-web'
import { readJson } from './http.mjs'

export { Config }
export const name = 'blueprint-fetch'
export const inject = ['web']

// TUN 代理的 Fake-IP 是路由标记，不能直接当作公网目的地址放行。
const fakeIp = entry => entry.family === 4 && isIP(entry.address) === 4
  && /^198\.(18|19)\./.test(entry.address)

async function publicDns(hostname, signal, fetcher) {
  const url = new URL('https://cloudflare-dns.com/dns-query')
  url.searchParams.set('name', hostname)
  url.searchParams.set('type', 'A')
  const response = await fetcher(url, { headers: { accept: 'application/dns-json' }, redirect: 'error', signal })
  if (!response.ok) throw new WebError(`公网域名解析失败（HTTP ${response.status}）`, 'WEB_PROVIDER_ERROR')
  const data = await readJson(response, 65536)
  if (data.Status !== 0 || data.TC) throw new WebError(`公网域名解析失败（DNS ${data.Status}）`, 'WEB_PROVIDER_ERROR')
  return (data.Answer || []).filter(record => record.type === 1).map(record => ({ address: record.data, family: 4 }))
}

/** 只替换 Fake-IP 解析；目的地址校验、固定 IP 连接、重定向、超时和正文限制仍由 dsh 执行。 */
export function createFetchProvider(limits, { resolver = lookup, fetcher = globalThis.fetch } = {}) {
  const provider = new HttpFetchProvider(limits)
  const resolvePublic = provider.resolveAddresses
  provider.resolveAddresses = (hostname, signal) => resolvePublic(hostname, signal, async (host, options) => {
    const addresses = await resolver(host, options)
    return addresses.length && addresses.every(fakeIp) ? publicDns(host, signal, fetcher) : addresses
  })
  return provider
}

export function apply(ctx, config) {
  ctx.web.registerFetchProvider(createFetchProvider(config))
}
