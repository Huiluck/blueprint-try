// 顶栏显示整个项目，当前节点的原生用量仍留在工作面板窗头。
function BlueprintProjectMetrics({ project, data, read, active }) {
    const [state, setState] = react.useState({ root: '', value: null, error: '' });
    const [tick, setTick] = react.useState(0);
    const clockRef = react.useRef(null), refreshRef = react.useRef(null), detailsRef = react.useRef(null);
    const root = project?.root, revision = root && data?.tree?.project === root ? data.tree.event_count : null;
    const clock = data?.clock;
    const acceptClock = value => {
        if (!value || value.project !== project?.path) return;
        const previous = clockRef.current;
        // 同一毫秒按服务端序号认新旧；重复快照不重置本地计时起点。
        if (!previous || previous.project !== value.project || value.asOf > previous.asOf
            || (value.asOf === previous.asOf && (value.sequence ?? 0) > (previous.sequence ?? 0))) {
            clockRef.current = { ...value, receivedAt: performance.now() };
        }
    };
    react.useEffect(() => {
        if (!active || !root) return;
        let valid = true, timer, reading = false, again = false, lastRead = 0;
        setState({ root, value: null, error: '' }); clockRef.current = null;
        const refresh = () => {
            if (!valid) return;
            if (reading) { again = true; return; }
            reading = true; lastRead = performance.now();
            read('history', { session: root, 要: '项目统计' }).then(result => {
                if (!valid) return;
                if (!Number.isFinite(result?.计量?.total)) throw new Error(译('服务暂未返回项目用量，正在重试'));
                setState({ root, value: result.计量, error: '' });
                acceptClock(result.工作时间);
            }).catch(error => {
                if (!valid) return;
                setState(previous => ({ ...previous, root, error: error.message }));
                // 首读失败或服务重载后也会恢复，不依赖下一个节点事件或用户切窗。
                schedule();
            })
              .finally(() => { reading = false; if (again && valid) { again = false; schedule(); } });
        };
        const schedule = () => { if (timer) return; timer = setTimeout(() => { timer = null; refresh(); }, Math.max(700, 5000 - (performance.now() - lastRead))); };
        refreshRef.current = schedule; refresh();
        return () => { valid = false; refreshRef.current = null; clearTimeout(timer); };
    }, [active, root, read]);
    react.useEffect(() => { refreshRef.current?.(); }, [revision, clock?.sequence]);
    react.useEffect(() => {
        if (active && state.root === root && Date.now() >= (state.value?.deepseek?.nextPriceChangeAt ?? Infinity)) refreshRef.current?.();
    }, [active, root, tick, state]);
    react.useEffect(() => {
        acceptClock(clock);
    }, [clock, project?.path]);
    react.useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => setTick(value => value + 1), 1000);
        const close = event => { if (!detailsRef.current?.contains(event.target)) detailsRef.current?.removeAttribute('open'); };
        const escape = event => { if (event.key === 'Escape') detailsRef.current?.removeAttribute('open'); };
        const focus = () => refreshRef.current?.();
        window.addEventListener('focus', focus);
        document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
        return () => { clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
    }, [active]);
    if (!active || !root) return null;
    const value = state.root === root ? state.value : null, cost = value?.deepseek;
    const currentClock = clockRef.current?.project === project.path ? clockRef.current : null;
    const stale = currentClock?.running && performance.now() - currentClock.receivedAt > 45000;
    const milliseconds = currentClock?.known ? currentClock.workedMs + (currentClock.running ? Math.min(45000, performance.now() - currentClock.receivedAt) : 0) : null;
    const elapsed = milliseconds === null ? '—' : [Math.floor(milliseconds / 3600000), Math.floor(milliseconds / 60000) % 60, Math.floor(milliseconds / 1000) % 60].map(value => String(value).padStart(2, '0')).join(':');
    const lower = !!(value?.unread || value?.missingUsage || value?.ledgerError);
    const tokenLabel = value ? (lower ? '≥ ' : '') + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value.total) : '—';
    const money = cost?.knownTokens ? (cost.unknownTokens || lower ? '≥ ' : '≈ ') + '¥' + cost.cost.toFixed(2) : '—';
    const metric = (label, content) => h('span', { className: 'bp-project-metric' }, h('span', null, label), h('b', null, content));
    return h('details', { ref: detailsRef, className: 'bp-project-metrics', 'data-stale': state.error || stale ? '' : undefined },
        h('summary', { 'aria-label': 译('项目总用量、运行时长与费用'), title: 译('查看项目总用量与 DeepSeek 官方分时计价') },
            metric(译('总用量'), h(react.Fragment, null, tokenLabel, h('span', { className: 'bp-token-unit' }, ' token'))), metric(译('运行'), elapsed), cost?.tokens ? metric('DeepSeek', h(react.Fragment, null, money, h('small', { title: 译('当前单价时段，累计费用仍按每次调用当时的价格计算') }, cost.period === '高峰' ? 译('高峰价') : cost.period === '空闲' ? 译('闲时价') : ''))) : null),
        h('div', { className: 'bp-project-metrics-detail' },
            h('h3', null, 译('项目用量')),
            h('p', null, 译('包含本项目全部工作、节点与子会话；分叉继承的 token 不重复计入。')),
            value ? h('p', null, (lower ? 译('已知用量至少 {n} token · {sessions} 个会话', { n: value.total.toLocaleString('en-US'), sessions: value.sessions }) : 译('累计 {n} token · {sessions} 个会话', { n: value.total.toLocaleString('en-US'), sessions: value.sessions }))): null,
            value ? h('p', null, 译('输入 {input} · 缓存读 {cacheRead} · 缓存写 {cacheWrite} · 输出 {output}', { input: value.input.toLocaleString('en-US'), cacheRead: value.cacheRead.toLocaleString('en-US'), cacheWrite: value.cacheWrite.toLocaleString('en-US'), output: value.output.toLocaleString('en-US') })) : null,
            h('p', null, 译('运行时长只累计至少一个节点实际运行的时间，并发不重复；没有运行节点时暂停，等待用户处理不计时。')),
            state.error ? h('p', { className: 'bp-project-metrics-warning', role: 'status' }, 译('统计暂未更新：{error}', { error: state.error })) : null,
            lower ? h('p', { className: 'bp-project-metrics-warning' }, [value.unread ? 译('{n} 个会话暂不可读取', { n: value.unread }) : '', value.missingUsage ? 译('{n} 条历史响应未提供用量', { n: value.missingUsage }) : '', value.ledgerError].filter(Boolean).join(译('；')) + 译('。当前数字为已知下限。')) : null,
            stale ? h('p', { className: 'bp-project-metrics-warning' }, 译('计时正在等待服务端同步。')) : null,
            cost?.tokens ? h(react.Fragment, null,
                h('h3', null, 译('DeepSeek 官方 API') + ' · ' + money),
                h('p', null, cost.schedule),
                h('p', null, 译('已计价部分：高峰 ¥{peak} · 空闲 ¥{offPeak}。按调用开始时间估算，跨价段或缺少时间的旧记录不猜价。', { peak: cost.peakCost.toFixed(4), offPeak: cost.offPeakCost.toFixed(4) })),
                cost.unknownTokens ? h('p', { className: 'bp-project-metrics-warning' }, 译('{n} token 尚无法匹配可靠的历史价格。', { n: cost.unknownTokens.toLocaleString('en-US') })) : null,
                h('table', null, h('caption', null, 译('当前单价 · 元 / 百万 token（缓存命中 / 未命中 / 输出）')),
                    h('thead', null, h('tr', null, h('th', null, 译('模型')), h('th', null, 译('空闲')), h('th', null, 译('高峰')))),
                    h('tbody', null, cost.rates.filter(row => row.peak).map(row => {
                        const rates = [.5, 1].map(m => [row.peak.缓存读, row.peak.输入, row.peak.输出].map(n => Number((n * m).toFixed(4))).join(' / '));
                        return h('tr', { key: row.model }, h('td', null, row.model.replace('deepseek-', '')), h('td', null, rates[0]), h('td', null, rates[1]));
                    }))),
                h('p', null, 译('仅估算 DeepSeek 官方 API 调用，不包括其他服务；实际扣费以官方账单为准。')),
                h('a', { href: cost.source, target: '_blank', rel: 'noreferrer' }, 译('官方价格 ↗')), h('small', null, ' ' + 译('核对于 {date}', { date: cost.verifiedAt }))) : null));
}
