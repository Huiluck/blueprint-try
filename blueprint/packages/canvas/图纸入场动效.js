// 入场留出欣赏结构展开的时间；项目树、状态、布局和镜头仍由画布负责。
const 图纸入场时长 = 450;
export function 图纸入场计划(nodes, entering, initial = false, positions = {}) {
  const byId = new Map(nodes.map(node => [node.node_id, node]));
  const byNumber = new Map(nodes.map(node => [String(node.号), node]));
  const parents = new Map();
  for (const node of nodes) for (const child of node.children || []) parents.set(child, node.node_id);
  for (const node of nodes) {
    const previous = node.previous && byNumber.get(String(node.previous));
    if (previous) parents.set(node.node_id, previous.node_id);
    else if (!parents.has(node.node_id) && byId.has(node.parent)) parents.set(node.node_id, node.parent);
  }
  const depths = new Map();
  const depth = id => {
    if (depths.has(id)) return depths.get(id);
    // 缺失父节点或异常环不阻塞呈现。
    const chain = [], visiting = new Set();
    let current = id;
    while (entering.has(current) && !depths.has(current) && !visiting.has(current)) {
      visiting.add(current); chain.push(current); current = parents.get(current);
    }
    let level = depths.get(current) ?? -1;
    for (const child of chain.reverse()) depths.set(child, ++level);
    return depths.get(id) || 0;
  };
  const incoming = nodes.filter(node => entering.has(node.node_id)).sort((a, b) => {
    const level = depth(a.node_id) - depth(b.node_id);
    const ay = positions[a.node_id]?.y, by = positions[b.node_id]?.y;
    return level || (Number.isFinite(ay) && Number.isFinite(by) ? ay - by : 0);
  });
  const maxDepth = Math.max(0, ...incoming.map(node => depth(node.node_id)));
  const duration = 图纸入场时长, step = Math.min(350, (3000 - duration) / (maxDepth + 1));
  const counts = new Map(), peers = new Map();
  for (const node of incoming) { const level = depth(node.node_id); counts.set(level, (counts.get(level) || 0) + 1); }
  return new Map(incoming.map(node => {
    const level = depth(node.node_id), peer = peers.get(level) || 0;
    peers.set(level, peer + 1);
    // 把同层的错峰均匀铺在短时间窗里，形成从上往下的接力。
    const stagger = Math.min(45, Math.min(135, step * .6) / Math.max(1, counts.get(level) - 1));
    const start = (initial ? 0 : 175) + level * step + peer * stagger;
    return [node.node_id, { start, duration, wireStart: Math.max(0, start - 175), wireDuration: 350 }];
  }));
}

// 外框、纸面、文字与角标交叠展开，所有分镜在同一入场窗口内收束。
export function 图纸入场分镜(element) {
  const fade = distance => [{ opacity: 0, translate: `0px ${distance}px` }, { translate: '0px 0px' }];
  const across = [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }];
  const down = [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }];
  return [
    ['.bhead, .bpc-card-head', 'title', .1, .76, fade(3)],
    ['.band, .bpc-card-deck', 'surface', .08, .84, across],
    ['.rail, .bpc-card-spine', 'rail', .12, .72, down],
    ['.txt, .bpc-card-empty', 'content', .24, 1, fade(4)],
    ['.xtag', 'badge', .48, 1, fade(-3)],
  ].flatMap(([selector, part, start, end, frames]) =>
    [...(element.querySelectorAll?.(selector) || [])].map(target => ({ target, part, start, end, frames })));
}

function 图纸入场描边(element) {
  if (!element.matches?.('.nbrick, .bpc-card') || !element.ownerDocument?.createElementNS) return null;
  const w = element.offsetWidth, h = element.offsetHeight;
  if (w < 2 || h < 2) return null;
  const create = name => element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', name);
  const svg = create('svg');
  svg.setAttribute('class', 'bpc-reveal-outline'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('preserveAspectRatio', 'none');
  // 从接线的左侧中点分为上下两笔，在右侧合拢。
  for (const y of [.5, h - .5]) {
    const path = create('path');
    path.setAttribute('d', `M.5,${h / 2} V${y} H${w - .5} V${h / 2}`);
    path.setAttribute('pathLength', '1'); path.setAttribute('stroke-dasharray', '1'); svg.appendChild(path);
  }
  element.appendChild(svg);
  return svg;
}

let 图纸入场序 = 0;
export function 创建图纸入场动效({ now = () => performance.now(), enabled = () => true, easing = 'cubic-bezier(.33,0,.2,1)' } = {}) {
  let project, started = false;
  const seen = new Set(), plans = new Map(), animations = new Map();
  const prefix = 'bpc-node-growth-' + ++图纸入场序;
  const stop = element => {
    const record = animations.get(element);
    if (!record) return;
    animations.delete(element); element.classList.remove('bpc-entering');
    for (const effect of record.effects) effect.cancel();
    record.outline?.remove();
  };
  const finish = () => {
    for (const element of animations.keys()) stop(element);
    plans.clear();
  };
  const update = (tree, presented, positions) => {
    if (tree.project !== project) { finish(); project = tree.project; started = false; seen.clear(); }
    const time = now(), visible = new Set(presented.nodes.map(node => node.node_id));
    for (const [id, plan] of plans) if (!visible.has(id) || time >= plan.start + plan.duration) plans.delete(id);
    for (const element of animations.keys()) if (!element.isConnected) stop(element);
    const entering = new Set(tree.nodes.filter(node => !seen.has(node.node_id)).map(node => node.node_id));
    for (const node of tree.nodes) seen.add(node.node_id);
    if (!enabled()) { finish(); if (tree.nodes.length) started = true; return; }
    if (!tree.nodes.length) return;
    for (const [id, plan] of 图纸入场计划(presented.nodes, started ? entering : visible, !started, positions)) {
      plans.set(id, { ...plan, start: time + plan.start, wireStart: time + plan.wireStart });
    }
    started = true;
  };
  const show = (element, id, fallback = false) => {
    if (!enabled()) return;
    const time = now(), plan = plans.get(id) || (fallback ? { start: time, duration: 图纸入场时长 } : null);
    if (!plan || time >= plan.start + plan.duration) return;
    if (animations.get(element)?.plan === plan) return;
    stop(element);
    element.classList.add('bpc-entering');
    const record = { plan, effects: [], outline: null }; animations.set(element, record);
    const play = (target, frames, start = 0, end = 1) => {
      const at = plan.start + plan.duration * start;
      const effect = target.animate(frames, { duration: plan.duration * (end - start), easing, fill: 'backwards' });
      effect.currentTime = time - at; effect.startTime = at;
      effect.finished.catch(() => {}); record.effects.push(effect);
      return effect;
    };
    // 外壳保持原位；只让内部文字轻轻抬起，后方窄边稍晚接入。
    const animation = play(element, [{ offset: 0, opacity: 0 }], element.matches?.('.bpc-track-card') ? .24 : 0);
    for (const shot of 图纸入场分镜(element)) play(shot.target, shot.frames, shot.start, shot.end);
    record.outline = 图纸入场描边(element);
    if (record.outline) play(record.outline, [
      { strokeDashoffset: '1', opacity: 0 },
      { offset: .12, opacity: .8 },
      { offset: .78, strokeDashoffset: '0', opacity: .55 },
      { strokeDashoffset: '0', opacity: 0 },
    ], 0, .96);
    const cleanup = () => { if (animations.get(element) === record) stop(element); };
    animation.finished.then(cleanup, cleanup);
  };
  const wireProgress = (id, time = now()) => {
    const plan = plans.get(id);
    return plan ? Math.max(0, Math.min(1, (time - plan.wireStart) / plan.wireDuration)) : 1;
  };
  return { update, show, finish, wireProgress, prefix, pending: () => [...plans.values()].some(plan => now() < plan.start + plan.duration) };
}
