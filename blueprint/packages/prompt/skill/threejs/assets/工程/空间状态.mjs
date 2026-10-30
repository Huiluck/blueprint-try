export const palette = Object.freeze(['#3bd8ad', '#8f9aff', '#ffb366'])
export const objects = Object.freeze([
  Object.freeze({ id: 'crystal', label: '晶体展品', color: '#3bd8ad' }),
  Object.freeze({ id: 'orbit', label: '轨道环', color: '#8f9aff' }),
  Object.freeze({ id: 'column', label: '灯柱', color: '#ffb366' }),
])
export function createState() {
  return { selected: objects[0].id, colors: Object.fromEntries(objects.map(item => [item.id, item.color])) }
}
export function selectObject(state, id) {
  if (!objects.some(item => item.id === id)) throw new Error('场景中没有这个对象')
  state.selected = id
  return state
}
export function colorSelected(state, color) {
  if (!palette.includes(color)) throw new Error('使用当前调色板中的颜色')
  state.colors[state.selected] = color
  return state
}
