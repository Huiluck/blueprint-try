#!/usr/bin/env python3
"""Download and parse the verified public visual samples into the current project.
Run: python3 取得视觉素材.py --source polyhaven --out "$BLUEPRINT_PROJECT_ROOT/素材/视觉来源复验"
Requires curl. Pillow/fontTools add optional image/font decode checks.
"""
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlparse, unquote
from html.parser import HTMLParser
from datetime import datetime, timezone
import argparse, hashlib, json, os, subprocess, struct, zipfile, traceback, xml.etree.ElementTree as ET

ROOT = Path(os.environ.get('BLUEPRINT_PROJECT_ROOT') or Path.cwd()) / '素材' / '视觉来源复验'
LOG = ROOT / '记录' / '视觉来源实测.json'
UA = 'BlueprintResourceReuseResearch/1.0'

def save_json(p, data):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

def decode_file(p):
    head = p.read_bytes()[:16]
    out = {'magic_hex':head.hex()}
    ext = p.suffix.lower()
    if ext in ('.png','.jpg','.jpeg','.webp','.gif','.tif','.tiff'):
        from PIL import Image
        with Image.open(p) as im:
            out.update(format=im.format, width=im.width, height=im.height, mode=im.mode)
            im.load()
            out['fully_decoded'] = True
    elif ext == '.svg':
        node = ET.parse(p).getroot()
        assert node.tag.endswith('svg'), 'not SVG root'
        out.update(root_tag=node.tag, viewBox=node.attrib.get('viewBox'), elements=sum(1 for x in node.iter()))
    elif ext in ('.ttf','.otf'):
        from fontTools.ttLib import TTFont
        font = TTFont(p)
        cmap = font.getBestCmap()
        names = [n.toUnicode() for n in font['name'].names if n.nameID in (1,2)]
        out.update(font_names=sorted(set(names)), glyph_count=font['maxp'].numGlyphs, chinese_sample_present=all(ord(c) in cmap for c in '素材复用'))
        font.close()
    elif ext == '.gltf':
        d=json.loads(p.read_text())
        assert d['asset']['version']=='2.0'
        refs=[x['uri'] for kind in ('buffers','images') for x in d.get(kind,[]) if 'uri' in x and not x['uri'].startswith('data:')]
        missing=[x for x in refs if not (p.parent/unquote(x)).is_file()]
        out.update(gltf_version=d['asset']['version'], meshes=len(d.get('meshes',[])), materials=len(d.get('materials',[])), animations=[x.get('name') for x in d.get('animations',[])], referenced_files=refs, missing_references=missing)
        assert not missing, f'missing glTF dependencies: {missing}'
    elif ext == '.glb':
        buf=p.read_bytes()
        magic,version,length=struct.unpack_from('<4sII',buf)
        assert magic==b'glTF' and version==2 and length==len(buf)
        chunk_length,chunk_type=struct.unpack_from('<II',buf,12)
        assert chunk_type==0x4E4F534A
        d=json.loads(buf[20:20+chunk_length])
        out.update(gltf_version=d['asset']['version'], container_bytes=length, meshes=len(d.get('meshes',[])), skins=len(d.get('skins',[])), materials=len(d.get('materials',[])), animations=[x.get('name') for x in d.get('animations',[])])
    elif ext == '.hdr':
        assert head.startswith(b'#?RADIANCE') or head.startswith(b'#?RGBE'), 'not Radiance HDR'
        text=p.read_bytes()[:1200].decode('ascii','ignore')
        out['radiance_header']=text.splitlines()[:8]
    elif ext == '.zip':
        with zipfile.ZipFile(p) as z:
            bad=z.testzip()
            assert bad is None, f'ZIP CRC failed: {bad}'
            out.update(zip_crc_checked=True, members=len(z.infolist()), uncompressed_bytes=sum(i.file_size for i in z.infolist()), extensions={e:sum(1 for i in z.infolist() if Path(i.filename).suffix.lower()==e) for e in sorted(set(Path(i.filename).suffix.lower() for i in z.infolist()))})
    return out

class Probe:
    def __init__(self, source):
        self.source=source
        self.result={'source':source,'tested_at_utc':datetime.now(timezone.utc).isoformat(),'requests':[],'artifacts':[],'checks':[],'status':'running'}
        self.samples=ROOT/'样例'/source
        self.records=ROOT/'记录'/source
        self.samples.mkdir(parents=True,exist_ok=True)
        self.records.mkdir(parents=True,exist_ok=True)
    def get(self, url, p, expected_size=None, expected_md5=None, role='asset', decode=True):
        p.parent.mkdir(parents=True,exist_ok=True)
        header=self.records/f'HTTP-{len(self.result["requests"])+1:02d}-{p.name}.headers'
        part=p.with_name(p.name+'.download-part')
        command=['curl','--fail','--location','--silent','--show-error','--connect-timeout','15','--max-time','100','-H',f'User-Agent: {UA}','-D',str(header),'-o',str(part),'-w','%{http_code}\n%{url_effective}\n%{content_type}\n%{size_download}\n',url]
        r=subprocess.run(command,capture_output=True,text=True)
        lines=r.stdout.splitlines()
        req={'url':url,'target':str(p.relative_to(ROOT)),'role':role,'curl_exit':r.returncode,'http_status':lines[0] if len(lines)>0 else None,'effective_url':lines[1] if len(lines)>1 else None,'content_type':lines[2] if len(lines)>2 else None,'error':r.stderr.strip() or None,'headers':str(header.relative_to(ROOT))}
        self.result['requests'].append(req)
        if r.returncode:
            if part.exists(): part.unlink()
            raise RuntimeError(f'curl failed for {url}: {r.stderr.strip()}')
        part.replace(p)
        size=p.stat().st_size
        data=p.read_bytes()
        artifact={'path':str(p.relative_to(ROOT)),'url':url,'role':role,'bytes':size,'sha256':hashlib.sha256(data).hexdigest()}
        if expected_size is not None:
            artifact['expected_bytes']=expected_size
            artifact['size_matches']=size==int(expected_size)
            if not artifact['size_matches']:
                artifact['metadata_warning']='Reported size differs from actual download; decode and digest checks determine file validity.'
        if expected_md5:
            artifact['expected_md5']=expected_md5
            artifact['md5_matches']=hashlib.md5(data).hexdigest()==expected_md5
            assert artifact['md5_matches'], f'MD5 mismatch: {p}'
        if role=='asset' and decode:
            artifact['parse']=decode_file(p)
        self.result['artifacts'].append(artifact)
        return p
    def api(self,url,name):
        p=self.get(url,self.records/name,role='metadata',decode=False)
        return json.loads(p.read_text())
    def asset(self,url,name=None,**kwargs):
        name=name or unquote(urlparse(url).path.rsplit('/',1)[-1])
        return self.get(url,self.samples/name,**kwargs)
    def unpack(self,p,folder):
        dest=self.samples/folder
        dest.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(p) as z:
            for item in z.infolist():
                resolved=(dest/item.filename).resolve()
                assert resolved.is_relative_to(dest.resolve()), 'ZIP unsafe path'
                assert ((item.external_attr>>16)&0o170000)!=0o120000, 'ZIP symlink'
            z.extractall(dest)
        checks=[]
        files=list(dest.rglob('*'))
        for f in files:
            if f.is_file() and f.suffix.lower() in ('.png','.jpg','.svg','.glb','.gltf'):
                checks.append({'path':str(f.relative_to(ROOT)),'parse':decode_file(f)})
        self.result['checks'].append({'kind':'extracted_asset_parse','folder':str(dest.relative_to(ROOT)),'file_count':sum(f.is_file() for f in files),'parsed_assets':checks})
        return dest

class Links(HTMLParser):
    def __init__(self): super().__init__(); self.hrefs=[]
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='a' and attrs.get('href'): self.hrefs.append(attrs)


def polyhaven(p):
    p.result['page']='https://polyhaven.com/'
    p.result['docs']=['https://api.polyhaven.com/','https://polyhaven.com/our-api']
    catalog=p.api('https://api.polyhaven.com/assets?type=all','资产目录.json')
    p.result['checks'].append({'kind':'catalog','asset_count':len(catalog),'found_ids':{k:k in catalog for k in ['wooden_table_02','brick_wall_001','venice_sunset']}})
    model=p.api('https://api.polyhaven.com/files/wooden_table_02','wooden_table_02-文件清单.json')['gltf']['1k']['gltf']
    for name,item in model.get('include',{}).items():
        p.asset(item['url'],'wooden_table_02/'+name,expected_size=item['size'],expected_md5=item['md5'])
    p.asset(model['url'],'wooden_table_02/wooden_table_02_1k.gltf',expected_size=model['size'],expected_md5=model['md5'])
    texture=p.api('https://api.polyhaven.com/files/brick_wall_001','brick_wall_001-文件清单.json')
    for kind in ['Diffuse','nor_gl','Rough']:
        item=texture[kind]['1k']['jpg']
        p.asset(item['url'],'brick_wall_001/'+urlparse(item['url']).path.rsplit('/',1)[-1],expected_size=item['size'],expected_md5=item['md5'])
    hdr=p.api('https://api.polyhaven.com/files/venice_sunset','venice_sunset-文件清单.json')['hdri']['1k']['hdr']
    p.asset(hdr['url'],'venice_sunset/'+urlparse(hdr['url']).path.rsplit('/',1)[-1],expected_size=hdr['size'],expected_md5=hdr['md5'])

def ambientcg(p):
    p.result['page']='https://ambientcg.com/'
    p.result['docs']=['https://docs.ambientcg.com/api/','https://docs.ambientcg.com/api/v2/full_json/']
    q=urlencode({'q':'bricks','type':'Material','limit':'3','include':'downloadData,imageData','sort':'Popular'})
    data=p.api('https://ambientcg.com/api/v2/full_json?'+q,'砖材质搜索.json')
    assert data.get('foundAssets'), 'no results'
    asset=data['foundAssets'][0]
    p.result['selected']={'id':asset['assetId'],'page':asset.get('shortLink'), 'displayName':asset.get('displayName')}
    cats=asset['downloadFolders']['default']['downloadFiletypeCategories']
    choices=[d for c in cats.values() for d in c.get('downloads',[])]
    item=next(d for d in choices if d.get('attribute')=='1K-JPG')
    package=p.asset(item.get('downloadLink') or item['fullDownloadPath'],item['fileName'],expected_size=item.get('size'))
    p.unpack(package,asset['assetId']+'-1K-JPG')

def kenney(p):
    p.result['page']='https://kenney.nl/assets'
    p.result['docs']=['https://kenney.nl/assets/ui-pack','https://kenney.nl/assets/tiny-town','https://kenney.nl/assets/nature-kit']
    for slug in ('ui-pack','tiny-town','nature-kit'):
        url='https://kenney.nl/assets/'+slug
        html=p.get(url,p.records/(slug+'-页面.html'),role='page',decode=False).read_text()
        parser=Links(); parser.feed(html)
        links=[a['href'] for a in parser.hrefs if a.get('id')=='donate-text']
        assert links, 'no public donate-text download link'
        download=urljoin(url,links[0])
        package=p.asset(download,slug+'.zip')
        p.unpack(package,slug)

def khronos(p):
    p.result['page']='https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox'
    p.result['docs']=['https://github.com/KhronosGroup/glTF-Sample-Assets']
    sha='main'; p.result['revision']='main (not pinned; exact content hash is recorded)'
    url=f'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/{sha}/Models/Fox/glTF-Binary/Fox.glb'
    p.asset(url,'Fox.glb')
    p.get(f'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/{sha}/Models/Fox/README.md',p.records/'Fox-README.md',role='documentation',decode=False)

def iconify(p):
    p.result['page']='https://icon-sets.iconify.design/'
    p.result['docs']=['https://iconify.design/docs/api/search.html','https://iconify.design/docs/api/svg.html']
    data=p.api('https://api.iconify.design/search?query=gamepad&limit=32','gamepad-搜索.json')
    icon=next((s for s in data['icons'] if s.startswith('mdi:')),data['icons'][0])
    prefix,name=icon.split(':',1)
    p.result['selected']=icon
    p.asset(f'https://api.iconify.design/{prefix}/{name}.svg?color=%2393c5fd&height=64',prefix+'-'+name+'.svg')

def cleveland(p):
    p.result['page']='https://www.clevelandart.org/open-access'
    p.result['docs']=['https://openaccess-api.clevelandart.org/']
    q=urlencode({'q':'landscape','has_image':'1','cc0':'1','limit':'3'})
    data=p.api('https://openaccess-api.clevelandart.org/api/artworks/?'+q,'山水画搜索.json')
    asset=next(x for x in data['data'] if x.get('images',{}).get('print'))
    p.result['selected']={'id':asset['id'],'title':asset['title'],'page':asset['url'],'image_variant':'print'}
    image=asset['images']['print']
    p.asset(image['url'],image['filename'],expected_size=image.get('filesize'))

def googlefonts(p):
    p.result['page']='https://fonts.google.com/noto/specimen/Noto+Sans+SC'
    p.result['docs']=['https://github.com/google/fonts']
    p.result['revision']='main (not pinned; exact content hash is recorded)'
    base='https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/'
    p.asset(base+'NotoSansSC%5Bwght%5D.ttf','NotoSansSC[wght].ttf')
    p.get(base+'OFL.txt',p.records/'NotoSansSC-OFL.txt',role='documentation',decode=False)

def wikimedia(p):
    p.result['page']='https://commons.wikimedia.org/'
    p.result['docs']=['https://www.mediawiki.org/wiki/API:Imageinfo']
    q=urlencode({'action':'query','format':'json','generator':'search','gsrnamespace':'6','gsrsearch':'Mount Fuji filetype:bitmap','gsrlimit':'3','prop':'imageinfo','iiprop':'url|size|mime|extmetadata'})
    data=p.api('https://commons.wikimedia.org/w/api.php?'+q,'富士山原图搜索.json')
    assert not data.get('error'),str(data.get('error'))
    asset=next(x for x in data['query']['pages'].values() if x.get('imageinfo'))
    image=asset['imageinfo'][0]
    p.result['selected']={'title':asset['title'],'page':image['descriptionurl'],'original':True}
    p.asset(image['url'],unquote(urlparse(image['url']).path.rsplit('/',1)[-1]),expected_size=image.get('size'))


def nasa(p):
    p.result['page']='https://images.nasa.gov/'
    p.result['docs']=['https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf']
    data=p.api('https://images-api.nasa.gov/search?q=apollo%20moon&media_type=image&page_size=3','月球任务照片搜索.json')
    asset=data['collection']['items'][0]
    metadata=asset['data'][0]
    nasa_id=metadata['nasa_id']
    manifest=p.api('https://images-api.nasa.gov/asset/'+nasa_id,'NASA原件文件清单.json')
    original=next(x['href'] for x in manifest['collection']['items'] if '~orig' in x['href'] and x['href'].lower().endswith(('.jpg','.png','.jpeg')))
    url=original.replace('http://','https://',1)
    p.result['selected']={'nasa_id':nasa_id,'title':metadata['title'],'original':True,'page':'https://images.nasa.gov/details/'+nasa_id}
    p.asset(url,unquote(urlparse(url).path.rsplit('/',1)[-1]))

TESTS={'nasa':nasa,'polyhaven':polyhaven,'ambientcg':ambientcg,'kenney':kenney,'khronos':khronos,'iconify':iconify,'cleveland':cleveland,'googlefonts':googlefonts}

def main():
    global ROOT, LOG
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',choices=list(TESTS),action='append',help='Repeat for chosen sources; default is all.')
    parser.add_argument('--out',type=Path,help='Output directory; default is the project root 素材/视觉来源复验.')
    args=parser.parse_args()
    if args.out:
        ROOT=args.out.resolve()
        LOG=ROOT/'记录'/'视觉来源实测.json'
    prior=json.loads(LOG.read_text()) if LOG.exists() else {'schema_version':1,'environment':{'user_agent':UA,'platform':'macOS','timezone':'Asia/Tokyo'},'sources':{}}
    any_failed = False
    for name in args.source or TESTS:
        probe=Probe(name)
        try:
            TESTS[name](probe)
            probe.result['status']='downloaded_and_parsed'
        except Exception as e:
            any_failed = True
            probe.result['status']='failed'
            probe.result['failure']=str(e)
            probe.result['traceback']=traceback.format_exc()
        prior['sources'][name]=probe.result
        save_json(LOG,prior)
        print(name,probe.result['status'],probe.result.get('failure',''),flush=True)
    return 1 if any_failed else 0
if __name__=='__main__':
    raise SystemExit(main())
