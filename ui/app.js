"use strict";
/* Boot, the top bar, routing of backend events and clicks, and reporting what is on screen. */
const Sel={text:"",timer:null};
async function refreshState(){
 const st=await safe(()=>rpc("state"));if(!st)return;
 Object.assign(S.data,st);renderTop();
 const titles=el("#doc-titles");if(titles)titles.innerHTML=(S.data.docs||[]).slice(0,800).map(d=>'<option value="'+esc(d.title)+'">').join("");
 Object.keys(Dock.panels).forEach(refreshTab);
}
function refreshChats(){Object.keys(Chat).forEach(pid=>loadChat(pid));}
function renderTop(){
 const bar=el("#topbar");if(!bar)return;
 const busy=(S.data.busy||[]).length,running=(S.data.running||[]).length,topic=S.data.active_topic;
 bar.innerHTML='<div class="brand">'+logo()+'<b>lattice</b></div>'+
  '<button class="btn sm" data-action="new-menu">'+svg("plus",14)+' 打开 / 新建</button>'+
  '<button class="top-search" data-action="palette">'+svg("search",14)+'<span>搜索或输入命令</span><kbd>Ctrl K</kbd></button>'+
  '<span class="grow"></span>'+
  (topic?'<a class="top-topic" data-action="open-doc" data-id="'+esc(topic)+'" title="正在学的主题">'+svg("map",13)+' '+esc(topicTitle(topic))+'</a>':'')+
  (busy?'<span class="top-chip working">'+svg("bot",13)+' '+busy+' 个 AI 在工作</span>':"")+
  (running?'<span class="top-chip working">'+svg("play",13)+' '+running+' 个运行中</span>':"")+
  '<button class="top-chip'+(S.data.due?" due":"")+'" data-action="open-review" title="到期要回顾的知识卡">'+svg("card",13)+' 回顾 '+(S.data.due||0)+'</button>'+
  iconButton(S.theme==="dark"?"sun":"moon","theme","切换明暗")+iconButton("sliders","open-settings","设置");
}
const NEW_ITEMS=[
 ["写记录","new-note","edit","随手写，关掉后 AI 帮你整理"],["写代码","new-code","code","任何语言，写完就能运行"],["新实验笔记","new-notebook","flask","Jupyter 格式，在沙箱内核里运行"],
 ["新知识卡","new-card","card","自己记下一个知识点"],["主讲","open-agent","bot","",'data-agent="tutor"'],["快答","open-agent","spark","",'data-agent="flash"'],
 ["学习库","open-browser","folder",""],["知识图","open-map","map",""],["学习轨迹","open-journal","history",""],["回顾","open-review","card",""],["设置","open-settings","sliders",""]];
function newMenu(anchor){
 const r=anchor.getBoundingClientRect();
 const menu=h('<div class="menu" style="left:'+r.left+'px;top:'+(r.bottom+6)+'px">'+NEW_ITEMS.map(([t,a,i,d,x],k)=>(k===4?'<hr/>':'')+'<button data-action="'+a+'" '+(x||"")+'>'+svg(i,14)+'<span>'+esc(t)+(d?'<small>'+esc(d)+'</small>':"")+'</span></button>').join("")+'</div>');
 closeMenus();document.body.appendChild(menu);
}
function closeMenus(){all(".menu").forEach(m=>m.remove());}
async function newScratch(kind){
 const stamp=new Date().toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).replace(/[\/: ]/g,"");
 let path;
 if(kind==="note")path=(await rpc("doc_create",{kind:"note",title:"随手记 "+stamp,topic:S.data.active_topic}))?.path;
 else if(kind==="notebook"){const name=prompt("实验笔记的名字：","实验 "+stamp);if(!name)return;path=(await rpc("doc_create",{kind:"notebook",title:name,topic:S.data.active_topic})).path;}
 else{
  const name=prompt("文件名（扩展名决定语言：.py .c .rs .go .js .sh …）：","草稿-"+stamp+".py");if(!name)return;
  path=(await rpc("file_create",{folder:"code",name})).path;
 }
 await refreshState();
 openPanel({type:"file",path,scratch:kind!=="notebook"},{then:pid=>setTimeout(()=>Dock.els[pid]?.querySelector("textarea")?.focus(),300)});
}
/* ---- the command palette -------------------------------------------------------------------------------- */
function palette(){
 modal('<div class="palette"><div class="palette-input">'+svg("search",18)+'<input id="palette-q" placeholder="找卡片、笔记、主题、文件，或者输入命令…" autocomplete="off"/></div><div class="palette-list" id="palette-list"></div><div class="palette-hint">↑↓ 选择 · Enter 打开 · Esc 关闭</div></div>',"palette-modal");
 paletteFilter("");setTimeout(()=>el("#palette-q")?.focus(),20);
}
let paletteSeq=0;
async function paletteFilter(q){
 const term=q.trim().toLowerCase(),seq=++paletteSeq;
 const commands=NEW_ITEMS.filter(c=>!term||c[0].toLowerCase().includes(term)).map(([t,a,i,d,x])=>'<button class="pal-item" data-action="'+a+'" '+(x||"")+'>'+svg(i,14)+'<span>'+esc(t)+'</span><em>命令</em></button>');
 const docs=(S.data.docs||[]).filter(d=>!term||d.title.toLowerCase().includes(term)).slice(0,term?30:12)
  .map(d=>'<button class="pal-item" data-action="open-file" data-path="'+esc(d.path)+'">'+svg(fileIcon(d.path),14)+'<span>'+esc(d.title)+'</span><em>'+esc(kindName[d.kind]||d.kind)+'</em></button>');
 const box=el("#palette-list");if(!box)return;
 box.innerHTML=(term?docs.concat(commands):commands.concat(docs)).join("")||'<p class="muted pad">没有找到</p>';
 if(term.length>=2){
  const hits=await safe(()=>rpc("search",{query:term}));
  if(seq!==paletteSeq||!hits||!el("#palette-list"))return;
  const seen=new Set((S.data.docs||[]).filter(d=>d.title.toLowerCase().includes(term)).map(d=>d.path));
  const more=hits.filter(x=>!seen.has(x.path)).slice(0,20).map(x=>'<button class="pal-item" '+(x.kind==="message"?'data-action="open-thread" data-thread="'+esc(x.thread)+'" data-agent="'+esc(x.agent||"tutor")+'"':'data-action="open-file" data-path="'+esc(x.path)+'"')+'>'+svg(x.kind==="message"?"bot":fileIcon(x.path),14)+'<span>'+esc(x.title)+'<small>'+esc(x.excerpt)+'</small></span><em>'+esc(kindName[x.kind]||"对话")+'</em></button>');
  el("#palette-list").insertAdjacentHTML("beforeend",more.join(""));
 }
}
/* ---- what is on screen, for the agents ------------------------------------------------------------------- */
const Dwell={path:null,since:0,where:"",recent:[]};
let screenTimer=null;
function reportScreen(){clearTimeout(screenTimer);screenTimer=setTimeout(()=>safe(sendScreen),1200);}
function screenOf(pid){const p=Dock.panels[pid],t=Dock.types[p?.type];return t?.screen?{panel:pid,type:p.type,title:panelTitle(pid),...t.screen(p,Dock.els[pid])}:{panel:pid,type:p?.type};}
function sendScreen(){
 const stacks=[];eachStack((s,f)=>stacks.push({tabs:s.tabs.map(panelTitle),showing:s.active?panelTitle(s.active):null,floating:!!f}));
 const shown=[];eachStack(s=>{if(s.active)shown.push(s.active);});
 const mine=shown.filter(pid=>sideOf(pid)==="mine").map(screenOf),ai=shown.filter(pid=>sideOf(pid)==="ai").map(screenOf);
 const state={layout:{stacks,focused:Dock.focus?panelTitle(Dock.focus):null},ai:{panels:ai},mine:{files:mine.filter(x=>x.type==="file"),other:mine.filter(x=>x.type!=="file")},
  open_but_hidden:Object.keys(Dock.panels).filter(pid=>!shown.includes(pid)).map(panelTitle),recent_files:Dwell.recent.slice(0,20),selection:Sel.text?shorten(Sel.text,600):undefined};
 return rpc("screen",{state});
}
function trackDwell(){
 const pid=Dock.focus,p=Dock.panels[pid],path=p?.type==="file"&&!document.hidden?p.path:null;
 if(path!==Dwell.path){
  if(Dwell.path){
   const seconds=Math.round((Date.now()-Dwell.since)/1000);
   if(seconds>=30)safe(()=>rpc("viewed",{path:Dwell.path,seconds,where:Dwell.where}));
   if(seconds>=3){Dwell.recent=[{path:Dwell.path,seconds,at:new Date(Dwell.since).toISOString().slice(0,16)},...Dwell.recent.filter(r=>r.path!==Dwell.path)].slice(0,20);}
  }
  Dwell.path=path;Dwell.since=Date.now();Dwell.where="";
 }
 if(path){const sc=fileScreen(pid);Dwell.where=sc.viewport?.section||(sc.visible_cells?"第 "+sc.visible_cells.map(c=>c.index).join("、")+" 格":"");}
}
function viewedFlush(pid){if(Dock.panels[pid]?.path===Dwell.path){Dock.focus=null;trackDwell();}}
/* The one-line note sent with each message: what the learner is looking at. */
function screenNote(){
 const shown=[];eachStack(s=>{if(s.active&&sideOf(s.active)==="mine")shown.push(s.active);});
 const pid=shown.includes(Dock.focus)?Dock.focus:shown.find(x=>Dock.panels[x].type==="file")||shown[0];
 if(!pid)return "";
 const sc=screenOf(pid);
 if(sc.type!=="file")return "我开着「"+sc.title+"」";
 let note="我正在看 "+sc.path;
 if(sc.viewport)note+=(sc.viewport.section?"「"+sc.viewport.section+"」一节，":"（")+"第 "+sc.viewport.from+"–"+sc.viewport.to+" 行"+(sc.viewport.section?"":"）");
 if(sc.visible_cells?.length)note+="，第 "+sc.visible_cells.map(c=>c.index).join("、")+" 格";
 if(sc.dirty)note+="，有没保存的修改";
 return note;
}
/* ---- events from the backend ---------------------------------------------------------------------------------- */
async function onEvent(evt){
 if(evt.type==="agent")return chatEvent(evt);
 if(evt.type==="run")return runEvent(evt);
 if(evt.type==="kernel"){kernelEvent(evt);if(["run_finished","batch_finished"].includes(evt.kind))journalsChanged();return;}
 if(evt.type==="changed"){fileChanged(evt);browserChanged(evt.paths);mapsChanged();journalsChanged();if(evt.external||evt.paths.some(p=>/^(topics|cards|lessons|notes|insights|notebooks)\//.test(p)))refreshState();return;}
 if(evt.type==="open"){openFile(evt.path,{line:evt.line,highlight:evt.highlight,cell:evt.cell});return;}
 if(evt.type==="env"){
  toast(evt.message,evt.ok?"info":"error");
  // A run that waited for the learner's install goes again.
  for(const pid of Object.keys(Files))if(Files[pid].afterInstall&&evt.ok&&evt.message.includes(Files[pid].afterInstall)){Files[pid].afterInstall=null;safe(()=>runFile(pid));}
  return;
 }
}
/* ---- clicks --------------------------------------------------------------------------------------------------- */
async function onAction(a){
 const kind=a.dataset.action,pid=a.dataset.pid;
 if(a.closest(".menu"))closeMenus();
 if(a.closest("#palette-list"))closeModal();
 switch(kind){
 case "dock-close":return closePanel(pid);
 case "dock-float":return float(pid);
 case "modal-close":return closeModal();
 case "new-menu":return newMenu(a);
 case "palette":return palette();
 case "theme":S.theme=S.theme==="dark"?"light":"dark";localStorage.setItem("lattice-theme",S.theme);document.documentElement.dataset.theme=S.theme;return renderTop();
 case "new-note":return newScratch("note");
 case "new-code":return newScratch("code");
 case "new-notebook":return newScratch("notebook");
 case "new-card":{const title=prompt("知识卡的标题：");if(!title)return;const r=await rpc("doc_create",{kind:"card",title,topic:S.data.active_topic});await refreshState();return openFile(r.path);}
 case "open-agent":return openPanel({type:"chat",agent:a.dataset.agent});
 case "open-browser":return openPanel({type:"browser"});
 case "open-map":return openPanel({type:"map",topic:S.data.active_topic||null});
 case "open-journal":return openPanel({type:"journal"});
 case "open-review":return openPanel({type:"review"},{reuse:false});
 case "open-settings":return openPanel({type:"settings"});
 case "open-file":return openFile(a.dataset.path||a.dataset.id,{line:a.dataset.line?Number(a.dataset.line):null,highlight:a.dataset.highlight||null});
 case "open-doc":{const d=(S.data.docs||[]).find(x=>x.id===a.dataset.id);if(d)return openFile(d.path);return toast("找不到这个文档，它可能已经被删除","error");}
 case "open-dir":Browser.open.add(a.dataset.path);openPanel({type:"browser"});return renderBrowser();
 case "open-thread":return openPanel({type:"chat",agent:a.dataset.agent||"tutor",thread:a.dataset.thread});
 case "open-practice":return openPractice(a.dataset.id);
 case "open-ref":return openRef(a.dataset.ref);
 case "open-url":return rpc("open_url",{url:a.dataset.url});
 case "open-vault":return rpc("open_folder",{});
 case "tree-toggle":{const p=a.dataset.path;Browser.open.has(p)?Browser.open.delete(p):Browser.open.add(p);return renderBrowser();}
 case "project-add":{const r=await rpc("project_add",{},0);if(r){delete Browser.entries[""];await refreshState();renderBrowser();toast("已挂载 "+r.name+"：你能读写，AI 只读");}return;}
 case "project-remove":if(!confirm("取消挂载这个目录？目录本身不会被改动。"))return;await rpc("project_remove",{id:a.dataset.id});delete Browser.entries[""];await refreshState();return renderBrowser();
 case "import-md":{const r=await rpc("import_markdown",{},0);if(r){toast("导入了 "+r.count+" 篇");browserChanged(["notes/x"]);refreshState();}return;}
 case "export":{const r=await rpc("export",{},0);if(r)toast("已导出到 "+r);return;}
 case "chat-send":return chatSend(pid);
 case "chat-cancel":return rpc("cancel",{thread:Chat[pid].thread});
 case "chat-task":return chatSend(pid,"",{task:a.dataset.task});
 case "chat-new":{if(!confirm("开一段新会话？之前的对话还在，可以在学习库的 threads/ 里找到，也能被搜索到。"))return;await rpc("thread_new",{agent:Dock.panels[pid].agent,topic:S.data.active_topic||""});return loadChat(pid,false);}
 case "practice-start":return startPractice(pid,a.dataset.mid);
 case "practice-end":return endPractice(pid);
 case "message-card":return messageToCard(pid,a.dataset.mid);
 case "message-escalate":return escalate(pid,a.dataset.mid);
 case "handoff":{let tutor=Object.keys(Chat).find(x=>Dock.panels[x]?.agent==="tutor"&&!Dock.panels[x].thread);if(!tutor)tutor=openPanel({type:"chat",agent:"tutor"});else activate(tutor);
  return setTimeout(()=>chatSend(tutor,"快答刚把一个问题转交给你了，请接住它。"),300);}
 case "undo":{await rpc("undo",{id:a.dataset.id});toast("已撤销");await refreshState();refreshChats();return renderOrganizer();}
 case "suggestion":{await rpc("suggestion",{thread:Chat[pid].thread,message:Number(a.dataset.mid),id:a.dataset.sid,decision:a.dataset.decision});return loadChat(pid);}
 case "quiz-answer":{
  const block=a.closest(".lblock"),choice=block.querySelector("input[type=radio]:checked"),free=block.querySelector("textarea");
  const answer=(choice?.value||free?.value||"").trim();if(!answer)return toast("先写下你的回答");
  const [message,index]=a.dataset.key.split(":");const chatPid=a.closest(".panel").dataset.pid;
  return chatSend(chatPid,"我的回答："+answer,{answer:{message:Number(message),block:Number(index),question:block.dataset.question||""},selection:""});
 }
 case "card-reveal":{const card=a.closest(".mini-card");card.querySelector(".mini-answer").hidden=false;a.parentElement.remove();return;}
 case "code-copy":{const n=el("#"+a.dataset.target);if(n){await navigator.clipboard.writeText(n.textContent);toast("已复制");}return;}
 case "code-run":{const n=el("#"+a.dataset.target);if(!n)return;const r=await rpc("run",{code:n.textContent,lang:a.dataset.lang});snippetRuns[a.dataset.target]={run:r.run,outputs:[]};
  const box=el('[data-snippet="'+a.dataset.target+'"]');if(box)box.innerHTML='<div class="run-head"><span class="run-state s-running">运行中…</span></div>';return;}
 case "code-take":{const n=el("#"+a.dataset.target);if(!n)return;const ext=CODE_EXT[(a.dataset.lang||"").toLowerCase()]||".txt";
  const name=prompt("存成哪个文件（放在 code/ 里）：","片段-"+new Date().toLocaleTimeString("zh-CN",{hour12:false}).replace(/:/g,"")+ext);if(!name)return;
  const r=await rpc("file_create",{folder:"code",name,content:n.textContent});await refreshState();return openFile(r.path);}
 case "sel-clear":Sel.text="";Object.keys(Chat).forEach(updateComposer);return;
 case "ask-flash":case "ask-tutor":{
  const agent=kind==="ask-flash"?"flash":"tutor",text=Sel.text;hidePop();
  let target=Object.keys(Chat).find(x=>Dock.panels[x]?.agent===agent&&!Dock.panels[x].thread);
  if(!target)target=openPanel({type:"chat",agent});else activate(target);
  const go=()=>Chat[target]?.thread?chatSend(target,agent==="flash"?"请解释我选中的内容，结合我正在看的东西给一个容易懂的例子。":"请结合我正在学的内容，讲讲我选中的这段。",{selection:text}):setTimeout(go,200);
  return go();
 }
 case "organizer-dismiss":Organizer.text="";return renderOrganizer();
 case "cfg-save":return saveSettings(a.closest(".panel"));
 case "cfg-test":await saveSettings(a.closest(".panel"));el("#cfg-test-result").textContent="正在读取模型列表…";return rpc("test_api",{agent:a.dataset.agent});
 case "cfg-clear-key":if(!confirm("清除本机保存的这个 Key？环境变量里的不受影响。"))return;await rpc("settings_save",{config:{apis:{[a.dataset.api]:{clear_key:true}}}});return renderSettings(a.closest(".panel"));
 case "env-install":{const input=a.closest(".env-box").querySelector("[data-env-install]"),pkgs=input.value.split(/\s+/).filter(Boolean);if(!pkgs.length)return;await rpc("env_install",{name:"default",packages:pkgs});input.value="";return toast("正在安装 "+pkgs.join("、")+"…");}
 case "topic-focus":{await rpc("focus",{topic:a.dataset.id});await refreshState();followingPanels().forEach(x=>loadChat(x));
  let tutor=Object.keys(Chat).find(x=>Dock.panels[x]?.agent==="tutor"&&!Dock.panels[x].thread);if(!tutor)openPanel({type:"chat",agent:"tutor"});else activate(tutor);return;}
 case "topic-delete":{if(!confirm("删除这个主题？里面的卡片、笔记和对话都会留下，只是不再属于它。主题文件会留在学习库的历史里。"))return;
  await rpc("topic_delete",{id:a.dataset.id});const p=a.closest(".panel")?.dataset.pid;if(p)await closePanel(p);await refreshState();return followingPanels().forEach(x=>loadChat(x));}
 case "version-view":case "version-restore":return versionAction(kind,a);
 case "file-history":return showHistory(pid);
 }
 return fileAction(kind,a);
}
async function openRef(ref){
 const at=ref.indexOf(":"),kind=ref.slice(0,at),id=ref.slice(at+1);
 if(kind==="file")return openFile(id);
 if(kind==="cell"){const [path,cell]=id.split("#");return openFile(path,{cell});}
 if(kind==="practice")return openPractice(id);
 const d=(S.data.docs||[]).find(x=>x.id===id);if(d)return openFile(d.path);
 await refreshState();const again=(S.data.docs||[]).find(x=>x.id===id);if(again)return openFile(again.path);
 toast("找不到它了，可能已经被撤销或删除","error");
}
/* ---- selection: ask about anything selected ----------------------------------------------------------------------- */
function hidePop(){el("#sel-pop")?.remove();}
function onSelect(e){
 if(e.target.closest?.("#overlays,.menu,#sel-pop,.composer,.tabs"))return;
 const t=e.target;let text="",rect=null;
 if(t.tagName==="TEXTAREA"||t.tagName==="INPUT"){text=t.value?.slice(t.selectionStart,t.selectionEnd)||"";rect=t.getBoundingClientRect();}
 else{const s=window.getSelection();text=s?.toString()||"";if(s?.rangeCount)rect=s.getRangeAt(0).getBoundingClientRect();}
 if(!text.trim()){hidePop();return;}
 Sel.text=text.slice(0,5000);Object.keys(Chat).forEach(updateComposer);reportScreen();
 if(!rect)return;hidePop();
 const pop=h('<div id="sel-pop"><button data-action="ask-flash">'+svg("spark",13)+' 问快答</button><button data-action="ask-tutor">'+svg("bot",13)+' 问主讲</button></div>');
 document.body.appendChild(pop);
 const x=Math.min(Math.max(8,rect.left+rect.width/2-pop.offsetWidth/2),innerWidth-pop.offsetWidth-8),y=rect.top-pop.offsetHeight-8;
 pop.style.left=x+"px";pop.style.top=(y<8?rect.bottom+8:y)+"px";
}
/* ---- wiring ------------------------------------------------------------------------------------------------------------- */
function initInteractions(){
 initDock();
 document.addEventListener("click",e=>{
  const wiki=e.target.closest("a[data-wiki]");
  if(wiki){e.preventDefault();const name=wiki.dataset.wiki.trim().toLowerCase(),d=(S.data.docs||[]).find(x=>x.title.toLowerCase()===name);
   if(d)openFile(d.path);else if(confirm("「"+wiki.dataset.wiki+"」还没有对应的文档，新建一篇笔记吗？"))safe(async()=>{const r=await rpc("doc_create",{kind:"note",title:wiki.dataset.wiki});await refreshState();openFile(r.path);});return;}
  const link=e.target.closest(".markdown a[href^='http']");if(link){e.preventDefault();safe(()=>rpc("open_url",{url:link.href}));return;}
  if(!e.target.closest(".menu,[data-action='new-menu']"))closeMenus();
  if(e.target.closest("[data-dismiss]")&&e.target===e.target.closest("[data-dismiss]")){closeModal();return;}
  const a=e.target.closest("[data-action]");if(a&&!a.disabled)safe(()=>onAction(a));
 });
 document.addEventListener("input",e=>{
  const t=e.target;
  if(t.id==="palette-q")return paletteFilter(t.value);
  if(t.dataset.composer){if(Chat[t.dataset.composer])Chat[t.dataset.composer].input=t.value;return;}
  if(t.dataset.browserSearch!==undefined){clearTimeout(Browser.timer);Browser.query=t.value;Browser.timer=setTimeout(async()=>{Browser.hits=t.value.trim()?await safe(()=>rpc("search",{query:t.value})):null;renderBrowser();},300);return;}
  if(fileInput(t))reportScreen();
 });
 document.addEventListener("change",e=>{
  const t=e.target;
  if(t.dataset.mapTopic!==undefined){Dock.panels[t.dataset.mapTopic].topic=t.value||null;saveLayout();refreshTab(t.dataset.mapTopic);return loadMap(t.dataset.mapTopic);}
  if(t.dataset.journalType!==undefined){Dock.panels[t.dataset.journalType].group=t.value;saveLayout();return loadJournal(t.dataset.journalType);}
  if(t.dataset.journalDays!==undefined){Dock.panels[t.dataset.journalDays].days=Number(t.value);saveLayout();return loadJournal(t.dataset.journalDays);}
  if(t.dataset.cfgAgent&&t.dataset.key==="api"){const api=S.config.apis.find(x=>x.id===t.value);const m=t.closest(".agent-card").querySelector('[data-key="model"]');if(api?.default_model&&m)m.value=api.default_model;return;}
  safe(()=>fileChange(t));
 });
 document.addEventListener("keydown",e=>{
  const mod=e.ctrlKey||e.metaKey,t=e.target;
  if(e.key==="Escape"){if(el(".modal-backdrop")){closeModal();return;}closeMenus();hidePop();return;}
  if(el("#palette-list")&&["ArrowDown","ArrowUp","Enter"].includes(e.key)){
   const items=all("#palette-list .pal-item");if(!items.length)return;
   if(e.key==="Enter"){if(t.id==="palette-q"){e.preventDefault();items[0].click();}return;}
   e.preventDefault();const at=items.indexOf(document.activeElement),next=e.key==="ArrowDown"?Math.min(at+1,items.length-1):at-1;
   if(next<0)el("#palette-q")?.focus();else items[next].focus();return;
  }
  if(t.dataset?.composer&&mod&&e.key==="Enter"){e.preventDefault();safe(()=>chatSend(t.dataset.composer));return;}
  if(fileKey(e))return;
  if(mod&&e.key.toLowerCase()==="k"){e.preventDefault();palette();return;}
  if(mod&&e.key.toLowerCase()==="s"){e.preventDefault();safe(async()=>{await flushAll();toast("已保存");});return;}
  if(mod&&e.key.toLowerCase()==="n"){e.preventDefault();safe(()=>newScratch("note"));return;}
  if(mod&&e.key.toLowerCase()==="j"){e.preventDefault();const f=Object.keys(Chat).find(x=>Dock.panels[x]?.agent==="flash")||openPanel({type:"chat",agent:"flash"});activate(f);setTimeout(()=>Dock.els[f]?.querySelector(".composer textarea")?.focus(),50);return;}
  if(mod&&e.key.toLowerCase()==="w"&&Dock.focus){e.preventDefault();safe(()=>closePanel(Dock.focus));return;}
 });
 document.addEventListener("mouseup",e=>setTimeout(()=>onSelect(e),0));
 document.addEventListener("scroll",()=>{hidePop();reportScreen();},true);
 document.addEventListener("focusin",()=>reportScreen());
 setInterval(trackDwell,2000);
 setInterval(()=>safe(flushAll),25000);
}
async function boot(){
 document.documentElement.dataset.theme=S.theme;
 try{
  if(typeof qt==="undefined"||!qt.webChannelTransport)throw new Error("必须由 Lattice 桌面程序启动（缺少本地 Qt WebChannel）");
  new QWebChannel(qt.webChannelTransport,async channel=>{
   try{
    S.bridge=channel.objects.backend;
    S.bridge.event.connect(raw=>safe(()=>onEvent(JSON.parse(raw))));
    S.data=await rpc("bootstrap");S.config=S.data.config;
    el("#app").innerHTML='<header id="topbar"></header><div id="dock-wrap"><div id="dock"></div><div id="floats"></div></div><div id="organizer" hidden></div><div id="drop-mark"></div><datalist id="doc-titles"></datalist>';
    renderTop();initInteractions();loadLayout(S.data.layout);await refreshState();reportScreen();
    if(S.data.migrated)toast("已把原来的学习数据迁移成文件，放在 "+S.data.vault);
    if(S.data.problems?.length)console.warn("读不了的文件",S.data.problems);
   }catch(err){console.error(err);el("#app").innerHTML='<div class="boot">初始化失败：'+esc(err.message)+'<br/><button class="btn" onclick="location.reload()">重试</button></div>';}
  });
 }catch(e){el("#app").innerHTML='<div class="boot">'+esc(e.message)+'</div>';}
}
window.addEventListener("beforeunload",()=>{try{flushAll();}catch(_){}});
document.addEventListener("DOMContentLoaded",boot);
