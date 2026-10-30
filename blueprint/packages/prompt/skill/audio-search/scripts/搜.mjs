#!/usr/bin/env node
// 旧脚本路径与导出兼容；声音入口与实现均在 resource-reuse。
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { 运行, 参数 as 统一参数, 搜索 as 统一搜索, 授权 } from '../../resource-reuse/scripts/搜.mjs'
export { 授权 }
export const 参数 = argv => ({ ...统一参数(argv), 默认类型: ['music', 'sfx'] })
export const 搜索 = options => 统一搜索({ ...options, 默认类型: ['music', 'sfx'] })
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  运行(process.argv.slice(2), { 默认类型: ['music', 'sfx'] })
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
