import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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

test('系统 DSH home 与 profile 的默认值来自 homedir 与 desktop', () => {
  assert.equal(systemDshHome({}), join(homedir(), '.dsh'))
  assert.equal(systemDshHome({ BLUEPRINT_SYSTEM_DSH_HOME: 'C:/custom-dsh' }), 'C:/custom-dsh')
  assert.equal(systemDshProfile({}), 'desktop')
  assert.equal(systemDshProfile({ BLUEPRINT_SYSTEM_DSH_PROFILE: 'web' }), 'web')
})
