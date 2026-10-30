/**
 * 外部 run 的过程记录 → 界面上一步一行（叶 6、C1）：说的话、跑的命令（带退出码，在跑的标出来）、改了哪些文件、出错。
 * 读的是 `外部run.js` 记下的 `系统文档/外部run/<编号>/第N次.jsonl`：每行 `{at, event}`（它吐的原样）、`{at, text}`（不是 JSON 的输出）
 * 或 `{at, blueprint}`（系统自己的记号：启动失败、结束）。纯函数，不读文件。
 */

/** 交回格式那段最后回答：不当成一步「说」，它在交回里。 */
const 是交回 = text => {
  try { const v = JSON.parse(String(text).trim()); return !!v && typeof v === 'object' && ['achieved', 'unmet'].includes(v.result) } catch { return false }
}
const 相对 = (path, 空间) => {
  const p = String(path || '')
  return 空间 && p.startsWith(`${空间}/`) ? p.slice(空间.length + 1) : p
}
const 一行 = (s, n = 200) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }

/**
 * @param {Array<{at?:string, event?:object, text?:string, blueprint?:string}>} 行们 过程记录的每一行（已解析）
 * @param {{ 开始?: string, 空间?: string, 完整?: boolean }} 选项 开始：算第几秒；空间：文件名去掉的目录；完整：阅读面保留正文、命令及输出全文
 * @returns {Array<{ t: number|null, 类: '说'|'命令'|'改文件'|'出错'|'停', 文: string, 码?: number|string|null, 在跑?: boolean }>}
 */
export function 过程步骤(行们, { 开始, 空间, 完整 = false } = {}) {
  const 起 = 开始 ? Date.parse(开始) : NaN
  const 秒 = at => { const t = Date.parse(at || ''); return Number.isFinite(t) && Number.isFinite(起) ? Math.max(0, Math.round((t - 起) / 1000)) : null }
  const 步们 = [], 命令们 = new Map()
  const 文字 = (value, limit) => 完整 ? String(value || '').trim() : 一行(value, limit)
  const 输出 = value => typeof value === 'string' ? value : Array.isArray(value) ? value.filter(block => block.type === 'text').map(block => block.text || '').join('\n') : ''
  const 加 = (at, 类, 文, extra = {}) => { const 步 = { t: 秒(at), 类, 文, ...extra }; 步们.push(步); return 步 }
  for (const 行 of 行们 || []) {
    const e = 行?.event
    if (行?.blueprint === 'start-failed') { 加(行.at, '出错', 文字(行.message || '程序没启动起来')); continue }
    if (行?.blueprint === 'ended') {
      if (完整) for (const step of 命令们.values()) if (step.在跑) { step.在跑 = false; step.中断 = true }
      if (行.stopped) 加(行.at, '停', `停下了：${行.stopped}`)
      else if (行.silent) 加(行.at, '停', '很久没有动静，系统停掉了它')
      continue
    }
    if (!e || typeof e !== 'object') continue
    // Codex：exec --json 的事件
    const item = e.item || {}
    if (e.type === 'item.started' && item.type === 'command_execution') {
      命令们.set(item.id, 加(行.at, '命令', 文字(item.command), { 码: null, 在跑: true }))
    } else if (e.type === 'item.completed' && item.type === 'command_execution') {
      const 步 = 命令们.get(item.id) || 加(行.at, '命令', 文字(item.command))
      步.码 = item.exit_code ?? null; 步.在跑 = false
      if (完整 && 输出(item.aggregated_output)) 步.输出 = 输出(item.aggregated_output)
    } else if (e.type === 'item.completed' && item.type === 'file_change') {
      const 文件们 = (item.changes || []).map(c => 相对(c.path, 空间)).filter(Boolean)
      if (文件们.length) 加(行.at, '改文件', 文件们.join('、'))
    } else if (e.type === 'item.completed' && item.type === 'agent_message') {
      if (item.text?.trim() && !是交回(item.text)) 加(行.at, '说', 文字(item.text, 400))
    } else if (e.type === 'turn.failed') {
      加(行.at, '出错', 文字(e.error?.message || '这一步失败了'))
    // Claude Code：stream-json 的事件
    } else if (e.type === 'assistant') {
      for (const block of e.message?.content || []) {
        if (block.type === 'text' && block.text?.trim() && !是交回(block.text)) 加(行.at, '说', 文字(block.text, 400))
        if (block.type !== 'tool_use') continue
        if (block.name === 'Bash') 命令们.set(block.id, 加(行.at, '命令', 文字(block.input?.command), { 码: null, 在跑: true }))
        else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(block.name) && block.input?.file_path) 加(行.at, '改文件', 相对(block.input.file_path, 空间))
      }
    } else if (e.type === 'user') {
      for (const block of e.message?.content || []) {
        const 步 = block.type === 'tool_result' && 命令们.get(block.tool_use_id)
        if (步) {
          步.码 = block.is_error ? '出错' : 0; 步.在跑 = false
          if (完整 && 输出(block.content)) 步.输出 = 输出(block.content)
        }
      }
    } else if (e.type === 'result' && e.is_error) {
      加(行.at, '出错', 文字(e.result || e.error || e.subtype || '出错了'))
    }
  }
  return 步们
}

/** 砖第二行的「刚才：…」：最后一步的一句话。 */
export function 刚才(步们) {
  const 步 = (步们 || []).at(-1)
  if (!步) return ''
  if (步.类 === '命令') return `跑 ${一行(步.文, 40)}`
  if (步.类 === '改文件') return `改 ${一行(步.文, 40)}`
  if (步.类 === '说') return `说 ${一行(步.文, 40)}`
  return 一行(步.文, 40)
}

/** 过程记录全文 → 每行解析好的对象；坏行跳过。 */
export const 解析过程记录 = text => String(text || '').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
