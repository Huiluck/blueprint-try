import test from 'node:test'
import assert from 'node:assert/strict'
import { 解析进程表, 认残留进程, 停残留进程 } from './src/残留进程.js'

const 根 = '/P/项目'
const 现在 = 10_000_000
// pid ppid pgid etime tty args —— 跟 `ps -axww -o pid=,ppid=,pgid=,etime=,tty=,args=` 一样
const 表 = lines => 解析进程表(lines.join('\n'), 现在)
const 服务 = '  100     1   100    02:00:00 ??       node dsh/lib/bin.js web --port 3090'
const 认 = (rows, extra = {}) => 认残留进程(rows, { 服务pid: 100, 项目根们: [根], ...extra })

test('本服务开的命令组整组算一件；已算作后台任务、外部 run 的不重复列', () => {
  const rows = 表([
    服务,
    '  200   100   200    01:57:00 ??       bash -c cd "/P/项目/幸存者/作品空间/3" &&\\012godot --shot x | head -5',
    '  201   200   200    01:56:50 ??       /Applications/Godot.app/Contents/MacOS/Godot --path 作品空间/3/art-pilot',
    '  300   100   300       05:00 ??       codex exec --json',
    '  310   300   310       04:00 ??       node docs/r2-run-integration-qa.mjs',
    '  400   100   100       00:03 ??       /usr/bin/magick a.png b.png',
    '  700   100   700       10:00 ttys003  -zsh',
    '  800   100   100       00:00 ??       /bin/ps -axww -o pid=,ppid=,pgid=,etime=,tty=,args=',
  ])
  const 件们 = 认(rows, { 认领pid们: new Set([300]) })
  assert.deepEqual(件们.map(x => x.id), ['pid:400', 'pgid:200'], '外部 run 和它开的命令、有终端的、ps 自己都不列；和服务同组的只按单个进程算')
  const godot = 件们.find(x => x.id === 'pgid:200')
  assert.equal(godot.进程数, 2)
  assert.equal(godot.项目, '幸存者')
  assert.equal(godot.pid, 200, '组长是那条命令')
  assert.equal(godot.起于, 现在 - (60 + 57) * 60_000)
  assert.ok(!godot.命令.includes('\\012'), '显示用的命令是一行')
  assert.deepEqual(认(rows, { 认领pid们: new Set([300]), 工作命令们: ['cd "/P/项目/幸存者/作品空间/3" &&\ngodot --shot x | head -5'] }).map(x => x.id),
    ['pid:400'], '正在跑的后台任务那条命令不重复列')
})

test('被系统收养的：命令里写着项目目录的才算；本服务开过的组，主命令退了留下的也认得', () => {
  const 记得的组 = new Map()
  const 先 = 表([服务,
    '  900   100   900       00:10 ??       bash -c python3 -m http.server 8000 &',
    '  901   900   900       00:09 ??       python3 -m http.server 8000'])
  assert.deepEqual(认(先, { 记得的组 }).map(x => x.id), ['pgid:900'])
  assert.ok(记得的组.has(900))
  const 后 = 表([服务,
    '  901     1   900       00:39 ??       python3 -m http.server 8000',
    '  500     1   500       40:00 ??       /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless --user-data-dir=/P/项目/猫/.blueprint-tmp/c',
    '  600     1   600       40:00 ??       /Applications/Notes.app/Contents/MacOS/Notes'])
  const 件们 = 认(后, { 记得的组 })
  assert.deepEqual(件们.map(x => x.id).sort(), ['pgid:500', 'pgid:900'], '用户自己的程序不碰')
  assert.equal(件们.find(x => x.id === 'pgid:500').项目, '猫')
  assert.ok(件们.every(x => x.被收养))
  // 那一组全退了，号码又给了别的程序：不认，也忘掉。
  const 再后 = 表([服务, '  900     1   900       00:05 ??       /usr/sbin/somebody-else'])
  assert.deepEqual(认(再后, { 记得的组 }).map(x => x.id), [])
  assert.equal(记得的组.has(900), false)
})

test('服务自己和它的祖先、它们所在的组都不能停', () => {
  const rows = 表([
    '   50     1    50    03:00:00 ??       /bin/zsh 重起Blueprint.command',
    '  100    50    50    02:00:00 ??       node dsh/lib/bin.js web --port 3090',
    '  410   100    50       00:30 ??       /usr/bin/ffmpeg -i /P/项目/猫/a.mp4'])
  assert.deepEqual(认(rows).map(x => [x.id, x.整组]), [['pid:410', false]])
})

test('停之前重新对一遍号码和起点；对上了整组先 SIGTERM，过一会儿还在才强关', async () => {
  const sent = []
  let 现 = [{ id: 'pgid:200', 号: 200, 整组: true, 起于: 5_000 }]
  const kill = (pid, signal) => sent.push([pid, signal])
  assert.deepEqual(await 停残留进程('pgid:200', 9_000, async () => 现, { kill, 等: 5 }), { 停了: false, 原因: '这个进程已经不在了，或者已经换成了别的程序' })
  assert.deepEqual(sent, [])
  assert.deepEqual(await 停残留进程('pgid:200', 5_500, async () => 现, { kill, 等: 5 }), { 停了: true })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(sent, [[-200, 'SIGTERM'], [-200, 'SIGKILL']])
  sent.length = 0
  现 = [{ id: 'pid:410', 号: 410, 整组: false, 起于: 5_000 }]
  const 后来 = [[]]
  await 停残留进程('pid:410', 5_000, async () => 后来.length ? (后来.pop(), 现) : [], { kill, 等: 5 })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(sent, [[410, 'SIGTERM']], '单个进程只停它自己；已经退了就不强关')
})
