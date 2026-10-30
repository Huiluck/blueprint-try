// 只合并正在执行的删除，磁盘目录仍是项目是否存在的权威。
import { resolve } from 'node:path'
export const 删除中的项目 = new Set()
export const 项目删除中 = root => !!root && 删除中的项目.has(resolve(root))
