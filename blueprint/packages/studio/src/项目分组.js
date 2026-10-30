import { 听名册 } from '../../roster/src/index.js'
import { readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { 项目存储 } from '../../prompt/src/路径.js'
import { 项目删除中 } from '../../node/src/项目删除状态.js'
import { 创建名册读缓存 } from './名册读缓存.js'
import { 读项目名称, 项目显示名, 同步项目名称, 听项目名称 } from '../../node/src/项目名称.js'

/** 只登记工作区和标题；不为会话分组恢复、叫醒 Agent。 */
export function 接项目分组(ctx, projectRoot) {
  ctx.inject(['workspaceRegistry', 'sessionTitle', 'sessions', 'sessionPersistence', 'sessionProjections'], scoped => {
    const readRoster = 创建名册读缓存()
    const roots = () => typeof projectRoot === 'function' ? projectRoot() : [projectRoot]
    const owns = directory => roots().some(root => String(directory).startsWith(root + '/'))
    let timer, reading = false, again = false, disposed = false
    const warn = error => scoped.logger.warn(`Blueprint 项目分组：${error.message}`)
    async function sync() {
      if (disposed) return
      if (reading) { again = true; return }
      reading = true
      try {
        const headers = new Map((await scoped.sessionPersistence.list()).map(row => [String(row.header.id), row.header]))
        for (const session of scoped.sessions.list()) headers.set(String(session.id), session.header)
        for (const base of roots()) for (const entry of await readdir(base, { withFileTypes: true }).catch(error => { if (error.code !== 'ENOENT') warn(error); return [] })) {
          if (!entry.isDirectory() || disposed) continue
          const directory = join(base, entry.name)
          if (项目删除中(directory)) continue
          try {
            const roster = await readRoster(directory)
            if (!roster?.rows.length) continue
            const canonical = await realpath(directory)
            if (项目删除中(directory)) continue
            const workspace = await scoped.workspaceRegistry.create(directory, 项目显示名(await 读项目名称(directory), entry.name))
            if (项目删除中(directory) || await realpath(directory).catch(() => '') !== canonical) {
              await scoped.workspaceRegistry.delete(workspace.id); continue
            }
            await 同步项目名称(directory, workspace)
            const members = new Set(workspace.sessionIds)
            // 注册归属按原生不可变 cwd 验证；包括同目录支线与子会话。
            for (const [id, header] of headers) {
              if (!header.cwd || members.has(id)) continue
              if (await realpath(header.cwd).catch(() => '') === canonical) await workspace.attachSession(id)
            }
            for (const row of roster.rows) {
              const session = row.session && scoped.sessions.get(String(row.session))
              if (!session || !row.name) continue
              // 原生 title 投影避免复制正文；用户或自动生成的已有标题照留。
              const title = scoped.get('sessionProjections')?.snapshot(session, ['title']).values.title
              if (!title && !scoped.sessionTitle.get(session)?.title) scoped.sessionTitle.rename(session, `${row.id} ${row.name}`)
            }
          } catch (error) { warn(error) }
        }
      } catch (error) { warn(error) }
      finally { reading = false; if (again && !disposed) { again = false; schedule() } }
    }
    function schedule() { if (disposed) return; clearTimeout(timer); timer = setTimeout(() => void sync(), 250) }
    scoped.on('session/created', schedule)
    const offRoster = 听名册(root => { if (owns(root)) schedule() })
    const offNames = 听项目名称(root => { if (owns(root)) schedule() })
    const offStorage = 项目存储.subscribe(schedule)
    void sync()
    scoped.on('dispose', () => { disposed = true; clearTimeout(timer); offRoster(); offNames(); offStorage() })
  })
}
