/**
 * 协作点（10-26，要求账协 1–协 5）：不加第四种模式。solo 固定；build、spark 各有一套协作预设，开头问用户行不行，
 * 不行就照他说的按块标：helm 用 divide 的 collab 记这一阶段用户要的协作，每块的 with_user 记这一块在哪儿和用户协作。
 * 这里放三样：页上接的事实（`协作点页`、`协作预设段`）、divide 里的核对（`验协作点`）、这一点用户是不是点名要在（`点名要用户`）。
 */
import { 一段, 选的模式Of, 运行模式Of } from '../../prompt/src/index.js'
import { 行Of, 首节点, 节点类型, 协作点们, 协作点说法, 块协作点们, 新阶段待开 } from '../../roster/src/index.js'

/** build、spark 的协作预设（协 1）：helm 在 build 下定向时、spark 开头那条消息里给。 */
export const 协作预设段 = 模式 => 一段(`重置/协作点/${模式}预设`)

/** 这一阶段用户选的模式：spark 交完以后照旧认 spark，只有用户自己选的 solo 才是 solo。 */
export const 选的模式 = 名册 => { const 首 = 行Of(名册, 首节点); return 选的模式Of(首?.task, 首?.stageMode)?.id || '' }

/**
 * 界面上那张表（协 7）：谁（总制作人、各部分）× 在哪儿参与（开头、计划、验收），外加过程中要拿主意时问不问。
 * 四个预设一点就填满整张表；建项目、新建阶段选的 solo、build 各对上一个，spark 之后同「全交给你们」。
 * ask：问我＝stageMode build；自己判断＝solo（spark 交完的阶段记着 spark，照样算自己判断）。
 */
export const 面板点们 = Object.freeze(['talk', 'plan', 'accept'])
export const 预设们 = Object.freeze({
  solo: Object.freeze({ helm: [], parts: [], ask: 'self' }),
  accept: Object.freeze({ helm: ['accept'], parts: [], ask: 'self' }),
  build: Object.freeze({ helm: ['talk', 'plan', 'accept'], parts: [], ask: 'ask' }),
  deep: Object.freeze({ helm: ['talk', 'plan', 'accept'], parts: ['plan', 'accept'], ask: 'ask' }),
})

/** helm 自己的协作点：用户在界面上改过、或 helm 照用户的话记过，就照记的；没记过照这一阶段选的方式，build 是开头、计划、收口三处，solo、spark 不找用户。 */
export function helm协作点(名册) {
  const 首 = 行Of(名册, 首节点)
  if (Array.isArray(首?.withUser)) return [...首.withUser]
  return 运行模式Of(首?.task, 首?.stageMode)?.id === 'build' ? [...预设们.build.helm] : []
}

/** 这一行此刻的协作点：helm 看 `helm协作点`，dock 是它自己的加上各部分的默认（用户单独点过的只认它自己的），run 没有。 */
export const 协作点Of = (名册, 行) => !行 ? [] : 节点类型(行) === 'helm' ? helm协作点(名册) : 节点类型(行) === 'dock' ? 块协作点们(名册, 行) : []

/**
 * 每一步摆给 helm、dock 的那一段（协 7）：用户此刻在表上勾着什么。他随时可能在界面上改，这一段跟着协作背景每一步重摆，是最新的。
 * helm 看自己这一层和每一个部分；dock 只看自己这一块；run、spark 没有。
 */
export function 协作现状文(名册, 行) {
  const 说 = 点们 => 点们.length ? 点们.map(点 => 协作点说法[点]).join('、') : '不找用户'
  if (节点类型(行) === 'helm') return [`- helm 这一层：${说(helm协作点(名册))}`, `- 每一个部分：${说(行Of(名册, 首节点)?.partsWithUser || [])}`].join('\n')
  if (节点类型(行) === 'dock') return `- 你这一块：${说(块协作点们(名册, 行))}${行.withUserBy === 'user' ? '（用户在界面上单独定的）' : ''}`
  return ''
}

/** 用户要在这一点参与：表上勾着就停下等他，不看这一阶段问不问（协 3、协 7）。 */
export const 点名要用户 = (名册, 行, 点) => !!点 && 协作点Of(名册, 行).includes(点)

/**
 * 页后接的事实（协 4）：helm 在 build 下定向（新建阶段直接进 plan 的，在 plan）接协作预设；
 * 标了协作点的 dock：talk、spark 在定向和 plan 接（定向被跳过也看得到），plan 在 plan 接，accept 在 complete 接；
 * dock 进 plan，helm 记了这一阶段用户要的协作，就接上，让它照着给自己派的块标。
 * 表上勾着就接（协 7）：「过程中问不问」不管协作点，用户在界面上关掉的那一点下一步就不接了。
 */
export function 协作点页(名册, 行, stage) {
  const 类型 = 节点类型(行), 页 = []
  if (类型 === 'helm' && 选的模式(名册) === 'build' && (stage === 'orient' || stage === 'plan' && 新阶段待开(名册, 行.id))) 页.push(协作预设段('build'))
  if (类型 !== 'dock') return 页
  const 点们 = 协作点Of(名册, 行)
  if (['orient', 'plan'].includes(stage)) {
    if (点们.includes('talk')) 页.push(一段('重置/协作点/谈'))
    if (点们.includes('spark')) 页.push(一段('重置/协作点/想清楚'))
  }
  if (stage === 'plan') {
    if (点们.includes('plan')) 页.push(一段('重置/协作点/审方案'))
    const collab = 行Of(名册, 首节点)?.collab?.trim()
    if (collab) 页.push(一段('重置/协作点/往下分', { collab }))
  }
  if (stage === 'complete' && 点们.includes('accept')) 页.push(一段('重置/协作点/验收'))
  return 页
}

/** divide 一块的 with_user（协 2）：一组协作点、每样一次；只给 dock；talk 和 spark 选一个。用户在界面上单独点过的块，派出时不改（协 7，`组织设计`）。 */
export function 验协作点(名册, b, role) {
  if (b.with_user === undefined) return
  const 名 = b.name || b.key || b.id
  if (!Array.isArray(b.with_user) || b.with_user.some(点 => !协作点们.includes(点)) || new Set(b.with_user).size !== b.with_user.length)
    throw new Error(`${名}：with_user 是一组协作点，每样写一次：${协作点们.join('、')}`)
  if (!b.with_user.length) return
  if (role !== 'dock') throw new Error(`${名}：with_user 只给 dock；要用户验收 run 做的，标在它上面那个 dock 上`)
  if (b.with_user.includes('talk') && b.with_user.includes('spark')) throw new Error(`${名}：talk 和 spark 都是开头和用户谈，选一个`)
}

/** divide 的 collab（协 2）：只给 helm，写这一阶段用户要的协作。 */
export function 验协作要求(名册, 我, collab) {
  if (collab === undefined) return
  if (节点类型(行Of(名册, 我)) !== 'helm') throw new Error('collab 只给 helm：这一阶段用户要的协作由 helm 记；你派的块在哪儿和用户协作，写在那一块的 with_user')
  if (typeof collab !== 'string') throw new Error('collab 写成一段文字：用户说的这一阶段怎么协作，原样')
}

/** divide 的 helm_with_user、parts_with_user（协 7）：只给 helm，照用户的话记界面上那张表的两行。 */
export function 验表上的点(名册, 我, args) {
  const 写了 = ['helm_with_user', 'parts_with_user'].filter(k => args[k] !== undefined)
  if (写了.length && 节点类型(行Of(名册, 我)) !== 'helm')
    throw new Error(`${写了.join('、')} 只给 helm：用户要在哪儿参与由 helm 记；你派的块在哪儿和用户协作，写在那一块的 with_user`)
}
