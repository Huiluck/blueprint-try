import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, chmod, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { 软件HTTP, 软件们 } from './src/软件.js'

const 款 = (key, 命令, cask = false) => ({ key, 类别: '测试', 名: key.toUpperCase(), 说: `${key} 的说明`, 命令, 包: 命令, cask })
const 清单 = [款('a', 'bp-tool-a'), 款('b', 'bp-tool-b', true), 款('broken', 'bp-broken'), 款('app', 'bp-app', true), 款('nocmd', 'bp-nocmd')]

// 假 Homebrew：装哪个包就在 bin 里放同名命令；几个特殊包名模拟常见的失败。每次开始、结束记一行，看是不是一次只跑一个。
const 假brew = `#!/bin/sh
for pkg; do :; done
echo "start $*" >> "$LOG"
sleep 0.2
case "$pkg" in
  bp-broken) echo "==> Downloading bp-broken"; echo "Error: bp-broken: no bottle available" >&2; exit 1 ;;
  bp-app) echo "Error: It seems there is already an App at '/Applications/BP.app'." >&2; exit 1 ;;
  bp-nocmd) echo "end $pkg" >> "$LOG"; exit 0 ;;
esac
printf '#!/bin/sh\\n' > "$BIN/$pkg"; chmod +x "$BIN/$pkg"
echo "end $pkg" >> "$LOG"
`

async function 场地(t, { 有brew = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-software-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = join(root, 'bin'), brew = join(root, 'brew'), log = join(root, 'brew.log'), 开过 = []
  await mkdir(bin)
  await writeFile(brew, 假brew); await chmod(brew, 0o755)
  await writeFile(join(bin, 'bp-tool-a'), '#!/bin/sh\n'); await chmod(join(bin, 'bp-tool-a'), 0o755)
  const 接口 = 软件HTTP((res, _status, body) => { res.body = body }, {
    清单, 环境: { PATH: `${bin}:/usr/bin:/bin`, LOG: log, BIN: bin }, brew位置: () => 有brew ? brew : null, 开终端: async () => { 开过.push(true) } })
  const request = async (path, body) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]); req.method = body === undefined ? 'GET' : 'POST'; req.url = path
    const res = {}; await 接口(req, res, path); return res.body
  }
  const 行 = (value, key) => value.软件们.find(row => row.key === key)
  const 等装完 = async () => {
    for (let i = 0; i < 100; i++) {
      const { value } = await request('/api/software')
      if (!value.软件们.some(row => row.装 && row.装.状态 !== '失败')) return value
      await new Promise(done => setTimeout(done, 50))
    }
    throw new Error('假 brew 一直没装完')
  }
  return { request, 行, 等装完, 日志: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n'), 开过 }
}

test('装没装看命令在不在 PATH 里；类别、名称、说明照清单给', async t => {
  const f = await 场地(t)
  const { ok, value } = await f.request('/api/software')
  assert.equal(ok, true)
  assert.equal(value.brew.在, true)
  assert.deepEqual(value.软件们.map(row => row.key), ['a', 'b', 'broken', 'app', 'nocmd'])
  assert.equal(f.行(value, 'a').在, true)
  assert.match(f.行(value, 'a').位置, /bp-tool-a$/)
  assert.equal(f.行(value, 'b').在, false)
  assert.equal(f.行(value, 'b').装, null)
  assert.equal(f.行(value, 'b').类别, '测试')
})

test('一键安装在后台跑 brew，一次只跑一个，其余排队；装好就算已安装', async t => {
  const f = await 场地(t)
  let { value } = await f.request('/api/software/install', { key: 'b' })
  assert.equal(f.行(value, 'b').装.状态, '安装中')
  ;({ value } = await f.request('/api/software/install', { key: 'nocmd' }))
  assert.equal(f.行(value, 'nocmd').装.状态, '排队')
  // 装着的时候再点一次不会重复排队
  ;({ value } = await f.request('/api/software/install', { key: 'b' }))
  value = await f.等装完()
  assert.equal(f.行(value, 'b').在, true)
  assert.equal(f.行(value, 'b').装, null)
  assert.deepEqual(await f.日志(), ['start install --cask bp-tool-b', 'end bp-tool-b', 'start install bp-nocmd', 'end bp-nocmd'])
  // brew 说装好了，命令却找不到：不能显示已安装
  assert.equal(f.行(value, 'nocmd').在, false)
  assert.equal(f.行(value, 'nocmd').装.状态, '失败')
  assert.match(f.行(value, 'nocmd').装.说明, /bp-nocmd/)
})

test('已经装好的不再跑 brew', async t => {
  const f = await 场地(t)
  const { value } = await f.request('/api/software/install', { key: 'a' })
  assert.equal(f.行(value, 'a').装, null)
  assert.deepEqual(await f.日志(), [''])
})

test('失败留下最后几行；已有 App 换成人话；失败后能重试', async t => {
  const f = await 场地(t)
  await f.request('/api/software/install', { key: 'broken' })
  await f.request('/api/software/install', { key: 'app' })
  let value = await f.等装完()
  assert.equal(f.行(value, 'broken').装.状态, '失败')
  assert.match(f.行(value, 'broken').装.说明, /no bottle available/)
  assert.match(f.行(value, 'app').装.说明, /不是用 Homebrew 装的/)
  ;({ value } = await f.request('/api/software/install', { key: 'broken' }))
  assert.equal(f.行(value, 'broken').装.状态, '安装中')
  await f.等装完()
  assert.equal((await f.日志()).filter(line => line === 'start install bp-broken').length, 2)
})

test('没有 Homebrew：安装直接说缺 Homebrew；装 Homebrew 打开终端', async t => {
  const f = await 场地(t, { 有brew: false })
  let { value } = await f.request('/api/software')
  assert.equal(value.brew.在, false)
  ;({ value } = await f.request('/api/software/install', { key: 'b' }))
  assert.equal(f.行(value, 'b').装.状态, '失败')
  assert.match(f.行(value, 'b').装.说明, /Homebrew/)
  await f.request('/api/software/brew', {})
  assert.equal(f.开过.length, 1)
  const 错 = await f.request('/api/software/install', { key: '不存在' })
  assert.equal(错.ok, false)
})

test('正式清单：键和命令不重复，同一类挨在一起，命令名只用安全字符', () => {
  const keys = 软件们.map(row => row.key), 命令们 = 软件们.map(row => row.命令)
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(new Set(命令们).size, 命令们.length)
  for (const row of 软件们) {
    assert.match(row.命令, /^[\w.-]+$/)
    assert.match(row.包, /^[\w.@-]+$/)
    assert.ok(row.类别 && row.名 && row.说, row.key)
  }
  const 类别们 = 软件们.map(row => row.类别).filter((类别, i, all) => 类别 !== all[i - 1])
  assert.equal(new Set(类别们).size, 类别们.length, '同一类要挨在一起，页面才不会分成两段')
})
