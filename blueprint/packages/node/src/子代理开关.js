/** 节点能不能把一件活整个交给 Codex／Claude Code、交给它时用哪个模型几档思考、三家各自什么时候优先用（选择偏好）：每个项目一份（用户 10-17 定），
 * 新建项目复制上次保存的默认选择；项目内保存 Agent 选择时也更新新建默认，其他已有项目保持自己的快照。登录是本机共用的，不在这里。
 * 文件不在＝这个项目还没设过，两家都关着、DSH 开着；已有项目不随新建默认变化。
 * 三家至少开一家（10-18 用户定）：DSH 只在有一家外部开着时能关；把最后一家外部关了，DSH 跟着打开。工具目录每步都读，按修改时间缓存；拨了、改了下一步起生效，不用重起。
 * 交给它们的活由外部 run 自己当那个 run（叶 6，`外部run.js`），不再有给节点直接调的工具。 */
import { readFileSync, statSync } from 'node:fs'
import { writeFile, rename, unlink, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { 文档夹名 } from '../../roster/src/index.js'

export const 默认子代理开关 = Object.freeze({ dsh: true, codex: false, claudeCode: false })
/** 外部两家的开关名。 */
const 外部开关们 = ['codex', 'claudeCode']
/** DSH 关着只在有外部开着时成立：外部都关着，就当开着（文件里写的 false 不算）。 */
const 规范开关 = raw => ({ dsh: raw.dsh !== false || 外部开关们.every(key => !raw[key]), codex: raw.codex, claudeCode: raw.claudeCode })
/** 空字符串＝不指定。Codex 不跟随本机设置（外部 run 带 --ignore-user-config）。10-17 时随包的 0.153.4 用 ChatGPT 账号请求新版模型会被拒；10-18 起随包升到 0.163.0，新模型可选，
 * 默认仍是实测能跑的 GPT-6-Astra 和它自带的 medium；Claude Code 默认跟账号走。 */
export const 默认子代理模型 = Object.freeze({
  codex: Object.freeze({ model: 'gpt-6-astra', effort: 'medium' }),
  claudeCode: Object.freeze({ model: '', effort: '' }),
})
/** 选择偏好（2026-10-18 用户定）：三家各一段「什么时候优先用它」，派活的节点在 agent 模式那段里照着挑。dsh＝Blueprint 自己的节点（DeepSeek）。
 * 默认照用户原话填；用户清空了就是空的，不再补回默认。 */
export const 默认选择偏好 = Object.freeze({
  dsh: '一般任务',
  codex: '前端、2D、3D、图片、视觉处理和视觉检查。',
  claudeCode: '复杂问题、品味、设计。',
})
const 偏好上限 = 500
/** 项目根 → 这个项目的设置文件。 */
export const 子代理开关路径 = 根 => join(根, 文档夹名, '子代理.json')

// 模型名和档位会接进启动参数：只收字母、数字和 . _ : - 。
const 安全名 = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const 规范一家 = (raw, 默认) => {
  const 取 = key => typeof raw?.[key] === 'string' && (raw[key] === '' || 安全名.test(raw[key])) ? raw[key] : 默认[key]
  return { model: 取('model'), effort: 取('effort') }
}
const 规范模型 = raw => Object.fromEntries(Object.keys(默认子代理模型).map(key => [key, 规范一家(raw?.[key], 默认子代理模型[key])]))
const 规范偏好 = raw => Object.fromEntries(Object.keys(默认选择偏好).map(key => [key,
  typeof raw?.[key] === 'string' ? raw[key].trim().slice(0, 偏好上限) : 默认选择偏好[key]]))
const 默认值 = () => ({ 开关: { ...默认子代理开关 }, 模型: 规范模型(), 偏好: 规范偏好(), 设过: false })

const 缓存 = new Map()
/** @returns {{ 开关: { dsh: boolean, codex: boolean, claudeCode: boolean }, 模型: Record<string, { model: string, effort: string }>, 偏好: Record<'dsh'|'codex'|'claudeCode', string>, 设过: boolean, 错?: string }} */
export function 读子代理开关(根) {
  if (!根) return 默认值()
  const path = 子代理开关路径(根)
  let stamp
  try { const s = statSync(path); stamp = `${s.ino}:${s.mtimeMs}:${s.size}` }
  catch (error) { if (error.code !== 'ENOENT') throw error; return 默认值() }
  const old = 缓存.get(path)
  if (old?.stamp === stamp) return old.value
  let value
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!raw || typeof raw !== 'object' || 外部开关们.some(key => typeof raw[key] !== 'boolean') || (raw.dsh !== undefined && typeof raw.dsh !== 'boolean')) throw new Error('开关只能是 true／false')
    value = { 开关: 规范开关(raw), 模型: 规范模型(raw.models), 偏好: 规范偏好(raw.prefs), 设过: true }
  } catch (error) {
    // 读不懂就按都关着算，页上照实显示原因，免得一份坏文件让工具悄悄露出来。
    value = { ...默认值(), 设过: true, 错: `子代理.json 读不懂：${error.message}` }
  }
  缓存.set(path, { stamp, value })
  return value
}

async function 写入(根, 改) {
  if (!根) throw new Error('没有指定项目')
  await mkdir(dirname(子代理开关路径(根)), { recursive: true })
  const now = 读子代理开关(根), next = 改({ ...now.开关, models: structuredClone(now.模型), prefs: { ...now.偏好 } })
  const path = 子代理开关路径(根), temporary = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, path) }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  return 读子代理开关(根)
}

export async function 写子代理开关(key, on, 根) {
  if (!Object.hasOwn(默认子代理开关, key) || typeof on !== 'boolean') throw new Error('没有这个开关')
  if (key === 'dsh' && !on && 外部开关们.every(k => !读子代理开关(根).开关[k])) throw new Error('Codex、Claude Code 都关着时，DSH agent 不能关')
  // 关掉最后一家外部：DSH 跟着打开，写进文件，免得以后再开一家外部时它悄悄又关着。
  return 写入(根, value => { const next = { ...value, [key]: on }; return { ...next, dsh: 规范开关(next).dsh } })
}

/** 改一家的选择偏好：dsh／codex／claudeCode，一段话，最多 500 字。 */
export async function 写选择偏好(key, text, 根) {
  if (!Object.hasOwn(默认选择偏好, key)) throw new Error('没有这家 Agent')
  if (typeof text !== 'string') throw new Error('选择偏好只能是一段文字')
  if (text.trim().length > 偏好上限) throw new Error(`选择偏好最多 ${偏好上限} 字`)
  return 写入(根, value => ({ ...value, prefs: { ...value.prefs, [key]: text.trim() } }))
}

/** 改一家的模型和思考程度；空字符串＝不指定。 */
export async function 写子代理模型(key, { model = '', effort = '' } = {}, 根) {
  if (!Object.hasOwn(默认子代理模型, key)) throw new Error('没有这家 Agent')
  for (const [名, 值] of [['模型', model], ['思考程度', effort]]) {
    if (typeof 值 !== 'string' || (值 !== '' && !安全名.test(值))) throw new Error(`${名}名字不对：只能用字母、数字和 . _ : -`)
  }
  return 写入(根, value => ({ ...value, models: { ...value.models, [key]: { model, effort } } }))
}

/** 启动官方程序时要接上的参数：Codex 用 -c 指定模型和思考程度，Claude Code 用 --model／--effort。 */
export function 启动参数Of(key, { model = '', effort = '' } = {}) {
  if (key === 'codex') return [...(model ? ['-c', `model="${model}"`] : []), ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : [])]
  if (key === 'claudeCode') return [...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])]
  return []
}
export const 子代理启动参数 = (key, 根) => 启动参数Of(key, 读子代理开关(根).模型[key])

/** 新建项目表单交来的整份设置：先验，验不过整份退回，不建一半。 */
export function 验子代理设置(raw = {}) {
  const 开关 = { ...默认子代理开关 }, 模型 = 规范模型(), 偏好 = 规范偏好()
  for (const key of Object.keys(默认子代理开关)) {
    const on = raw?.开关?.[key]
    if (on !== undefined && typeof on !== 'boolean') throw new Error('Agent 开关只能是开或关')
    if (on !== undefined) 开关[key] = on
  }
  开关.dsh = 规范开关(开关).dsh
  for (const key of Object.keys(默认子代理模型)) {
    const 选 = raw?.模型?.[key]
    if (选 === undefined) continue
    for (const [名, 值] of [['模型', 选.model ?? ''], ['思考程度', 选.effort ?? '']]) {
      if (typeof 值 !== 'string' || (值 !== '' && !安全名.test(值))) throw new Error(`${名}名字不对：只能用字母、数字和 . _ : -`)
    }
    模型[key] = { model: 选.model ?? '', effort: 选.effort ?? '' }
  }
  for (const key of Object.keys(默认选择偏好)) {
    const 文 = raw?.偏好?.[key]
    if (文 === undefined) continue
    if (typeof 文 !== 'string' || 文.trim().length > 偏好上限) throw new Error(`选择偏好只能是一段文字，最多 ${偏好上限} 字`)
    偏好[key] = 文.trim()
  }
  return { 开关, 模型, 偏好 }
}
export async function 写子代理设置(根, 设置) {
  const { 开关, 模型, 偏好 } = 验子代理设置(设置)
  return 写入(根, () => ({ ...开关, models: 模型, prefs: 偏好 }))
}

/** run 的执行者：分工块里写的名字 → 开关、显示名（短名给砖顶栏）。不写＝DeepSeek 自己做。 */
export const 执行者们 = Object.freeze({
  codex: Object.freeze({ 开关: 'codex', 名字: 'Codex', 短名: 'Codex' }),
  claude_code: Object.freeze({ 开关: 'claudeCode', 名字: 'Claude Code', 短名: 'Claude' }),
})
/** 分工块里写这个，表示交给 DeepSeek：新开的 run 不写也一样；改写已有的 run 时用它换回 DeepSeek（D2）。 */
export const DeepSeek执行者 = 'deepseek'
/** DSH（DeepSeek）此刻做不做 run：关着时 run 只交给打开了的外部几家。 */
export const DeepSeek开着 = 根 => 读子代理开关(根).开关.dsh
/** 用户此刻打开了的执行者，按表里的先后。 */
export const 打开的执行者 = 根 => {
  const { 开关 } = 读子代理开关(根)
  return Object.keys(执行者们).filter(key => 开关[执行者们[key].开关])
}
