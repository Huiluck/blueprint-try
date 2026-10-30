/** Read a bounded response and release the body on errors and cancellation. */
export async function readText(response, maxBytes = 4 * 1024 * 1024) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('服务返回了空响应')
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error('服务响应超过大小限制')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  return Buffer.concat(chunks).toString('utf8')
}

export async function readJson(response, maxBytes = 4 * 1024 * 1024) {
  return JSON.parse(await readText(response, maxBytes))
}
