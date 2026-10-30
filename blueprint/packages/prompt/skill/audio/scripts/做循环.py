"""做循环：从一段音频里截一段，首尾交叉淡化，接成能无缝循环的文件。只用 ffmpeg。

python3 做循环.py <入> <出> --长 秒 [--起 秒] [--交叉 秒]

截 [起, 起+长+交叉]；结尾多出来的那一小段（长度＝交叉）淡出、叠到开头淡入的那一段上，
所以循环播到末尾接回开头时，听到的是原曲里连续的下一拍。长度最好落在小节线上（秒＝小节数×拍数×60÷BPM）。
出 .wav 是 16 位 PCM（Godot 直接能导），出 .ogg 是 Vorbis。做完用 声音体检.py --循环 量一下接缝。
"""
import argparse
import json
import subprocess
import sys


def 时长(f):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", f], capture_output=True, text=True)
    return float(json.loads(r.stdout or "{}").get("format", {}).get("duration") or 0)


def main():
    参 = argparse.ArgumentParser(prog="做循环.py")
    参.add_argument("入")
    参.add_argument("出")
    参.add_argument("--长", type=float, required=True, help="循环一圈多少秒")
    参.add_argument("--起", type=float, default=0.0, help="从原曲第几秒截起")
    参.add_argument("--交叉", type=float, default=0.5, help="首尾交叉淡化多少秒")
    a = 参.parse_args()
    总 = 时长(a.入)
    if a.长 <= a.交叉 or a.交叉 <= 0:
        sys.exit("--长 要大于 --交叉，--交叉 要大于 0")
    if a.起 + a.长 + a.交叉 > 总 + 1e-3:
        sys.exit(f"原曲只有 {总:.2f} 秒，不够截 起 {a.起} + 长 {a.长} + 交叉 {a.交叉}")
    L, X = a.长, a.交叉
    图 = (f"[0:a]atrim=start={a.起}:end={a.起 + L + X},asetpts=PTS-STARTPTS,asplit=3[a][b][c];"
          f"[a]atrim=start=0:end={X},asetpts=PTS-STARTPTS,afade=t=in:st=0:d={X}:curve=qsin[head];"
          f"[b]atrim=start={L}:end={L + X},asetpts=PTS-STARTPTS,afade=t=out:st=0:d={X}:curve=qsin[tail];"
          f"[head][tail]amix=inputs=2:normalize=0:duration=longest[xf];"
          f"[c]atrim=start={X}:end={L},asetpts=PTS-STARTPTS[body];"
          f"[xf][body]concat=n=2:v=0:a=1[out]")
    编码 = ["-c:a", "libvorbis", "-q:a", "6"] if a.出.lower().endswith(".ogg") else ["-c:a", "pcm_s16le"]
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a.入, "-filter_complex", 图, "-map", "[out]", *编码, a.出], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(r.stderr.strip() or "ffmpeg 失败")
    print(f"{a.出}：{时长(a.出):.3f} 秒（要的是 {L} 秒），首尾交叉 {X} 秒")


if __name__ == "__main__":
    main()
