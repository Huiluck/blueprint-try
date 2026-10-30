import { 译 } from '../../../viewer/界面语言.js';
// 看板只组织原节点，不改变节点状态、卡片或操作。
export const 看板规格 = { width: 1120, height: 640, gap: 24 };
export const 看板列 = [
  { key: 'run', label: '正在运行', states: ['run'] },
  { key: 'wait', label: '等待中', states: ['wait'] },
  { key: 'ask', label: '待回答', states: ['ask'] },
  { key: 'ended', label: '已结束', states: ['done', 'stop', 'dead', 'gone'] },
];

// 列名在 看板列 里是中文（测试按它认）；画的时候按语言取。
export const 看板列名 = key => ({ run: 译('正在运行'), wait: 译('等待中'), ask: 译('待回答'), ended: 译('已结束') })[key];

export function 看板分组(cards) {
  return 看板列.map(column => ({ ...column,
    cards: cards.filter(card => column.states.some(state => card.classList.contains('o-' + state))),
  }));
}

export function 看板适配(width, height) {
  const scale = Math.max(0, Math.min(1, width / 看板规格.width, height / 看板规格.height));
  return { scale, width: 看板规格.width * scale, height: 看板规格.height * scale };
}

// 隐藏后的滚动容器会读到 0；只接收仍在显示的看板位置。
export function 记录看板滚动(board, positions) {
  if (!board.getClientRects().length) return;
  for (const body of board.querySelectorAll('.bpc-column-body')) {
    positions.set(board.dataset.project + '|' + body.dataset.state, body.scrollTop);
  }
}
