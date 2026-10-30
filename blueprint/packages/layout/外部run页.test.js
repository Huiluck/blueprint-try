// 叶 6、C1：左窗「过程」页的文案，照 2026-10-18 用户批的样稿。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { 时刻文, 时长文, 外部run头, 外部run角标字, 步显示, 外部run停着, 额度文, 外部run底, 外部run要轮询, 外部run段落, 外部run概况, 外部run轮次 } from './外部run页数据.js'
const 界面语言 = readFileSync(new URL('../../../viewer/界面语言.js', import.meta.url), 'utf8').replace(/^export /gm, '');

const 做着 = { 执行者: 'Codex', 短名: 'Codex', model: 'gpt-6-astra', effort: 'medium', 次: 2, 在跑: true, 用时: 12.4 * 60_000, 状态: '开工', state: 'running', 母节点: { 号: '1', 名字: '程序分身', 会话: 's1' } }

function renderAttempt(data) {
  const context = vm.createContext({ 步显示, 外部run段落, 时刻文, BlueprintNodeText: "Markdown",
    h: (type, props, ...children) => ({ type, props: props || {}, children }) })
  vm.runInContext(界面语言 + '\n' + readFileSync(new URL('./外部run页.js', import.meta.url), 'utf8'), context)
  return context.BlueprintExternalRunAttempt({ data })
}
const walk = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.children || []).flat(Infinity).flatMap(walk)]
const textOf = tree => !tree ? '' : typeof tree === 'object' ? (tree.children || []).flat(Infinity).map(textOf).join(' ') : String(tree)

test('任务与 Agent 说明保留完整正文；原始 prompt 和交回 schema 不进入阅读面', () => {
  const message = '# 当前进展\n\n' + '完整保留有用的说明。\n'.repeat(1000) + '\n<img src=x onerror=alert(1)>\n说明末尾'
  const tree = renderAttempt({ 次: 3, 执行者: 'Claude Code', 任务: { 目标: '验证动画的实际效果。' },
    输入: { prompt: '系统提示不显示', 交回格式: { type: 'object' } }, 步骤: [{ t: 1, 类: '说', 文: message }] })
  const nodes = walk(tree), sources = nodes.filter(node => node.type === 'Markdown').map(node => node.props.source)
  assert.deepEqual(sources, ['验证动画的实际效果。', message])
  assert.equal(nodes.some(node => node.type === 'img'), false)
  assert.doesNotMatch(textOf(tree), /系统提示不显示|schema|prompt/)
  assert.equal(nodes.some(node => node.type === 'pre'), false)
})

test('旧执行没有任务快照时不把当前任务冒充旧请求，已有工具过程仍可展开', () => {
  const tree = renderAttempt({ 次: 1, 执行者: 'Codex', 输入: null, 步骤: [{ t: 3, 类: '命令', 文: 'npm test', 码: 1, 在跑: false }] })
  const tools = walk(tree).find(node => typeof node.type === 'function')
  assert.equal(tools.props.steps[0].文, 'npm test')
  assert.doesNotMatch(textOf(tree), /prompt|未记录.*任务|当前任务/)
})

test('头一行：前面一枚角标（CODEX／CLAUDE），后面模型、思考程度、第几次、已多久；交回了写用时；Claude Code 没选模型写跟随账号默认', () => {
  assert.equal(外部run角标字(做着), 'CODEX')
  assert.equal(外部run角标字({ 执行者: 'Claude Code', 短名: 'Claude' }), 'CLAUDE')
  assert.equal(外部run头(做着), 'gpt-6-astra · medium · 第 2 次 · 已 12 分钟')
  assert.equal(外部run头({ 执行者: 'Claude Code', model: '', effort: '', 次: 1, 在跑: false, 用时: 192_000, 状态: '完成' }), '跟随账号默认 · 第 1 次 · 用时 3 分 12 秒')
  assert.equal(时刻文(718), '11:58'); assert.equal(时刻文(3725), '1:02:05'); assert.equal(时刻文(null), '')
  assert.equal(时长文(4_000_000), '1 小时 7 分')
})

test('每一步：失败的命令带退出码、加粗；在跑的标出来；出错也算没成功', () => {
  assert.deepEqual(步显示({ t: 220, 类: '命令', 文: 'npm test', 码: 1, 在跑: false }), { 时: '03:40', 类: '命令', 文: 'npm test', 尾: '失败（1）', 命令: true, 失败: true, 在跑: false })
  assert.equal(步显示({ t: 718, 类: '命令', 文: 'npm test', 码: null, 在跑: true }).尾, '在跑')
  assert.equal(步显示({ t: 6, 类: '命令', 文: 'ls', 码: 0, 在跑: false }).失败, false)
  assert.equal(步显示({ t: 9, 类: '出错', 文: 'unauthorized' }).失败, true)
  assert.equal(步显示({ t: 9, 类: '说', 文: '先看看' }).尾, '')
})

test('停着：等你处理的原因（提到「Agent 选择」页就给按钮）；被按停、重起切断；在做和交回了不显示', () => {
  assert.deepEqual(外部run停着({ ...做着, 在跑: false, state: 'blocked', 原因: 'Codex 的登录过期了或没登录：到左窗「Agent 选择」页重新登录，再点「全部启动」' }),
    { 文: '停着：Codex 的登录过期了或没登录：到左窗「Agent 选择」页重新登录，再点「全部启动」', 去子Agent: true })
  assert.match(外部run停着({ ...做着, 在跑: false, 停因: '用户按了停' }).文, /^停下了：用户按了停。点「全部启动」/)
  assert.equal(外部run停着(做着), null)
  assert.equal(外部run停着({ ...做着, 在跑: false, 状态: '完成' }), null)
  assert.equal(外部run停着({ ...做着, 在跑: false, 收尾: true, state: 'running' }), null, '收尾那几秒不显示停下了（10-25）')
})

test('额度只有 Claude Code 报；底下那一行按状态说能不能收话、交回给了谁；还在变才接着读', () => {
  assert.equal(额度文({ five_hour: { used: 0.51 }, seven_day: { used: 0.15 } }), 'Claude 额度：5 小时窗口已用 51% · 7 天窗口已用 15%（和你自己用 Claude Code 是同一份）')
  assert.equal(额度文(null), '')
  assert.equal(外部run底(做着), '这块由 Codex 在做，中途收不到话。有话对派它的节点说。')
  assert.equal(外部run底({ ...做着, 状态: '完成' }), '结果已交回 1 · 程序分身。需要调整，可在那里补充要求。')
  assert.equal(外部run底({ ...做着, 在跑: false, state: 'blocked' }), '派出节点已收到异常信息。')
  assert.equal(外部run要轮询(做着), true)
  assert.equal(外部run要轮询({ ...做着, 在跑: false, state: 'retrying' }), true)
  assert.equal(外部run要轮询({ ...做着, 在跑: false, 收尾: true, state: 'running' }), true, '收尾那几秒接着读，交回了才停')
  assert.equal(外部run要轮询({ ...做着, 在跑: false, state: '' }), true, '还没开工')
  assert.equal(外部run要轮询({ ...做着, 在跑: false, state: 'blocked' }), false)
  assert.equal(外部run要轮询({ ...做着, 状态: '完成' }), false)
})

test('说明和工具分开分组，历史未结束的命令不会冒充仍在运行', () => {
  const input = [{ 类: '说', 文: '先检查' }, { 类: '命令', 文: 'node --test', 在跑: true, 码: null }, { 类: '改文件', 文: '动画.js' }, { 类: '说', 文: '再验证' }]
  const inactive = 外部run段落(input)
  assert.deepEqual(inactive.map(item => item.type), ['message', 'tools', 'message'])
  assert.equal(inactive[1].steps[0].中断, true); assert.equal(inactive[1].steps[0].在跑, false)
  assert.equal(input[1].在跑, true, '不改写数据源')
  assert.equal(外部run段落(input, true)[1].steps[0].在跑, true)
})

test('进程结束与任务交付分开：重试、整理、停止不冒充成功；当前轮次优先，历史倒序', () => {
  assert.equal(外部run概况({ ...做着, 在跑: false, endedAt: '刚结束' }).label, '正在整理交回')
  assert.equal(外部run概况({ ...做着, 在跑: false, state: 'retrying' }).label, '等待自动重试')
  assert.equal(外部run概况({ ...做着, 在跑: false, state: 'blocked' }).label, '需要处理')
  assert.equal(外部run概况({ ...做着, 在跑: false }).label, '已停止')
  assert.equal(外部run概况({ ...做着, 状态: '完成', result: 'unmet' }).label, '未达成')
  const attempts = 外部run轮次({ 次: 10, 历次: [{ 次: 1 }, { 次: 2 }, { 次: 10 }] })
  assert.equal(attempts.current.次, 10); assert.deepEqual(attempts.earlier.map(item => item.次), [2, 1])
})
