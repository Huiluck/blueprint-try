/**
 * divide 是写任务表的那一把（通 17、派 4，10-23；十步重置 10-24；设计页第三版）：阶段、块都是表里的格子。三格——
 * stage：helm 记阶段（不写＝一个阶段）；shared、blocks：写这一批的块——台撑得起的派出（dispatch），其余登记（dispatch:false），不要了的去掉（remove）。
 * 先全部核对，再按 阶段 → 块 的次序写。只写阶段、或者这一份没有派出的块，不送审、不结束环节；
 * 派出了块的照旧：终稿按协作模式审核后执行，plan 那次用户通过了的不再送审（选 35），派出后这个环节结束，孩子交齐由交齐汇总叫醒。
 * 程序留下的约束只有结构本身要的：helm 一次只派一块、是这一阶段的总 dock，上一个总 dock 还在做就不派；外部 agent 只能当 run；
 * 派出的块，台目录要在派出者的分支里；只能改自己的子树；run 交回了不接着用（开新的），子 dock 同一阶段里可以接着用；执行者开着、solo 不问用户这些和环境有关的照旧。
 */
import { isAbsolute, join, relative } from 'node:path'
import { realpath } from 'node:fs/promises'
import { 一段, 有一段, 说明书, 只回一段字 } from '../../prompt/src/index.js'
import { 节点类型, 角色们, 节点档位们, 是part号, 换号, 新阶段待开, 同层分工 } from '../../roster/src/index.js'
import {
  读名册, 改名册, 行Of, 后代们, 孩子们, 派出者Of,
  读节点文档, 读纸条,
  验名字, 称呼, 工作文档路径,
} from '../../roster/src/index.js'
import { 认我 } from './工具.js'
import { 开团队 } from './会话.js'
import { 去掉分支, 收起分支 } from './纸条.js'
import { 保存自主定稿, 验合并, 验审议, 写审议, 排策略执行, 完成执行, 是同稿重提 } from './策略审议.js'
import { 编译组织, 写本次范围, 补齐组织文档, 接着用不了 } from './组织设计.js'
import { 等前置, 等开工孩子 } from '../../roster/src/组织.js'
import { 审核定稿 } from './定稿审核.js'
import { 分工字段, 请求必填, 块格们, 派人格, 接方案, 结构文本, 验块表, 派出, 栏内容, 台的仓库路径 } from './方案.js'
import { 结束阶段 } from './选择机.js'
import { 执行者们, 打开的执行者, DeepSeek执行者, DeepSeek开着 } from './子代理开关.js'
import { 收尾 } from './收尾.js'
import { 登记等待 } from './条件等待.js'
import { 开始等待 } from './持续工作.js'
import { 阶段参数, 验阶段, 写阶段 } from './阶段排期.js'
import { 不在分支里的台, 节点工作目录, 节点分支 } from './节点Git空间.js'
import { 验协作点, 验协作要求, 验表上的点 } from './协作点.js'

const 状态话 = { 待做: '登记着', 开工: '在做', 完成: '已交回', 去掉: '已去掉' }
/** 写错的旧格子：说清现在由什么表达（设计页第八节；第三版第四节）。 */
const 旧格话 = {
  action: '派还是登记由 dispatch 定，新的一块写 key、表上已有的写 id',
  after: '要等别的块先有的，needs 写它的 p 编号；台撑不起的登记着，下一轮再派',
  queued: '只登记不派是 dispatch:false',
  start: '派出登记着的块是写它的 id、dispatch 不写或写 true',
  integrator: '整合是上级自己的第 8 步，不交给座位',
  approach: '已经定下的做法写进 situation',
  to: '座位撤了：helm 每个阶段派一个总 dock，dock 把块派给下级的 dock 或 run，按 role 定',
  purpose: '撤了：要它做的写 what（做什么）',
  part: '改叫 what：做什么，清晰地描述需要它帮忙完成的任务目标',
  includes: '撤了（派 9）：这一块做什么写 what；兄弟各做什么系统会列进同层分工；必须遵从的写 rules',
  excludes: '撤了（派 9）：兄弟各做什么系统会列进同层分工；必须遵从的写 rules',
  expect: '撤了（派 9）：为什么要做、利害有多大、要做到什么程度写进 situation（项目情境）',
  direction: '撤了（派 9）：方向写进 what，给它定好方向',
  ask: '撤了（派 8）：不替下级出要回答的问题；拿不准的写进 situation 当事实',
  tools: '撤了（派 9）：台里的验收工具是什么、能做什么，写在台里',
  collaborators: '有事往上问，不横着找：要别的块补信息，用 note 发求助',
}

/**
 * 无副作用地核对一整份块表，先认权限，避免执行到一半才发现不对的块。根：项目根，用来查这个项目打开了哪些外部执行者；不给就按都没打开算。
 * `重提`：同一份定稿的重提（启动中途失败后照原样再交）：它派的总 dock 已经落在表上，不算「还在做」。
 */
export function 验策略块(名册, 我, blocks, 根, { 重提 = false } = {}) {
  const 表 = 验块表(blocks), 我行 = 行Of(名册, 我)
  const 子树 = new Set(后代们(名册, 我)), 已有 = new Set(), 去掉们 = []
  const 是helm = 节点类型(我行) === 'helm'
  // 用户在「Agent 选择」页关了 DSH（10-18）：新派的 run 要选一家打开的外部，也不能换回 DeepSeek。dock 由 DeepSeek 做，不受这个开关管。
  const 关DeepSeek = 根 && !DeepSeek开着(根), 去选 = () => `用户关了 DeepSeek 做 run，executor 要填打开了的 agent（${打开的执行者(根).join('／')}）`
  function 核对执行者(b, 原, role) {
    if (b.executor === undefined) {
      // 登记时选过的外部 agent，派出这一刻关了：开团队时改回 DeepSeek（DSH 也关着就交给开着的那家，外部run.js 的 关掉的改回）。
      if (role === 'run' && 派出(b) && 关DeepSeek && !原?.executor) throw new Error(去选())
      return
    }
    if (是helm) throw new Error('总 dock 不选执行者：外部 agent 只能当 run')
    if (role === 'dock') throw new Error(`${b.name || b.key || b.id}：外部 agent 只能当 run。role 写 dock 的块由 DeepSeek 做，executor 不写；要交给外部 agent，role 改成 run`)
    if (b.executor !== DeepSeek执行者 && !Object.hasOwn(执行者们, b.executor)) throw new Error(`executor 只能是 ${[...Object.keys(执行者们), DeepSeek执行者].join('／')}；不填由 DeepSeek 做`)
    if (b.executor === DeepSeek执行者 && 关DeepSeek) throw new Error(去选())
    if (b.executor !== DeepSeek执行者 && !打开的执行者(根).includes(b.executor)) throw new Error(`${执行者们[b.executor].名字} 在这个项目里没打开（左窗「Agent 选择」页），现在选不了；${关DeepSeek ? 去选() : 'executor 不填就由 DeepSeek 做'}`)
  }
  const 本份key = new Set(表.filter(b => !b.remove && typeof b.key === 'string').map(b => b.key))
  const 表上p = new Set(名册.rows.filter(r => r.p && r.status !== '去掉').map(r => r.p))
  function 核对依赖(b, 原) {
    if (b.needs === undefined) return
    if (是helm) throw new Error('总 dock 不写 needs：一个阶段只派它一块')
    if (!Array.isArray(b.needs) || b.needs.some(n => typeof n !== 'string' || !n.trim())) throw new Error(`${b.name || b.key || b.id}：needs 是一组 p 编号（或同一份里的 key）`)
    for (const n of b.needs) {
      if (n === b.key || (原?.p && n === 原.p)) throw new Error(`${b.name || b.key || b.id}：needs 里写了它自己`)
      if (!本份key.has(n) && !(是part号(n) && 表上p.has(n))) throw new Error(`${b.name || b.key || b.id}：needs 里的「${n}」不是表上的块，也不是这一份里的 key`)
    }
  }
  let 派的 = 0
  for (const b of 表) {
    const 多的 = Object.keys(b).filter(k => !块格们.includes(k))
    if (多的.length) throw new Error(`blocks 每一项的格子是 ${块格们.join('、')}；${多的.join('、')} 不在里面${多的.filter(k => 旧格话[k]).map(k => `（${k}：${旧格话[k]}）`).join('')}`)
    for (const k of ['bench', 'executor', 'role', 'level', ...分工字段]) if (b[k] !== undefined && typeof b[k] !== 'string') throw new Error(`${k} 是一段文字`)
    if (b.level !== undefined && !节点档位们.includes(b.level)) throw new Error(`level 是 ${节点档位们.join('、')} 之一：这一块的工作等级`)
    for (const k of ['dispatch', 'remove']) if (b[k] !== undefined && typeof b[k] !== 'boolean') throw new Error(`${k} 是 true 或 false`)
    if (b.role !== undefined && !角色们.includes(b.role)) throw new Error(`role 是 ${角色们.join(' 或 ')}：里面还有几个整体的 dock，一个整体的 run`)
    if ((b.key === undefined) === (b.id === undefined)) throw new Error(`${b.name || '有一块'}：key 和 id 写一个——key 是新的一块，id 是表上已有的一块`)
    if (b.id !== undefined && !名册.rows.some(r => r.id === String(b.id))) throw new Error(`表上没有 ${b.id}：id 写你名下已有的一块，${孩子们(名册, 我).map(n => 行Of(名册, n)).filter(r => r.status !== '去掉').map(r => r.p ? `${r.id}（${r.p}）` : r.id).join('、') || '你名下还没有块'}；新的一块写 key`)
    const 原 = b.id !== undefined ? 行Of(名册, b.id) : null
    if (原) {
      if (!子树.has(原.id)) throw new Error(`${原.id} 不在你派出的块里：只能改自己的子树`)
      if (已有.has(原.id)) throw new Error(`${原.id} 在这一份里出现了两次`)
      已有.add(原.id)
    }
    if (b.remove) {
      if (!原) throw new Error(`${b.name || b.key}：remove 去掉的是表上已有的块，写它的 id`)
      if (原.status === '去掉') throw new Error(`${原.id} 已经去掉了`)
      // 新建阶段时上一任由系统收起（十 61，10-26）：remove 会把整枝作废、图纸上不见了，上一阶段要留着看。
      if (是helm && 新阶段待开(名册, 我)) throw new Error(`用户新建了阶段：上一任 ${原.id} 不用 remove。派出新的总 dock 时，系统把它那一枝收起——没交回的停下，交回过的照旧，图纸上留着，文件和分支都在。blocks 里只写新的总 dock`)
      去掉们.push(原.id)
      continue
    }
    // 用户从「新建阶段」进来（十 61）：要的是一个全新的总 dock，不接着用上一阶段的。
    if (是helm && 原 && 新阶段待开(名册, 我)) throw new Error(`用户新建了阶段，要开一个全新的总 dock：blocks 写新的 key，不写 ${原.id} 接着用。用户要接着改上一阶段的，会直接跟它说，或者不走新建阶段跟你说`)
    if (!原 || b.name !== undefined) 验名字(b.name)
    if (原 && 原.parent !== String(我)) throw new Error(`${原.id} 是 ${原.parent} 派的块`)
    if (原 && ['开工', '去掉'].includes(原.status)) throw new Error(`${原.id} 现在${状态话[原.status]}：id 写的是登记着的块，或同一阶段里交回过的子 dock`)
    if (原?.status === '完成') { const 话 = 接着用不了(名册, 我, 原); if (话) throw new Error(话) }
    if (原?.status === '完成' && !派出(b)) throw new Error(`${原.id} 已经交回：接着用它就是派出（dispatch 不写或写 true），不能改回登记`)
    if (是helm) {
      // helm 是问题解决机：一个阶段派一块，就是这一阶段的总 dock（设计页第三版第二节）。
      if (!派出(b)) throw new Error('helm 不登记块：一个阶段用 divide 派一块，就是这一阶段的总 dock')
      if (b.role !== undefined && b.role !== 'dock') throw new Error('helm 派的是这一阶段的总 dock：role 写 dock')
      if (b.bench !== undefined && b.bench.trim()) throw new Error('总 dock 的空间是整份成品，不放台：bench 不写')
    } else if (!原 && b.role === undefined) throw new Error(`${b.name}：role 写 dock 或 run——里面还有几个整体、要再分的派 dock，一个整体的派 run`)
    const role = 是helm ? 'dock' : b.role ?? 原?.role ?? 'run'
    核对依赖(b, 原)
    验协作点(名册, b, role)
    if (!派出(b)) {
      if (!原 && !b.what?.trim()) throw new Error(`登记「${b.name}」：what 写一句做什么`)
      核对执行者(b, 原, role)
      continue
    }
    派的++
    for (const k of [...请求必填, 'level']) {
      const v = b[k] ?? (k === 'name' ? 原?.name : k === 'what' ? 原?.goal : k === 'level' ? 原?.level : undefined)
      if (typeof v !== 'string' || !v.trim()) throw new Error(`派出的块要写 ${k}${原?.status === '待做' ? `（${原.id} 登记时只记了 name、role 和 what）` : ''}`)
    }
    if (!是helm) 台的仓库路径(我行, b.bench)
    核对执行者(b, 原, role)
  }
  for (const id of 去掉们) if (后代们(名册, id).some(n => 已有.has(n))) throw new Error(`去掉的 ${id} 下面的块，这一份里又写了`)
  if (是helm) {
    if (派的 > 1) throw new Error('helm 一次只派一块：这一阶段的总 dock。阶段里的块由总 dock 去分')
    const 在做 = 孩子们(名册, 我).map(n => 行Of(名册, n)).filter(r => r.status === '开工' && !去掉们.includes(r.id))
    // 新建阶段：上一任还在做的，派出时由系统收起（执行派人），不拦。
    if (派的 && 在做.length && !重提 && !新阶段待开(名册, 我)) throw new Error(`这一阶段的总 dock ${在做.map(r => `${r.id}「${r.name}」`).join('、')}还在做：等它交回再派；方向变了，写纸条告诉它，或者在这一份里 remove 它`)
  }
}

/**
 * 交给孩子的请求（10-27，派 9）：helm 和 dock 都用同一套六项——做什么、之间的联系、项目情境、工作等级、同层分工、必要规则；开头一行是台。
 * 执行节点并成一份请求页时用那一份，还分着时 dock、run 各一份。交给 Codex／Claude Code 的 run 也是这份：规矩页由 外部run.js 开工时接在前面（叶 6）。
 * 台填它的工作目录（绝对路径）：它的空间里只检出这个目录（十步重置 10-24）；总 dock 没有台，填的是整份成品的目录。
 * 工作等级填等级名和那一档的说法（`重置/请求/档位/<名>`），叫回时没写就用表上记的。
 * whole（项目总目的、上级这一块的目的）放进「之间的联系」，shared 放进「项目情境」，都是这一批共用的。
 * 同层分工由系统列（roster 的 `同层分工`，节点信息也用它），dock 写的 peers 接在后面。没写的一行不出现；一项只剩标题的整段不出现；多出来的空行压掉。
 */
export const 执行请求页 = '重置/请求/执行节点请求'
export const 请求页Of = 行 => 有一段(执行请求页) ? 执行请求页 : 节点类型(行) === 'run' ? '重置/请求/run请求' : '重置/请求/dock请求'
const 空栏 = '⟪没写⟫'
export const 档位说法 = 档 => `${档}——${一段(`重置/请求/档位/${档}`)}`
function 请求文本(根, 母节点, b, 行, 名册, { whole, shared } = {}) {
  const 栏 = v => (typeof v === 'string' && v.trim() ? v.trim() : 空栏)
  const 档 = b.level ?? 行?.level
  const 文 = 一段(请求页Of(行), { 母节点,
    bench: join(根, 节点工作目录(行)),
    what: 栏(栏内容('what', b.what)), link: 栏(栏内容('link', b.link)), situation: 栏(栏内容('situation', b.situation)), rules: 栏(栏内容('rules', b.rules)),
    whole: 栏(栏内容('whole', whole)), shared: 栏(shared),
    level: 档 ? 档位说法(档) : 空栏,
    peers: 栏([同层分工(名册, 行), 栏内容('peers', b.peers)].filter(v => typeof v === 'string' && v.trim()).join('\n')) })
  // 先去掉没写的行，再去掉只剩标题（以「：」结尾）的段。
  return 文.split('\n').filter(line => !line.includes(空栏)).join('\n').split(/\n{2,}/)
    .filter(段 => { const 行们 = 段.trim().split('\n'); return !!行们[0] && !(行们.length === 1 && /[:：]$/.test(行们[0].trim())) })
    .join('\n\n').trimEnd()
}

/**
 * 阶段之间留经验（十 59）：helm 派新的总 dock 时，写明这个位置前几任的节点文档在哪；第一任没有就不写。
 * 新建阶段时去掉了的、没交回的也列（十 61）：它们做出来的没并进作品，写明在哪个分支、哪个目录，由新的总 dock 自己去收。
 */
export function 历任总dock段(根, 名册, 我, 新id) {
  if (节点类型(行Of(名册, 我)) !== 'helm') return ''
  const 前任 = 孩子们(名册, 我).map(id => 行Of(名册, id)).filter(r => r.id !== 新id && r.role === 'dock' && r.session)
  if (!前任.length) return ''
  const 交没交 = r => r.status === '完成' && !r.stageClosed ? '交回了，做出来的已并进作品'
    : `没交回${r.stageClosed ? '，新建阶段时收起了' : r.status === '去掉' ? '就去掉了' : ''}，做出来的没并进作品：分支 ${节点分支(r.id)}，目录 ${join(根, 节点工作目录(r))}`
  return 一段('重置/请求/历任总dock', { 列表: 前任.map(r => `- ${r.id} ${r.name}（${交没交(r)}）：${工作文档路径(根, r)}`).join('\n') })
}

/** bench 写成了绝对路径的，换成相对派出者工作目录的（项目根的两种写法都认：原样的、去掉软链的）。 */
async function 台写成相对(根, 我行, blocks) {
  const 目录们 = [...new Set([join(根, 节点工作目录(我行)), join(await realpath(根).catch(() => 根), 节点工作目录(我行))])]
  return blocks.map(b => {
    const 台 = typeof b?.bench === 'string' ? b.bench.trim() : ''
    if (!台 || !isAbsolute(台)) return b
    const 相对 = 目录们.map(d => relative(d, 台)).find(r => r && !r.startsWith('..') && !isAbsolute(r))
    return 相对 ? { ...b, bench: 相对 } : b
  })
}

/** 派出的块，台目录要在派出者的分支里（设计页第九节第 3 条）：派出者空间里没提交的先存一个版本，再看分支里有没有。 */
async function 验台们(根, 名册, 我, blocks) {
  // helm 派的总 dock 不放台（它的空间是整份成品）。
  if (节点类型(行Of(名册, 我)) === 'helm') return
  const 我行 = 行Of(名册, 我), 派们 = 验块表(blocks).filter(派出).map(b => ({ b, 台: 台的仓库路径(我行, b.bench) }))
  const 缺 = new Set(await 不在分支里的台(根, 我, [...new Set(派们.map(x => x.台))]))
  const 缺的 = 派们.filter(x => 缺.has(x.台))
  if (缺的.length) throw new Error(`台目录不在你的空间里：${缺的.map(({ b, 台 }) => `bench「${b.bench}」（${join(根, 节点工作目录({ id: 我行.id, bench: 台 }))}）`).join('、')}——这个目录不存在，或者里面没有进版本的文件（git 不记空目录，.godot/、node_modules/ 这类不进版本）`)
}

/** 排队写数据；开会话与停止会话在队列外，避免会话钩子等待同一把项目锁。 */
async function 执行派人(ctx, 根, 我, 定版, args, exec) {
  // 新块落进名册后才有编号；结构段按落好的编号写，母节点醒来时能直接对上是谁。
  const 落定 = { ...定版, blocks: structuredClone(定版.blocks) }
  const { 执行 } = await 改名册(根, async m => {
    if (exec.signal?.aborted) throw new Error('策略已中断')
    const 文档 = await 读节点文档(根, 行Of(m, 我))
    const { review, fingerprint } = 验审议(m, 我, 文档, args)
    if (review.execution) return { 名册: m, 执行: review.execution }
    验策略块(m, 我, 落定.blocks, 根)
    const 编译 = 编译组织(m, 我, 落定.blocks, await 读纸条(根))
    落定.blocks = 编译.blocks
    // 请求只写给派出的块（登记的没有请求）：新开的、派出登记着的建文档，接着用的子 dock 改写请求。
    const 文档们 = 落定.blocks.filter(派出).map(b => ({ id: b.id, action: 编译.改的.includes(b.id) ? 'rewrite' : 'add',
      request: [请求文本(根, 称呼(行Of(编译.名册, 派出者Of(b.id, 编译.名册))), b, 行Of(编译.名册, b.id), 编译.名册, 落定),
        历任总dock段(根, 编译.名册, 我, b.id)].filter(Boolean).join('\n\n') }))
    // 新建阶段（十 61）：上一任还在做的，派出时收起。
    const 收起的 = 节点类型(行Of(m, 我)) === 'helm' && 新阶段待开(m, 我) && 落定.blocks.some(派出)
      ? 孩子们(m, 我).filter(n => 行Of(m, n).status === '开工' && !编译.去掉的.includes(n)) : []
    const 执行 = { fingerprint, choice: 'dispatch', 开的: 编译.开的, 改的: 编译.改的, 去掉的: 编译.去掉的, 收起的, 排的: 编译.排的,
      key_map: 编译.key_map, p_map: 编译.p_map, 文档们, mirroredNodes: [], 落定, submission: structuredClone(args), structure: 结构文本(文档?.structure, 落定), planMirrored: false, completed: false, rewritten: [] }
    // 这一阶段用户要的协作（协 2）：helm 派总 dock 时写了就记下；新建阶段派新总 dock 没写，上一阶段的清掉。
    const 记协作 = 节点类型(行Of(m, 我)) === 'helm' && 落定.blocks.some(派出) && (落定.collab !== undefined || 新阶段待开(m, 我))
    const 来源册 = { ...编译.名册, rows: 编译.名册.rows.map(row => {
      const doc = 文档们.find(d => d.id === row.id && d.action === 'rewrite')
      if (记协作 && row.id === String(我)) { const { collab: _, ...rest } = row; row = 落定.collab ? { ...rest, collab: 落定.collab } : rest }
      // 用户要在 helm 这一层、每一个部分哪几处参与（协 7）：写了就记在 helm 行，界面上那张表跟着变。
      if (row.id === String(我) && 节点类型(row) === 'helm') {
        if (落定.helm_with_user) row = { ...row, withUser: [...落定.helm_with_user] }
        if (落定.parts_with_user) row = { ...row, partsWithUser: [...落定.parts_with_user] }
      }
      return doc && row.originalRequest !== undefined ? { ...row, originalRequest: doc.request } : row
    }) }
    return { 名册: 写审议(写本次范围(来源册, 我), 我, { ...review, execution: 执行 }), 执行 }
  })
  // 名册和收据先落定，文档失败后使用同一编号补齐，不重复派人。
  await 补齐组织文档(ctx, 根)
  const latest = await 读名册(根)
  验审议(latest, 我, await 读节点文档(根, 行Of(latest, 我)), args)
  if (执行.completed) return 执行
  if (exec.signal?.aborted) throw new Error('策略已中断')
  for (const id of 执行.去掉的) await 去掉分支(ctx, 根, id, exec.agent)
  for (const id of 执行.收起的 || []) await 收起分支(ctx, 根, id, exec.agent)
  // 开团队补齐完整会话结构，再启动派出的节点。
  await 开团队(ctx, 根, 我, exec.agent, { 用户续工: true, 仅新建: true })
  for (const id of 执行.改的.filter(id => !执行.rewritten.includes(id))) {
    const m = await 读名册(根), row = 行Of(m, id)
    if (等前置(m, id).length || 等开工孩子(m, id).length) continue
    if (!row.kickoff?.delivered) throw new Error(`${id} 的请求已改写，但节点暂停、待回答或已结束，尚未投递改写通知；恢复后用原改版重试`)
    await 改名册(根, m => {
      const review = 行Of(m, 我).strategyReview
      if (review?.id !== args.review_id) throw new Error('改写通知期间审议已改变')
      return 写审议(m, 我, { ...review, execution: { ...review.execution, rewritten: [...review.execution.rewritten, id] } })
    })
  }
  await 完成执行(根, 我, args.review_id)
  return 执行
}

/**
 * 派出后挡住上级（10-24 用户「挡吧还是」）：替派出者登记一条通用的等待——等自己的孩子（children）交回，登记那一刻挂起 Goal，不出空轮。
 * children 等的是没有在做的孩子（登记着的块不算在做）；中途补派的块再登记一次，整条换成新的，补派的也在里面。
 * 孩子交齐时，交回节点 在同一次写名册里把这条等待撤掉、由交齐汇总叫醒它（只走一条路）；等着时用户说话、求助照现有规则叫醒，
 * 卡住提醒也照旧能撤。登不上（比如成环）不拦派出，返回一句事实接在回执后面。孩子已经都不在做了，不登记，返回空。
 */
export async function 等这一批交回(ctx, 根, 我, agent) {
  const 原因 = '等这一批派出的块交回'
  try {
    const 回 = await 登记等待(ctx, 根, 我, { reason: 原因, conditions: [{ type: 'children' }] }, agent)
    if (!回.ready) 开始等待(ctx, agent, `等待 ${原因}。`)
    return ''
  } catch (error) { return `没有登记上「${原因}」：${error.message || error}` }
}

/** stage 写进任务表（一次改名册）。返回给模型的话，没写就空。 */
async function 写阶段格(根, 我, 阶段) {
  if (!阶段) return ''
  let 回 = ''
  await 改名册(根, m => { const 写 = 写阶段(m, 我, 阶段); 回 = 写.回; return 写.名册 })
  return 回
}

/** divide 的参数：三格平铺（派 4；第三版座位撤了，没有 seats）。 */
export const divide参数 = { type: 'object', additionalProperties: false, properties: { stage: 阶段参数, ...派人格 } }

/**
 * 回执：派出、接着用、登记、去掉了哪些；新进表的块编到了几号 p（key → p 几）；派出的块里依赖还没交回的，写事实（十 41，不拦）。
 * needs 写了别的分支的块，也写事实（十 51，不拦）：那一块交回时叫醒的是它自己的上级，不是你。
 */
function 派出回执(执行, 轮, m) {
  const 列 = 们 => 们?.length ? 们.join('、') : '无'
  const 编号 = Object.entries(执行.p_map || {}).map(([key, p]) => `${key} → ${p}（${执行.key_map?.[key] ?? '?'}）`)
  const 没交回 = m ? [...(执行.开的 || []), ...(执行.改的 || [])].flatMap(id => {
    const r = 行Of(m, id), 等 = (r.needs || []).map(p => m.rows.find(x => x.p === p)).filter(x => x && x.status !== '完成')
    return 等.length ? [`${r.p || r.id} 依赖的 ${等.map(x => `${x.p}（${x.id} ${x.name}，${状态话[x.status] || x.status}）`).join('、')}还没交回`] : []
  }) : []
  const 跨块 = m ? [...(执行.开的 || []), ...(执行.改的 || []), ...(执行.排的 || [])].flatMap(id => {
    const r = 行Of(m, id), 外 = (r.needs || []).map(p => m.rows.find(x => x.p === p)).filter(x => x && x.parent !== r.parent)
    return 外.length ? [`${r.p || r.id} 依赖的 ${外.map(x => `${x.p}（${x.id} ${x.name}）在 ${x.parent ?? '用户'} 名下`).join('、')}，不是你名下的块：它交回时叫醒的是它自己的上级，不是你；跨块的依赖由共同的上级排`] : []
  }) : []
  return [`派出：${列(执行.开的)}；接着用：${列(执行.改的)}；登记：${列(执行.排的)}；去掉：${列(执行.去掉的)}${执行.收起的?.length ? `；收起：${列(执行.收起的)}` : ''}。${轮 ? `这一批记在第 ${轮} 轮。` : ''}`,
    ...(编号.length ? [`编号：${编号.join('、')}`] : []), ...没交回, ...跨块].join('\n')
}

/** divide 的说明：三档工作等级的说法从 `重置/请求/档位/` 填进去，和请求里放的是同一份（派 6、派 9）。 */
export const divide说明 = () => 说明书('divide', { 档位说明: 节点档位们.map(档 => `  - ${档位说法(档).replace('——', '：')}`).join('\n') })

export function 装策略(ctx) {
  ctx.tools.register({ name: 'divide', description: divide说明(), output: 只回一段字,
    parameters: divide参数,
    execute: async (args, exec) => {
      const { 根, 我, 名册 } = await 认我(ctx, exec), 行 = 行Of(名册, 我)
      if (行.status !== '开工') throw new Error('这个节点已交回或去掉，不能写表')
      if (exec.signal?.aborted) throw new Error('策略已中断')
      const { seats, stage, ...派 } = args || {}
      if (seats !== undefined) throw new Error('座位撤了，没有 seats 这一格：helm 每个阶段用 divide 派一个总 dock（blocks 写一块，role 写 dock）；dock 把块派给下级的 dock 或 run')
      const 有派 = Object.keys(派).length > 0
      if (stage === undefined && !有派)
        throw new Error('divide 写任务表，这一次一格都没写：blocks 是这一批的块（shared 给这一批人共看），stage 记阶段（helm）')
      // 先全部核对再写。
      const 阶段 = stage === undefined ? null : 验阶段(stage)
      if (阶段) 写阶段(名册, 我, 阶段)
      if (!有派) return { 文: await 写阶段格(根, 我, 阶段) }
      // 做不到、要别的节点补信息：用 note 发求助（选 16）；helm 直接问用户。
      if (派.choice === 'send_back' || 派.choice === 'wait') throw new Error('divide 只写表：做不到、要别的节点补信息，用 note 发求助（kind=ask）；helm 直接问用户')
      // 模型看到的参数里没有 choice；旧调用方写的 dispatch 照收，self 改用 next（选 25）。
      if (派.choice !== undefined && 派.choice !== 'dispatch') throw new Error('divide 只写表；自己做的，做完用 next 交成果报告')
      if (派.phase !== undefined || 派.review_id !== undefined) throw new Error('divide 只提交定稿')
      args = 接方案({ ...派, choice: 'dispatch' })
      验协作要求(名册, 我, args.collab)
      验表上的点(名册, 我, args)
      验合并(args)
      args = { ...args, blocks: (await 台写成相对(根, 行, args.blocks)).map(b => !b || typeof b !== 'object' ? b : { ...b,
        // 一块两个号：id 换成节点号，needs 换成 p 号，写哪个都认（10-28）。
        ...(typeof b.id === 'string' && { id: 换号(名册, b.id, 'id') }),
        ...(Array.isArray(b.needs) && { needs: b.needs.map(n => typeof n === 'string' ? 换号(名册, n, 'p') : n) }) }) }
      // 阶段换了再派：按换过的阶段核对（总 dock 是不是这一阶段的）。
      const 有阶段册 = 阶段 ? 写阶段(名册, 我, 阶段).名册 : 名册
      const 重提 = 是同稿重提(行, await 读节点文档(根, 行), args)
      验策略块(有阶段册, 我, args.blocks, 根, { 重提 }); 编译组织(有阶段册, 我, args.blocks)
      await 验台们(根, 有阶段册, 我, args.blocks)
      const 先写 = await 写阶段格(根, 我, 阶段)
      return 排策略执行(根, 我, exec, async () => {
        const 定版 = { ...args, blocks: args.blocks }
        const current = await 读名册(根)
        if (args.review_id === undefined || !行Of(current, 我).strategyReview?.execution) {
          验策略块(current, 我, args.blocks, 根, { 重提: 是同稿重提(行Of(current, 我), await 读节点文档(根, 行Of(current, 我)), args) }); 编译组织(current, 我, args.blocks)
        }
        if (args.review_id === undefined) args = await 保存自主定稿(ctx, 根, 我, args, exec)
        // 结构段：plan 交的分工表在前，这一轮派出那一节接在后面（送审、派人、补写结构都用这样拼出来的一份）。
        const 文档 = await 读节点文档(根, 行Of(current, 我))
        const 审核 = await 审核定稿(ctx, 根, 我, args, 结构文本(文档?.structure, 定版), exec)
        if (!审核.approved) return { 文: [先写, 审核.文].filter(Boolean).join('\n') }
        const 执行 = await 执行派人(ctx, 根, 我, 定版, args, exec)
        const m = await 读名册(根), 派了 = [...执行.开的, ...执行.改的]
        const 轮 = 派了.length ? 行Of(m, 派了[0]).rounds?.at(-1)?.round : null
        // 派出了块：execute 这个环节结束（写一句交接，选择机下次看得到），登记等这一批交回、挂起 Goal，这一轮收尾；
        // 孩子交齐由交齐汇总叫醒（十步重置 10-24：helm 和 dock 同一套）。只登记、只去掉的不结束环节，接着做。
        let 等话 = ''
        if (派了.length) {
          await 结束阶段(ctx, exec.agent, 根, 我, 派出回执(执行, 轮).split('\n')[0])
          等话 = await 等这一批交回(ctx, 根, 我, exec.agent)
          收尾(exec)
        }
        const pending = 后代们(m, 我).map(n => 行Of(m, n)).filter(r => r.status === '开工' && r.kickoff && !r.kickoff.delivered)
          .map(r => `${r.id}（${等前置(m, r.id).length ? `正式前置：${等前置(m, r.id).map(n => `${n}·${行Of(m, n).status}`).join('、')}`
            : 等开工孩子(m, r.id).length ? `下层交回：${等开工孩子(m, r.id).join('、')}` : '启动投递待恢复'}）`)
        return { 文: `${先写 ? `${先写}\n` : ''}定稿已写入本节点文档的结构，并按同一方案执行。\n引用表：${JSON.stringify(执行.key_map)}\n${派出回执(执行, 轮, m)}${pending.length ? `\n待启动：${pending.join('；')}` : ''}${等话 ? `\n${等话}` : ''}` }
      })
    },
  })
}
