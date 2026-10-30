import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8')
const start = source.indexOf('  const 持久问题 = new Map()'), end = source.indexOf('  function 关闭问题(', start)
assert.ok(start >= 0 && end > start)
const restore = (failCode) => {
  const pending = new Map(), warnings = []; let blocked = true
  const scope = { pending, 项目位置们: () => ['可读位置', '不可读位置', '另一个位置'],
    ctx: { logger: { warn: message => warnings.push(message) }, effect: callback => callback() },
    send() {}, 项目存储: { subscribe: callback => { scope.retry = callback; return () => {} } },
    扫问答: root => {
      if (blocked && root === '不可读位置') throw Object.assign(new Error('目录读取失败'), { code: failCode })
      return [{ root, frame: { rpcId: root + '的问题' } }]
    } }
  return { pending, warnings, allow: () => { blocked = false; scope.retry(); }, run: () => vm.runInNewContext(source.slice(start, end), scope) }
}

test('一个项目目录失去权限不阻断界面启动，其他位置的待回答记录照常恢复并明确记录错误', () => {
  for (const code of ['EPERM', 'EACCES']) {
    const f = restore(code); f.run()
    assert.deepEqual([...f.pending.keys()], ['可读位置的问题', '另一个位置的问题'])
    assert.equal(f.warnings.length, 1)
    f.allow(); assert.equal(f.pending.size, 3, '授权后无需重启即可恢复原目录待回答记录')
    f.allow(); assert.equal(f.pending.size, 3, '重复检查不重复登记')
    assert.ok(f.warnings[0].includes(code) && f.warnings[0].includes('不可读位置'))
  }
  assert.throws(restore('EIO').run, /目录读取失败/, '其他数据错误照实报出')
})
