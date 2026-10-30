import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { 一段, 有一段, 说明书, 技能正文, 节点本体技能名 } from './src/index.js'

// 第十四件附录 A 是初版；现行文字由用户按真跑效果修改，这里不钉措辞，
// 只核对代码依赖的形状：代码会填的占位、skill 的名字、程序靠它认出来的几处字。
const 原件 = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const 占位们 = text => [...String(text).matchAll(/\{\{([^}]+)\}\}/g)].map(m => m[1].trim())
function 只用(path, 允许) {
  const 多出 = 占位们(原件(path)).filter(name => !允许.includes(name))
  assert.deepEqual(多出, [], `${path} 里有代码不会填的占位：${多出.join('、')}`)
}

// 设计页第三版（10-24）：helm 的四页在 重置/阶段/helm/，执行节点（dock）的六页在 重置/阶段/；rule、dock、spark 环节撤了，10-25 verify 并进 integrate。
const helm阶段 = ['orient', 'plan', 'execute', 'complete']
const 执行阶段 = ['orient', 'plan', 'execute', 'integrate', 'complete', 'reply']

test('canon、开头、节点前缀、派人请求、选择机的文字只用代码会填的占位', () => {
  只用('重置/canon.md', [])
  只用('重置/开头.md', ['职责', '等你的', '你等的'])
  只用('重置/分身简介.md', [])
  只用('shells/节点前缀.md', ['我', '我的文档', 'git 空间', '请求'])
  // 派下级的请求（10-27 派 9）：你的台、做什么、之间的联系（whole＋link）、项目情境（shared＋situation）、工作等级、同层分工（系统列＋peers）、必要规则——策略.js 的 请求文本 填这几样。
  // 执行节点并成一份请求页时用那一份，还分着时 dock、run 各一份（策略.js 的 请求页Of）。
  const 请求占位 = ['母节点', 'bench', 'what', 'whole', 'link', 'shared', 'situation', 'level', 'peers', 'rules']
  if (有一段('重置/请求/执行节点请求')) 只用('重置/请求/执行节点请求.md', 请求占位)
  else for (const 类型 of ['dock', 'run']) 只用(`重置/请求/${类型}请求.md`, 请求占位)
  只用('重置/选择机.md', ['上一个阶段', '进过', '结构段', '菜单'])
  只用('重置/节点总表.md', ['路径', '总表'])
  只用('重置/叫醒/开工.md', [])
  只用('重置/叫醒/阶段报告.md', [])
  只用('重置/叫醒/并入冲突.md', ['冲突'])
  只用('重置/叫醒/主线变了.md', ['来源', '目标', '文件'])
  只用('重置/叫醒/出错重试.md', ['错误'])
  只用('重置/叫醒/工具参数坏了.md', ['坏处'])
  for (const 类型 of ['helm', 'dock', 'run']) 只用(`重置/节点/${类型}.md`, [])
  for (const 阶段 of 执行阶段) 只用(`重置/阶段/${阶段}.md`, [])
  for (const 阶段 of helm阶段) 只用(`重置/阶段/helm/${阶段}.md`, [])
  // 分工表的格式接在 dock 的 plan 页后面（2026-10-19；第三版 helm 的 plan 不接）。
  只用('重置/分工表.md', [])
  // 思考开头.js 用第一行和第二段认出一条输入已经带过开头；两段之间要空一行。
  const 段们 = 一段('重置/开头', { 职责: '', 等你的: '', 你等的: '' }).split('\n\n').map(s => s.trim()).filter(Boolean)
  assert.ok(段们.length >= 2 && 段们[0].split('\n')[0].trim() && 段们[1], '开头.md 要有第一行和空一行后的第二段')
})

test('阶段页由选择机插入：技能目录里不再有 orient／what／execute，helm 和 dock 的阶段页都在，撤掉的 rule／dock／spark／divide 没有页', () => {
  assert.deepEqual(节点本体技能名, [])
  assert.ok(Object.isFrozen(节点本体技能名))
  for (const name of ['orient', 'what', 'execute', 'how']) assert.throws(() => 技能正文(name), new RegExp(`没有 skill/${name}/SKILL.md`))
  for (const 阶段 of 执行阶段) assert.ok(一段(`重置/阶段/${阶段}`).startsWith('# '), 阶段)
  for (const 阶段 of helm阶段) assert.ok(一段(`重置/阶段/helm/${阶段}`).startsWith('# '), `helm/${阶段}`)
  for (const 撤掉的 of ['rule', 'dock', 'spark', 'divide', 'verify']) assert.throws(() => 一段(`重置/阶段/${撤掉的}`), /没有 重置\/阶段\//)
  assert.ok(一段('重置/分工表').startsWith('## '))
})

test('工具说明读得出', () => {
  for (const name of ['note', 'publish', 'wait', 'node_doc', 'shelve', 'finish']) assert.ok(说明书(name))
  // divide 的三档节点档位由 策略.js 从 重置/请求/档位/ 填（派 6）；每一档都有说法。
  assert.ok(说明书('divide', { 档位说明: '' }))
  for (const 档 of ['stunning', 'polished', 'lean']) assert.ok(一段(`重置/请求/档位/${档}`))
})

test('叫醒话只用代码会填的占位', () => {
  for (const name of ['改写', '等待']) 只用(`shells/叫醒/${name}.md`, [])
  只用('shells/叫醒/回条.md', ['编号', '来自', '内容'])
  只用('shells/叫醒/去掉.md', ['节点'])
  只用('shells/叫醒/交差.md', ['汇总'])
})

test('派人请求填好四项与母节点；节点总表靠「目的：」「范围：」两行取目的与范围', () => {
  const 填 = { 母节点: '0 · 根节点', situation: '当前情境', purpose: '需要的效果', collaborators: '另一节点', scope: '这一块', 工作量预估: '工作量预估：常规（直接完成）' }
  const 文 = 一段('请求', 填)
  for (const value of Object.values(填)) assert.ok(文.includes(value), value)
  assert.doesNotMatch(文, /\{\{/)
  assert.match(原件('shells/请求.md'), /^目的：\{\{purpose\}\}$/m)
  assert.match(原件('shells/请求.md'), /^范围：\{\{scope\}\}$/m)
})
