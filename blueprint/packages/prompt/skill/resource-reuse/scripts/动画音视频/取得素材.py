#!/usr/bin/env python3
"""取得已实测的公开原件。只写 --output-dir 或调用 cwd 下的素材目录。"""
import argparse
import os
import datetime
import hashlib
import html
import http.cookiejar
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

SOURCES = ["kenney-ui-audio", "mixkit-sfx", "mixkit-music", "mixkit-video",
           "quaternius-animation", "itch-free-package", "lottie-starfish", "opengameart-retro-synth", "cmu-walk"]
LOTTIE_COMMIT = "bede03d25d232826e0c9dca1733d542d8a7754fb"


def attribute(text, name):
    match = re.search(re.escape(name) + r'="([^"]+)"', text)
    if not match:
        raise ValueError(f"页面未找到 {name}；请重新检查官网当前下载入口")
    return html.unescape(match.group(1))


class Fetcher:
    def __init__(self, output, source):
        self.output = output
        self.source = source
        self.requests = []
        self.files = []
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, url, fields=None, referer=None):
        headers = {"User-Agent": "Mozilla/5.0 resource-reuse-verification"}
        if referer:
            headers.update({"Referer": referer, "X-Requested-With": "XMLHttpRequest"})
        data = urllib.parse.urlencode(fields).encode() if fields is not None else None
        with self.opener.open(urllib.request.Request(url, data=data, headers=headers), timeout=90) as response:
            body = response.read()
            metadata = {"request_url": url, "resolved_url": response.url,
                        "method": "POST" if fields is not None else "GET",
                        "post_field_names": sorted(fields) if fields is not None else [],
                        "http_status": response.status,
                        "content_type": response.headers.get("Content-Type"),
                        "size_bytes": len(body)}
        self.requests.append(metadata)
        return body, metadata

    def text(self, url, fields=None, referer=None):
        return self.request(url, fields, referer)[0].decode("utf-8")

    def file(self, url, filename):
        body, metadata = self.request(url)
        target = self.output / filename
        target.write_bytes(body)
        record = {**metadata, "path": filename,
                  "sha256": hashlib.sha256(body).hexdigest()}
        self.files.append(record)
        print(f"取得 {target} ({len(body)} bytes, SHA256 {record['sha256']})")

    def save(self):
        target = self.output / "取得记录.json"
        history = json.loads(target.read_text()) if target.exists() else []
        history.append({"source": self.source,
                        "retrieved_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        "requests": self.requests, "files": self.files})
        target.write_text(json.dumps(history, ensure_ascii=False, indent=2))


def itch_free_package(fetcher, page_url, filename, output_filename=None):
    """只取得匿名免费页明确列出的指定文件；不从公开页猜付费 upload ID。"""
    parts = urllib.parse.urlsplit(page_url)
    if parts.scheme != "https" or not (parts.hostname or "").endswith(".itch.io"):
        raise ValueError("--page-url 应为已读的 HTTPS itch.io 作者素材页")
    if not filename or filename != Path(filename).name or "\\" in filename:
        raise ValueError("--filename 应为页面列出的完整文件名，不含目录")
    base = urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), "", ""))

    def csrf_token(text):
        match = re.search(r'<meta name="csrf_token" value="([^"]+)"', text)
        if not match:
            raise ValueError("页面未提供匿名下载所需的 CSRF；请检查当前取得条件")
        return html.unescape(match.group(1))

    purchase = fetcher.text(base + "/purchase")
    generated = json.loads(fetcher.text(base + "/download_url",
                                      {"csrf_token": csrf_token(purchase)}, base + "/purchase"))
    if not generated.get("url"):
        raise ValueError("此页面未返回匿名免费页，尚未取得指定原件")
    pageurl = generated["url"]
    download = fetcher.text(pageurl)
    uploads = re.findall(r'<div class="upload">(.*?)(?=<div class="upload">|</div></div>)', download, re.S)
    names = []
    for block in uploads:
        name = re.search(r'<strong[^>]*class="name"[^>]*>(.*?)</strong>', block, re.S)
        names.append(html.unescape(re.sub(r'<[^>]+>', '', name.group(1))).strip() if name else "")
    matching = [block for block, name in zip(uploads, names) if name == filename]
    if len(matching) != 1:
        listed = "、".join(f"“{name}”" for name in names if name) or "无"
        raise ValueError(f"匿名免费页未唯一列出文件“{filename}”；免费页列出的是：{listed}；未请求付费文件")
    upload = attribute(matching[0], "data-upload_id")
    endpoint = base + "/file/" + upload + "?source=game_download"
    response = json.loads(fetcher.text(endpoint, {"csrf_token": csrf_token(download)}, pageurl))
    if not response.get("url"):
        raise ValueError("指定免费文件未返回原件 URL，尚未取得")
    fetcher.file(response["url"], output_filename or filename)


def acquire(fetcher, args):
    source = args.source
    if source == "kenney-ui-audio":
        page = "https://kenney.nl/assets/ui-audio"
        text = fetcher.text(page)
        links = re.findall(r'''href=["']([^"']+\.zip(?:\?[^"']*)?)["']''', text)
        urls = [html.unescape(url) for url in links if "kenney.nl/media/pages/assets/ui-audio/" in url]
        if len(urls) != 1:
            raise ValueError("Kenney 页面原包链接不唯一或已改变")
        fetcher.file(urls[0], "Kenney-UI-Audio原包.zip")
    elif source in ["mixkit-sfx", "mixkit-music"]:
        kind = "free-sound-effects" if source == "mixkit-sfx" else "free-stock-music"
        item = args.item_id or ("213" if source == "mixkit-sfx" else "738")
        page = f"https://mixkit.co/{kind}/"
        text = fetcher.text(page)
        modals = re.findall(r'data-download--button-modal-url-value="([^"]+)"', text)
        matching = [url for url in modals if f"/download/{item}/" in url]
        if matching:
            modal = urllib.parse.urljoin(page, html.unescape(matching[0]))
        elif args.item_id:
            # ID 必须来自已读的素材页面；这条路径与已实测下载按钮的路径相同。
            modal = f"https://mixkit.co/{kind}/download/{item}/?context=item+grid"
        else:
            raise ValueError("默认实测条目已离开列表；请从当前页面取得实际 item ID")
        url = attribute(fetcher.text(modal), "data-download--modal-url-value")
        if "preview" in url:
            raise ValueError("下载动作返回了试听 URL，未当作原件保存")
        name = "Mixkit-Arcade-retro-game-over.wav" if source == "mixkit-sfx" and item == "213" else (
            "Mixkit-Hip-Hop-02.mp3" if source == "mixkit-music" and item == "738" else
            f"Mixkit-{source.removeprefix('mixkit-')}-item-{item}{Path(urllib.parse.urlparse(url).path).suffix}")
        fetcher.file(url, name)
    elif source == "mixkit-video":
        page = args.page_url or "https://mixkit.co/free-stock-video/couple-exploring-a-forest-43151/"
        text = fetcher.text(page)
        options = re.findall(r'value="([^"]+/download/[^\"]+)"', text)
        options = [html.unescape(url) for url in options if "type=1080p" in html.unescape(url)]
        if len(options) != 1:
            raise ValueError("未找到唯一 Full HD 下载动作；请检查素材页")
        modal = urllib.parse.urljoin(page, options[0])
        url = attribute(fetcher.text(modal), "data-download--modal-url-value")
        item = re.search(r'/download/(\d+)/', modal).group(1)
        name = "Mixkit-Couple-exploring-a-forest-FullHD.mp4" if item == "43151" else f"Mixkit-video-item-{item}-FullHD.mp4"
        fetcher.file(url, name)
    elif source == "quaternius-animation":
        itch_free_package(fetcher, "https://quaternius.itch.io/universal-animation-library",
                          "Universal Animation Library[Standard].zip",
                          "Quaternius-Universal-Animation-Library-Standard.zip")
    elif source == "itch-free-package":
        itch_free_package(fetcher, args.page_url, args.filename)
    elif source == "lottie-starfish":
        base = f"https://raw.githubusercontent.com/airbnb/lottie-web/{LOTTIE_COMMIT}/"
        fetcher.file(base + "test/animations/starfish.json", "Lottie-starfish.json")
        fetcher.file(base + "build/player/lottie.js", "Lottie-player.js")
    elif source == "opengameart-retro-synth":
        page = "https://opengameart.org/content/50-cc0-retro-synth-sfx"
        text = fetcher.text(page)
        urls = re.findall(r'href="([^"]+/sites/default/files/50-CC0-retro-synth-SFX\.zip)"', text)
        if len(urls) != 1:
            raise ValueError("OGA File(s) 原包链接未唯一匹配")
        fetcher.file(html.unescape(urls[0]), "OpenGameArt-retro-synth原包.zip")
    elif source == "cmu-walk":
        base = "https://mocap.cs.cmu.edu/"
        text = fetcher.text(base + "search.php?subjectnumber=02")
        for source_path, name in [("/subjects/02/02.asf", "CMU-Subject02骨架.asf"),
                                  ("/subjects/02/02_01.amc", "CMU-Subject02-walk.amc")]:
            if source_path not in text:
                raise ValueError("CMU 当前页面没有对应文件链接")
            fetcher.file(urllib.parse.urljoin(base, source_path), name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", choices=SOURCES)
    parser.add_argument("--output-dir", type=Path, default=Path(os.environ.get("BLUEPRINT_PROJECT_ROOT") or Path.cwd()) / "素材" / "动画音视频")
    parser.add_argument("--item-id", help="Mixkit 音乐/音效 ID，须来自已读页面；默认取实测样例")
    parser.add_argument("--page-url", help="Mixkit 视频详情页或已读 itch.io 作者素材页")
    parser.add_argument("--filename", help="itch-free-package：匿名免费页明确列出的完整文件名")
    args = parser.parse_args()
    if args.source == "itch-free-package" and (not args.page_url or not args.filename):
        parser.error("itch-free-package 需要 --page-url 和 --filename")
    output = args.output_dir.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    fetcher = Fetcher(output, args.source)
    try:
        acquire(fetcher, args)
    finally:
        fetcher.save()


if __name__ == "__main__":
    main()
