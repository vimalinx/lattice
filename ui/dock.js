"use strict";
/* The panel layout: splits, tab stacks and floating windows. The layout belongs to the learner:
   agents never move or close a panel; what they open lands in an existing stack of the same side. */
const Dock={layout:null,panels:{},els:{},types:{},focus:null,lastStack:{ai:null,mine:null},saveTimer:null,drag:null};
function panelType(name,def){Dock.types[name]=def;}
function newId(prefix){return prefix+Math.random().toString(36).slice(2,10);}
function stackNode(tabs){return {t:"stack",id:newId("s"),tabs,active:tabs[0]||null};}
/* Out of the box: the main conversation and quick answers apart on the left, the learner's side on the right. */
function factoryLayout(){
 const main=newId("p"),flash=newId("p"),home=newId("p");
 return {panels:{[main]:{type:"chat",agent:"tutor"},[flash]:{type:"chat",agent:"flash"},[home]:{type:"home"}},
  layout:{root:{t:"split",id:newId("n"),dir:"h",sizes:[.46,.54],kids:[{t:"split",id:newId("n"),dir:"v",sizes:[.7,.3],kids:[stackNode([main]),stackNode([flash])]},stackNode([home])]},floats:[]}};
}
function defaultChoice(){
 const preset=S.ui?.default_preset&&S.ui.presets?.[S.ui.default_preset];
 return preset?JSON.parse(JSON.stringify(preset)):factoryLayout();
}
function defaultLayout(){const chosen=defaultChoice();Dock.panels=chosen.panels;return chosen.layout;}
/* Replace the whole layout; panels that stay keep their state, the rest are closed. */
async function applyLayout(saved){
 if(typeof flushAll==="function")await flushAll();
 const next=JSON.parse(JSON.stringify(saved));
 for(const pid of Object.keys(Dock.panels)){
  const keep=next.panels[pid]&&panelKey(next.panels[pid])===panelKey(Dock.panels[pid]);
  if(keep){Dock.panels[pid]=next.panels[pid];applyView(pid);}
  else{const t=Dock.types[Dock.panels[pid].type];const node=Dock.els[pid];delete Dock.panels[pid];delete Dock.els[pid];if(t?.unmount)safe(()=>t.unmount({},node));node?.remove();}
 }
 Dock.layout=next.layout;Dock.layout.floats=Dock.layout.floats||[];
 for(const [pid,params] of Object.entries(next.panels))if(!Dock.panels[pid]){Dock.panels[pid]=params;mountPanel(pid);}
 tidy();renderDock();saveLayout();
}
function currentLayout(){return JSON.parse(JSON.stringify({layout:Dock.layout,panels:Dock.panels}));}
function sideOf(pid){const p=Dock.panels[pid];return p?(Dock.types[p.type]?.side||"mine"):"mine";}

/* ---- tree helpers ---------------------------------------------------------------------------- */
function eachStack(fn){
 const walk=n=>{if(!n)return;if(n.t==="stack")fn(n);else n.kids.forEach(walk);};
 walk(Dock.layout.root);Dock.layout.floats.forEach(f=>fn(f.stack,f));
}
function findStack(id){let found=null;eachStack(s=>{if(s.id===id)found=s;});return found;}
function stackOf(pid){let found=null;eachStack(s=>{if(s.tabs.includes(pid))found=s;});return found;}
function parentOf(target,n=Dock.layout.root,parent=null){
 if(n===target)return parent;
 if(n.t==="split")for(const k of n.kids){const r=parentOf(target,k,n);if(r!==undefined)return r;}
 return undefined;
}
function normalize(n){
 if(n.t==="stack")return n.tabs.length?n:null;
 const kids=[],sizes=[];
 n.kids.forEach((k,i)=>{const kept=normalize(k);if(!kept)return;
  if(kept.t==="split"&&kept.dir===n.dir){kept.kids.forEach((kk,j)=>{kids.push(kk);sizes.push(n.sizes[i]*kept.sizes[j]);});}
  else{kids.push(kept);sizes.push(n.sizes[i]);}});
 if(!kids.length)return null;
 if(kids.length===1)return kids[0];
 const total=sizes.reduce((a,b)=>a+b,0)||1;
 return {...n,kids,sizes:sizes.map(s=>s/total)};
}
function tidy(){
 Dock.layout.root=normalize(Dock.layout.root)||stackNode([]);
 Dock.layout.floats=Dock.layout.floats.filter(f=>f.stack.tabs.length);
 eachStack(s=>{if(!s.tabs.includes(s.active))s.active=s.tabs[s.tabs.length-1]||null;});
}
function detach(pid){
 const s=stackOf(pid);if(!s)return;
 s.tabs=s.tabs.filter(x=>x!==pid);if(s.active===pid)s.active=s.tabs[s.tabs.length-1]||null;
}
function splitBeside(target,zone,newStack){
 const dir=zone==="left"||zone==="right"?"h":"v",before=zone==="left"||zone==="top";
 const parent=parentOf(target);
 if(parent&&parent.dir===dir){
  const at=parent.kids.indexOf(target),share=parent.sizes[at]/2;
  parent.kids.splice(before?at:at+1,0,newStack);parent.sizes.splice(at,1,share,share);
  return;
 }
 const split={t:"split",id:newId("n"),dir,sizes:[.5,.5],kids:before?[newStack,target]:[target,newStack]};
 if(!parent){Dock.layout.root=split;return;}
 parent.kids[parent.kids.indexOf(target)]=split;
}
/* ---- opening and closing ----------------------------------------------------------------------- */
function panelKey(p){return p.type+":"+(p.path||p.thread||p.agent||"")+(p.type==="chat"&&!p.thread?":follow":"");}
function findPanel(params){const key=panelKey(params);return Object.keys(Dock.panels).find(pid=>panelKey(Dock.panels[pid])===key)||null;}
function targetStack(side){
 const remembered=findStack(Dock.lastStack[side]);
 if(remembered)return remembered;
 let found=null;eachStack(s=>{if(!found&&s.tabs.some(pid=>sideOf(pid)===side))found=s;});
 if(found)return found;
 // No stack of this side yet: open one beside everything, AI on the left, mine on the right.
 const s=stackNode([]),root=Dock.layout.root;
 if(root.t==="stack"&&!root.tabs.length){Dock.layout.root=s;return s;}
 Dock.layout.root={t:"split",id:newId("n"),dir:"h",sizes:[.5,.5],kids:side==="ai"?[s,root]:[root,s]};
 return s;
}
function openPanel(params,opts={}){
 let pid=opts.reuse===false?null:findPanel(params);
 if(pid){activate(pid);if(opts.then)opts.then(pid);return pid;}
 pid=newId("p");Dock.panels[pid]=params;
 const side=Dock.types[params.type]?.side||"mine";
 const stack=opts.stack?findStack(opts.stack)||targetStack(side):targetStack(side);
 stack.tabs.push(pid);
 if(opts.activate!==false)stack.active=pid;
 mountPanel(pid);renderDock();saveLayout();
 if(opts.then)opts.then(pid);
 return pid;
}
function activate(pid){const s=stackOf(pid);if(!s)return;s.active=pid;Dock.focus=pid;Dock.lastStack[sideOf(pid)]=s.id;renderDock();saveLayout();}
async function closePanel(pid){
 const p=Dock.panels[pid],type=Dock.types[p?.type];
 if(type?.beforeClose&&await type.beforeClose(p,Dock.els[pid])===false)return;
 detach(pid);delete Dock.panels[pid];
 const node=Dock.els[pid];delete Dock.els[pid];
 if(type?.unmount)safe(()=>type.unmount(p,node));
 node?.remove();
 tidy();renderDock();saveLayout();
}
function mountPanel(pid){
 const p=Dock.panels[pid],type=Dock.types[p.type];
 const node=document.createElement("div");node.className="panel panel-"+p.type;node.dataset.pid=pid;
 Dock.els[pid]=node;applyView(pid);
 if(type)safe(()=>type.mount(p,node,pid));else node.innerHTML=emptyState("info","这个面板打不开","面板类型 "+p.type+" 不存在。");
}
function float(pid){
 detach(pid);
 const rect=el("#dock").getBoundingClientRect();
 Dock.layout.floats.push({id:newId("f"),x:Math.round(rect.width*.25),y:70,w:Math.round(Math.max(480,Math.min(760,rect.width*.5))),h:Math.round(rect.height*.7),stack:stackNode([pid])});
 tidy();renderDock();saveLayout();
}
/* Size: each kind of panel has a default in the settings; a window can set its own, kept in the layout.
   Line height and reading width likewise fall back to the settings unless the window sets its own. */
const VIEW_KEYS=["line_height","read_width"];
function zoomKind(p){return p.type==="chat"?"chat:"+(p.agent||"tutor"):p.type;}
function zoomDefault(p){return Number(S.ui.zoom?.[zoomKind(p)])||1;}
function zoomOf(p){return Number(p.zoom)||zoomDefault(p);}
function applyView(pid){
 const node=Dock.els[pid],p=Dock.panels[pid];if(!node||!p)return;
 node.style.zoom=zoomOf(p);
 if(p.line_height)node.style.setProperty("--line-height",String(p.line_height));else node.style.removeProperty("--line-height");
 if(p.read_width)node.style.setProperty("--read-width",readWidth(p.read_width));else node.style.removeProperty("--read-width");
}
function viewOf(p,key){return key==="zoom"?zoomOf(p):p[key]??S.ui[key];}
function setView(pid,key,value){
 if(key==="zoom")return setZoom(pid,value);
 const p=Dock.panels[pid];if(!p||!VIEW_KEYS.includes(key))return;
 if(value==null||value===""||value===S.ui[key])delete p[key];else p[key]=value;
 applyView(pid);const t=Dock.types[p.type],node=Dock.els[pid];if(t?.shown&&node?.isConnected)t.shown(p,node);
 saveLayout();
}
function setZoom(pid,value){
 const p=Dock.panels[pid];if(!p)return;
 const z=value==null?null:Math.round(Math.min(2.5,Math.max(.6,Number(value)))*20)/20;
 if(z==null||Math.abs(z-zoomDefault(p))<.001)delete p.zoom;else p.zoom=z;
 applyView(pid);refreshTab(pid);
 const t=Dock.types[p.type],node=Dock.els[pid];if(t?.shown&&node?.isConnected)t.shown(p,node);
 saveLayout();
}
function stepZoom(pid,dir){const p=Dock.panels[pid];if(p)setZoom(pid,dir?zoomOf(p)+dir*.1:null);}
function zoomBadge(pid){const p=Dock.panels[pid];return p?.zoom?Math.round(p.zoom*100)+"%":"";}
function panelTitle(pid){const p=Dock.panels[pid];return Dock.types[p.type]?.title(p,Dock.els[pid])||p.type;}
function refreshTab(pid){
 const tab=el('.tab[data-pid="'+pid+'"] .tab-title');if(!tab)return;
 const p=Dock.panels[pid];tab.textContent=panelTitle(pid);
 const badge=tab.parentElement.querySelector(".tab-zoom");if(badge)badge.textContent=zoomBadge(pid);
 tab.parentElement.classList.toggle("dirty",!!Dock.types[p.type]?.dirty?.(p,Dock.els[pid]));
}

/* ---- rendering ----------------------------------------------------------------------------------- */
function renderDock(){
 const host=el("#dock");if(!host)return;
 Object.values(Dock.els).forEach(n=>n.parentElement&&n.remove());
 host.innerHTML="";host.appendChild(nodeEl(Dock.layout.root));
 const floats=el("#floats");floats.innerHTML="";
 Dock.layout.floats.forEach(f=>{
  const w=h('<div class="float" data-float="'+f.id+'" style="left:'+f.x+'px;top:'+f.y+'px;width:'+f.w+'px;height:'+f.h+'px"><div class="float-resize" data-float-resize="'+f.id+'"></div></div>');
  w.prepend(stackEl(f.stack,f));floats.appendChild(w);
 });
}
function nodeEl(n){
 if(n.t==="stack")return stackEl(n);
 const box=h('<div class="split '+n.dir+'"></div>');
 n.kids.forEach((k,i)=>{
  if(i)box.appendChild(h('<div class="gutter" data-split="'+n.id+'" data-index="'+i+'"></div>'));
  const cell=nodeEl(k);cell.style.flex=n.sizes[i]+" 1 0";box.appendChild(cell);
 });
 return box;
}
function stackEl(s,floating=null){
 const node=h('<div class="stack" data-stack="'+s.id+'"><div class="tabs" data-stack="'+s.id+'"></div><div class="stack-body" data-stack="'+s.id+'"></div></div>');
 const bar=node.firstElementChild;
 s.tabs.forEach(pid=>{
  const p=Dock.panels[pid],type=Dock.types[p?.type]||{};
  bar.appendChild(h('<div class="tab'+(pid===s.active?" active":"")+(type.side==="ai"?" ai":"")+'" draggable="true" data-pid="'+pid+'" title="'+esc(panelTitle(pid))+'">'+
   svg(typeof type.icon==="function"?type.icon(p):type.icon||"file",13)+'<span class="tab-title">'+esc(panelTitle(pid))+'</span><small class="tab-zoom" title="这个窗口单独调过大小；右键标签可以恢复">'+zoomBadge(pid)+'</small>'+
   (floating?"":'<button class="tab-btn" data-action="dock-float" data-pid="'+pid+'" title="浮出">'+svg("float",12)+'</button>')+
   '<button class="tab-btn" data-action="dock-close" data-pid="'+pid+'" title="关闭">'+svg("close",12)+'</button></div>'));
 });
 bar.appendChild(h('<div class="tabs-fill" data-stack="'+s.id+'"'+(floating?' data-float-move="'+floating.id+'"':"")+'></div>'));
 if(s.active&&Dock.els[s.active]){
  node.lastElementChild.appendChild(Dock.els[s.active]);
  // Sizes measured while a panel was detached are wrong; let it fit itself once it is visible.
  const p=Dock.panels[s.active],t=Dock.types[p?.type];if(t?.shown)requestAnimationFrame(()=>t.shown(p,Dock.els[s.active]));
 }
 else if(!s.tabs.length)node.lastElementChild.appendChild(h('<div class="stack-empty">'+emptyState("layout","这里是空的","把标签拖到这里，或者从上面的「＋」打开。")+'</div>'));
 return node;
}
function saveLayout(){
 clearTimeout(Dock.saveTimer);
 Dock.saveTimer=setTimeout(()=>safe(()=>rpc("layout_save",{layout:{layout:Dock.layout,panels:Dock.panels}})),600);
 if(typeof reportScreen==="function")reportScreen();
}
function loadLayout(saved){
 const ok=saved&&saved.layout&&saved.panels&&saved.layout.root;
 if(ok){Dock.layout=saved.layout;Dock.panels=saved.panels;Dock.layout.floats=Dock.layout.floats||[];
  const known=new Set();eachStack(s=>{s.tabs=s.tabs.filter(pid=>Dock.panels[pid]&&Dock.types[Dock.panels[pid].type]);s.tabs.forEach(t=>known.add(t));});
  Object.keys(Dock.panels).forEach(pid=>{if(!known.has(pid))delete Dock.panels[pid];});
  tidy();
 }
 if(!ok||!Object.keys(Dock.panels).length)Dock.layout=defaultLayout();
 Object.keys(Dock.panels).forEach(mountPanel);
 renderDock();
}

/* ---- interaction: tabs, dragging, splitters, floats ------------------------------------------------- */
function dropZone(stackBody,x,y){
 const r=stackBody.getBoundingClientRect(),fx=(x-r.left)/r.width,fy=(y-r.top)/r.height;
 if(fx<.22)return "left";if(fx>.78)return "right";if(fy<.22)return "top";if(fy>.78)return "bottom";return "center";
}
function showDrop(target,zone){
 const mark=el("#drop-mark");if(!target){mark.style.display="none";return;}
 const r=target.getBoundingClientRect(),box={left:r.left,top:r.top,width:r.width,height:r.height};
 if(zone==="left")box.width/=2;if(zone==="right"){box.left+=r.width/2;box.width/=2;}
 if(zone==="top")box.height/=2;if(zone==="bottom"){box.top+=r.height/2;box.height/=2;}
 Object.assign(mark.style,{display:"block",left:box.left+"px",top:box.top+"px",width:box.width+"px",height:box.height+"px"});
}
function initDock(){
 document.addEventListener("dragstart",e=>{
  const tab=e.target.closest?.(".tab");if(!tab)return;
  Dock.drag=tab.dataset.pid;e.dataTransfer.setData("text/lattice-panel",tab.dataset.pid);e.dataTransfer.effectAllowed="move";
 });
 document.addEventListener("dragend",()=>{Dock.drag=null;showDrop(null);});
 document.addEventListener("dragover",e=>{
  if(!Dock.drag)return;
  const body=e.target.closest?.(".stack-body"),bar=e.target.closest?.(".tabs");
  if(body){e.preventDefault();showDrop(body,body.closest(".float")?"center":dropZone(body,e.clientX,e.clientY));}
  else if(bar){e.preventDefault();showDrop(bar,"center");}
  else showDrop(null);
 });
 document.addEventListener("drop",e=>{
  const pid=Dock.drag;if(!pid)return;
  const body=e.target.closest?.(".stack-body"),bar=e.target.closest?.(".tabs");
  if(!body&&!bar)return;e.preventDefault();showDrop(null);Dock.drag=null;
  const target=findStack((body||bar).dataset.stack);if(!target)return;
  // A floating window holds one stack, so anything dropped on it joins that stack.
  const floating=Dock.layout.floats.some(f=>f.stack===target);
  const zone=body&&!floating?dropZone(body,e.clientX,e.clientY):"center";
  if(zone==="center"){
   if(target.tabs.includes(pid)&&!bar)return;
   detach(pid);
   const over=e.target.closest?.(".tab"),at=over?target.tabs.indexOf(over.dataset.pid):-1;
   target.tabs.splice(at<0?target.tabs.length:at,0,pid);target.active=pid;
  }else{
   if(target.tabs.length===1&&target.tabs[0]===pid)return;
   detach(pid);splitBeside(target,zone,stackNode([pid]));
  }
  Dock.lastStack[sideOf(pid)]=stackOf(pid)?.id;
  tidy();renderDock();saveLayout();
 });
 document.addEventListener("mousedown",e=>{
  const tab=e.target.closest?.(".tab");
  if(tab&&!e.target.closest(".tab-btn")){activate(tab.dataset.pid);return;}
  const gutter=e.target.closest?.(".gutter");
  if(gutter){e.preventDefault();startResize(gutter,e);return;}
  const move=e.target.closest?.("[data-float-move]"),size=e.target.closest?.("[data-float-resize]");
  if(move||size){e.preventDefault();startFloatDrag((move||size).dataset.floatMove||size.dataset.floatResize,!!size,e);return;}
  const panel=e.target.closest?.(".panel");
  if(panel){const pid=panel.dataset.pid,s=stackOf(pid);Dock.focus=pid;if(s)Dock.lastStack[sideOf(pid)]=s.id;}
 },true);
}
function findSplit(id,n=Dock.layout.root){
 if(n.t!=="split")return null;if(n.id===id)return n;
 for(const k of n.kids){const r=findSplit(id,k);if(r)return r;}return null;
}
function startResize(gutter,e){
 const split=findSplit(gutter.dataset.split);if(!split)return;
 const i=+gutter.dataset.index,box=gutter.parentElement.getBoundingClientRect(),horizontal=split.dir==="h";
 const total=horizontal?box.width:box.height,start=horizontal?e.clientX:e.clientY,a=split.sizes[i-1],b=split.sizes[i];
 const cells=[...gutter.parentElement.children].filter(c=>!c.classList.contains("gutter"));
 const move=ev=>{
  const delta=((horizontal?ev.clientX:ev.clientY)-start)/total,min=.08;
  const na=Math.max(min,Math.min(a+b-min,a+delta));split.sizes[i-1]=na;split.sizes[i]=a+b-na;
  cells[i-1].style.flex=split.sizes[i-1]+" 1 0";cells[i].style.flex=split.sizes[i]+" 1 0";
 };
 const up=()=>{document.removeEventListener("mousemove",move);document.removeEventListener("mouseup",up);document.body.classList.remove("resizing");saveLayout();};
 document.body.classList.add("resizing");document.addEventListener("mousemove",move);document.addEventListener("mouseup",up);
}
function startFloatDrag(id,resize,e){
 const f=Dock.layout.floats.find(x=>x.id===id);if(!f)return;
 const node=el('[data-float="'+id+'"]'),sx=e.clientX,sy=e.clientY,start={...f};
 const move=ev=>{
  if(resize){f.w=Math.max(280,start.w+ev.clientX-sx);f.h=Math.max(200,start.h+ev.clientY-sy);}
  else{f.x=Math.max(0,start.x+ev.clientX-sx);f.y=Math.max(0,start.y+ev.clientY-sy);}
  Object.assign(node.style,{left:f.x+"px",top:f.y+"px",width:f.w+"px",height:f.h+"px"});
 };
 const up=()=>{document.removeEventListener("mousemove",move);document.removeEventListener("mouseup",up);document.body.classList.remove("resizing");saveLayout();};
 document.body.classList.add("resizing");document.addEventListener("mousemove",move);document.addEventListener("mouseup",up);
}

/* ---- the agents' hands on the interface -------------------------------------------------------------- */
const UiSnapshots={};
function resolvePanel(ref){
 if(!ref)return null;
 if(Dock.panels[ref])return ref;
 const ids=Object.keys(Dock.panels),title=String(ref);
 return ids.find(pid=>panelTitle(pid)===title)||ids.find(pid=>Dock.panels[pid].path===title)||ids.find(pid=>panelTitle(pid).includes(title))||null;
}
function paramsOf(op){
 const type=op.panel||"file";
 if(type==="chat")return {type,agent:op.agent||"tutor",...(op.thread?{thread:op.thread}:{})};
 if(type==="file"){if(!op.path)throw new Error("打开文件要给 path");return {type,path:op.path};}
 if(type==="map")return {type,topic:op.topic||null};
 if(!Dock.types[type])throw new Error("没有这种面板："+type);
 return {type};
}
function placePanel(pid,where,to){
 where=where||"tab";
 if(where==="float"){detach(pid);const rect=el("#dock").getBoundingClientRect();
  Dock.layout.floats.push({id:newId("f"),x:Math.round(rect.width*.3),y:60,w:Math.round(Math.max(480,rect.width*.4)),h:Math.round(rect.height*.6),stack:stackNode([pid])});return;}
 const anchor=to&&to!==pid?stackOf(to):null;
 detach(pid);
 const target=anchor||targetStack(sideOf(pid));
 if(where==="tab"||where==="center"){target.tabs.push(pid);target.active=pid;}
 else if(["left","right","top","bottom"].includes(where))splitBeside(target,where,stackNode([pid]));
 else throw new Error("where 应为 tab、left、right、top、bottom 或 float");
}
function buildSpec(spec,used){
 if(Array.isArray(spec))spec={tabs:spec};
 if(spec.tabs){
  const tabs=spec.tabs.map(ref=>{
   let pid=typeof ref==="string"?resolvePanel(ref):findPanel(paramsOf(ref));
   if(!pid&&typeof ref==="object"){pid=newId("p");Dock.panels[pid]=paramsOf(ref);mountPanel(pid);}
   if(!pid)throw new Error("找不到面板："+ref);
   used.add(pid);return pid;
  });
  return {...stackNode(tabs),active:tabs.includes(resolvePanel(spec.active))?resolvePanel(spec.active):tabs[0]};
 }
 const parts=(spec.parts||[]).map(x=>buildSpec(x,used));
 if(!parts.length)throw new Error("layout 的 parts 不能为空");
 const sizes=(spec.sizes&&spec.sizes.length===parts.length?spec.sizes:parts.map(()=>1/parts.length)).map(Number);
 return {t:"split",id:newId("n"),dir:spec.split==="v"?"v":"h",sizes,kids:parts};
}
async function runUiOps(ops){
 const snapshot=newId("u");
 UiSnapshots[snapshot]={layout:currentLayout(),ui:JSON.parse(JSON.stringify(S.ui))};
 const results=[];
 for(const op of ops||[]){
  try{
   if(op.do==="open"){
    const params=paramsOf(op);let pid=findPanel(params);
    if(!pid){pid=newId("p");Dock.panels[pid]=params;mountPanel(pid);}
    placePanel(pid,op.where,resolvePanel(op.to));results.push({ok:true,panel:pid});
   }else if(["close","focus","float","move"].includes(op.do)){
    const pid=resolvePanel(op.panel);if(!pid)throw new Error("找不到面板："+op.panel);
    if(op.do==="close"){await closePanel(pid);}
    else if(op.do==="focus"){const s=stackOf(pid);if(s)s.active=pid;Dock.focus=pid;}
    else if(op.do==="float")placePanel(pid,"float");
    else placePanel(pid,op.where,resolvePanel(op.to));
    results.push({ok:true,panel:pid});
   }else if(op.do==="layout"){
    const used=new Set(),root=buildSpec(op.spec||{},used);
    for(const pid of Object.keys(Dock.panels))if(!used.has(pid)){const t=Dock.types[Dock.panels[pid].type],node=Dock.els[pid];if(t?.beforeClose)await t.beforeClose(Dock.panels[pid],node);delete Dock.panels[pid];delete Dock.els[pid];if(t?.unmount)safe(()=>t.unmount({},node));node?.remove();}
    Dock.layout={root,floats:[]};results.push({ok:true});
   }else if(op.do==="preset"){
    const preset=S.ui.presets?.[op.name];if(!preset)throw new Error("没有叫「"+op.name+"」的布局");
    await applyLayout(preset);results.push({ok:true});
   }else if(op.do==="sidebar"){
    if(op.section&&!SIDE_SECTIONS[op.section])throw new Error("左栏没有这个分区："+op.section);
    showSection(op.section,op.open!==false);results.push({ok:true});
   }else if(op.do==="set"&&(op.key==="zoom"||op.panel&&VIEW_KEYS.includes(op.key))){
    const pid=resolvePanel(op.panel);if(!pid)throw new Error(op.key+" 要给 panel：面板 id 或标题");
    if(op.key==="zoom"&&op.value!=null&&!(Number(op.value)>0))throw new Error("zoom 的 value 是倍数，比如 1.2");
    setView(pid,op.key,op.value==null?null:op.key==="read_width"?String(op.value):Number(op.value));results.push({ok:true,panel:pid,[op.key]:viewOf(Dock.panels[pid],op.key)});
   }else if(op.do==="set"){
    const keys=["theme","font_size","code_font_size","line_height","read_width","density"];
    if(!keys.includes(op.key))throw new Error("只能改 "+keys.join("、")+"，或者给 panel 改 zoom");
    S.ui[op.key]=op.value;applyUi();saveUi();results.push({ok:true});
   }else throw new Error("不认识的操作："+op.do);
  }catch(e){results.push({ok:false,error:e.message});}
 }
 tidy();renderDock();saveLayout();
 const panels=Object.keys(Dock.panels).map(pid=>({id:pid,title:panelTitle(pid),type:Dock.panels[pid].type}));
 return {snapshot,results,panels};
}
async function restoreUi(snapshot){
 const s=UiSnapshots[snapshot];if(!s)return toast("这次改动之前的界面已经找不到了（重启过）","error");
 S.ui=s.ui;applyUi();saveUi();await applyLayout(s.layout);renderSide();toast("界面已还原");
}
