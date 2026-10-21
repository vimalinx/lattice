"use strict";
/* The panel layout: splits, tab stacks and floating windows. The layout belongs to the learner:
   agents never move or close a panel; what they open lands in an existing stack of the same side. */
const Dock={layout:null,panels:{},els:{},types:{},focus:null,lastStack:{ai:null,mine:null},saveTimer:null,drag:null};
function panelType(name,def){Dock.types[name]=def;}
function newId(prefix){return prefix+Math.random().toString(36).slice(2,10);}
function stackNode(tabs){return {t:"stack",id:newId("s"),tabs,active:tabs[0]||null};}
function defaultLayout(){
 const tutor=newId("p"),flash=newId("p"),files=newId("p");
 Dock.panels={[tutor]:{type:"chat",agent:"tutor"},[flash]:{type:"chat",agent:"flash"},[files]:{type:"browser"}};
 return {root:{t:"split",id:newId("n"),dir:"h",sizes:[.52,.48],kids:[stackNode([tutor,flash]),stackNode([files])]},floats:[]};
}
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
 Dock.els[pid]=node;
 if(type)safe(()=>type.mount(p,node,pid));else node.innerHTML=emptyState("info","这个面板打不开","面板类型 "+p.type+" 不存在。");
}
function float(pid){
 detach(pid);
 const rect=el("#dock").getBoundingClientRect();
 Dock.layout.floats.push({id:newId("f"),x:Math.round(rect.width*.25),y:70,w:Math.round(Math.min(720,rect.width*.5)),h:Math.round(rect.height*.7),stack:stackNode([pid])});
 tidy();renderDock();saveLayout();
}
function panelTitle(pid){const p=Dock.panels[pid];return Dock.types[p.type]?.title(p,Dock.els[pid])||p.type;}
function refreshTab(pid){
 const tab=el('.tab[data-pid="'+pid+'"] .tab-title');if(!tab)return;
 const p=Dock.panels[pid];tab.textContent=panelTitle(pid);
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
   svg(typeof type.icon==="function"?type.icon(p):type.icon||"file",13)+'<span class="tab-title">'+esc(panelTitle(pid))+'</span>'+
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
