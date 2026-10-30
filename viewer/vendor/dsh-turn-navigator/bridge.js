import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { TurnNavigator } from './TurnNavigator.js';
export {mountTrace} from './trajectory/bridge.js';

// Blueprint owns the transcript. DSH owns every mark, preview and rail interaction.
export function mount({ host, scroller, stream, onNavigate, jumpTo, onError }) {
  const root = createRoot(host);
  host.classList.add('turn-nav-slot');
  let items = [], railItems = [], activeTurn = null, busyTurn = null;
  let anchors = new Map(), dirty = true, pending = 0, request = 0, destroyed = false;
  let rendered = null;
  const t = (key, args = {}) => ({
    'chat.turnNavigation.label': '轮次导航',
    'chat.turnNavigation.jump': `跳转到第 ${args.turn} 轮`,
    'chat.turnNavigation.jumpLoad': `显示并跳转到第 ${args.turn} 轮`,
    'chat.turnNavigation.turn': `第 ${args.turn} 轮`,
  })[key] || key;
  function anchorFor(item) {
    if (item.anchorSeq === null) return stream.querySelector(`[data-nav-turn="${item.turn}"]`);
    const node = anchors.get(item.anchorSeq);
    return node && stream.contains(node) ? node : null;
  }
  function indexAnchors() {
    anchors = new Map();
    stream.querySelectorAll('[data-seq]').forEach(node => {
      const seq = Number(node.dataset.seq);
      if (Number.isSafeInteger(seq) && !anchors.has(seq)) anchors.set(seq, node);
    });
    dirty = false;
  }
  async function navigate(railItem) {
    const item = items.find(item => item.turn === railItem.turn);
    if (!item) return;
    const token = ++request;
    busyTurn = item.turn;
    render();
    try {
      const row = typeof onNavigate === 'function' ? await onNavigate(item) : anchorFor(item);
      if (destroyed || token !== request) return;
      if (row && typeof jumpTo === 'function') jumpTo(row);
      activeTurn = item.turn;
    } catch (error) {
      if (typeof onError === 'function') onError(error);
    } finally {
      if (!destroyed && token === request) { busyTurn = null; refresh(); }
    }
  }
  function render() {
    const same = rendered && rendered.items === railItems && rendered.active === activeTurn && rendered.busy === busyTurn;
    if (same || destroyed) return;
    rendered = { items: railItems, active: activeTurn, busy: busyTurn };
    root.render(createElement(TurnNavigator, { items: railItems, activeTurn, busyTurn, onNavigate: navigate, t }));
  }
  function refreshNow() {
    pending = 0;
    if (destroyed) return;
    const height = scroller.clientHeight;
    host.style.setProperty('--turn-nav-viewport-height', `${height}px`);
    host.style.setProperty('--turn-nav-viewport-width', `${scroller.clientWidth}px`);
    host.hidden = items.length < 2 || height < 64 || stream.hidden;
    if (dirty) indexAnchors();
    const nextRail = items.map(item => ({ turn: item.turn, prompt: item.prompt, response: item.response,
      anchor: anchorFor(item) ? { kind: 'loaded', key: String(item.anchorSeq ?? item.turn) }
        : { kind: 'unloaded', seq: item.anchorSeq } }));
    if (JSON.stringify(nextRail) !== JSON.stringify(railItems)) railItems = nextRail;
    if (!host.hidden) {
      const line = scroller.getBoundingClientRect().top + Math.min(96, height * .2);
      const atBottom = scroller.scrollHeight - scroller.scrollTop - height <= 25;
      let next = null;
      for (const item of items) {
        const row = anchorFor(item);
        if (!row || !row.getClientRects().length) continue;
        if (next === null || atBottom || row.getBoundingClientRect().top <= line) next = item.turn;
        else break;
      }
      activeTurn = next;
    }
    render();
  }
  function refresh() {
    if (!destroyed && !pending) pending = requestAnimationFrame(refreshNow);
  }
  // Keep Blueprint's keyboard shortcuts in addition to DSH's focus/click behavior.
  function keydown(event) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...host.querySelectorAll('.eGxaPq_mark')];
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const rail = host.querySelector('.eGxaPq_scroller');
    if (rail) rail.scrollTop = Math.max(0, next * 10 + 6 - rail.clientHeight / 2);
    buttons[next].focus({ preventScroll: true });
  }
  host.addEventListener('keydown', keydown);
  scroller.addEventListener('scroll', refresh, { passive: true });
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === 'attributes' && record.attributeName === 'data-seq'
      || record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === 1 && (node.hasAttribute('data-seq') || node.querySelector('[data-seq]'))))) dirty = true;
    refresh();
  });
  observer.observe(stream, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'hidden', 'data-seq', 'data-nav-turn'] });
  const resize = new ResizeObserver(refresh);
  resize.observe(stream); resize.observe(scroller);
  return {
    update(nextItems) {
      const next = new Map();
      for (const item of nextItems || []) {
        if (!item || !Number.isSafeInteger(item.turn) || item.turn < 0) continue;
        next.set(item.turn, { turn: item.turn, anchorSeq: Number.isSafeInteger(item.anchorSeq) ? item.anchorSeq : null,
          prompt: String(item.prompt || ''), response: String(item.response || '') });
      }
      items = [...next.values()].sort((a, b) => a.turn - b.turn);
      dirty = true;
      refresh();
    },
    refresh,
    reset() { request++; activeTurn = null; busyTurn = null; this.update([]); },
    destroy() {
      if (destroyed) return;
      destroyed = true; request++;
      if (pending) cancelAnimationFrame(pending);
      observer.disconnect(); resize.disconnect();
      host.removeEventListener('keydown', keydown);
      scroller.removeEventListener('scroll', refresh);
      root.unmount(); host.hidden = true;
    },
  };
}
