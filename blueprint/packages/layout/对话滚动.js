// 补齐原生 Chat 的底部跟随：正文增高不改变阅读意图，到达增高前的底部也算恢复跟随。
// 会话、历史分页、阅读位置与「回到底部」按钮继续由 dsh 管理。
export function 连接对话滚动(column) {
    const list = column?.parentElement, root = list?.parentElement;
    const scroller = list?.closest('[data-conversation-scroll]') || list;
    if (!scroller || !root) return () => {};
    let following = null, previous = null, frame = 0;
    const sync = () => {
        if (!scroller.clientHeight || !column.getClientRects().length) { previous = null; return; }
        const metrics = { top: scroller.scrollTop, floor: Math.max(0, scroller.scrollHeight - scroller.clientHeight) };
        if (following === null) following = root.hasAttribute('data-chat-following-tail') || Math.abs(metrics.top - metrics.floor) <= 1;
        if (previous) {
            const movedUp = metrics.top < Math.min(previous.top, metrics.floor) - .5;
            const reachedPreviousFloor = metrics.top > previous.top + .5 && Math.abs(metrics.top - previous.floor) <= 1;
            if (movedUp) following = false;
            else if (reachedPreviousFloor) following = true;
        }
        if (Math.abs(metrics.top - metrics.floor) <= 1) following = true;
        if (following && metrics.top !== metrics.floor) scroller.scrollTop = metrics.floor;
        previous = { top: scroller.scrollTop, floor: metrics.floor };
    };
    const schedule = () => {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; sync(); });
    };
    const onScroll = event => { if (event.target === scroller) sync(); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(column); observer.observe(scroller);
    const composer = scroller.querySelector('[data-composer-seat]');
    if (composer) observer.observe(composer);
    schedule();
    return () => {
        observer.disconnect();
        scroller.removeEventListener('scroll', onScroll);
        if (frame) cancelAnimationFrame(frame);
    };
}
