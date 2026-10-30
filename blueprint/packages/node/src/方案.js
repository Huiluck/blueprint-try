/** 模型只提交一份方案；文档、审核与执行使用它的同一组内容。 */
import { posix } from 'node:path'
import { 是节点号, 标题下沉, 角色们, 节点档位们, 协作点们, 协作点说法 } from '../../roster/src/index.js'
import { 执行者们, DeepSeek执行者 } from './子代理开关.js'

// 派下级（10-27，派 9）：helm 和 dock 都用同一套六项——做什么（what）、之间的联系（link，共用的一段在 whole）、项目情境（situation，共用的在 shared）、
// 工作等级（level）、同层分工（系统列，dock 可补 peers）、必要规则（rules，大多数块是空的）。怎么做、怎么验不写，由下级判断。
// 派出时要写的是 请求必填 加 level；登记只要 name、role、what 一句（needs、level 可写）。
export const 分工字段 = ['name', 'what', 'link', 'situation', 'rules', 'peers']
export const 请求必填 = ['name', 'what', 'link', 'situation']

/** 模型常把栏名（或照着示意写的那句）写在内容开头；请求和派出那一节自己会加栏名，这里去掉，免得「做什么：做什么：」（10-23-3 真跑）。 */
const 栏名开头 = {
  what: /^\s*做什么\s*[:：]\s*/,
  link: /^\s*(?:之间的)?联系\s*[:：]\s*/,
  situation: /^\s*(?:项目)?情境(?:与(?:这一(?:块|部分)的)?矛盾)?\s*[:：]\s*/,
  rules: /^\s*(?:必要)?规则\s*[:：]\s*/,
  peers: /^\s*同层分工\s*[:：]\s*/,
  whole: /^\s*(?:我要做的|之间的联系)\s*[:：]\s*/,
}
export const 栏内容 = (key, value) => 栏名开头[key] ? String(value ?? '').replace(栏名开头[key], '') : value
/**
 * blocks 每一项的格子（设计页第三版第四节）：key 写新的一块，id 写表上已有的一块（派出登记着的、接着用同一阶段交回过的子 dock、去掉）；
 * role 是 dock 或 run（里面还有几个整体的 dock，一个整体的 run，整 2；外部 agent 只能是 run）；level 是工作等级（派 6、派 9）；dispatch 为 false 只登记；needs 是它依赖的 p 编号（或同一份里的 key）；
 * bench 是台的目录，派的时候写（helm 派的总 dock 不写，它的空间是整份成品）；executor 只给 run；remove 去掉；
 * with_user 是这一块在哪儿和用户协作（协 2，只给 dock）。
 */
export const 块格们 = Object.freeze(['key', 'id', 'name', 'role', 'level', 'dispatch', 'needs', 'bench', ...分工字段.filter(k => k !== 'name'), 'executor', 'with_user', 'remove'])
const Block参数 = { type: 'object', properties: {
  key: { type: 'string', minLength: 1, description: '新的一块：本表唯一的任务标识' },
  id: { type: 'string', description: '表上已有的块：派出登记着的、接着用同一阶段交回过的子 dock，或去掉一块' },
  role: { type: 'string', enum: [...角色们], description: 'dock 或 run：里面还有几个整体、要再分的 dock；一个整体的 run，再密再大也一样；外部 agent 只能是 run' },
  level: { type: 'string', enum: [...节点档位们], description: '工作等级：派出时写；叫回的不写照旧' },
  dispatch: { type: 'boolean', description: 'true 这一轮派出；false 只登记（name、role、expect 一句、needs）。不写算 true' },
  needs: { type: 'array', items: { type: 'string' }, description: '它依赖的 p 编号，也可以写同一份里的 key' },
  bench: { type: 'string', description: '台的目录：你的空间里、相对你的工作目录；派出时要写，目录要已经在' },
  executor: { type: 'string', enum: [...Object.keys(执行者们), DeepSeek执行者], description: '只给 run：交给谁做；不填由 DeepSeek 做' },
  with_user: { type: 'array', items: { type: 'string', enum: [...协作点们] }, description: '只给 dock：这一块在哪儿和用户协作。talk 开头先和用户谈，spark 开头先陪用户想清楚，plan 方案给用户审，accept 交回前用户亲自验收；不写照旧' },
  remove: { type: 'boolean', description: 'true 去掉这一块（写 id）' },
  ...Object.fromEntries(分工字段.map(k => [k, { type: 'string' }])),
} }
/**
 * 这一轮的目的、停点在 plan 交的分工表里；divide 写发给所有分工看的东西和派出的块。
 * 10-23（阶 9、派 4）：这两格摊平在 divide 最外层，和 stage 并排，不再包一层 plan——三次真跑模型三回都直接写在外层。
 */
export const 派人格 = { whole: { type: 'string', description: '之间的联系里共用的那一段：项目总目的是做什么、你这一块的目的；派出时写，这一批的每一份请求都放它' }, shared: { type: 'string', description: '项目情境里这一批共用的已知信息' }, collab: { type: 'string', description: '只给 helm：用户说的这一阶段怎么协作，原样；照默认不写' },
  // 界面上那张表（协 7）：helm 照用户的话记，用户之后也可能自己在界面上改。
  helm_with_user: { type: 'array', items: { type: 'string', enum: ['talk', 'plan', 'accept'] }, description: '只给 helm：用户要在你这一层哪几处参与。talk 开头和你对清楚，plan 你的方案给他审，accept 收口请他验收；照这一阶段的默认不写，一处都不要写空的' },
  parts_with_user: { type: 'array', items: { type: 'string', enum: [...协作点们] }, description: '只给 helm：用户要每一个部分（下面所有 dock）都在哪几处参与，写法同 with_user；只点名某几块的，标在那几块的 with_user' }, blocks: { type: 'array', items: Block参数 } }

/** 这一块派出还是只登记：不写 dispatch 算派出。 */
export const 派出 = b => !b.remove && b.dispatch !== false

/**
 * 块表只有一层：每一块都直接挂在派它的节点下。这里只核对形状：是对象、key 不重复也不是节点编号。
 * 格子对不对、能不能派，由 策略.js 的 验策略块 照名册核对。
 */
export function 验块表(blocks) {
  if (!Array.isArray(blocks)) throw new Error('blocks 是一个数组，一块一项')
  const keys = new Set()
  return blocks.map(b => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('blocks 每一项是一块（一个对象）')
    if (b.key !== undefined) {
      if (typeof b.key !== 'string' || !b.key.trim() || b.key !== b.key.trim() || 是节点号(b.key)) throw new Error(`key「${b.key}」要是有意义的任务标识，不是节点编号`)
      if (keys.has(b.key)) throw new Error(`key「${b.key}」出现了两次`)
      keys.add(b.key)
    }
    return structuredClone(b)
  })
}

/**
 * 台的目录（bench）写成作品仓库里的相对路径：派出者写的是相对它自己工作目录的，派出者自己也在台上的（dock 在上级给的台里），
 * 前面接上它的台。写到工作目录外面、或者写成工作目录本身，抛错说清楚。
 */
export function 台的仓库路径(派出者行, bench) {
  const 文 = String(bench ?? '').trim().replace(/\\/g, '/')
  if (!文) throw new Error('bench 是空的：派出的块要写台的目录')
  if (posix.isAbsolute(文)) throw new Error(`bench「${文}」是绝对路径：写成相对你工作目录的路径`)
  const 段 = posix.normalize(文).replace(/\/+$/, '')
  if (段 === '.' || !段) throw new Error(`bench「${文}」是你的工作目录本身：台是它下面的一个目录`)
  if (段 === '..' || 段.startsWith('../')) throw new Error(`bench「${文}」在你的工作目录外面`)
  return posix.join(派出者行?.bench || '', 段)
}

/** 撤掉的字段（2026-10-19）：这一轮的目的、停点和做法都写进了分工表。 */
const 表里有的 = ['approach', 'work_scope', 'later', 'reason', 'synthesis']
const 表里有话 = '这一圈的目的和停点在分工表里（plan 环节用 next 交的），divide 只写 shared 和 blocks'

/** 接到审议、指纹及执行收据。`args` 是 divide 去掉 stage 以后剩下的：shared、blocks（另有内部的 choice、phase、review_id）。 */
export function 接方案(args) {
  if (Object.hasOwn(args, 'plan')) throw new Error('divide 没有 plan 那一层了：shared、blocks 直接写在最外层，和 stage 并排')
  const 旧字段 = Object.keys(args).filter(key => 表里有的.includes(key))
  if (旧字段.length) throw new Error(`divide 不写 ${旧字段.join('、')}：${表里有话}`)
  for (const key of Object.keys(args)) if (!['choice', 'phase', 'review_id', ...Object.keys(派人格)].includes(key)) throw new Error(`divide 不认识字段 ${key}：${表里有话}`)
  if (args.whole !== undefined && typeof args.whole !== 'string') throw new Error('whole 写成一段文字：项目总目的是做什么、你这一块的目的')
  if (args.shared !== undefined && typeof args.shared !== 'string') throw new Error('shared 写成一段文字：分工表里发给所有分工看的东西')
  if (args.blocks !== undefined && !Array.isArray(args.blocks)) throw new Error('blocks 写成数组，一个执行者一块')
  if (!args.blocks?.length) throw new Error('blocks 是空的：一块都没写')
  if (args.blocks.some(b => b && typeof b === 'object' && 派出(b)) && !args.whole?.trim()) throw new Error('派出了块，whole 要写：项目总目的是做什么、你这一块（helm 是这一阶段）的目的，系统放进这一批每一份请求的「之间的联系」')
  if (args.collab !== undefined && typeof args.collab !== 'string') throw new Error('collab 写成一段文字：用户说的这一阶段怎么协作，原样')
  for (const [key, 可选] of [['helm_with_user', ['talk', 'plan', 'accept']], ['parts_with_user', 协作点们]])
    if (args[key] !== undefined && (!Array.isArray(args[key]) || args[key].some(点 => !可选.includes(点)) || new Set(args[key]).size !== args[key].length))
      throw new Error(`${key} 是一组协作点，每样写一次：${可选.join('、')}`)
  if (args.parts_with_user?.includes('talk') && args.parts_with_user.includes('spark')) throw new Error('parts_with_user：talk 和 spark 都是开头和用户谈，选一个')
  return { choice: args.choice, phase: args.phase, review_id: args.review_id, blocks: args.blocks,
    ...(args.whole?.trim() ? { whole: 栏内容('whole', args.whole.trim()) } : {}),
    ...(args.shared?.trim() ? { shared: args.shared.trim() } : {}),
    ...(args.collab?.trim() ? { collab: args.collab.trim() } : {}),
    ...(args.helm_with_user !== undefined ? { helm_with_user: [...args.helm_with_user] } : {}),
    ...(args.parts_with_user !== undefined ? { parts_with_user: [...args.parts_with_user] } : {}),
  }
}

/** 派出那一节的标题；结构段里它前面是 plan 交的分工表，重新派出只换这一节（2026-10-19）。 */
export const 派出标题 = '### 这一轮派出'

/** 可读的派出一节由已提交的内容生成；派人落册后仅把引用补成真实编号。机器的小标题是 ###，节点写的文字里的标题从 #### 起（选 32）。 */
export function 方案正文(args, blocks = args.blocks || []) {
  const lines = [派出标题]
  if (args.whole?.trim()) lines.push(`共用的联系：${栏内容('whole', args.whole.trim())}`)
  if (args.shared?.trim()) lines.push(`共用的情境：${标题下沉(args.shared.trim(), 4)}`)
  if (args.collab?.trim()) lines.push(`用户这一阶段要的协作：${args.collab.trim()}`)
  const 说 = 点们 => 点们.length ? 点们.map(点 => 协作点说法[点]).join('、') : '不找用户'
  if (args.helm_with_user) lines.push(`用户在 helm 这一层：${说(args.helm_with_user)}`)
  if (args.parts_with_user) lines.push(`用户在每一个部分：${说(args.parts_with_user)}`)
  for (const b of blocks) {
    const 号 = [b.id || b.key || '新节点', b.p].filter(Boolean).join(' ')
    const 依赖 = (b.needs?.length ? ` · 依赖 ${b.needs.join('、')}` : '') + (b.with_user?.length ? ` · 和用户：${b.with_user.map(点 => 协作点说法[点]).join('、')}` : '')
    if (b.remove) { lines.push(`${号}${b.name ? ` · ${b.name}` : ''} · 去掉`); continue }
    if (!派出(b)) { lines.push(`${号} · ${b.name || ''} · ${b.role || ''} · 登记 · ${栏内容('what', b.what) || ''}${依赖}`); continue }
    const 栏 = (名, k) => b[k]?.trim() ? [`  ${名}：${栏内容(k, b[k])}`] : []
    lines.push(`${号} · ${b.name || ''} · ${b.role || ''}${b.level ? ` · ${b.level}` : ''} · 派出${依赖}`, ...(b.bench?.trim() ? [`  台：${b.bench}`] : []),
      ...栏('做什么', 'what'), ...栏('之间的联系', 'link'), ...栏('项目情境', 'situation'), ...栏('必要规则', 'rules'), ...栏('同层分工补充', 'peers'))
    if (b.executor) lines.push(`  执行者：${b.executor === DeepSeek执行者 ? 'DeepSeek' : 执行者们[b.executor]?.名字 || b.executor}`)
  }
  return lines.filter(Boolean).join('\n')
}

/**
 * 结构段：plan 交的分工表在前，派出那一节接在后面。结构段里已有的派出一节（上一次派出、送审时写的）整节换掉，不叠加；
 * 没有分工表（没走 plan 的旧项目）就只有派出那一节。
 */
export function 结构文本(现有结构, args, blocks) {
  const 正文 = 方案正文(args, blocks), 文 = String(现有结构 || '')
  const 起 = 文.search(new RegExp(`^${派出标题}[ \t]*$`, 'm'))
  const 表 = (起 < 0 ? 文 : 文.slice(0, 起)).trimEnd()
  return 表 ? `${表}\n\n${正文}` : 正文
}
