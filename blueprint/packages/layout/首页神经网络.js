// 首页背景：长在 32px 网格上的活的神经网络。神经元落在格线交点，轴突沿格线走；只是装饰，不读写任何项目数据。
// 一直在发生：神经元朝附近的神经元伸轴突（也从已有轴突半路分叉），接上后放电传信号；常用的连接变深，
// 不用就变淡、断开、缩回；神经元有寿命，空处不断冒出新的，扎成互不相连的小团。
// 节奏是 2026-10-23 在 草稿/首页分形/神经网络原型.html 里调定的：信号 13 格/秒、结构变化 ×10、整体时间 ×0.18（定稿后又整体慢一半）、
// 离散 85（定稿后从 75 调高）；下面的数已把这几个倍数折进去。墨色用原型最初的浓淡，整层 45% 不透明写在 项目入口.css。
// 省性能：最多 30 帧；首页隐藏、开场未播完或标签页切走时整段停下；每帧按浓淡分组一次描完；减少动态时只画一张静止帧。
function mountBlueprintHomeNetwork(canvas, { scroller = null, random = Math.random } = {}) {
    const G = 32, INK = '#1D232A', FPS = 30, TIME = .18, SIGNAL = 13;
    const P = {
        // cone：新连线往外长的速度（格/秒），定稿后按他要求降到原来 110 的 30%，免得看着像一道极快的信号
        density: 1 / 20.5, life: [3, 9], lonely: 1, refill: 5, sprout: 3.2, boot: 2, cone: 33, retract: 160, abort: 1,
        // 离散 85 折算：神经元更少、每个最多 2 条轴突、只连 7 格以内、几乎不跨远，团和团之间留出约 7 格空白
        density: 1 / 21.5, maxOut: 2, reachMin: 2, reach: 7, local: 1.47, far: .015, nearSpawn: .96, nearR: 2.15, seedGap: 7, collateral: .4,
        leak: .35, refractory: .3, tire: .3, rest: 2.5, spont: .22, targetRate: .5,
        w0: .6, wMax: 1.6, ltp: .1, ltd: .05, wDecay: .3, wCut: .18, coverTarget: .16, coverCap: .24, trail: 2.2,
    };
    const INKS = { axon: [.025, .17], glow: .22, soma: .3, flash: .55, ring: .26, cone: .42, spike: .62, trail: .3 };
    const AXON_MAX = INKS.axon[0] + INKS.axon[1] + INKS.glow, LEVELS = 12;
    const ctx = canvas.getContext('2d'), reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const buckets = Array.from({ length: LEVELS }, () => []);
    let W = 0, H = 0, NX = 0, NY = 0, cols = 0, rows = 0, segH, segV, somaAt, lit = 0, totalSeg = 1, sized = false;
    let neurons = [], axons = [], spikes = [], spawnQ = [], spawnAt = 0, uid = 0, t = 0, gain = 1.2, rate = 0, fires = 0;
    let active = false, disposed = false, raf = 0, last = 0, lastFrame = 0, resizeTimer = 0, stillDrawn = false;
    const I = (x, y) => y * NX + x, X = v => v * G + .5, cover = () => lit / totalSeg;

    function layout() {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return false;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        W = w; H = h; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cols = Math.ceil(W / G); rows = Math.ceil(H / G); NX = cols + 1; NY = rows + 1;
        segH = new Uint16Array(NX * NY); segV = new Uint16Array(NX * NY); somaAt = new Array(NX * NY).fill(null);
        totalSeg = cols * (rows + 1) + (cols + 1) * rows; lit = 0;
        neurons = []; axons = []; spikes = []; t = 0; gain = 1.2; rate = 0; stillDrawn = false;
        const n = Math.round(cols * rows * P.density);
        spawnQ = Array.from({ length: n }, (_, k) => .05 + k * (.9 / n)); spawnAt = 0;
        return sized = true;
    }

    // 一段格线被几条轴突用着；从 0 到 1 算点亮一段（总闸按点亮比例控制面积）
    function seg(x, y, dx, dy, d) {
        const arr = dx ? segH : segV, i = dx ? I(Math.min(x, x + dx), y) : I(x, Math.min(y, y + dy));
        const b = arr[i]; arr[i] += d;
        if (!b && arr[i]) lit++; else if (b && !arr[i]) lit--;
    }
    function segs(ax, d) { const p = ax.pts; for (let k = 0; k < ax.len; k++) seg(p[k][0], p[k][1], p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1], d); }

    // 多半冒在已有神经元旁边（团长大），少数冒在离别人远的空处（新的一团）
    function spawn() {
        let live = 0; for (const n of neurons) if (n.state === 'live') live++;
        const near = live > 6 && random() < P.nearSpawn;
        let parent = null;
        if (near) { let k = Math.floor(random() * live); for (const n of neurons) if (n.state === 'live' && k-- === 0) { parent = n; break; } }
        const R = near ? 3 : P.seedGap;
        let best = -1, bd = -1;
        for (let k = 0; k < 14; k++) {
            const x = near ? parent.x + Math.round((random() - .5) * 2 * P.nearR) : 1 + Math.floor(random() * (cols - 1));
            const y = near ? parent.y + Math.round((random() - .5) * 2 * P.nearR) : 1 + Math.floor(random() * (rows - 1));
            if (x < 1 || y < 1 || x >= cols || y >= rows || somaAt[I(x, y)]) continue;
            let d = R + 1;
            for (let yy = Math.max(0, y - R); yy <= Math.min(NY - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(NX - 1, x + R); xx++)
                if (somaAt[I(xx, yy)]) d = Math.min(d, Math.max(Math.abs(xx - x), Math.abs(yy - y)));
            if (d > bd) { bd = d; best = I(x, y); }
        }
        if (best < 0 || bd < 2) return;
        const n = { x: best % NX, y: (best / NX) | 0, v: 0, th: 1, lastFire: -1e9, flash: 0, alpha: 0, act: 0, state: 'live',
            life: P.life[0] + random() * (P.life[1] - P.life[0]), age: 0, lonely: 0, out: [], in: [], growing: null };
        somaAt[best] = n; neurons.push(n);
    }
    function kill(n) {
        if (n.state !== 'live') return; n.state = 'dying';
        for (const ax of n.out) retract(ax);
        for (const ax of n.in.slice()) retract(ax);
    }

    // 沿格线的楼梯形路线：横竖交替、最多拐两次，三条里挑穿过别的神经元最少的
    function split(n, m) { if (!n) return []; m = Math.max(1, Math.min(m, n)); const p = new Array(m).fill(1); for (let k = m; k < n; k++) p[Math.floor(random() * m)]++; return p; }
    function stair(x0, y0, x1, y1) {
        const nx = Math.abs(x1 - x0), ny = Math.abs(y1 - y0), sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
        let best = null, bs = 1e9;
        for (let tr = 0; tr < 3; tr++) {
            const T = 1 + Math.floor(random() * 2);
            let a = Math.ceil((T + 1) / 2), b = Math.floor((T + 1) / 2);
            if (random() < .5) [a, b] = [b, a];
            a = nx ? Math.max(1, Math.min(a, nx)) : 0; b = ny ? Math.max(1, Math.min(b, ny)) : 0;
            while (a > b + 1 && b) a--; while (b > a + 1 && a) b--;
            const hr = split(nx, a), vr = split(ny, b), pts = [];
            let cur = hr.length > vr.length ? 'h' : vr.length > hr.length ? 'v' : (random() < .5 ? 'h' : 'v'), x = x0, y = y0, hi = 0, vi = 0;
            while (hi < hr.length || vi < vr.length) {
                if ((cur === 'h' && hi < hr.length) || vi >= vr.length) { for (let k = 0; k < hr[hi]; k++) { x += sx; pts.push([x, y]); } hi++; cur = 'v'; }
                else { for (let k = 0; k < vr[vi]; k++) { y += sy; pts.push([x, y]); } vi++; cur = 'h'; }
            }
            let s = random() * .5; for (let k = 0; k < pts.length - 1; k++) if (somaAt[I(pts[k][0], pts[k][1])]) s += 1;
            if (s < bs) { bs = s; best = pts; }
        }
        return best;
    }
    function turnsOf(pts) {
        const tr = [];
        for (let k = 1; k < pts.length - 1; k++) if (pts[k][0] - pts[k - 1][0] !== pts[k + 1][0] - pts[k][0] || pts[k][1] - pts[k - 1][1] !== pts[k + 1][1] - pts[k][1]) tr.push(k);
        return tr;
    }

    // 伸出：朝附近（越活跃越容易被选中）的神经元长一条轴突，或从自己已有的轴突半路分叉
    function sprout(n) {
        if (n.growing) return;
        let own = 0, trunks = 0;
        for (const a of n.out) { if (a.state !== 'retract') own++; if (a.state === 'live' && a.len >= 3) trunks++; }
        if (own >= P.maxOut) return;
        let prefix = [[n.x, n.y]], k0 = 0;
        if (trunks && random() < P.collateral) {
            let k = Math.floor(random() * trunks), p = null;
            for (const a of n.out) if (a.state === 'live' && a.len >= 3 && k-- === 0) { p = a; break; }
            k0 = 1 + Math.floor(random() * (p.len - 2)); prefix = p.pts.slice(0, k0 + 1);
        }
        const [sx, sy] = prefix[prefix.length - 1], R = P.reach, far = random() < P.far, cands = [];
        let sum = 0;
        for (let y = Math.max(0, sy - R); y <= Math.min(NY - 1, sy + R); y++) for (let x = Math.max(0, sx - R); x <= Math.min(NX - 1, sx + R); x++) {
            const m = somaAt[I(x, y)]; if (!m || m === n || m.state !== 'live') continue;
            const d = Math.abs(x - sx) + Math.abs(y - sy); if (d < P.reachMin || d > R) continue;
            if (n.out.some(a => a.b === m && a.state !== 'retract')) continue;
            const w = (.25 + m.act) * (far ? 1 : Math.exp(-(d - P.reachMin) / P.local)); cands.push(m, w); sum += w;
        }
        if (!cands.length) return;
        let r = random() * sum, m = cands[0];
        for (let k = 0; k < cands.length; k += 2) { r -= cands[k + 1]; if (r <= 0) { m = cands[k]; break; } }
        const pts = prefix.concat(stair(sx, sy, m.x, m.y));
        const ax = { a: n, b: m, pts, len: pts.length - 1, turns: turnsOf(pts), prog: k0, state: 'grow', w: P.w0 * (.75 + .5 * random()), fade: .6 + .8 * random(), glow: 0, load: 0 };
        segs(ax, 1); axons.push(ax); n.out.push(ax); n.growing = ax;
    }
    function retract(ax) {
        if (ax.state === 'retract') return;
        if (ax.state === 'grow') ax.a.growing = null;
        if (ax.state === 'live') ax.b.in = ax.b.in.filter(a => a !== ax);
        ax.state = 'retract';
    }

    // 放电与传递：信号到了给对方充电，攒够就亮；每亮一次会累一会儿，活动不会整片爆发
    function fire(n) {
        n.lastFire = t; n.flash = 1; n.v = 0; n.th += P.tire; n.act = Math.min(2, n.act + .3); fires++;
        for (const ax of n.out) if (ax.state === 'live') { spikes.push({ ax, s: 0 }); ax.load++; }
    }
    function deliver(ax) {
        const b = ax.b; if (b.state !== 'live') return;
        if (t - b.lastFire < P.refractory) { ax.w = Math.max(0, ax.w - P.ltd); return; }
        b.v += ax.w * gain; ax.glow = Math.max(ax.glow, .5);
        if (b.v >= b.th) { ax.w = Math.min(P.wMax, ax.w + P.ltp); ax.glow = 1; fire(b); }
    }

    function step(dt) {
        t += dt; const f0 = fires;
        while (spawnAt < spawnQ.length && spawnQ[spawnAt] <= t) { spawnAt++; spawn(); }
        let live = 0; for (const n of neurons) if (n.state === 'live') live++;
        const target = Math.round(cols * rows * P.density), booting = spawnAt < spawnQ.length;
        if (!booting && live < target) for (let k = 0, n = (target - live) * P.refill * dt; k < n; k++) if (k + 1 <= n || random() < n - k) spawn();
        // 接近面积上限时少伸、多修剪，但不停下
        const c = cover(), over = Math.max(0, (c - P.coverTarget) / (P.coverCap - P.coverTarget));
        const brake = c >= P.coverCap ? 0 : 1 - .7 * Math.min(1, over), decay = P.wDecay * (1 + 4 * Math.min(1.5, over));
        const boost = t < P.boot ? 3 : 1, leakK = Math.exp(-dt / P.leak), flashK = Math.exp(-dt * 4), actK = Math.exp(-dt / 3), restK = Math.exp(-dt / P.rest);
        let keep = 0;
        for (const n of neurons) {
            n.flash *= flashK; n.act *= actK; n.th = 1 + (n.th - 1) * restK;
            if (n.state === 'live') {
                n.alpha = Math.min(1, n.alpha + dt / .35); n.v *= leakK;
                if (random() < P.spont * dt && t - n.lastFire > P.refractory) fire(n);
                const conn = n.out.length + n.in.length;
                if (random() < P.sprout * dt * brake * boost * (.6 + n.act) * (conn < 2 ? 1.6 : 1)) sprout(n);
                n.age += dt; n.lonely = conn ? 0 : n.lonely + dt;
                if (n.age > n.life || n.lonely > P.lonely) kill(n);
            } else if ((n.alpha -= dt / .5) <= 0 && !n.out.length) { somaAt[I(n.x, n.y)] = null; continue; }
            neurons[keep++] = n;
        }
        neurons.length = keep;
        const glowK = Math.exp(-dt * 5);
        keep = 0;
        for (const ax of axons) {
            ax.glow *= glowK;
            if (ax.state === 'grow') {
                if (ax.b.state !== 'live' || random() < P.abort * dt) retract(ax);
                else if ((ax.prog += P.cone * dt) >= ax.len) { ax.prog = ax.len; ax.state = 'live'; ax.a.growing = null; ax.b.in.push(ax); ax.glow = 1; ax.b.flash = Math.max(ax.b.flash, .45); }
            } else if (ax.state === 'live') {
                // 线上有信号在走时先不修剪，等信号到了再断
                if ((ax.w -= decay * ax.fade * dt) < P.wCut && !ax.load) retract(ax);
            } else if ((ax.prog -= P.retract * dt) <= 0) {
                segs(ax, -1); const out = ax.a.out, i = out.indexOf(ax); if (i >= 0) out.splice(i, 1);
                continue;
            }
            axons[keep++] = ax;
        }
        axons.length = keep;
        keep = 0;
        for (const sp of spikes) {
            if (sp.ax.state !== 'live') { sp.ax.load--; continue; }
            if ((sp.s += SIGNAL * dt) >= sp.ax.len) { sp.ax.load--; deliver(sp.ax); continue; }
            spikes[keep++] = sp;
        }
        spikes.length = keep;
        if (dt > 0) {
            rate += ((fires - f0) / dt / Math.max(1, live) - rate) * Math.min(1, dt / 3);
            gain = Math.max(.9, Math.min(2.6, gain * Math.exp((P.targetRate - rate) / P.targetRate * .3 * dt)));
        }
    }

    function pointAt(ax, s) {
        s = Math.max(0, Math.min(ax.len, s));
        const k = Math.min(ax.len - 1, Math.floor(s)), u = s - k, p = ax.pts[k], q = ax.pts[k + 1];
        return [X(p[0] + (q[0] - p[0]) * u), X(p[1] + (q[1] - p[1]) * u)];
    }
    function range(ax, s0, s1) {
        if (s1 - s0 < .01) return;
        let [x, y] = pointAt(ax, s0); ctx.moveTo(x, y);
        for (const k of ax.turns) if (k > s0 && k < s1) ctx.lineTo(X(ax.pts[k][0]), X(ax.pts[k][1]));
        [x, y] = pointAt(ax, s1); ctx.lineTo(x, y);
    }
    function draw() {
        ctx.clearRect(0, 0, W, H);
        ctx.lineWidth = 1; ctx.strokeStyle = INK; ctx.fillStyle = INK;
        // 连线按浓淡分 12 组，每组一次描完
        for (const list of buckets) list.length = 0;
        for (const ax of axons) {
            if (ax.prog <= .01) continue;
            const a = (INKS.axon[0] + INKS.axon[1] * Math.min(1, ax.w / 1.2) + INKS.glow * ax.glow) * Math.min(1, ax.a.alpha + .2);
            buckets[Math.min(LEVELS - 1, Math.round(a / AXON_MAX * (LEVELS - 1)))].push(ax);
        }
        for (let b = 1; b < LEVELS; b++) {
            if (!buckets[b].length) continue;
            ctx.globalAlpha = b / (LEVELS - 1) * AXON_MAX; ctx.beginPath();
            for (const ax of buckets[b]) range(ax, 0, ax.prog);
            ctx.stroke();
        }
        ctx.globalAlpha = INKS.cone; ctx.beginPath();
        for (const ax of axons) if (ax.state === 'grow') { const [x, y] = pointAt(ax, ax.prog); ctx.rect(x - 1.5, y - 1.5, 3, 3); }
        ctx.fill();
        ctx.globalAlpha = INKS.trail; ctx.beginPath();
        for (const sp of spikes) range(sp.ax, Math.max(0, sp.s - P.trail), sp.s);
        ctx.stroke();
        ctx.globalAlpha = INKS.spike; ctx.beginPath();
        for (const sp of spikes) { const [x, y] = pointAt(sp.ax, sp.s); ctx.rect(x - 1.5, y - 1.5, 3, 3); }
        ctx.fill();
        // 静着的神经元一次画完，正在亮或出生／消失中的单独画
        ctx.globalAlpha = INKS.soma; ctx.beginPath();
        for (const n of neurons) if (n.flash < .05 && n.alpha >= 1) { const s = n.out.length + n.in.length >= 5 ? 5 : 3; ctx.rect(X(n.x) - s / 2, X(n.y) - s / 2, s, s); }
        ctx.fill();
        for (const n of neurons) {
            const a = n.alpha, f = n.flash; if ((f < .05 && a >= 1) || a < .01) continue;
            const cx = X(n.x), cy = X(n.y), s = n.out.length + n.in.length >= 5 ? 5 : 3;
            ctx.globalAlpha = (INKS.soma + INKS.flash * f) * a; ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
            if (f > .05) { const side = 5 + 14 * (1 - f); ctx.globalAlpha = INKS.ring * f * a; ctx.strokeRect(cx - side / 2, cy - side / 2, side, side); }
        }
        ctx.globalAlpha = 1;
    }

    function frame(now) {
        raf = 0;
        if (!active || disposed || document.hidden) { last = 0; return; }
        raf = requestAnimationFrame(frame);
        if (now - lastFrame < 1000 / FPS - 2) return;
        const real = last ? Math.min(.1, (now - last) / 1000) : 0; last = lastFrame = now;
        if (real > 0) step(real * TIME);
        draw();
    }
    // 减少动态：快进一段画一张静止帧，不跑循环
    function still() {
        if (stillDrawn || (!sized && !layout())) return;
        for (let k = 0; k < 300; k++) step(1 / 30);
        draw(); stillDrawn = true;
    }
    function resume() {
        if (!active || disposed || document.hidden || raf) return;
        if (!sized && !layout()) return;
        if (reduced?.matches) { still(); return; }
        last = 0; raf = requestAnimationFrame(frame);
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; last = 0; }
    // 首页在小窗口里滚动时，网格背景不跟着滚；画布反向平移，和网格对齐
    function follow() { canvas.style.transform = scroller && (scroller.scrollTop || scroller.scrollLeft) ? `translate(${scroller.scrollLeft}px,${scroller.scrollTop}px)` : ''; }
    function visibility() { if (document.hidden) stop(); else resume(); }
    function motion() { stop(); stillDrawn = false; resume(); }
    // 窗口改大小才重新铺；首页暂时隐藏（尺寸变 0）时保留原样，回来接着跑
    const observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const w = canvas.clientWidth, h = canvas.clientHeight;
            if (disposed || !w || !h || (sized && w === W && h === H)) return;
            sized = false; stop(); if (active) resume();
        }, 200);
    });
    observer.observe(canvas);
    document.addEventListener('visibilitychange', visibility);
    reduced?.addEventListener?.('change', motion);
    scroller?.addEventListener('scroll', follow, { passive: true });
    return {
        setActive(value) { active = !!value; if (active) resume(); else stop(); },
        // 在目标框里打字：点亮离那一点最近的几个神经元
        stimulate(clientX, clientY, count = 3) {
            if (!active || !sized || reduced?.matches) return;
            const r = canvas.getBoundingClientRect(), gx = (clientX - r.left) / G, gy = (clientY - r.top) / G;
            neurons.filter(n => n.state === 'live' && t - n.lastFire > P.refractory)
                .sort((a, b) => Math.hypot(a.x - gx, a.y - gy) - Math.hypot(b.x - gx, b.y - gy)).slice(0, count).forEach(fire);
        },
        // 测试与静止帧用：不经浏览器帧，直接按模拟时间推进
        advance(seconds) { if (!sized && !layout()) return; for (let k = 0, n = Math.round(seconds * 30); k < n; k++) step(1 / 30); draw(); },
        stats() { return { neurons: neurons.length, links: axons.filter(a => a.state === 'live').length, spikes: spikes.length, cover: cover(), running: !!raf }; },
        dispose() {
            disposed = true; stop(); clearTimeout(resizeTimer); observer.disconnect();
            document.removeEventListener('visibilitychange', visibility);
            reduced?.removeEventListener?.('change', motion);
            scroller?.removeEventListener('scroll', follow);
        },
    };
}
