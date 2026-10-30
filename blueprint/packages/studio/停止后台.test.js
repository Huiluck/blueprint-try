import test from 'node:test'
import assert from 'node:assert/strict'
import { 停止会话后台 } from './src/停止后台.js'

test('停止仅取消本会话的后台执行，并交给原生 kill 抑制完成通知', () => {
  const killed = []
  const jobs = [
    { id: 'own-bash', owner: 'a', kind: 'bash', status: 'running' },
    { id: 'own-stopping', owner: 'a', kind: 'bash', status: 'stopping' },
    { id: 'own-sub', owner: 'a', kind: 'subagent', status: 'running' },
    { id: 'foreign', owner: 'b', kind: 'bash', status: 'running' },
    { id: 'unowned', kind: 'bash', status: 'running' },
    { id: 'done', owner: 'a', kind: 'bash', status: 'completed' },
  ]
  // 原生登记册拿会话号认主人，不认 agent 本身。
  const ctx = { agents: { get: id => { assert.equal(id, 'a'); return { id: 'a' } } }, get: () => ({
    list: caller => { assert.equal(caller, 'a'); return jobs },
    kill: (id, caller) => { assert.equal(caller, 'a'); killed.push(id) },
  }) }
  停止会话后台(ctx, 'a')
  assert.deepEqual(killed, ['own-bash', 'own-stopping'])
})

test('原生后台停止失败不会被吞掉；没有登记册时保持会话取消可用', () => {
  assert.doesNotThrow(() => 停止会话后台({ get: () => undefined }, 'a'))
  const ctx = { agents: { get: () => ({ id: 'a' }) }, get: () => ({
    list: () => [{ id: 'own', owner: 'a', kind: 'bash', status: 'running' }],
    kill: () => { throw new Error('process termination failed') },
  }) }
  assert.throws(() => 停止会话后台(ctx, 'a'), /process termination failed/)
})
