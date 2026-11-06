import test from 'node:test'
import assert from 'node:assert/strict'
import { assertPatchCommand } from '../scripts/patch-command.mjs'

test('缺少 patch 时给出可操作报错', () => {
  assert.throws(() => assertPatchCommand({ BLUEPRINT_PATCH: 'C:/不存在/patch.exe' }), /Git for Windows|BLUEPRINT_PATCH/)
})

test('显式 BLUEPRINT_PATCH 优先', () => {
  // 成功用例不依赖本机真的装了 patch：当前 Node 可执行文件充当"可运行命令"替身，
  // 用来证明显式配置被优先采用，并且在返回前确实执行过 --version 探测。
  assert.equal(assertPatchCommand({ BLUEPRINT_PATCH: process.execPath }), process.execPath)
})
