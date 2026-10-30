export const world = Object.freeze({ width: 960, height: 600, radius: 22, speed: 270, duration: 35 })
const locations = [[215, 180], [370, 420], [520, 260], [720, 160], [835, 445]]

export function createState() {
  return { phase: 'playing', x: 80, y: 300, score: 0, remaining: world.duration,
    stars: locations.map(([x, y], id) => ({ id, x, y, collected: false })) }
}

export function advance(state, input, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('时间应为非负有限数')
  if (state.phase !== 'playing') return state
  let x = Number(input.x || 0), y = Number(input.y || 0)
  if (![x, y].every(Number.isFinite)) throw new Error('移动输入应为有限数')
  const magnitude = Math.hypot(x, y)
  if (magnitude > 1) { x /= magnitude; y /= magnitude }
  state.x = Math.max(world.radius, Math.min(world.width - world.radius, state.x + x * world.speed * seconds))
  state.y = Math.max(90 + world.radius, Math.min(world.height - world.radius, state.y + y * world.speed * seconds))
  state.remaining = Math.max(0, state.remaining - seconds)
  for (const star of state.stars) if (!star.collected && Math.hypot(star.x - state.x, star.y - state.y) <= world.radius + 18) {
    star.collected = true; state.score++
  }
  if (state.score === state.stars.length) state.phase = 'won'
  else if (state.remaining === 0) state.phase = 'lost'
  return state
}
