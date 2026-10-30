import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 规范技能选择, 读技能选择, 写技能选择 } from './src/项目技能.js'
import { 参数 } from './skill/resource-reuse/scripts/搜.mjs'

test('旧搜索选择映射为统一入口，保留其他选择及未选择状态；读取不改写旧文件', async t => {
  const root = await mkdtemp(join(tmpdir(), 'Blueprint资源入口选择-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '系统文档')); await mkdir(join(root, '作品'))
  assert.equal(await 读技能选择(root), null)
  const old = JSON.stringify({ skills: ['look', 'asset-search', 'audio-search', 'resource-reuse'] }, null, 2)
  const file = join(root, '系统文档', '技能.json')
  await writeFile(file, old)
  assert.deepEqual(await 读技能选择(join(root, '作品')), ['look', 'resource-reuse'])
  assert.equal(await readFile(file, 'utf8'), old)
  assert.deepEqual(规范技能选择([]), [])
  await 写技能选择(root, ['audio-search', 'impeccable'])
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).skills, ['impeccable', 'resource-reuse'])
})

test('统一检索接受视觉和声音条件；未知时长由结果处理，错误条件明确失败', () => {
  assert.deepEqual(参数(['--kind', '3d', '--source', 'polyhaven', 'wooden', 'table']).词, 'wooden table')
  const audio = 参数(['--kind', 'sfx', '--source', 'wikimedia', '--max-duration', '3', '--json', 'metal impact'])
  assert.equal(audio.source, 'commons'); assert.equal(audio.最长, 3); assert.equal(audio.json, true)
  assert.throws(() => 参数(['--kind', 'unused', 'wood']), /--kind/)
  assert.throws(() => 参数(['--min-duration', '4', '--max-duration', '3', 'sound']), /最短时长/)
  assert.throws(() => 参数(['--unknown', 'sound']), /未知参数/)
})

test('只保留一个可发现入口；旧 CLI 为小型兼容壳', async () => {
  for (const name of ['asset-search', 'audio-search']) {
    await assert.rejects(access(new URL(`./skill/${name}/SKILL.md`, import.meta.url)), { code: 'ENOENT' })
    const wrapper = await readFile(new URL(`./skill/${name}/scripts/搜.mjs`, import.meta.url), 'utf8')
    assert.match(wrapper, /resource-reuse\/scripts\/搜.mjs/)
    assert.ok(wrapper.length < 1400)
  }
  const guide = await readFile(new URL('./skill/resource-reuse/SKILL.md', import.meta.url), 'utf8')
  assert.match(guide, /scripts\/搜.mjs/); assert.match(guide, /scripts\/查渠道.mjs/)
})
