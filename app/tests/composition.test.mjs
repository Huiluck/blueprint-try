import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { readDesktopComposition, prepareDesktopProfile } from '../runtime/composition.mjs'

const appRoot = fileURLToPath(new URL('../', import.meta.url))
const repo = resolve(appRoot, '..')
const require = createRequire(join(appRoot, 'package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)

test('源码与桌面共用 canonical 工具清单，解析依赖和技能路径不受启动目录影响', async () => {
  const result = await readDesktopComposition({ resourceRoot: join(appRoot, 'runtime'), sourceRoot: repo,
    promptDir: '/isolated-data/prompt', resolvePlugin: name => pathToFileURL(require.resolve(name)).href })
  assert.equal(result.preset.id, 'blueprint')
  assert.equal(result.plugins.find(row => row.id === 'blueprint-runtime').isolate.blueprintToolCatalog, true)
  assert.equal(result.plugins.find(row => row.id === 'skill-filesystem').name,
    pathToFileURL(join(repo, 'blueprint/packages/context/src/技能加载.js')).href)
  assert.deepEqual(result.plugins.find(row => row.id === 'skill-filesystem').config.customSkillDirs, [join('/isolated-data/prompt', 'skill')])
  const entries = result.patches.flatMap(row => row.insert || [row]);
  assert.equal(entries.find(row => row.id === 'ui-layout').disabled,true);
  assert.equal(entries.find(row => row.id === 'ui-brand-official').disabled,true);
  for(const id of ['blueprint-layout','blueprint-canvas','blueprint-brand','blueprint-files','blueprint-feed','blueprint-workspace','blueprint-skill','blueprint-media-page']) assert.equal(entries.filter(row => row.id === id).length,1);
  assert.equal(entries.findLast(row => row.id === 'blueprint-fetch-http').name,pathToFileURL(join(appRoot,'runtime/fetch.mjs')).href);
  assert.equal(entries.findLast(row => row.id === 'blueprint-search').name,pathToFileURL(join(appRoot,'runtime/search.mjs')).href);
  assert.ok(!entries.some(row => row.id === 'session'), '核心行由 base/web-app 提供');
  assert.deepEqual(result.clientPackages.map(path=>path.split(/[\\/]/).at(-1)),['layout','canvas','brand','files','feed','workspace','skill','media']);
  assert.equal(result.plugins.filter(row => row.id === 'tool-goal').length, 1)
  assert.equal(result.plugins.find(row => row.id === 'tool-goal').name,
    '@deepseek-ai/dsh-tool-goal')
  assert.deepEqual(entries.find(row => row.id === 'subagent-ralph-spawn').config, { providerName: 'blueprint-ralph' })
  assert.deepEqual(result.plugins.find(row => row.id === 'blueprint-ralph').isolate, { workflowEngine: true })
  assert.deepEqual(result.plugins.find(row => row.id === 'blueprint-runtime').config.find(row => row.id === 'blueprint-node').config.executionRuntimeEntries,
    [pathToFileURL(require.resolve('@deepseek-ai/dsh-ptc-runtime-node')).href])
})

test('系统 DSH provider 行导入到 patch 链，位于 host.json 覆盖之前', async () => {
  const systemProviderRows = [
    { id: 'agent-default-model', config: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } },
    { id: 'llm-pi-ai', config: { providers: { 'opencode-go': { api: 'openai-completions' } } } },
    { id: 'credentials', config: { path: join(tmpdir(), 'system-credentials.yaml') } },
  ]
  const result = await readDesktopComposition({ resourceRoot: join(appRoot, 'runtime'), sourceRoot: repo,
    promptDir: '/isolated-data/prompt', resolvePlugin: name => pathToFileURL(require.resolve(name)).href, systemProviderRows })
  const overrides = JSON.parse(await readFile(join(appRoot, 'runtime/host.json'), 'utf8'))
  const start = result.patches.length - overrides.length - systemProviderRows.length
  assert.deepEqual(result.patches.slice(start, start + systemProviderRows.length), systemProviderRows,
    '系统 provider 行原样接在 bundle 补丁之后')
  assert.equal(result.patches.findIndex(row => row.id === 'credentials'), start + systemProviderRows.length - 1,
    'credentials 覆盖行随系统 provider 行导入')
  assert.ok(result.patches.slice(-overrides.length).every(row => overrides.some(item => item.id === row.id)),
    '宿主覆盖仍是 patch 链最后一段')
})

test('刷新 App 默认装配保留个人 patch、manifest 字段和其他 bundle，清空 Loader 根', async () => {
  const home = await mkdtemp(join(tmpdir(), 'blueprint-native-profile-files-'))
  try {
    const input = { engineHome: home, installAnchor: join(appRoot, 'package.json'), cwd: home,
      patches: [{id:'agent-preset-registry',config:{default:'blueprint'}},{insert:[{id:'preset-blueprint'}]}], plugins: [], preset: { id: 'blueprint', name: 'Blueprint' } }
    const first = await prepareDesktopProfile(input)
    const custom = '# 个人注释\n- id: llm-pi-ai\n  config: { providers: {} }\n'
    await writeFile(first.profileContext.patchPath, custom)
    const manifest = JSON.parse(await readFile(join(first.profileContext.dir, 'package.json'), 'utf8'))
    manifest.note = '个人内容'
    manifest.dsh.profile.bundles.push('custom-official-bundle')
    await writeFile(join(first.profileContext.dir, 'package.json'), JSON.stringify(manifest))
    await writeFile(first.configPath, JSON.stringify([{ id: 'old-baked-row', name: 'noop' }]))
    await prepareDesktopProfile({ ...input, plugins: [{ id: 'new-default', name: 'cordis:group', group: true, config: [] }] })
    assert.equal(await readFile(first.profileContext.patchPath, 'utf8'), custom)
    assert.deepEqual(JSON.parse(await readFile(first.configPath, 'utf8')), [])
    const next = JSON.parse(await readFile(join(first.profileContext.dir, 'package.json'), 'utf8'))
    assert.equal(next.note, '个人内容')
    assert.deepEqual(next.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@blueprint/bundle', 'custom-official-bundle'])
    await writeFile(join(first.profileContext.dir, 'package.json'), '["invalid-profile"]\n')
    await assert.rejects(prepareDesktopProfile(input), /JSON 对象/)
    assert.equal(await readFile(join(first.profileContext.dir, 'package.json'), 'utf8'), '["invalid-profile"]\n', '无效的个人 manifest 原样保留')
  } finally { await rm(home, { recursive: true, force: true }) }
})

async function waitFor(read, label) {
  const until = Date.now() + 3000
  while (Date.now() < until) {
    const value = read()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`原生配置未就绪：${label}`)
}

test('真实 alpha profile 贯通旧设置导入、模型与媒体保存、冲突校验、Include 和重启恢复', {timeout:20000}, async () => {
  const home = await mkdtemp(join(tmpdir(), 'blueprint-native-settings-persistence-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const { boot, loadProfileDirectory, readProfilePatches, createRuntimeResolution, PluginPackages } = await load('@deepseek-ai/dsh-app-boot')
  const { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } = await load('@deepseek-ai/dsh-launch-environment')
  let ctx
  try {
    const media = { name: '合成媒体连接', baseURL: 'http://127.0.0.1:9/v1', api: 'openai-media',
      apiKeyEnv: 'BLUEPRINT_SYNTHETIC_MEDIA_KEY', models: [{ id: 'synthetic-image', name: '合成图片模型', operations: ['image.generate'], defaults: {} }] }
    const provider = { api: 'openai-completions', baseURL: 'http://127.0.0.1:9/v1', apiKeyEnv: 'BLUEPRINT_SYNTHETIC_MODEL_KEY',
      models: [{ id: 'synthetic-model', name: '合成模型', input: ['text'], contextWindow: 32768, maxTokens: 2048 }] }
    await writeFile(join(home, 'settings.yaml'), JSON.stringify({
      'agent-default-model': { provider: 'synthetic-route', model: 'synthetic-model' },
      'llm-deepseek': { baseURL: 'http://127.0.0.1:9', apiKeyEnv: 'BLUEPRINT_SYNTHETIC_DEEPSEEK_KEY' },
      'llm-pi-ai': { providers: { 'synthetic-route': provider } },
      'blueprint-media': { connections: { 'synthetic-media': media } },
    }))
    const helper = join(home, 'preset-helper.mjs')
    await writeFile(helper, 'export function apply() {}\n')
    const studioRoot = join(repo, 'blueprint/packages/studio')
    const studioManifest = JSON.parse(await readFile(join(studioRoot, 'package.json'), 'utf8'))
    const rows = [
      ['config-editor', '@deepseek-ai/dsh-config-editor'], ['settings', '@deepseek-ai/dsh-settings'],
      ['session', '@deepseek-ai/dsh-session'], ['session-projection', '@deepseek-ai/dsh-session-projection'],
      ['llm', '@deepseek-ai/dsh-llm'], ['llm-pi-ai', '@deepseek-ai/dsh-llm-pi-ai'],
      ['llm-deepseek', '@deepseek-ai/dsh-llm-deepseek-api-key'],
      ['blueprint-media', '@blueprint/bundle/media-settings'],
    ].map(([id, name]) => ({ id, name }))
    rows.push({ id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model',
      config: { provider: 'deepseek-official', model: 'deepseek-flash' } })
    const input = { engineHome: home, installAnchor: join(appRoot, 'package.json'), cwd: home, patches: [
        ...rows.filter(row=>row.id!=='blueprint-media'),
        {insert:[rows.find(row=>row.id==='blueprint-media'),{id:'preset-blueprint'}]},
      ],
      plugins: [{ id: 'preset-helper', name: pathToFileURL(helper).href }], preset: { id: 'blueprint', name: 'Blueprint 合成测试' },
      mediaSettingsPath: pathToFileURL(join(studioRoot, studioManifest.exports['./media-settings'])).href }
    const {provideCmdline}=await load('@deepseek-ai/dsh-cmdline')
    const open = async () => {
      const prepared = await prepareDesktopProfile(input)
      const context = prepared.profileContext
      const profile = loadProfileDirectory('Blueprint-test', context.dir, context.installAnchor)
      assert.deepEqual(profile.skippedBundles, [])
      const resolution = await createRuntimeResolution({ installAnchor: context.installAnchor, profile, home })
      const readiness=new Set()
      const runtime=await boot('Blueprint-test', prepared.configPath, readProfilePatches('Blueprint-test', context, profile), async host => {
        host.provide('profileContext', context)
        provideCmdline(host,{args:['--no-open','--port','0'],ready:{onReady:listener=>{readiness.add(listener);return ()=>readiness.delete(listener)}},exit:code=>{throw Error('unexpected exit '+code)}})
        host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values: { DSH_HOME: home } }]))
        await host.plugin(PluginPackages, { resolution })
      })
      for(const listener of readiness) listener()
      return runtime
    }
    ctx = await open()
    const descriptor = ns => ctx.settings.describe().find(row => row.ns === ns)
    await waitFor(() => descriptor('blueprint-media')?.value.connections?.['synthetic-media'], '媒体旧设置迁移')
    assert.equal(descriptor('llm-pi-ai').value.providers['synthetic-route'].apiKeyEnv, provider.apiKeyEnv)
    assert.equal(descriptor('llm-deepseek').value.apiKeyEnv, 'BLUEPRINT_SYNTHETIC_DEEPSEEK_KEY')
    assert.deepEqual(ctx.agentDefaultModel.currentSelection(), { provider: 'synthetic-route', model: 'synthetic-model' })
    assert.deepEqual(await ctx.agentPresets.resolve('blueprint'), { id: 'blueprint' }, '声明中的普通 Include 实际激活')
    assert.ok((await readFile(join(home, 'settings.yaml.imported'), 'utf8')).includes('synthetic-media'))
    const defaults = descriptor('agent-default-model')
    await ctx.settings.mutate('agent-default-model', [{ op: 'set', path: ['model'], value: 'saved-model' }], defaults.revision)
    await assert.rejects(ctx.settings.mutate('agent-default-model', [{ op: 'set', path: ['model'], value: 'stale-model' }], defaults.revision), { code: 'SETTINGS_CONFLICT' })
    const currentMedia = descriptor('blueprint-media')
    await ctx.settings.mutate('blueprint-media', [{ op: 'set', path: ['connections', 'synthetic-media', 'name'], value: '保存后的媒体名称' }], currentMedia.revision)
    const savedMedia = descriptor('blueprint-media')
    await assert.rejects(ctx.settings.mutate('blueprint-media', [{ op: 'set', path: ['connections', 'synthetic-media', 'api'], value: 'unknown-protocol' }], savedMedia.revision), /媒体|Config|配置/)
    const patchBefore = await readFile(join(home, 'profiles/blueprint/cordis.patch.yml'), 'utf8')
    await ctx.fiber.dispose(); ctx = null
    ctx = await open()
    assert.equal(ctx.agentDefaultModel.currentSelection().model, 'saved-model')
    assert.equal(descriptor('blueprint-media').value.connections['synthetic-media'].name, '保存后的媒体名称')
    assert.equal(descriptor('blueprint-media').value.connections['synthetic-media'].apiKeyEnv, media.apiKeyEnv)
    assert.equal(descriptor('llm-pi-ai').value.providers['synthetic-route'].apiKeyEnv, provider.apiKeyEnv)
    assert.deepEqual(await ctx.agentPresets.resolve('blueprint'), { id: 'blueprint' })
    assert.equal(await readFile(join(home, 'profiles/blueprint/cordis.patch.yml'), 'utf8'), patchBefore)
  } finally { await ctx?.fiber.dispose(); await rm(home, { recursive: true, force: true }); if(previousHome===undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME=previousHome }
})
