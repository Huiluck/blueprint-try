import { 来源显示 } from './src/消息协议.js'
/**
 * context 的离线核对：`node --test blueprint/packages/context/核对.test.js`
 *
 * 不起 dsh：用一个假的 dsh 把插件真装一遍，拿真的名册、工作文档核两段（系统提示、节点前缀）。
 * 模板换成假的，把每个占位原样标出来，看得见机器往哪一格填了什么。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 落新名册, 读名册, 改名册, 加行, 记会话, 排队, 写工作文档, 新工作文档, 行Of } from '../roster/src/index.js'
import { 装, 拼公共前缀 } from './src/index.js'
import { 有节点前缀了, 节点前缀来路, 节点前缀版本, 用户选择来路, 用户选择文 } from './src/拼.js'
import { 一段, 协作模式Of } from '../prompt/src/index.js'
import { renderContextSections } from '@deepseek-ai/dsh-system-prompt'

const 假字 = (名, 填) => {
  if (!填) return `【${名}】`
  return `【${名}】\n` + Object.entries(填).map(([k, v]) => `<${k}>\n${v}`).join('\n')
}

/** 假 dsh：收下插件注册的东西；会话表按 id 给 header。 */
function 假dsh(会话们, 取字 = 假字) {
  const 收 = { sections: [], contexts: [], on: {}, tools: [] }
  const ctx = {
    systemPrompt: { section: (s) => 收.sections.push(s), context: (c) => 收.contexts.push(c) },
    tools: { register: (t) => 收.tools.push(t) },
    sessions: { get: (id) => 会话们[id] },
    // 挂在最外层（prepend）的另放 外层，收.on 照旧是各事件的主处理。
    on: (ev, fn, opt) => { if (opt?.prepend) (收.外层 ||= {})[ev] = fn; else 收.on[ev] = fn },
  }
  装(ctx, 取字)
  return 收
}

/** 假会话：对话就是一个数组。`origin: 'subagent'` ＝ do，`parentSession` 是派它的节点。 */
const 假会话 = (id, cwd, 消息们 = [], 头 = {}) => ({ id, header: { cwd, ...头 }, deriveMessages: () => 消息们, ownEvents: () => [] })

/** 搭三个层级的普通节点，各有工作文档。 */
async function 搭项目() {
  const 根 = await mkdtemp(join(tmpdir(), 'context-'))
  await 落新名册(根, '猫咪闯关')
  await 改名册(根, (m) => 加行(m, '0', { kind: 'worker', name: '总策划' }))
  await 改名册(根, (m) => 加行(m, '1', { kind: 'worker', name: '关卡设计师' }))
  const { 名册 } = await 改名册(根, (m) => 记会话(记会话(记会话(m, '0', 's-0'), '1', 's-1'), '1.1', 's-11'))
  await 排队(根, async () => {
    for (const [id, 意图] of [['0', '做一个猫咪横版闯关游戏'], ['1', '三关，难度递增'], ['1.1', '做第一关：平台和两个敌人']]) {
      const 行 = 行Of(名册, id)
      await 写工作文档(根, 行, 新工作文档(行, 意图))
    }
  })
  return 根
}

const 会话表 = (根) => ({
  's-0': 假会话('s-0', 根),
  's-1': 假会话('s-1', 根),
  's-11': 假会话('s-11', 根),
  's-帮手': 假会话('s-帮手', 根, [], { origin: 'subagent', parentSession: 's-11' }),
  's-外人': 假会话('s-外人', '/别处'),
})

test('稳定提示同一类节点逐字相同：helm、run 各一份；帮手没带独立提示词就空着，不含动态身份', async () => {
  const 根 = await 搭项目()
  try {
    const 表 = 会话表(根), 段 = 假dsh(表).sections[0]
    const 取 = id => 段.text({ agent: { session: 表[id] } })
    assert.equal(取('s-1'), 取('s-11'), '同是 run，逐字相同')
    assert.notEqual(取('s-0'), 取('s-1'), 'helm 和 run 不一样')
    assert.match(取('s-0'), /<目标与判断>\n【重置\/canon】/)
    assert.match(取('s-0'), /【公共前缀】[\s\S]*【使用情境】[\s\S]*【重置\/节点\/helm】/)
    assert.match(取('s-11'), /【重置\/节点\/run】[\s\S]*【公共前缀】[\s\S]*【使用情境】/)
    assert.equal(取('s-帮手'), '', '帮手的提示词由它自己带来')
    assert.doesNotMatch(取('s-11'), /1\.1|关卡设计师/)
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('真模板：canon → 公共前缀 → 使用情境 → 这类节点一段；run 拿自己的一段、公共前缀和使用情境，不读 canon', async () => {
  for (const 类型 of ['helm', 'dock']) {
    const 文 = 拼公共前缀(类型)
    assert.equal(文, ['重置/canon', '公共前缀', '使用情境', `重置/节点/${类型}`].map(name => 一段(name)).join('\n\n'))
    assert.ok(!文.includes('{{'))
  }
  assert.match(拼公共前缀('dock'), /比较多张图在同一步读取/)
  assert.equal(拼公共前缀('print'), ['重置/canon', '公共前缀', '使用情境'].map(name => 一段(name)).join('\n\n'), '没有 print 了：认不出的身份不拼节点页')
  assert.equal(拼公共前缀('run'), ['重置/节点/run', '公共前缀', '使用情境'].map(name => 一段(name)).join('\n\n'))
  assert.match(拼公共前缀('run'), /比较多张图在同一步读取/)
  assert.match(拼公共前缀('run'), /仍不可信就停止视觉验收/)
  assert.ok(!拼公共前缀('run').includes(一段('重置/canon').trim()), 'run 不读 canon')
})

test('派出时角色写 dock 的用 dock 那一段，helm 用 helm 那一段', async () => {
  const 根 = await 搭项目()
  try {
    await 改名册(根, m => ({ ...m, rows: m.rows.map(row => row.id === '1' ? { ...row, role: 'dock' } : row) }))
    const sessions = 会话表(根), collected = 假dsh(sessions, 一段)
    const 取 = id => collected.sections[0].text({ agent: { session: sessions[id] } })
    assert.ok(取('s-1').endsWith(一段('重置/节点/dock')))
    assert.ok(取('s-0').endsWith(一段('重置/节点/helm')))
    assert.ok(取('s-11').startsWith(一段('重置/节点/run')), '没写角色的孩子是 run')
    assert.ok(取('s-0').startsWith(一段('重置/canon')))
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('节点前缀只给请求原文、节点文档入口与产物空间；run 用不带节点文档那一行的模板', async () => {
  const 根 = await 搭项目()
  try {
    const 会话们 = 会话表(根), 收 = 假dsh(会话们)
    const 前 = async id => (await 收.on['agent/pre-step']({ agent: { session: 会话们[id] } }, async () => ({ kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text: '开工。' }] }] }))).messages
    const 出 = await 前('s-11')
    assert.equal(出.length, 2, '节点前缀＋叫醒话')
    assert.equal(来源显示(出[0]), 节点前缀来路)
    assert.equal(出[0].content[0].text, [
      '【节点前缀run】', '<我>', '1.1 · run · 关卡设计师',
      '<我的文档>', join(根, '工作文档', '1.1 关卡设计师 工作文档.md'),
      '<请求>', '【前缀/请求】', '<原文>', '做第一关：平台和两个敌人',
      '<git 空间>', join(根, '作品空间', '1.1'),
    ].join('\n'))
    assert.match((await 前('s-0'))[0].content[0].text, /^【节点前缀】\n/)
    assert.match((await 前('s-0'))[0].content[0].text, /<请求>\n【前缀\/用户意图】\n<原文>\n做一个猫咪横版闯关游戏/)
    assert.ok((await 前('s-0'))[0].content[0].text.includes(`<git 空间>\n${join(根, '作品')}`))
    assert.equal(一段('节点前缀', { 我: 'x', 我的文档: 'x', 请求: '原文', 'git 空间': '作品/' }).includes('{{'), false)
    const run前缀 = 一段('节点前缀run', { 我: 'x', 请求: '原文', 'git 空间': '作品/' })
    assert.equal(run前缀.includes('{{'), false)
    assert.equal(run前缀.includes('节点文档：'), false, 'run 的节点文档只有请求，前缀里已经是原文')
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('节点前缀只给一次（被压缩收掉了再给）；do 和外人不给', async () => {
  const 根 = await 搭项目()
  try {
    const 已有 = [{ role: 'user', content: [], source: { kind: 'plugin', plugin: 节点前缀来路, summary: 节点前缀版本 } }]
    const 会话们 = { ...会话表(根), 's-0': 假会话('s-0', 根, 已有) }
    const 收 = 假dsh(会话们)
    const d = { kind: 'enter', messages: [] }
    for (const id of ['s-0', 's-帮手', 's-外人']) {
      const 出 = await 收.on['agent/pre-step']({ agent: { session: 会话们[id] } }, async () => d)
      assert.equal(出.messages.some(m => 来源显示(m) === 节点前缀来路), false, id)
      if (id === 's-外人') assert.equal(出, d)
    }
    assert.equal(有节点前缀了(已有), true)
    assert.equal(有节点前缀了([]), false, '压缩把它收掉了 → 下一步再摆')
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('旧前缀恢复为新信息入口一次，不改写已有消息；压缩后可再次恢复', async () => {
  const 根 = await 搭项目()
  try {
    const 旧 = { role: 'user', content: [{ type: 'text', text: '旧节点前缀' }], source: { kind: 'plugin', plugin: 节点前缀来路 } }
    const 历史 = [旧]
    const 表 = 会话表(根)
    表['s-11'].deriveMessages = () => 历史
    const 收 = 假dsh(表, 一段)
    const 前 = () => 收.on['agent/pre-step']({ agent: { session: 表['s-11'] } }, async () => ({ kind: 'enter', messages: [] }))
    const 新 = (await 前()).messages.find(m => 来源显示(m) === 节点前缀来路)
    assert.equal(新.source.summary, 节点前缀版本)
    assert.match(新.content[0].text, /产物空间：.*作品空间\/1\.1/)
    assert.doesNotMatch(新.content[0].text, /节点文档：/, 'run 不给节点文档入口')
    assert.equal(旧.content[0].text, '旧节点前缀')
    历史.push(新)
    assert.ok(!(await 前()).messages.some(m => 来源显示(m) === 节点前缀来路))
    历史.pop()
    assert.ok((await 前()).messages.some(m => 来源显示(m) === 节点前缀来路))
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('helm 开场即取得共同图景原文，下面的 dock 和 run 不给（十 4）；节点总表随思考开头给、不进运行背景；素材仍按需读取', async () => {
  const 根 = await 搭项目()
  try {
    const 表 = 会话表(根), 收 = 假dsh(表, 一段)
    const 图景 = '# 系统目标图景\n共同目标全文；保留 {{模板原文}}。\n'
    await writeFile(join(根, '总图景.md'), 图景)
    await writeFile(join(根, '素材'), '素材入口不应在启动时被扫描为目录')
    await writeFile(join(根, '系统文档/素材检索目录.md'), '只在取材时读取的素材清单')
    const 装配 = async id => {
      const context = { agent: { session: 表[id] } }
      const out = await 收.on['system-prompt/assemble'](null, context, async () => ({
        sections: [{ name: 'blueprint:公共前缀', text: 拼公共前缀('worker') }],
        contexts: 收.contexts.map(c => ({ name: c.name, text: c.text(context) })), tools: [], variables: {},
      }))
      return renderContextSections(out)
    }
    for (const id of ['s-0', 's-1', 's-11']) {
      const 背景 = await 装配(id)
      assert.equal(背景.find(c => c.name === 'blueprint:总图景')?.text, id === 's-0' ? 图景 : undefined, `${id}：只有没有派出者的 0 号拿到总图景`)
      assert.ok(!背景.some(c => c.name === 'blueprint:节点总表'), id)
      assert.ok(!背景.some(c => c.text.includes('只在取材时读取的素材清单')))
    }
    for (const id of ['s-帮手', 's-外人']) {
      assert.ok(!(await 装配(id)).some(c => ['blueprint:总图景', 'blueprint:节点总表'].includes(c.name)), id)
    }
    await writeFile(join(根, '总图景.md'), '# 更新后的目标\n根据实际成果调整。')
    const m = await 读名册(根), 行 = 行Of(m, '1.1')
    await 排队(根, () => 写工作文档(根, 行, 新工作文档(行, '更新后的任务', { responsibility: '负责第一关试玩反馈' })))
    const 更新 = await 装配('s-0')
    assert.equal(更新.find(c => c.name === 'blueprint:总图景').text, '# 更新后的目标\n根据实际成果调整。')
    assert.ok(!更新.some(c => c.name === 'blueprint:节点总表'), '别的节点改了也不把整份表追加进运行背景（选 33）')
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('共同图景按项目隔离，缺失文件不注入，已有文件的错误与越界链接不当作空；节点总表不进运行背景', async () => {
  const 根 = await 搭项目()
  try {
    const 另一根 = join(根, '独立项目'), 表 = 会话表(根)
    await 落新名册(另一根, '独立项目')
    await 改名册(另一根, m => 记会话(m, '0', 's-另一个'))
    表['s-另一个'] = 假会话('s-另一个', 另一根)
    const 收 = 假dsh(表, 一段)
    const 装配 = async id => renderContextSections(await 收.on['system-prompt/assemble'](null,
      { agent: { session: 表[id] } }, async () => ({
        sections: [{ name: 'blueprint:公共前缀' }], contexts: [], tools: [], variables: {},
      })))
    await writeFile(join(根, '总图景.md'), '第一个项目的目标')
    await writeFile(join(另一根, '总图景.md'), '独立项目的目标')
    const 独立 = await 装配('s-另一个')
    assert.equal(独立.find(c => c.name === 'blueprint:总图景').text, '独立项目的目标')
    assert.ok(!独立.some(c => c.text.includes('第一个项目的目标') || c.text.includes('关卡设计师')))
    await rm(join(根, '总图景.md'))
    assert.ok(!(await 装配('s-0')).some(c => c.name === 'blueprint:总图景'))
    await mkdir(join(根, '总图景.md'))
    await assert.rejects(装配('s-0'), { code: 'EISDIR' })
    await rm(join(根, '总图景.md'), { recursive: true })
    // 节点总表的读取边界在 node 的思考开头里核（选 33）；它坏了也不影响运行背景。
    await rm(join(根, '系统文档/任务表.md'))
    await mkdir(join(根, '系统文档/任务表.md'))
    assert.ok(!(await 装配('s-0')).some(c => c.name === 'blueprint:节点总表'))
    await rm(join(根, '系统文档/任务表.md'), { recursive: true })
    await writeFile(join(根, '系统文档/任务表.md'), '第一个项目的分工')
    await rm(join(另一根, '总图景.md'))
    await symlink(join(根, '系统文档/任务表.md'), join(另一根, '总图景.md'))
    await assert.rejects(装配('s-另一个'), /总图景入口只能指向本项目文件/)
  } finally { await rm(根, { recursive: true, force: true }) }
})

// 10-22：run 的名字是派它的节点定的职位，给它的 node_doc 不带 brief；10-23 起有派出者的 dock 也一样（瘦 2）。helm 照旧有。
test('装配给有派出者的节点的 node_doc 没有 brief，helm 照旧有', async () => {
  const 根 = await 搭项目()
  try {
    const 会话们 = 会话表(根), 收 = 假dsh(会话们, 一段)
    const node_doc = { name: 'node_doc', description: 'brief 写短名\nappend_record 追加记录', parameters: { type: 'object', properties: { brief: { type: 'object' }, append_record: { type: 'string' } } } }
    const 工具 = async id => (await 收.on['system-prompt/assemble'](null, { agent: { session: 会话们[id] } },
      async () => ({ sections: [{ name: 'deployment:persona-prefix', text: '前缀' }], contexts: [], tools: [node_doc] }))).tools.find(t => t.name === 'node_doc')
    const run = await 工具('s-11'), helm = await 工具('s-0')
    assert.deepEqual(Object.keys(run.parameters.properties), ['append_record'])
    assert.doesNotMatch(run.description, /brief/)
    assert.deepEqual(Object.keys(helm.parameters.properties), ['brief', 'append_record'])
    // helm 派出的总 dock（有派出者）也不给；用户自己开的分身没有派出者，照旧有（node 的分身简介核对）。
    await 改名册(根, m => ({ ...m, rows: m.rows.map(row => row.id === '1' ? { ...row, role: 'dock' } : row) }))
    assert.deepEqual(Object.keys((await 工具('s-1')).parameters.properties), ['append_record'])
  } finally { await rm(根, { recursive: true, force: true }) }
})

// 10-28：run 照 dsh 标准模式补齐——提问卡、todo、present、计划模式、fork、子代理控制、选模型只给 run；run 不给 compact；计划模式规则段只放行给 run。
test('只给 run 的原生工具和计划模式规则段：run 有，helm、dock、帮手没有；dock 的 subagent 不带选模型字段', async () => {
  const 根 = await 搭项目()
  try {
    const 会话们 = 会话表(根), 收 = 假dsh(会话们, 一段)
    const 工具 = name => ({ name, description: name, parameters: { type: 'object', properties: {} } })
    const subagent = { name: 'subagent', description: 'subagent', parameters: { type: 'object', required: ['prompt'],
      properties: { prompt: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' }, reasoning_effort: { type: 'string' } } } }
    const 新的 = ['ask_user_question', 'todo_write', 'present', 'exit_plan_mode', 'subagent_fork', 'send_message', 'interrupt_agent', 'list_agents', 'list_subagent_models']
    const 装配 = async id => 收.on['system-prompt/assemble'](null, { agent: { session: 会话们[id] } }, async () => ({
      // 帮手没带独立提示词时人设槽是空的（带了的走 spawn 时的 toolFilter，见 程序协助禁用工具）。
      sections: [{ name: 'deployment:persona-prefix', text: id === 's-帮手' ? '' : '前缀' }, { name: 'plan:policy', text: 'You are in plan mode.' }],
      contexts: [], tools: [...新的.map(工具), 工具('compact'), 工具('finish'), subagent] }))
    await 改名册(根, m => ({ ...m, rows: m.rows.map(row => row.id === '1' ? { ...row, role: 'dock' } : row) }))
    const run = await 装配('s-11'), dock = await 装配('s-1'), helm = await 装配('s-0'), 帮手 = await 装配('s-帮手')
    const 名们 = out => out.tools.map(t => t.name)
    for (const name of 新的) assert.ok(名们(run).includes(name), `run 有 ${name}`)
    assert.ok(!名们(run).includes('compact'), 'run 照 dsh 自动压，不给 compact')
    assert.deepEqual(Object.keys(run.tools.find(t => t.name === 'subagent').parameters.properties), ['prompt', 'provider', 'model', 'reasoning_effort'])
    assert.ok(run.sections.some(s => s.name === 'plan:policy'))
    for (const [who, out] of [['dock', dock], ['helm', helm], ['帮手', 帮手]]) {
      for (const name of 新的) assert.ok(!名们(out).includes(name), `${who} 没有 ${name}`)
      assert.ok(!out.sections.some(s => s.name === 'plan:policy'), `${who} 不放行计划模式规则段`)
    }
    assert.ok(名们(dock).includes('compact'))
    assert.deepEqual(Object.keys(dock.tools.find(t => t.name === 'subagent').parameters.properties), ['prompt'], 'dock 的 subagent 不带选模型字段')
    assert.deepEqual(dock.tools.find(t => t.name === 'subagent').parameters.required, ['prompt'])
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('系统提示保留项目运行环境和工具用法；不是我们的装配原样放过', async () => {
  const 收 = 假dsh({})
  assert.deepEqual(收.contexts.map(c => c.name), ['blueprint:运行环境', 'blueprint:组织情境'])
  const f = 收.on['system-prompt/assemble']
  const 混 = {
    sections: [{ name: 'blueprint:公共前缀' }, { name: 'deployment:persona-prefix' }, { name: 'tool:bash' }, { name: 'tool:read' }, { name: 'tool:jobs', text: 'keep working on independent steps' }, { name: 'tool:web_search' }, { name: 'tool:web_fetch' }],
    contexts: [{ name: 'blueprint:运行环境' }, { name: 'sandbox:policy' }, { name: 'subagent:delegation' }], tools: ['t'],
  }
  const 出 = await f(null, null, async () => 混)
  assert.deepEqual(出.sections.map((s) => s.name), ['blueprint:公共前缀', 'tool:bash', 'tool:read', 'tool:jobs', 'tool:web_fetch'])
  assert.equal(出.sections.find(s => s.name === 'tool:jobs').text, 假字('后台任务'))
  assert.deepEqual(出.contexts.map(c => c.name), ['blueprint:运行环境'])
  assert.deepEqual(出.tools, ['t'])
  const 别人 = { sections: [{ name: 'deployment:persona-prefix' }], contexts: [] }
  assert.equal(await f(null, null, async () => 别人), 别人)
})

test('运行目录来自各自会话，节点和 do 可见；稳定系统提示不含本机路径', async () => {
  const 根 = await 搭项目()
  try {
    const 会话们 = 会话表(根)
    const 收 = 假dsh(会话们, 一段)
    const 环境 = 收.contexts[0]
    for (const id of ['s-0', 's-1', 's-11', 's-帮手']) {
      const 文 = 环境.text({ agent: { session: 会话们[id] } })
      assert.ok(文.includes(`项目根目录：\`${根}\``), id)
      assert.ok(文.includes(join(根, '.blueprint-tmp')), id)
      assert.match(文, /workdir 相对当前目录解析/)
      assert.match(文, /新的 shell/)
      assert.ok(!收.sections[0].text({ agent: { session: 会话们[id] } }).includes(根))
    }
    const 另一根 = join(根, '另一个用户 空格项目')
    会话们['s-另一个'] = 假会话('s-另一个', 另一根)
    await 落新名册(另一根, '独立目录')
    await 改名册(另一根, m => 记会话(m, '0', 's-另一个'))
    const 另一文 = 环境.text({ agent: { session: 会话们['s-另一个'] } })
    assert.ok(另一文.includes(`项目根目录：\`${另一根}\``))
    assert.ok(!另一文.includes(`项目根目录：\`${根}\``))
    assert.equal(环境.text({ agent: { session: 会话们['s-外人'] } }), '')
    assert.equal(环境.text({}), '')
    会话们['s-帮手'].ownEvents = () => [{ type: 'subagent/descriptor', data: { persona: '专用人设' } }]
    assert.equal(环境.text({ agent: { session: 会话们['s-帮手'] } }), '')
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('context 不注册工具', () => {
  assert.deepEqual(假dsh({}).tools, [])
})

test('根节点与子节点请求抬头不同', async () => {
  const { 建名册, 加行 } = await import('../roster/src/index.js')
  const { 节点前缀格 } = await import('./src/拼.js')
  let m = 建名册('测试')
  ;({ 名册: m } = 加行(m, '0', { kind: 'worker', name: '首轮规划师' }))
  const 请求 = '派你的是 0。\n\n情境：当前成果。\n目的：下一段。\n协作对象：根节点。\n范围：下一段。'
  const 根 = '/项目/请求抬头核对'
  const 格 = 节点前缀格(m, '1', 请求, 根)
  assert.equal(格.请求, '# 请求（原文）\n\n'+请求)
  assert.equal(格['git 空间'], join(根, '作品空间', '1'))
  assert.equal(节点前缀格(m, '0', '用户原话', 根).请求, '# 用户请求（原文）\n\n用户原话')
  assert.equal(节点前缀格(m, '0', '用户原话', 根)['git 空间'], join(根, '作品'))
})

test('品质与模式保留原文；压缩后恢复，不从历史猜默认值', async () => {
  const 原话 = '做游戏\nQuality: max（消耗极大、以人类世界顶级品质为标准）\nMode: solo（我不参与，自由发挥你认为最好的答案）'
  const 选择 = 用户选择文(原话)
  assert.equal(选择, 'Quality: max（消耗极大、以人类世界顶级品质为标准）；Mode: solo（我不参与，自由发挥你认为最好的答案）')
  assert.equal(用户选择文('没有选择'), '')
  assert.equal(用户选择文('Quality: low｜Mode: co-create'), 'Quality: low；Mode: co-create')
  assert.equal(用户选择文('Quality: low\nMode: solo\nQuality: max'), 'Quality: max；Mode: solo')
  // run 只看请求里的节点档位，不拿项目的品质档（派 6）：选择里只留模式。
  const 模式 = 用户选择文(原话, { 要品质: false })
  assert.equal(模式, 'Mode: solo（我不参与，自由发挥你认为最好的答案）')
  const 根 = await 搭项目()
  try {
    // 1 号当 dock，1.1 照旧是 run（没写 role 按 run 算）；帮手跟它的节点（1.1）走。
    await 改名册(根, (m) => ({ ...m, rows: m.rows.map((r) => r.id === '0' ? { ...r, task: 原话 } : r.id === '1' ? { ...r, role: 'dock' } : r) }))
    const 表 = 会话表(根)
    const 历史们 = Object.fromEntries(Object.keys(表).map(id => [id, []]))
    for (const [id, session] of Object.entries(表)) session.deriveMessages = () => 历史们[id]
    const 收 = 假dsh(表, 一段)
    const 前 = (id) => 收.on['agent/pre-step']({ agent: { session: 表[id] } }, async () => ({ kind: 'enter', messages: [] }))
    for (const id of ['s-0', 's-1', 's-11', 's-帮手']) {
      const 出 = await 前(id), 文 = 出.messages.find(m => 来源显示(m) === 用户选择来路).content[0].text
      if (['s-11', 's-帮手'].includes(id)) assert.ok(文.includes(模式) && !文.includes('Quality:'), id)
      else assert.ok(文.includes(选择), id)
      历史们[id].push(...出.messages)
      const 次步 = await 前(id)
      assert.equal(次步.messages.length, 0, id)
      历史们[id].length = 0 // 压缩回收，下一步按原始选择恢复。
      assert.ok((await 前(id)).messages.some(m => 来源显示(m) === 用户选择来路))
    }
    assert.equal((await 前('s-外人')).messages.length, 0)
    await 改名册(根, (m) => ({ ...m, rows: m.rows.map((r) => r.id === '0' ? { ...r, task: undefined } : r) }))
    表['s-0'].ownEvents = () => [{ type: 'user/message', data: { source: { kind: 'plugin', plugin: 节点前缀来路, summary: 节点前缀版本 }, content: [{ type: 'text', text: 原话 }] } }]
    assert.ok(!(await 前('s-11')).messages.some((m) => m.content[0]?.text.includes(选择)), '名册没写选择，不从历史提示猜')
    表['s-0'].ownEvents = () => []
    assert.ok(!(await 前('s-11')).messages.some((m) => m.content[0]?.text.includes('Quality:')))
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('各层继承同一协作频率；背景缺失和选择变化后补入相应职责', async () => {
  const 根 = await 搭项目()
  try {
    const 表 = 会话表(根), 历史 = Object.fromEntries(['s-0','s-1','s-11'].map(id=>[id,[]]))
    for (const id of Object.keys(历史)) 表[id].deriveMessages = () => 历史[id]
    const 注册 = 假dsh(表, 一段)
    for (const mode of ['co-create','conduct','solo']) {
      await 改名册(根,m=>({...m,rows:m.rows.map(r=>r.id==='0'?{...r,task:`做游戏\nMode: ${mode}`}:r)}))
      const 职责 = 一段(协作模式Of(`Mode: ${mode}`).prompt)
      for (const id of Object.keys(历史)) {
        const 前 = () => 注册.on['agent/pre-step']({agent:{session:表[id]},turn:1,step:1},async()=>({kind:'enter',messages:[]}))
        const 出 = await 前()
        // 旧名 conduct 按 co-create 的说明读；模式标记原样，所以每次切换都补入新背景。
        // helm 的协作说明后面还接一段此刻的协作表（协 7），run 没有。
        const 文 = 出.messages.find(m=>来源显示(m)===用户选择来路)?.content[0].text
        assert.ok(id === 's-0' ? 文.includes(`${职责}\n\n用户此刻要在哪儿参与`) : 文.endsWith(职责), id)
        历史[id].push(...出.messages)
        assert.ok(!(await 前()).messages.some(m=>来源显示(m)===用户选择来路),'相同职责不重复注入')
      }
    }
    for (const id of Object.keys(历史)) 历史[id].length=0
    const 出 = await 注册.on['agent/pre-step']({agent:{session:表['s-11']},turn:2,step:1},async()=>({kind:'enter',messages:[]}))
    assert.ok(出.messages.some(m=>来源显示(m)===用户选择来路 && m.content[0].text.includes('Mode: solo') && m.content[0].text.includes('当前协作方式：solo')))
  } finally { await rm(根,{recursive:true,force:true}) }
})

test('品质档那段跟在协作方式后面，helm、dock 拿，run 不拿（派 6：run 看请求里的节点档位），三档各换各的；认不出的档不补（档 1）', async () => {
  const 根 = await 搭项目()
  try {
    await 改名册(根, m => ({ ...m, rows: m.rows.map(r => r.id === '1' ? { ...r, role: 'dock' } : r) }))
    const 表 = 会话表(根), 历史 = Object.fromEntries(['s-0','s-1','s-11'].map(id=>[id,[]]))
    for (const id of Object.keys(历史)) 表[id].deriveMessages = () => 历史[id]
    const 注册 = 假dsh(表, 一段)
    const 背景 = async id => (await 注册.on['agent/pre-step']({agent:{session:表[id]},turn:1,step:1},async()=>({kind:'enter',messages:[]})))
      .messages.find(m=>来源显示(m)===用户选择来路)?.content[0].text
    for (const 档 of ['high','max','ultra']) {
      await 改名册(根,m=>({...m,rows:m.rows.map(r=>r.id==='0'?{...r,task:`做游戏\nQuality: ${档}（说明）\nMode: solo`}:r)}))
      for (const id of Object.keys(历史)) {
        const 文 = await 背景(id)
        if (id === 's-11') { assert.ok(文.includes('当前协作方式：solo') && !文.includes('品质档是用户建项目时选的') && !文.includes('Quality:'), `${id} ${档}`); continue }
        assert.ok(文?.endsWith(`${一段('档位/总述')}\n\n${一段(`档位/${档}`)}`), `${id} ${档}`)
        assert.ok(文.indexOf('当前协作方式：solo') < 文.indexOf('品质档是用户建项目时选的'), id)
      }
    }
    await 改名册(根,m=>({...m,rows:m.rows.map(r=>r.id==='0'?{...r,task:'做游戏\nQuality: low\nMode: solo'}:r)}))
    assert.ok(!(await 背景('s-1')).includes('当前品质档'))
  } finally { await rm(根,{recursive:true,force:true}) }
})

test('总节点、子节点与帮手的请求和初始背景如实带着 solo 模式标记（问卡 3）', async () => {
  const 根 = await 搭项目(), 请求 = '做游戏\nQuality: max\nMode: solo（什么都不问）'
  try {
    await 改名册(根, async m => {
      const row = 行Of(m, '0')
      await 写工作文档(根, row, 新工作文档(row, 请求))
      return { ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, task: 请求 } : r) }
    })
    const 表 = 会话表(根), 注册 = 假dsh(表, 一段)
    for (const id of ['s-0', 's-1', 's-11', 's-帮手']) {
      const 输入 = { role: 'user', content: [{ type: 'text', text: 请求 }] }
      const 出 = await 注册.on['agent/pre-step']({ agent: { session: 表[id] } }, async () => ({ kind: 'enter', messages: [输入] }))
      const text = 出.messages.flatMap(m => m.content.map(b => b.text)).join('\n')
      assert.match(text, /Mode: solo/, id)
      assert.doesNotMatch(text, /conduct/, id)
      assert.match(输入.content[0].text, /Mode: solo/, '原始输入保留')
    }
    assert.equal(协作模式Of(行Of(await 读名册(根), '0').task).id, 'solo')
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('含多级标题的任务完整进入首次请求，后续成果不进入任务前缀', async () => {
  const 根 = await 搭项目()
  try {
    const 内容 = '## 你的意图\n画一张样张\n## 构图\n巨兽就是大地\n# 接口\n五层 PNG'
    await 改名册(根, async (m) => {
      const 行 = 行Of(m, '1.1')
      await 写工作文档(根, 行, 新工作文档(行, 内容) + '\n## 成果\n不该注入的后续记录\n')
      return m
    })
    const 表 = 会话表(根)
    const 收 = 假dsh(表)
    const 出 = await 收.on['agent/pre-step']({ agent: { session: 表['s-11'] } }, async () => ({ kind: 'enter', messages: [] }))
    const 文 = 出.messages[0].content[0].text
    assert.ok(文.includes(内容))
    assert.ok(!文.includes('不该注入'))
    assert.ok(!文.includes('blueprint-intent:'))
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('帮手从持久 descriptor 加载独立人设，系统提示不混入核心', async () => {
  const { 子agent人设 } = await import('./src/index.js')
  const session = { header: { origin: 'subagent' }, ownEvents: () => [{ type: 'subagent/descriptor', data: { persona: '独立帮手提示词' } }] }
  const 文=拼公共前缀('帮手', 假字, 子agent人设(session))
  assert.equal(文, '独立帮手提示词')
  assert.doesNotMatch(文, /canon|子agent/)
  for (const 身份 of ['helm', 'dock', 'worker', 'run']) assert(拼公共前缀(身份).includes(一段('使用情境')))
  assert.equal(子agent人设({ header: { origin: 'root' }, ownEvents: session.ownEvents }), undefined)
  assert.equal(拼公共前缀('帮手', 假字), '')
})

test('context 只补缺失的前缀和协作背景，职责开头由 node 负责', async () => {
  const 根 = await 搭项目()
  try {
    await 改名册(根, (m) => ({ ...m, rows: m.rows.map((r) => r.id === '0' ? { ...r, task: '做游戏\nMode: solo' } : r) }))
    const 表 = 会话表(根)
    const 历史们 = Object.fromEntries(Object.keys(表).map(id => [id, []]))
    for (const [id, session] of Object.entries(表)) { session.deriveMessages = () => 历史们[id]; session.tokens = 400000 }
    const 收 = 假dsh(表, 一段)
    for (const id of ['s-0', 's-11', 's-帮手']) {
      for (let turn = 1; turn <= 3; turn++) {
        const 出 = await 收.on['agent/pre-step']({ agent: { session: 表[id] }, turn, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
        const 来路们 = 出.messages.map(m => 来源显示(m))
        assert.deepEqual(来路们, turn === 1 ? (id === 's-帮手' ? [用户选择来路] : [节点前缀来路, 用户选择来路]) : [], `${id} 第 ${turn} 轮`)
        历史们[id].push(...出.messages)
      }
    }
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('工具定义原样装配；已有孩子与新子节点保留行动工具', async () => {
  const 根 = await 搭项目()
  try {
    const 会话们 = 会话表(根)
    const f = 假dsh(会话们, 一段).on['system-prompt/assemble']
    const 全套 = ['bash', 'job_output', 'media_call', 'web_search', 'web_fetch', 'read', 'write', 'edit', 'finish'].map(name => ({ name }))
    const 给 = async id => (await f(null, { agent: { session: 会话们[id] } }, async () => ({ sections: [{ name: 'blueprint:公共前缀' }], contexts: [], tools: 全套 }))).tools
    for (const id of ['s-0', 's-1', 's-11']) assert.deepEqual(await 给(id), 全套)
    assert.deepEqual(await 给('s-帮手'), 全套.filter(tool => tool.name !== 'finish'))
  } finally { await rm(根, { recursive: true, force: true }) }
})

test('即时组织背景随名册更新，正式前置成果和阶段位置进入 context，不改 canon', async () => {
  const root = await 搭项目()
  try {
    const sessions = 会话表(root), registered = 假dsh(sessions, 一段)
    const dynamic = registered.contexts.find(c => c.name === 'blueprint:组织情境')
    await 改名册(root, m => ({ ...m, rows: m.rows.map(r => r.id === '1.1' ? { ...r, after: ['0'], organizationOwner: '1' } : r) }))
    assert.match(dynamic.text({ agent: { session: sessions['s-11'] } }), /尚等前置：0/)
    await 改名册(root, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, status: '完成', outcome: 'complete', result: 'achieved', handoff: '前置真实结论', artifact: { commit: '真实版本' } } : r) }))
    assert.match(dynamic.text({ agent: { session: sessions['s-11'] } }), /前置正式成果[\s\S]*前置真实结论[\s\S]*真实版本/)
    assert.equal(dynamic.text({ agent: { session: sessions['s-帮手'] } }), '', '独立帮手不继承统筹的组织背景')
    // helm、dock 的组织情境随思考开头给，不进运行背景：它一变，dsh 就把整份运行背景再追加一次（10-22）。
    await 改名册(root, m => ({ ...m, rows: m.rows.map(r => r.id === '0' ? { ...r, organizationOwner: '0' } : r) }))
    assert.equal(dynamic.text({ agent: { session: sessions['s-0'] } }), '', 'helm 不从运行背景拿组织情境')
    assert.ok(拼公共前缀('worker').includes(一段('重置/canon').trim()))
  } finally { await rm(root, { recursive: true, force: true }) }
})
