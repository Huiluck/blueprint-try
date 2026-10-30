import { DOMParser } from '@xmldom/xmldom'
import { WebError } from '@deepseek-ai/dsh-web'
import { readText } from './http.mjs'

export const name = 'blueprint-search'
export const inject = ['web']
const endpoint = 'https://html.duckduckgo.com/html/'
const hasClass = (element, name) => element?.getAttribute?.('class')?.split(/\s+/).includes(name)
const elements = element => Array.from(element.getElementsByTagName('*'))
const text = element => element?.textContent?.replace(/\s+/g, ' ').trim() || ''

function sourceUrl(href) {
  if (!href) return
  try {
    let url = new URL(href, endpoint)
    if (url.hostname === 'duckduckgo.com' && /^\/l\/?$/.test(url.pathname)) {
      const target = url.searchParams.get('uddg')
      if (!target) return
      url = new URL(target)
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || /(^|\.)duckduckgo\.com$/.test(url.hostname)) return
    return url.href
  } catch { return }
}

/** 提取搜索页面的真实结果；验证页、未知页面和无结果是不同的情况。 */
export function parseSearchResults(html, maxResults = 8) {
  if (/id=["'](?:challenge-form|anomaly-form)["']|action=["'][^"']*anomaly\.js/i.test(html)) {
    throw new WebError('搜索服务暂时要求人工验证，请稍后重试。', 'WEB_SEARCH_RATE_LIMITED')
  }
  const document = new DOMParser({ errorHandler: {
    warning: () => {}, error: () => {}, fatalError: () => { throw new WebError('搜索页面无法解析。', 'WEB_PROVIDER_ERROR') },
  } }).parseFromString(html, 'text/html')
  const seen = new Set(), sources = []
  for (const anchor of Array.from(document.getElementsByTagName('a'))) {
    if (!hasClass(anchor, 'result__a')) continue
    let result = anchor.parentNode
    while (result && !hasClass(result, 'result')) result = result.parentNode
    if (!result || hasClass(result, 'result--ad')) continue
    const url = sourceUrl(anchor.getAttribute('href'))
    if (!url || seen.has(url)) continue
    seen.add(url)
    const title = text(anchor).slice(0, 1000)
    const snippet = text(elements(result).find(element => hasClass(element, 'result__snippet'))).slice(0, 4000)
    sources.push({ url, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}) })
  }
  if (!sources.length && !elements(document).some(element => hasClass(element, 'no-results'))) {
    throw new WebError('搜索服务没有返回可识别的网页结果，请稍后重试。', 'WEB_PROVIDER_ERROR')
  }
  return { sources: sources.slice(0, maxResults), truncated: sources.length > maxResults,
    content: sources.length ? '搜索来源：DuckDuckGo' : 'DuckDuckGo 未找到相关网页。' }
}

/** 所有模型共用同一搜索后台，不读取模型、连接或 API Key。 */
export function createSearchProvider({ fetcher = globalThis.fetch, timeoutMs = 30000 } = {}) {
  return { id: 'blueprint-search', available: () => true, async search(request, signal) {
    if (signal?.aborted) throw new WebError('网页搜索已停止。', 'WEB_ABORTED')
    if (typeof request.query !== 'string' || !request.query.trim()) throw new WebError('搜索词不能为空。', 'WEB_SEARCH_INVALID_QUERY')
    const url = new URL(endpoint)
    url.searchParams.set('q', request.query)
    const timeout = AbortSignal.timeout(timeoutMs)
    const operation = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      const response = await fetcher(url.href, { headers: { accept: 'text/html' }, redirect: 'error', signal: operation })
      if (!response.ok) {
        await response.body?.cancel()
        throw new WebError(`搜索服务返回 HTTP ${response.status}，请稍后重试。`, response.status === 429 ? 'WEB_SEARCH_RATE_LIMITED' : 'WEB_PROVIDER_ERROR')
      }
      const html = await readText(response, 2 * 1024 * 1024)
      operation.throwIfAborted()
      return parseSearchResults(html, request.maxResults)
    } catch (cause) {
      if (signal?.aborted) throw new WebError('网页搜索已停止。', 'WEB_ABORTED', { cause })
      if (timeout.aborted) throw new WebError('网页搜索超时，请稍后重试。', 'WEB_SEARCH_TIMEOUT', { cause })
      if (cause instanceof WebError) throw cause
      throw new WebError('网页搜索请求失败，请检查网络后重试。', 'WEB_PROVIDER_ERROR', { cause })
    }
  } }
}

export function apply(ctx) {
  ctx.web.registerSearchProvider(createSearchProvider())
}
