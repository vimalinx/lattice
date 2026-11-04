import {$t,$p} from "./i18n.js";
import {S,el,esc,fmtDate,iconButton,logo,rpc,safe,shorten,stageColor,stageName,svg} from "./core.js";
import {sessionMeta,sessionTip,topicTitle} from "./chat.js";
import {fileIcon} from "./files.js";
import {Notes,notesSection} from "./notes.js";
import {SkillSide,skillsSection} from "./skillstore.js";
import {saveUi} from "./app.js";
import {Dock} from "./state.js";
import {saveLayout} from "./dock.js";
/* The fixed left column: an activity bar of lists, and the chosen list beside it. Choosing a list changes this column and
   nothing else: the windows stay where they are, so any list can be read beside the main conversation.
   Each list answers a different question, so each kind of material has its own instead of one shared tree:
   what am I learning (topics), what do I know (cards), what have I written (notes),
   what was taught (lessons), what am I building (experiments and code), how am I doing (practice). */
export const SIDE_SECTIONS={
 topics:{title:$p("列表","主题"),icon:"map",render:topicsSection},
 cards:{title:$p("列表","知识卡"),icon:"card",render:cardsSection},
 notes:{title:$p("列表","笔记"),icon:"document",render:()=>notesSection()},
 lessons:{title:$p("列表","课程"),icon:"book",render:lessonsSection},
 work:{title:$p("列表","实验与代码"),icon:"flask",render:workSection},
 practice:{title:$p("列表","练习与薄弱点"),icon:"code",render:practiceSection},
 files:{title:$p("列表","文件"),icon:"folder",render:filesSection},
 skills:{title:$p("列表","技能"),icon:"store",render:()=>skillsSection()},
};
// Things that belong to a list live in its header (知识图 under 主题, 回顾 under 知识卡); only the rest sit at the bottom.
const SIDE_LAUNCH=[["search",$t("搜索 · Ctrl K"),"palette"],["history",$t("学习轨迹"),"open-journal"],["home",$t("开始"),"open-home"]];
export const Side={entries:{},fileMap:null,fileQuery:"",fileOpen:new Set(),fileShut:new Set(),open:new Set(["code","notebooks","data"]),topicOpen:new Set(),topicShut:new Set(),archOpen:new Set(),stage:"",cardQuery:""};
/* Each working state keeps a left column of its own, as a program of its own would: which list, folded or not, how wide.
   One not set yet starts as the column was last left anywhere (S.ui.side), which is also where a new state starts. */
function column(){const l=Dock.layout;if(!l)return S.ui.side;return l.side||(l.side={list:S.ui.side.list,shut:!!S.ui.side.shut,width:S.ui.side.width});}
function changeColumn(change){Object.assign(column(),change);Object.assign(S.ui.side,change);saveLayout();saveUi();}
export function sideList(){const k=column().list;return SIDE_SECTIONS[k]?k:"topics";}
export function sideOpen(){return !column().shut;}
export function sideWidth(){return Math.max(180,Math.min(560,Number(column().width)||270));}
export function setSideWidth(width){changeColumn({width:Math.max(180,Math.min(560,Math.round(Number(width))||270))});const box=el("#side");if(box)box.style.width=sideWidth()+"px";}
export function setSideOpen(open){changeColumn({shut:!open});renderSide();}
export function showList(key){changeColumn({list:key,shut:false});renderSide();}
export function renderActivity(){
 const bar=el("#activity");if(!bar)return;
 const now=sideOpen()?sideList():null;
 bar.innerHTML="<div class=\"act-logo\" title=\"Lattice\">"+logo()+"</div>"+Object.entries(SIDE_SECTIONS).map(([k,s],i)=>'<button class="act'+(k===now?" on":"")+'" data-action="side-list" data-list="'+k+'" title="'+esc(s.title)+" · Ctrl "+(i+1)+'">'+svg(s.icon,19)+
   (k==="cards"&&S.data.due?'<i class="badge">'+S.data.due+'</i>':"")+'</button>').join("")+(S.ui.activity_plus?"<button class=\"act act-new\" data-action=\"new-menu\" title=\""+$t("新建、打开窗口、新工作状态")+"\">"+svg("plus",19)+"</button>":"")+"<span class=\"grow\"></span>"+SIDE_LAUNCH.map(([i,t,a])=>'<button class="act" data-action="'+a+'" title="'+esc(t)+'">'+svg(i,18)+'</button>').join("")+"<button class=\"act\" data-action=\"theme\" title=\""+$t("切换明暗")+"\">"+svg(S.ui.theme==="dark"?"sun":"moon",17)+"</button><button class=\"act\" data-action=\"open-settings\" title=\""+$t("设置")+"\">"+svg("sliders",18)+"</button>";
}
export async function renderSide(){
 renderActivity();
 const box=el("#side"),key=sideList(),open=sideOpen();if(!box)return;
 box.hidden=!open;el("#side-gutter").hidden=!open;
 box.style.width=sideWidth()+"px";
 if(!open)return;
 const scroll=box.querySelector(".side-body")?.scrollTop||0,same=box.dataset.list===key;
 const focusId=document.activeElement?.closest?.("#side")?document.activeElement.dataset.sideInput:null;
 const {tools,body}=await SIDE_SECTIONS[key].render();
 // Another list was chosen while this one loaded.
 if(key!==sideList())return;
 box.dataset.list=key;
 box.innerHTML='<div class="side-head"><b>'+esc(SIDE_SECTIONS[key].title)+'</b>'+(tools?tools+'<span class="side-sep"></span>':"")+iconButton("collapse","side-collapse",$t("收起 · Ctrl B"))+'</div>'+
  '<div class="side-body">'+body+'</div>';
 if(same)box.querySelector(".side-body").scrollTop=scroll;
 if(focusId){const f=box.querySelector('[data-side-input="'+focusId+'"]');if(f){f.focus();f.setSelectionRange(f.value.length,f.value.length);}}
}
export function sideRow(icon,title,attrs,meta="",extra=""){
 return '<div class="side-row" '+attrs+' title="'+esc(title)+'">'+svg(icon,14)+'<span class="t">'+esc(title)+'</span>'+(meta?'<small>'+meta+'</small>':"")+extra+'</div>';
}
export function sideGroup(title,rows,empty=""){
 if(!rows.join("")&&!empty)return "";
 return '<div class="side-group"><h6>'+esc(title)+'</h6>'+(rows.join("")||'<p class="side-empty">'+esc(empty)+'</p>')+'</div>';
}
const docsOf=kind=>(S.data.docs||[]).filter(d=>d.kind===kind);
/* Topics with their conversations under them, as one tree. Clicking a topic learns there (in the conversation it last had
   open); clicking the topic being learned folds it. Its own conversations come first, then its branches. */
async function topicsSection(){
 const topics=S.data.topics||[],active=S.data.active_topic||"";
 const r=await safe(()=>rpc("sessions",{agent:"tutor",every:true,space:Dock.space})),byTopic={};
 for(const x of r?.sessions||[])(byTopic[x.topic||""]=byTopic[x.topic||""]||[]).push(x);
 const open=key=>Side.topicOpen.has(key)||(key===active&&!Side.topicShut.has(key));
 const session=(x,depth)=>"<div class=\"side-row ss-row"+(x.current&&(x.topic||"")===active?" on":"")+"\" data-action=\"session-open\" data-id=\""+esc(x.id)+"\" style=\"--d:"+depth+"\" title=\""+esc(sessionTip(x))+"\"><span class=\"t\" data-session-title=\""+esc(x.id)+"\">"+esc(x.title)+"</span><small>"+sessionMeta(x)+"</small><button class=\"row-btn\" data-action=\"session-more\" data-id=\""+esc(x.id)+"\" data-archived=\""+(x.archived?1:0)+"\" title=\""+$t("改名、归档、删除")+"\">"+svg("dots",12)+"</button></div>";
 const sessions=(key,depth)=>{
  const list=byTopic[key]||[],live=list.filter(x=>!x.archived),kept=list.filter(x=>x.archived),shown=Side.archOpen.has(key);
  return live.map(x=>session(x,depth)).join("")+(list.length?"":"<p class=\"side-empty ss-none\" style=\"--d:"+depth+"\">"+$t("还没有会话")+"</p>")+
   (kept.length?"<div class=\"side-row ss-kept\" data-action=\"session-kept\" data-key=\""+esc(key)+"\" style=\"--d:"+depth+"\">"+svg(shown?"chevrondown":"chevron",11)+"<span class=\"t\">"+$t("已归档")+" "+kept.length+"</span></div>"+(shown?kept.map(x=>session(x,depth)).join(""):""):"");
 };
 const head=(key,icon,title,depth,extra)=>"<div class=\"side-row tp-row"+(key===active?" here":"")+"\" data-action=\"topic-row\" data-id=\""+esc(key)+"\" style=\"--d:"+depth+"\" title=\""+esc(title)+"\"><span class=\"tp-fold\" data-action=\"topic-fold\" data-id=\""+esc(key)+"\">"+svg(open(key)?"chevrondown":"chevron",11)+"</span>"+svg(icon,14)+"<span class=\"t\">"+esc(title)+"</span>"+(key===active?'<b class="dot-on">●</b>':"")+"<button class=\"row-btn\" data-action=\"session-new\" data-agent=\"tutor\" data-topic=\""+esc(key)+"\" title=\""+$t("在这里开新会话")+"\">"+svg("plus",12)+"</button>"+(extra||"")+"</div>";
 const node=(t,depth,state)=>head(t.id,"map",t.title,depth,"<button class=\"row-btn\" data-action=\"open-file\" data-path=\""+esc(t.path)+"\" title=\""+$t("打开主题页")+"\">"+svg("document",12)+"</button>")+
  (open(t.id)?sessions(t.id,depth+1)+tree(t.id,depth+1,state).join(""):"");
 const tree=(parent,depth,state)=>topics.filter(t=>(t.parent||null)===parent&&t.state===state).map(t=>node(t,depth,state));
 const roots=state=>topics.filter(t=>t.state===state&&(!t.parent||!topics.some(x=>x.id===t.parent&&x.state===state))).map(t=>node(t,0,state));
 return {tools:iconButton("download","import-chat",$t("导入网页上的 AI 对话（ChatGPT 分享链接）"))+iconButton("network","open-map",$t("知识图")),body:head("","bot",$t("默认对话（不属于任何主题）"),0)+(open("")?sessions("",1):"")+
  sideGroup($t("进行中"),roots("active"),$t("还没有主题。和主会话聊着聊着，它会把值得深入的内容建成主题。"))+sideGroup($t("先放一放"),roots("parked"))+sideGroup($t("学完了"),roots("completed"))};
}
// Topics folded or unfolded by hand; the one being learned is open unless folded.
export function topicFold(key){const on=Side.topicOpen.has(key)||(key===(S.data.active_topic||"")&&!Side.topicShut.has(key));
 if(on){Side.topicOpen.delete(key);Side.topicShut.add(key);}else{Side.topicShut.delete(key);Side.topicOpen.add(key);}return renderSide();}
function cardsSection(){
 const q=Side.cardQuery.trim().toLowerCase(),cards=(S.data.cards||[]).filter(c=>(!Side.stage||c.stage===Side.stage)&&(!q||c.title.toLowerCase().includes(q)));
 // Whether a card is due is decided once, by the backend, for the UI and the agents alike.
 const due=new Set((S.data.cards||[]).filter(c=>c.due_now).map(c=>c.id));
 return {tools:iconButton("layout","open-library",$t("卡片库"))+iconButton("refresh","open-review",$t("回顾"))+iconButton("plus","new-card",$t("新知识卡")),
  body:(S.data.due?"<button class=\"side-banner\" data-action=\"open-review\">"+svg("refresh",13)+" "+S.data.due+" "+$t("张卡到期 · 开始回顾")+"</button>":"")+"<input class=\"side-input\" data-side-input=\"cards\" placeholder=\""+$t("筛选卡片…")+"\" value=\""+esc(Side.cardQuery)+"\"/><div class=\"stage-chips\">"+[["",$t("全部")],...Object.entries(stageName)].map(([v,t])=>'<button class="'+(Side.stage===v?"on":"")+'" data-action="side-stage" data-stage="'+v+'">'+esc(t)+'</button>').join("")+"</div>"+cards.map(c=>sideRow("card",c.title,'data-action="open-file" data-path="'+esc(c.path)+'"','<i class="stage-dot" style="background:'+stageColor[c.stage]+'"></i>'+(due.has(c.id)?" "+$t("到期"):""))).join("")+(cards.length?"":"<p class=\"side-empty\">"+$t("没有符合的卡片。")+"</p>")};
}
function lessonsSection(){
 const groups={};docsOf("lesson").forEach(l=>{const t=topicTitle(l.topic)||$t("不属于主题");(groups[t]=groups[t]||[]).push(l);});
 return {tools:"",body:Object.entries(groups).map(([t,list])=>sideGroup(t,list.map(l=>sideRow("book",l.title,'data-action="open-file" data-path="'+esc(l.path)+'"')))).join("")||"<p class=\"side-empty\">"+$t("讲完值得回看的一步，主会话会把它存成课程。")+"</p>"};
}
async function workSection(){
 const parts=[];
 for(const [dir,name] of [["notebooks",$t("实验笔记")],["code",$t("代码")],["data",$t("数据")]])parts.push(sideGroup(name,[await treeRows(dir,0)],$t("空")));
 return {tools:iconButton("code","new-code",$t("写代码"))+iconButton("flask","new-notebook",$t("新实验笔记")),body:parts.join("")};
}
function practiceSection(){
 const ps=S.data.practices||[],weak=(S.data.insights||[]).filter(i=>i.kind==="weak");
 const row=p=>sideRow("code",p.title,'data-action="open-practice" data-id="'+esc(p.id)+'"',esc({active:$t("进行中"),reviewing:$t("复盘中"),done:$t("已复盘")}[p.state]||p.state));
 return {tools:"",body:sideGroup($t("进行中"),ps.filter(p=>p.state!=="done").map(row),$t("主会话某条回复下点「开始练习」，就会开一个练习。"))+
  sideGroup($t("主会话正在留意的薄弱点"),weak.map(i=>sideRow("bulb",i.title,'data-action="open-doc" data-id="'+esc(i.id)+'"',"","<button class=\"row-btn\" data-action=\"insight-resolve\" data-id=\""+esc(i.id)+"\" title=\""+$t("已克服")+"\">"+svg("check",12)+"</button>")),$t("还没有。"))+
  sideGroup($t("做过的"),ps.filter(p=>p.state==="done").map(row))};
}
/* Every file by where it came up: under its topic, in the conversations it was written, changed, opened, attached,
   noted or built in; the rest by folder. A filter finds a file by name and says where it belongs. The folders as
   they are on disk are one switch away. */
async function filesSection(){
 const folders=S.ui.files_view==="folders";
 const tools=iconButton(folders?"map":"list","files-view",folders?$t("按主题和会话看"):$t("按文件夹看"))+iconButton("link","project-add",$t("挂载一个本地目录（AI 只读）"))+iconButton("external","open-vault",$t("在系统里打开学习库"));
 if(folders)return {tools,body:await treeRows("",0)};
 if(!Side.fileMap)Side.fileMap=await safe(()=>rpc("file_map"))||{topics:[],loose:[]};
 const m=Side.fileMap,q=Side.fileQuery.trim().toLowerCase();
 const input="<input class=\"side-input\" data-side-input=\"files\" placeholder=\""+$t("按文件名找…")+"\" value=\""+esc(Side.fileQuery)+"\"/>";
 const row=(f,depth)=>sideRow(fileIcon(f.path),f.title,'data-action="open-file" data-path="'+esc(f.path)+'" style="--d:'+depth+'"',esc(fmtDate(f.at)));
 if(q){
  // Each file once, with every place it came up.
  const found=new Map(),add=(f,where)=>{if(!(f.title+" "+f.path).toLowerCase().includes(q))return;const x=found.get(f.path)||{f,where:[]};if(!x.where.includes(where))x.where.push(where);found.set(f.path,x);};
  for(const t of m.topics){for(const c of t.threads)c.files.forEach(f=>add(f,t.title+" › "+c.title));t.files.forEach(f=>add(f,t.title));}
  for(const g of m.loose)g.files.forEach(f=>add(f,$t("没有归属 ·")+" "+(FOLDER_NAME[g.folder]||g.folder||$t("学习库根目录"))));
  const hits=[...found.values()].sort((a,b)=>a.f.at<b.f.at?1:-1).slice(0,200);
  return {tools,body:input+(hits.map(x=>row(x.f,0)+'<p class="side-excerpt">'+esc(shorten(x.where.join("；"),120))+'</p>').join("")||"<p class=\"side-empty\">"+$t("没有找到。")+"</p>")};
 }
 const open=(key,first)=>Side.fileOpen.has(key)||(first&&!Side.fileShut.has(key));
 const fold=(key,on,icon,title,count,depth)=>sideRow(on?"chevrondown":icon,title,'data-action="files-fold" data-key="'+esc(key)+'" data-on="'+(on?1:0)+'" style="--d:'+depth+'"',String(count));
 // Within a conversation or a topic, the files worked on come first; the many cards noted along the way are folded.
 const listed=(key,files,depth)=>{const cards=files.filter(f=>f.kind==="card"),rest=files.filter(f=>f.kind!=="card");
  let out=rest.map(f=>row(f,depth)).join("");
  if(cards.length){const on=open("k:"+key,!rest.length);out+=fold("k:"+key,on,"card",$t("记下的知识卡"),cards.length,depth);if(on)out+=cards.map(f=>row(f,depth+1)).join("");}
  return out;};
 let body="";
 for(const t of m.topics){
  const count=new Set([...t.files,...t.threads.flatMap(c=>c.files)].map(f=>f.path)).size,on=open("t:"+t.id,t.active);
  body+=fold("t:"+t.id,on,t.id?"map":"bot",t.title,count,0);
  if(!on)continue;
  t.threads.forEach((c,i)=>{const cOn=open("c:"+c.id,c.current||(i===0&&!t.threads.some(x=>x.current)));
   body+=fold("c:"+c.id,cOn,"bot",c.title,c.files.length,1);if(cOn)body+=listed(c.id,c.files,2);});
  if(t.files.length){const oOn=open("o:"+t.id,!t.threads.length);body+=fold("o:"+t.id,oOn,"folder",t.threads.length?$t("不在某段会话里的"):$t("这个主题的文件"),t.files.length,1);if(oOn)body+=listed("o"+t.id,t.files,2);}
 }
 if(m.loose.length){
  const on=open("loose",!m.topics.length),total=m.loose.reduce((n,g)=>n+g.files.length,0);
  body+=fold("loose",on,"folder",$t("没有归属的文件"),total,0);
  if(on)for(const g of m.loose){const gOn=open("f:"+g.folder,false);body+=fold("f:"+g.folder,gOn,"folder",FOLDER_NAME[g.folder]||g.folder||$t("学习库根目录"),g.files.length,1);if(gOn)body+=g.files.map(f=>row(f,2)).join("");}
 }
 return {tools,body:input+(body||"<p class=\"side-empty\">"+$t("还没有文件。")+"</p>")};
}
export async function treeEntries(path){if(!Side.entries[path])Side.entries[path]=await rpc("tree",{path});return Side.entries[path];}
async function treeRows(path,depth){
 let out="";
 for(const e of await treeEntries(path)){
  const open=Side.open.has(e.path),label=depth===0&&!path&&!e.project?FOLDER_NAME[e.name]||e.name:e.name.replace(/\.md$/,"");
  if(e.type==="dir"){
   out+=sideRow(open?"chevrondown":e.project?"link":"folder",label,'data-action="tree-toggle" data-path="'+esc(e.path)+'" style="--d:'+depth+'"',e.project?$t("挂载 · AI 只读"):"",
    e.project?"<button class=\"row-btn\" data-action=\"project-remove\" data-id=\""+esc(e.project)+"\" title=\""+$t("取消挂载")+"\">"+svg("close",12)+"</button>":"");
   if(open)out+=await treeRows(e.path,depth+1);
  }else out+=sideRow(fileIcon(e.path),label,'data-action="open-file" data-path="'+esc(e.path)+'" style="--d:'+depth+'"');
 }
 return out;
}
const FOLDER_NAME={topics:$t("主题"),cards:$t("知识卡"),lessons:$t("课程"),notes:$t("笔记"),insights:$t("薄弱点"),notebooks:$t("实验笔记"),code:$t("代码"),data:$t("数据"),envs:$t("环境"),threads:$t("对话"),journal:$t("轨迹"),agents:$t("AI 的规则"),skills:$t("技能")};
export function sideChanged(paths){
 Side.fileMap=null;
 for(const path of paths||[]){const parts=path.split("/");for(let i=0;i<parts.length;i++)delete Side.entries[parts.slice(0,i).join("/")];}
 clearTimeout(Side.timer);Side.timer=setTimeout(()=>safe(renderSide),300);
}
export function sideInput(t){
 if(t.dataset.sideInput==="cards"){Side.cardQuery=t.value;renderSide();return true;}
 if(t.dataset.sideInput==="files"){Side.fileQuery=t.value;renderSide();return true;}
 if(t.dataset.sideInput==="notes"){Notes.query=t.value;renderSide();return true;}
 if(t.dataset.sideInput==="skills"){SkillSide.query=t.value;renderSide();return true;}
 return false;
}
export function initSideResize(){
 el("#side-gutter").addEventListener("mousedown",e=>{
  e.preventDefault();const start=e.clientX,w=sideWidth(),box=el("#side");let width=w;
  const move=ev=>{width=Math.max(180,Math.min(560,w+ev.clientX-start));box.style.width=width+"px";};
  const up=()=>{document.removeEventListener("mousemove",move);document.removeEventListener("mouseup",up);document.body.classList.remove("resizing");setSideWidth(width);};
  document.body.classList.add("resizing");document.addEventListener("mousemove",move);document.addEventListener("mouseup",up);
 });
}
