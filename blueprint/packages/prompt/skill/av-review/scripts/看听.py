#!/usr/bin/env python3
"""看听：把一段录屏或音频看一遍、听一遍，做成带时刻的卡片；之后按卡片回答问题。

只用 Python 标准库和 ffmpeg／ffprobe（联系表上的时间码用 ImageMagick，没有就不标）。
画面交给 DeepSeek（DEEPSEEK_API_KEY），声音交给 MiMo（MIMO_API_KEY）；响度、峰值、静音、削波由本地量。

  python3 看听.py 索引 <文件> [--重建] [--每秒 N]
  python3 看听.py 问   <文件> "<问题>" [--看图 N]
  python3 看听.py 细看 <文件> <秒> ["<问题>"]
  python3 看听.py 帧   <文件> <秒>
  python3 看听.py 片段 <文件> <起秒>-<止秒>
"""
import argparse, array, base64, hashlib, json, math, os, re, shutil, subprocess, sys, time, urllib.error, urllib.request, wave

DEEPSEEK = os.environ.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').rstrip('/') + '/chat/completions'
DEEPSEEK_MODEL = os.environ.get('AV_REVIEW_VISION_MODEL', 'deepseek-v4-flash')
MIMO = os.environ.get('MIMO_BASE_URL', 'https://api.xiaomimimo.com/v1').rstrip('/') + '/chat/completions'
MIMO_MODEL = os.environ.get('AV_REVIEW_AUDIO_MODEL', 'mimo-v2.6-flash')
每批 = 10          # 一次交给模型的帧数
声音段长 = 10.0     # 一次交给 MiMo 的秒数
用量 = {'画面': 0, '声音': 0, '调用': 0}


# ---------- 小工具 ----------

def 跑(argv, 要输出=False):
    r = subprocess.run(argv, capture_output=True, text=True)
    if r.returncode != 0 and not 要输出:
        raise SystemExit(f'命令失败：{" ".join(argv[:3])}…\n{r.stderr[-800:]}')
    return r.stdout + r.stderr


def 时刻(t):
    t = max(0.0, float(t))
    return f'{int(t // 60):02d}:{t % 60:04.1f}'


def 指纹(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()[:16]


def 索引夹(path):
    基 = os.environ.get('TMPDIR') or os.path.join(os.path.dirname(os.path.abspath(path)), '.看听')
    return os.path.join(基, '看听索引', 指纹(path))


def 读媒体(path):
    out = 跑(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height',
              '-of', 'json', path])
    d = json.loads(out[out.index('{'):])
    流 = d.get('streams', [])
    return {'时长': float(d['format'].get('duration') or 0),
            '有画面': any(s.get('codec_type') == 'video' for s in 流),
            '有声音': any(s.get('codec_type') == 'audio' for s in 流)}


def 图(path):
    with open(path, 'rb') as f:
        return {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + base64.b64encode(f.read()).decode()}}


def 问模型(url, key_env, model, content, 想=False, 最多=4000, 类='画面'):
    key = os.environ.get(key_env)
    if not key:
        raise SystemExit(f'没有 {key_env}：这一步要用它调模型。')
    body = {'model': model, 'max_tokens': 最多, 'messages': [{'role': 'user', 'content': content}]}
    if not 想:
        body['thinking'] = {'type': 'disabled'}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    for 次 in range(3):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=180))
            用量[类] += (r.get('usage') or {}).get('total_tokens', 0)
            用量['调用'] += 1
            return (r['choices'][0]['message'].get('content') or '').strip()
        except urllib.error.HTTPError as e:
            msg = e.read()[:300].decode('utf8', 'ignore')
            if e.code in (429, 500, 502, 503) and 次 < 2:
                time.sleep(3 * (次 + 1)); continue
            raise SystemExit(f'{model} 调用失败 HTTP {e.code}：{msg}')
        except (urllib.error.URLError, TimeoutError) as e:
            if 次 < 2:
                time.sleep(3); continue
            raise SystemExit(f'{model} 连不上：{e}')


def 取JSON(text):
    text = re.sub(r'^```(?:json)?|```$', '', text.strip(), flags=re.M).strip()
    # 先试最外层那一种括号：对象里套着数组时，不能先抓到里面的数组。
    次序 = sorted((('[', ']'), ('{', '}')), key=lambda p: text.find(p[0]) if text.find(p[0]) >= 0 else len(text))
    for 开, 合 in 次序:
        i, j = text.find(开), text.rfind(合)
        if i >= 0 and j > i:
            try:
                return json.loads(text[i:j + 1])
            except json.JSONDecodeError:
                pass
    return None


# ---------- 画面 ----------

def 抽帧(path, 夹, 每秒):
    帧夹 = os.path.join(夹, '帧')
    os.makedirs(帧夹, exist_ok=True)
    跑(['ffmpeg', '-v', 'error', '-y', '-i', path, '-vf', f'fps={每秒},scale=512:-2', '-q:v', '5',
        os.path.join(帧夹, '%05d.jpg')])
    文件们 = sorted(f for f in os.listdir(帧夹) if f.endswith('.jpg'))
    # fps 滤镜取的是每个间隔的起点附近：第 i 张记作 i/每秒 秒。
    return [{'t': round(i / 每秒, 2), '图': os.path.join(帧夹, f)} for i, f in enumerate(文件们)]


def 镜头切换(path):
    out = 跑(['ffmpeg', '-v', 'info', '-i', path, '-vf', "select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], 要输出=True)
    return [round(float(m), 2) for m in re.findall(r'pts_time:([0-9.]+)', out)]


def 联系表(帧们, 出):
    magick = shutil.which('magick')
    # ImageMagick 写字要一个字体文件；不指定时常找不到默认字体。
    字体 = next((f for f in ('/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Menlo.ttc',
                             '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf') if os.path.exists(f)), None)
    if magick:
        argv = [magick, 'montage'] + (['-font', 字体] if 字体 else [])
        for f in 帧们:
            argv += ['-label', 时刻(f['t']), f['图']]
        argv += ['-tile', '6x', '-geometry', '256x+4+4', '-pointsize', '16', '-background', '#222', '-fill', 'white', 出]
        if subprocess.run(argv, capture_output=True).returncode == 0:
            return 出
    # 没有 ImageMagick：按顺序拼，时间码靠「第 n 格＝第 n 个采样点」对。
    列表 = os.path.join(os.path.dirname(出), '帧列表.txt')
    with open(列表, 'w') as f:
        for x in 帧们:
            f.write(f"file '{x['图']}'\n")
    行 = math.ceil(len(帧们) / 6)
    跑(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 列表, '-vf', f'scale=256:-2,tile=6x{行}', '-frames:v', '1', 出])
    return 出


画面提示 = """这是同一段视频按时间顺序抽出的 {n} 帧，每帧前面写着它在视频里的时刻。请逐帧写一张卡片，只写看得见的，不猜画外的事。
只回一个 JSON 数组，每帧一项，字段：
- t：这一帧的秒数（照抄前面写的）
- 画面：一句话，画面里有什么、在哪、什么状态
- 事件：和上一帧比，发生了什么变化；没有变化写 ""
- 文字：画面里看得见的字（字幕、界面、招牌），没有写 ""
- 运动：静、小、中、大 之一（和上一帧比，画面变化多大）"""


def 写画面卡片(帧们):
    卡片们, 上一句 = [], ''
    for i in range(0, len(帧们), 每批):
        批 = 帧们[i:i + 每批]
        content = [{'type': 'text', 'text': 画面提示.format(n=len(批)) + (f'\n\n上一批最后一帧：{上一句}' if 上一句 else '')}]
        for f in 批:
            content += [{'type': 'text', 'text': f"[{f['t']} 秒]"}, 图(f['图'])]
        回 = 取JSON(问模型(DEEPSEEK, 'DEEPSEEK_API_KEY', DEEPSEEK_MODEL, content))
        回 = 回 if isinstance(回, list) else []
        按秒 = {round(float(x.get('t', -1)), 2): x for x in 回 if isinstance(x, dict) and str(x.get('t', '')).replace('.', '', 1).isdigit()}
        for k, f in enumerate(批):
            x = 按秒.get(f['t']) or (回[k] if k < len(回) and isinstance(回[k], dict) else {})
            卡 = {'t': f['t'], '画面': str(x.get('画面', '')), '事件': str(x.get('事件', '')),
                  '文字': str(x.get('文字', '')), '运动': str(x.get('运动', '')), '图': f['图']}
            卡片们.append(卡)
        if 卡片们:
            上一句 = 卡片们[-1]['画面']
    return 卡片们


# ---------- 声音 ----------

def 抽声音(path, 夹):
    出 = os.path.join(夹, '声音.wav')
    跑(['ffmpeg', '-v', 'error', '-y', '-i', path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 出])
    return 出


def 本地量(wav, 原文件):
    out = 跑(['ffmpeg', '-v', 'info', '-i', 原文件, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], 要输出=True)
    摘 = out[out.rfind('Summary:'):] if 'Summary:' in out else ''
    def 数(pat):
        m = re.search(pat, 摘)
        return float(m.group(1)) if m else None
    响度 = {'整体响度LUFS': 数(r'I:\s*(-?[0-9.]+) LUFS'), '响度范围LU': 数(r'LRA:\s*(-?[0-9.]+) LU'),
            '真峰值dBTP': 数(r'Peak:\s*(-?[0-9.]+) dBFS')}
    sil = 跑(['ffmpeg', '-v', 'info', '-i', wav, '-af', 'silencedetect=noise=-50dB:d=0.5', '-f', 'null', '-'], 要输出=True)
    起 = [float(x) for x in re.findall(r'silence_start: (-?[0-9.]+)', sil)]
    止 = [float(x) for x in re.findall(r'silence_end: ([0-9.]+)', sil)]
    静音 = [[round(max(0, a), 2), round(b, 2)] for a, b in zip(起, 止 + [None] * (len(起) - len(止))) if b is not None]
    # 每 0.25 秒的音量，找削波和突变（声音事件的候选时刻）。
    with wave.open(wav) as w:
        rate = w.getframerate()
        a = array.array('h', w.readframes(w.getnframes()))
    步 = rate // 4
    电平, 削波, 满幅 = [], [], []
    for i in range(0, len(a), 步):
        块 = a[i:i + 步]
        if not 块:
            break
        rms = math.sqrt(sum(x * x for x in 块) / len(块)) or 1e-9
        电平.append(max(-90.0, round(20 * math.log10(rms / 32768), 1)))   # 静音按 -90 算，免得变响数字失真
        顶 = max(abs(x) for x in 块)
        # 接近满幅（-0.5 dBFS 以上）：可能削波。有损编码解出来的削波不是平顶，只能这样提示。
        if 顶 >= 30900:
            满幅.append(round(i / rate, 2))
        # 平顶：连着好几个采样一样高，是没压缩过的文件里真正的削波。
        if 顶 >= 30000:
            连, 最长 = 0, 0
            for x in 块:
                连 = 连 + 1 if abs(x) >= 顶 * 0.995 else 0
                最长 = max(最长, 连)
            if 最长 >= 6:
                削波.append(round(i / rate, 2))
    事件 = []
    for k in range(1, len(电平)):
        底 = max(-60.0, min(电平[max(0, k - 4):k]))
        跳 = round(电平[k] - 底, 1)
        if 跳 >= 10 and 电平[k] > -45:
            t = round(k * 0.25, 2)
            if 事件 and t - 事件[-1]['t'] < 0.6:
                if 跳 > 事件[-1]['变响dB']:
                    事件[-1] = {'t': t, '变响dB': 跳}   # 挨得太近的两个，留跳得更猛的那个
            else:
                事件.append({'t': t, '变响dB': 跳})
    return {**响度, '静音段': 静音, '削波时刻': 削波[:40], '接近满幅时刻': 满幅[:40], '突然变响': 事件[:60], '每0.25秒电平': 电平}


def 声音图(wav, 出):
    跑(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-lavfi', 'showspectrumpic=s=1200x320:legend=1', 出])
    return 出


声音提示 = """这是一段音频的第 {a} 到第 {b} 秒（下面说的时刻都按整段音频算）。本地测量在这一段里找到的突然变响：{事件}。
请认真听，只回一个 JSON 对象：
- 听到：一两句话，这一段里有哪些声音（乐器、人声、环境、音效），按先后说
- 情绪：一句话，给人的感觉
- 事件：数组，每项 {{"t": 秒, "声音": "是什么声音"}}；本地找到的变响时刻逐个说明是什么声音，你听到的其他明显事件也补上
- 问题：听得出的毛病（爆音、断裂、突兀的切换、杂音、节奏不齐），没有写 ""
"""


def 写声音卡片(wav, 时长, 事件们):
    卡片们 = []
    with wave.open(wav) as w:
        rate, n = w.getframerate(), w.getnframes()
        data = w.readframes(n)
    t = 0.0
    while t < 时长 - 0.05:
        a, b = t, min(时长, t + 声音段长)
        段 = os.path.join(os.path.dirname(wav), f'段_{int(a)}.wav')
        with wave.open(段, 'wb') as o:
            o.setnchannels(1); o.setsampwidth(2); o.setframerate(rate)
            o.writeframes(data[int(a * rate) * 2:int(b * rate) * 2])
        这段事件 = [e for e in 事件们 if a <= e['t'] < b]
        事件文 = '、'.join(f"{e['t']} 秒（变响 {e['变响dB']} dB）" for e in 这段事件) or '没有'
        with open(段, 'rb') as f:
            音 = base64.b64encode(f.read()).decode()
        content = [{'type': 'input_audio', 'input_audio': {'data': 音, 'format': 'wav'}},
                   {'type': 'text', 'text': 声音提示.format(a=round(a, 1), b=round(b, 1), 事件=事件文)}]
        原文 = 问模型(MIMO, 'MIMO_API_KEY', MIMO_MODEL, content, 最多=3000, 类='声音')
        回 = 取JSON(原文)
        回 = 回 if isinstance(回, dict) else {}
        卡 = {'从': round(a, 2), '到': round(b, 2), '听到': str(回.get('听到', '')), '情绪': str(回.get('情绪', '')),
             '事件': 回.get('事件') if isinstance(回.get('事件'), list) else [], '问题': str(回.get('问题', ''))}
        if not 卡['听到']:
            卡['原文'] = 原文[:600]   # 模型没按格式答：原话留着，别丢
        卡片们.append(卡)
        t = b
    return 卡片们


# ---------- 索引 ----------

def 时间线(idx):
    行们 = []
    for c in idx.get('画面', []):
        if not c['画面']:
            continue
        bits = [c['画面']]
        if c['事件']: bits.append('变化：' + c['事件'])
        if c['文字']: bits.append('文字：' + c['文字'])
        行们.append((c['t'], f"[{时刻(c['t'])}] 画面　" + '；'.join(bits) + (f"（运动{c['运动']}）" if c['运动'] else '')))
    for t in idx.get('镜头切换', []):
        行们.append((t, f'[{时刻(t)}] 画面大变（像素自动检测，不一定是切镜头；暗色之间的切换常检测不到）'))
    声 = idx.get('声音') or {}
    for c in 声.get('段', []):
        行们.append((c['从'], f"[{时刻(c['从'])}–{时刻(c['到'])}] 声音　{c['听到']}" + (f"；情绪：{c['情绪']}" if c['情绪'] else '') + (f"；毛病：{c['问题']}" if c['问题'] else '')))
        for e in c['事件']:
            try:
                te = float(e.get('t')) if isinstance(e, dict) else None
            except (TypeError, ValueError):
                te = None
            if te is not None:
                行们.append((te, f"[{时刻(te)}] 声音事件　{e.get('声音', '')}"))
    for e in 声.get('本地', {}).get('突然变响', []):
        行们.append((e['t'], f"[{时刻(e['t'])}] 突然变响 +{e['变响dB']} dB（本地量）"))
    for a, b in 声.get('本地', {}).get('静音段', []):
        行们.append((a, f'[{时刻(a)}–{时刻(b)}] 静音'))
    for t in 声.get('本地', {}).get('削波时刻', []):
        行们.append((t, f'[{时刻(t)}] 削波（爆音）'))
    满 = 声.get('本地', {}).get('接近满幅时刻', [])
    for k, t in enumerate(满):
        if k == 0 or t - 满[k - 1] > 0.3:   # 连着的几块只报开头
            行们.append((t, f'[{时刻(t)}] 接近满幅（可能削波）'))
    return [s for _, s in sorted(行们, key=lambda x: x[0])]


def 索引(path, 重建=False, 每秒=None):
    path = os.path.abspath(path)
    夹 = 索引夹(path)
    索引文件 = os.path.join(夹, '索引.json')
    if os.path.exists(索引文件) and not 重建:
        with open(索引文件) as f:
            return json.load(f), 夹, True
    os.makedirs(夹, exist_ok=True)
    媒 = 读媒体(path)
    idx = {'文件': path, '指纹': os.path.basename(夹), '时长': round(媒['时长'], 2), '建于': time.strftime('%Y-%m-%d %H:%M')}
    if 媒['有画面']:
        每秒 = 每秒 or (1 if 媒['时长'] <= 60 else 0.5 if 媒['时长'] <= 600 else 0.2 if 媒['时长'] <= 1800 else 0.1)
        帧们 = 抽帧(path, 夹, 每秒)
        idx['每秒帧数'] = 每秒
        idx['联系表'] = 联系表(帧们, os.path.join(夹, '联系表.jpg'))
        idx['镜头切换'] = 镜头切换(path)
        if os.environ.get('DEEPSEEK_API_KEY'):
            idx['画面'] = 写画面卡片(帧们)
        else:
            idx['画面'] = [{'t': f['t'], '画面': '', '事件': '', '文字': '', '运动': '', '图': f['图']} for f in 帧们]
            idx['缺'] = idx.get('缺', []) + ['没有 DEEPSEEK_API_KEY：画面卡片没写，只有联系表']
    if 媒['有声音']:
        wav = 抽声音(path, 夹)
        本地 = 本地量(wav, path)
        idx['声音'] = {'本地': 本地, '频谱图': 声音图(wav, os.path.join(夹, '频谱.png')),
                     '段': 写声音卡片(wav, 媒['时长'], 本地['突然变响']) if os.environ.get('MIMO_API_KEY') else []}
        if not os.environ.get('MIMO_API_KEY'):
            idx['缺'] = idx.get('缺', []) + ['没有 MIMO_API_KEY：声音卡片没写，只有本地测量和频谱图']
    idx['用量'] = dict(用量)
    with open(索引文件, 'w') as f:
        json.dump(idx, f, ensure_ascii=False, indent=1)
    with open(os.path.join(夹, '时间线.md'), 'w') as f:
        f.write(f"# {os.path.basename(path)}（{时刻(idx['时长'])}，指纹 {idx['指纹']}）\n\n" + '\n'.join(时间线(idx)) + '\n')
    return idx, 夹, False


def 打印索引(idx, 夹, 现成):
    print(f"{'用的是现成索引（文件没变）' if 现成 else '索引建好了'}：{夹}")
    print(f"时长 {时刻(idx['时长'])}" + (f"；联系表 {idx['联系表']}" if idx.get('联系表') else '') +
          (f"；频谱图 {idx['声音']['频谱图']}" if idx.get('声音') else ''))
    声 = (idx.get('声音') or {}).get('本地')
    if 声:
        print(f"声音：整体 {声['整体响度LUFS']} LUFS，真峰值 {声['真峰值dBTP']} dBTP，响度范围 {声['响度范围LU']} LU；"
              f"静音 {len(声['静音段'])} 段，削波 {len(声['削波时刻'])} 处，接近满幅 {len(声['接近满幅时刻'])} 块，突然变响 {len(声['突然变响'])} 处")
    if not 现成:
        u = idx['用量']; print(f"这次调用模型 {u['调用']} 次，画面 {u['画面']} token、声音 {u['声音']} token")
    for x in idx.get('缺', []):
        print('注意：' + x)
    print('\n时间线（全文在 时间线.md）：')
    行们 = 时间线(idx)
    for s in 行们[:80]:
        print(s)
    if len(行们) > 80:
        print(f'……共 {len(行们)} 行')


# ---------- 问 ----------

def 二元(s):
    s = re.sub(r'\s+', '', s)
    return {s[i:i + 2] for i in range(len(s) - 1)}


def 问(path, 问题, 看图=6):
    idx, 夹, _ = 索引(path)
    卡们 = idx.get('画面', [])
    q = 二元(问题)
    def 分(c):
        return len(q & 二元(c['画面'] + c['事件'] + c['文字'])) + (1 if c['事件'] else 0) + {'大': 1.5, '中': 0.8}.get(c['运动'], 0)
    选 = sorted(sorted(卡们, key=分, reverse=True)[:看图], key=lambda c: c['t'])
    间隔 = 1 / idx['每秒帧数'] if idx.get('每秒帧数') else None
    说明 = (f"画面卡片每 {间隔:g} 秒一张，所以时刻和时长都只准到约 ±{间隔:g} 秒；要更准，说清该对哪一秒用「细看」（每秒 12 帧放大看那一秒）。" if 间隔 else '')
    content = [{'type': 'text', 'text': f"下面是一段视频（{时刻(idx['时长'])}）事先做好的时间线卡片，和其中最相关的几帧原图。{说明}"
                f"声音卡片是能听的模型写的「听起来像什么」，静音、接近满幅、变响是本地量出来的。"
                f"请回答问题，每个论点后面标出依据的时刻，写成 [MM:SS]。卡片和图里没有的，直说看不出，不要猜。\n\n"
                f"问题：{问题}\n\n时间线：\n" + '\n'.join(时间线(idx))}]
    for c in 选:
        content += [{'type': 'text', 'text': f"[{时刻(c['t'])} 的原图]"}, 图(c['图'])]
    答 = 问模型(DEEPSEEK, 'DEEPSEEK_API_KEY', DEEPSEEK_MODEL, content, 想=True, 最多=8000)
    print(答)
    print(f"\n（看了 {len(选)} 帧原图：{'、'.join(时刻(c['t']) for c in 选)}；调用 {用量['调用']} 次，{用量['画面']} token。要看清某一刻的动作，用「细看」。）")


def 细看(path, 秒, 问题=''):
    idx, 夹, _ = 索引(path)
    if not idx.get('画面'):
        raise SystemExit('这个文件没有画面，细看只看画面。')
    t = float(秒)
    出夹 = os.path.join(夹, f'细看_{t:.2f}')
    os.makedirs(出夹, exist_ok=True)
    a = max(0, t - 0.5)
    跑(['ffmpeg', '-v', 'error', '-y', '-ss', str(a), '-t', '1', '-i', path, '-vf', 'fps=12,crop=iw*0.6:ih*0.6,scale=480:-2',
        '-q:v', '4', os.path.join(出夹, '%03d.jpg')])
    帧们 = [{'t': round(a + i / 12, 3), '图': os.path.join(出夹, f)} for i, f in enumerate(sorted(os.listdir(出夹))) if f.endswith('.jpg')]
    表 = 联系表(帧们, os.path.join(出夹, '细看.jpg'))
    print(f'细看图：{表}（{时刻(a)} 起 1 秒，每秒 12 帧，画面中间放大）')
    if 问题:
        content = [{'type': 'text', 'text': f'这是视频 {时刻(a)} 起 1 秒内每秒 12 帧、画面中间放大后的连续帧。问题：{问题}\n按先后说动作怎么变化，标出时刻。'}]
        for f in 帧们:
            content += [{'type': 'text', 'text': f"[{f['t']} 秒]"}, 图(f['图'])]
        print(问模型(DEEPSEEK, 'DEEPSEEK_API_KEY', DEEPSEEK_MODEL, content, 想=True, 最多=6000))


def 帧(path, 秒):
    夹 = 索引夹(path); os.makedirs(夹, exist_ok=True)
    出 = os.path.join(夹, f'帧_{float(秒):.2f}.png')
    跑(['ffmpeg', '-v', 'error', '-y', '-ss', str(秒), '-i', path, '-frames:v', '1', 出])
    print(出)


def 片段(path, 区间):
    a, b = (float(x) for x in 区间.split('-'))
    夹 = 索引夹(path); os.makedirs(夹, exist_ok=True)
    出 = os.path.join(夹, f'片段_{a:.1f}-{b:.1f}.mp4')
    跑(['ffmpeg', '-v', 'error', '-y', '-ss', str(a), '-t', str(b - a), '-i', path, '-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', 出])
    print(出)


def main():
    p = argparse.ArgumentParser(description='看听：录屏和音频做成带时刻的卡片，按卡片查')
    s = p.add_subparsers(dest='命令', required=True)
    a = s.add_parser('索引'); a.add_argument('文件'); a.add_argument('--重建', action='store_true'); a.add_argument('--每秒', type=float)
    b = s.add_parser('问'); b.add_argument('文件'); b.add_argument('问题'); b.add_argument('--看图', type=int, default=6)
    c = s.add_parser('细看'); c.add_argument('文件'); c.add_argument('秒'); c.add_argument('问题', nargs='?', default='')
    d = s.add_parser('帧'); d.add_argument('文件'); d.add_argument('秒')
    e = s.add_parser('片段'); e.add_argument('文件'); e.add_argument('区间')
    x = p.parse_args()
    if not os.path.exists(x.文件):
        raise SystemExit(f'找不到文件：{x.文件}')
    if x.命令 == '索引':
        打印索引(*索引(x.文件, x.重建, x.每秒))
    elif x.命令 == '问':
        问(x.文件, x.问题, x.看图)
    elif x.命令 == '细看':
        细看(x.文件, x.秒, x.问题)
    elif x.命令 == '帧':
        帧(x.文件, x.秒)
    else:
        片段(x.文件, x.区间)


if __name__ == '__main__':
    main()
