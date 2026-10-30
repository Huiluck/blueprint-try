// 经首页小样确认的单次八秒镜头；只绘制装饰性组织，不创建项目或节点。
function mountBlueprintHomeScene(host, { onProgress = () => {} } = {}) {
 host.innerHTML = `<svg class="bp-home-canvas" role="img" aria-label="从一枚 Blueprint 原始节点开始，逐个长出分工；镜头连续拉远，显露更多相连的组织。">
        <defs>
          <pattern id="bp-home-minor" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" class="bp-home-minor-line"/></pattern>
          <pattern id="bp-home-major" width="120" height="120" patternUnits="userSpaceOnUse"><path d="M120 0H0V120" class="bp-home-major-line"/></pattern>
        </defs>
        <g data-camera>
          <rect x="-4000" y="-4000" width="8000" height="8000" fill="url(#bp-home-minor)"/>
          <rect x="-4000" y="-4000" width="8000" height="8000" fill="url(#bp-home-major)"/>
          <g data-world-frames></g><g data-wires></g><g data-nodes></g><g data-messages></g>
        </g>
      </svg>`;
 const svg=host.querySelector('svg'),camera=host.querySelector('[data-camera]'),wireLayer=host.querySelector('[data-wires]'),nodeLayer=host.querySelector('[data-nodes]'),messageLayer=host.querySelector('[data-messages]'),frameLayer=host.querySelector('[data-world-frames]');
 const NS='http://www.w3.org/2000/svg',clamp=x=>Math.max(0,Math.min(1,x)),mix=(a,b,t)=>a+(b-a)*t;
 const smooth=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10)},out=x=>1-Math.pow(1-clamp(x),3);
 const el=(tag,attrs,parent,text)=>{const e=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attrs||{}))e.setAttribute(key,value);if(text!==undefined)e.textContent=text;if(parent)parent.append(e);return e};
 const nodes=[],edges=[],frames=[];const sceneKey='bp-home-node';
 function add(x,y,name,task,born,parent,group='main'){
  const id=nodes.length,node={id,x,y,name,task,born,parent,group};nodes.push(node);
  if(parent!==null){const p=nodes[parent],edgeX=p.x+200,spine=p.x+252,d=`M${edgeX} ${p.y+37}H${spine}V${y+37}H${x}`;edges.push({p:parent,c:id,born:Math.max(.25,born-.48),d})}return id;
 }
 const anchor=add(0,-37,'目标与方向','做一个可以试玩的塔防游戏',-.65,null);
 const first=[add(310,-217,'玩法与体验','梳理核心玩法和交互',1.22,anchor),add(310,143,'工程与实现','建立可运行的工程',1.62,anchor)];
 const middle=[];for(let i=0;i<4;i++){const y=-270+i*180;middle.push(add(620,y-37,['关卡设计','视觉与反馈','核心逻辑','集成验证'][i],['组织节奏与难度','建立清晰的视觉层次','实现关键系统','检查运行与交付'][i],2.15+i*.32,first[Math.floor(i/2)]))}
 for(let i=0;i<8;i++){const y=-315+i*90;add(930,y-37,['地图布局','敌人配置','界面组件','反馈动效','战斗系统','资源管理','自动检查','试玩迭代'][i],['落地细节并检查结果','按反馈持续修正'][i%2],3.40+i*.17,middle[Math.floor(i/2)])}
 const larger=add(-330,-37,'Blueprint','围绕目标，组织持续生长',5.25,null,'outer');
 edges.push({p:larger,c:anchor,born:5.1,d:'M-130 0H0'});
 function neighboring(y,label,start){
  const p=add(0,y-37,label,'自主分工，推进另一项工作',start,larger,'outer');
  const children=[add(310,y-207,'设计与探索','形成可以执行的方案',start+.38,p,'outer'),add(310,y+133,'实现与验证','推进工作并交付结果',start+.60,p,'outer')];
  const leaves=[];for(let i=0;i<4;i++)leaves.push(add(620,y-292+i*170,['收集与整理','分析与判断','制作与检查','整合与交付'][i],'推进当前分工',start+.85+i*.16,children[Math.floor(i/2)],'outer'));return {root:p,leaves};
 }
 const upper=neighboring(-740,'新的研究目标',5.55),lower=neighboring(740,'另一支创作团队',5.8);
 const right=add(1240,-37,'成果与下一步','交付之后，新的组织继续展开',6.15,null,'outer');
 edges.push({p:middle[3],c:right,born:6.0,d:'M820 270H1190V0H1240'});
 const rightChildren=[add(1550,-207,'延伸与探索','继续发现新的可能',6.7,right,'outer'),add(1550,133,'完善与应用','让成果继续产生作用',6.95,right,'outer')];
 for(let i=0;i<4;i++)add(1860,-292+i*170,['新的任务','新的分工','新的协作','新的成果'][i],'工作仍在继续',7.15+i*.14,rightChildren[Math.floor(i/2)],'outer');
 function sideTeam(y,label,start,parent){
  const p=add(1120,y-37,label,'一支新的组织正在展开',start,parent,'outer');
  const children=[add(1430,y-167,'探索与设计','构建下一步的方案',start+.12,p,'outer'),add(1430,y+93,'实现与交付','持续推进新的工作',start+.17,p,'outer')];
  for(let i=0;i<4;i++)add(1740,y-232+i*130,['方向探索','细节实现','检查反馈','整合交付'][i],'让新的分工继续生长',start+.22+i*.04,children[Math.floor(i/2)],'outer');
 }
 sideTeam(-640,'产品与体验',6.9,upper.leaves[1]);sideTeam(640,'内容与表达',6.95,lower.leaves[0]);
 function organizationFrame(x,y,w,h,label,born){const g=el('g',{},frameLayer);el('path',{d:`M${x+28} ${y}H${x+w}V${y+h}H${x}V${y+28}`,class:'bp-org-frame'},g);el('text',{x:x+12,y:y-12,class:'bp-org-frame-label'},g,label);frames.push({g,born})}
 organizationFrame(-24,-390,1180,780,'PROJECT / 目标长成一支组织',4.7);
 organizationFrame(-24,-1100,880,720,'RESEARCH / 组织仍在生长',6.35);
 organizationFrame(-24,380,880,720,'CREATE / 每个局部都在推进',6.55);
 organizationFrame(1096,-930,880,580,'PRODUCT / 新的团队',7.0);
 organizationFrame(1096,350,880,580,'STUDIO / 持续创造',7.1);
 for(const edge of edges){edge.path=el('path',{d:edge.d,class:'bp-org-wire'},wireLayer);edge.length=edge.path.getTotalLength();edge.path.style.strokeDasharray=edge.length;edge.packet=el('rect',{width:4,height:4,class:'bp-org-message'},messageLayer)}
 for(const n of nodes){
  n.g=el('g',{transform:`translate(${n.x} ${n.y})`,'data-node':n.id},nodeLayer);
  n.paper=el('rect',{width:200,height:74,class:'bp-node-paper'},n.g);
  const clip=el('clipPath',{id:`${sceneKey}-${n.id}`},svg.querySelector('defs'));n.clip=el('rect',{width:0,height:74},clip);
  n.detail=el('g',{'clip-path':`url(#${sceneKey}-${n.id})`},n.g);
  el('rect',{width:200,height:28,class:'bp-node-header'},n.detail);
  el('path',{d:'M0 28H200M24 28V74M152 0V28M176 0V28',class:'bp-node-divider'},n.detail);
  el('text',{x:7,y:18,class:'bp-node-number'},n.detail,String(n.id).padStart(2,'0'));
  el('text',{x:32,y:18,class:'bp-node-name'},n.detail,n.name);
  el('text',{x:160,y:18,class:'bp-node-action'},n.detail,'■');el('text',{x:182,y:18,class:'bp-node-action'},n.detail,'↻');
  el('rect',{x:.5,y:28.5,width:23,height:45,class:'bp-node-rail'},n.detail);
  n.bars=[];for(let j=0;j<3;j++)n.bars.push(el('rect',{x:6+j*4,y:47,width:2,height:8,class:'bp-node-wave'},n.detail));
  el('text',{x:33,y:47,class:'bp-node-task'},n.detail,n.task);
  el('text',{x:33,y:64,class:'bp-node-meta'},n.detail,'Run / Working');
  n.outline=el('path',{d:'M0 37V0H200V74H0V37',class:'bp-node-outline'},n.g);n.length=n.outline.getTotalLength();n.outline.style.strokeDasharray=n.length;
 }

 let width=1,height=1,last=0,time=0,active=false,disposed=false,raf=0;
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 if(reduced.matches)time=8;
 function render(t) {
  const stageOne=smooth((t-1.15)/3.65),stageTwo=smooth((t-4.8)/3.2);
  const scale=Math.min(width/736,height/510),vw=width/scale,vh=height/scale;
  const firstZoom=Math.min(.59,(vw-72)/1130,(vh-80)/704)*scale,initialZoom=Math.min(1.12,(vw-56)/520)*scale;
  const lastZoom=Math.min(.29,(vw-50)/2200)*scale;
  const z=mix(mix(initialZoom,firstZoom,stageOne),lastZoom,stageTwo),cx=mix(mix(100,565,stageOne),760,stageTwo),cy=mix(0,-12,stageTwo);
  camera.setAttribute('transform',`translate(${width*mix(.32,.5,stageOne)} ${height*.49}) scale(${z}) translate(${-cx} ${-cy})`);
  for(const edge of edges){const p=out((t-edge.born)/.60);edge.path.style.strokeDashoffset=edge.length*(1-p);edge.path.style.opacity=p===0?0:1;const age=t-nodes[edge.c].born,phase=(age-1.1+edge.c*.13)%3.5,show=age>1.1&&phase>=0&&phase<1.55;edge.packet.style.opacity=show?.65:0;if(show){const point=edge.path.getPointAtLength(edge.length*smooth(phase/1.55));edge.packet.setAttribute('x',point.x-2);edge.packet.setAttribute('y',point.y-2)}}
  for(const n of nodes){const p=out((t-n.born)/.64),detail=out((t-n.born-.18)/.52);n.g.style.opacity=p>0?1:0;n.g.setAttribute('transform',`translate(${n.x-6*(1-p)} ${n.y})`);n.outline.style.strokeDashoffset=n.length*(1-p);n.paper.style.opacity=p*.98;n.clip.setAttribute('width',200*detail);n.detail.style.opacity=detail;
   const legibility=1-smooth((.46-z)/.2);n.detail.querySelector('.bp-node-task').style.opacity=legibility;n.detail.querySelector('.bp-node-meta').style.opacity=legibility;
   n.bars.forEach((bar,j)=>{const wave=.45+.55*(.5+.5*Math.sin(t*4.6-j*.8-n.id*.2));bar.setAttribute('height',4+5*wave);bar.setAttribute('y',51-(4+5*wave)/2);bar.style.opacity=.5+.5*wave})}
  for(const f of frames)f.g.style.opacity=smooth((t-f.born)/1.05)*.8;

  host.style.opacity=1-smooth(clamp((t-6)/2)/.9);
  host.style.filter=`blur(${smooth(clamp((t-6)/2)/.48)*1.05}px)`;
  host.dataset.time=t.toFixed(3);
  onProgress(t);
 }
 function draw(){width=Math.max(1,svg.clientWidth);height=Math.max(1,svg.clientHeight);svg.setAttribute('viewBox',`0 0 ${width} ${height}`);render(time);}
 function stop(){cancelAnimationFrame(raf);raf=0;last=0;}
 function tick(now){
  raf=0;if(disposed||!active||document.hidden)return;
 // 保留八秒时间轴的相对节奏，以 1.6 倍播放，实际约五秒完成。
 if(last)time=Math.min(8,time+Math.min(50,now-last)/1000*1.6);
  last=now;render(time);
  if(time<8)raf=requestAnimationFrame(tick);else last=0;
 }
 function resume(){if(active&&!disposed&&!document.hidden&&time<8&&!raf)raf=requestAnimationFrame(tick);}
 function visibility(){stop();resume();}
 function finish(){stop();time=8;draw();}
 function motionChange(){if(reduced.matches)finish();}
 const observer=new ResizeObserver(draw);observer.observe(host);
 document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',motionChange);draw();
 return {setActive(value){active=value;stop();draw();resume();},finish,get time(){return time;},dispose(){disposed=true;stop();observer.disconnect();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',motionChange);host.replaceChildren();}};
}
