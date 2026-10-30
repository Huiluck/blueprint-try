// 实际 alpha controller 与合成 subprocess；不调用 shell 或模型。
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PassThrough } from 'node:stream'
import { 终端操作, 终端流 } from '../../../blueprint/packages/studio/src/终端.js'
const require = createRequire(new URL('../../package.json', import.meta.url))
const native = async name => import(pathToFileURL(require.resolve('@deepseek-ai/' + name)).href)
const { Context } = await native('cordis')
const { TerminalController } = await native('dsh-api-terminal-controller')
const signal = () => new AbortController().signal

export async function fixture(t) {
  const ctx = new Context(), lookups = [], spawns = [], scopes = []
  const agents = new Map(['project-a', 'node-a', 'project-b'].map(id => [id,
    { id, ctx, session: { id, header: { cwd: id === 'project-b' ? '/projects/b' : '/projects/a' } } }]))
  let cwd = '/projects/a/.agents/worktrees/draft'
  ctx.provide('workingDirectory', { get: () => cwd, ensure: async () => cwd })
  ctx.provide('sandboxPolicy', {})
  ctx.provide('subprocess', {
    terminalEnvironment: async () => ({ platform: 'posix', defaultShell: '/bin/sh' }),
    resolveExecutable: async path => path,
    async spawnTerminal(spec) {
      const output = new PassThrough(), outcome = Promise.withResolvers(), release = Promise.withResolvers()
      release.resolve()
      const row = { spec, output, release, written: [], resized: [], terminateCount: 0, failClose: false,
        handle: { output, done: outcome.promise, inspectActivity: async () => ({ state: 'unknown', revision: 0 }),
          write: async data => { row.written.push(data) }, resize: async (...dimensions) => { row.resized.push(dimensions) },
          async terminate() { row.terminateCount++; await row.release.promise
            if (row.failClose) { row.failClose = false; throw new Error('进程范围仍待释放') }
            output.end('LAST OUTPUT\r\n'); outcome.resolve({ exitCode: 0, signal: null }) } } }
      spawns.push(row); return row.handle
    },
  })
  const controller = new TerminalController(ctx, { shellCandidates: [], shell: undefined, maxTerminals: 4,
    maxCols: 200, maxRows: 100, scrollback: 100, maxBufferedBytes: 100000, maxInputBytes: 1000, disposeGraceMs: 100,
    unattendedTimeoutMs: 0, activityPollIntervalMs: 1000, cleanupRetryMs: 1000 })
  const items = [...agents.values()].map(agent => ({ sessionId: agent.id, cwd: agent.session.header.cwd }))
  const api = { effect: ctx.effect.bind(ctx), get: key => ({ terminalController: controller,
    sessionController: { list: async () => ({ items }) },
    typert: { lookups: { get: () => ({ resolve: async id => { lookups.push(id); return agents.get(id) } }) } },
  })[key] ?? ctx.get(key) }
  const scope = async (_ctx, agent, run, abort) => { abort.throwIfAborted(); scopes.push(agent.id); return run() }
  const invoke = (method, args = {}, sessionId = 'node-a', projectSessionId = 'project-a') =>
    终端操作(api, { method, args, sessionId, projectSessionId }, signal(), scope)
  const attach = async (id, attachmentId = 'main-view', sessionId = 'node-a') => {
    const abort = new AbortController()
    const iterator = 终端流(api, { mode: 'follow', id, attachmentId, sessionId, projectSessionId: sessionId }, abort.signal)[Symbol.asyncIterator]()
    const first = await iterator.next()
    t.after(async () => { abort.abort(); await iterator.return?.() })
    return { abort, iterator, first: first.value }
  }
  t.after(async () => { spawns.forEach(row => row.release.resolve()); await ctx.fiber.dispose() })
  return { ctx, api, controller, agents, items, spawns, scopes, lookups, invoke, attach, scope, setCwd: value => { cwd = value } }
}
