import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { 建名册, 加行, 工作文档相对, 节点总表成文, 呈现节点总表入口 } from './src/index.js'
import { 成果入口, 组织情境, 呈现成果发布, 呈现等待事实 } from './src/组织.js'

test('协作呈现只转换真实文件字段，保留业务原文与正式Git身份，未传根仍输出旧相对入口', () => {
  const root = '/项目/正式协作 空格'
  const artifact = { node: '1', branch: 'node-1', path: '作品空间/1', commit: 'a'.repeat(40) }
  const publication = { key: '参考结果', summary: '请根据 素材/原话.md 判断', entries: ['素材/参考.md'], version: 1 }
  const before = structuredClone({ artifact, publication })
  assert.equal(呈现成果发布(publication), publication)
  assert.deepEqual(呈现成果发布(publication, root), { ...publication, entries: [join(root, '素材/参考.md')] })
  assert.deepEqual(呈现等待事实([{ ready: true, publication }, { ready: true, job: { cwd: '作业原始目录' } }], root),
    [{ ready: true, publication: { ...publication, entries: [join(root, '素材/参考.md')] } }, { ready: true, job: { cwd: '作业原始目录' } }])
  assert.deepEqual({ artifact, publication }, before)
  let roster = 加行(建名册('用户请求'), '0', { name: '已交回提供者' }).名册
  roster = { ...roster, rows: roster.rows.map(row => row.id === '1' ? { ...row, status: '完成', artifact,
    handoff: '业务原文：作品空间/1/main.js', result: 'achieved' } : { ...row, after: ['1'] }) }
  const old = 成果入口(roster, '1'), actual = 成果入口(roster, '1', root), row = roster.rows[1]
  assert.ok(old.includes(`节点文档：${工作文档相对(row)}`))
  assert.ok(actual.includes(`节点文档：${join(root, 工作文档相对(row))}`))
  assert.ok(actual.includes(JSON.stringify({ ...artifact, path: join(root, artifact.path) })))
  assert.ok(actual.includes(row.handoff), '业务交回文字不递归改写')
  const organization = 组织情境(roster, '0', root)
  assert.ok(organization.includes(join(root, 工作文档相对(row)))); assert.ok(organization.includes(join(root, artifact.path)))
})

test('任务表只呈现完整匹配的机器发布行，summary、未知行及其他区原文不改，持久任务表仍相对', () => {
  const root = '/项目/发布入口核对'
  const publication = { key: '实际成果', version: 2, summary: '用途原文：素材/结果.md | 仍是判断材料\n保留下一句', entries: ['素材/结果.md'] }
  const roster = { ...建名册('用户请求'), rows: [{ ...建名册('用户请求').rows[0], publications: [publication] }] }
  const stored = 节点总表成文(roster)
  const machineLine = stored.split('\n').find(line => line.startsWith('| 0 | 实际成果 |'))
  const unknown = machineLine.replace('实际成果', '未知旧成果'), changedMetadata = machineLine.replace('仍是判断材料', '正文已有未知改动')
  const original = `用户自己的引用：素材/结果.md\n${machineLine}\n${stored}${unknown}\n${changedMetadata}\n## 自己写下的资料\n${machineLine}\n末尾原文`
  const projected = 呈现节点总表入口(original, roster, root)
  const absoluteLine = machineLine.replace(/；素材\/结果.md \|$/, `；${join(root, '素材/结果.md')} |`)
  assert.ok(projected.includes(absoluteLine))
  assert.ok(projected.includes(`用户自己的引用：素材/结果.md\n${machineLine}\n`))
  assert.ok(projected.includes(`${unknown}\n${changedMetadata}\n## 自己写下的资料\n${machineLine}\n末尾原文`))
  assert.equal(projected.split('用途原文：素材/结果.md').length, original.split('用途原文：素材/结果.md').length)
  assert.equal(呈现节点总表入口(original, roster), original)
  assert.equal(节点总表成文(roster), stored)
})
