// 原生测试使用已知的旧版临时项目位置，避免写入真实用户的文稿目录。
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { 数据根 } from '../../blueprint/packages/prompt/src/路径.js'
export const fixtureProjectRoot = join(数据根, '项目')
await mkdir(fixtureProjectRoot, { recursive: true })
