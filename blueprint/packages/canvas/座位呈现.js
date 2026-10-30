// 移植 blueprint-seat-avatar-workspace.html 的 makeModel 分身轨道与 focusAnchor。
// 节点本体继续由 MirrorRender 画；同一个轨道壳在窄边、选项、隐藏位置之间过渡。
export function 分身轨位(owner, list, index, expanded, width = owner.砖.w ?? 200) {
  return list.map((node, i) => {
    const delta = i - index, side = delta < 0 ? -1 : 1;
    const centerX = owner.砖.x + width / 2;
    let state = 'dormant', x = centerX - (width - 12) / 2, y = side < 0 ? owner.砖.y - 10 : owner.砖.y + owner.砖.h + 4;
    let w = width - 12, h = 6;
    if (i === index) {
      state = 'current'; x = centerX - width / 2; y = owner.砖.y; w = width; h = owner.砖.h;
    } else if (expanded && ((index >= 0 && Math.abs(delta) <= 2) || (index < 0 && i < 3))) {
      state = 'choice'; x = centerX - width / 2; w = width; h = 47;
      y = index < 0 ? owner.y + owner.h + 14 + i * 53
        : delta < 0 ? owner.y - 14 - Math.abs(delta) * 53 : owner.y + owner.h + 14 + (delta - 1) * 53;
    } else if (!expanded && !owner.空 && ((index >= 0 && Math.abs(delta) === 1) || (index < 0 && i === 0))) state = 'peek';
    return { node, state, x, y, w, h };
  });
}

// 上方候选和「还有几个」共同占位，helm 节点贴着整组的顶边摆。
export function 分身上界(owner, list, index, expanded) {
  if (!expanded) return owner.y;
  const top = Math.min(owner.y, ...分身轨位(owner, list, index, true).filter(card => card.state === 'choice').map(card => card.y));
  return index > 2 ? Math.min(top, owner.y - 148) : top;
}

// 下方候选、「还有几个」和「新建」共同占位（同选项圈的排法），项目总闸贴着整组的底边摆；收起时只留露边。
export function 分身下界(owner, list, index, expanded) {
  const 底 = owner.y + owner.h;
  if (!expanded) return 底 + 10;
  const 后 = list.length - (index < 0 ? 0 : index + 1), 下数 = Math.min(index < 0 ? 3 : 2, 后);
  return 底 + 14 + 下数 * 53 + (后 - 下数 > 0 ? 30 : 0) + 47;
}

export function 座位聚焦镜头(card, bounds, area, side, top = null) {
  const z = Math.max(.5, Math.min(.92, (area.W - 28) / 750));
  const span = Math.min(750, Math.max(card.w, (bounds?.x1 ?? card.x + card.w) - card.x));
  // 画布在右侧保持原有位置；在左侧时，把座位和右方工作树一起居中。
  const offset = side === 'r' ? Math.max(24, (area.W - span * z) / 2) : 24;
  const y = area.r.height * .48 - (card.y + card.h / 2) * z;
  return { z, x: area.L + offset - card.x * z, y: top === null ? y : Math.max(y, area.T - top * z) };
}

export function 锚定座位(layout, anchor) {
  if (!anchor) return layout;
  const owner = anchor && layout.框.find(card => card.key === anchor.key);
  const shift = Number.isFinite(anchor.中心) && Number.isFinite(layout.中心)
    ? anchor.中心 - layout.中心 : owner && Number.isFinite(anchor.y) ? anchor.y - owner.y : 0;
  if (!shift) return layout;
  for (const pos of Object.values(layout.pos)) pos.y += shift;
  for (const card of layout.框) { card.y += shift; card.砖.y += shift; }
  for (const bounds of Object.values(layout.排框)) { bounds.y0 += shift; bounds.y1 += shift; }
  layout.界.y0 += shift; layout.界.y1 += shift;
  if (Number.isFinite(layout.中心)) layout.中心 += shift;
  layout.h = Math.max(layout.h, layout.界.y1 + 300);
  return layout;
}

// 只替换座位内当前分身的落点；同一行的普通子节点仍使用自己的砖边。
export function 座位连线锚点(cards) {
  const anchors = {};
  for (const card of cards) {
    if (!card.节点) continue;
    const middleX = card.x + card.w / 2, middleY = card.y + card.h / 2;
    anchors[card.节点] = {
      execL: { x: card.x, y: middleY }, execR: { x: card.x + card.w, y: middleY },
      stageTop: { x: middleX, y: card.y }, stageBottom: { x: middleX, y: card.y + card.h },
    };
  }
  return anchors;
}


// 总座位聚焦组织层；子座位保留原来的整棵工作树聚焦。
export function 座位聚焦层级(focused, 局) {
  if (!focused) return { 座位: () => '', 节点: () => '', 连线: () => '', 轨道: () => '' };
  if (focused !== 'helm') {
    const level = key => key === focused ? '' : 'muted';
    return { 座位: level, 节点: (_id, key) => level(key), 连线: (_id, key) => level(key), 轨道: level };
  }
  const frames = new Map([['helm', '']]), direct = new Set();
  for (const seat of 局.座位 || []) {
    frames.set(seat.key, seat.独立 ? 'muted' : 'context');
    if (!seat.独立 && seat.选?.node_id) direct.add(seat.选.node_id);
  }
  for (const node of 局.直属 || []) direct.add(node.node_id);
  const primary = id => Boolean(id) && (id === 局.helm?.node_id || id === 局.helm节点?.node_id);
  return {
    座位: key => frames.get(key) ?? 'muted',
    节点: id => primary(id) ? '' : direct.has(id) ? 'soft' : 'muted',
    连线: id => primary(id) ? '' : direct.has(id) ? 'context' : 'muted',
    轨道: key => key === 'helm' ? '' : frames.get(key) === 'context' ? 'soft' : 'muted',
  };
}
