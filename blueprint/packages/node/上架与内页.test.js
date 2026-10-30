import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { 上架素材, 装上架工具 } from './src/上架.js'
import { 素材卡片Of, 生成素材目录 } from './src/素材目录.js'
import { 建名册, 记会话, 落名册 } from '../roster/src/index.js'
import { callMedia } from './src/媒体服务.js'
const command = promisify(execFile)
async function 项目(t) {const root = await mkdtemp(join(tmpdir(), 'blueprint-上架内页核对-')); t.after(() => rm(root, {recursive: true, force: true})); return root}
async function 放(root, path, text = '原件') {await mkdir(dirname(join(root, path)), {recursive: true}); await writeFile(join(root, path), text)}
const shelve = (root, args, extra = {}) => 上架素材(root, args, {节点: '0', 时间: '2026-10-09T10:00:00Z', ...extra})
const 卡片 = async (root, group) => 素材卡片Of(await readFile(join(root, '素材', group, '说明.md'), 'utf8'))

function PDF原件(带书签 = true) {
  const title = text => 'FEFF' + [...text].map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('')
  const stream = 'BT /F1 12 Tf 20 100 Td (Button Design) Tj ET'
  const objects = [`<< /Type /Catalog /Pages 2 0 R ${带书签 ? '/Outlines 5 0 R' : ''} >>`, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 8 0 R >> >> /Contents 4 0 R >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Outlines /First 6 0 R /Last 7 0 R /Count 2 >>', `<< /Title <${title('界面结构')}> /Parent 5 0 R /Next 7 0 R /Dest [3 0 R /XYZ null null null] >>`, `<< /Title <${title('按钮反馈')}> /Parent 5 0 R /Prev 6 0 R /Dest [3 0 R /XYZ null null null] >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let pdf = '%PDF-1.4\n', offsets = [0]
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n` }
  const xref = Buffer.byteLength(pdf)
  return pdf + `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
}

test('why 必填，文件移动入组；整组一行，已用单件补条并保留组认识', async t => {
  const root = await 项目(t)
  await 放(root, '.blueprint-tmp/候选/交互设计.md', '# 页面结构\n## 点击反馈')
  await 放(root, '.blueprint-tmp/候选/视觉设计.md', '# 色彩')
  await assert.rejects(shelve(root, {paths: ['.blueprint-tmp/候选/交互设计.md'], group: '设计参考'}), /why 必填/)
  assert.equal((await stat(join(root, '.blueprint-tmp/候选/交互设计.md'))).isFile(), true)
  const result = await shelve(root, {paths: ['.blueprint-tmp/候选/交互设计.md', '.blueprint-tmp/候选/视觉设计.md'], group: '设计参考', why: '用在界面设计', what: '两份设计参考', from: '团队原件'})
  assert.deepEqual(result.paths, ['素材/设计参考/交互设计.md', '素材/设计参考/视觉设计.md'])
  await assert.rejects(stat(join(root, '.blueprint-tmp/候选/交互设计.md')), {code: 'ENOENT'})
  const before = await 卡片(root, '设计参考')
  assert.equal(before.files.length, 2); assert.equal(before.node, '0'); assert.equal(before.time, '2026-10-09T10:00:00Z'); assert.equal(before.entries.length, 0)
  await shelve(root, {paths: ['素材/设计参考/交互设计.md'], group: '设计参考', why: '采用点击反馈', what: '交互反馈采用这一份'}, {节点: '1'})
  const after = await 卡片(root, '设计参考')
  assert.equal(after.what, before.what); assert.equal(after.why, before.why)
  assert.equal(after.entries.length, 1); assert.equal(after.entries[0].node, '1')
  const text = await readFile(await 生成素材目录(root), 'utf8')
  assert.match(text, /\| 设计参考 \| 两份设计参考/)
  assert.match(text, /\| ↳ 交互设计.md \| 交互反馈采用这一份/)
  await shelve(root, {paths: ['素材/设计参考/交互设计.md'], group: '设计参考', why: '采用更新后的反馈', what: '更新读数'})
  assert.equal((await 卡片(root, '设计参考')).entries.length, 1)
})

test('嵌套子组保留自己的条目，并发上架不会丢卡片', async t => {
  const root = await 项目(t)
  await 放(root, '.blueprint-tmp/整体.md', '# 整体'); await 放(root, '.blueprint-tmp/子图.md', '# 子图')
  await Promise.all([shelve(root, {paths: ['.blueprint-tmp/整体.md'], group: '界面参考', why: '界面整体'}), shelve(root, {paths: ['.blueprint-tmp/子图.md'], group: '界面参考/按钮参考', why: '按钮反馈'})])
  const text = await readFile(await 生成素材目录(root), 'utf8')
  assert.match(text, /\| 界面参考 \|/); assert.match(text, /\| ↳ 界面参考\/按钮参考 \|/)
})

test('上架拒绝外部路径、系统工作文档、内页、软链接和冲突；不先移动其它有效原件', async t => {
  const root = await 项目(t), outside = await 项目(t)
  await 放(root, '.blueprint-tmp/正常.md', '# 原件'); await 放(outside, '外部.md', '# 外部')
  await 放(root, '工作文档/请求.md'); await 放(root, '系统文档/名册.yaml'); await 放(root, '.blueprint-evidence/原始.json')
  await 放(root, '素材/别组/_内页/索引.md'); await 放(root, '.blueprint-tmp/目录/内部.md')
  await symlink(join(outside, '外部.md'), join(root, '.blueprint-tmp/外部链接'))
  await symlink(join(root, '.blueprint-tmp/目录'), join(root, '.blueprint-tmp/内部链接'))
  for (const path of [join(outside, '外部.md'), '../外部.md', '工作文档/请求.md', '系统文档/名册.yaml', '.blueprint-evidence/原始.json', '素材/别组/_内页/索引.md', '.blueprint-tmp/外部链接', '.blueprint-tmp/内部链接/内部.md']) {
    await assert.rejects(shelve(root, {paths: ['.blueprint-tmp/正常.md', path], group: '保留原件', why: '使用原件'}), /PROJECT_ISOLATION|不能上架|软链接/)
    assert.equal((await stat(join(root, '.blueprint-tmp/正常.md'))).isFile(), true)
  }
  await assert.rejects(shelve(root, {paths: ['.blueprint-tmp/正常.md'], group: '../越界', why: '原件'}), /group/)
  await assert.rejects(shelve(root, {paths: ['.blueprint-tmp/正常.md', '.blueprint-tmp/正常.md'], group: '重名组', why: '原件'}), /重名/)
})

test('图片原件生成带文件名的拼版，尺寸与大小真实；坏图片列失败原因', async t => {
  const root = await 项目(t), dir = join(root, '.blueprint-tmp/图片候选')
  await mkdir(dir, {recursive: true})
  await command('/opt/homebrew/bin/magick', ['-size', '64x48', 'xc:red', join(dir, '赤色按钮.png')])
  await command('/opt/homebrew/bin/magick', ['-size', '80x40', 'xc:blue', join(dir, '蓝色按钮.png')])
  await writeFile(join(dir, '坏图片.png'), '不是图片')
  const result = await shelve(root, {paths: ['.blueprint-tmp/图片候选'], group: '按钮画面', why: '选择按钮颜色', what: '按钮色彩候选'})
  const card = await 卡片(root, '按钮画面'), red = card.files.find(f => f.path.endsWith('赤色按钮.png'))
  assert.equal(red.width, 64); assert.equal(red.height, 48); assert.equal(red.bytes, (await stat(join(root, red.path))).size)
  assert.equal(card.files.length, 3); assert.equal(card.pages.filter(p => p.endsWith('.png')).length, 1)
  const picture = join(root, card.pages.find(p => p.endsWith('.png')))
  const size = (await command('/opt/homebrew/bin/magick', ['identify', '-format', '%w %h', picture])).stdout.split(' ').map(Number)
  assert(size[0] >= 360); assert(size[1] >= 160)
  assert.match(result.errors.join(' '), /坏图片.png/)
  assert.match(await readFile(join(root, result.index), 'utf8'), /坏图片.png.*identify/)
  assert.equal((await 卡片(root, '按钮画面')).files.length, 3, '内页不计入原件')
})

test('视频按时间抽帧，工程文件树与README标题、文档标题目录使用真实原件', async t => {
  const root = await 项目(t)
  await mkdir(join(root, '.blueprint-tmp/工程候选'), {recursive: true})
  await command('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=80x60:rate=4', '-t', '1.5', '-pix_fmt', 'yuv420p', '-y', join(root, '.blueprint-tmp/工程候选/按钮演示.mp4')])
  await 放(root, '.blueprint-tmp/工程候选/src/交互.js', 'export const 点击 = true')
  await 放(root, '.blueprint-tmp/工程候选/README.md', '# 按钮工程\n## 启动方法')
  await 放(root, '.blueprint-tmp/工程候选/布局.html', '<h1>界面布局</h1><h2>导航结构</h2>')
  await 放(root, '.blueprint-tmp/工程候选/设计书签.pdf', PDF原件())
  await 放(root, '.blueprint-tmp/工程候选/无书签原件.pdf', PDF原件(false))
  const result = await shelve(root, {paths: ['.blueprint-tmp/工程候选'], group: '交互工程', why: '复用按钮交互'})
  assert.deepEqual(result.errors, [])
  const card = await 卡片(root, '交互工程'), video = card.files.find(f => f.type === '视频')
  assert.equal(video.width, 80); assert.equal(video.height, 60); assert(video.duration >= 1.4)
  assert(card.pages.some(path => path.includes('视频抽帧-按钮演示')))
  const tree = await readFile(join(root, '素材/交互工程/_内页/工程文件树与README标题.md'), 'utf8')
  assert.match(tree, /工程候选\/src\/交互.js/); assert.match(tree, /按钮工程[\s\S]*启动方法/)
  const documents = await readFile(join(root, '素材/交互工程/_内页/文档标题目录.md'), 'utf8')
  assert.match(documents, /界面布局[\s\S]*导航结构/)
  assert.match(documents, /界面结构（第1页）[\s\S]*按钮反馈（第1页）/)
  assert.match(documents, /未找到 PDF 书签标题，查看原件/)
  for (const match of (await readFile(join(root, result.index), 'utf8')).matchAll(/\]\(([^)]+)\)/g)) await stat(join(dirname(join(root, result.index)), decodeURIComponent(match[1])))
})

test('超过30张图片按页拼版；DOCX只用实际标题样式生成标题目录', async t => {
  const root = await 项目(t), candidate = join(root, '.blueprint-tmp/画面与文档')
  await mkdir(candidate, {recursive: true})
  await command('/opt/homebrew/bin/magick', ['-size', '20x20', 'xc:green', join(candidate, '绿色导航按钮-款式1.png')])
  const image = await readFile(join(candidate, '绿色导航按钮-款式1.png'))
  for (let i = 2; i <= 31; i++) await writeFile(join(candidate, `绿色导航按钮-款式${i}.png`), image)
  const staging = join(root, '.blueprint-tmp/DOCX原件包')
  await 放(root, '.blueprint-tmp/DOCX原件包/word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>')
  await 放(root, '.blueprint-tmp/DOCX原件包/word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>导航设计</w:t></w:r></w:p><w:p><w:r><w:t>普通正文不作标题</w:t></w:r></w:p></w:body></w:document>')
  await command('/usr/bin/zip', ['-q', join(candidate, '导航说明.docx'), 'word/styles.xml', 'word/document.xml'], {cwd: staging})
  const result = await shelve(root, {paths: ['.blueprint-tmp/画面与文档'], group: '导航画面', why: '选取导航颜色'})
  assert.deepEqual(result.errors, [])
  const card = await 卡片(root, '导航画面')
  assert.equal(card.pages.filter(path => path.includes('图片缩略拼版')).length, 2)
  const text = await readFile(join(root, '素材/导航画面/_内页/文档标题目录.md'), 'utf8')
  assert.match(text, /导航设计/); assert.doesNotMatch(text, /普通正文不作标题/)
})

test('shelve 用附录A原文，帮手会话的父节点身份可以上架且不入名册', async t => {
  const root = await 项目(t), sessions = new Map(), tools = []
  const registry = 记会话(建名册('上架项目', '作品需求'), '0', 'root-session')
  await 落名册(root, registry)
  sessions.set('root-session', {header: {cwd: root}})
  sessions.set('sub-session', {header: {cwd: root, origin: 'subagent', parentSession: 'root-session'}})
  装上架工具({sessions: {get: id => sessions.get(id)}, tools: {register: tool => tools.push(tool)}})
  const tool = tools[0]
  assert.equal(tool.name, 'shelve'); assert.match(tool.description, /【上架】/); assert.deepEqual(tool.parameters.required, ['paths', 'group', 'why'])
  await 放(root, '.blueprint-tmp/sub原件.md', '# sub 原件')
  const result = await tool.execute({paths: ['.blueprint-tmp/sub原件.md'], group: '帮手参考', why: '用在交互设计'}, {agent: {session: {id: 'sub-session'}}, signal: new AbortController().signal})
  assert.equal(JSON.parse(result.文).group, '帮手参考'); assert.equal((await 卡片(root, '帮手参考')).node, '0')
  assert.equal(registry.rows.length, 1)
})

test('生成候选整目录上架后回执改到新入口，status 不重复生成或重建候选说明', async t => {
  const root = await 项目(t), job = '12345678-1234-1234-1234-123456789012', folder = `.blueprint-tmp/生成/${job}`
  await mkdir(join(root, folder), {recursive: true})
  await command('/opt/homebrew/bin/magick', ['-size', '32x24', 'xc:orange', join(root, folder, '橙色按钮-1.png')])
  await 放(root, `${folder}/说明.md`, 'AI 生成的图片：橙色按钮\n\n完整提示词：橙色的圆角按钮')
  const files = [{path: `${folder}/橙色按钮-1.png`, mimeType: 'image/png', bytes: (await stat(join(root, folder, '橙色按钮-1.png'))).size}]
  await 放(root, `.blueprint-evidence/media/${job}.json`, JSON.stringify({id: job, operation: 'image.generate', result: {job, status: 'completed', files}}))
  await shelve(root, {paths: [folder], group: '按钮生成稿', why: '留用按钮画面', from: '提示词：橙色的圆角按钮'})
  const result = await callMedia({}, {action: 'status', job}, {root, fetch: async () => {throw new Error('不应重新请求生成')}})
  assert.equal(result.files[0].path, `素材/按钮生成稿/${job}/橙色按钮-1.png`)
  assert.match(await readFile(join(root, `素材/按钮生成稿/${job}/说明.md`), 'utf8'), /完整提示词：橙色的圆角按钮/)
  await assert.rejects(stat(join(root, folder)), {code: 'ENOENT'})
})
