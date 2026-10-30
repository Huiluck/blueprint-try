/** 将测试项目的真实 history 和文档导出为只读、可交互的 Canvas 展示页。 */
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const root = args.get('--project'), url = args.get('--url'), token = args.get('--token'), reactRuntime = args.get('--react-runtime')
if (!root || !url || !token || !reactRuntime) throw new Error('需要 --project、--url、--token 和 --react-runtime（含 react/react-dom 的 node_modules 目录）')
const base = new URL(url)
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('只读取本机测试实例')
const manifest = JSON.parse(await readFile(join(root, '展示壳会话.json'), 'utf8'))
if (manifest.format !== 'blueprint-seat-shell-v1' || manifest.cwd !== resolve(root) || manifest.url !== base.origin) throw new Error('目标必须是对应测试实例的座位展示壳')
const auth = new URL('/', base); auth.searchParams.set('token', token)
const response = await fetch(auth, { redirect: 'manual' })
const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
if (!cookie) throw new Error('测试实例未返回登录 cookie')
const historyUrl = new URL('/studio/api/history', base)
historyUrl.searchParams.set('session', manifest.sessions['0']); historyUrl.searchParams.set('要', '树'); historyUrl.searchParams.set('首屏', '1')
const history = await fetch(historyUrl, { headers: { cookie } }).then(response => response.json())
if (!history.ok || history.lineage?.tree?.project !== manifest.sessions['0']) throw new Error('测试接口没有返回这份展示项目树')
history.sessions = history.sessions.filter(row => row.projectRootSession === manifest.sessions['0'])
const documents = {}
for (const node of history.lineage.tree.nodes) if (node.文档位) documents[node.文档位] = await readFile(join(root, node.文档位), 'utf8')
documents['展示项目说明.md'] = await readFile(join(root, '展示项目说明.md'), 'utf8')
const require = createRequire(new URL('../../../app/package.json', import.meta.url))
const runtimeRequire = createRequire(join(resolve(reactRuntime), '座位展示页依赖.cjs'))
const react = runtimeRequire.resolve('react'), reactDom = runtimeRequire.resolve('react-dom/client')
const source = `
import React from ${JSON.stringify(react)};
import {createRoot} from ${JSON.stringify(reactDom)};
const history=${JSON.stringify(history).replaceAll('<', '\\u003c')};
const documents=${JSON.stringify(documents).replaceAll('<', '\\u003c')};
const listeners=new Set();
let state={byId:{[history.lineage.root]:{id:history.lineage.root,cwd:${JSON.stringify(root)},retainedBy:{mainView:1}}}};
const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
const navigate=id=>{state={byId:{[id]:{id,cwd:${JSON.stringify(root)},retainedBy:{mainView:1}}}};for(const fn of listeners)fn();};
const useSessions=selector=>selector(React.useSyncExternalStore(subscribe,()=>state));
let Canvas;
window.__ModuleLoader__={load(spec){const plugin=spec.factory(name=>{if(name==='react')return React;throw Error(name);});
 const ctx={uiWorkspace:{openSession:navigate},effect:fn=>fn(),slots:{register(options,component){if(options.name==='main.blueprint')Canvas=component;return {};},inject(name,fn){for(const entry of fn()){}return ()=>{};}}};plugin.apply(ctx);}};
// 只读运输层：history 来自测试实例；任何业务写入在页面内拒绝，不连模型。
window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.pathname==='/studio/api/history')return new Response(JSON.stringify({...history,session:url.searchParams.get('session')}),{headers:{'content-type':'application/json'}});
 if(url.pathname==='/studio/api/rpc'){const request=JSON.parse(init.body);return new Response(JSON.stringify(request.method==='session.list'?{ok:true,value:{projectSessionId:history.lineage.root,items:history.sessions.filter(row=>row.projectRootSession===history.lineage.root).map(row=>({sessionId:row.id,running:false}))}}:{ok:false,message:'展示壳只供查看，不执行启停、重启或新工作。'}),{headers:{'content-type':'application/json'}});}
 return new Response(JSON.stringify({ok:false,message:'展示壳只供查看，不执行启停、重启或新工作。'}),{headers:{'content-type':'application/json'}});
};
window.EventSource=class{addEventListener(){}close(){}};
function App(){const [selected,setSelected]=React.useState(null);return React.createElement(React.Fragment,null,
 React.createElement(Canvas,{view:'canvas',leftOpen:false,useSessions,navigate,onSelectNode:setSelected,onNodeDocument:setSelected}),
 selected?React.createElement('aside',{className:'preview-document'},React.createElement('header',null,React.createElement('strong',null,selected.title),React.createElement('button',{onClick:()=>setSelected(null),'aria-label':'关闭工作文档'},'×')),React.createElement('pre',null,(documents[selected.path]||'这个展示节点没有工作文档。').replace(/<!-- blueprint-[^>]*-->/g,''))):null);}
window.mountSeatPreview=()=>createRoot(document.getElementById('canvas-root')).render(React.createElement(App));
`
const bundle = await require('esbuild').build({ stdin: { contents: source, loader: 'js', sourcefile: '座位展示页入口.js', resolveDir: resolve(reactRuntime) }, write: false, bundle: true, format: 'iife', minify: true, define: { 'process.env.NODE_ENV': '"production"' } })
const canvas = await readFile(new URL('./client.js', import.meta.url), 'utf8')
const script = `${bundle.outputFiles[0].text}\n${canvas}\nmountSeatPreview();`.replaceAll('</script', '<\\/script')
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blueprint · 座位与分身展示壳</title><style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#171717;font:13px/1.5 -apple-system,system-ui,"PingFang SC",sans-serif}.preview-header{position:fixed;inset:0 0 auto;height:44px;border-bottom:1px solid #171717;background:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 24px;z-index:10}.preview-header strong{font-size:14px}.preview-header span{color:#707070;font-size:11px}#canvas-root{position:absolute;inset:44px 0 0}.preview-document{position:absolute;right:16px;top:16px;width:min(460px,85vw);max-height:calc(100% - 32px);overflow:auto;background:#fff;border:1px solid #bdbdbd;border-top:3px solid #171717;z-index:30;box-shadow:0 8px 30px #0001}.preview-document header{position:sticky;top:0;background:#fff;padding:12px 16px;display:flex;justify-content:space-between;border-bottom:1px solid #e6e6e6}.preview-document button{border:0;background:#f1f1f1;width:26px;height:26px;cursor:pointer}.preview-document pre{margin:0;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.8 ui-monospace,"SF Mono",Menlo,monospace}
</style></head><body><header class="preview-header"><strong>Blueprint · 座位与分身展示壳</strong><span>3 件工作 · 4 个 seat · 8 个分身 · 25 个节点　｜　只读，模型未启动</span></header><div id="canvas-root"></div><script>${script}</script></body></html>`
const output = join(root, '座位与分身展示图纸.html')
await writeFile(output, html)
console.log(JSON.stringify({ output, snapshot: new Date().toISOString(), nodes: history.lineage.tree.nodes.length, seats: history.lineage.tree.座位们.length, bytes: Buffer.byteLength(html) }, null, 2))
