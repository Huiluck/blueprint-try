import { cp, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const corePackages = ['context', 'node', 'prompt', 'roster', 'studio', 'layout', 'canvas', 'brand', 'files', 'feed', 'workspace', 'skill', 'media']
const excluded = new Set(['node_modules', '.git', '.DS_Store', '旧', '.cache', 'evaluation'])

export async function copySource(source, destination, { tests = false } = {}) {
  await mkdir(join(destination, 'blueprint/packages'), { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml', 'agent.cordis.yml', 'preset.yml', 'register-preset.mjs']) {
    await cp(join(source, 'blueprint', file), join(destination, 'blueprint', file))
  }
  for (const name of corePackages) {
    const base = join(source, 'blueprint/packages', name)
    const target = join(destination, 'blueprint/packages', name)
    await cp(base, target, { recursive: true, dereference: false, filter: async path => {
      if (path.split('/').some(part => excluded.has(part))) return false
      if (!tests && /\.test\.js$/.test(path)) return false
      return true
    } })
  }
  // 旧 viewer 页面 10-15 下线，运行时不再读它；只随导出源码给它自己的测试用。
  // 例外是界面语言的机制和英文表：服务端拼给界面的句子（studio/src/界面语言.js）运行时要读这两份。
  if (tests) await cp(join(source, 'viewer'), join(destination, 'viewer'), { recursive: true,
    filter: path => !path.split('/').some(part => excluded.has(part)) })
  else {
    await mkdir(join(destination, 'viewer'), { recursive: true })
    for (const file of ['界面语言.js', '英文.json']) await cp(join(source, 'viewer', file), join(destination, 'viewer', file))
  }
  await assertNoLinks(destination)
}

export async function assertNoLinks(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    const target = join(path, item.name)
    if (item.isSymbolicLink()) throw new Error(`发布资源包含不能搬走的软链接：${target}`)
    if (item.isDirectory()) await assertNoLinks(target)
  }
}
