/** 目录沿用原来的有效期；图纸要求新鲜快照，并发调用只扫一次原生目录。 */
export function 创建会话快照读取(read, { ttl = 1500, now = Date.now } = {}) {
  let cached, started = 0, pending
  return function snapshots(fresh = false) {
    if (pending) return pending
    if (!fresh && cached && now() - started < ttl) return Promise.resolve(cached)
    started = now()
    const request = Promise.resolve().then(read)
    pending = request
    request.then(value => { cached = value }, () => { cached = undefined })
      .finally(() => { if (pending === request) pending = undefined })
    return request
  }
}
