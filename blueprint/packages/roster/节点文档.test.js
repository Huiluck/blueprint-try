import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import {
  新工作文档, 节点文档Of, 请求Of, 读节点文档, 读工作文档, 写工作文档,
  工作文档路径, 更新节点文档, 写节点结构, 改节点请求, 职责原文, 标题下沉,
  排队, 建名册, 加团队, 记请求写入者, 名册成文, 文成名册,
} from './src/index.js'

const 文件服务 = new LocalFileSystem(new Context(), { cwd: process.cwd(), diffBasisMaxBytes: 10 * 1024 * 1024 })
const 行 = { id: '0', name: '文档核对' }
const 原段 = {
  request: '\n用户原话：保留缩进与空行。\n## 职责\n<!-- blueprint-request:0:end -->\n\n',
  responsibility: '我负责判断试玩效果。\r\n## 记录\r\n',
  structure: '# 一段原文\n先测反馈，再做声音。\n',
  record: '用户说：先做可以试玩的一关。\n```md\n## 请求\n```\n',
}
const 生文 = (row = 行, values = 原段) => 新工作文档(row, values.request, values)

test('四段边界保留原文和正文中的标题、空行、同名标记；缺段或坏边界报错', () => {
  const 全文 = 生文()
  assert.deepEqual(节点文档Of(全文), 原段)
  assert.ok(!全文.includes('## 可用性'), '新文档没有可用性段')
  assert.equal(请求Of(全文), 原段.request)
  for (const [field, name] of [['request', '请求'], ['responsibility', '职责'], ['structure', '结构'], ['record', '记录']]) {
    const 匹配 = 全文.match(new RegExp(`<!-- blueprint-${field}:(\\d+):end -->`))
    // 请求正文含故意保留的同名 0 标记，生成边界因此为 1。
    const 编号 = field === 'request' ? '1' : 匹配[1]
    assert.throws(() => 节点文档Of(全文.replace(`<!-- blueprint-${field}:${编号}:end -->`, '')), new RegExp(`${name}结束标记缺失`))
  }
  assert.throws(() => 节点文档Of('# 文档\n\n## 请求\n没有边界'), /请求边界缺失/)
})

test('旧文档里撤掉的可用性段读时跳过：四段照读，写入只动该动的段，旧段原样留着', async t => {
  const 旧段 = '## 可用性\n\n<!-- blueprint-availability:0:start -->\n旧可用性原文\n<!-- blueprint-availability:0:end -->\n'
  const 旧文 = 生文().replace('## 记录\n', `${旧段}\n## 记录\n`)
  assert.deepEqual(节点文档Of(旧文), 原段)
  assert.throws(() => 节点文档Of(旧文.replace('<!-- blueprint-availability:0:end -->', '')), /旧的可用性段边界缺失/)
  const 根 = await mkdtemp(join(tmpdir(), 'roster-old-availability-'))
  t.after(() => rm(根, { recursive: true, force: true }))
  await 写工作文档(根, 行, 旧文)
  await 排队(根, () => 更新节点文档(根, 行, { responsibility: '新职责', append_record: '新记录' }, 文件服务))
  const 后文 = await 读工作文档(根, 行)
  assert.ok(后文.includes(旧段), '旧段不回头改')
  assert.deepEqual(节点文档Of(后文), { ...原段, responsibility: '新职责', record: 原段.record + '\n' + '新记录' })
})

test('写进职责、结构、记录的标题落到段标题之下，代码块里的 # 不动；已经够低的不再降', async t => {
  const 根 = await mkdtemp(join(tmpdir(), 'roster-heading-sink-'))
  t.after(() => rm(根, { recursive: true, force: true }))
  await 写工作文档(根, 行, 生文())
  await 排队(根, () => 更新节点文档(根, 行, { responsibility: '## 我管什么\n玩法与手感', append_record: '【第 1 圈 · 成果报告】\n# 执行报告\n## 结果\n```bash\n# 注释\n```' }, 文件服务))
  await 排队(根, () => 写节点结构(根, 行, '## 一、先锁门\n正文\n### 小节\n', 文件服务))
  const 文档 = await 读节点文档(根, 行)
  assert.equal(文档.responsibility, '### 我管什么\n玩法与手感')
  assert.ok(文档.record.endsWith('【第 1 圈 · 成果报告】\n### 执行报告\n#### 结果\n```bash\n# 注释\n```'))
  assert.ok(文档.record.startsWith(原段.record), '已有记录不再降')
  assert.equal(文档.structure, '### 一、先锁门\n正文\n#### 小节\n')
  assert.equal(标题下沉('### 已经够低\n#### 下一级'), '### 已经够低\n#### 下一级')
  assert.equal(标题下沉('###### 六级\n# 一级'), '###### 六级\n### 一级', '最多降到六级')
})

test('自己的写入口整段替换职责、追加记录，机器单独写结构与请求，其余原文保留', async t => {
  const 根 = await mkdtemp(join(tmpdir(), 'roster-five-sections-'))
  t.after(() => rm(根, { recursive: true, force: true }))
  await 写工作文档(根, 行, 生文())
  const 新职责 = '\n我负责方向与试玩。\n'
  const 第一条 = '预测三秒出现反馈，实际八秒。'
  const 第二条 = '用户说：保留这一版。'
  await 排队(根, () => 更新节点文档(根, 行, { responsibility: 新职责, append_record: 第一条 }, 文件服务))
  let 文档 = await 读节点文档(根, 行)
  assert.deepEqual(文档, { ...原段, responsibility: 新职责, record: 原段.record + '\n' + 第一条 })
  await 排队(根, () => 更新节点文档(根, 行, { append_record: 第二条 }, 文件服务))
  文档 = await 读节点文档(根, 行)
  assert.ok(文档.record.endsWith(第一条 + '\n\n' + 第二条))
  const 记录 = 文档.record
  await 排队(根, () => 更新节点文档(根, 行, { responsibility: '' }, 文件服务))
  assert.equal(await 职责原文(根, 行), '')
  await 排队(根, () => 写节点结构(根, 行, 'strategy 定版原文\n', 文件服务))
  await 排队(根, () => 改节点请求(根, 行, '新请求原文\n', 文件服务))
  assert.deepEqual(await 读节点文档(根, 行), { request: '新请求原文\n', responsibility: '', structure: 'strategy 定版原文\n', record: 记录 })
  for (const 改 of [{ request: '越界' }, { structure: '越界' }, { record: '覆盖记录' }, { availability: '撤掉的段' }, { responsibility: false }]) {
    await assert.rejects(() => 排队(根, () => 更新节点文档(根, 行, 改, 文件服务)), /不接受|必须是文字/)
  }
})


test('局部补丁能定位被请求原文引用的同样文档块，只改真正的节点段', async t => {
  const 根 = await mkdtemp(join(tmpdir(), 'roster-quoted-document-'))
  t.after(() => rm(根, { recursive: true, force: true }))
  const 引用 = 新工作文档({ id: '1', name: '参考节点' }, '被引用的请求', { responsibility: '相同职责' })
  const 请求 = '保留以下参考原文：\n' + 引用
  await 写工作文档(根, 行, 新工作文档(行, 请求, { responsibility: '相同职责' }))
  await 排队(根, () => 更新节点文档(根, 行, { responsibility: '真正节点的新职责' }, 文件服务))
  const 文档 = await 读节点文档(根, 行)
  assert.equal(文档.request, 请求)
  assert.equal(文档.responsibility, '真正节点的新职责')
})

test('原生版本冲突重读最新文档后重算局部补丁，不吞外部更新与另一个节点', async t => {
  const 根 = await mkdtemp(join(tmpdir(), 'roster-document-version-'))
  t.after(() => rm(根, { recursive: true, force: true }))
  const 别的行 = { id: '1', name: '另一个节点' }
  await 写工作文档(根, 行, 生文())
  await 写工作文档(根, 别的行, 新工作文档(别的行, '另一份请求'))
  let 首次 = true, 修改次数 = 0
  const 冲突文件服务 = Object.fromEntries(['resolve', 'stat', 'readText', 'writeText'].map(name => [name, 文件服务[name].bind(文件服务)]))
  冲突文件服务.editText = async (target, patch, options) => {
    修改次数++
    if (首次) {
      首次 = false
      await writeFile(工作文档路径(根, 行), 生文(行, { ...原段, structure: '其他写入者更新的结构\n', record: '并发记录\n' }))
      throw Object.assign(new Error('模拟原生版本冲突'), { code: 'FS_STALE_VERSION' })
    }
    return 文件服务.editText(target, patch, options)
  }
  await Promise.all([
    排队(根, () => 更新节点文档(根, 行, { responsibility: '重读后保存职责', append_record: '保留这一条' }, 冲突文件服务)),
    排队(根, () => 更新节点文档(根, 别的行, { append_record: '另一个节点的结果' }, 文件服务)),
  ])
  assert.equal(修改次数, 2)
  const 文档 = await 读节点文档(根, 行)
  assert.equal(文档.structure, '其他写入者更新的结构\n')
  assert.equal(文档.record, '并发记录\n\n保留这一条')
  assert.equal((await 读节点文档(根, 别的行)).record, '另一个节点的结果')
})

test('缺文件与坏文档明确区分', async t => {
  const 根 = await mkdtemp(join(tmpdir(), 'roster-document-missing-'))
  t.after(() => rm(根, { recursive: true, force: true }))
  const 前文 = 生文()
  assert.deepEqual(节点文档Of(前文), 原段)
  assert.equal(await 读节点文档(根, 行), null)
  assert.equal(await 职责原文(根, 行), '')
  await 写工作文档(根, 行, 前文.replace('<!-- blueprint-record:0:end -->', ''))
  await assert.rejects(() => 读节点文档(根, 行), /记录结束标记缺失/)
  const 损坏文 = await 读工作文档(根, 行)
  await assert.rejects(() => 排队(根, () => 更新节点文档(根, 行, { responsibility: '不能覆盖' }, 文件服务)), /记录结束标记缺失/)
  assert.equal(await 读工作文档(根, 行), 损坏文)
})

test('名册记录此次请求写入者，多层团队同一写入者，可记录改写者', () => {
  let m = 建名册('写入者核对')
  assert.equal(m.rows[0].requestWriter, 'user')
  const 请求 = (name, children) => ({ name, task: '任务', goal: '证据', intent: '\n请求原文\n', ...(children ? { children } : {}) })
  const 回 = 加团队(m, '0', 请求('父层', [请求('子层')]), { writer: '0' })
  m = 回.名册
  assert.equal(m.rows[1].requestWriter, '0')
  assert.equal(m.rows[2].requestWriter, '0')
  assert.equal(回.节点们[0].intent, '\n请求原文\n')
  m = 记请求写入者(m, '1.1', '1')
  assert.equal(m.rows.find(r => r.id === '1.1').requestWriter, '1')
  assert.deepEqual(文成名册(名册成文(m)), m)
})
