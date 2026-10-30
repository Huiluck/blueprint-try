// 品质档（档 1–档 7，10-25）：high／max／ultra 不再只是一句形容词，各有一段话写分多大、什么时候算完、能推翻到哪一层、试几种。
import test from 'node:test'
import assert from 'node:assert/strict'
import { 品质档Of, 一段 } from './src/index.js'

test('只认最后一条 Quality 行里的 high／max／ultra；认不出的不猜默认', () => {
  assert.deepEqual(品质档Of('做游戏\n\nQuality: max（以顶级品质为标准，优先投入关键环节，追求最高性价比）\nMode: solo'), { id: 'max', 段们: ['档位/总述', '档位/max'] })
  assert.equal(品质档Of('Quality: ultra；Mode: solo（不问我）').id, 'ultra', '用户选择文拼成一行时也认得')
  assert.equal(品质档Of('Quality: High｜Mode: build').id, 'high')
  assert.equal(品质档Of('Quality: high\nQuality: ultra').id, 'ultra', '后出现的优先')
  for (const 原话 of ['', 'Mode: solo', 'Quality: low', 'Quality: ', '做一个 Quality: max 的游戏']) assert.equal(品质档Of(原话), null, 原话)
})

test('三档各有一段话，开头说是哪一档，四件事都在；high 让 helm 把阶段切小（档 7），ultra 要拿真的顶级作品当尺子', () => {
  for (const id of ['high', 'max', 'ultra']) {
    const 文 = 一段(品质档Of(`Quality: ${id}`).段们[1])
    assert.ok(文.startsWith(`当前品质档：${id}。`), id)
    for (const 件 of ['分多大', '什么时候算完', '对不上现实', '试几种']) assert.ok(文.includes(件), `${id} 缺 ${件}`)
  }
  assert.match(一段('档位/high'), /只派 run，不派 dock，最多 4 个/)
  assert.match(一段('档位/high'), /多分几个阶段/)
  assert.match(一段('档位/max'), /被派出的 dock 只派 run；每个 dock 名下最多 6 个/)
  assert.match(一段('档位/ultra'), /顶级的作品/)
  assert.match(一段('档位/ultra'), /helm 可以回头改问题和标准/)
})

test('三档共用的总述排在前面：三档各用界面上那句原话，说明品质档只管 helm 和 dock、改五件事（多一件给下级定工作等级，派 6、派 9）、哪一档都不浪费（档 8）', () => {
  const 文 = 一段('档位/总述')
  for (const 句 of ['high：消耗中等、以行业一般水平为标准', 'max：以顶级品质为标准，优先投入关键环节，追求最高性价比',
    'ultra：在宽松但有限的预算下，以人类世界顶级品质为标准']) assert.ok(文.includes(句), 句)
  assert.match(文, /品质档只管 helm 和 dock，改五件事：.*给下级定什么工作等级/)
  for (const id of ['high', 'max', 'ultra']) assert.match(一段(`档位/${id}`), /^- 给下级的工作等级：/m, id)
  assert.match(文, /高档多花的，应该全花在换来新信息上/)
  for (const id of ['high', 'max', 'ultra']) assert.equal(品质档Of(`Quality: ${id}`).段们[0], '档位/总述')
})
