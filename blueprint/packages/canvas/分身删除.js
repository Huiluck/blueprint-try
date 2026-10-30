import { 译 } from '../../../viewer/界面语言.js';
// 删除范围与确认共用一份投影；不改变座位本身。
export function 分身删除范围(tree, key, node) {
  if (!tree?.project || !node || !tree.nodes?.includes(node)) throw new Error(译('分身已不在当前项目，请刷新后重试'))
  const total = key === 'helm', seat = total ? '' : key?.startsWith('seat:') ? key.slice(5) : null
  if (seat === null || (total ? node.类型 !== 'helm' && !(node.是根 && node.类型 !== 'dock') : node.类型 !== 'dock' || node.座位名 !== seat)) throw new Error(译('分身不属于当前座位'))
  const children = new Map(tree.nodes.map(item => [item.node_id, new Set(item.children || [])]))
  for (const item of tree.nodes) children.get(item.parent)?.add(item.node_id)
  const ids = new Set(), pending = [node.node_id]
  while (pending.length) {
    const id = pending.pop()
    if (ids.has(id)) continue
    ids.add(id); pending.push(...(children.get(id) || []))
  }
  const sessionId = node.带们?.find(band => band.主会话)?.主会话 || node.带们?.[0]?.会话
  if (!sessionId) throw new Error(译('分身会话尚未就绪，请稍后重试'))
  return { projectSessionId: tree.project, nodeId: String(node.号), sessionId, seat,
    label: total ? '工作' : '分身', name: node.名字 || String(node.号), count: ids.size }
}

// label 是 '工作' 或 '分身'（测试按它认），显示时才按语言换。
export const 分身类名 = label => label === '工作' ? 译('工作') : 译('分身')

export function 确认分身删除(target) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog')
    dialog.className = 'node-restart-dialog bpc-restart-dialog'
    dialog.setAttribute('aria-labelledby', 'bpc-remove-title')
    const form = document.createElement('form'); form.method = 'dialog'
    const title = document.createElement('h2'); title.id = 'bpc-remove-title'; title.textContent = 译('删除{label}「{name}」？', { label: 分身类名(target.label), name: target.name })
    const detail = document.createElement('p'); detail.textContent = target.count > 1
      ? 译('将移除这条{label}及其下属节点（共 {n} 个节点），并停止相关运行。座位、历史对话和已有文件保留。', { label: 分身类名(target.label), n: target.count })
      : 译('将移除这条{label}，并停止相关运行。座位、历史对话和已有文件保留。', { label: 分身类名(target.label) })
    const footer = document.createElement('footer')
    const cancel = document.createElement('button'); cancel.value = 'cancel'; cancel.textContent = 译('取消'); cancel.autofocus = true
    const accept = document.createElement('button'); accept.value = 'delete'; accept.textContent = 译('删除')
    footer.append(cancel, accept); form.append(title, detail, footer); dialog.append(form)
    dialog.addEventListener('close', () => { const accepted = dialog.returnValue === 'delete'; dialog.remove(); resolve(accepted) }, { once: true })
    document.body.append(dialog); dialog.showModal()
  })
}
