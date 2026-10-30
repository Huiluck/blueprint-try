import { 译 } from '../../../viewer/界面语言.js';
// 请求事实来自项目的待回答.json，经已有 Studio SSE 恢复；浏览器只保存填写草稿。
function BlueprintPlanReview(questions) {
    if (questions.length !== 1) return;
    const q = questions[0], options = q.options || [];
    if (q.intent?.kind !== 'plan-review' || typeof q.detail !== 'string' || q.multiSelect || options.length > 2) return;
    const approve = options.find(option => option.label === q.intent.approve);
    if (!approve) return;
    return { id: q.id, question: q.question, plan: q.detail, approve, decline: options.find(option => option !== approve) };
}
// 长问题的完整原文放进同一个可滚动正文，标题使用提问者已有的简短 header。
export function 问题展示(questions) {
    return questions.map(question => question.intent?.kind !== 'plan-review' && question.header && question.question.length > 100
        ? { ...question, header: undefined, question: question.header,
            detail: question.question + (question.detail ? '\n\n' + question.detail : '') }
        : question);
}
export function 创建恢复问题(frame, send, liveKeys) {
    const listeners = new Set();
    let closed = false, sending;
    let snapshot = Object.freeze({ state: 'open', waitState: 'waiting', channel: 'rpc', closed: false, countdown: undefined });
    const question = {
        blueprintPersistent: true,
        key: 'blueprint-question:' + frame.session + ':' + frame.rpcId,
        sessionId: frame.session,
        questions: frame.questions,
        kind: BlueprintPlanReview(frame.questions) ? 'plan-review' : 'question',
        dismissal: 'hide',
        liveKeys,
        snapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        getSnapshot: () => snapshot,
        // 原生通用问卷仍拥有聚焦、分页与草稿；持久请求没有前台倒计时。
        takeTime() {}, engage() {}, holdFocus() {}, releaseFocus() {},
        dismiss: () => Promise.resolve(),
        answer(answer) {
            if (closed) return Promise.reject(new Error(译('这条问题已经处理，请刷新后查看结果。')));
            if (sending) return sending;
            sending = Promise.resolve().then(() => send(frame.rpcId, answer)).finally(() => { sending = undefined; });
            return sending;
        },
        close() {
            if (closed) return;
            closed = true; snapshot = Object.freeze({ ...snapshot, closed: true, channel: 'none' });
            for (const listener of listeners) listener();
        },
    };
    return question;
}

// 原生选项、分页和草稿不动，材料区跟随当前问题，覆盖实时卡与持久恢复卡。
function BlueprintQuestionMaterialLinks({ pending, useStore }) {
    const anchor = react.useRef(null);
    const stored = useStore(state => state.progressByRequest[pending.key]);
    const index = Number.isInteger(stored?.index) && stored.index >= 0 && stored.index < pending.questions.length ? stored.index : 0;
    const question = pending.questions[index], signature = JSON.stringify(question);
    react.useEffect(() => 挂问题材料(anchor.current?.closest('.bp-review-document') || anchor.current?.parentElement,
        { session: pending.sessionId, question }), [pending.key, pending.sessionId, signature]);
    return h('span', { ref: anchor, hidden: true });
}

function BlueprintPlanCard({ pending, useStore, actions }) {
    const review = BlueprintPlanReview(pending.questions);
    const stored = useStore(state => state.progressByRequest[pending.key]);
    const draft = stored || {};
    const anchor = react.useRef(null), reader = react.useRef(null), draftRef = react.useRef(draft);
    draftRef.current = draft;
    const [target, setTarget] = react.useState(null);
    const [busy, setBusy] = react.useState(false), [error, setError] = react.useState('');
    const save = patch => actions.replace(pending.key, { ...draftRef.current, ...patch });
    react.useLayoutEffect(() => { setTarget(anchor.current?.closest('.bp-chat-body') || null); }, [pending.key]);
    const fullpage = !!draft.expanded && !!target;
    react.useLayoutEffect(() => {
        if (!fullpage) return;
        reader.current?.focus({ preventScroll: true });
        return () => {
            const button = anchor.current?.querySelector('.bp-review-preview');
            if (button?.offsetParent) button.focus({ preventScroll: true });
        };
    }, [fullpage]);
    const decide = async (option, custom) => {
        if (busy) return;
        setBusy(true); setError('');
        try {
            await pending.answer({ answers: [{ id: review.id, selected: [option.label], ...(custom ? { custom } : {}) }] });
            actions.clear(pending.key);
        } catch (cause) { setError(cause.message || String(cause)); setBusy(false); }
    };
    const title = review.plan.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '') || 译('方案审核');
    const MarkdownText = require('@deepseek-ai/dsh-client-ui-primitives').MarkdownText;
    const card = expanded => h('section', { className: 'bp-review-card' + (expanded ? ' is-expanded' : ''),
        'aria-label': review.question, 'aria-busy': busy },
            h('header', { className: 'bp-review-head' }, h('span', { className: 'bp-review-status' }, 译('方案待审')),
                h('button', { type: 'button', className: 'bp-review-preview' + (expanded ? ' bp-review-back' : ''), 'aria-expanded': expanded,
                    'aria-label': expanded ? 译('返回对话') : undefined, title: expanded ? 译('返回对话') : undefined,
                    onClick: () => save({ expanded: !expanded }) }, expanded ? h('svg', {
                        width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
                        strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true
                    }, h('path', { d: 'm12 5-7 7 7 7M5 12h14' })) : 译('查看全文 ＋'))),
            h('div', { className: 'bp-review-summary' }, h('h3', null, title), h('p', null, review.question)),
            expanded ? h('div', { className: 'bp-review-document', role: 'region', tabIndex: 0, 'aria-label': 译('完整方案') }, h(MarkdownText, { text: review.plan }), h(BlueprintQuestionMaterialLinks, { pending, useStore })) : null,
            draft.editing ? h('div', { className: 'bp-review-feedback' },
                h('label', { htmlFor: pending.key + (expanded ? ':feedback-fullpage' : ':feedback-card') }, 译('修改意见')),
                h('textarea', { id: pending.key + (expanded ? ':feedback-fullpage' : ':feedback-card'), rows: 3, value: draft.feedback || '', disabled: busy,
                    placeholder: 译('说明你希望调整的地方'), onChange: event => save({ feedback: event.target.value }) })) : null,
            error ? h('div', { className: 'bp-review-error', role: 'alert' }, error) : null,
            h('footer', { className: 'bp-review-footer' },
                h('span', { className: 'bp-review-note' }, draft.editing ? 译('意见随本版方案一起送回') : 译('确认后按此方案继续')),
                h('div', { className: 'bp-review-actions' },
                    draft.editing ? h(react.Fragment, null,
                        h('button', { type: 'button', disabled: busy, onClick: () => save({ editing: false }) }, 译('返回')),
                        h('button', { type: 'button', className: 'bp-review-primary', disabled: busy || !draft.feedback?.trim(),
                            onClick: () => decide(review.decline, draft.feedback.trim()) }, busy ? 译('正在提交…') : 译('提交修改意见')))
                        : h(react.Fragment, null,
                            review.decline ? h('button', { type: 'button', disabled: busy, onClick: () => save({ editing: true }) }, 译('要求修改')) : null,
                            h('button', { type: 'button', className: 'bp-review-primary', disabled: busy,
                                onClick: () => decide(review.approve) }, busy ? 译('正在提交…') : 译('同意执行'))))));
    // 保留紧凑卡的占位和原生对话挂载，返回时不改变对话滚动与阅读位置。
    return h(react.Fragment, null,
        h('div', { ref: anchor, className: 'bp-review-frame', 'data-bp-persistent-question': pending.key,
            'aria-hidden': fullpage || undefined, inert: fullpage ? '' : undefined }, card(!!draft.expanded && !target)),
        fullpage ? require('react-dom').createPortal(
            h('div', { ref: reader, className: 'bp-review-fullpage', role: 'region', tabIndex: -1, 'aria-label': 译('完整方案审核'),
                onKeyDown: event => {
                    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent?.isComposing) return;
                    event.preventDefault(); event.stopPropagation(); save({ expanded: false });
                } }, card(true)), target) : null);
}

function 注册持久问题(ctx) {
    ctx.inject(['blueprintQuestions', 'uiSession'], scope => {
        const source = scope.get('blueprintQuestions'), cards = new Map();
        // 保留原生计划／普通问题的先后关系，恢复件略高于同类，避免重复卡片。
        const publish = scope.get('uiSession').registerPendingInteraction(pending => pending.kind === 'plan-review' ? 2.1 : 1.1);
        const send = async (rpcId, answer) => {
            const response = await fetch('/studio/api/rpc', { method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'respond', rpcId, value: { answer } }) });
            if (!response.ok) throw new Error(译('回答未送达（HTTP {status}），请重试。', { status: response.status }));
            const result = await response.json();
            if (!result.ok) throw new Error(result.message || 译('回答未送达，请重试。'));
        };
        scope.effect(() => {
            const sync = () => {
                const frames = source.getSnapshot();
                for (const [id, frame] of frames) if (!cards.has(id)) {
                    const pending = 创建恢复问题(frame, send, () => [...cards.values()].map(card => card.pending.key));
                    cards.set(id, { pending, release: publish(pending, () => {}) });
                }
                for (const [id, card] of cards) if (!frames.has(id)) {
                    card.pending.close(); card.release(); cards.delete(id);
                }
            };
            const off = source.subscribe(sync); sync();
            return () => { off(); for (const card of cards.values()) card.release(); cards.clear(); };
        });
        // 沿原生问卷的 owner、子槽、草稿 store 和选项交互，仅扩展选举与恢复载体。
        scope.effect(() => {
            let current, original, select, decorated, choose;
            const restore = () => {
                if (current && current.component === decorated) current.component = original;
                if (current && current.select === choose) current.select = select;
            };
            const sync = () => {
                const entry = scope.slots.entries('conversation.composer').find(item => item.locale === 'question');
                if (entry === current) return;
                restore(); current = entry; if (!entry) return;
                original = entry.component; select = entry.select;
                const NativeQuestion = original, nativeSelect = select;
                choose = owner => owner.pendingInteraction?.blueprintPersistent ? owner.pendingInteraction : nativeSelect(owner);
                decorated = function BlueprintQuestionComposer(props) {
                    const pending = props.matched;
                    const progress = props.useStore(state => state.progressByRequest);
                    // 原生卡可能早于 SSE 补发挂载；它的草稿清理也须保留持久问题的稳定键。
                    const actions = { ...props.actions, prune(keep) {
                        props.actions.prune([...new Set([...keep, ...Object.keys(progress).filter(key => key.startsWith('blueprint-question:'))])]);
                    } };
                    if (!pending?.blueprintPersistent) return Array.isArray(pending?.questions) && pending.kind !== 'plan-review'
                        ? h('div', { className: 'bp-question-persistent' }, h(NativeQuestion, { ...props, actions }), h(BlueprintQuestionMaterialLinks, { pending, useStore: props.useStore }))
                        : h(NativeQuestion, { ...props, actions });
                    const useQuestionCard = (_key, selection) => selection(react.useSyncExternalStore(pending.subscribe, pending.snapshot));
                    // 草稿只在明确答复后清理，不以当前卡片集合删除其他项目或原生问题的输入。
                    actions.prune = () => {};
                    return pending.kind === 'plan-review' ? h(BlueprintPlanCard, { ...props, pending, actions })
                        : h('div', { className: 'bp-question-persistent', 'data-bp-persistent-question': pending.key },
                            h(NativeQuestion, { ...props, matched: { ...pending, questions: 问题展示(pending.questions) }, useQuestionCard, actions }),
                            h(BlueprintQuestionMaterialLinks, { pending, useStore: props.useStore }));
                };
                entry.component = decorated; entry.select = choose;
            };
            const off = scope.slots.subscribe('conversation.composer', sync); sync();
            return () => { off(); restore(); };
        });
    });
}
