// 外部 run 的工作记录：任务、进展、实时文件与交回；原始提示词不进入阅读面。
function BlueprintExternalRunTools({ steps }) {
    const failed = steps.filter(step => 步显示(step).失败).length, running = steps.some(step => step.在跑);
    return h('details', { className: 'bpx-tools' },
        h('summary', {}, h('span', {}, 译('工具操作（{n}）', { n: steps.length })),
            h('span', { className: 'bpx-tool-state', 'data-bad': failed ? '' : undefined }, running ? 译('执行中') : failed ? 译('{n} 项未成功', { n: failed }) : 译('查看命令与文件操作'))),
        h('ol', { className: 'bpx-steps' }, steps.map((step, index) => {
            const display = 步显示(step);
            return h('li', { key: index, 'data-bad': display.失败 ? '' : undefined, 'data-now': display.在跑 ? '' : undefined },
                h('div', { className: 'bpx-step-meta' }, h('span', {}, display.时), h('span', {}, step.类 === '命令' ? 译('命令') : 译('文件操作')), display.尾 ? h('span', {}, display.尾) : null),
                step.类 === '命令' ? h('pre', {}, h('code', {}, step.文)) : h('p', { className: 'bpx-file-operation' }, step.文),
                step.输出 ? h('details', { className: 'bpx-output' }, h('summary', {}, 译('查看输出')), h('pre', {}, step.输出)) : null);
        })));
}

function BlueprintExternalRunAttempt({ data, active = false, currentTask = null, showTask = true }) {
    const paragraphs = 外部run段落(data.正文步骤 || data.步骤, active), task = data.任务 || currentTask;
    return h('section', { className: 'bpx-attempt', 'aria-label': 译('第 {n} 次记录', { n: data.次 }) },
        h('div', { className: 'bpx-attempt-head' }, [译('第 {n} 次执行', { n: data.次 }), data.执行者].filter(Boolean).join(' · ')),
        showTask && task?.目标 ? h('div', { className: 'bpx-task' }, h('div', { className: 'bpx-message-label' }, data.任务 ? 译('收到的任务') : 译('当前任务')),
            h(BlueprintNodeText, { source: task.目标 })) : null,
        paragraphs.length ? paragraphs.map(paragraph => paragraph.type === 'tools'
            ? h(BlueprintExternalRunTools, { key: paragraph.key, steps: paragraph.steps })
            : paragraph.type === 'message' ? h('div', { key: paragraph.key, className: 'bpx-message' },
                h('div', { className: 'bpx-message-label' }, data.执行者 || 译('执行者'), paragraph.step.t != null ? h('time', {}, 时刻文(paragraph.step.t)) : null),
                h(BlueprintNodeText, { source: paragraph.step.文 }))
            : h('div', { key: paragraph.key, className: 'bpx-notice', role: paragraph.step.类 === '出错' ? 'note' : undefined }, paragraph.step.文))
            : h('p', { className: 'bpx-empty-line' }, active ? 译('正在执行，等待第一条进展。') : 译('这次执行没有留下过程记录。')));
}

function BlueprintExternalRunFiles({ data, project, finished, onOpenFile }) {
    const [error, setError] = react.useState('');
    react.useEffect(() => { setError(''); }, [project]);
    const files = data?.文件们 || [], previewable = file => !file.已删除 && ['image', 'web', 'pdf', 'slides', 'office', 'video', 'audio'].includes(file.类型);
    const sorted = [...files].sort((a, b) => Number(previewable(b)) - Number(previewable(a)));
    const open = file => { setError(''); return Promise.resolve().then(() => onOpenFile(file.位置)).catch(() => setError(译('文件暂时打不开，可能还在写入，请稍后重试。'))); };
    const row = file => {
        const preview = `/studio/preview/${encodeURIComponent(project)}/` + file.位置.split('/').map(encodeURIComponent).join('/') + '?v=' + encodeURIComponent(`${file.修改于}:${file.字节}`);
        // 网页和音视频缩略较重；文件清单每次更新，缩略图最多每十秒换一次版本。
        const thumbnail = ['web', 'video', 'audio'].includes(file.类型) ? '/studio/api/material-preview?' + new URLSearchParams({ session: project, path: file.位置, v: String(Math.floor(file.修改于 / 10000)) }) : file.类型 === 'image' ? preview : '';
        const children = [thumbnail && !file.已删除 ? h('img', { src: thumbnail, alt: '', loading: 'lazy', onError: event => { event.currentTarget.hidden = true; }, onLoad: event => { event.currentTarget.hidden = false; } }) : null,
            h('span', { className: 'bpx-file-name' }, file.名字), h('small', {}, file.已删除 ? 译('已删除') : file.字节 >= 1048576 ? `${(file.字节 / 1048576).toFixed(1)} MB` : file.字节 >= 1024 ? `${Math.round(file.字节 / 1024)} KB` : `${file.字节} B`)];
        return file.已删除 ? h('div', { className: 'bpx-file', key: file.位置, 'data-deleted': '' }, ...children)
            : h('button', { type: 'button', className: 'bpx-file', key: file.位置, onClick: () => open(file), title: 译('打开 {file}', { file: file.名字 }) }, ...children);
    };
    return h('section', { className: 'bpx-files', 'aria-label': 译('实时产物') },
        h('h3', {}, 译('实时产物'), data?.可用 ? h('span', {}, 译('{n} 个文件', { n: files.length })) : null),
        h('p', { className: 'bpx-caption' }, data?.可用 === false ? 译('实时文件暂不可读取，执行记录仍会更新。') : finished ? 译('这里是本次工作目录中的文件，交付结论见上方。') : 译('自动读取工作目录中的新建和改动文件，仍在制作，可能尚未写完整。')),
        sorted.length ? h('div', { className: 'bpx-file-list' }, sorted.slice(0, 6).map(row)) : data?.可用 ? h('p', { className: 'bpx-caption' }, 译('还没有检测到文件改动。')) : null,
        sorted.length > 6 ? h('details', { className: 'bpx-more-files' }, h('summary', {}, 译('其他文件改动（{n}）', { n: sorted.length - 6 })),
            h('div', { className: 'bpx-file-list' }, sorted.slice(6).map(row))) : null,
        error ? h('p', { className: 'bpx-error', role: 'alert' }, error) : null);
}

function BlueprintExternalRun({ node, ...actions }) {
    if (!node) return h('div', { className: 'bpx-page bpx-empty' }, 译('未选中节点'));
    return h(BlueprintExternalRunBody, { key: `${node.root}#${node.id}`, node, ...actions });
}

function BlueprintExternalRunBody({ node, onOpenParent, onOpenAgents, onOpenFile }) {
    const [data, setData] = react.useState(null), [error, setError] = react.useState(''), [refresh, setRefresh] = react.useState(0);
    use界面语言(react);
    react.useEffect(() => {
        if (!node?.root || node.id == null) return;
        const controller = new AbortController(); let timer;
        const load = async () => {
            let delay = 3000;
            try {
                const response = await fetch('/studio/api/external-run?' + new URLSearchParams({ session: node.root, id: node.id, 视图: '工作' }),
                    { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
                const body = await response.json();
                if (controller.signal.aborted) return;
                if (!response.ok || !body?.ok) throw new Error();
                setData(body.value); setError('');
                if (body.value.状态 === '完成') delay = 10000;
            } catch { if (controller.signal.aborted) return; setError(译('读取执行记录失败，请重试。')); delay = 5000; }
            timer = setTimeout(load, delay);
        };
        void load();
        return () => { controller.abort(); clearTimeout(timer); };
    }, [node.root, node.id, refresh]);
    if (!data) return h('div', { className: 'bpx-page bpx-empty', role: error ? 'alert' : 'status' }, error || 译('正在读取执行记录…'),
        error ? h('button', { type: 'button', onClick: () => setRefresh(value => value + 1) }, 译('重试')) : null);
    const overview = 外部run概况(data), stopped = overview.state === 'stop' ? 外部run停着(data) : null, quota = 额度文(data.额度), parent = data.母节点;
    const { current, earlier } = 外部run轮次(data);
    const task = current?.任务 || data.任务;
    const last = (current?.正文步骤 || current?.步骤 || []).at(-1);
    return h('div', { className: 'bpx-page' },
        h('div', { className: 'bpx-scroll' }, h('div', { className: 'bpx-content' },
            h('header', { className: 'bpx-overview' },
                h('div', { className: 'bpx-overline' }, h('span', { className: 'bpx-xtag' }, 外部run角标字(data)), h('span', {}, 译('任务与执行记录')),
                    h('button', { type: 'button', className: 'bpx-refresh', onClick: () => setRefresh(value => value + 1) }, 译('刷新'))),
                h('h2', { 'data-state': overview.state }, overview.label),
                data.用时 != null ? h('p', { className: 'bpx-caption' }, data.在跑 ? 译('已运行 {time}', { time: 时长文(data.用时) }) : 译('本次用时 {time}', { time: 时长文(data.用时) })) : null,
                data.state === 'retrying' ? h('p', { className: 'bpx-caption', role: 'status' }, 译('暂时连不上服务，系统稍后会自动再试。')) : null,
                data.在跑 && last && last.类 !== '说' ? h('p', { className: 'bpx-current-action' }, 译('最近动作：{action}', { action: String(last.文 || '').replace(/\s+/g, ' ').slice(0, 140) })) : null),
            stopped ? h('aside', { className: 'bpx-alert', role: 'alert' }, h('p', {}, stopped.文),
                stopped.去子Agent ? h('button', { type: 'button', onClick: onOpenAgents }, 译('打开「Agent 选择」页')) : null) : null,
            error ? h('p', { className: 'bpx-error', role: 'alert' }, error) : null,
            task?.目标 ? h('div', { className: 'bpx-task bpx-current-task' }, h('div', { className: 'bpx-message-label' }, current?.任务 ? 译('收到的任务') : 译('当前任务')),
                h(BlueprintNodeText, { source: task.目标 })) : null,
            data.交回 ? h('section', { className: 'bpx-handoff' }, h('div', { className: 'bpx-result-head' }, h('h3', {}, 译('交回结果')), h('span', {}, data.交回.结论)),
                data.交回.正文 ? h(BlueprintNodeText, { source: data.交回.正文 }) : null,
                data.交付异常?.版本未保存 ? h('p', { className: 'bpx-error' }, 译('产物版本未能保存，请回到派出节点确认交付状态。')) : null,
                data.交付异常?.合并未完成 ? h('p', { className: 'bpx-error' }, 译('文件合并未成功，当前仍可查看这个节点的文件；需要派出节点继续处理。')) : null,
                data.已验证 ? h('div', { className: 'bpx-verification' }, h('h4', {}, 译('已验证')), h(BlueprintNodeText, { source: data.已验证 })) : null,
                data.未验证 ? h('div', { className: 'bpx-verification' }, h('h4', {}, 译('尚未验证')), h(BlueprintNodeText, { source: data.未验证 })) : null) : null,
            data.问题 ? h('aside', { className: 'bpx-question' }, h('h3', {}, 译('需要决定')), h(BlueprintNodeText, { source: data.问题 })) : null,
            h(BlueprintExternalRunFiles, { data: data.实时产物, project: node.root, finished: data.状态 === '完成', onOpenFile }),
            current ? h(BlueprintExternalRunAttempt, { data: current, active: data.在跑 && current.次 === data.次, showTask: false }) : null,
            earlier.length ? h('details', { className: 'bpx-history' }, h('summary', {}, 译('之前的执行（{n} 次）', { n: earlier.length })),
                earlier.map(attempt => h(BlueprintExternalRunAttempt, { key: attempt.次, data: attempt }))) : null,
            h('details', { className: 'bpx-runtime' }, h('summary', {}, 译('运行详情')), h('p', {}, 外部run头(data)), quota ? h('p', {}, quota) : null))),
        h('footer', { className: 'bpx-foot' }, h('p', {}, 外部run底(data)),
            parent?.会话 ? h('button', { type: 'button', onClick: () => onOpenParent(parent) }, 译('向 {name} 补充要求', { name: parent.名字 })) : null));
}
