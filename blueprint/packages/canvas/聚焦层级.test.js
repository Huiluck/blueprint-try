import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { 座位聚焦层级, 分身上界, 分身下界, 锚定座位, 座位连线锚点, 座位聚焦镜头 } from './座位呈现.js';

const 局 = {
  helm: {node_id:'root'},
  座位: [
    {key:'seat:视觉',选:{node_id:'visual'}},
    {key:'seat:空位'},
    {key:'seat:独立',独立:true,选:{node_id:'other-work'}},
  ],
  直属: [{node_id:'direct'}],
};

test('总 seat 本身清晰，直属座位保留轮廓，当前任务轻虚化，深层退出焦点',()=>{
  const focus=座位聚焦层级('helm',局);
  assert.equal(focus.座位('helm'),''); assert.equal(focus.节点('root','helm'),'');
  assert.equal(focus.座位('seat:视觉'),'context');
  assert.equal(focus.节点('visual','seat:视觉'),'soft');
  assert.equal(focus.节点('visual-child','seat:视觉'),'muted');
  assert.equal(focus.节点('direct','直属:direct'),'soft');
  assert.equal(focus.节点('direct-child','直属:direct'),'muted');
  assert.equal(focus.轨道('helm'),''); assert.equal(focus.轨道('seat:视觉'),'soft');
});

test('空座位仍呈现组织位置，其他工作的独立分身不混入当前工作焦点',()=>{
  const focus=座位聚焦层级('helm',局);
  assert.equal(focus.座位('seat:空位'),'context');
  assert.equal(focus.座位('seat:独立'),'muted');
  assert.equal(focus.节点('other-work','seat:独立'),'muted');
  assert.equal(focus.轨道('seat:独立'),'muted');
  assert.equal(focus.节点(undefined,undefined),'muted');
});

test('主干与深层连线采用不同层次，子 seat 的工作树仍完整清晰',()=>{
  const main=座位聚焦层级('helm',局),child=座位聚焦层级('seat:视觉',局);
  assert.equal(main.连线('visual','seat:视觉'),'context');
  assert.equal(main.连线('direct','直属:direct'),'context');
  assert.equal(main.连线('visual-child','seat:视觉'),'muted');
  for(const id of ['visual','visual-child','visual-grandchild']){
    assert.equal(child.节点(id,'seat:视觉'),'');
    assert.equal(child.连线(id,'seat:视觉'),'');
  }
  assert.equal(child.座位('seat:视觉'),''); assert.equal(child.座位('helm'),'muted');
  assert.equal(child.节点('direct','直属:direct'),'muted');
});

test('收起选择恢复所有对象，切工作后的新分身采用新焦点集合',()=>{
  const closed=座位聚焦层级(null,局);
  for(const key of ['helm','seat:视觉','seat:独立','unknown']){
    assert.equal(closed.座位(key),''); assert.equal(closed.节点(key,key),'');
    assert.equal(closed.连线(key,key),''); assert.equal(closed.轨道(key),'');
  }
  const next=座位聚焦层级('helm',{...局,helm:{node_id:'next-root'},座位:[{key:'seat:视觉',选:{node_id:'next-visual'}}]});
  assert.equal(next.节点('next-root','helm'),''); assert.equal(next.节点('root','helm'),'muted');
  assert.equal(next.节点('next-visual','seat:视觉'),'soft'); assert.equal(next.节点('visual','seat:视觉'),'muted');
});

const source=readFileSync(new URL('./画布.js',import.meta.url),'utf8');
const start=source.indexOf('const 卡边 ='),end=source.indexOf('function Canvas(',start);
const context={分身上界, 分身下界,锚定座位,座位连线锚点};
vm.runInNewContext(source.slice(start,end)+'\nthis.layout=排座位;',context);
test('总览范围只围绕第一层组织，深层工作树和折叠不拉宽主 seat 镜头',()=>{
  const root={node_id:'root',children:[]},child={node_id:'visual',children:['deep']},deep={node_id:'deep',children:['deepest']},deepest={node_id:'deepest',children:[]};
  const direct={node_id:'direct',children:['direct-deep']},directDeep={node_id:'direct-deep',children:[]};
  const nodes=[root,child,deep,deepest,direct,directDeep];
  const size={宽:()=>200,高:()=>74,孩子:node=>node.children.map(id=>nodes.find(n=>n.node_id===id))};
  const layout=context.layout(nodes,size,{...局,helm:root,works:[root],座位:[{key:'seat:视觉',选:child}],直属:[direct]});
  const seat=layout.框.find(card=>card.key==='helm'),right=Math.max(...layout.框.map(card=>card.x+card.w),layout.pos.direct.x+200);
  assert.equal(layout.总览.x1,right);
  assert.ok(layout.总览.x1<layout.pos.deepest.x);
  assert.ok(layout.总览.x1<layout.界.x1);
  const area={L:40,T:56,W:900,r:{height:800}};
  const camera=座位聚焦镜头(seat,layout.总览,area,'r',layout.总控.y);
  const groupMiddle=camera.x+(seat.x+right)/2*camera.z;
  assert.ok(Math.abs(groupMiddle-(area.L+area.W/2))<1e-8);
  assert.ok(camera.y+layout.总控.y*camera.z>=area.T);
});
