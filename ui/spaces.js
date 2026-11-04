import {$t,$p} from "./i18n.js";
import {Dock} from "./state.js";
import {S,WINDOW,all,ask,askText,el,esc,h,rpc,safe,svg,toast} from "./core.js";
import {activate,buildSpec,detach,dropUnused,eachStack,findPanel,findStack,flushLayout,hosts,mountPanel,newId,panelTitle,renderDock,saveLayout,setLayout,sideOf,stackOf,targetStack,tidy,building} from "./dock.js";
import {flushAll} from "./files.js";
import {noteFollow} from "./notes.js";
import {renderSettings} from "./panels.js";
import {popMenu,renderStatus,saveUi} from "./app.js";
import {renderSide} from "./side.js";
/* Working states (工作状态): the tabs along the status bar. Each is like a program of its own, and is a file of its own in
   the vault (states/<name>.json): what is open and how it is arranged, its left column, the topic learned in it and so its
   own main conversation and quick answer, kept as it was left. It can be taken out into a window of its own that is the
   whole interface for that state. The look is the same in all of them. A file or a conversation opened by hand can sit in
   several states; it is the same window in each.
   A template is where a new state starts from: it is used once and does not change with the state. */
const TUTOR={type:"chat",agent:"tutor"},FLASH={type:"chat",agent:"flash"};
const TEMPLATES=[
 {id:"chat",name:$p("工作状态","学习"),icon:"bot",
  spec:{split:"h",sizes:[.46,.54],parts:[{split:"v",sizes:[.7,.3],parts:[{tabs:[TUTOR]},{tabs:[FLASH]}]},{tabs:[{type:"home"}],keep:true}]}},
 {id:"write",name:$p("工作状态","写作"),icon:"edit",
  spec:{split:"h",sizes:[.78,.22],parts:[{tabs:[],keep:true},{tabs:[{type:"noteinfo"}]}]}},
 {id:"cards",name:$p("工作状态","复习"),icon:"refresh",
  spec:{split:"h",sizes:[.38,.62],parts:[{tabs:[{type:"library"}]},{split:"v",sizes:[.7,.3],parts:[{tabs:[{type:"review"},{type:"memory"}],keep:true},{tabs:[FLASH]}]}]}},
 // Notes as in Obsidian: the note in the middle, its outline and links beside it.
 {id:"notes",name:$p("工作状态","阅读"),icon:"eye",
  spec:{split:"h",sizes:[.7,.3],parts:[{tabs:[],keep:true},{split:"v",sizes:[.56,.44],parts:[{tabs:[{type:"noteinfo"}]},{tabs:[FLASH]}]}]}},
 {id:"work",name:$p("工作状态","动手"),icon:"terminal",
  spec:{split:"h",sizes:[.64,.36],parts:[{tabs:[],keep:true},{tabs:[FLASH]}]}},
 {id:"map",name:$p("工作状态","梳理"),icon:"network",
  spec:{split:"h",sizes:[.6,.4],parts:[{tabs:[{type:"map"}]},{split:"v",sizes:[.55,.45],parts:[{tabs:[],keep:true},{tabs:[TUTOR]}]}]}},
 // Skills: the store, a skill's SKILL.md opening beside it, the main conversation to try them in.
 {id:"skills",name:$p("工作状态","定制"),icon:"tag",
  spec:{split:"h",sizes:[.5,.5],parts:[{tabs:[{type:"skills"}]},{split:"v",sizes:[.58,.42],parts:[{tabs:[],keep:true},{tabs:[TUTOR]}]}]}},
 {id:"files",name:$p("工作状态","整理"),icon:"pin",
  spec:{split:"h",sizes:[.68,.32],parts:[{tabs:[],keep:true},{tabs:[FLASH]}]}},
];
export const SPACE_ICONS=["bot","spark","card","document","book","flask","code","network","map","folder","search","history","bulb","edit","terminal","calendar","layout","home","tag","pin"];
function spaceTemplates(){return [...TEMPLATES,...(S.ui.templates||[])];}
export function templateOf(id){return spaceTemplates().find(t=>t.id===id)||null;}
export function spaceList(){const list=(S.states||[]).filter(x=>x.name);return list.length?list:[{id:TEMPLATES[0].id,name:TEMPLATES[0].name,icon:TEMPLATES[0].icon}];}
export function visibleSpaces(){return spaceList().filter(x=>!x.hidden);}
// The states the main window holds: open, and not taken out into a window of their own.
export function mainSpaces(){return visibleSpaces().filter(x=>!Dock.out[x.id]);}
export function spaceOf(id){return spaceList().find(x=>x.id===id)||null;}
export function findSpace(name){const n=String(name||"").trim();return spaceList().find(x=>x.id===n)||spaceList().find(x=>x.name===n)||spaceList().find(x=>n&&x.name.includes(n))||null;}
export function currentSpace(){return spaceOf(Dock.space)||mainSpaces()[0]||visibleSpaces()[0];}
export function spaceSpec(sp){return templateOf(sp.from||sp.id)?.spec;}
/* The topic learned in a state. One not chosen yet takes the topic being learned now; one deleted since is none (kept as
   it was: a topic an AI has just made is not in the list until the next refresh). */
export function topicOf(space=Dock.space){
 const l=Dock.spaces[space];if(!l)return S.data?.active_topic||null;
 if(l.topic===undefined)l.topic=S.data?.active_topic||null;
 return l.topic&&S.data?.topics&&!S.data.topics.some(t=>t.id===l.topic)?null:l.topic;
}
export function setTopicOf(space,topic){const l=Dock.spaces[space];if(l)l.topic=topic||null;if(space===Dock.space)S.data.active_topic=topic||null;saveLayout();}
// What is done without saying where (a note written, a passage annotated) is about the topic of the state in front.
export function topicHere(){return WINDOW&&!Dock.own?null:safe(()=>rpc("topic_here",{topic:topicOf()}));}
// The list goes into the states' files with the main window's next save.
function writeSpaces(list){S.states=list;saveLayout();renderStatus();spaceSettingsChanged();}
// The settings page lists the states; keep it in step when they change.
function spaceSettingsChanged(){
 Object.keys(Dock.panels).forEach(pid=>{const p=Dock.panels[pid],node=Dock.els[pid];if(p.type==="settings"&&p.page==="layout"&&node?.isConnected)safe(()=>renderSettings(node,"layout"));});
}
function changeSpace(id,change){writeSpaces(spaceList().map(x=>x.id===id?{...x,...change}:x));}
// States are named for what is being done; the first ones carried the names of the left column's lists.
// i18n: keep (names saved by earlier versions, as they were saved)
const LIST_NAMES={chat:"对话",cards:"知识卡",notes:"笔记与课程",work:"实验与代码",map:"知识图",skills:"技能",files:"文件"};
/* The first states: learning, writing and review, and any saved arrangement that holds a file; the other saved ones closed. */
export function seedSpaces(saved){
 if(WINDOW)return;
 const had=(S.states||[]).filter(x=>x.name);
 if(had.length){
  if(!had.some(x=>x.name===LIST_NAMES[x.id]))return;
  const list=had.map(x=>x.name===LIST_NAMES[x.id]?{...x,name:templateOf(x.id).name,icon:templateOf(x.id).icon}:x);
  if(!list.some(x=>x.id==="write")){const t=templateOf("write");list.splice(1,0,{id:t.id,name:t.name,icon:t.icon});}
  return writeSpaces(list);
 }
 const kept=saved?.spaces||{},panels=saved?.panels||{},first=["chat","write","cards"];
 const holdsFile=l=>{let hit=false;eachStack(s=>{if(s.tabs.some(pid=>panels[pid]?.type==="file"))hit=true;},l);return hit;};
 writeSpaces(TEMPLATES.filter(t=>first.includes(t.id)||kept[t.id]?.root).map(t=>({id:t.id,name:t.name,icon:t.icon,...(first.includes(t.id)||holdsFile(kept[t.id])?{}:{hidden:true})})));
}
export function layoutFromSpec(spec,space=Dock.space){
 spec=spec||{tabs:[],keep:true};
 return building(space,()=>{
  const used=new Set(),root=buildSpec(spec,used);
  const floats=(spec.floats||[]).map(f=>({id:newId("f"),x:f.x,y:f.y,w:f.w,h:f.h,stack:buildSpec({tabs:f.tabs||[]},used)}));
  return {root,floats};
 });
}
// The arrangement on screen, written the way a workspace's default is: panels by their parameters, not their ids.
function specOf(n){
 return n.t==="stack"?{tabs:n.tabs.map(pid=>({...Dock.panels[pid]})),...(n.keep?{keep:true}:{})}:{split:n.dir,sizes:n.sizes.map(x=>+x.toFixed(3)),parts:n.kids.map(specOf)};
}
function layoutSpec(layout=Dock.layout){
 return {...specOf(layout.root),floats:(layout.floats||[]).map(f=>({x:f.x,y:f.y,w:f.w,h:f.h,tabs:f.stack.tabs.map(pid=>({...Dock.panels[pid]}))}))};
}
export function switchSpace(id){
 const sp=spaceOf(id);if(!sp)return;
 // A state in a window of its own: that window comes to the front. A window holding a state shows only that one.
 if(Dock.out[id])return safe(()=>rpc("window_raise",{window:Dock.out[id]}));
 if(Dock.own&&id!==Dock.own)return;
 if(id!==Dock.space){
  Dock.space=id;
  if(!Dock.spaces[id])Dock.spaces[id]=layoutFromSpec(spaceSpec(sp),id);
  setLayout(Dock.spaces[id]);tidy();S.data.active_topic=topicOf(id);topicHere();
  const shown=[];eachStack(s=>{if(s.active)shown.push(s.active);});
  Dock.focus=shown.find(hosts)||shown[0]||null;
  renderDock();renderSide();saveLayout();spaceSettingsChanged();noteFollow();
 }
 Dock.notice.delete(id);renderStatus();
}
function freeName(name){const taken=new Set(spaceList().map(x=>x.name));if(!taken.has(name))return name;let n=2;while(taken.has(name+" "+n))n++;return name+" "+n;}
export function createSpace({name,icon,spec,from}){
 if(Dock.own){toast($t("新的工作状态在主窗口里建"));return null;}
 const id="w"+Math.random().toString(36).slice(2,8);
 writeSpaces([...spaceList(),{id,name,icon,...(from?{from}:{})}]);
 Dock.spaces[id]=layoutFromSpec(spec||layoutSpec(),id);
 switchSpace(id);return id;
}
/* Closing puts a state away with its arrangement, to be opened again from the +. */
export function closeSpace(id){
 if(Dock.out[id])return toast($t("它在单独的窗口里，先放回主窗口"));
 if(mainSpaces().length<2)return toast($t("至少留一个工作状态"));
 changeSpace(id,{hidden:true});
 if(Dock.space===id)switchSpace(mainSpaces()[0].id);
}
export async function removeSpace(id){
 if(Dock.out[id])return toast($t("它在单独的窗口里，先放回主窗口"));
 const left=spaceList().filter(x=>x.id!==id);if(!left.some(x=>!x.hidden&&!Dock.out[x.id]))return toast($t("至少留一个工作状态"));
 writeSpaces(left);delete Dock.spaces[id];safe(()=>rpc("state_delete",{space:id}));
 if(Dock.space===id){Dock.space=null;switchSpace(mainSpaces()[0].id);}
 await dropUnused();saveLayout();
}
function moveSpaceTo(id,before){
 const list=spaceList(),from=list.findIndex(x=>x.id===id);if(from<0||id===before)return;
 const [sp]=list.splice(from,1);list.splice(list.findIndex(x=>x.id===before),0,sp);writeSpaces(list);
}
export function spaceTabs(){
 // A window holding a state shows that one, and the way back.
 if(Dock.own){const sp=spaceOf(Dock.own);return "<div class=\"st-own\" title=\""+$t("这个窗口是工作状态「{0}」",esc(sp?.name||""))+"\">"+svg(sp?.icon||"layout",12)+"<span>"+esc(sp?.name||"")+"</span><button data-action=\"space-return\" data-space=\""+esc(Dock.own)+"\" title=\""+$t("放回主窗口")+"\" aria-label=\""+$t("放回主窗口")+"\">"+svg("undo",11)+"</button></div>";}
 return "<div class=\"st-tabs\">"+visibleSpaces().map((sp,i)=>'<button class="st-tab'+(sp.id===Dock.space?" on":"")+(Dock.out[sp.id]?" out":"")+'" draggable="true" data-action="space" data-space="'+esc(sp.id)+'"'+(Dock.out[sp.id]?' title="'+$t("在单独的窗口里，点一下切过去")+'"':"")+'>'+svg(sp.icon||"layout",12)+'<span>'+esc(sp.name)+'</span>'+(Dock.out[sp.id]?svg("external",10):"")+(Dock.notice.has(sp.id)?'<i></i>':"")+'</button>').join("")+"<button class=\"st-add\" data-action=\"space-add\" title=\""+$t("新工作状态")+"\">"+svg("plus",12)+"</button></div>";
}
export function spaceMenu(id,at){
 const sp=spaceOf(id);if(!sp)return;
 const item=(action,icon,label)=>'<button data-action="'+action+'" data-space="'+esc(id)+'">'+svg(icon,14)+'<span>'+label+'</span></button>';
 if(Dock.own||Dock.out[id])return popMenu(at,'<div class="menu-label">'+esc(sp.name)+'</div>'+(Dock.own?"":item("space","external",$t("切到它的窗口")))+item("space-return","undo",$t("放回主窗口")));
 popMenu(at,'<div class="menu-label">'+esc(sp.name)+'</div>'+item("space-rename","edit",$t("改名…"))+item("space-copy","layout",$t("复制一份"))+item("space-template","save",$t("存成模板"))+item("space-window","external",$t("放进单独的窗口"))+'<hr/>'+item("space-close","close",$t("关闭")));
}
function spaceAddMenu(at){
 const shut=spaceList().filter(x=>x.hidden);
 popMenu(at,"<div class=\"menu-label\">"+$t("新工作状态")+"</div><button data-action=\"space-blank\">"+svg("layout",14)+"<span>"+$t("空白")+"</span></button>"+spaceTemplates().map(t=>'<button data-action="space-from" data-template="'+esc(t.id)+'">'+svg(t.icon||"layout",14)+'<span>'+esc(t.name)+'</span></button>').join("")+(shut.length?"<hr/><div class=\"menu-label\">"+$t("已关闭")+"</div>"+shut.map(x=>'<button data-action="space-reopen" data-space="'+esc(x.id)+'">'+svg(x.icon||"layout",14)+'<span>'+esc(x.name)+'</span></button>').join(""):""));
}
export async function spaceAction(kind,a){
 const id=a.dataset.space,sp=spaceOf(id);
 switch(kind){
  case "space":return switchSpace(id);
  case "space-add":return spaceAddMenu(a);
  case "space-blank":Dock.into=null;return createSpace({name:freeName($t("工作状态")),icon:"layout",spec:{tabs:[],keep:true}});
  case "space-from":{const t=templateOf(a.dataset.template);if(!t)return;Dock.into=null;return createSpace({name:freeName(t.name),icon:t.icon,spec:t.spec,from:t.id});}
  case "space-rename":{const name=(await askText($t("工作状态的名字"),sp.name,{ok:$t("改名")}))?.trim();if(!name)return;changeSpace(id,{name:name.slice(0,20)});if(Dock.out[id])safe(()=>rpc("window_title",{window:Dock.out[id],title:name.slice(0,20)}));return;}
  case "space-window":return spaceToWindow(id);
  case "space-return":return Dock.own?rpc("window_return",{window:WINDOW}):Dock.out[id]?rpc("window_return",{window:Dock.out[id]}):null;
  case "space-copy":return createSpace({name:freeName(sp.name),icon:sp.icon,spec:layoutSpec(Dock.spaces[id]||Dock.layout),from:sp.from});
  case "space-template":{const t={id:"t"+Math.random().toString(36).slice(2,8),name:sp.name,icon:sp.icon,spec:layoutSpec(Dock.spaces[id]||Dock.layout)};S.ui.templates=[...(S.ui.templates||[]),t];saveUi();spaceSettingsChanged();return toast($t("存成了模板「{0}」，底栏的 + 里能用",t.name));}
  case "space-close":return closeSpace(id);
  case "space-reopen":changeSpace(id,{hidden:false});return switchSpace(id);
  case "space-delete":if(!await ask($t("里面的文件和对话都还在。"),{title:$t("删除工作状态「{0}」？",sp.name),danger:true,ok:$t("删除")}))return;return removeSpace(id);
  case "space-template-delete":S.ui.templates=(S.ui.templates||[]).filter(t=>t.id!==a.dataset.template);saveUi();return spaceSettingsChanged();
  case "stack-unkeep":{const s=findStack(a.dataset.stack);if(s){s.keep=false;tidy();renderDock();saveLayout();}return;}
 }
 return null;
}
let spaceDrag=null;
document.addEventListener("dragstart",e=>{spaceDrag=e.target.closest?.(".st-tab")?.dataset.space||null;});
document.addEventListener("dragover",e=>{if(spaceDrag&&e.target.closest?.(".st-tab"))e.preventDefault();});
document.addEventListener("drop",e=>{const to=e.target.closest?.(".st-tab")?.dataset.space;if(spaceDrag&&to){e.preventDefault();moveSpaceTo(spaceDrag,to);}spaceDrag=null;});

/* Hovering a state shows its windows above its tab. A window is dragged from there onto another state, whose list shows as
   the pointer reaches it: it moves there, or with Ctrl (Option on a Mac) held is shown there too. The list is redrawn under the drag, which a
   browser drag does not survive, so this one follows the mouse itself. */
const Peek={id:null,timer:null,hide:null,drag:null};
// Ctrl and a click is the right button on a Mac, where copying by dragging is Option's, as in Finder.
const MAC=/Mac/.test(navigator.platform);
function copying(e){return MAC?e.altKey:e.ctrlKey;}
export function spaceWindows(id){const out=[];if(Dock.spaces[id])eachStack(s=>s.tabs.forEach(pid=>{if(!out.includes(pid))out.push(pid);}),Dock.spaces[id]);return out;}
function peekShow(id){
 const tab=el('.st-tab[data-space="'+CSS.escape(id)+'"]'),sp=spaceOf(id);if(!tab||!sp)return;
 clearTimeout(Peek.hide);Peek.id=id;
 if(!Dock.spaces[id]&&!Dock.out[id])Dock.spaces[id]=layoutFromSpec(spaceSpec(sp),id);
 const at=visibleSpaces().findIndex(x=>x.id===id);
 let box=el("#st-peek");if(!box){box=h('<div id="st-peek" class="st-peek"></div>');document.body.appendChild(box);}
 const list=spaceWindows(id),row=pid=>{const p=Dock.panels[pid],t=Dock.types[p.type],icon=typeof t?.icon==="function"?t.icon(p):t?.icon;
  return '<div class="st-win" data-pid="'+esc(pid)+'" data-space="'+esc(id)+'" title="'+esc(panelTitle(pid))+'">'+svg(icon||"layout",13)+'<span>'+esc(panelTitle(pid))+'</span></div>';};
 box.innerHTML='<div class="menu-label">'+esc(sp.name)+(at<9?"<small>"+(MAC?"⌘ ⇧ ":"Ctrl Shift ")+at+1+" "+$t("· 右键改")+"</small>":"")+'</div>'+(Dock.out[id]?"<p class=\"side-empty\">"+$t("在单独的窗口里")+"</p>":list.map(row).join("")||"<p class=\"side-empty\">"+$t("还没有窗口")+"</p>");
 const r=tab.getBoundingClientRect();box.style.left=Math.max(8,Math.min(r.left,innerWidth-box.offsetWidth-8))+"px";box.style.bottom=innerHeight-r.top+6+"px";
}
function peekHide(){clearTimeout(Peek.timer);clearTimeout(Peek.hide);Peek.id=null;el("#st-peek")?.remove();}
// A short step between a tab and its list, or from one tab to the next, does not close it.
function peekLeave(){clearTimeout(Peek.timer);clearTimeout(Peek.hide);Peek.hide=setTimeout(peekHide,260);}
function inSpace(id,fn){const space=Dock.space,layout=Dock.layout;Dock.space=id;Dock.layout=Dock.spaces[id];try{return fn();}finally{Dock.space=space;Dock.layout=layout;}}
export function sendToSpace(pid,from,to,copy){
 if(from===to)return;
 if(Dock.out[to])return toast($t("「{0}」在单独的窗口里，先放回主窗口再移过去",spaceOf(to)?.name||""));
 if(!Dock.spaces[to])Dock.spaces[to]=layoutFromSpec(spaceSpec(spaceOf(to)),to);
 Dock.into=null;
 inSpace(to,()=>{if(!stackOf(pid)){const s=targetStack(sideOf(pid));s.tabs.push(pid);s.active=pid;tidy();}});
 if(!copy){inSpace(from,()=>{detach(pid);tidy();});if(Dock.focus===pid&&from===Dock.space)Dock.focus=null;}
 renderDock();saveLayout();
}
function peekDrag(down,win){
 const d=Peek.drag={pid:win.dataset.pid,from:win.dataset.space,to:null,copy:false,ghost:null},title=panelTitle(d.pid);
 const paint=()=>{if(!d.ghost)return;d.ghost.textContent=d.to&&d.to!==d.from?(d.copy?$t("复制到「{0}」",spaceOf(d.to).name):$t("移动到「{0}」",spaceOf(d.to).name)):title;d.ghost.classList.toggle("copy",d.copy);
  all(".st-tab").forEach(t=>t.classList.toggle("drop",t.dataset.space===d.to&&d.to!==d.from));};
 const move=e=>{
  if(!d.ghost){if(Math.hypot(e.clientX-down.clientX,e.clientY-down.clientY)<5)return;d.ghost=h('<div class="st-ghost"></div>');document.body.appendChild(d.ghost);document.body.classList.add("st-dragging");}
  d.ghost.style.left=e.clientX+12+"px";d.ghost.style.top=e.clientY-38+"px";d.copy=copying(e);
  const under=document.elementFromPoint(e.clientX,e.clientY),tab=under?.closest?.(".st-tab");
  if(tab){d.to=tab.dataset.space;if(d.to!==Peek.id)peekShow(d.to);}else d.to=under?.closest?.("#st-peek")?Peek.id:null;
  clearTimeout(Peek.hide);paint();
 };
 const key=e=>{if(e.key==="Escape"){d.to=null;d.cancel=true;up(e);}else if(e.key==="Control"||e.key==="Alt"){d.copy=copying(e);paint();}};
 const up=e=>{
  document.removeEventListener("mousemove",move);document.removeEventListener("mouseup",up);document.removeEventListener("keydown",key,true);document.removeEventListener("keyup",key,true);
  d.ghost?.remove();document.body.classList.remove("st-dragging");all(".st-tab.drop").forEach(t=>t.classList.remove("drop"));Peek.drag=null;
  if(d.cancel)return peekHide();
  if(!d.ghost){peekHide();switchSpace(d.from);return activate(d.pid);}
  if(d.to&&d.to!==d.from){sendToSpace(d.pid,d.from,d.to,d.copy);peekShow(d.to);}else peekLeave();
 };
 document.addEventListener("mousemove",move);document.addEventListener("mouseup",up);document.addEventListener("keydown",key,true);document.addEventListener("keyup",key,true);
}
document.addEventListener("mouseover",e=>{
 if(Peek.drag)return;
 const tab=e.target.closest?.(".st-tab"),box=e.target.closest?.("#st-peek");
 if(box)return clearTimeout(Peek.hide);
 if(!tab)return;
 clearTimeout(Peek.timer);clearTimeout(Peek.hide);
 const id=tab.dataset.space;if(Peek.id&&Peek.id!==id)return peekShow(id);
 if(!Peek.id)Peek.timer=setTimeout(()=>{if(tab.matches(":hover"))peekShow(id);},350);
});
document.addEventListener("mouseout",e=>{if(!Peek.drag&&e.target.closest?.(".st-tab,#st-peek")&&!e.relatedTarget?.closest?.(".st-tab,#st-peek"))peekLeave();});
document.addEventListener("mousedown",e=>{const win=e.button===0&&e.target.closest?.(".st-win");if(win){e.preventDefault();peekDrag(e,win);}else if(!e.target.closest?.("#st-peek"))peekHide();});

/* A working state taken out into a window of its own, to put it on another screen. The window shows the state whole and
   saves it; here its tab stays, marked, and brings that window to the front. Windows other states show too stay in
   those. Closing the window brings the state back as it was left there. */
export async function spaceToWindow(id){
 const sp=spaceOf(id);if(!sp||WINDOW)return;
 if(Dock.out[id])return switchSpace(id);
 const left=mainSpaces().filter(x=>x.id!==id);
 if(!left.length)return toast($t("主窗口里至少留一个工作状态"));
 if(!Dock.spaces[id])Dock.spaces[id]=layoutFromSpec(spaceSpec(sp),id);
 await flushAll();await flushLayout();
 const r=await rpc("window_open",{state:id,title:sp.name});
 if(Dock.space===id)switchSpace(left[0].id);
 Dock.out[id]=r.window;delete Dock.spaces[id];Dock.notice.delete(id);
 await dropUnused();renderStatus();saveLayout();spaceSettingsChanged();
}
// Back from its window: its panels join the main window's (one already open here is the same one), and it is shown.
export function spaceFromWindow(id,unit){
 delete Dock.out[id];
 const sp=spaceOf(id);if(!sp){renderStatus();return;}
 const same={};
 for(const [pid,params] of Object.entries(unit?.panels||{})){
  if(!params?.type||!Dock.types[params.type])continue;
  const found=Dock.panels[pid]?pid:findPanel(params);
  if(found){same[pid]=found;continue;}
  Dock.panels[pid]=params;mountPanel(pid);same[pid]=pid;
 }
 const layout=unit?.layout?.root?unit.layout:null;
 if(layout){layout.floats=layout.floats||[];eachStack(s=>{s.tabs=[...new Set(s.tabs.map(pid=>same[pid]).filter(Boolean))];s.active=same[s.active]||s.tabs[0]||null;},layout);}
 Dock.spaces[id]=layout||layoutFromSpec(spaceSpec(sp),id);
 inSpace(id,tidy);
 if(sp.hidden){renderStatus();saveLayout();}else switchSpace(id);
 spaceSettingsChanged();
}
