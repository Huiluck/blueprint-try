import { 译 } from '../../../viewer/界面语言.js';
import { 项目工作, 节点状态 } from './项目数据.js';

export function 座位节点文档(tree, node) {
    const band = node.带们?.find(item => item.会话 && (node.用户草稿 || item.有对话 !== false));
    return { root: tree.project, path: node.文档位 || null, title: `${node.号} ${node.名字 || ''}`.trim(),
        id: node.号, session: band?.会话 || null, nodeSession: band?.会话 || node.带们?.[0]?.会话 || null };
}

export function 座位页数据(tree, key, currentWork, status = new Map()) {
    if (!tree?.nodes) return null;
    const total = key === 'helm', index = (tree.座位们 || []).findIndex(seat => 'seat:' + seat.name === key);
    if (!total && index < 0) return null;
    // 座位就是 helm（十 54）：它的记忆是项目里的几份文件——接手说明、项目经验、历任总 dock 的节点文档（十 58）。
    const 记 = tree.座位记忆 || {};
    // 新建阶段页（10-25 样稿 C）要交代做到哪了：上一阶段取最后一个开过工的（登记着没开工的不算），新阶段号接在所有阶段后面。
    const 历任 = 记.历任 || [], 历任态 = 历任.map((item, index) => {
        const node = tree.nodes.find(node => String(node.号) === String(item.号));
        return { ...item, 序: index + 1, state: node ? 节点状态(node, status) : '' };
    });
    const seat = total ? { name: 译('总制作人'), scope: 译('承接工作目标，建立组织、分配职责，协调推进。'),
        现状: 记.现状 || '', 经验数: 记.经验数 ?? 0, 经验目录: 记.经验目录 || '', 历任, 项目模式: 记.项目模式 || '',
        上一阶段: [...历任态].reverse().find(item => item.state && item.state !== 'idle') || 历任态.at(-1) || null, 阶段号: 历任.length + 1 } : tree.座位们[index];
    const works = 项目工作(tree, status).map(work => ({ ...work, doc: 座位节点文档(tree, tree.nodes.find(node => node.node_id === work.id)) }));
    const current = works.find(work => work.members.some(node => String(node.号) === String(currentWork)));
    const nodes = total ? works.map(work => tree.nodes.find(node => node.node_id === work.id)).filter(node => node.类型 !== 'dock')
        : tree.nodes.filter(node => node.类型 === 'dock' && node.座位名 === seat.name && 节点状态(node, status) !== 'gone');
    const avatars = nodes.map(node => {
        const work = works.find(work => work.members.some(member => member.node_id === node.node_id));
        return { node, doc: 座位节点文档(tree, node), state: 节点状态(node, status), work,
            current: !!current && current.id === work?.id };
    }).sort((a, b) => String(a.node.号).localeCompare(String(b.node.号), 'en', { numeric: true }));
    return { ...seat, key, total, code: 'S.' + String(total ? 0 : index + 1).padStart(2, '0'), works, avatars, currentWork: current?.id || '' };
}

// 首次发送才建立独立工作线；重试沿用同一创建请求。
export async function 创建座位分身(read, { root, key, requestId, launch }) {
    if (!root || !(key === 'helm' || key?.startsWith('seat:')) || !requestId) throw new Error(译('创建分身的项目或座位身份缺失。'));
    const data = await read('history', { session: root, 要: '树', 首屏: '1' }, { fresh: true });
    const tree = data.lineage?.tree;
    if (data.lineage?.root !== root || tree?.project !== root) throw new Error(译('项目归属已改变，未创建分身。'));
    const seat = 座位页数据(tree, key);
    if (!seat) throw new Error(译('这个座位已不可读取。'));
    const userDraft = { name: seat.name, code: seat.code, scope: seat.scope, 现状: seat.现状, 经验数: seat.经验数, 经验目录: seat.经验目录, 历任: seat.历任 };
    const result = await read('avatar', {}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        session: root, seat: seat.total ? '' : seat.name, requestId, ...(launch ? { launch } : {}),
    }) });
    if (!result.value?.sessionId || result.value.id === undefined) throw new Error(译('没有返回新分身，未进入旧分身。'));
    const session = result.value.sessionId;
    // build、solo：话直接交给座位上的 helm（十 58），toHelm 时不把输入框的模型、权限、计划模式套到 helm 上。
    return { root, id: result.value.id, session, nodeSession: session, name: seat.name, title: seat.name,
        userDraft, toHelm: result.value.toHelm === true };
}

// 已有树是权威；创建响应只在新节点投影尚未到达时提供空白页信息。
export function 空白分身信息(tree, sessionId, doc) {
    if (!sessionId) return null;
    const current = tree?.nodes?.find(item => item.带们?.some(band => band.会话 === sessionId));
    if (current) {
        if (!current.用户草稿) return null;
        const index = tree.座位们?.findIndex(item => item.name === current.座位名) ?? -1;
        const seat = tree.座位们?.[index];
        return { name: seat?.name || (current.类型 === 'helm' ? 译('总制作人') : current.名字), code: seat ? 'S.' + String(index + 1).padStart(2, '0') : current.座位名 ? null : 'S.00',
            scope: seat?.scope, 现状: seat?.现状, 经验数: seat?.经验数 };
    }
    return doc?.nodeSession === sessionId ? doc.userDraft ?? null : null;
}
