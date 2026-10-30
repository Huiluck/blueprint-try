import assert from 'node:assert/strict'
import { createState, advance, world } from './玩法状态.mjs'

const initial = createState()
const moving = createState()
advance(moving, { x: 1, y: 0 }, 0.1)
assert.equal(moving.x, initial.x + world.speed * 0.1)
const diagonal = createState()
advance(diagonal, { x: 1, y: 1 }, 0.1)
assert.ok(Math.abs(Math.hypot(diagonal.x - initial.x, diagonal.y - initial.y) - world.speed * 0.1) < 1e-8)
const winning = createState()
for (const star of winning.stars) {
  for (let frame = 0; frame < 300 && !star.collected; frame++) {
    const dx = star.x - winning.x, dy = star.y - winning.y, length = Math.hypot(dx, dy)
    advance(winning, { x: dx / length, y: dy / length }, 1 / 60)
  }
  assert.equal(star.collected, true, '移动到目标应取得星光')
}
assert.equal(winning.phase, 'won')
assert.equal(winning.score, winning.stars.length)
const finished = structuredClone(winning)
advance(winning, { x: 1 }, 1)
assert.deepEqual(winning, finished, '结束后状态应保持')
const losing = createState()
advance(losing, {}, world.duration)
assert.equal(losing.phase, 'lost')
assert.equal(losing.remaining, 0)
assert.deepEqual(createState(), initial, '重开应恢复初始状态')
assert.throws(() => advance(createState(), {}, NaN))
console.log('玩法状态通过：移动、对角速度、收集、胜利、超时、结束保持与重开。实际输入和画面另验。')
