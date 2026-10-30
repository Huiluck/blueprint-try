/** 在指定的本机测试实例里建真实名册和空会话；不发送 prompt。 */
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  加座位, 建名册, 名册成文, 文成名册, 工作Of, 新工作文档,
  重建节点总表, 工作文档相对, 座位现状相对, 座位经验夹相对, 读名册, 落名册,
} from '../roster/src/index.js'

const options = new Map()
for (let i = 2; i < process.argv.length; i += 2) options.set(process.argv[i], process.argv[i + 1])
const url = options.get('--url'), projectRoot = options.get('--project-root'), token = options.get('--token'), sessionRoot = options.get('--session-root')
if (!url || !projectRoot || (!token && !sessionRoot)) throw new Error('用法：node 生成座位展示壳.mjs --url http://127.0.0.1:3094 --project-root <测试项目目录> --session-root <当前测试实例账本目录>；使用空会话 API 时传 --token')
const base = new URL(url)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('展示壳只写入显式指定的本机测试实例')
const projectName = '座位与分身展示壳', root = join(resolve(projectRoot), projectName)
const manifestPath = join(root, '展示壳会话.json')

const seats = [
  { name: '视觉总监', scope: '角色、场景与视觉语言。保留跨工作的视觉认识。', state: '视觉统一为石墨白家具与少量状态色；角色轮廓、场景层次和素材命名分别交给子节点。', experience: '先验证轮廓，再调材质' },
  { name: '系统总监', scope: '状态、存档与运行结构。维护跨工作的接口认识。', state: '输入、存档和暂停菜单使用同一状态入口；此页只为展示座位记忆的阅读效果。', experience: '状态入口保持集中' },
  { name: '体验总监', scope: '关卡节奏、交互与试玩反馈。', state: '首关先让玩家学会移动和命中，再增加反馈；存档工作没有这个座位的分身。', experience: '第一次成功要清晰可见' },
  { name: '研究总监', scope: '资料与外部证据。这个展示项目暂未分配工作。', state: '座位常驻，尚未派出分身。', experience: null },
]
const works = [
  { id: '0', name: '首关可玩版本', task: '把移动、命中和通关反馈接成一个完整的首关。' },
  { id: '1', name: '角色动作改版', task: '改善角色起步、转向和受击动作的辨识度。' },
  { id: '2', name: '存档系统改版', task: '统一存档结构，支持退出后从最近检查点恢复。' },
]
const avatars = [
  { id: '3', parent: '0', seat: '视觉总监', task: '让首关的角色、场景和反馈在同一视觉语言里成立。', children: ['角色轮廓设计师', '场景层次设计师', '命中反馈设计师'] },
  { id: '4', parent: '0', seat: '系统总监', task: '接通首关输入和战斗状态，检查暂停与恢复的边界。', children: ['输入系统工程师', '战斗状态工程师'] },
  { id: '5', parent: '0', seat: '体验总监', task: '安排第一分钟的学习节奏，让玩家理解移动、命中和结束。', children: ['首关节奏设计师', '试玩记录员'] },
  { id: '6', parent: '1', seat: '视觉总监', task: '把角色的起步、转身和受击姿态整理为可比较的动作样本。', children: ['动作轮廓设计师', '受击反馈设计师'] },
  { id: '7', parent: '1', seat: '系统总监', task: '整理动作状态转换，避免转向和受击互相打断。', children: ['动作状态工程师'] },
  { id: '8', parent: '1', seat: '体验总监', task: '比较改版前后操作感，记录响应时间与可读性的变化。', children: ['操作感观察员'] },
  { id: '9', parent: '2', seat: '视觉总监', task: '设计检查点标记与恢复提示，保持首关已有的视觉语言。', children: ['检查点提示设计师'] },
  { id: '10', parent: '2', seat: '系统总监', task: '制定存档数据边界，安排迁移和恢复两个独立检查。', children: ['存档迁移工程师', '恢复验证工程师'] },
]

let roster = 建名册(projectName, '用于实看多个 seat、工作分身和子树的展示壳；所有内容都是人工样本。')
for (const seat of seats) roster = 加座位(roster, { name: seat.name, scope: seat.scope, by: '0' })
const rows = works.map(work => ({ ...work, kind: 'worker', parent: null, status: work.id === '1' ? '完成' : '开工', requestWriter: 'user' }))
for (const avatar of avatars) {
  const { children, ...row } = avatar
  rows.push({ ...row, name: avatar.seat, kind: 'worker', status: avatar.parent === '1' ? '完成' : '开工', requestWriter: avatar.parent, workload: '复杂' })
  children.forEach((name, index) => rows.push({ id: `${avatar.id}.${index + 1}`, name, parent: avatar.id, kind: 'worker', task: `整理${name.replace(/设计师|工程师|观察员|记录员/g, '')}的方案与检查入口。`, status: avatar.parent === '1' || index === 0 ? '完成' : '开工', requestWriter: avatar.id, workload: '常规' }))
}
// 经过 roster 的同一份规整与校验，避免展示数据发明另一套节点协议。
roster = 文成名册(名册成文({ ...roster, rows }))
let manifest
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
if (!manifest) {
  await mkdir(root) // 已有同名目录而没有展示标记时拒绝，不覆盖用户项目。
  manifest = { format: 'blueprint-seat-shell-v1', projectName, url: base.origin, cwd: root,
    sessions: Object.fromEntries(rows.map(row => [row.id, `session-${randomUUID()}`])) }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
}
if (manifest.format !== 'blueprint-seat-shell-v1' || manifest.cwd !== root || manifest.url !== base.origin) throw new Error('展示标记与目标实例不符，停止写入')
for (const row of roster.rows) row.session = manifest.sessions[row.id]
roster = 文成名册(名册成文(roster))

const writeNew = async (relative, text) => {
  const path = join(root, relative)
  await mkdir(join(path, '..'), { recursive: true })
  try { await writeFile(path, text, { flag: 'wx' }) } catch (error) { if (error.code !== 'EEXIST') throw error }
}
// 名册存在 系统文档/任务.db（任务表）；已经有了就不覆盖，和别的展示文件一样。
if (!await 读名册(root)) await 落名册(root, roster)
for (const row of roster.rows) {
  const work = works.find(item => item.id === 工作Of(roster, row.id))
  await writeNew(工作文档相对(row), 新工作文档(row, row.task, {
    responsibility: row.seat ? seats.find(seat => seat.name === row.seat).scope : `在「${work.name}」中承担${row.name}的部分。`,
    structure: roster.rows.filter(child => child.parent === row.id).map(child => `${child.id} · ${child.name}`).join('\n') || '这个展示节点没有子节点。',
    record: '节点状态和分工是人工布置的界面样本，没有真实执行或交回记录。',
  }))
}
for (const seat of seats) {
  await writeNew(座位现状相对(seat.name), `# ${seat.name}现状\n\n${seat.state}\n\n这是一页人工展示资料。\n`)
  if (seat.experience) await writeNew(join(座位经验夹相对(seat.name), `${seat.experience}.md`), `# ${seat.experience}\n\n人工展示条目，用于检查座位经验入口。\n`)
}
await writeNew('总图景.md', '# 座位与分身展示壳\n\n3 件工作共用 4 个常驻座位。每件工作有自己的分身和子树，研究总监保持空座位；存档系统改版没有体验总监分身。\n\n所有内容均为人工样本，用来查看图纸的布局、切换与动画。\n')
await writeNew('展示项目说明.md', '# 座位与分身展示壳\n\n点总 seat 卡头切工作；点普通 seat 卡头挑选其他工作上的分身；「随总 seat」回到跟随；Esc 收起选择。\n\n这是测试实例中的真实项目目录、名册、工作文档与 dsh 空会话。生成器使用原生空会话 API 或原生持久化库，不发送 prompt，不启动模型。节点状态仅为人工界面样本。\n')
await 重建节点总表(root, roster)

let cookie = ''
if (token) {
  const auth = new URL('/', base)
  auth.searchParams.set('token', token)
  const first = await fetch(auth, { redirect: 'manual' })
  cookie = first.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
}
if (!sessionRoot && !cookie) throw new Error('测试实例未返回登录 cookie，停止创建会话')
async function rpc(method, request) {
  const rpcId = randomUUID()
  const response = await fetch(new URL(`/api/${method}`, base), {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: { request } } }),
  })
  const body = await response.json()
  if (!response.ok || body.rpcId !== rpcId || !body.result?.ok) throw new Error(`${method}: ${JSON.stringify(body.result?.error || body)}`)
  return body.result.value
}
if (sessionRoot) {
  // 显式离线模式只持久化原生的 preset/title 记录，连 Agent 都不装配。
  // 使用当前 profile 的格式校验、目录编码、锁与 flush，不手写 JSONL。
  manifest.sessionRoot = resolve(sessionRoot)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const require = createRequire(new URL('../../../.dsh/profiles/web/package.json', import.meta.url))
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')))
  const { default: Jsonl } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-persistence-jsonl')))
  const { SESSION_FORMAT_VERSION } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')))
  const storage = new Jsonl(new Context(), { root: resolve(sessionRoot) })
  for (const row of roster.rows) {
    const existing = await storage.stat(row.session)
    if (existing && existing.header.cwd !== root) throw new Error(`空会话 ${row.id} 已归属其他目录，停止写入`)
    if (!existing) {
      const handle = await storage.create({ version: SESSION_FORMAT_VERSION, id: row.session, cwd: root, createdAt: Date.now(), isSeeded: false })
      try {
        await handle.append([
          { type: 'agent-preset/selected', seq: 0, time: Date.now(), data: { agentPreset: 'blueprint' } },
          { type: 'session/title', seq: 1, time: Date.now(), data: { title: `${row.id} ${row.name} · 展示壳`, messageSeqs: [], source: { kind: 'user' } } },
        ])
        await handle.flush()
      } finally { await handle.close() }
    }
    console.log(`冷空会话 ${row.id} · ${row.name}`)
  }
} else {
  for (const row of roster.rows) {
    await rpc('session/create', { cwd: root, sessionId: row.session })
    await rpc('session/rename', { sessionId: row.session, title: `${row.id} ${row.name} · 展示壳` })
    console.log(`空会话 ${row.id} · ${row.name}`)
  }
}
const historyUrl = new URL('/studio/api/history', base)
historyUrl.searchParams.set('session', manifest.sessions['0'])
historyUrl.searchParams.set('要', '树')
historyUrl.searchParams.set('首屏', '1')
const history = await fetch(historyUrl, { headers: { cookie } }).then(response => response.json())
console.log(JSON.stringify({ projectName, cwd: root, sessionId: manifest.sessions['0'], works: works.length, seats: history.lineage?.tree?.座位们?.length, avatars: avatars.length, nodes: roster.rows.length, busy: history.busy }, null, 2))
