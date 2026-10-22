"use strict";
/* The panel layout: splits, tab stacks and floating windows, one arrangement per workspace (spaces.js).
   Panels are shared: the same panel can sit in several workspaces, so the main conversation is one conversation everywhere.
   What opens lands in an existing stack of the same side in the workspace on screen. */
const Dock={layout:null,spaces:{},space:"chat",panels:{},els:{},types:{},focus:null,lastStack:{ai:null,mine:null},saveTimer:null,drag:null};
function panelType(name,def){Dock.types[name]=def;}
function newId(prefix){return prefix+Math.random().toString(36).slice(2,10);}
function stackNode(tabs){return {t:"stack",id:newId("s"),tabs,active:tabs[0]||null};}
function setLayout(layout){layout.floats=layout.floats||[];Dock.layout=layout;Dock.spaces[Dock.space]=layout;}
function dockSnapshot(){return JSON.parse(JSON.stringify({spaces:Dock.spaces,space:Dock.space,panels:Dock.panels}));}
/* Go back to a snapshot of every workspace; panels that stay keep their state, the rest are closed. */
async function restoreDock(saved){
 if(typeof flushAll==="function")await flushAll();
 const next=JSON.parse(JSON.stringify(saved));
 for(const pid of Object.keys(Dock.panels)){
  if(next.panels[pid]&&panelKey(next.panels[pid])===panelKey(Dock.panels[pid])){Dock.panels[pid]=next.panels[pid];applyView(pid);}
  else unmountPanel(pid);
 }
 Dock.spaces=next.spaces;Dock.space=next.space;setLayout(Dock.spaces[Dock.space]);
 for(const [pid,params] of Object.entries(next.panels))if(!Dock.panels[pid]){Dock.panels[pid]=params;mountPanel(pid);}
 tidy();renderDock();saveLayout();
}
function sideOf(pid){const p=Dock.panels[pid];return p?(Dock.types[p.type]?.side||"mine"):"mine";}
// A panel that lists things to open (the card library, the map) opens them beside itself, not on top of itself.
function hosts(pid){const p=Dock.panels[pid];return !!p&&Dock.types[p.type]?.host!==false;}
function remember(pid){
 const s=stackOf(pid);if(s&&hosts(pid))Dock.lastStack[sideOf(pid)]=s.id;
 if(typeof noteFollow==="function")noteFollow();
}

/* ---- tree helpers ---------------------------------------------------------------------------- */
function eachStack(fn,layout=Dock.layout){
 const walk=n=>{if(!n)return;if(n.t==="stack")fn(n);else n.kids.forEach(walk);};
 walk(layout.root);(layout.floats||[]).forEach(f=>fn(f.stack,f));
}
function usedPanels(){const used=new Set();Object.values(Dock.spaces).forEach(l=>eachStack(s=>s.tabs.forEach(pid=>used.add(pid)),l));return used;}
// Panels no workspace shows any more are closed for good.
async function dropUnused(){
 const used=usedPanels(),gone=Object.keys(Dock.panels).filter(pid=>!used.has(pid));
 if(gone.length&&typeof flushAll==="function")await flushAll();
 gone.forEach(unmountPanel);
}
function findStack(id){let found=null;eachStack(s=>{if(s.id===id)found=s;});return found;}
function stackOf(pid){let found=null;eachStack(s=>{if(s.tabs.includes(pid))found=s;});return found;}
function parentOf(target,n=Dock.layout.root,parent=null){
 if(n===target)return parent;
 if(n.t==="split")for(const k of n.kids){const r=parentOf(target,k,n);if(r!==undefined)return r;}
 return undefined;
}
function normalize(n){
 // A stack marked keep is a workspace's place for things to open: it stays even when empty.
 if(n.t==="stack")return n.tabs.length||n.keep?n:null;
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
// A conversation on show is never covered by a new tab: the AI that opened something would hide itself.
function covers(s){return !!(s?.active&&Dock.panels[s.active]?.type==="chat");}
function targetStack(side){
 // Opened from a group's own +: into that group, whatever kind of window it is.
 if(Dock.into){const s=Dock.into.until>Date.now()&&findStack(Dock.into.stack);Dock.into=null;if(s)return s;}
 const remembered=findStack(Dock.lastStack[side]);
 if(remembered&&!covers(remembered)&&(remembered.tabs.length?remembered.tabs.some(pid=>sideOf(pid)===side&&hosts(pid)):remembered.keep))return remembered;
 let found=null;
 if(side==="mine")eachStack(s=>{if(!found&&s.keep&&!s.tabs.length)found=s;});
 eachStack(s=>{if(!found&&!covers(s)&&s.tabs.some(pid=>sideOf(pid)===side&&hosts(pid)))found=s;});
 if(side==="mine")eachStack(s=>{if(!found&&s.keep&&!covers(s))found=s;});
 if(found)return found;
 // Every place of this kind is showing a conversation: open a new group beside it instead.
 let near=null;eachStack((s,f)=>{if(!near&&!f&&s.tabs.some(pid=>sideOf(pid)===side))near=s;});
 if(near&&side==="ai"){const s=stackNode([]);splitBeside(near,"right",s);return s;}
 // No stack of this side yet: open one beside everything, AI on the left, mine on the right.
 const s=stackNode([]),root=Dock.layout.root;
 if(root.t==="stack"&&!root.tabs.length){Dock.layout.root=s;return s;}
 Dock.layout.root={t:"split",id:newId("n"),dir:"h",sizes:[.5,.5],kids:side==="ai"?[s,root]:[root,s]};
 return s;
}
function openPanel(params,opts={}){
 let pid=opts.reuse===false?null:findPanel(params);
 // Already a tab behind a conversation that is on show: bring it out to a free group rather than hide the conversation.
 if(pid&&params.type!=="chat"){const s=stackOf(pid);if(s&&s.active!==pid&&covers(s)){detach(pid);tidy();}}
 // Already open, maybe in another workspace: show the same panel here too (moved into the group asked for, if any).
 if(pid&&Dock.into&&Dock.into.until>Date.now()&&findStack(Dock.into.stack)&&!findStack(Dock.into.stack).tabs.includes(pid)){detach(pid);tidy();}
 if(pid){activate(pid);if(opts.then)opts.then(pid);return pid;}
 pid=newId("p");Dock.panels[pid]=params;
 const side=Dock.types[params.type]?.side||"mine";
 const stack=opts.stack?findStack(opts.stack)||targetStack(side):targetStack(side);
 stack.tabs.push(pid);
 if(opts.activate!==false){stack.active=pid;Dock.focus=pid;}
 mountPanel(pid);renderDock();saveLayout();
 if(opts.then)opts.then(pid);
 return pid;
}
function activate(pid){
 if(!Dock.panels[pid])return;
 let s=stackOf(pid);if(!s){s=targetStack(sideOf(pid));s.tabs.push(pid);}
 s.active=pid;Dock.focus=pid;remember(pid);renderDock();saveLayout();
}
/* Closing a tab takes the panel out of this workspace; it is closed for good once no workspace shows it. */
async function closePanel(pid){
 const p=Dock.panels[pid],type=Dock.types[p?.type];
 const elsewhere=Object.entries(Dock.spaces).some(([id,l])=>{if(id===Dock.space)return false;let hit=false;eachStack(s=>{if(s.tabs.includes(pid))hit=true;},l);return hit;});
 if(!elsewhere&&type?.beforeClose&&await type.beforeClose(p,Dock.els[pid])===false)return;
 detach(pid);if(!elsewhere)unmountPanel(pid);
 tidy();renderDock();saveLayout();
}
function unmountPanel(pid){
 const p=Dock.panels[pid],type=Dock.types[p?.type],node=Dock.els[pid];
 delete Dock.panels[pid];delete Dock.els[pid];
 if(type?.unmount)safe(()=>type.unmount(p||{},node));
 node?.remove();
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
const VIEW_KEYS=["line_height","read_width","composer"];
// Conversations write in a capsule by default; quick answers in a plain box under a hairline.
function composerDefault(p){return p.agent==="flash"?"line":"capsule";}
function zoomKind(p){return p.type==="chat"?"chat:"+(p.agent||"tutor"):p.type;}
function zoomDefault(p){return Number(S.ui.zoom?.[zoomKind(p)])||1;}
function zoomOf(p){return Number(p.zoom)||zoomDefault(p);}
function applyView(pid){
 const node=Dock.els[pid],p=Dock.panels[pid];if(!node||!p)return;
 node.style.zoom=zoomOf(p);
 if(p.line_height)node.style.setProperty("--line-height",String(p.line_height));else node.style.removeProperty("--line-height");
 if(p.read_width)node.style.setProperty("--read-width",readWidth(p.read_width));else node.style.removeProperty("--read-width");
 if(p.type==="chat")node.dataset.composer=p.composer||composerDefault(p);
}
function viewOf(p,key){return key==="zoom"?zoomOf(p):key==="composer"?p.composer||composerDefault(p):p[key]??S.ui[key];}
function setView(pid,key,value){
 if(key==="zoom")return setZoom(pid,value);
 const p=Dock.panels[pid];if(!p||!VIEW_KEYS.includes(key))return;
 if(value==null||value===""||value===S.ui[key]||key==="composer"&&value===composerDefault(p))delete p[key];else p[key]=value;
 applyView(pid);if(key==="composer"&&typeof fitComposer==="function")fitComposer(pid);const t=Dock.types[p.type],node=Dock.els[pid];if(t?.shown&&node?.isConnected)t.shown(p,node);
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
 bar.appendChild(h('<button class="tab-add" data-action="stack-add" data-stack="'+s.id+'" title="在这一组里新建或打开…">'+svg("plus",13)+'</button>'));
 bar.appendChild(h('<div class="tabs-fill" data-stack="'+s.id+'"'+(floating?' data-float-move="'+floating.id+'"':"")+'></div>'));
 if(s.active&&Dock.els[s.active]){
  node.lastElementChild.appendChild(Dock.els[s.active]);
  // Sizes measured while a panel was detached are wrong; let it fit itself once it is visible.
  const p=Dock.panels[s.active],t=Dock.types[p?.type];if(t?.shown)requestAnimationFrame(()=>t.shown(p,Dock.els[s.active]));
 }
 else if(!s.tabs.length)node.lastElementChild.appendChild(h('<div class="stack-empty">'+emptyState("layout","这里是空的",s.keep?"从左栏打开的东西放在这里，也可以把标签拖进来。":"把标签拖到这里，或者从上面的「＋」打开。")+
  (s.keep?'<button class="ghost xs" data-action="stack-unkeep" data-stack="'+s.id+'">不要这一块</button>':"")+'</div>'));
 return node;
}
function saveLayout(){
 clearTimeout(Dock.saveTimer);
 Dock.saveTimer=setTimeout(()=>safe(()=>rpc("layout_save",{layout:{spaces:Dock.spaces,space:Dock.space,panels:Dock.panels}})),600);
 if(typeof reportScreen==="function")reportScreen();
}
/* Every workspace's arrangement comes back as it was left; one never opened yet is built from its default when first shown. */
function loadLayout(saved){
 Dock.panels=saved?.panels||{};
 // A layout saved before there were workspaces becomes the conversation workspace.
 Dock.spaces=saved?.spaces||(saved?.layout?.root?{chat:saved.layout}:{});
 for(const [id,l] of Object.entries(Dock.spaces)){
  if(!l?.root||!spaceOf(id)){delete Dock.spaces[id];continue;}
  eachStack(s=>{s.tabs=s.tabs.filter(pid=>Dock.panels[pid]&&Dock.types[Dock.panels[pid].type]);},l);
 }
 const used=usedPanels();Object.keys(Dock.panels).forEach(pid=>{if(!used.has(pid))delete Dock.panels[pid];});
 Dock.space=spaceOf(saved?.space)&&!spaceOf(saved.space).hidden?saved.space:visibleSpaces()[0].id;
 Object.keys(Dock.panels).forEach(mountPanel);
 if(!Dock.spaces[Dock.space])Dock.spaces[Dock.space]=layoutFromSpec(spaceOf(Dock.space).spec);
 Object.values(Dock.spaces).forEach(l=>{Dock.layout=l;l.floats=l.floats||[];tidy();});
 setLayout(Dock.spaces[Dock.space]);
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
  remember(pid);
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
  if(panel){Dock.focus=panel.dataset.pid;remember(panel.dataset.pid);}
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
 // By title, those in this workspace first.
 const here=[];eachStack(s=>here.push(...s.tabs));
 const ids=[...here,...Object.keys(Dock.panels).filter(pid=>!here.includes(pid))],title=String(ref);
 return ids.find(pid=>panelTitle(pid)===title)||ids.find(pid=>Dock.panels[pid].path===title)||ids.find(pid=>panelTitle(pid).includes(title))||null;
}
function paramsOf(op){
 // A panel as a saved arrangement writes it: its own parameters, type included.
 if(op.type&&!op.panel){if(!Dock.types[op.type])throw new Error("没有这种面板："+op.type);return {...op};}
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
 // Asked to go in as a tab over a conversation that is on show: beside it instead.
 if((where==="tab"||where==="center")&&covers(target)&&target.active!==pid){splitBeside(target,"right",stackNode([pid]));return;}
 if(where==="tab"||where==="center"){target.tabs.push(pid);target.active=pid;}
 else if(["left","right","top","bottom"].includes(where))splitBeside(target,where,stackNode([pid]));
 else throw new Error("where 应为 tab、left、right、top、bottom 或 float");
}
function buildSpec(spec,used){
 if(Array.isArray(spec))spec={tabs:spec};
 if(spec.tabs){
  const tabs=[];
  for(const ref of spec.tabs){
   let pid=typeof ref==="string"?resolvePanel(ref):findPanel(paramsOf(ref));
   if(!pid&&typeof ref==="object"){pid=newId("p");Dock.panels[pid]=paramsOf(ref);mountPanel(pid);}
   if(!pid)throw new Error("找不到面板："+ref);
   // One panel shows in one place per workspace.
   if(!used.has(pid)){used.add(pid);tabs.push(pid);}
  }
  return {...stackNode(tabs),...(spec.keep?{keep:true}:{}),active:tabs.includes(resolvePanel(spec.active))?resolvePanel(spec.active):tabs[0]||null};
 }
 const parts=(spec.parts||[]).map(x=>buildSpec(x,used));
 if(!parts.length)throw new Error("layout 的 parts 不能为空");
 const sizes=(spec.sizes&&spec.sizes.length===parts.length?spec.sizes:parts.map(()=>1/parts.length)).map(Number);
 return {t:"split",id:newId("n"),dir:spec.split==="v"?"v":"h",sizes,kids:parts};
}
async function runUiOps(ops){
 const snapshot=newId("u");
 UiSnapshots[snapshot]={dock:dockSnapshot(),ui:JSON.parse(JSON.stringify(S.ui))};
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
    setLayout(layoutFromSpec(op.spec||{}));await dropUnused();results.push({ok:true});
   }else if(op.do==="workspace"){
    const found=findSpace(op.name);
    if(op.new){
     if(!op.name)throw new Error("新工作区要给 name");
     const lists=(op.side||[]).filter(k=>SIDE_SECTIONS[k]);
     createSpace({name:String(op.name).slice(0,20),icon:SPACE_ICONS.includes(op.icon)?op.icon:"layout",side:lists,spec:op.spec||null});
    }else{if(!found)throw new Error("没有这个工作区："+op.name+"；有："+visibleSpaces().map(x=>x.name).join("、"));switchSpace(found.id);}
    results.push({ok:true,workspace:currentSpace().name});
   }else if(op.do==="sidebar"){
    setSideOpen(op.open!==false);results.push({ok:true});
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
 tidy();renderDock();saveLayout();renderSide();
 const panels=[];eachStack(s=>s.tabs.forEach(pid=>panels.push({id:pid,title:panelTitle(pid),type:Dock.panels[pid].type})));
 return {snapshot,workspace:currentSpace().name,results,panels};
}
async function restoreUi(snapshot){
 const s=UiSnapshots[snapshot];if(!s)return toast("这次改动之前的界面已经找不到了（重启过）","error");
 S.ui=s.ui;applyUi();saveUi();await restoreDock(s.dock);renderSide();toast("界面已还原");
}
