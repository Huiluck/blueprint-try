import assert from 'node:assert/strict'
import { createState, selectObject, colorSelected, objects, palette } from './空间状态.mjs'

const state = createState(), original = structuredClone(state)
selectObject(state, objects[1].id)
assert.equal(state.selected, objects[1].id)
colorSelected(state, palette[0])
assert.equal(state.colors[objects[1].id], palette[0])
assert.equal(state.colors[objects[2].id], original.colors[objects[2].id], '未选对象的颜色应保留')
assert.throws(() => selectObject(state, 'missing'))
assert.throws(() => colorSelected(state, 'invalid'))
assert.deepEqual(createState(), original, '复位应恢复初始选择与配色')
console.log('交互状态通过：选物、换色、其他对象保持、无效输入与复位。浏览器选物、镜头与 WebGL 另验。')
