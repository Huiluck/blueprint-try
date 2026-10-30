#!/usr/bin/env python3
"""Retrieve the exact verified sources into a current-project directory."""
import argparse, hashlib, json, os, pathlib, subprocess
base=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--manifest',type=pathlib.Path,default=base/'source-requests.json')
parser.add_argument('--destination',type=pathlib.Path,default=pathlib.Path(os.environ.get('BLUEPRINT_PROJECT_ROOT') or pathlib.Path.cwd())/'reusable-code-originals')
parser.add_argument('--name',action='append',help='Repeat exact source basename; without this, retrieve all.')
args=parser.parse_args();args.destination.mkdir(parents=True,exist_ok=True)
items=json.loads(args.manifest.read_text())
if args.name:
    requested=set(args.name);items=[item for item in items if pathlib.Path(item['local_path']).name in requested]
    missing=requested-{pathlib.Path(item['local_path']).name for item in items}
    if missing:parser.error('Unknown original names: '+', '.join(sorted(missing)))
for item in items:
    name=pathlib.Path(item['local_path']).name
    target=args.destination/name
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest()!=item['sha256']:
        partial=target.with_name(target.name+'.download-partial')
        subprocess.run(['curl','--fail','--location','--silent','--show-error','--retry','2',item['url'],'--output',str(partial)],check=True)
        digest=hashlib.sha256(partial.read_bytes()).hexdigest()
        if digest!=item['sha256']:raise SystemExit(f'{name}: source content changed; expected {item["sha256"]}, received {digest}. Download left at {partial}.')
        partial.replace(target)
    print(json.dumps({'path':str(target.resolve()),'bytes':target.stat().st_size,'sha256':item['sha256'],'url':item['url']},ensure_ascii=False))
