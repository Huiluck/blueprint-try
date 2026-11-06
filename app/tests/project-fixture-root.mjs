// 原生测试使用已知的旧版临时项目位置，避免写入真实用户的文稿目录。
// BLUEPRINT_DATA_HOME 由 scripts/test-runner.mjs 指到当前用户的临时目录：
// Windows 的 ACL 沙箱要求调用者拥有工作区，仓库副本可能属于管理员。
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { 数据根 } from '../../blueprint/packages/prompt/src/路径.js'
export const fixtureProjectRoot = join(数据根, '项目')
await mkdir(fixtureProjectRoot, { recursive: true })
