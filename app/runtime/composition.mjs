// 桌面共用源码的三层 bundle；本地路径和宿主覆盖按 row id 转换。
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

const bundleName = '@blueprint/bundle'
export const desktopBundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', bundleName]
const yamlOptions = { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => ({ __jsExpr: value }) }] }
const json = value => JSON.stringify(value, null, 2) + '\n'

export async function readDesktopComposition({ resourceRoot, sourceRoot, promptDir, resolvePlugin, systemProviderRows = [] }) {
  const preset = parse(await readFile(join(sourceRoot, 'blueprint/preset.yml'), 'utf8'))
  const plugins = parse(await readFile(join(sourceRoot, 'blueprint/agent.cordis.yml'), 'utf8'), yamlOptions)
  const patches = parse(await readFile(join(sourceRoot, 'blueprint/cordis.patch.yml'), 'utf8'), yamlOptions)
  const clientPackages = ['layout', 'canvas', 'brand', 'files', 'feed', 'workspace', 'skill', 'media'].map(name => join(sourceRoot, 'blueprint/packages', name))
  function sourceEntry(name) {
    const [packageName, ...parts] = name.slice('@blueprint/'.length).split('/')
    return readFile(join(sourceRoot, 'blueprint/packages', packageName, 'package.json'), 'utf8').then(text => {
      const manifest = JSON.parse(text), key = parts.length ? `./${parts.join('/')}` : '.'
      const entry = manifest.exports?.[key] || (!parts.length && manifest.main)
      if (typeof entry !== 'string') throw new Error(`Blueprint 组装入口没有导出：${name}`)
      return pathToFileURL(join(sourceRoot, 'blueprint/packages', packageName, entry)).href
    })
  }
  async function resolveRows(rows) {
    for (const row of rows) {
      if (row.name?.startsWith('@blueprint/') && !['@blueprint/layout', '@blueprint/canvas', '@blueprint/brand', '@blueprint/files', '@blueprint/feed', '@blueprint/workspace', '@blueprint/skill', '@blueprint/media', '@blueprint/bundle/register-preset'].includes(row.name)) row.name = await sourceEntry(row.name)
      if (row.id === 'skill-filesystem') row.config = { ...row.config, customSkillDirs: [join(promptDir, 'skill')] }
      if (row.id === 'blueprint-node') row.config = { ...row.config, executionRuntimeEntries: [resolvePlugin('@deepseek-ai/dsh-ptc-runtime-node')],
        externalProviderEntries: ['@deepseek-ai/dsh-subagent-codex', '@deepseek-ai/dsh-subagent-claude-code'].map(resolvePlugin) }
      if (row.id === 'blueprint-execution-features') row.config = { resourceRoot: join(resourceRoot, 'native-resources'),
        entries: Object.fromEntries(Object.entries({ presentation: '@deepseek-ai/dsh-agent-tool-presentation', workflow: '@deepseek-ai/dsh-workflow-ptc',
          workflowTool: '@deepseek-ai/dsh-tool-workflow', browserRegistry: '@deepseek-ai/dsh-browser-use', browserProvider: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp',
          office: '@deepseek-ai/dsh-skill-office', dependencies: '@deepseek-ai/dsh-tool-workspace-dependencies' }).map(([key, name]) => [key, resolvePlugin(name)])) }
      if (row.group && Array.isArray(row.config)) await resolveRows(row.config)
      if (Array.isArray(row.insert)) await resolveRows(row.insert)
    }
  }
  await resolveRows(plugins)
  await resolveRows(patches)
  const overrides = JSON.parse(await readFile(join(resourceRoot, 'host.json'), 'utf8'))
  function resolveOverrides(rows) {
    for (const row of rows) {
      if (row.name?.startsWith('./')) row.name = pathToFileURL(join(resourceRoot, row.name)).href
      if (row.insert) resolveOverrides(row.insert)
    }
  }
  resolveOverrides(overrides)
  const port = Number(process.env.BLUEPRINT_PORT || 0)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('BLUEPRINT_PORT 须为 0–65535 的整数')
  const webserver = overrides.flatMap(row => row.insert || []).find(row => row.id === 'blueprint-webserver')
  if (!webserver) throw new Error('Blueprint webserver 覆盖形状不合')
  webserver.config.port = port
  return { patches: [...patches, ...systemProviderRows, ...overrides], plugins, preset, clientPackages }
}

export async function prepareDesktopProfile({ engineHome, installAnchor, cwd, patches = [], plugins, preset, clientPackages = [], mediaSettingsPath }) {
  const dir = join(engineHome, 'profiles/blueprint'), bundleDir = join(dir, 'node_modules', bundleName)
  await mkdir(bundleDir, { recursive: true })
  const agentPath = join(bundleDir, 'agent.cordis.yml')
  await writeFile(agentPath, json(plugins))
  // 浏览器包在 profile 中是普通 dsh.client 包；node 半仍只导出空 apply。
  for (const source of clientPackages) {
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    const target = join(dir, 'node_modules', manifest.name)
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'package.json'), json(manifest))
    await copyFile(join(source, 'index.js'), join(target, 'index.js'))
    await copyFile(join(source, 'client.js'), join(target, 'client.js'))
  }
  if (mediaSettingsPath) await writeFile(join(bundleDir, 'media-settings.mjs'), `export * from ${JSON.stringify(mediaSettingsPath)}\n`)
  await writeFile(join(bundleDir, 'package.json'), json({ name: bundleName, private: true, type: 'module',
    exports: { './agent.cordis.yml': './agent.cordis.yml', ...(mediaSettingsPath ? { './media-settings': './media-settings.mjs' } : {}) },
    dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  const presetRow = { id: 'preset-blueprint', name: '@deepseek-ai/dsh-agent-preset', config: { ...preset,
    plugins: [{ id: 'blueprint-agent', name: 'cordis:include', config: { path: pathToFileURL(agentPath).href } }] } }
  const defaults = structuredClone(patches)
  function replacePreset(entries) {
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].id === 'preset-blueprint') entries[i] = presetRow
      if (Array.isArray(entries[i].insert)) replacePreset(entries[i].insert)
    }
  }
  replacePreset(defaults)
  await writeFile(join(bundleDir, 'cordis.patch.yml'), json(defaults))
  const manifestPath = join(dir, 'package.json')
  let manifest
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error; manifest = { name: 'dsh-profile-blueprint', private: true, dependencies: {} } }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error(`Blueprint profile manifest 须为 JSON 对象：${manifestPath}`)
  const selected = manifest.dsh?.profile?.bundles || []
  if (!Array.isArray(selected) || selected.some(name => typeof name !== 'string')) throw new Error('Blueprint profile 的 bundles 须为名称列表')
  const bundles = [...desktopBundles, ...selected.filter(name => !desktopBundles.includes(name))]
  await writeFile(manifestPath, json({ ...manifest, dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } } }))
  const patchPath = join(dir, 'cordis.patch.yml')
  try { await writeFile(patchPath, '[]\n', { flag: 'wx', mode: 0o600 }) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
  const configPath = join(dir, 'root.cordis.json')
  await writeFile(configPath, '[]\n')
  return { configPath, bundleDir, profileContext: { name: 'blueprint', dir, patchPath, installAnchor,
    cwd, home: engineHome, startedBundles: bundles, overlays: [], telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED } }
}
