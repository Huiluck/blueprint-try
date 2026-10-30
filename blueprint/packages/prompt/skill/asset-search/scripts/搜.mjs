#!/usr/bin/env node
// 旧脚本路径兼容；素材入口与实现均在 resource-reuse。
import { 运行 } from '../../resource-reuse/scripts/搜.mjs'
运行(process.argv.slice(2), { 默认类型: ['2d', '3d', 'texture', 'hdri', 'icon', 'photo', 'illustration', 'artwork'] })
  .catch(error => { console.error(error.message); process.exitCode = 1 })
