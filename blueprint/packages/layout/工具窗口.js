// 工具窗只保存几何；原生页面、会话持有和资源清理仍归 dsh。
const 工具窗最小宽 = 320, 工具窗最小高 = 160, 工具窗间隔 = 8;
const 工具窗限值 = (value, low, high) => Math.round(Math.max(low, Math.min(value, high)));

export function 读取工具窗(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([kind, rect]) =>
        ['terminal', 'changes-review', 'browser', 'files'].includes(kind) && rect &&
        ['x', 'y', 'w', 'h'].every(key => Number.isFinite(rect[key])) && rect.w > 0 && rect.h > 0)
        .map(([kind, { x, y, w, h }]) => [kind, { x, y, w, h }]));
}

export function 约束工具窗(rect, geometry) {
    const W = Math.max(1, geometry.width), H = Math.max(1, geometry.height);
    const w = 工具窗限值(rect.w, Math.min(工具窗最小宽, W), W);
    const h = 工具窗限值(rect.h, Math.min(工具窗最小高, H), H);
    return { x: 工具窗限值(rect.x, 0, W - w), y: 工具窗限值(rect.y, 0, H - h), w, h };
}

export function 默认工具窗(cells, geometry) {
    const columns = Math.max(1, ...cells.map(cell => cell.column));
    const room = Math.min(geometry.width, geometry.roomWidth);
    const w = Math.min(geometry.defaultWidth, (room - (columns - 1) * 工具窗间隔) / columns);
    const total = w * columns + (columns - 1) * 工具窗间隔;
    return Object.fromEntries(cells.map(cell => {
        const h = Math.max(Math.min(工具窗最小高, geometry.height),
            (geometry.height - (cell.rows - 1) * 工具窗间隔) / cell.rows);
        return [cell.kind, 约束工具窗({
            x: (geometry.side === 'l' ? 0 : geometry.width - total) + (cell.column - 1) * (w + 工具窗间隔),
            y: cell.rows > 1 ? (geometry.height - h) * (cell.row - 1) / (cell.rows - 1) : 0,
            w, h,
        }, geometry)];
    }));
}

export function 调节工具窗(start, edge, dx, dy, geometry) {
    if (edge === 'move') return 约束工具窗({ ...start, x: start.x + dx, y: start.y + dy }, geometry);
    let left = start.x, right = start.x + start.w, top = start.y, bottom = start.y + start.h;
    const minW = Math.min(工具窗最小宽, geometry.width), minH = Math.min(工具窗最小高, geometry.height);
    if (edge.includes('w')) left = 工具窗限值(left + dx, 0, right - minW);
    if (edge.includes('e')) right = 工具窗限值(right + dx, left + minW, geometry.width);
    if (edge.includes('n')) top = 工具窗限值(top + dy, 0, bottom - minH);
    if (edge.includes('s')) bottom = 工具窗限值(bottom + dy, top + minH, geometry.height);
    return { x: left, y: top, w: right - left, h: bottom - top };
}

export function 创建工具窗拖动({ target, change, commit }) {
    let current = null;
    const clear = () => {
        const previous = current;
        if (!previous) return;
        current = null;
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', end);
        target.removeEventListener('pointercancel', end);
        try { previous.owner.releasePointerCapture(previous.pointerId); } catch {}
        change(null);
    };
    const position = event => 调节工具窗(current.start, current.edge,
        event.clientX - current.x, event.clientY - current.y, current.geometry);
    const move = event => {
        if (!current || event.pointerId !== current.pointerId) return;
        if (!current.moving && Math.abs(event.clientX - current.x) + Math.abs(event.clientY - current.y) < 4) return;
        current.moving = true;
        change({ kind: current.kind, edge: current.edge, rect: position(event) });
    };
    const end = event => {
        if (!current || event.pointerId !== current.pointerId) return;
        const previous = current, rect = event.type === 'pointerup' ? position(event) : null;
        clear();
        if (rect && previous.moving) commit(previous.kind, rect);
    };
    return {
        begin(kind, edge, start, geometry, event) {
            if (event.button !== 0 || current) return;
            event.preventDefault(); event.stopPropagation();
            current = { kind, edge, start, geometry, x: event.clientX, y: event.clientY,
                owner: event.currentTarget, pointerId: event.pointerId, moving: edge !== 'move' };
            try { current.owner.setPointerCapture(current.pointerId); } catch {}
            target.addEventListener('pointermove', move);
            target.addEventListener('pointerup', end);
            target.addEventListener('pointercancel', end);
            if (current.moving) change({ kind, edge, rect: start });
        },
        cancel(kind) { if (!kind || current?.kind === kind) clear(); },
    };
}
