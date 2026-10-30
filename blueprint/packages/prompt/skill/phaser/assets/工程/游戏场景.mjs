import { createState, advance, world } from './玩法状态.mjs'

const held = new Set(), status = document.querySelector('#游戏状态')
let current, destination = null, frames = 0, scene
const start = () => { current = createState(); destination = null; held.clear() }
start()
document.querySelector('#重新开始').addEventListener('click', start)
for (const button of document.querySelectorAll('[data-direction]')) {
  const direction = button.dataset.direction
  button.addEventListener('pointerdown', event => { button.setPointerCapture(event.pointerId); held.add(direction); destination = null; event.preventDefault() })
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => held.delete(direction))
}
window.addEventListener('blur', () => { held.clear(); destination = null })

class StarRoute extends Phaser.Scene {
  create() {
    scene = this
    this.cursors = this.input.keyboard.createCursorKeys()
    this.letters = this.input.keyboard.addKeys('W,A,S,D')
    const background = this.add.graphics()
    background.fillStyle(0x102035).fillRect(0, 0, world.width, world.height)
    background.lineStyle(1, 0x263c50, .55)
    for (let x = 0; x <= world.width; x += 60) background.lineBetween(x, 90, x, world.height)
    for (let y = 90; y <= world.height; y += 60) background.lineBetween(0, y, world.width, y)
    this.add.text(28, 22, 'FOLLOW THE LIGHT', { fontFamily: 'sans-serif', fontSize: '18px', color: '#a0c9dc' })
    this.meter = this.add.text(660, 23, '', { fontFamily: 'sans-serif', fontSize: '20px', color: '#70ecc9' })
    this.player = this.add.circle(current.x, current.y, world.radius, 0x69e5c4)
    this.player.setStrokeStyle(4, 0xbafce8)
    this.stars = current.stars.map(star => this.add.star(star.x, star.y, 5, 9, 20, 0xffd377).setStrokeStyle(2, 0xfff4cd))
    this.message = this.add.text(world.width / 2, world.height / 2, '', { fontFamily: 'sans-serif', fontSize: '38px', color: '#eef8ff', backgroundColor: '#08111fcc', padding: { x: 24, y: 18 }, align: 'center' }).setOrigin(.5)
    this.message.setVisible(false)
    this.input.on('pointerdown', pointer => { destination = { x: pointer.worldX, y: pointer.worldY } })
  }
  update(_time, delta) {
    frames++
    let x = Number(this.cursors.right.isDown || this.letters.D.isDown || held.has('right')) - Number(this.cursors.left.isDown || this.letters.A.isDown || held.has('left'))
    let y = Number(this.cursors.down.isDown || this.letters.S.isDown || held.has('down')) - Number(this.cursors.up.isDown || this.letters.W.isDown || held.has('up'))
    if (x || y) destination = null
    else if (destination) {
      const dx = destination.x - current.x, dy = destination.y - current.y, length = Math.hypot(dx, dy)
      if (length < 6) destination = null
      else { x = dx / length; y = dy / length }
    }
    advance(current, { x, y }, Math.min(delta / 1000, .05))
    this.player.setPosition(current.x, current.y)
    this.stars.forEach((star, index) => { star.setVisible(!current.stars[index].collected); star.rotation += delta / 1500 })
    this.meter.setText(`${current.score} / ${current.stars.length}   ·   ${Math.ceil(current.remaining)}s`)
    this.message.setVisible(current.phase !== 'playing')
    if (current.phase !== 'playing') this.message.setText(current.phase === 'won' ? '全部星光已收集\n再来一局？' : '时间到了\n重新出发吧')
    const text = current.phase === 'playing' ? `已收集 ${current.score} / ${current.stars.length} · 剩余 ${Math.ceil(current.remaining)} 秒`
      : current.phase === 'won' ? '胜利：全部星光已收集。点击重新开始再玩。' : '时间耗尽。点击重新开始再玩。'
    if (status.textContent !== text) status.textContent = text
  }
}
try {
  new Phaser.Game({ type: Phaser.AUTO, parent: '游戏画布', width: world.width, height: world.height,
    backgroundColor: '#102035', scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: StarRoute,
    input: { keyboard: true }, audio: { noAudio: true }, render: { antialias: true } })
  window.blueprintGame = Object.freeze({ getState: () => ({ ...structuredClone(current), frames, started: !!scene, engine: Phaser.VERSION,
    view: scene ? { playerX: scene.player.x, playerY: scene.player.y, visibleStars: scene.stars.filter(star => star.visible).length, resultText: scene.message.visible ? scene.message.text : null } : null }) })
} catch (error) { status.textContent = '游戏启动失败：' + error.message; console.error(error) }
