import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { entryOf } from '../../blueprint/packages/studio/src/index.js'

test('PTC 历史行复用工具 renderer，原生子身份配对结果并保留父身份', async () => {
  const source = await readFile(new URL('../../viewer/stream-render.js', import.meta.url), 'utf8')
  const rows = new Map(), finishes = []
  const scope = vm.createContext({ eventTime: value => value, toolRows: rows,
    el: (_tag, className) => ({ className, children: [], appendChild(node) { this.children.push(node); node.parentNode = this } }),
    makeToolRow(id, name, args) {
      const row = { node: { dataset: {}, name, args }, finish: (text, isError) => finishes.push({ id, text, isError }) }
      rows.set(id, row); return row
    } })
  vm.runInContext(source.slice(source.indexOf('  function attachToolResult('), source.indexOf('  let sysSeen')), scope)
  vm.runInContext(source.slice(source.indexOf('  function renderEntry('), source.indexOf('  /* ---------------- 动作组')), scope)
  const data = { rootCallId: '程序', parentCallId: '程序', subCallId: '原生子身份:中文', name: 'write',
    arguments: { file_path: '成果.md', content: '原文' } }
  const container = scope.renderEntry(entryOf({ type: 'tool/ptc-dispatch-start', time: 10, data }))
  assert.equal(container.className, 'turn ai')
  const row = container.children[0]
  assert.equal(row.dataset.parentCallId, '程序'); assert.equal(row.dataset.startedAt, 10)
  assert.equal(row.args.file_path, '成果.md'); assert.equal(row.title, '程序内部工具调用')
  scope.renderEntry(entryOf({ type: 'tool/ptc-dispatch', data: { ...data, isError: true, content: [{ type: 'text', text: '真实失败' }] } }))
  assert.deepEqual(finishes, [{ id: data.subCallId, text: '真实失败', isError: true }])
})
