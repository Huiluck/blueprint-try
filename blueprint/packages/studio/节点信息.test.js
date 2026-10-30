import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { 落新名册, 改名册, 加行, 记会话, 排队, 写工作文档, 新工作文档, 工作文档路径, 名册路径 } from '../roster/src/index.js'
import { 读节点信息, 节点成果报告, 节点信息HTTP } from './src/节点信息.js'
import { 座位们Of } from './src/名册视图.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), '节点信息分型核对-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await 落新名册(root, '游戏总制作人', '做一个可以玩的游戏')
  const { 名册: roster } = await 改名册(root, m => {
    m = 加行(m, '0', { name: '美术分身', task: '完成这一轮视觉', goal: '游戏视觉统一' }).名册
    m = 加行(m, '1', { name: '角色制作', task: '制作主角', goal: '可以使用的角色动画' }).名册
    m = 加行(m, '1', { name: '场景制作', task: '制作场景', goal: '关卡的背景和地面' }).名册
    m = 记会话(m, '0', 'project-root')
    return { ...m, rows: m.rows.map(r => ({ ...r,
      ...(r.id === '0' ? { strategyReview: { execution: { 落定: { blocks: [{ id: '1', name: '美术分身', action: 'add', situation: '已有游戏原型', ask: '判断画面风格', purpose: '游戏视觉统一' }] } } } } : {}),
      ...(r.id === '1' ? { role: 'dock', strategyReview: { execution: { 落定: { whole: '把游戏视觉统一起来', shared: '用户原话：要像素风', blocks: [{ id: '1.1', action: 'add', situation: '主角动作还未制作', ask: '判断走路动作节奏', approach: '沿已有角色比例制作',
        level: 'polished', link: '主角是玩家一直盯着看的那一块', rules: '帧尺寸 64×64', peers: '场景那一块也按这个帧尺寸摆', expect: '轻快、有弹性（旧格子）' }] } } } } : {}),
      ...(r.id === '1.2' ? { role: 'run', p: 'p3' } : {}),
      ...(r.id === '1.1' ? { executor: 'codex', status: '完成', level: 'polished', bench: '验收台/主角', result: 'unmet', handoff: '角色已导出，动画衔接仍需调整。\n\n——以下由系统补上——\n内部系统补丁不要上屏', checked: '检查了图集尺寸', unchecked: '未验证游戏内手感', handoffQuestion: '选择哪种步态？' } : {}),
    })) }
  })
  await 排队(root, async () => {
    for (const row of roster.rows) await 写工作文档(root, row, 新工作文档(row, '系统启动说明，不应显示', {
      responsibility: row.id === '1' ? '负责角色与场景的视觉一致性' : '',
      structure: '### 工作方案\n先验证整体效果，再完善细节。\n\n### 这一轮派出\n内部 key / rewrite / schema 不要上屏',
      record: '【预测认识 · 研究】\n内部预测不展示\n\n【第 1 圈 · 成果报告】\n已验证可运行的原型。\n\n【调查预测】\n内部调查不展示\n\n【第 2 轮轮报告】\n角色已能在游戏中移动。',
    }))
  })
  return { root, roster }
}

test('helm、dock、无会话的外部 run 分别提供职责、分工、成果及真实验收；不返回系统材料', async t => {
  const { root } = await fixture(t), before = await readFile(名册路径(root))
  const helm = await 读节点信息(root, '0'), dock = await 读节点信息(root, '1'), run = await 读节点信息(root, '1.1')
  assert.equal(helm.kind, 'helm'); assert.equal(helm.parent, null); assert.equal(helm.children[0].kind, 'dock')
  assert.equal(helm.projectRequest, '做一个可以玩的游戏')
  assert.equal(Object.hasOwn(dock, 'projectRequest'), false); assert.equal(Object.hasOwn(run, 'projectRequest'), false)
  assert.equal(dock.kind, 'dock'); assert.equal(Object.hasOwn(dock, 'seatScope'), false, '座位撤了（第三版 10-24）'); assert.equal(Object.hasOwn(dock, 'mode'), false); assert.equal(dock.ask, '判断画面风格')
  assert.deepEqual(await 座位们Of(join(root, '系统文档')), [], '座位表投影一律空')
  assert.equal(dock.responsibility, '负责角色与场景的视觉一致性'); assert.equal(dock.children[0].id, '1.1')
  assert.equal(run.kind, 'run'); assert.equal(run.session, ''); assert.equal(run.executor, 'Codex'); assert.equal(run.result, 'unmet')
  assert.equal(run.approach, '沿已有角色比例制作'); assert.equal(run.unchecked, '未验证游戏内手感'); assert.equal(run.question, '选择哪种步态？')
  assert.equal(run.handoff, '角色已导出，动画衔接仍需调整。')
  // 和它收到的请求同一套六项（10-27 派 9）：做什么（goal）、之间的联系、项目情境、工作等级、同层分工（系统列兄弟＋派它的补的一句）、必要规则；旧格子原样带出给旧项目。
  assert.deepEqual([run.goal, run.whole, run.link, run.shared, run.situation, run.level, run.bench, run.rules, run.expect],
    ['可以使用的角色动画', '把游戏视觉统一起来', '主角是玩家一直盯着看的那一块', '用户原话：要像素风', '主角动作还未制作', 'polished', '验收台/主角', '帧尺寸 64×64', '轻快、有弹性（旧格子）'])
  assert.equal(run.peers, '- p3 · 场景制作（run，在做）：关卡的背景和地面\n场景那一块也按这个帧尺寸摆')
  assert.equal(helm.whole, '', 'helm 的请求来自用户，没有派它的那一份')
  assert.equal(dock.reports[0].body, '角色已能在游戏中移动。'); assert.equal(dock.reports[1].body, '已验证可运行的原型。')
  assert.doesNotMatch(JSON.stringify([helm, dock, run]), /系统启动说明|内部系统补丁|内部 key|内部预测|内部调查|出生包|systemPrompt/)
  assert.deepEqual(await readFile(名册路径(root)), before, '读取节点信息不修改执行账本')
})

test('总制作人展示项目最初的完整用户需求，后续阶段与目标改写不覆盖原文', async t => {
  const { root } = await fixture(t)
  const original = '  做一个可以玩的游戏\n\n保留 <参考> 与 **原始文字**。\n' + '完整需求，不要截断。'.repeat(500) + '\n结尾要求。  '
  await 改名册(root, m => ({ ...m, rows: [...m.rows.map(row => row.id === '0' ? { ...row,
    task: '更新后的任务', description: '当前工作目标', originalRequest: original,
    initialState: { row: { task: '带附件链接的初始任务', originalRequest: original } },
  } : row), { id: '2', kind: 'worker', parent: null, name: '下一阶段总制作人', task: '下一阶段任务', originalRequest: '后续用户要求', status: '开工', requestWriter: 'user' }] }))
  const first = await 读节点信息(root, '0'), later = await 读节点信息(root, '2')
  assert.equal(first.goal, '当前工作目标')
  assert.equal(first.projectRequest, original); assert.equal(later.projectRequest, original)
  assert.equal(later.kind, 'helm'); assert.equal(later.goal, '下一阶段任务')
  // 老项目没有独立原文字段时，优先读首次开工保存的用户任务。
  await 改名册(root, m => ({ ...m, rows: m.rows.map(row => row.id === '0' ? { ...row,
    originalRequest: undefined, initialState: { row: { task: '最初开工的用户需求' } },
  } : row) }))
  assert.equal((await 读节点信息(root, '2')).projectRequest, '最初开工的用户需求')
  // 没有保留原文的项目不拿工作文档中的系统启动说明冒充。
  await 改名册(root, m => ({ ...m, rows: m.rows.map(row => row.id === '0' ? { ...row, task: undefined, initialState: undefined } : row) }))
  assert.equal((await 读节点信息(root, '0')).projectRequest, '')
})

test('只读节点本身的文档，缺失或坏边界保留名册事实，不回退展示原始请求', async t => {
  const { root, roster } = await fixture(t), row = roster.rows.find(r => r.id === '1.1')
  await writeFile(工作文档路径(root, row), '# 错误边界\n系统全文不应作为回退显示')
  const info = await 读节点信息(root, row.id)
  assert.equal(info.documentUnavailable, true); assert.equal(info.goal, '可以使用的角色动画'); assert.deepEqual(info.reports, [])
  assert.doesNotMatch(JSON.stringify(info), /错误边界|系统全文/)
  await rm(工作文档路径(root, row))
  assert.equal((await 读节点信息(root, row.id)).documentUnavailable, true)
  await assert.rejects(读节点信息(root, '99'), /99/)
})

test('报告按独立边界提取，空报告不展示，不把其他记录并入成果', () => {
  assert.deepEqual(节点成果报告('普通记录\n【第 1 圈 · 成果报告】\n\n【调查预测】\n不要并入成果'), [])
  assert.deepEqual(节点成果报告('【第 2 轮协作说明】\n先合并美术。\n【第 3 轮下一轮方案】\n验证动画。').map(r => r.body), ['验证动画。', '先合并美术。'])
  assert.equal(节点成果报告('【第 1 圈 · 成果报告】\n【实际验证】\n动画可用。\n【调查预测】\n内部内容')[0].body, '【实际验证】\n动画可用。')
})

test('接口沿当前项目的会话授权读取，拒绝写请求、越界项目与不存在的节点', async t => {
  const { root } = await fixture(t)
  const handler = 节点信息HTTP((res, status, body) => Object.assign(res, { status, body }), { 项目根Of: async session => {
    if (session !== 'project-root') throw new Error('无权读取这个项目')
    return root
  } })
  const request = async (method, session, id) => { const res = {}; await handler({ method }, res, new URL(`http://localhost/?session=${session}&id=${id}`)); return res }
  assert.equal((await request('GET', 'project-root', '1.1')).body.value.kind, 'run')
  assert.equal((await request('POST', 'project-root', '1')).status, 405)
  assert.equal((await request('GET', 'other-project', '1')).body.ok, false)
  assert.equal((await request('GET', 'project-root', '99')).body.ok, false)
})
