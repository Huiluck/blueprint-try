import { mkdir, readdir, readFile, writeFile, copyFile, rmdir, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/**
 * 按默认内容的指纹升级；用户已修改的文件保留，新默认值另外留档。
 * 退役：上一版默认里有、这一版没有的文件，用户没改过的删掉，改过的挪到 `默认更新/退役/`——
 * 都不留在生效目录里，免得撤下的旧页面继续被模型读到。用户自己新建的文件（从来不在默认里）不动。
 */
export async function initializeContent(source, destination, manifestPath) {
  const { createHash } = await import('node:crypto')
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  const previous = JSON.parse(await readFile(manifestPath, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return '{}' }))
  const next = {}
  async function visit(relative = '') {
    for (const item of await readdir(join(source, relative), { withFileTypes: true })) {
      const rel = join(relative, item.name), target = join(destination, rel)
      if (item.isSymbolicLink()) throw new Error(`默认内容不允许软链接：${rel}`)
      if (item.isDirectory()) { await mkdir(target, { recursive: true }); await visit(rel); continue }
      const bytes = await readFile(join(source, rel)), digest = hash(bytes)
      let current
      try { current = await readFile(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
      await mkdir(join(target, '..'), { recursive: true })
      if (!current || hash(current) === previous[rel]) await writeFile(target, bytes)
      else if (hash(current) !== digest && previous[rel] !== digest) {
        const incoming = join(destination, '..', '默认更新', rel)
        await mkdir(join(incoming, '..'), { recursive: true })
        await copyFile(join(source, rel), incoming)
      }
      next[rel] = digest
    }
  }
  async function retire() {
    for (const [rel, digest] of Object.entries(previous)) {
      if (Object.hasOwn(next, rel)) continue
      const target = join(destination, rel)
      let current
      try { current = await readFile(target) } catch (error) { if (error.code !== 'ENOENT') throw error; continue }
      if (hash(current) !== digest) {
        const kept = join(destination, '..', '默认更新', '退役', rel)
        await mkdir(join(kept, '..'), { recursive: true })
        await copyFile(target, kept)
      }
      await unlink(target)
      // 顺手收掉因此空出来的文件夹（比如撤下的一页 skill），到生效目录为止。
      for (let dir = dirname(target); resolve(dir) !== resolve(destination); dir = dirname(dir)) {
        try { await rmdir(dir) } catch (error) { if (['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) break; throw error }
      }
    }
  }
  await mkdir(destination, { recursive: true })
  await visit()
  await retire()
  const temporary = `${manifestPath}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(next, null, 2))
  const { rename } = await import('node:fs/promises')
  await rename(temporary, manifestPath)
}
