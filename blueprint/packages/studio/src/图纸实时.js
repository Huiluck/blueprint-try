import { watch, watchFile, unwatchFile } from 'node:fs'
import { stat, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { 文档夹名, 名册文件名 } from '../../roster/src/index.js'

const fileStamp = async path => {
  try {
    const s = await stat(path, { bigint: true })
    return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':')
  } catch (error) { if (error.code === 'ENOENT') return ''; throw error }
}
const contentHash = async path => {
  try { return createHash('sha256').update(await readFile(path)).digest('hex') }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error }
}

/** 只读树通过现有 stream 推送；HTTP 重读仅由名册文件签变化通知触发。 */
export function 创建图纸实时({ read, send }) {
  const projects = new Map()
  function schedule(item) {
    clearTimeout(item.timer)
    item.timer = setTimeout(async () => {
      if (item.reading) { item.again = true; return }
      item.reading = true
      try {
        const tree = await read(item.root)
        if (projects.get(item.root) !== item) return
        item.tree = tree
        send({ type: 'blueprint.tree', root: item.root, tree })
      } catch (error) { send({ type: 'blueprint.tree_error', root: item.root, message: error.message }) }
      finally { item.reading = false; if (item.again) { item.again = false; schedule(item) } }
    }, 250)
  }
  function remove(item) {
    clearTimeout(item.timer); item.watcher?.close()
    if (item.checkRoster) unwatchFile(item.path, item.checkRoster)
    projects.delete(item.root)
  }
  return {
    async track(root, cwd, tree, rows, supplement = false) {
      const prior = projects.get(root)
      if (prior) { prior.tree = tree; prior.ids = new Set(rows.map(r => r.id)); if (supplement) schedule(prior); return }
      // 名册在 `系统文档/任务.db`（SQLite，每次提交都改主文件），照旧按文件签和内容盯着它。
      const directory = join(cwd, 文档夹名), path = join(directory, 名册文件名)
      const item = { root, tree, path, ids: new Set(rows.map(r => r.id)), stamp: await fileStamp(path), hash: await contentHash(path) }
      projects.set(root, item)
      item.checkRoster = () => {
        void fileStamp(path).then(async stamp => {
          if (projects.get(root) !== item || stamp === item.stamp) return
          item.stamp = stamp
          const hash = await contentHash(path)
          if (projects.get(root) !== item) return
          if (hash !== item.hash) { item.hash = hash; send({ type: 'blueprint.roster_changed', root }) }
        }).catch(error => send({ type: 'blueprint.tree_error', root, message: error.message }))
      }
      // 名册单文件签轮询也覆盖 sandbox 中不投递原生目录事件的环境。
      watchFile(path, { persistent: false, interval: 250 }, item.checkRoster)
      try {
        item.watcher = watch(directory, { recursive: true }, () => {
          item.checkRoster()
          schedule(item) // 总图景、纸条、模型等只读投影也随文件变化推送。
        })
        item.watcher.on('error', error => send({ type: 'blueprint.tree_error', root, message: error.message }))
      } catch (error) { send({ type: 'blueprint.tree_error', root, message: error.message }) }
      if (supplement) schedule(item)
      while (projects.size > 16) remove(projects.values().next().value)
    },
    update(session) {
      for (const item of projects.values()) if (!session || item.ids.has(String(session))) schedule(item)
    },
    forget(root) { const item = projects.get(root); if (item) remove(item) },
    snapshots() { return [...projects.values()].map(item => ({ type: 'blueprint.tree', root: item.root, tree: item.tree })) },
    dispose() { for (const item of [...projects.values()]) remove(item) },
  }
}
