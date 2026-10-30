import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script, createContext, runInContext } from 'node:vm'
import { 协作模式们, 协作模式Of, 运行模式Of, 一段, 原生工具文案 } from './src/index.js'

test('三种模式 spark、build、solo（十 55）；旧名都按 build 读，后一次选择优先；spark 之后按 solo 跑', () => {
  assert.deepEqual(协作模式们().map(x => x.id), ['spark', 'build', 'solo'])
  for (const id of ['build', 'solo']) {
    const chosen = 协作模式Of(`明确需求\nMode: ${id}（参与频率）`)
    assert.equal(chosen.id, id)
    assert.ok(一段(chosen.prompt).startsWith(`当前协作方式：${chosen.label}。`), id)
  }
  // co-create 改名 build；conduct 去掉了；旧项目里的写法都按 build 读（问卡 2、十 55）。
  for (const old of ['co-create', 'conduct', 'light-collab', 'execute', 'high-collab']) assert.equal(协作模式Of(`Mode: ${old}`).id, 'build')
  assert.equal(协作模式Of('Mode: solo\nMode: conduct').id, 'build')
  assert.equal(协作模式Of('Quality: max；Mode: solo').id, 'solo')
  assert.equal(协作模式Of('Mode: solo\nMode: 任意自由表述'), null)
  assert.equal(协作模式Of('没有模式'), null)
  // spark 只是前置组件：交完以后按 solo 跑；helm 行上记的这一阶段的模式优先（十 56）。
  assert.equal(协作模式Of('Mode: spark').id, 'spark')
  assert.equal(运行模式Of('Mode: spark').id, 'solo')
  assert.equal(运行模式Of('Mode: spark', 'build').id, 'build')
  assert.equal(运行模式Of('Mode: build', 'solo').id, 'solo')
  assert.equal(运行模式Of('Mode: co-create').id, 'build')
  assert.equal(运行模式Of('没有模式'), null)
})

test('没有提问卡：build 在对话里问、wait 等回话，方案照旧审；solo 不问不送审', () => {
  const co = 协作模式们().find(mode => mode.id === 'build'), solo = 协作模式们().find(mode => mode.id === 'solo')
  const 共创 = 一段(co.prompt), 独自 = 一段(solo.prompt)
  assert.match(共创, /需要形成或调整执行方案时.*节点.*终稿/s)
  assert.match(共创, /通过后/)
  assert.doesNotMatch(共创, /spark/, 'spark 撤了（第三版 10-24）')
  assert.match(共创, /在对话里直接问用户.*链接.*wait 等用户回话/s)
  assert.match(独自, /方案不送审，过程中不问用户/)
  assert.notEqual(solo.prompt, co.prompt)
  for (const 文 of [共创, 独自]) assert.doesNotMatch(文, /ask_user_question|推荐/)
  assert.ok(!Object.hasOwn(原生工具文案(), 'ask_user_question'), '提问工具的说明一并删掉')
  // 按钮下面那句是用户写的（10-25），原样用。
  assert.deepEqual(协作模式们().map(mode => mode.description), ['还没想好要什么，需要Blueprint与我一起构思', '我大概知道我要什么，执行的具体方案多问我', '我都说清楚了，全部自己决断，不用问我'])
  // 输入框里的引导给第一次用的人看，不出现内部词。
  for (const mode of 协作模式们()) for (const text of mode.guide) assert.doesNotMatch(text, /节点|座位|分身|方案|照见|spark|conduct|推荐/, mode.id)
})

test('新项目显示协作频率，旧浏览器选择按含义迁移；提交保留稳定标识', () => {
  const html = readFileSync(new URL('../../../viewer/studio.html', import.meta.url), 'utf8')
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new Script(match[1])
  const start = html.indexOf('function 造条('), end = html.indexOf('\n(async function wireNewProject', start)
  const code = html.slice(start, end)
  const modes = 协作模式们()
  // 十 55：spark、build、solo，默认第一项 spark；上一版存的 co-create 迁成 build，solo 照旧；再旧的下标照旧迁移。
  const map = {'co-create':'build', execute:'build', solo:'solo', 0:'build', 2:'solo'}
  for (const [saved, expected] of [[null,'spark'], ['co-create','build'], ['execute','build'], ['solo','solo'], ['1','spark']]) {
    const values = new Map(saved == null ? [] : [['studio-mode-4', saved]])
    let inputs = [], painted
    const host = {
      set innerHTML(value) { this.markup = value; inputs = [...value.matchAll(/<input[^>]*value="(\d+)"([^>]*)>/g)].map(m => ({value:m[1], _checked:m[2].includes('checked'), get checked(){return this._checked}, set checked(v){if(v)for(const x of inputs)x._checked=false;this._checked=v}})) },
      querySelectorAll() { return inputs }, querySelector() { return {} },
    }
    const row = {名:'Mode', key:'studio-mode-5', 默认:0, 挡:modes.map(m=>({名:m.id, 显示名:m.label, 说:m.description})), 迁移:[{key:'studio-mode-4',挡:map}]}
    const ctx = createContext({host,row,mem:{get:k=>values.get(k),set:(k,v)=>values.set(k,v)}, paint:v=>painted=v})
    runInContext(`${code}\nglobalThis.current=造条(host,row,paint);`, ctx)
    assert.equal(ctx.current().名, expected)
    assert.equal(painted.名, expected)
    assert.ok(host.markup.includes('>spark<') && host.markup.includes('>build<') && host.markup.includes('>solo<'))
    assert.ok(!host.markup.includes('>conduct<') && !host.markup.includes('>execute<') && !host.markup.includes('高度协作'))
    if (saved != null && Object.hasOwn(map, saved)) assert.equal(values.get('studio-mode-5'), expected)
  }
})
