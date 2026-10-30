import test from 'node:test'
import assert from 'node:assert/strict'
import { 精简工具文案, 重复工具段 } from './src/工具文案.js'
import { 装 } from './src/index.js'

/** 描述不参与校验；字段名、类型、默认值、枚举与其余约束必须完全一致。 */
function 参数约束(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema
  const { description, properties, items, ...rest } = schema
  return {
    ...rest,
    ...(properties ? { properties: Object.fromEntries(Object.entries(properties).map(([name, value]) => [name, 参数约束(value)])) } : {}),
    ...(items ? { items: 参数约束(items) } : {}),
  }
}

const native = () => ({
  name: 'bash', description: 'Long native operation explanation. '.repeat(100),
  execute: () => 'executor unchanged', output: { schema: { type: 'object' } },
  parameters: { type: 'object', additionalProperties: false, properties: {
    command: { type: 'string', minLength: 1, description: 'Command to execute.' },
    description: { type: 'string', description: 'UI action label.' },
    run_in_background: { type: 'boolean', default: false, description: 'Background flag.' },
    sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'], description: 'Permission escalation.' },
    justification: { type: 'string', minLength: 1, description: 'Approval reason.' },
    future: { type: 'object', properties: { value: { type: 'integer', minimum: 1, description: 'Future native parameter.' } } },
  }, required: ['command', 'description'] },
})

test('精简保留所有参数约束、执行与输出；新字段和原始定义不被修改', () => {
  const tool = native(), original = structuredClone(tool.parameters)
  const changed = 精简工具文案(tool)
  assert.ok(JSON.stringify(changed).length < JSON.stringify(tool).length)
  assert.deepEqual(参数约束(changed.parameters), 参数约束(original))
  assert.deepEqual(tool.parameters, original)
  assert.equal(changed.parameters.properties.future, tool.parameters.properties.future)
  assert.equal(changed.execute, tool.execute)
  assert.equal(changed.output, tool.output)
  assert.equal(changed.execute(), 'executor unchanged')
  for (const unrelated of [{ name: 'custom', parameters: tool.parameters }, { name: 'bash', parameters: { properties: { unrelated: { type: 'string' } } } }]) {
    assert.equal(精简工具文案(unrelated), unrelated)
  }
})

test('数组参数的字段名与校验结构保留；仅缩短说明', () => {
  const tool = { name: 'ask_user_question', parameters: { type: 'object', properties: {
    questions: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: true,
      properties: { id: { type: 'string', description: 'Stable identifier.' }, question: { type: 'string', description: 'Question body.' } }, required: ['id', 'question'] } },
  }, required: ['questions'] } }
  assert.deepEqual(参数约束(精简工具文案(tool).parameters), 参数约束(tool.parameters))
})

test('装配使用精简工具定义，并只撤掉已被该工具说明覆盖的重复段；非 Blueprint 原样通过', async () => {
  let assemble
  装({ systemPrompt: { section() {}, context() {} }, sessions: { get() {} },
    on(name, fn) { if (name === 'system-prompt/assemble') assemble = fn } })
  const tool = native()
  const input = { sections: [{ name: 'blueprint:公共前缀', text: 'Blueprint' },
    { name: 'tool:bash', text: 'Repeated bash usage.' }, { name: 'tool:read', text: 'Read usage without matching tool.' },
    { name: 'tool:jobs', text: 'Native jobs lifecycle.' }], contexts: [], tools: [tool] }
  const changed = await assemble(null, null, async () => input)
  assert.equal(changed.tools.length, input.tools.length)
  assert.deepEqual(参数约束(changed.tools[0].parameters), 参数约束(tool.parameters))
  assert.equal(changed.tools[0].execute, tool.execute)
  assert.deepEqual(changed.sections.map(s => s.name), ['blueprint:公共前缀', 'tool:read', 'tool:jobs'])
  const foreign = { ...input, sections: [{ name: 'tool:bash' }] }
  assert.equal(await assemble(null, null, async () => foreign), foreign)
  assert.equal(重复工具段({ name: 'tool:bash' }, [tool]), false)
})
