"use strict";
/* Boot, the top bar, routing of backend events and clicks, and reporting what is on screen. */
const Sel={text:"",timer:null,el:null};
/* Selected text is only context until the learner hands it to a conversation; letting go of it clears it everywhere. */
function clearSelection(){
 Sel.text="";hidePop();
 if(Sel.el?.setSelectionRange&&Sel.el.isConnected)Sel.el.setSelectionRange(Sel.el.selectionEnd,Sel.el.selectionEnd);
 Sel.el=null;window.getSelection()?.removeAllRanges();reportScreen();
}
async function refreshState(){
 const st=await safe(()=>rpc("state"));if(!st)return;
 Object.assign(S.data,st);renderTop();sideChanged([]);homesChanged();cardViewsChanged();
 const titles=el("#doc-titles");if(titles)titles.innerHTML=(S.data.docs||[]).slice(0,800).map(d=>'<option value="'+esc(d.title)+'">').join("");
 Object.keys(Dock.panels).forEach(refreshTab);
}
function refreshChats(){Object.keys(Chat).forEach(pid=>loadChat(pid));}
/* The status bar: where the conversation is, what is working, what is running. */
function renderStatus(){
 const bar=el("#status");if(!bar)return;
 const busy=(S.data.busy||[]).length,running=(S.data.running||[]).length,topic=S.data.active_topic;
 bar.innerHTML=(topic?'<a data-action="open-doc" data-id="'+esc(topic)+'" title="正在学的主题">'+svg("map",12)+' '+esc(topicTitle(topic))+'</a>':'<span>'+svg("bot",12)+' 默认对话</span>')+
  (busy?'<span class="working">'+svg("bot",12)+' '+busy+' 个 AI 在工作</span>':"")+(running?'<span class="working">'+svg("play",12)+' '+running+' 个运行中</span>':"")+
  '<span class="grow"></span>'+(S.data.sandbox?.ok?'<span title="AI 的命令和运行都在沙箱里">'+svg("shield",12)+' 沙箱</span>':'<span class="warn">'+svg("shield",12)+' 沙箱不可用</span>')+
  '<a data-action="open-vault" title="在系统里打开学习库">'+svg("folder",12)+' '+esc(S.data.vault||"")+'</a>';
}
function renderTop(){renderStatus();renderActivity();}
/* Interface preferences live in the machine's config; appearance applies at once. */
// Reading width in characters of body text, so headings and paragraphs share one column and it widens with the text.
const READ_WIDTH={narrow:34,medium:42,wide:54};
function readChars(v){if(v==="none"||v===0)return 0;return Math.min(120,Math.max(20,Number(v)||READ_WIDTH[v]||42));}
function readWidth(v){const chars=readChars(v);return chars?Math.round(chars*(Number(S.ui.font_size)||14.5))+"px":"none";}
function applyUi(){
 const u=S.ui,root=document.documentElement;
 root.dataset.theme=u.theme==="light"?"light":"dark";root.dataset.density=u.density||"comfortable";
 root.style.setProperty("--font-size",(Number(u.font_size)||14.5)+"px");root.style.setProperty("--code-size",(Number(u.code_font_size)||13)+"px");
 root.style.setProperty("--line-height",String(Number(u.line_height)||1.8));root.style.setProperty("--read-width",readWidth(u.read_width));
 applyTheme();
 Object.keys(Dock.panels).forEach(applyView);
 renderActivity();
}
let uiTimer=null;
function saveUi(now=false){
 clearTimeout(uiTimer);
 const go=()=>rpc("ui_save",{ui:S.ui}).then(u=>{S.ui=u;}).catch(e=>toast(e.message,"error"));
 if(now)return go();uiTimer=setTimeout(go,500);
}
const NEW_ITEMS=[
 ["写记录","new-note","edit","随手写，关掉后 AI 帮你整理"],["写代码","new-code","code","任何语言，写完就能运行"],["新实验笔记","new-notebook","flask","Jupyter 格式，在沙箱内核里运行"],
 ["新知识卡","new-card","card","自己记下一个知识点"],["主会话","open-agent","bot","",'data-agent="tutor"'],["快答","open-agent","spark","",'data-agent="flash"'],
 ["新工作区…","space-new","layout","自己搭一套窗口组合"]];
// Panels that already have a button of their own; the palette still lists them as commands.
const PANEL_ITEMS=[["开始","open-home","home",""],["知识图","open-map","network",""],["学习轨迹","open-journal","history",""],["回顾","open-review","refresh",""],["卡片库","open-library","card",""],["记忆","open-memory","calendar",""],
 ["快速打开笔记 · Ctrl O","note-switcher","document",""],["技能商城","open-skills","store",""],["今天的日记","note-daily","calendar",""],["大纲与链接","open-noteinfo","list",""],["设置","open-settings","sliders",""]];
// What a group of tabs can open: something new, or any window. The same list is behind the activity bar's +, when it is shown.
const OPEN_ITEMS=[["主会话","open-agent","bot",'data-agent="tutor"'],["快答","open-agent","spark",'data-agent="flash"'],["开始","open-home","home"],["知识图","open-map","network"],
 ["卡片库","open-library","card"],["回顾","open-review","refresh"],["记忆","open-memory","calendar"],["大纲与链接","open-noteinfo","list"],["学习轨迹","open-journal","history"],["技能商城","open-skills","store"],["设置","open-settings","sliders"]];
function openMenuHtml(){
 const item=([t,a,i,d,x])=>'<button data-action="'+a+'" '+(x||"")+'>'+svg(i,14)+'<span>'+esc(t)+(d?'<small>'+esc(d)+'</small>':"")+'</span></button>';
 return '<div class="menu-label">新建</div><div class="menu-grid">'+NEW_ITEMS.slice(0,4).map(([t,a,i,d,x])=>item([t,a,i,"",x])).join("")+
  '<button data-action="note-new" data-folder="">'+svg("notenew",14)+'<span>新笔记</span></button></div>'+
  '<hr/><div class="menu-label">打开窗口</div><div class="menu-grid">'+OPEN_ITEMS.map(([t,a,i,x])=>'<button data-action="'+a+'" '+(x||"")+'>'+svg(i,14)+'<span>'+esc(t)+'</span></button>').join("")+'</div>'+
  '<hr/><button data-action="note-switcher">'+svg("search",14)+'<span>打开一篇笔记或文件… <small>Ctrl O</small></span></button>'+
  '<button data-action="space-new">'+svg("layout",14)+'<span>新工作区…</span></button>';
}
// From a group's own +: whatever is opened goes into that group.
function stackMenu(anchor,stack){Dock.into={stack,until:Date.now()+15000};popMenu(anchor,openMenuHtml(),{cls:"menu-wide"});}
function newMenu(anchor){
 Dock.into=null;
 const r=anchor.getBoundingClientRect();
 const menu=h('<div class="menu menu-wide" style="left:'+(r.right+6)+'px;top:'+r.top+'px">'+openMenuHtml()+'</div>');
 closeMenus();document.body.appendChild(menu);
 menu.style.top=Math.max(8,Math.min(r.top,innerHeight-menu.offsetHeight-8))+"px";
}
function closeMenus(){all(".menu").forEach(m=>m.remove());Menus.owner=null;}
/* A small menu next to what opened it (above it for things at the bottom), kept inside the window. */
const Menus={reopen:null,owner:null};
function popMenu(anchor,html,opts={}){
 closeMenus();Menus.reopen=null;
 const r=anchor.getBoundingClientRect?anchor.getBoundingClientRect():{left:anchor.x,right:anchor.x,top:anchor.y,bottom:anchor.y};
 const menu=h('<div class="menu '+(opts.cls||"")+'">'+html+'</div>');if(opts.width)menu.style.minWidth=opts.width+"px";document.body.appendChild(menu);
 const w=menu.offsetWidth,ht=menu.offsetHeight,below=r.bottom+6,above=r.top-ht-6;
 // Below unless it does not fit there and does above (or asked for above and it fits).
 const y=opts.above?(above>=8?above:below):(below+ht<=innerHeight-8||above<8?below:above);
 menu.style.left=Math.max(8,Math.min(r.left,innerWidth-w-8))+"px";menu.style.top=Math.max(8,Math.min(y,innerHeight-ht-8))+"px";
 return menu;
}
function tabMenu(pid,at){
 const p=Dock.panels[pid];if(!p)return;
 const floating=Dock.layout.floats.some(f=>f.stack.tabs.includes(pid));
 popMenu(at,'<div class="menu-label">这个窗口的大小'+(p.zoom?"（单独调过）":"")+'</div><div class="zoom-row">'+
  '<button data-action="zoom-step" data-pid="'+pid+'" data-dir="-1" title="缩小 · Ctrl -">A−</button><b>'+Math.round(zoomOf(p)*100)+'%</b>'+
  '<button data-action="zoom-step" data-pid="'+pid+'" data-dir="1" title="放大 · Ctrl =">A+</button></div>'+
  (p.zoom?'<button data-action="zoom-step" data-pid="'+pid+'" data-dir="0">'+svg("undo",14)+'<span>恢复成这种面板的默认（'+Math.round(zoomDefault(p)*100)+'%）</span></button>':"")+'<hr/>'+
  (floating?"":'<button data-action="dock-float" data-pid="'+pid+'">'+svg("float",14)+'<span>浮出</span></button>')+
  '<button data-action="dock-close" data-pid="'+pid+'">'+svg("close",14)+'<span>关闭</span></button>');
 Menus.reopen=()=>tabMenu(pid,at);
}
function panelHere(){const a=document.activeElement?.closest?.(".panel");return a?.dataset.pid||(Dock.panels[Dock.focus]?Dock.focus:null);}
async function newScratch(kind){
 const stamp=new Date().toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).replace(/[\/: ]/g,"");
 let path;
 if(kind==="note")path=(await rpc("doc_create",{kind:"note",title:"随手记 "+stamp,topic:S.data.active_topic}))?.path;
 else if(kind==="notebook"){const name=await askText("实验笔记的名字","实验 "+stamp,{ok:"新建"});if(!name)return;path=(await rpc("doc_create",{kind:"notebook",title:name,topic:S.data.active_topic})).path;}
 else{
  const name=await askText("文件名","草稿-"+stamp+".py",{hint:"扩展名决定语言：.py .c .rs .go .js .sh …",selectStem:true,ok:"新建"});if(!name)return;
  path=(await rpc("file_create",{folder:"code",name})).path;
 }
 await refreshState();
 openPanel({type:"file",path,scratch:kind!=="notebook"},{then:pid=>setTimeout(()=>focusEditor(Dock.els[pid]),400)});
}
/* ---- the command palette -------------------------------------------------------------------------------- */
function palette(){
 modal('<div class="palette"><div class="palette-input">'+svg("search",18)+'<input id="palette-q" placeholder="找卡片、笔记、主题、文件，或者输入命令…" autocomplete="off"/></div><div class="palette-list" id="palette-list"></div><div class="palette-hint">↑↓ 选择 · Enter 打开 · Esc 关闭</div></div>',"palette-modal");
 paletteFilter("");setTimeout(()=>el("#palette-q")?.focus(),20);
}
let paletteSeq=0;
async function paletteFilter(q){
 const term=q.trim().toLowerCase(),seq=++paletteSeq;
 const commands=NEW_ITEMS.concat(PANEL_ITEMS).filter(c=>!term||c[0].toLowerCase().includes(term)).map(([t,a,i,d,x])=>'<button class="pal-item" data-action="'+a+'" '+(x||"")+'>'+svg(i,14)+'<span>'+esc(t)+'</span><em>命令</em></button>');
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
 const stacks=[];eachStack((s,f)=>stacks.push({tabs:s.tabs.map(pid=>({id:pid,title:panelTitle(pid),type:Dock.panels[pid].type,zoom:Math.round(zoomOf(Dock.panels[pid])*100)+"%"})),showing:s.active,floating:!!f}));
 const shown=[];eachStack(s=>{if(s.active)shown.push(s.active);});
 const mine=shown.filter(pid=>sideOf(pid)==="mine").map(screenOf),ai=shown.filter(pid=>sideOf(pid)==="ai").map(screenOf);
 // Where each window on show sits, as shares of the window area, so an agent can tell what is beside it.
 const area=el("#dock")?.getBoundingClientRect(),windows=area?.width?shown.map(pid=>{
  const r=Dock.els[pid]?.getBoundingClientRect();if(!r?.width)return null;const p=Dock.panels[pid];
  return {id:pid,title:panelTitle(pid),type:p.type,...(p.type==="chat"?{agent:p.agent,thread:Chat[pid]?.thread||p.thread||null}:{}),
   floating:Dock.layout.floats.some(f=>f.stack.tabs.includes(pid)),
   x:+((r.left-area.left)/area.width).toFixed(3),y:+((r.top-area.top)/area.height).toFixed(3),w:+(r.width/area.width).toFixed(3),h:+(r.height/area.height).toFixed(3)};
 }).filter(Boolean):[];
 const state={layout:{stacks,focused:Dock.focus||null,nesting:layoutShape(Dock.layout.root),windows},ai:{panels:ai},mine:{files:mine.filter(x=>x.type==="file"),other:mine.filter(x=>x.type!=="file")},
  look:{base:S.ui.theme,theme:S.ui.theme_custom||"默认",...(activeTheme()?{vars:activeTheme().vars,font:activeTheme().font||undefined,css:activeTheme().css?activeTheme().css.slice(0,600):undefined}:{}),saved:Object.keys(S.ui.themes||{})},
  workspace:{now:currentSpace().name,sidebar:sideOpen()?(currentSpace().side||[]):"收起",all:visibleSpaces().map(x=>x.name)},theme:S.ui.theme,
  open_but_hidden:stacks.flatMap(s=>s.tabs).filter(t=>!shown.includes(t.id)).map(t=>t.title),recent_files:Dwell.recent.slice(0,20),selection:Sel.text?shorten(Sel.text,600):undefined};
 return rpc("screen",{state});
}
/* The split tree in brief, so an agent can see how the panels sit before it rearranges them. */
function layoutShape(n){return n.t==="stack"?{tabs:n.tabs}:{split:n.dir,sizes:n.sizes.map(x=>+x.toFixed(2)),parts:n.kids.map(layoutShape)};}
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
 if(evt.type==="agent"&&String(evt.thread||"").startsWith("compare:"))return compareEvent(evt);
 if(evt.type==="agent")return chatEvent(evt);
 if(evt.type==="skill_change"){skillsChanged();return skillChangeEvent(evt);}
 if(evt.type==="run")return runEvent(evt);
 if(evt.type==="kernel"){kernelEvent(evt);if(["run_finished","batch_finished"].includes(evt.kind))journalsChanged();return;}
 if(evt.type==="notice"){toast(evt.message);return;}
 if(evt.type==="web")return readerEvent(evt);
 if(evt.type==="ui"){const result=await runUiOps(evt.ops);return rpc("ui_done",{request:evt.request,result});}
 if(evt.type==="changed"){fileChanged(evt);embedsChanged(evt.paths);if(evt.paths.some(p=>p.startsWith("skills/")))skillsChanged();sideChanged(evt.paths);mapsChanged();journalsChanged();homesChanged();if(evt.external||evt.paths.some(p=>/^(topics|cards|lessons|notes|insights|notebooks)\//.test(p)))refreshState();return;}
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
 case "stack-add":return stackMenu(a,a.dataset.stack);
 case "palette":return palette();
 case "theme":
  // With a theme of its own in use, the button goes back to the plain look first.
  if(S.ui.theme_custom){S.ui.theme_custom=null;toast("回到默认主题；设置的「外观」里可以再选回来");}else S.ui.theme=S.ui.theme==="dark"?"light":"dark";
  applyUi();return saveUi();
 case "theme-use":S.ui.theme_custom=a.dataset.name||null;if(S.ui.theme_custom)S.ui.theme=S.ui.themes[S.ui.theme_custom].base;applyUi();saveUi();return renderSettings(a.closest(".panel"),"look");
 case "theme-delete":{if(!await ask("删掉以后可以再让 AI 做一个。",{title:"删除主题「"+a.dataset.name+"」？",danger:true,ok:"删除"}))return;themeOp({name:a.dataset.name,delete:true});return renderSettings(a.closest(".panel"),"look");}
 case "side-collapse":return setSideOpen(false);
 case "side-stage":Side.stage=a.dataset.stage;return renderSide();
 case "lib-stage":if(Dock.panels[pid]){Dock.panels[pid].stage=a.dataset.stage;saveLayout();renderLibrary(pid);}return;
 case "open-home":return openPanel({type:"home"});
 case "ui-restore":return restoreUi(a.dataset.snapshot);
 case "new-note":return newScratch("note");
 case "new-code":return newScratch("code");
 case "new-notebook":return newScratch("notebook");
 case "new-card":{const title=await askText("知识卡的标题","",{ok:"新建"});if(!title)return;const r=await rpc("doc_create",{kind:"card",title,topic:S.data.active_topic});await refreshState();return openFile(r.path);}
 case "open-agent":return openPanel({type:"chat",agent:a.dataset.agent});
 case "open-map":return openPanel({type:"map",topic:S.data.active_topic||null});
 case "open-journal":return openPanel({type:"journal"});
 case "open-review":{const had=findPanel({type:"review"}),id=openPanel({type:"review"});if(had)loadReview(Dock.els[id]);return;}
 case "open-library":return openPanel({type:"library"});
 case "open-memory":return openPanel({type:"memory"});
 case "open-noteinfo":return openPanel({type:"noteinfo"});
 case "open-skills":return openPanel({type:"skills"});
 case "open-settings":{const page=a.dataset.page,had=findPanel({type:"settings"}),id=openPanel({type:"settings",...(page?{page}:{})});if(had&&page)renderSettings(Dock.els[id],page);return;}
 case "open-file":return openFile(a.dataset.path||a.dataset.id,{line:a.dataset.line?Number(a.dataset.line):null,highlight:a.dataset.highlight||null});
 case "open-doc":{const d=(S.data.docs||[]).find(x=>x.id===a.dataset.id);if(d)return openFile(d.path);return toast("找不到这个文档，它可能已经被删除","error");}
 case "open-dir":{Side.open.add(a.dataset.path);if((currentSpace().side||[]).includes("files"))return setSideOpen(true);
  const sp=visibleSpaces().find(x=>(x.side||[]).includes("files"));if(sp){switchSpace(sp.id);return setSideOpen(true);}return toast("没有哪个工作区的左栏放着「全部文件」");}
 case "open-thread":return openPanel({type:"chat",agent:a.dataset.agent||"tutor",thread:a.dataset.thread});
 case "open-practice":return openPractice(a.dataset.id);
 case "open-ref":return openRef(a.dataset.ref);
 case "open-url":return rpc("open_url",{url:a.dataset.url});
 case "open-web":return openWeb(a.dataset.url,pid);
 case "web-back":case "web-refresh":case "web-copy":case "web-save":return readerAction(kind,a,pid);
 case "open-vault":return rpc("open_folder",{});
 case "tree-toggle":{const p=a.dataset.path;Side.open.has(p)?Side.open.delete(p):Side.open.add(p);return renderSide();}
 case "project-add":{const path=await pickPath({mode:"dir",title:"挂载一个本地目录",ok:"挂载",hint:"挂载后你能读写，AI 只读"});if(!path)return;const r=await rpc("project_add",{path},0);if(r){delete Side.entries[""];await refreshState();renderSide();toast("已挂载 "+r.name+"：你能读写，AI 只读");}return;}
 case "project-remove":if(!await ask("目录本身不会被改动。",{title:"取消挂载这个目录？",ok:"取消挂载",cancel:"留着"}))return;await rpc("project_remove",{id:a.dataset.id});delete Side.entries[""];await refreshState();return renderSide();
 case "import-md":{const folder=await pickPath({mode:"dir",title:"从已有的 Markdown 笔记目录导入",ok:"导入",hint:"只复制，原来的文件不动"});if(!folder)return;const r=await rpc("import_markdown",{folder},0);if(r){toast("导入了 "+r.count+" 篇");sideChanged(["notes/x"]);refreshState();}return;}
 case "export":{const path=await pickPath({mode:"save",title:"导出学习库",ok:"导出",name:"lattice-learning.zip",ext:".zip",hint:"一个 ZIP，不含 API Key"});if(!path)return;const r=await rpc("export",{path},0);if(r)toast("已导出到 "+r);return;}
 case "chat-send":return chatSend(pid);
 case "chat-starter":return chatSend(pid,a.dataset.say);
 case "chat-retry":return chatRetry(pid);
 case "chat-bottom":{const s=Dock.els[pid]?.querySelector(".chat-scroll");if(Chat[pid])Chat[pid].bottom=true;if(s)s.scrollTo({top:s.scrollHeight,behavior:"smooth"});return toBottomButton(pid);}
 case "chat-topic-menu":return topicMenu(pid,a);
 case "chat-attach":return attachMenu(pid,a);
 case "chat-attach-add":{const st=Chat[pid];if(st&&!st.attach.some(x=>x.path===a.dataset.path))st.attach.push({path:a.dataset.path});updateComposer(pid);return Dock.els[pid]?.querySelector(".composer textarea")?.focus();}
 case "chat-attach-pick":{const picked=await pickPath({mode:"files",title:"附上文件",ok:"附上",hint:"会复制进学习库的 data/附件/，原文件不动"});if(!picked?.length)return;const paths=await rpc("attach_files",{paths:picked},0);const st=Chat[pid];if(!paths?.length||!st)return;
  paths.forEach(x=>{if(!st.attach.some(y=>y.path===x))st.attach.push({path:x});});await refreshState();updateComposer(pid);return Dock.els[pid]?.querySelector(".composer textarea")?.focus();}
 case "chat-attach-sel":{const st=Chat[pid];if(st&&Sel.text){st.quote=Sel.text;clearSelection();updateComposer(pid);}return Dock.els[pid]?.querySelector(".composer textarea")?.focus();}
 case "att-open":return openAttachment(a.dataset.path);
 case "chat-attach-remove":Chat[pid]?.attach.splice(Number(a.dataset.index),1);return updateComposer(pid);
 case "chat-effort":{const p=Dock.panels[pid];if(!p)return;if(a.dataset.value)p.effort=a.dataset.value;else delete p.effort;saveLayout();updateComposer(pid);
  if(Menus.reopen)Menus.reopen();return;}
 case "chat-model":return modelMenu(pid,a.closest(".menu")?Dock.els[pid]?.querySelector(".model-tag")||a:a);
 case "chat-model-set":return setChatModel(pid,a.dataset.api,a.dataset.model);
 case "chat-model-other":{const m=chatModel(pid),name=await askText("模型名",m.model,{hint:"用「"+((S.config?.apis||[]).find(x=>x.id===m.api)?.label||m.api)+"」这个连接",ok:"换上"});if(name&&name.trim())setChatModel(pid,m.api,name.trim());return;}
 case "msg-copy":{const m=Chat[pid]?.data?.messages.find(x=>String(x.id)===a.dataset.mid);if(m){await writeClipboard(m.content);toast("已复制");}return;}
 case "zoom-step":{const dir=Number(a.dataset.dir),again=Menus.reopen;stepZoom(pid,dir||0);if(dir&&again)again();return;}
 case "chat-more":return chatMoreMenu(pid,a);
 case "view-step":case "view-set":case "view-reset":case "ui-set":case "ui-step":{
  const again=Menus.reopen,key=a.dataset.key,p=Dock.panels[pid];
  if(kind==="view-step"){
   if(key==="zoom")stepZoom(pid,Number(a.dataset.dir));
   else if(key==="read_width")setView(pid,key,Math.min(120,Math.max(20,(readChars(viewOf(p,key))||42)+Number(a.dataset.dir)*2)));
   else setView(pid,key,Math.round(Math.min(2.4,Math.max(1.3,(Number(viewOf(p,key))||1.8)+Number(a.dataset.dir)*.1))*100)/100);
  }
  else if(kind==="view-set")setView(pid,key,key==="read_width"&&a.dataset.value==="toggle"?(readChars(viewOf(p,key))?"none":readChars(S.ui.read_width)||42):a.dataset.value);
  else if(kind==="view-reset"){setZoom(pid,null);VIEW_KEYS.forEach(k=>setView(pid,k,null));}
  else{
   const step={font_size:[.5,11,24],code_font_size:[.5,10,24]}[key];
   S.ui[key]=kind==="ui-step"?Math.min(step[2],Math.max(step[1],(Number(S.ui[key])||14)+Number(a.dataset.dir)*step[0])):a.dataset.value;
   applyUi();saveUi();if(key==="thinking")Object.keys(Chat).forEach(x=>{Chat[x].thoughts={};Chat[x].liveOpen=null;renderChat(x);});
  }
  if(again)again();return;
 }
 case "chat-copy-all":await writeClipboard(conversationMarkdown(pid));return toast("整段对话已复制（Markdown）");
 case "chat-save-note":{const st=Chat[pid],topic=st.data?.head?.topic||null;
  const r=await rpc("doc_create",{kind:"note",title:"对话 · "+(topic?topicTitle(topic):agentTitle(Dock.panels[pid].agent))+" · "+fmtDate(new Date().toISOString()),topic,body:conversationMarkdown(pid)});
  await refreshState();return openFile(r.path);}
 case "zoom-reset-all":Object.keys(Dock.panels).forEach(x=>{if(Dock.panels[x].zoom)setZoom(x,null);});return toast("所有窗口都回到了各自面板的默认大小");
 case "chat-cancel":return rpc("cancel",{thread:Chat[pid].thread});
 case "chat-task":return chatSend(pid,"",{task:a.dataset.task});
 case "chat-new":{if(!await ask("之前的对话还在，可以在学习库的 threads/ 里找到，也能被搜索到。",{title:"开一段新会话？",ok:"开新会话"}))return;await rpc("thread_new",{agent:Dock.panels[pid].agent,topic:S.data.active_topic||""});return loadChat(pid,false);}
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
  const [message,index]=a.dataset.key.split(":");const chatPid=a.closest(".panel").dataset.pid,src=Chat[chatPid],question=block.dataset.question||"";
  const sent={message:Number(message),block:Number(index),question};
  if(Dock.panels[chatPid]?.agent!=="tutor")return chatSend(chatPid,"我的回答："+answer,{answer:sent,selection:""});
  // The tutor's small questions are checked by the quick-answer side, so the explanation is not interrupted.
  let side=Object.keys(Chat).find(x=>Dock.panels[x]?.agent==="flash"&&!Dock.panels[x].thread);
  if(!side)side=openPanel({type:"chat",agent:"flash"});else if(!Dock.els[side]?.offsetParent)activate(side);
  for(let i=0;i<60&&!Chat[side]?.data;i++)await new Promise(r=>setTimeout(r,100));
  if(!Chat[side]?.data)return toast("快答还没打开，等一下再交","error");
  await chatSend(side,"我的回答："+answer,{answer:{...sent,thread:src.thread},selection:"主会话的小问题："+shorten(question.replace(/[#*`]/g,""),400)});
  src.data.answers={...(src.data.answers||{}),[a.dataset.key]:answer};renderChat(chatPid);
  return toast("交给快答看了，主会话接着讲");
 }
 case "card-reveal":{const card=a.closest(".mini-card");card.querySelector(".mini-answer").hidden=false;a.parentElement.remove();return;}
 case "code-copy":{const n=el("#"+a.dataset.target);if(n){await writeClipboard(n.textContent);toast("已复制");}return;}
 case "code-run":{const n=el("#"+a.dataset.target);if(!n)return;const r=await rpc("run",{code:n.textContent,lang:a.dataset.lang});snippetRuns[a.dataset.target]={run:r.run,outputs:[]};
  const box=el('[data-snippet="'+a.dataset.target+'"]');if(box)box.innerHTML='<div class="run-head"><span class="run-state s-running">运行中…</span></div>';return;}
 case "code-take":{const n=el("#"+a.dataset.target);if(!n)return;const ext=CODE_EXT[(a.dataset.lang||"").toLowerCase()]||".txt";
  const name=await askText("存成哪个文件","片段-"+new Date().toLocaleTimeString("zh-CN",{hour12:false}).replace(/:/g,"")+ext,{hint:"放在 code/ 里",selectStem:true,ok:"存下"});if(!name)return;
  const r=await rpc("file_create",{folder:"code",name,content:n.textContent});await refreshState();return openFile(r.path);}
 case "quote-clear":if(Chat[pid])Chat[pid].quote="";return updateComposer(pid);
 case "ask-flash":case "ask-tutor":{
  // Hands the selection to that conversation's input and waits for the learner's own question.
  const agent=kind==="ask-flash"?"flash":"tutor",text=Sel.text;clearSelection();
  let target=Object.keys(Chat).find(x=>Dock.panels[x]?.agent===agent&&!Dock.panels[x].thread);
  if(!target)target=openPanel({type:"chat",agent});else activate(target);
  const go=()=>{if(!Chat[target]?.data)return setTimeout(go,150);Chat[target].quote=text;updateComposer(target);Dock.els[target]?.querySelector(".composer textarea")?.focus();};
  return go();
 }
 case "theme-color":return themeColorPick(a);
 case "sc-window":case "sc-all-left":case "sc-reset":case "sc-rebase":case "sc-history":case "sc-compare":case "sc-try-q":case "sc-dismiss":case "sc-approve":return changeAction(kind,a);
 case "sc-restore":return restoreVersion(a);
 case "open-change":return wideWindow(openPanel({type:"skillchange",change:a.dataset.change}));
 case "cmp-stop":case "cmp-window":case "cmp-pick":return compareAction(kind,a);
 case "organizer-dismiss":Organizer.text="";return renderOrganizer();
 case "topic-focus":{await rpc("focus",{topic:a.dataset.id});await refreshState();followingPanels().forEach(x=>loadChat(x));
  let tutor=Object.keys(Chat).find(x=>Dock.panels[x]?.agent==="tutor"&&!Dock.panels[x].thread);if(!tutor)openPanel({type:"chat",agent:"tutor"});else activate(tutor);return;}
 case "topic-delete":{if(!await ask("里面的卡片、笔记和对话都会留下，只是不再属于它。主题文件会留在学习库的历史里。",{title:"删除这个主题？",...{danger:true,ok:"删除"}}))return;
  await rpc("topic_delete",{id:a.dataset.id});const p=a.closest(".panel")?.dataset.pid;if(p)await closePanel(p);await refreshState();return followingPanels().forEach(x=>loadChat(x));}
 case "version-view":case "version-restore":return versionAction(kind,a);
 case "file-history":return showHistory(pid);
 }
 if(kind.startsWith("space")||kind==="stack-unkeep"){const r=await spaceAction(kind,a);if(r!==null)return r;}
 if(kind.startsWith("grid-")){const r=gridAction(kind,a);if(r!==null)return r;}
 if(kind.startsWith("skill-")){const r=await skillAction(kind,a);if(r!==null)return r;}
 if(/^(note-|noteinfo-|folder-new|ni-|switcher-)/.test(kind)){const r=await notesAction(kind,a);if(r!==null)return r;}
 if(a.closest(".panel-settings")){const r=await settingsAction(kind,a);if(r!==null)return r;}
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
 if(!text.trim()){if(Sel.text)clearSelection();else hidePop();return;}
 Sel.text=text.slice(0,5000);Sel.el=t.tagName==="TEXTAREA"||t.tagName==="INPUT"?t:null;reportScreen();
 if(!rect||S.ui.selection_popup===false)return;hidePop();
 const pop=h('<div id="sel-pop"><button data-action="ask-flash">'+svg("spark",13)+' 问快答</button><button data-action="ask-tutor">'+svg("bot",13)+' 问主会话</button></div>');
 document.body.appendChild(pop);
 const x=Math.min(Math.max(8,rect.left+rect.width/2-pop.offsetWidth/2),innerWidth-pop.offsetWidth-8),y=rect.top-pop.offsetHeight-8;
 pop.style.left=x+"px";pop.style.top=(y<8?rect.bottom+8:y)+"px";
}
/* ---- wiring ------------------------------------------------------------------------------------------------------------- */
function initInteractions(){
 initDock();
 document.addEventListener("click",e=>{
  const wiki=e.target.closest("a[data-wiki]");
  if(wiki){e.preventDefault();safe(()=>openWiki(wiki.dataset.wiki,wiki.closest(".panel")?.dataset.pid));return;}
  const tag=e.target.closest("a.tag[data-tag]");if(tag){e.preventDefault();showTag(tag.dataset.tag);return;}
  // Web links open in the reader; with Ctrl, in the browser.
  const link=e.target.closest(".markdown a[href^='http']");if(link){e.preventDefault();openWeb(link.href,link.closest(".panel")?.dataset.pid,e.ctrlKey||e.metaKey);return;}
  if(!e.target.closest(".menu,[data-action='new-menu'],[data-action='stack-add']")){closeMenus();Dock.into=null;}
  if(e.target.closest("[data-dismiss]")&&e.target===e.target.closest("[data-dismiss]")){closeModal();return;}
  const a=e.target.closest("[data-action]");if(a&&!a.disabled)safe(()=>onAction(a));
 });
 document.addEventListener("input",e=>{
  const t=e.target;
  if(t.id==="palette-q")return t.dataset.switcher!=null?switcherFilter(t.value):paletteFilter(t.value);
  if(t.dataset.niTagQuery){const p=Dock.panels[t.dataset.niTagQuery];if(p){p.tagQuery=t.value;renderTags(t.dataset.niTagQuery).then(()=>{const f=el('[data-ni-tag-query="'+t.dataset.niTagQuery+'"]');if(f){f.focus();f.setSelectionRange(f.value.length,f.value.length);}});}return;}
  if(t.dataset.composer){
   const pid=t.dataset.composer;if(Chat[pid])Chat[pid].input=t.value;fitComposer(pid);
   // A / on its own picks a skill for this message.
   if(t.value==="/"){t.value="";if(Chat[pid])Chat[pid].input="";safe(()=>skillMenu(pid,t.closest(".capsule")||t));}
   return;}
  if(t.dataset.uiRange){S.ui[t.dataset.uiRange]=Number(t.value);const out=t.parentElement.querySelector("[data-range-out]");if(out)out.textContent=t.value+" 字";applyUi();return saveUi();}
  if(t.dataset.apiQuery!==undefined){Settings.apiQuery=t.value;const n=t.closest(".panel");renderSettings(n,"apis").then(()=>{const f=n.querySelector("[data-api-query]");if(f){f.focus();f.setSelectionRange(f.value.length,f.value.length);}});return;}
  if(t.closest?.(".panel-settings")&&settingsAutosave(t,false))return;
  if(t.dataset.sideInput&&sideInput(t))return;
  if(t.dataset.libQuery&&libraryInput(t))return;
  if(fileInput(t))reportScreen();
 });
 document.addEventListener("change",e=>{
  const t=e.target;
  if(t.dataset.mapTopic!==undefined){Dock.panels[t.dataset.mapTopic].topic=t.value||null;saveLayout();refreshTab(t.dataset.mapTopic);return loadMap(t.dataset.mapTopic);}
  if(t.dataset.journalType!==undefined){Dock.panels[t.dataset.journalType].group=t.value;saveLayout();return loadJournal(t.dataset.journalType);}
  if((t.dataset.libTopic||t.dataset.libSort||t.dataset.libDue)&&libraryInput(t))return;
  if(t.dataset.journalDays!==undefined){Dock.panels[t.dataset.journalDays].days=Number(t.value);saveLayout();return loadJournal(t.dataset.journalDays);}
  if(t.closest(".panel-settings")&&settingsChange(t))return;
  safe(()=>fileChange(t));
 });
 document.addEventListener("keydown",e=>{
  const mod=e.ctrlKey||e.metaKey,t=e.target;
  // A key the editor already used (bold, indent, its search…) is not also a program shortcut.
  if(e.defaultPrevented&&t.closest?.(".cm-editor"))return;
  if(e.key==="Escape"){if(el(".modal-backdrop")){closeModal();return;}closeMenus();hidePop();return;}
  if(el("#palette-list")&&["ArrowDown","ArrowUp","Enter"].includes(e.key)){
   const items=all("#palette-list .pal-item");if(!items.length)return;
   if(e.key==="Enter"){if(t.id==="palette-q"){e.preventDefault();items[0].click();}return;}
   e.preventDefault();const at=items.indexOf(document.activeElement),next=e.key==="ArrowDown"?Math.min(at+1,items.length-1):at-1;
   if(next<0)el("#palette-q")?.focus();else items[next].focus();return;
  }
  if((t.dataset?.composer||t.classList?.contains("quiz-free"))&&e.key==="Enter"&&!e.isComposing&&e.keyCode!==229){
   const send=S.ui.send_key==="ctrl"?mod:!e.shiftKey&&!mod;
   if(send){e.preventDefault();if(t.dataset.composer)safe(()=>chatSend(t.dataset.composer));else t.closest(".lblock")?.querySelector('[data-action="quiz-answer"]')?.click();}
   return;
  }
  if(mod&&!e.altKey&&["=","+","-","0"].includes(e.key)){const pid=panelHere();if(pid){e.preventDefault();stepZoom(pid,e.key==="0"?0:e.key==="-"?-1:1);}return;}
  if(fileKey(e))return;
  if(mod&&e.key.toLowerCase()==="k"){e.preventDefault();palette();return;}
  if(mod&&e.key.toLowerCase()==="o"){e.preventDefault();switcher();return;}
  if(mod&&e.key.toLowerCase()==="s"){e.preventDefault();safe(async()=>{await flushAll();toast("已保存");});return;}
  if(mod&&e.key.toLowerCase()==="n"){e.preventDefault();safe(()=>newScratch("note"));return;}
  if(mod&&e.key.toLowerCase()==="j"){e.preventDefault();const f=Object.keys(Chat).find(x=>Dock.panels[x]?.agent==="flash")||openPanel({type:"chat",agent:"flash"});activate(f);setTimeout(()=>Dock.els[f]?.querySelector(".composer textarea")?.focus(),50);return;}
  if(mod&&e.key.toLowerCase()==="b"){e.preventDefault();setSideOpen(!sideOpen());return;}
  if(mod&&!e.altKey&&!e.shiftKey&&/^[1-9]$/.test(e.key)){const sp=visibleSpaces()[Number(e.key)-1];if(sp){e.preventDefault();switchSpace(sp.id);}return;}
  if(mod&&e.key.toLowerCase()==="w"&&Dock.focus){e.preventDefault();safe(()=>closePanel(Dock.focus));return;}
 });
 // Ctrl + wheel sizes the window under the mouse, not the whole program.
 let wheel=0;
 document.addEventListener("wheel",e=>{
  if(!e.ctrlKey)return;e.preventDefault();e.stopPropagation();
  const pid=e.target.closest?.(".panel")?.dataset.pid;if(!pid)return;
  wheel+=e.deltaY;if(Math.abs(wheel)<60)return;stepZoom(pid,wheel<0?1:-1);wheel=0;
 },{passive:false,capture:true});
 document.addEventListener("contextmenu",e=>{
  const tab=e.target.closest?.(".tab"),space=e.target.closest?.(".act.space");
  if(tab){e.preventDefault();tabMenu(tab.dataset.pid,{x:e.clientX,y:e.clientY});}
  else if(space){e.preventDefault();const r=space.getBoundingClientRect();spaceMenu(space.dataset.space,{x:r.right+8,y:r.top});}
 });
 document.addEventListener("mouseup",e=>{if(e.button!==2)setTimeout(()=>onSelect(e),0);});
 document.addEventListener("scroll",()=>{hidePop();reportScreen();},true);
 addEventListener("resize",reportScreen);
 document.addEventListener("focusin",()=>reportScreen());
 setInterval(trackDwell,2000);
 setInterval(()=>safe(flushAll),25000);
}
async function boot(){
 try{
  if(typeof qt==="undefined"||!qt.webChannelTransport)throw new Error("必须由 Lattice 桌面程序启动（缺少本地 Qt WebChannel）");
  new QWebChannel(qt.webChannelTransport,async channel=>{
   try{
    S.bridge=channel.objects.backend;
    S.bridge.event.connect(raw=>safe(()=>onEvent(JSON.parse(raw))));
    S.data=await rpc("bootstrap");S.config=S.data.config;S.ui=S.config.ui;
    el("#app").innerHTML='<div id="shell"><nav id="activity"></nav><aside id="side"></aside><div id="side-gutter"></div><div id="dock-wrap"><div id="dock"></div><div id="floats"></div></div></div>'+
     '<footer id="status"></footer><div id="organizer" hidden></div><div id="drop-mark"></div><datalist id="doc-titles"></datalist>';
    applyUi();initInteractions();initSideResize();loadLayout(S.data.layout);await refreshState();renderSide();reportScreen();
    if(S.data.migrated)toast("已把原来的学习数据迁移成文件，放在 "+S.data.vault);
    if(S.data.problems?.length)console.warn("读不了的文件",S.data.problems);
   }catch(err){console.error(err);el("#app").innerHTML='<div class="boot">初始化失败：'+esc(err.message)+'<br/><button class="btn" onclick="location.reload()">重试</button></div>';}
  });
 }catch(e){el("#app").innerHTML='<div class="boot">'+esc(e.message)+'</div>';}
}
window.addEventListener("beforeunload",()=>{try{flushAll();}catch(_){}});
document.addEventListener("DOMContentLoaded",boot);
