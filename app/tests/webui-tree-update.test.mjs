import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../../viewer/studio.html', import.meta.url), 'utf8')
const regionSource = source.slice(source.indexOf('const 树刷新区域 ='), source.indexOf('const 说不清 ='))
const signatureSource = source.slice(source.indexOf('function 树显示签(T){'), source.indexOf('/* **按那块 PULSE'))
const faceSource = source.slice(source.indexOf('const 脸 = ['), source.indexOf('const 树刷新区域 ='))
const labels = [...faceSource.matchAll(/\['([^']+)',/g)].map(match => match[1])

function fixture() {
  const calls = [], context = { console, 脸: labels.map(label => [label, () => calls.push(label)]) }
  vm.createContext(context)
  vm.runInContext(regionSource + '\n' + signatureSource, context)
  return { calls, context, signature: tree => context.树显示签(tree),
    paintTree: () => vm.runInContext('画脸(树刷新区域)', context), paintAll: () => context.画脸() }
}

const tree = () => ({ project: 'offline', event_count: 5, roots: ['root'],
  nodes: [{ node_id: 'root', 名字: '根节点', 目标: '保持正文', 带们: [{ 会话: 'root', 状态: 'run' }], Sub们: [] }],
  edges: [{ from: 'root', to: 'helper' }], 全启: { 要叫: [] } })

test('事件计数和原始边表更新不拆树；节点、状态、目标和控件变化仍触发更新', () => {
  const f = fixture(), value = tree(), initial = f.signature(value)
  value.event_count += 1000
  value.edges.push({ from: 'root', to: 'other' })
  assert.equal(f.signature(value), initial)
  for (const mutate of [
    t => { t.nodes[0].带们[0].状态 = 'done' },
    t => { t.nodes[0].目标 = '新目标' },
    t => { t.nodes[0].Sub们.push({ 会话: 'new-sub', 态: 'run' }) },
    t => { t.nodes.push({ node_id: 'child', children: [] }) },
    t => { t.全启.要叫.push('child') },
    t => { t.project = 'another-project' },
  ]) {
    const next = tree()
    mutate(next)
    assert.notEqual(f.signature(next), initial)
  }
})

test('其他节点的树更新只画相关区域，保留当前对话、导航、输入和抽屉', () => {
  const f = fixture()
  f.paintTree()
  assert.ok(f.calls.includes('树与脚注'))
  assert.ok(f.calls.includes('右列铭牌'))
  assert.ok(f.calls.includes('项目下拉'))
  assert.ok(f.calls.includes('轨迹'))
  assert.ok(f.calls.includes('信息流'))
  for (const region of ['流', '输入条与砖', '右抽屉', '产物', '模型下拉']) assert.ok(!f.calls.includes(region), region)
  f.calls.length = 0
  f.paintAll()
  assert.deepEqual(f.calls, labels, '切节点和全量更新仍绘制完整页面')
})
