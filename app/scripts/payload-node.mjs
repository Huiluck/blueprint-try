import { join } from 'node:path'

/** 运行包里的内置 Node：Windows 是 node.exe，macOS 是无扩展名的 node。 */
export const payloadNode = payload => join(payload, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
