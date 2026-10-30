// 只在副本核对旧项目与原生日志；真实模型、现用 profile 与源项目不参与运行。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readlink, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, relative } from 'node:path'
import { 读名册, 读纸条, 读节点文档 } from '../../blueprint/packages/roster/src/index.js'
import { 装会话事实, 节点会话事实 } from '../../blueprint/packages/node/src/会话事实.js'
import { 运行卡点 } from '../../blueprint/packages/node/src/条件等待.js'
import { 在等回条 } from '../../blueprint/packages/node/src/纸条等待.js'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..'), repository = resolve(app, '..')
const source = await realpath(process.argv[2]), reportPath = resolve(process.argv[3])
assert.equal(dirname(source), join(repository, '项目'), '只选择当前项目目录中的旧项目')
const require = createRequire(join(app, 'package.json'))
const load = name => import(pathToFileURL(require.resolve('@deepseek-ai/' + name)).href)
const base = await mkdtemp(join(app, '.build/旧项目恢复验收-')), copy = join(base, '项目副本'), store = join(base, '会话副本')
const report = { engine: '0.2.1-alpha.2', source, copy, status: 'failed', files: 0, sessions: [], modelRequests: 0 }
const contexts = []
const sourceLogs = new Map()
async function hashes(root) {
  const result = new Map()
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const path = join(directory, entry.name), key = relative(root, path)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isSymbolicLink()) result.set(key, 'link:' + await readlink(path))
      else if (entry.isFile()) {
        const hash = createHash('sha256')
        for await (const chunk of createReadStream(path)) hash.update(chunk)
        result.set(key, hash.digest('hex'))
      }
    }
  }
  await walk(root); return result
}
try {
  const before = await hashes(source)
  await cp(source, copy, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true,
    filter: path => !path.split('/').includes('.git') })
  assert.deepEqual(await hashes(copy), before, '复制后所有文件与链接保留')
  report.files = before.size
  const roster = await 读名册(copy), notes = await 读纸条(copy)
  report.nodes = roster.rows.length; report.notes = notes.length
  for (const row of roster.rows) assert.ok(await 读节点文档(copy, row), `节点 ${row.id} 文档可恢复`)
  report.artifacts = []
  for (const row of roster.rows.filter(row => row.artifact?.path)) {
    const path = resolve(copy, row.artifact.path), key = relative(copy, path)
    assert.ok(key && key !== '..' && !key.startsWith('../'), '成果入口属于副本')
    assert.ok((await stat(path)).isDirectory(), `节点 ${row.id} 成果目录可恢复`)
    report.artifacts.push({ node: row.id, path: row.artifact.path, commit: row.artifact.commit,
      files: [...before.keys()].filter(name => name.startsWith(key + '/')).length })
  }
  await mkdir(store)
  const folders = await readdir(join(repository, '.dsh/sessions'))
  for (const row of roster.rows.filter(row => row.session)) {
    let located
    for (const folder of folders) {
      const directory = join(repository, '.dsh/sessions', folder, row.session)
      const names = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      if (!names.some(name => /^session\.v\d\.jsonl/.test(name))) continue
      located = { directory, folder, names }; break
    }
    assert.ok(located, `节点 ${row.id} 的会话日志存在`)
    const logHashes = await hashes(located.directory)
    logHashes.delete('session.lock')
    sourceLogs.set(located.directory, logHashes)
    const destination = join(store, located.folder, row.session)
    await mkdir(destination, { recursive: true })
    for (const name of located.names.filter(name => name !== 'session.lock')) await cp(join(located.directory, name), join(destination, name), { recursive: true })
  }
  const { Context } = await load('cordis'), { SessionId } = await load('dsh-session')
  const ctx = new Context(); contexts.push(ctx)
  for (const name of ['dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent']) await ctx.plugin((await load(name)).default)
  await ctx.plugin((await load('dsh-session-persistence-jsonl')).default, { root: store, compression: 'zstd' })
  装会话事实(ctx)
  const live = new Context(); contexts.push(live)
  for (const name of ['dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent']) await live.plugin((await load(name)).default)
  await live.plugin((await load('dsh-agent-loop')).default, { agents: [] })
  装会话事实(live)
  const { LlmAdapter } = await load('dsh-llm')
  class NoModel extends LlmAdapter { async *stream() { report.modelRequests++; throw new Error('旧项目验收禁止模型请求') } }
  live.llm.registerAdapter(['old-copy-no-model'], new NoModel())
  for (const row of roster.rows.filter(row => row.session)) {
    const reader = await ctx.sessionPersistence.open(SessionId(row.session), 'read')
    try {
      const events = (await reader.read()).events
      const header = { ...reader.header, cwd: copy }
      const handle = await live.agents.create({ sessionId: SessionId(row.session), seed: events, meta: header,
        agentOptions: { provider: 'old-copy-no-model', model: 'none' } })
      const agent = handle.agent, facts = 节点会话事实(live, agent.session)
      const messages = agent.session.deriveMessages()
      report.sessions.push({ node: row.id, version: reader.header.version, events: events.length, messages: messages.length,
        coldRestored: agent.status === 'idle', userStopped: facts?.userStopped, receivedInputs: facts?.received.length,
        waitingPoints: (await 运行卡点(live, agent.session)).length,
        awaitingNotes: 在等回条(notes, row.id, roster, agent.session, live).length })
      await handle.dispose()
    } finally { await reader.close() }
  }
  assert.equal(report.modelRequests, 0)
  assert.deepEqual(await hashes(source), before, '源项目文件与链接均未改变')
  for (const [directory, beforeLogs] of sourceLogs) {
    const afterLogs = await hashes(directory); afterLogs.delete('session.lock')
    assert.deepEqual(afterLogs, beforeLogs, '原会话日志未改变')
  }
  report.sourceLogsUnchanged = true
  report.sourceUnchanged = true; report.status = 'passed'
} catch (error) {
  report.error = String(error.message || error).slice(0, 600); process.exitCode = 1
} finally {
  for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, nodes: report.nodes, files: report.files,
    sessions: report.sessions.length, sourceUnchanged: report.sourceUnchanged, modelRequests: report.modelRequests, error: report.error }))
}
