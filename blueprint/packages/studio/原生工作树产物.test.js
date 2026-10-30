import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, realpath, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 检查产物, 允许产物路径 } from '../node/src/产物.js'
import { 产物路径, 产物引用, 汇集产物, 安全产物文件, 打开本地产物 } from './src/产物.js'
import { 列目录 } from './src/文件夹.js'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'

const nativeCall = (session, id, name, args) => session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId(id), name, arguments: args })
const nativeResult = (session, id, text, meta) => session.append('tool/result', { turn: 1, step: 1,
  message: createToolResultMessage({ callId: ToolCallId(id), isError: false, content: [{ type: 'text', text }] }), ...(meta ? { meta } : {}) }, { surfaceOp: 'append' })
const nativeText = (session, text) => session.append('assistant/message', { turn: 1, step: 1, stream: [],
  message: createAssistantMessage({ source: { provider: 'fixture', model: 'directory' }, content: [{ type: 'text', text }] }) }, { surfaceOp: 'append' })

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'blueprint-worktree-artifacts-')))
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'blueprint-worktree-outside-')))
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) })
  const prefix = '作品空间/1/.agents/worktrees/设计分支'
  const cwd = join(root, prefix)
  await mkdir(join(cwd, '资源'), { recursive: true })
  await writeFile(join(cwd, 'demo.html'), '<title>工作树试玩</title><link rel="stylesheet" href="资源/style.css">')
  await writeFile(join(cwd, '资源/style.css'), 'body { color: red }')
  await writeFile(join(cwd, 'cover.png'), 'synthetic-image')
  await writeFile(join(cwd, '.git'), 'gitdir: hidden administration\n')
  await writeFile(join(cwd, '.env'), 'SYNTHETIC_PRIVATE_CONFIGURATION')
  await mkdir(join(root, '作品/.git'), { recursive: true })
  await writeFile(join(root, '作品/.git/config'), 'SYNTHETIC_GIT_CONFIGURATION')
  await mkdir(join(root, '系统文档'), { recursive: true })
  await writeFile(join(root, '系统文档/节点总表.md'), '合法项目文件浏览')
  await mkdir(join(root, '作品空间/1/.agents/notes'), { recursive: true })
  await writeFile(join(root, '作品空间/1/.agents/notes/配置.md'), '隐藏配置')
  await writeFile(join(outside, 'private.html'), 'OTHER_PROJECT_SECRET')
  await symlink(join(root, '作品/.git/config'), join(cwd, '管理文件别名.txt'))
  await symlink(join(root, '作品/.git'), join(root, '管理目录别名'))
  await symlink(join(cwd, '.env'), join(cwd, '配置别名.txt'))
  await symlink(join(outside, 'private.html'), join(cwd, '越界.html'))
  return { root, outside, prefix, cwd }
}

test('当前工作树 entry 和 cover 解析后仍返回项目路径，默认根语义及 URL 保持有效', async t => {
  const f = await fixture(t)
  const artifact = await 检查产物(f.root, { entry: 'demo.html', cover: 'cover.png' }, { cwd: f.cwd })
  assert.equal(artifact.path, `${f.prefix}/demo.html`)
  assert.equal(artifact.coverPath, `${f.prefix}/cover.png`)
  assert.equal(artifact.opening, 'preview')
  assert.equal((await 检查产物(f.root, { entry: artifact.path })).path, artifact.path)
  assert.equal((await 检查产物(f.root, { entry: 'https://example.com/demo', cover: 'cover.png' }, { cwd: f.cwd })).coverPath, artifact.coverPath)
  assert.equal(产物路径(f.root, artifact.path).path, artifact.path)
  assert.equal(允许产物路径(`${f.prefix}/资源/style.css`), true)
  assert.equal(允许产物路径(`${f.prefix}/.agents/worktrees/下一分支/demo.html`), true)
  for (const path of ['.agents', '.agents/worktrees', '.agents/notes/配置.md', '.agents/worktrees/.隐藏/demo.html',
    `${f.prefix}/.git`, `${f.prefix}/.env`, `${f.prefix}/node_modules/demo.html`]) assert.equal(允许产物路径(path), false, path)
  await assert.rejects(检查产物(f.root, { entry: 'demo.html' }, { cwd: f.outside }))
  for (const entry of ['.git', '.env', '配置别名.txt', '管理文件别名.txt', '越界.html'])
    await assert.rejects(检查产物(f.root, { entry }, { cwd: f.cwd }))
})

test('工作树声明、图片封面与写入回执能进入画廊，用户打开沿用项目相对路径', async t => {
  const f = await fixture(t)
  const artifact = await 检查产物(f.root, { entry: 'demo.html', cover: 'cover.png', title: '工作树试玩' }, { cwd: f.cwd })
  const events = [
    { type: 'tool/call', seq: 1, data: { callId: 'present', name: 'present_artifact', arguments: { entry: 'demo.html' } } },
    { type: 'tool/result', seq: 2, data: { message: { content: [{ type: 'tool-result', toolCallId: 'present', content: [{ type: 'text', text: JSON.stringify({ artifactVersion: 1, artifact }) }] }] } } },
    { type: 'tool/call', seq: 3, data: { callId: 'write', name: 'write', arguments: { file_path: 'cover.png' } } },
    { type: 'tool/result', seq: 4, data: { message: { content: [{ type: 'tool-result', toolCallId: 'write', content: [{ type: 'text', text: `<path>${join(f.cwd, 'cover.png')}</path>` }] }] } } },
  ]
  const refs = 产物引用(events, 'worktree-session', f.root)
  assert.deepEqual(refs.map(row => row.path), [`${f.prefix}/demo.html`, `${f.prefix}/cover.png`])
  const items = await 汇集产物(f.root, refs, [], [])
  const page = items.find(item => item.path.endsWith('/demo.html'))
  assert.equal(page.available, true)
  assert.equal(page.cover.path, `${f.prefix}/cover.png`)
  assert.equal(page.excerpt, '工作树试玩')
  assert.equal(items.find(item => item.kind === 'image').available, true)
  const launches = []
  await 打开本地产物(f.root, page.path, 'reveal', { platform: 'darwin', launch: async argv => launches.push(argv) })
  assert.deepEqual(launches, [['-R', join(f.cwd, 'demo.html')]])
})

test('模型展示回执的绝对入口和封面恢复项目相对声明，旧回执和网页地址仍可读', async t => {
  const f = await fixture(t)
  const declaration = await 检查产物(f.root, { entry: 'demo.html', cover: 'cover.png' }, { cwd: f.cwd })
  const absolute = {...declaration, path:join(f.root, declaration.path), coverPath:join(f.root, declaration.coverPath)}
  const records = [declaration, absolute, {...absolute, path:'https://example.com/demo', opening:'browser'}, {...absolute, path:join(f.outside, 'private.html')}]
  const events = records.flatMap((artifact, index) => [
    {type:'tool/call', seq:index * 2, data:{callId:`present-${index}`,name:'present_artifact',arguments:{entry:'demo.html'}}},
    {type:'tool/result',seq:index * 2 + 1,data:{message:{content:[{type:'tool-result',toolCallId:`present-${index}`,content:[{type:'text',text:JSON.stringify({artifactVersion:1,artifact})}]}]}}},
  ])
  const refs = 产物引用(events, 'session', f.root)
  assert.equal(refs.length, 3, '项目外的绝对入口不投影')
  assert.equal(refs[1].path, declaration.path)
  assert.equal(refs[1].declaration.path, declaration.path)
  assert.equal(refs[1].declaration.coverPath, declaration.coverPath)
  assert.equal(refs[1].input, 'demo.html')
  assert.equal(refs[2].path, 'https://example.com/demo')
  assert.equal(refs[2].declaration.coverPath, declaration.coverPath)
  const items = await 汇集产物(f.root, refs, [], [])
  assert.equal(items.find(item => !item.url).cover.path, declaration.coverPath)
})

test('工作树 HTML 和相对资源可预览；Git 管理文件、隐藏配置与别名不能绕过真实路径检查', async t => {
  const f = await fixture(t)
  for (const path of [`${f.prefix}/demo.html`, `${f.prefix}/资源/style.css`, `${f.prefix}/cover.png`])
    assert.ok(await readFile(await 安全产物文件(f.root, path, { preview: true })))
  for (const path of ['作品/.git/config', '管理目录别名/config', `${f.prefix}/.git`, `${f.prefix}/.env`,
    `${f.prefix}/管理文件别名.txt`, `${f.prefix}/配置别名.txt`, `${f.prefix}/越界.html`, '作品空间/1/.agents/notes/配置.md'])
    await assert.rejects(安全产物文件(f.root, path, { preview: true }), undefined, path)
  await assert.rejects(安全产物文件(f.root, '管理目录别名/config'), /Git 管理/)
  assert.equal(await readFile(await 安全产物文件(f.root, '系统文档/节点总表.md'), 'utf8'), '合法项目文件浏览')
})

test('文件浏览可经过原生池父目录，隐藏配置与 Git 管理节点不出现，普通项目文件仍可浏览', async t => {
  const f = await fixture(t)
  const worktree = await 列目录(f.root, f.prefix)
  assert.ok(worktree.树.some(row => row.名 === 'demo.html'))
  assert.ok(worktree.树.some(row => row.名 === '资源'))
  assert.ok(!worktree.树.some(row => row.名 === '.git' || row.名 === '.env'))
  assert.deepEqual((await 列目录(f.root, '作品空间/1/.agents')).树.map(row => row.名), ['worktrees'])
  assert.deepEqual((await 列目录(f.root, '作品空间/1/.agents/worktrees')).树.map(row => row.名), ['设计分支'])
  assert.ok(!(await 列目录(f.root, '作品')).树.some(row => row.名 === '.git'))
  for (const path of ['作品/.git', '管理目录别名', '作品空间/1/.agents/notes']) await assert.rejects(列目录(f.root, path))
  assert.deepEqual((await 列目录(f.root, '系统文档')).树.map(row => row.名), ['节点总表.md'])
})

test('真实 Session 目录事件与继承前缀决定相对引用，工具完成前切目录仍沿调用时目录', async t => {
  const f = await fixture(t)
  const parent = Session.create(SessionId('artifact-cwd-parent'), [], { ...Session.create(SessionId('artifact-cwd-parent')).header, cwd: f.root })
  parent.append('working-directory/change', { cwd: f.cwd })
  nativeText(parent, '[继承页面](demo.html)')
  nativeCall(parent, 'inherited-write', 'write', { file_path: '继承稿.md' })
  nativeResult(parent, 'inherited-write', 'ok')
  const inherited = parent.snapshotEvents().length
  const child = Session.create(SessionId('artifact-cwd-child'), parent.snapshotEvents(), {
    ...Session.create(SessionId('artifact-cwd-child')).header, cwd: f.root, parentSession: parent.id, isSeeded: true,
  }, SessionLogOffset(inherited))
  nativeCall(child, 'late-write', 'write', { file_path: 'demo.html' })
  child.append('working-directory/change', { cwd: f.root })
  nativeResult(child, 'late-write', 'ok')
  nativeText(child, '[项目入口](总图景.md)')
  nativeCall(child, 'absolute-write', 'edit', { file_path: '错误参数.md' })
  nativeResult(child, 'absolute-write', `<path>${join(f.cwd, '资源/真实回执.md')}</path>`)
  nativeCall(child, 'absolute-read', 'read', { file_path: '同名参考.md' })
  nativeResult(child, 'absolute-read', `<path>${join(f.cwd, '资源/真实参考.md')}</path>`)
  child.append('working-directory/change', { cwd: f.cwd })
  nativeText(child, '[工作树入口](demo.html)')
  const refs = 产物引用(child.snapshotEvents(), child.id, f.root, child.inheritedEventCount, { materials: true })
  assert.deepEqual(refs.map(row => [row.path, row.source]), [
    [`${f.prefix}/demo.html`, '写入'], ['总图景.md', '展示'], [`${f.prefix}/资源/真实回执.md`, '写入'],
    [`${f.prefix}/资源/真实参考.md`, '读取'], [`${f.prefix}/demo.html`, '展示'],
  ])
  assert.ok(!refs.some(row => row.title === '继承页面' || row.path.endsWith('继承稿.md')))
  assert.equal(产物引用(child.snapshotEvents(), child.id, f.root, inherited).filter(row => row.source === '读取').length, 0)
})

test('bash 的显式目录及原生 cwd 回执用于输出引用，项目产物和截图 DTO 保持项目相对', async t => {
  const f = await fixture(t)
  const session = Session.create(SessionId('artifact-cwd-receipts'))
  session.append('working-directory/change', { cwd: f.cwd })
  nativeCall(session, 'bash-workdir', 'bash', { command: '输出里没有猜路径', workdir: '资源' })
  session.append('working-directory/change', { cwd: f.root })
  nativeResult(session, 'bash-workdir', 'output.html')
  nativeCall(session, 'bash-result-cwd', 'bash', { command: '输出里没有猜路径' })
  nativeResult(session, 'bash-result-cwd', 'receipt.png', { cwd: join(f.cwd, '资源') })
  session.append('working-directory/change', { cwd: f.cwd })
  nativeCall(session, 'present', 'present_artifact', { entry: 'demo.html' })
  const declaration = { path: `${f.prefix}/demo.html`, declared: true, title: '正式展示', opening: 'preview' }
  nativeResult(session, 'present', JSON.stringify({ artifactVersion: 1, artifact: declaration }))
  nativeCall(session, 'screenshot', 'render_page', { entry: 'demo.html' })
  nativeResult(session, 'screenshot', JSON.stringify({ path: '素材/截图.png' }))
  const refs = 产物引用(session.snapshotEvents(), session.id, f.root)
  assert.deepEqual(refs.map(row => row.path), [`${f.prefix}/资源/output.html`, `${f.prefix}/资源/receipt.png`, `${f.prefix}/demo.html`, '素材/截图.png'])
  assert.equal(refs[2].declaration.path, declaration.path)
  assert.ok(!refs.some(row => row.path.includes('输出里没有猜路径')))
})
