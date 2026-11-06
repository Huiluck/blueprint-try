// 启动级核对：真实启动 app/runtime/backend.mjs，验证系统 DSH provider 行从启动到 /studio/api/connections 的整条链路。
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(appRoot, '..')
const appModules = join(appRoot, 'node_modules')
const bootTimeout = 90_000
const requestTimeout = 20_000
const providerId = 'opencode-go'
const defaultModel = 'deepseek-v4.1-flash'
const apiKeyEnv = 'OPENCODE_GO_API_KEY'
const readyPattern = /Blueprint 已启动：(http:\/\/\S+)/
const profilePatch = `- id: desktop-shell
  config:
    theme: dark
- id: agent-default-model
  config:
    provider: ${providerId}
    model: ${defaultModel}
- id: llm-pi-ai
  config:
    providers:
      ${providerId}:
        api: openai-completions
        apiKeyEnv: ${apiKeyEnv}
- id: llm-deepseek-account
  config: {}
- id: blueprint-webserver
  config:
    port: 4321
`

// 源码态 backend 用 file URL 直接加载 blueprint/packages；这些包里的 dsh 依赖要能从
// blueprint/node_modules 解析。本机 app/node_modules 是共享的 rc.5 依赖（junction），
// 这里在缺失时补一个同样的临时 junction（gitignored），结束再拆掉，不动任何源码。
let createdModulesLink = ''
before(async () => {
  const link = join(repositoryRoot, 'blueprint', 'node_modules')
  const existing = await lstat(link).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
  if (existing) return
  assert.ok(existsSync(appModules), `缺少共享依赖目录：${appModules}`)
  try {
    await symlink(appModules, link, process.platform === 'win32' ? 'junction' : 'dir')
    createdModulesLink = link
  } catch (error) { if (error.code !== 'EEXIST') throw error }
})
after(async () => {
  if (createdModulesLink) await rm(createdModulesLink, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const makeTemp = prefix => mkdtemp(join(tmpdir(), `blueprint-${prefix}-`))

async function createSystemHome(patch) {
  const home = await makeTemp('system-provider-home')
  if (patch === undefined) return home
  await mkdir(join(home, 'profiles', 'desktop'), { recursive: true })
  await writeFile(join(home, 'profiles', 'desktop', 'cordis.patch.yml'), patch)
  return home
}

// 和桌面入口一样先清掉继承来的凭据与 DSH 环境，避免本机配置混进这次启动。
function backendEnvironment({ dataHome, systemHome }) {
  const environment = { ...process.env }
  for (const name of Object.keys(environment)) {
    if (name.endsWith('_API_KEY') || /^(DSH_|BLUEPRINT_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(name)) delete environment[name]
  }
  environment.BLUEPRINT_DATA_HOME = dataHome
  environment.BLUEPRINT_SYSTEM_DSH_HOME = systemHome
  environment.DSH_TELEMETRY_DISABLED = '1'
  environment[apiKeyEnv] = 'fixture-key'
  return environment
}

function logTail(logs) {
  return `stdout:\n${logs.stdout.slice(-4000)}\nstderr:\n${logs.stderr.slice(-4000)}`
}

// 不带 IPC：backend 在无 process.send 时把带 token 的地址打到 stdout，正是这里的启动契约。
async function startBackend({ dataHome, systemHome, timeout = bootTimeout }) {
  const child = spawn(process.execPath, [join(appRoot, 'runtime', 'backend.mjs')], {
    cwd: appRoot, env: backendEnvironment({ dataHome, systemHome }), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  const logs = { stdout: '', stderr: '' }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { logs.stdout += chunk })
  child.stderr.on('data', chunk => { logs.stderr += chunk })
  try {
    const url = await new Promise((resolveReady, rejectReady) => {
      let settled = false
      let timer
      const settle = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) rejectReady(error)
        else resolveReady(value)
      }
      timer = setTimeout(() => settle(new Error(`backend 在 ${timeout}ms 内没有打印启动地址\n${logTail(logs)}`)), timeout)
      child.on('error', error => settle(new Error(`backend 启动失败：${error.message}\n${logTail(logs)}`)))
      child.on('exit', (code, signal) => settle(new Error(`backend 在启动完成前退出（code=${code}, signal=${signal}）\n${logTail(logs)}`)))
      child.stdout.on('data', () => {
        const match = readyPattern.exec(logs.stdout)
        if (match) settle(undefined, match[1])
      })
    })
    return { child, logs, url }
  } catch (error) {
    await stopChild(child)
    throw error
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolveExit => child.once('exit', resolveExit))
  try { child.kill() } catch { /* 已经退出 */ }
  const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* 已经退出 */ } }, 10_000)
  await exited
  clearTimeout(timer)
}

// 用启动地址里的 token 换浏览器会话 cookie；后续请求带 cookie 和同源 Origin。
async function openWebSession(authenticatedUrl) {
  const url = new URL(authenticatedUrl)
  const exchange = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(requestTimeout) })
  assert.equal(exchange.status, 303, `token 换会话 cookie 应返回 303，实际 ${exchange.status}`)
  await exchange.body?.cancel()
  const cookies = exchange.headers.getSetCookie().map(value => value.split(';', 1)[0])
  assert.ok(cookies.length > 0, 'token 换会话 cookie 应返回 set-cookie')
  const session = {
    origin: url.origin,
    token: url.searchParams.get('token'),
    cookie: cookies.join('; '),
    get(path) {
      return fetch(new URL(path, url.origin), {
        redirect: 'manual', headers: { cookie: session.cookie, origin: url.origin }, signal: AbortSignal.timeout(requestTimeout),
      })
    },
  }
  assert.ok(session.token, '启动地址应带 token')
  return session
}

async function readJSON(response, path) {
  const text = await response.text()
  assert.equal(response.status, 200, `${path} 应返回 200，实际 ${response.status}：${text.slice(0, 500)}`)
  try { return JSON.parse(text) }
  catch { assert.fail(`${path} 应返回 JSON：${text.slice(0, 500)}`) }
}

function scheduleCleanup(t, state) {
  t.after(async () => {
    await stopChild(state.backend?.child)
    for (const directory of [state.dataHome, state.systemHome]) {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  })
}

test('系统 DSH profile 的 provider 在真实 backend 启动后出现在连接清单并可路由', { timeout: 120_000 }, async t => {
  const dataHome = await makeTemp('backend-data')
  const systemHome = await createSystemHome(profilePatch)
  const state = { dataHome, systemHome }
  scheduleCleanup(t, state)
  const started = Date.now()
  state.backend = await startBackend({ dataHome, systemHome })
  t.diagnostic(`backend 启动耗时 ${Date.now() - started}ms`)
  const session = await openWebSession(state.backend.url)

  const root = await session.get('/')
  assert.equal(root.status, 200, '登录后的网页根应返回 200')
  assert.match(root.headers.get('content-type') || '', /text\/html/)
  await root.body?.cancel().catch(() => {})

  const body = await readJSON(await session.get('/studio/api/connections'), '/studio/api/connections')
  assert.equal(body.ok, true)
  assert.ok(Array.isArray(body.value?.providers), '连接清单应带 providers 数组')
  const provider = body.value.providers.find(row => row.id === providerId)
  assert.ok(provider, `连接清单应包含 ${providerId}：${JSON.stringify(body.value.providers.map(row => row.id))}`)
  assert.equal(provider.namespace, 'llm-pi-ai')
  assert.equal(provider.active, true, `${providerId} 应可路由；fixture 已通过 ${apiKeyEnv} 注入环境变量`)
  assert.ok(Array.isArray(provider.models) && provider.models.length > 0, `${providerId} 的模型目录不应为空`)
  assert.ok(provider.models.some(model => model.id === defaultModel), `模型目录应包含 ${defaultModel}`)
  assert.equal(provider.error, '')
  assert.equal(body.value.default?.provider, providerId, '默认 provider 应与 fixture 的 agent-default-model 一致')
  assert.equal(body.value.default?.model, defaultModel, '默认模型应与 fixture 的 agent-default-model 一致')
})

test('没有系统 DSH 配置时 backend 仍能启动，连接清单只剩原生 inactive provider', { timeout: 120_000 }, async t => {
  const dataHome = await makeTemp('backend-data')
  const systemHome = await createSystemHome()
  const state = { dataHome, systemHome }
  scheduleCleanup(t, state)
  const started = Date.now()
  state.backend = await startBackend({ dataHome, systemHome })
  t.diagnostic(`空配置 backend 启动耗时 ${Date.now() - started}ms`)
  const session = await openWebSession(state.backend.url)

  const root = await session.get('/')
  assert.equal(root.status, 200, '没有系统 DSH 配置时网页根仍应返回 200')
  await root.body?.cancel().catch(() => {})

  const body = await readJSON(await session.get('/studio/api/connections'), '/studio/api/connections')
  assert.equal(body.ok, true)
  assert.ok(Array.isArray(body.value?.providers), '连接清单应带 providers 数组')
  assert.equal(body.value.providers.some(row => row.id === providerId), false, '空 home 不应导入 fixture 的 provider')
  for (const provider of body.value.providers) {
    assert.equal(provider.native, true, '空 home 时只应剩原生 provider')
    assert.equal(provider.active, false, '没有 Key 的原生 provider 应保持 inactive')
  }
})
