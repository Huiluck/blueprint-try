#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["markitdown[docx,xlsx,pptx]==0.1.8"]
# ///
"""Convert a local Office document to Markdown without remote/plugin converters."""
import argparse
import hashlib
import json
import sys
import zipfile
from importlib.metadata import version
from pathlib import Path

OFFICE_PARTS = {
    ".docx": "word/document.xml",
    ".xlsx": "xl/workbook.xml",
    ".pptx": "ppt/presentation.xml",
}


def validate_document(source: Path) -> None:
    if source.suffix.lower() not in OFFICE_PARTS:
        raise ValueError("只读取 DOCX、XLSX、PPTX；PDF 文字和版面用 pdf skill。")
    if not source.is_file():
        raise ValueError(f"办公材料不是可读文件：{source}")
    if source.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("办公材料超过 64 MiB，请按当前问题拆分材料。")
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) > 20000 or sum(item.file_size for item in entries) > 256 * 1024 * 1024:
            raise ValueError("办公材料解压后的内容超过读取范围，请拆分材料。")
        if OFFICE_PARTS[source.suffix.lower()] not in archive.namelist():
            raise ValueError("文件缺少对应 Office 正文，扩展名与内容可能不一致。")


def read_document(source: Path) -> str:
    # These are MarkItDown's Office-only converters. No generic URL dispatcher,
    # plugin discovery, image model, or cloud converter participates.
    from markitdown import StreamInfo
    from markitdown.converters import DocxConverter, PptxConverter, XlsxConverter

    converters = {".docx": DocxConverter, ".pptx": PptxConverter, ".xlsx": XlsxConverter}
    converter = converters[source.suffix.lower()]()
    with source.open("rb") as stream:
        result = converter.convert(
            stream,
            StreamInfo(extension=source.suffix.lower(), filename=source.name, local_path=str(source)),
        )
    return result.markdown


def main() -> None:
    parser = argparse.ArgumentParser(description="读取本地 DOCX、XLSX、PPTX 办公材料")
    parser.add_argument("source", nargs="?", help="当前项目中的办公文件路径")
    parser.add_argument("--out", help="提取内容的 Markdown 文件路径；省略时输出全文")
    parser.add_argument("--overwrite", action="store_true", help="替换已有 Markdown 提取文件")
    parser.add_argument("--check", action="store_true", help="检查 Python 和 MarkItDown 版本")
    args = parser.parse_args()
    if args.check:
        print(json.dumps({"python": sys.version.split()[0], "markitdown": version("markitdown"), "formats": list(OFFICE_PARTS)}, ensure_ascii=False))
        return
    if not args.source:
        parser.error("请提供当前项目中的办公材料")
    source = Path(args.source).expanduser().resolve()
    validate_document(source)
    destination = Path(args.out).expanduser().resolve() if args.out else None
    if destination and destination.suffix.lower() != ".md":
        raise ValueError("提取文件使用说明内容的 .md 文件名。")
    if destination and destination.exists() and not args.overwrite:
        raise ValueError(f"提取文件已存在：{destination}；需要替换时加 --overwrite。")
    text = read_document(source)
    if not text.strip():
        raise ValueError("未提取到可读正文；请查看原办公材料。")
    if destination is None:
        print(text)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w" if args.overwrite else "x", encoding="utf-8") as output:
        output.write(text.rstrip() + "\n")
    print(json.dumps({
        "source": str(source),
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "markdown_path": str(destination),
        "characters": len(text),
        "markitdown": version("markitdown"),
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"读取办公材料失败：{error}", file=sys.stderr)
        sys.exit(1)
