// 与图纸 CSS 的 cubic-bezier(.22,1,.36,1) 使用同一条曲线。
export function 图纸缓出(progress) {
  const x = Math.max(0, Math.min(1, progress));
  if (x === 0 || x === 1) return x;
  const position = t => 3 * (1 - t) ** 2 * t * .22 + 3 * (1 - t) * t ** 2 * .36 + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (position(mid) < x) lo = mid; else hi = mid;
  }
  return 1 - (1 - (lo + hi) / 2) ** 3;
}

// 只管理一次分身身份交接；节点执行、布局与候选轨道仍由原组件负责。
export function 创建分身切换动效({ scene, ghosts, duration = 540, easing = 'cubic-bezier(.22,1,.36,1)' }) {
  const animations = new Set(), faces = new Map(), copies = new Set();
  const box = element => {
    if (!element) return null;
    const surface = scene(), rect = element.getBoundingClientRect(), origin = surface.getBoundingClientRect();
    const scale = new DOMMatrix(getComputedStyle(surface).transform).a || 1;
    return { x: (rect.left - origin.left) / scale, y: (rect.top - origin.top) / scale, w: rect.width / scale, h: rect.height / scale };
  };
  const cancel = () => {
    for (const animation of animations) animation.cancel();
    animations.clear();
    for (const copy of copies) copy.remove();
    copies.clear(); faces.clear();
  };
  const animate = (element, frames, finish = () => {}) => {
    const animation = element.animate(frames, { duration, easing, fill: 'both' });
    animations.add(animation);
    animation.finished.then(() => {
      if (!animations.delete(animation)) return;
      finish(); animation.cancel();
    }, () => { animations.delete(animation); });
    return animation;
  };
  const copyAt = (source, start, id) => {
    if (!source || !start || !ghosts()) return null;
    const copy = source.cloneNode(true);
    copy.inert = true; copy.setAttribute('aria-hidden', 'true');
    copy.classList.remove('sel', 'bpc-muted', 'bpc-soft', 'bpc-context');
    copy.classList.add('bpc-switch-copy');
    Object.assign(copy.style, { left: start.x + 'px', top: start.y + 'px', width: start.w + 'px', height: start.h + 'px',
      transition: 'none', transform: 'none', visibility: 'visible', opacity: '1', overflow: 'hidden', pointerEvents: 'none' });
    ghosts().appendChild(copy); copies.add(copy); faces.set(id, copy);
    return copy;
  };
  const remove = (copy, id) => {
    copy.remove(); copies.delete(copy);
    if (faces.get(id) === copy) faces.delete(id);
  };
  const capture = ({ key, incoming, outgoing, choice, current }) => {
    // 快速反向优先接住还在飞的那张卡，不从上一次的终点重来。
    const source = faces.get(incoming) || choice;
    const result = { key, incoming, outgoing, from: box(source), fromFace: source?.cloneNode(true),
      out: box(current), outFace: current?.cloneNode(true) };
    cancel();
    return result;
  };
  const play = ({ change, brick, outgoingTrack, target, outgoingTarget }) => {
    if (!change || !brick || !target || !change.from) return false;
    const from = change.from, dx = from.x - target.x, dy = from.y - target.y;
    const clip = Math.max(0, target.h - from.h);
    const face = copyAt(change.fromFace, from, change.incoming);
    if (face) animate(face, [
      { left: from.x + 'px', top: from.y + 'px', width: from.w + 'px', height: from.h + 'px', opacity: 1 },
      { offset: .35, opacity: .65 },
      { left: target.x + 'px', top: target.y + 'px', width: target.w + 'px', height: target.h + 'px', opacity: 0 },
    ], () => remove(face, change.incoming));
    // 只平移、裁切和交接透明度，正文与图标不随外壳的高度变化被压扁。
    animate(brick, [
      { transform: `translate(${dx}px,${dy}px)`, clipPath: `inset(0px 0px ${clip}px 0px)`, opacity: face ? 0 : 1 },
      ...(face ? [{ offset: .35, opacity: .35 }] : []),
      { transform: 'none', clipPath: 'inset(0px 0px 0px 0px)', opacity: 1 },
    ]);
    if (change.outFace && change.out && outgoingTarget) {
      const old = copyAt(change.outFace, change.out, change.outgoing);
      if (old) animate(old, [
        { left: change.out.x + 'px', top: change.out.y + 'px', width: change.out.w + 'px', height: change.out.h + 'px', opacity: 1 },
        { offset: .35, opacity: .65 },
        { left: outgoingTarget.x + 'px', top: outgoingTarget.y + 'px', width: outgoingTarget.w + 'px', height: outgoingTarget.h + 'px', opacity: 0 },
      ], () => remove(old, change.outgoing));
      if (outgoingTrack) animate(outgoingTrack, [{ opacity: 0 }, { offset: .35, opacity: .35 }, { opacity: 1 }]);
    }
    return true;
  };
  return { capture, play, cancel };
}
