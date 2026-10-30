// 只调用固定版本 DSH 的原样构建器；资源可随 App 搬走，不借用户的 Python 环境。
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { preparePrimaryRuntime, smokePrimaryRuntime } from './dsh-primary-runtime/prepare.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export async function prepareOfficeResources({ output = join(root, '.build/native-resources'), cache = join(root, '.build/official-resource-downloads'), verify = true } = {}) {
  const source = JSON.parse(await readFile(new URL('./dsh-primary-runtime/official-source.json', import.meta.url), 'utf8'))
  for (const [name, digest] of Object.entries(source.files)) {
    const bytes = await readFile(new URL('./dsh-primary-runtime/' + name, import.meta.url))
    if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('DSH 官方资源构建器已改变：' + name)
  }
  const target = ({ darwin: 'mac', linux: 'linux', win32: 'win' })[process.platform] + '-' + process.arch
  await mkdir(output, { recursive: true })
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  await preparePrimaryRuntime({ target, output, cache, version: manifest.version, pythonOnly: true })
  if (verify) smokePrimaryRuntime(join(output, 'primary-runtime'))
  return { directory: output, target, officialCommit: source.commit }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareOfficeResources({ ...(process.argv[2] ? { output: resolve(process.argv[2]) } : {}) })
    .then(value => console.log(JSON.stringify(value)))
    .catch(error => { console.error(error); process.exitCode = 1 })
}
