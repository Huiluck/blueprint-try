/** 程序资源、应用数据与项目存储的路径入口。 */
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { 创建项目存储 } from './项目存储.js'

export const 仓库根 = fileURLToPath(new URL('../../../..', import.meta.url))
export const 数据根 = resolve(process.env.BLUEPRINT_DATA_HOME || 仓库根)
export const 项目存储 = 创建项目存储({ dataRoot: 数据根, documents: process.env.BLUEPRINT_DOCUMENTS_HOME, protectedRoots: [仓库根] })
export let 项目路径 = 项目存储.snapshot().defaultRoot
项目存储.subscribe(state => { 项目路径 = state.defaultRoot })
export const 项目位置们 = () => 项目存储.roots()
export const 项目父目录 = directory => 项目存储.parentOf(directory)
export const 文字路径 = resolve(process.env.BLUEPRINT_PROMPT_DIR || fileURLToPath(new URL('..', import.meta.url)))
export const 技能路径 = join(文字路径, 'skill')
export const 工具临时目录名 = '.blueprint-tmp'
/** 临时目录里的公共工具夹：节点装的工具放这里、在 目录.md 记一行，别的节点也能用（产 5）。命令里是 $BLUEPRINT_TOOLS。 */
export const 公共工具夹名 = '公共工具'
