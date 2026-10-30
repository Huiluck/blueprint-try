// 节点信息只消费面向用户的工作字段；运行状态继续取图纸与原生会话投影。
function BlueprintNodeText({ source }) {
    const host = react.useRef(null);
    react.useLayoutEffect(() => { renderNodeMarkdown(host.current, source || ''); }, [source]);
    return h('div', { className: 'bni-text s2stream' }, h('div', { ref: host, className: 'said' }));
}

function BlueprintNodeSection({ title, source, children }) {
    if (!source && !children) return null;
    return h('section', { className: 'bni-section' }, h('h3', {}, title),
        source ? h(BlueprintNodeText, { source }) : null, children);
}

function BlueprintNodeInformation({ info, tree, status = new Map() }) {
    const kind = info.kind, isHelm = kind === 'helm', isDock = kind === 'dock';
    const actual = tree?.nodes?.find(item => String(item.号) === String(info.id));
    const state = actual ? 节点状态(actual, status) : info.status === '完成' ? 'done' : info.status === '去掉' ? 'gone' : info.status === '待做' ? 'idle' : '';
    const roles = { helm: 译('工作总负责人'), dock: 译('统筹负责人'), run: 译('专项执行者') };
    const phases = { orient: 译('弄清要做什么'), plan: 译('制定方案'), execute: 译('执行工作'), integrate: 译('整合成果'), complete: 译('核对成果'), reply: 译('沟通中'), spark: 译('一起想清楚'), rule: 译('研究工作方法') };
    // 派它的节点给这一块定的要求（10-27）；三档的意思和请求里给它的那一段同出用户原句。
    const levels = { stunning: 译('富含创造力且令人惊叹的结果'), polished: 译('令人一看到就感觉高品质的结果'), lean: 译('低成本高性价比达成目标的结果') };
    const outcomes = { achieved: 译('已达成'), unmet: 译('未达成') };
    const relation = info.parent ? `${info.parent.id} · ${info.parent.name}` : 译('用户');
    const fact = (label, value) => value ? h('div', { className: 'bni-fact', key: label }, h('dt', {}, label), h('dd', {}, value)) : null;
    const children = info.children || [], reports = info.reports || [];
    const currentReport = reports[0];
    // 和它收到的请求同一套六项（10-27 派 9）：做什么、之间的联系、项目情境、工作等级、同层分工、必要规则；台写在上面一行。
    // 10-27 以前的项目用的是旧格子，只放进折起来的「旧格式的请求」。
    const link = [info.whole, info.link].filter(Boolean).join('\n\n'), context = [info.shared, info.situation].filter(Boolean).join('\n\n');
    const legacy = [[译('期待'), info.expect], [译('希望发挥的方向'), info.direction], [译('这一部分包括'), info.includes], [译('不包括'), info.excludes],
        [译('台里的验收工具'), info.tools], [译('需要判断的问题'), info.ask]].filter(([, source]) => source);
    const deliveryText = outcomes[info.result] || 译('已交回');
    const statusText = state === 'done' ? deliveryText : 项目状态名[state] || 译('状态暂不可用');
    const renderChild = child => {
        const item = tree?.nodes?.find(entry => String(entry.号) === String(child.id));
        const childState = item ? 节点状态(item, status) : child.status === '完成' ? 'done' : child.status === '待做' ? 'idle' : '';
        return h('li', { key: child.id, className: 'bni-collaborator' },
            h('div', { className: 'bni-collaborator-title' }, h('span', {}, child.seat || child.name),
                h('span', { className: 'bni-small-state', 'data-state': childState }, 项目状态名[childState] || 译('状态暂不可用'))),
            child.seat && child.name !== child.seat ? h('small', {}, child.name) : null,
            child.goal ? h('p', {}, child.goal) : null);
    };
    return h('article', { className: 'bni-content', 'data-kind': kind, 'aria-label': 译('节点信息') },
        h('header', { className: 'bni-identity' },
            h('div', { className: 'bni-overline' }, h('span', {}, `${kind.toUpperCase()} / ${info.id}`),
                h('span', { className: 'bni-status', 'data-state': state }, statusText)),
            h('h2', {}, info.name), h('p', { className: 'bni-role' }, roles[kind]),
            h('dl', { className: 'bni-facts' },
                fact(isHelm ? 译('负责向谁交付') : 译('来自'), relation),
                fact(译('工作等级'), info.level ? `${info.level} · ${levels[info.level] || ''}` : ''),
                fact(译('台'), info.bench),
                fact(译('当前环节'), state === 'run' ? phases[info.phase] : ''),
                fact(译('执行者'), info.executor))),
        h(BlueprintNodeSection, { title: isHelm ? 译('这件工作要做到什么') : 译('做什么'), source: info.goal || 译('正在理解任务…') }),
        isHelm && info.projectRequest ? h(BlueprintNodeSection, { title: 译('创建项目时的原始需求') },
            h('div', { className: 'bni-original-request' }, info.projectRequest)) : null,
        h(BlueprintNodeSection, { title: 译('之间的联系'), source: link }),
        h(BlueprintNodeSection, { title: 译('项目情境'), source: context }),
        h(BlueprintNodeSection, { title: 译('同层分工'), source: info.peers }),
        h(BlueprintNodeSection, { title: 译('必要规则'), source: info.rules }),
        info.responsibility && info.responsibility !== info.goal ? h(BlueprintNodeSection, { title: 译('职责与范围'), source: info.responsibility }) : null,
        legacy.length ? h('details', { className: 'bni-details bni-context' }, h('summary', {}, 译('旧格式的请求')),
            legacy.map(([label, source]) => h('div', { className: 'bni-boundary-item', key: label }, h('h4', {}, label), h(BlueprintNodeText, { source })))) : null,
        // 每类节点用它自己的工作材料说明做法，不用系统角色提示充当介绍。
        // run 不走 plan，没有自己的方案；没写过做法就不出这一节，免得永远是一句「还没有记录」。
        kind === 'run' && !info.approach && !info.plan && !children.length ? null : h(BlueprintNodeSection, { title: isHelm ? 译('怎样推进这件工作') : isDock ? 译('怎样开展这一块') : 译('执行做法'), source: info.approach || '' },
            info.plan ? h('details', { className: 'bni-details' }, h('summary', {}, 译('查看工作方案')), h(BlueprintNodeText, { source: info.plan })) : null,
            children.length ? h(react.Fragment, null,
                h('div', { className: 'bni-group-label' }, isHelm ? 译('各阶段的统筹负责人') : 译('交出的执行任务')),
                h('ul', { className: 'bni-collaborators' }, children.map(renderChild))) : null,
            !info.plan && !info.approach && !children.length ? h('p', { className: 'bni-caption' }, 译('还没有记录具体做法。')) : null),
        h(BlueprintNodeSection, { title: isHelm ? 译('整体进展与交付') : isDock ? 译('成果与交付') : 译('执行结果') },
            state === 'wait' && info.waitingFor?.length ? h('div', { className: 'bni-waiting' }, h('h4', {}, 译('正在等待')),
                h('ul', {}, info.waitingFor.map((item, index) => h('li', { key: index }, item.kind === 'input' ? 译('你的回复') : item.kind === 'job' ? 译('后台任务') : [item.name, item.deliverable].filter(Boolean).join(' · '))))) : null,
            info.handoff ? h('div', { className: 'bni-result' }, h('div', { className: 'bni-result-label' }, deliveryText), h(BlueprintNodeText, { source: info.handoff })) : null,
            currentReport ? h('div', { className: 'bni-report' }, h('div', { className: 'bni-group-label' }, currentReport.title), h(BlueprintNodeText, { source: currentReport.body })) : null,
            !info.handoff && !currentReport ? h('p', { className: 'bni-caption' }, state === 'run' ? 译('正在工作，尚未提交成果。') : state === 'done' ? 译('已交回，暂未记录成果正文。') : 译('尚未提交成果。')) : null,
            info.checked ? h('div', { className: 'bni-verification' }, h('h4', {}, 译('已验证')), h(BlueprintNodeText, { source: info.checked })) : null,
            info.unchecked ? h('div', { className: 'bni-verification' }, h('h4', {}, 译('尚未验证')), h(BlueprintNodeText, { source: info.unchecked })) : null,
            info.question ? h('aside', { className: 'bni-question' }, h('h4', {}, 译('需要决定')), h(BlueprintNodeText, { source: info.question })) : null,
            reports.length > 1 ? h('details', { className: 'bni-details' }, h('summary', {}, 译('更早的成果（{n}）', { n: reports.length - 1 })),
                reports.slice(1).map((report, index) => h('div', { className: 'bni-report', key: index }, h('h4', {}, report.title), h(BlueprintNodeText, { source: report.body })))) : null),
        info.documentUnavailable ? h('p', { className: 'bni-caption' }, 译('部分工作记录暂不可读，当前显示已登记的信息。')) : null);
}

function NodeDocumentBody({ doc, tree, status }) {
    const page = react.useRef(null), [shown, setShown] = react.useState(false), [result, setResult] = react.useState(null), [error, setError] = react.useState(''), [retry, setRetry] = react.useState(0);
    use界面语言(react);
    const helper = tree?.nodes?.find(item => item.sub && String(item.号) === String(doc.id));
    const helperParent = helper && tree.nodes.find(item => item.node_id === helper.parent);
    const helperInfo = helper ? { id: helper.号, name: helper.名字, kind: 'run', goal: helper.带们?.[0]?.一行 || helper.名字,
        parent: helperParent ? { id: helperParent.号, name: helperParent.名字 } : null } : null;
    react.useLayoutEffect(() => {
        const wrapper = page.current.parentElement, sync = () => setShown(!wrapper.hidden);
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(wrapper, { attributes: true, attributeFilter: ['hidden'] });
        return () => observer.disconnect();
    }, []);
    react.useEffect(() => {
        if (!shown || helper || !doc.root || doc.id == null) return;
        const controller = new AbortController(); let timer;
        const load = async () => {
            try {
                const data = await readStudio('node-information', { session: doc.root, id: doc.id }, controller.signal);
                if (controller.signal.aborted) return;
                setResult(data.value); setError('');
            } catch (failure) { if (!controller.signal.aborted) setError(译('节点信息暂时读取失败，请重试。')); }
            if (!controller.signal.aborted) timer = setTimeout(load, 5000);
        };
        void load();
        return () => { controller.abort(); clearTimeout(timer); };
    }, [shown, doc.root, doc.id, retry, !!helper]);
    return h('div', { ref: page, className: 'bp-node-doc' },
        error ? h('div', { className: 'bni-error', role: 'alert' }, error,
            h('button', { type: 'button', onClick: () => setRetry(value => value + 1) }, 译('重试'))) : null,
        helperInfo || result ? h(BlueprintNodeInformation, { info: helperInfo || result, tree, status })
            : !error ? h('p', { className: 'bni-loading', role: 'status' }, 译('正在读取节点信息…')) : null);
}
