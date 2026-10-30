import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeContent } from '../runtime/initialize.mjs'

test('默认内容升级保留用户修改，未修改内容更新，重复初始化不覆盖', async t => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-defaults-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), destination = join(root, 'prompt'), manifest = join(root, 'defaults.json')
  await mkdir(join(source, 'shells'), { recursive: true })
  await writeFile(join(source, 'shells/a.md'), '默认 A1')
  await writeFile(join(source, 'shells/b.md'), '默认 B1')
  await initializeContent(source, destination, manifest)
  await writeFile(join(destination, 'shells/a.md'), '用户修改')
  await writeFile(join(source, 'shells/a.md'), '默认 A2')
  await writeFile(join(source, 'shells/b.md'), '默认 B2')
  await initializeContent(source, destination, manifest)
  await initializeContent(source, destination, manifest)
  assert.equal(await readFile(join(destination, 'shells/a.md'), 'utf8'), '用户修改')
  assert.equal(await readFile(join(destination, 'shells/b.md'), 'utf8'), '默认 B2')
  assert.equal(await readFile(join(root, '默认更新/shells/a.md'), 'utf8'), '默认 A2')
})

test('退役：新版默认里没有的文件，没改过的删掉并收掉空文件夹，改过的挪到 默认更新/退役/，用户自建的不动', async t => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-defaults-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), destination = join(root, 'prompt'), manifest = join(root, 'defaults.json')
  for (const d of ['shells', 'skill/try', 'skill/split', 'skill/intent']) await mkdir(join(source, d), { recursive: true })
  await writeFile(join(source, 'shells/核心.md'), '旧核心')
  await writeFile(join(source, 'skill/try/SKILL.md'), '旧页 try')
  await writeFile(join(source, 'skill/split/SKILL.md'), '旧页 split')
  await writeFile(join(source, 'skill/intent/SKILL.md'), '新页 intent')
  await initializeContent(source, destination, manifest)
  await writeFile(join(destination, 'skill/split/SKILL.md'), '用户改过的 split')
  await mkdir(join(destination, 'skill/mine'), { recursive: true })
  await writeFile(join(destination, 'skill/mine/SKILL.md'), '用户自建')
  await rm(join(source, 'skill/try'), { recursive: true })
  await rm(join(source, 'skill/split'), { recursive: true })
  await writeFile(join(source, 'shells/核心.md'), '新核心')
  await initializeContent(source, destination, manifest)
  await initializeContent(source, destination, manifest)
  await assert.rejects(access(join(destination, 'skill/try')), '没改过的旧页连同空文件夹一起收掉')
  await assert.rejects(access(join(destination, 'skill/split')), '改过的旧页也离开生效目录')
  assert.equal(await readFile(join(root, '默认更新/退役/skill/split/SKILL.md'), 'utf8'), '用户改过的 split')
  assert.equal(await readFile(join(destination, 'skill/mine/SKILL.md'), 'utf8'), '用户自建')
  assert.equal(await readFile(join(destination, 'shells/核心.md'), 'utf8'), '新核心')
  assert.equal(await readFile(join(destination, 'skill/intent/SKILL.md'), 'utf8'), '新页 intent')
})
