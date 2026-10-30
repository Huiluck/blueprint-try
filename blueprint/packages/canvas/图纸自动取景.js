// 只量实际可见的卡片和控件，不把画布预留空间当作内容。
export function 图纸内容范围(rectangles) {
  const valid = rectangles.filter(({ x, y, w, h }) => [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0);
  if (!valid.length) return null;
  return {
    x0: Math.min(...valid.map(r => r.x)), y0: Math.min(...valid.map(r => r.y)),
    x1: Math.max(...valid.map(r => r.x + r.w)), y1: Math.max(...valid.map(r => r.y + r.h)),
  };
}

// 自动取景只平移到工作区中央，始终保留用户当前的缩放比例。
export function 图纸自动镜头(bounds, area, z = 1) {
  if (!bounds || !area) return null;
  const { x0, y0, x1, y1 } = bounds, { L, T, W, H } = area;
  const w = x1 - x0, h = y1 - y0;
  if (![x0, y0, w, h, L, T, W, H, z].every(Number.isFinite) || Math.min(w, h, W, H, z) <= 0) return null;
  return { z, x: L + W / 2 - (x0 + x1) / 2 * z, y: T + H / 2 - (y0 + y1) / 2 * z };
}

// 重新打开项目时，位置和缩放一起归位；四周留白按屏幕像素计算。
export function 图纸进入镜头(bounds, area) {
  if (!图纸自动镜头(bounds, area)) return null;
  const z = Math.min(1, Math.max(1, area.W - 48) / (bounds.x1 - bounds.x0),
    Math.max(1, area.H - 48) / (bounds.y1 - bounds.y0));
  return 图纸自动镜头(bounds, area, z);
}

function 需要自动取景(camera, bounds, area) {
  if (!camera || !(camera.z > 0)) return true;
  const cx = camera.x + (bounds.x0 + bounds.x1) / 2 * camera.z;
  const cy = camera.y + (bounds.y0 + bounds.y1) / 2 * camera.z;
  return Math.abs(cx - area.L - area.W / 2) > 8 || Math.abs(cy - area.T - area.H / 2) > 8;
}

export const 图纸手动静置时长 = 15_000;

const 自动取景记忆键 = 'blueprint.canvas.auto-frame';
export function 读自动取景(storage) {
  try { return (storage || globalThis.localStorage)?.getItem(自动取景记忆键) !== 'off'; } catch { return true; }
}
export function 记自动取景(enabled, storage) {
  try { (storage || globalThis.localStorage)?.setItem(自动取景记忆键, enabled ? 'on' : 'off'); } catch { /* 本机记忆不可写时仍可切换。 */ }
}

// 开启时每 15 秒检查一次构图；手动调整从最后一次操作重新计时，关闭则取消计时。
export function 创建图纸自动取景({ move, camera, enabled: initialEnabled = true, frameOnEntry = false,
  schedule = (fn, delay) => setTimeout(fn, delay), cancel = clearTimeout, now = () => performance.now() }) {
  let project, input, timer = null, placed = false, enabled = initialEnabled, nextAt = 0, manualUntil = 0;
  const stop = () => { if (timer !== null) cancel(timer); timer = null; };
  const targetFor = () => 图纸自动镜头(input?.bounds, input?.area, camera()?.z);
  const ready = () => enabled && input?.active && !!targetFor();
  const isAuto = () => enabled && now() >= manualUntil;
  const apply = animated => {
    if (!ready() || !isAuto()) return;
    if (!placed || 需要自动取景(camera(), input.bounds, input.area)) move(targetFor(), placed && animated);
    placed = true;
  };
  const arm = () => {
    if (timer !== null || !ready()) return;
    timer = schedule(tick, Math.max(0, Math.max(nextAt, manualUntil) - now()));
  };
  const tick = () => {
    timer = null;
    if (!ready()) return;
    if (now() >= Math.max(nextAt, manualUntil)) {
      manualUntil = 0; apply(true); nextAt = now() + 图纸手动静置时长;
    }
    arm();
  };
  return {
    update(next) {
      if (project !== next.project) {
        stop(); placed = false; manualUntil = 0; nextAt = now() + 图纸手动静置时长; project = next.project;
      }
      input = next;
      // 首次进入的双归位独立于持续自动取景，关闭开关也要保证打开时能看到整图。
      const entry = frameOnEntry && !placed && next.active && 图纸进入镜头(next.bounds, next.area);
      if (entry) {
        move(entry, false); placed = true; nextAt = now() + 图纸手动静置时长;
      }
      if (!ready()) { stop(); return; }
      if (!placed && isAuto()) { apply(false); nextAt = now() + 图纸手动静置时长; }
      arm();
    },
    manual() { stop(); manualUntil = now() + 图纸手动静置时长; nextAt = manualUntil; arm(); },
    pause() { stop(); if (input) input = { ...input, active: false }; },
    setEnabled(value) {
      enabled = !!value; stop(); manualUntil = 0; nextAt = now() + 图纸手动静置时长;
      if (enabled && !placed) apply(false);
      arm();
    },
    isAuto,
    dispose() { stop(); input = null; manualUntil = 0; },
  };
}
