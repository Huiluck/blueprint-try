import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { 参数 } from './skill/resource-reuse/scripts/取得.mjs'

const 脚本 = name => fileURLToPath(new URL(`./skill/resource-reuse/scripts/${name}`, import.meta.url))

// 假 curl：按网址后缀写一份能过文件头检查的内容，再按 --write-out 回一段 JSON。
const 假curl = `#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output) out="$2"; shift 2;;
    --write-out|--retry|--connect-timeout|--max-time|--proto|--proto-redir|--user-agent) shift 2;;
    *) url="$1"; shift;;
  esac
done
case "$url" in
  *.svg) printf '<svg xmlns="http://www.w3.org/2000/svg"></svg>' > "$out";;
  *.gltf) printf '{}' > "$out";;
  *.png) printf '\\211PNG\\r\\n\\032\\n' > "$out";;
  *) printf 'fixture-bytes' > "$out";;
esac
printf '{"url_effective":"%s","http_code":200,"content_type":"application/octet-stream"}' "$url"
`

function 环境(t) {
  const root = mkdtempSync(join(tmpdir(), 'blueprint-pick-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'curl'), 假curl, { mode: 0o755 })
  const env = { ...process.env, TMPDIR: root, PATH: root + ':' + (process.env.PATH || '') }
  delete env.NODE_OPTIONS; delete env.NODE_PATH
  const 候选单 = join(root, '候选.json')
  writeFileSync(候选单, JSON.stringify({ 词: 'forest 森林', 结果: [
    { 编号: 1, 名字: 'leaf', 来源: 'Iconify', 来源标识: 'iconify', 作者: 'Ann', 版权: 'CC BY 4.0', 授权状态: '按所列许可使用', 页面: 'https://icon.test/leaf', 文件: [{ 名: 'leaf.svg', 网址: 'https://cdn.test/leaf.svg' }] },
    { 编号: 2, 名字: 'wind', 来源: 'freesound.org', 来源标识: 'freesound', 作者: 'Bo', 版权: 'CC0', 页面: 'https://fs.test/2', 试听: 'https://cdn.test/wind-hq.mp3', 文件: [] },
    { 编号: 3, 名字: 'tree', 来源: 'Poly Haven', 来源标识: 'polyhaven', 作者: 'Cy', 版权: 'CC0', 页面: 'https://ph.test/tree', 文件: [{ 名: 'tree.gltf', 网址: 'https://cdn.test/tree.gltf' }, { 名: 'textures/bark.png', 网址: 'https://cdn.test/bark.png' }] },
    { 编号: 4, 名字: 'statue', 来源: 'Sketchfab', 来源标识: 'sketchfab', 作者: 'Di', 版权: 'CC BY', 页面: 'https://sf.test/statue', 文件: [] },
  ] }))
  const 取 = args => spawnSync(process.execPath, [脚本('取得.mjs'), ...args], { env, encoding: 'utf8', timeout: 10000 })
  return { root, 候选单, 取 }
}

test('--pick 照序号取文件，来源、作者、许可和搜索词自动写进来源记录', t => {
  const { root, 候选单, 取 } = 环境(t)
  const 目标 = join(root, '选定', 'leaf.svg')
  const r = 取(['--pick', 候选单, '1', 目标])
  assert.equal(r.status, 0, r.stderr)
  const 记 = JSON.parse(readFileSync(目标 + '.来源.json', 'utf8'))
  assert.equal(记.sourcePage, 'https://icon.test/leaf')
  assert.equal(记.author, 'Ann')
  assert.equal(记.license, 'CC BY 4.0')
  assert.equal(记.query, 'forest 森林')
  assert.equal(记.requestedUrl, 'https://cdn.test/leaf.svg')
  assert.match(记.sha256, /^[0-9a-f]{64}$/)
  const 再取 = 取(['--pick', 候选单, '1', 目标])
  assert.notEqual(再取.status, 0)
  assert.match(再取.stderr, /目标已存在/)
})

test('Freesound 没有原件时取试听转码版，并在记录里写明', t => {
  const { root, 候选单, 取 } = 环境(t)
  const 目标 = join(root, 'wind.mp3')
  const r = 取(['--pick', 候选单, '2', 目标])
  assert.equal(r.status, 0, r.stderr)
  const 记 = JSON.parse(readFileSync(目标 + '.来源.json', 'utf8'))
  assert.match(记.fileKind, /试听转码版/)
  assert.equal(记.license, 'CC0')
})

test('一项几份文件时目标当文件夹，按相对路径摆，记录在文件夹里', t => {
  const { root, 候选单, 取 } = 环境(t)
  const 目标 = join(root, 'tree')
  const r = 取(['--pick', 候选单, '3', 目标])
  assert.equal(r.status, 0, r.stderr)
  assert(existsSync(join(目标, 'tree.gltf')))
  assert(existsSync(join(目标, 'textures', 'bark.png')))
  const 记 = JSON.parse(readFileSync(join(目标, 'tree.来源.json'), 'utf8'))
  assert.equal(记.files.length, 2)
  assert.equal(记.author, 'Cy')
})

test('只有页面的候选不下载，提示用 --url；给了 --url 照样写候选的来源', t => {
  const { root, 候选单, 取 } = 环境(t)
  const 目标 = join(root, 'statue.png')
  const 拒 = 取(['--pick', 候选单, '4', 目标])
  assert.notEqual(拒.status, 0)
  assert.match(拒.stderr, /--url/)
  assert(!existsSync(目标))
  const r = 取(['--pick', 候选单, '4', 目标, '--url', 'https://cdn.test/statue.png'])
  assert.equal(r.status, 0, r.stderr)
  const 记 = JSON.parse(readFileSync(目标 + '.来源.json', 'utf8'))
  assert.equal(记.sourcePage, 'https://sf.test/statue')
  assert.equal(记.fileKind, '页面上找到的文件')
})

test('旧用法照旧：网址、目标、来源页', t => {
  const { root, 取 } = 环境(t)
  const 目标 = join(root, 'a.svg')
  const r = 取(['https://cdn.test/a.svg', 目标, 'https://page.test/a'])
  assert.equal(r.status, 0, r.stderr)
  const 记 = JSON.parse(readFileSync(目标 + '.来源.json', 'utf8'))
  assert.equal(记.sourcePage, 'https://page.test/a')
  assert.equal(记.author, undefined)
  assert.throws(() => 参数(['--pick', 'x.json']), /用法/)
  assert.throws(() => 参数(['--pick', 'x.json', '1', 'y', '--bogus', 'z']), /用法/)
  assert.deepEqual(参数(['--pick', 'x.json', '2', 'y', '--filename', 'a.zip']),
    { 模式: '候选', list: 'x.json', number: '2', destination: 'y', filename: 'a.zip' })
})

test('搜索把候选存成带编号的候选单，声音候选出试听页', t => {
  const root = mkdtempSync(join(tmpdir(), 'blueprint-candidates-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const loader = join(root, 'loader.mjs'), setup = join(root, 'setup.mjs')
  const 假联网 = `
export function 补钥匙() {}
export function 补代理() {}
export function 分语(词) { return {英文词:词,中文词:''} }
export async function 取(url) {
  if (url.startsWith('https://freesound.org/apiv2/search/?')) return {results:[
    {id:1,name:'wind <loop>',license:'http://creativecommons.org/publicdomain/zero/1.0/',username:'Bo',category:'Sound Effect',duration:3,url:'https://fs.test/1',previews:{'preview-hq-mp3':'https://cdn.test/1-hq.mp3'}},
    {id:2,name:'no preview',license:'',username:'Cy',category:'Sound Effect',duration:2,url:'https://fs.test/2',previews:{}}]}
  throw new Error('未声明的离线请求')
}`
  writeFileSync(loader, `export async function load(url,context,next) {
    if(decodeURI(url).endsWith('/resource-reuse/scripts/检索/联网.mjs')) return {format:'module',shortCircuit:true,source:${JSON.stringify(假联网)}}
    return next(url,context)
  }`)
  writeFileSync(setup, `import {register} from 'node:module';register(${JSON.stringify(new URL('file:' + loader).href)},import.meta.url)`)
  const env = { ...process.env, TMPDIR: root, FREESOUND_API_KEY: 'fixture-only-key' }
  delete env.NODE_OPTIONS; delete env.NODE_PATH
  const r = spawnSync(process.execPath, ['--import', setup, 脚本('搜.mjs'), '--kind', 'sfx', '--source', 'freesound', '--json', 'wind'], { env, encoding: 'utf8', timeout: 10000 })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  const 单 = JSON.parse(readFileSync(out.候选.候选单, 'utf8'))
  assert.deepEqual(单.结果.map(x => x.编号), [1, 2])
  assert.equal(单.结果[0].作者, 'Bo')
  assert.equal(单.词, 'wind')
  const 页 = readFileSync(out.候选.试听页, 'utf8')
  assert.match(页, /<audio controls preload="none" src="https:\/\/cdn\.test\/1-hq\.mp3">/)
  assert.match(页, /wind &lt;loop&gt;/)
  assert.deepEqual(out.候选.无试听, [2])
})
