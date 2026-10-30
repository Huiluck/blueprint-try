"""声音体检：一条命令把一批音频该量的都量完，出一张表。只用 Python 标准库和 ffmpeg / ffprobe。

python3 声音体检.py <文件或目录>... [--循环] [--json]

每个文件量：格式（编码、采样率、声道、位深）、时长、峰值与真峰、整体响度与响度范围、直流、
开头结尾的静音、中间超过 0.3 秒的静音；循环文件再量首尾接缝。
循环文件的认法：加了 --循环 就全当循环；否则看旁边 Godot 的 .import 里 edit/loop_mode=2，或文件名带 loop。
在 Godot 工程里（上层有 project.godot）的 WAV，还会查导入会不会失败、是不是导成了有损。
最后一列「要看的」只列可能有问题的地方；好不好听，这张表回答不了。
"""
import argparse
import json
import math
import re
import subprocess
import sys
from array import array
from pathlib import Path

后缀 = {".wav", ".ogg", ".mp3", ".flac", ".m4a", ".aif", ".aiff", ".opus"}
静音线 = 10 ** (-60 / 20) * 32768  # -60 dBFS，16 位样点值


def 跑(命令, 要字节=False):
    r = subprocess.run(命令, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or "ffmpeg 失败")
    return r.stdout if 要字节 else r.stderr.decode("utf-8", "replace")


def 格式(f):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                        "stream=codec_name,sample_rate,channels,bits_per_sample,bits_per_raw_sample:format=duration",
                        "-of", "json", str(f)], capture_output=True, text=True)
    d = json.loads(r.stdout or "{}")
    s = (d.get("streams") or [{}])[0]
    位 = s.get("bits_per_raw_sample") or s.get("bits_per_sample")
    return {"编码": s.get("codec_name"), "采样率": int(s.get("sample_rate") or 0), "声道": s.get("channels"),
            "位深": int(位) if str(位 or "").isdigit() and int(位) else None, "时长": float(d.get("format", {}).get("duration") or 0)}


def wav头(f):
    """WAV 的格式码：1 整数 PCM，3 浮点，0xFFFE 扩展头（ffmpeg 写 24 位时就是它，Godot 4.7.2 导入报 not PCM）。"""
    if f.suffix.lower() != ".wav":
        return None
    b = f.read_bytes()[:4096]
    i = b.find(b"fmt ")
    return int.from_bytes(b[i + 8:i + 10], "little") if i >= 0 else None


def 读数(f):
    文 = 跑(["ffmpeg", "-nostats", "-hide_banner", "-i", str(f), "-af",
             "silencedetect=n=-60dB:d=0.3,astats=metadata=0,ebur128=peak=true+sample", "-f", "null", "-"])
    取 = lambda 式, 段=文: (lambda m: float(m.group(1)) if m and m.group(1) not in ("-inf", "inf", "nan") else None)(re.search(式, 段, re.S))
    总 = 文[文.rfind("Overall"):] if "Overall" in 文 else 文  # astats 先逐声道、最后一段是全部声道合起来
    return {
        "响度": 取(r"Integrated loudness:\s*I:\s*(-?[\d.]+|-inf)"), "响度范围": 取(r"Loudness range:\s*LRA:\s*(-?[\d.]+)"),
        "峰值": 取(r"Sample peak:\s*Peak:\s*(-?[\d.]+|-inf)"), "真峰": 取(r"True peak:\s*Peak:\s*(-?[\d.]+|-inf)"),
        "直流": 取(r"DC offset:\s*(-?[\d.e+-]+)", 总),
        "静音段": [(float(a), float(b)) for a, b in re.findall(r"silence_start: (-?[\d.]+).*?silence_end: (-?[\d.]+)", 文, re.S)],
    }


def 样点(f):
    """解成单声道 16 位样点，量首尾静音和接缝用。"""
    return array("h", 跑(["ffmpeg", "-v", "error", "-i", str(f), "-ac", "1", "-f", "s16le", "-"], 要字节=True))


def 首尾(x, 率):
    头 = next((i for i, v in enumerate(x) if abs(v) > 静音线), len(x))
    尾 = next((i for i in range(len(x) - 1, -1, -1) if abs(x[i]) > 静音线), -1)
    return 头 / 率, (len(x) - 1 - 尾) / 率


def 接缝(x, 率):
    """首尾接上那一下跳多少（相对满幅），和片内相邻样点差的 99.9% 分位比；再比首尾各 50 毫秒的电平。"""
    if len(x) < 率 // 10:
        return None
    步 = max(1, len(x) // 400000)
    差 = sorted(abs(x[i + 1] - x[i]) for i in range(0, len(x) - 1, 步))
    分位 = 差[int(len(差) * 0.999)] / 32768
    n = 率 // 20
    电平 = lambda 段: 20 * math.log10(max(1e-9, (sum(v * v for v in 段) / len(段)) ** 0.5 / 32768))
    return {"跳变": abs(x[0] - x[-1]) / 32768, "片内分位": 分位, "电平差": abs(电平(x[:n]) - 电平(x[-n:]))}


def godot导入(f):
    """在 Godot 工程里才查：.import 的 compress/mode 和 edit/loop_mode。"""
    if not any((p / "project.godot").exists() for p in f.resolve().parents):
        return None
    旁 = f.with_name(f.name + ".import")
    if not 旁.exists():
        return {"有": False}
    文 = 旁.read_text("utf-8", "replace")
    取 = lambda 键: (lambda m: m.group(1) if m else None)(re.search(rf"^{re.escape(键)}=(\S+)", 文, re.M))
    return {"有": True, "压缩": 取("compress/mode"), "循环": 取("edit/loop_mode")}


def 查一个(f, 全当循环):
    格 = 格式(f)
    数 = 读数(f)
    x = 样点(f)
    率 = 格["采样率"] or 48000
    头静, 尾静 = 首尾(x, 率)
    导 = godot导入(f) if f.suffix.lower() == ".wav" else None
    循环 = 全当循环 or "loop" in f.stem.lower() or (导 or {}).get("循环") == "2"
    缝 = 接缝(x, 率) if 循环 else None
    要看 = []
    if wav头(f) == 0xFFFE:
        要看.append("WAV 是扩展头（ffmpeg 写 24 位就是这样），Godot 导入会失败：出成 -c:a pcm_s16le")
    if 导 is not None and not 导["有"]:
        要看.append("没有 .import：Godot 默认导成有损 QOA（compress/mode=2）")
    elif 导 and 导["压缩"] == "2":
        要看.append("Godot 导入是有损 QOA（compress/mode=2），要保真改 0")
    if 导 and 循环 and 导.get("有") and 导["循环"] != "2":
        要看.append(f"循环文件的 edit/loop_mode={导['循环']}，要无缝循环改 2")
    if 数["真峰"] is not None and 数["真峰"] > -1.0:
        要看.append(f"真峰 {数['真峰']:.1f}，高过 -1，转码或叠加后可能削波")
    if 数["峰值"] is not None and 数["峰值"] >= -0.01:
        要看.append("样点峰值到了满幅，可能已经削波")
    if 数["直流"] is not None and abs(数["直流"]) > 0.005 and 格["时长"] >= 2:  # 短件衰减本来就不对称，均值不等于直流
        要看.append(f"直流偏移 {数['直流']:.4f}")
    if not 循环 and 格["时长"] < 10 and 头静 >= 0.05:
        要看.append(f"短件开头有 {头静:.2f} 秒静音，触发会晚这么多")
    if 缝 and (缝["跳变"] > 2 * 缝["片内分位"] or 缝["电平差"] > 3):  # 跳得比片内几乎所有相邻样点都大一倍，才听得出咔哒
        要看.append(f"循环接缝：跳变 {缝['跳变']:.3f}（片内 99.9% 分位 {缝['片内分位']:.3f}），首尾电平差 {缝['电平差']:.1f} dB")
    中间 = [s for s in 数["静音段"] if s[0] > 0.01 and s[1] < 格["时长"] - 0.01]
    return {"文件": str(f), **格, **{k: 数[k] for k in ("峰值", "真峰", "响度", "响度范围", "直流")},
            "开头静音": round(头静, 3), "结尾静音": round(尾静, 3), "中间静音": 中间, "循环": 循环, "接缝": 缝,
            "到-1真峰要加": None if 数["真峰"] is None else round(-1 - 数["真峰"], 1), "要看的": 要看}


def 收集(路径们):
    for p in map(Path, 路径们):
        if p.is_dir():
            yield from sorted(q for q in p.rglob("*") if q.suffix.lower() in 后缀 and q.is_file())
        elif p.exists():
            yield p
        else:
            print(f"找不到：{p}", file=sys.stderr)


def 数字(v, 位=1):
    return "—" if v is None else f"{v:.{位}f}"


def 表(行们, 根):
    print("| 文件 | 格式 | 时长 | 峰值 / 真峰 | 响度 (范围) | 首 / 尾静音 | 接缝 | 要看的 |")
    print("|---|---|---|---|---|---|---|---|")
    for r in 行们:
        名 = Path(r["文件"]).relative_to(根) if 根 and Path(r["文件"]).is_relative_to(根) else Path(r["文件"]).name
        格 = f"{r['编码']} {r['采样率'] // 1000 if r['采样率'] else '?'}k {r['声道']}ch" + (f" {r['位深']}bit" if r["位深"] else "")
        缝 = "—" if not r["接缝"] else f"跳 {r['接缝']['跳变']:.3f} / {r['接缝']['电平差']:.1f}dB"
        print(f"| {名} | {格} | {r['时长']:.2f}s | {数字(r['峰值'])} / {数字(r['真峰'])} | {数字(r['响度'])} LUFS ({数字(r['响度范围'])}) | "
              f"{r['开头静音']:.2f} / {r['结尾静音']:.2f}s | {缝} | {'；'.join(r['要看的']) or '—'} |")
    有事 = sum(1 for r in 行们 if r["要看的"])
    print(f"\n{len(行们)} 个文件，{有事} 个有要看的。中间超过 0.3 秒的静音和「到-1真峰要加」几 dB 在 --json 里。")


def main():
    参 = argparse.ArgumentParser(prog="声音体检.py")
    参.add_argument("路径", nargs="+")
    参.add_argument("--循环", action="store_true", help="给的文件全当循环，量首尾接缝")
    参.add_argument("--json", action="store_true")
    a = 参.parse_args()
    行们 = []
    for f in 收集(a.路径):
        try:
            行们.append(查一个(f, a.循环))
        except Exception as e:  # noqa: BLE001 一个文件坏了不挡别的
            行们.append({"文件": str(f), "错": str(e)})
    好 = [r for r in 行们 if "错" not in r]
    if a.json:
        print(json.dumps(行们, ensure_ascii=False, indent=1))
    else:
        根 = Path(a.路径[0]).resolve() if len(a.路径) == 1 and Path(a.路径[0]).is_dir() else None
        表([dict(r, 文件=str(Path(r["文件"]).resolve())) for r in 好], 根)
        for r in 行们:
            if "错" in r:
                print(f"读不了 {r['文件']}：{r['错']}")
    sys.exit(0 if 行们 else 1)


if __name__ == "__main__":
    main()
