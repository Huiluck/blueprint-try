/**
 * 这一阶段过程中问不问用户（10-25 立 solo 开关；10-29 协 7 起界面上换成协作设置，这里只剩「过程中要拿主意时」那一格）。
 * 不另存一份，它就是这一阶段的协作方式：helm 行的 stageMode（没有就看项目原话里的 Mode）。
 * solo（或 spark 交完以后）＝自己判断；build＝问我。下一步起节点看到的协作说明、问不问跟着换；新建阶段选的模式就是初始状态。
 * `读人工审核` 回答「这会儿要不要等人」：自己判断的阶段不等；表上勾着的协作点不归它管，勾着就等（`协作点.js` 的 `点名要用户`）。
 * `读solo`、`写solo` 留给旧调用和测试：写 solo＝界面上点「自己判断」，写 build＝点「问我」（`协作设置.js`）。
 */
import { 读名册, 改名册, 行Of, 首节点 } from '../../roster/src/index.js'
import { 运行模式Of, 选的模式Of } from '../../prompt/src/index.js'

function 这一阶段(m) {
  if (!m?.rows?.length) throw new Error('这个会话不是 Blueprint 项目')
  const 首 = 行Of(m, 首节点)
  return { mode: 运行模式Of(首.task, 首.stageMode)?.id || '', 选的: 选的模式Of(首.task, 首.stageMode)?.id || '' }
}

export async function 读solo(root, roster) {
  return { on: 这一阶段(roster || await 读名册(root)).mode === 'solo' }
}

export async function 读人工审核(root, roster) {
  const { mode, 选的 } = 这一阶段(roster || await 读名册(root))
  return { enabled: mode !== 'solo', mode, solo: 选的 === 'solo' }
}

export function 写solo(root, on) {
  if (typeof on !== 'boolean') throw new Error('solo 开关只能是 true／false')
  return 改名册(root, m => {
    // 已经是这个状态就不动：spark 交完的阶段本来就开着，不把它改写成 solo。
    if ((这一阶段(m).mode === 'solo') === on) return m
    return { ...m, rows: m.rows.map(r => r.id === 首节点 ? { ...r, stageMode: on ? 'solo' : 'build' } : r) }
  }).then(() => 读solo(root))
}
