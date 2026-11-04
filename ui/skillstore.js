import {$t} from "./i18n.js";
import {Dock,panelType} from "./state.js";
import {all,ask,askText,button,closeModal,emptyState,esc,iconButton,markdown,modal,modalHead,rpc,safe,svg,toast} from "./core.js";
import {openPanel,saveLayout} from "./dock.js";
import {Chat,updateComposer} from "./chat.js";
import {openFile} from "./files.js";
import {skillHistory} from "./skillchange.js";
import {renderSide,sideGroup,sideList,sideRow} from "./side.js";
import {pickPath} from "./popups.js";
import {popMenu} from "./app.js";
/* Skills: the store to browse and install them, and picking one for a message. A skill is a written-down way of doing
   one kind of work (lattice/skills.py); installed ones live in the vault's skills/ folder, where they can be edited. */
export const SkillBook={list:null,loading:null};
// i18n: keep (a skill's category is a key its file stores; it is translated where it is shown)
const SKILL_CATS=[["讲解思路","bulb"],["课程与教程","map"],["练习与评估","check"],["复杂生产","layout"],["研究与阅读","book"],["笔记与整理","document"],["其他","spark"]];
const SKILL_AGENTS={tutor:$t("主会话"),flash:$t("快答"),coach:$t("练习教练"),organizer:$t("整理"),builder:$t("应用助手")};
export const catIcon=c=>(SKILL_CATS.find(x=>x[0]===c)||SKILL_CATS.at(-1))[1];
async function skillList(fresh=false){
 if(fresh||!SkillBook.list){SkillBook.loading=SkillBook.loading||rpc("skills").then(l=>{SkillBook.list=l;SkillBook.loading=null;return l;}).catch(e=>{SkillBook.loading=null;throw e;});await SkillBook.loading;}
 return SkillBook.list;
}
export function skillsChanged(){
 SkillBook.list=null;all(".panel-skills").forEach(n=>{if(n.isConnected)safe(()=>renderStore(n.dataset.pid));});
 if(sideList()==="skills")renderSide();
}
/* ---- the sidebar's list: installed skills by kind ------------------------------------------------------------- */
export const SkillSide={query:""};
export async function skillsSection(){
 const list=(await skillList()).filter(s=>s.state!=="absent"),q=SkillSide.query.trim().toLowerCase();
 const shown=list.filter(s=>!q||(s.title+s.name+s.description).toLowerCase().includes(q));
 const row=s=>sideRow(catIcon(s.category),s.title,'data-action="open-file" data-path="skills/'+esc(s.slug)+'/SKILL.md" title="'+esc(s.description)+'"',
  s.enabled?(s.state==="update"?$t("有新版本"):""):$t("已停用"),"<button class=\"row-btn\" data-action=\"skill-try\" data-slug=\""+esc(s.slug)+"\" title=\""+$t("开个临时会话试用")+"\">"+svg("bot",12)+"</button><button class=\"row-btn\" data-action=\"skill-toggle\" data-slug=\""+esc(s.slug)+"\" title=\""+(s.enabled?$t("停用"):$t("启用"))+"\">"+svg(s.enabled?"eye":"check",12)+"</button>");
 return {tools:iconButton("store","open-skills",$t("技能商城"))+iconButton("plus","skill-new",$t("新建技能")),
  body:"<input class=\"side-input\" data-side-input=\"skills\" placeholder=\""+$t("筛选技能…")+"\" value=\""+esc(SkillSide.query)+"\"/>"+(list.length?SKILL_CATS.map(([c])=>sideGroup($t(c),shown.filter(s=>s.category===c).map(row))).join("")||"<p class=\"side-empty\">"+$t("没有符合的技能。")+"</p>":
    "<p class=\"side-empty\">"+$t("还没有装技能。点上面的商城图标，挑几个装上。")+"</p>")};
}

/* ---- the store ------------------------------------------------------------------------------------------------------ */
panelType("skills",{side:"mine",host:false,icon:"store",title:()=>$t("技能商城"),
 mount(p,node,pid){node.innerHTML='<div class="store"><div class="store-head"></div><div class="store-list" data-keep-scroll></div></div>';renderStore(pid,true);},
 screen(p){return {view:$t("技能商城"),tab:p.tab||"store",category:p.cat||$t("全部")};}});
async function renderStore(pid,full=true){
 const p=Dock.panels[pid],node=Dock.els[pid]?.querySelector(".store");if(!p||!node)return;
 const list=await skillList(),tab=p.tab||"store",q=(p.q||"").trim().toLowerCase();
 const mine=list.filter(s=>s.state!=="absent");
 if(full)node.querySelector(".store-head").innerHTML="<div class=\"store-intro\"><b>"+$t("技能商城")+"</b><small>"+$t("每个技能是一套做某类事的完整做法：讲解思路、出教程树、整套教程的生产线……装上以后，AI 遇到对应的请求会照着做；也可以在输入框的「＋」里（或者输入 /）点名用一个。装上的技能放在学习库的 skills/ 里，能直接改。")+"</small></div><div class=\"store-bar\"><div class=\"segmented\">"+[["store",$t("商城 ·")+" "+list.filter(s=>s.shipped).length],["mine",$t("已装 ·")+" "+mine.length]].map(([k,t])=>'<button class="'+(tab===k?"on":"")+'" data-action="skill-tab" data-pid="'+pid+'" data-tab="'+k+'">'+t+'</button>').join("")+"</div><input class=\"side-input\" data-store-q=\""+pid+"\" placeholder=\""+$t("搜技能…")+"\" value=\""+esc(p.q||"")+"\"/><span class=\"grow\"></span>"+(list.some(s=>s.state==="absent")?button(svg("download",13)+" "+$t("全部装上"),"skill-install-all","","ghost sm"):"")+button(svg("plus",13)+" "+$t("新建技能"),"skill-new","","ghost sm")+button(svg("upload",13)+" "+$t("导入文件夹"),"skill-import","","ghost sm")+"</div><div class=\"stage-chips\">"+[["",$t("全部")],...SKILL_CATS].map(([c])=>'<button class="'+((p.cat||"")===c?"on":"")+'" data-action="skill-cat" data-pid="'+pid+'" data-cat="'+esc(c)+'">'+esc(c?$t(c):$t("全部"))+'</button>').join("")+"</div>";
 const shown=(tab==="mine"?mine:list.filter(s=>s.shipped)).filter(s=>(!p.cat||s.category===p.cat)&&(!q||(s.title+s.name+s.description+s.tags.join(" ")).toLowerCase().includes(q)));
 const groups=SKILL_CATS.map(([c])=>[c,shown.filter(s=>s.category===c)]).filter(([,l])=>l.length);
 node.querySelector(".store-list").innerHTML=groups.map(([c,l])=>'<h4>'+svg(catIcon(c),14)+' '+esc($t(c))+'<small>'+l.length+'</small></h4><div class="skill-grid">'+l.map(skillCard).join("")+'</div>').join("")||
  emptyState("store",tab==="mine"?$t("还没有装技能"):$t("没有符合的技能"),tab==="mine"?$t("到「商城」里挑几个装上，或者自己新建一个。"):$t("换个关键词或分类试试。"));
}
function skillCard(s){
 const on=s.state!=="absent",b=(t,a,cls="ghost xs")=>button(t,a,'data-slug="'+esc(s.slug)+'"',cls);
 const badge={update:"<span class=\"chip warn\">"+$t("有新版本")+"</span>",changed:"<span class=\"chip\">"+$t("你改过")+"</span>"}[s.state]||"";
 return '<div class="skill-card'+(on?" on":"")+(on&&!s.enabled?" off":"")+'" data-action="skill-detail" data-slug="'+esc(s.slug)+'">'+
  '<div class="sk-top">'+svg(catIcon(s.category),15)+'<b>'+esc(s.title)+'</b>'+(s.shipped?"":"<span class=\"chip\">"+$t("我的")+"</span>")+badge+(on?'<span class="chip '+(s.enabled?"on":"")+'">'+(s.enabled?$t("已装"):$t("已停用"))+'</span>':"")+'</div>'+
  '<p>'+esc(s.description)+'</p>'+
  '<div class="sk-meta">'+s.agents.map(a=>'<span>'+esc(SKILL_AGENTS[a]||a)+'</span>').join("")+(s.files.length?"<span>"+$t("附带 {0} 个文件",s.files.length)+"</span>":"")+'</div>'+
  '<div class="sk-actions">'+(!on?b(svg("download",12)+" "+$t("装上"),"skill-install","primary xs"):
   b(s.enabled?$t("停用"):$t("启用"),"skill-toggle")+b($t("试用"),"skill-try")+b($t("改"),"skill-revise")+b($t("历史"),"skill-history")+
   (s.state==="update"?b($t("更新到 v")+s.latest,"skill-install"):s.state==="changed"?b($t("恢复商城版"),"skill-install"):"")+b(s.shipped?$t("卸下"):$t("删除"),"skill-uninstall"))+'</div></div>';
}
async function skillDetail(slug){
 const s=(await skillList()).find(x=>x.slug===slug);if(!s)return;
 const full=await rpc("skill_read",{slug,shipped:s.state==="absent"});
 modal(modalHead(s.title)+"<div class=\"skill-detail\"><div class=\"sk-meta\">"+svg(catIcon(s.category),13)+" "+esc($t(s.category))+" · "+esc(s.name)+" "+$t("· v{0} · 给{1}用",s.version,s.agents.map(a=>SKILL_AGENTS[a]).join("、"))+"</div><p class=\"muted\">"+esc(s.description)+"</p><div class=\"markdown skill-body\">"+markdown(full.body)+"</div>"+(full.files?.length?"<div class=\"field-label\">"+$t("附带的文件")+"</div><div class=\"sk-files\">"+full.files.map(f=>s.state==="absent"?'<span>'+svg("document",12)+' '+esc(f)+'</span>':'<a data-action="open-file" data-path="skills/'+esc(s.slug)+'/'+esc(f)+'">'+svg("document",12)+' '+esc(f)+'</a>').join("")+"</div>":"")+"<div class=\"modal-actions\">"+(s.state==="absent"?button(svg("download",13)+" "+$t("装上"),"skill-install",'data-slug="'+esc(slug)+'"',"primary"):
   button($t("开个临时会话试用"),"skill-try",'data-slug="'+esc(slug)+'"',"primary")+button($t("左右对照着改"),"skill-revise",'data-slug="'+esc(slug)+'"',"ghost")+
   button(svg("history",13)+" "+$t("历史"),"skill-history",'data-slug="'+esc(slug)+'"',"ghost")+button($t("打开文件"),"skill-open",'data-slug="'+esc(slug)+'"',"ghost"))+"</div></div>","large");
}
// Pick a skill for the next message in this conversation (or the main conversation, from the store).
function useSkill(pid,s){
 const st=Chat[pid];if(!st)return;
 st.skill={slug:s.slug,title:s.title};updateComposer(pid);
 Dock.els[pid]?.querySelector(".composer textarea")?.focus();
}
export async function skillAction(kind,a){
 const slug=a.dataset.slug,pid=a.dataset.pid,list=()=>skillList(true);
 switch(kind){
  case "skill-tab":Dock.panels[pid].tab=a.dataset.tab;saveLayout();return renderStore(pid);
  case "skill-cat":Dock.panels[pid].cat=a.dataset.cat;saveLayout();return renderStore(pid);
  case "skill-detail":return skillDetail(slug);
  case "skill-install":{closeModal();await rpc("skill_install",{slug});await list();skillsChanged();return toast($t("装上了；AI 遇到对应的请求会照着做"));}
  case "skill-install-all":{const slugs=(await skillList()).filter(s=>s.state==="absent").map(s=>s.slug);
   if(!await ask($t("装上以后都能在学习库的 skills/ 里改、停用或卸下。"),{title:$t("把商城里的 {0} 个技能全部装上？",slugs.length),ok:$t("全部装上")}))return;
   await rpc("skill_install_many",{slugs});await list();skillsChanged();return toast($t("装上了 {0} 个技能",slugs.length));}
  case "skill-uninstall":{const s=(await skillList()).find(x=>x.slug===slug);
   if(!await ask(s.shipped?$t("以后可以从商城重新装上；你改过的版本留在学习库的历史里。"):$t("它会留在学习库的历史里，可以恢复。"),{title:(s.shipped?$t("卸下"):$t("删除"))+$t("技能「{0}」？",s.title),danger:true,ok:s.shipped?$t("卸下"):$t("删除")}))return;
   await rpc("skill_uninstall",{slug});await list();return skillsChanged();}
  case "skill-toggle":{const s=(await skillList()).find(x=>x.slug===slug);await rpc("skill_enable",{slug,on:!s.enabled});await list();skillsChanged();return toast(s.enabled?$t("停用了；AI 不会再看到它"):$t("启用了"));}
  case "skill-open":closeModal();return openFile("skills/"+slug+"/SKILL.md");
  case "skill-history":closeModal();return skillHistory(slug);
  // Changing it by hand, side by side with how it is now: the same review as an agent's proposal.
  case "skill-revise":closeModal();return rpc("skill_propose",{slug,why:$t("我自己改")});
  case "skill-try":{
   // A trial runs in a conversation of its own, so nothing of it lands in the main conversation.
   closeModal();const s=(await skillList()).find(x=>x.slug===slug);if(!s)return;
   const r=await rpc("skill_trial",{slug,agent:s.agents.includes("tutor")?"tutor":s.agents[0]});
   const target=openPanel({type:"chat",agent:r.agent,thread:r.thread});
   const go=()=>{if(!Chat[target]?.data)return setTimeout(go,150);useSkill(target,s);toast($t("这是试用「{0}」的单独会话，不会进主会话",s.title));};return go();}
  case "skill-new":{const title=await askText($t("新技能叫什么"),"",{hint:$t("比如「讲公式的三步法」；建好后会打开它的 SKILL.md，照模板写做法"),ok:$t("新建")});if(!title)return;
   const r=await rpc("skill_create",{title});await list();skillsChanged();return openFile(r.path);}
  case "skill-import":{const folder=await pickPath({mode:"dir",title:$t("导入一个技能文件夹"),ok:$t("导入"),hint:$t("文件夹里要有 SKILL.md；Claude 的技能文件夹也能直接导入")});if(!folder)return;const r=await rpc("skill_import",{folder});if(!r)return;await list();skillsChanged();toast($t("导入了；Claude 的技能文件夹也能直接导入"));return openFile(r.path);}
  case "skill-pick":{const s=(await skillList()).find(x=>x.slug===slug);if(s)useSkill(pid,s);return;}
  case "skill-clear":if(Chat[pid]){Chat[pid].skill=null;updateComposer(pid);}return;
  case "skill-menu":return skillMenu(pid,a);
 }
 return null;
}
// The skills this conversation's AI can use, to pick one for the next message.
export async function skillMenu(pid,anchor){
 const agent=Dock.panels[pid]?.agent,list=(await skillList()).filter(s=>s.state!=="absent"&&s.enabled&&s.agents.includes(agent));
 popMenu(anchor,(list.length?SKILL_CATS.map(([c,i])=>{const l=list.filter(s=>s.category===c);return l.length?'<div class="menu-label">'+esc($t(c))+'</div>'+l.map(s=>'<button data-action="skill-pick" data-pid="'+pid+'" data-slug="'+esc(s.slug)+'">'+svg(i,14)+'<span>'+esc(s.title)+'<small>'+esc(s.description)+'</small></span></button>').join(""):"";}).join(""):
  "<p class=\"menu-empty\">"+$t("这个 AI 还没有能用的技能。")+"</p>")+"<hr/><button data-action=\"open-skills\">"+svg("store",14)+"<span>"+$t("去技能商城…")+"</span></button>",{cls:"menu-wide",above:true});
}
document.addEventListener("input",e=>{
 const t=e.target;
 if(t.dataset?.storeQ){const p=Dock.panels[t.dataset.storeQ];if(p){p.q=t.value;renderStore(t.dataset.storeQ,false);}}
});
