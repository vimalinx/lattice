import {$t,LOCALE,LANG} from "./i18n.js";
import {Dock,panelHand,panelType} from "./state.js";
import {S,all,ask,baseName,button,cardTypeName,el,emptyState,esc,fmtDate,iconButton,markdown,rpc,safe,stageColor,stageName,svg,toast,who} from "./core.js";
import {themeSettings} from "./theme.js";
import {saveLayout} from "./dock.js";
import {spaceList} from "./spaces.js";
import {BLOCKS,journalRow,mountGraph,routeClass,routeStep} from "./blocks.js";
import {Chat,renderChat,tokenNum,topicTitle,updateComposer} from "./chat.js";
import {MD_MODES,fileIcon} from "./files.js";
import {skillHistory} from "./skillchange.js";
import {renderActivity,renderSide,setSideWidth,sideRow,sideWidth} from "./side.js";
import {applyUi,readChars,refreshChats,saveUi} from "./app.js";
/* The learner's other panels: the start page, the knowledge map, the journal, reviews, the card library, memory and settings. */
/* ---- the knowledge map ---------------------------------------------------------------------------------- */
const MapState={};
panelType("map",{side:"mine",host:false,icon:"network",title:p=>p.topic?$t("知识图 ·")+" "+topicTitle(p.topic):$t("知识图"),
 mount(p,node,pid){
  node.innerHTML='<div class="map"><div class="map-bar"><select data-map-topic="'+pid+'"></select><span class="map-stats muted"></span><span class="grow"></span>'+
   iconButton("refresh","map-relayout",$t("重新排布"),'data-pid="'+pid+'"')+'</div><div class="map-body"><div class="map-canvas"></div><aside class="map-route"></aside></div></div>';
  loadMap(pid);
 },
 shown(p,node){const c=node.querySelector(".map-canvas"),cy=c?.__cy;if(cy&&!cy.destroyed()){cy.resize();cy.fit(undefined,20);}else if(c&&c.clientWidth&&!c.firstChild)loadMap(node.dataset.pid);},
 screen(p){return {view:$t("知识图"),topic:p.topic||null};}});
export async function loadMap(pid){
 const p=Dock.panels[pid],node=Dock.els[pid];if(!node)return;
 const sel=node.querySelector("[data-map-topic]");
 sel.innerHTML="<option value=\"\">"+$t("整张图")+"</option>"+(S.data.topics||[]).map(t=>'<option value="'+esc(t.id)+'"'+(p.topic===t.id?" selected":"")+'>'+esc((t.parent?"↳ ":"")+t.title)+'</option>').join("");
 const g=await rpc("graph",{topic:p.topic||null});
 MapState[pid]=g;
 node.querySelector(".map-stats").textContent=g.nodes.length+" "+$t("个节点 · {0} 条关系",g.edges.length);
 const canvas=node.querySelector(".map-canvas");
 if(!g.nodes.length){canvas.innerHTML=emptyState("map",$t("图还是空的"),$t("和主会话聊着聊着，它会把讲过的东西存成卡片、连成关系，并给每个主题定一条主干路线。"));node.querySelector(".map-route").innerHTML="";return;}
 canvas.innerHTML="";
 if(!canvas.clientWidth)return;  // not on screen yet; drawn when the panel is shown
 mountGraph(canvas,g,{topic:p.topic});
 const route=p.topic?g.routes[p.topic]||[]:[],docs=new Map((S.data.docs||[]).map(d=>[d.id,d]));
 node.querySelector(".map-route").innerHTML=p.topic?"<h4>"+$t("主干路线")+"</h4>"+(route.length?'<ol>'+route.map(s=>'<li'+routeClass(s)+'>'+routeStep(s,docs)+(s.why?'<small>'+esc(s.why)+'</small>':"")+'</li>').join("")+'</ol>':"<p class=\"muted\">"+$t("还没有路线。")+"</p>")+button(svg("document",12)+" "+$t("打开主题"),"open-doc",'data-id="'+esc(p.topic)+'"',"ghost xs"):"<h4>"+$t("图例")+"</h4><p class=\"legend\">"+$t("⬢ 主题 · ▢ 知识卡（边框色＝理解阶段）· ● 笔记 · ◆ 课程 · ■ 实验笔记和文件 · ▲ 薄弱点")+"</p><p class=\"muted\">"+$t("选一个主题，就能看到它的主干路线和挂着的岔路。")+"</p>";
}
export function mapsChanged(){clearTimeout(MapState.timer);MapState.timer=setTimeout(()=>Object.keys(Dock.panels).filter(pid=>Dock.panels[pid].type==="map").forEach(loadMap),800);}

/* ---- the journal ------------------------------------------------------------------------------------------- */
const JOURNAL_GROUPS={"":$t("全部"),annotated:$t("批注"),asked:$t("提问与作答"),ran:$t("运行"),wrote:$t("写作"),viewed:$t("查看"),reviewed:$t("回顾"),judged:$t("AI 判断与讲解"),detour:$t("岔路与主干"),insight:$t("薄弱点"),searched:$t("联网"),action:$t("AI 动作")};
const GROUP_TYPES={asked:["asked","answered"],judged:["judged","explained"],detour:["detour","bridged"],reviewed:["reviewed","staged"],action:["action","undo","installed","organized"]};
panelType("journal",{side:"mine",icon:"history",title:()=>$t("学习轨迹"),
 mount(p,node,pid){node.innerHTML='<div class="journal"><div class="map-bar"><select data-journal-type="'+pid+'">'+Object.entries(JOURNAL_GROUPS).map(([k,v])=>'<option value="'+k+'"'+((p.group||"")===k?" selected":"")+'>'+esc(v)+'</option>').join("")+'</select>'+
  '<select data-journal-days="'+pid+'">'+[[1,$t("今天")],[7,$t("近 7 天")],[30,$t("近 30 天")],[0,$t("全部")]].map(([d,t])=>'<option value="'+d+'"'+((p.days??7)==d?" selected":"")+'>'+t+'</option>').join("")+'</select></div><div class="journal-list" data-keep-scroll></div></div>';loadJournal(pid);},
 screen(p){return {view:$t("学习轨迹"),filter:p.group||"all"};}});
export async function loadJournal(pid){
 const p=Dock.panels[pid],node=Dock.els[pid];if(!node)return;
 const days=p.days??7,group=p.group||"";
 const types=group?GROUP_TYPES[group]||[group]:null;
 const since=days?new Date(Date.now()-(days===1?(Date.now()-new Date().setHours(0,0,0,0)):days*864e5)).toISOString():null;
 const rows=await rpc("journal",{types,since,limit:400});
 const byDay={};rows.forEach(r=>(byDay[r.at.slice(0,10)]=byDay[r.at.slice(0,10)]||[]).push(r));
 node.querySelector(".journal-list").innerHTML=Object.entries(byDay).map(([day,list])=>"<h5>"+esc(new Date(day).toLocaleDateString(LOCALE,{month:"long",day:"numeric",weekday:"short"}))+" · "+list.length+" "+$t("条")+"</h5>"+list.map(journalRow).join("")).join("")||emptyState("history",$t("这段时间没有记录"),$t("提问、作答、运行、写作和 AI 的判断都会记在这里。"));
}
export function journalsChanged(){clearTimeout(MapState.jtimer);MapState.jtimer=setTimeout(()=>Object.keys(Dock.panels).filter(pid=>Dock.panels[pid].type==="journal").forEach(loadJournal),1500);}

/* ---- reviewing due cards ------------------------------------------------------------------------------------ */
panelType("review",{side:"mine",icon:"refresh",title:()=>$t("回顾"),
 mount(p,node){node.innerHTML='<div class="review"><div class="review-body"></div></div>';loadReview(node);},
 screen(){return {view:$t("回顾到期的卡")};}});
// Asked for again where it is open already: the review loads again, the settings go to the page asked for.
panelHand("review-again",(pid,h,fresh)=>fresh?null:loadReview(Dock.els[pid]));
panelHand("settings-page",(pid,h,fresh)=>fresh?null:renderSettings(Dock.els[pid],h.page));
export async function loadReview(node){
 const due=await rpc("due");
 const body=node.querySelector(".review-body");
 if(!due.length){body.innerHTML=emptyState("check",$t("现在没有到期的卡"),$t("接触过的卡会在保存一天后到期；每次自评以后，间隔会按你记得的程度拉长或缩短。"));return;}
 body.innerHTML='<div class="lblock"></div>';
 await BLOCKS.cards({cards:due.map(c=>c.id),review:true},body.firstElementChild,{});
}

/* ---- the card library: every card, to browse and pick from ------------------------------------------------------ */
panelType("library",{side:"mine",host:false,icon:"card",title:()=>$t("卡片库"),
 mount(p,node,pid){node.innerHTML='<div class="library"><div class="lib-bar"></div><div class="lib-list" data-keep-scroll></div></div>';renderLibrary(pid);},
 screen(p){return {view:$t("卡片库"),filter:{query:p.query||"",stage:p.stage||"",topic:p.topic??$t("全部"),sort:p.sort||"due",due_only:!!p.due_only}};}});
const LIB_SORT=[["due",$t("先到期的")],["updated",$t("最近改过的")],["stage",$t("理解阶段")],["title",$t("标题")]];
// When a card comes up next: the backend's rule, a day after it was saved if never reviewed; cards still to explore are not scheduled.
function cardDueAt(c){return c.stage==="suggested"?Infinity:Date.parse(c.due||"")||Date.parse(c.created)+864e5;}
function dueText(c){
 if(c.stage==="suggested")return $t("不排期");
 if(c.due_now)return $t("到期");
 const days=Math.round((new Date(cardDueAt(c)).setHours(0,0,0,0)-new Date().setHours(0,0,0,0))/864e5);
 return days<=0?$t("今天"):days===1?$t("明天"):days+" "+$t("天后");
}
export function renderLibrary(pid,full=true){
 const p=Dock.panels[pid],node=Dock.els[pid]?.querySelector(".library");if(!p||!node)return;
 if(full)node.querySelector(".lib-bar").innerHTML="<input class=\"side-input\" data-lib-query=\""+pid+"\" placeholder=\""+$t("搜标题、自测题和正文…")+"\" value=\""+esc(p.query||"")+"\"/><div class=\"lib-filters\"><select data-lib-topic=\""+pid+"\">"+opt(p.topic??"*",[["*",$t("全部主题")],["",$t("不属于主题的")],...(S.data.topics||[]).map(t=>[t.id,t.title])])+"</select><select data-lib-sort=\""+pid+"\">"+opt(p.sort||"due",LIB_SORT)+"</select><label class=\"check inline-check\"><input type=\"checkbox\" data-lib-due=\""+pid+"\""+(p.due_only?" checked":"")+"/> "+$t("只看到期")+"</label>"+iconButton("plus","new-card",$t("新知识卡"))+"</div><div class=\"stage-chips\">"+[["",$t("全部")],...Object.entries(stageName)].map(([v,t])=>'<button class="'+((p.stage||"")===v?"on":"")+'" data-action="lib-stage" data-pid="'+pid+'" data-stage="'+v+'">'+esc(t)+'</button>').join("")+"</div><div class=\"stage-chips type-chips\">"+[["",$t("所有类型")],...Object.entries(cardTypeName)].map(([v,t])=>'<button class="'+((p.ctype||"")===v?"on":"")+'" data-action="lib-type" data-pid="'+pid+'" data-ctype="'+v+'">'+esc(t)+'</button>').join("")+"</div>";
 const q=(p.query||"").trim().toLowerCase(),order=Object.keys(stageName);
 const cards=(S.data.cards||[]).filter(c=>(!p.stage||c.stage===p.stage)&&(!p.ctype||c.type===p.ctype)&&(p.topic==null||(c.topic||"")===p.topic)&&(!p.due_only||c.due_now)&&
  (!q||(c.title+" "+(c.question||"")+" "+(c.excerpt||"")).toLowerCase().includes(q)));
 const sort={due:(a,b)=>cardDueAt(a)-cardDueAt(b),updated:(a,b)=>String(b.updated).localeCompare(String(a.updated)),
  stage:(a,b)=>order.indexOf(a.stage)-order.indexOf(b.stage)||a.title.localeCompare(b.title,"zh"),title:(a,b)=>a.title.localeCompare(b.title,"zh")}[p.sort||"due"];
 cards.sort(sort);
 const every=S.data.cards||[];
 node.querySelector(".lib-list").innerHTML="<p class=\"lib-count muted small\">"+cards.length+" "+$t("张")+(cards.length!==every.length?$t("（共 {0} 张）",every.length):"")+(S.data.due?" · "+S.data.due+" "+$t("张到期"):"")+"</p>"+(libraryGroups(cards).map(([area,list])=>'<div class="lib-area"><h5>'+esc(area||$t("没分领域"))+'<small>'+list.length+'</small></h5>'+list.map(c=>'<button class="lib-card" data-action="open-file" data-path="'+esc(c.path)+'">'+
   '<span class="lib-top">'+(c.type?'<i class="ct ct-'+esc(c.type)+'">'+esc(cardTypeName[c.type]||c.type)+'</i>':"")+'<span class="stage stage-'+esc(c.stage)+'">'+esc(stageName[c.stage]||c.stage)+'</span><small class="'+(c.due_now?"due":"")+'">'+esc(dueText(c))+'</small></span>'+
   '<b>'+esc(c.title)+'</b>'+((c.question||c.excerpt)?'<span class="lib-text">'+esc(c.question||c.excerpt)+'</span>':"")+
   '<small class="lib-foot">'+esc(c.topic?topicTitle(c.topic):$t("不属于主题"))+(c.reviews?" "+$t("· 回顾过 {0} 次",c.reviews):"")+'</small></button>').join("")+'</div>').join("")||
   emptyState("card",every.length?$t("没有符合的卡片"):$t("还没有知识卡"),every.length?$t("换个筛选试试。"):$t("和主会话学着学着，它会把讲清楚的知识点存成卡；也可以在左栏点「＋」自己记一张。")));
}
// Cards sorted by area, the biggest area first and the cards without one last; inside an area the chosen order holds.
function libraryGroups(cards){
 const groups=new Map();for(const c of cards){const k=c.area||"";if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c);}
 return [...groups].sort((a,b)=>(!a[0])-(!b[0])||b[1].length-a[1].length||a[0].localeCompare(b[0],"zh"));
}
export function libraryInput(t){
 const pid=t.dataset.libQuery||t.dataset.libTopic||t.dataset.libSort||t.dataset.libDue,p=Dock.panels[pid];if(!p)return false;
 if(t.dataset.libQuery){p.query=t.value;renderLibrary(pid,false);}
 else if(t.dataset.libTopic){p.topic=t.value==="*"?null:t.value;renderLibrary(pid,false);}
 else if(t.dataset.libSort){p.sort=t.value;renderLibrary(pid,false);}
 else{p.due_only=t.checked;renderLibrary(pid,false);}
 saveLayout();return true;
}

/* ---- memory: how the cards are holding up, from their schedule and the learner's own ratings --------------------- */
panelType("memory",{side:"mine",icon:"calendar",title:()=>$t("记忆"),
 mount(p,node,pid){node.innerHTML='<div class="memory" data-keep-scroll></div>';loadMemory(pid);},
 screen(){return {view:$t("记忆：各理解阶段有多少卡、接下来两周每天到期多少、最近 30 天的回顾和老是记不住的卡")};}});
const dayKey=d=>{d=new Date(d);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");};
function bars(cols,height=86){
 const top=Math.max(1,...cols.map(c=>c.parts.reduce((a,x)=>a+x.n,0)));
 return '<div class="bars" style="--h:'+height+'px">'+cols.map(c=>{const sum=c.parts.reduce((a,x)=>a+x.n,0);
  return '<div class="bar" title="'+esc(c.tip)+'"><span class="bar-n">'+(sum||"")+'</span><span class="bar-stack">'+c.parts.map(x=>x.n?'<i style="height:'+(x.n/top*height).toFixed(1)+'px;background:'+x.color+'"></i>':"").join("")+'</span><small>'+esc(c.label)+'</small></div>';}).join("")+'</div>';
}
async function loadMemory(pid){
 const node=Dock.els[pid]?.querySelector(".memory");if(!node)return;
 const cards=S.data.cards||[],today=new Date();today.setHours(0,0,0,0);
 const reviews=await rpc("journal",{types:["reviewed"],since:new Date(today-29*864e5).toISOString(),limit:500});
 const order=Object.keys(stageName),count=k=>cards.filter(c=>c.stage===k).length;
 const todayKey=dayKey(today),doneToday=reviews.filter(r=>dayKey(r.at)===todayKey).length;
 // Next two weeks: what is overdue counts today.
 const ahead=Array.from({length:14},(_,i)=>({n:0,day:new Date(+today+i*864e5)}));
 cards.forEach(c=>{const at=cardDueAt(c);if(at===Infinity)return;const i=Math.max(0,Math.floor((new Date(at).setHours(0,0,0,0)-today)/864e5));if(i<14)ahead[i].n++;});
 const label=(d,i)=>i===0?$t("今天"):i===1?$t("明天"):(d.getMonth()+1)+"/"+d.getDate();
 const RATE={again:[$t("忘了"),"var(--red)"],hard:[$t("费劲"),"var(--amber)"],good:[$t("记得"),"var(--accent)"]};
 const past=Array.from({length:30},(_,i)=>{const d=new Date(+today-(29-i)*864e5),k=dayKey(d),rs=reviews.filter(r=>dayKey(r.at)===k);
  return {label:i%5===4||i===29?(d.getMonth()+1)+"/"+d.getDate():"",tip:d.getMonth()+1+$t("/{0}：{1} 次",d.getDate(),rs.length),parts:Object.entries(RATE).map(([r,[,color]])=>({n:rs.filter(x=>x.data.rating===r).length,color}))};});
 // Cards forgotten most often lately: again counts fully, hard by half.
 const weight={};reviews.forEach(r=>{const id=r.refs[0];if(id&&r.data.rating!=="good")weight[id]=(weight[id]||0)+(r.data.rating==="again"?1:.5);});
 const hard=Object.entries(weight).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([id,w])=>({card:cards.find(c=>c.id===id),w})).filter(x=>x.card);
 const total=cards.length||1;
 node.innerHTML="<div class=\"mem-stats\"><div><b>"+cards.length+"</b><small>"+$t("张卡")+"</small></div><div><b>"+(S.data.due||0)+"</b><small>"+$t("现在到期")+"</small></div><div><b>"+doneToday+"</b><small>"+$t("今天回顾")+"</small></div><div><b>"+reviews.length+"</b><small>"+$t("近 30 天回顾")+"</small></div></div>"+(S.data.due?'<div class="inline">'+button(svg("refresh",13)+" "+$t("回顾到期的 {0} 张",S.data.due),"open-review","","primary sm")+'</div>':"")+"<h4>"+$t("理解阶段")+"</h4><div class=\"stage-bar\">"+order.map(k=>count(k)?'<i style="flex:'+count(k)/total+';background:'+stageColor[k]+'" title="'+esc(stageName[k])+' '+count(k)+'"></i>':"").join("")+"</div><div class=\"stage-legend\">"+order.map(k=>'<span><i class="stage-dot" style="background:'+stageColor[k]+'"></i>'+esc(stageName[k])+' '+count(k)+'</span>').join("")+"</div><h4>"+$t("接下来两周到期")+"</h4>"+(ahead.some(x=>x.n)?bars(ahead.map((x,i)=>({label:label(x.day,i),tip:label(x.day,i)+"："+x.n+" "+$t("张"),parts:[{n:x.n,color:"var(--ai)"}]}))):"<p class=\"muted\">"+$t("两周内没有要回顾的卡。还在「待探索」的卡不排期，标成「接触过」以后才开始排。")+"</p>")+"<h4>"+$t("最近 30 天的回顾")+"</h4>"+(reviews.length?bars(past,64)+'<div class="stage-legend">'+Object.values(RATE).map(([t,c])=>'<span><i class="stage-dot" style="background:'+c+'"></i>'+t+'</span>').join("")+'</div>':"<p class=\"muted\">"+$t("还没有回顾过。卡片到期后在「回顾」里自评，这里就会有记录。")+"</p>")+"<h4>"+$t("最近老是记不住的")+"</h4>"+(hard.length?hard.map(x=>sideRow("card",x.card.title,'data-action="open-file" data-path="'+esc(x.card.path)+'"',esc(stageName[x.card.stage]||"")+" · "+dueText(x.card))).join(""):"<p class=\"muted\">"+$t("没有。自评「忘了」或「费劲」的卡会排在这里。")+"</p>");
}
export function cardViewsChanged(){
 clearTimeout(MapState.ctimer);
 MapState.ctimer=setTimeout(()=>Object.keys(Dock.panels).forEach(pid=>{const t=Dock.panels[pid].type;if(t==="library")renderLibrary(pid);else if(t==="memory")safe(()=>loadMemory(pid));}),400);
}

/* ---- the start page: where I am, what is waiting, what changed ---------------------------------------- */
panelType("home",{side:"mine",icon:"home",title:()=>$t("开始"),mount(p,node){node.innerHTML='<div class="home" data-keep-scroll></div>';renderHome(node);},
 screen(){return {view:$t("开始")};}});
async function renderHome(node){
 const box=node.querySelector(".home");if(!box)return;
 const t=(S.data.topics||[]).find(x=>x.id===S.data.active_topic),docs=new Map((S.data.docs||[]).map(d=>[d.id,d]));
 const recent=await safe(()=>rpc("journal",{types:["wrote","ran","viewed"],limit:60}))||[];
 const files=[...new Set(recent.flatMap(e=>(e.data.files||[]).map(f=>f.file).concat(e.data.file?[e.data.file]:[])))].filter(x=>!x.startsWith(".lattice")).slice(0,10);
 const lately=await safe(()=>rpc("journal",{limit:10}))||[];
 const active=(S.data.practices||[]).filter(x=>x.state==="active");
 box.innerHTML="<section class=\"home-now\">"+(t?"<div class=\"overline\">"+$t("正在学")+"</div><h2><a data-action=\"open-doc\" data-id=\""+esc(t.id)+"\">"+esc(t.title)+"</a></h2><p class=\"muted\">"+esc(t.question||"")+"</p>"+((t.route||[]).length?'<ol class="home-route">'+t.route.slice(0,9).map(s=>'<li'+routeClass(s)+'>'+routeStep(s,docs)+'</li>').join("")+'</ol>':"<p class=\"muted\">"+$t("还没有主干路线。")+"</p>")
   :"<div class=\"overline\">"+$t("默认对话")+"</div><h2>"+$t("想到什么，直接和主会话说。")+"</h2><p class=\"muted\">"+$t("值得长期深入的内容，主会话会建成主题，并定一条主干路线；你在左栏「主题」里能看到它们。")+"</p>")+"</section><div class=\"home-grid\"><section class=\"home-box\"><h4>"+svg("refresh",14)+" "+$t("回顾")+"</h4>"+(S.data.due?"<p>"+S.data.due+" "+$t("张卡到期。")+"</p>"+button($t("开始回顾"),"open-review","","primary sm"):"<p class=\"muted\">"+$t("现在没有到期的卡。")+"</p>")+"</section><section class=\"home-box\"><h4>"+svg("code",14)+" "+$t("进行中的练习")+"</h4>"+(active.map(x=>'<a data-action="open-practice" data-id="'+esc(x.id)+'">'+esc(x.title)+'</a>').join("")||"<p class=\"muted\">"+$t("没有。")+"</p>")+"</section><section class=\"home-box\"><h4>"+svg("file",14)+" "+$t("最近碰过的文件")+"</h4>"+(files.map(f=>'<a data-action="open-file" data-path="'+esc(f)+'">'+svg(fileIcon(f),12)+' '+esc(baseName(f))+'</a>').join("")||"<p class=\"muted\">"+$t("还没有。")+"</p>")+"</section><section class=\"home-box wide\"><h4>"+svg("history",14)+" "+$t("刚才发生了什么")+"</h4>"+(lately.map(journalRow).join("")||"<p class=\"muted\">"+$t("还没有记录。")+"</p>")+button($t("打开学习轨迹"),"open-journal","","ghost xs")+"</section></div>";
}
export function homesChanged(){clearTimeout(MapState.htimer);MapState.htimer=setTimeout(()=>Object.keys(Dock.panels).filter(pid=>Dock.panels[pid].type==="home").forEach(pid=>renderHome(Dock.els[pid])),1200);}

/* ---- settings: everything is changeable here ------------------------------------------------------------- */
const SETTINGS_PAGES=[["look",$t("外观与交互"),"sun"],["layout",$t("工作状态与左栏"),"layout"],["agents",$t("四个 AI"),"bot"],["apis",$t("模型连接"),"link"],["web",$t("联网"),"search"],
 ["usage",$t("用量"),"bars"],["run",$t("运行与环境"),"terminal"],["vault",$t("学习库"),"folder"],["rules",$t("学习库的规矩"),"shield"],["keys",$t("快捷键"),"cmd"],["update",$t("更新"),"download"]];
panelType("settings",{side:"mine",icon:"sliders",title:()=>$t("设置"),
 mount(p,node,pid){node.innerHTML='<div class="settings-shell"><nav class="settings-nav"></nav><div class="settings" data-keep-scroll></div></div>';renderSettings(node,p.page||"look");},
 screen(p){return {view:$t("设置"),page:p.page||"look"};}});
export async function renderSettings(node,page){
 const p=Dock.panels[node.dataset.pid];if(p)p.page=page;
 renderSettingsNav(node,page);
 const box=node.querySelector(".settings");box.dataset.page=page;
 box.innerHTML='<div class="loading">…</div>';
 S.config=await rpc("settings");
 box.innerHTML=await SETTINGS_RENDER[page](S.config,node);
 if(page==="apis")fitProviders(box);
}
/* The pages, what saving is doing, and this version (a dot on 「更新」 when a newer one is out). */
function renderSettingsNav(node,page){
 node.querySelector(".settings-nav").innerHTML=SETTINGS_PAGES.map(([k,t,i])=>'<button class="'+(k===page?"on":"")+'" data-action="settings-page" data-page="'+k+'" title="'+esc(t)+'">'+svg(i,14)+'<span>'+esc(t)+'</span>'+(k==="update"&&S.update?.newer?'<i class="nav-dot"></i>':"")+'</button>').join("")+"<span class=\"save-state nav-save\">"+svg("check",13)+" "+$t("改了就自动保存")+"</span>"+(S.version?'<span class="nav-version">Lattice '+esc(S.version)+'</span>':"");
}
/* The provider list and its details scroll on their own; they are as tall as the room left in the settings window
   (not the screen), so in a small or floating window their ends are not hidden below its edge. */
function fitProviders(box){
 const prov=box.querySelector(".prov");if(!prov)return;
 const fit=()=>{
  if(!prov.isConnected)return box.__fit?.disconnect();
  const k=box.getBoundingClientRect().height/(box.offsetHeight||1)||1;
  const top=(prov.getBoundingClientRect().top-box.getBoundingClientRect().top)/k+box.scrollTop;
  const room=Math.max(240,Math.round(box.clientHeight-top-24)),stacked=getComputedStyle(prov).gridTemplateColumns.split(" ").length<2;
  for(const el of prov.querySelectorAll(".prov-list,.prov-detail"))el.style.maxHeight=(stacked&&el.classList.contains("prov-list")?220:room)+"px";
 };
 fit();box.__fit?.disconnect();box.__fit=new ResizeObserver(fit);box.__fit.observe(box);
}
export const opt=(value,list)=>list.map(([v,t])=>'<option value="'+esc(v)+'"'+(String(value)===String(v)?" selected":"")+'>'+esc(t)+'</option>').join("");
const SETTINGS_RENDER={
 async usage(){
  const u=await rpc("usage"),P=u.periods,n=x=>Number(x||0).toLocaleString();
  const card=(k,t)=>{const x=P[k];return "<div class=\"use-card\"><small>"+t+"</small><b>"+tokenNum(x.input+x.output)+"</b><span>"+tokenNum(x.input)+" "+$t("入 · {0} 出 · {1} 次请求",tokenNum(x.output),x.requests)+"</span></div>";};
  const top=Math.max(1,...u.days.map(d=>d.input+d.output));
  const bars=u.days.map(d=>{const t=d.input+d.output;return '<div class="use-day" data-tip="'+esc(d.day+"："+n(t)+" "+$t("tokens\n输入 {0}，输出 {1}，{2} 次请求",n(d.input),n(d.output),d.requests))+'">'+
   '<div class="use-col"><i style="height:'+(t?Math.max(3,t/top*100):0)+'%"></i></div><small>'+Number(d.day.slice(8))+'</small></div>';}).join("");
  const table=(rows,name)=>rows.length?"<div class=\"use-wrap\"><table class=\"use-table\"><thead><tr><th>"+name+"</th><th>"+$t("输入")+"</th><th>"+$t("缓存命中")+"</th><th>"+$t("输出")+"</th><th>"+$t("其中思考")+"</th><th>"+$t("请求")+"</th></tr></thead><tbody>"+rows.map(r=>'<tr><td>'+esc(r.name)+(r.estimated?" <small data-tip=\""+$t("有 {0} 次请求服务没报用量，按字数估算",r.estimated)+"\">"+$t("含估算")+"</small>":"")+'</td><td>'+n(r.input)+'</td><td>'+n(r.cached)+'</td><td>'+n(r.output)+'</td><td>'+n(r.reasoning)+'</td><td>'+n(r.requests)+'</td></tr>').join("")+"</tbody></table></div>":"<p class=\"muted\">"+$t("还没有记录。")+"</p>";
  return "<h3>"+$t("用量")+"</h3><p class=\"muted\">"+$t("每次 AI 回答用掉的 token 都记在这台电脑上（不进学习库）：一次回答里的每一轮请求（包括调用工具的那几轮）都算上，输入里有多少是缓存命中、输出里有多少是思考也分开记。服务没报用量时按字数估算，并标出「估算」。")+(u.since?$t("从 {0} 开始记录。",esc(fmtDate(u.since,true))):"")+"</p><div class=\"use-cards\">"+card("today",$t("今天"))+card("week",$t("近 7 天"))+card("month",$t("近 30 天"))+card("all",$t("全部"))+"</div><div class=\"field-label\">"+$t("近 14 天")+"</div><div class=\"use-days\">"+bars+"</div><h3>"+$t("按模型")+"</h3>"+table(u.models,$t("模型"))+"<h3>"+$t("按 AI")+"</h3>"+table(u.agents.map(r=>({...r,name:who(r.name)})),"AI");
 },
 look(c){
  const u=S.ui;
  return themeSettings()+"<h3>"+$t("外观")+"</h3>"+
  // Each language under its own name, so it can be found whatever the interface speaks now.
  "<div class=\"three\"><label>"+$t("界面语言")+"<select data-ui=\"language\">"+opt(u.language||LANG,[["auto",$t("跟随系统")],["zh","中文"],["en","English"]])+"</select></label></div><div class=\"three\"><label>"+$t("深色还是浅色")+"<select data-ui=\"theme\">"+opt(u.theme,[["dark",$t("深色")],["light",$t("浅色")]])+"</select></label><label>"+$t("正文字号")+"<input type=\"number\" step=\"0.5\" min=\"11\" max=\"24\" data-ui=\"font_size\" value=\""+esc(u.font_size)+"\"/></label><label>"+$t("笔记字号")+"<input type=\"number\" step=\"0.5\" min=\"12\" max=\"28\" data-ui=\"note_font_size\" value=\""+esc(u.note_font_size??16)+"\"/></label><label>"+$t("代码字号")+"<input type=\"number\" step=\"0.5\" min=\"10\" max=\"24\" data-ui=\"code_font_size\" value=\""+esc(u.code_font_size)+"\"/></label></div><div class=\"three\"><label>"+$t("行距")+"<input type=\"number\" step=\"0.05\" min=\"1.3\" max=\"2.4\" data-ui=\"line_height\" value=\""+esc(u.line_height)+"\"/></label><label>"+$t("密度")+"<select data-ui=\"density\">"+opt(u.density,[["comfortable",$t("舒适")],["compact",$t("紧凑")]])+"</select></label></div><div class=\"field-label\">"+$t("阅读宽度")+" <small>"+$t("对话和文档正文一行最多多少字；某个窗口还能在它的 ⋯ 菜单里单独调")+"</small></div><div class=\"range-row\"><input type=\"range\" min=\"20\" max=\"120\" step=\"1\" data-ui-range=\"read_width\" value=\""+(readChars(u.read_width)||42)+"\""+(readChars(u.read_width)?"":" disabled")+"/><b data-range-out=\"read_width\">"+(readChars(u.read_width)?readChars(u.read_width)+" "+$t("字"):$t("不限"))+"</b><label class=\"check inline-check\"><input type=\"checkbox\" data-read-unlimited"+(readChars(u.read_width)?"":" checked")+"/> "+$t("不限")+"</label></div><h3>"+$t("每种窗口的大小")+"</h3><p class=\"muted\">"+$t("新开的窗口按这里的比例显示，文字、代码、间距和图标一起缩放。某一个窗口还可以单独调：鼠标放在它上面按 Ctrl + 滚轮，或者聚焦后按 Ctrl + = / Ctrl + - / Ctrl + 0，标签上右键也能调；单独调过的会在标签上显示百分比，跟着工作状态一起记住。")+"</p><div class=\"zoom-grid\">"+ZOOM_KINDS.map(([k,t])=>'<label>'+esc(t)+'<span class="unit"><input type="number" step="5" min="60" max="250" data-zoom-kind="'+k+'" value="'+Math.round((Number(u.zoom?.[k])||1)*100)+'"/>%</span></label>').join("")+"</div>"+(Object.values(Dock.panels).some(p=>p.zoom)?"<div class=\"inline\"><span class=\"muted\">"+$t("有 {0} 个窗口单独调过大小。",Object.values(Dock.panels).filter(p=>p.zoom).length)+"</span>"+button($t("全部恢复成各自的默认"),"zoom-reset-all","","ghost sm")+"</div>":"")+"<label>"+$t("笔记默认的显示方式")+"<select data-ui=\"md_mode\">"+opt(u.md_mode||"live",MD_MODES)+"</select></label><label>"+$t("模型的思考过程")+"<select data-ui=\"thinking\">"+opt(u.thinking||"collapsed",[["collapsed",$t("折叠，只显示用时和一句摘要")],["open",$t("展开")],["hidden",$t("不显示")]])+"</select></label><h3>"+$t("交互")+"</h3><label>"+$t("发送消息")+"<select data-ui=\"send_key\">"+opt(u.send_key,[["enter",$t("Enter 发送，Shift + Enter 换行")],["ctrl",$t("Ctrl + Enter 发送，Enter 换行")]])+"</select></label><label>"+$t("AI 批注")+"<select data-ui=\"ai_annotate\">"+opt(u.ai_annotate||"auto",[["auto",$t("主动批注：讲到原文时自己留在原文旁边")],["asked",$t("只在我要求时才留")]])+"</select></label><label class=\"check\"><input type=\"checkbox\" data-ui=\"selection_popup\""+(u.selection_popup?" checked":"")+"/> "+$t("选中文字时出现「问快答 / 问主会话」")+"</label><label class=\"check\"><input type=\"checkbox\" data-cfg=\"agent_auto_organize\""+(c.agent_auto_organize?" checked":"")+"/> "+$t("关掉随手写的记录或代码后，自动交给 AI 整理")+"</label><label class=\"check\"><input type=\"checkbox\" data-cfg=\"auto_cards\""+(c.auto_cards?" checked":"")+"/> "+$t("边学边记知识卡：主会话每讲完一段，整理助手在后台把讲到的概念、原理、方法和思想记成分好类、连好关系的卡")+"</label><label>"+$t("停下多少秒后提交我的编辑")+"<input type=\"number\" min=\"5\" max=\"3600\" data-cfg=\"commit_idle\" value=\""+esc(c.commit_idle)+"\"/></label>";
 },
 layout(){
  const b=(t,a,id,extra="")=>button(t,a,'data-space="'+esc(id)+'" '+extra,"ghost xs");
  return "<h3>"+$t("工作状态")+"</h3><p class=\"muted\">"+$t("每个工作状态像一个单独的程序，记着自己的窗口和左栏，在底栏切换（Ctrl + Shift + 1～9）；外观和主题是共用的。同一个对话、同一个文件可以同时出现在几个工作状态里。拖动、分栏、浮出都会自动记住。底栏的「＋」新建，标签上右键改名、复制、存成模板、放进单独的窗口（能拖到别的屏幕）、关闭，拖动调顺序。")+"</p><div class=\"preset-list\">"+spaceList().map(sp=>'<div class="preset'+(sp.hidden?" off":"")+'">'+svg(sp.icon||"layout",14)+' <b>'+esc(sp.name)+'</b>'+
    (sp.id===Dock.space?"<span class=\"chip on\">"+$t("当前")+"</span>":"")+(sp.hidden?"<span class=\"chip\">"+$t("已关闭")+"</span>":"")+'<span class="grow"></span>'+
    (sp.hidden?b($t("打开"),"space-reopen",sp.id):sp.id===Dock.space?"":b($t("切换"),"space",sp.id))+b($t("改名"),"space-rename",sp.id)+(sp.hidden?"":b($t("关闭"),"space-close",sp.id))+b($t("删除"),"space-delete",sp.id)+'</div>').join("")+"</div>"+((S.ui.templates||[]).length?"<h3>"+$t("我的模板")+"</h3><div class=\"preset-list\">"+S.ui.templates.map(t=>'<div class="preset">'+svg(t.icon||"layout",14)+' <b>'+esc(t.name)+'</b><span class="grow"></span>'+
    button($t("用它新建"),"space-from",'data-template="'+esc(t.id)+'"',"ghost xs")+button($t("删除"),"space-template-delete",'data-template="'+esc(t.id)+'"',"ghost xs")+'</div>').join("")+"</div>":"")+"<div class=\"inline\">"+button(svg("plus",13)+" "+$t("新工作状态"),"space-blank","","primary sm")+"</div><h3>"+$t("左栏")+"</h3><p class=\"muted\">"+$t("活动栏的图标只换左栏里的列表，窗口不动（Ctrl + 1～8）；每个工作状态的左栏各记各的。收起、展开左栏：点它右上角的按钮、再点一次当前列表的图标，或者按 Ctrl + B。")+"</p><label>"+$t("左栏宽度")+"<input type=\"number\" min=\"180\" max=\"560\" data-side-width value=\""+esc(sideWidth())+"\"/></label><label class=\"check\"><input type=\"checkbox\" data-ui=\"activity_plus\""+(S.ui.activity_plus?" checked":"")+"/> "+$t("活动栏里也放一个「＋」")+" <small>"+$t("（和每组标签末尾的「＋」是同一个菜单）")+"</small></label>";
 },
 async agents(c){
  const cards=[];
  for(const [name,a] of Object.entries(c.agents)){
   const d=await rpc("agent_definition",{name}),def=d.definition,apiOpts=c.apis.map(x=>[x.id,x.label+(x.has_key?"":" "+$t("· 没有 Key"))]);
   cards.push("<details class=\"agent-edit\""+(name==="tutor"?" open":"")+"><summary><b>"+esc(a.title)+"</b> <span class=\"muted\">"+esc(a.label)+(d.overridden?" "+$t("· 规则已改写"):"")+"</span></summary><div class=\"three\"><label>"+$t("API 连接")+"<select data-cfg-agent=\""+name+"\" data-key=\"api\">"+opt(a.api,apiOpts)+"</select></label><label>"+$t("模型")+" <small>"+$t("可以从连接读到的列表里选")+"</small><input data-cfg-agent=\""+name+"\" data-key=\"model\" data-suggest=\"models-"+esc(a.api)+"\" value=\""+esc(a.model)+"\"/></label><label>"+$t("回复上限（含思考）")+"<input type=\"number\" min=\"256\" max=\"64000\" data-cfg-agent=\""+name+"\" data-key=\"max_tokens\" value=\""+esc(a.max_tokens)+"\"/></label></div><div class=\"three\"><label>Temperature <small>"+$t("留空用全局")+"</small><input type=\"number\" step=\"0.05\" min=\"0\" max=\"2\" data-cfg-agent=\""+name+"\" data-key=\"temperature\" value=\""+esc(a.temperature??"")+"\"/></label><label>"+$t("思考强度")+" <small>"+$t("每个窗口还能在模型菜单里单独调")+"</small><select data-cfg-agent=\""+name+"\" data-key=\"effort\">"+opt(a.effort||"",[["",$t("服务默认")],...Object.entries(c.effort_levels||{})])+"</select></label><label>"+$t("每轮带上多少条历史")+"<input type=\"number\" min=\"0\" max=\"200\" data-agent-history=\""+name+"\" value=\""+esc(def.history)+"\"/></label><label class=\"check\"><input type=\"checkbox\" data-agent-blocks=\""+name+"\""+(def.blocks?" checked":"")+"/> "+$t("能用展示块")+"</label></div><div class=\"field-label\">"+$t("能用的工具")+"</div><div class=\"tool-grid\">"+d.tools.map(t=>'<label class="check" title="'+esc(t.description)+'"><input type="checkbox" data-agent-tool="'+name+'" value="'+t.name+'"'+(def.tools.includes(t.name)?" checked":"")+'/> '+esc(t.name)+'</label>').join("")+"</div><label>"+$t("规则")+" <small>"+$t("它每一轮都读；改了存进学习库的 agents/{0}.md",name)+"</small><textarea rows=\"14\" data-agent-policy=\""+name+"\">"+esc(def.policy)+"</textarea></label><div class=\"inline\">"+button(svg("history",13)+" "+$t("规则的历史"),"agent-history","data-name=\""+name+"\" data-tip=\""+$t("每次改动都在这里，任何一版都能对照着恢复")+"\"","ghost sm")+button(svg("split",13)+" "+$t("左右对照着改"),"agent-revise","data-name=\""+name+"\" data-tip=\""+$t("在左右对照里改，审过再批准；还能用两版规则各回答一次来比")+"\"","ghost sm")+(d.overridden?button($t("恢复默认规则"),"agent-reset",'data-name="'+name+'"',"ghost sm"):"")+button($t("测试连接"),"cfg-test",'data-agent="'+name+'"',"ghost sm")+"</div></details>");
  }
  return "<h3>"+$t("四个 AI")+"</h3><p class=\"muted\">"+$t("工具、历史条数和规则改了会存进学习库的 agents/；所有 AI 都还会先读学习库的规矩（AGENTS.md）。连接在「模型连接」里加和改。")+"</p>"+cards.join("")+"<div class=\"test-result\" id=\"cfg-test-result\"></div>"+c.apis.map(x=>'<datalist id="models-'+esc(x.id)+'">'+(x.models||[]).map(m=>'<option value="'+esc(m)+'">').join("")+'</datalist>').join("");
 },
 apis(c){
  /* Two columns: every provider on the left, the chosen one on the right with its key first. */
  const groups=["本机","聚合","国内","云服务","自定义"],ready=a=>a.auth!=="none"&&a.has_key;
  const q=(Settings.apiQuery||"").trim().toLowerCase();
  const list=c.apis.filter(a=>!q||(a.label+a.id).toLowerCase().includes(q));
  const pick=c.apis.find(a=>a.id===Settings.openApi)||c.apis.find(ready)||c.apis[0];
  const left="<div class=\"prov-list\"><input class=\"side-input\" data-api-query placeholder=\""+$t("搜供应商…")+"\" value=\""+esc(Settings.apiQuery||"")+"\"/>"+(list.some(ready)?"<div class=\"prov-group\">"+$t("已填好")+"</div>"+list.filter(ready).map(a=>provRow(a,pick)).join(""):"")+groups.map(g=>{const l=list.filter(a=>!ready(a)&&(a.group||"自定义")===g);return l.length?'<div class="prov-group">'+esc($t(g))+'</div>'+l.map(a=>provRow(a,pick)).join(""):"";}).join("")+"<button class=\"prov-row prov-add\" data-action=\"api-new\">"+svg("plus",13)+"<span>"+$t("自定义连接")+"</span></button></div>";
  return "<h3>"+$t("模型连接")+"</h3><p class=\"muted\">"+$t("左边选一个供应商，右边贴上 API Key 就能用；Key 只保存在本机，界面拿不到它。都走 OpenAI 兼容的 Chat Completions，其余设置一般不用动。")+"</p><div class=\"prov\">"+left+"<div class=\"prov-detail\">"+(pick?apiDetail(pick,c):"")+"</div></div><h3>"+$t("全局")+"</h3><div class=\"two\"><label>"+$t("超时（秒）")+"<input type=\"number\" data-cfg=\"timeout\" value=\""+esc(c.timeout)+"\"/></label><label>"+$t("全局 Temperature")+"<input type=\"number\" step=\"0.05\" data-cfg=\"temperature\" value=\""+esc(c.temperature)+"\"/></label></div>";
 },
 web(c){
  return "<h3>"+$t("联网")+"</h3><p class=\"muted\">"+$t("AI 有两个联网接口：搜索和读网页。什么时候查由它判断；来源列在回复下面，并记进轨迹。读网页不会访问本机和局域网地址。")+"</p><label>"+$t("搜索服务")+"<select data-cfg-web=\"search\">"+opt(c.web.search,Object.entries(c.web_backends))+"</select></label><label>"+$t("SearXNG 地址")+"<input data-cfg-web=\"searxng_url\" value=\""+esc(c.web.searxng_url)+"\" placeholder=\"https://searx.example\"/></label><div class=\"two\"><label>Brave Key <small>"+(c.web.brave_key?$t("已保存"):$t("未填"))+"</small><input type=\"password\" data-cfg-web=\"brave_key\"/></label><label>Tavily Key <small>"+(c.web.tavily_key?$t("已保存"):$t("未填"))+"</small><input type=\"password\" data-cfg-web=\"tavily_key\"/></label></div>";
 },
 async run(c){
  const env=await rpc("env_info",{name:Settings.env||"default"}).catch(()=>null),acc=await rpc("accelerator").catch(()=>null);
  const rows=Object.keys({...c.default_runners,...c.runners}).sort().map(ext=>'<div class="runner-row"><code>'+esc(ext)+'</code><input data-runner="'+esc(ext)+'" value="'+esc(c.runners[ext]??"")+'" placeholder="'+esc(c.default_runners[ext]||"")+'"/></div>').join("");
  return "<h3>"+$t("运行")+"</h3><label class=\"check\"><input type=\"checkbox\" data-cfg=\"agent_auto_run\""+(c.agent_auto_run?" checked":"")+"/> "+$t("允许 AI 自己运行代码和命令")+" <small>"+(S.data.sandbox?.isolated?$t("都在沙箱里：看不到家目录和你的其他文件"):$t("这台电脑没有沙箱：AI 的命令用你的权限直接运行，碰得到学习库以外的文件"))+"</small></label><label class=\"check\"><input type=\"checkbox\" data-cfg=\"agent_network\""+(c.agent_network!==false?" checked":"")+"/> "+$t("沙箱可以上网")+" <small>"+(S.data.sandbox?.isolated?$t("经过 Lattice 的代理：能装包下载、拉数据集、调网上的接口，连不了这台电脑和局域网；访问了哪些网站记在学习轨迹里。改了之后新开的内核才生效"):$t("这台电脑没有沙箱，这个开关不起作用：AI 的命令直接联网"))+"</small></label><label class=\"check\"><input type=\"checkbox\" data-cfg=\"gpu\""+(c.gpu!==false?" checked":"")+"/> "+$t("允许用显卡计算")+" <small>"+$t("AI 需要时（训练、CUDA）和你运行导入了 torch / jax 之类的 Python 时用；实验笔记的内核可以单独切到显卡，空闲 15 分钟自动关掉")+"</small></label>"+(acc?"<div class=\"accel-box\"><div class=\"field-label\">"+$t("这台电脑")+" <small>"+$t("自动识别，不会唤醒显卡；AI 装 torch 之类的库时按这个选版本")+"</small></div>"+(acc.accelerators.length?acc.accelerators.map(a=>'<div class="accel-row'+(a.kind===acc.preferred?" on":"")+'">'+svg(a.kind===acc.preferred?"check":"spark",13)+'<b>'+esc(a.name)+'</b>'+
     (a.driver?"<span class=\"chip\">"+$t("驱动")+" "+esc(a.driver)+"</span>":"")+(a.cuda_max?'<span class="chip">CUDA ≤ '+esc(a.cuda_max)+'</span>':"")+(a.kind===acc.preferred?"<span class=\"chip on\">"+$t("用这块算")+"</span>":"")+'</div>').join(""):"<p class=\"muted\">"+$t("没有找到能用来计算的显卡，代码都在 CPU 上跑。")+"</p>")+"<div class=\"muted small\">"+$t("启动方式：{0} · 学习库的 Python",esc(acc.launcher))+" "+esc(acc.python)+"</div><label>"+$t("显卡运行的启动方式")+" <small>"+$t("auto：有 nvidia-run 就用它（跑完让显卡休眠），否则直接运行；none：直接运行；也可以写一条命令的开头，比如 prime-run")+"</small><input data-cfg=\"gpu_launcher\" value=\""+esc(acc.setting)+"\" placeholder=\"auto\"/></label></div>":"")+"<label class=\"check\"><input type=\"checkbox\" data-cfg=\"auto_install\""+(c.auto_install?" checked":"")+"/> "+$t("运行时缺 Python 包就自动装进环境，再跑一次")+" <small>"+$t("关掉以后，运行结果里会给一个「装上再运行」的按钮")+"</small></label><div class=\"three\"><label>"+$t("实验笔记单格时限（秒）")+"<input type=\"number\" data-cfg=\"kernel_timeout\" value=\""+esc(c.kernel_timeout)+"\"/></label><label>"+$t("运行文件时限（秒）")+"<input type=\"number\" data-cfg=\"run_timeout\" value=\""+esc(c.run_timeout)+"\"/></label><label>"+$t("AI 命令时限（秒）")+"<input type=\"number\" data-cfg=\"shell_timeout\" value=\""+esc(c.shell_timeout)+"\"/></label></div><div class=\"field-label\">"+$t("运行器")+" <small>"+$t("每种扩展名用什么命令运行。留空用默认（灰字）；可用 {file} {dir} {stem} {out} {python}")+"</small></div><div class=\"runners\">"+rows+"</div><div class=\"inline\"><input data-runner-new placeholder=\".ext\"/><input data-runner-new-cmd placeholder=\""+$t("程序 {file}")+"\"/>"+button($t("加一行"),"runner-add","","ghost xs")+"</div><h3>"+$t("Python 环境")+"</h3>"+(env?"<div class=\"inline\"><select data-env-pick>"+opt(env.name,env.names.map(n=>[n,n]))+"</select><input data-env-new placeholder=\""+$t("新环境的名字")+"\"/>"+button($t("新建环境"),"env-create","","ghost xs")+"</div><p class=\"muted\">"+(env.ready?$t("已建好"):$t("第一次用时自动建好"))+" "+$t("· 定义在 {0}。在某个目录里放一个内容是环境名的 .lattice-env 文件，那个目录下的文件就用这个环境。",esc(env.definition))+"</p><label>"+$t("这个环境里的包（一行一个，可以带版本）")+"<textarea rows=\"6\" data-env-text>"+esc(env.wanted.join("\n"))+"</textarea></label><div class=\"inline\"><input data-env-install placeholder=\""+$t("现在就装：包名，空格分开")+"\"/>"+button($t("安装"),"env-install","","ghost sm")+"</div>"+(env.installed.length?"<details><summary class=\"muted\">"+$t("已经装了 {0} 个包",env.installed.length)+"</summary><p class=\"small muted\">"+env.installed.map(x=>esc(x.name+" "+x.version)).join("、")+"</p></details>":""):"")+"<h3>"+$t("沙箱")+"</h3><p class=\""+(S.data.sandbox?.ok?"muted":"warn")+"\">"+(S.data.sandbox?.isolated?svg("shield",13)+" "+$t("沙箱可用（bubblewrap）。AI 的命令和运行都在里面：学习库可写，挂载的目录只读，看不到家目录的其余部分；能不能上网看上面「运行」里的开关。"):
    S.data.sandbox?.ok?svg("play",13)+" "+$t("这台电脑上没有沙箱：AI 的命令和运行用你的权限直接运行，能联网，也碰得到学习库以外的文件。它们改动的学习库文件照样一步一步记进历史，可以撤销。"):esc(S.data.sandbox?.why||""))+"</p><label>"+$t("沙箱里额外可见的只读路径")+" <small>"+$t("一行一个，比如装在家目录里的工具链")+"</small><textarea rows=\"2\" data-cfg=\"sandbox_paths\">"+esc((c.sandbox_paths||[]).join("\n"))+"</textarea></label>";
 },
 vault(c){
  const projects=S.data.projects||[];
  return "<h3>"+$t("学习库")+"</h3><p class=\"muted\">"+$t("所有学习数据都是普通文件，放在")+" <code>"+esc(c.vault_path)+"</code>"+$t("，它本身是一个 git 仓库，可以用任何编辑器直接改。")+"</p><label>"+$t("学习库的位置")+" <small>"+(c.env_vault?$t("现在由环境变量 LATTICE_VAULT 决定，这里的设置不生效"):$t("重启 Lattice 后生效；留空就是 ~/Lattice"))+"</small><input data-cfg=\"vault\" value=\""+esc(c.vault)+"\" placeholder=\"~/Lattice\"/></label><div class=\"inline\">"+button(svg("folder",13)+" "+$t("在系统里打开"),"open-vault","","ghost sm")+button(svg("download",13)+" "+$t("导出整个学习库"),"export","","ghost sm")+button(svg("upload",13)+" "+$t("导入 Markdown 笔记"),"import-md","","ghost sm")+"</div><h3>"+$t("挂载的目录")+"</h3><p class=\"muted\">"+$t("你能读写，AI 只读。")+"</p>"+projects.map(x=>'<div class="preset">'+svg("link",13)+' <b>'+esc(x.name)+'</b><span class="muted small">'+esc(x.path)+'</span><span class="grow"></span>'+button($t("取消挂载"),"project-remove",'data-id="'+esc(x.id)+'"',"ghost xs")+'</div>').join("")+button(svg("plus",13)+" "+$t("挂载一个目录"),"project-add","","ghost sm");
 },
 async rules(){
  const r=await rpc("rules");
  return "<h3>"+$t("学习库的规矩")+"</h3><p class=\"muted\">"+$t("学习库根目录的 AGENTS.md：目录约定、属性格式、谁能改什么。每个 AI 每一轮都先读它。")+"</p><textarea rows=\"26\" data-rules>"+esc(r.text)+"</textarea><div class=\"inline\">"+button($t("恢复成默认的规矩"),"rules-reset","","ghost sm")+button($t("在编辑器里打开"),"open-file",'data-path="AGENTS.md"',"ghost sm")+"</div>";
 },
 async update(){
  const u=S.update=await rpc("update_state"),how={"windows-setup":$t("用安装包更新：Lattice 关闭后装上新版本，装好自动重新打开。"),
   "windows-zip":$t("新版本先解开在 Lattice 文件夹旁边，Lattice 关闭后替换旧的文件夹，再重新打开。"),"linux":$t("新版本先解开在 Lattice 文件夹旁边，Lattice 关闭后替换旧的文件夹，再重新打开。"),
   "macos":$t("下载新的安装盘并打开它：退出 Lattice 后，把里面的 Lattice 拖进「应用程序」替换旧的。"),"source":$t("这个 Lattice 是从源码运行的：在仓库里 git pull 就是更新。")}[u.how]||"";
  const notes=u.newer&&u.latest.notes?"<details class=\"update-notes\" open><summary>"+$t("{0} 的说明",esc(u.latest.name||"v"+u.latest.version))+"</summary><div class=\"markdown\">"+markdown(u.latest.notes)+"</div></details>":"";
  return "<h3>"+$t("更新")+"</h3><p class=\"muted\">"+esc(how)+" "+$t("学习库和设置都不受影响。")+"</p><div class=\"update-box\" data-version=\""+esc(u.newer?u.latest.version:"")+"\">"+updateBox(u)+"</div>"+notes+
   "<label class=\"check\"><input type=\"checkbox\" data-cfg=\"update_check\""+(u.auto?" checked":"")+"/> "+$t("每天到 GitHub 看一次有没有新版本")+" <small>"+$t("只读取发布页上的版本和说明，不发送你的任何数据；下载和安装都等你点")+"</small></label>";
 },
 keys(){
  const send=S.ui.send_key==="ctrl"?$t("Ctrl + Enter 发送，Enter 换行"):$t("Enter 发送，Shift + Enter 换行");
  return "<h3>"+$t("快捷键")+"</h3><table class=\"keys\">"+[["Ctrl + K",$t("搜索或输入命令")],["Ctrl + N",$t("写记录")],["Ctrl + S",$t("保存")],["Ctrl + J",$t("快答")],["Ctrl + W",$t("关闭当前面板")],["Ctrl + B",$t("展开或收起左栏")],[$t("消息框"),send],["Ctrl + Enter",$t("在代码文件里：运行")],["Shift + Enter",$t("在实验笔记里：运行当前格")],["Tab",$t("在代码里缩进")],["Esc",$t("关闭弹窗")]].map(([k,t])=>'<tr><td><kbd>'+esc(k)+'</kbd></td><td>'+esc(t)+'</td></tr>').join("")+"</table><p class=\"muted\">"+$t("发送键在「外观与交互」里改。")+"</p>";
 },
};
/* Where the update stands: this version, the newest one, and what can be done about it now. */
function updateBox(u){
 const L=u.latest,mb=n=>(n/1048576).toFixed(n>=1048576*10?0:1)+" MB",page=L?.page||u.releases;
 const state=u.checking?$t("正在检查…"):u.error&&u.phase!=="failed"?'<span class="bad">'+$t("检查失败：")+esc(u.error)+'</span>':
  u.newer?"<span class=\"chip on\">"+$t("{0} 可以更新了",esc("v"+L.version))+"</span>"+(L.published?" <small class=\"muted\">"+$t("发布于 {0}",esc(fmtDate(L.published)))+"</small>":""):
  u.checked?$t("已经是最新版本")+" <small class=\"muted\">"+$t("上次检查：{0}",esc(fmtDate(new Date(u.checked*1000).toISOString(),true)))+"</small>":$t("还没有检查过");
 let act="";
 if(u.newer&&u.blocked)act='<span class="muted small">'+esc(u.blocked)+'</span>';
 else if(u.newer&&u.phase==="downloading")act='<span class="update-progress">'+$t("正在下载 {0}",u.total?Math.floor(u.got/u.total*100)+"%":mb(u.got))+" · "+mb(u.got)+(u.total?" / "+mb(u.total):"")+'</span>'+button($t("取消"),"update-cancel","","ghost sm");
 else if(u.newer&&u.phase==="preparing")act='<span class="update-progress">'+$t("正在解开新版本…")+'</span>';
 else if(u.newer&&u.phase==="ready")act=u.how==="macos"?button(svg("external",13)+" "+$t("打开安装盘"),"update-apply","","primary sm"):button(svg("refresh",13)+" "+$t("重启并更新"),"update-apply","","primary sm");
 else if(u.newer)act=(u.phase==="failed"?'<span class="bad small">'+esc(u.error)+'</span>':"")+button(svg("download",13)+" "+(u.phase==="failed"?$t("重新下载"):$t("下载更新"))+(u.size?" · "+mb(u.size):""),"update-download","","primary sm");
 return '<div class="update-state"><b>Lattice '+esc(u.current)+'</b> '+state+'</div><div class="inline">'+act+(u.checking?"":button(svg("refresh",13)+" "+$t("检查更新"),"update-check","","ghost sm"))+
  "<a class=\"btn ghost sm\" data-action=\"open-url\" data-url=\""+esc(page)+"\">"+svg("external",12)+" "+$t("发布页")+"</a></div>";
}
/* News of the update from behind: a check done, how far a download is. The pages showing it follow. */
export function updateEvent(evt){
 if(evt.type==="update_progress"){if(!S.update)return;if(evt.phase)S.update.phase=evt.phase;else Object.assign(S.update,{got:evt.got,total:evt.total});}
 else S.update=evt.update;
 for(const pid of Object.keys(Dock.panels)){
  const node=Dock.els[pid],page=node?.querySelector(".settings")?.dataset.page;
  if(Dock.panels[pid].type!=="settings"||!node)continue;
  if(evt.type==="update")renderSettingsNav(node,page);
  const box=page==="update"&&node.querySelector(".update-box");
  // A new release's notes come with a page of their own; how far a download is, just in the box.
  if(box&&evt.type==="update"&&(S.update.newer?S.update.latest.version:"")!==box.dataset.version)renderSettings(node,"update");
  else if(box)box.innerHTML=updateBox(S.update);
 }
}
export const Settings={env:"default",tests:{}};
/* Every setting saves itself shortly after it changes; text fields wait until typing pauses. */
const Autosave={timers:{}};
function saveState(node,text,bad=false){const s=node?.querySelector(".save-state");if(s){s.innerHTML=svg(bad?"info":"check",13)+" "+esc(text);s.classList.toggle("bad",bad);}else if(bad)toast(text,"error");}
function autosave(node,key,fn,delay){
 clearTimeout(Autosave.timers[key]);saveState(node,$t("正在保存…"));
 Autosave.timers[key]=setTimeout(async()=>{
  try{await fn();saveState(node,$t("已自动保存 ·")+" "+new Date().toLocaleTimeString(LOCALE,{hour:"2-digit",minute:"2-digit",second:"2-digit"}));}
  catch(e){saveState(node,$t("没有保存：")+e.message,true);}
 },delay);
}
export function settingsAutosave(t,changed){
 const node=t.closest?.(".panel-settings");if(!node)return false;
 const delay=changed?250:900;
 if(t.matches("[data-cfg],[data-cfg-agent],[data-cfg-api],[data-cfg-web],[data-runner]")){
  if(!changed&&t.type==="password"&&t.value.length<8)return true;
  autosave(node,"cfg",async()=>{
   const secret=all("input[type=password]",node).some(i=>i.value);
   S.config=await rpc("settings_save",{config:collectSettings(node)});
   Object.keys(Chat).forEach(updateComposer);
   // A new key, or a different way of sending it, changes what the connection's card shows.
   if(t.dataset.cfgApi)Settings.openApi=t.dataset.cfgApi;
   if(secret||t.dataset.key==="auth")renderSettings(node,node.querySelector(".settings").dataset.page);
  },delay);
  return true;
 }
 const agent=t.dataset.agentHistory||t.dataset.agentBlocks||t.dataset.agentTool||t.dataset.agentPolicy;
 if(agent){
  autosave(node,"agent:"+agent,async()=>{const q=s=>node.querySelector(s);
   await rpc("agent_save",{name:agent,history:Number(q('[data-agent-history="'+agent+'"]').value),blocks:q('[data-agent-blocks="'+agent+'"]').checked,
    tools:all('[data-agent-tool="'+agent+'"]',node).filter(i=>i.checked).map(i=>i.value),policy:q('[data-agent-policy="'+agent+'"]').value});},changed?250:1500);
  return true;
 }
 if(t.dataset.envText!==undefined){autosave(node,"env",()=>rpc("env_save",{name:Settings.env,text:t.value}),changed?250:1500);return true;}
 if(t.dataset.rules!==undefined){autosave(node,"rules",()=>rpc("rules_save",{text:t.value}),changed?250:1500);return true;}
 return false;
}
function collectSettings(node){
 const cfg={};
 all("[data-cfg-agent]",node).forEach(i=>{cfg.agents=cfg.agents||{};(cfg.agents[i.dataset.cfgAgent]=cfg.agents[i.dataset.cfgAgent]||{})[i.dataset.key]=i.type==="number"?(i.value===""?null:Number(i.value)):i.value;});
 all("[data-cfg-api]",node).forEach(i=>{cfg.apis=cfg.apis||{};const a=cfg.apis[i.dataset.cfgApi]=cfg.apis[i.dataset.cfgApi]||{};
  if(i.dataset.key==="headers"||i.dataset.key==="extra_body"){try{a[i.dataset.key]=JSON.parse(i.value||"{}");}catch(_){throw new Error($t("「{1}」的 {0} 不是合法的 JSON",i.dataset.key,i.dataset.cfgApi));}}
  else if(i.dataset.key!=="api_key"||i.value)a[i.dataset.key]=i.value;});
 all("[data-cfg-web]",node).forEach(i=>{cfg.web=cfg.web||{};if(i.type!=="password"||i.value)cfg.web[i.dataset.cfgWeb]=i.value;});
 all("[data-cfg]",node).forEach(i=>{
  const k=i.dataset.cfg;
  if(i.type==="checkbox")cfg[k]=i.checked;else if(i.type==="number")cfg[k]=Number(i.value);
  else if(k==="sandbox_paths")cfg[k]=i.value.split("\n").map(x=>x.trim()).filter(Boolean);else cfg[k]=i.value;
 });
 const runners=all("[data-runner]",node);
 if(runners.length){cfg.runners={};runners.forEach(i=>{if(i.value.trim())cfg.runners[i.dataset.runner]=i.value.trim();});}
 return cfg;
}
async function saveSettings(node,quiet=false){
 S.config=await rpc("settings_save",{config:collectSettings(node)});
 if(quiet)return;
 toast($t("设置已保存"));refreshChats();renderSettings(node,node.querySelector(".settings").dataset.page);
}
function provRow(a,pick){
 const state=a.auth==="none"?"local":a.has_key?"on":"off";
 return '<button class="prov-row'+(a.id===pick?.id?" on":"")+'" data-action="api-pick" data-api="'+esc(a.id)+'"><i class="prov-dot '+state+'"></i><span>'+esc(a.label)+'</span>'+
  (a.models?.length?'<small>'+a.models.length+'</small>':"")+'</button>';
}
function apiDetail(a,c){
 const f=(key,label,attrs="",val=a[key])=>'<label>'+label+'<input data-cfg-api="'+esc(a.id)+'" data-key="'+key+'" value="'+esc(val??"")+'" '+attrs+'/></label>';
 const users=Object.values(c.agents||{}).filter(x=>x.api===a.id).map(x=>x.title),models=a.models||[],test=Settings.tests[a.id];
 const head='<div class="prov-head"><b>'+esc(a.label)+'</b>'+(users.length?"<span class=\"chip on\">"+esc(users.join("、"))+$t("在用")+"</span>":"")+'<span class="grow"></span>'+
  (a.key_url?"<a class=\"btn ghost xs\" data-action=\"open-url\" data-url=\""+esc(a.key_url)+"\">"+svg("external",12)+" "+$t("去获取 Key")+"</a>":"")+'</div>'+(a.note?'<p class="muted small">'+esc(a.note)+'</p>':"");
 if(a.managed)return head+"<p class=\"muted\">"+$t("这是本机的 LocalRouter，由")+" <code>"+esc(c.localrouter.config)+"</code> "+$t("接入：Token 从文件里读，不用贴 Key。{0}。连不上时这次会改用别的连接，并提示一句。",esc(a.key_source))+"</p>"+(a.model?f("model",$t("默认模型"),"disabled"):"")+"<div class=\"inline\">"+button($t("测试"),"api-test",'data-api="'+esc(a.id)+'"',"primary sm")+testLine(a.id,test)+"</div>";
 const key=a.auth==="none"?"<p class=\"muted\">"+$t("本机服务，不需要 Key；确认地址对、服务开着就能用。")+"</p>":
  '<label class="key-field">API Key <small>'+esc(a.has_key?(a.key_source==="本机配置"?$t("已保存，不会回传；贴新的就替换"):$t("正在用")+a.key_source):$t("贴进来，自动保存"))+'</small>'+
  '<input type="password" autocomplete="new-password" data-cfg-api="'+esc(a.id)+'" data-key="api_key" placeholder="'+(a.has_key?"••••••••":"sk-…")+'"/></label>';
 return head+key+"<div class=\"inline\">"+button((models.length?$t("重新读取"):$t("测试并读取"))+$t("模型列表"),"api-test",'data-api="'+esc(a.id)+'"',"primary sm")+testLine(a.id,test)+"<span class=\"grow\"></span>"+(a.has_key&&a.key_source==="本机配置"?button($t("清除 Key"),"cfg-clear-key",'data-api="'+esc(a.id)+'"',"ghost xs"):"")+"</div>"+f("model",$t("默认模型")+" <small>"+$t("选这个连接时默认用它")+"</small>",'data-suggest="models-'+esc(a.id)+'"')+(models.length?"<div class=\"field-label\">"+$t("可用的模型 ·")+" "+models.length+" <small>"+$t("点一个设为默认")+"</small></div><div class=\"model-chips\">"+models.map(m=>'<button class="chip'+(m===a.model?" on":"")+'" data-action="api-use-model" data-api="'+esc(a.id)+'" data-model="'+esc(m)+'">'+esc(m)+'</button>').join("")+"</div>":"")+"<datalist id=\"models-"+esc(a.id)+"\">"+models.map(m=>'<option value="'+esc(m)+'">').join("")+"</datalist><details class=\"api-more\""+(a.preset==="custom"?" open":"")+"><summary>"+$t("地址和高级设置")+"</summary>"+(a.preset==="custom"?f("label",$t("名字")):"")+f("base_url","Base URL",'placeholder="https://…/v1"')+"<div class=\"three\"><label>"+$t("Key 怎么传")+"<select data-cfg-api=\""+esc(a.id)+"\" data-key=\"auth\">"+opt(a.auth,[["bearer",$t("Bearer（标准）")],["header",$t("放在请求头里")],["none",$t("不需要 Key")]])+"</select></label>"+f("auth_header",$t("请求头名字")+" <small>"+$t("如 api-key")+"</small>",a.auth==="header"?"":"disabled")+f("key_env",$t("从环境变量读 Key"),"placeholder=\""+$t("例如 OPENAI_API_KEY")+"\"")+"</div><div class=\"two\">"+f("chat_path",$t("对话接口路径"),'placeholder="chat/completions"')+f("models_path",$t("模型列表路径")+" <small>"+$t("没有就留空")+"</small>",'placeholder="models"')+"</div><label>"+$t("思考强度怎么传")+" <small>"+$t("模型菜单里调的「思考强度」按这个方式发给服务")+"</small><select data-cfg-api=\""+esc(a.id)+"\" data-key=\"effort_style\">"+opt(a.effort_style||"standard",Object.entries(c.effort_styles||{}))+"</select></label><div class=\"two\"><label>"+$t("请求头")+" <small>"+$t("JSON；{session} 会换成会话 id")+"</small><textarea rows=\"2\" data-cfg-api=\""+esc(a.id)+"\" data-key=\"headers\">"+esc(JSON.stringify(a.headers||{}))+"</textarea></label><label>"+$t("附加参数")+" <small>"+$t("JSON，合进每次请求")+"</small><textarea rows=\"2\" data-cfg-api=\""+esc(a.id)+"\" data-key=\"extra_body\">"+esc(JSON.stringify(a.extra_body||{}))+"</textarea></label></div>"+(a.preset==="custom"?'<div class="inline">'+button($t("删除这个连接"),"api-delete",'data-api="'+esc(a.id)+'"',"ghost xs")+'</div>':"")+"</details>";
}
function testLine(id,test){return '<span class="test-result'+(test&&!test.ok?" bad":"")+'" id="cfg-test-'+esc(id)+'">'+esc(test?.text||"")+'</span>';}
export function settingsTestResult(evt){
 const box=(evt.api&&el("#cfg-test-"+CSS.escape(evt.api)))||el("#cfg-test-result"),text=(evt.ok?"✓ ":$t("连接失败："))+evt.message;
 if(evt.api)Settings.tests[evt.api]={text,ok:evt.ok};
 if(box){box.textContent=text;box.classList.toggle("bad",!evt.ok);}toast(text,evt.ok?"info":"error");
 // A model list just read: show it, and offer it when picking a model.
 if(evt.ok&&evt.models?.length)setTimeout(()=>all(".panel-settings").forEach(n=>{const pg=n.querySelector(".settings")?.dataset.page;if(pg==="apis"||pg==="agents"){Settings.openApi=evt.api;renderSettings(n,pg);}}),300);
}
export async function settingsAction(kind,a){
 const node=a.closest(".panel"),page=()=>node.querySelector(".settings").dataset.page,again=()=>renderSettings(node,page());
 switch(kind){
 case "settings-page":return renderSettings(node,a.dataset.page);
 case "cfg-save":return saveSettings(node);
 case "cfg-test":await saveSettings(node);el("#cfg-test-result").textContent=$t("正在读取模型列表…");return rpc("test_api",{agent:a.dataset.agent});
 case "api-pick":Settings.openApi=a.dataset.api;return again();
 case "api-new":{const taken=new Set((S.config.apis||[]).map(x=>x.id));let i=1;while(taken.has("custom-"+i))i++;const id="custom-"+i;
  S.config=await rpc("settings_save",{config:{apis:{[id]:{preset:"custom",label:$t("自定义连接")+" "+i}}}});Settings.openApi=id;return again();}
 case "api-test":{await saveSettings(node,true);const box=el("#cfg-test-"+CSS.escape(a.dataset.api));if(box){box.textContent=$t("正在连接…");box.classList.remove("bad");}return rpc("test_api",{api:a.dataset.api});}
 case "api-use-model":{S.config=await rpc("settings_save",{config:{apis:{[a.dataset.api]:{model:a.dataset.model}}}});Settings.openApi=a.dataset.api;toast($t("默认模型改成了")+" "+a.dataset.model);return again();}
 case "api-delete":{const src=(S.config.apis||[]).find(x=>x.id===a.dataset.api),users=Object.values(S.config.agents||{}).filter(x=>x.api===a.dataset.api).map(x=>x.title);
  if(users.length)return toast(users.join("、")+$t("正在用这个连接，先给它们换一个"),"error");
  if(!await ask($t("它的 Key 也会从本机删掉。"),{title:$t("删除连接「{0}」？",src.label),danger:true,ok:$t("删除")}))return;
  S.config=await rpc("settings_save",{config:{apis:{[a.dataset.api]:null}}});return again();}
 case "cfg-clear-key":if(!await ask($t("环境变量里的不受影响。"),{title:$t("清除本机保存的这个 Key？"),danger:true,ok:$t("清除")}))return;await rpc("settings_save",{config:{apis:{[a.dataset.api]:{clear_key:true}}}});return again();
 case "agent-save":{
  const n=a.dataset.name,q=s=>node.querySelector(s);
  await rpc("agent_save",{name:n,history:Number(q('[data-agent-history="'+n+'"]').value),blocks:q('[data-agent-blocks="'+n+'"]').checked,
   tools:all('[data-agent-tool="'+n+'"]',node).filter(i=>i.checked).map(i=>i.value),policy:q('[data-agent-policy="'+n+'"]').value});
  await saveSettings(node);return toast($t("已存进学习库的 agents/{0}.md",n));
 }
 case "agent-history":return skillHistory("agent:"+a.dataset.name);
 case "agent-revise":return rpc("skill_propose",{slug:"agent:"+a.dataset.name,why:$t("我自己改")});
 case "agent-reset":if(!await ask($t("改写过的版本留在学习库的历史里。"),{title:$t("删掉你改写的规则，恢复成默认的？"),ok:$t("恢复默认")}))return;await rpc("agent_reset",{name:a.dataset.name});return again();
 case "runner-add":{const ext=node.querySelector("[data-runner-new]").value.trim(),cmd=node.querySelector("[data-runner-new-cmd]").value.trim();if(!ext||!cmd)return;
  S.config=await rpc("settings_save",{config:{runners:{...S.config.runners,[ext.startsWith(".")?ext:"."+ext]:cmd}}});return again();}
 case "env-create":{const n=node.querySelector("[data-env-new]").value.trim();if(!n)return;await rpc("env_save",{name:n,text:"ipykernel\nnumpy\nmatplotlib\n"});Settings.env=n;return again();}
 case "env-save":await rpc("env_save",{name:Settings.env,text:node.querySelector("[data-env-text]").value});toast($t("环境定义已保存，下次运行时环境会跟着改"));return again();
 case "env-install":{const input=node.querySelector("[data-env-install]"),pkgs=input.value.split(/\s+/).filter(Boolean);if(!pkgs.length)return;await rpc("env_install",{name:Settings.env,packages:pkgs});input.value="";return toast($t("正在安装 {0}…",pkgs.join("、")));}
 case "update-check":S.update=await rpc("update_check");return again();
 case "update-download":S.update=await rpc("update_download");return again();
 case "update-cancel":return rpc("update_cancel");
 case "update-apply":{
  const u=S.update;
  if(u.how!=="macos"&&!await ask($t("Lattice 会先保存你写的东西再关闭，换上新版本后自动重新打开；正在进行的回答和运行会停下。"),{title:$t("重启并更新到 {0}？","v"+u.latest.version),ok:$t("重启并更新")}))return;
  const r=await rpc("update_apply");
  if(!r.closing)toast($t("安装盘已经打开：退出 Lattice 后，把里面的 Lattice 拖进「应用程序」替换旧的。"));
  return;
 }
 case "rules-save":await rpc("rules_save",{text:node.querySelector("[data-rules]").value});return toast($t("规矩已保存，所有 AI 下一轮起照这个来"));
 case "rules-reset":{if(!await ask($t("现在的版本留在学习库的历史里。"),{title:$t("把 AGENTS.md 恢复成默认的？"),ok:$t("恢复默认")}))return;const r=await rpc("rules");await rpc("rules_save",{text:r.shipped});return again();}
 }
 return null;
}
const ZOOM_KINDS=[["chat:tutor",$t("主会话")],["chat:flash",$t("快答")],["chat:coach",$t("练习教练")],["file",$t("文件")],["home",$t("开始")],["map",$t("知识图")],["journal",$t("学习轨迹")],["review",$t("回顾")],["library",$t("卡片库")],["memory",$t("记忆")],["noteinfo",$t("大纲与链接")],["skills",$t("技能商城")],["settings",$t("设置")]];
export function settingsChange(t){
 if(t.dataset.readUnlimited!==undefined){S.ui.read_width=t.checked?"none":42;applyUi();saveUi();renderSettings(t.closest(".panel"),"look");return true;}
 if(t.dataset.uiRange){S.ui[t.dataset.uiRange]=Number(t.value);applyUi();saveUi();return true;}
 if(t.dataset.zoomKind){const v=Math.max(60,Math.min(250,Number(t.value)||100))/100;S.ui.zoom={...(S.ui.zoom||{}),[t.dataset.zoomKind]:v};applyUi();saveUi();return true;}
 if(t.dataset.ui){const k=t.dataset.ui;S.ui[k]=t.type==="checkbox"?t.checked:t.type==="number"?Number(t.value):t.value;applyUi();saveUi();if(k==="activity_plus")renderActivity();if(k==="language")toast($t("重启 Lattice 后换成这种语言"));
  if(k==="thinking")Object.keys(Chat).forEach(x=>{Chat[x].thoughts={};Chat[x].liveOpen=null;renderChat(x);});return true;}
 if(t.dataset.sideWidth!==undefined){setSideWidth(t.value);renderSide();return true;}
 if(t.dataset.envPick!==undefined){Settings.env=t.value;renderSettings(t.closest(".panel"),"run");return true;}
 if(t.dataset.cfgAgent&&t.dataset.key==="api"){const api=S.config.apis.find(x=>x.id===t.value);const m=t.closest(".agent-edit").querySelector('[data-key="model"]');if(api?.default_model&&m)m.value=api.default_model;}
 return settingsAutosave(t,true);
}
