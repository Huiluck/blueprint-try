import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { SYSTEM_PROVIDER_ROW_IDS, providerPatchRows, readSystemProviderRows, systemDshHome, systemDshProfile } from '../runtime/system-providers.mjs'

const patchText = `- id: desktop-shell
  config:
    theme: dark
- id: agent-default-model
  config:
    provider: opencode-go
    model: deepseek-v4.1-flash
- id: llm-pi-ai
  config:
    providers:
      opencode-go:
        api: openai-completions
- id: llm-deepseek-account
  config: {}
- id: blueprint-webserver
  config:
    port: 4321
- id: llm-deepseek
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
`

async function makeHome(files) {
  const home = await mkdtemp(join(tmpdir(), 'blueprint-system-providers-'))
  for (const [name, text] of Object.entries(files)) {
    const target = join(home, name)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, text)
  }
  return home
}

test('系统 DSH profile 只导入白名单 provider 行，并指向系统凭据文件', async () => {
  const home = await makeHome({
    'profiles/desktop/cordis.patch.yml': patchText,
    '.credentials.yaml': 'opencode-go:\n  apiKey: synthetic-key\n',
  })
  try {
    const result = await readSystemProviderRows({ environment: { BLUEPRINT_SYSTEM_DSH_HOME: home } })
    assert.equal(result.found, true)
    assert.equal(result.warning, '')
    assert.equal(result.home, home)
    assert.equal(result.profile, 'desktop')
    assert.equal(result.patchPath, join(home, 'profiles', 'desktop', 'cordis.patch.yml'))
    assert.deepEqual(result.rows.map(row => row.id), ['agent-default-model', 'llm-pi-ai', 'llm-deepseek-account', 'llm-deepseek'])
    assert.deepEqual(result.rows[0].config, { provider: 'opencode-go', model: 'deepseek-v4.1-flash' })
    assert.deepEqual(result.rows[1].config, { providers: { 'opencode-go': { api: 'openai-completions' } } })
    assert.equal(result.credentialsPath, join(home, '.credentials.yaml'))
    assert.ok(SYSTEM_PROVIDER_ROW_IDS.includes('llm-deepseek-account'))
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('provider 白名单精确固定为四类行', () => {
  assert.deepEqual(SYSTEM_PROVIDER_ROW_IDS, ['agent-default-model', 'llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account'])
})

test('profile 可由环境变量覆盖；没有凭据文件时 credentialsPath 为空且不抛', async () => {
  const home = await makeHome({
    'profiles/web/cordis.patch.yml': '- id: llm-deepseek\n  config:\n    apiKeyEnv: DEEPSEEK_API_KEY\n',
  })
  try {
    const result = await readSystemProviderRows({ environment: { BLUEPRINT_SYSTEM_DSH_HOME: home, BLUEPRINT_SYSTEM_DSH_PROFILE: 'web' } })
    assert.equal(result.found, true)
    assert.equal(result.profile, 'web')
    assert.equal(result.patchPath, join(home, 'profiles', 'web', 'cordis.patch.yml'))
    assert.deepEqual(result.rows.map(row => row.id), ['llm-deepseek'])
    assert.equal(result.credentialsPath, '')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('系统 DSH home 或 profile 缺失时返回空导入，不抛异常', async () => {
  const missing = join(tmpdir(), `blueprint-missing-dsh-home-${process.pid}-${Date.now()}`)
  const result = await readSystemProviderRows({ environment: { BLUEPRINT_SYSTEM_DSH_HOME: missing } })
  assert.equal(result.found, false)
  assert.deepEqual(result.rows, [])
  assert.equal(result.credentialsPath, '')
  assert.match(result.warning, /不存在/)
  assert.equal(result.home, missing)
  assert.equal(result.patchPath, join(missing, 'profiles', 'desktop', 'cordis.patch.yml'))

  const home = await makeHome({ '.credentials.yaml': '{}\n' })
  try {
    const noProfile = await readSystemProviderRows({ environment: { BLUEPRINT_SYSTEM_DSH_HOME: home } })
    assert.equal(noProfile.found, false)
    assert.deepEqual(noProfile.rows, [])
    assert.equal(noProfile.credentialsPath, join(home, '.credentials.yaml'))
    assert.match(noProfile.warning, /不存在/)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('YAML 损坏、为空或不是补丁行列表时只给 warning，不抛异常', async () => {
  for (const text of ['- id: llm-pi-ai\n  config: [unclosed\n', 'null\n', 'id: llm-pi-ai\nconfig: {}\n']) {
    const home = await makeHome({ 'profiles/desktop/cordis.patch.yml': text })
    try {
      const result = await readSystemProviderRows({ environment: { BLUEPRINT_SYSTEM_DSH_HOME: home } })
      assert.equal(result.found, false, `应判定不可用：${JSON.stringify(text)}`)
      assert.deepEqual(result.rows, [])
      assert.notEqual(result.warning, '', `应给出 warning：${JSON.stringify(text)}`)
    } finally { await rm(home, { recursive: true, force: true }) }
  }
})

test('!!js 表达式按 composition 的标签形状保留，不把带表达式的 provider 行判成损坏', async () => {
  const home = await makeHome({
    'profiles/desktop/cordis.patch.yml': `- id: agent-default-model
  config: !!js 读取默认模型()
- id: llm-pi-ai
  config:
    providers:
      opencode-go:
        api: !!js process.env.OPENCODE_API
        models:
          - id: model-a
            name: !!js 模型名()
- id: desktop-shell
  config:
    title: !!js 标题()
`,
  })
  try {
    const result = await readSystemProviderRows({ environment: { BLUEPRINT_SYSTEM_DSH_HOME: home } })
    assert.equal(result.found, true, result.warning)
    assert.equal(result.warning, '')
    assert.deepEqual(result.rows.map(row => row.id), ['agent-default-model', 'llm-pi-ai'])
    assert.deepEqual(result.rows[0].config, { __jsExpr: '读取默认模型()' })
    assert.deepEqual(result.rows[1].config, {
      providers: {
        'opencode-go': {
          api: { __jsExpr: 'process.env.OPENCODE_API' },
          models: [{ id: 'model-a', name: { __jsExpr: '模型名()' } }],
        },
      },
    })
    assert.deepEqual(providerPatchRows(result)[0].config, { __jsExpr: '读取默认模型()' })
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('混合数组（null/数字/字符串/数组/重复 id）只保留白名单对象行，顺序与重复行照原文件', async () => {
  const home = await makeHome({
    'profiles/desktop/cordis.patch.yml': `- null
- 42
- 纯字符串
- [1, 2]
- id: llm-pi-ai
  config:
    providers:
      route-a:
        api: openai-completions
- id: agent-default-model
  config:
    provider: route-a
    model: 第一个
- id: agent-default-model
  config:
    model: 第二个
`,
  })
  try {
    const result = await readSystemProviderRows({ environment: { BLUEPRINT_SYSTEM_DSH_HOME: home } })
    assert.equal(result.found, true)
    assert.equal(result.warning, '')
    assert.deepEqual(result.rows.map(row => row.id), ['llm-pi-ai', 'agent-default-model', 'agent-default-model'])
    assert.deepEqual(result.rows[1].config, { provider: 'route-a', model: '第一个' })
    assert.deepEqual(result.rows[2].config, { model: '第二个' })
    // 重复 id 原样保留：交给 patch 链按顺序覆盖，和系统 profile 自身的语义一致。
    assert.deepEqual(providerPatchRows(result), result.rows)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('profile 名与 home 做路径校验：../、绝对路径、空串、非目录都按不可用处理，不抛异常', async () => {
  const home = await makeHome({
    'profiles/desktop/cordis.patch.yml': '- id: llm-deepseek\n  config:\n    apiKeyEnv: DEEPSEEK_API_KEY\n',
    'profiles/v2.beta_1/cordis.patch.yml': '- id: llm-pi-ai\n  config:\n    providers: {}\n',
  })
  const fileHome = join(home, 'not-a-home.txt')
  await writeFile(fileHome, 'x')
  try {
    for (const profile of ['', '..', '../..', '..\\escape', 'a/b', 'a\\b', join(tmpdir(), 'absolute-profile')]) {
      const result = await readSystemProviderRows({ environment: { BLUEPRINT_SYSTEM_DSH_HOME: home, BLUEPRINT_SYSTEM_DSH_PROFILE: profile } })
      assert.equal(result.found, false, `应拒绝 profile：${JSON.stringify(profile)}`)
      assert.deepEqual(result.rows, [])
      assert.equal(result.patchPath, '', '非法 profile 不拼出可能越界的路径')
      assert.notEqual(result.warning, '', `应给出 warning：${JSON.stringify(profile)}`)
    }
    // 只含点、下划线、连字符的单段名字仍然是合法 profile。
    const dotted = await readSystemProviderRows({ environment: { BLUEPRINT_SYSTEM_DSH_HOME: home, BLUEPRINT_SYSTEM_DSH_PROFILE: 'v2.beta_1' } })
    assert.equal(dotted.found, true)
    assert.deepEqual(dotted.rows.map(row => row.id), ['llm-pi-ai'])

    // 显式空 home 不回退到 ~/.dsh，也不把当前工作目录当成系统配置目录。
    const emptyHome = await readSystemProviderRows({ environment: { BLUEPRINT_SYSTEM_DSH_HOME: '', BLUEPRINT_SYSTEM_DSH_PROFILE: 'desktop' } })
    assert.equal(emptyHome.found, false)
    assert.equal(emptyHome.home, '')
    assert.deepEqual(emptyHome.rows, [])
    assert.match(emptyHome.warning, /为空/)

    const notDirectory = await readSystemProviderRows({ environment: { BLUEPRINT_SYSTEM_DSH_HOME: fileHome } })
    assert.equal(notDirectory.found, false)
    assert.deepEqual(notDirectory.rows, [])
    assert.match(notDirectory.warning, /不是目录/)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('凭据路径指向目录时按不存在处理，不追加 credentials 覆盖行', async () => {
  const home = await makeHome({ 'profiles/desktop/cordis.patch.yml': patchText })
  await mkdir(join(home, '.credentials.yaml'))
  try {
    const result = await readSystemProviderRows({ environment: { BLUEPRINT_SYSTEM_DSH_HOME: home } })
    assert.equal(result.found, true)
    assert.equal(result.credentialsPath, '')
    const imported = providerPatchRows(result)
    assert.deepEqual(imported.map(row => row.id), result.rows.map(row => row.id))
    assert.ok(!imported.some(row => row.id === 'credentials'))
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('backend 启动时把系统 DSH 导入 warning 写到 stderr，不静默丢弃也不阻断启动', async () => {
  const source = await readFile(new URL('../runtime/backend.mjs', import.meta.url), 'utf8')
  assert.match(source, /process\.stderr\.write\(`Blueprint: 系统 DSH 模型配置：\$\{[^}]+\}\\n`\)/,
    'warning 必须带固定前缀写到 stderr，便于用户和日志检索')
  assert.ok(source.includes('providerPatchRows(systemProviderImport)'),
    'warning 之外仍以可用的 provider 行继续启动')
})

test('providerPatchRows 只保留白名单行，并在凭据文件存在时追加 credentials 覆盖行', () => {
  const rows = [
    { id: 'desktop-shell', config: { theme: 'dark' } },
    { id: 'agent-default-model', config: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } },
    { id: 'credentials', config: { path: 'C:/old/.credentials.yaml' } },
  ]
  const withCredentials = providerPatchRows({ rows, credentialsPath: 'C:/system/.credentials.yaml' })
  assert.deepEqual(withCredentials, [
    { id: 'agent-default-model', config: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } },
    { id: 'credentials', config: { path: 'C:/system/.credentials.yaml' } },
  ])
  assert.deepEqual(providerPatchRows({ rows }), [
    { id: 'agent-default-model', config: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } },
  ])
  assert.deepEqual(providerPatchRows(), [])
})

test('系统 DSH home 与 profile 的默认值来自 homedir 与 desktop，显式空值不回退', () => {
  assert.equal(systemDshHome({}), join(homedir(), '.dsh'))
  assert.equal(systemDshHome({ BLUEPRINT_SYSTEM_DSH_HOME: 'C:/custom-dsh' }), 'C:/custom-dsh')
  assert.equal(systemDshHome({ BLUEPRINT_SYSTEM_DSH_HOME: '' }), '')
  assert.equal(systemDshProfile({}), 'desktop')
  assert.equal(systemDshProfile({ BLUEPRINT_SYSTEM_DSH_PROFILE: 'web' }), 'web')
  assert.equal(systemDshProfile({ BLUEPRINT_SYSTEM_DSH_PROFILE: '' }), '')
})
