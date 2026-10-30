/**
 * @blueprint/studio —— 把 studio 这张脸接到 dsh 上。
 *
 * 一个消费者插件。它占两件事:
 *   ① 在 ctx.webServer 上挂一条 prefix 路由(默认 /studio),只给新界面提供数据接口（旧页面 10-15 下线，访问 /studio/ 转到新界面）;
 *      外加一条 POST /studio/api/project —— 建项目(先建文件夹,再开 Blueprint,cwd 指过去),
 *      与两条只读的 GET:/studio/api/files?session=<id> 列这个项目那个文件夹的文件树,
 *      /studio/api/file?session=<id>&位置=<格> 读其中一个文件的正文;
 *      以及 /studio/preview/<session>/<位置> —— 节点用 `preview` 摆出去那扇窗
 *      加载的就是这一条(按真 content-type 吐字节,相对资源跟着活,不许缓存);
 *   ② 把 dsh 的会话事件**在服务端**翻译成 stream-render.js 认的形状,
 *      实时走 SSE(/studio/api/stream),历史走一次性 JSON(/studio/api/history)。
 *
 * 为什么翻译在服务端(工单第 2 件的 A 路):前端只认我们自己的形状,不绑 dsh 的私有
 * wire 协议(api-proxy 的 SSE 帧)。它改协议,碎的是这一个文件,不是那张脸。
 *
 * 零暗层:每一条会话事件都必须有落点 —— 要么画出来,要么归进「结构性」(已并入别的块),
 * 要么归进「未画出」并逐类报数。三个筐加起来必须等于事件总数,由历史 API 保留诊断计数。
 */

import { readFile, readdir, mkdir, stat, open, rmdir, copyFile, writeFile, rename } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { 创建图纸实时 } from './图纸实时.js'
import { 读树账本 } from './树账本.js'
import { 创建树摘要盘 } from './树摘要盘.js'
import { 创建会话快照读取 } from './会话快照读取.js'
import { 接项目分组 } from './项目分组.js'
import { 项目名称HTTP } from './项目名称入口.js'
import { 协作HTTP } from './协作入口.js'
import { 读协作设置 } from '../../node/src/协作设置.js'
import { 自动项目目录名, 读项目名称, 项目显示名 } from '../../node/src/项目名称.js'
import { 请求提示统计, 字符数 } from './提示统计.js'
import { 展开工具调用 } from '../../node/src/通用工具.js'
/* **界面不动，只换数据的出处**（2026-09-24 重建）：原来从 archive／arc／旧 roster／prompt 拿的那些，
   现在全从 `名册视图.js` 拿 —— 它把新名册折成这张脸原来认的形状，名字一一对应。 */
import {
  文档夹名, 文档夹, 现行, 现行们, 取现行, 是身份, 扫, 拆信封行, 全名, 默认座位,
  等着的, 等用户输入, 用户叫停的, 关停了的, 交齐的, 捞醒, 被接出, 接续, 欠着的, 待返工, 同层还没做完,
  Blueprint号, 父号, 名册, 我是谁, 会话的模型, 全局模型, 改模型, 壳文, 读到的文件, 项目会话, 座位们Of, 座位记忆Of,
} from './名册视图.js'
/* 建项目：`node` 的 `建项目()`，跟 `/blueprint` 命令同一份实现（协议 2.2）。 */
import { 建项目, 开工作, 准备新阶段, 删除分身, 删除项目, 项目夹, 准备节点续工, 重启节点 } from '../../node/src/index.js'
import { 停下等回条 } from '../../node/src/纸条等待.js'
import { 数据根, 项目存储, 项目位置们, 项目父目录 } from '../../prompt/src/路径.js'
import { 项目存储HTTP } from './项目存储入口.js'
import { 创建首页动画记录, 首页动画HTTP } from './首页动画记录.js'
import { 项目请求上限 } from '../../node/src/项目附件.js'
import { 纸条等待事件, 条件等待事件 } from '../../node/src/纸条等待.js'
import { 是用户续工输入, 是回话停下, 是用户回话, 等用户回话的, 是开工调用, 调的工具 } from '../../node/src/规则.js'
import { 记定稿审核回答 } from '../../node/src/定稿审核.js'
import { 拼公共前缀, 节点提示身份 } from '../../context/src/index.js'
import { 子run提供方们 } from '../../context/src/程序协助.js'
import { 节点本体技能名 } from '../../prompt/src/index.js'
import { 扫问答, 写问答, 验人工回答 } from '../../roster/src/问答.js'
import { 接问答链, 创建恢复送答, 标记提醒已读, 通过项目待审核 } from './问答链.js'
import { 自动回答, 自动批准 } from '../../node/src/回答.js'
import { 复查项目等待 } from '../../node/src/条件等待.js'
import { dirname, resolve, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { 产物路径, 续产物引用, 定位产物引用, 产物范围, 汇集产物, 安全产物文件, 允许本机打开, 打开本地产物 } from './产物.js'
import { 检查产物 } from '../../node/src/产物.js'
import { 创建材料目录, 材料分页 } from './材料.js'
import { 创建任务廊预览 } from './任务廊预览.js'
import { 列目录 } from './文件夹.js'
import { 发送预览文件 } from './预览.js'
import { createConnectionManager, connectionHandler } from './连接.js'
import { 项目操作会话, 检查项目操作 } from './项目操作.js'
import { 文字路径 } from '../../prompt/src/路径.js'
import { 读技能选择, 写技能选择, 规范技能选择, 退役技能名 } from '../../prompt/src/项目技能.js'
import { 排队 as 项目排队 } from '../../roster/src/index.js'
import { 对账回话提醒 } from './回话提醒.js'
import { 协作模式们 } from '../../prompt/src/index.js'
import { assembleAssistantStream, lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm'
import { 会话观察, 会话目录, 会话地址, 实时输出 } from './实时输出.js'
import { 接运行状态 } from './运行状态.js'
import { 接工作计时, 历史工作毫秒 } from './工作时间.js'
import { 读取项目计量 } from './项目计量.js'
import { 译, 设界面语言, 服务端语言 } from './界面语言.js'
import { 停止会话后台 } from './停止后台.js'
import { 读取外部协助, 原生外部运行, 停止外部协助, 外部运行状态, 项目外部目录 } from './外部协助.js'
import { 终端HTTP, 可关闭节点终端, 关闭项目节点终端 } from './终端.js'
import { 持续目标操作, 停用会话持续目标 } from './持续目标.js'
import { 执行能力操作 } from './执行能力.js'
import { 子代理HTTP } from './子代理.js'
import { 软件HTTP } from './软件.js'
import { 创建帮助助理, 助理权限 } from './助理.js'
import { 外部run视图HTTP } from './外部run视图.js'
import { 外部run文件页 } from './外部run产物.js'
import { 节点信息HTTP } from './节点信息.js'
import { 验子代理设置 } from '../../node/src/子代理开关.js'
import { 外部run清单, 听外部run变化, 停外部run, 停项目外部run } from '../../node/src/外部run.js'
import { 列残留进程, 停残留进程 } from '../../node/src/残留进程.js'
import { 消息来自, 来源显示, 工具调用Of, 工具结果Of, 工具结果失败 } from '../../context/src/消息协议.js'
import { 是重建消息 } from '../../context/src/拼.js'

export const name = 'blueprint-studio'
const 历史等待事件 = new Set([纸条等待事件, 条件等待事件, `plugin:${纸条等待事件}`, `plugin:${条件等待事件}`])

/** 这张脸挂在哪。 */
export const 默认挂载 = '/studio'

/**
 * 界面上改一个已有文件：先把旧的留一份进同一个根下的 `旧/`（带时间戳，不覆盖别的备份），再原子写。
 * `留旧: false` ＝ 只原子写（那一片自己在 git 里）。
 */
async function 盖掉(根, 绝对, 相对, 内容, { 留旧 = true } = {}) {
  const 戳 = new Date().toISOString().replace(/[:.]/g, '-')
  if (留旧) {
    const 备份 = join(根, '旧', `${String(相对).split('/').join('__')}.${戳}`)
    await mkdir(dirname(备份), { recursive: true })
    await copyFile(绝对, 备份)
  }
  const 临时 = `${绝对}.${process.pid}.${Date.now()}.tmp`
  await writeFile(临时, 内容, 'utf8')
  await rename(临时, 绝对)
}
/* 只声明**必需**的三条。sessionController／subagents（说话、停、分叉借它们的现成实现）刻意不写进来 ——
   写进来它们就成了必需项，没挂的部署会整个起不来。
   可选服务的取法是运行时 `ctx.get('sessionController')`，取不到就如实说没有。
   （dsh 0.1.5 删掉了整个 `apiProxy`，换成这几个 controller —— `参考/dsh/packages/api/README.md`。）
   （dsh 全仓库的 inject 都只有数组形式，没有 required/optional 那种写法。） */
/* llm／web／agentDefaultModel 不是界面的事 —— 座位卡上的设备要,界面这层只是把它们传下去。 */
export const inject = ['webServer', 'sessionPersistence', 'agents', 'sessions', 'llm', 'web', 'agentDefaultModel', 'settings', 'credentials']

const HERE = dirname(fileURLToPath(import.meta.url))

/* 结构性:这条事件的内容已经在别的块里画出来了,不是被吞掉。
   assistant/chunk 组装成 assistant/message;tool/call 是 assistant/message 里的
   toolCall 块;turn/step 的边界变成底部统计条与轨迹页的时长。

   `turn/end` **不在这里** —— 2026-08-17 起它自己出一条条目(轮尾行),
   见 fold() 里的 turnTail。它从「结构性」挪进了「画出来的」那个筐。 */
const STRUCTURAL = new Set([
  'turn/start', 'step/start', 'step/end',
  'assistant/chunk', 'tool/call', 'session/end-seed',
  'compaction/start', 'compaction/end',
  /* 子级创建后的目录记录；创建过程已有 spawn 工具及回执，不另作对话消息。 */
  'subagent/catalog',
  /* dsh 每次 web 搜索发出前记的一条 log-only 事件(端点、api 版本、不含密钥的
     请求体,`参考/dsh/docs/persistence-catalog.md` 标着 log-only)。
     **搜索这件事已经在别的块里画过了**:座位自己搜是 tool/call ＋回执;
     再画一遍底层请求体就是同一件事的第三份表示。 */
  'web/deepseek-search-llm-request',
])

// 暂停可能发生在第一个响应片段之前；空尝试的状态已由轮尾表达。
const structuralEvent = ev => STRUCTURAL.has(ev.type)
  || (ev.type === 'assistant/attempt' && !ev.data?.stream?.length)

// ---------------------------------------------------------------- 翻译

const textOf = (blocks) => (Array.isArray(blocks) ? blocks : [])
  .filter((b) => b && b.type === 'text').map((b) => String(b.text ?? '')).join('\n')

/* dsh 的 tool-call.arguments 是**未解析的 JSON 字符串**,渲染器要对象。
   解析失败不许静默吞掉 —— 把失败原因和原始字符串一起摆进参数对象,
   它会原样出现在那一行点开后的 args 里。 */
function parseArgs(raw) {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'string') return typeof raw === 'object' ? raw : { 值: raw }
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : { 值: v }
  } catch (e) {
    return { 参数解析失败: String((e && e.message) || e), 原始参数: raw }
  }
}

/* dsh 的内容块 → 渲染器的内容块。认不出的原样透传:
   渲染器会画「(未识别内容块 X,原文在会话文件)」—— 那就是它的落点。 */
function assistantContent(blocks) {
  const out = []
  for (const c of Array.isArray(blocks) ? blocks : []) {
    if (!c || typeof c !== 'object') continue
    if (c.type === 'text') out.push({ type: 'text', text: String(c.text ?? '') })
    else if (c.type === 'reasoning') out.push({ type: 'thinking', thinking: String(c.text ?? '') })
    else if (c.type === 'tool-call') out.push({ type: 'toolCall', id: c.id, name: c.name, arguments: parseArgs(c.arguments) })
    else out.push(c)
  }
  return out
}

/* TokenUsage(dsh)→ 渲染器账单。dsh 的四个数是**互不重叠**的:
   计费输入 = inputTokens + cacheReadTokens + cacheWriteTokens。
   五个字段一个不丢地传过去,渲染器那边照单画。 */
function usageOf(u) {
  if (!u || typeof u !== 'object') return undefined
  return {
    input: u.inputTokens || 0,
    output: u.outputTokens || 0,
    reasoning: u.reasoningTokens || 0,
    cacheRead: u.cacheReadTokens || 0,
    cacheWrite: u.cacheWriteTokens || 0,
  }
}

const oneLine = (s, n) => {
  const line = String(s ?? '').split('\n').find((l) => l.trim()) ?? ''
  const a = [...line.trim()]
  return a.length > n ? `${a.slice(0, n).join('')}…` : a.join('')
}

/** 同一条事件在回放和实时使用同一轮号；收件盒条目可能属于下一轮，不能按当前轮猜。 */
export function 事件轮号(ev, openTurn = null) {
  const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null
  const own = number(ev.data?.turn)
  return own !== null ? own : ev.type === 'agent/inbox/spliced' ? null : number(openTurn)
}

/** 只钉原始事件的坐标；不改变消息正文或其渲染类型。 */
export function 钉事件坐标(entry, ev, openTurn = null) {
  if (!entry) return entry
  entry.seq = ev.seq
  const turn = 事件轮号(ev, openTurn)
  if (turn !== null) entry.turn = turn
  if (typeof ev.data?.step === 'number' && Number.isFinite(ev.data.step)) entry.step = ev.data.step
  return entry
}

function 模型失败抬头(failure) {
  if (failure?.code === 'TIMEOUT') return '响应超时 · 长时间未收到新内容'
  if (failure?.code === 'RATE_LIMIT') return '接口限流 · 服务暂时不接请求'
  return '模型响应失败'
}

/* 一条会话事件 → 一条渲染器条目,或 null(结构性 / 未画出)。 */
export function entryOf(ev, 料 = null) {
  switch (ev.type) {
    case 'subagent/catalog':
      return ev.data?.mode === 'external' ? { type: 'blueprint.external', data: {
        id: ev.data.childId, label: ev.data.label || ev.data.childId, createdAt: ev.data.childCreatedAt,
        status: 'unknown', canStop: false,
      } } : null
    case 'user/message': {
      const m = ev.data || {}
      const src = m.source || {}
      /* 真的是用户说的话 —— 摆在用户那一侧 */
      if (src.kind === 'user') {
        /* time 是这一条的时钟 —— 你说的话下面那行动作条要它(dsh 同款) */
        /* 文字保留原来的合并口径；附件保留 dsh 的耐久引用，不在投影里读盘或重新上传。 */
        const attachments = (Array.isArray(m.content) ? m.content : [])
          .filter((b) => b && (b.type === 'image' || b.type === 'file')).map((b) => ({ ...b }))
        return { type: 'message', message: { role: 'user', time: ev.time,
          content: [{ type: 'text', text: textOf(m.content) }, ...attachments] } }
      }
      /* 垫进去的上下文(插件注入、子 agent 转达、别的会话的快照…)不是用户说的话。
         摆在用户那一侧就是伪造发言人 —— 它走「记」那一行,点开是全文。 */
      const who = 来源显示(m)
      const form = src.form ? ` · ${src.form}` : ''
      /* 抬头说人话 ——「垫入 图景 v3」,不是「垫入插件名」。
         返程路摆进 observation:点开那一行要看得见它回哪儿去,
         否则这一条就成了一段没有出处的文本(压缩纪律:压缩物必须留返程路)。 */
      return {
        type: 'blueprint.event',
        event: {
          id: `seq${ev.seq}`, actor: who, kind: `user/message · ${src.kind || '?'}${form}`,
          /* 弧递的话（出生包、新到的、接着干）：抬头印它的第一行，一眼看得出是哪一种（2026-09-16）。 */
          headline: 是重建消息(m) ? '节点文档重建（压缩后按文档摆回的那一条）'
            : who === 'blueprint-context' ? '节点前缀（出生时摆在最前面的那一条）'
            : who === 'blueprint-node' ? `叫醒 · ${oneLine(textOf(m.content), 30)}`
              : who === 'blueprint-摘要' ? '摘要指令（context 用到七成）'
                /* 座位卡的 assemble 只留 blueprint:* 那几段（context 包），dsh 这一路垫进来的就只剩末尾复述 */
                : 消息来自(m, 'runtime-context') ? `末尾复述 · ${oneLine(textOf(m.content), 30)}`
                  : `垫入 ${who}${src.summary ? ` · ${oneLine(src.summary, 40)}` : ''}`,
          action: textOf(m.content),
          ...(src['返程路'] ? { observation: `返程路 ${src['返程路']}` } : {}),
        },
      }
    }
    case 'assistant/message':
      return {
        type: 'message',
        message: {
          role: 'assistant',
          ...(Number.isFinite(ev.time) ? { time: ev.time } : {}),
          content: assistantContent(ev.data?.message?.content),
          usage: usageOf(ev.data?.usage),
        },
      }
    case 'assistant/attempt': {
      const stream = ev.data?.stream || []
      if (!stream.length) return null
      const reason = lastAssistantStreamChunk(stream, 'finish')?.reason
      const blocks = assembleAssistantStream(stream).blocks()
      const content = blocks.map(block => block.type === 'text' ? block.text
        : block.type === 'reasoning' ? `思考：\n${block.text}`
          : block.type === 'tool-call' ? `未执行的工具请求 ${block.name}：\n${block.arguments}`
            : JSON.stringify(block)).join('\n\n')
      return { type: 'blueprint.event', event: {
        id: `seq${ev.seq}`, actor: '模型', kind: '模型响应', attempt: true,
        headline: reason?.kind === 'error' ? 模型失败抬头(reason.failure) : '模型响应中断',
        action: content ? `已收到的部分内容：\n${content}` : '中断前没有收到正文。',
        observation: reason?.failure
          ? `${reason.failure.code || ''} ${reason.failure.message || ''}`.trim()
          : '此次响应未完成，已收到的部分内容保留在此处。',
      } }
    }
    case 'llm/retry': {
      const data = ev.data
      const 次数 = Number.isSafeInteger(data.maxRetries) ? `${data.retry}/${data.maxRetries}` : `第 ${data.retry} 次`
      const 秒 = Math.max(1, Math.ceil(data.delayMs / 1000))
      return { type: 'blueprint.event', event: {
        id: `seq${ev.seq}`, actor: '系统', kind: '模型重试', retry: true,
        headline: `等待约 ${秒} 秒后自动重试（${次数}）`,
        action: 模型失败抬头(data.failure),
        observation: JSON.stringify(data, null, 2),
      } }
    }
    case 'llm/retry-started':
      return { type: 'blueprint.event', event: {
        id: `seq${ev.seq}`, actor: '系统', kind: '模型重试', retry: true,
        headline: `第 ${ev.data.retry} 次自动重试已开始`,
        action: '系统已结束等待，开始重新请求模型。',
        observation: JSON.stringify(ev.data, null, 2),
      } }
    case 'tool/ptc-dispatch-start': {
      const call = 工具调用Of(ev)
      if (!call) return null
      const display = 调用展示(call.name, call.arguments)
      return { type: 'blueprint.tool', toolCallId: call.callId, parentCallId: call.parentCallId,
        toolName: display.name, args: parseArgs(display.argsRaw), time: ev.time }
    }
    case 'tool/ptc-dispatch':
    case 'tool/result': {
      const blk = 工具结果Of(ev) || {}
      return {
        type: 'message',
        message: {
          role: 'toolResult',
          toolCallId: blk.toolCallId,
          content: blk.content || [],
          isError: 工具结果失败(ev),
        },
      }
    }
    /* 账本正文是实发内容，当前文件是可查看的来源。分别展示，不相加。
       工具与动态提示按最近请求计量；数据缺失时仍显示这条系统原文。 */
    case 'system/message': {
      const 全文 = textOf(ev.data?.message?.content)
      const 来源 = (料?.料单 || []).map(r => ({ ...r, 组: r.组 === '公共前缀' ? '系统正文来源（当前文件）'
        : r.组 === '工具说明书' ? '工具说明来源（当前文件）' : r.组 }))
      const 料单 = [{ 组: '实际系统正文', 名: '这一条的全文（账本原文）', 全文, 字数: 字符数(全文) }, ...来源]
      if (料?.工具定义?.length) 料单.push({ 组: '最近请求的工具定义', 名: '工具说明与参数结构（账本原文）',
        全文: JSON.stringify(料.工具定义, null, 2), 字数: 料.统计?.工具定义 ?? 字符数(JSON.stringify(料.工具定义)),
        注: '字数按紧凑 JSON 计，展开时格式化便于阅读' })
      return { type: 'custom', customType: 'blueprint.system_prompt', data: {
        料单, 注: 料?.注 || '', 统计: { ...料?.统计, 系统正文: 字符数(全文) },
      } }
    }
    /* 请求头:这一格用哪个模型、手上几把工具。一行,点开是工具名单。 */
    case 'request/header': {
      const h = ev.data?.header || {}
      const cfg = h.config || {}
      const tools = (h.tools || []).map((t) => t.name)
      return 会话行(ev, `模型 ${cfg.provider ?? '?'} / ${cfg.model ?? '?'} · 工具 ${tools.length} 把`, tools.join('\n'))
    }
    /* 第一层压缩收起一条工具结果（context 包的 `收起()`）：节点那边这一条只剩一句占位，
       全文存在 `系统文档/过程/<号>/<callId>.txt`，节点用 `pull` 的 `past` 读得回来。 */
    case 'compaction/prune':
      return 会话行(ev, `收起了 ${(ev.data?.shadowedSeqs || []).length || 1} 条工具结果（约 ${ev.data?.shadowedTokenCount ?? '?'} token）`
        + ' —— 节点那边只剩一句占位，全文在 系统文档/过程/')
    case 'compaction/summary':
      return {
        type: 'compaction',
        tokensBefore: ev.data?.shadowedTokenCount,
        summary: textOf(ev.data?.summary),
      }
    case 'todo/write': {
      const list = ev.data?.todos || []
      return {
        type: 'blueprint.event',
        event: {
          id: `seq${ev.seq}`, actor: 'agent', kind: 'todo/write',
          headline: `待办 ${list.length} 条`,
          action: list.map((t) => `[${t.status ?? ''}] ${t.content ?? ''}`).join('\n'),
        },
      }
    }
    /* ---- 会话自己写下的那几条(2026-08-26 补) ----
       在这之前它们全落在「未画出」那个筐里 —— 每建一个新项目，粉框就报一次 7 条。
       它们不是噪音:沙箱开到哪一档、审批要不要问、走哪个模型多大 context、
       这场对话叫什么名字是谁起的，全在这儿，不画就是暗层。

       **一条事件一行，不合并成「开场块」**:seq 0/1/2 是挨着的，可 session/title
       那三条夹在第一条用户消息后面(实测 seq 12–16)。合并会撒谎说它们同时发生，
       也会把「轨迹 → 对话」那一跳要的 seq 锚点弄丢(一个 entry 只钉得住一个 seq)。 */
    case 'permission/preset':
      return 会话行(ev, `权限档位 ${ev.data?.preset ?? '?'}`)
    case 'sandbox/mode':
      return 会话行(ev, `沙箱 ${ev.data?.mode ?? '?'}`)
    case 'approval/policy':
      return 会话行(ev, `审批策略 ${ev.data?.policy ?? '?'}`)
    case 'request/context':
      return 会话行(ev, `模型 ${ev.data?.provider ?? '?'} / ${ev.data?.model ?? '?'}`
        + (ev.data?.contextWindow ? ` · context ${ev.data.contextWindow}` : ''))
    case 'session/title': {
      const src = ev.data?.source || {}
      /* 标题有两个来路:先落一个截头一句的占位，小模型答完再盖一版。
         两条都画 —— 只画后一条，页面就会显得标题是凭空变出来的。 */
      const 谁 = src.kind === 'fallback' ? '占位 · 截你第一句'
        : src.kind === 'provider' ? `${src.provider ?? '?'} 起的`
          : String(src.kind ?? '?')
      return 会话行(ev, `标题「${oneLine(ev.data?.title, 30)}」—— ${谁}`)
    }
    case 'session/title-llm-request':
      /* 点开是这次起标题真正送出去的 system prompt —— 跟 request/header 同一条纪律:
         模型被告知了什么，必须有地方看得见。 */
      return 会话行(ev, `起标题 · 送给 ${ev.data?.route?.provider ?? '?'} / ${ev.data?.route?.model ?? '?'}`,
        ev.data?.system)
    default:
      return null
  }
}

/**
 * **一条事件身上的块印** —— 【取】【进】【出】那几行信封。
 * 写在 `信封行()`，认在 `拆信封行()`，两头同一个出处；这儿一个字都不自己认。
 *
 * 只有两种事件带得动它：工具结果（自己拉的全文、自己落的档）和 user/message
 * （弧递进来的那张信封清单）。别的原样返回 null —— 普通正文里出现一行长得像
 * 信封的字，`拆信封行()` 自己会退回 null。
 *
 * **对话流那一排词块的粒度就是这个函数**：一条事件 ＝ 一步 ＝ 屏幕上一排，
 * 挂在它出自的那一行底下。信息流那页仍按轮汇总（`一行一轮()`）——
 * 两页粒度不同，认的是同一行信封。
 *
 * @returns {{进: object[], 出: object[]}|null} 一个印都没有就是 null
 */
function 块印们(ev) {
  const 文 = ev.type === 'user/message' ? textOf(ev.data?.content)
    : ['tool/result', 'tool/ptc-dispatch'].includes(ev.type) ? textOf(工具结果Of(ev)?.content)
      : ''
  if (!文.includes('【')) return null   /* 绝大多数事件在这一行就走了 */
  const 见 = new Set()
  const 进 = [], 出 = []
  for (const p of 文.split('\n').map(拆信封行)) {
    if (!p) continue
    /* 同一步里同一块料报两遍只摆一个（一张信封清单里重复列了同一号）。
       **跨步不去重**：弧先报名字、它随后自己去取，那是两个时刻发生的两件事，
       各自长在自己那一步底下才对得上你眼睛看见的顺序。 */
    const 号 = `${p.印} ${p.名} v${p.版本}`
    if (见.has(号)) continue
    见.add(号)
    ;(p.印 === '出' ? 出 : 进).push(p)
  }
  return (进.length || 出.length) ? { 进, 出 } : null
}

/**
 * **出生包那条消息报了哪几份柜子里的料** —— 一条会话里头一条带信封行的消息就是它
 * （弧递的第一条；用户自己说的话里没有信封行，扫过去就是了）。
 *
 * 【取】＝出生包里当场给了全文，【进】＝只给了信封，正文他自己按名取。
 * **认的是 `信封行()` 那一行**，跟词块那一排同一个出处，不另写一套。
 */
function 出生包印们(events) {
  for (const ev of events || []) {
    if (ev.type !== 'user/message') continue
    /* 只认**弧递进来的**那几条（`arc` 递的时候署的就是这个名）。用户自己说的话里
       要是抄了一行信封，不许被当成出生包。头一条就是出生包 —— 后面那几条是「新到」。 */
    if (!消息来自(ev.data, 'plugin:blueprint-arc')) continue
    const 块 = 块印们(ev)
    if (块 && 块.进.length) return 块.进
  }
  return []
}

/** 会话自己那几条的一行。给了正文就点开看得见全文。 */
const 会话行 = (ev, headline, 全文) => ({
  type: 'blueprint.event',
  event: {
    id: `seq${ev.seq}`, actor: '会话', kind: ev.type, headline,
    ...(全文 ? { action: String(全文) } : {}),
  },
})

// ---------------------------------------------- 轨迹:移植 dsh 的 layout.ts
//
// 这一段是**照搬**，不是重新设计。原件：
//   参考/dsh/packages/client/ui-trajectory/src/client/layout.ts（1126 行 TS/React）
//   参考/dsh/packages/client/ui-trajectory/src/client/trajectory-record.ts（记录形状）
//   参考/dsh/packages/client/ui-trajectory/src/client/TrajectoryCell.tsx（一行长什么样）
//
// 搬的是**折叠规则**，不是那 7858 行组件代码：
//   · 一轮(turn)一节，节内分组(Message / Step N / Compaction seq)
//   · 一条 assistant 消息炸成多条记录：正文与想合成一条 Message，每个工具调用各一条 Tool
//   · 七种 kind：system / user / context / compacted / message / tool / subtool
//   · 每条记录的 own-duration，分组头上是墙钟跨度 + 工具直方图（`1.5 s bash×6`）
//   · user/message 在线上没有 turn —— 归进它后面那条 assistant 的 turn（dsh 的规则）
//   · 孤儿 turn 0 折进 Turn 1
//
// **差异（dsh 有、这里没有的）**，逐条列在包 README 里，不许悄悄少：
//   · subtool（run_code 的子调用）—— dsh 从 ToolCallBlock.subCalls 拿，那是它客户端投影
//     里的字段，原始会话事件里没有。这里不会长出 subtool 行。
//   · requestOnly（一次没有任何输出的请求）、partial/runningCalls（正在飞的那一条）——
//     它们来自 dsh 的 RequestView 投影，不是会话事件。实时那条由 SSE 单独喂。
//   · 图片块只留元数据（同 dsh），但没有缩略图。

const TURN_MESSAGE = 'Message'

/** dsh: formatElapsedSeconds —— 秒 → 整数毫秒带千分位，未知是破折号 */
const finite = (t) => (typeof t === 'number' && Number.isFinite(t) ? t : null)
const durationSeconds = (later, earlier) =>
  (earlier === null || earlier === undefined || !Number.isFinite(later) || !Number.isFinite(earlier))
    ? null : Math.max(0, (later - earlier) / 1000)

/** dsh: promptChangeLabel */
function promptChangeLabel(kind) {
  if (kind === 'initial') return 'Initial System Prompt'
  if (kind === 'system') return 'System Prompt Updated'
  if (kind === 'tools') return 'Tools Updated'
  return 'System Prompt and Tools Updated'
}

/* ---------------- 两样东西改叫 context（2026-08-22 用户裁定）----------------
 *
 * **角色 prompt** 和 **初始用户要求那条消息**，原来在轨迹上一个叫 SYSTEM、一个叫 USER。
 * 用户要它们跟垫进来的引用件同一族 —— 理由是它们本来就是同一件事：
 * **在模型开口之前就已经躺在它 context 里的东西。**
 *
 * ⚠️ **只改身份和抬头，一个 token 都不多花**（用户在两条路里选的就是这一条）：
 * 模型看见的东西一个字没变，变的只是这张表怎么称呼它们。
 * 真要再垫一份进对话是另一件事 —— 那会让 7,000 多字的角色 prompt 在 context 里
 * 出现两次，每轮都在缓存前缀里烧一遍。
 *
 * 抬头里的座位名从**柜子**认（`我是谁()`），不是 `agentPreset` —— 子会话原样继承
 * 父亲，认它会把 Helm 标成 Blueprint。认不出来就不写名字，不猜（宁可少一个词，
 * 不许写一个假的）。
 */
const 角色抬头 = (changeKind, 座位) => {
  /* 新系统没有座位：人人读同一份公共前缀（2026-09-24） */
  const 谁 = 座位 ? `角色 ${座位}` : '公共前缀'
  if (changeKind === 'initial') return `【${谁}】（出生时装的${座位 ? ` · 返程路 shells/${座位}.md` : ''}）`
  if (changeKind === 'tools') return `【${谁}】（手上的工具换了一批）`
  if (changeKind === 'system') return `【${谁}】（它读的那几份换了一版）`
  return `【${谁}】（它读的那几份和手上的工具都换了）`
}

/* 初始用户要求 ＝ **这条会话的第一条用户消息**。带着新项目那张表的格式（【名字】…【坐标】…）
   就把坐标印在抬头上，没有就只写「初始用户要求」——格式认不出来时不编。
   坐标那一行里每挡后面跟着一整句说明（「优质（消耗中等、以行业复杂水平为标准）」），
   抬头上只留挡名，全文点开就在。

   ⚠️ **原来叫「开场」，2026-08-26 用户改的**，同一拍还把两挡的正文拼进了这条消息
   （见前端 `openingText()`）。改名不是措辞问题：用户拨的挡、和那两挡到底要求什么，
   本来就是**他拨盘子的同一个动作**。以前挡名在第 0 条、正文在几千 seq 之后
   才端上来，Blueprint 早按自己的猜测开跑了。现在一条消息一次给全，
   名字就得说出它是什么 —— 它是这个项目的初始用户要求，不是一句开场白。 */
function 初始用户要求抬头(text) {
  const t = String(text || '')
  if (!/^【名字】/.test(t)) return '【初始用户要求】'
  const m = /^【坐标】(.*)$/m.exec(t)
  if (!m) return '【初始用户要求】（新项目那张表）'
  const 简 = m[1].replace(/（[^）]*）/g, '').replace(/\s+/g, ' ').trim()
  return `【初始用户要求】（新项目那张表${简 ? ` · ${简}` : ''}）`
}

/** dsh: sourceBlock —— 原始块按模型看见的次序留档，reasoning 改叫 thinking */
function 调用展示(name, args) {
  const actual = 展开工具调用(name, args)
  return { name: actual.name, argsRaw: typeof actual.arguments === 'string' ? actual.arguments : JSON.stringify(actual.arguments ?? {}) }
}

function sourceBlockOf(b) {
  if (!b || typeof b !== 'object') return { type: 'unknown', content: JSON.stringify(b ?? null, null, 2) }
  if (b.type === 'tool-call') {
    const call = 调用展示(b.name, b.arguments)
    return { type: 'tool-call', content: call.argsRaw, callId: b.id, toolName: call.name }
  }
  if (typeof b.text === 'string') return { type: b.type === 'reasoning' ? 'thinking' : b.type, content: b.text }
  return { type: b.type || 'unknown', content: JSON.stringify(b, null, 2) }
}

/** dsh: detailResult */
function detailResult(blk) {
  if (blk.isError) return blk.__errName ? `${blk.__errName}: ${blk.__errCode}` : 'error'
  const t = textOf(blk.content)
  if (t !== '') return t
  if (!(blk.content || []).length) return 'No output'
  return JSON.stringify(blk.content, null, 2)
}

/** dsh: summarizeResult */
function summarizeResult(blk) {
  if (blk.isError) return { result: blk.__errCode || 'error' }
  for (const b of blk.content || []) {
    if (b && b.type === 'text' && typeof b.text === 'string' && b.text !== '') {
      return { result: '', resultPreviewMarkdown: b.text }
    }
  }
  return { result: 'No output' }
}

/** dsh: attachUsage —— 五个计数原样挂上，一个不折 */
function attachUsage(cell, u) {
  if (!u) return
  if (u.inputTokens !== undefined) cell.input = u.inputTokens
  if (u.cacheReadTokens !== undefined) cell.cacheRead = u.cacheReadTokens
  if (u.cacheWriteTokens !== undefined) cell.cacheWrite = u.cacheWriteTokens
  if (u.outputTokens !== undefined) cell.output = u.outputTokens
  if (u.reasoningTokens !== undefined) cell.think = u.reasoningTokens
}

/** dsh: formatElapsedSeconds 的服务端版,给分组头用 */
const fmtSpan = (sec) => (sec === null || !Number.isFinite(sec))
  ? undefined : `${Math.round(sec * 1000).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ms`

/** dsh: groupDescription —— 墙钟跨度 + 工具直方图 */
function groupDescription(laid) {
  const parts = []
  const times = []
  for (const l of laid) {
    if (l.absTime === null) continue
    times.push(l.absTime)
    const c = l.cell
    if (c.kind === 'tool' && c.timeSeconds !== null && Number.isFinite(c.timeSeconds)) {
      times.push(l.absTime + c.timeSeconds * 1000)
    } else if (c.kind === 'message') {
      /* ⚠️ **assistant 那条的 `absTime` 是它「说完」的时刻，不是起点**（`expandAssistant`
         推的是 `finite(node.time)`，真起点在 `startedAt`）。不把起点算进来，一步的跨度
         就从"模型说完"才开始数 —— **整段 LLM 时间凭空消失**：实机上一个组头写着
         19,696 ms，里面那条 assistant 自己就是 491,932 ms（2026-09-09 用户看出来的）。
         旧账本没有 `timing` 时 `startedAt` 是 null，用时长往回推。 */
      const st = Number.isFinite(c.startedAt) ? c.startedAt
        : (Number.isFinite(c.timeSeconds) ? l.absTime - c.timeSeconds * 1000 : null)
      if (st !== null) times.push(st)
    }
  }
  if (times.length >= 2) {
    const s = fmtSpan((Math.max(...times) - Math.min(...times)) / 1000)
    if (s) parts.push(s)
  } else if (times.length === 1) {
    const own = (laid.find((l) => l.absTime === times[0]) || {}).cell?.timeSeconds
    const s = (own !== null && own !== undefined) ? fmtSpan(own) : undefined
    if (s) parts.push(s)
  }
  const tools = new Map()
  for (const l of laid) {
    if (!l.toolName || l.cell.kind !== 'tool') continue
    tools.set(l.toolName, (tools.get(l.toolName) || 0) + 1)
  }
  for (const [n, c] of tools) parts.push(c > 1 ? `${n}×${c}` : n)
  return parts.length ? parts.join(' ') : undefined
}

/**
 * 会话事件 → dsh 形状的「节点」列表。
 * dsh 的客户端有一层 ConversationSnapshot 投影，我们没有——这一步就是补它。
 */
function toNodes(events) {
  const nodes = []
  const stepStart = new Map()
  const firstToken = new Map()
  const callAt = new Map()
  let prevSystem, prevTools

  for (const ev of events) {
    const key = `${ev.data?.turn}/${ev.data?.step}`
    if (ev.type === 'step/start') { stepStart.set(key, ev.time); continue }
    if (ev.type === 'assistant/chunk') { if (!firstToken.has(key)) firstToken.set(key, ev.time); continue }
    const invoked = 工具调用Of(ev)
    if (invoked) {
      callAt.set(String(invoked.callId), { time: ev.time, ...调用展示(invoked.name, invoked.arguments) })
      continue
    }
    if (ev.type === 'user/message') {
      const src = ev.data?.source || {}
      nodes.push({
        kind: src.kind === 'user' ? 'user' : 'context',
        seq: ev.seq, time: ev.time, content: ev.data?.content || [], source: src,
      })
      continue
    }
    if (ev.type === 'assistant/message') {
      const m = ev.data?.message || {}
      nodes.push({
        kind: 'assistant', seq: ev.seq, time: ev.time,
        turn: ev.data.turn, step: ev.data.step,
        blocks: (m.content || []).map((b) => {
          if (b.type === 'text') return { kind: 'text', text: String(b.text ?? '') }
          if (b.type === 'reasoning') return { kind: 'reasoning', text: String(b.text ?? '') }
          if (b.type === 'tool-call') return { kind: 'tool-call', ...调用展示(b.name, b.arguments), callId: String(b.id) }
          return { kind: 'other', block: b }
        }),
        usage: ev.data.usage,
        timing: {
          stepStartTime: finite(stepStart.get(key)),
          firstTokenTime: finite(firstToken.get(key)),
          completedTime: ev.time,
        },
        model: m.source ? `${m.source.provider}/${m.source.model}` : undefined,
      })
      continue
    }
    if (ev.type === 'tool/result' || ev.type === 'tool/ptc-dispatch') {
      const blk = 工具结果Of(ev) || {}
      const callId = String(blk.toolCallId)
      const call = callAt.get(callId) || null
      nodes.push({
        kind: 'tool-result', seq: ev.seq, time: ev.time,
        turn: ev.data.turn, step: ev.data.step,
        callId, callTime: call ? call.time : null,
        call: call ? { name: call.name, argsRaw: call.argsRaw } : null,
        content: blk.content || [], isError: 工具结果失败(ev),
        __errName: ev.data?.error?.name, __errCode: ev.data?.error?.code,
      })
      continue
    }
    if (ev.type === 'request/header') {
      const h = ev.data?.header || {}
      const sysText = h.system ?? ''
      const toolsSig = JSON.stringify((h.tools || []).map((t) => t.name))
      let changeKind
      if (prevSystem === undefined) changeKind = 'initial'
      else if (sysText !== prevSystem && toolsSig !== prevTools) changeKind = 'both'
      else if (sysText !== prevSystem) changeKind = 'system'
      else if (toolsSig !== prevTools) changeKind = 'tools'
      prevSystem = sysText; prevTools = toolsSig
      if (changeKind === undefined) continue      /* 一个字没变的重复 header:不出行 */
      nodes.push({
        kind: 'system', seq: ev.seq, time: ev.time, changeKind,
        prompt: { system: sysText, tools: h.tools || [], config: h.config || {}, reason: ev.data?.reason },
      })
      continue
    }
    if (ev.type === 'compaction/summary') {
      nodes.push({
        kind: 'compacted', seq: ev.seq, time: ev.time,
        summary: ev.data?.summary || [], rawOutput: ev.data?.rawOutput,
        shadowedTokenCount: ev.data?.shadowedTokenCount, usage: ev.data?.usage,
        provider: ev.data?.provider, model: ev.data?.model,
      })
      continue
    }
  }
  return nodes
}

/**
 * dsh: deriveTrajectoryLayout —— 节点 → 轮 → 分组 → 记录。
 * @param {object[]} nodes toNodes 的产物
 * @returns {object[]} [{turn, groups:[{title, description, cells:[…]}]}]
 */
function deriveTrajectory(nodes, 座位) {
  const resultByCall = new Map()
  for (const n of nodes) if (n.kind === 'tool-result') resultByCall.set(n.callId, n)
  const emittedCallIds = new Set()
  for (const n of nodes) if (n.kind === 'assistant') {
    for (const b of n.blocks) if (b.kind === 'tool-call') emittedCallIds.add(b.callId)
  }
  /* 每条节点后面最近的那条 assistant —— user/message 靠它认领 turn */
  const following = new Array(nodes.length)
  { let a; for (let i = nodes.length - 1; i >= 0; i--) { following[i] = a; if (nodes[i].kind === 'assistant') a = nodes[i] } }

  const firstVisibleTurn = (() => {
    const ts = nodes.filter((n) => n.kind === 'assistant' && n.turn > 0).map((n) => n.turn)
    return ts.length ? Math.min(...ts) : 1
  })()
  const enclosingPromptTurn = (seq) => {
    const next = nodes.find((n) => n.seq > seq && n.kind === 'assistant' && n.step > 0)
    return next ? next.turn : 1
  }

  /* 初始用户要求那一条 ＝ 按 seq 最早、**而且带着新项目那张表的格式**（`【名字】` 开头）
     的那条用户消息。分叉出来的线前缀是复制的，所以它在子线上还是同一条 ——
     认「第一条」而不是认 seq 值，正好两边都对。

     ⚠️ **认格式，不认「第一条」**（2026-09-01 改）：建项目那句话 2026-09-01 不再补发了
     （前端 `form.onsubmit` 末尾写着为什么：它排 next-turn，会变成一条延迟九分半的
     过期命令）。只认「第一条」的话，这个抬头会落到**你自己打的第一句话**头上，
     把它画成「开口前就在那儿的东西」—— 而那正是这一格明写不许一锅端的两件事。
     认不出来就没有这一条，不编：真正的那份在柜子里（《初始用户要求》）。 */
  const 初始用户要求节点 = nodes
    .filter((n) => n.kind === 'user'
      && /^【名字】/.test((n.content || []).find((b) => b && b.type === 'text')?.text || ''))
    .sort((a, b) => a.seq - b.seq)[0] || null

  const turns = new Map()
  const standalone = []
  let index = 0
  let prevAbsTime = null
  let lastAssistantTurn = null

  const bucket = (t) => { if (!turns.has(t)) turns.set(t, { groups: [] }); return turns.get(t) }
  const pushMessage = (t, laid) => {
    const g = bucket(t).groups
    const last = g[g.length - 1]
    if (last && last.title === TURN_MESSAGE) { last.laid.push(laid); return }
    g.push({ title: TURN_MESSAGE, laid: [laid] })
  }
  const pushStep = (t, step, list) => {
    if (!list.length) return
    const g = bucket(t).groups
    const title = `Step ${step}`
    const ex = g.find((x) => x.title === title)
    if (ex) { ex.laid.push(...list); return }
    g.push({ title, laid: [...list] })
  }

  /* 排序：initial 那条 system 一律排到最前(dsh 用 -Infinity)，其余按 seq */
  const ordered = [...nodes].sort((a, b) => {
    const ka = (a.kind === 'system' && a.changeKind === 'initial') ? -Infinity : a.seq
    const kb = (b.kind === 'system' && b.changeKind === 'initial') ? -Infinity : b.seq
    return ka - kb
  })
  const posOf = new Map(nodes.map((n, i) => [n, i]))

  /* 这条会话坐的是谁 —— **一条会话一个座位，不会中途换**（柜子说了算，调用方查好递进来）。
     钉到每条 assistant 格上，前端的 ASSISTANT 标签就能写成座位名。 */
  const 当前座位 = 座位 || null

  for (const node of ordered) {
    if (node.kind === 'system') {
      const t = node.changeKind === 'initial' ? firstVisibleTurn : enclosingPromptTurn(node.seq)
      pushMessage(t, {
        absTime: finite(node.time),
        cell: {
          /* kind 是 context，但**节点还是 system** —— 上面那些排序、归轮的规矩
             认的是节点，不是这张表怎么称呼它。改错了地方，initial 那条就不再排最前。 */
          index: ++index, kind: 'context', text: 角色抬头(node.changeKind, 座位),
          messageSource: {
            kind: 'plugin', plugin: 'blueprint-prompt', form: '角色',
            summary: 座位 ? `角色 ${座位}` : '角色',
            ...(座位 ? { 返程路: 'blueprint/packages/prompt/重置/canon.md' } : {}),
            /* dsh 自己那句英文抬头留着 —— 折叠可以有，暗层不能有 */
            dsh原名: promptChangeLabel(node.changeKind),
          },
          sourceSeq: node.seq, promptDetail: node.prompt,
          timeSeconds: 0, startedAt: finite(node.time),
        },
      })
      prevAbsTime = finite(node.time) ?? prevAbsTime
      continue
    }
    if (node.kind === 'compacted') {
      const cell = {
        index: ++index, kind: 'compacted',
        text: textOf(node.summary) ? '' : 'Context compacted',
        previewMarkdown: textOf(node.summary) || undefined,
        sourceSeq: node.seq,
        outputDetail: textOf(node.summary),
        outputBlocks: (node.summary || []).map(sourceBlockOf),
        thinkingDetail: (node.rawOutput || []).filter((b) => b && b.type === 'reasoning').map((b) => b.text).join('\n') || undefined,
        sourceBlocks: (node.rawOutput || node.summary || []).map(sourceBlockOf),
        tokensBefore: node.shadowedTokenCount,
        timeSeconds: null, startedAt: finite(node.time),
      }
      attachUsage(cell, node.usage)
      standalone.push({ groups: [{ title: `Compaction ${node.seq}`, laid: [{ absTime: finite(node.time), cell }] }] })
      prevAbsTime = finite(node.time) ?? prevAbsTime
      continue
    }
    if (node.kind === 'user' || node.kind === 'context') {
      const fa = following[posOf.get(node)]
      const t = fa ? fa.turn : (lastAssistantTurn !== null ? lastAssistantTurn + 1 : 1)
      const 是初始用户要求 = node === 初始用户要求节点
      const 正文 = (node.content || []).find((b) => b && b.type === 'text')?.text
      pushMessage(t, {
        absTime: finite(node.time),
        cell: {
          index: ++index,
          /* 初始用户要求那一条改叫 context（同上那条裁定）；其余用户发言仍然是 user ——
             **「你说的话」和「开口前就在那儿的东西」是两回事**，不许一锅端。 */
          kind: 是初始用户要求 ? 'context' : node.kind,
          text: 是初始用户要求 ? 初始用户要求抬头(正文) : '',
          previewMarkdown: 正文,
          sourceSeq: node.seq,
          messageSource: 是初始用户要求
            ? { ...(node.source || {}), form: '初始用户要求', summary: '初始用户要求' }
            : node.source,
          inputDetail: textOf(node.content),
          sourceBlocks: (node.content || []).map(sourceBlockOf),
          timeSeconds: 0, startedAt: finite(node.time),
          ...(node.kind === 'user' ? { opensTurn: true } : {}),
        },
      })
      prevAbsTime = finite(node.time) ?? prevAbsTime
      continue
    }
    if (node.kind === 'assistant') {
      const list = expandAssistant(node, index + 1, prevAbsTime, resultByCall, 当前座位)
      if (node.step > 0) pushStep(node.turn, node.step, list)
      else for (const l of list) pushMessage(node.turn, l)
      const last = list[list.length - 1]
      if (last) index = last.cell.index
      prevAbsTime = finite(node.time) ?? prevAbsTime
      lastAssistantTurn = node.turn
      continue
    }
    if (node.kind === 'tool-result') {
      /* 没有任何 assistant 认领的孤儿工具结果 —— dsh 把它塞进 turn 0，最后折进 Turn 1 */
      if (!emittedCallIds.has(node.callId)) {
        const preview = summarizeResult(node)
        pushStep(0, 1, [{
          absTime: finite(node.callTime ?? node.time),
          toolName: node.call?.name, callId: node.callId,
          cell: {
            index: ++index, kind: 'tool', sourceSeq: node.seq,
            text: node.call ? node.call.name : (preview.result || ''),
            previewMarkdown: node.call ? (node.call.argsRaw || undefined) : preview.resultPreviewMarkdown,
            inputDetail: node.call ? node.call.argsRaw : undefined,
            outputDetail: detailResult(node),
            outputBlocks: (node.content || []).map(sourceBlockOf),
            ...preview,
            callId: node.callId, isError: node.isError,
            timeSeconds: durationSeconds(node.time, node.callTime),
            startedAt: finite(node.callTime),
          },
        }])
      }
      prevAbsTime = finite(node.time) ?? prevAbsTime
    }
  }

  /* 孤儿 turn 0 折进 Turn 1（dsh 同款） */
  const prologue = turns.get(0)
  if (prologue) {
    turns.delete(0)
    const first = turns.get(1) || { groups: [] }
    first.groups = [...prologue.groups, ...first.groups]
    turns.set(1, first)
  }

  /* anchorSeq —— 分叉锚点。dsh 的 sessions.fork 规则：边界取「**在 atSeq 之后的第一条
     turn/end**」。所以传这一轮里最后一条记录的 seq，切下来的就是「含这一轮为止」。
     一轮还开着（没有 turn/end）时 dsh 会回 fork-unavailable，不会往前切 —— 那是它的保险。 */
  const toModel = (turn, entry) => {
    const seqs = entry.groups.flatMap((g) => g.laid.map((l) => l.cell.sourceSeq)).filter((s) => typeof s === 'number')
    return {
      turn,
      ...(seqs.length ? { anchorSeq: Math.max(...seqs) } : {}),
      groups: entry.groups.map(({ title, laid }) => {
        const description = groupDescription(laid)
        return { title, ...(description ? { description } : {}), cells: laid.map((l) => l.cell) }
      }),
    }
  }
  const firstCellIndex = (t) =>
    Math.min(...t.groups.flatMap((g) => g.cells.map((c) => c.index)), Infinity)
  return [
    ...[...turns.entries()].map(([t, e]) => toModel(t, e)),
    ...standalone.map((e) => toModel(null, e)),
  ].sort((a, b) => firstCellIndex(a) - firstCellIndex(b))
}

/** dsh: expandAssistant —— 一条 assistant 消息炸成 1 条 Message + 每个工具调用 1 条 Tool */
function expandAssistant(node, startIndex, prevAbsTime, results, 座位) {
  const out = []
  let index = startIndex - 1
  const u = node.usage
  const recordedStart = finite(node.timing?.stepStartTime)
  const messageDuration = durationSeconds(node.time, recordedStart ?? prevAbsTime)
  const messageText = node.blocks.filter((b) => b.kind === 'text').map((b) => b.text).join('\n\n')
  const thinkingText = node.blocks.filter((b) => b.kind === 'reasoning').map((b) => b.text).join('\n\n')
  const hasCalls = node.blocks.some((b) => b.kind === 'tool-call')

  const message = {
    index: ++index,
    recordId: `assistant\u0000${node.turn}\u0000${node.step}`,
    kind: 'message', sourceSeq: node.seq,
    text: (messageText !== '' || thinkingText !== '') ? '' : (hasCalls ? 'Tool call only' : ''),
    previewMarkdown: messageText !== '' ? messageText : (thinkingText !== '' ? thinkingText : undefined),
    outputDetail: messageText !== '' ? messageText : undefined,
    thinkingDetail: thinkingText !== '' ? thinkingText : undefined,
    sourceBlocks: node.blocks.map((b) => b.kind === 'tool-call'
      ? { type: 'tool-call', content: b.argsRaw, callId: b.callId, toolName: b.name }
      : b.kind === 'other' ? sourceBlockOf(b.block)
        : { type: b.kind === 'reasoning' ? 'thinking' : 'text', content: b.text }),
    timeSeconds: messageDuration,
    startedAt: recordedStart,
    model: node.model,
    ...(座位 ? { 座位 } : {}),
    turn: node.turn, step: node.step,
    assistantMetrics: {
      timingRecorded: !!node.timing,
      stepStartTime: node.timing?.stepStartTime ?? null,
      firstTokenTime: node.timing?.firstTokenTime ?? null,
      completedTime: finite(node.time),
      usageProvided: u !== undefined,
      outputTokens: (u && Number.isFinite(u.outputTokens)) ? u.outputTokens : null,
    },
  }
  attachUsage(message, u)
  out.push({ absTime: finite(node.time), cell: message })

  for (const b of node.blocks) {
    if (b.kind !== 'tool-call') continue
    const result = results.get(b.callId)
    const preview = result ? summarizeResult(result) : undefined
    const callAbs = result ? finite(result.callTime) : null
    out.push({
      absTime: callAbs, toolName: b.name, callId: b.callId,
      cell: {
        index: ++index, kind: 'tool',
        text: b.name,
        previewMarkdown: b.argsRaw === '' ? undefined : b.argsRaw,
        inputDetail: b.argsRaw, callId: b.callId,
        turn: node.turn, step: node.step,
        ...(result ? {
          outputDetail: detailResult(result),
          outputBlocks: (result.content || []).map(sourceBlockOf),
          ...preview,
          isError: result.isError,
          sourceSeq: result.seq,
        } : {}),
        timeSeconds: result ? durationSeconds(result.time, result.callTime) : null,
        startedAt: callAbs,
      },
    })
  }
  return out
}

/**
 * 一条 `turn/end` → 轮尾行条目。这是 dsh 那张脸上每一轮末尾那一行的全部原料。
 *
 * 一轮没跑过任何一步(空转、开头就被打断)就不出这一行 —— 那一行会是一排破折号,
 * 等于在页面上占一格说「什么都没有」。没有就是没有,不画。
 *
 * @param {object} ev turn/end 事件
 * @param {Map<number, number>} turnAt turn → turn/start 的时刻
 * @param {Map<number, object>} turnFold turn → 这一轮的累加器
 * @returns {object|null} 轮尾行条目;这一轮一步没跑时是 null
 */
function turnTail(ev, turnAt, turnFold) {
  const turn = ev.data?.turn
  const f = turnFold.get(turn)
  if (!f || !f.steps) return null
  const t0 = turnAt.get(turn)
  return {
    type: 'blueprint.turn_tail',
    turn,
    seq: ev.seq,                       /* 分叉锚点:种子止于这条 turn/end */
    time: f.at ?? ev.time,             /* 时钟取最后一步定格的时刻,与 dsh 同 */
    ...(t0 != null ? { runMs: Math.max(0, ev.time - t0) } : {}),
    ...(f.ttftMs !== null ? { ttftMs: f.ttftMs } : {}),
    ...(f.sampled && f.decodeMs > 0 ? { tokensPerSecond: f.decodeTokens / (f.decodeMs / 1000) } : {}),
    steps: f.steps,
    usage: { input: f.input, output: f.output, reasoning: f.reasoning,
             cacheRead: f.cacheRead, cacheWrite: f.cacheWrite },
  }
}

/**
 * 一条**没好好结束**的 `turn/end` → 一条讣告，或 null（这一轮善终）。
 *
 * 为什么单独有这一条：轮尾行只在跑过至少一步时才出（一步没跑画出来是一排破折号）。
 * 于是「一步没跑就死了」的那一轮**在脸上一个字都没有** —— 2026-08-17 实测撞上：
 * 起服务的进程里没有 DEEPSEEK_API_KEY，那一轮带着 MISSING_CREDENTIALS 死了，
 * 页面上什么都没长出来，只能去解 zstd 才看得见。**那就是暗层。**
 *
 * 所以：善终（completed）不画；其余五种（error / aborted / blocked /
 * max-tokens / interrupted）各出一行，点开是结构化的原因全文。
 * 跑过步的那一轮照样出轮尾行，这一条挨着它 —— 两件事：一件是账，一件是死因。
 *
 * @param {object} ev turn/end 事件
 * @returns {object|null} 讣告条目；这一轮善终时是 null
 */
function turnDeath(ev) {
  const r = ev.data?.reason
  const kind = r?.kind
  if (!kind || kind === 'completed') return null
  /* 五种死法各给一句人话。不认识的 kind 也画 —— 「读不出」和「没有」必须分得开。 */
  /* 标题说人话，说**发生了什么**，不说「炸了」（2026-09-14 用户定：「显示一个断网了，或者用户暂停了，系统暂停中之类的」）。
     原始的码和 message 一个字不丢，在下面 action／observation 里。
     断网的认法**不带词边界**：dsh 自己那条正则 `\bnetwork\b` 认不出 `network_error`（下划线算词内），这儿别学它。 */
  const 断网 = (e) => ['TRANSPORT', 'TIMEOUT'].includes(String(e?.code))
    || /network|connection|socket|fetch|ECONN|terminated|premature close|stream ended|time(?:d)?\s*out/i.test(String(e?.message ?? ''))
  const said = kind === 'error' ? (断网(r.error) ? '断网了' : '模型报错了')
    : kind === 'aborted' ? ({ user: '用户暂停了', parent: '上级暂停了' }[r.reason?.kind] ?? '系统暂停了')
    : ({
      blocked: '被拦下了',
      'max-tokens': '一次说太长，被截断了',
      interrupted: '系统重启，这一轮断了',
    }[kind] ?? `这一轮以 ${kind} 结束`)
  const detail = kind === 'error' ? (r.error?.message ?? '(没有 message)')
    : kind === 'aborted' ? `叫停来自：${r.reason?.kind ?? '?'}`
      : ''
  return {
    type: 'blueprint.event',
    event: {
      id: `seq${ev.seq}`, actor: 'system', kind: `turn/end · ${kind}`,
      headline: `第 ${ev.data?.turn ?? '?'} 轮 —— ${said}`,
      action: detail,
      /* 原因原样落在这儿：dsh 以后加新的 reason 变体，这里不用改也不会吞掉 */
      observation: JSON.stringify(r, null, 2),
    },
  }
}

/**
 * 一条 `agent/inbox/spliced` → 「还排着队」那一行,或 null（这条已经被读掉了）。
 *
 * 这个判断值得写清楚，因为两个方向都会出错：
 *   全画 —— 每句话出现两次（排队那行 + 你说的话那个气泡），一件事两个真相
 *   全不画 —— **一句还没被读的话会整个消失**。实测有这种事：
 *              有条消息进了收件盒，那一轮再没跑起来，全流水里只有这一条事件带着它
 *
 * 所以判据是「它后来有没有变成一条 user/message」：变成了就是重复，没变成就是还排着。
 *
 * ⚠️ 2026-08-26 改了配对的依据。原来只认 id ——「同一句话说两遍，按正文比会把第二遍
 * 误判成重复」。可**插件垫进来的那几条 dsh 根本不发 id**（引用件、
 * 目录、prompt…），只认 id 的话它们永远配不上后面那条 user/message，
 * 于是「还没被读到」这一行会一直挂着撒谎 —— 实测小猫超级玛丽那场挂了 5 行，
 * 而它们全都在 150 毫秒之内就被读掉了。
 *
 * 新依据见 `msgKey`：有 id 认 id，没 id 认正文。「说两遍」那个顾虑用**份数**接住 ——
 * 核销是按份扣的，不是"出现过就算"：说两遍只读掉一遍，第二遍照样还排着。
 *
 * @param {object} ev agent/inbox/spliced 事件
 * @param {Map<string,number>} consumed 指纹 → 还剩几份没核销（**这个函数会扣它**）
 * @returns {object|null} 「还排着队」条目；一条都不剩时是 null
 */
function queued(ev, consumed) {
  const waiting = []
  for (const m of ev.data?.inserted || []) {
    if (!m) continue
    const k = msgKey(m)
    const n = consumed.get(k) || 0
    if (n > 0) { consumed.set(k, n - 1); continue }   /* 核销一份 */
    waiting.push(m)
  }
  if (!waiting.length) return null
  return {
    type: 'blueprint.event',
    event: {
      id: `seq${ev.seq}`, actor: 'user', kind: 'agent/inbox/spliced',
      headline: `排着队 ${waiting.length} 条 —— 还没被读到`,
      action: waiting.map((m) => textOf(m.content)).join('\n\n'),
      observation: waiting.map((m) => `${m.id ?? '没有 id'} · ${m.source?.kind ?? '?'}`).join('\n'),
    },
  }
}

/** 一条消息的指纹：有 id 认 id，**没 id 认正文**（dsh 给插件垫的消息不发 id）。
    收件盒里那一条与它后来落成的 user/message 正文逐字相同，所以配得上。 */
const msgKey = (m) => (m && m.id !== undefined && m.id !== null)
  ? `id:${m.id}` : `t:${textOf(m?.content)}`

// ------------------------------------------------- 血脉:一个座位的一生

/* 一条线最多读几个会话。超了就截断,并且**把截了几条报上去** ——
   前端要把这个数摆在图上。悄悄少画几条线,那正是暗层。 */
const LINEAGE_CAP = 300   /* 2026-09-15：20 撞上了 —— 横版冒险游戏 3.0 有 21 个真节点，Dock 派的 0.0.0.1 最深、最晚，被截掉看不见。
                             2026-09-17：60 又撞上了（横版游戏 5.0 截掉 5 个）；画树改读瘦账之后一格只要几 KB，放到 300 */

/**
 * 轮骨架:只走到轮边界，不折内容。时间线一根条要的全部就是这些。
 *
 * 与 `fold()` 的分工:fold 是**一个会话的全部**(条目、统计、轨迹),重;
 * 这个是**一条线上每个会话的骨头**,轻。时间线要同时看好几个会话,
 * 用 fold 去读会把一次刷新变成十次全折。
 *
 * @param {readonly object[]} events 会话事件，按 seq 升序
 * @returns {{turn:number, seq:number, at:number, endAt:number, runMs?:number, steps:number, error:boolean}[]}
 */
/* ---- 瘦账：画树只读账本里这几样（2026-09-17 用户报：横版游戏 5.0 到 50 多个节点，切一格要 4.7 秒）----
   那 4.7 秒里 3.9 秒是把 60 份账本整份解压重读 —— 可画树从每份账本里要的只有：
   · `turn/start`／`turn/end`（轮骨架、开着一轮没有、怎么收的）
   · `assistant/message` 的轮号、用量、模型（步数、全项目用量）
   · `archive` 那把工具的参数（`seatReadout()` 读落档和图景全文）
   · 第一条和最后一条的时刻（同一条带上哪条线最后动过）
   其余（正文、思考、工具结果）一个字都不用。所以每份账本**只瘦一次**，记住瘦下来的这一小撮，
   整份账本读完就扔。账本只增不改：活的会话下回只瘦新长出来的那一截。

   **瘦过的数组跟原数组长得一样**（同样的 type / time / seq / data 字段路径），读的人不用改，
   只有两处要知道它是瘦的：
   · 每条上的 `i` ＝ 它在原账本里的下标（种子边界 `seedLength` 按下标比）；
   · 数组上挂的 `总数` ＝ 原账本一共几条 —— 用 `条数Of()` 读，别读 `.length`。
   **树上要读账本里别的东西时，先在 `瘦一条()` 里加一行**，不然瘦账里没有，树上读到的是空。 */
function 瘦一条(ev, i, 瘦) {
  const d = ev.data || {}
  const 头 = { type: ev.type, time: ev.time, seq: ev.seq, i }
  if (历史等待事件.has(ev.type)) return { ...头, data: { turn: d.turn, notes: d.notes, conditions: d.conditions } }
  switch (ev.type) {
    /* 子会话的出身：哪种帮手（run 开的 sub 才上树）、那次交代的简短描述（sub 砖的名字）。 */
    case 'subagent/descriptor': return { ...头, data: { provider: d.provider, label: d.label } }
    case 'turn/start': return { ...头, data: { turn: d.turn } }
    case 'turn/end': return { ...头, data: { turn: d.turn, reason: d.reason } }
    case 'step/start': return { ...头, data: { turn: d.turn, step: d.step } }
    case 'assistant/message': {
      const src = d.message?.source
      return { ...头, data: { turn: d.turn, step: d.step, usage: d.usage,
        message: { source: src ? { provider: src.provider, model: src.model } : undefined } } }
    }
    case 'compaction/start': return { ...头, data: {} }
    case 'compaction/summary': return { ...头, data: { usage: d.usage, provider: d.provider, model: d.model } }
    /* next、divide、finish 只留名字：`等用户回话的()` 看回话里有没有接着开工（10-25）。 */
    case 'tool/call': return d.name === 'archive' ? { ...头, data: { name: d.name, arguments: d.arguments } }
      : 是开工调用(ev) ? { ...头, data: { name: 调的工具(d) } } : null
    /* 按停之后的续工、回话停下：`用户叫停的()` 从末尾往回找它们。瘦账里没有，按停过一次的节点之后不在跑就一直画成停止（10-22 保卫罐头 0 号在等孩子却亮红）。只留判据读的字段，不带正文。
       用户回话：`等用户回话的()` 认「回完没开工」（10-25）。 */
    case 'user/message': return 是用户续工输入(d) || 是回话停下(d) || 是用户回话(d)
      ? { ...头, data: { role: d.role, source: { kind: d.source?.kind, plugin: d.source?.plugin, summary: d.source?.summary } } } : null
    default: return null
  }
}
/** 原账本从下标 `起` 开始的那一截瘦下来，接到 `瘦` 后面。首尾两条不管是什么都留一个时刻（类型记成 `时刻`）。 */
export function 瘦身(瘦, 段, 起) {
  // 上回的末时刻变成中间事件后不再占一行；逐事件折入也只保留首尾时刻。
  if (段.length && 瘦.at(-1)?.type === '时刻' && 瘦.at(-1).i !== 0) 瘦.pop()
  for (let k = 0; k < 段.length; k++) {
    const ev = 段[k]
    if (!ev) continue
    const i = 起 + k
    const x = 瘦一条(ev, i, 瘦)
      || ((i === 0 || k === 段.length - 1) ? { type: '时刻', time: ev.time, seq: ev.seq, i } : null)
    if (x) 瘦.push(x)
  }
  瘦.总数 = 起 + 段.length
  return 瘦
}
/** 瘦账长相的指纹：落盘的画树摘要认它。`瘦一条()` 里读到的外部判据（如 `历史等待事件`）改了，把这里的版数加一。 */
const 瘦账格式 = createHash('sha256').update('1\n' + 瘦一条 + '\n' + 瘦身).digest('hex').slice(0, 16)
/** 账本一共几条 —— 瘦账认 `总数`，整份的认 `length`。 */
const 条数Of = (evs) => (!evs ? 0 : evs.总数 !== undefined ? evs.总数 : evs.length)

/** 从原生观察截面取得树投影；无变化时不访问惰性的 events。 */
export function 瘦账截面(source, 旧, 活, 手上 = null) {
  const 起 = 旧 ? 条数Of(旧.瘦) : 0
  const 总数 = source.cursor + 1
  const 接得上 = 活 && 旧?.活 === 活 && 起 <= 总数
  if (接得上 && 起 === 总数
    || source.source === 'prepared' && source.revision !== undefined && 旧 && 旧.版 === source.revision) return 旧
  const 瘦 = 接得上 ? 旧.瘦 : 瘦身([], [], 0)
  const 从 = 接得上 ? 起 : 0
  const 全 = 手上?.length === 总数 ? 手上 : source.events
  瘦身(瘦, 从 === 0 ? 全 : 全.slice(从), 从)
  return { 活, 版: source.revision, 瘦 }
}

function turnSkeleton(events) {
  const out = []
  const at = new Map()          /* turn → turn/start 的时刻 */
  const steps = new Map()       /* turn → 跑了几步 */
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    const t = ev.data?.turn
    if (ev.type === 'turn/start') at.set(t, ev.time)
    else if (ev.type === 'assistant/message') steps.set(t, (steps.get(t) || 0) + 1)
    else if (ev.type === 'turn/end') {
      const t0 = at.get(t)
      out.push({
        turn: t, seq: ev.seq, endAt: ev.time,
        /* idx = 这条 turn/end 在事件数组里的**下标**。种子边界要用它比,不能用 seq ——
           `seedLength` 在 dsh 那边的用法是 `events.slice(seedLength)`,是下标不是序号。
           两者通常相等(seq 从 0 连号),但「通常相等」不是可以拿来比的理由。 */
        idx: ev.i ?? i,   /* 瘦账上每条自带原下标 */
        ...(t0 != null ? { at: t0, runMs: Math.max(0, ev.time - t0) } : {}),
        steps: steps.get(t) || 0,
        /* 红＝**这一轮本身没善终**（error/aborted）。轮内某次工具报错不算 ——
           闸的拒绝、失败重试都是正常协议，按它们染红会满屏红（2026-08-26 真事）。 */
        error: !!(ev.data?.reason?.kind && ev.data.reason.kind !== 'completed'),
      })
    }
  }
  return out
}

/**
 * 身份 —— **这个座位出生那一刻，上级给了他什么。**
 *
 * 三节，按**到达顺序**排，因为那正是他的经历：
 *
 *   ① 身份      出生就写死在 system prompt 里的那一段（总纲 ＋ 座位的壳）
 *   ② 上级给的  分工手册 —— 上级唯一要写的东西
 *   ③ 机器推的  出生包（上级的《汇报》与《图景》 ＋ 结构图 ＋ 柜子索引）
 *
 * **2026-08-31 换掉了第 ② 节**：原来是「他睁眼看见的第一句话（交代）」，
 * 那一格删了 —— 出生包一推整份分工手册，交代就只是把目标又说一遍。
 * 第 ③ 节**不重算**：出生包是弧递进他账里的那条 `user/message`，**原样读出来**，
 * 在这儿重算一遍就是第二份实现（禁令 10），而且算出来的是"现在会给什么"，
 * 不是"他当初拿到了什么"——那是两件事。
 *
 * **2026-08-26 用户砍掉两节**：
 *   ·「继承的对话」—— 没有任何继承对话的设计（座位一律 spawn，那一格恒为 0）。
 *   ·「垫进来的料」—— 轨迹页和对话流里本来就一条条看得见，这儿是第二份实现。
 *
 * **一个字都不新造。** 每一格都指得出出处：名册（扫 prompt 折的）、会话头、账本。
 * 算不出来的格子如实写「读不出来」，**不许拿默认值填** —— 「没有」和「读不出」
 * 长得一样，是这一页最该防的坏。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 要 `ctx.agents`（壳只有活着的会话拿得到）
 * @param {readonly object[]} rows listSessions() 的返回
 * @param {string} sessionId 要看谁
 */
async function 身份Of(ctx, rows, sessionId, events = null) {
  const id = String(sessionId)
  const by = new Map(rows.map((r) => [String(r.id), r]))
  /* `文档夹()` 要 `ctx.sessions.get(id).header.{cwd,parentSession}` 那个形状；
     服务端手上是 listSessions() 的行，包一层就够 —— 项目根只有 archive 那一个出处。 */
  const 假ctx = { sessions: { get: (x) => {
    const r = by.get(String(x))
    return r ? { header: { cwd: r.cwd, parentSession: r.parentSession } } : undefined
  } } }

  /* ── ②③ prompt 那几格：从名册读（名册 ＝ 扫 prompt 折出来的，零模型） ── */
  let 我 = null
  let 上级 = null
  let 册坏 = ''
  let 单路 = ''
  try {
    const 文档夹路 = 文档夹(假ctx, id)
    const 册 = await 名册(文档夹路)
    我 = 册.find((r) => r.会话 === id) || null
    if (我) {
      /* 返程路取**真的那个文件**，不拼。拼出来的路径打不开，比没有路径更坏。 */
      const 单 = (await 现行(文档夹路, 我.id, '分工手册')) || (await 现行(文档夹路, 我.id, '登记'))
      if (单) 单路 = `${文档夹路}/${单.文件}`
    }
    if (我 && 我.parent !== null) {
      const 父 = 我.parent
      const p = 册.find((r) => r.id === 父)
      上级 = { 号: 父, 名字: p ? p.name : '（名册上没有他）', 会话: p ? p.会话 : '' }
    } else if (我) {
      /* 0 的意图来自用户的第一句话 */
      上级 = { 号: '用户', 名字: '（第一句话）', 会话: '' }
    }
  } catch (e) {
    /* 算不出项目文件夹（刚开出来的、或者不在项目里）—— 说出来，不装作"他没有分工手册"。 */
    册坏 = String((e && e.message) || e)
  }

  /* ── ① 壳 ────────────────────────────────────────────────────────────
     权威那一份在**出生包**里（下面那一格的全文），落了盘、不可变。
     这一格是**照他的座位重拼的，只为对照**，而且明写着是重拼的：座位卡那行
     `parts` 或那份 md 后来被人动过，重拼出来的就跟他当初收到的不是同一份 ——
     从文本上看不出来。「他看到的」和「他这个座位现在该看到的」是两件事，
     不许混成一格（图景禁令 3：不许有来路不明的东西）。 */
  /* 模型查模型表（`archive` 的「模型表」）—— 跟调模型那一钩、节点下拉同一个答案 */
  let 模型 = ''
  try {
    const c = 会话的模型(ctx, id)
    模型 = c ? `${c.provider} · ${c.model}${c.reasoningEffort ? ` · ${c.reasoningEffort}` : ''}` : ''
  } catch { /* 同上 */ }

  /* 座位从名册来 —— 那是**账本上的事实**（prompt 里写着的那个字）。 */
  const 座位名 = (我 && 我.座位) || ''
  /* 新系统没有座位的壳（身份页第 ① 节改成指向公共前缀，2026-09-24）；老项目才会走下面这一支 */
  let 壳 = null
  if (座位名) {
    try {
      const t = 壳文([座位名])
      壳 = { 来源: '重拼', 字数: t.length, 全文: t, 名册座位: 座位名 }
    } catch (e) {
      /* `shells/<座位>.md` 不存在 —— 说出来，别静默留空。 */
      壳 = { 来源: '重拼', 坏: String((e && e.message) || e), 名册座位: 座位名 }
    }
  }

  /* **他当初真的收到的那一包** —— 认弧递进去那条话的头一个标记。
     标记只有一个出处：`arc` 的 `出生包()` 第一段。认不出＝他还没被叫醒过。 */
  let 出生包 = null
  try {
    for (const e of events || []) {
      if (!e || e.type !== 'user/message') continue
      for (const c of ((e.data && e.data.content) || e.content || [])) {
        const t = c && c.type === 'text' ? String(c.text || '') : ''
        /* 新系统：节点收到的第一条是节点前缀（`context` 摆的，来路 blueprint-context） */
        if (消息来自(e.data, 'plugin:blueprint-context')) { 出生包 = { 全文: t, 字数: t.length }; break }
      }
      if (出生包) break
    }
  } catch { /* 冷会话读不出账 —— 就是读不出，不是没有 */ }

  return {
    会话: id,
    号: 我 ? 我.id : null,
    名字: 我 ? 我.name : '',
    座位: 座位名 || (我 ? '—' : ''),
    难度: (我 && 我.难度) || '',
    出生: (我 && 我.出生) || '',
    上级,
    理解: 我 ? 我.理解 : '',
    预期: 我 ? 我.预期 : '',
    工作内容: 我 ? 我.工作内容 : '',
    验收标准: 我 ? 我.验收标准 : '',
    分工手册: 单路,
    出生包,
    壳,
    模型,
    册坏,
    /* 名册上没有他 ＝ 还没落分工手册。全树只有 Blueprint 座位天生没有，别的都该有。 */
    在名册上: !!我,
  }
}

/**
 * 一个座位的账本里能读出来的两件事：**他派出去了谁**、**他落了什么档**。
 *
 * 这是「记账与查账分离」（核心结论 7）在代码里的形态：状态不问模型要，
 * 从它已经发生过的动作里推。模型自报的状态是文本属性，不是世界状态（第〇公理）。
 *
 * @param {readonly object[]} events 一个会话的事件流
 * @returns {{落档:string[], 正文:Map<string,string>}}
 */
function seatReadout(events) {
  const 落档 = []
  const 正文 = new Map()      /* 种类 → 最后一版的全文（现在只有图景在用） */
  /* ⚠️ 这里原来还侦查三样，2026-08-26 全删了 —— 三个证据源都已经不存在：
       ① `open_<座位>` 工具（2026-08-18 换成一把 `assign`）
       ② 回执里的 `started subagent <id>`（`assign` 不走 dsh 那把委派工具了）
       ③ `subagent/descriptor` 事件（2026-08-26 seats 故意不打 subagent 标记）
     谁是谁的孩子，现在从 `parentSession` 读（血脉本来就在会话头上）；
     角色名／工作内容／验收标准／座位／难度，从**名册**读（扫 prompt 折出来的）。
     **别再往这儿加"从账本里认身份"的分支** —— 身份的出处只有名册一个。 */
  for (const ev of events) {
    if (ev.type !== 'tool/call') continue
    const name = String(ev.data?.name || '')
    if (name !== 'archive') continue
    const args = parseArgs(ev.data?.arguments)
    if (!args || !args['种类']) continue
    落档.push(String(args['种类']))
    /* 图景全文就在这一刀的参数里 —— **从账本读，不去开柜子**：
       柜子那个 unit 归 `@blueprint/archive` 开着，同一个 unit 开两次 dsh 会拒。
       账本是只增不改的，这里读到的就是那一版逐字的正文。 */
    if (args['全文']) 正文.set(String(args['种类']), String(args['全文']))
  }
  return { 落档, 正文 }
}


/** 一段正文的头一行 —— 目标卡上那一行放不下全文，全文在 `brief.raw` 里悬停读。
    只去掉 markdown 的记号，不改一个字（折叠不摘要）。 */
function headline(text) {
  const line = String(text).split('\n').map((l) => l.trim()).find((l) => l) || ''
  return line.replace(/[*#>`]/g, '').trim().slice(0, 60)
}

/* ⚠️ 这儿原来有 `const GHOSTS = 3` 和一段"还没派人的项目画三张虚卡"的代码，
   2026-08-28 删了。它自己的注释就写着「**它是图示，不是账本里的事实**」——
   `r1:'待定' r2:'待定' 验收:'—'`，三张写死的假卡，只在 Blueprint 一个孩子都没有时才出现。

   删得掉是因为**真的等待态现在有出处了**：assign 出来的节点当场在树上，
   一句话没说、一次模型没烧，那就是「等其他节点」（`状态输入()` 的 `有未满足的卡点`）。
   **别把它加回来** —— 假卡和真卡长得一样，加回来就分不出哪张是事实。 */

/**
 * **七个显示态的判据表。** 出处：「节点状态灯」定稿 § 6（2026-08-28 用户口述定）。
 * **从上往下，第一个命中为准。** 第 4–7 条都以「状态名称 ＝ 未完成」为前提。
 * 顺序本身就是设计：先看有没有被判死判活，再看动没动，最后才问为什么不动。
 *
 * **算在这儿，不算在前端。**（studio.html 自己的规矩：记账与查账必须分离。）
 * 翻过墙给前端的只有返回的那一个字符串，前端拿它挑一个 CSS 类，一个字都不判断。
 * 判据可证伪：**加第八个状态时要不要改前端？不要 → 骨架做对了。**
 *
 * ⚠️ **这套判据要六样输入，账本现在只答得上一样半。** 缺的一律走「当它不存在」
 *    那一支 —— 不猜、不造、不拿别的东西凑。缺一样就少亮一盏灯，但绝不亮错。
 *    缺口明细见 `状态输入()`。
 *
 * @param {object} 入 六样输入，见 `状态输入()`
 * @returns {'dead'|'done'|'idle'|'run'|'wait'|'ask'|'stop'}
 */
export function 状态OF(入) {
  if (入.关停了) return 'dead'                       // 1 上级关停了他，或上面那一支被关停（号往上爬，连坐）
  /* 1.5 **最后一轮出事故断了，压过「完成」**（2026-09-15 用户报：节点 1 交过汇报，被纸条叫醒后撞 429，
     卡片却一直写着完成）。原来事故只在第 6 条判，交过活的节点走到第 2 条就返回了，永远轮不到。
     只挪「断掉」这一半（报错／输出上限／被拦下／重启切断）；用户按停和 PULSE 关着留在第 6 条 ——
     否则一关总开关，全树交完活的节点会一片红。 */
  if (入.有等待状态) return 'ask' // 持久问题在停止、重启后仍待用户处理
  if (入.断掉了) return 'stop'
  /* 2 **完成 ＝ 本职工作搞定 ＋ 这一格自己不在转**（2026-09-03 用户裁定）。
     ⚠️ **「它下面也不在转」那半条 2026-09-03 撤了。** 用户原话：
     「plan 和 helm 已经把任务交出去了，已经不在持续输出了，为什么还显示进行中……
      只要检测这个节点本身和搜索和智囊不工作，就是完成的那个状态」。
     撤掉之前：一个交完货、把活派下去的 Helm，只要子树里还有人在跑就一直亮「运行中」——
     可它自己一个字都没在产出。**一格的状态说的是这一格，不是它那一支。**
     子树在不在跑，树上自己看得见（那几个后代砖自己亮着）。

     旧注里担心的「交完第一轮、正忙着别的事的节点会一直挂完成」仍然拦得住 ——
     拦它的是 `!入.在行动`（它自己那一轮开着），跟后代无关。 */
  /* ⚠️ **还欠着下一拍的不叫完成**（2026-09-07 加 `!入.有未满足的卡点`）。
     `本职搞定` 是**按带算的**（见 `本职搞定了()`）：统筹的展开带交完清点＋排班就是真交完了，
     Blueprint 的展开带交完五拍也是真交完了。可 Blueprint**还欠一拍**（第六拍收口），
     而那一拍挂在一条还没出生的执行带上 —— **没有任何一条带把那个等待显示出来**。
     于是屏幕上写着「完成」，机器却在等，那句话谁也看不见。
     这破的是系统自己那条规矩：**屏幕上写着他在等什么，机器就真在等什么。**
     加这一条之后它们掉到第 6 条 `wait`，等待表就把那句话印出来了。
     ⚠️ 卡点是**按号**算的（`等着.get(号)`），不按带 —— 等待属于这一格，不属于它的某半场。
     09-15 起「在等」只剩一种：等孩子的汇报（`arc` 的 `等着的()`）；都交了它自然是空，`done` 照旧到得了。 */
  if (入.本职搞定 && !入.在行动 && !入.有未满足的卡点) return 'done'
  if (!入.已启动) return 'idle'                      // 3 直系上级还没启动它
  /* 4 **有人在问你 —— 压过「它在跑」和「它在等别人」**（2026-09-03 用户报）。
     ⚠️ **问话工具是阻塞的：模型等你答的时候，它那一轮并没有关闭。**
     所以 `在行动` 是真 —— 原来「运行中」排在前面，一个正在问你的节点
     就一直亮着绿色三格波，那盏金灯永远点不亮（用户实机撞到）。
     「那一轮开着」是技术事实，「它在等你动手」才是你要看见的事。
     它也压过「等其他节点」：**要你动手的事，压过一切"它自己在忙"或"它在等别人"**
     —— 跟暖族那条同一个意思（全树唯一的两块彩纸，都是要你动手）。 */
  if (入.有等待状态) return 'ask'
  if (入.在行动) return 'run'                        // 5 **只看自己在不在跑**（2026-09-03）
  /* 6 **红只归「被停下」**（2026-09-14 用户裁定，原话：「只有人为停止或者系统重启或者总开关关了，
     才是红色的停止状态」）。三条：用户按了停／全停、进程重启把一轮切断了、这个项目的 PULSE 关着。
     排在「等别人」前面：你按了停，它就是停，不管它原来在等谁。
     ⚠️ 撤掉的是原来的第 7 条「该动没动，还给不出理由」兜底红 —— 递完纸条停下来等回话的节点
     （那时候的「等回话」「打回」机器答不出）就一直被冤枉成红（用户实机：5 号执行带）。
     **不在跑、没被停下，就是在等**，一律 ⏸。 */
  if (入.被停下) return 'stop'
  return 'wait'                                      // 7 没在跑、没被停下 ＝ 在等（等别人、等回话、等 PULSE 叫）
}

/**
 * 从账本里凑出 `状态OF()` 要的六样。**这个函数就是那张缺口清单。**
 *
 * 现在的实情（2026-08-28）：
 *   ✓ 在行动      **账本里有一轮开着**（`turn/start` 之后没有 `turn/end`）
 *                 ⚠️ 2026-08-28 事故：原来写的是 `agents.has(id)`。**那是错的。**
 *                 `参考/dsh/docs/api-gateway.md:127`：任何带 `session`／`agent` 参数的
 *                 RPC 都会**自动 resume 冷会话**。于是用户在界面上点一下某个节点，
 *                 studio 去问它的身份／模型，dsh 顺手把它唤醒成一个活 Agent ——
 *                 `agents.has(id)` 当场变真，一个停着的节点被判成「运行中」。
 *                 `agents.has(id)` 的意思是**内存里有个实例**，不是**它在跑**。
 *                 现在它只当必要条件用：冷会话一定没在跑，但活着的不一定在跑。
 *   ✓ 后代在行动  上一条递归子树，白拿
 *   ◐ 有等待状态  暂借 dsh 的问话机制（approval / question 挂在 `pending` 上），
 *                 加上名册里用 wait 等用户输入的节点（2026-10-18，提问卡拆了以后在对话里问）。
 *                 跟定稿说的「模型自己写一条状态条目」**不是一回事**，以后要对齐
 *   ✓ 关停了／本职搞定  **2026-08-31 换血：状态不再是一种料，是算出来的。**
 *                 原来读柜子的「状态」那一格（上级用 `judge` 判的完成／废案）——
 *                 那把工具和那种料一起删了：**没有人批准任何事**。
 *                 现在两条都在 `arc`：`关停了的()`（上级落的关停 ＋ 顺号连坐）、
 *                 `交齐的()`（承诺的产出都在 ＋ 说明文档落过了）。
 *                 **判据只有一个出处** —— 这儿说他完成了、那儿还在推他干活，
 *                 就是自相矛盾，而且不会有任何东西报错。
 *   ✓ 已启动      **恒真，而且这是对的**（2026-08-28 用户裁）。「未启动」这个态没有
 *                 存在的理由：**每个没在跑的节点，任何时刻都说得出自己在等什么** ——
 *                 在等上一格派人，或者在等信封上 `启动` 点名的那几格做完。
 *                 「还没启动」只在旧设计里成立（那时候派活＝开跑，"派了但没跑"没法解释）。
 *                 判据表里 `idle` 那一条留着不动（零成本），**但不许为了让它命中去造机制**。
 *   ✓ 有未满足的卡点  `arc` 的 `等着的()`：还欠他汇报的孩子。跟弧「没交不许停」同一份 ——
 *                 这儿说他在等、那儿推他干活，就是自相矛盾，而且不会有任何东西报错
 *
 * ⚠️ **2026-09-14 起兜底不再是红**（用户裁定）：一个不在跑、也没人问你话、也没被停下的节点
 *    落到最后那条「等其他节点」（⏸）。原来兜底红的理由是「系统说不出他为什么不动」——
 *    可递完纸条等回话的节点就说不出，却是在合法地等，被冤枉成红。
 *    **红只归 `被停下`**（用户按停 · 进程重启切断 · PULSE 关着 · 这一轮出事故断了），判据在 `seatTree()` 的 `被停下()`。
 *    代价要记着：真的卡死、没人会叫醒的节点现在也亮 ⏸ —— 分辨它靠等待表那句「在等什么」。
 */
function 状态输入(id, { 在行动, 后代在行动, 有等待状态, 已启动, 有未满足的卡点, 关停了, 本职搞定, 被停下, 断掉了 }) {
  return {
    被停下: !!被停下,
    断掉了: !!断掉了,
    关停了: !!关停了,
    本职搞定: !!本职搞定,
    已启动,
    在行动,
    后代在行动,
    有未满足的卡点: !!有未满足的卡点,
    有等待状态,
  }
}

/**
 * 血统树 ＋ 座位 ＝ **节点树**。图景 9.1：项目就是这棵树，不需要第二份存储。
 *
 * **本函数只折数据，一个像素都不画。** 画的是 `viewer/mirror-render.js`。
 * 所以这里的出口形状不是我们定的，
 * 是**它认的那个形状**：`{project, event_count, roots, nodes, edges}`，
 * 节点带 `node_id / parent / children / depth / 座位 / 状态 / r1 / r2 / 编号 / 验收 / brief`。
 *
 * **座位原样发**（`blueprint` / `helm` / `run`，名册上那个字）。2026-08-28 换血：
 * 原来发的是 `identity: SYS|PLAN|GO|HOLD` —— 那是四角色时代的词，而且把「状态」
 * (HOLD) 混进了「身份」那一格，害得一个 Helm 只要在等你回话，卡上就看不出他是几号。
 * 现在**身份归身份、状态归状态**，前端那张座位名表认不出的座位原样印，
 * 加一个新座位不用改任何代码。
 *
 * **状态是算出来的**，判据在 `状态OF()`，一个字都不在前端算。
 * ⚠️ `agentPreset` 认不出座位：子会话 header 原样继承父亲的 preset
 * （2026-08-18 真跑的子会话 header 里写着 agentPreset: blueprint）。
 *
 * @returns {object} 渲染器认的那棵树
 */
/**
 * **这个项目是不是旧格式** —— 柜子里有没有**这一版根本产不出来**的东西。
 *
 * 为什么要它：2026-08-31 一晚上被同一件事吃掉两次 —— 界面画得挺正常，
 * 实际上柜子里全是旧种类名／旧形状，新代码一个都认不出，
 * 而**没有任何东西说话**。这违反「读不出和没有必须分得开」。
 *
 * **判据只认"这一版产不出来"的东西，不认"缺什么"** —— 缺是正常的（还没跑到），
 * 多出一个不可能的形状才是铁证：
 *
 * - `种类` 是 `prompt` / `分目标图景` / `总目标图景` / `图景` —— 改名前的老名字
 * - 一份 `分工手册` 的信封上有 `helm会话` 那一格 —— 那是「一块砖两条带」
 *   （Blueprint 和 Helm 共用一个号一份手册）那一版的形状，2026-09-01 拆掉了。
 *   ⚠️ **别再拿「座位是 helm」当判据**：从这一版起那正是**新**形状 ——
 *   每个 Helm 都有自己的一份分工手册，座位那一格写的就是 helm。
 *
 * @returns {string} 一句话；空字符串 ＝ 没发现旧东西
 */
function 旧格式(现块) {
  /* 9-5 又删掉一批（工单／章程／协作图／路径清单／分割）—— 老项目里还躺着这些块，
     在新盘上打开时得有人说一句，不然界面照画，而谁都不知道它为什么不动。
     ⚠️ **《工单》9-13 又回来了**（执行工单，`archive` 名字清单里是正式种类），所以从这张表里摘掉 ——
        留着的话，新项目里谁落一份工单，整个项目就被判成旧格式（2026-09-13 横版游戏 01 撞上，日志刷了十几遍）。
        往这张表里加名字之前，先对一遍 `archive` 的名字清单：**现役的名字不许在这儿。** */
  const 老名 = new Set(['prompt', '分目标图景', '总目标图景', '目标图景',
                        '章程', '协作图', '路径清单', '分割',
                        /* 09-14 删：协作协议并进简报，说明文档／产出换成汇报（`archive` 名字清单）。 */
                        '协作协议', '说明文档', '产出',
                        /* 09-15 删：交付只剩汇报（`工单-变常规.md`）。
                           ⚠️ **《工单》2026-09-18 又回来了**（run 开工前交的那一份，`archive` 名字清单里是正式种类），
                              所以又从这张表里摘掉 —— 第二次了，加名字之前先对一遍名字清单。 */
                        '简报', '任务手册', '设计集'])
  const 撞见 = new Set()
  for (const r of 现块 || []) {
    if (老名.has(String(r.种类))) 撞见.add(`《${r.种类}》这个种类名早改了`)
    if (r.种类 === '分工手册' && String((r.别的 || {}).helm会话 || '')) {
      撞见.add(`《分工手册·${r.名称}》上有 helm会话 那一格 —— 那是「一块砖两条带」那一版的形状`)
    }
  }
  if (!撞见.size) return ''
  return `这个项目是**旧格式**，新代码读不懂它：${[...撞见].join('；')}。`
    + `不迁移（图景：重写优先，不留兼容岔路）—— **新建一个项目**。`
}

/**
 * **本职搞定了没有** —— 状态判据第 2 条的前一半（后一半是「这一格和它下面都不在转」，在 `状态OF()` 里）。
 * 跟弧同一个判据（`arc` 的 `结束了()`）：Blueprint／Plan 派完人、Run／Dock 交了汇报没被打回。
 */
function 本职搞定了(座, 号, 现块) {
  /* **清单空了才叫搞定**（`arc` 的 `欠着的()`）—— 不是「柜子里有一份汇报」。
     一格的清单上有三种：主任务、被 Dock 打回、交完之后递进来的纸条。
     2026-09-18 之前这儿只问「交齐了没有」，于是 3.4.1 交过汇报、压着 3.4.4 的召回纸条、
     又被用户按停，屏幕上写着「完成」，而它其实永远不会再动。 */
  return !!号 && 欠着的(座, 号, 现块 || []).length === 0
}

/**
 * **板块里写什么** —— `DESIGN_GUIDE.md` 3.2。
 *
 * 2026-09-15 用户裁定翻的：原来两行写的是**固定的目标**（「定基调：做什么，怎么量」「照着自己写的工单做」），
 * 五张卡一模一样，用户原话「那两行文字没什么看的价值」「像机械化流水线」。
 * 现在两行只有一条规矩，所有座位一样：
 *
 *   **一行 ＝ 这一格的活，用它自己（或派它的人）的话** —— 柜子里他写的那份的头一句；
 *   还没写就用上级派活时写的工作内容。
 *   **二行 ＝ 柜子里的事实** —— 交了什么（种类·号）；没交就写在等谁（`等着的()`，跟叫醒同一个判据）；
 *   再没有才退回上级写的验收标准。
 *
 * 状态仍然归形态（纸色·边线·状态条）：这儿写的「等 1.1《汇报》」不是七态之一，是**等的是谁** ——
 * 颜色只能说"在等"，说不出等谁。可证伪：**加第八个状态，这个函数要不要改？不要。**
 *
 * 镜像侧不从这儿拿字：镜像只写目标（2026-09-29），在 `seatTree()` 末尾「镜像」那段取。
 * `柜` 是画树那一刻读好的 `{ 现块, 等着, 交齐, 册 }`；传空也画得出来，退回上级写的那两行。
 */

/* 柜子里某一份的现行版，按种类和号取；没有就 null。 */
const 块Of = (现块, 种类, 号) => (现块 || []).find((r) => r.种类 === 种类 && String(r.名称) === String(号)) || null

/** 一份文档开头那句人话：跳过空行、只是抬头的行（「工单·1」「# 图景」）、太短的行，去掉 markdown 记号。 */
function 首句(row) {
  if (!row || !row.全文) return ''
  const 抬头 = /^(图景|汇报|分工手册|工单)(·[\d.]+)?$/
  for (const raw of String(row.全文).split('\n')) {
    const l = raw.replace(/^[\s#>*\-]+/, '').replace(/\*\*|`/g, '').trim()
    if (!l || 抬头.test(l) || l.length < 4) continue
    return l.slice(0, 40)
  }
  return ''
}

/** 「交了 图景·1、汇报·1」—— 这个号在柜子里落了哪几种。一种都没有 ＝ 空串。 */
function 交了行(现块, 号, 种类们) {
  const 有 = 种类们.filter((k) => 块Of(现块, k, 号))
  return 有.length ? 译('交了 {list}', { list: 有.map((k) => `${k}·${号}`).join(译('、')) }) : ''
}

/** 「等 1.1《汇报》」—— `arc` 的 `差什么()` 吐的原条；「同一层还有人没做完」那句原样印。 */
function 等行(等着, 号) {
  const 缺 = (等着 && 等着.get && 等着.get(String(号))) || []
  if (!缺.length) return ''
  if (缺.length === 1 && 缺[0] === 同层还没做完) return 缺[0]
  /* 缺里的「用户输入」「作业 x」也是判据用的原值（等你回应靠它认），只在这里按界面语言说。 */
  const 说 = x => x === 等用户输入 ? 译('用户输入') : /^作业 /.test(x) ? 译('作业 {id}', { id: x.slice(3) }) : x
  return 译('等 {list}', { list: 缺.map(说).join(' ') })
}

/** 外部 run 的砖态（叶 6）：在做是运行中；交回了是完成；等用户处理、被按停或重起切断是停止；还没开工、等自动再试是等待。 */
export function 外部态(r) {
  const 外 = r.外部 || {}
  if (r.状态 === '完成') return 'done'
  // 收尾＝进程刚退出、交回还没落进名册的那几秒：照旧算在做，不先闪一下停止（10-25）。
  if (外.在跑 || 外.收尾) return 'run'
  if (外.state === 'blocked' || 外.state === 'running') return 'stop'
  return 'wait'
}
const 分钟Of = at => { const ms = Date.now() - Date.parse(at || ''); return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : null }
/** 外部 run 砖的两行：一行照旧是派它的节点写的那句；二行写它此刻的事实。 */
export function 外部两行(r, 态, 等 = '') {
  const 外 = r.外部 || {}, 问 = r.问题 ? ' · ' + 译('等你定：{question}', { question: r.问题 }) : ''
  const 一行 = r.工作内容 || 译('（没写工作内容）')
  if (态 === 'done') return { 一行, 二行: `${r.交付结论 || 译('已交回')}${问}`, 二行全: [r.交付结论 + ((r.交回 || r.偏差) ? 译('：') + (r.交回 || r.偏差) : ''), r.问题 && 译('等你定：{question}', { question: r.问题 })].filter(Boolean).join('\n') }
  if (态 === 'run') {
    const 分 = 分钟Of(外.startedAt)
    return { 一行, 二行: [译('{who} 在做', { who: 外.执行者 }), 分 === null ? '' : 分 < 1 ? 译('不到 1 分钟') : 译('{n} 分钟', { n: 分 }), 外.刚才 && 译('刚才：{text}', { text: 外.刚才 })].filter(Boolean).join(' · ') }
  }
  if (态 === 'stop' && 外.state === 'blocked') return { 一行, 二行: 译('停着：{reason}', { reason: String(外.原因 || 译('要你处理')).split(/[（：]/)[0] }), 二行全: 译('停着：{reason}', { reason: 外.原因 || 译('要你处理') }) }
  if (态 === 'stop') {
    const 因 = 外.停因 || 译('Blueprint 重起了')
    return { 一行, 二行: 译('停下了：{reason}', { reason: 因 }), 二行全: 译('停下了：{reason}。点「全部启动」，它从停下的地方重新开一次。', { reason: 因 }) }
  }
  if (外.state === 'retrying') return { 一行, 二行: 译('{who} 连不上服务，稍后自动再试', { who: 外.执行者 }) }
  return { 一行, 二行: 等 || 译('等 {who} 开工', { who: 外.执行者 }) }
}

function 板块文案(part, 号, 我, n, 柜) {
  我 = 我 || {}; n = n || {}
  const { 现块 = [], 等着, 交齐, 册 } = 柜 || {}
  const 交 = (...种类们) => 交了行(现块, 号, 种类们)
  const 等 = () => 等行(等着, 号)
  let 两行
  if (part === 'dock') {
    /* 收口：汇报交了就印它头一句；没交印「收 n／N 份汇报」—— N ＝ 同一层的兄弟，n ＝ 做完了的。 */
    const 我父 = 我.parent
    const 兄弟 = [...((册 && 册.values) ? 册.values() : [])]
      .filter((r) => r && !r.草稿 && r.会话 && r.parent === 我父 && String(r.id) !== String(号)).map((r) => String(r.id))
    const 收了 = 兄弟.filter((x) => 交齐 && 交齐.has(x)).length
    两行 = { 一行: 首句(块Of(现块, '汇报', 号)) || (兄弟.length ? 译('收 {n}／{total} 份汇报', { n: 收了, total: 兄弟.length }) : (我.工作内容 || 译('把这一层合起来'))),
            二行: 交('汇报') || 等() || 我.验收标准 || '' }
  } else {
    /* 派出去的那几格（plan／run）：一行是派他的人写的；二行交了汇报就写，没交写在等什么。 */
    两行 = { 一行: 我.工作内容 || n.r2 || 译('（没写工作内容）'),
            二行: (交齐 && 交齐.has(String(号))) ? 译('交付了') : (等() || 我.验收标准 || n.验收 || '') }
  }
  /* 交回了：二行只印结论（一行放不下交回正文，2026-10-16 用户），正文留给悬停。 */
  if (我.交付结论) {
    两行.二行 = 我.交付结论
    两行.二行全 = 我.交付结论 + ((我.交回 || 我.偏差) ? 译('：') + (我.交回 || 我.偏差) : '')
  }
  return 两行
}

/**
 * 这个会话在名册上是哪一格 —— 自己查得到就是自己；查不到就顺父往上找第一个查得到的，
 * 找到谁**它就是谁的一条支线**（点「撤回／分叉」开出来的那种）。
 *
 * ⚠️ 名册读不出来（空的）时**一步都不往上爬** —— 那会把整棵树折成一块砖，
 * 而「读不出」和「没有」必须分得开。
 *
 * **分得开「派出去的一格」和「同一格的另一条线」的只有名册。** 树和信息流两页
 * 共用这一份，别造第三条（2026-09-03 信息流接上分叉时提出来的）。
 *
 * @param {Map} 册 会话 → 名册那一行
 * @param {(id:string)=>string} 父 顺着谁往上爬（树用 `parent`，信息流用 `parentSession`）
 * @param {string} id 要问的那条会话
 * @param {string} root Blueprint会话（它永远算自己那一格）
 */
function 谁的线(册, 父, id, root) {
  if (!册.size) return id
  let cur = id
  for (let hop = 0; cur && hop < 64; hop++) {
    if (册.has(cur) || cur === root) return cur
    cur = 父(cur)
  }
  return id
}

/** run 用 dsh 自带的 subagent／subagent_fork 开的会话（无 2）：出身记录里 provider 是 spawn 或 fork。批量帮助、迭代工作不算。 */
export const 是子run会话 = evs => (evs || []).some(e => e.type === 'subagent/descriptor' && 子run提供方们.includes(e.data?.provider))
const 子run名Of = evs => String((evs || []).find(e => e.type === 'subagent/descriptor')?.data?.label || '').trim()

export function seatTree(by, ids, root, evsById, 等你, 册, 等着, 退了, 交齐, 现块, chosen, 脉搏开 = false, 子run们 = []) {
  等你 = 等你 || new Set()
  等着 = 等着 || new Map()
  退了 = 退了 || new Map()
  交齐 = 交齐 || new Set()
  册 = 册 || new Map()
  const read = new Map(ids.map((id) => [id, seatReadout(evsById.get(id) || [])]))

  const kidsOf = new Map(ids.map((i) => [i, []]))
  for (const id of ids) {
    const p = by.get(id)?.parentSession
    if (kidsOf.has(p)) kidsOf.get(p).push(id)
  }
  const depthOf = new Map([[root, 0]])
  for (const id of ids) {
    if (depthOf.has(id)) continue
    let d = 0, cur = id
    while (cur && cur !== root && d < 64) { cur = by.get(cur)?.parentSession; d++ }
    depthOf.set(id, d)
  }

  /**
   * 「在行动」读原生 Agent.status 投影到会话行的 running。
   * 活 Agent 也可能 idle；取消或异常后账本可能缺 turn/end，两者都不能冒充运行。
   * 旧离线调用没有 running 字段时，才用 active 与轮边界判定。
   */
  const 开着一轮 = (id) => {
    const evs = evsById.get(id) || []
    for (let i = evs.length - 1; i >= 0; i--) {
      if (evs[i].type === 'turn/end') return false
      if (evs[i].type === 'turn/start') return true
    }
    return false
  }
  const 在跑 = (id) => typeof by.get(id)?.running === 'boolean'
    ? by.get(id).running : !!by.get(id)?.active && 开着一轮(id)

  /* 「等 N1.2」只写给**此刻停着**的（DESIGN_GUIDE 3.2）：`等着的()` 给的是名册那一半（派出的、还没交付的孩子），
     在不在跑是 dsh 的事，在这儿筛（2026-09-24：名册不再记「等待」）。 */
  const 号到会话 = new Map([...册.values()].filter((r) => r && r.会话).map((r) => [String(r.id), String(r.会话)]))
  等着 = new Map([...等着].filter(([号]) =>
    !(号到会话.has(String(号)) && 在跑(号到会话.get(String(号))))))

  /**
   * **被停下了** —— 红灯的唯一判据（2026-09-14 用户裁定：只有人为停止、系统重启、总开关关了）。
   * - 人为停止：最后那条 `turn/end` 是用户按的停（跟弧「不叫他」同一条判据，`arc` 的 `用户叫停的()`）
   * - 系统重启：最后一轮是崩溃后补的句号（`interrupted`），或者一轮开着、内存里却没有这个 Agent
   *   （进程重启，那条 `turn/start` 再也等不到 `turn/end`）
   * - 总开关关了：这个项目的 PULSE 关着 —— 此刻没有任何东西会叫醒它
   * - 出事故：最后一轮炸了（`error`，API 报错／断网）、撞上输出上限（`max-tokens`）、被拦下（`blocked`）
   *   —— 2026-09-14 用户裁「算红」：不是人停的，但没人会来救它，⏸ 会让你以为它在等
   * 你在那一格说一句话就开了新回合，前两条自己就解了。
   */
  const 断掉的轮 = new Set(['interrupted', 'error', 'max-tokens', 'blocked'])
  /* **断掉了** ＝ 上面后两条（重启切断 ＋ 出事故）。单拎出来是因为它要压过「完成」（`状态OF()` 第 1.5 条）。 */
  const 断掉了 = (id) => {
    const evs = evsById.get(id) || []
    if (在跑(id)) return false
    if (开着一轮(id)) return true
    for (let i = evs.length - 1; i >= 0; i--) {
      if (evs[i].type === 'turn/start') return false
      if (evs[i].type === 'turn/end') {
        const event = evs[i]
        if (event.data?.reason?.kind === 'blocked') {
          const row = 册.get(id)
          // 交回了的没有要人来救的活：交回那一刻自动续跑刚开的一轮被作废，也是 blocked（10-22 东方僵尸 3 号）。
          if (row?.状态 === '完成') return false
          // 等派出去的下层交回也是等（10-16-1 节点 3：divide 派完那一轮以 blocked 收尾，被画成红）。
          if (row && [row.等纸条, row.等条件, row.等前置, row.等开工孩子, row.等孩子].some(items => items?.length)) return false
          // 旧运行写过的等待事件只用于回读，包含原生 v3→v4 迁移后的命名。
          if (evs.some(e => 历史等待事件.has(e.type) && e.data?.turn === event.data?.turn
            && (e.data?.notes?.length || e.data?.conditions?.length))) return false
        }
        return 断掉的轮.has(String(event.data?.reason?.kind))
      }
    }
    return false
  }
  const 被停下 = (id) => !脉搏开 || 用户叫停的(evsById.get(id) || []) || 断掉了(id)

  /* 「后代在行动」= 子树里有任何一个在跑。判据第 4 条要它（用户定：
     子节点在跑也算运行中）。爬一遍就够，树不深，不值得记忆化。

     ⚠️ 2026-09-01 之前这儿有一条例外：**排掉"同一块砖的另一条带"**。
     那条例外随「一块砖两条带」一起没了 —— Helm 现在是**真的子节点**，
     它在跑，它爹当然算「后代在行动」。而 Blueprint 交完三拍之后照样变得成「完成」：
     Blueprint 交完三拍之后能不能显示「完成」，看的是**它和它下面都不在转**
     （`状态OF()` 第 2 条那后一半）—— Helm 在跑，这张卡就还是「运行中」，那是对的：
     这一格的活确实还没结束。 */
  const 后代在跑 = (id) => (kidsOf.get(id) || []).some((c) => 在跑(c) || 后代在跑(c))

  /* ⚠️ 这儿原来算一张「每块料的现行版号」表（`到版`），传给 `本职搞定了()`。
     **2026-09-05 删了**：那个函数从来没读过它 —— 判「交完没有」走的是弧的
     `交了()`，版本要求写在拍子表 `交.版本` 那一格里，由它自己去看。
     一张算了不用的表，比没有更坏：下一个人会以为版本判断在这儿。 */

  /** 这条会话在名册上是哪一行（一个会话一格）。查不到是 `{}`。 */
  const 名册行 = (sid) => 册.get(sid) || {}

  const nodes = []
  const edges = []
  let event_count = 0
  for (const id of ids) {
    const r = by.get(id) || {}
    const mine = read.get(id)
    const 我 = 名册行(id)
    const hasKids = (kidsOf.get(id) || []).length > 0
    /* **一个会话一个座位**，名册那一行上写着（2026-09-01 起 Helm 自己一行）。 */
    const 座位 = 我.座位 || ''
    /* 名册那一行没写座位 ＝ 名册读不出来（正常情况下 `roster` 一律按
       `默认座位()` 填）。Blueprint 我们认得出，别人认不出就留空 —— 空 ＝ 没拍子，
       宁可少画几颗点，也不按错座位画一排。 */
    const 座 = 座位
    const 图景 = mine.正文.get('图景') || ''
    event_count += 条数Of(evsById.get(id))
    nodes.push({
      node_id: id,
      parent: r.parentSession && by.has(r.parentSession) ? r.parentSession : null,
      children: kidsOf.get(id) || [],
      depth: depthOf.get(id) || 0,
      /* 座位原样发。Blueprint 钉成 blueprint（它是建项目建出来的，名册上那一行也写着）。
         ⚠️ **非 Blueprint 不许兜底成 `run`**（2026-08-31 修）：旧模型里"非 Blueprint 非 helm 就是 run"
         成立，现在每一层都可能是 blueprint —— 一个刚派出去、还没落分工手册的 Blueprint
         会被画成 run，而且不报错。查不到就空着，渲染器印「—」。 */
      座位: 座,
      类型: 我.类型 || '',
      座位名: 我.座位名 || '',
      工作: 我.工作 || '',
      轮们: 我.轮们 || [], 轮数: 我.轮数 || 0, 阶段号: 我.阶段号 || 0, 等新阶段: 我.等新阶段 === true,
      阶段: 我.阶段 || '',
      /* 七个显示态，判据在 `状态OF()`。真会话一律当已启动（2026-08-28 用户裁，见那张清单）。 */
      /* 「等其他节点」那盏灯：`arc` 的 `等着的()`，按**号**索引（号 → 还欠他汇报的孩子），所以从名册那一行拿号。 */
      状态: 我.状态 === '去掉' ? 'gone' : 状态OF(状态输入(id, {
        在行动: 在跑(id),
        后代在行动: 后代在跑(id),
        /* 「等你回应」两种：问答通道上挂着要你答的（方案审核卡），或者节点在对话里问完、用 wait 等你下一句话
           （2026-10-18 用户定：拆掉提问卡以后，这种情境也算等你回应）。 */
        /* 还有一种（10-25 用户）：节点回完你的话、没开工，在等你回话（`等用户回话的()`），不画成 ⏸ 等待中。 */
        有等待状态: 等你.has(id) || (等着.get(String(我.id || '')) || []).includes(等用户输入) || 等用户回话的(evsById.get(id) || []),
        被停下: 被停下(id),
        断掉了: 断掉了(id),
        /* 恒真。**这是 2026-08-28 用户裁的，不是缺口** —— 理由见上面那张缺口清单：
           「每个没在跑的节点，任何时刻都说得出自己在等什么」。
           2026-08-31 我按"零条 user/message ＝ 还没启动"把它改成算出来的，
           **当天回退了**：统筹项目一建就在树上，它说得出自己在等什么 ——
           那就该走第 5 条「等其他节点」，不是第 3 条「未启动」。
           那条裁定原话还写着：**不许为了让 `idle` 命中去造机制。**

           ⚠️ 那条裁定的前提是**下面那一格真答得出来**：修的永远是让他答得出来，不是把 `已启动` 改成假。 */
        已启动: true,
        /* **一个号一条等待**：`等着的()` 按号索引，而一个号就是一个会话 —— 屏幕上写着他在等什么，机器就真在等什么。 */
        有未满足的卡点: (等着.get(String(我.id || '')) || []).length > 0,
        /* 收口了没有。判据表头两条，压在所有别的之上 —— 一格收口了，
           它在不在跑就不重要了。**两条都算出来的，柜子里没有「状态」那种料。** */
        关停了: 退了.has(String(我.id || '')),
        /* 「本职工作搞定」判据在 `本职搞定了()` 头上，跟弧「没交不许停」读同一份。 */
        本职搞定: 本职搞定了(座, String(我.id || ''), 现块),
      })),
      /* 三行字的分工（2026-08-25 用户定）：小词块＝座位名（渲染器认 `座位` 那个字，
         认不出的原样印），r1＝Blueprint 写任务名称、子写角色名称（派活的人取的），r2＝工作内容（10 字以内，
         Blueprint 座位固定），验收＝镜像卡那一行（18 字以内，派活的人写的；Blueprint＝图景头一行）。 */
      r1: id === root ? (String(r.cwd || '').split('/').filter(Boolean).pop() || '（无文件夹）')
                      : (我.name || '（还没落分工手册）'),
      /* r2 ＝ 工作内容，**所有座位一个出处：名册**。Blueprint 那一行由建项目时机器落的
         《登记·0》给（2026-08-31 之前这儿对 Blueprint 写死一句，现在 Blueprint 跟别人一样了）。 */
      r2: 我.工作内容 || (id === root ? '想清楚这个项目该是什么样' : '（没写工作内容）'),
      验收: id === root ? (图景 ? headline(图景) : '等图景')
                        : (我.验收标准 || '（没写验收标准）'),
      /* 名册上那个位置号（`1` / `1.2`）。**每一格都印**（2026-08-31 改）：
         原来只发给 Helm（那一位 09-18 删了）。现在树是一对一对长的，
         合卡上要同时印这一格的号和它收口那一位的号，看不见号就分不清哪一对是哪一对。 */
      编号: String(我.id || (id === root ? Blueprint号 : '')),
      /* 目标卡悬停读全文 —— 折叠不摘要。Blueprint 读《图景》，子读**他那份分工手册的两段**。 */
      brief: id === root
        ? (图景 ? { raw: 图景, acceptance: [] } : null)
        : (我.理解 || 我.预期
            ? { raw: [我.理解 && `上级怎么理解这一格：${我.理解}`,
                      我.预期 && `上级期待它长成什么样：${我.预期}`].filter(Boolean).join('\n\n'), acceptance: [] }
            : null),
      /* **「自己闲着，但手下在跑」** —— 渲染器拿它挂 `echo` 类，
         CSS 藏掉跳动的三点、露出静态 ▶（`mirror.css`：`.s-run.echo`）。
         一个 plan 把人派出去之后就是这个样子：它自己没事干了，**但这一支是活的**。

         ⚠️ **不是字面的「后代在不在跑」**，是「这张卡该不该画成回声」：
         自己也在跑的时候要显示动画 —— 那才是"它自己在动"。
         CSS 和渲染器早就写好了（`.s-run.echo` ＋ `n.后代在跑 ? ' echo'`），
         **一直缺的就是这一行**（2026-08-28 补，用户报的第 5 条）。 */
      后代在跑: 后代在跑(id) && !在跑(id),
      /* 原始事实跟着一起过去。**注意 `active` 不是「在行动」** ——
         它只说明内存里有个活 Agent（点一下就会被 resume 成活的）。 */
      active: !!r.active,
    })
    if (r.parentSession && by.has(r.parentSession)) {
      edges.push({ from: r.parentSession, to: id })
    }
  }

  /* ⚠️ 这儿原来给"还没派人的项目"挂三张 `ghost:` 假卡，2026-08-28 跟 `GHOSTS`
     一起删了。理由见那个常量原来待的地方。**别加回来。** */

  /* ── 折成砖：一格一张卡；**被自动接续出来的那一位（Dock）并进它爹那张卡的下半截** ──────
     折的是显示单位，账本上他们是完全独立的节点（2026-09-01 用户：「只是显示的时候放在一起」）。
     **支线并回它那条带**：点「分叉」开出来的会话，账本上是一个带 `parentSession` 的新会话 ——
     照 `parentSession` 画就会凭空多一格。分叉不是派活，是同一个节点的另一条线
     （用户 2026-08-26 裁定：「轨迹真正的作用是一个对话内撤回，或者开支线的情况」）。
     **分得开它俩的只有名册**，跟时间线那边 `派出去的` 同一条判据 —— studio 里只此两处，别造第三条。 */
  const 按会话 = new Map(nodes.map((n) => [n.node_id, n]))
  /* 板块文案要读的柜子里的事实，画树那一刻读好的（`lineage()` 传进来），这儿只是打包递下去。
     `行Of`：按号查名册那一行 —— 还没出生的带没有会话可查，只有号。 */
  const 柜 = { 现块, 等着, 交齐, 册 }
  const 行Of = (k) => [...册.values(), ...现块].find((r) => String(r.id) === String(k)) || {}
  const 砖们 = []
  const 砖表 = new Map()          // 卡的键（＝上带那一格的号）→ 砖
  const 归属 = new Map()          // 会话 → 砖
  const 带按主 = new Map()        // 名册上那个节点的会话 → 它在卡上那一条

  const 名册主 = (id) => 谁的线(册, (x) => (按会话.get(x) || {}).parent, id, root)

  for (const n of nodes) {
    /* 帮手会话（批量帮助、迭代工作）不上树：它在派它的那个节点那一步里，结果回到那个节点。
       不拦的话它会被当成那条带的支线。 */
    if (by.get(n.node_id)?.origin === 'subagent') continue
    const 主 = 名册主(n.node_id)

    /* ── 支线：不开砖、不开带，挂到它那条带上 ──
       `ids` 是广度优先，主一定先进来，所以这儿一定拿得到那条带。 */
    if (主 !== n.node_id) {
      const 带 = 带按主.get(主)
      if (带) {
        /* 记下这条线就行 —— **这条带最后指向哪一条，在下面那一轮统一挑**
           （挑法：你最后说过话的那条）。这儿挑会挑错：广度优先只保证主先进来，
           不保证支线按时间进来。 */
        (带.线们 || (带.线们 = [主])).push(n.node_id)
        const 那砖 = 归属.get(主)
        归属.set(n.node_id, 那砖)
        if (那砖 && n.后代在跑) 那砖.后代在跑 = true
        continue
      }
      /* 那条带没找到 —— 不该发生。**不静默吞掉**：退回原来的画法，
         它自成一块野砖，宁可多画一格也不让一条真线人间蒸发。 */
    }

    const 我 = 册.get(主) || {}
    const 号 = String(我.id || (主 === root ? Blueprint号 : ''))
    const part = String(我.座位 || '')
    /* **被自动接续出来的那一位画在它爹那张卡的下半截** —— 判据是座位卡上「有没有人指着我」（`被接出()`），不是座位名。
       爹也是被接续出来的，就一路往上找到不是被接续出来的那一格。 */
    const 并进爹 = !!被接出(part)
    const 座Of号 = (k) => String(([...册.values()].find((r) => String(r.id) === String(k)) || {}).座位 || '')
    let 爹键 = 我.parent || 号
    while (并进爹 && 父号(爹键) !== null && 被接出(座Of号(爹键))) 爹键 = 父号(爹键)
    const 键 = 号 ? (并进爹 ? 爹键 : 号) : `野·${n.node_id}`
    let 砖 = 砖表.get(键)
    if (!砖) {
      砖 = { 号: 并进爹 ? 键 : 号, 名字: 我.name || n.r1, 是Blueprint: 键 === Blueprint号, 是根: 我.parent === null, 键,
             node_id: n.node_id, parent: null, children: [], depth: n.depth,
             /* `拍分隔` ＝ **在第几颗点之前画一条竖线**，一段一条，空数组＝不画。
                ⚠️ **2026-09-07 从单个数字改成数组。** 原来一张卡只画得下一条分隔，
                够用是因为那时候未出生的带不画拍子 —— Blueprint 卡就只有
                「blueprint 展开 │ helm 展开」一条缝。现在未出生的带也画（空心点），
                Blueprint 卡有三段（blueprint 展开│helm 展开│Blueprint 的收口），一个数字装不下。
                ⚠️ 里面不许出现 0：判的是「第 i 颗点之前画不画」，0 会在第一颗点
                前面画一条（2026-09-02 加航向时撞过）—— 下面那句 `if (轨.length)` 挡着。 */
             带们: [], 下带号: '', 拍子: [], 拍分隔: [],
             /* 重置后的节点类型与座位：图纸按「这件工作」筛、按座位标。 */
             类型: 我.类型 || '', 座位名: 我.座位名 || '', 工作: 我.工作 || '', 阶段: 我.阶段 || '', 用户草稿: 我.用户草稿 === true, 开工模式: 我.开工模式 || 'build',
             /* 固定线上的轮（10-23）：砖在哪几轮干过活、每轮的快照；helm 带这件工作一共几轮。 */
             轮们: 我.轮们 || [], 轮数: 我.轮数 || 0, 阶段号: 我.阶段号 || 0, 等新阶段: 我.等新阶段 === true,
             /* run 交给了谁（叶 3、D6）：顶栏标「run · Codex」。 */
             执行者: 我.执行者 || '', 执行者全名: 我.执行者全名 || '',
             后代在跑: false, brief: n.brief }
      砖表.set(键, 砖); 砖们.push(砖)
    }
    /* `主会话` ＝ 名册上记的那条线。**接父子只许认它** —— `会话` 会被支线换掉，
       照 `会话` 往上找父，找到的是自己那块砖，这块砖就自己断成一棵新树。 */
    const 带 = { part, 座位: part, 号, 会话: n.node_id, 主会话: n.node_id, 有对话: (evsById.get(n.node_id) || []).some(e => e.type === 'turn/start'), 状态: n.状态, ...板块文案(part, 号, 我, n, 柜) }
    砖.带们.push(带)
    带按主.set(n.node_id, 带)
    归属.set(n.node_id, 砖)
    /* 卡的身份 ＝ **上带**：点它跳到那个会话，深度也照它算。下带（Dock）只贡献自己那个号。 */
    if (并进爹) 砖.下带号 = 号
    else { 砖.node_id = n.node_id; 砖.depth = n.depth; 砖.名字 = 我.name || n.r1; 砖.brief = n.brief }
    if (n.后代在跑) 砖.后代在跑 = true
  }

  /* ── 一条带指向哪条线：**你最后说过话的那一条** ──────────────────────────
     （2026-09-03 用户裁定，原话：「我需要无论如何永远显示时间是我最后对话过的那条线」。）

     一个节点可以有好几条线：主线 ＋ 每次「撤回／分叉」开出来的那条。它们是真会话，
     账本上都在，但**卡上只有一条带**，带只能指一条。原来指的是**名册上那条**（主线），
     于是从 a 撤回开出 b、在 b 上说了半天，一刷新又回到 a —— 你写的东西还在，
     只是这张脸把你送回了旧的那条，看起来像"撤回没生效"。

     判据换成**时间**：这条带上的所有线里，最后有动静的那条赢。
     - 时间取那条线**最后一条事件**的时刻（账本上的事实，重启后照样算得出来 ——
       内存里那份 `lastActive` 重启就空了，所以不能只靠它）。
     - 读不出事件的线退到会话表上的 `lastActive`／`createdAt`，一个都没有就算 0。
     - **你此刻正站着的那条线永远赢**：你可能故意点回旧线去看，那一刻它就该是它。 */
  const 末时 = (id) => {
    const evs = evsById.get(id)
    const 末 = evs && evs.length ? evs[evs.length - 1] : null
    const 行 = by.get(id) || {}
    return Math.max(Number(末 && 末.time) || 0, Number(行.lastActive) || 0, Number(行.createdAt) || 0)
  }
  for (const 带 of 带按主.values()) {
    const 线们 = 带.线们
    if (!线们 || 线们.length < 2) continue
    const 赢 = (chosen && 线们.includes(chosen)) ? chosen
      : 线们.reduce((a, b) => (末时(b) > 末时(a) ? b : a), 带.主会话)
    if (赢 === 带.会话) continue
    带.会话 = 赢
    const 那 = 按会话.get(赢)
    if (那) { 带.状态 = 那.状态; 带.有对话 = (evsById.get(赢) || []).some(e => e.type === 'turn/start') }
  }


  /* ── 被接续出来的那几位也出生就摆（2026-09-14 用户：「dock 默认加载在这个大节点下面，新建项目之后都在」）──
     沿座位卡上 `交完自动起` 一路往下（blueprint／plan → dock），还没开出来的画成未出生的带；号照弧的规矩推（`<上一位>.0`）。
     带的先后：这一格自己那条在前，被接续出来的垫底。 */
  for (const 砖 of 砖们) {
    if (!砖.号 || !砖.带们.length) continue
    const 上带 = 砖.带们.find((z) => !被接出(z.part)) || 砖.带们[0]
    const 座 = String(上带.座位 || 上带.part || '')
    if (!座) continue
    const 有了 = new Set(砖.带们.map((z) => String(z.part)))
    const 走过 = new Set([座])
    for (let 接 = 接续(座), 接号 = 砖.号; 接 && !走过.has(接); 接 = 接续(接)) {
      走过.add(接)
      接号 = `${接号}.0`
      if (有了.has(接)) continue
      砖.带们.push({ part: 接, 座位: 接, 号: 接号, 会话: '', 主会话: '', 状态: 'idle',
                     ...板块文案(接, 接号, 行Of(接号), {}, 柜) })
    }
    砖.带们.sort((x, y) => (被接出(x.part) ? 1 : 0) - (被接出(y.part) ? 1 : 0))
  }

  /* 卡上第二格印的是 `part` ＝ 座位 ＝ 节点的种（名册视图 `旧行()`；2026-09-27 第十件，拍删了，暂定，第三步由用户定）。 */

  /* ── 交给 Codex／Claude Code 的 run（叶 6）：没有会话，照名册那一行画一块砖，挂在派它的节点下面 ──
     状态和第二行照样稿（2026-10-18 用户批）：在做／交回了（带问题时多一句「等你定」）／停着等你处理（珊瑚色）。 */
  for (const r of 现块) {
    if (!r || !r.外部 || r.会话 || r.状态 === '去掉' || 砖表.has(String(r.id))) continue
    const 号 = String(r.id), 父会话 = 行Of(r.parent).会话 || ''
    if (!父会话 || !归属.has(父会话)) continue
    const 态 = 外部态(r)
    砖们.push(砖表.set(号, { 号, 名字: r.name, 是Blueprint: false, 是根: false, 键: 号, node_id: `外部:${号}`, parent: null, children: [], depth: 0,
      带们: [{ part: '', 座位: '', 号, 会话: '', 主会话: '', 有对话: false, 状态: 态, 外部: r.外部, ...外部两行(r, 态, 等行(等着, 号)) }],
      下带号: '', 拍子: [], 拍分隔: [], 类型: 'run', 座位名: '', 工作: r.工作 || '', 阶段: '', 用户草稿: false, 开工模式: 'build', 轮们: r.轮们 || [], 轮数: 0,
      执行者: r.外部.短名, 执行者全名: r.外部.执行者, 后代在跑: false, brief: null, 外部父会话: 父会话 }).get(号))
  }

  /* ── 排着的下一阶段总分身（阶 7）：stage 记了不止一个阶段时排的，还没有会话；照名册那一行画一块砖，进总 seat 的阶段名单。 */
  for (const r of 现块) {
    if (!r || r.类型 !== 'helm' || r.状态 !== '待做' || r.会话 || 砖表.has(String(r.id))) continue
    const 号 = String(r.id)
    砖们.push(砖表.set(号, { 号, 名字: r.name, 是Blueprint: false, 是根: true, 键: 号, node_id: `排着:${号}`, parent: null, children: [], depth: 0,
      带们: [{ part: '', 座位: '', 号, 会话: '', 主会话: '', 有对话: false, 状态: 'idle', 一行: r.name, 二行: 译('排着：等 {n} 号这一阶段交棒', { n: r.接 }) }],
      下带号: '', 拍子: [], 拍分隔: [], 类型: 'helm', 座位名: '', 工作: r.工作 || 号, 阶段: '', 用户草稿: false, 开工模式: 'build', 轮们: [], 轮数: 0, 阶段号: r.阶段号 || 0,
      执行者: '', 执行者全名: '', 后代在跑: false, brief: null }).get(号))
  }

  /* ── 登记着还没派出的块（第三版，十 52；10-25 用户「登记了没派出的也显示出来暂停状态」）：没有会话、没有工作文档，
     照名册那一行画一块「未启动」的砖（没跑过、在等：纯灰、半透明，跟跑过、在等的暂停 ⏸ 分开），挂在登记它的 dock 下面；第二行写在等哪几块交回，前提齐了写等它的上级派出。
     点不进对话，不进 Start All（Start All 只叫有会话的）。 */
  for (const r of 现块) {
    if (!r || r.状态 !== '待做' || r.会话 || r.外部 || r.类型 === 'helm' || 砖表.has(String(r.id))) continue
    const 号 = String(r.id), 父会话 = 行Of(r.parent).会话 || ''
    if (!父会话 || !归属.has(父会话)) continue
    const 二行 = r.等依赖?.length ? 译('登记着：等 {list} 交回', { list: r.等依赖.join('、') }) : 译('登记着：前提齐了，等 {n} 派出', { n: r.parent })
    砖们.push(砖表.set(号, { 号, 名字: r.name, 是Blueprint: false, 是根: false, 键: 号, node_id: `登记:${号}`, parent: null, children: [], depth: 0,
      带们: [{ part: '', 座位: '', 号, 会话: '', 主会话: '', 有对话: false, 状态: 'idle', 一行: r.工作内容 || r.name, 二行 }],
      下带号: '', 拍子: [], 拍分隔: [], 类型: r.类型, 座位名: '', 工作: r.工作 || '', 阶段: '', 用户草稿: false, 开工模式: 'build', 轮们: [], 轮数: 0,
      执行者: r.执行者 || '', 执行者全名: r.执行者全名 || '', 后代在跑: false, brief: null, 外部父会话: 父会话 }).get(号))
  }

  /* ── run 用 dsh 自带的 subagent 开的会话（无 2；2026-10-18 用户：「run 开的 sub 也用节点的形式显示，但是右上角加一个 sub 的角标」）──
     不在名册上：照会话画一块砖，挂在开它的 run 下面；号接在 run 的号后面（.s1、.s2，按开出的先后），名字是那次交代的简短描述。
     在跑画在跑；你按停或断掉画停下；其余算做完了——它一次做完，回答已经回到开它的 run。点它看它的对话。 */
  const 子run按父 = new Map()
  for (const id of 子run们) {
    const 父会话 = by.get(id)?.parentSession
    if (父会话 && 归属.has(父会话)) (子run按父.get(父会话) || 子run按父.set(父会话, []).get(父会话)).push(id)
  }
  for (const [父会话, 们] of 子run按父) {
    const 父砖 = 归属.get(父会话)
    们.sort((a, b) => (Number(by.get(a)?.createdAt) || 0) - (Number(by.get(b)?.createdAt) || 0))
    们.forEach((id, i) => {
      const 号 = `${父砖.号}.s${i + 1}`, 名 = 子run名Of(evsById.get(id)) || 'sub'
      const 态 = 在跑(id) ? 'run' : 被停下(id) ? 'stop' : 'done'
      if (态 === 'run' && !在跑(父会话)) 父砖.后代在跑 = true
      const 二行 = 态 === 'run' ? 译('在做') : 态 === 'stop' ? 译('停下了') : 译('做完了，回答已回到 {n}', { n: 父砖.号 })
      const 砖 = { 号, 名字: 名, 是Blueprint: false, 是根: false, 键: 号, node_id: id, parent: null, children: [], depth: 0,
        带们: [{ part: '', 座位: '', 号, 会话: id, 主会话: id, 有对话: true, 状态: 态, 一行: 名, 二行 }],
        下带号: '', 拍子: [], 拍分隔: [], 类型: 'run', 座位名: '', 工作: 父砖.工作 || '', 阶段: '', 用户草稿: false, 开工模式: 'build',
        执行者: '', 执行者全名: '', sub: true, 后代在跑: false, brief: null, 外部父会话: 父会话 }
      砖们.push(砖); 砖表.set(号, 砖); 归属.set(id, 砖)
    })
  }

  /* 父子：认**卡**，不认会话。一张卡的父 ＝ 它上带的父会话所在的那张卡；
     统筹的父会话是 Blueprint，落在同一张卡里，自然不成边（那条真父子边被折进卡里了）。 */
  for (const 砖 of 砖们) {
    const 上带 = 砖.带们[0]
    const 父会话 = 砖.外部父会话 || (按会话.get(上带.主会话 || 上带.会话) || {}).parent
    const 父砖 = 父会话 && 归属.get(父会话)
    if (父砖 && 父砖 !== 砖) { 砖.parent = 父砖.node_id; 父砖.children.push(砖.node_id) }
  }

  /* 深度按**卡**重算 —— 服务端原来那个 `depth` 是按会话数的，
     一张卡两个会话，照它排每层会多吃一列。 */
  const 根砖们 = 砖们.filter(z => !z.parent)
  const Blueprint砖 = 砖们.find(z => z.node_id === root) || 根砖们[0]
  for (const 根砖 of 根砖们) (function 走(z, d) { z.depth = d; for (const c of z.children) { const k = 砖们.find(x => x.node_id === c); if (k) 走(k, d + 1) } })(根砖, 0)

  /* 拍子轨 09-13 删了（拍子表没了）：`拍子`／`拍分隔` 留空数组 —— 砖创建时就是这个值。 */

  /* ── 镜像（`DESIGN_GUIDE.md` 3.5）：每张卡一张，只写一件事 —— **它的目标**（2026-09-29 用户：「镜像表示目标」）──
     目标是派它的节点出生时写的那一句（名册上的 `goal`，写了不再改）；0 的目标是它跟用户定下的图景，从它工作文档里读。
     交差了（名册上「完成」）→ 镜像虚变实。点它 ＝ 打开它的工作文档。**一个字不判断状态。** */
  for (const 砖 of 砖们) {
    const 上带 = 砖.带们[0]
    const k = String((上带 && 上带.号) || '')
    const r = k ? 行Of(k) : {}
    砖.目标 = r.目标 || (砖.是Blueprint ? '等图景' : '—')
    砖.目标全 = [r.目标全, r.交付结论, r.交回 || r.偏差].filter(Boolean).join('\n')
    砖.交了 = r.状态 === '完成'
    砖.文档位 = r.文档 || ''
    if (r.previous) 砖.previous = r.previous
  }

  /* ── Start All 叫谁（`DESIGN_GUIDE.md` 3.8d，2026-09-24 用户：「加回来」）──
     停着、还没交付的：亮红的（你按的停、重启切断、出事故断了），和没东西可等卡住的（停着、没交付、孩子都交付了）。
     在跑的、在问你的、交付了的、仍等子节点的不在里面；创建未完的团队从现有父节点补齐会话。**前端一个字不判断**，照这张单发「继续」。
     **只叫名册上的节点**（2026-10-15 修）：同一文件夹里名册没登记的会话（dsh 原生「新会话」开出的空会话）也会画成一块野砖，
     它没有号、查不到交没交，原来照「未开工」进了单子，收到的「继续」成了它的第一句话。名册行认的是带的主线，支线照旧随带。 */
  const 要叫 = []
  for (const 砖 of 砖们) {
    for (const 带 of 砖.带们) {
      if (!带.会话 || !册.has(String(带.主会话)) || 等你.has(String(带.会话))) continue
      const 待交 = (等着.get(String(带.号)) || []).length
      const 未交回 = 行Of(带.号).状态 !== '完成'
      const 卡住 = 带.状态 === 'wait' && 未交回 && !待交
      const 未开工 = 带.状态 === 'idle' && 未交回 && !待交
      const 缺会话 = 待交 && (等着.get(String(带.号)) || []).some(x => !行Of(x).会话)
      if (未交回 && (带.状态 === 'stop' || 卡住 || 未开工 || 缺会话)) 要叫.push(String(带.会话))
    }
  }

  return { project: root, event_count, roots: 根砖们.map(z => z.node_id), nodes: 砖们, edges, 全启: { 要叫 } }
}

/**
 * 从当前会话出发，找出它所属的整条血脉：先顺 parentSession 爬到 Blueprint，再收全部后代。
 *
 * **这一步一条事件都不用读** —— `parentSession` / `seedLength` 是 dsh 落盘时
 * 就写在 SessionHeader 里的。那棵树是白拿的。
 *
 * @param {readonly object[]} rows listSessions() 的返回
 * @param {string} chosen 当前会话 id
 * @returns {{ids:string[], root:string}} 这条血脉里的会话 id（Blueprint 在前），与 Blueprint 的 id
 */
export function lineageIds(rows, chosen) {
  const by = new Map(rows.map((r) => [r.id, r]))
  const projectRoot = by.get(chosen)?.projectRootSession
  let root = projectRoot && by.has(projectRoot) ? projectRoot : chosen
  if (!projectRoot) {
    const seen = new Set([chosen])
    for (;;) {
      const p = by.get(root)?.parentSession
      if (!p || !by.has(p) || seen.has(p)) break
      seen.add(p); root = p
    }
  }
  const stable = rows.filter(r => !r.replacedBySession).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const roots = projectRoot ? stable.filter(r => r.projectRootSession === root && !r.parentSession).map(r => r.id) : [root]
  const ids = [root, ...roots.filter(id => id !== root)]
  for (let i = 0; i < ids.length; i++) {
    for (const r of stable) {
      if (r.parentSession === ids[i] && !ids.includes(r.id)) ids.push(r.id)
    }
  }
  return { ids, root }
}

// ------------------------------------------------- 折叠视图:条目 / 统计 / 轨迹

/**
 * 一次走完整条事件流，折出四样东西。**现算，不落存储**。
 * @param {readonly object[]} events 会话事件，按 seq 升序
 * @returns {{entries:object[], stats:object, turns:object[], undrawn:object, structural:number, total:number}}
 */
/* ================= 单价表:输入栏那个「¥」的全部来源 =================
   一张 JSON,跟这个包放在一起(`blueprint/packages/studio/单价.json`)。
   **不写死在代码里** —— 单价是会变的事实(官网随时调价),不是逻辑。
   存盘即生效:靠 mtime 认新,不用重起服务。
   读不出 / 表里没这个模型 → **不算,并且如实报缺了哪个键**。一分钱都不许猜。 */
const 单价路径 = resolve(HERE, '..', '单价.json')
let 单价缓存 = { 时: -1, 表: null }
async function 单价() {
  let 时
  try { 时 = (await stat(单价路径)).mtimeMs } catch { return { 币: '¥', 价: {}, 坏: '这个包旁边没有 单价.json' } }
  if (单价缓存.时 === 时 && 单价缓存.表) return 单价缓存.表
  let 表
  try {
    const j = JSON.parse(await readFile(单价路径, 'utf8'))
    表 = { 币: String(j['币'] ?? '¥'), 价: (j['价'] && typeof j['价'] === 'object') ? j['价'] : {}, 官方分时: j.官方分时 }
  } catch (e) {
    /* JSON 写坏了必须说出来。静默当空表 ＝ 把「我少打了一个逗号」演成「这个模型没价」 */
    表 = { 币: '¥', 价: {}, 坏: `单价.json 读不了：${String((e && e.message) || e)}` }
  }
  单价缓存 = { 时, 表 }
  return 表
}

/** 按模型分好的桶 × 单价 ＝ 钱。
 *  单价.json 里四个数的单位是**元 / 每百万 token**,所以除 1e6。
 *
 *  **只要有一个模型查不到价,就不给总数**(`合计: null`)——
 *  少算一截再报个总数,那个总数会被当成全部,那正是暗层。
 *  缺哪个就把键原样报出去,用户照着往表里填。
 *  `已算` 是算得出来的那部分,界面拿它说「至少 ¥x」,不冒充总数。
 */
function 算钱(stats, 表) {
  const 桶 = (stats && stats.按模型) || {}
  const 键 = Object.keys(桶)
  if (!键.length) return null
  const 缺 = [], 分项 = {}
  let 已算 = 0
  for (const k of 键) {
    const p = 表.价[k]
    if (!p || typeof p !== 'object') { 缺.push(k); continue }
    const b = 桶[k]
    const 钱 = (b.input * (Number(p['输入']) || 0)
              + b.cacheRead * (Number(p['缓存读']) || 0)
              + b.cacheWrite * (Number(p['缓存写']) || 0)
              + b.output * (Number(p['输出']) || 0)) / 1e6
    分项[k] = 钱
    已算 += 钱
  }
  return { 币: 表.币, 合计: 缺.length ? null : 已算, 已算, 分项, 缺, 坏: 表.坏 }
}

/** 一个桶加进另一个桶。桶 ＝ `{input, cacheRead, cacheWrite, output}`。 */
function 并桶(收, k, b) {
  const t = 收[k] || (收[k] = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
  t.input += b.input || 0
  t.cacheRead += b.cacheRead || 0
  t.cacheWrite += b.cacheWrite || 0
  t.output += b.output || 0
}

/**
 * **整个项目烧了多少** —— 树上每一格。
 *
 * 顶栏那一行就是这个数。它跟输入条上那个「累计」**不是一件事**：那个只讲你正看着
 * 的这一格，这个讲整棵树 —— 而钱是按整棵树出的。
 *
 * 三条口径，每一条都能把数算错，所以写在这儿：
 *
 * ① **分叉／支线不许重复计数。** dsh 开支线是把父的前 `seedLength` 条事件
 *    物理复制进子会话。照单全收地加一遍，那几轮的钱就收了两次。所以每条线
 *    只数它种子边界之后的部分（`seedLength` 的单位是事件条数）。
 *    实测有 `seedLength` 大过整个事件数的坏数据，`Math.min` 兜住。
 *
 * ② **按模型分桶，不按会话。** 一条会话中途可以换模型，换了单价就变了；
 *    先乘价再相加是唯一算得对的顺序（`算钱()` 在那一头乘）。
 *
 * ③ **截断要说出来。** 一条血脉一次最多读 `LINEAGE_CAP` 个会话；超了那几条的账
 *    根本没读到，这个数就是个下限。`截了` 原样报上去，界面上写「≥」——
 *    悄悄少算一截再报个总数，那个总数会被当成全部（跟 `算钱()` 缺价那一格同一条纪律）。
 *
 * @returns {{input:number,cacheRead:number,cacheWrite:number,output:number,合计:number,按模型:object,会话数:number,截了:number,读不出:number}}
 */
function 全项目用量(by, kept, evsById, 截了) {
  const 按模型 = {}
  let 会话数 = 0
  let 读不出 = 0
  for (const id of kept) {
    const evs = evsById.get(id)
    /* 读不出的那条线**不许当成 0** —— 它烧过的钱是真的，只是我们看不见。
       数出来跟截断一条路：界面照样写「≥」。 */
    if (!evs) { 读不出++; continue }
    会话数++
    const seed = Math.min(Math.max(0, Number(by.get(id)?.seedLength) || 0), 条数Of(evs))
    for (let k = 0; k < evs.length; k++) {
      const ev = evs[k]
      if ((ev.i ?? k) < seed) continue   /* 瘦账按原下标比种子边界 */
      if (ev.type !== 'assistant/message') continue
      const u = ev.data?.usage
      if (!u) continue
      const src = ev.data?.message?.source
      /* 报不出模型的记在 '?' 名下 —— 「读不出」要占一格，到了界面上就是「查不到价」。 */
      const 型 = (src && src.provider && src.model) ? `${src.provider}/${src.model}` : '?'
      并桶(按模型, 型, {
        input: u.inputTokens, cacheRead: u.cacheReadTokens,
        cacheWrite: u.cacheWriteTokens, output: u.outputTokens,
      })
    }
  }

  let input = 0, cacheRead = 0, cacheWrite = 0, output = 0
  for (const b of Object.values(按模型)) {
    input += b.input; cacheRead += b.cacheRead; cacheWrite += b.cacheWrite; output += b.output
  }
  return {
    input, cacheRead, cacheWrite, output,
    合计: input + cacheRead + cacheWrite + output,
    按模型,
    会话数,
    截了: Number(截了) || 0,
    读不出,
  }
}

/* `料` ＝ SYS 那一块的料单（`料单Of()` 现算好递进来）。fold 是纯的、读不到磁盘，
   而料单要问柜子、要读文件 —— 所以它在外面算，跟 `座位`、价目表同一个办法。 */
export function fold(events, 座位, 要轨迹 = true, 料 = null) {
  const entries = []
  const undrawn = {}
  let structural = 0

  /* 先走一趟只为收一件事:哪些消息后来真的落成了 user/message。
     `agent/inbox/spliced` 在流水里排在它前面,不先收就判不了它是重复还是还排着。 */
  const consumed = new Map()
  for (const ev of events) {
    if (ev.type !== 'user/message') continue
    const k = msgKey(ev.data)
    consumed.set(k, (consumed.get(k) || 0) + 1)
  }

  const stepStart = new Map()      /* "turn/step" → step/start 的时刻 */
  const firstToken = new Map()     /* "turn/step" → 第一条 chunk 的时刻 */
  const callAt = new Map()         /* callId → 调用时刻 */

  /* ---- 轮尾行:一轮跑完在流里落下的那一行(口径抄 dsh 的 deriveTurnMetrics) ----
     turn → { 起始时刻, 第一步的 TTFT, 解码毫秒与解码 token 的累加, 这一轮的 token 总账 }
     TTFT 取**第一步**那一个读数,不是各步平均 —— dsh 就是这么定的:
     它回答的是「你按下回车之后多久开始看见字」,那只跟第一步有关。
     tok/s 取整轮的 Σ输出token / Σ解码墙钟,只算两样都记全了的步。 */
  const turnAt = new Map()         /* turn → turn/start 的时刻 */
  let entryTurn = null            /* 只认真实 turn/start；无轮字段的消息归属当前打开的轮 */
  const turnFold = new Map()       /* turn → 上面那个累加器 */
  const turnOf = (t) => {
    let f = turnFold.get(t)
    if (!f) {
      f = { firstStep: Infinity, ttftMs: null, decodeMs: 0, decodeTokens: 0, sampled: false,
            input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, steps: 0, at: null }
      turnFold.set(t, f)
    }
    return f
  }
  const stats = {
    turns: 0, steps: 0, llmMs: 0, toolMs: 0,
    ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
    input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0,
    /* **按模型分桶的 token**。为什么要按模型分:一条会话中途可以换模型,
       换了之后单价就变了 —— 把整条会话的 token 乘同一个价,那个数是错的,
       而且错得看不出来。所以这儿只分桶,不乘价(价在 算钱() 里,那儿才读得到价目表)。
       键 = 「厂商/模型」,跟 单价.json 里的键**必须是同一个字符串**。 */
    按模型: {},
    /* **上下文占用**:跟上面那一排累计**不是一件事,别把它俩加在一起看**。
       上面那些是「从头到现在一共烧了多少」(每一步都往上加,只会涨);
       这一个是「最近一步进模型的那一坨有多大」——
       它 ≈ 最后一次 assistant/message 的 (输入 ＋ 缓存读 ＋ 缓存写 ＋ 输出),
       也就是下一步要重新递进去的那一堆。涨到模型的窗口上限,这条会话就跑不动了。
       模型没报 usage 时留 null —— **null 是「读不出」,0 是「真的没有」**,不许混。 */
    context: null,
  }
  const turnSet = new Set()
  let 最后一笔 = null              /* 最近一步的 usage 原件,收尾时折成 stats.context */

  for (const ev of events) {
    const key = `${ev.data?.turn}/${ev.data?.step}`

    if (ev.type === 'step/start') stepStart.set(key, ev.time)
    else if (ev.type === 'assistant/chunk') { if (!firstToken.has(key)) firstToken.set(key, ev.time) }
    else if (ev.type === 'tool/call') callAt.set(String(ev.data.callId), ev.time)
    else if (ev.type === 'turn/start') {
      turnAt.set(ev.data?.turn, ev.time)
      entryTurn = typeof ev.data?.turn === 'number' && Number.isFinite(ev.data.turn) ? ev.data.turn : null
    }

    /* turn/end 自己出一条条目 —— 它是 dsh 那张脸上「轮尾行」的来源:
       时刻 · 用时 · 首 token · tok/s · 这一轮的 token,外加分叉的锚点。
       锚点用 turn/end 自己的 seq:dsh 的 fork 要求种子止于一个跑完的 turn/end,
       这条事件本身就是那个边界,不用去猜。 */
    const entry = ev.type === 'turn/end' ? turnTail(ev, turnAt, turnFold)
      : ev.type === 'agent/inbox/spliced' ? queued(ev, consumed)
        : entryOf(ev, 料)
    /* 每条条目钉上它出自的 seq —— 这是「轨迹表 → 对话」那一跳的锚点。
       轨迹里每条记录身上本来就有 sourceSeq,两边同一个坐标系,不用再造第三套编号。 */
    const turn = 事件轮号(ev, entryTurn !== null && turnAt.has(entryTurn) ? entryTurn : null)
    if (entry) {
      钉事件坐标(entry, ev, turn)
      entries.push(entry)
    }
    /* 两种「有落点但这一条没内容可画」的情况退回结构性,不许报成「未画出」:
       一步没跑的那一轮(turn/end),和已经被读掉的排队条(它的正文就是那个用户气泡)。 */
    else if (structuralEvent(ev) || ev.type === 'turn/end' || ev.type === 'agent/inbox/spliced') structural++
    else undrawn[ev.type] = (undrawn[ev.type] || 0) + 1

    /* 讣告跟轮尾行是两条条目,不是二选一:轮尾行是这一轮的账,讣告是它的死因。
       一步没跑就死的那一轮只有讣告 —— 那一条正是不画就会整轮消失的东西。 */
    if (ev.type === 'turn/end') {
      const death = turnDeath(ev)
      if (death) {
        钉事件坐标(death, ev, turn)
        entries.push(death)
      }
      entryTurn = null
    }

    /* ---- 底部统计条（口径抄 dsh 的 StatsLine.deriveStats，逐字段同名） ---- */
    if (ev.type === 'assistant/message') {
      turnSet.add(ev.data.turn)
      stats.steps++
      const s0 = stepStart.get(key)
      const t0 = firstToken.get(key)
      const u = ev.data.usage
      if (s0 != null) stats.llmMs += Math.max(0, ev.time - s0)
      if (s0 != null && t0 != null) { stats.ttftMs += Math.max(0, t0 - s0); stats.ttftSteps++ }
      if (t0 != null && u && typeof u.outputTokens === 'number') {
        stats.decodeMs += Math.max(0, ev.time - t0)
        stats.decodeTokens += u.outputTokens
      }
      if (u) {
        stats.input += u.inputTokens || 0
        stats.cacheRead += u.cacheReadTokens || 0
        stats.cacheWrite += u.cacheWriteTokens || 0
        stats.output += u.outputTokens || 0
        stats.reasoning += u.reasoningTokens || 0
        最后一笔 = u
        /* 这一步是哪个模型跑的。报不出来就记在 '?' 名下 ——
           **「读不出」要占一格**,不许并进别人的桶里当它是同一个模型。 */
        const src = ev.data?.message?.source
        const 型 = (src && src.provider && src.model) ? `${src.provider}/${src.model}` : '?'
        const b = stats.按模型[型] || (stats.按模型[型] = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
        b.input += u.inputTokens || 0
        b.cacheRead += u.cacheReadTokens || 0
        b.cacheWrite += u.cacheWriteTokens || 0
        b.output += u.outputTokens || 0
      }

      /* 同一笔账再落进它那一轮的口袋(轮尾行要用) */
      const f = turnOf(ev.data.turn)
      f.steps++
      f.at = ev.time
      const ttft = (s0 != null && t0 != null) ? Math.max(0, t0 - s0) : null
      if (ev.data.step < f.firstStep) { f.firstStep = ev.data.step; f.ttftMs = ttft }
      if (t0 != null && u && typeof u.outputTokens === 'number') {
        f.decodeMs += Math.max(0, ev.time - t0)
        f.decodeTokens += u.outputTokens
        f.sampled = true
      }
      if (u) {
        f.input += u.inputTokens || 0
        f.output += u.outputTokens || 0
        f.reasoning += u.reasoningTokens || 0
        f.cacheRead += u.cacheReadTokens || 0
        f.cacheWrite += u.cacheWriteTokens || 0
      }
    } else if (ev.type === 'tool/result') {
      const blk = 工具结果Of(ev) || {}
      const t = callAt.get(String(blk.toolCallId))
      if (t != null) stats.toolMs += Math.max(0, ev.time - t)
    }
  }
  stats.turns = turnSet.size
  if (最后一笔) {
    const u = 最后一笔
    stats.context = (u.inputTokens || 0) + (u.cacheReadTokens || 0)
                  + (u.cacheWriteTokens || 0) + (u.outputTokens || 0)
  }
  return {
    entries, stats, undrawn, structural, total: events.length,
    /* 轨迹是整条会话再摊一遍（每一步的入参、出参、原始块全文），常常比对话本身还大 ——
       只有「轨迹」那一页开着才算、才发（2026-09-15：一格 5.7MB 里它占了 2.8MB）。 */
    ...(要轨迹 ? { turns: deriveTrajectory(toNodes(events), 座位) } : {}),
  }
}

/* 输入栏只借原生能力，不重做权限、上传或附件授权。独立函数便于用假 service 验证边界。 */
function 必填标识(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`${name} 必须是非空字符串`), { code: 'gateway/bad-request' })
  }
  return value
}

/** 官方 observation 只读真实投影；释放 lease，不把冷会话捞成活 Agent。 */
export async function 输入信息(ctx, payload, signal) {
  const sessionId = 必填标识(payload?.sessionId, 'sessionId')
  const query = ctx.get('sessionQuery')
  if (!query?.observeSession) throw new Error('这个部署没有挂 sessionQuery —— 输入栏的信息读不出来')
  signal.throwIfAborted()
  const observation = await query.observeSession(sessionId, { signal, projectionMode: 'all' })
  try {
    signal.throwIfAborted()
    const values = observation.projections?.values || {}
    return { permissions: values.permissions ?? null, imageLimits: values.imageLimits ?? null }
  } finally { observation[Symbol.dispose]() }
}

/** sessionController 原样校验附件是否属于这条会话。 */
export function 读取附件(session, payload) {
  return session.attachment({
    sessionId: 必填标识(payload?.sessionId, 'sessionId'),
    attachmentId: 必填标识(payload?.attachmentId, 'attachmentId'),
  })
}

/**
 * 给一条会话记一次模型选择：沿用全局默认的模型，只换思考档。
 * 走的是 dsh `selectModel` 里只管这一条会话的那一步（记 `model/selection` 并交给下一次请求）；
 * `selectModel` 本身还会把这次选择存成全局默认，所以不走它。模型不认这一档就不记，照默认。
 */
export async function 设会话思考(ctx, sessionId, 思考) {
  const controller = ctx.get('sessionController'), 默认 = ctx.agentDefaultModel?.currentSelection()
  if (typeof controller?.agents?.selectForNextRequest !== 'function') throw new Error('这个 dsh 没有单条会话的模型选择')
  if (!默认?.provider || !默认?.model) throw new Error('还没有默认模型')
  let 定
  try { 定 = await ctx.llm.resolveCallConfig({ provider: 默认.provider, model: 默认.model, reasoningEffort: 思考 }) }
  catch { return null }
  const found = await controller.resolveAgent(sessionId)
  if (found.error) throw found.error
  const selection = { provider: 定.provider, model: 定.model, ...(定.reasoningEffort === undefined ? {} : { reasoningEffort: String(定.reasoningEffort) }) }
  controller.agents.selectForNextRequest(found.agent, selection)
  return selection
}

/** 只有用户选择档位才执行命令；原生命令记账、验证 preset，且不递话给模型。 */
export async function 修改权限(ctx, session, payload, signal) {
  const sessionId = 必填标识(payload?.sessionId, 'sessionId')
  const preset = 必填标识(payload?.preset, 'preset')
  const commands = ctx.get('commands')
  if (!commands?.execute) throw new Error('这个部署没有挂 commands —— 权限档位改不了')
  signal.throwIfAborted()
  const found = await session.resolveAgent(sessionId)
  if (found.error) throw found.error
  signal.throwIfAborted()
  const execution = await commands.execute(found.agent, `/permission ${preset}`, [], signal)
  if (!execution) throw new Error('这个部署没有注册 permission 命令 —— 权限档位改不了')
  return execution
}

/** 与原生 raw upload 同样的检查和流式调用，沿用原生 Session 范围与 receipt。 */
export async function 上传文件(ctx, req, res, url, reply) {
  const fail = (status, code, message) => reply(res, status, { ok: false, error: { code, message, details: {} } })
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return fail(405, 'gateway/bad-request', '上传文件只收 POST')
  }
  const mediaType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'application/octet-stream') return fail(415, 'gateway/bad-request', 'Content-Type 必须是 application/octet-stream')
  const sessionId = url.searchParams.get('session')
  if (!sessionId?.trim() || url.searchParams.getAll('session').length !== 1) {
    return fail(400, 'gateway/bad-request', 'session 必须是一个非空会话标识')
  }
  if (url.searchParams.getAll('name').length > 1) return fail(400, 'gateway/bad-request', 'name 只能传一次')
  const name = url.searchParams.get('name') ?? undefined
  const ac = new AbortController()
  const abort = () => ac.abort()
  const close = () => { if (!res.writableEnded) abort() }
  req.on('aborted', abort)
  res.on('close', close)
  if (req.aborted || res.destroyed) abort()
  try {
    ac.signal.throwIfAborted()
    const service = ctx.get('fileUploads')
    if (!service?.uploadStream) throw new Error('这个部署没有挂 fileUploads —— 文件上传不了')
    const value = await service.uploadStream({
      sessionId, data: req, signal: ac.signal, ...(name === undefined ? {} : { name }),
    })
    return reply(res, 200, { ok: true, value })
  } catch (error) {
    return reply(res, 200, { ok: false, error: {
      code: typeof error?.code === 'string' ? error.code : 'gateway/internal',
      message: String(error?.message || error),
      details: error?.details && typeof error.details === 'object' ? error.details : {},
    } })
  } finally {
    req.removeListener('aborted', abort)
    res.removeListener('close', close)
  }
}

/** 一次请求的分段计时 → 回包上的 `Server-Timing` 头（2026-09-15，查「切一格为什么还要半秒」）。
    浏览器开发者工具 Network → 点那条请求 → Timing 里看得到；`curl -D -` 也看得到。
    每一段是**从上一个点到这个点**花的毫秒。

    ⚠️ **阶段名只许 ASCII，写中文的代价是整张脸空掉。** HTTP 响应头不许有非 Latin-1 字符，
    `res.writeHead()` 当场抛 ERR_INVALID_CHAR，dsh 的兜底把整个请求答成 **400 空响应** ——
    而 `/api/history` 正管着左列那张项目名单，于是界面上看见的是「项目全没了」。
    2026-09-16 实机撞过一次（我给新阶段起名「料单」）：**原来这儿只写了「不许有中文」这条规矩，
    没写后果，于是它被当成一句习惯**。规矩写后果才拦得住人。
    `json()` 里那道 ASCII 过滤是第二道闸，这一段是第一道。 */
function 计时器() {
  let 上 = performance.now()
  const 表 = []
  const 记 = (名) => { const 今 = performance.now(); 表.push(`${名};dur=${(今 - 上).toFixed(1)}`); 上 = 今 }
  记.头 = () => 表.join(', ')
  return 记
}

// ---------------------------------------------------------------- 插件

export function apply(ctx, config) {
  const cfg = config || {}
  const mount = (cfg.mount || 默认挂载).replace(/\/+$/, '') || 默认挂载

  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set()
  const busy = new Map()        /* sessionId → 当前轮的开跑时刻；运行与否读原生 Agent.status */
  const openTurns = new Map()   /* sessionId → 真实 turn/start 的数字轮号；收件盒消息不用它 */
  const lastActive = new Map()  /* sessionId → 最近一条事件的时刻 */
  const pending = new Map()   /* rpcId → 我们发出去的待用户处理帧 */
  /* sessionId → { 行: Map<seq, Set<指纹>>, 谁: Map<指纹, seq> }
     实时那条「排着队 —— 还没被读到」的回执行，等的是哪几条消息。
     读到了就撤 —— 见下面 `核销()`。 */
  const 排队 = new Map()

  let 图纸流, 工作计时
  const send = (frame) => {
    if (frame.type === 'blueprint.ask' || frame.type === 'blueprint.ask_done') 工作计时?.刷新(frame.session)
    if (['blueprint.busy', 'blueprint.ask', 'blueprint.ask_done', 'blueprint.entry',
      'blueprint.external_changed'].includes(frame.type)) 图纸流?.update(frame.session)
    const line = `data: ${JSON.stringify(frame)}\n\n`
    for (const res of clients) { try { res.write(line) } catch { clients.delete(res) } }
  }
  /* 等你回话的提醒（10-26 协 6，`回话提醒.js`）：节点在对话里问用户、只等用户输入的等待，各发一帧给桌面通知和角标；等到了就收。
     出处只有名册：每一轮开始、结束时照这个项目的名册对一次账，起来时把各项目对一遍（重启前挂着的也补上），重连时补发。 */
  const 回话提醒 = new Map()
  const 对回话账 = 根 => {
    if (!根) return
    void 对账回话提醒(回话提醒, String(根), send).catch(e => console.log(`Blueprint studio: 等你回话的提醒没对上账 ${根} —— ${(e && e.message) || e}`))
  }

  /* ══════════════ PULSE（2026-09-24 删了）══════════════
     新系统没有定时器：叫醒只因为名册变了（图景 构11、协议 2.2、案底 A10）。
     树上那块 PULSE 词块和 Start 带，是渲染器看见 `tree.脉搏` 才画的 —— 后端不再发它，它们就不出现，界面一个字不用改。
     状态灯里「总开关关了就亮红」那一条随之作废：恒当开着。 */
  const 脉搏开着 = () => true

  const sid = (session) => String(session?.id ?? '')

  /**
   * 核销一条回执:这条消息落成 user/message 了,它那一行「还没被读到」就该当场撤掉。
   *
   * 一行等的可能不止一条(`inserted` 是个数组)。**等的全读完才撤** ——
   * 只读掉一条就把整行抹了,剩下那几条真排着队的会凭空消失,那是暗层。
   * 已知的小账:多条那一行在读掉一部分之后,数字会多报一会儿(还写着「排着队 N 条」),
   * 到 turn/end 那次重取才校正。实测 `inserted` 一直是一条,先不为它加第二套路径。
   */
  /* ══════════════ 在跑 ══════════════
     「后台到底有什么东西泡着」这一问，答案分两处，**两处都是现成的账，我们一份都不自己记**：

       ① **在跑的节点** —— dsh 的 `Agent.status`；`busy` 只记录开跑时刻。
       ② **后台工作** —— **dsh 自己的 `ctx.jobs`**（后台 bash、subagent 委派都往里登记，
          `tool-jobs` 是给模型用的同一本册子）。协议一.1：dsh 有的不造 ——
          我们要是自己再立一个登记册，那本册子和这一本第一天就会开始各说各的。

     另外两类不在 dsh 的账上，各读各的现成出处：
       ③ **外部 run**（Codex／Claude Code 直接当节点做）—— node 包 `外部run.js` 的内存表，进程只活在服务进程里。
       ④ **残留进程** —— 上面哪一类都不认、却还开着的进程（节点停了它开的程序没退、删掉的项目留下的，
          10-18 真事：一个卡了两小时的 Godot 哪里都看不见）。只读 ps，不立登记册（`node/src/残留进程.js`）。

     `ctx.jobs` 走 `ctx.get('jobs')` 取，取不到就只报第 ① 半 —— 照 apiProxy 那条规矩：
     少一样服务不许整块塌，但也不许假装它在。 */

  /**
   * 后台此刻在跑几件。**顶栏那个钮上那个数字就是它** ——
   * 那个数字要在**那一列关着的时候**也是对的（"有没有东西泡着"正是你不点开也想知道的事），
   * 所以它跟着帧走，不是等你打开那一列才去数。数一遍很便宜：两张表的长度。
   */
  function 在跑几件() {
    let n = 0
    n += 运行.全体().length
    for (const j of 工作们().行们) if (j.status === 'running' || j.status === 'stopping') n++
    try { n += 原生外部运行(ctx).length } catch { /* 列表会明确报告缺少原生查询。 */ }
    return n
  }

  /** 在跑的东西变了 —— 顶栏那个数字当场跟着变；那一列开着的那张脸再去取一次全表。 */
  const 在跑变了 = () => send({ type: 'blueprint.在跑变了', 几: 在跑几件() })
  const 外部变了 = () => { 在跑变了(); send({ type: 'blueprint.external_changed' }) }
  const 不听外部run = 听外部run变化(() => { 在跑变了(); 工作计时?.刷新() })
  ctx.on('subagent/start', info => { if (!info.local) 外部变了() })
  ctx.on('subagent/end', info => { if (!info.local) 外部变了() })
  const 运行 = 接运行状态(ctx, { busy, openTurns, send, changed: 在跑变了 })
  工作计时 = 接工作计时(ctx, { projectRoot: 项目位置们, send,
    waiting: id => [...pending.values()].some(frame => frame.session === id),
    externalProjects: () => 外部run清单().map(row => row.根),
    seed: async (root, before) => {
      const rows = await listSessions()
      const anchor = rows.find(row => row.cwd && resolve(row.cwd) === root)
      if (!anchor) return 0
      const members = 项目操作会话(rows.map(row => ({ ...row, sessionId: row.id,
        parentSessionId: row.parentSession })), anchor.id)
      const records = []
      for (let offset = 0; offset < members.length; offset += 4) {
        records.push(...await Promise.all(members.slice(offset, offset + 4)
          .map(async row => ({ events: await 瘦账Of(row.id), running: 运行.在跑(row.id) }))))
      }
      return 历史工作毫秒(records, before)
    } })

  /** 这台机器上活着的 agent 的会话号（`ctx.jobs` 拿会话号认主人；传 agent 本身谁的都认不出）。 */
  function 活着的agent们() {
    try { return [...ctx.agents.list()].map(agent => agent.id) } catch { return [] }
  }

  /**
   * 后台工作的全表。`ctx.jobs.list(caller)` **只给这个 caller 看得见的那些**
   * （他自己的 ＋ 无主的），所以要挨个 agent 问一遍再并起来。
   * @returns {{行们: object[], 有登记册: boolean}}
   */
  function 工作们() {
    const jobs = ctx.get('jobs')
    if (!jobs) return { 行们: [], 有登记册: false }
    const 表 = new Map()
    const 收 = (caller) => {
      let 单 = []
      try { 单 = jobs.list(caller) || [] } catch { return }
      for (const j of 单) if (!表.has(j.id)) 表.set(j.id, j)
    }
    收(undefined)                                  /* 无主的 */
    for (const a of 活着的agent们()) 收(a)
    return { 行们: [...表.values()], 有登记册: true }
  }

  /** 一条会话在跑的样子。**项目就是它的文件夹名** —— 一个项目一个文件夹（图景 9.1）。 */
  const 项目名 = (cwd) => (cwd ? basename(resolve(cwd)) : '')

  async function 外部协助身份(parentSessionId, sessions) {
    const parent = sessions.find(row => String(row.id) === String(parentSessionId))
    if (!parent?.cwd) throw new Error('认不出外部任务所属项目')
    const roster = await 名册c(join(resolve(parent.cwd), 文档夹名))
    const by = new Map(sessions.map(row => [String(row.id), row]))
    const registered = new Map(roster.filter(row => row.会话).map(row => [String(row.会话), row]))
    const ownerSessionId = 谁的线(registered, id => by.get(id)?.parentSession, String(parentSessionId), '')
    const owner = registered.get(ownerSessionId)
    return { projectSessionId: String(parentSessionId), ownerSessionId,
      owner: owner ? [owner.id, owner.name || 项目名(parent.cwd)].filter(Boolean).join(' ') : '未登记节点',
      project: 项目名(parent.cwd) }
  }

  async function 外部协助Of(parentSessionId, sessions, options) {
    const data = await 读取外部协助(ctx, String(parentSessionId), options)
    if (!data.rows.length) return data
    const owner = await 外部协助身份(parentSessionId, sessions)
    return { ...data, rows: data.rows.map(row => ({ ...row, ...owner })) }
  }

  async function externalSubagents(res, want) {
    if (!want) return json(res, 400, { ok: false, message: '请选择一个节点' })
    try {
      const data = await 外部协助Of(want, await listSessions())
      json(res, 200, { ok: true, session: String(want), ...data })
    } catch (error) { json(res, 404, { ok: false, message: error.message }) }
  }

  /**
   * `GET /api/running` —— 后台此刻有什么东西在跑。
   * 两类各自带着**自己那条停法**（`类`），前端照着分派：节点走 dsh 的
   * `session.cancel`／`subagent.interrupt`（跟输入框那个「停」同一份实现），
   * 后台工作走下面的 `/api/kill`。
   */
  async function running(res) {
    const 行们 = []
    const 现在 = Date.now()

    /* ① 在跑的节点 */
    let 名单 = []
    try { 名单 = await listSessions() } catch { /* 读不出就没有这一半 */ }
    const 认识 = new Map(名单.map((r) => [String(r.id), r]))
    /* 名字从**柜子**认（`我是谁()`），跟树上那张砖同一个出处：`号 任务名`，Blueprint 是项目名。
       2026-09-14 之前这儿印 `agentPreset` —— 子会话原样继承 preset，于是一列全是「blueprint」。 */
    const 节点们 = await Promise.all(运行.全体().map(async ([id, 自]) => {
      const h = 认识.get(String(id)) || {}
      let 我 = null
      try { 我 = await 我是谁(ctx, String(id)) } catch { /* 认不出就退回 preset */ }
      /* **帮手**：节点用 `subagent` 递出去的会话（批量帮助、迭代工作）。它的会话头 `origin` 是 subagent、
         `parentSession` 指着派它的那条线；`我是谁()` 顺着爬上去认出主人（`支线` 为真）。
         活着的会话不一定已经落盘进 `认识`，所以 origin 也从活会话头上兜一次。 */
      let origin = String(h.origin || '')
      if (!origin) { try { origin = String(ctx.sessions.get(String(id))?.header?.origin || '') } catch { /* 冷的读不到就空 */ } }
      const 手 = !!我 && !!我.支线 && origin === 'subagent'
      const 项目 = 项目名(h.cwd)
      const 任务 = 我 ? (我.号 === Blueprint号 ? 项目 : String(我.行?.name || '')) : ''
      let 父 = String(h.parentSession || '')
      if (!父) { try { 父 = String(ctx.sessions.get(String(id))?.header?.parentSession || '') } catch { /* 冷的读不到就空 */ } }
      return {
        类: '节点', id: String(id),
        名: 我 ? (手 ? 译('{name} 的帮手', { name: [我.号, 任务].filter(Boolean).join(' ') }) : [我.号, 任务].filter(Boolean).join(' ')) : (h.agentPreset || 译('节点')),
        /* 类型取名册行的 `类型`（helm／dock／run）；`座位` 那一格是旧界面的标签，一律是 print（10-18 用户：系统已经没有 print） */
        说明: [手 ? 译('帮手 · subagent') : 我?.行?.类型, 项目 || 译('（不在任何项目里）')].filter(Boolean).join(' · '),
        起于: 自, 跑了: Math.max(0, 现在 - 自), 项目, ...(项目 && !existsSync(h.cwd) ? { 项目已删: true } : {}),
        /* 停它走哪条路：subagent 会话只有 `subagent.interrupt` 停得了（见 RPC 表那一条） */
        ...(origin ? { origin } : {}), ...(父 ? { parentSessionId: 父 } : {}),
      }
    }))
    行们.push(...节点们)

    /* external 没有本地 Session；只从原生 manager 查询，不读 Session.activity。 */
    let 外部缺 = ''
    try {
      const live = 原生外部运行(ctx)
      const groups = await Promise.all([...new Set(live.map(row => row.parentSessionId))]
        .map(parent => 外部协助Of(parent, 名单, { live })))
      for (const row of groups.flatMap(data => data.rows).filter(row => 外部运行状态.has(row.status))) {
        行们.push({ 类: '外部', id: row.id, 名: row.label, 项目: row.project || '',
          说明: [row.owner, row.provider || 译('提供方未记录'), row.cwd || 译('目录未记录'), row.project].join(' · '),
          起于: row.createdAt, 跑了: row.createdAt ? Math.max(0, 现在 - row.createdAt) : null,
          status: row.status, parentSessionId: row.parentSessionId, projectSessionId: row.projectSessionId })
      }
    } catch (error) { 外部缺 = error.message }

    /* ② dsh 登记在册的后台工作。settled 的不列 —— 这一列问的是「现在还占着什么」。 */
    const { 行们: 工作, 有登记册 } = 工作们()
    for (const j of 工作) {
      if (j.status !== 'running' && j.status !== 'stopping') continue
      行们.push({
        类: '工作', id: String(j.id),
        名: String(j.kind || 译境('后台', '工作')),
        说明: String(j.label || ''),
        起于: j.startedAt || 0,
        跑了: j.startedAt ? Math.max(0, 现在 - j.startedAt) : null,
        ...(j.status === 'stopping' ? { 停着了: true } : {}),
        ...(j.owner ? { 归谁: String(j.owner) } : {}),
        ...(j.owner && 认识.get(String(j.owner))?.cwd ? 项目处(认识.get(String(j.owner)).cwd) : {}),
      })
    }

    /* ③ 外部 run：没有会话，名字和项目会话从名册认。 */
    for (const x of 外部run清单()) {
      let 名 = x.id, 项目会话 = ''
      try {
        const 册 = await 名册c(join(x.根, 文档夹名))
        const r = 册.find(row => String(row.id) === x.id)
        if (r?.name) 名 = `${x.id} ${r.name}`
        项目会话 = String(册.find(row => String(row.id) === Blueprint号)?.会话 || '')
      } catch { /* 名册读不出就只写号 */ }
      行们.push({ 类: '外部run', id: `${x.根}#${x.id}`, 名, 说明: [x.执行者, 项目名(x.根)].join(' · '),
        起于: x.起于, 跑了: Math.max(0, 现在 - x.起于), ...项目处(x.根),
        ...(项目会话 ? { 项目会话 } : {}), ...(x.停因 ? { 停着了: true } : {}) })
    }

    /* ④ 残留进程 */
    let 进程缺 = ''
    try {
      const 件们 = await 此刻残留()
      for (const p of 件们) {
        const 项目文 = p.项目 ? `${p.项目}${p.项目已删 ? 译('（已删除）') : ''}` : p.项目已删 ? 译('已删除的项目') : 译('不属于任何项目')
        行们.push({ 类: '进程', id: p.id, 名: 进程名(p.命令),
          说明: [项目文, p.进程数 > 1 ? 译('{n} 个进程', { n: p.进程数 }) : '', p.命令].filter(Boolean).join(' · '),
          起于: p.起于, 跑了: Math.max(0, 现在 - p.起于), 项目: p.项目 || '', ...(p.项目已删 ? { 项目已删: true } : {}) })
      }
      盯残留(件们)
    } catch (error) { 进程缺 = `读不到进程表 —— 残留进程那一半看不见（${error.message}）` }

    行们.sort((a, b) => (b.起于 || 0) - (a.起于 || 0))
    json(res, 200, {
      ok: true, 行们,
      /* 缺什么就说缺什么 —— 一列空着，「没东西在跑」和「这一半根本读不到」是两件事 */
      ...(!有登记册 || 外部缺 || 进程缺 ? { 缺: [有登记册 ? '' : '这个部署没挂 ctx.jobs —— 后台工作那一半读不到', 外部缺, 进程缺].filter(Boolean).join('；') } : {}),
    })
  }

  /** 一行属于哪个项目：文件夹名；文件夹没了（项目被删）也照实说。 */
  const 项目处 = cwd => ({ 项目: 项目名(cwd), ...(existsSync(cwd) ? {} : { 项目已删: true }) })

  /** 残留进程那一半：已经算作外部 run、后台任务的进程组不重复列。 */
  const 此刻残留 = () => 列残留进程({
    认领pid们: new Set(外部run清单().map(x => x.pid).filter(Boolean)),
    工作命令们: 工作们().行们.filter(j => j.status === 'running' || j.status === 'stopping').map(j => String(j.label || '')),
  })

  /** 进程的名字：`bash -c <命令>` 取命令，App 里的程序取 App 名，别的取程序文件名。 */
  function 进程名(命令) {
    const sh = /^(?:\S*\/)?(?:ba|z)?sh -c (.+)$/.exec(命令)
    if (sh) return sh[1]
    const app = /\/([^/]+)\.app\/Contents\/MacOS\//.exec(命令)
    if (app) return app[1]
    return basename(命令.split(' ')[0]) || 命令
  }

  /* 残留进程会自己退出，退了不会有任何事件。列出来过的还在，就每 15 秒复查一次，变了喊一声；没有了就不再查。 */
  let 残留复查 = null, 残留签 = ''
  function 盯残留(件们) {
    残留签 = 件们.map(p => p.id).sort().join(',')
    if (!件们.length || 残留复查) return
    残留复查 = setTimeout(() => {
      残留复查 = null
      void 此刻残留().then(现 => {
        if (现.map(p => p.id).sort().join(',') !== 残留签) 在跑变了()
        else 盯残留(现)
      }).catch(() => {})
    }, 15_000)
    残留复查.unref?.()
  }

  /**
   * `POST /api/kill` —— 停一件后台工作（`{id}`）。**节点不走这儿**：
   * 停节点只有 `停一个()` 那一份实现（输入框的「停」、树上的「全停」、这一列，三处共用）。
   */
  async function killJob(req, res) {
    let body = ''
    for await (const chunk of req) body += chunk
    let want
    try { want = JSON.parse(body || '{}') } catch (e) { return json(res, 400, { ok: false, message: `请求体不是 JSON：${String(e && e.message)}` }) }
    const id = String(want.id ?? '')
    if (!id) return json(res, 400, { ok: false, message: '没说停哪一件' })
    /* Live 上另外两类：外部 run 走 node 包那一份停法（停因记下，继续时它知道上次做到一半）；
       残留进程重新列一遍、号码和起点都对上才停。 */
    if (want.类 === '外部run') {
      const x = 外部run清单().find(x => `${x.根}#${x.id}` === id)
      if (!x) return json(res, 200, { ok: false, message: '这个外部 run 已经不在做了' })
      await 停外部run(x.根, x.id, '用户在 Live 里按了停', { 用户: true })
      在跑变了()
      return json(res, 200, { ok: true })
    }
    if (want.类 === '进程') {
      try {
        const r = await 停残留进程(id, want.起于, 此刻残留)
        在跑变了()
        if (r.停了) setTimeout(在跑变了, 3_500).unref?.()
        return json(res, 200, r.停了 ? { ok: true } : { ok: false, message: r.原因 })
      } catch (error) { return json(res, 200, { ok: false, message: `停不了这个进程：${error.message}` }) }
    }
    const jobs = ctx.get('jobs')
    if (!jobs) return json(res, 200, { ok: false, message: '这个部署没挂 ctx.jobs —— 停不了后台工作' })
    /* `kill` 要 caller 对得上主人才让停。挨个试：无主的那次先来，然后每个活着的 agent。
       全试完都不认，就是这件工作的主人已经不在了 —— 如实说，不假装停住了。 */
    for (const caller of [undefined, ...活着的agent们()]) {
      try {
        const r = jobs.kill(id, caller, '用户在「在跑」那一列上按的')
        在跑变了()
        return json(res, 200, { ok: true, 结果: r })
      } catch { /* 不是他的，下一个 */ }
    }
    return json(res, 200, { ok: false, message: `没找到这件工作（${id}），或者它的主人已经不在了` })
  }

  function 核销(id, m) {
    const st = 排队.get(id)
    if (!st) return
    const k = msgKey(m)
    const seq = st.谁.get(k)
    if (seq === undefined) return
    st.谁.delete(k)
    const 等 = st.行.get(seq)
    if (!等) return
    等.delete(k)
    if (等.size) return
    st.行.delete(seq)
    send({ type: 'blueprint.entry_drop', session: id, seq })
  }

  /**
   * **这一步吃进／交出的那几块料,当场发一排词块** —— 不等这一轮结束。
   *
   * 认的是 `块印们()`,跟 `history` 里那一份**同一个函数**:实时长出来的那一排
   * 与刷新后重画的那一排,不可能长得不一样(它们是同一份账的两次投影)。
   *
   * `位` 要现问柜子(刚落的档这一刻已经在盘上了),所以这一帧是异步的 ——
   * 它比它锚着的那一行晚几毫秒到,但赶在下一步之前(下一步要等模型跑一趟)。
   * 问不出来就发一排灰的:点不开好过不告诉你它吃了什么。
   *
   * @param {string} id 会话
   * @param {object} ev 这一条会话事件
   * @param {string|null} 调用 工具结果那一头的 callId —— 前端靠它把这一排挂在那一行底下
   */
  function 块排帧(id, ev, 调用) {
    const 块 = 块印们(ev)
    if (!块) return
    const 发 = () => send({ type: 'blueprint.块排', session: id, seq: ev.seq, ...(调用 ? { 调用 } : {}), ...块 })
    按名版Of(id).then((m) => { 配位(m, 块); 发() }, 发)
  }

  /* 后台工作册子变了(开了一件、停了一件、跑完了)→ 喊一声。
     **不轮询**:dsh 自己有这个回调(`onJobsChanged`),那一列开着的时候听见了才去取。
     没有 `ctx.jobs` 的部署这儿一句都不挂 —— 那一列会自己说"这一半读不到"。 */
  try {
    const jobs = ctx.get('jobs')
    if (jobs && typeof jobs.onJobsChanged === 'function') jobs.onJobsChanged(() => 在跑变了())
  } catch (e) {
    console.log(`Blueprint studio: 后台工作那本册子听不上 —— ${(e && e.message) || e}`)
  }

  // ------------------------------------------------ 实时:会话事件 → 渲染器帧

  ctx.on('goal/activation-changed', ({ sessionId }) => send({ type: 'goal/activation-changed', session: String(sessionId) }))
  ctx.on('session/event', (session, ev) => {
    const id = sid(session)
    if (!id) return
    if (ev.type === 'goal/change') send({ type: ev.type, session: id })
    if (ev.type === 'subagent/catalog' && ev.data?.mode === 'external'
      || ['tool/result', 'tool/ptc-dispatch'].includes(ev.type) && ev.data?.meta?.blueprintExternal
      || ev.type === 'user/message' && ev.data?.source?.kind === 'subagent-settled'
      || ev.type === 'agent/inbox/spliced' && ev.data?.inserted?.some(message => message.source?.kind === 'subagent-settled')) {
      send({ type: 'blueprint.external_changed', session: id })
    }
    // 树只保留已有投影需要的字段；新事件到达即折入，不反复复制整份活账本。
    const cached = 瘦账.get(id)
    if (cached?.活 === session && 条数Of(cached.瘦) === ev.seq) 瘦身(cached.瘦, [ev], ev.seq)
    lastActive.set(id, ev.time ?? Date.now())
    /* 异步料单也用事件到达时的坐标，不能等发送时再读可能已切轮的 Map。 */
    const turn = 事件轮号(ev, openTurns.get(id))
    const step = typeof ev.data?.step === 'number' && Number.isFinite(ev.data.step) ? ev.data.step : null

    switch (ev.type) {
      /* ⚠️ **这儿不许加自造事件类型。** 曾经有一条 `blueprint/流水账` 的实时推送，
         搬进项目文件夹之后连事件带那一帧一起没了。柜子里的东西变了要让前端知道，
         正路是**给文件加 watcher**，不是把事件写回账本 ——
         dsh 读到不认识的事件类型整份拒载，重启后整条会话读不出来（案底 A6，实机撞过）。 */
      case 'turn/start': {
        const startedTurn = 事件轮号(ev)
        if (startedTurn !== null) openTurns.set(id, startedTurn)
        else openTurns.delete(id)
        /* 记的是**开跑那一刻**，不是一个 true —— 「在跑」那一列要说「跑了多久」，
           而"跑了太久"正是你要在那一列里一眼看出来的东西。真值不变（时刻恒为真）。 */
        busy.set(id, ev.time || Date.now())
        /* `自` ＝ 这一轮从什么时候开始跑的。**时刻本来就在这张表里，只是以前没送** ——
           对话流底下那根活条要说「它在想，已经 1m20s」，而那个数别处算不出来
           （前端自己掐表的话，切过去的时候已经跑了一半，秒表从零开始就是撒谎）。 */
        send({ type: 'blueprint.busy', session: id, busy: true, '自': busy.get(id),
          ...(startedTurn !== null ? { turn: startedTurn } : {}) })
        在跑变了()
        对回话账(session?.header?.cwd)
        return
      }
      case 'turn/end':
        openTurns.delete(id)
        busy.set(id, 0)
        在跑变了()
        对回话账(session?.header?.cwd)
        /* 定格了。前端这时重取一次 /api/history —— 于是「实时长出来的形态」
           与「重新加载后的形态」每一轮都对一次账。 */
        send({ type: 'blueprint.busy', session: id, busy: false })
        return
      // 模型输出由原生 follow 顺序递送，包含中途连接时的已有片段。
      case 'assistant/message':
      case 'assistant/attempt':
      case 'llm/retry':
      case 'llm/retry-started':
        return
      /* 系统提示词那一条:实时这一头也要给出料单,否则「跑着长出来的」跟「刷新后重画的」
         是两个东西(实时是一坨正文、刷新是一张单)。料单要问柜子、要读盘 —— 异步,
         算完再发这一帧。**算不出来就发 null**,那一块退回总纲原文,不空着。
         ⚠️ 这一刻出生包还没递(它在系统提示词之后),所以实时这一张单上没有柜子那几行;
         下一次重取(每轮末尾那次)就补齐了 —— 单子的注里说着这件事。 */
      case 'system/message': {
        const 发 = (料) => {
          const entry = entryOf(ev, 料)
          if (!entry) return
          钉事件坐标(entry, ev, turn)
          send({ type: 'blueprint.entry', session: id, entry })
        }
        料单Of(id).then(发, (e) => {
          console.log(`Blueprint studio: ${id} 实时那张出生料单没算出来 —— ${(e && e.message) || e}`)
          发(null)
        })
        return
      }
      case 'tool/call': {
        const call = 调用展示(ev.data.name, ev.data.arguments)
        send({ type: 'tool_execution_start', session: id, time: ev.time, toolCallId: ev.data.callId, toolName: call.name, args: parseArgs(call.argsRaw) })
        return
      }
      case 'tool/ptc-dispatch-start': {
        const entry = entryOf(ev)
        if (entry) send({ type: 'blueprint.entry', session: id, entry: 钉事件坐标(entry, ev, turn) })
        return
      }
      case 'tool/ptc-dispatch':
      case 'tool/result': {
        const blk = 工具结果Of(ev) || {}
        send({ type: 'tool_execution_end', session: id, time: ev.time, toolCallId: blk.toolCallId, result: textOf(blk.content), isError: 工具结果失败(ev) })
        块排帧(id, ev, blk.toolCallId)
        return
      }
      /* 刚进收件盒的那一条,按定义还没被读 —— 空的 consumed 就是这一刻的实况。
         它是你按下发送之后**唯一的回执**:不发这一帧,那句话会像掉进井里,
         直到几十秒后模型读到它才冒出来。

         ⚠️ 2026-08-26:原来这一行要等 turn/end 那次重取才消失。**出生那一拍这是撒谎** ——
         备料、协议、目录那几条进收件盒 150 毫秒后就被读掉了,而第一轮要跑几分钟,
         这几分钟里屏幕一直在说"还没被读到"。现在改成读到当场撤(`核销()`),
         turn/end 那次重取仍在,只是不再是唯一的出路。 */
      case 'agent/inbox/spliced': {
        const entry = queued(ev, new Map())
        if (!entry) return
        /* 撤的时候靠这个 seq 找到那一行(前端把它盖成 data-seq) */
        钉事件坐标(entry, ev)
        send({ type: 'blueprint.entry', session: id, entry })
        const st = 排队.get(id) || (排队.set(id, { 行: new Map(), 谁: new Map() }), 排队.get(id))
        const 等 = new Set((ev.data?.inserted || []).filter(Boolean).map(msgKey))
        st.行.set(ev.seq, 等)
        for (const k of 等) st.谁.set(k, ev.seq)
        return
      }
      default: {
        /* 这条消息真被读到了 —— 撤掉它那张回执 */
        if (ev.type === 'user/message') 核销(id, ev.data)
        const entry = entryOf(ev)
        /* 条目钉上它出自的 seq —— 回放那一头本来就钉（`fold()` 里那一行），
           实时这一头原来没钉，于是这一行的那排词块找不到锚。同一个坐标系，钉一次。 */
        if (entry) { 钉事件坐标(entry, ev, turn); send({ type: 'blueprint.entry', session: id, entry }) }
        else if (!structuralEvent(ev)) send({ type: 'blueprint.undrawn', session: id, kind: ev.type })
        /* 弧递进来的那张信封清单，也在它那一行底下摆一排 */
        块排帧(id, ev, null)
      }
    }
  })



  // ------------------------------------------------ 会话名单与事件读取

  /* `list()` 要把这台机器上所有会话的头扫一遍（5.0 那次一趟 120–200ms），几十格同时在动时
     每秒要来好几趟。一秒半之内再问，直接给上一趟的结果（2026-09-17）。
     刚出生、还没落盘的会话不靠它 —— `listSessions()` 从活着的 agent 那儿补行，那一半是现读的。 */
  const 快照名单 = 创建会话快照读取(() => ctx.sessionPersistence.list())
  const 名单版本 = new WeakMap() // 同一次新鲜目录观察的版本，只交给这一次图纸使用。

  async function listSessions(新鲜 = false) {
    let headers = [], 快照们 = []
    try {
      /* dsh 0.1.5 起 `list()` 回的是快照 `{header, revision, sizeBytes}`，头包在 `header` 里
         （`参考/dsh/packages/session/session-persistence/src/index.ts` 的 SessionPersistenceSnapshot）。
         直接当头读，每一行的 id／cwd 全是空的 —— 项目列表就一个都没有（2026-09-13 真事）。 */
      快照们 = await 快照名单(新鲜)
      /* 存储版本用于材料／产物投影的变化签名；冷账本缓存由 sessionQuery 管。 */
      for (const x of 快照们) {
        if (x?.header?.id != null) 账本版本.set(String(x.header.id), { 版: x.revision, 大小: Number(x.sizeBytes) || 0 })
      }
      headers = 快照们.map((x) => x.header)
    } catch (e) {
      /* ⚠️ **别静默。** `list()` 扫的是全部账本，一份不合格就整个抛 ——
         吞成空数组之后，界面上长得跟"你还没有任何项目"一模一样，
         排查会从"谁把项目删了"开始走远路（2026-08-20 真事，案底 A6）。 */
      console.log(`Blueprint studio: 会话名单读不出来 —— ${(e && e.message) || e}`)
      headers = []
    }
    const agents = new Map()
    try { for (const a of ctx.agents.list()) agents.set(String(a.id), a) } catch { /* 没有注册表就算了 */ }
    const rows = headers.map((h) => {
      const id = String(h.id)
      return {
        id, createdAt: h.createdAt, cwd: h.cwd, origin: h.origin, agentPreset: h.agentPreset,
        /* 血统：分叉出来的会话，父是谁、从父的第几条事件切的。这两个已经落盘在
           SessionHeader 里 —— 多条线的那棵树是免费的，不用我们自己记。 */
        parentSession: h.parentSession ? String(h.parentSession) : undefined,
        /* 继承长度与原生 observation 的账本截面一起读，冷分叉也不重复计量。 */
        seedLength: h.seedLength ?? agents.get(id)?.session?.inheritedEventCount ?? 继承截点.get(id),
        active: agents.has(id), lastActive: lastActive.get(id) ?? h.createdAt ?? 0,
        /* 这一格此刻在不在跑 —— 顶栏项目列表前面那颗点从它长出来（整棵树有一格在跑，项目就在跑） */
        running: 运行.在跑(id),
      }
    })
    /* 刚出生还没落盘的会话:名单里补上,否则第一句话看不见。
       cwd/preset 从内存里的活会话取 —— 落盘晚一拍,补行没有 cwd 的话,
       顶栏画「无文件夹」、树上 Blueprint 第一行画不出项目名(2026-08-25 真事)。 */
    for (const [id, a] of agents) {
      if (rows.some((r) => r.id === id)) continue
      const h = a?.session?.header || {}
      rows.push({
        id, createdAt: lastActive.get(id) ?? h.createdAt ?? 0, active: true, lastActive: lastActive.get(id) ?? 0,
        running: 运行.在跑(id),
        cwd: h.cwd, agentPreset: h.agentPreset,
        /* origin 也补上：刚递出去的帮手会话还没落盘，缺了它树上认不出它是帮手会话，会被当成一条支线 */
        origin: h.origin,
        parentSession: h.parentSession ? String(h.parentSession) : undefined,
        seedLength: h.seedLength ?? a?.session?.inheritedEventCount,
      })
    }
    rows.sort((a, b) => (b.lastActive - a.lastActive) || (b.createdAt - a.createdAt))
    const projected = await 项目会话(rows)
    if (新鲜) 名单版本.set(projected, new Map(快照们.map(x => [String(x.header.id), x])))
    return projected
  }

  /* 原生 sessionQuery 负责 live 优先、冷读 revision 缓存和恢复校验。
     Studio 只保留展示投影；读取拿到的原生事件一律只读。 */
  const 账本版本 = new Map()   /* 会话 → { 版, 大小 }，每次 listSessions 刷新 */
  const 继承截点 = new Map() // 与读取截面成对的继承长度，分叉不重复归属或计量

  async function eventsOf(id) {
    return 会话观察(ctx.get('sessionQuery'), id, source => {
      继承截点.set(String(id), source.inheritedEventCount)
      if (source.revision !== undefined) {
        const prior = 账本版本.get(String(id))
        账本版本.set(String(id), { ...prior, 版: source.revision })
      }
      return source.events
    })
  }

  /* 瘦账的缓存（见 `瘦身()`）。一份几 KB，上百个节点也就几 MB，只防无限长。
     活投影绑定原生 Session 实例，冷投影绑定 observation revision。 */
  const 瘦账 = new Map()
  const 瘦账中 = new Map()   /* 会话 → 正在瘦的那一次：两个请求同时要同一份，只瘦一遍 */
  const 瘦账上限 = 5000
  /* `手上` ＝ 调用方已经读好的整份账本（你正看着的那一格，`history` 刚读过）—— 要重瘦时拿它瘦，不再读一遍盘 */
  function 瘦账Of(id, 手上 = null, 快照 = null) {
    const 在 = 瘦账中.get(id)
    if (在) return 快照 ? 在.then(() => 现瘦(id, 手上, 快照)) : 在
    const p = 现瘦(id, 手上, 快照).finally(() => 瘦账中.delete(id))
    瘦账中.set(id, p)
    return p
  }
  /* 画树摘要放在账本旁边的 dsh 存储里（`<DSH_HOME>/storages/blueprint_tree/`），跟着它读的那份账本根走。 */
  let 树摘要盘 = null
  function 树摘要盘Of(persistence) {
    const root = typeof persistence?.root === 'string' ? persistence.root : ''
    if (!root) return null
    if (树摘要盘?.root !== root) 树摘要盘 = { root, 盘: 创建树摘要盘(join(dirname(root), 'storages', 'blueprint_tree'), 瘦账格式) }
    return 树摘要盘.盘
  }
  async function 现瘦(id, 手上, 快照) {
    const 旧 = 瘦账.get(id)
    // 树只留瘦投影；同次新鲜目录已有原生 revision，避免逐节点重复扫描历史目录。
    const persistence = ctx.get('sessionPersistence')
    if (persistence && !ctx.sessions.get(id)) {
      const snapshot = 快照 || await persistence.stat(id)
      if (!snapshot) throw new Error(`会话 ${id} 不存在`)
      if (旧?.存储 === persistence.identity && snapshot.revision === 旧?.版) return 旧.瘦
      // 重启后先看盘上的画树摘要：同一版本号的账本，瘦下来一字不差，不必整份解开。
      const 盘 = 树摘要盘Of(persistence)
      const 盘上 = await 盘?.读(id, snapshot.revision)
      if (盘上 && !ctx.sessions.get(id)) {
        继承截点.set(String(id), 盘上.继承)
        记瘦账(id, { 活: null, 版: snapshot.revision, 存储: persistence.identity, 瘦: 盘上.瘦 })
        return 盘上.瘦
      }
      const source = await 读树账本(persistence, id)
      // 冷读期间若会话被真实操作捞活，回到下方的原生 live 观察截面。
      if (!ctx.sessions.get(id)) {
        继承截点.set(String(id), source.inheritedEventCount)
        const 瘦 = 瘦身([], source.events, 0)
        记瘦账(id, { 活: null, 版: snapshot.revision, 存储: persistence.identity, 瘦 })
        void 盘?.写(id, snapshot.revision, source.inheritedEventCount, 瘦)
        return 瘦
      }
    }
    return 会话观察(ctx.get('sessionQuery'), id, source => {
      继承截点.set(String(id), source.inheritedEventCount)
      const 活 = source.source === 'live' ? ctx.sessions.get(id) : null
      const result = 瘦账截面(source, 旧, 活, 手上)
      result.存储 = persistence?.identity
      记瘦账(id, result)
      return result.瘦
    })
  }
  function 记瘦账(id, x) {
    瘦账.delete(id)
    瘦账.set(id, x)
    while (瘦账.size > 瘦账上限) 瘦账.delete(瘦账.keys().next().value)
  }

  /* ---- 柜子的读缓存（2026-09-17：横版游戏 5.0 切一格还要 1 秒）----
     剩下那一秒几乎全是扫柜子：537 份文件，一次请求里 `名册()`／`等着的()`／`现行们()`／
     `我是谁()`／配词块各自从头扫一遍，一遍 70ms 上下。
     **一条规矩：柜子里一个文件都没变，就给上一回的结果。**
     「变没变」看的是**签**：柜子里每个文件夹、每份文件的路径 ＋ 修改时刻 ＋ 大小连成一串
     （深度跟 `扫()` 一样）。新建、改名、删、原地改，签都会变。只 stat 不读内容 —— 537 份实测 6ms。
     · 签在 200ms 内复用：一次请求要问好几回，不必各 stat 一遍；
     · 界面上改文件（`writeOneFile`）改完当场清掉，不等那 200ms。
     这几样只在**这张脸**上缓存：工具、弧照旧每次现扫。
     拿出去的结果是共用的，读的人一律只读。 */
  const 柜缓存 = new Map()     /* `["名", 柜]` → { 签, 值: Promise } */
  const 柜签缓存 = new Map()   /* 柜 → { 时, 签: Promise<string> } */
  function 清柜缓存() { 柜缓存.clear(); 柜签缓存.clear() }
  function 柜签(dir) {
    const 旧 = 柜签缓存.get(dir)
    if (旧 && Date.now() - 旧.时 < 200) return 旧.签
    const 签 = (async () => {
      const 串 = []
      const 走 = async (p, 深) => {
        let 项 = []
        try { 项 = await readdir(p, { withFileTypes: true }) } catch { return }
        await Promise.all(项.map(async (e) => {
          const q = join(p, e.name)
          if (e.isDirectory() && 深 >= 2) return
          try { const s = await stat(q); 串.push(`${q}@${s.mtimeMs}@${s.size}`) } catch { /* 这一刻刚被挪走 */ }
          if (e.isDirectory()) await 走(q, 深 + 1)
        }))
      }
      await 走(dir, 0)
      return 串.sort().join('|')
    })()
    柜签缓存.set(dir, { 时: Date.now(), 签 })
    return 签
  }
  async function 柜里(名, dir, 算) {
    const 签 = await 柜签(dir)
    const 键 = JSON.stringify([名, dir])
    const 旧 = 柜缓存.get(键)
    if (旧 && 旧.签 === 签) return 旧.值
    const 值 = 算()
    柜缓存.delete(键)
    柜缓存.set(键, { 签, 值 })
    值.catch(() => { if (柜缓存.get(键)?.值 === 值) 柜缓存.delete(键) })
    while (柜缓存.size > 2000) 柜缓存.delete(柜缓存.keys().next().value)
    return 值
  }
  const 扫c = (柜) => 柜里('扫', 柜, () => 扫(柜))
  const 名册c = (柜) => 柜里('名册', 柜, () => 名册(柜))
  const 等着的c = (柜) => 柜里('等着的', 柜, () => 等着的(柜))
  const 现行们c = (柜) => 柜里('现行们', 柜, () => 现行们(柜))
  /* `我是谁()` 读的是这个会话所在项目的名册 —— 认不出柜子在哪就不缓存，照原样现问 */
  const 我是谁c = (id) => {
    let 柜 = ''
    try { 柜 = 文档夹(ctx, id) } catch { /* 认不出 */ }
    return 柜 ? 柜里(`我是谁:${id}`, 柜, () => 我是谁(ctx, id)) : 我是谁(ctx, id)
  }

  // ------------------------------------------------ 路由

  const json = (res, code, body, 记 = null) => {
    const text = JSON.stringify(body)
    const 头 = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    /* 计时头**过一遍 ASCII**：非 Latin-1 的字符写进响应头会抛 ERR_INVALID_CHAR，
       那一抛整条接口答的是 400 空响应（见 `计时器()` 上面那段）。
       一个阶段名起错，代价是整张脸空掉 —— 所以这儿宁可把那个字显示成 `?`。 */
    if (记) { 记('json'); 头['Server-Timing'] = 记.头().replace(/[^\x20-\x7E]/g, '?') }
    res.writeHead(code, 头)
    res.end(text)
  }

  /* 目录和身份按需读取；原有三个历史响应保持兼容。
     · `要`：全 ＝ 树 ＋ 这一格的对话；树 ＝ 别的格子动了，只算树（见下面那一段）；
             对话 ＝ 同一棵树上换了一格，树原样不动，只折这一格的对话（前端手上留着树）
     · `页`：轨迹／身份 —— 那两页开着才算、才发（都是重的，而且平时没人看） */
  async function history(res, want, 要 = '全', 页 = new Set(), 首屏 = false) {
    const 只要树 = 要 === '树', 只要对话 = 要 === '对话'
    const 要轨迹 = 页.has('轨迹'), 要身份 = 页.has('身份')
    const 记 = 计时器()
    const sessions = await listSessions(要 === '树' || 要 === '全')
    记('list')
    /* **要哪条就给哪条,给不出也不许换一条给他。**
       2026-08-19 的真事故:刚开出来的会话还没落盘、也还没有 agent 实例,
       于是这一行判它「不在名单里」,悄悄把用户换回最近活跃的那条 —— 界面上一个字都不说,
       用户看到的是「点了新对话没反应」。**替人做了选择还不吭声就是暗层**(图景禁令 3)。 */
    const chosen = want || (sessions[0]?.id ?? null)
    if (要 === '目录') return json(res, 200, { ok: true, session: chosen, sessions, 项目根: PROJ_ROOT }, 记)
    if (要 === '身份') {
      if (!chosen) return json(res, 200, { ok: true, session: null, 身份: null }, 记)
      let events
      try { events = await eventsOf(chosen) }
      catch (error) { return json(res, 200, { ok: true, session: chosen, 身份: null,
        note: `这条会话还读不出内容(${String(error?.message || error)})—— 刚开出来的会话,说完第一句话才有流` }, 记) }
      记('events')
      const 身份 = await 身份Of(ctx, sessions, chosen, events)
      记('identity')
      return json(res, 200, { ok: true, session: chosen, 身份 }, 记)
    }
    const 工作时间 = chosen ? await 工作计时.读取(sessions.find(row => row.id === chosen)?.cwd) : null
    if (要 === '项目统计') {
      if (!chosen) return json(res, 200, { ok: true, 计量: null, 工作时间: null }, 记)
      const providers = (await connections.list()).providers
      const 计量 = await 读取项目计量(sessions, chosen, async (id, row) => {
        const events = await 瘦账Of(id)
        row.seedLength ??= 继承截点.get(String(id))
        return events
      }, await 单价(), providers)
      return json(res, 200, { ok: true, 计量, 工作时间 }, 记)
    }
    /* **这个节点用哪个模型，跟他的对话一起送。** 查的是模型表（`archive` 的「模型表」），调模型那一钩查的也是它。
       界面不另外问、不自己记：数据钉着会话，点到哪个节点，下拉就是哪个节点的。 */
    let 模型 = null
    if (chosen) {
      try { 模型 = 会话的模型(ctx, chosen, sessions.find((x) => String(x.id) === String(chosen))?.cwd) } catch (e) {
        console.log(`Blueprint studio: ${chosen} 的模型表查不出来（${(e && e.message) || e}）`)
      }
    }
    /* 项目根一并带出去:那张「新项目」表要把文件夹会建在哪儿**当场显给用户看**。
       建在哪儿是这一台机器的事实,不该让界面猜,也不该让用户建完才知道。 */
    if (!chosen) return json(res, 200, { ok: true, session: null, sessions, 项目根: PROJ_ROOT, entries: [], trace: [], stats: null, undrawn: {}, structural: 0, total: 0, busy: false })
    /* 只刷新树时直接读瘦投影，当前会话也不先复制整份正文。 */
    if (只要树) {
      const lin = await lineage(sessions, chosen, 记, null, 首屏)
      记('lin-tree')
      if (lin && lin['用量']) lin['用量']['钱'] = 算钱(lin['用量'], await 单价())
      const cwd = sessions.find(row => row.id === lin?.root)?.cwd
      if (cwd && lin?.tree) await 图纸流.track(lin.root, cwd, lin.tree,
        sessions.filter(row => row.projectRootSession === lin.root), 首屏)
      return json(res, 200, { ok: true, session: chosen, sessions, 项目根: PROJ_ROOT, 工作时间,
                              busy: 运行.在跑(chosen), 'busy自': 运行.起于(chosen), 'busy轮': 运行.轮号(chosen), lineage: lin }, 记)
    }
    let events
    try { events = await eventsOf(chosen) } catch (e) {
      /* 刚出生、一句话还没说的会话读不出来是正常的(说完第一句就有了)。
         **照样认领它**,只是如实说这一句 —— 不许拿别人的流冒充它。 */
      return json(res, 200, {
        ok: true, session: chosen, sessions, 项目根: PROJ_ROOT, 模型, 工作时间, entries: [], trace: [], turns: [], lineage: null,
        stats: null, undrawn: {}, structural: 0, total: 0, busy: false,
        note: `这条会话还读不出内容(${String((e && e.message) || e)})—— 刚开出来的会话,说完第一句话才有流`,
      })
    }
    记('events')
    /* 座位从柜子问一次，递给 fold —— fold 是纯的，读不到磁盘。
       一条会话一个座位，不会中途换，所以问一次就够。 */
    let 我的座位 = ''
    try { 我的座位 = (await 我是谁c(chosen))?.座位 || '' } catch { /* 认不出就不写名字 */ }
    记('seat')
    /* SYS 那一块的料单 —— 事实齐了才算得出来（座位、账本、柜子），所以在 fold 之前现算一次。
       算不出来不拦整条流:`entryOf` 收到 null 就把那一块退回成总纲原文。 */
    let 料 = null
    try { 料 = await 料单Of(chosen, 我的座位, events) } catch (e) {
      console.log(`Blueprint studio: ${chosen} 的出生料单没算出来 —— ${(e && e.message) || e}`)
    }
    记('manifest')
    const folded = fold(events, 我的座位, 要轨迹, 料)
    if (folded.entries.some(entry => entry.type === 'blueprint.external')) {
      try {
        const data = await 外部协助Of(chosen, sessions)
        const external = new Map(data.rows.map(row => [row.id, row]))
        for (const entry of folded.entries) if (entry.type === 'blueprint.external') {
          const inherited = entry.seq < (继承截点.get(String(chosen)) || 0)
          entry.data = inherited ? { ...entry.data, inherited: true }
            : external.get(entry.data.id) || entry.data
        }
        if (data.missing) folded.externalNote = data.missing
      } catch (error) { folded.externalNote = error.message }
    }
    记('fold')
    /* 钱在这儿算,不在 fold 里 —— fold 是纯的,读不到磁盘上那张价目表 */
    if (folded.stats) folded.stats['钱'] = 算钱(folded.stats, await 单价())

    /* 这条会话**每一步**吃进／交出了哪几块料 —— 一步一排,画在那一步那一行底下。
       2026-09-08 之前这儿是按轮算的(`一行一轮()` ＋ `对柜子()`),对话流把它画在
       轮尾行上 —— 于是这一轮跑二十分钟,你就二十分钟看不见它吃了什么、交了什么,
       整轮结束才一次性冒出来。**粒度换成一条事件**:料是一步一步进出的,账也该是。
       信息流那页仍按轮汇总(那一页的粒度就是"一行一轮"),两页认的是同一行信封。

       实时那一头走 `块排帧()`,读的是同一个 `块印们()` ——
       所以"跑着长出来的"和"刷新后重画的"是同一排东西,不会各说各的(验收 4)。 */
    let 步块 = []
    try {
      const 按名版 = await 按名版Of(chosen)
      for (const ev of events) {
        const 块 = 块印们(ev)
        if (!块) continue
        步块.push({ seq: ev.seq, ...配位(按名版, 块) })
      }
    } catch (e) {
      /* 画不出这几排不许拖垮整条流,但也不静默 —— 少了一半线索是看不出来的那种缺。 */
      console.log(`Blueprint studio: ${chosen} 那几排 context 没算出来 —— ${(e && e.message) || e}`)
    }
    记('blocks')
    /* 只要对话：不带 `lineage` 这个键 —— 前端认「没带」＝ 留着手上那棵 */
    let lin
    if (!只要对话) {
      lin = await lineage(sessions, chosen, 记, events)
      记('lin-tree')
      /* 全项目那笔钱在这儿乘价，跟单条会话那笔走同一张表、同一个 `算钱()` ——
         两处各算一遍就会漂，而漂了没人看得出来。 */
      if (lin && lin['用量']) lin['用量']['钱'] = 算钱(lin['用量'], await 单价())
    }
    /* 身份那一页没开就不算、不带这个键（前端认「没带」＝ 还没取，不是「读不出」） */
    let 身份
    if (要身份) {
      身份 = await 身份Of(ctx, sessions, chosen, events)
      记('identity')
    }
    json(res, 200, {
      ok: true, session: chosen, sessions, 项目根: PROJ_ROOT, 模型, 工作时间, busy: 运行.在跑(chosen),
      'busy自': 运行.起于(chosen), 'busy轮': 运行.轮号(chosen),          /* 开跑时刻 —— 活条那把秒表的起点 */
      ...(只要对话 ? {} : { lineage: lin }),
      ...(要身份 ? { 身份 } : {}),
      步块, ...folded,
    }, 记)
  }

  // 只读投影：重启后从会话恢复；不写名册、不唤醒节点，也不另存文件登记账。
  const 产物缓存 = new Map()
  const 材料目录 = 创建材料目录()
  const 任务廊预览缓存 = join(数据根, '.dsh', '任务廊预览缓存')
  const 任务廊预览 = 创建任务廊预览({renderer:ctx.get('blueprintRenderer'),cacheDir:任务廊预览缓存})
  const 材料缓存 = new Map()
  async function materialPreview(res, params) {
    try {
      const session = params.get('session'), g = await 项目文件夹(session)
      if(g.错) return json(res, 404, {ok:false,message:g.错})
      const result = await 任务廊预览(g.dir, {session,path:params.get('path')})
      if(result.type !== 'image') return json(res, 200, {ok:true,...result})
      res.writeHead(200, {'Content-Type':'image/png','Content-Length':result.body.length,'Cache-Control':'no-store'})
      res.end(result.body)
    } catch { return json(res, 404, {ok:false,message:译('预览不可用')}) }
  }
  async function 会话产物引用(s, root, materials = false) {
    const events = await eventsOf(s.id)
    const 版 = 账本版本.get(String(s.id))?.版, inherited = s.seedLength ?? 继承截点.get(String(s.id)) ?? 0
    const signature = `${版}:${events.length}:${events.at(-1)?.seq}:${events.at(-1)?.time}`
    // 运行中的节点每来一条事件签就变；同一版账本只折新来的事件，不再每次从头扫整段会话。只算这次要的那一种。
    let cached = 产物缓存.get(s.id)
    if (!cached || cached.版 !== 版 || cached.root !== root || cached.inherited !== inherited) cached = { 版, root, inherited }
    const kind = materials ? 'materials' : 'refs'
    cached[kind] = 续产物引用(cached[kind], events, s.id, root, inherited, { materials })
    产物缓存.delete(s.id); 产物缓存.set(s.id, cached)
    if (产物缓存.size > 500) 产物缓存.delete(产物缓存.keys().next().value)
    return { signature, events, refs: cached[kind].refs }
  }
  async function artifacts(res, want, scope) {
    if (!want) return json(res, 400, { ok: false, message: '请选择一个节点' })
    try {
      const all = await listSessions(), g = await 项目文件夹(want)
      if (g.错) return json(res, 404, { ok: false, message: g.错 })
      const sessions = all.filter(s => s.cwd && resolve(s.cwd) === g.dir)
      const roster = await 名册c(join(g.dir, 文档夹名))
      const selected = 产物范围(sessions, want, roster, scope)
      const refs = [], warnings = []
      for (const s of selected) {
        try {
          refs.push(...(await 会话产物引用(s, g.dir)).refs)
        } catch (e) { warnings.push(`会话 ${s.id} 的产物未读出：${e.message}`) }
      }
      const items = await 汇集产物(g.dir, refs, roster, sessions)
      return json(res, 200, { ok: true, session: want, scope, items, warnings, sessions: selected.map(s => s.id) })
    } catch (e) { return json(res, 500, { ok: false, message: `产物读取失败：${e.message}` }) }
  }

  // 仅供界面按需读取；不注入模型消息、不修改节点和素材目录。
  async function materials(res, params) {
    const want = params.get('session'), view = params.get('view') || 'assets'
    if (!want) return json(res, 400, {ok:false, message:'请选择一个节点'})
    const filter = {offset:params.get('offset'), limit:params.get('limit'), query:params.get('query') || '', kind:params.get('kind') || ''}
    try {
      const g = await 项目文件夹(want)
      // 不在项目里的会话（右上角的帮助、dsh 自己开的普通会话）没有项目材料：对话里那条材料按「没有」回，不报错；别的视图照旧 404。
      if (g.错 && g.不是项目 && view === 'used' && !params.get('path')) return json(res, 200, {ok:true, session:want, items:[], warnings:[], more:false, offset:0, limit:0})
      if (g.错) return json(res, 404, {ok:false, message:g.错})
      if (view === 'live') {
        const page = await 外部run文件页(g.dir, {session:want, id:params.get('id'), ...filter})
        return json(res, 200, {ok:true, session:want, ...page})
      }
      if (view !== 'used' || params.get('path')) {
        const page = await 材料目录(g.dir, {session:want, view, path:params.get('path') || '', ...filter})
        return json(res, 200, {ok:true, session:want, warnings:[], ...page})
      }
      const scope = ['self','project'].includes(params.get('scope')) ? params.get('scope') : 'branch'
      const all = await listSessions(), sessions = all.filter(s => s.cwd && resolve(s.cwd) === g.dir)
      const roster = await 名册c(join(g.dir, 文档夹名)), selected = 产物范围(sessions, want, roster, scope)
      const refs = [], stamps = [], warnings = []
      for (const s of selected) {
        try {
          const { refs: sessionRefs } = await 会话产物引用(s, g.dir, true)
          // 引用只增不改：多数新事件不带新材料，按引用条数认缓存，不随每条事件重查全部文件。
          stamps.push([s.id, sessionRefs.length])
          refs.push(...sessionRefs)
        } catch (error) { warnings.push(`会话材料暂不可读：${error.message}`) }
      }
      const seq = params.get('seq'), callId = params.get('callId')
      const matching = refs.filter(ref => (!seq || String(ref.seq) === seq) && (!callId || ref.callId === callId))
      const key = JSON.stringify([g.dir, stamps, seq, callId]), now = Date.now()
      let cached = 材料缓存.get(key)
      if (!cached || now - cached.time > 5000) {
        cached = {time:now, value:汇集产物(g.dir, matching, roster, sessions, {materials:true})}
        材料缓存.delete(key); 材料缓存.set(key, cached)
        while (材料缓存.size > 24) 材料缓存.delete(材料缓存.keys().next().value)
      }
      const items = await cached.value, page = 材料分页(items, filter)
      return json(res, 200, {ok:true, session:want, view, scope, path:'', shared:false, warnings, ...page})
    } catch (error) { return json(res, 400, {ok:false, message:`材料读取失败：${error.message}`}) }
  }

  /* 一行一轮:扫每条会话的账,轮起于 turn/start;进场认三样 —— 信封行的印、
     弧递的话、用户的话。【出】的印这儿**故意不收**:出的那一半从柜子挂回来
     (`挂出()`),两头都收就是同一块印两遍(做完算完第 3 条)。

     **两页共用这一份**:信息流按项目全量画,对话流只要当前这条会话的那几行
     (`history` 把它们一并带出去,画在每一轮的轮尾)。同一份账、同一个粒度 ——
     写第二份的那天,两页开始各说各的,而且不会有任何东西报错。 */
  async function 一行一轮(会话们, 只算自己跑的 = false) {
    const 行们 = []
    const 行按会话 = new Map()
    for (const s of 会话们) {
      let evs
      try { evs = await eventsOf(s.id) } catch { continue }  /* 刚出生还没流,有话时自然进来 */
      /* **分叉出来的那条线,账本前半截是从父原样复制过来的**(`seedLength` ＝ 下标,
         dsh 那边的用法就是 `events.slice(seedLength)`)。信息流按**整个项目**铺,
         不跳过这一截,同一轮会在每条支线上各出现一次 —— 用户 2026-09-03 报,
         截图里「轮10 你帮我打开」一模一样出现了四遍。
         对话流那一页**不跳**(默认 false):那一页看的就是这条线自己的全文,
         继承来的那几轮它照画,词块也该跟着。 */
      if (只算自己跑的) evs = evs.slice(Number(s.seedLength ?? 继承截点.get(String(s.id))) || 0)
      const 我行 = []
      行按会话.set(String(s.id), 我行)
      let cur = null
      let 轮 = 0
      const 开行 = (t) => { cur = { 会话: String(s.id), 轮, 时: t || 0, 进: [], 出: [] }; 行们.push(cur); 我行.push(cur) }
      for (const e of evs) {
        if (!e) continue
        /* 轮号**认账上写的那一个**(`turn/start` 自带 `turn`),自己数只是兜底 ——
           对话流那边的轮尾行认的也是账上这个号,两边各数各的就会错位一格。 */
        if (e.type === 'turn/start') { 轮 = (e.data && e.data.turn) || 轮 + 1; 开行(e.time); continue }
        if (!['user/message', 'tool/result', 'tool/ptc-dispatch'].includes(e.type)) continue
        if (!cur) 开行(e.time)   /* turn/start 之前的(种子、出生备料)记在第 0 轮 */
        if (e.type === 'user/message') {
          const m = e.data || {}
          const text = textOf(m.content)
          const 印们 = text.split('\n').map(拆信封行).filter(Boolean)
          if (印们.length) { for (const p of 印们) cur.进.push(p); continue }
          const 说 = oneLine(text, 80)
          if (!说) continue
          const 来源 = 来源显示(m)
          if (来源 === 'blueprint-arc') cur.进.push({ 印: text.startsWith('【换版】') ? '换版' : '弧', 说 })
          else if (m.source?.kind === 'user') cur.进.push({ 印: '话', 主人: '用户', 说 })
          else cur.进.push({ 印: '递', 主人: 来源, 说 })
        } else {
          const blk = 工具结果Of(e) || {}
          for (const p of textOf(blk.content).split('\n').map(拆信封行).filter(Boolean)) {
            if (p.印 === '取' || p.印 === '进') cur.进.push(p)
          }
        }
      }
    }
    return { 行们, 行按会话 }
  }

  /* 这些行跟柜子对一次，两件事：

     ① **出** —— 柜子里每一块挂回「由」那条会话、落档时刻所在的那一轮。
        挂不回去的**原样退回来**（`落空`）：它可能是别条会话的，也可能落在
        那条会话第一轮开始之前。怎么安置它是两页各自的事 —— 这儿不替它们决定。
     ② **进** —— 每个印配上它在柜子里的位置，于是它点得开。
        认的是「全名 ＋ 版本」：信封行报的就是这两样，柜子里那份也就是这两样。
        **配位要拿整个柜子去配**，不能只拿这条会话产的那些 —— 它吃进来的东西
        多半是别人产的。配不上的(版本已经不在盘上)**不给位置**：
        没有位置的画出来是灰的、点不动，手型是个承诺，兑现不了就不摆。

     @returns {object[]} 没挂上任何一轮的那些块 */
  function 对柜子(行们, 行按会话, 全部块) {
    const 落空 = []
    for (const b of 全部块) {
      /* **不是他产的就不算他的【出】**（2026-09-05 用户报：分工手册·0 和
         初始用户要求 在 Blueprint 那一页上既是【取】又是【出】）。
         `由` 答的是"哪条会话把它写进盘的"，建项目那一刻机器是**借 Blueprint 这条会话的手**
         落的这两块，于是它们的 `由` 就是 Blueprint —— 但 `主人` 老老实实写着「用户」「机器」。
         挂【出】认的该是主人：**出 ＝ 这一格自己交出去的东西**。
         它们照旧是【取】（出生包把全文喂进了窗），那一半是对的，两个印说的本来
         就是两件事：【取】＝正文进过你的窗，【出】＝这一块是你交的。 */
      if (b.主人 === '用户' || b.主人 === '机器') continue
      const t = Date.parse(b.落档于) || 0
      const 候 = (行按会话.get(b.由) || []).filter((行) => 行.时 <= t)
      if (候.length) 候[候.length - 1].出.push(b)
      else 落空.push(b)
    }
    const 按名版 = new Map(全部块.map((b) => [`${全名(b.种类, b.名称)} v${b.版本}`, b]))
    for (const 行 of 行们) {
      for (const p of 行.进) {
        if (!p.名) continue
        const b = 按名版.get(`${p.名} v${p.版本}`)
        if (b) p.位 = b.位
      }
    }
    return 落空
  }

  /* 柜子里每一块给这两页看的样子(全版本 —— 这两页看的是流水,不是现行目录)。
     **纯投影,不碰盘**:扫盘那一次在调用方,不然同一次请求会把柜子读两遍。 */
  function 柜里全部块(原始) {
    return 原始.map((r) => ({
      种类: r.种类, 名称: r.名称, 版本: r.版本, 主人: r.主人 || '',
      导读: oneLine(r.导读, 120), 落档于: r.落档于, 由: r.由 || '',
      /* 字数：料单那一张要报「这一份有多大」。正文不带出去（太大），只带这一个数。 */
      字数: [...String(r.全文 || '')].length,
      /* 点块看正文走现成的 /api/file(根=项目),位置从这儿带回去,前端不拼路径 */
      位: `${文档夹名}/${r.文件}`,
    }))
  }

  /* 「全名 v版本」→ 柜子里那一块。**词块要点得开,靠的就是这张表配出来的 `位`。**
     配不上(版本已经不在盘上、这条会话根本不在项目里)就是空表 —— 那几个词块画出来
     是灰的、点不动,不是错(手型是个承诺,兑现不了就不摆)。 */
  async function 按名版Of(会话) {
    try {
      const g = await 项目文件夹(会话)
      if (g.错) return new Map()
      const 全部块 = 柜里全部块(await 扫c(join(g.dir, 文档夹名)))
      return new Map(全部块.map((b) => [`${全名(b.种类, b.名称)} v${b.版本}`, b]))
    } catch { return new Map() }
  }

  /* 给这一步的每个印配上位置。认「全名 ＋ 版本」—— 信封行报的就是这两样,
     跟 `对柜子()` 里配位那一段同一条规矩。**纯的,原地盖 `位`**。 */
  function 配位(按名版, 块) {
    for (const p of [...块.进, ...块.出]) {
      const b = 按名版.get(`${p.名} v${p.版本}`)
      if (b) p.位 = b.位
    }
    return 块
  }

  /* ── SYS 那一块的料单 ──────────────────────────────────────────────────────
     「这个节点睁眼那一刻，眼前一共摆了哪几份纸。」三样事实拼起来，**一样都不是猜的**：
       · 座位 —— 柜子上写着（`我是谁()`）→ 壳是哪一份、附哪几份
       · 工具 —— 账本里 `request/header` 报的真名 → 一把一份说明书
       · 柜子 —— 出生包那条消息上的信封行 → 配上盘上的位置（`按名版Of()`，跟词块同一张表）
     加一个座位、加一把工具，这张单自动多一行，本函数一个字不改（协议 0.4）。

     ⚠️ **它不是快照，是现算的。** 文件那几行的字数与正文是**现在**磁盘上那一份；
     出生之后改过 md，这儿显示的是改后的。这句话写在单子的注里，不许装作是那一刻的样子。 */
  async function 料单Of(会话, 座位 = null, events = null) {
    let evs = events
    if (!evs) { try { evs = await eventsOf(会话) } catch { evs = [] } }
    let 座 = 座位
    if (座 === null || 座 === undefined) {
      try { 座 = (await 我是谁(ctx, 会话))?.座位 || '' } catch { 座 = '' }
    }
    /* 工具名单取**最后一条**请求头 —— 中途多了一把的话，那一条才是他现在手上这几把。 */
    const 请求 = evs.findLast(ev => ev.type === 'request/header')
    const 工具定义 = 请求?.data?.header?.tools || []
    const 工具名们 = 请求 ? 工具定义.map(t => t.name) : null
    const 统计 = 请求提示统计(evs)
    // 显示标签不决定提示词；SYS 使用名册中的实际身份。
    let 身份 = 座
    try {
      const current = await 我是谁(ctx, 会话)
      身份 = current ? 节点提示身份(current.身份, current.行) : 座
    } catch { /* 非项目会话保留原入口 */ }
    const descriptor = evs.find(e => e.type === 'subagent/descriptor')?.data
    const persona = descriptor?.persona
    if (descriptor) 身份 = '帮手'
    const 行们 = typeof persona === 'string'
      ? [{ 组: '公共前缀', 名: '子 agent 独立提示词（会话记录）', 全文: persona, 字数: persona.length }]
      : 读到的文件(身份, 工具名们 || [])
    /* 顺带现拼一份公共前缀全文，SYS 那一块拿它跟账上那一条对账（fold 读不到磁盘）。 */
    let 公共前缀 = ''
    try { 公共前缀 = 拼公共前缀(身份 || null, undefined, persona) } catch { /* 拼不出就空着，注里照说 */ }

    const 印们 = 出生包印们(evs)
    if (印们.length) {
      const 按名版 = await 按名版Of(会话)
      for (const p of 印们) {
        const b = 按名版.get(`${p.名} v${p.版本}`)
        行们.push({
          组: '柜子',
          名: `${p.名} v${p.版本}`,
          ...(b ? { 路径: b.位, 字数: b.字数 } : { 缺: '盘上配不上这一版 —— 版本换过，或者这条会话不在这个项目里' }),
          注: p.印 === '取' ? '出生包里当场给了全文' : '出生包里只给了信封，正文他自己按名取（archive_read）',
        })
      }
    }
    const 注 = [
      '公共前缀：同一种身份逐字相同，按 分层前缀.md 组合目标与判断（节点是核心，帮手用自己的独立提示词）和操作提醒。来源清单与实际装配共用一份定义；本轮意图、位置与协作背景在动态消息中提供，三页 skill 由节点自己读。',
      '工具名单从账本里 request/header 那条读'
        + (工具名们 ? `（${工具名们.length} 把）。` : '。⚠️ 这一刻账上还没有那一条，工具说明书这一组是空的 —— 这一格再动一下就补上。'),
      '系统正文字数取这一条 system/message 的原文；工具定义与动态提示取最近一次请求，动态提示只算当时活动的上下文文字消息，不含用户对话、工具结果或压缩摘要。工具定义按紧凑 JSON 计，字符数不等于 token 数。',
      '来源文件是当前磁盘上的模板与资料，可能含占位符或已修改；供回查，不计入实际请求字数，也不与账本原文相加。',
    ].join('\n')
    return { 料单: 行们, 注, 公共前缀, 统计, 工具定义 }
  }

  /* ---- 信息流:全系统只看块（工单-context积木.md 中部九）----
     **零自有数据**,三样现成的各投影一遍:
     · 已发生的「出」＝ 扫柜子(柜子本来就是 append-only 的块账,中部事实 1),
       每一块按「由」＋落档时刻挂回那条会话当时的那一轮;
     · 已发生的「进」＝ 各会话账里认 `信封行()` 的印(【取】【进】,拆用 `拆信封行()`,
       写与认同一个出处)＋ 弧递的话 ＋ 用户说的话(用户的话也是块,主人＝用户);
     · 未发生 ＝ `等着的()`(跟叫醒同一个判据)。
     死锁标红的判据是纯机械的:被等的名字,从名册和产出承诺里**推不出**谁会产出它 ——
     推不出 ≠ 一定不会来(有人可能落一份没承诺过的同名文档),所以死因说的是「推不出」,
     不替机器下更重的断言。 */
  async function flow(res, want) {
    const sessions = await listSessions()
    const chosen = want || (sessions[0]?.id ?? null)
    if (!chosen) return json(res, 200, { ok: true, session: null, 流: [], 等待: [], note: '还没有任何项目' })
    const g = await 项目文件夹(chosen)
    if (g.错) return json(res, 200, { ok: false, session: chosen, message: g.错 })
    const 柜 = join(g.dir, 文档夹名)

    const 原始 = await 扫c(柜)
    const 全部块 = 柜里全部块(原始)

    let 册 = []
    try { 册 = await 名册c(柜) } catch { /* 没有名册就光板:行上没有号和名字,但流照画 */ }
    const 按会话名 = new Map(册.map((r) => [String(r.会话), r]))
    const 按号 = new Map(册.map((r) => [String(r.id), r]))

    /* 这个项目的会话们 ＝ cwd 就是这个项目文件夹的(Blueprint、派出去的、支线都在内)。 */
    const 我的 = sessions.filter((s) => {
      try { return resolve(String(s.cwd || '')) === g.dir } catch { return false }
    })
    const Blueprint会话 = 我的.find(s => s.projectRootSession === s.id)?.id || 我的.find(s => !s.parentSession)?.id || chosen

    const 按id = new Map(我的.map((s) => [String(s.id), s]))
    /* **这一页只看你正站着的那一条线,跟轨迹同一个读法**（2026-09-03 用户裁定，原话：
       「我点那个节点就显示那个节点的信息流，点击那个支线就显示那个支线的信息流，
       这个逻辑应该和 dsh 的轨迹是一样的」）。
       原来它铺整个项目 —— 一个节点吃进／交出了什么，被别的六条线的行淹着，
       而支线还会把它爹的账再复述一遍。**换页看谁，就只有谁。**
       ⚠️ 上面那半页（未发生 —— 谁在等哪个名字）**仍然是整个项目的**：互等是一件
       只有站在项目高处才看得见的事，把它切成一条线就没人看得见死锁了。 */
    const 这一条 = 我的.filter((s) => String(s.id) === String(chosen))
    const { 行们, 行按会话 } = await 一行一轮(这一条, true)
    /* 挂不上任何一轮的自成一行 —— **块不许消失**。别人产的块不关这一页的事
       （这一页只有一条线），所以只捡这条线自己产的那几块。 */
    for (const b of 对柜子(行们, 行按会话, 全部块)) {
      if (String(b.由) !== String(chosen)) continue
      行们.push({ 会话: b.由, 轮: 0, 时: Date.parse(b.落档于) || 0, 进: [], 出: [b] })
    }

    /* 过滤 ＋ 排序,零自有数据的全部加工就这两下。 */
    const 流 = 行们
      .filter((r) => r.进.length || r.出.length)
      .sort((a, b) => a.时 - b.时)
      .map((r) => {
        /* **一条支线是那一格的另一条线,不是另一格。** 名册上查不到它,就顺父往上找 ——
           跟树上折砖同一条判据(`谁的线()`),所以两页说的是同一件事。
           `支线` 那一格是给界面用的:同一格的几条线要分得开是哪一条(2026-09-03)。 */
        const 主 = 谁的线(按会话名, (x) => String((按id.get(x) || {}).parentSession || ''), String(r.会话), Blueprint会话)
        const 名 = 按会话名.get(主)
        return { ...r, 号: 名 ? String(名.id) : '', 名字: 名 ? 名.name : '', 座位: 名 ? 名.座位 : '',
                 ...(主 !== String(r.会话) ? { 支线: true } : {}) }
      })

    /* 未发生:谁在等什么(`arc` 的 `差什么()`,跟叫醒同一个判据)。死因是纯机械的:被等的那一格关停了,它交的东西不会来。 */
    let 等待 = []
    let 等待挂 = ''
    try {
      const 等 = await 等着的c(柜)
      const 退 = 关停了的(原始)
      for (const [号, 缺] of 等) {
        if (!缺.length || 退.has(String(号))) continue
        /* 名册只给「孩子还没交付」那一半；此刻在跑的不是「停着在等」（跑没跑看 busy，dsh 的事实） */
        const 那行 = 按号.get(String(号))
        if (那行 && 那行.会话 && 运行.在跑(那行.会话)) continue
        const 条目 = 缺.map((条) => {
          const s = String(条)
          if (s === 同层还没做完) return { 条: s }      /* 这一层还在动就是在动,天生不会死 */
          const n = s.replace(/《.*$/, '').trim()
          return (n && 退.has(n)) ? { 条: s, 死: `${n} 已关停,它的汇报不会来了` } : { 条: s }
        })
        const r = 按号.get(String(号))
        等待.push({ 号: String(号), 名字: r ? r.name : '', 座位: r ? r.座位 : '',
                    会话: r ? String(r.会话) : '', 条目 })
      }
    } catch (e) {
      等待挂 = `等待表算不出来 —— ${String((e && e.message) || e)}`
    }

    /* **待完成**：每一格手上还有哪几件活（`arc` 的 `欠着的()` —— 跟 `report` 那把工具、
       跟树上「完成」那个态读同一份，不许各判各的）。
       跟「等待」分两栏摆：**待完成是他自己动得了的**（交汇报、做打回、回纸条），
       **等待是他动不了的**（门没开，那是别人的活）。混成一张表，你会去推错人。 */
    let 待完成 = []
    try {
      /* 新系统：「现块」就是名册的行（`名册视图.js`）；停着等孩子的节点在「等」那一栏，不算它手上的活 */
      const 现 = 册
      const 退 = 关停了的(原始)
      const 在等 = new Set(等待.map((x) => String(x.号)))
      for (const r of 册) {
        const 号 = String(r.id || '')
        if (!号 || r.草稿 || !r.会话 || 退.has(号) || 在等.has(号)) continue
        const 条目 = 欠着的(String(r.座位 || ''), 号, 现).map((x) => ({ 类: x.类, 说: x.说 }))
        if (条目.length) 待完成.push({ 号, 名字: r.name || '', 座位: r.座位 || '', 会话: String(r.会话), 条目 })
      }
    } catch (e) {
      等待挂 = `${等待挂 ? 等待挂 + '；' : ''}待完成算不出来 —— ${String((e && e.message) || e)}`
    }

    json(res, 200, {
      ok: true, session: chosen, Blueprint会话, 项目名: g.dir.split('/').pop(), 流, 等待, 待完成,
      ...(等待挂 ? { 等待挂 } : {}),
    })
  }

  /* ---- 血脉:时间线上半部分那张图的全部原料 ----
     一个座位的一生散在好几个会话里(分叉 = 新开一个会话,dsh 就是这么实现的)。
     这里把整条线上每个会话的**轮骨架**收齐,一根条一轮。

     省的地方在两处:① 那棵树白拿,不读事件 ② 每个会话只走到轮边界,不折内容。
     当前这个会话的事件已经在手上了,不重读。 */
  /* 树上每一格一律读瘦账（见 `瘦身()`），你正看着的那一格也一样 ——
     `手上` 只是省一次读盘：那一格的整份账本 `history` 刚读过，要重瘦时拿它瘦。 */
  async function lineage(rows, chosen, 记 = () => {}, 手上 = null, 首屏 = false) {
    const { ids, root } = lineageIds(rows, chosen)
    const by = new Map(rows.map((r) => [r.id, r]))
    const 快照们 = 名单版本.get(rows)
    const 瘦账of = async id => {
      const evs = await 瘦账Of(id, id === chosen ? 手上 : null, 快照们?.get(id))
      const row = by.get(id)
      if (row) row.seedLength ??= 继承截点.get(String(id))
      return evs
    }
    /* 帮手会话（批量帮助、迭代工作；会话头 origin 是 subagent）不上树，也不占 `LINEAGE_CAP`。 */
    const 是帮手会话 = (id) => by.get(id)?.origin === 'subagent'
    const 人 = new Set(ids.filter((id) => !是帮手会话(id)).slice(0, LINEAGE_CAP))
    const 被截的人 = ids.filter((id) => !是帮手会话(id)).length - 人.size
    const kept = ids.filter((id) => 人.has(id))
    // 独立冷读并行；后面的归属与继承仍按原来的广度顺序投影。
    const 预读 = new Map()
    const readBatch = async ids => {
      const queue = [...ids]
      await Promise.all(Array.from({ length: Math.min(8, queue.length) }, async () => {
        while (queue.length) {
          const id = queue.shift()
          try { 预读.set(id, { value: await 瘦账of(id) }) }
          catch (error) { 预读.set(id, { error }) }
        }
      }))
    }
    await readBatch(人)
    记('lin-node-events')
    const lines = []
    /* 事件已经读了一遍，树就在这一遍里建完 —— 不为了画树再读第二遍 */
    const evsById = new Map()
    for (const [id, read] of 预读) if (read.value) evsById.set(id, read.value)
    for (const id of kept) {
      let evs
      try {
        const read = 预读.get(id)
        if (read.error) throw read.error
        evs = read.value
      } catch (e) {
        /* 读不出的那条线**照样占一格**,并且说出读不出 —— 「读不出」和「没有」必须分得开 */
        lines.push({ id, parent: by.get(id)?.parentSession, seedLength: by.get(id)?.seedLength,
                     broken: String((e && e.message) || e), turns: [] })
        continue
      }
      if (首屏) continue
      /* 继承了几轮 = 种子边界之前那几轮。**这里算,不让前端算** ——
         前端不该知道 seedLength 是什么单位,它只该知道「前 n 根条不是我画的」。 */
      evsById.set(id, evs)
      const turns = turnSkeleton(evs)
      const seed = by.get(id)?.seedLength ?? 0
      const inherited = turns.filter((t) => t.idx < seed).length
      /* 实测有 seedLength 大过整个事件数的会话(609 条事件却声称继承 11210 条)。
         dsh 自己的校验器遇到这种会直接抛。我们不抛,但**必须说出来** ——
         不说的话它表现为「这条线一轮都没自己跑过」,那是把坏数据画成了正常状态。 */
      const seedBad = seed > 条数Of(evs)
        ? `血统对不上：声称继承 ${seed} 条事件，这个会话总共只有 ${条数Of(evs)} 条`
        : undefined
      /* 第二道对账:继承的轮数不该多过父自己有的轮数。多了就意味着图上会开一个洞 ——
         父画到第 3 根,子从第 5 根起,中间那一格谁都不画。洞是真的(数据就是对不上),
         但没人说的洞会被当成画错了。`ids` 是广度优先,父一定先进 lines,拿得到。 */
      const par = lines.find((l) => l.id === by.get(id)?.parentSession)
      const gap = par && inherited > par.turns.length
        ? `接不上父：继承了 ${inherited} 轮，父只有 ${par.turns.length} 轮`
        : undefined
      lines.push({
        id,
        parent: by.get(id)?.parentSession,
        seedLength: by.get(id)?.seedLength,
        active: !!by.get(id)?.active,
        turns, inherited,
        ...(seedBad ? { seedBad } : {}),
        ...(gap ? { gap } : {}),
      })
    }
    记('lin-events')
    /* 树上三行字（角色名/工作内容/验收标准）的出处：prompt（派活的人写的）。 */
    let 册 = new Map()
    try {
      const rootCwd = by.get(root)?.cwd
      if (rootCwd) {
        /* **一个会话一行**（2026-09-01 起 Helm 自己占一行、自己一个号）。 */
        册 = new Map()
        for (const x of await 名册c(join(String(rootCwd), 文档夹名))) {
          if (x.会话) 册.set(x.会话, x)
        }
      }
    } catch { /* 没有名册就空着，树退回账本字段 */ }
    记('lin-roster')
    /* **派出去的节点** ＝ 名册上有它的 prompt。没有 ＝ 这个对话自己的支线
       （用户撤回／开支线 fork 出来的）。两者在账本上长得一模一样
       （都是 parentSession ＋ seedLength），只有名册分得开 —— 时间线要靠它
       把「另一个对话」和「同一个对话的另一条线」分开（2026-08-26 用户裁定：
       「轨迹真正的作用是一个对话内撤回，或者开支线的情况」）。 */
    /* Blueprint**永远不是**派出去的：没人派它。名册在 `别的.会话` 缺席时会退回按「谁落的单」
       归堆，于是 Blueprint（它落了所有下级的 prompt）会被误认成一格。这里钉死。 */
    for (const l of lines) l.派出去的 = l.id !== root && 册.has(l.id)

    /* run 用 subagent 开的会话也上树（无 2）：只认父会话是 run 的帮手会话，读它的瘦账看出身，批量帮助、迭代工作照旧不上树。 */
    const 子run们 = []
    for (const id of ids.filter(id => 是帮手会话(id) && 册.get(by.get(id)?.parentSession)?.类型 === 'run')) {
      try {
        const evs = await 瘦账of(id)
        if (是子run会话(evs)) { evsById.set(id, evs); 子run们.push(id) }
      } catch { /* 读不出就不画这一块 */ }
    }

    /* 谁还在等、等什么 —— 跟叫醒共用 `archive` 里那一个判据。读不出就当没人在等
       （少亮一盏灯，绝不亮错：`状态OF()` 头上那条纪律）。 */
    let 等着 = new Map()
    let 退了 = new Map()
    let 交齐 = new Set()
    let 现块 = []
    /* 这棵树是哪个柜子的 —— PULSE 那块词块要拿它去问开关（一个项目一个开关）。 */
    let 柜路径 = ''
    try {
      const rootCwd = by.get(root)?.cwd
      if (rootCwd) {
        const 柜 = join(String(rootCwd), 文档夹名)
        柜路径 = 柜
        /* ⚠️ **这儿原来有一次「兜底 `反射()`」—— 2026-09-10 删了，别加回来。**

           它当时的理由是对的（主触发点在 `落档()` 那头，是一次性的：那一刻错过了
           —— 进程正好重启、闸那一刻还没开 —— 就再没有第二次机会，人会一直睡在那儿）。
           **错的是它挂的地方：画树是界面轮询。** 于是浏览器盯着哪个项目看，
           哪个项目的引擎就在转 —— 表针连着油门。用户实机报的三条全出自这一行：
           切到陈年老项目那些节点乱七八糟地重启、刷新一次再重启一遍、
           进程重启后第一次画树把所有冷会话捞活一遍。

           它自己那段注释里已经记着两次代价了（09-05 那次「按停停不住」就是它），
           **这是第三次**。兜底这件事没有取消，是换了触发源：
           **`PULSE` 那块词块 ＋ 一个定时器**（本文件下面「PULSE」那一节）——
           兜底的是一个你按得到的开关，不是你的眼睛。

           所以这个函数从此**一个副作用都没有**：画树就是画树。 */
        等着 = await 等着的c(柜)
        const 现 = await 现行们c(柜)
        现块 = 现
        退了 = 关停了的(现)
        交齐 = 交齐的(现)
      }
    } catch { /* 算不出来就空着 */ }
    记('lin-cabinet')
    /* 座位表：图纸按座位排（座位卡＋这件工作在座位上的分身）。读不出就空着。 */
    let 座位们 = []
    try { if (柜路径) 座位们 = await 座位们Of(柜路径) } catch { /* 没有座位 */ }

    const 旧 = 旧格式(现块)
    if (旧) console.log(`Blueprint studio: ⚠️ ${by.get(root)?.cwd || root} —— ${旧.replace(/\*\*/g, '')}`)
    return { root, current: chosen, lines, dropped: 被截的人,
             ...(旧 ? { 旧格式: 旧 } : {}),
             /* 整棵树烧了多少 —— 顶栏那一行。价在路由那头乘（这儿读不到磁盘上的价目表）。 */
             用量: 全项目用量(by, kept, evsById, 被截的人),
             // spark 不上图纸（十 56）：用量照算，树上不画。
             tree: { ...seatTree(by, kept.filter((id) => 册.get(id)?.类型 !== 'spark'), root, evsById,
                            new Set([...pending.values()].map((f) => String(f.session))), 册, 等着, 退了, 交齐, 现块, chosen,
                            脉搏开着(柜路径), 子run们),
                     /* 树上 PULSE 正上方「全局」那一行：模型表上的全局那一格原样带下来；
                        `会话` 原样带回给 `模型.改`（认项目用）。规则在 `archive` 的「模型表」。 */
                     全局模型: { 值: 全局模型(ctx, root, by.get(root)?.cwd), 会话: root }, 座位们,
                     ...(柜路径 ? { collab: await 读协作设置(dirname(柜路径)).catch(() => null), 座位记忆: await 座位记忆Of(dirname(柜路径)) } : {}) } }
  }

  /* 右上角的帮助：一条 cordis 预设的普通 dsh 会话，工作目录在数据根的 助理/（./助理.js）。 */
  const 帮助助理 = 创建帮助助理({ 数据根, 文字路径, 会话总管: () => ctx.get('sessionController'),
    改权限: sessionId => 修改权限(ctx, ctx.get('sessionController'), { sessionId, preset: 助理权限 }, new AbortController().signal),
    设思考: (sessionId, 思考) => 设会话思考(ctx, sessionId, 思考) })

  /* ---- 一条通道:把 dsh 的 session／subagent controller 原样转出去 ----
     **一件能力都不自己实现。** 说话、停、开新会话、换模型、分叉,
     dsh 的 `ctx.sessionController` 全都做完了,而且做得比我们能做的细
     (分叉那条要找完整 turn 边界、带上边界后的零散追加、继承 cwd/preset/模型/血统)。
     我们只出一条路由和一张脸。自己写第二遍就是在造第二套真相。

     白名单,不是通用转发 —— 列在这儿的才转得出去,别的一律 404。
     **页面这头的名字和形状是 apiProxy 时代定下的，这张表负责翻译**，页面一个字不用改。
     dsh 0.1.5（2026-09-13 装上）把 `apiProxy` 整个删了：方法都还在，搬进了
     `参考/dsh/packages/api/session-controller/src/index.ts` 和 `subagent/subagent/src/index.ts`，
     调法从「`{rpcId, payload}` 进，`{result:{ok,value|error}}` 出」变成
     「请求对象进、值出、失败抛 `RemoteError`（带 `code`）」。

     **一处诚实记账**:dsh 在它自己的 `/api` 上还过一层校验,我们这条没有。
     它是同进程直调,调用方是我们自己那一页,每个 payload 都在一处拼出来。
     真送进去个歪的,dsh 的实现会抛,这里兜成一条原样回给页面 —— 不静默。 */
  const 要子节点 = (h) => {
    if (!h.subagents) throw new Error('这个部署没有挂 subagents —— 子节点说不了话、停不了')
    return h.subagents
  }
  const RPC = {
    /* 右上角的帮助：开（或接着）助理那一条标准 dsh 会话，回会话号，界面自己持有、自己画对话。 */
    '助理.打开': (_h, p) => 帮助助理.打开({ 新对话: p.新对话 === true }),
    'goal.control': (_h, p, signal) => 持续目标操作(ctx, p, signal),
    'features.control': (_h, p, signal) => 执行能力操作(ctx, p, signal),
    'project.closeAgentTerminals': (_h, p, signal) => 关闭项目节点终端(ctx, p, signal),
    /* 「全部停止」：节点各停各的（`session.cancel`），交给 Codex／Claude Code 的 run 没有会话，由这一条一起停；之后只在「全部启动」时再开。 */
    'project.stopExternalRuns': async (h, p, signal) => {
      const items = (await h.session.list({}, signal)).items || []
      const root = 项目操作会话(items, p.projectSessionId).find(r => String(r.sessionId) === String(p.projectSessionId))?.cwd
      if (!root) throw new Error('认不出这个项目，外部 run 没有停')
      const stopped = await 停项目外部run(String(root), '用户按了停', { 用户: true })
      if (stopped.length) 在跑变了()
      return { stopped }
    },
    'external.interrupt': async (h, p, signal) => {
      const items = (await h.session.list({}, signal)).items || []
      const result = await 停止外部协助(ctx, items, p)
      外部变了()
      return result
    },
    'project.trash': async (h, p, signal) => {
      const items = (await h.session.list({}, signal)).items || []
      const root = 项目操作会话(items, p.projectSessionId).find(r => String(r.sessionId) === String(p.projectSessionId))?.cwd
      const value = await 删除项目(ctx, root, p, { projectRoot: 项目父目录(root), beforeMove: async sessionIds => {
        const ids = new Set(sessionIds)
        for (const record of [...持久问题.values()]) if (ids.has(record.frame.session)) 关闭问题(record, 'cancelled')
      } })
      图纸流?.forget(p.projectSessionId)
      send({ type: 'blueprint.project_deleted', ...value })
      return value
    },
    'node.remove': async (h, p, signal) => {
      const items = (await h.session.list({}, signal)).items || []
      检查项目操作(items, 'node.remove', p)
      const root = items.find(r => String(r.sessionId) === String(p.projectSessionId))?.cwd
      const value = await 删除分身(ctx, root, p.nodeId, p)
      const retired = new Set(value.retiredSessions)
      for (const record of [...持久问题.values()]) if (retired.has(record.frame.session)) 关闭问题(record, 'cancelled')
      return value
    },
    'node.restart': async (h, p, signal) => {
      const items = (await h.session.list({}, signal)).items || []
      检查项目操作(items, 'node.restart', p)
      const root = items.find(r => String(r.sessionId) === String(p.projectSessionId))?.cwd
      const value = await 重启节点(ctx, root, p.nodeId, p)
      const retired = new Set(value.retiredSessions)
      for (const record of [...持久问题.values()]) if (retired.has(record.frame.session)) 关闭问题(record, 'cancelled')
      return value
    },
    '输入.信息': (h, p, signal) => 输入信息(ctx, p, signal),
    '附件.读取': (h, p) => 读取附件(h.session, p),
    '权限.改': (h, p, signal) => 修改权限(ctx, h.session, p, signal),
    /* `requestId` 是 dsh 新要的：客户端铸一个，落在那条用户消息上。
       说给哪个节点就送到哪个节点，交回了的也一样（选 24：所有节点都可以对话）；
       是回一句还是重新开工，由这一轮第一步的选择机定，这里不另开接续节点。 */
    'session.prompt': async (h, p, signal) => {
      const value = await h.session.prompt({
        requestId: randomUUID(), sessionId: p.sessionId,
        mode: p.mode === 'queue' ? 'queue' : 'steer', content: p.content,
        ...(p.clientTimeZone ? { clientTimeZone: p.clientTimeZone } : {}),
      }, signal)
      return { ...value, targetSessionId: p.sessionId }
    },
    'session.cancel': (h, p) => {
      if (p.waitForNotes === true) {
        return 停下等回条(ctx, p.sessionId).then(value => {
          if (value.stopped) 停止会话后台(ctx, p.sessionId)
          return value
        })
      }
      停用会话持续目标(ctx, p.sessionId)
      const value = h.session.cancel({ sessionId: p.sessionId })
      停止会话后台(ctx, p.sessionId)
      return value
    },
    /* **改模型只有这一条**：写模型表（`archive` 的「模型表」）。`全局` 为真 ＝ 改全局，`sessionId` 只用来认项目。
       不走 dsh 的 `session.selectModel` —— 那一条还会顺手改 settings.yaml 和 dsh 自己内存里那一份。 */
    '模型.改': (h, p) => 改模型(ctx, String(p.sessionId || ''),
      { provider: p.provider, model: p.model, ...(p.reasoningEffort ? { reasoningEffort: p.reasoningEffort } : {}) }, !!p['全局']),
    'session.fork': (h, p) => h.session.fork(p),
    /* 主机级的模型名单(不占会话)—— 新项目那张表开着的时候还没有会话,
       session.models 问不了,这一条问得了。回的是 buildModelCatalog 那份 {groups, failures, default}。 */
    'llm.models': () => connections.modelCatalog(),
    /* 走树用的最便宜那条：`SessionSummary` 带 `parentSessionId` / `origin` / `running`，
       **零日志加载**。「停」／「全停」每扫一遍都要一份新鲜的表（这几百毫秒里节点
       的死活会变），拿 `api/history` 去换太贵——那一条要把血脉上每个会话的事件全读一遍。 */
    'session.list': async (h, p, signal) => {
      const value = await h.session.list({}, signal)
      if (!Object.hasOwn(p, 'projectSessionId')) return value
      const items = 项目操作会话(value.items || [], p.projectSessionId)
      return { ...value, projectSessionId: String(p.projectSessionId), items,
        canCloseAgentTerminals: 可关闭节点终端(ctx),
        external: await 项目外部目录(ctx, items, p.projectSessionId, signal) }
    },
    /* 停一个子节点**只有这一条路**。`session.cancel` 明写了拒绝 subagent 拥有的
       会话（`参考/dsh/packages/api/session-controller/src/agent.ts` 的 hasApiSessionSubagentOwner）——
       没有它，界面上的「停」就只够得着 Blueprint，子节点跑完照样把上级叫醒。 */
    'subagent.interrupt': (h, p) => {
      const value = 要子节点(h).interruptByParent(
        String(p.childSessionId || ''), String(p.parentSessionId || ''), 'continuable')
      停止会话后台(ctx, p.childSessionId)
      return value
    },
    /* 跟一个子节点说话**也只有这一条路** —— `session.prompt` 对子节点一律回
       agent-busy「owned by subagent routing」，而且那个判定是无条件的
       （同上那个文件：`if (session.header.origin === 'subagent') return true`）。
       它的 signal **不是可选的** —— 见下面 rpc() 里那个 ac。 */
    'subagent.prompt': (h, p, signal) => 要子节点(h).prompt({
      requestId: randomUUID(), parentSessionId: p.parentSessionId, childSessionId: p.childSessionId,
      mode: 'continuable', delivery: p.delivery === 'steer' ? 'steer' : 'queue', content: p.content,
      ...(p.clientTimeZone ? { clientTimeZone: p.clientTimeZone } : {}),
    }, signal),
  }

  async function rpc(req, res) {
    let body = ''
    for await (const chunk of req) body += chunk
    let want
    try { want = JSON.parse(body || '{}') } catch (e) { return json(res, 400, { ok: false, message: `请求体不是 JSON：${String(e && e.message)}` }) }

    if (want.method === 'attention.seen') {
      try {
        const value = 标记提醒已读(want.payload?.sessionId, want.payload?.rpcIds,
          { pending, 持久问题, 写问答, send })
        return json(res, 200, { ok: true, value })
      } catch (e) { return json(res, 200, { ok: false, message: String(e.message || e) }) }
    }

    /* 「答一句问话」不是一条普通调用:它**回**的是问话那一条的 rpcId。
       所以它不走下面那张白名单表,单独一支。等着答的人在 `答复口` 里（见下面「要你点头」那节）。 */
    if (want.method === 'respond') {
      const rpcId = String(want.rpcId ?? '')
      if (!rpcId) return json(res, 400, { ok: false, message: '没说在答哪一条' })
      const 口 = 答复口.get(rpcId)
      /* 不在 ＝ 晚了（超时、被取消，或 dsh 那张脸先答了）。不是"成功" —— 如实说,
         不然你点了没反应还以为点上了。 */
      if (!口 && 持久问题.has(rpcId)) {
        try {
          const record = 持久问题.get(rpcId)
          if (want.cancel) {
            if (record.answer) throw new Error('回答已保存，等待送达，不能撤回')
            关闭问题(record, 'cancelled')
          } else {
            const answer = 验人工回答(want.value?.answer, record.frame.questions)
            if (record.answer && JSON.stringify(record.answer) !== JSON.stringify(answer)) throw new Error('已有待送达的回答，请重试原回答')
            record.answer = answer
            写问答(record.root, record)
            await 送恢复回答(record)
          }
          return json(res, 200, { ok: true, value: { accepted: true } })
        } catch (e) { return json(res, 200, { ok: false, message: String(e.message || e) }) }
      }
      if (!口) return json(res, 200, { ok: false, code: 'not-pending', message: '这条问题已经处理过了' })
      /* `cancel:true` ＝ **不答,把这一问撤掉**。撤掉之后 `ask_user_question` 这次工具调用
         以一条错误收场,**那一轮接着往下跑** —— 于是排在它后面的那句话马上被读到。
         这就是「问卷挡住了输入框」的解法:不是绕过问话,是撤掉它。
         **批准(approval)没有这条路**:只给得出「准/不准」。替用户点头是替他做决定,不做。 */
      if (want.cancel) {
        if (口.kind === 'approval') return json(res, 200, { ok: false, message: '批准只收「准／不准」，撤不了' })
        await 口.撤()
        return json(res, 200, { ok: true, value: { accepted: true } })
      }
      const v = want.value || {}
      if (口.kind === 'approval') {
        if (v.outcome !== 'allowed-once' && v.outcome !== 'rejected') {
          return json(res, 200, { ok: false, code: 'bad-response', message: `答复形状不对：批准只收 allowed-once／rejected，收到 ${String(v.outcome)}` })
        }
        await 口.答(v.outcome)
      } else {
        const answers = v.answer && Array.isArray(v.answer.answers) ? v.answer.answers : null
        if (!answers) return json(res, 200, { ok: false, code: 'bad-response', message: '答复形状不对：缺 answer.answers' })
        try { await 口.答(验人工回答({ answers }, pending.get(rpcId)?.questions || [])) }
        catch (e) { return json(res, 200, { ok: false, code: 'bad-response', message: String(e.message || e) }) }
      }
      return json(res, 200, { ok: true, value: { accepted: true } })
    }

    const h = { session: ctx.get('sessionController'), subagents: ctx.get('subagents') }
    if (!h.session) return json(res, 200, { ok: false, message: '这个部署没有挂 sessionController —— 这张脸能做的动作全来自它，没有它一件都做不了' })

    const call = RPC[want.method]
    if (!call) return json(res, 404, { ok: false, message: `没有这条:${want.method}（白名单里只有 ${Object.keys(RPC).join(' ')} respond）` })

    /* **对一条冷会话说话之前，先由我们把它捞醒。** `捞醒()` 走 `seats` 那条重建，
       它按分工手册上记的模型把人捞回来；dsh 自己那条退到部署默认值。
       捞不动就原样交给 dsh。**只捞不递话** —— 话仍旧由下面这条 RPC 送。 */
    const 载 = want.payload || {}
    if (Object.hasOwn(载, 'projectSessionId') &&
        ['session.cancel', 'session.prompt', 'subagent.interrupt', 'subagent.prompt'].includes(want.method)) {
      try {
        const value = await h.session.list({}, new AbortController().signal)
        检查项目操作(value.items || [], want.method, 载)
      } catch (e) {
        return json(res, 200, { ok: false, code: 'project-scope-invalid', message: String(e.message || e) })
      }
    }
    let 要说话的 = want.method === 'session.prompt' ? String(载.sessionId || '')
      : want.method === 'subagent.prompt' ? String(载.childSessionId || '')
        : ''
    if (要说话的 && 载.resumeOnly) {
      const records = [...持久问题.values()].filter(r => r.frame.session === 要说话的)
      if (records.length) {
        try {
          for (const record of records) {
            if (record.answer) await 送恢复回答(record)
            else send({ ...record.frame, 补发: true })
          }
          return json(res, 200, { ok: true, value: { waitingForAnswer: true } })
        } catch (e) { return json(res, 200, { ok: false, message: String(e.message || e) }) }
      }
      try {
        const identity = await 我是谁(ctx, 要说话的)
        if (identity) {
          const root = ctx.sessions.get(要说话的)?.header?.cwd || await 会话目录(ctx.get('sessionQuery'), 要说话的)
          const ready = await 准备节点续工(ctx, root, identity.号)
          // 能不能接着做只由 `准备节点续工` 判一处（孩子没交齐不挡、上一轮被切断的等回条不挡）。
          if (!ready.resumable) return json(res, 200, { ok: true, value: ready })
          if (ready.session && ready.session !== 要说话的) {
            要说话的 = ready.session
            if (want.method === 'session.prompt') 载.sessionId = ready.session
            else 载.childSessionId = ready.session
          }
        }
      } catch (e) { return json(res, 200, { ok: false, message: String(e.message || e) }) }
    }
    if (要说话的) {
      try { await 捞醒(ctx, 要说话的) } catch (e) {
        console.log(`Blueprint studio: ⚠️ ${要说话的} 发话前捞它炸了 —— ${(e && e.message) || e}。这句话照发，但他可能戴着别人的壳。`)
      }
    }
    let value
    /* 每条调用配一个 signal:dsh 的 Remote 方法也是这么收的(它传的是自己那条请求的 signal)。
       多数路由压根不看它;`subagent.prompt` 的签名里它**不是可选的**。
       页面中途断了就撤掉这条 —— 一个没人等的 followup 还往孩子的 inbox 里塞,
       等于替一个已经走掉的人说了句话。 */
    const ac = new AbortController()
    res.on('close', () => { if (!res.writableEnded) ac.abort() })
    try {
      value = await call(h, 载, ac.signal)
    } catch (e) {
      /* `RemoteError` 带 `code`（`subagent/parent-unavailable` 这种）。页面那张「递不进去」表
         是 apiProxy 时代的横杠写法（`subagent-parent-unavailable`）—— 在这儿换成横杠，页面不动。 */
      const code = e && e.code ? String(e.code).replace(/\//g, '-') : undefined
      return json(res, 200, { ok: false, ...(code ? { code } : {}),
        message: `${code || `${want.method} 炸了`}：${String((e && e.message) || e)}` })
    }
    json(res, 200, { ok: true, value })
  }

  /* ---------------------------------------------- 建项目
     **一个项目 ＝ 一个文件夹 ＋ 坐在它里面的 Blueprint。**

     项目名不另存一本:它**就是文件夹名**,而文件夹就是这个会话的 cwd ——
     dsh 的 SessionHeader 本来就记 cwd,所以项目名跟着账本走,
     我们**一个字段、一张表、一个 id 都不发明**（协议第二节:项目边界 ＝ 血统树,
     别建项目表、别发项目 id）。

     顺序钉死:**先有文件夹,再有会话**。反过来的话,建完会话文件夹没建成,
     用户手上就是一个没处放东西的空对话 —— 用户 2026-08-19 明说不要这个。
     所以会话没开成,刚建的空文件夹当场删掉,不留半拉子。 */
  /* 项目放哪儿：出处在 `node`（建项目、列项目、`/blueprint` 命令都问那一处）。 */
  let PROJ_ROOT = 项目夹
  const manageProjectStorage = 项目存储HTTP(json, 项目存储)
  const manageHomeIntro = 首页动画HTTP(json, 创建首页动画记录(数据根))
  ctx.effect(() => 项目存储.subscribe(value => { PROJ_ROOT = value.defaultRoot; send({ type: 'blueprint.storage_changed', value }) }))
  /* **建项目开出来的那一个**座位。2026-09-05 起 blueprint 只有 Blueprint 一个 ——
     派出去的一律 plan（判据在 `archive` 的 `默认座位()`），所以这一行就是"Blueprint 是谁"。
     写在这儿不写在前端: 前端不该知道座位名 —— 那是组织的事,不是界面的事。 */
  /* 名字的红线:它同时要当路径用、当项目名给人看。
     路径分隔与保留字符会跑出目录,点开头是隐藏文件,空名字是无名项目。 */
  const BAD_NAME = /[/\\:*?"<>|\u0000-\u001f]/

  /* 座位没开成就把刚建的空文件夹撤掉，不留半拉子。
     **只删我们自己刚建的那两层，而且只在它们是空的时候** —— rmdir 遇到非空会拒绝，
     这正是我们要的：里面万一已经有东西了，宁可留着让人看见，也不许递归删。 */
  async function 回滚(dir) {
    await rmdir(join(dir, 文档夹名)).catch(() => {})
    await rmdir(dir).catch(() => {})
  }

  /* ---------------------------------------------- 文件浏览器
     项目根仍从会话的 cwd 认定。每次只列一个目录的直属条目；展开哪一层才读哪一层。
     不递归、不按整个项目的文件总数截断，.git／node_modules 也可以按需展开。
     相对位置和符号链接的边界由 `列目录()` 校验，读取失败不能装作空目录。 */

  /* ---------------------------------------------- 有哪几个根
     **根钉在这儿,不从外面进来。** 客户端只能报「哪个根 ＋ 里面哪一格」,
     两样都不是路径 —— 越界在参数层就表达不出来。

     加第三个根(以后的模板库、素材库…) ＝ 这张表里加一行,别处一个字不改。 */
  const PROMPT = 文字路径
  const SHELLS = resolve(PROMPT, 'shells')
  const TOOLS = resolve(PROMPT, '工具')
  /* prompt 包的 `skill/`：一个 skill 一个文件夹，正文是里面那份 SKILL.md（座位卡上 skill-filesystem 的 customSkillDirs 指的就是这儿）。 */
  const SKILLS = resolve(PROMPT, 'skill')
  const 根表 = {
    项目:   { 名: '项目', 要会话: true,  可写: false },
    /* prompt／tool 两个根都在 git 里，旧版翻 git，不再生 `旧/`（09-17 用户定：干净）。 */
    prompt: { 名: 'prompt', 要会话: false, 可写: true, 留旧: false, dir: SHELLS,
              只收: /\.md$/i,
              提示: '模型共用的核心、节点各自的一段、节点前缀和叫醒话。每次调模型现读，改完下一步就生效。' },
    /* 工具的说明书 —— 一把工具一份 md（2026-08-31 用户裁定从 JS 字符串里搬出来:
       「为什么我的 prompt 文件夹中看不见?」模型读到的字有三成他打不开）。
       **跟 prompt 根不重叠**:那边是座位的正文,这边是工具的说明书。 */
    /* 抽屉上没有它自己的按钮：skill 那一列底下列着这几份，点开走这个根。 */
    tool:   { 名: 'tool', 要会话: false, 可写: true, 留旧: false, dir: TOOLS,
              只收: /\.md$/i,
              提示: '这把工具的说明书。改完要重起 dsh 才生效 —— 说明书是起服务那一刻读的。' },
    /* 抽屉上它是一列开关（`/api/skills`）；点名字读／改那一份 SKILL.md。 */
    skill:  { 名: 'skill', 要会话: false, 可写: true, 留旧: false, dir: SKILLS,
              只收: /\.md$/i,
              提示: 'skill 的正文。模型用到它的那一刻现读，改完下一次就是新的；开头的 name、description 改了，模型的目录下一步就换。' },
  }

  /** 一个根落在磁盘哪儿。**这是唯一把「根」变成路径的地方。** */
  async function 认根(根名, want) {
    const 根 = 根表[String(根名 || '项目')]
    if (!根) return { 错: `没有「${根名}」这个根` }
    if (!根.要会话) return { dir: 根.dir, 卡: 根 }
    const g = await 项目文件夹(want)
    return g.错 ? g : { dir: g.dir, 卡: 根 }
  }

  /* 这个会话的项目文件夹在哪。**路径不从外面进来** —— 会话 id 进来,cwd 我们自己
     从账本里读,再硬比一次它坐在项目根底下。列文件夹与读文件共用这一处判断。 */
  async function 项目文件夹(want) {
    const id = String(want ?? '').trim()
    if (!id) return { 错: '没说看哪个项目' }
    let cwd = ''
    try {
      /* 走会话名单（跟 `history` 同一份：刚出生还没落盘的也在，一秒半内不重扫全机器的账本） */
      cwd = String((await listSessions()).find((r) => r.id === id)?.cwd || '')
    } catch (e) {
      return { 错: `读不到这个会话的工作目录：${String((e && e.message) || e)}` }
    }
    if (!cwd) return { 错: '这个会话没有工作目录 —— 它不是我们建的项目', 不是项目: true }
    const dir = resolve(cwd)
    if (!项目父目录(dir)) {
      return { 错: `这个会话的工作目录不在项目根底下（${dir}）—— 它不是一个项目`, 不是项目: true }
    }
    let st
    try { st = await stat(dir) } catch { return { 错: `这个项目的文件夹不在了：${dir}` } }
    if (!st.isDirectory()) return { 错: `${dir} 不是一个文件夹` }
    return { dir }
  }

  /* ---------------------------------------------- 读一个文件(只读)
     `位置` 是**项目文件夹里的一格**,不是路径:相对、不许以 / 开头、不许有 `..`。
     越界在参数层就表达不出来,不是被拦下来的 —— 拦是运行时的事,表达不出来是形状的事。

     **只读不改。** 界面上改文件只走 `writeOneFile()`(只收 `可写` 的根,覆盖前自动备份到 `旧/`)。 */
  const 文件上限 = 400_000

  /** 把「根 ＋ 一格」变成一个绝对路径,顺便把所有越界写法挡在这儿。 */
  async function 落到(根名, want, 位置) {
    const 位 = String(位置 ?? '').trim()
    if (!位) return { 错: '没说哪个文件' }
    if (位.startsWith('/') || 位.split('/').includes('..')) {
      return { 错: `「${位}」不是这个文件夹里的一格` }
    }
    const g = await 认根(根名, want)
    if (g.错) return g
    const 全 = resolve(join(g.dir, 位))
    /* 拼完再比一次 —— 符号链接、多余的 ./ 都在这一步现形 */
    if (!全.startsWith(g.dir + '/')) return { 错: `「${位}」指到这个文件夹外面去了` }
    if (g.卡.只收 && !g.卡.只收.test(位)) return { 错: `「${位}」不是这个根收的那种文件` }
    return { 位, 全, 根: g.dir, 卡: g.卡 }
  }

  async function readOneFile(res, 根名, want, 位置) {
    if (根名 === 'skill' && /^office-(docx|pptx|xlsx)\/SKILL\.md$/.test(String(位置))
      && !existsSync(join(SKILLS, String(位置)))) {
      try {
        const 文 = await ctx.get('blueprintExecutionFeatures').officeContent(String(位置).split('/')[0])
        return json(res, 200, { ok: true, 位置, 名: 'SKILL.md', 字节: Buffer.byteLength(文), 截了: false,
          可写: false, 提示: 'DSH 官方 Office 技能；可创建同名个人技能覆盖。', 文 })
      } catch (error) { return json(res, 200, { ok: false, message: error.message }) }
    }
    const L = await 落到(根名, want, 位置)
    if (L.错) return json(res, 200, { ok: false, message: L.错 })
    const 位 = L.位
    let 全
    try { 全 = await 安全产物文件(L.根, 位) }
    catch { return json(res, 200, {ok:false, message:'文件不存在或位于当前目录外'}) }
    let st
    try { st = await stat(全) } catch { return json(res, 200, { ok: false, message: `没有这个文件：${位}` }) }
    if (st.isDirectory()) return json(res, 200, { ok: false, message: `${位} 是个文件夹,不是文件` })

    let buf
    try {
      const handle = await open(全, 'r')
      try {
        const buffer = Buffer.alloc(Math.min(st.size, 文件上限))
        const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0)
        buf = buffer.subarray(0, bytesRead)
      } finally { await handle.close() }
    } catch (e) {
      return json(res, 200, { ok: false, message: `读不了：${String((e && e.message) || e)}` })
    }
    /* 二进制不硬当文字读 —— 读出来是一屏乱码,那比说一句实话更不像实话 */
    if (buf.subarray(0, 8192).includes(0)) {
      return json(res, 200, { ok: false, message: `${位} 是个二进制文件,这儿只读得了文字` })
    }
    const 截了 = st.size > 文件上限
    json(res, 200, {
      ok: true, 位置: 位, 名: 位.split('/').pop(), 字节: st.size, 截了,
      可写: !!L.卡.可写 && !截了,          /* 截了就不许写 —— 存回去会把后半截抹掉 */
      提示: L.卡.提示 || '',
      文: buf.subarray(0, 文件上限).toString('utf8'),
    })
  }

  /* ---------------------------------------------- 摆一格出来给人看（只读）
     `preview` 那把工具摆的那扇窗，窗里加载的就是这条路。

     **跟 /api/file 不是一回事，两条都得在**：那一条把文件当**字**吐回去（JSON，
     给阅读页排版用）；这一条把文件当**字节**吐回去，带真的 content-type ——
     浏览器要靠它才知道这是网页不是文本。

     **路径式，不是 query 式**，这一点是硬要求：`/studio/preview/<会话>/<一格>`。
     （路由名这一段是英文：`url.pathname` 拿到的是**编码过的**串，中文路由名在这儿
     是 `/%E9%A2%84%E8%A7%88/`，`startsWith('/预览/')` 永远不成立 —— 踩过。
     位置那几段仍是中文，它们本来就要解码，不受影响。）
     html 里的 `<script src="游戏.js">` 是相对自己那一格算的，query 式的地址
     （`?位置=…`）会让它去 `/studio/游戏.js` 找，整套前端当场散架。

     越界仍然表达不出来：会话 id 进来，文件夹我们自己从账本里读（`落到()` 那一处），
     `..` 和绝对写法在参数层就不合法。

     **不许缓存**（no-store）：模型改一版摆一次，浏览器拿旧的就等于骗人。
     唯一例外是成果卡：地址带着原件修改时间 `t`，对得上才缓存，原件一改地址就变（见 `发送预览文件`）。 */
  /** `/preview/<会话>/<一格>` 里那一串，拆成会话与位置。两边都是 URL 编码过的。 */
  function 拆预览(rest) {
    const 段 = String(rest || '').split('/').filter((x) => x !== '')
    if (段.length < 2) return { 错: '预览地址要写成 preview/<会话>/<一格>' }
    let 解 = []
    try { 解 = 段.map((x) => decodeURIComponent(x)) } catch { return { 错: '预览地址编码坏了' } }
    return { session: 解[0], 位置: 解.slice(1).join('/') }
  }

  // 正文链接与成果卡片共用入口检查和打开策略。
  async function artifactEntry(res, session, path, source = {}) {
    const g = await 项目文件夹(session)
    if (g.错) return json(res, 404, {ok:false, message:g.错})
    if ((source.seq !== null && source.seq !== undefined) || source.callId) {
      try {
        const { refs, events } = await 会话产物引用({ id: session }, g.dir, true)
        path = 定位产物引用(g.dir, refs, path, source, events)
      } catch { return json(res, 404, {ok:false, message:'这条记录的文件入口暂不可用'}) }
    }
    const file = 产物路径(g.dir, path, {any:true, includeTemporary:true, includeEvidence:true})
    if (!file) return json(res, 400, {ok:false, message:'请选择项目内文件或目录'})
    try {
      const artifact = await 检查产物(g.dir, {entry:file.path}, {includeTemporary:true, includeEvidence:true})
      return json(res, 200, {ok:true, item:{...artifact, kind:file.kind, session, available:true}})
    } catch { return json(res, 404, {ok:false, message:'文件不存在、不可读取或位于项目外'}) }
  }

  async function openArtifact(req, res, action) {
    if (!允许本机打开(req.headers))
      return json(res, 403, {ok:false, message:'只允许本机 Blueprint 页面打开文件'})
    let body = '', input
    for await (const chunk of req) {
      body += chunk
      if (body.length > 16384) return json(res, 413, {ok:false, message:'请求过长'})
    }
    try { input = JSON.parse(body) } catch { return json(res, 400, {ok:false, message:'请求格式有误'}) }
    if (!input || typeof input.path !== 'string')
      return json(res, 400, {ok:false, message:'请选择项目内文件或目录'})
    const L = await 落到('项目', input.session, input.path)
    if (L.错) return json(res, 404, {ok:false, message:L.错})
    try {
      await 打开本地产物(L.根, L.位, action)
      return json(res, 200, {ok:true})
    } catch (e) { return json(res, 400, {ok:false, message:process.platform !== 'darwin' ? e.message : '无法打开：文件不存在、位于项目外，或系统没有可用的应用。可尝试定位文件。'}) }
  }

  async function servePreview(req, res, rest) {
    const 拆 = 拆预览(rest)
    if (拆.错) return 纯文(res, 400, 拆.错)
    const L = await 落到('项目', 拆.session, 拆.位置)
    if (L.错) return 纯文(res, 404, L.错)

    try { L.全 = await 安全产物文件(L.根, L.位, {preview:true}) } catch { return 纯文(res, 404, '文件不存在或位于项目外') }
    let st
    try { st = await stat(L.全) } catch { return 纯文(res, 404, `没有这个文件：${L.位}`) }
    /* 文件夹不猜 index.html —— 猜错了用户看见的是一片空白，而没有人告诉他为什么。 */
    if (st.isDirectory()) return 纯文(res, 404, `${L.位} 是个文件夹 —— 摆窗要指名到具体那一份`)

    try { await 发送预览文件(req, res, L.全, {thumbnailDir:join(任务廊预览缓存, '图片缩略')}) }
    catch (error) {
      if (!res.headersSent) return 纯文(res, 500, '暂时无法读取此文件，请重新打开')
      res.destroy(error)
    }
  }

  const 纯文 = (res, code, 话) => {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(话)
  }

  /* ---------------------------------------------- 写一个文件
     **只有 `可写` 的根收得下**(现在只有 prompt)。覆盖前旧的自动进 `旧/` 带时间戳 ——
     这一步是本文件的 `盖掉()`。

     **不许新建。** 这儿是"改现有的那几份",不是"往里塞文件" —— 塞进去也没人读它
     (谁读哪几份写在座位卡上),那种文件只会让人以为它在起作用。 */
  async function writeOneFile(req, res) {
    let body = ''
    try {
      for await (const chunk of req) {
        body += chunk
        if (body.length > 2_000_000) return json(res, 200, { ok: false, message: '太大了' })
      }
    } catch (e) { return json(res, 200, { ok: false, message: `没收全：${String((e && e.message) || e)}` }) }

    let p
    try { p = JSON.parse(body || '{}') } catch { return json(res, 200, { ok: false, message: '请求不是 JSON' }) }
    if (typeof p.文 !== 'string') return json(res, 200, { ok: false, message: '没给正文' })

    const L = await 落到(p.根, p.session, p.位置)
    if (L.错) return json(res, 200, { ok: false, message: L.错 })
    if (!L.卡.可写) return json(res, 200, { ok: false, message: `「${L.卡.名}」这个根不许在界面上改` })

    let st
    try { st = await stat(L.全) } catch {
      return json(res, 200, { ok: false, message: `没有 ${L.位} —— 这儿只改现有的那几份,不新建` })
    }
    if (!st.isFile()) return json(res, 200, { ok: false, message: `${L.位} 不是文件` })

    try {
      await 盖掉(L.根, L.全, L.位, p.文, { 留旧: L.卡.留旧 !== false })
    } catch (e) {
      return json(res, 200, { ok: false, message: String((e && e.message) || e) })
    }
    清柜缓存()   /* 改的可能就是柜子里那一份 —— 树上下一眼就该是新的 */
    json(res, 200, { ok: true, 位置: L.位, 字节: Buffer.byteLength(p.文), 提示: L.卡.提示 || '' })
  }

  async function listFiles(res, 根名, want, 位置) {
    const g = await 认根(根名, want)
    if (g.错) return json(res, 200, { ok: false, message: g.错 })
    try {
      const d = await 列目录(g.dir, 位置)
      json(res, 200, { ok: true, 根: g.dir, 名: basename(g.dir),
                       提示: g.卡.提示 || '', ...d })
    } catch (e) {
      json(res, 200, { ok: false, message: `读不了这个文件夹：${String(e.message || e)}` })
    }
  }

  /* ---------------------------------------------- skill 开关
     带 session 时查看或调整当前项目的 `系统文档/技能.json`；不带时查看或调整全局默认开关。
     全局开关仍写在 SKILL.md 的 `disable-model-invocation`，项目选择不改共享正文；下一步生效。 */

  /** SKILL.md 开头 `---` 之间那几行 → {键: 值}。 */
  const 读头 = (文) => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(文))
    const 头 = {}
    for (const 行 of (m ? m[1] : '').split(/\r?\n/)) {
      const k = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(行)
      if (k) 头[k[1]] = k[2].replace(/^["']|["']$/g, '').trim()
    }
    return 头
  }
  const 关着 = (头) => /^(true|yes|on|1)$/i.test(String(头['disable-model-invocation'] || ''))

  /** `prompt/skill/` 下每个带 SKILL.md 的文件夹：{夹, 文, 头}。 */
  async function 扫skill() {
    let 夹们 = []
    try { 夹们 = (await readdir(SKILLS, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name) } catch { /* 没有也行 */ }
    const 出 = []
    for (const 夹 of 夹们.sort((a, b) => a.localeCompare(b, 'en'))) {
      if (节点本体技能名.includes(夹) || 退役技能名.includes(夹)) continue
      let 文
      try { 文 = await readFile(join(SKILLS, 夹, 'SKILL.md'), 'utf8') } catch { continue }
      const 头 = 读头(文)
      if (节点本体技能名.includes(头.name) || 退役技能名.includes(头.name)) continue
      出.push({ 夹, 文, 头 })
    }
    const features = ctx.get('blueprintExecutionFeatures')
    if (features) {
      const defaults = await features.officeDefaults()
      for (const candidate of await features.officeCatalog()) {
        if (出.some(row => (row.头.name || row.夹) === candidate.name)) continue
        出.push({ 夹: candidate.name, 文: '', 官方: true,
          头: { name: candidate.name, description: candidate.description, 'disable-model-invocation': defaults[candidate.name] === false ? 'true' : 'false' } })
      }
    }
    return 出
  }

  async function listSkills(req, res) {
    const session = new URL(req.url, 'http://localhost').searchParams.get('session')
    const project = session ? await 项目文件夹(session) : null
    if (project?.错) return json(res, 200, { ok: false, message: project.错 })
    let selection
    try { selection = project ? await 读技能选择(project.dir) : null }
    catch (error) { return json(res, 200, { ok: false, message: error.message }) }
    const 们 = await 扫skill()
    const 能力 = ctx.get('blueprintCapabilities')
    const 行们 = await Promise.all(们.map(async ({ 夹, 头 }) => ({ 名: 头.name || 夹, 说: 头.description || '', 开: selection === null ? !关着(头) : selection.includes(头.name || 夹), 文件: `${夹}/SKILL.md`, ...(能力 ? { 条件: await 能力.check(头.name || 夹) } : {}) })))
    let md = []
    try { md = (await readdir(TOOLS)).filter((f) => /\.md$/i.test(f)).map((f) => f.slice(0, -3)) } catch { /* 没有也行 */ }
    json(res, 200, {
      ok: true,
      范围: project ? 'project' : 'default',
      ...(project ? { session } : {}),
      行们,
      工具们: md.sort((a, b) => a.localeCompare(b, 'en')),
    })
  }

  // 界面接上 dsh 的语言后报上来：服务端拼给界面的句子、模型的回答语言都跟它走。GET 读当前值。
  async function uiLanguage(req, res) {
    if (req.method !== 'POST') return json(res, 200, { ok: true, 语言: 服务端语言() })
    let body = ''
    for await (const chunk of req) body += chunk
    try { return json(res, 200, { ok: true, 语言: 设界面语言(JSON.parse(body || '{}').语言) }) }
    catch (error) { return json(res, 200, { ok: false, message: error.message || String(error) }) }
  }

  async function switchSkill(req, res) {
    let body = ''
    for await (const chunk of req) body += chunk
    let p
    try { p = JSON.parse(body || '{}') } catch { return json(res, 200, { ok: false, message: '请求不是 JSON' }) }
    const 名 = String(p.名 ?? '').trim()
    const 开 = !!p.开
    const 这个 = (await 扫skill()).find((x) => (x.头.name || x.夹) === 名)
    if (!这个) return json(res, 200, { ok: false, message: `没有「${名}」这份 skill` })
    if (p.session) {
      const project = await 项目文件夹(p.session)
      if (project.错) return json(res, 200, { ok: false, message: project.错 })
      try {
        await 项目排队(project.dir, async () => {
          const selection = await 读技能选择(project.dir) ?? (await 扫skill()).filter(x => !关着(x.头)).map(x => x.头.name || x.夹)
          await 写技能选择(project.dir, 开 ? [...selection, 名] : selection.filter(name => name !== 名))
        })
      } catch (error) { return json(res, 200, { ok: false, message: error.message }) }
      return json(res, 200, { ok: true, 名, 开, 范围: 'project' })
    }
    if (这个.官方) {
      try { await ctx.get('blueprintExecutionFeatures').setOfficeDefault(名, 开) }
      catch (error) { return json(res, 200, { ok: false, message: error.message }) }
      return json(res, 200, { ok: true, 名, 开, 范围: 'default' })
    }
    const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(这个.文)
    if (!m) return json(res, 200, { ok: false, message: `「${名}」的 SKILL.md 开头没有 --- 那几行，拨不了` })
    const 行们 = m[2].split(/\r?\n/).filter((l) => !/^disable-model-invocation:/.test(l))
    if (!开) 行们.push('disable-model-invocation: true')
    const 新 = m[1] + 行们.join('\n') + m[3] + 这个.文.slice(m[0].length)
    try {
      await 盖掉(SKILLS, join(SKILLS, 这个.夹, 'SKILL.md'), `${这个.夹}/SKILL.md`, 新, { 留旧: false })
    } catch (e) {
      return json(res, 200, { ok: false, message: `没写上：${String((e && e.message) || e)}` })
    }
    console.log(`Blueprint studio: skill ${名} ${开 ? '开' : '关'}`)
    json(res, 200, { ok: true, 名, 开 })
  }

  let projSeq = 0
  async function createProject(req, res) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > 项目请求上限) return json(res, 413, { ok: false, message: 'Brief 附件合计不能超过 20 MB' })
      chunks.push(bytes)
    }
    const body = Buffer.concat(chunks).toString('utf8')
    let want
    try { want = JSON.parse(body || '{}') } catch (e) { return json(res, 400, { ok: false, message: `请求体不是 JSON：${String(e && e.message)}` }) }

    const parent = 项目存储.snapshot()
    if (Object.hasOwn(want, '存储版本') && (want.存储版本 !== parent.revision || want.项目位置 !== parent.defaultRoot))
      return json(res, 200, { ok: false, message: '保存位置已更新，请重新确认后创建项目' })
    await 项目存储.initialize()
    const 输入名字 = String(want['名字'] ?? '').trim(), 自动命名 = !输入名字
    const 名字 = 输入名字 || 自动项目目录名()
    if (BAD_NAME.test(名字)) return json(res, 200, { ok: false, message: '名字里不能有 / \\ : * ? " < > | 这些字符 —— 它要当文件夹名用' })
    if (名字.startsWith('.')) return json(res, 200, { ok: false, message: '名字不能用点开头 —— 那是隐藏文件夹' })
    if (名字.length > 60) return json(res, 200, { ok: false, message: `名字太长了（${名字.length} 字），60 字以内` })

    let createRoot
    try { createRoot = await 项目存储.prepareDefault(parent.revision) }
    catch (error) { return json(res, 200, { ok: false, message: error.message,
      ...(error.code ? { code: error.code } : {}), ...(error.path ? { path: error.path } : {}) }) }
    const dir = join(createRoot, 名字)
    /* 同名即拒。不自动加后缀 —— 文件夹名就是项目名,悄悄改名等于把用户的项目换了一个他没说过的名字。 */
    let exists = false
    try { await stat(dir); exists = true } catch { /* 不存在才是常态 */ }
    if (exists) return json(res, 200, { ok: false, message: `已经有一个叫「${名字}」的项目了（${dir}）—— 换个名字，或者去顶栏把它选出来` })

    /* **建项目交给 `node` 的 `建项目()`**（2026-09-24 重建，跟 `/blueprint` 命令同一份实现，协议 2.2）：
       项目文件夹 → 名册 → 0 的工作文档（意图 ＝ 用户的第一句话）→ 模型表 → 开 0、叫醒它。
       第一句话 ＝ 表上的「描述」＋ 你拨的那两挡（Quality、Mode）的原话 —— 那几句是你挑的，也是你说的话
       （前端 `坐标表` 头上那条：「它直接进第一句话里」）。Mode 表达人机协作频率，所有层与接续轮继承同一选择。
       前端按模型能力和品质默认选思考等级，手动选择优先；实际选中的档与模型一起写进模型表。 */
    const 描述 = String(want['描述'] || '').trim()
    if (!描述) return json(res, 200, { ok: false, message: '描述得写 —— 它就是这个项目的第一句话（0 号 blueprint 的意图）' })
    const 坐标 = String(want['坐标行'] || '').trim()
    const 第一句话 = 坐标 ? `${描述}\n\n${坐标.split('｜').join('\n')}` : 描述
    const 模型 = want['模型']
    const 档 = want['档'] ? String(want['档']) : ''
    const 默认 = ctx.agentDefaultModel && ctx.agentDefaultModel.currentSelection()
    const 用 = (模型 && typeof 模型 === 'object' && 模型.provider && 模型.model) ? 模型 : 默认 || {}
    let 技能
    if (Object.hasOwn(want, '技能')) {
      try {
        技能 = 规范技能选择(want.技能)
        const available = new Set((await 扫skill()).map(x => x.头.name || x.夹))
        const unknown = 技能.filter(name => !available.has(name))
        if (unknown.length) throw new Error(`skill 名单已变化，请重新选择：${unknown.join('、')}`)
      } catch (error) { return json(res, 200, { ok: false, message: error.message }) }
    }
    // 表单显式提供的 Agent 选择先验；省略时建项目沿用本机默认，叫醒首节点前落进项目。
    let 子代理设置
    if (Object.hasOwn(want, '子代理')) {
      try { 子代理设置 = 验子代理设置(want['子代理']) } catch (error) { return json(res, 200, { ok: false, message: error.message }) }
    }
    let 根
    try {
      根 = await 建项目(ctx, createRoot, 名字, 第一句话, { provider: 用.provider, model: 用.model, ...(档 ? { reasoningEffort: 档 } : {}) }, 技能, want.附件, { 自动命名, 子代理: 子代理设置 })
    } catch (e) {
      await 回滚(dir)
      const code = e && e.code ? String(e.code) : ''
      return json(res, 200, { ok: false, ...(code ? { code } : {}),
        message: `${code ? code + '：' : '建不出来：'}${String((e && e.message) || e)}` })
    }
    /* 0 的会话号从名册上读 —— 界面要跳过去；spark 模式先跳到陪用户聊的那个 spark（十 56） */
    let sessionId = ''
    try {
      const 行们 = await 名册(join(根, 文档夹名))
      const spark = 行们.filter((r) => r.类型 === 'spark' && r.会话).at(-1)
      sessionId = String((spark || 行们.find((r) => r.id === Blueprint号) || {}).会话 || '')
    } catch { /* 读不到就不跳 */ }
    json(res, 200, { ok: true, value: { sessionId, cwd: 根, 名字: 项目显示名(await 读项目名称(根), 名字) } })
  }

  /* 一件新工作：总 seat 上的新分身，和已有的工作并行（`node` 的 `开工作()`）。
     会话号认项目；名字进文件名，描述是这件工作的第一句话。 */
  async function createAvatar(req, res) {
    let want
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      want = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch (error) { return json(res, 400, { ok: false, message: '创建请求不是有效 JSON' }) }
    let root = ''
    try { root = String(ctx.sessions.get(String(want.session))?.header?.cwd || await 会话目录(ctx.get('sessionQuery'), String(want.session)) || '') } catch {}
    if (!root) return json(res, 200, { ok: false, message: '认不出是哪个项目' })
    try {
      // 新建阶段（十 58）：launch 是这一阶段的模式。spark 开一个空白 spark；build、solo 记在 helm 上、话交给座位上的 helm（toHelm）。
      const mode = ['spark', 'build', 'solo'].includes(want.launch) ? want.launch : undefined
      const value = await 准备新阶段(ctx, root, { requestId: want.requestId, mode })
      json(res, 200, { ok: true, value })
    } catch (error) { json(res, 200, { ok: false, message: error.message || String(error) }) }
  }

  async function createWork(req, res) {
    let want
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      want = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch (e) { return json(res, 400, { ok: false, message: `请求体不是 JSON：${String(e && e.message)}` }) }
    const 名字 = String(want['名字'] ?? '').trim(), 描述 = String(want['描述'] ?? '').trim()
    if (!名字 || BAD_NAME.test(名字) || 名字.startsWith('.') || 名字.length > 60) return json(res, 200, { ok: false, message: '这件工作得有个名字（60 字以内，不含 / \\ : * ? " < > |）' })
    if (!描述) return json(res, 200, { ok: false, message: '写一句这件工作要做什么' })
    let 根 = ''
    try { 根 = String(ctx.sessions.get(String(want.session))?.header?.cwd || await 会话目录(ctx.get('sessionQuery'), String(want.session)) || '') } catch { /* 认不出项目 */ }
    if (!根) return json(res, 200, { ok: false, message: '认不出是哪个项目' })
    try {
      const sessionId = await 开工作(ctx, 根, 名字, 描述)
      json(res, 200, { ok: true, value: { sessionId, cwd: 根, 名字 } })
    } catch (e) { json(res, 200, { ok: false, message: String((e && e.message) || e) }) }
  }

  // ------------------------------------------------ 要你点头的那两件事
  //
  // 「这个我删了？」(approval) 与 「你选哪个？」(question) —— 这两样**不是会话事件**,
  // 它们是 dsh 的两条接力链(cordis waterfall):`approval/request` 与 `user-questions/request`。
  // 链上每一环要么自己给出答案,要么 `next()` 交给下一环。dsh 自带那张脸是链上的一环
  // (`参考/dsh/packages/api/remotes/src/index.ts` 的 forwardWaterfall)。
  // (apiProxy 时代走的是 mux 流 —— dsh 0.1.5 把 apiProxy 整个删了,流也没了。)
  //
  // **我们这一环排在它前面(prepend),而且同时 `next()` 把问话交下去 —— 谁先答算谁的。**
  // 排前面:它那一环在没有浏览器连着时会一直等,排在它后面我们就永远收不到。
  // 同时交下去:dsh 那张脸开着时也能答 —— 两边并存,不抢谁的位置。
  //
  // 这张脸可能比问话晚开,所以留一份 pending,供 /api/history 和重连补发一并带出。
  const 持久问题 = new Map()
  function 恢复目录问答() {
    for (const base of 项目位置们()) {
      let records
      try { records = 扫问答(base) }
      catch (error) {
        if (!['EPERM', 'EACCES'].includes(error.code)) throw error
        ctx.logger?.warn(`项目位置暂时无法读取：${base}（${error.code}），未恢复该位置的待回答记录`)
        continue
      }
      for (const record of records) {
        if (持久问题.has(record.frame.rpcId)) continue
        持久问题.set(record.frame.rpcId, record)
        pending.set(record.frame.rpcId, record.frame)
        send(record.frame)
      }
    }
  }
  恢复目录问答()
  ctx.effect(() => 项目存储.subscribe(恢复目录问答))
  for (const base of 项目位置们()) {
    let dirs = []
    try { dirs = readdirSync(base, { withFileTypes: true }) } catch { continue }
    for (const d of dirs) if (d.isDirectory()) 对回话账(join(base, d.name))
  }
  function 关闭问题(record, outcome) {
    写问答(record.root, record, true)
    持久问题.delete(record.frame.rpcId)
    pending.delete(record.frame.rpcId)
    send({ type: 'blueprint.ask_done', kind: 'question', session: record.frame.session, rpcId: record.frame.rpcId, outcome,
      ...(outcome === 'answered' ? { answer: record.answer } : {}) })
  }
  const 送恢复回答 = 创建恢复送答({
    beforeDeliver: record => 记定稿审核回答(record.root, record.frame.session, record.frame.questions, record.answer, ctx),
    resume: session => 捞醒(ctx, session),
    prompt: request => ctx.get('sessionController').prompt(request, new AbortController().signal),
    close: record => 关闭问题(record, 'answered'),
  })
  const 答复口 = new Map()     /* rpcId → { kind, 答(值), 撤() } —— rpc() 里 respond 那一支来这儿找人 */

  /* 撤掉一问 ＝ 让 ask_user_question 这次调用以一条错误收场,那一轮接着跑。
     形状照 dsh 的 UserQuestionError(`restoreUserQuestionError` 认 name/message/code 三格)。 */

  const 接一条链 = (event, kind) => 接问答链(ctx, event, kind, { 自动回答, 自动批准, 我是谁, 写问答, 持久问题, pending, 答复口, send, 送恢复回答,
    记用户回答: (record, answer) => 记定稿审核回答(record.root, record.frame.session, record.frame.questions, answer, ctx) })
  接一条链('approval/request', 'approval')
  接一条链('user-questions/request', 'question')
  const approveProjectPending = async root => {
    const result = await 通过项目待审核(root, { pending, 持久问题, 答复口, 写问答, 送恢复回答,
      rootOf: async session => { const found = await 项目文件夹(session); if (found.错) throw new Error(found.错); return found.dir } })
    // 等用户回话的也按现在的表复查（协 7）：改成自己判断、关掉了那一点的当场放行。spark 是陪用户聊的，不代答。
    try { result.approved += await 复查项目等待(ctx, root) || 0 }
    catch (error) { result.warnings.push(error.message || String(error)) }
    return result
  }
  for (const root of new Set([...持久问题.values()].map(record => record.root))) {
    void approveProjectPending(root).catch(error => console.log(`Blueprint studio: 自动审核恢复失败：${error.message}`))
  }

  async function stream(res, sessionId) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    })
    res.write(': studio\n\n')
    clients.add(res)
    res.write(`data: ${JSON.stringify({ type: 'blueprint.hello' })}\n\n`)
    for (const frame of 图纸流.snapshots()) res.write(`data: ${JSON.stringify(frame)}\n\n`)
    /* 刚连上就把还悬着的问话补一遍 —— 这张脸后开的、刷新过的,都不能漏掉
       一件正等着你点头的事(漏掉的后果是那一轮永远卡着,而页面上看不出来)。
       **盖 `补发` 章**:这一批不是"刚刚发生的",那张脸靠它决定响不响铃。
       章由发的人盖 —— 它自己知道,收的人只能掐表猜,而猜会连真的一起吞掉。 */
    for (const frame of [...pending.values(), ...[...回话提醒.values()].map(项 => 项.frame)]) {
      try { res.write(`data: ${JSON.stringify({ ...frame, 补发: true })}\n\n`) } catch { clients.delete(res) }
    }
    /* 顶栏那个数字：刚连上先报一次。不报的话，后开的那张脸要等到下一次有人开跑
       才知道后台有几件在跑 —— 而"开着没人管"的那几件恰恰不会再发帧。 */
    try { res.write(`data: ${JSON.stringify({ type: 'blueprint.在跑变了', 几: 在跑几件() })}\n\n`) } catch { clients.delete(res) }
    const beat = setInterval(() => { try { res.write(': beat\n\n') } catch { /* 断了,下面收 */ } }, 15000)
    const abort = new AbortController()
    const drop = () => { clearInterval(beat); clients.delete(res); abort.abort() }
    res.on('close', drop)
    res.on('error', drop)
    if (!sessionId) return
    const write = frame => res.write(`data: ${JSON.stringify({ ...frame, session: sessionId })}\n\n`)
    const 工作时间 = await 工作计时.读取(ctx.sessions.get(sessionId)?.header?.cwd)
    if (工作时间) write({ type: 'blueprint.work-time', ...工作时间 })
    write({ type: 'blueprint.busy', busy: 运行.在跑(sessionId), 自: 运行.起于(sessionId),
      turn: 运行.轮号(sessionId) })
    try {
      const address = await 会话地址(ctx.get('sessionQuery'), sessionId, abort.signal)
      for await (const frame of 实时输出(ctx.get('sessionController'), address, abort.signal, entryOf)) write(frame)
    } catch (error) {
      if (!abort.signal.aborted) write({ type: 'blueprint.error', message: `实时输出连接失败：${error.message}` })
    } finally { drop(); res.end() }
  }

  图纸流 = 创建图纸实时({ send, read: async root => (await lineage(await listSessions(true), root)).tree })
  接项目分组(ctx, 项目位置们)
  const connections = createConnectionManager(ctx, { projectRoot: 项目位置们 })
  const manageConnections = connectionHandler(connections, json)
  const manageTerminal = 终端HTTP(ctx, json)
  const manageSubagents = 子代理HTTP(json, { 管理端口: () => ctx.get('webServer')?.port,
    项目根Of: async session => { const found = await 项目文件夹(session); if (found.错) throw new Error(found.错); return found.dir },
    保存全局模型: (session, model) => 改模型(ctx, session, model),
    // 测试结果本机共用，跟画树摘要一样放在账本旁边的 dsh 存储里（`<DSH_HOME>/storages/blueprint_agents/`）。
    测试记录路径: () => { const root = ctx.get('sessionPersistence')?.root; return typeof root === 'string' && root ? join(dirname(root), 'storages', 'blueprint_agents', '测试.json') : null } })
  const manageSoftware = 软件HTTP(json)
  const manageExternalRun = 外部run视图HTTP(json, { 项目根Of: async session => { const found = await 项目文件夹(session); if (found.错) throw new Error(found.错); return found.dir } })
  const manageNodeInformation = 节点信息HTTP(json, { 项目根Of: async session => { const found = await 项目文件夹(session); if (found.错) throw new Error(found.错); return found.dir } })
  const manageProjectName = 项目名称HTTP(json, {
    projectRootOf: async session => { const found = await 项目文件夹(session); if (found.错) throw new Error(found.错); return found.dir },
    workspaceOf: root => ctx.get('workspaceRegistry')?.create(root, basename(root)),
  })
  const manageCollab = 协作HTTP(json, {
    projectRootOf: async session => { const found = await 项目文件夹(session); if (found.错) throw new Error(found.错); return found.dir },
    onChange: (_root, _value, session) => 图纸流?.update(session), approvePending: approveProjectPending,
  })

  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: mount,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const rel = url.pathname.slice(mount.length)

      /* 旧页面 10-15 下线：打开 /studio/ 的转到新界面（dsh 网页界面的根）。 */
      if (rel === '' || rel === '/' || rel === '/studio.html') { res.writeHead(302, { Location: '/' }); res.end(); return }
      if (rel === '/api/connections' || rel.startsWith('/api/connections/')) return manageConnections(req, res, rel)
      if (rel === '/api/subagents' || rel.startsWith('/api/subagents/')) return manageSubagents(req, res, rel)
      if (rel === '/api/software' || rel.startsWith('/api/software/')) return manageSoftware(req, res, rel)
      if (rel === '/api/external-run') return manageExternalRun(req, res, url)
      if (rel === '/api/node-information') return manageNodeInformation(req, res, url)
      if (rel === '/api/stream') return stream(res, url.searchParams.get('session'))
      if (rel === '/api/history') return history(res, url.searchParams.get('session'), url.searchParams.get('要') || '全',
        new Set((url.searchParams.get('页') || '').split(',').filter(Boolean)), url.searchParams.get('首屏') === '1')
      if (rel === '/api/artifact-reveal' && req.method === 'POST') return openArtifact(req, res, 'reveal')
      if (rel === '/api/artifact-open' && req.method === 'POST') return openArtifact(req, res, 'system')
      if (rel === '/api/artifact-entry' && req.method === 'GET') return artifactEntry(res, url.searchParams.get('session'), url.searchParams.get('path'), {seq:url.searchParams.get('seq'), callId:url.searchParams.get('callId')})
      if (rel === '/api/artifacts') return artifacts(res, url.searchParams.get('session'), ['self', 'project'].includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'branch')
      if (rel === '/api/materials' && req.method === 'GET') return materials(res, url.searchParams)
      if (rel === '/api/material-preview' && req.method === 'GET') return materialPreview(res, url.searchParams)
      if (rel === '/api/flow') return flow(res, url.searchParams.get('session'))
      if (rel === '/api/rpc' && req.method === 'POST') return rpc(req, res)
      if (rel === '/api/terminal') return manageTerminal(req, res, url)
      if (rel === '/api/upload-file') return 上传文件(ctx, req, res, url, json)
      if (rel === '/api/project-storage') return manageProjectStorage(req, res)
      if (rel === '/api/home-intro') return manageHomeIntro(req, res)
      if (rel === '/api/project' && req.method === 'POST') return createProject(req, res)
      if (rel === '/api/project-name' && req.method === 'POST') return manageProjectName(req, res)
      if (rel === '/api/collab') return manageCollab(req, res)
      if (rel === '/api/work' && req.method === 'POST') return createWork(req, res)
      if (rel === '/api/avatar' && req.method === 'POST') return createAvatar(req, res)
      if (rel === '/api/running') return running(res)
      if (rel === '/api/external-subagents') return externalSubagents(res, url.searchParams.get('session'))
      if (rel === '/api/kill' && req.method === 'POST') return killJob(req, res)
      if (rel === '/api/skills' && req.method === 'POST') return switchSkill(req, res)
      if (rel === '/api/skills') return listSkills(req, res)
      if (rel === '/api/collaboration-modes') return json(res, 200, { ok: true, modes: 协作模式们() })
      if (rel === '/api/ui-language') return uiLanguage(req, res)
      if (rel === '/api/files') return listFiles(res, url.searchParams.get('根'), url.searchParams.get('session'), url.searchParams.get('位置'))
      if (rel === '/api/file' && req.method === 'POST') return writeOneFile(req, res)
      if (rel === '/api/file') return readOneFile(res, url.searchParams.get('根'), url.searchParams.get('session'), url.searchParams.get('位置'))
      /* 摆出去那扇窗加载的就是这一条 —— 路径式，相对资源才跟着活 */
      if (rel.startsWith('/preview/')) return servePreview(req, res, rel.slice('/preview/'.length))
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`studio: ${rel} 不是数据接口`)
    },
  })

  ctx.on('dispose', () => {
    不听外部run()
    clearTimeout(残留复查)
    图纸流.dispose()
    for (const res of clients) { try { res.end() } catch { /* 已经断了 */ } }
    clients.clear()
    dispose()
  })

  ctx.logger.info(`Blueprint studio 数据接口已挂上 —— http://127.0.0.1:<port>${mount}/api/`)
  console.log(`Blueprint studio 数据接口已挂上 —— ${mount}/api/`)
}
