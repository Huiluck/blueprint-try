import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODES = new Set(['workspace-write', 'read-only'])
const STDERR_LIMIT = 4096
const RUNNER_PACKAGE = '@deepseek-ai/dsh-sandbox-windows-acl/runner'

/**
 * 用 windows-acl runner 的 argv 契约起一个受限子进程，验证写边界。
 *
 * 子进程尝试写工作区内的 `probe-inside.txt` 与工作区父目录的
 * `probe-outside.txt`，各自记录 `'written'` 或 Win32 错误码。runner 自身
 * 供给失败时不会打印子进程 JSON（退出码 127、stderr 带 `windows-acl-run:`），
 * 这里直接抛错并附上前 4KB stderr，避免断言失败掩盖供给失败。
 */
export async function runWindowsSandboxProbe(options = {}) {
  const { workspace, temp, mode = 'workspace-write', childTimeoutMs = 15000 } = options
  if (typeof workspace !== 'string' || workspace === '') throw new Error('windows-sandbox-probe: workspace is required')
  if (typeof temp !== 'string' || temp === '') throw new Error('windows-sandbox-probe: temp is required')
  if (!MODES.has(mode)) throw new Error(`windows-sandbox-probe: unsupported mode: ${String(mode)}`)

  const workspacePath = resolve(workspace)
  const tempPath = resolve(temp)
  await mkdir(workspacePath, { recursive: true })
  await mkdir(tempPath, { recursive: true })

  const inside = join(workspacePath, 'probe-inside.txt')
  const outside = join(dirname(workspacePath), 'probe-outside.txt')
  const childPath = join(tempPath, 'probe-child.cjs')
  await writeFile(childPath, childSource({ inside, outside }), 'utf8')

  const runnerPath = createRequire(import.meta.url).resolve(RUNNER_PACKAGE)
  const spawned = spawnSync(process.execPath, [
    runnerPath,
    '--workspace', workspacePath,
    '--temp', tempPath,
    '--mode', mode,
    '--',
    process.execPath, childPath,
  ], { encoding: 'utf8', timeout: childTimeoutMs, windowsHide: true })

  const runnerStderr = String(spawned.stderr ?? '').slice(0, STDERR_LIMIT)
  if (spawned.error) {
    throw new Error(`windows-sandbox-probe: runner spawn failed: ${spawned.error.message}${runnerStderr === '' ? '' : `\n${runnerStderr}`}`)
  }

  return {
    platform: process.platform,
    mode,
    workspace: workspacePath,
    temp: tempPath,
    child: parseChildResult(spawned.stdout, spawned.status, runnerStderr),
    runnerExit: spawned.status,
    runnerStderr,
  }
}

function childSource({ inside, outside }) {
  return `'use strict'
const { writeFileSync } = require('node:fs')
const targets = ${JSON.stringify({ inside, outside })}
const results = {}
for (const [key, target] of Object.entries(targets)) {
  try {
    writeFileSync(target, 'windows-sandbox-probe\\n')
    results[key] = 'written'
  } catch (error) {
    results[key] = error && error.code ? error.code : String(error)
  }
}
process.stdout.write(JSON.stringify(results))
`
}

function parseChildResult(stdout, exitCode, runnerStderr) {
  const text = String(stdout ?? '')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`windows-sandbox-probe: runner did not produce child JSON (exit ${String(exitCode)}); stderr: ${runnerStderr === '' ? '<empty>' : runnerStderr}`)
  }
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.inside !== 'string' || typeof parsed.outside !== 'string') {
    throw new Error(`windows-sandbox-probe: malformed child result: ${text.slice(0, STDERR_LIMIT)}; stderr: ${runnerStderr === '' ? '<empty>' : runnerStderr}`)
  }
  return parsed
}

function parseCliArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token !== '--workspace' && token !== '--temp' && token !== '--mode') throw new Error(`windows-sandbox-probe: unknown argument: ${token}`)
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`windows-sandbox-probe: missing value after ${token}`)
    options[token.slice(2)] = value
    index += 1
  }
  return options
}

async function main() {
  const result = await runWindowsSandboxProbe(parseCliArgs(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
