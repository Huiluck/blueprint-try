import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {落新名册,改名册,记会话,加行,行Of,写工作文档,新工作文档,落名册,建名册,名册路径} from '../roster/src/index.js'
import {DatabaseSync} from 'node:sqlite'
import {项目会话,我是谁} from './src/名册视图.js'

test('冷会话身份从原生元数据识别，不因内存未装载而跳过恢复的等待检查',async()=>{
 const root=await mkdtemp(join(tmpdir(),'Blueprint-冷会话等待身份-'));
 try {
  await 落新名册(root,'冷恢复核对','等节点真实答复');
  await 改名册(root,async m=>{
   await 写工作文档(root,行Of(m,'0'),新工作文档(行Of(m,'0'),'等节点真实答复'));
   return 记会话(m,'0','cold-root');
  });
  const inspected=[];let released=0;
  const ctx={sessions:{get:()=>null},get:key=>key==='sessionQuery'?{observeSession:async (id,options)=>{
   inspected.push(id);assert.equal(options.projectionMode,'none');
   return {header:{cwd:root},get events(){throw new Error('身份读取不应复制事件')},[Symbol.dispose](){released++;}};
  }}:undefined};
  assert.equal((await 我是谁(ctx,'cold-root')).号,'0');
  assert.equal(await 我是谁(ctx,'not-in-roster'),null);
  assert.deepEqual(inspected,['cold-root','not-in-roster']);
  assert.equal(released,2);
  assert.equal(await 我是谁({sessions:{get:()=>null},get:()=>undefined},'missing'),null);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('一份旧名册无效不能阻断其他项目的会话列表与文件根定位',async()=>{
 const good=await mkdtemp(join(tmpdir(),'studio-good-'));
 const bad=await mkdtemp(join(tmpdir(),'studio-old-'));
 try {
  await 落新名册(good,'正常项目','浏览文件');
  await 改名册(good,m=>记会话(加行(记会话(m,'0','root'),'0',{name:'子节点'}).名册,'1','child'));
  // 坏名册：任务库里 0 号的整行被改成不合法的编号（像手改坏了一样）。
  await 落名册(bad,建名册('旧项目'));
  const 库=new DatabaseSync(名册路径(bad));
  库.prepare('UPDATE "任务" SET "全行" = ? WHERE "编号" = ?').run(JSON.stringify({id:'N1',kind:'worker',parent:null,name:'旧项目',status:'开工'}),'0');
  库.close();
  const rows=[{id:'root',cwd:good},{id:'child',cwd:good},{id:'old',cwd:bad,parentSession:'old-parent'}];
  const out=await 项目会话(rows);
  assert.equal(out.length,3);
  assert.equal(out[1].parentSession,'root');
  assert.match(out[2].名册错误,/N1/);
  assert.equal(out[2].parentSession,'old-parent');
  assert.equal(out[2].cwd,bad);
  assert.equal(out[0].名册错误,undefined);
  assert.equal(rows[1].parentSession,undefined,'投影不能修改原始会话记录');
 } finally {await rm(good,{recursive:true,force:true});await rm(bad,{recursive:true,force:true});}
});
