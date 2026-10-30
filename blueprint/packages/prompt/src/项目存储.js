/** 默认位置仅决定新项目；历史位置持续保留，项目身份仍取原生会话 cwd。 */
import { readFileSync, realpathSync, existsSync } from 'node:fs'
import { mkdir, open, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

const canonical = path => { try { return realpathSync(path) } catch (error) { if (error.code === 'ENOENT') return resolve(path); throw error } }
export function 创建项目存储({ dataRoot, documents = join(homedir(), 'Documents'), home = homedir(), protectedRoots = [], io = { mkdir, open, readdir } }) {
  const file = join(dataRoot, '项目存储.json'), legacyRoot = resolve(dataRoot, '项目'), suggestedRoot = resolve(documents, 'Blueprint', '项目')
  let persisted = false, state
  try {
    state = JSON.parse(readFileSync(file, 'utf8')); persisted = true
    if (state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !isAbsolute(state.defaultRoot || '')
      || !Array.isArray(state.roots) || state.roots.some(root => typeof root !== 'string' || !isAbsolute(root))) throw new Error('格式不正确')
  } catch (error) { if (error.code !== 'ENOENT') throw new Error(`项目存储设置读不出来：${error.message}`) }
  state = { version: 1, revision: 0, defaultRoot: suggestedRoot, roots: [], ...state }
  state.roots = [...new Set([legacyRoot, ...state.roots, state.defaultRoot])]
  const listeners = new Set(), snapshot = () => ({ ...state, roots: [...state.roots], suggestedRoot })
  let tail = Promise.resolve()
  const serial = task => { const run = tail.catch(() => {}).then(task); tail = run; return run }
  async function save(next) {
    await mkdir(dataRoot, { recursive: true })
    const temporary = join(dataRoot, `.项目存储-${randomUUID()}.json`)
    try { await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file) }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    state = next; persisted = true
    for (const listener of listeners) { try { listener(snapshot()) } catch {} }
    return snapshot()
  }
  const notify = () => { for (const listener of listeners) { try { listener(snapshot()) } catch {} } }
  const accessError = (error, path) => {
    if (!['EPERM', 'EACCES', 'EROFS'].includes(error.code)) return error
    return Object.assign(new Error(`无法访问项目保存位置：${path}。请授权访问此文件夹，或在「项目与存储」中选择可读写的位置。`),
      { code: 'PROJECT_STORAGE_PERMISSION', path, systemCode: error.code, cause: error })
  }
  async function status() {
    const path = state.defaultRoot
    try { await io.readdir(path); return { ok: true, exists: true, path } }
    catch (error) {
      if (error.code === 'ENOENT') return { ok: true, exists: false, path }
      const failure = accessError(error, path)
      return { ok: false, path, code: failure.code, message: failure.message }
    }
  }
  async function prepare(value) {
    try { return await prepareDirectory(value) }
    catch (error) { throw accessError(error, typeof value === 'string' ? value : state.defaultRoot) }
  }
  async function prepareDirectory(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\x00-\x1f]/.test(value)) throw new Error('请选择有效的文件夹路径')
    const entered = value.trim(), path = resolve(entered === '~' ? home : entered.startsWith('~/') ? join(home, entered.slice(2)) : entered)
    if (!isAbsolute(entered) && entered !== '~' && !entered.startsWith('~/')) throw new Error('请使用文件夹的完整路径')
    const target = canonical(path), blocked = [home, dataRoot, ...protectedRoots].map(canonical)
    if (target === parse(target).root || blocked.includes(target)) throw new Error('请选择专门保存项目的文件夹')
    for (let parent = target; ; parent = dirname(parent)) {
      if (existsSync(join(parent, '系统文档', '任务.db')) || existsSync(join(parent, '系统文档', '名册.yaml'))) throw new Error('不能在已有项目内部保存新项目')
      if (dirname(parent) === parent) break
    }
    await io.mkdir(path, { recursive: true })
    const root = realpathSync(path)
    await io.readdir(root)
    // 用独占小文件核对实际可写；失败不会改变默认位置。
    const probe = join(root, `.Blueprint写入检查-${randomUUID()}`)
    const handle = await io.open(probe, 'wx')
    try { await handle.close() } finally { await unlink(probe) }
    return root
  }
  return {
    snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    initialize() { return serial(() => persisted ? snapshot() : save(state)) },
    roots() { return snapshot().roots },
    parentOf(directory) {
      if (!directory) return null
      const parent = dirname(canonical(directory))
      return state.roots.find(root => { try { return canonical(root) === parent } catch { return false } }) || null
    },
    setDefault(value, expectedRevision) { return serial(async () => {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== state.revision) throw new Error('保存位置已更新，请重新读取后再更改')
      const root = await prepare(value)
      if (root === state.defaultRoot && persisted) { notify(); return snapshot() }
      return save({ version: 1, revision: state.revision + 1, defaultRoot: root, roots: [...new Set([...state.roots, state.defaultRoot, root])] })
    }) },
    status,
    prepareDefault(expectedRevision) { return serial(async () => {
      if (expectedRevision !== undefined && expectedRevision !== state.revision) throw new Error('保存位置已更新，请重新读取后再创建')
      return prepare(state.defaultRoot)
    }) },
  }
}
