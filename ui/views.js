"use strict";
/* Lattice Views: functional panels backed by live local data. */
function dashboard(){
 const d=S.data,stat=d.stats||{},notes=(d.notes||[]).slice(0,7),labs=(d.experiments||[]).slice(0,5);
 return '<div class="page"><div class="page-header">'+
 '<div><h1 class="page-title">回到你正在做的事。</h1>'+
 '<p class="page-sub">'+esc(dateToday())+' · '+esc(stat.notes||0)+' 篇笔记 · '+esc(stat.experiments||0)+' 个实验 · '+esc(stat.sessions||0)+' 段协作</p></div>'+
 '<div class="header-actions">'+button(svg("plus")+' 新笔记',"new-note","","primary")+'</div></div>'+
 '<div class="two-columns">'+
 '<div class="stack">'+
 '<section class="card"><div class="card-header"><span class="card-title">最近在思考</span>'+
 '<button class="btn ghost sm" data-action="nav" data-view="notes">全部笔记 '+svg("arrow",13)+'</button></div>'+
 (notes.length?notes.map(n=>'<button class="list-row" data-action="open-note" data-id="'+esc(n.id)+'">'+
 '<span class="list-row-icon">'+svg("document")+'</span><span class="list-row-main"><strong>'+esc(n.title)+'</strong>'+
 '<span>'+esc(n.folder)+' · '+esc(shorten(n.body.replace(/[#*]/g,""),67))+'</span></span>'+
 '<span class="arrow">'+svg("chevron",14)+'</span></button>').join(""):'<div style="padding:22px" class="muted">还没有笔记。</div>')+
 '</section>'+
 '<section class="card"><div class="card-header"><span class="card-title">实验记录</span>'+
 '<button class="btn ghost sm" data-action="nav" data-view="labs">进入实验室 '+svg("arrow",13)+'</button></div>'+
 (labs.length?labs.map(l=>'<button class="list-row" data-action="open-lab" data-id="'+esc(l.id)+'">'+
 '<span class="list-row-icon">'+svg("flask")+'</span><span class="list-row-main"><strong>'+esc(l.title)+'</strong>'+
 '<span>'+esc(l.question||"验证一个想法")+'</span></span><span class="pill '+(l.status==="completed"?"accent":"")+'">'+esc(l.status)+'</span></button>').join(""):
 '<div style="padding:22px;color:var(--muted);font-size:12px">还没有实验。把一条猜测变成可运行的程序吧。</div>')+
 '</section></div>'+
 '<div class="stack">'+
 '<section class="card"><div class="card-header"><span class="card-title">接下来做什么</span>'+
 '<button class="btn ghost sm" data-action="add-task">'+svg("plus",13)+' 添加</button></div>'+
 '<div>'+((d.tasks||[]).slice(0,8).map(t=>
 '<label class="check-row '+(t.done?"done":"")+'"><input type="checkbox" data-task="'+esc(t.id)+'" '+(t.done?"checked":"")+'/><span>'+esc(t.label)+'</span></label>'
 ).join("")||'<div style="padding:18px" class="muted">还没有待办事项</div>')+'</div></section></div></div></div>';
}
function workItem(id,title,subtitle,selected,icon){
 return '<button class="work-item '+(selected?"active":"")+'" data-action="'+esc(icon)+'" data-id="'+esc(id)+'"><strong>'+esc(title)+'</strong>'+
 '<small>'+esc(subtitle)+'</small></button>';
}
function notesListItems(){
 const term=S.noteFilter.toLowerCase().trim();
 const notes=(S.data.notes||[]).filter(n=>(S.noteFolder==='All'||n.folder===S.noteFolder)&&(!term||[n.title,n.body,...(n.tags||[])].join(' ').toLowerCase().includes(term)));
 return notes.map(n=>detailCard('note',n.id,n.title,n.folder+' · '+fmtDate(n.updated_at),()=>notePageBody(n.id))).join('')||'<div class="learn-empty"><h3>没有匹配的笔记</h3><p>调整搜索条件，或新建一篇笔记。</p></div>';
}
function notePane(n){
 return '<div class="note-head">'+
 '<input id="note-title" class="note-title" placeholder="笔记标题" value="'+esc(n.title)+'"/>'+
 '<div class="note-meta">'+
 '<select id="note-folder">'+["Knowledge","Daily","Ideas","Projects","Home","Research","Imported"].filter((x,i,a)=>a.indexOf(x)===i).concat([n.folder]).filter((x,i,a)=>a.indexOf(x)===i).map(f=>
 '<option '+(n.folder===f?"selected":"")+' value="'+esc(f)+'">'+esc(f)+'</option>').join("")+'</select>'+
 '<input id="note-tags" placeholder="标签，以逗号分开" title="标签，以逗号分开" value="'+esc((n.tags||[]).join(", "))+'"/>'+
 '<span id="note-saved" class="save-state">已保存 · '+esc(fmtDate(n.updated_at,true))+'</span></div></div>'+
 '<div class="note-content '+(S.noteMode==="edit"?"edit-only":S.noteMode==="preview"?"preview-only":"")+'">'+
 '<textarea id="note-body" spellcheck="false" class="markdown-editor" placeholder="从这里开始思考…&#10;&#10;## 我真正想理解的是什么？&#10;&#10;[[链接另一条笔记]]">'+esc(n.body)+'</textarea>'+
 '<div class="markdown-preview markdown" id="note-preview">'+markdown(n.body)+'</div></div>'+
 '<div class="note-footer"><span>Markdown · [[双向链接]] · 本地修订版本</span><span>'+n.body.length+' 字符</span></div>';
}
function notesView(){
 const folders=['All',...new Set((S.data.notes||[]).map(n=>n.folder))];
 return '<section class="flat-page"><div class="flat-heading"><div><h1>知识笔记</h1><p>'+(S.data.notes||[]).length+' 篇笔记 · 点击展开编辑，再次点击收起。</p></div>'+button(svg('plus',14)+' 新建笔记','new-note','','primary')+'</div>'+
 '<div class="flat-toolbar"><input id="note-filter" class="search-input" aria-label="搜索笔记" placeholder="搜索笔记…" value="'+esc(S.noteFilter)+'"/>'+
 '<select id="note-folder-filter" class="field" aria-label="笔记分类">'+folders.map(f=>'<option value="'+esc(f)+'" '+(S.noteFolder===f?'selected':'')+'>'+esc(f==='All'?'全部分类':f)+'</option>').join('')+'</select></div>'+
 '<div class="flat-grid notes-grid">'+notesListItems()+'</div></section>';
}
function labsView(){
 const labs=S.data.experiments||[],lab=S.lab;
 let right=lab?('<div class="work-toolbar"><div class="path">EXPERIMENT <span style="margin:0 7px">/</span> '+esc(lab.id.slice(0,7))+'</div>'+
 '<div class="work-actions"><span id="lab-state" class="run-state '+esc(lab.status)+'"><i class="dot"></i>'+esc(lab.status)+'</span>'+
 '<button class="icon-btn" data-action="open-lab-dir" title="打开实验目录">'+svg("folder",15)+'</button>'+
 '<button class="btn ghost sm" data-action="lab-history">'+svg("history")+' 运行历史</button>'+ 
 '<button class="btn ghost sm" data-action="save-lab">'+svg("save")+' 保存</button>'+
 '<button class="btn primary sm" data-action="run-lab">'+svg("play")+' 运行</button>'+
 '<button class="btn danger sm" data-action="stop-lab">'+svg("stop")+' 停止</button></div></div>'+
 '<div class="lab-main" data-scroll="lab-main" data-scroll-ns="'+esc(S.labId)+'"><input id="lab-title" class="lab-title" value="'+esc(lab.title)+'" placeholder="给实验起一个名字"/>'+
 '<div class="lab-description">探索问题 → 建立假设 → 亲手验证 → 解释观测结果</div>'+
 '<div class="form-grid"><div class="form-group"><label>01 / 我想弄明白的问题</label>'+
 '<textarea id="lab-question" class="field" placeholder="我们究竟想解释哪个现象？">'+esc(lab.question)+'</textarea></div>'+
 '<div class="form-group"><label>02 / 我的假设与可证伪条件</label>'+
 '<textarea id="lab-hypothesis" class="field" placeholder="如果我猜得对，应该看到什么结果？">'+esc(lab.hypothesis)+'</textarea></div></div>'+
 '<div class="lab-heading"><span>03 / 可执行的 Python 实验</span>'+
 '<div class="flex"><span class="subtle text-xs mono">main.py</span>'+
 '<button class="btn ghost sm" data-action="copy-lab">'+svg("copy")+' 复制代码</button></div></div>'+
 '<textarea class="code-area" id="lab-code" spellcheck="false" placeholder="# 在这里用代码验证假设&#10;print(&quot;Hello, Lattice!&quot;)">'+esc(lab.code)+'</textarea>'+
 '<div class="lab-heading terminal-head"><span>04 / 实际运行输出</span><span id="lab-output-label" class="text-xs subtle">由本地 Python 运行产生</span></div>'+
 '<div id="lab-output" class="terminal">'+(lab.output?esc(lab.output):'<span class="hint">$ 点击右上角「运行」，这里将显示真实输出。没有运行过的实验不会自动填入结果。</span>')+'</div>'+
 '<p style="color:var(--subtle);font-size:10.5px;line-height:1.9;margin-top:12px">实验脚本保存在本机独立目录中。输出与执行状态会写入实验记录，支持之后反复比较。</p></div>'):
 emptyState("flask","实验从一个问题开始","建立假设，编写几行代码，让运行结果为理解提供证据。","创建第一个实验","new-lab");
 return '<div class="work-layout"><aside class="work-sidebar"><div class="work-sidehead"><div class="work-side-title">实验室 <span class="subtle" style="font-size:11px">'+labs.length+'</span></div>'+
 '<button class="btn primary" data-action="new-lab" style="width:100%">'+svg("plus")+' 新建实验</button></div>'+
 '<div class="work-list">'+labs.map(l=>workItem(l.id,l.title,l.status+" · "+fmtDate(l.updated_at),S.labId===l.id,"open-lab")).join("")+'</div></aside>'+
 '<div class="work-pane">'+right+'</div></div>';
}
function chatMessage(m){
 const user=m.role==="user";
 const body=user?'<div>'+esc(m.content)+'</div>':'<div class="markdown">'+markdown(m.content)+'</div>';
 return '<div class="message '+(user?"user":"assistant")+'"><div class="avatar">'+(user?"我":svg("spark",15))+'</div>'+
 '<div class="message-body"><div class="who">'+(user?"你":"AI Agent")+'</div>'+
 '<div class="message-text">'+body+'</div>'+
 (!user?'<div class="message-actions">'+
 '<button data-action="capture-message" data-id="'+esc(m.id)+'">'+svg("book",13)+' 沉淀为笔记</button>'+
 '<button data-action="copy-message" data-id="'+esc(m.id)+'">'+svg("copy",13)+' 复制</button></div>':"")+
 '</div></div>';
}
function chatMessages(messages){
 if(!(messages||[]).length)return '<div class="chat-empty"><div class="orb">'+svg("spark",36)+'</div>'+
 '<h2>和 AI 一起，让问题变得清晰。</h2>'+
 '<p>挑一个真实困惑。你们可以从直觉出发、修改代码、构造实验，再把得到的知识保留下来。</p>'+
 '<div class="prompt-chips">'+
 ['解释 Attention 为什么会出现','从零设计最小 Transformer','帮我找这个实验的反例'].map(t=>
 '<button data-action="insert-prompt" data-prompt="'+esc(t)+'">'+esc(t)+'</button>').join("")+'</div></div>';
 return messages.map(chatMessage).join("");
}
function isLearningSession(s){return s&&(s.agent==="deepseek"||/^主讲 · /.test(s.title||""));}
function agentView(){
 const sessions=(S.data.sessions||[]).filter(s=>!isLearningSession(s)),active=sessions.find(s=>s.id===S.sessionId)||null;
 const messages=S.agentMessages||[];
 let content=active?(
 '<div class="chat-shell"><div class="chat-header"><div class="chat-heading"><div class="agent-avatar '+(active.agent==="devin"?"devin":"")+'">'+
 (active.agent==="codex"?"C":"D")+'</div><div><strong>'+esc(active.title)+'</strong>'+
 '<small>'+esc(active.agent==="codex"?"Codex · 已有 ChatGPT 订阅":"Devin · SWE-2 High")+
 ' · <span id="agent-status">'+esc(S.agentStatus)+'</span></small></div></div>'+
 '<div class="work-actions">'+
 '<button class="btn ghost sm" data-action="rename-session">'+svg("edit")+' 重命名</button>'+
 '<button class="btn ghost sm" data-action="new-session">'+svg("plus")+' 新会话</button></div></div>'+
 '<div class="chat-messages" id="chat-scroll" data-scroll="chat-agents" data-scroll-ns="'+esc(S.sessionId)+'">'+chatMessages(messages)+
 (S.streaming?'<div class="message assistant" id="stream-row"><div class="avatar">'+svg("spark",15)+'</div>'+
 '<div class="message-body"><div class="who">AI Agent · 正在回答</div>'+
 '<div class="message-text markdown" id="streaming-text">'+markdown(S.streaming)+'</div></div></div>':"")+
 '</div><div class="chat-footer"><div class="chat-composer">'+
 '<textarea id="chat-input" placeholder="告诉 AI 你想弄明白什么，或者让它执行一个实验…"></textarea>'+
 '<div class="composer-row"><span class="composer-hint">Enter 换行 · Ctrl+Enter 发送 · 需要权限时会询问你</span>'+
 '<div class="composer-actions"><button class="btn ghost sm" data-action="agent-cancel">'+svg("stop",12)+' 停止</button>'+
 '<button class="btn primary sm" data-action="agent-send">'+svg("arrowup",14)+' 发送</button></div></div></div></div></div>'
 ):emptyState("bot","一个对话就能成为一段探索。","Codex 与 Devin SWE-2 已通过本地 CLI 接入，能够访问你选择的项目目录。","开始新的 AI 会话","new-session");
 return '<div class="work-layout"><aside class="work-sidebar"><div class="work-sidehead">'+
 '<div class="work-side-title">AI 会话 <span class="subtle" style="font-size:11px">'+sessions.length+'</span></div>'+
 '<button class="btn primary" data-action="new-session" style="width:100%">'+svg("plus")+' 新建会话</button></div>'+
 '<div class="work-list">'+sessions.map(s=>workItem(s.id,s.title,(s.agent==="codex"?"Codex":"Devin")+" · "+fmtDate(s.updated_at),S.sessionId===s.id,"open-session")).join("")+'</div></aside>'+
 '<div class="work-pane">'+content+'</div></div>';
}
function graphView(){
 const folders=["All",...new Set((S.data.notes||[]).map(n=>n.folder))];
 return '<div style="height:100%"><div class="graph-toolbar"><div><div class="overline">KNOWLEDGE CONSTELLATION</div>'+
 '<div style="font-size:17px;font-weight:680;margin-top:6px">知识并非孤岛。</div></div>'+
 '<div class="flex"><span class="text-xs subtle">'+(S.data.graph?.nodes?.length||0)+' 节点 · '+(S.data.graph?.edges?.length||0)+' 连接</span>'+
 '<select id="graph-filter" class="field" style="width:133px">'+folders.map(f=>
 '<option value="'+esc(f)+'" '+(S.graphFilter===f?"selected":"")+'>'+esc(f==="All"?"所有分类":f)+'</option>').join("")+'</select></div></div>'+
 '<div class="graph-stage">'+(S.data.graph?.nodes?.length?'<div id="main-cy" class="main-cy" role="img" aria-label="笔记知识网络"></div>':emptyState("network","还没有知识网络","在笔记中使用 [[笔记标题]] 就能建立关联。","新建笔记","new-note"))+
 '<div class="graph-guide">点击节点进入笔记 · 关联来自 Markdown 双向链接</div></div></div>';
}
function mountNoteGraph(){
 const c=document.getElementById("main-cy");if(!c)return;
 const g=S.data.graph||{nodes:[],edges:[]};
 const filter=S.graphFilter||"All";
 const nodes=g.nodes.filter(n=>filter==="All"||n.folder===filter).slice(0,180);
 const ids=new Set(nodes.map(n=>n.id));
 mountCytoscape(c,{
  elements:[
   ...nodes.map(n=>({data:{id:n.id,label:n.title,folder:n.folder,degree:n.degree||0}})),
   ...g.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)).map((e,i)=>({data:{id:"e"+i,source:e.source,target:e.target}}))],
  style:[
   {selector:"node",style:{"background-color":"#8bdcc5","label":"data(label)","color":"#c9d6e4","font-size":11,"font-family":"inherit","text-valign":"bottom","text-margin-y":7,"width":"mapData(degree,0,8,26,58)","height":"mapData(degree,0,8,26,58)","border-width":2,"border-color":"#0e141b","text-wrap":"ellipsis","text-max-width":"112px"}},
   {selector:'node[folder="Home"]',style:{"background-color":"#b5a8fa"}},
   {selector:'node[folder="Daily"]',style:{"background-color":"#e0be88"}},
   {selector:"edge",style:{"width":1.3,"line-color":"#42566b","curve-style":"haystack","opacity":.5}},
   {selector:".faded",style:{"opacity":.15}}],
  layout:{name:"cose",animate:true,animationDuration:600,idealEdgeLength:120,nodeRepulsion:5200,gravity:.35},
  onTapNode:n=>openNote(n.id())});
}
function timelineView(){
 const events=S.data.events||[];
 return '<div class="timeline-wrap"><div class="overline">YOUR COGNITIVE TIMELINE</div><h1 class="timeline-title">思想，有迹可循。</h1>'+
 '<p class="timeline-sub">每一次笔记修改、实验运行和 Agent 会话都会留下事件。点开对应的笔记，还能查看之前写下的版本。</p>'+
 '<div class="flex mb-2">'+button(svg("refresh")+' 刷新时间线',"refresh","","ghost")+
 button(svg("download")+' 导出 Markdown',"export","","")+'</div>'+
 '<div class="timeline-line">'+events.map(e=>
 '<div class="timeline-row" data-action="timeline-event" data-kind="'+esc(e.kind)+'" data-id="'+esc(e.target||"")+'">'+
 '<div class="timeline-time">'+esc(fmtDate(e.at,true))+' · '+esc(e.kind.toUpperCase())+'</div>'+
 '<div class="timeline-event-title">'+esc(e.title)+'</div>'+
 '<div class="timeline-detail">'+esc(e.detail||"")+'</div></div>').join("")+
 (!events.length?'<div class="muted">学习历史会出现在这里。</div>':"")+'</div></div>';
}
function projectView(){
 const projects=S.data.projects||[];
 const active=projects.find(x=>x.id===S.projectId);
 const files=S.projectFiles||[];
 let pane;
 if(!active)pane=emptyState("folder","连接你的本地项目","把代码目录作为工作区接入。Lattice 只在你主动编辑或运行时修改文件。","选择文件夹","add-project");
 else if(!S.filePath)pane='<div class="work-toolbar"><span class="path">'+esc(active.path)+'</span>'+
 '<button class="btn ghost sm" data-action="open-project-dir">'+svg("external")+' 在文件管理器中打开</button></div>'+
 emptyState("code","选择一个文件开始","浏览项目源码、打开 Markdown 文档，或者切换到 Agent 让 AI 直接在目录中协作。",null,null);
 else pane='<div class="work-toolbar"><span class="path">'+esc(S.filePath)+'</span>'+
 '<div class="work-actions"><span class="subtle text-xs" id="file-dirty-status">'+(S.fileDirty?"尚未保存":"已加载")+'</span>'+
 '<button class="btn ghost sm" data-action="file-external">'+svg("external")+' 外部打开</button>'+
 '<button class="btn primary sm" data-action="file-save">'+svg("save")+' 保存文件</button></div></div>'+
 '<textarea id="project-editor" class="project-code" spellcheck="false">'+esc(S.fileContent)+'</textarea>';
 return '<div class="work-layout"><aside class="work-sidebar"><div class="work-sidehead">'+
 '<div class="work-side-title">代码工作区</div>'+
 '<select id="project-select" class="field">'+
 '<option value="">选择工作区</option>'+
 projects.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===S.projectId?"selected":"")+'>'+esc(p.name)+'</option>').join("")+'</select>'+
 '<div class="work-side-actions" style="margin-top:9px">'+
 '<button class="btn sm" style="flex:1" data-action="add-project">'+svg("plus")+' 添加目录</button>'+
 '<button class="btn sm" title="上级目录" data-action="project-up">'+svg("folder")+' 返回</button></div>'+
 '<div class="text-xs subtle truncate" style="margin-top:13px">'+esc(S.treePath||"/")+'</div></div>'+
 '<div class="work-list" id="file-tree">'+
 files.map(f=>'<button class="tree-folder" data-action="'+esc((f.type==="dir"?"project-enter":"project-file"))+'" data-path="'+esc(f.path)+'">'+
 svg(f.type==="dir"?"folder":"file",15)+'<span class="truncate">'+esc(f.name)+'</span>'+
 (f.type==="dir"?svg("chevron",12):"")+'</button>').join("")+
 '</div></aside><div class="work-pane">'+pane+'</div></div>';
}
function settingsView(){
 return '<div class="page"><div class="overline">CUSTOMISE · OWN · PRESERVE</div>'+
 '<h1 class="page-title">设置。</h1>'+
 '<p class="page-sub">模型连接、外观与数据迁移，全部只保存在本机。</p>'+
 '<div class="section-label" style="margin-top:26px">模型连接 · AI 通道</div>'+connectionsBody()+
 '<div class="section-label" style="margin-top:30px">工作台</div>'+
 '<div class="two-columns mt-3"><div class="stack">'+
 '<section class="card"><div class="card-header"><span class="card-title">外观与操作</span></div>'+
 '<div style="padding:20px"><div class="section-label">APPEARANCE</div>'+
 '<p class="muted text-sm">根据心情切换色彩。对话、知识图谱和实验可长期共存。</p>'+
 '<div class="flex">'+button(svg("moon")+' 深色',"set-dark","","")+button(svg("sun")+' 浅色',"set-light","","")+'</div>'+
 '<div class="divider"></div><div class="section-label">SHORTCUTS</div>'+
 '<p class="context-tip">Ctrl + K · 快速搜索<br>Ctrl + N · 新建笔记<br>Ctrl + S · 保存当前内容<br>Ctrl + Enter · 发送 AI 消息</p></div></section>'+
 '<section class="card"><div class="card-header"><span class="card-title">数据与迁移</span></div>'+
 '<div style="padding:20px"><p class="muted text-sm">支持无损导出 Markdown，也可以从已有笔记目录复制导入。导入不会修改原文件。</p>'+
 '<div class="flex" style="flex-wrap:wrap">'+button(svg("upload")+' 导入 Markdown',"import","","")+
 button(svg("download")+' 导出 Markdown',"export","","")+
 button(svg("folder")+' 打开数据目录',"open-data","","ghost")+'</div></div></section></div>'+
 '<div class="stack"><section class="card"><div class="card-header"><span class="card-title">关于 Lattice</span></div>'+
 '<div style="padding:20px"><div class="overline">VERSION 0.1</div>'+
 '<p class="muted text-sm">Qt 6 原生桌面外壳 · SQLite · Agent Client Protocol · 本地执行环境</p>'+
 '<p class="context-tip">以知识为中心，不强迫你进入某种固定的学习流程。笔记、实验和 Agent 都是互相可以引用的工具。</p></div></section></div></div></div>';
}
function viewHtml(){
 if(LEARNING_PAGES.has(S.view))return learningPage();
 if(S.view==="home")return dashboard();
 if(S.view==="notes")return notesView();
 if(S.view==="graph")return graphView();
 if(S.view==="labs")return labsView();
 if(S.view==="agents")return agentView();
 if(S.view==="timeline")return timelineView();
 if(S.view==="projects")return projectView();
 if(S.view==="settings")return settingsView();
 return dashboard();
}
function render(){
 hideSelPop();teardownLive();
 const sc=scrollSnapshot(),learning=LEARNING_PAGES.has(S.view);
 document.documentElement.setAttribute('data-theme',S.theme);
 const contextual=['learning','classroom','notebook','flash'].includes(S.view);
 // Keep the shell mounted so page updates cannot interrupt navigation motion
 // or replace the focused navigation button.
 if(!el('#root'))el('#app').innerHTML='<div id="root" class="'+(S.sidebarCollapsed?'nav-collapsed':'')+'">'+sidebar()+'<main class="main"></main></div>';
 refreshSidebar();
 el('#root > .main').innerHTML=(contextual?learningHeader():header())+
 '<section class="content '+(learning?'page-surface':'')+'" data-scroll="page" data-scroll-ns="'+esc(S.view)+'">'+
 (learning?learningPage():'<div class="page '+(['notes','labs','agents','projects','graph'].includes(S.view)?'wide':'')+'">'+viewHtml()+'</div>')+
 '</section>'+(contextual?proposalRibbon():'');
 scrollRestore(sc,L.scrollBottom?'chat-'+L.scrollBottom:null);L.scrollBottom=null;
 if(S.view==='agents')scrollChat();
 fitCodeEditors();runAfterRender();
}
function scrollChat(){
 const box=el("#chat-scroll");if(box)requestAnimationFrame(()=>box.scrollTop=box.scrollHeight);
}
