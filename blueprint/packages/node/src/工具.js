import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
/** 节点交回和用户可预览的产物入口。 */
import { 说明书, 只回一段字, 一段, 运行模式Of } from '../../prompt/src/index.js'
import {
  项目根, 读名册, 改名册, 我是谁, 行Of, 在等谁, 派出者Of, 结束节点,
  验交付, 交付结论, 写节点结构, 节点类型, 首节点, 更新节点文档, 称呼,
} from '../../roster/src/index.js'
import { 收束分支, 推进组织, 重新开工 } from './会话.js'
import { 产物参数, 检查产物, 网页入口 } from './产物.js'
import { 提交节点空间, 节点成果版本, 并入派出者, 并入目标, 碰过的文件, 台外的文件 } from './节点Git空间.js'
import { 验经验, 验交回记忆, 写交回记忆 } from './交回记忆.js'
import { 工具执行目录 } from './项目隔离.js'
import { 结束阶段 } from './选择机.js'
import { 完成持续目标, 开始等待, 开持续目标 } from './持续工作.js'
import { 继续节点 } from './项目停下.js'
import { 继续补送 } from './继续补送.js'
import { 记回话开工 } from './思考开头.js'
import { 登记等待 } from './条件等待.js'
import { 记成果报告 } from './节点文档.js'
import { 审核方案 } from './定稿审核.js'
import { 是用户的话 } from './交给新总分身.js'
import { 交spark } from './spark.js'
import { 只等孩子 } from '../../roster/src/信息依赖.js'
import { 读人工审核 } from './人工审核.js'
import { 自动对话答复 } from './回答.js'
import { 收尾 } from './收尾.js'
import { 用户进来过, 验收后回过话 } from './规则.js'
import { 点名要用户, 协作点Of } from './协作点.js'
import { 验交付件, 记交付件, 验整合件, 记整合, 整合数, 工作们, 整合状态们, 谁判们 } from '../../roster/src/整合表.js'

export async function 认我(ctx, exec) {
  const 会话 = exec?.agent?.session?.id
  if (!会话) throw new Error('这次调用没有会话')
  const 根 = 项目根(ctx, 会话), 名册 = await 读名册(根), 我 = 名册 && 我是谁(名册, 会话)
  if (!我) throw new Error('这个会话不是 Blueprint 的节点 —— 名册里没有它')
  return { 根, 我, 名册 }
}

/** ask_user 写「不用」开头就是不问。 */
const 不问 = 文 => /^不用/.test(文.trim())

/** 协作点上还没问过用户就写「不用」：退回时说的话（协 3）。 */
const 协作点没问 = {
  talk: '这一块用户要在你动手前和你谈（with_user 标了 talk），你还没和他谈过：先在正文里把你对这一块的理解说给他听，ask_user 写你要问他的。',
  spark: '这一块用户要先和你一起想清楚（with_user 标了 spark），你还没和他谈过：先拿一组拉开距离的东西给他看，ask_user 写你要问他的那一件。',
  accept: '这一块交回前要用户亲自验收（with_user 标了 accept），你还没请他验：finish 的 ask_user 写请他看什么、在哪看、怎么打开、怎么试；他回了话再交。',
}

/**
 * 要不要问用户（10-22 用户：「……都要思考一下是否需要询问用户意见，这应该做进机制里面」；第三版 10-24，十 33）：
 * 所有节点都可以问——问方向，或请用户协助验收；只有 helm 在 orient、complete（和交回）有固定的必答：build 下 ask_user 必填。
 * 不等人时（这一阶段按 solo 跑，solo 开关就是它）返回固定答复，让节点自己判断；要等人时登记等用户回话，这次交的不算；solo 阶段不问用户。问题怎么写给用户看，由 prompt 讲。
 * 用户中途亲口跟这个节点说过话（选 47）：不等人时也照样停下等他——solo 是用户不参与过程，他开了口就是在参与。
 * 协作点（协 3）：`协作点` 是这一步上用户点名要在的那一点（talk、spark 在定向和 plan，accept 在 finish）。不是用户选的 solo 就照样停下等他，
 * spark 交完按 solo 跑的阶段也一样；还没和他谈过、还没请他验过就写「不用」，退回去叫它问。
 * 返回 null 表示接着交。
 */
async function 问用户(ctx, 根, 我, 名册, ask, exec, { 必答 = false, 协作点 } = {}) {
  const 首 = 行Of(名册, 首节点), 模式 = 运行模式Of(首.task, 首.stageMode)?.id, 有 = typeof ask === 'string' && !!ask.trim()
  if (!必答 && !协作点 && (!有 || 不问(ask))) return null
  const 审 = await 读人工审核(根, 名册), { enabled } = 审, 事件们 = exec.agent?.session?.ownEvents?.() || []
  const 点名 = 点名要用户(名册, 行Of(名册, 我), 协作点)
  const 人在 = !enabled && (点名 || 用户进来过(事件们))
  exec.signal?.throwIfAborted()
  if (!enabled && !人在) return 有 && !不问(ask) ? { 文: 自动对话答复 } : null
  // helm 的必答（开头、收口）照旧可以写「不用」；dock 的协作点要真问过（协 3）。
  if (点名 && !必答 && (!有 || 不问(ask)) && !(协作点 === 'accept' ? 验收后回过话(事件们) : 用户进来过(事件们))) throw new Error(协作点没问[协作点])
  if (必答 && !有) throw new Error('ask_user 必填：这一段有哪些要用户来定、或者要用户亲眼看过才判断得了的？没有就写「不用」；有，就先在正文里问用户，ask_user 写那一个问题。')
  if (!有 || 不问(ask)) return null
  if (模式 === 'solo' && !人在) throw new Error('solo：用户把这件事全权交给你们，过程中不问用户。ask_user 写「不用」，依据目标与证据自己判断。')
  return 等用户回话(ctx, 根, 我, ask, exec, '问题摆给用户了，这一步先停下，这次交的不算。用户回了话，你回到这一步重新判断，再交。', { 点名: 点名 && 协作点 })
}

/** 登记等用户回话、停下这一轮；用户已经说了话就不等，先看。`点名`：用户点名要在的那一点（协 3），按 solo 跑也不替他答；他在界面上关掉了就放行（协 7）。 */
async function 等用户回话(ctx, 根, 我, ask, exec, 停下话, { 点名 = false } = {}) {
  const 回 = await 登记等待(ctx, 根, 我, { reason: `问用户：${ask.trim()}`, conditions: [{ type: 'input' }] }, exec.agent, { 点名 })
  if (回.facts?.some(f => f.automatic)) return { 文: 自动对话答复 }
  if (回.ready) return { 文: '用户刚说了话，还没看：先看用户的话，再重新判断、再交。' }
  开始等待(ctx, exec.agent, `等用户回话：${ask.trim()}`)
  收尾(exec)
  return { 文: 停下话 }
}

/** 并进派它的节点的分支撞上冲突：这次不成立，冲突交给它自己解决。 */
const 并入冲突话 = (回, 再 = '交回') => 一段('重置/叫醒/并入冲突', { 冲突: `冲突文件：\n${回.冲突.map(f => `- ${f}`).join('\n') || '- （git 没列出文件）'}\n\n在你的产物空间里先把 ${回.目标分支} 并进来（git merge ${回.目标分支}），解决冲突、提交后再${再}。` })

export function 装工具(ctx) {
  const 注册 = (name, parameters, execute) => ctx.tools.register({ name, description: 说明书(name), parameters, output: 只回一段字, execute })
  注册('present_artifact', 产物参数, async (args, exec) => {
    const { 根 } = await 认我(ctx, exec)
    const artifact = await 检查产物(根, args, { cwd: 工具执行目录() || 根 })
    return { 文: JSON.stringify({ artifactVersion: 1, artifact: { ...artifact,
      path: 网页入口(artifact.path) ? artifact.path : resolve(根, artifact.path),
      ...(artifact.coverPath ? { coverPath: resolve(根, artifact.coverPath) } : {}),
    } }) }
  })
  // 每个阶段只用 next 结束（divide 派出的除外），handoff 就是这个环节的结论（选 25）。机器按刚结束的阶段做事：
  // plan → 分工表，写进结构段（协作模式下先给用户审）；execute → 成果报告记进记录、轮尾重建；其余 → 一句交接。
  // 10-25 精简（十 49）：verify 撤了，要人判的只在 finish 的 unchecked 交一次，next 不再收 unchecked。
  // 选出的阶段不对（选 15）：wrong_stage 为真，handoff 只当理由，不当方案或报告。
  // 参数不让 dsh 先挡（不写 required、不禁多余字段）：10-19-4 里四个节点三个往 next 里塞 phase／stage，
  // 原生报错只列 schema，helm 没看出自己还在 rule，接着在 rule 里做 plan 的事。这里自己判，报错说清还在哪个阶段；
  // 有 handoff 时多写的字段不拦，照常结束这个阶段，回执里说一声它们没用上。
  // 十步重置（10-24）：this_round、wrap_up、new_goal、next_stage 去掉——下级每轮都交回，收尾直接 finish；换阶段用 divide 的 stage；
  // 用户换了目标，helm 回 plan 当新阶段做。
  // parts（10-25，合 4）：只在 integrate 收，给整合表上的每一样定去向；别的环节写了照常结束，回执说一声没用上。
  const next格们 = ['handoff', 'wrong_stage', 'ask_user', 'parts']
  const 整合件参数 = { type: 'object', properties: { id: { type: 'string' }, what: { type: 'string' }, state: { type: 'string', enum: 整合状态们 },
    where: { type: 'string' }, effect: { type: 'string' }, judge: { type: 'string', enum: 谁判们 }, reason: { type: 'string' } } }
  注册('next', { type: 'object', properties: { handoff: { type: 'string' }, wrong_stage: { type: 'boolean' },
    ask_user: { type: 'string' }, parts: { type: 'array', items: 整合件参数 } } }, async (args, exec) => {
    const { 根, 我, 名册 } = await 认我(ctx, exec)
    const 行 = 行Of(名册, 我), 多的 = Object.keys(args || {}).filter(k => !next格们.includes(k))
    if (typeof args?.handoff !== 'string' || !args.handoff.trim()) {
      throw new Error(`${行.selector?.last ? `你还在 ${行.selector.last} 环节，它还没结束。` : ''}next 只写 handoff：这个环节的结论（plan 写分工表，execute 写成果报告，其余写一句交接）${多的.length ? `；${多的.join('、')} 不用写` : ''}。下一个环节由系统选，不用你写。写好 handoff 再调一次 next。`)
    }
    const 结论 = args.handoff.trim()
    const 整合里 = 行.selector?.last === 'integrate' && !args.wrong_stage
    const 没用上 = [多的.filter(k => k !== 'stage').length && `（${多的.filter(k => k !== 'stage').join('、')} 没用上：next 的格子是 ${next格们.join('、')}；下一个环节由系统选。）`,
      多的.includes('stage') && '（stage 没用上：阶段写在 divide 的 stage 那一格。）',
      args.parts?.length && !整合里 && '（parts 没用上：它只在 integrate 环节给整合表定去向。）'].filter(Boolean).join('')
    const 整合件们 = 整合里 ? 验整合件(名册, 我, args.parts) : []
    // 回话里用 next 交接，就是要开工（选 46）：交回了的 helm、dock 原地重新开工。交回了的 helm 在回话里发现要做事也一样（十 54）。
    const 回话里开工 = 行.selector?.last === 'reply' && ['helm', 'dock'].includes(节点类型(行))
    if (行.status !== '开工' && (回话里开工 || 节点类型(行) === 'helm' && exec.agent.session.deriveMessages().some(是用户的话))) await 重新开工(根, 我)
    if (行.status !== '开工' && 行Of(await 读名册(根), 我).status !== '开工') throw new Error('本节点已交回，不再开新的环节')
    // 问用户（十 33）：helm 在 orient、complete 必答——表上 helm 勾着开头、验收才答（协 7）；别的环节、执行节点写了 ask_user 就问，这次交的不算，用户回了话再交。
    if (!args.wrong_stage) {
      const helm点 = 节点类型(行) === 'helm' ? { orient: 'talk', complete: 'accept' }[行.selector?.last] : undefined
      const 必答 = 点名要用户(名册, 行, helm点)
      // 协作点（协 3）：标了 talk、spark 的 dock，定向和 plan 交接前要和用户谈过。
      const 协作点 = 必答 ? helm点 : 节点类型(行) === 'dock' && ['orient', 'plan'].includes(行.selector?.last) ? 协作点Of(名册, 行).find(点 => ['talk', 'spark'].includes(点)) : undefined
      const 问 = await 问用户(ctx, 根, 我, 名册, args.ask_user, exec, { 必答, 协作点 })
      if (问) return 问
    }
    // 什么时候交回由 prompt 讲（complete 页），程序不拦（10-20 用户：不强制限制 dock 什么时候必须停止）。
    let 交接 = 结论, 文 = '这个环节结束了。系统会据此选下一个环节，把那一页放到你眼前。'
    if (args.wrong_stage) 交接 = `选出的 ${行.selector?.last || ''} 环节不对：${结论}`
    else if (行.selector?.last === 'plan') {
      const 审 = await 审核方案(ctx, 根, 我, 结论, exec)
      if (!审.approved) return { 文: 审.文 }
      await 写节点结构(根, 行, 结论, ctx.get('fs'))
      交接 = '方案写在节点文档的结构段。'
      文 = '方案已写进节点文档的结构段。这个环节结束，系统接着选下一个环节。'
    } else if (行.selector?.last === 'execute') {
      const 第几圈 = await 记成果报告(ctx, 根, 我, 结论, exec.agent)
      交接 = `第 ${第几圈} 圈的成果报告已记进记录。`
      文 = `第 ${第几圈} 圈的成果报告已记进记录。执行到此停下：context 会按节点文档重建，再选下一步。`
    } else if (整合里) {
      // 整合表（合 4）：定下的去向记进表；没落去向的不拦，留在表上，回执报数。
      const { 名册: 新 } = await 改名册(根, m => 记整合(m, 我, 整合件们))
      const 定了 = 状态 => 整合件们.filter(p => p.state === 状态).length, 数 = 整合数(新, 我)
      文 += `整合表：这次接上 ${定了('merged')} 样、不接 ${定了('skipped')} 样、留给谁 ${定了('deferred')} 样；还没接进你手上成品的 ${数.open} 样留在表上。`
    }
    await 结束阶段(ctx, exec.agent, 根, 我, 交接)
    if (回话里开工) {
      // 这一轮不收：下一步当场过选择机，在这一轮里接着做（思考开头.js）。交回了的重建 Goal；
      // 被按停的，这一轮停稳后继续：补一句用户续工、恢复 Goal，排着的纸条和交回补送进来。在等的照旧由等待管。
      if (行.status !== '开工') 开持续目标(ctx, exec.agent, 行Of(await 读名册(根), 我), { 重开续跑: true })
      记回话开工(exec.agent)
      void exec.agent.whenIdle?.().then(async () => 继续节点(ctx, 根, exec.agent, 行Of(await 读名册(根), 我), 继续补送, { 补一句: true }))
        .catch(e => console.log(`Blueprint node: 回话后继续没接上 —— ${e?.message || e}`))
      return { 文: '这个环节结束了。系统接着选下一个环节，把那一页放到你眼前，你在这一轮里接着做。' + 没用上 }
    }
    收尾(exec)
    return { 文: 文 + 没用上 }
  })
  // 后面的圈由同一个节点接着转；finish 只有正式交回全部责任这一种。
  const 经验参数 = { type: 'object', additionalProperties: false, required: ['title', 'situation', 'reflex', 'instead', 'because'], properties: {
    title: { type: 'string' }, situation: { type: 'string' }, reflex: { type: 'string' }, instead: { type: 'string' }, because: { type: 'string' },
  } }
  // 十步重置（10-24）：交回只写做了什么、入口、哪里没把握（十 9）；next_stage 去掉。
  // checked（10-27，派 7）放回来：怎么验由下级自己定，验证结果自己交；执行节点必写，helm 不写。
  // parts（10-25，合 2）：自己交出的东西，一样一行，记进整合表。
  const 交付件参数 = { type: 'object', additionalProperties: false, required: ['work'], properties: {
    id: { type: 'string' }, what: { type: 'string' }, work: { type: 'string', enum: 工作们 }, where: { type: 'string' },
    effect: { type: 'string' }, judge: { type: 'string', enum: 谁判们 }, reason: { type: 'string' },
  } }
  注册('finish', {
    type: 'object', additionalProperties: false, required: ['result', 'handoff'], properties: {
      result: { type: 'string', enum: ['achieved', 'unmet'] },
      handoff: { type: 'string' },
      question: { type: 'string' },
      checked: { type: 'string' },
      unchecked: { type: 'string' },
      status: { type: 'string' },
      lessons: { type: 'array', items: 经验参数 },
      ask_user: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } },
      parts: { type: 'array', items: 交付件参数 },
    },
  }, async (args, exec) => {
    const { 根, 我, 名册 } = await 认我(ctx, exec)
    const { ask_user, files = [], ...交回 } = args
    // 相关文件（10-22）：和交回前那段说明一起出现在对话里；先核对都在，写错的退回让它改。界面从这次调用的参数里认。
    // 先按当时的目录找，找不到再按项目根找（导出/ 在项目根，0 号的目录是 作品/）；界面认的顺序相同。
    for (const entry of files) await 检查产物(根, { entry }, { cwd: 工具执行目录() || 根 }).catch(() => 检查产物(根, { entry }))
      .catch(e => { throw new Error(`files 里的 ${entry}：${e.message || e}`) })
    // spark 交的是那一页（十 56）：作为用户的话交给 helm，自己就完成了；不并分支、不叫醒派出者、不问用户（它一路都在和用户说）。
    if (节点类型(行Of(名册, 我)) === 'spark') {
      if (行Of(名册, 我).status !== '开工') return { 文: '这一页已经交给 helm 了。' }
      const 回 = await 交spark(ctx, 根, 我, { handoff: 交回.handoff, files }, exec.agent)
      收尾(exec)
      return 回
    }
    if (节点类型(行Of(名册, 我)) !== 'helm' && !(typeof 交回.checked === 'string' && 交回.checked.trim()))
      throw new Error('checked 要写：你怎么验的、验出了什么、证据在哪（写路径）；没验成的照实写')
    // helm 交回就是这件工作的收口，和 complete 一样必答（表上 helm 勾着验收，协 7）；执行节点写了才问（十 33）。
    // 标了 accept 的 dock（协 3）：交回前要请用户验过、用户回过话。
    const 问 = 行Of(名册, 我).status === '开工' ? await 问用户(ctx, 根, 我, 名册, ask_user, exec,
      { 必答: 节点类型(行Of(名册, 我)) === 'helm' && 点名要用户(名册, 行Of(名册, 我), 'accept'),
        协作点: 点名要用户(名册, 行Of(名册, 我), 'accept') ? 'accept' : undefined }) : null
    if (问) return 问
    const 回 = await 交回节点(ctx, 根, 我, 交回, exec.agent)
    收尾(exec)
    return 回
  })
}

/**
 * 并进之后，还在做的节点里碰过同一批文件的，下一次醒来时看到一句（只给信息，不下命令）。
 * 不重叠的不打扰。通知记在名册行的 notices，思考开头带上后清掉。
 */
async function 通知碰过的(根, 我, { 目标, 变了 }) {
  const m = await 读名册(根), 我行 = 行Of(m, 我), 目标行 = 行Of(m, 目标)
  const 改的 = new Set(变了), 要通知 = []
  for (const r of m.rows) {
    if (r.status !== '开工' || r.id === 我 || r.id === 目标 || !r.session) continue
    const 重叠 = (await 碰过的文件(根, r.id, 目标)).filter(f => 改的.has(f))
    if (重叠.length) 要通知.push({ id: r.id, text: 一段('重置/叫醒/主线变了', { 来源: `${我行.id} ${我行.name}`, 目标: `${目标行.id} ${目标行.name}`, 文件: 重叠.slice(0, 20).map(f => `- ${f}`).join('\n') }) })
  }
  if (要通知.length) await 改名册(根, latest => ({ ...latest, rows: latest.rows.map(r => {
    const n = 要通知.find(x => x.id === r.id)
    return n ? { ...r, notices: [...(r.notices || []), { id: randomUUID(), text: n.text }] } : r
  }) }))
}

/**
 * 交回过的东西一路往上（达 2）：刚并进的那一层要是已经交回，就接着把它并进它的上级，一层层往上，
 * 到还在做的那一层为止（给它留一条通知，下次醒来看到），上面都交回了就一直并到作品（0 号的分支）。
 * 撞上冲突就停在那一层，照实说。只搬交回过的东西，接不接照旧由整合的节点判断。返回接在交回回执后面的一句，没往上走就是空。
 */
async function 往上并(根, 我, 起) {
  const 经过 = []
  let 名册 = await 读名册(根), x = String(起)
  while (行Of(名册, x).status === '完成' && 并入目标(名册, x) !== null) {
    const 回 = await 并入派出者(根, 名册, x)
    if (回?.冲突) return `${经过.length ? `接着往上并过了 ${经过.join('、')}；` : ''}${x} 也已经交回，再往上并进 ${回.目标} 时撞上冲突（${回.冲突.slice(0, 10).join('、') || 'git 没列出文件'}），停在 ${x} 的分支。`
    if (!回?.并入 && !回?.已在) return `${经过.length ? `接着往上并过了 ${经过.join('、')}；` : ''}${x} 也已经交回，可它上级的空间不在，没再往上并，停在 ${x} 的分支。`
    经过.push(x)
    x = 回.目标 ?? 并入目标(名册, x)
    名册 = await 读名册(根)
  }
  if (!经过.length) return ''
  if (行Of(名册, x).status !== '开工') return `${经过.join('、')} 都已经交回，改动接着一路并到了作品。`
  const 话 = 一段('重置/叫醒/下面又改了', { 来源: 称呼(行Of(名册, 我)), 经过: 经过.join('、') })
  await 改名册(根, m => ({ ...m, rows: m.rows.map(r => r.id === x ? { ...r, notices: [...(r.notices || []), { id: randomUUID(), text: 话 }] } : r) }))
  return `${经过.join('、')} 已经交回，改动接着并到了 ${x}（还在做），它下次醒来会看到。`
}

/**
 * agent：交回的那个节点的会话。外部 run（叶 6）没有会话，传 null：不收它的会话分支、不动 Goal。
 * 不并入：外部 run 解决冲突那一轮还撞时，照实交回、不并进去。
 * 并入撞冲突抛的错带 `并入冲突`（冲突文件、目标分支），外部 run 认它叫执行者解决一次。
 */
/** 记进工作文档的那一段交回：抬头写第几轮和达成没达成，下面是交回原文和验了什么、没验什么。 */
export function 交回记录(轮, { result, handoff, handoffQuestion, checked, unchecked }) {
  const 结 = result === 'achieved' ? '达成' : '没达成'
  return [`【${轮 ? `第 ${轮} 轮` : ''}交回·${结}】`, handoff, handoffQuestion && `要派我的节点定：${handoffQuestion}`,
    checked && `验了：${checked}`, unchecked && `没验：${unchecked}`].filter(Boolean).join('\n')
}

export async function 交回节点(ctx, 根, 我, args, agent, { 不并入 = false } = {}) {
  const 结果 = 验交付(args), 件们 = 验交付件(args.parts, 我), 当前 = await 读名册(根), 行 = 行Of(当前, 我)
  // 带着问题交回只给 run（叶 4）；别的节点要派它的人判断，照旧发求助纸条。
  if (结果.handoffQuestion && 节点类型(行) !== 'run') throw new Error('question 只给 run；要派你的节点判断，用 note 发求助')
  结束节点(当前, 我, 结果)
  验交回记忆(行, args)
  验经验(args.lessons)
  if (agent && 行.status !== '完成') await 收束分支(ctx, 根, 我, agent)
  let 提交 = '', artifact = 行.artifact, 并入 = '', 台外 = ''
  if (行.status !== '完成') {
    // 台外写的文件不进版本、不并上去（十步重置 10-24）：照实写一句，没有就不写。
    const 外 = 行.bench ? await 台外的文件(根, 我) : []
    if (外.length) 台外 = `台外写的文件没有交上去（台是 ${行.bench}）：${外.slice(0, 20).join('、')}${外.length > 20 ? ` 等 ${外.length} 个` : ''}。`
    try {
      await 提交节点空间(根, 我, `${我} 交回时的版本`)
      artifact = await 节点成果版本(根, 我)
    } catch (e) { 提交 = `产物空间没有提交上：${e.message || e}。`; artifact = { error: 提交 } }
    // 并进派它的节点的分支；撞上冲突，这次交回不成立，冲突交给它自己解决。
    if (!artifact?.error && !不并入) {
      const 回 = await 并入派出者(根, 当前, 我)
      if (回?.冲突) throw Object.assign(new Error(并入冲突话(回)), { 并入冲突: 回 })
      if (回?.并入) {
        并入 = `已并进 ${回.目标} 的分支。`
        if (回.变了?.length) await 通知碰过的(根, 我, 回)
        并入 += await 往上并(根, 我, 回.目标)
      }
    }
  }
  const { 名册, 爹 } = await 改名册(根, async m => {
    const row = 行Of(m, 我), 首次 = row.status !== '完成', 爹 = 派出者Of(我, m)
    const 回 = 结束节点(m, 我, 结果)
    let roster = 回.名册
    if (首次) await 写交回记忆(根, row, { status: args.status, lessons: args.lessons })
    if (首次) roster = { ...roster, rows: roster.rows.map(r => r.id === 我 ? { ...r, artifact } : r) }
    if (首次) roster = 记交付件(roster, 我, 件们)
    if (爹 !== null && 行Of(roster, 爹).status === '开工' && !在等谁(roster, 爹).length && !行Of(roster, 爹).aggregate) {
      // 孩子交齐只走交齐汇总一条路叫醒：上级等的若正是这些孩子，那个等待一并撤掉，不另叫一次（10-22）。
      const 撤 = 只等孩子(roster, 爹) ? { wait: undefined } : {}
      roster = { ...roster, rows: roster.rows.map(r => r.id === 爹 ? { ...r, aggregate: { id: randomUUID(), delivered: false }, ...撤 } : r) }
    }
    // 欠着的求助不拿交回代答：交回以后机器照样叫醒它去回（选 17）。
    return { 名册: roster, 爹 }
  })
  // 交回的结论记进自己工作文档的记录（10-23）：被接着用时 context 按文档重建，看得到自己上一轮交了什么；外置 run 也是同一份。
  if (行.status !== '完成' && 节点类型(行) !== 'helm') {
    const r = 行Of(名册, 我)
    await 更新节点文档(根, r, { append_record: 交回记录(r.rounds?.at(-1)?.round, 结果) }, ctx.get('fs'))
      .catch(e => console.log(`Blueprint node: ⚠️ ${我} 交回结论没记进工作文档 —— ${e.message || e}`))
  }
  // 交回就是 Goal 完成；之后欠着的求助照样会叫醒它去回（选 17）。
  if (agent) 完成持续目标(ctx, agent)
  let 运行 = ''
  try { await 推进组织(ctx, 根, agent) }
  catch (e) { 运行 = `结果已保存，组织启动或上级通知待恢复：${e.message || e}。` }
  const 最新 = await 读名册(根)
  const 回话 = 爹 === null ? '结果交给用户判断。'
    : !在等谁(最新, 爹).length ? 行Of(最新, 爹).aggregate?.delivered ? `${爹} 的子节点已交齐，已统一通知。` : `${爹} 的子节点已交齐，汇总通知等待恢复。`
      : '结果已记录，等待其他责任交回；重复交差不重复通知。'
  return { 文: `${交付结论(行Of(名册, 我))}。${并入}${回话}${运行}${提交}${台外}` }
}
