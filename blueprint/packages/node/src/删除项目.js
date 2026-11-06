/** 用户确认后停稳整个项目，再交给 macOS 原生回收站；会话日志保留。 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { 读名册, 行Of, 排队, 关名册 } from '../../roster/src/index.js'
import { 停下项目 } from './项目停下.js'
import { 停止后台 } from './会话.js'
import { 停用持续工作 } from './持续工作.js'
import { 关闭节点终端 } from './终端.js'
import { 删除中的项目 } from './项目删除状态.js'

const run = promisify(execFile), requests = new Map()
async function 系统回收站(root) {
  if (process.platform === 'win32') {
    // 没有 /usr/bin/trash；用 Shell 的回收站接口，失败时目录留在原位。
    const quoted = root.replaceAll("'", "''")
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${quoted}','OnlyErrorDialogs','SendToRecycleBin')`], { timeout: 60000 })
    return
  }
  if (process.platform !== 'darwin') throw new Error('此部署暂不支持系统回收站，项目文件未移动')
  await run('/usr/bin/trash', ['-s', root])
}
const service = (ctx, name) => ctx.get?.(name) || ctx.root?.get?.(name)

async function 验项目(root, projectRoot, sessionId) {
  const [base, canonical, info] = await Promise.all([realpath(projectRoot), realpath(root), lstat(root)])
  if (!info.isDirectory() || info.isSymbolicLink() || canonical !== resolve(root) || dirname(canonical) !== base)
    throw new Error('只能删除项目目录下的完整 Blueprint 项目，不能移动其他目录或符号链接')
  const roster = await 读名册(root)
  if (!roster || 行Of(roster, '0').session !== sessionId) throw new Error('项目身份已改变，请刷新后重试')
  return { roster, dev: info.dev, ino: info.ino }
}

// 包含同项目分叉和无 cwd 的辅助会话；明确属于其他目录的会话不会被父链带入。
function 项目Actors(ctx, root, sessions) {
  return [...ctx.root.agents.list()].filter(actor => {
    let session = actor.session
    const seen = new Set()
    while (session && !seen.has(session.id)) {
      if (session.header?.cwd) return resolve(session.header.cwd) === root
      if (sessions.has(session.id)) return true
      seen.add(session.id)
      const parent = session.header?.parentSession
      session = ctx.root.agents.get(parent)?.session || ctx.sessions.get(parent)
    }
    return false
  })
}

async function 停稳项目(ctx, root, sessionIds) {
  await 停下项目(ctx, root)
  const handled = new Set()
  for (let pass = 0; pass < 5; pass++) {
    const fresh = 项目Actors(ctx, root, sessionIds).filter(actor => !handled.has(actor))
    if (!fresh.length) return
    停用持续工作(ctx, fresh)
    for (const actor of fresh) { handled.add(actor); sessionIds.add(actor.session.id); actor.cancel({ kind: 'user' }, { keepInbox: true }) }
    await 停止后台(ctx, fresh)
    await Promise.all(fresh.map(actor => actor.whenIdle()))
    await 关闭节点终端(ctx, fresh, '用户删除项目，关闭所属终端')
    await service(ctx, 'blueprintExecutionFeatures')?.releaseResources(fresh)
    await Promise.all(fresh.map(actor => ctx.sessions.flush(actor.session)))
  }
  throw new Error('项目仍有新执行产生，已停下项目，请稍后重试删除')
}

export function 删除项目(ctx, directory, payload, { projectRoot, beforeMove = async () => {}, trash = 系统回收站 } = {}) {
  const { projectSessionId, projectPath, requestId } = payload || {}
  if (!directory || !projectRoot || !projectSessionId || !projectPath || typeof requestId !== 'string' || !requestId || requestId.length > 200)
    throw new Error('删除缺少项目身份、目录或请求编号')
  const root = resolve(directory)
  if (resolve(projectPath) !== root) throw new Error('项目路径与会话归属不一致，请刷新后重试')
  const key = JSON.stringify([root, projectSessionId, requestId])
  if (requests.has(key)) return requests.get(key)
  if (删除中的项目.has(root)) throw new Error('项目正在移入回收站，请等待完成')
  删除中的项目.add(root)
  const task = (async () => {
    const original = await 验项目(root, projectRoot, projectSessionId)
    const registry = service(ctx, 'workspaceRegistry')
    if (!registry?.list || !registry?.delete || !registry?.create) throw new Error('工作区服务不可用，项目文件未移动')
    const sessionIds = new Set(original.roster.rows.flatMap(row => [row.session, ...(row.priorSessions || [])]).filter(Boolean))
    await 停稳项目(ctx, root, sessionIds)
    await beforeMove([...sessionIds])
    return 排队(root, async () => {
      const current = await 验项目(root, projectRoot, projectSessionId)
      if (current.dev !== original.dev || current.ino !== original.ino) throw new Error('项目目录已被替换，未移动文件')
      const removed = []
      try {
        for (const workspace of registry.list()) {
          if (await realpath(workspace.path).catch(() => '') !== root) continue
          const record = { path: workspace.path, title: workspace.title, sessionIds: [...workspace.sessionIds] }
          await registry.delete(workspace.id)
          removed.push(record)
        }
        // 任务库（系统文档/任务.db）先关掉连接，再整个文件夹挪走。
        关名册(root)
        await trash(root)
        if (await lstat(root).then(() => true, () => false)) throw new Error('系统未完成文件夹移动')
      } catch (error) {
        // 原生回收站失败时目录仍在原位；恢复已移除的工作区登记，保留可重试入口。
        if (await lstat(root).then(() => true, () => false)) {
          try {
            for (const record of removed) {
              const workspace = await registry.create(record.path, record.title || basename(record.path))
              for (const id of record.sessionIds) await workspace.attachSession(id)
            }
          } catch (restoreError) { throw new AggregateError([error, restoreError], '项目文件仍在原位，工作区登记恢复失败，请刷新项目列表') }
          throw new Error(`未移入回收站，项目文件仍在原位，执行已停下：${error.message}`)
        }
        throw error
      }
      return { trashed: true, projectPath: root, projectSessionId, sessionIds: [...sessionIds] }
    })
  })()
  requests.set(key, task)
  task.then(() => { while (requests.size > 64) requests.delete(requests.keys().next().value) }, () => requests.delete(key))
  return task.finally(() => 删除中的项目.delete(root))
}
