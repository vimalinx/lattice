"use strict";
/* Working states (工作状态): the tabs along the status bar. A state is one combination of windows and nothing more: what is
   open and how it is arranged, kept as it was left. The left column, the look and the topic do not change with it.
   Windows are shared between states, so a conversation is the same conversation in every state.
   A template is where a new state starts from: it is used once and does not change with the state. */
const TUTOR={type:"chat",agent:"tutor"},FLASH={type:"chat",agent:"flash"};
const TEMPLATES=[
 {id:"chat",name:"学习",icon:"bot",
  spec:{split:"h",sizes:[.46,.54],parts:[{split:"v",sizes:[.7,.3],parts:[{tabs:[TUTOR]},{tabs:[FLASH]}]},{tabs:[{type:"home"}],keep:true}]}},
 {id:"write",name:"写作",icon:"edit",
  spec:{split:"h",sizes:[.78,.22],parts:[{tabs:[],keep:true},{tabs:[{type:"noteinfo"}]}]}},
 {id:"cards",name:"复习",icon:"refresh",
  spec:{split:"h",sizes:[.38,.62],parts:[{tabs:[{type:"library"}]},{split:"v",sizes:[.7,.3],parts:[{tabs:[{type:"review"},{type:"memory"}],keep:true},{tabs:[FLASH]}]}]}},
 // Notes as in Obsidian: the note in the middle, its outline and links beside it.
 {id:"notes",name:"阅读",icon:"eye",
  spec:{split:"h",sizes:[.7,.3],parts:[{tabs:[],keep:true},{split:"v",sizes:[.56,.44],parts:[{tabs:[{type:"noteinfo"}]},{tabs:[FLASH]}]}]}},
 {id:"work",name:"动手",icon:"terminal",
  spec:{split:"h",sizes:[.64,.36],parts:[{tabs:[],keep:true},{tabs:[FLASH]}]}},
 {id:"map",name:"梳理",icon:"network",
  spec:{split:"h",sizes:[.6,.4],parts:[{tabs:[{type:"map"}]},{split:"v",sizes:[.55,.45],parts:[{tabs:[],keep:true},{tabs:[TUTOR]}]}]}},
 // Skills: the store, a skill's SKILL.md opening beside it, the main conversation to try them in.
 {id:"skills",name:"定制",icon:"tag",
  spec:{split:"h",sizes:[.5,.5],parts:[{tabs:[{type:"skills"}]},{split:"v",sizes:[.58,.42],parts:[{tabs:[],keep:true},{tabs:[TUTOR]}]}]}},
 {id:"files",name:"整理",icon:"pin",
  spec:{split:"h",sizes:[.68,.32],parts:[{tabs:[],keep:true},{tabs:[FLASH]}]}},
];
const SPACE_ICONS=["bot","spark","card","document","book","flask","code","network","map","folder","search","history","bulb","edit","terminal","calendar","layout","home","tag","pin"];
function spaceTemplates(){return [...TEMPLATES,...(S.ui.templates||[])];}
function templateOf(id){return spaceTemplates().find(t=>t.id===id)||null;}
function spaceList(){const list=(S.ui.spaces||[]).filter(x=>x.name);return list.length?list:[{id:TEMPLATES[0].id,name:TEMPLATES[0].name,icon:TEMPLATES[0].icon}];}
function visibleSpaces(){return spaceList().filter(x=>!x.hidden);}
function spaceOf(id){return spaceList().find(x=>x.id===id)||null;}
function findSpace(name){const n=String(name||"").trim();return spaceList().find(x=>x.id===n)||spaceList().find(x=>x.name===n)||spaceList().find(x=>n&&x.name.includes(n))||null;}
function currentSpace(){return spaceOf(Dock.space)||visibleSpaces()[0];}
function spaceSpec(sp){return templateOf(sp.from||sp.id)?.spec;}
function writeSpaces(list){S.ui.spaces=list;saveUi();renderStatus();spaceSettingsChanged();}
// The settings page lists the states; keep it in step when they change.
function spaceSettingsChanged(){
 Object.keys(Dock.panels).forEach(pid=>{const p=Dock.panels[pid],node=Dock.els[pid];if(p.type==="settings"&&p.page==="layout"&&node?.isConnected)safe(()=>renderSettings(node,"layout"));});
}
function changeSpace(id,change){writeSpaces(spaceList().map(x=>x.id===id?{...x,...change}:x));}
// States are named for what is being done; the first ones carried the names of the left column's lists.
const LIST_NAMES={chat:"对话",cards:"知识卡",notes:"笔记与课程",work:"实验与代码",map:"知识图",skills:"技能",files:"文件"};
/* The first states: learning, writing and review, and any saved arrangement that holds a file; the other saved ones closed. */
function seedSpaces(saved){
 if(WINDOW)return;
 const had=(S.ui.spaces||[]).filter(x=>x.name);
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
function layoutFromSpec(spec){
 spec=spec||{tabs:[],keep:true};
 const used=new Set(),root=buildSpec(spec,used);
 const floats=(spec.floats||[]).map(f=>({id:newId("f"),x:f.x,y:f.y,w:f.w,h:f.h,stack:buildSpec({tabs:f.tabs||[]},used)}));
 return {root,floats};
}
// The arrangement on screen, written the way a workspace's default is: panels by their parameters, not their ids.
function specOf(n){
 return n.t==="stack"?{tabs:n.tabs.map(pid=>({...Dock.panels[pid]})),...(n.keep?{keep:true}:{})}:{split:n.dir,sizes:n.sizes.map(x=>+x.toFixed(3)),parts:n.kids.map(specOf)};
}
function layoutSpec(layout=Dock.layout){
 return {...specOf(layout.root),floats:(layout.floats||[]).map(f=>({x:f.x,y:f.y,w:f.w,h:f.h,tabs:f.stack.tabs.map(pid=>({...Dock.panels[pid]}))}))};
}
function switchSpace(id){
 const sp=spaceOf(id);if(!sp)return;
 if(id!==Dock.space){
  Dock.space=id;
  if(!Dock.spaces[id])Dock.spaces[id]=layoutFromSpec(spaceSpec(sp));
  setLayout(Dock.spaces[id]);tidy();
  const shown=[];eachStack(s=>{if(s.active)shown.push(s.active);});
  Dock.focus=shown.find(hosts)||shown[0]||null;
  renderDock();saveLayout();spaceSettingsChanged();noteFollow();
 }
 Dock.notice.delete(id);renderStatus();
}
function freeName(name){const taken=new Set(spaceList().map(x=>x.name));if(!taken.has(name))return name;let n=2;while(taken.has(name+" "+n))n++;return name+" "+n;}
function createSpace({name,icon,spec,from}){
 const id="w"+Math.random().toString(36).slice(2,8);
 writeSpaces([...spaceList(),{id,name,icon,...(from?{from}:{})}]);
 Dock.spaces[id]=layoutFromSpec(spec||layoutSpec());
 switchSpace(id);return id;
}
/* Closing puts a state away with its arrangement, to be opened again from the +. */
function closeSpace(id){
 if(visibleSpaces().length<2)return toast("至少留一个工作状态");
 changeSpace(id,{hidden:true});
 if(Dock.space===id)switchSpace(visibleSpaces()[0].id);
}
async function removeSpace(id){
 const left=spaceList().filter(x=>x.id!==id);if(!left.some(x=>!x.hidden))return toast("至少留一个工作状态");
 writeSpaces(left);delete Dock.spaces[id];
 if(Dock.space===id){Dock.space=null;switchSpace(visibleSpaces()[0].id);}
 await dropUnused();saveLayout();
}
function moveSpaceTo(id,before){
 const list=spaceList(),from=list.findIndex(x=>x.id===id);if(from<0||id===before)return;
 const [sp]=list.splice(from,1);list.splice(list.findIndex(x=>x.id===before),0,sp);writeSpaces(list);
}
function spaceTabs(){
 return '<div class="st-tabs">'+visibleSpaces().map((sp,i)=>'<button class="st-tab'+(sp.id===Dock.space?" on":"")+'" draggable="true" data-action="space" data-space="'+esc(sp.id)+'">'+svg(sp.icon||"layout",12)+'<span>'+esc(sp.name)+'</span>'+(Dock.notice.has(sp.id)?'<i></i>':"")+'</button>').join("")+
  '<button class="st-add" data-action="space-add" title="新工作状态">'+svg("plus",12)+'</button></div>';
}
function spaceMenu(id,at){
 const sp=spaceOf(id);if(!sp)return;
 const item=(action,icon,label)=>'<button data-action="'+action+'" data-space="'+esc(id)+'">'+svg(icon,14)+'<span>'+label+'</span></button>';
 popMenu(at,'<div class="menu-label">'+esc(sp.name)+'</div>'+item("space-rename","edit","改名…")+item("space-copy","layout","复制一份")+item("space-template","save","存成模板")+'<hr/>'+item("space-close","close","关闭"));
}
function spaceAddMenu(at){
 const shut=spaceList().filter(x=>x.hidden);
 popMenu(at,'<div class="menu-label">新工作状态</div><button data-action="space-blank">'+svg("layout",14)+'<span>空白</span></button>'+
  spaceTemplates().map(t=>'<button data-action="space-from" data-template="'+esc(t.id)+'">'+svg(t.icon||"layout",14)+'<span>'+esc(t.name)+'</span></button>').join("")+
  (shut.length?'<hr/><div class="menu-label">已关闭</div>'+shut.map(x=>'<button data-action="space-reopen" data-space="'+esc(x.id)+'">'+svg(x.icon||"layout",14)+'<span>'+esc(x.name)+'</span></button>').join(""):""));
}
async function spaceAction(kind,a){
 const id=a.dataset.space,sp=spaceOf(id);
 switch(kind){
  case "space":return switchSpace(id);
  case "space-add":return spaceAddMenu(a);
  case "space-blank":Dock.into=null;return createSpace({name:freeName("工作状态"),icon:"layout",spec:{tabs:[],keep:true}});
  case "space-from":{const t=templateOf(a.dataset.template);if(!t)return;Dock.into=null;return createSpace({name:freeName(t.name),icon:t.icon,spec:t.spec,from:t.id});}
  case "space-rename":{const name=(await askText("工作状态的名字",sp.name,{ok:"改名"}))?.trim();if(name)changeSpace(id,{name:name.slice(0,20)});return;}
  case "space-copy":return createSpace({name:freeName(sp.name),icon:sp.icon,spec:layoutSpec(Dock.spaces[id]||Dock.layout),from:sp.from});
  case "space-template":{const t={id:"t"+Math.random().toString(36).slice(2,8),name:sp.name,icon:sp.icon,spec:layoutSpec(Dock.spaces[id]||Dock.layout)};S.ui.templates=[...(S.ui.templates||[]),t];saveUi();spaceSettingsChanged();return toast("存成了模板「"+t.name+"」，底栏的 + 里能用");}
  case "space-close":return closeSpace(id);
  case "space-reopen":changeSpace(id,{hidden:false});return switchSpace(id);
  case "space-delete":if(!await ask("里面的文件和对话都还在。",{title:"删除工作状态「"+sp.name+"」？",danger:true,ok:"删除"}))return;return removeSpace(id);
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
   the pointer reaches it: it moves there, or with Ctrl held is shown there too. The list is redrawn under the drag, which a
   browser drag does not survive, so this one follows the mouse itself. */
const Peek={id:null,timer:null,hide:null,drag:null};
function spaceWindows(id){const out=[];if(Dock.spaces[id])eachStack(s=>s.tabs.forEach(pid=>{if(!out.includes(pid))out.push(pid);}),Dock.spaces[id]);return out;}
function peekShow(id){
 const tab=el('.st-tab[data-space="'+CSS.escape(id)+'"]'),sp=spaceOf(id);if(!tab||!sp)return;
 clearTimeout(Peek.hide);Peek.id=id;
 if(!Dock.spaces[id])Dock.spaces[id]=layoutFromSpec(spaceSpec(sp));
 const at=visibleSpaces().findIndex(x=>x.id===id);
 let box=el("#st-peek");if(!box){box=h('<div id="st-peek" class="st-peek"></div>');document.body.appendChild(box);}
 const list=spaceWindows(id),row=pid=>{const p=Dock.panels[pid],t=Dock.types[p.type],icon=typeof t?.icon==="function"?t.icon(p):t?.icon;
  return '<div class="st-win" data-pid="'+esc(pid)+'" data-space="'+esc(id)+'" title="'+esc(panelTitle(pid))+'">'+svg(icon||"layout",13)+'<span>'+esc(panelTitle(pid))+'</span></div>';};
 box.innerHTML='<div class="menu-label">'+esc(sp.name)+(at<9?'<small>Ctrl Shift '+(at+1)+' · 右键改</small>':"")+'</div>'+(list.map(row).join("")||'<p class="side-empty">还没有窗口</p>');
 const r=tab.getBoundingClientRect();box.style.left=Math.max(8,Math.min(r.left,innerWidth-box.offsetWidth-8))+"px";box.style.bottom=innerHeight-r.top+6+"px";
}
function peekHide(){clearTimeout(Peek.timer);clearTimeout(Peek.hide);Peek.id=null;el("#st-peek")?.remove();}
// A short step between a tab and its list, or from one tab to the next, does not close it.
function peekLeave(){clearTimeout(Peek.timer);clearTimeout(Peek.hide);Peek.hide=setTimeout(peekHide,260);}
function inSpace(id,fn){const space=Dock.space,layout=Dock.layout;Dock.space=id;Dock.layout=Dock.spaces[id];try{return fn();}finally{Dock.space=space;Dock.layout=layout;}}
function sendToSpace(pid,from,to,copy){
 if(from===to)return;
 if(!Dock.spaces[to])Dock.spaces[to]=layoutFromSpec(spaceSpec(spaceOf(to)));
 Dock.into=null;
 inSpace(to,()=>{if(!stackOf(pid)){const s=targetStack(sideOf(pid));s.tabs.push(pid);s.active=pid;tidy();}});
 if(!copy){inSpace(from,()=>{detach(pid);tidy();});if(Dock.focus===pid&&from===Dock.space)Dock.focus=null;}
 renderDock();saveLayout();
}
function peekDrag(down,win){
 const d=Peek.drag={pid:win.dataset.pid,from:win.dataset.space,to:null,copy:false,ghost:null},title=panelTitle(d.pid);
 const paint=()=>{if(!d.ghost)return;d.ghost.textContent=d.to&&d.to!==d.from?(d.copy?"复制到「":"移动到「")+spaceOf(d.to).name+"」":title;d.ghost.classList.toggle("copy",d.copy);
  all(".st-tab").forEach(t=>t.classList.toggle("drop",t.dataset.space===d.to&&d.to!==d.from));};
 const move=e=>{
  if(!d.ghost){if(Math.hypot(e.clientX-down.clientX,e.clientY-down.clientY)<5)return;d.ghost=h('<div class="st-ghost"></div>');document.body.appendChild(d.ghost);document.body.classList.add("st-dragging");}
  d.ghost.style.left=e.clientX+12+"px";d.ghost.style.top=e.clientY-38+"px";d.copy=e.ctrlKey;
  const under=document.elementFromPoint(e.clientX,e.clientY),tab=under?.closest?.(".st-tab");
  if(tab){d.to=tab.dataset.space;if(d.to!==Peek.id)peekShow(d.to);}else d.to=under?.closest?.("#st-peek")?Peek.id:null;
  clearTimeout(Peek.hide);paint();
 };
 const key=e=>{if(e.key==="Escape"){d.to=null;d.cancel=true;up(e);}else if(e.key==="Control"){d.copy=e.type==="keydown";paint();}};
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
