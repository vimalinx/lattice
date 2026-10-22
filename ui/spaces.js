"use strict";
/* Workspaces: the activity bar's icons. Each is a combination of windows with its own lists in the sidebar and its own
   arrangement, kept as it was left. Panels are shared between them, so a conversation is the same conversation in every
   workspace; the conversation workspace can hold anything the others have, arranged by the learner or by the AI. */
const TUTOR={type:"chat",agent:"tutor"},FLASH={type:"chat",agent:"flash"};
const SPACES=[
 {id:"chat",name:"对话",icon:"bot",side:["topics"],
  spec:{split:"h",sizes:[.46,.54],parts:[{split:"v",sizes:[.7,.3],parts:[{tabs:[TUTOR]},{tabs:[FLASH]}]},{tabs:[{type:"home"}],keep:true}]}},
 // The card library is this workspace's list, so its sidebar stays empty unless the learner adds one.
 {id:"cards",name:"知识卡",icon:"card",side:[],
  spec:{split:"h",sizes:[.38,.62],parts:[{tabs:[{type:"library"}]},{split:"v",sizes:[.7,.3],parts:[{tabs:[{type:"review"},{type:"memory"}],keep:true},{tabs:[FLASH]}]}]}},
 // Notes as in Obsidian: the folder tree on the left, the note in the middle, its outline and links beside it.
 {id:"notes",name:"笔记与课程",icon:"document",side:["notes","lessons"],
  spec:{split:"h",sizes:[.7,.3],parts:[{tabs:[],keep:true},{split:"v",sizes:[.56,.44],parts:[{tabs:[{type:"noteinfo"}]},{tabs:[FLASH]}]}]}},
 {id:"work",name:"实验与代码",icon:"flask",side:["work","practice"],
  spec:{split:"h",sizes:[.64,.36],parts:[{tabs:[],keep:true},{tabs:[FLASH]}]}},
 {id:"map",name:"知识图",icon:"network",side:["topics"],
  spec:{split:"h",sizes:[.6,.4],parts:[{tabs:[{type:"map"}]},{split:"v",sizes:[.55,.45],parts:[{tabs:[],keep:true},{tabs:[TUTOR]}]}]}},
 // Skills: the installed ones listed by kind, the store beside them, a skill's SKILL.md opening in the middle, the main conversation to try them in.
 {id:"skills",name:"技能",icon:"store",side:["skills"],
  spec:{split:"h",sizes:[.5,.5],parts:[{tabs:[{type:"skills"}]},{split:"v",sizes:[.58,.42],parts:[{tabs:[],keep:true},{tabs:[TUTOR]}]}]}},
 {id:"files",name:"文件",icon:"folder",side:["files"],
  spec:{split:"h",sizes:[.68,.32],parts:[{tabs:[],keep:true},{tabs:[FLASH]}]}},
];
const SPACE_ICONS=["bot","spark","card","document","book","flask","code","network","map","folder","search","history","bulb","edit","terminal","calendar","layout","home","tag","pin"];
const SPACE_KEYS=["name","icon","side","spec","hidden"];
/* The learner's list: built-ins with whatever they changed, then their own, in their order. */
function spaceList(){
 const out=[],seen=new Set();
 for(const x of S.ui.spaces||[]){
  const base=SPACES.find(b=>b.id===x.id);
  if(seen.has(x.id)||(!base&&!x.custom))continue;
  seen.add(x.id);out.push({...(base||{}),...x,builtin:!!base});
 }
 for(const b of SPACES)if(!seen.has(b.id))out.push({...b,builtin:true});
 return out;
}
function visibleSpaces(){const list=spaceList().filter(x=>!x.hidden);return list.length?list:[{...SPACES[0],builtin:true}];}
function spaceOf(id){return spaceList().find(x=>x.id===id)||null;}
function findSpace(name){const n=String(name||"").trim();return spaceList().find(x=>x.id===n)||spaceList().find(x=>x.name===n)||spaceList().find(x=>n&&x.name.includes(n))||null;}
function currentSpace(){return spaceOf(Dock.space)||visibleSpaces()[0];}
// Only what differs from a built-in is stored, so a later version's better default still reaches the learner.
function writeSpaces(list){
 S.ui.spaces=list.map(x=>{
  const base=SPACES.find(b=>b.id===x.id);
  if(!base)return {id:x.id,custom:true,name:x.name,icon:x.icon,side:x.side||[],spec:x.spec,...(x.hidden?{hidden:true}:{})};
  const own={id:x.id};
  for(const k of SPACE_KEYS)if(x[k]!==undefined&&JSON.stringify(x[k])!==JSON.stringify(base[k]))own[k]=x[k];
  return own;
 });
 saveUi();renderActivity();spaceSettingsChanged();
}
// The settings page lists the workspaces; keep it in step when they change.
function spaceSettingsChanged(){
 Object.keys(Dock.panels).forEach(pid=>{const p=Dock.panels[pid],node=Dock.els[pid];if(p.type==="settings"&&p.page==="layout"&&node?.isConnected)safe(()=>renderSettings(node,"layout"));});
}
function changeSpace(id,change){writeSpaces(spaceList().map(x=>x.id===id?{...x,...change}:x));}
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
function layoutSpec(){
 return {...specOf(Dock.layout.root),floats:Dock.layout.floats.map(f=>({x:f.x,y:f.y,w:f.w,h:f.h,tabs:f.stack.tabs.map(pid=>({...Dock.panels[pid]}))}))};
}
function switchSpace(id){
 const sp=spaceOf(id);if(!sp)return;
 if(id!==Dock.space){
  Dock.space=id;
  if(!Dock.spaces[id])Dock.spaces[id]=layoutFromSpec(sp.spec);
  setLayout(Dock.spaces[id]);tidy();
  const shown=[];eachStack(s=>{if(s.active)shown.push(s.active);});
  Dock.focus=shown.find(hosts)||shown[0]||null;
  renderDock();saveLayout();spaceSettingsChanged();noteFollow();
 }
 renderSide();
}
function createSpace({name,icon,side,spec}){
 const id="w"+Math.random().toString(36).slice(2,8);
 writeSpaces([...spaceList(),{id,custom:true,name,icon,side,spec:spec||layoutSpec()}]);
 Dock.spaces[id]=layoutFromSpec(spec||layoutSpec());
 switchSpace(id);return id;
}
async function resetSpace(id){
 const sp=spaceOf(id);if(!sp)return;
 const base=SPACES.find(b=>b.id===id);
 if(base)changeSpace(id,{spec:base.spec});
 const spec=spaceOf(id).spec;
 if(id===Dock.space){setLayout(layoutFromSpec(spec));tidy();renderDock();saveLayout();}else delete Dock.spaces[id];
 await dropUnused();saveLayout();
}
async function removeSpace(id){
 const sp=spaceOf(id);if(!sp)return;
 if(sp.builtin)changeSpace(id,{hidden:true});else writeSpaces(spaceList().filter(x=>x.id!==id));
 delete Dock.spaces[id];
 if(Dock.space===id){Dock.space=null;switchSpace(visibleSpaces()[0].id);}
 await dropUnused();saveLayout();renderSide();
}
function moveSpace(id,dir){
 const list=spaceList(),i=list.findIndex(x=>x.id===id),j=i+dir;
 if(i<0||j<0||j>=list.length)return;
 [list[i],list[j]]=[list[j],list[i]];writeSpaces(list);
}
/* The sidebar's open or folded state belongs to each workspace. */
function sideOpen(){return !(S.ui.side.closed||[]).includes(Dock.space);}
function setSideOpen(open){
 const closed=new Set(S.ui.side.closed||[]);open?closed.delete(Dock.space):closed.add(Dock.space);
 S.ui.side.closed=[...closed];saveUi();renderSide();
}
function spaceMenu(id,at){
 const sp=spaceOf(id);if(!sp)return;
 const here=id===Dock.space,list=spaceList(),i=list.findIndex(x=>x.id===id);
 const item=(action,icon,label,extra="")=>'<button data-action="'+action+'" data-space="'+esc(id)+'" '+extra+'>'+svg(icon,14)+'<span>'+label+'</span></button>';
 popMenu(at,'<div class="menu-label">'+esc(sp.name)+'</div>'+
  (here?"":item("space","arrow","切换到这里"))+
  item("space-edit","edit","名字、图标和左栏…")+
  (here?item("space-keep","save","把现在的样子设为它的默认"):"")+
  item("space-reset","undo","恢复默认的样子")+'<hr/>'+
  (i>0?item("space-move","arrowup","往上挪",'data-dir="-1"'):"")+(i<list.length-1?item("space-move","chevrondown","往下挪",'data-dir="1"'):"")+
  item("space-remove",sp.builtin?"eye":"trash",sp.builtin?"从活动栏隐藏":"删除这个工作区")+'<hr/>'+
  '<button data-action="space-new">'+svg("plus",14)+'<span>新工作区…</span></button>');
}
/* One form for a new workspace and for changing one: name, icon, which lists the sidebar shows. */
function spaceForm(id){
 const sp=id?spaceOf(id):{name:"",icon:"layout",side:[]};if(!sp)return;
 const lists=Object.entries(SIDE_SECTIONS);
 modal(modalHead(id?"工作区「"+sp.name+"」":"新工作区")+'<div class="space-form" data-space-form="'+esc(id||"")+'">'+
  '<label>名字<input data-space-name maxlength="20" value="'+esc(sp.name)+'" placeholder="比如：读论文"/></label>'+
  '<div class="field-label">图标</div><div class="icon-pick">'+SPACE_ICONS.map(i=>'<button class="'+(sp.icon===i?"on":"")+'" data-action="space-icon" data-icon="'+i+'" title="'+i+'">'+svg(i,17)+'</button>').join("")+'</div>'+
  '<div class="field-label">左栏放哪些列表（可以不放）</div><div class="list-pick">'+lists.map(([k,s])=>'<label class="check"><input type="checkbox" data-space-list="'+k+'"'+((sp.side||[]).includes(k)?" checked":"")+'/> '+svg(s.icon,13)+' '+esc(s.title)+'</label>').join("")+'</div>'+
  (id?"":'<div class="field-label">窗口</div><label class="check"><input type="radio" name="space-from" value="current" checked/> 照现在的样子复制一份</label><label class="check"><input type="radio" name="space-from" value="blank"/> 从一块空白开始，自己往里放</label>')+
  '<div class="inline end">'+button("取消","modal-close","","ghost sm")+button(id?"保存":"建好并切过去","space-save","","primary sm")+'</div></div>');
 setTimeout(()=>el("[data-space-name]")?.focus(),20);
}
function spaceSave(form){
 const id=form.dataset.spaceForm,name=form.querySelector("[data-space-name]").value.trim();
 if(!name)return toast("先起个名字");
 const icon=form.querySelector(".icon-pick .on")?.dataset.icon||"layout";
 const side=all("[data-space-list]",form).filter(i=>i.checked).map(i=>i.dataset.spaceList);
 closeModal();
 if(id){changeSpace(id,{name,icon,side});renderSide();return;}
 createSpace({name,icon,side,spec:form.querySelector('[name="space-from"]:checked')?.value==="blank"?{tabs:[],keep:true}:null});
}
async function spaceAction(kind,a){
 const id=a.dataset.space;
 switch(kind){
  case "space":if(id===Dock.space)return setSideOpen(!sideOpen());return switchSpace(id);
  case "space-new":Dock.into=null;return spaceForm(null);
  case "space-edit":return spaceForm(id);
  case "space-icon":all(".icon-pick button").forEach(b=>b.classList.toggle("on",b===a));return;
  case "space-save":return spaceSave(a.closest("[data-space-form]"));
  case "space-keep":changeSpace(id,{spec:layoutSpec()});return toast("以后「恢复默认的样子」就回到现在这样");
  case "space-reset":if(!await ask("里面开着的东西会按默认重新摆，内容都已保存。",{title:"把「"+spaceOf(id).name+"」恢复成默认的样子？",ok:"恢复"}))return;return resetSpace(id);
  case "space-move":return moveSpace(id,Number(a.dataset.dir));
  case "space-remove":{const sp=spaceOf(id);if(!sp.builtin&&!await ask("里面的文件和对话都还在。",{title:"删除工作区「"+sp.name+"」？",...{danger:true,ok:"删除"}}))return;return removeSpace(id);}
  case "space-show":return changeSpace(id,{hidden:false});
  case "stack-unkeep":{const s=findStack(a.dataset.stack);if(s){s.keep=false;tidy();renderDock();saveLayout();}return;}
 }
 return null;
}
