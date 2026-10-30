import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, mkdir, symlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { 规范项目附件, 附件需求原话, 保存项目附件, 项目附件上限 } from '../../blueprint/packages/node/src/项目附件.js'

const attachment = (name, text) => ({ name, data: Buffer.from(text).toString('base64') })

test('Brief 文件原字节保存，同名与不同大小写各自保留；初始需求链接支持中文、空格与括号', async () => {
  const root = await mkdtemp(join(tmpdir(), 'Blueprint Brief 附件保存-'))
  try {
    const files = 规范项目附件([
      attachment('参考 图 (原稿).png', '图片字节'), attachment('参考 图 (原稿).png', '第二份图片'),
      attachment('需求.md', '# 需求'), attachment('需求.MD', '另一个需求'), attachment('空文档.txt', ''),
    ])
    await 保存项目附件(root, files)
    for (const file of files) assert.deepEqual(await readFile(join(root, file.path)), file.data)
    assert.equal(files[1].name, '参考 图 (原稿)（2）.png')
    assert.equal(files[3].name, '需求（2）.MD')
    const brief = 附件需求原话('制作一张海报。', files)
    assert.ok(brief.startsWith('制作一张海报。\n\n'))
    for (const file of files) assert.ok(brief.includes(file.name))
    const paths = [...brief.matchAll(/\]\(([^)]+)\)/g)].map(match => decodeURIComponent(match[1]))
    assert.deepEqual(paths, files.map(file => file.path))
    assert.equal(附件需求原话('仅文字', []), '仅文字')
    await assert.rejects(保存项目附件(root, files), { code: 'EEXIST' })
    assert.equal(await readFile(join(root, files[0].path), 'utf8'), '图片字节')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Brief 拒绝越界文件名、无效内容、超数量与超总大小；上限内的大文件可正常准备', () => {
  for (const name of ['../外部.txt', '/外部.txt', '目录/文件.txt', '目录\\文件.txt', '.隐藏', '换\n行.txt', ''])
    assert.throws(() => 规范项目附件([attachment(name, '内容')]), /文件名无效/)
  for (const input of [null, {}, '附件']) assert.throws(() => 规范项目附件(input), /文件列表/)
  for (const data of ['不是 base64', 'AQ=', 'AR==', {}, 'AAAA='])
    assert.throws(() => 规范项目附件([{ name: '需求.txt', data }]), /内容无效/)
  assert.throws(() => 规范项目附件(Array.from({ length: 21 }, () => attachment('需求.txt', ''))), /最多插入/)
  const large = { name: '参考素材.bin', data: Buffer.alloc(项目附件上限.bytes).toString('base64') }
  assert.equal(规范项目附件([large])[0].data.length, 项目附件上限.bytes)
  assert.throws(() => 规范项目附件([large, attachment('额外.txt', '超限')]), /合计不能超过/)
})

test('Brief 保存拒绝已有的符号链接目录，不能写入其他位置', async () => {
  const root = await mkdtemp(join(tmpdir(), 'Blueprint Brief 目录隔离-'))
  try {
    const own = join(root, '本项目'), other = join(root, '其他项目')
    await mkdir(own); await mkdir(other)
    await symlink(other, join(own, '素材'))
    await assert.rejects(保存项目附件(own, 规范项目附件([attachment('需求.txt', '内容')])), /符号链接/)
    await assert.rejects(stat(join(other, 'Brief')), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
