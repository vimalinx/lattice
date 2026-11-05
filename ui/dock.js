import {$t} from "./i18n.js";
import {Dock} from "./state.js";
import {S,WINDOW,all,button,el,emptyState,esc,h,rpc,safe,scheduleMermaid,svg,toast} from "./core.js";
import {themeOp} from "./theme.js";
import {SPACE_ICONS,createSpace,currentSpace,findSpace,inSpace,layoutFromSpec,seedSpaces,spaceOf,spaceSpec,switchSpace,visibleSpaces} from "./spaces.js";
import {fitComposer} from "./chat.js";
import {Files,flushAll,flushFile} from "./files.js";
import {noteFollow} from "./notes.js";
import {isBook} from "./books.js";
import {marksShown} from "./marks.js";
import {SIDE_SECTIONS,renderSide,setSideOpen,showList} from "./side.js";
import {applyUi,readWidth,renderStatus,reportScreen,saveUi} from "./app.js";
/* The panel layout: splits, tab stacks and floating windows, one arrangement per working state (spaces.js).
   Panels are shared: the same panel can sit in several workspaces, so the main conversation is one conversation everywhere.
   What opens lands in an existing stack of the same side in the workspace on screen. */
// A separate window taken out for a panel, not a whole working state; what is opened from inside it opens there too.
export function onePanel(){return !!WINDOW&&!Dock.own;}
/* One panel is open in one window: asked for where another window has it, that window comes to the front. */
function heldElsewhere(params){
 const key=panelKey(params);
 for(const [w,list] of Object.entries(Dock.held))if(w!==WINDOW&&list.some(p=>panelKey(p)===key))return w;
 return null;
}
// This window's panels, told to the others (after a change settles).
let heldTimer=null;
export function reportHeld(){clearTimeout(heldTimer);heldTimer=setTimeout(()=>safe(()=>rpc("window_held",{window:WINDOW,panels:Object.values(Dock.panels)})),300);}
// A separate window with nothing left in it closes.
function closeIfEmpty(){if(onePanel()&&!Object.keys(Dock.panels).length)safe(()=>rpc("window_return",{window:WINDOW}));}
export function newId(prefix){return prefix+Math.random().toString(36).slice(2,10);}
export function stackNode(tabs){return {t:"stack",id:newId("s"),tabs,active:tabs[0]||null};}
export function setLayout(layout){layout.floats=layout.floats||[];Dock.layout=layout;Dock.spaces[Dock.space]=layout;}
export function dockSnapshot(){return JSON.parse(JSON.stringify({spaces:Dock.spaces,space:Dock.space,panels:Dock.panels}));}
/* Go back to a snapshot of every workspace; panels that stay keep their state, the rest are closed. */
async function restoreDock(saved){
 await flushAll();
 const next=JSON.parse(JSON.stringify(saved));
 for(const pid of Object.keys(Dock.panels)){
  if(next.panels[pid]&&panelKey(next.panels[pid])===panelKey(Dock.panels[pid])){Dock.panels[pid]=next.panels[pid];applyView(pid);}
  else unmountPanel(pid);
 }
 // A state in a window of its own is that window's now, whatever it was in the snapshot.
 for(const id of Object.keys(Dock.out))delete next.spaces[id];
 Dock.spaces=next.spaces;Dock.space=Dock.out[next.space]?Dock.space:next.space;setLayout(Dock.spaces[Dock.space]);
 for(const [pid,params] of Object.entries(next.panels))if(!Dock.panels[pid]){Dock.panels[pid]=params;mountPanel(pid);}
 tidy();renderDock();saveLayout();
}
export function sideOf(pid){const p=Dock.panels[pid];return p?(Dock.types[p.type]?.side||"mine"):"mine";}
// A panel that lists things to open (the card library, the map) opens them beside itself, not on top of itself.
export function hosts(pid){const p=Dock.panels[pid];return !!p&&Dock.types[p.type]?.host!==false;}
export function remember(pid){
 const s=stackOf(pid);if(s&&hosts(pid))Dock.lastStack[sideOf(pid)]=s.id;
 // The learner's own panel last used: what "this" means when they then type to an AI.
 if(sideOf(pid)==="mine")Dock.lastMine=pid;
 noteFollow();
}

/* ---- tree helpers ---------------------------------------------------------------------------- */
export function eachStack(fn,layout=Dock.layout){
 const walk=n=>{if(!n)return;if(n.t==="stack")fn(n);else n.kids.forEach(walk);};
 walk(layout.root);(layout.floats||[]).forEach(f=>fn(f.stack,f));
}
function usedPanels(){const used=new Set();Object.values(Dock.spaces).forEach(l=>eachStack(s=>s.tabs.forEach(pid=>used.add(pid)),l));return used;}
// Panels no workspace shows any more are closed for good.
export async function dropUnused(){
 const used=usedPanels(),gone=Object.keys(Dock.panels).filter(pid=>!used.has(pid));
 if(gone.length)await flushAll();
 gone.forEach(unmountPanel);
}
export function findStack(id){let found=null;eachStack(s=>{if(s.id===id)found=s;});return found;}
export function stackOf(pid){let found=null;eachStack(s=>{if(s.tabs.includes(pid))found=s;});return found;}
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
export function tidy(){
 Dock.layout.root=normalize(Dock.layout.root)||stackNode([]);
 Dock.layout.floats=Dock.layout.floats.filter(f=>f.stack.tabs.length);
 eachStack(s=>{if(!s.tabs.includes(s.active))s.active=s.tabs[s.tabs.length-1]||null;});
}
export function detach(pid){
 const s=stackOf(pid);if(!s)return;
 s.tabs=s.tabs.filter(x=>x!==pid);if(s.active===pid)s.active=s.tabs[s.tabs.length-1]||null;
}
export function splitBeside(target,zone,newStack){
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
export function panelKey(p){return p.type+":"+(p.path||p.url||p.change||p.compare||p.thread||p.agent||"")+(p.type==="chat"&&!p.thread?":follow":"")+(p.space?"@"+p.space:"");}
/* Each working state has its own main conversation and quick answer, so one that follows along belongs to the state it
   is opened in (or built for). */
const BY_STATE=new Set(["tutor","flash"]);
let Building=null;
export function bindSpace(params,space=Building||Dock.space){
 return params?.type==="chat"&&BY_STATE.has(params.agent)&&!params.thread?{...params,space}:params;
}
function spaceFollow(agent){let found=null;eachStack(s=>{if(!found)found=s.tabs.find(pid=>Dock.panels[pid]?.type==="chat"&&Dock.panels[pid].agent===agent&&!Dock.panels[pid].thread)||null;});return found;}
// This state's quick answer, if it has one open.
export function spaceFlash(){return spaceFollow("flash");}
// The panel an AI's conversation that follows along is shown in: the main conversation and the quick answer are this
// state's own, never fetched from another state.
export function followingPanel(agent){
 return BY_STATE.has(agent)?spaceFollow(agent):Object.keys(Dock.panels).find(pid=>Dock.panels[pid].type==="chat"&&Dock.panels[pid].agent===agent&&!Dock.panels[pid].thread)||null;
}
// Panels written in a saved arrangement are made for the state it is built for.
export function building(space,fn){const was=Building;Building=space;try{return fn();}finally{Building=was;}}
export function findPanel(params){const key=panelKey(params);return Object.keys(Dock.panels).find(pid=>panelKey(Dock.panels[pid])===key)||null;}
// A conversation on show is never covered by a new tab: the AI that opened something would hide itself.
function covers(s){return !!(s?.active&&Dock.panels[s.active]?.type==="chat");}
export function targetStack(side){
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
export function openPanel(params,opts={}){
 if(params.type==="file"&&isBook(params.path))params={type:"book",path:params.path};
 if(!params.space)params=bindSpace(params);
 let pid=opts.reuse===false?null:findPanel(params);
 if(!pid&&opts.reuse!==false){const there=heldElsewhere(params);if(there!=null){safe(()=>rpc("window_show",{window:there,params}));return null;}}
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
export function activate(pid){
 if(!Dock.panels[pid])return;
 let s=stackOf(pid);if(!s){s=targetStack(sideOf(pid));s.tabs.push(pid);}
 s.active=pid;Dock.focus=pid;remember(pid);renderDock();saveLayout();
}
/* Closing a tab takes the panel out of this workspace; it is closed for good once no workspace shows it. */
export async function closePanel(pid){
 const p=Dock.panels[pid],type=Dock.types[p?.type];
 const elsewhere=Object.entries(Dock.spaces).some(([id,l])=>{if(id===Dock.space)return false;let hit=false;eachStack(s=>{if(s.tabs.includes(pid))hit=true;},l);return hit;});
 if(!elsewhere&&type?.beforeClose&&await type.beforeClose(p,Dock.els[pid])===false)return;
 detach(pid);if(!elsewhere)unmountPanel(pid);
 tidy();renderDock();saveLayout();closeIfEmpty();
}
/* A tab dropped into another window: it leaves this one, from every working state here. */
export async function letGo(pid){
 if(!Dock.panels[pid])return;
 if(Files[pid])await flushFile(pid);
 const here=Dock.layout;
 Object.values(Dock.spaces).forEach(l=>{Dock.layout=l;detach(pid);tidy();});
 Dock.layout=here;unmountPanel(pid);
 if(Dock.focus===pid)Dock.focus=null;
 renderDock();saveLayout();closeIfEmpty();
}
export function unmountPanel(pid){
 const p=Dock.panels[pid],type=Dock.types[p?.type],node=Dock.els[pid];
 delete Dock.panels[pid];delete Dock.els[pid];
 if(type?.unmount)safe(()=>type.unmount(p||{},node));
 node?.remove();
}
/* A panel taken out into a window of its own, to make it big or put it on another screen. It leaves this window as it
   is (its typing written out first); closing that window puts it back. */
export async function toWindow(pid){
 const p=Dock.panels[pid];if(!p)return;
 if(Files[pid])await flushFile(pid);
 // Where to put it back: its group and place, or, a floating one, the floating window as it was.
 const f=Dock.layout.floats.find(x=>x.stack.tabs.includes(pid));
 const origin={...placeOf(pid),space:Dock.space,...(f?{float:{x:f.x,y:f.y,w:f.w,h:f.h}}:{})};
 await rpc("window_open",{params:p,title:panelTitle(pid),origin});
 detach(pid);unmountPanel(pid);tidy();renderDock();saveLayout();
}
// A panel back from its own window, where it was: in the working state it came from, which stays where it is if the
// learner has gone to another one since, and is marked.
export function fromWindow(params,origin={}){
 if(!params?.type||!Dock.types[params.type])return;
 const found=findPanel(params);if(found)return activate(found);
 const pid=newId("p");Dock.panels[pid]=params;mountPanel(pid);
 const sp=spaceOf(origin.space),away=sp&&!sp.hidden&&sp.id!==Dock.space&&!Dock.out[sp.id]?sp.id:null;
 if(!away){putBack(pid,origin);tidy();renderDock();saveLayout();return activate(pid);}
 if(!Dock.spaces[away])Dock.spaces[away]=layoutFromSpec(spaceSpec(sp),away);
 Dock.into=null;inSpace(away,()=>{putBack(pid,origin);const s=stackOf(pid);if(s)s.active=pid;tidy();});
 Dock.notice.add(away);renderDock();saveLayout();renderStatus();
}
function putBack(pid,origin){
 if(origin.float)Dock.layout.floats.push({id:newId("f"),...origin.float,stack:stackNode([pid]),origin:{stack:origin.stack,index:origin.index}});
 else placeAt(pid,origin);
}
export let windowTitleShown="";
function windowTitle(title){if(title!==windowTitleShown){windowTitleShown=title;safe(()=>rpc("window_title",{window:WINDOW,title}));}}
export function mountPanel(pid){
 const p=Dock.panels[pid],type=Dock.types[p.type];
 const node=document.createElement("div");node.className="panel panel-"+p.type;node.dataset.pid=pid;
 Dock.els[pid]=node;applyView(pid);
 if(type)safe(()=>type.mount(p,node,pid));else node.innerHTML=emptyState("info",$t("这个面板打不开"),$t("面板类型 {0} 不存在。",p.type));
}
export function float(pid){
 const origin=placeOf(pid);
 detach(pid);
 const rect=el("#dock").getBoundingClientRect();
 Dock.layout.floats.push({id:newId("f"),x:Math.round(rect.width*.25),y:70,w:Math.round(Math.max(480,Math.min(760,rect.width*.5))),h:Math.round(rect.height*.7),stack:stackNode([pid]),origin});
 tidy();renderDock();saveLayout();
}
// Where a panel sits among the docked groups (a floating one: where it was before it floated), to go back there.
function placeOf(pid){
 const f=Dock.layout.floats.find(x=>x.stack.tabs.includes(pid));if(f)return f.origin||{};
 const s=stackOf(pid);return s?{stack:s.id,index:s.tabs.indexOf(pid)}:{};
}
// Back into the group it came from, at its place among the tabs (or wherever its kind opens, if that group is gone).
function dockAt(pid,origin){placeAt(pid,origin);tidy();renderDock();saveLayout();activate(pid);}
function placeAt(pid,origin){
 let target=origin?.stack&&findStack(origin.stack);
 if(!target||Dock.layout.floats.some(f=>f.stack===target))target=targetStack(sideOf(pid));
 detach(pid);
 target.tabs.splice(origin?.index>=0?Math.min(origin.index,target.tabs.length):target.tabs.length,0,pid);target.active=pid;
}
export function unfloat(pid){const f=Dock.layout.floats.find(x=>x.stack.tabs.includes(pid));dockAt(pid,f?.origin);}
/* Size: each kind of panel has a default in the settings; a window can set its own, kept in the layout.
   Line height and reading width likewise fall back to the settings unless the window sets its own. */
export const VIEW_KEYS=["line_height","read_width","composer"];
// Conversations write in a capsule by default; quick answers in a plain box under a hairline.
function composerDefault(p){return p.agent==="flash"?"line":"capsule";}
function zoomKind(p){return p.type==="chat"?"chat:"+(p.agent||"tutor"):p.type;}
export function zoomDefault(p){return Number(S.ui.zoom?.[zoomKind(p)])||1;}
export function zoomOf(p){return Number(p.zoom)||zoomDefault(p);}
export function applyView(pid){
 const node=Dock.els[pid],p=Dock.panels[pid];if(!node||!p)return;
 node.style.zoom=zoomOf(p);
 if(p.line_height)node.style.setProperty("--line-height",String(p.line_height));else node.style.removeProperty("--line-height");
 if(p.read_width)node.style.setProperty("--read-width",readWidth(p.read_width));else node.style.removeProperty("--read-width");
 if(p.type==="chat")node.dataset.composer=p.composer||composerDefault(p);
}
export function viewOf(p,key){return key==="zoom"?zoomOf(p):key==="composer"?p.composer||composerDefault(p):p[key]??S.ui[key];}
export function setView(pid,key,value){
 if(key==="zoom")return setZoom(pid,value);
 const p=Dock.panels[pid];if(!p||!VIEW_KEYS.includes(key))return;
 if(value==null||value===""||value===S.ui[key]||key==="composer"&&value===composerDefault(p))delete p[key];else p[key]=value;
 applyView(pid);if(key==="composer")fitComposer(pid);const t=Dock.types[p.type],node=Dock.els[pid];if(t?.shown&&node?.isConnected)t.shown(p,node);
 saveLayout();
}
export function setZoom(pid,value){
 const p=Dock.panels[pid];if(!p)return;
 const z=value==null?null:Math.round(Math.min(2.5,Math.max(.6,Number(value)))*20)/20;
 if(z==null||Math.abs(z-zoomDefault(p))<.001)delete p.zoom;else p.zoom=z;
 applyView(pid);refreshTab(pid);
 const t=Dock.types[p.type],node=Dock.els[pid];if(t?.shown&&node?.isConnected)t.shown(p,node);
 saveLayout();
}
export function stepZoom(pid,dir){const p=Dock.panels[pid];if(p)setZoom(pid,dir?zoomOf(p)+dir*.1:null);}
function zoomBadge(pid){const p=Dock.panels[pid];return p?.zoom?Math.round(p.zoom*100)+"%":"";}
export function panelTitle(pid){const p=Dock.panels[pid];return Dock.types[p.type]?.title(p,Dock.els[pid])||p.type;}
export function refreshTab(pid){
 if(onePanel()&&Dock.panels[pid]&&stackOf(pid)?.active===pid)windowTitle(panelTitle(pid));
 const tab=el('.tab[data-pid="'+pid+'"] .tab-title');if(!tab)return;
 const p=Dock.panels[pid];tab.textContent=panelTitle(pid);
 const badge=tab.parentElement.querySelector(".tab-zoom");if(badge)badge.textContent=zoomBadge(pid);
 tab.parentElement.classList.toggle("dirty",!!Dock.types[p.type]?.dirty?.(p,Dock.els[pid]));
}

/* ---- rendering ----------------------------------------------------------------------------------- */
/* Changing the layout takes windows out of the page and puts them back, which loses where everything inside them was
   scrolled to. Each scroll is noted as it happens, and put back once the window shows again.
   A window that comes back at another width has reflowed, so the item that was at the top is found again and kept at
   the same distance from the top, rather than the same number of pixels. */
const topOf=(box,node,k)=>(node.getBoundingClientRect().top-box.getBoundingClientRect().top)/k+box.scrollTop;
function noteScroll(t){
 const k=t.getBoundingClientRect().height/(t.offsetHeight||1)||1,kids=t.children;let anchor=null;
 // The first child reaching below the top edge (children are in order, so a binary search finds it).
 if(kids.length>1){
  let lo=0,hi=kids.length-1;
  while(lo<hi){const mid=(lo+hi)>>1,c=kids[mid];if(topOf(t,c,k)+c.offsetHeight<=t.scrollTop)lo=mid+1;else hi=mid;}
  anchor=kids[lo];
 }
 t.__at={top:t.scrollTop,left:t.scrollLeft,anchor,gap:anchor?t.scrollTop-topOf(t,anchor,k):0};
}
document.addEventListener("scroll",e=>{
 const t=e.target;if(t.nodeType!==1||!t.isConnected||!t.clientHeight)return;
 const panel=t.closest(".panel");if(!panel)return;
 (panel.__scrolled||=new Set()).add(t);
 if(!t.__noting){t.__noting=true;requestAnimationFrame(()=>{t.__noting=false;if(t.isConnected&&t.clientHeight)noteScroll(t);});}
},true);
function restoreScroll(node){
 for(const t of node?.__scrolled||[]){
  if(!node.contains(t)){node.__scrolled.delete(t);continue;}
  const at=t.__at;if(!at)continue;
  const k=t.getBoundingClientRect().height/(t.offsetHeight||1)||1;
  t.scrollTop=at.anchor&&t.contains(at.anchor)?topOf(t,at.anchor,k)+at.gap:at.top;t.scrollLeft=at.left;
 }
}
export function renderDock(){
 const host=el("#dock");if(!host||Dock.away)return;
 // A page inside a window (a book, an app) is lost when it leaves the document, so a window that has one waits here while
 // the rest is rebuilt, and one still on show is moved to its new place whole. A book on a tab behind stays here, its size
 // kept, so it is as it was when its tab comes back.
 const hold=el("#dock-keep");
 Object.values(Dock.els).forEach(n=>{
  if(!n.parentElement||n.parentElement===hold)return;
  if(hold?.moveBefore&&n.querySelector("iframe")){const r=n.getBoundingClientRect();n.style.width=r.width+"px";n.style.height=r.height+"px";hold.moveBefore(n,null);}
  else n.remove();
 });
 host.innerHTML="";host.appendChild(nodeEl(Dock.layout.root));
 const floats=el("#floats");floats.innerHTML="";
 Dock.layout.floats.forEach(f=>{
  const w=h('<div class="float" data-float="'+f.id+'" style="left:'+f.x+'px;top:'+f.y+'px;width:'+f.w+'px;height:'+f.h+'px"><div class="float-resize" data-float-resize="'+f.id+'"></div></div>');
  w.prepend(stackEl(f.stack,f));floats.appendChild(w);
 });
 all("[data-awaits]").forEach(body=>{const n=Dock.els[body.dataset.awaits];body.moveBefore(n,null);n.style.width=n.style.height="";delete body.dataset.awaits;});
 // The three left most lately, as a book costs memory; another opens again where it was.
 if(hold){const books=[...hold.children].filter(n=>n.querySelector("iframe.book-frame")||n.remove());books.slice(0,-3).forEach(n=>n.remove());}
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
function cornerStack(n=Dock.layout.root){return n.t==="stack"?n:cornerStack(n.dir==="h"?n.kids[n.kids.length-1]:n.kids[0]);}
function stackEl(s,floating=null){
 const node=h('<div class="stack" data-stack="'+s.id+'"><div class="tabs" data-stack="'+s.id+'"></div><div class="stack-body" data-stack="'+s.id+'"></div></div>');
 const bar=node.firstElementChild;
 s.tabs.forEach(pid=>{
  const p=Dock.panels[pid],type=Dock.types[p?.type]||{};
  bar.appendChild(h("<div class=\"tab"+(pid===s.active?" active":"")+(type.side==="ai"?" ai":"")+"\" draggable=\"true\" data-pid=\""+pid+"\" title=\""+esc(panelTitle(pid))+"\">"+svg(typeof type.icon==="function"?type.icon(p):type.icon||"file",13)+"<span class=\"tab-title\">"+esc(panelTitle(pid))+"</span><small class=\"tab-zoom\" title=\""+$t("这个窗口单独调过大小；右键标签可以恢复")+"\">"+zoomBadge(pid)+"</small>"+(floating?"<button class=\"tab-btn\" data-action=\"dock-unfloat\" data-pid=\""+pid+"\" title=\""+$t("放回原处")+"\">"+svg("undo",12)+"</button>"+(WINDOW?"":"<button class=\"tab-btn\" data-action=\"dock-window\" data-pid=\""+pid+"\" title=\""+$t("放大成单独的窗口（能拖到别的屏幕）")+"\">"+svg("external",12)+"</button>"):
    "<button class=\"tab-btn\" data-action=\"dock-float\" data-pid=\""+pid+"\" title=\""+$t("浮出")+"\">"+svg("float",12)+"</button>")+"<button class=\"tab-btn\" data-action=\"dock-close\" data-pid=\""+pid+"\" title=\""+$t("关闭")+"\">"+svg("close",12)+"</button></div>"));
 });
 bar.appendChild(h("<button class=\"tab-add\" data-action=\"stack-add\" data-stack=\""+s.id+"\" title=\""+$t("在这一组里新建或打开…")+"\">"+svg("plus",13)+"</button>"));
 bar.appendChild(h('<div class="tabs-fill" data-stack="'+s.id+'"'+(floating?' data-float-move="'+floating.id+'"':"")+'></div>'));
 // A separate window's way back sits at the right end of its top right group.
 if(WINDOW&&!floating&&cornerStack()===s)bar.appendChild(h("<button class=\"tab-return\" data-action=\"window-return\" title=\""+(Dock.own?$t("关掉这个窗口，这个工作状态回到主窗口"):$t("关掉这个窗口，里面的面板回到主窗口"))+"\">"+svg("undo",12)+"<span>"+$t("放回主窗口")+"</span></button>"));
 if(s.active&&Dock.els[s.active]){
  if(Dock.els[s.active].parentElement?.id==="dock-keep")node.lastElementChild.dataset.awaits=s.active;
  else node.lastElementChild.appendChild(Dock.els[s.active]);
  // Sizes measured while a panel was detached are wrong; let it fit itself once it is visible, scrolled where it was.
  const p=Dock.panels[s.active],t=Dock.types[p?.type],panel=Dock.els[s.active];
  requestAnimationFrame(()=>{restoreScroll(panel);if(t?.shown)t.shown(p,panel);marksShown(s.active);if(panel.querySelector(".mermaid:not([data-processed='true'])"))scheduleMermaid();});
 }
 else if(!s.tabs.length)node.lastElementChild.appendChild(h('<div class="stack-empty">'+emptyState("layout",$t("这里是空的"),s.keep?$t("从左栏打开的东西放在这里，也可以把标签拖进来。"):$t("把标签拖到这里，或者从上面的「＋」打开。"))+
  (s.keep?button($t("不要这一块"),"stack-unkeep",'data-stack="'+s.id+'"',"ghost xs"):"")+'</div>'));
 return node;
}
/* Working states are saved one by one, each a file in the vault with the panels in it. The main window saves the list and
   the states it holds (not those in windows of their own, which save themselves); a window holding a state saves that one. */
export function stateUnit(id){
 const layout=Dock.spaces[id],panels={};
 eachStack(s=>s.tabs.forEach(pid=>{if(Dock.panels[pid])panels[pid]=Dock.panels[pid];}),layout);
 return {layout,panels};
}
function writeLayout(){
 clearTimeout(Dock.saveTimer);
 if(onePanel())return safe(()=>rpc("window_save",{window:WINDOW,unit:{...stateUnit(Dock.space),home:"w"+WINDOW.slice(0,10)}}));
 if(Dock.own)return safe(()=>rpc("states_save",{states:{[Dock.own]:stateUnit(Dock.own)}}));
 return safe(()=>rpc("states_save",{states:Object.fromEntries(Object.keys(Dock.spaces).map(id=>[id,stateUnit(id)])),list:S.states||[],now:Dock.space}));
}
export function saveLayout(){
 reportHeld();
 clearTimeout(Dock.saveTimer);
 Dock.saveTimer=setTimeout(writeLayout,600);
 reportScreen();
}
// Written out at once: before a state goes into a window of its own, and as that window closes.
export function flushLayout(){return writeLayout();}
/* Every workspace's arrangement comes back as it was left; one never opened yet is built from its default when first shown. */
export function loadLayout(saved){
 seedSpaces(saved);
 Dock.panels=saved?.panels||{};
 Dock.spaces=saved?.spaces||{};
 for(const [id,l] of Object.entries(Dock.spaces)){
  if(!l?.root||!spaceOf(id)){delete Dock.spaces[id];continue;}
  eachStack(s=>{s.tabs=s.tabs.filter(pid=>Dock.panels[pid]&&Dock.types[Dock.panels[pid].type]);},l);
 }
 // Before states had their own main conversation and quick answer, one of each was shared by all: it stays with the
 // first state that shows it, and every other state gets one of its own in the same place.
 for(const [id,l] of Object.entries(Dock.spaces))eachStack(s=>{s.tabs=s.tabs.map(pid=>{
  const p=Dock.panels[pid];if(p?.type!=="chat"||!BY_STATE.has(p.agent)||p.thread||p.space===id)return pid;
  if(!p.space){p.space=id;return pid;}
  const own=Object.keys(Dock.panels).find(x=>Dock.panels[x].agent===p.agent&&Dock.panels[x].space===id&&!Dock.panels[x].thread);
  if(own)return own;
  const fresh=newId("p");Dock.panels[fresh]={...p,space:id};if(s.active===pid)s.active=fresh;return fresh;
 });},l);
 const used=usedPanels();Object.keys(Dock.panels).forEach(pid=>{if(!used.has(pid))delete Dock.panels[pid];});
 Dock.space=spaceOf(saved?.space)&&!spaceOf(saved.space).hidden?saved.space:visibleSpaces()[0].id;
 Object.keys(Dock.panels).forEach(mountPanel);
 if(!Dock.spaces[Dock.space])Dock.spaces[Dock.space]=layoutFromSpec(spaceSpec(spaceOf(Dock.space)),Dock.space);
 Object.values(Dock.spaces).forEach(l=>{Dock.layout=l;l.floats=l.floats||[];tidy();});
 setLayout(Dock.spaces[Dock.space]);
 renderDock();
}

/* ---- interaction: tabs, dragging, splitters, floats ------------------------------------------------- */
/* Where a dragged tab goes over a group: its top or bottom quarter splits above or below; anywhere else, the left or
   right half splits beside it. Dropped on the tab bar, it joins the group as a tab. */
function dropZone(stackBody,x,y){
 const r=stackBody.getBoundingClientRect(),fx=(x-r.left)/r.width,fy=(y-r.top)/r.height;
 if(fy<.25)return "top";if(fy>.75)return "bottom";return fx<.5?"left":"right";
}
const DROP_LABEL={left:$t("放在左边"),right:$t("放在右边"),top:$t("放在上面"),bottom:$t("放在下面"),center:$t("合并成标签")};
function showDrop(target,zone){
 const mark=el("#drop-mark");if(!target){mark.style.display="none";return;}
 mark.textContent=DROP_LABEL[zone]||"";
 const r=target.getBoundingClientRect(),box={left:r.left,top:r.top,width:r.width,height:r.height};
 if(zone==="left")box.width/=2;if(zone==="right"){box.left+=r.width/2;box.width/=2;}
 if(zone==="top")box.height/=2;if(zone==="bottom"){box.top+=r.height/2;box.height/=2;}
 Object.assign(mark.style,{display:"grid",left:box.left+"px",top:box.top+"px",width:box.width+"px",height:box.height+"px"});
}
export function initDock(){
 /* A tab can be dropped into another window too: what it is travels with the drag (nothing else gets through while one
    is under way), and the window it is dropped in opens it and tells this one to let it go. What is typed in it is
    written out first. Caught before what is under the pointer (an editor would take the tab's title as text). */
 const PANEL="text/lattice-panel",lattice=e=>!!Dock.drag||!!e.dataTransfer?.types.includes(PANEL);
 document.addEventListener("dragstart",e=>{
  const tab=e.target.closest?.(".tab");if(!tab)return;
  const pid=tab.dataset.pid;
  Dock.drag=pid;e.dataTransfer.setData(PANEL,JSON.stringify({window:WINDOW,pid,params:Dock.panels[pid]}));e.dataTransfer.setData("text/plain",panelTitle(pid));e.dataTransfer.effectAllowed="move";
  if(Files[pid])safe(()=>flushFile(pid));
 });
 document.addEventListener("dragend",()=>{Dock.drag=null;showDrop(null);});
 document.addEventListener("dragleave",e=>{if(!e.relatedTarget)showDrop(null);});
 document.addEventListener("dragover",e=>{
  if(!lattice(e))return;
  const body=e.target.closest?.(".stack-body"),bar=e.target.closest?.(".tabs");
  if(body||bar){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect="move";}
  if(body)showDrop(body,body.closest(".float")?"center":dropZone(body,e.clientX,e.clientY));
  else if(bar)showDrop(bar,"center");
  else showDrop(null);
 },true);
 document.addEventListener("drop",e=>{
  if(!lattice(e))return;
  let pid=Dock.drag,remote=null;
  if(!pid){try{remote=JSON.parse(e.dataTransfer.getData(PANEL));}catch(_){}if(remote?.window===WINDOW||!remote?.params?.type||!Dock.types[remote.params.type])return;}
  const body=e.target.closest?.(".stack-body"),bar=e.target.closest?.(".tabs");
  if(!body&&!bar)return;e.preventDefault();e.stopPropagation();showDrop(null);Dock.drag=null;
  const target=findStack((body||bar).dataset.stack);if(!target)return;
  if(remote){
   pid=findPanel(remote.params);
   if(!pid){pid=newId("p");Dock.panels[pid]=remote.params;mountPanel(pid);}
   safe(()=>rpc("tab_moved",{window:remote.window,pid:remote.pid}));
  }
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
 },true);
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
export function findSplit(id,n=Dock.layout.root){
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

// What dragging a tab to the edge of its group does.
export function splitOut(pid,where){
 const s=stackOf(pid);if(!s||s.tabs.length<2)return false;
 detach(pid);splitBeside(s,where,stackNode([pid]));tidy();renderDock();saveLayout();activate(pid);return true;
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
function paramsOf(op){return bindSpace(rawParamsOf(op));}
function rawParamsOf(op){
 // A panel as a saved arrangement writes it: its own parameters, type included.
 if(op.type&&!op.panel){if(!Dock.types[op.type])throw new Error($t("没有这种面板：")+op.type);return {...op};}
 const type=op.panel||"file";
 if(type==="chat")return {type,agent:op.agent||"tutor",...(op.thread?{thread:op.thread}:{})};
 if(type==="file"){if(!op.path)throw new Error($t("打开文件要给 path"));return {type,path:op.path};}
 if(type==="map")return {type,topic:op.topic||null};
 if(type==="web"){if(!/^https?:\/\//.test(op.url||""))throw new Error($t("打开网页要给 http(s) 的 url"));return {type,url:op.url};}
 if(!Dock.types[type])throw new Error($t("没有这种面板：")+type);
 return {type};
}
function placePanel(pid,where,to){
 where=where||"tab";
 if(where==="float"){const origin=placeOf(pid);detach(pid);const rect=el("#dock").getBoundingClientRect();
  Dock.layout.floats.push({id:newId("f"),x:Math.round(rect.width*.3),y:60,w:Math.round(Math.max(480,rect.width*.4)),h:Math.round(rect.height*.6),stack:stackNode([pid]),origin});return;}
 const anchor=to&&to!==pid?stackOf(to):null;
 detach(pid);
 const target=anchor||targetStack(sideOf(pid));
 // Asked to go in as a tab over a conversation that is on show: beside it instead.
 if((where==="tab"||where==="center")&&covers(target)&&target.active!==pid){splitBeside(target,"right",stackNode([pid]));return;}
 if(where==="tab"||where==="center"){target.tabs.push(pid);target.active=pid;}
 else if(["left","right","top","bottom"].includes(where))splitBeside(target,where,stackNode([pid]));
 else throw new Error($t("where 应为 tab、left、right、top、bottom 或 float"));
}
export function buildSpec(spec,used){
 if(Array.isArray(spec))spec={tabs:spec};
 if(spec.tabs){
  const tabs=[];
  for(const ref of spec.tabs){
   // A main conversation or quick answer copied from another state's arrangement is this state's own.
   const params=typeof ref==="object"?paramsOf(ref.type==="chat"&&BY_STATE.has(ref.agent)&&!ref.thread?{...ref,space:undefined}:ref):null;
   let pid=typeof ref==="string"?resolvePanel(ref):findPanel(params);
   if(!pid&&params){pid=newId("p");Dock.panels[pid]=params;mountPanel(pid);}
   if(!pid)throw new Error($t("找不到面板：")+ref);
   // One panel shows in one place per workspace.
   if(!used.has(pid)){used.add(pid);tabs.push(pid);}
  }
  return {...stackNode(tabs),...(spec.keep?{keep:true}:{}),active:tabs.includes(resolvePanel(spec.active))?resolvePanel(spec.active):tabs[0]||null};
 }
 const parts=(spec.parts||[]).map(x=>buildSpec(x,used));
 if(!parts.length)throw new Error($t("layout 的 parts 不能为空"));
 const sizes=(spec.sizes&&spec.sizes.length===parts.length?spec.sizes:parts.map(()=>1/parts.length)).map(Number);
 return {t:"split",id:newId("n"),dir:spec.split==="v"?"v":"h",sizes,kids:parts};
}
export async function runUiOps(ops,thread){
 const snapshot=newId("u");
 UiSnapshots[snapshot]={dock:dockSnapshot(),ui:JSON.parse(JSON.stringify(S.ui))};
 // What an AI does stays in the working state it was asked from, even when the learner has gone to another.
 const here=Dock.space,focus=Dock.focus,from=Dock.origin[thread],away=from&&from!==here&&Dock.spaces[from]&&!spaceOf(from)?.hidden?from:null;
 if(away){Dock.away=true;Dock.space=away;Dock.layout=Dock.spaces[away];}
 const results=[];
 for(const op of ops||[]){
  try{
   if(op.do==="open"){
    const params=paramsOf(op);let pid=findPanel(params);
    const there=pid?null:heldElsewhere(params);
    if(there!=null){safe(()=>rpc("window_show",{window:there,params}));results.push({ok:true,note:$t("它开在另一个窗口里，那个窗口到了前面")});continue;}
    if(!pid){pid=newId("p");Dock.panels[pid]=params;mountPanel(pid);}
    placePanel(pid,op.where,resolvePanel(op.to));results.push({ok:true,panel:pid});
   }else if(["close","focus","float","move"].includes(op.do)){
    const pid=resolvePanel(op.panel);if(!pid)throw new Error($t("找不到面板：")+op.panel);
    if(op.do==="close"){await closePanel(pid);}
    else if(op.do==="focus"){const s=stackOf(pid);if(s)s.active=pid;Dock.focus=pid;}
    else if(op.do==="float")placePanel(pid,"float");
    else placePanel(pid,op.where,resolvePanel(op.to));
    results.push({ok:true,panel:pid});
   }else if(op.do==="layout"){
    setLayout(layoutFromSpec(op.spec||{}));await dropUnused();results.push({ok:true});
   }else if(op.do==="workspace"){
    if(WINDOW)throw new Error(Dock.own?$t("这个工作状态在单独的窗口里，这里不能切换或新建工作状态"):$t("这是单独的窗口，这里不能切换或新建工作状态"));
    if(away)throw new Error($t("学习者已经离开这个工作状态，这里不能切换"));
    const found=findSpace(op.name);
    if(op.new){
     if(!op.name)throw new Error($t("新工作状态要给 name"));
     createSpace({name:String(op.name).slice(0,20),icon:SPACE_ICONS.includes(op.icon)?op.icon:"layout",spec:op.spec||null});
    }else{if(!found)throw new Error($t("没有这个工作状态：{0}；有：",op.name)+visibleSpaces().map(x=>x.name).join("、"));switchSpace(found.id);}
    results.push({ok:true,workspace:currentSpace().name});
   }else if(op.do==="theme"){
    results.push(themeOp(op));
   }else if(op.do==="sidebar"){
    if(op.list&&!SIDE_SECTIONS[op.list])throw new Error($t("没有这个左栏列表：{0}；有：",op.list)+Object.keys(SIDE_SECTIONS).join("、"));
    if(op.list&&op.open!==false)showList(op.list);else setSideOpen(op.open!==false);results.push({ok:true});
   }else if(op.do==="set"&&(op.key==="zoom"||op.panel&&VIEW_KEYS.includes(op.key))){
    const pid=resolvePanel(op.panel);if(!pid)throw new Error(op.key+" "+$t("要给 panel：面板 id 或标题"));
    if(op.key==="zoom"&&op.value!=null&&!(Number(op.value)>0))throw new Error($t("zoom 的 value 是倍数，比如 1.2"));
    setView(pid,op.key,op.value==null?null:op.key==="read_width"?String(op.value):Number(op.value));results.push({ok:true,panel:pid,[op.key]:viewOf(Dock.panels[pid],op.key)});
   }else if(op.do==="set"){
    const keys=["theme","font_size","code_font_size","line_height","read_width","density"];
    if(!keys.includes(op.key))throw new Error($t("只能改 {0}，或者给 panel 改 zoom",keys.join("、")));
    S.ui[op.key]=op.value;applyUi();saveUi();results.push({ok:true});
   }else throw new Error($t("不认识的操作：")+op.do);
  }catch(e){results.push({ok:false,error:e.message});}
 }
 tidy();
 const panels=[];eachStack(s=>s.tabs.forEach(pid=>panels.push({id:pid,title:panelTitle(pid),type:Dock.panels[pid].type})));
 const workspace=currentSpace().name;
 if(away){Dock.away=false;Dock.space=here;Dock.layout=Dock.spaces[here];Dock.focus=focus;Dock.notice.add(away);}
 renderDock();saveLayout();renderSide();renderStatus();
 return {snapshot,workspace,results,panels};
}
export async function restoreUi(snapshot){
 const s=UiSnapshots[snapshot];if(!s)return toast($t("这次改动之前的界面已经找不到了（重启过）"),"error");
 S.ui=s.ui;applyUi();saveUi();await restoreDock(s.dock);renderSide();toast($t("界面已还原"));
}
