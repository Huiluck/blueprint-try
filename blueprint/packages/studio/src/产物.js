/** 产物是现有会话事实的只读投影。记录来源，不把文件修改次数冒充内容快照。 */
import { open, realpath, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, relative, extname, basename, sep, isAbsolute } from 'node:path'
import { 检查产物, 网页入口, 允许产物路径, 允许预览路径, 文本产物扩展名 } from '../../node/src/产物.js'
import { execFile } from 'node:child_process'
import { 展开工具调用 } from '../../node/src/通用工具.js'
import { 是上下文消息, 工具调用Of, 工具结果Of, 工具结果失败 } from '../../context/src/消息协议.js'

const 类型 = new Map(Object.entries({
  image: 'png jpg jpeg gif webp svg avif bmp',
  document: 'md markdown txt', web: 'html htm', pdf: 'pdf',
  slides: 'ppt pptx odp', office: 'doc docx xls xlsx csv',
  video: 'mp4 webm mov', audio: 'mp3 wav ogg m4a', playable: 'app command exe bat cmd',
}).flatMap(([kind, extensions]) => extensions.split(' ').map(e => [e, kind])))
export const 产物类型 = path => 类型.get(extname(path).slice(1).toLowerCase()) || (文本产物扩展名.includes(extname(path).slice(1).toLowerCase()) ? 'document' : 'file')
const argsOf = x => { try { return typeof x === 'string' ? JSON.parse(x) : x || {} } catch { return {} } }
const textOf = blocks => (blocks || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n')
const timeOf = x => typeof x === 'number' ? x : Date.parse(x) || 0

export function 产物路径(root, input, { cwd = root, any = false, includeTemporary = false, includeEvidence = false } = {}) {
  if (typeof input !== 'string' || !input.trim() || /[\0\r\n]/.test(input)) return null
  let value = input.trim().replace(/^<|>$/g, '')
  // `C:\` 以盘符开头，和 URL scheme 形状相同；先排除 Windows 绝对路径。
  if (!/^[a-z]:[\\/]/i.test(value) && /^[a-z][a-z\d+.-]*:/i.test(value)) return null
  try { value = decodeURIComponent(value) } catch { return null }
  // Markdown 的行号与锚点不属于文件路径。
  value = value.replace(/#.*$/, '').replace(/:\d+(?::\d+)?$/, '')
  const path = relative(resolve(root), resolve(root, cwd, value)).split(sep).join('/')
  if (!path || path.startsWith('../') || path === '..' || path.startsWith('/')) return null
  if (!允许产物路径(path, {includeTemporary, includeEvidence})) return null
  const kind = 类型.get(extname(path).slice(1).toLowerCase())
  return kind || any ? { path, kind: kind || 产物类型(path) } : null
}

/** 只收成功写入、显式预览和 assistant 正文中明确的文件引用；read 与 reasoning 不算产物。 */
export function 产物引用(events, session, root, inherited = 0, options = {}) {
  return 续产物引用(null, events, session, root, inherited, options).refs
}

/** 账本只追加：记住折到第几条，再读时只折新来的；前缀对不上就从头折。 */
export function 续产物引用(state, events, session, root, inherited = 0, { materials = false } = {}) {
  if (!state || state.next > events.length || (state.next && events[state.next - 1]?.seq !== state.lastSeq))
    state = { calls: new Map(), refs: [], seen: new Set(), cwd: root, next: 0, lastSeq: undefined, start: 0 }
  const { calls, refs, seen } = state
  let cwd = state.cwd
  const add =(path, ev, callId, source, title, any = false, directory = cwd, input = path) => {
    const file = 产物路径(root, path, {cwd:directory, any:any || materials, includeTemporary:materials, includeEvidence:materials})
    if (!file || /^\.blueprint-tmp\/后台工具-/.test(file.path)) return
    const key = `${ev.seq}:${file.path}`
    if (seen.has(key)) return
    seen.add(key)
    // bash 输出里提到的带上节点开工时刻，汇集时好认出哪些是开工以后才有的。
    refs.push({ ...file, input, session, seq: ev.seq, callId: callId || null,
      time: timeOf(ev.time), source, title: title || basename(file.path), ...(source === '输出引用' && state.start ? { since: state.start } : {}) })
  }
  const quoted = (text, ev, callId, source, directory = cwd) => {
    if (typeof text !== 'string') return
    for (const m of text.matchAll(/!?\[([^\]\n]*)\]\((<[^>\n]+>|[^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\)/g))
      add(m[2].replace(/\s+["'][^]*$/, ''), ev, callId, source === '引用' ? '展示' : source, m[1], true, directory)
    for (const m of text.matchAll(/`([^`\n]+)`|「([^」\n]+)」|“([^”\n]+)”/g))
      add(m[1] || m[2] || m[3], ev, callId, source, undefined, false, directory)
  }
  const register = (id, name, args, ev, emitReferences = true) => {
    const effective = 展开工具调用(name, args)
    name = effective.name; args = effective.arguments
    const parsed = argsOf(args)
    const directory = name === 'bash' && typeof parsed.workdir === 'string' ? resolve(cwd, parsed.workdir) : cwd
    calls.set(id, { name, args: parsed, cwd: directory })
    // 提问还在等用户回答时，也展示其中明确引用的文件，不等待 tool/result。
    if (emitReferences && name === 'ask_user_question') {
      const visit = value => {
        if (typeof value === 'string') quoted(value, ev, id, '提问引用')
        else if (value && typeof value === 'object') Object.values(value).forEach(visit)
      }
      visit(parsed)
    }
  }
  for (let index = state.next; index < events.length; index++) {
    const ev = events[index], d = ev.data || {}, blocks = d.message?.content || []
    if (ev.type === 'working-directory/change' && typeof d.cwd === 'string' && isAbsolute(d.cwd)) cwd = d.cwd
    const invoked = 工具调用Of(ev)
    if (invoked) register(invoked.callId, invoked.name, invoked.arguments, ev, index >= inherited)
    if (ev.type === 'assistant/message') {
      for (const b of blocks) if (b.type === 'tool-call') register(b.id, b.name, b.arguments, ev, index >= inherited)
    }
    if (index < inherited) continue
    state.start ||= timeOf(ev.time)
    // 用户上传、项目 context 和持久材料入口仍以项目根为基准。
    if (materials && ev.type === 'user/message') quoted(textOf(d.content), ev, null, 是上下文消息(d) ? '上下文引用' : '输入材料', root)
    if (ev.type === 'assistant/message') {
      quoted(textOf(blocks), ev, null, '引用')
    }
    const b = 工具结果Of(ev)
    if (!b || 工具结果失败(ev)) continue
    const call = calls.get(b.toolCallId)
    if (!call) continue
    if (call.name === 'present_artifact') {
      try {
        const receipt = JSON.parse(textOf(b.content)), a = receipt.artifact
        if (receipt.artifactVersion === 1 && a?.declared && typeof a.path === 'string') {
          const options = {any:true, includeTemporary:materials, includeEvidence:materials}
          const url = 网页入口(a.path), file = url ? null : 产物路径(root, a.path, options)
          if (!url && !file) continue
          const declaration = {...a, path:url || file.path,
            ...(a.coverPath ? {coverPath:产物路径(root, a.coverPath, options)?.path} : {})}
          refs.push({path:declaration.path, input:call.args.entry, kind:url ? 'web' : 类型.get(extname(declaration.path).slice(1).toLowerCase()) || 'file',
            session, seq:ev.seq, callId:b.toolCallId, time:timeOf(ev.time), source:'交付入口', title:a.title, declaration})
        }
      } catch { /* 只读成功工具回执，不猜损坏的协议 */ }
      continue
    }
    // finish 的相关文件（10-22）：和交回前那段说明一起，作交付入口列在对话里。先按当时的目录认，那里没有再按项目根（同 finish 的核对）。
    if (call.name === 'finish' && Array.isArray(call.args.files)) {
      for (const path of call.args.files) if (typeof path === 'string')
        add(path, ev, b.toolCallId, '交付入口', undefined, true, existsSync(resolve(call.cwd, path)) ? call.cwd : root)
    }
    const a = call.args
    const directory = ['bash','job_output'].includes(call.name) && typeof d.meta?.cwd === 'string' && isAbsolute(d.meta.cwd) ? d.meta.cwd : call.cwd
    if (materials) {
      const body = textOf(b.content)
      if (['read','read_image','read_audio','read_video'].includes(call.name)) {
        const resolved = body.match(/<path>([^<]+)<\/path>/)?.[1]
        const inputs = [resolved || a.file_path || a.path || a.位置, ...(Array.isArray(a.files) ? a.files : [])].flat().filter(Boolean)
        for (const [index, path] of inputs.entries()) add(path, ev, b.toolCallId, '读取', undefined, false, call.cwd,
          index === 0 && resolved ? a.file_path || a.path || a.位置 || path : path)
      }
      if (['web_fetch','web_search'].includes(call.name)) {
        const urls = [a.url, ...Array.from(body.matchAll(/https?:\/\/[^\s<>"\)\]]+/g), m => m[0])].filter(Boolean)
        for (const input of new Set(urls)) {
          const url = 网页入口(input)
          if (url) refs.push({path:url, kind:'web', session, seq:ev.seq, callId:b.toolCallId,
            time:timeOf(ev.time), source:call.name === 'web_fetch' ? '读取网页' : '检索候选', title:new URL(url).hostname})
        }
      }
      if (['bash','job_output'].includes(call.name)) {
        quoted(body, ev, b.toolCallId, '输出引用', directory)
        for (const line of body.split('\n')) if (/^(?:素材\/|\.blueprint-(?:tmp|evidence)\/)/.test(line.trim()) || line.trim().startsWith(root + '/'))
          add(line.trim(), ev, b.toolCallId, '输出引用', undefined, false, directory)
      }
    }
    if (call.name === 'render_page') {
      try { add(JSON.parse(textOf(b.content)).path, ev, b.toolCallId, '写入', undefined, false, root) } catch { /* 只收成功截图回执 */ }
    }
    if (['write', 'edit', 'folder_write', 'folder_edit', 'preview', 'read_image'].includes(call.name)) {
      // 工具返回的绝对路径优先于参数，参数可能是相对工作目录的路径。
      const resolved = textOf(b.content).match(/<path>([^<]+)<\/path>/)?.[1]
      add(resolved || a.file_path || a.path || a.位置, ev, b.toolCallId,
        call.name === 'read_image' ? '查看' : call.name === 'preview' ? '展示' : '写入', undefined, false, call.cwd, a.file_path || a.path || a.位置 || resolved)
    }
    if (call.name === 'bash' || call.name === 'job_output') {
      // 只收回执里明确出现且实际存在的路径，不解析 shell 程序来猜它写了什么。
      for (const line of textOf(b.content).split('\n')) {
        for (const m of line.matchAll(/(?:^|[\s`'"·])([^\s`'"<>（）]+\.(?:png|jpe?g|gif|webp|svg|avif|md|markdown|html?|pdf|pptx?|docx?|xlsx?|mp4|webm|mp3|wav|command))(?=$|[\s`'"（）:,])/gi))
          add(m[1], ev, b.toolCallId, '输出引用', undefined, false, directory)
      }
    }
  }
  state.cwd = cwd; state.next = events.length; state.lastSeq = events.at(-1)?.seq
  return state
}

/** 正文与工具参数点击只认该事件恢复出的入口，不使用会话最新目录。 */
export function 定位产物引用(root, refs, input, { seq, callId } = {}, events = []) {
  const normalize = value => {
    if (typeof value !== 'string') return null
    try { return decodeURIComponent(value.trim().replace(/^<|>$/g, '')).replace(/#.*$/, '').replace(/:\d+(?::\d+)?$/, '') }
    catch { return null }
  }
  const wanted = normalize(input)
  if (!wanted) throw new Error('缺少文件入口')
  const source = refs.filter(ref => callId ? ref.callId === callId : String(ref.seq) === String(seq))
  const direct = 产物路径(root, input, { any: true, includeTemporary: true, includeEvidence: true })?.path
  const paths = [...new Set(source.filter(ref => normalize(ref.input) === wanted || ref.path === direct).map(ref => ref.path))]
  if (paths.length === 1) return paths[0]
  if (paths.length > 1) throw new Error('这条记录的文件入口不唯一')
  // 头部输入不必成为产物：只核对真实调用中的文件参数和当时目录。
  let cwd = root, candidate
  const call = (id, name, args) => {
    if (!callId || id !== callId) return
    const effective = 展开工具调用(name, args), a = argsOf(effective.arguments)
    const inputs = ['path','位置','file_path','entry'].flatMap(key => {
      const value = a[key]
      if (Array.isArray(value)) return value
      try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed } catch { /* 普通路径 */ }
      return typeof value === 'string' ? [value] : []
    })
    if (inputs.some(value => normalize(value) === wanted)) candidate = 产物路径(root, input, {
      cwd: effective.name === 'bash' && typeof a.workdir === 'string' ? resolve(cwd, a.workdir) : cwd,
      any: true, includeTemporary: true, includeEvidence: true,
    })?.path
  }
  for (const event of events) {
    const d = event.data || {}
    if (event.type === 'working-directory/change' && typeof d.cwd === 'string' && isAbsolute(d.cwd)) cwd = d.cwd
    const invoked = 工具调用Of(event)
    if (invoked) call(invoked.callId, invoked.name, invoked.arguments)
    if (event.type === 'assistant/message') for (const block of d.message?.content || [])
      if (block.type === 'tool-call') call(block.id, block.name, block.arguments)
    if (!callId && String(event.seq) === String(seq) && ['assistant/message','user/message'].includes(event.type)) {
      const body = textOf(event.type === 'user/message' ? d.content : d.message?.content)
      if (body.includes(String(input).trim()) || body.includes(wanted)) candidate = 产物路径(root, input, {
        cwd: event.type === 'user/message' ? root : cwd, any: true, includeTemporary: true, includeEvidence: true,
      })?.path
    }
  }
  if (!candidate) throw new Error('这条记录没有对应的文件入口')
  return candidate
}

export function 产物范围(sessions, chosen, roster, scope = 'branch') {
  // 名册父子关系是主干，会话血统补上 do 与支线。
  const byNode = new Map(roster.map(r => [String(r.id), r]))
  const parent = new Map(sessions.map(s => [String(s.id), String(s.parentSession || '')]))
  for (const r of roster) {
    const p = byNode.get(String(r.交给))
    if (r.会话 && p?.会话) parent.set(String(r.会话), String(p.会话))
  }
  if (scope === 'project') return sessions
  return sessions.filter(s => {
    let id = String(s.id)
    const seen = new Set()
    while (id && !seen.has(id)) {
      if (id === String(chosen)) return true
      if (scope === 'self') return false
      seen.add(id); id = parent.get(id)
    }
    return false
  })
}

/** realpath 再验边界，符号链接不能把项目外的文件送进预览。 */
export async function 安全产物文件(root, path, { preview = false } = {}) {
  const base = await realpath(root), file = await realpath(resolve(root, path))
  if (!file.startsWith(base + sep)) throw new Error('文件位于项目外')
  const paths = [relative(base, resolve(base, path)), relative(base, file)].map(value => value.split(sep).join('/'))
  if (paths.some(value => value.split('/').some(part => /^\.git$/i.test(part)))) throw new Error('Git 管理文件不提供预览')
  if (preview || paths.some(value => value.split('/').includes('.agents'))) {
    if (paths.some(value => !允许预览路径(value, { includeTemporary: true, includeEvidence: true }))) throw new Error('隐藏配置不提供预览')
  }
  return file
}

/** 打开动作只接收本机同源点击，不让预览网页跨源触发宿主应用。 */
export function 允许本机打开(headers) {
  try {
    const origin = new URL(headers.origin)
    return origin.host === headers.host && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname)
      && headers['sec-fetch-site'] !== 'cross-site'
  } catch { return false }
}

/** 相当于用户双击入口；路径单独传参，不经 shell，不接受附加命令。 */
export async function 打开本地产物(root, path, action, {
  platform = process.platform,
  launch = (args, _action) => new Promise((done, fail) => execFile(platform === 'win32' ? 'explorer.exe' : '/usr/bin/open', args, { timeout: 5000 }, err => err ? fail(err) : done())),
} = {}) {
  if (!['system','reveal'].includes(action)) throw new Error('不支持的打开方式')
  if (!['darwin','win32'].includes(platform)) throw new Error('系统打开与定位目前仅支持 macOS 和 Windows')
  const artifact = await 检查产物(root, {entry:path, opening:action}, {includeTemporary:true, includeEvidence:true})
  if (网页入口(artifact.path)) throw new Error('请选择项目内文件或目录')
  const full = await 安全产物文件(root, artifact.path)
  if (platform === 'win32') await launch(action === 'reveal' ? ['/select,', full] : [full], action)
  else await launch(action === 'reveal' ? ['-R', full] : [full], action)
}

/** 列表只收节点做了、看了、拿给人看的：搜索结果里的候选网址、系统叫醒话里的路径不算；
 *  bash 输出里提到的路径只认节点开工以后新建或改过的文件（ctime，解压、拷贝也算），列目录、grep 带出来的旧素材、参考和目录本身不算。
 *  点开路径时的定位仍用全部引用。 */
async function 列入的引用(root, path, refs) {
  const kept = refs.filter(r => r.source !== '检索候选' && r.source !== '上下文引用')
  if (!kept.some(r => r.source === '输出引用' && r.since)) return kept
  let info = null
  try { info = await stat(await 安全产物文件(root, path)) } catch { /* 不在了就不算 */ }
  return kept.filter(r => r.source !== '输出引用' || !r.since || (info?.isFile() && info.ctimeMs >= r.since))
}

export async function 汇集产物(root, refs, roster, sessions, { materials = false } = {}) {
  const rows = new Map(roster.map(r => [String(r.会话), r]))
  const parents = new Map(sessions.map(s => [String(s.id), String(s.parentSession || '')]))
  const owner = session => {
    const seen = new Set()
    while (session && !seen.has(session)) {
      if (rows.has(session)) return rows.get(session)
      seen.add(session); session = parents.get(session)
    }
    return null
  }
  const grouped = new Map()
  for (const ref of refs) {
    const node = owner(ref.session)
    const list = grouped.get(ref.path) || []
    list.push({ ...ref, nodeId: node?.id || '', nodeName: node?.name || '', nodeStatus: node?.交付结论 || '' })
    grouped.set(ref.path, list)
  }
  const artifacts = []
  for (const [path, all] of grouped) {
    const history = await 列入的引用(root, path, all)
    if (!history.length) continue
    history.sort((a, b) => b.time - a.time || b.seq - a.seq || a.session.localeCompare(b.session))
    const latest = history[0], node = owner(latest.session)
    const item = { ...latest, id: path, history, nodeId: node?.id || '', nodeName: node?.name || '',
      nodeStatus: node?.交付结论 || '', available: false, excerpt: '', modified: 0, size: 0 }
    const declaration = history.find(r => r.declaration)?.declaration
    try {
      {
        const checked = await 检查产物(root, {entry:path, title:declaration?.title || item.title,
          description:declaration?.description, opening:declaration?.opening}, {includeTemporary:materials, includeEvidence:materials})
        Object.assign(item, checked)
        item.declared = !!declaration
        if (checked.directory && item.kind !== 'playable') item.kind = 'file'
        if (declaration?.coverPath) {
          try {
            const coverFile = await 安全产物文件(root, declaration.coverPath), coverStat = await stat(coverFile)
            if (coverStat.isFile() && /\.(png|jpe?g|webp|gif|avif)$/i.test(declaration.coverPath))
              item.cover = {path:declaration.coverPath, modified:coverStat.mtimeMs}
          } catch { /* 封面丢失不隐藏有效入口 */ }
        }
        if (网页入口(path)) {
          item.url = path; item.available = true
          artifacts.push(item); continue
        }
      }
      const full = await 安全产物文件(root, path), st = await stat(full)
      if (!st.isFile() && !item.directory) continue
      item.available = true; item.modified = st.mtimeMs; item.size = st.size
      if (item.cover) item.cover.stale = item.cover.modified < st.mtimeMs
      if (!item.cover && (item.kind === 'web' || item.kind === 'playable')) {
        // 明确约定：同目录、同主文件名的图片作为网页封面；不启动浏览器截图。
        const stem = path.slice(0, -extname(path).length)
        for (const extension of ['png', 'webp', 'jpg', 'jpeg']) {
          const coverPath = `${stem}.${extension}`
          try {
            const coverFile = await 安全产物文件(root, coverPath), coverStat = await stat(coverFile)
            if (!coverStat.isFile()) continue
            item.cover = { path: coverPath, modified: coverStat.mtimeMs, stale: coverStat.mtimeMs < st.mtimeMs }
            break
          } catch { /* 没有同名封面就保留文字入口；越界图片不加载 */ }
        }
      }
      if (item.kind === 'document' || item.kind === 'web') {
        const handle = await open(full, 'r')
        try {
          const buffer = Buffer.alloc(8192), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
          const text = buffer.subarray(0, bytesRead).toString('utf8')
          if (item.kind === 'document') item.excerpt = text.slice(0, 800)
          else item.excerpt = (text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '')
        } finally { await handle.close() }
      }
    } catch (e) { item.unavailableReason = e.code === 'ENOENT' ? '文件已移动或删除' : '文件不可读取或位于项目外' }
    // 单纯的正文引用必须确实落地，写入回执则保留“已删除”的事实。
    if (!item.available && history.every(r => !['写入','交付入口','实时文件'].includes(r.source))) continue
    artifacts.push(item)
  }
  return artifacts.sort((a, b) => b.time - a.time || a.path.localeCompare(b.path))
}
