// previous 来自名册的 successorOf；只沿总节点的接班关系归组，不把座位自己的接班算成总节点换轮。
export function 工作轮组(nodes = [], selections = {}) {
  const helms = nodes.filter(node => node.类型 === 'helm' || (node.是根 && node.类型 !== 'dock'));
  const byId = new Map(helms.map(node => [node.node_id, node]));
  const byNumber = new Map(helms.map(node => [String(node.号), node]));
  const groups = new Map();
  for (const node of helms) {
    const chain = [], seen = new Set();
    let current = node;
    while (current && !seen.has(current.node_id)) {
      seen.add(current.node_id); chain.unshift(current);
      current = current.previous === undefined || current.previous === '' ? null
        : byId.get(current.previous) || byNumber.get(String(current.previous));
    }
    const first = chain[0], key = String(first.号 ?? first.node_id);
    if (!groups.has(key)) groups.set(key, { key, first, rounds: [] });
    if (!(node.带们 || []).some(band => band.状态 === 'gone')) groups.get(key).rounds.push({ node, order: chain.length });
  }
  return [...groups.values()].filter(group => group.rounds.length).map(group => {
    const rounds = group.rounds.sort((a, b) => a.order - b.order
      || String(a.node.号).localeCompare(String(b.node.号), 'en', { numeric: true })).map(item => item.node);
    const current = rounds.find(node => String(node.号) === selections[group.key] || node.node_id === selections[group.key]) || rounds.at(-1);
    return { ...group, rounds, current };
  }).sort((a, b) => String(a.first.号).localeCompare(String(b.first.号), 'en', { numeric: true }));
}
