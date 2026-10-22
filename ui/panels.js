"use strict";
/* The learner's other panels: the start page, the knowledge map, the journal, reviews, the card library, memory and settings. */
/* ---- the knowledge map ---------------------------------------------------------------------------------- */
const MapState={};
panelType("map",{side:"mine",host:false,icon:"network",title:p=>p.topic?"知识图 · "+topicTitle(p.topic):"知识图",
 mount(p,node,pid){
  node.innerHTML='<div class="map"><div class="map-bar"><select data-map-topic="'+pid+'"></select><span class="map-stats muted"></span><span class="grow"></span>'+
   iconButton("refresh","map-relayout","重新排布",'data-pid="'+pid+'"')+'</div><div class="map-body"><div class="map-canvas"></div><aside class="map-route"></aside></div></div>';
  loadMap(pid);
 },
 shown(p,node){const c=node.querySelector(".map-canvas"),cy=c?.__cy;if(cy&&!cy.destroyed()){cy.resize();cy.fit(undefined,20);}else if(c&&c.clientWidth&&!c.firstChild)loadMap(node.dataset.pid);},
 screen(p){return {view:"知识图",topic:p.topic||null};}});
async function loadMap(pid){
 const p=Dock.panels[pid],node=Dock.els[pid];if(!node)return;
 const sel=node.querySelector("[data-map-topic]");
 sel.innerHTML='<option value="">整张图</option>'+(S.data.topics||[]).map(t=>'<option value="'+esc(t.id)+'"'+(p.topic===t.id?" selected":"")+'>'+esc((t.parent?"↳ ":"")+t.title)+'</option>').join("");
 const g=await rpc("graph",{topic:p.topic||null});
 MapState[pid]=g;
 node.querySelector(".map-stats").textContent=g.nodes.length+" 个节点 · "+g.edges.length+" 条关系";
 const canvas=node.querySelector(".map-canvas");
 if(!g.nodes.length){canvas.innerHTML=emptyState("map","图还是空的","和主会话聊着聊着，它会把讲过的东西存成卡片、连成关系，并给每个主题定一条主干路线。");node.querySelector(".map-route").innerHTML="";return;}
 canvas.innerHTML="";
 if(!canvas.clientWidth)return;  // not on screen yet; drawn when the panel is shown
 mountGraph(canvas,g,{topic:p.topic});
 const route=p.topic?g.routes[p.topic]||[]:[],docs=new Map((S.data.docs||[]).map(d=>[d.id,d]));
 node.querySelector(".map-route").innerHTML=p.topic?'<h4>主干路线</h4>'+(route.length?'<ol>'+route.map(s=>'<li>'+(s.ref&&docs.get(s.ref)?'<a data-action="open-doc" data-id="'+esc(s.ref)+'">'+esc(s.title)+'</a>':esc(s.title))+(s.why?'<small>'+esc(s.why)+'</small>':"")+'</li>').join("")+'</ol>':'<p class="muted">还没有路线。</p>')+
  button(svg("document",12)+" 打开主题","open-doc",'data-id="'+esc(p.topic)+'"',"ghost xs"):'<h4>图例</h4><p class="legend">⬢ 主题 · ▢ 知识卡（边框色＝理解阶段）· ● 笔记 · ◆ 课程 · ■ 实验笔记和文件 · ▲ 薄弱点</p><p class="muted">选一个主题，就能看到它的主干路线和挂着的岔路。</p>';
}
function mapsChanged(){clearTimeout(MapState.timer);MapState.timer=setTimeout(()=>Object.keys(Dock.panels).filter(pid=>Dock.panels[pid].type==="map").forEach(loadMap),800);}

/* ---- the journal ------------------------------------------------------------------------------------------- */
const JOURNAL_GROUPS={"":"全部",asked:"提问与作答",ran:"运行",wrote:"写作",viewed:"查看",reviewed:"回顾",judged:"AI 判断与讲解",detour:"岔路与主干",insight:"薄弱点",searched:"联网",action:"AI 动作"};
const GROUP_TYPES={asked:["asked","answered"],judged:["judged","explained"],detour:["detour","bridged"],reviewed:["reviewed","staged"],action:["action","undo","installed","organized"]};
panelType("journal",{side:"mine",icon:"history",title:()=>"学习轨迹",
 mount(p,node,pid){node.innerHTML='<div class="journal"><div class="map-bar"><select data-journal-type="'+pid+'">'+Object.entries(JOURNAL_GROUPS).map(([k,v])=>'<option value="'+k+'"'+((p.group||"")===k?" selected":"")+'>'+esc(v)+'</option>').join("")+'</select>'+
  '<select data-journal-days="'+pid+'">'+[[1,"今天"],[7,"近 7 天"],[30,"近 30 天"],[0,"全部"]].map(([d,t])=>'<option value="'+d+'"'+((p.days??7)==d?" selected":"")+'>'+t+'</option>').join("")+'</select></div><div class="journal-list" data-keep-scroll></div></div>';loadJournal(pid);},
 screen(p){return {view:"学习轨迹",filter:p.group||"all"};}});
async function loadJournal(pid){
 const p=Dock.panels[pid],node=Dock.els[pid];if(!node)return;
 const days=p.days??7,group=p.group||"";
 const types=group?GROUP_TYPES[group]||[group]:null;
 const since=days?new Date(Date.now()-(days===1?(Date.now()-new Date().setHours(0,0,0,0)):days*864e5)).toISOString():null;
 const rows=await rpc("journal",{types,since,limit:400});
 const byDay={};rows.forEach(r=>(byDay[r.at.slice(0,10)]=byDay[r.at.slice(0,10)]||[]).push(r));
 node.querySelector(".journal-list").innerHTML=Object.entries(byDay).map(([day,list])=>'<h5>'+esc(new Date(day).toLocaleDateString("zh-CN",{month:"long",day:"numeric",weekday:"short"}))+' · '+list.length+' 条</h5>'+list.map(journalRow).join("")).join("")||emptyState("history","这段时间没有记录","提问、作答、运行、写作和 AI 的判断都会记在这里。");
}
function journalsChanged(){clearTimeout(MapState.jtimer);MapState.jtimer=setTimeout(()=>Object.keys(Dock.panels).filter(pid=>Dock.panels[pid].type==="journal").forEach(loadJournal),1500);}

/* ---- reviewing due cards ------------------------------------------------------------------------------------ */
panelType("review",{side:"mine",icon:"refresh",title:()=>"回顾",
 mount(p,node){node.innerHTML='<div class="review"><div class="review-body"></div></div>';loadReview(node);},
 screen(){return {view:"回顾到期的卡"};}});
async function loadReview(node){
 const due=await rpc("due");
 const body=node.querySelector(".review-body");
 if(!due.length){body.innerHTML=emptyState("check","现在没有到期的卡","接触过的卡会在保存一天后到期；每次自评以后，间隔会按你记得的程度拉长或缩短。");return;}
 body.innerHTML='<div class="lblock"></div>';
 await BLOCKS.cards({cards:due.map(c=>c.id),review:true},body.firstElementChild,{});
}

/* ---- the card library: every card, to browse and pick from ------------------------------------------------------ */
panelType("library",{side:"mine",host:false,icon:"card",title:()=>"卡片库",
 mount(p,node,pid){node.innerHTML='<div class="library"><div class="lib-bar"></div><div class="lib-list" data-keep-scroll></div></div>';renderLibrary(pid);},
 screen(p){return {view:"卡片库",filter:{query:p.query||"",stage:p.stage||"",topic:p.topic??"全部",sort:p.sort||"due",due_only:!!p.due_only}};}});
const LIB_SORT=[["due","先到期的"],["updated","最近改过的"],["stage","理解阶段"],["title","标题"]];
// When a card comes up next: the backend's rule, a day after it was saved if never reviewed; cards still to explore are not scheduled.
function cardDueAt(c){return c.stage==="suggested"?Infinity:Date.parse(c.due||"")||Date.parse(c.created)+864e5;}
function dueText(c){
 if(c.stage==="suggested")return "不排期";
 if(c.due_now)return "到期";
 const days=Math.round((new Date(cardDueAt(c)).setHours(0,0,0,0)-new Date().setHours(0,0,0,0))/864e5);
 return days<=0?"今天":days===1?"明天":days+" 天后";
}
function renderLibrary(pid,full=true){
 const p=Dock.panels[pid],node=Dock.els[pid]?.querySelector(".library");if(!p||!node)return;
 if(full)node.querySelector(".lib-bar").innerHTML='<input class="side-input" data-lib-query="'+pid+'" placeholder="搜标题、自测题和正文…" value="'+esc(p.query||"")+'"/>'+
  '<div class="lib-filters"><select data-lib-topic="'+pid+'">'+opt(p.topic??"*",[["*","全部主题"],["","不属于主题的"],...(S.data.topics||[]).map(t=>[t.id,t.title])])+'</select>'+
  '<select data-lib-sort="'+pid+'">'+opt(p.sort||"due",LIB_SORT)+'</select>'+
  '<label class="check inline-check"><input type="checkbox" data-lib-due="'+pid+'"'+(p.due_only?" checked":"")+'/> 只看到期</label>'+iconButton("plus","new-card","新知识卡")+'</div>'+
  '<div class="stage-chips">'+[["","全部"],...Object.entries(stageName)].map(([v,t])=>'<button class="'+((p.stage||"")===v?"on":"")+'" data-action="lib-stage" data-pid="'+pid+'" data-stage="'+v+'">'+esc(t)+'</button>').join("")+'</div>';
 const q=(p.query||"").trim().toLowerCase(),order=Object.keys(stageName);
 const cards=(S.data.cards||[]).filter(c=>(!p.stage||c.stage===p.stage)&&(p.topic==null||(c.topic||"")===p.topic)&&(!p.due_only||c.due_now)&&
  (!q||(c.title+" "+(c.question||"")+" "+(c.excerpt||"")).toLowerCase().includes(q)));
 const sort={due:(a,b)=>cardDueAt(a)-cardDueAt(b),updated:(a,b)=>String(b.updated).localeCompare(String(a.updated)),
  stage:(a,b)=>order.indexOf(a.stage)-order.indexOf(b.stage)||a.title.localeCompare(b.title,"zh"),title:(a,b)=>a.title.localeCompare(b.title,"zh")}[p.sort||"due"];
 cards.sort(sort);
 const every=S.data.cards||[];
 node.querySelector(".lib-list").innerHTML='<p class="lib-count muted small">'+cards.length+' 张'+(cards.length!==every.length?"（共 "+every.length+" 张）":"")+(S.data.due?' · '+S.data.due+' 张到期':"")+'</p>'+
  (cards.map(c=>'<button class="lib-card" data-action="open-file" data-path="'+esc(c.path)+'">'+
   '<span class="lib-top"><span class="stage stage-'+esc(c.stage)+'">'+esc(stageName[c.stage]||c.stage)+'</span><small class="'+(c.due_now?"due":"")+'">'+esc(dueText(c))+'</small></span>'+
   '<b>'+esc(c.title)+'</b>'+((c.question||c.excerpt)?'<span class="lib-text">'+esc(c.question||c.excerpt)+'</span>':"")+
   '<small class="lib-foot">'+esc(c.topic?topicTitle(c.topic):"不属于主题")+(c.reviews?" · 回顾过 "+c.reviews+" 次":"")+'</small></button>').join("")||
   emptyState("card",every.length?"没有符合的卡片":"还没有知识卡",every.length?"换个筛选试试。":"和主会话学着学着，它会把讲清楚的知识点存成卡；也可以在左栏点「＋」自己记一张。"));
}
function libraryInput(t){
 const pid=t.dataset.libQuery||t.dataset.libTopic||t.dataset.libSort||t.dataset.libDue,p=Dock.panels[pid];if(!p)return false;
 if(t.dataset.libQuery){p.query=t.value;renderLibrary(pid,false);}
 else if(t.dataset.libTopic){p.topic=t.value==="*"?null:t.value;renderLibrary(pid,false);}
 else if(t.dataset.libSort){p.sort=t.value;renderLibrary(pid,false);}
 else{p.due_only=t.checked;renderLibrary(pid,false);}
 saveLayout();return true;
}

/* ---- memory: how the cards are holding up, from their schedule and the learner's own ratings --------------------- */
panelType("memory",{side:"mine",icon:"calendar",title:()=>"记忆",
 mount(p,node,pid){node.innerHTML='<div class="memory" data-keep-scroll></div>';loadMemory(pid);},
 screen(){return {view:"记忆：各理解阶段有多少卡、接下来两周每天到期多少、最近 30 天的回顾和老是记不住的卡"};}});
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
 const label=(d,i)=>i===0?"今天":i===1?"明天":(d.getMonth()+1)+"/"+d.getDate();
 const RATE={again:["忘了","var(--red)"],hard:["费劲","var(--amber)"],good:["记得","var(--accent)"]};
 const past=Array.from({length:30},(_,i)=>{const d=new Date(+today-(29-i)*864e5),k=dayKey(d),rs=reviews.filter(r=>dayKey(r.at)===k);
  return {label:i%5===4||i===29?(d.getMonth()+1)+"/"+d.getDate():"",tip:(d.getMonth()+1)+"/"+d.getDate()+"："+rs.length+" 次",parts:Object.entries(RATE).map(([r,[,color]])=>({n:rs.filter(x=>x.data.rating===r).length,color}))};});
 // Cards forgotten most often lately: again counts fully, hard by half.
 const weight={};reviews.forEach(r=>{const id=r.refs[0];if(id&&r.data.rating!=="good")weight[id]=(weight[id]||0)+(r.data.rating==="again"?1:.5);});
 const hard=Object.entries(weight).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([id,w])=>({card:cards.find(c=>c.id===id),w})).filter(x=>x.card);
 const total=cards.length||1;
 node.innerHTML='<div class="mem-stats"><div><b>'+cards.length+'</b><small>张卡</small></div><div><b>'+(S.data.due||0)+'</b><small>现在到期</small></div><div><b>'+doneToday+'</b><small>今天回顾</small></div><div><b>'+reviews.length+'</b><small>近 30 天回顾</small></div></div>'+
  (S.data.due?'<div class="inline">'+button(svg("refresh",13)+" 回顾到期的 "+S.data.due+" 张","open-review","","primary sm")+'</div>':"")+
  '<h4>理解阶段</h4><div class="stage-bar">'+order.map(k=>count(k)?'<i style="flex:'+count(k)/total+';background:'+stageColor[k]+'" title="'+esc(stageName[k])+' '+count(k)+'"></i>':"").join("")+'</div>'+
  '<div class="stage-legend">'+order.map(k=>'<span><i class="stage-dot" style="background:'+stageColor[k]+'"></i>'+esc(stageName[k])+' '+count(k)+'</span>').join("")+'</div>'+
  '<h4>接下来两周到期</h4>'+(ahead.some(x=>x.n)?bars(ahead.map((x,i)=>({label:label(x.day,i),tip:label(x.day,i)+"："+x.n+" 张",parts:[{n:x.n,color:"var(--ai)"}]}))):'<p class="muted">两周内没有要回顾的卡。还在「待探索」的卡不排期，标成「接触过」以后才开始排。</p>')+
  '<h4>最近 30 天的回顾</h4>'+(reviews.length?bars(past,64)+'<div class="stage-legend">'+Object.values(RATE).map(([t,c])=>'<span><i class="stage-dot" style="background:'+c+'"></i>'+t+'</span>').join("")+'</div>':'<p class="muted">还没有回顾过。卡片到期后在「回顾」里自评，这里就会有记录。</p>')+
  '<h4>最近老是记不住的</h4>'+(hard.length?hard.map(x=>sideRow("card",x.card.title,'data-action="open-file" data-path="'+esc(x.card.path)+'"',esc(stageName[x.card.stage]||"")+" · "+dueText(x.card))).join(""):'<p class="muted">没有。自评「忘了」或「费劲」的卡会排在这里。</p>');
}
function cardViewsChanged(){
 clearTimeout(MapState.ctimer);
 MapState.ctimer=setTimeout(()=>Object.keys(Dock.panels).forEach(pid=>{const t=Dock.panels[pid].type;if(t==="library")renderLibrary(pid);else if(t==="memory")safe(()=>loadMemory(pid));}),400);
}

/* ---- the start page: where I am, what is waiting, what changed ---------------------------------------- */
panelType("home",{side:"mine",icon:"home",title:()=>"开始",mount(p,node){node.innerHTML='<div class="home" data-keep-scroll></div>';renderHome(node);},
 screen(){return {view:"开始"};}});
async function renderHome(node){
 const box=node.querySelector(".home");if(!box)return;
 const t=(S.data.topics||[]).find(x=>x.id===S.data.active_topic),docs=new Map((S.data.docs||[]).map(d=>[d.id,d]));
 const recent=await safe(()=>rpc("journal",{types:["wrote","ran","viewed"],limit:60}))||[];
 const files=[...new Set(recent.flatMap(e=>(e.data.files||[]).map(f=>f.file).concat(e.data.file?[e.data.file]:[])))].filter(x=>!x.startsWith(".lattice")).slice(0,10);
 const lately=await safe(()=>rpc("journal",{limit:10}))||[];
 const active=(S.data.practices||[]).filter(x=>x.state==="active");
 box.innerHTML='<section class="home-now">'+(t?'<div class="overline">正在学</div><h2><a data-action="open-doc" data-id="'+esc(t.id)+'">'+esc(t.title)+'</a></h2><p class="muted">'+esc(t.question||"")+'</p>'+
   ((t.route||[]).length?'<ol class="home-route">'+t.route.slice(0,9).map(s=>'<li>'+(s.ref&&docs.get(s.ref)?'<a data-action="open-doc" data-id="'+esc(s.ref)+'">'+esc(s.title)+'</a>':esc(s.title))+'</li>').join("")+'</ol>':'<p class="muted">还没有主干路线。</p>')
   :'<div class="overline">默认对话</div><h2>想到什么，直接和主会话说。</h2><p class="muted">值得长期深入的内容，主会话会建成主题，并定一条主干路线；你在左栏「主题」里能看到它们。</p>')+'</section>'+
  '<div class="home-grid">'+
  '<section class="home-box"><h4>'+svg("refresh",14)+' 回顾</h4>'+(S.data.due?'<p>'+S.data.due+' 张卡到期。</p>'+button("开始回顾","open-review","","primary sm"):'<p class="muted">现在没有到期的卡。</p>')+'</section>'+
  '<section class="home-box"><h4>'+svg("code",14)+' 进行中的练习</h4>'+(active.map(x=>'<a data-action="open-practice" data-id="'+esc(x.id)+'">'+esc(x.title)+'</a>').join("")||'<p class="muted">没有。</p>')+'</section>'+
  '<section class="home-box"><h4>'+svg("file",14)+' 最近碰过的文件</h4>'+(files.map(f=>'<a data-action="open-file" data-path="'+esc(f)+'">'+svg(fileIcon(f),12)+' '+esc(baseName(f))+'</a>').join("")||'<p class="muted">还没有。</p>')+'</section>'+
  '<section class="home-box wide"><h4>'+svg("history",14)+' 刚才发生了什么</h4>'+(lately.map(journalRow).join("")||'<p class="muted">还没有记录。</p>')+button("打开学习轨迹","open-journal","","ghost xs")+'</section></div>';
}
function homesChanged(){clearTimeout(MapState.htimer);MapState.htimer=setTimeout(()=>Object.keys(Dock.panels).filter(pid=>Dock.panels[pid].type==="home").forEach(pid=>renderHome(Dock.els[pid])),1200);}

/* ---- settings: everything is changeable here ------------------------------------------------------------- */
const SETTINGS_PAGES=[["look","外观与交互","sun"],["layout","工作区与左栏","layout"],["agents","四个 AI","bot"],["apis","模型连接","link"],["web","联网","search"],
 ["run","运行与环境","terminal"],["vault","学习库","folder"],["rules","学习库的规矩","shield"],["keys","快捷键","cmd"]];
panelType("settings",{side:"mine",icon:"sliders",title:()=>"设置",
 mount(p,node,pid){node.innerHTML='<div class="settings-shell"><nav class="settings-nav"></nav><div class="settings" data-keep-scroll></div></div>';renderSettings(node,p.page||"look");},
 screen(p){return {view:"设置",page:p.page||"look"};}});
async function renderSettings(node,page){
 const p=Dock.panels[node.dataset.pid];if(p)p.page=page;
 node.querySelector(".settings-nav").innerHTML=SETTINGS_PAGES.map(([k,t,i])=>'<button class="'+(k===page?"on":"")+'" data-action="settings-page" data-page="'+k+'" title="'+esc(t)+'">'+svg(i,14)+'<span>'+esc(t)+'</span></button>').join("");
 const box=node.querySelector(".settings");box.dataset.page=page;
 box.innerHTML='<div class="loading">…</div>';
 S.config=await rpc("settings");
 box.innerHTML=await SETTINGS_RENDER[page](S.config,node);
}
const opt=(value,list)=>list.map(([v,t])=>'<option value="'+esc(v)+'"'+(String(value)===String(v)?" selected":"")+'>'+esc(t)+'</option>').join("");
const SETTINGS_RENDER={
 look(c){
  const u=S.ui;
  return '<h3>外观</h3><div class="three"><label>主题<select data-ui="theme">'+opt(u.theme,[["dark","深色"],["light","浅色"]])+'</select></label>'+
   '<label>正文字号<input type="number" step="0.5" min="11" max="24" data-ui="font_size" value="'+esc(u.font_size)+'"/></label>'+
   '<label>代码字号<input type="number" step="0.5" min="10" max="24" data-ui="code_font_size" value="'+esc(u.code_font_size)+'"/></label></div>'+
   '<div class="three"><label>行距<input type="number" step="0.05" min="1.3" max="2.4" data-ui="line_height" value="'+esc(u.line_height)+'"/></label>'+
   '<label>密度<select data-ui="density">'+opt(u.density,[["comfortable","舒适"],["compact","紧凑"]])+'</select></label></div>'+
   '<div class="field-label">阅读宽度 <small>对话和文档正文一行最多多少字；某个窗口还能在它的 ⋯ 菜单里单独调</small></div>'+
   '<div class="range-row"><input type="range" min="20" max="120" step="1" data-ui-range="read_width" value="'+(readChars(u.read_width)||42)+'"'+(readChars(u.read_width)?"":" disabled")+'/>'+
   '<b data-range-out="read_width">'+(readChars(u.read_width)?readChars(u.read_width)+" 字":"不限")+'</b>'+
   '<label class="check inline-check"><input type="checkbox" data-read-unlimited'+(readChars(u.read_width)?"":" checked")+'/> 不限</label></div>'+
   '<h3>每种窗口的大小</h3><p class="muted">新开的窗口按这里的比例显示，文字、代码、间距和图标一起缩放。某一个窗口还可以单独调：鼠标放在它上面按 Ctrl + 滚轮，或者聚焦后按 Ctrl + = / Ctrl + - / Ctrl + 0，标签上右键也能调；单独调过的会在标签上显示百分比，跟着工作区一起记住。</p>'+
   '<div class="zoom-grid">'+ZOOM_KINDS.map(([k,t])=>'<label>'+esc(t)+'<span class="unit"><input type="number" step="5" min="60" max="250" data-zoom-kind="'+k+'" value="'+Math.round((Number(u.zoom?.[k])||1)*100)+'"/>%</span></label>').join("")+'</div>'+
   (Object.values(Dock.panels).some(p=>p.zoom)?'<div class="inline"><span class="muted">有 '+Object.values(Dock.panels).filter(p=>p.zoom).length+' 个窗口单独调过大小。</span>'+button("全部恢复成各自的默认","zoom-reset-all","","ghost sm")+'</div>':"")+
   '<label>模型的思考过程<select data-ui="thinking">'+opt(u.thinking||"collapsed",[["collapsed","折叠，只显示用时和一句摘要"],["open","展开"],["hidden","不显示"]])+'</select></label>'+
   '<h3>交互</h3><label>发送消息<select data-ui="send_key">'+opt(u.send_key,[["enter","Enter 发送，Shift + Enter 换行"],["ctrl","Ctrl + Enter 发送，Enter 换行"]])+'</select></label>'+
   '<label class="check"><input type="checkbox" data-ui="selection_popup"'+(u.selection_popup?" checked":"")+'/> 选中文字时出现「问快答 / 问主会话」</label>'+
   '<label class="check"><input type="checkbox" data-cfg="agent_auto_organize"'+(c.agent_auto_organize?" checked":"")+'/> 关掉随手写的记录或代码后，自动交给 AI 整理</label>'+
   '<label>停下多少秒后提交我的编辑<input type="number" min="5" max="3600" data-cfg="commit_idle" value="'+esc(c.commit_idle)+'"/></label>'+
   saveBar();
 },
 layout(){
  const list=spaceList(),b=(t,a,id,extra="")=>button(t,a,'data-space="'+esc(id)+'" '+extra,"ghost xs");
  return '<h3>工作区</h3><p class="muted">活动栏上的每个图标是一个工作区：一套窗口组合，左栏放它自己的列表。同一个对话、同一个文件可以同时出现在几个工作区里。'+
   '在工作区里拖动、分栏、浮出都会自动记住；「设为默认」以后，「恢复默认」就回到那时的样子。活动栏上的图标右键也能改，Ctrl + 1～9 切换。</p>'+
   '<div class="preset-list">'+list.map((sp,i)=>'<div class="preset'+(sp.hidden?" off":"")+'">'+svg(sp.icon||"layout",14)+' <b>'+esc(sp.name)+'</b>'+
    (sp.id===Dock.space?'<span class="chip on">当前</span>':"")+(sp.hidden?'<span class="chip">隐藏了</span>':"")+
    '<span class="muted small">'+esc((sp.side||[]).map(k=>SIDE_SECTIONS[k]?.title).filter(Boolean).join("、")||"左栏不放列表")+'</span><span class="grow"></span>'+
    (sp.hidden?b("显示","space-show",sp.id):sp.id===Dock.space?b("把现在的样子设为默认","space-keep",sp.id):b("切换","space",sp.id))+
    b("改","space-edit",sp.id)+b("恢复默认","space-reset",sp.id)+(i>0?iconButton("arrowup","space-move","往上挪",'data-space="'+esc(sp.id)+'" data-dir="-1"'):"")+
    (sp.hidden?"":b(sp.builtin?"隐藏":"删除","space-remove",sp.id))+'</div>').join("")+'</div>'+
   '<div class="inline">'+button(svg("plus",13)+" 新工作区","space-new","","primary sm")+'</div>'+
   '<h3>左栏</h3><p class="muted">每个工作区的左栏各自收起、展开：点它右上角的按钮、再点一次活动栏上这个工作区的图标，或者按 Ctrl + B。</p>'+
   '<label>左栏宽度<input type="number" min="180" max="560" data-side-width value="'+esc(S.ui.side.width)+'"/></label>';
 },
 async agents(c){
  const cards=[];
  for(const [name,a] of Object.entries(c.agents)){
   const d=await rpc("agent_definition",{name}),def=d.definition,apiOpts=c.apis.map(x=>[x.id,x.label+(x.has_key?"":" · 没有 Key")]);
   cards.push('<details class="agent-edit"'+(name==="tutor"?" open":"")+'><summary><b>'+esc(a.title)+'</b> <span class="muted">'+esc(a.label)+(d.overridden?" · 规则已改写":"")+'</span></summary>'+
    '<div class="three"><label>API 连接<select data-cfg-agent="'+name+'" data-key="api">'+opt(a.api,apiOpts)+'</select></label><label>模型<input data-cfg-agent="'+name+'" data-key="model" value="'+esc(a.model)+'"/></label>'+
    '<label>回复上限（含思考）<input type="number" min="256" max="64000" data-cfg-agent="'+name+'" data-key="max_tokens" value="'+esc(a.max_tokens)+'"/></label></div>'+
    '<div class="three"><label>Temperature <small>留空用全局</small><input type="number" step="0.05" min="0" max="2" data-cfg-agent="'+name+'" data-key="temperature" value="'+esc(a.temperature??"")+'"/></label>'+
    '<label>每轮带上多少条历史<input type="number" min="0" max="200" data-agent-history="'+name+'" value="'+esc(def.history)+'"/></label>'+
    '<label class="check"><input type="checkbox" data-agent-blocks="'+name+'"'+(def.blocks?" checked":"")+'/> 能用展示块</label></div>'+
    '<div class="field-label">能用的工具</div><div class="tool-grid">'+d.tools.map(t=>'<label class="check" title="'+esc(t.description)+'"><input type="checkbox" data-agent-tool="'+name+'" value="'+t.name+'"'+(def.tools.includes(t.name)?" checked":"")+'/> '+esc(t.name)+'</label>').join("")+'</div>'+
    '<label>规则 <small>它每一轮都读；改了存进学习库的 agents/'+name+'.md</small><textarea rows="14" data-agent-policy="'+name+'">'+esc(def.policy)+'</textarea></label>'+
    '<div class="inline">'+(d.overridden?button("恢复默认规则","agent-reset",'data-name="'+name+'"',"ghost sm"):"")+button("测试连接","cfg-test",'data-agent="'+name+'"',"ghost sm")+'</div></details>');
  }
  return '<h3>四个 AI</h3><p class="muted">工具、历史条数和规则改了会存进学习库的 agents/；所有 AI 都还会先读学习库的规矩（AGENTS.md）。</p>'+cards.join("")+'<div class="test-result" id="cfg-test-result"></div>'+saveBar();
 },
 apis(c){
  return '<h3>模型连接</h3><p class="muted">都是 OpenAI 兼容的 Chat Completions。每个连接各存一份 Key；Key 只保存在本机，界面拿不到它。</p>'+c.apis.map(a=>'<details class="api" open><summary><b>'+esc(a.label)+'</b><span class="muted">Key：'+esc(a.key_source)+'</span></summary>'+
   '<label>Base URL<input data-cfg-api="'+a.id+'" data-key="base_url" value="'+esc(a.base_url)+'" placeholder="https://…/v1"/></label>'+
   '<label>API Key <small>留空表示不改</small><input type="password" autocomplete="new-password" data-cfg-api="'+a.id+'" data-key="api_key" placeholder="'+(a.has_key?"已保存，不会回传":"sk-…")+'"/></label>'+
   '<div class="two"><label>请求头 <small>{session} 会换成会话 id</small><textarea rows="2" data-cfg-api="'+a.id+'" data-key="headers">'+esc(JSON.stringify(a.headers))+'</textarea></label>'+
   '<label>附加参数<textarea rows="2" data-cfg-api="'+a.id+'" data-key="extra_body">'+esc(JSON.stringify(a.extra_body))+'</textarea></label></div>'+
   button("清除本机 Key","cfg-clear-key",'data-api="'+a.id+'"',"ghost xs")+'</details>').join("")+
   '<div class="two"><label>超时（秒）<input type="number" data-cfg="timeout" value="'+esc(c.timeout)+'"/></label><label>全局 Temperature<input type="number" step="0.05" data-cfg="temperature" value="'+esc(c.temperature)+'"/></label></div>'+saveBar();
 },
 web(c){
  return '<h3>联网</h3><p class="muted">AI 有两个联网接口：搜索和读网页。什么时候查由它判断；来源列在回复下面，并记进轨迹。读网页不会访问本机和局域网地址。</p>'+
   '<label>搜索服务<select data-cfg-web="search">'+opt(c.web.search,Object.entries(c.web_backends))+'</select></label>'+
   '<label>SearXNG 地址<input data-cfg-web="searxng_url" value="'+esc(c.web.searxng_url)+'" placeholder="https://searx.example"/></label>'+
   '<div class="two"><label>Brave Key <small>'+(c.web.brave_key?"已保存":"未填")+'</small><input type="password" data-cfg-web="brave_key"/></label><label>Tavily Key <small>'+(c.web.tavily_key?"已保存":"未填")+'</small><input type="password" data-cfg-web="tavily_key"/></label></div>'+saveBar();
 },
 async run(c){
  const env=await rpc("env_info",{name:Settings.env||"default"}).catch(()=>null);
  const rows=Object.keys({...c.default_runners,...c.runners}).sort().map(ext=>'<div class="runner-row"><code>'+esc(ext)+'</code><input data-runner="'+esc(ext)+'" value="'+esc(c.runners[ext]??"")+'" placeholder="'+esc(c.default_runners[ext]||"")+'"/></div>').join("");
  return '<h3>运行</h3><label class="check"><input type="checkbox" data-cfg="agent_auto_run"'+(c.agent_auto_run?" checked":"")+'/> 允许 AI 自己运行代码和命令 <small>都在沙箱里：看不到家目录，不联网</small></label>'+
   '<label class="check"><input type="checkbox" data-cfg="auto_install"'+(c.auto_install?" checked":"")+'/> 运行时缺 Python 包就自动装进环境，再跑一次 <small>关掉以后，运行结果里会给一个「装上再运行」的按钮</small></label>'+
   '<div class="three"><label>实验笔记单格时限（秒）<input type="number" data-cfg="kernel_timeout" value="'+esc(c.kernel_timeout)+'"/></label><label>运行文件时限（秒）<input type="number" data-cfg="run_timeout" value="'+esc(c.run_timeout)+'"/></label><label>AI 命令时限（秒）<input type="number" data-cfg="shell_timeout" value="'+esc(c.shell_timeout)+'"/></label></div>'+
   '<div class="field-label">运行器 <small>每种扩展名用什么命令运行。留空用默认（灰字）；可用 {file} {dir} {stem} {out} {python}</small></div><div class="runners">'+rows+'</div>'+
   '<div class="inline"><input data-runner-new placeholder=".ext"/><input data-runner-new-cmd placeholder="程序 {file}"/>'+button("加一行","runner-add","","ghost xs")+'</div>'+
   '<h3>Python 环境</h3>'+(env?'<div class="inline"><select data-env-pick>'+opt(env.name,env.names.map(n=>[n,n]))+'</select><input data-env-new placeholder="新环境的名字"/>'+button("新建环境","env-create","","ghost xs")+'</div>'+
   '<p class="muted">'+(env.ready?"已建好":"第一次用时自动建好")+' · 定义在 '+esc(env.definition)+'。在某个目录里放一个内容是环境名的 .lattice-env 文件，那个目录下的文件就用这个环境。</p>'+
   '<label>这个环境里的包（一行一个，可以带版本）<textarea rows="6" data-env-text>'+esc(env.wanted.join("\n"))+'</textarea></label>'+
   '<div class="inline"><input data-env-install placeholder="现在就装：包名，空格分开"/>'+button("安装","env-install","","ghost sm")+'</div>'+
   (env.installed.length?'<details><summary class="muted">已经装了 '+env.installed.length+' 个包</summary><p class="small muted">'+env.installed.map(x=>esc(x.name+" "+x.version)).join("、")+'</p></details>':""):"")+
   '<h3>沙箱</h3><p class="'+(S.data.sandbox?.ok?"muted":"warn")+'">'+(S.data.sandbox?.ok?svg("shield",13)+" 沙箱可用（bubblewrap）。AI 的命令和运行都在里面：学习库可写，挂载的目录只读，看不到家目录的其余部分，不联网。":esc(S.data.sandbox?.why||""))+'</p>'+
   '<label>沙箱里额外可见的只读路径 <small>一行一个，比如装在家目录里的工具链</small><textarea rows="2" data-cfg="sandbox_paths">'+esc((c.sandbox_paths||[]).join("\n"))+'</textarea></label>'+saveBar();
 },
 vault(c){
  const projects=S.data.projects||[];
  return '<h3>学习库</h3><p class="muted">所有学习数据都是普通文件，放在 <code>'+esc(c.vault_path)+'</code>，它本身是一个 git 仓库，可以用任何编辑器直接改。</p>'+
   '<label>学习库的位置 <small>'+(c.env_vault?"现在由环境变量 LATTICE_VAULT 决定，这里的设置不生效":"重启 Lattice 后生效；留空就是 ~/Lattice")+'</small><input data-cfg="vault" value="'+esc(c.vault)+'" placeholder="~/Lattice"/></label>'+
   '<div class="inline">'+button(svg("folder",13)+" 在系统里打开","open-vault","","ghost sm")+button(svg("download",13)+" 导出整个学习库","export","","ghost sm")+button(svg("upload",13)+" 导入 Markdown 笔记","import-md","","ghost sm")+'</div>'+
   '<h3>挂载的目录</h3><p class="muted">你能读写，AI 只读。</p>'+projects.map(x=>'<div class="preset">'+svg("link",13)+' <b>'+esc(x.name)+'</b><span class="muted small">'+esc(x.path)+'</span><span class="grow"></span>'+button("取消挂载","project-remove",'data-id="'+esc(x.id)+'"',"ghost xs")+'</div>').join("")+
   button(svg("plus",13)+" 挂载一个目录","project-add","","ghost sm")+saveBar();
 },
 async rules(){
  const r=await rpc("rules");
  return '<h3>学习库的规矩</h3><p class="muted">学习库根目录的 AGENTS.md：目录约定、属性格式、谁能改什么。每个 AI 每一轮都先读它。</p><textarea rows="26" data-rules>'+esc(r.text)+'</textarea>'+
   '<div class="inline">'+button("恢复成默认的规矩","rules-reset","","ghost sm")+button("在编辑器里打开","open-file",'data-path="AGENTS.md"',"ghost sm")+'</div>'+saveBar();
 },
 keys(){
  const send=S.ui.send_key==="ctrl"?"Ctrl + Enter 发送，Enter 换行":"Enter 发送，Shift + Enter 换行";
  return '<h3>快捷键</h3><table class="keys">'+[["Ctrl + K","搜索或输入命令"],["Ctrl + N","写记录"],["Ctrl + S","保存"],["Ctrl + J","快答"],["Ctrl + W","关闭当前面板"],["Ctrl + B","展开或收起左栏"],["消息框",send],["Ctrl + Enter","在代码文件里：运行"],["Shift + Enter","在实验笔记里：运行当前格"],["Tab","在代码里缩进"],["Esc","关闭弹窗"]].map(([k,t])=>'<tr><td><kbd>'+esc(k)+'</kbd></td><td>'+esc(t)+'</td></tr>').join("")+'</table>'+
   '<p class="muted">发送键在「外观与交互」里改。</p>';
 },
};
const Settings={env:"default"};
function saveBar(){return '<div class="settings-save"><span class="save-state">'+svg("check",13)+' 改了就自动保存</span></div>';}
/* Every setting saves itself shortly after it changes; text fields wait until typing pauses. */
const Autosave={timers:{}};
function saveState(node,text,bad=false){const s=node?.querySelector(".save-state");if(s){s.innerHTML=svg(bad?"info":"check",13)+" "+esc(text);s.classList.toggle("bad",bad);}else if(bad)toast(text,"error");}
function autosave(node,key,fn,delay){
 clearTimeout(Autosave.timers[key]);saveState(node,"正在保存…");
 Autosave.timers[key]=setTimeout(async()=>{
  try{await fn();saveState(node,"已自动保存 · "+new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",second:"2-digit"}));}
  catch(e){saveState(node,"没有保存："+e.message,true);}
 },delay);
}
function settingsAutosave(t,changed){
 const node=t.closest?.(".panel-settings");if(!node)return false;
 const delay=changed?250:900;
 if(t.matches("[data-cfg],[data-cfg-agent],[data-cfg-api],[data-cfg-web],[data-runner]")){
  if(!changed&&t.type==="password")return true;
  autosave(node,"cfg",async()=>{
   const secret=all("input[type=password]",node).some(i=>i.value);
   S.config=await rpc("settings_save",{config:collectSettings(node)});
   Object.keys(Chat).forEach(updateComposer);
   if(secret)renderSettings(node,node.querySelector(".settings").dataset.page);
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
  if(i.dataset.key==="headers"||i.dataset.key==="extra_body"){try{a[i.dataset.key]=JSON.parse(i.value||"{}");}catch(_){throw new Error("「"+i.dataset.cfgApi+"」的 "+i.dataset.key+" 不是合法的 JSON");}}
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
async function saveSettings(node){
 S.config=await rpc("settings_save",{config:collectSettings(node)});
 toast("设置已保存");refreshChats();renderSettings(node,node.querySelector(".settings").dataset.page);
}
function settingsTestResult(evt){const box=el("#cfg-test-result");const text=(evt.ok?"✓ ":"连接失败：")+evt.message;if(box)box.textContent=text;toast(text,evt.ok?"info":"error");}
async function settingsAction(kind,a){
 const node=a.closest(".panel"),page=()=>node.querySelector(".settings").dataset.page,again=()=>renderSettings(node,page());
 switch(kind){
 case "settings-page":return renderSettings(node,a.dataset.page);
 case "cfg-save":return saveSettings(node);
 case "cfg-test":await saveSettings(node);el("#cfg-test-result").textContent="正在读取模型列表…";return rpc("test_api",{agent:a.dataset.agent});
 case "cfg-clear-key":if(!confirm("清除本机保存的这个 Key？环境变量里的不受影响。"))return;await rpc("settings_save",{config:{apis:{[a.dataset.api]:{clear_key:true}}}});return again();
 case "agent-save":{
  const n=a.dataset.name,q=s=>node.querySelector(s);
  await rpc("agent_save",{name:n,history:Number(q('[data-agent-history="'+n+'"]').value),blocks:q('[data-agent-blocks="'+n+'"]').checked,
   tools:all('[data-agent-tool="'+n+'"]',node).filter(i=>i.checked).map(i=>i.value),policy:q('[data-agent-policy="'+n+'"]').value});
  await saveSettings(node);return toast("已存进学习库的 agents/"+n+".md");
 }
 case "agent-reset":if(!confirm("删掉你改写的规则，恢复成默认的？改写过的版本留在学习库的历史里。"))return;await rpc("agent_reset",{name:a.dataset.name});return again();
 case "runner-add":{const ext=node.querySelector("[data-runner-new]").value.trim(),cmd=node.querySelector("[data-runner-new-cmd]").value.trim();if(!ext||!cmd)return;
  S.config=await rpc("settings_save",{config:{runners:{...S.config.runners,[ext.startsWith(".")?ext:"."+ext]:cmd}}});return again();}
 case "env-create":{const n=node.querySelector("[data-env-new]").value.trim();if(!n)return;await rpc("env_save",{name:n,text:"ipykernel\nnumpy\nmatplotlib\n"});Settings.env=n;return again();}
 case "env-save":await rpc("env_save",{name:Settings.env,text:node.querySelector("[data-env-text]").value});toast("环境定义已保存，下次运行时环境会跟着改");return again();
 case "env-install":{const input=node.querySelector("[data-env-install]"),pkgs=input.value.split(/\s+/).filter(Boolean);if(!pkgs.length)return;await rpc("env_install",{name:Settings.env,packages:pkgs});input.value="";return toast("正在安装 "+pkgs.join("、")+"…");}
 case "rules-save":await rpc("rules_save",{text:node.querySelector("[data-rules]").value});return toast("规矩已保存，所有 AI 下一轮起照这个来");
 case "rules-reset":{if(!confirm("把 AGENTS.md 恢复成默认的？现在的版本留在学习库的历史里。"))return;const r=await rpc("rules");await rpc("rules_save",{text:r.shipped});return again();}
 }
 return null;
}
const ZOOM_KINDS=[["chat:tutor","主会话"],["chat:flash","快答"],["chat:coach","练习教练"],["file","文件"],["home","开始"],["map","知识图"],["journal","学习轨迹"],["review","回顾"],["library","卡片库"],["memory","记忆"],["settings","设置"]];
function settingsChange(t){
 if(t.dataset.readUnlimited!==undefined){S.ui.read_width=t.checked?"none":42;applyUi();saveUi();renderSettings(t.closest(".panel"),"look");return true;}
 if(t.dataset.uiRange){S.ui[t.dataset.uiRange]=Number(t.value);applyUi();saveUi();return true;}
 if(t.dataset.zoomKind){const v=Math.max(60,Math.min(250,Number(t.value)||100))/100;S.ui.zoom={...(S.ui.zoom||{}),[t.dataset.zoomKind]:v};applyUi();saveUi();return true;}
 if(t.dataset.ui){const k=t.dataset.ui;S.ui[k]=t.type==="checkbox"?t.checked:t.type==="number"?Number(t.value):t.value;applyUi();saveUi();
  if(k==="thinking")Object.keys(Chat).forEach(x=>{Chat[x].thoughts={};Chat[x].liveOpen=null;renderChat(x);});return true;}
 if(t.dataset.sideWidth!==undefined){S.ui.side.width=Math.max(180,Math.min(560,Number(t.value)));saveUi();renderSide();return true;}
 if(t.dataset.envPick!==undefined){Settings.env=t.value;renderSettings(t.closest(".panel"),"run");return true;}
 if(t.dataset.cfgAgent&&t.dataset.key==="api"){const api=S.config.apis.find(x=>x.id===t.value);const m=t.closest(".agent-edit").querySelector('[data-key="model"]');if(api?.default_model&&m)m.value=api.default_model;}
 return settingsAutosave(t,true);
}
