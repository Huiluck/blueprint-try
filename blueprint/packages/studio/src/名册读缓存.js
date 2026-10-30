import { stat } from 'node:fs/promises'
import { constants } from 'node:os'
import { resolve } from 'node:path'
import { 名册路径, 读名册 } from '../../roster/src/index.js'

const 文件签 = s => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':')
function 固定(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) 固定(child, seen)
  return Object.freeze(value)
}

/** Studio 只读投影共用解析结果；每次查文件签，不复用已变更或删除的名册。 */
export function 创建名册读缓存(读取 = 读名册, { maxSourceBytes = 8 * 1024 * 1024 } = {}) {
  const 缓存 = new Map()
  let 占用 = 0
  function 删除(路径, 预期) {
    const 项 = 缓存.get(路径)
    if (!项 || (预期 && 项 !== 预期)) return
    缓存.delete(路径)
    占用 -= 项.字节
  }
  return async 根 => {
    const 项目根 = resolve(String(根)), 路径 = 名册路径(项目根)
    let 签, 字节
    try {
      const 文件 = await stat(路径, { bigint: true })
      签 = 文件签(文件); 字节 = Number(文件.size)
    }
    catch (error) {
      删除(路径)
      if (error.code === 'ENOENT') return null
      throw error
    }
    const 旧 = 缓存.get(路径)
    if (旧?.签 === 签) {
      缓存.delete(路径); 缓存.set(路径, 旧)
      return 旧.读
    }
    删除(路径)
    const 项 = { 签, 字节, 读: null }
    项.读 = (async () => {
      const 值 = 固定(await 读取(项目根))
      // 读取途中若文件被替换，这份仍可作为本次快照，但不留给下一次请求。
      let 现签
      try { 现签 = 文件签(await stat(路径, { bigint: true })) }
      catch (error) {
        删除(路径, 项)
        if (error.code === 'ENOENT') return null
        throw error
      }
      if (现签 !== 签) 删除(路径, 项)
      return 值
    })().catch(error => {
      // 文件内容错误可按签复用；瞬时系统读取错误要允许下一次重试。
      if (Object.hasOwn(constants.errno, error?.code)) 删除(路径, 项)
      throw error
    })
    // 超额文件仍可读取，但不挤掉其他项目的缓存。
    if (字节 <= maxSourceBytes) {
      缓存.set(路径, 项); 占用 += 字节
      while (缓存.size > 128 || 占用 > maxSourceBytes) 删除(缓存.keys().next().value)
    }
    return 项.读
  }
}
