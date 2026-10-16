"use strict";
/* Lattice Application Controller — all controls are actionable. */
async function reloadData(keepSelection=true){
 const data=await rpc("bootstrap");
 S.data=data;
 if(typeof adoptLearning==="function"&&data.learning)adoptLearning(data.learning);
 if(keepSelection){
  if(S.noteId&&!S.noteDirty)S.note=data.notes.find(n=>n.id===S.noteId)||null;
  if(S.labId&&!S.labDirty)S.lab=data.experiments.find(l=>l.id===S.labId)||null;
 }else{
  S.noteId=data.notes[0]?.id||null;S.note=data.notes[0]||null;
 }
 if(!S.projectId&&data.projects.length)S.projectId=data.projects[0].id;
 if(!S.labId&&data.experiments.length){S.labId=data.experiments[0].id;S.lab=data.experiments[0];}
}
async function go(view){
 if(S.noteDirty)await saveNote(true);
 if(S.labDirty)await saveLab(true);
 S.view=view;
 if(view==="notes"&&!S.note&&S.data.notes.length){
  S.note=S.data.notes[0];S.noteId=S.note.id;
 }
 if(view==="agents"&&S.sessionId&&(!S.agentMessages||!S.agentMessages.length)){
  S.agentMessages=await rpc("session_messages",{id:S.sessionId});
 }
 if(view==="projects")await loadTree();
 if(view==="timeline")S.data.events=await rpc("events");
 if(view==="graph")S.data.graph=await rpc("graph");
 render();
}
async function createNote(title="未命名笔记",body=""){
 if(S.noteDirty)await saveNote(true);
 const n=await rpc("save_note",{note:{title,folder:"Knowledge",body,tags:[]}});
 S.note=n;S.noteId=n.id;S.noteDirty=false;
 await reloadData();await openContent("note",n.id);
 const inp=el("#note-title");if(inp){inp.focus();inp.select();}
 toast("新笔记已创建");
}
async function openNote(id){
 if(S.noteDirty)await saveNote(true);
 const note=S.data.notes.find(n=>n.id===id)||await rpc("note",{id});
 if(!note)return toast("找不到这篇笔记","error");
 S.note=note;S.noteId=id;S.noteDirty=false;
 return openContent("note",id);
}
function markNote(t){
 if(!S.note)return;
 const root=document;
 const q=f=>root.querySelector?.("[data-note='"+f+"']")||root.querySelector?.("#note-"+f);
 const ti=q("title"),bo=q("body"),fo=q("folder"),tg=q("tags");
 if(ti)S.note.title=ti.value;
 if(bo)S.note.body=bo.value;
 if(fo)S.note.folder=fo.value;
 if(tg)S.note.tags=tg.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean);
 S.noteDirty=true;
 const state=root.querySelector?.("#note-saved")||el("#note-saved");
 if(state)state.textContent="编辑中 · 自动保存";
 const preview=root.querySelector?.("#note-preview")||el("#note-preview");
 if(preview)preview.innerHTML=markdown(S.note.body);
 clearTimeout(S.noteTimer);
 S.noteTimer=setTimeout(()=>safe(()=>saveNote(true)),2200);
}
async function saveNote(silent=false){
 clearTimeout(S.noteTimer);
 if(!S.note||!S.noteDirty)return S.note;
 const saved=await rpc("save_note",{note:S.note});
 S.note=saved;S.noteDirty=false;
 const pos=S.data.notes.findIndex(n=>n.id===saved.id);
 if(pos>=0)S.data.notes[pos]=saved;else S.data.notes.unshift(saved);
 S.data.notes.sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
 document.querySelectorAll("#note-saved").forEach(state=>{
  state.textContent="已保存 · "+fmtDate(saved.updated_at,true);
 });
 if(!silent){toast("笔记已保存（可在版本历史中回看）");await reloadData();refreshSidebar();}
 return saved;
}
function markLab(){
 if(!S.lab)return;
 const keys=[["lab-title","title"],["lab-question","question"],["lab-hypothesis","hypothesis"],["lab-code","code"]];
 for(const [id,key] of keys){const input=el("#"+id);if(input)S.lab[key]=input.value;}
 S.labDirty=true;
}
async function saveLab(silent=false){
 if(!S.lab||!S.labDirty)return S.lab;
 S.lab=await rpc("experiment_save",{experiment:S.lab});
 S.labDirty=false;
 const pos=S.data.experiments.findIndex(l=>l.id===S.labId);
 if(pos>=0)S.data.experiments[pos]=S.lab;
 if(!silent)toast("实验设计已保存");
 return S.lab;
}
async function labHistory(){
 if(!S.labId)return;
 const runs=await rpc("experiment_history",{id:S.labId});
 const html=runs.map(r=>'<div class="revision"><div class="meta"><strong>'+esc(fmtDate(r.ended_at,true))+'</strong>'+ 
 '<span>退出码 '+r.exit_code+' · '+esc(shorten(r.preview||"无输出",90))+'</span></div>'+ 
 button(svg("eye")+' 查看',"lab-run-preview",'data-id="'+esc(r.id)+'"',"ghost")+'</div>').join("");
 modal(modalHead("实验运行历史 · "+S.lab.title)+
 '<p>每次实际执行都会保留当时的代码、输出和退出码。</p>'+(html||'<p>尚无运行记录。</p>'),"large");
}
async function createLab(title="新实验"){
 if(S.labDirty)await saveLab(true);
 const lab=await rpc("experiment_create",{title,project_id:S.projectId});
 S.lab=lab;S.labId=lab.id;S.labDirty=false;
 await reloadData();S.view="labs";render();
 const t=el("#lab-title");if(t){t.focus();t.select();}
}
async function openLab(id){
 if(S.labDirty)await saveLab(true);
 S.lab=await rpc("experiment_get",{id});S.labId=id;S.labDirty=false;
 S.view="labs";render();
}
async function runLab(){
 if(!S.lab)return;
 markLab();await saveLab(true);
 const r=await rpc("experiment_run",{id:S.labId});
 S.lab.status="running";S.lab.output="";
 const out=el("#lab-output");if(out)out.textContent="$ 正在启动本地 Python …\n";
 const badge=el("#lab-state");if(badge){badge.className="run-state running";badge.innerHTML='<i class="dot"></i>运行中';}
 toast("实验已启动");
 return r;
}
function createSessionModal(){
 const ps=S.data.projects||[];
 const html=modalHead("开始一段新的 AI 探索")+
 '<p>从已登录的本地 Agent 中选择一个，并指定它应该在哪个项目目录工作。</p>'+
 '<div class="form-group" style="margin:16px 0"><label>使用的 Agent</label>'+
 '<select id="new-agent" class="field"><option value="codex">Codex · ChatGPT 登录</option>'+
 '<option value="devin">Devin · SWE-2 High</option></select></div>'+
 '<div class="form-group"><label>工作目录</label>'+
 '<select id="new-session-project" class="field"><option value="">独立空白工作空间</option>'+
 ps.map(p=>'<option value="'+esc(p.id)+'" '+(S.projectId===p.id?"selected":"")+'>'+esc(p.name)+'</option>').join("")+'</select></div>'+
 '<div class="form-group mt-2"><label>这次想做什么</label>'+
 '<input id="new-session-title" class="field" placeholder="例如：探索 nanoGPT 的训练循环"/></div>'+
 '<div class="modal-actions">'+button("取消","modal-close","","ghost")+
 button(svg("spark")+' 开始协作',"session-confirm","","primary")+'</div>';
 modal(html);
}
async function createSession(){
 const agent=el("#new-agent")?.value||"codex";
 const project_id=el("#new-session-project")?.value||null;
 const title=el("#new-session-title")?.value.trim()||undefined;
 const session=await rpc("session_create",{agent,project_id,title});
 closeModal();await reloadData();
 await openSession(session.id);
 toast("会话已建立，可以直接输入问题");
}
async function openSession(id){
 const s=(S.data.sessions||[]).find(x=>x.id===id);
 if(s&&isLearningSession(s))return await go("learning");
 S.sessionId=id;S.agentMessages=await rpc("session_messages",{id});
 S.streaming="";S.agentBusy=false;S.agentStatus="ready";S.agentTools=[];
 S.view="agents";render();
}
async function sendAgent(){
 if(!S.sessionId)return;
 const input=el("#chat-input");const text=(input?.value||"").trim();
 if(!text)return;
 if(input)input.value="";
 try{await rpc("agent_send",{id:S.sessionId,text});}
 catch(e){if(input)input.value=text;throw e;}
 S.agentMessages=S.agentMessages||[];
 S.agentMessages.push({id:"tmp-"+Date.now(),role:"user",content:text,created_at:new Date().toISOString()});
 S.agentBusy=true;S.streaming="";S.agentStatus="thinking";
 render();
 scrollChat();
}
function messageById(id){return (S.agentMessages||[]).find(m=>String(m.id)===String(id));}
async function captureMessage(id){
 const m=messageById(id);if(!m)return;
 const active=S.data.sessions.find(s=>s.id===S.sessionId);
 const content="# 来自协作的一个待检验想法\n\n"+
 "> 这是一段 AI 输出的摘录。请补充你自己的理解，并通过实验独立验证。\n\n"+
 "## 原始讨论片段\n\n"+m.content+"\n\n"+
 "## 我真正理解的部分\n\n- \n\n## 需要验证的假设\n\n- \n\n"+
 "## 关联\n\nAI 会话："+(active?.title||"")+"\n";
 await createNote("协作发现 · "+shorten(m.content,22),content);
}
async function loadTree(){
 if(!S.projectId){S.projectFiles=[];return;}
 S.projectFiles=await rpc("project_files",{id:S.projectId,path:S.treePath});
}
async function addProject(){
 const project=await rpc("project_add",{},0);
 if(!project)return;
 S.projectId=project.id;S.treePath="";S.filePath=null;S.fileDirty=false;
 await reloadData();await loadTree();if(!["learning","knowledge","graph"].includes(S.view))S.view="projects";render();toast("已连接本地目录："+project.name);
}
async function openProjectFile(path){
 if(S.fileDirty){const okay=confirm("当前文件有未保存的更改。放弃它们并打开其他文件吗？");if(!okay)return;}
 const file=await rpc("file_read",{id:S.projectId,path});
 S.fileContent=file.content;S.filePath=path;S.fileDirty=false;render();
}
async function saveProjectFile(){
 if(!S.fileDirty||!S.filePath)return;
 await rpc("file_write",{id:S.projectId,path:S.filePath,content:S.fileContent});
 S.fileDirty=false;
 const label=el("#file-dirty-status");if(label)label.textContent="已保存";
 toast("文件已保存，原内容的备份保存在应用数据目录");
}
async function editProject(e){
 if(e.target.id==="project-editor"){
  S.fileContent=e.target.value;S.fileDirty=true;
  const label=el("#file-dirty-status");if(label)label.textContent="尚未保存";
 }
}
async function promptNoteHistory(){
 if(!S.note)return;
 const revs=await rpc("revisions",{id:S.note.id});
 const items=revs.map(r=>
 '<div class="revision"><div class="meta"><strong>'+esc(r.title||"旧版本")+'</strong>'+
 '<span>'+esc(fmtDate(r.created_at,true))+' · '+r.body.length+' 字符</span></div>'+
 button(svg("eye")+' 查看',"revision-preview",'data-id="'+esc(r.id)+'"',"ghost")+
 button(svg("history")+' 恢复',"revision-restore",'data-id="'+esc(r.id)+'"',"")+'</div>').join("");
 modal(modalHead("修订时间机 · "+S.note.title)+
 '<p>每次保存都会保留之前的内容。选择某个版本进行对照，或恢复成当时的状态。</p>'+
 (items||'<p>还没有历史修订。编辑并保存后就会产生新版本。</p>'),"large");
}
async function showRevision(id){
 const revs=await rpc("revisions",{id:S.note.id}),r=revs.find(x=>x.id===Number(id));
 if(!r)return;
 modal(modalHead("版本预览 · "+fmtDate(r.created_at,true))+
 '<div class="markdown" style="max-height:60vh;overflow:auto;padding:12px 5px">'+markdown(r.body)+'</div>'+
 '<div class="modal-actions">'+button("返回版本列表","history-note","","ghost")+
 button("恢复这个版本","revision-restore",'data-id="'+esc(r.id)+'"',"primary")+'</div>',"large");
}
function commandPalette(){
 S.commandOpen=true;
 const commands=[["新建知识笔记","new-note","book"],["创建实验","new-lab","flask"],
 ["开启 AI 会话","new-session","bot"],["查看知识网络","go-graph","network"],
 ["进入时间线","go-timeline","history"],["打开本地代码","go-projects","folder"],
 ["导入 Markdown","import","upload"],["导出 Markdown","export","download"]];
 modal('<div style="display:flex;align-items:center;gap:9px">'+svg("search",21)+
 '<input class="field command-palette-input" id="palette-query" placeholder="搜索笔记或输入一个命令…" autofocus/></div>'+
 '<div class="section-label" style="margin:19px 0 8px">QUICK ACTIONS & NOTES</div>'+
 '<div class="command-list" id="palette-list"></div>',"",false);
 S.paletteCommands=commands;
 paletteFilter("");
 setTimeout(()=>el("#palette-query")?.focus(),20);
}
function paletteFilter(query){
 const term=String(query||"").toLowerCase();
 const commands=(S.paletteCommands||[]).filter(x=>x[0].toLowerCase().includes(term));
 const notes=(S.data.notes||[]).filter(n=>[n.title,n.body,(n.tags||[]).join(" ")].join(" ").toLowerCase().includes(term)).slice(0,8);
 const labs=(S.data.experiments||[]).filter(x=>[x.title,x.question,x.hypothesis].join(" ").toLowerCase().includes(term)).slice(0,5);
 const sessions=(S.data.sessions||[]).filter(x=>!isLearningSession(x)&&x.title.toLowerCase().includes(term)).slice(0,5);
 const events=(S.data.events||[]).filter(x=>[x.title,x.detail].join(" ").toLowerCase().includes(term)).slice(0,5);
 const learn=typeof ld==="function"?ld():null;
 const ltopics=(learn?.topics||[]).filter(x=>[x.title,x.question].join(" ").toLowerCase().includes(term)).slice(0,4);
 const llessons=(learn?.all_lessons||learn?.lessons||[]).filter(x=>[x.title,x.objective].join(" ").toLowerCase().includes(term)).slice(0,4);
 const lcards=(learn?.cards||[]).filter(x=>[x.title,x.understanding,x.body].join(" ").toLowerCase().includes(term)).slice(0,6);
 const lnotebooks=(learn?.notebooks||[]).filter(x=>(x.title||"").toLowerCase().includes(term)).slice(0,3);
 const rows=[
   ...commands.map(c=>'<button class="command-item" data-action="'+esc(c[1])+'">'+svg(c[2])+'<span>'+esc(c[0])+'</span></button>'),
   ...notes.map(n=>'<button class="command-item" data-action="open-note" data-id="'+esc(n.id)+'">'+svg("document")+
     '<span>'+esc(n.title)+'</span><span class="subtle text-xs" style="margin-left:auto">'+esc(n.folder)+'</span></button>'),
   ...labs.map(l=>'<button class="command-item" data-action="open-lab" data-id="'+esc(l.id)+'">'+svg("flask")+'<span>'+esc(l.title)+'</span></button>'),
   ...ltopics.map(x=>'<button class="command-item" data-action="go-learning" data-lkind="topic" data-id="'+esc(x.id)+'">'+svg("spark")+'<span>'+esc(x.title)+'</span><span class="subtle text-xs" style="margin-left:auto">主题</span></button>'),
   ...llessons.map(x=>{const tp=(learn?.topics||[]).find(t=>t.id===x.topic_id);return '<button class="command-item" data-action="go-learning" data-lkind="lesson" data-id="'+esc(x.id)+'">'+svg("book")+'<span>'+esc(x.title)+'</span><span class="subtle text-xs" style="margin-left:auto">课程'+(tp?' · '+esc(tp.title):'')+'</span></button>';}),
   ...lcards.map(x=>'<button class="command-item" data-action="go-learning" data-lkind="card" data-id="'+esc(x.id)+'">'+svg("tag")+'<span>'+esc(x.title)+'</span><span class="subtle text-xs" style="margin-left:auto">知识卡</span></button>'),
   ...lnotebooks.map(x=>'<button class="command-item" data-action="go-learning" data-lkind="notebook" data-id="'+esc(x.id)+'">'+svg("terminal")+'<span>'+esc(x.title)+'</span><span class="subtle text-xs" style="margin-left:auto">实验笔记</span></button>'),
   ...sessions.map(s=>'<button class="command-item" data-action="open-session" data-id="'+esc(s.id)+'">'+svg("bot")+'<span>'+esc(s.title)+'</span></button>'),
   ...events.map(e=>'<button class="command-item" data-action="timeline-event" data-id="'+esc(e.target||"")+'" data-kind="'+esc(e.kind)+'">'+svg("history")+'<span>'+esc(e.title)+'</span></button>')
 ];
 const box=el("#palette-list");if(box)box.innerHTML=rows.join("")||
 '<div class="muted text-sm" style="padding:14px">没有找到匹配结果</div>';
}
function quickAddMenu(){
 if(typeof topicModal==="function")return topicModal();
 modal(modalHead("创建新的探索")+
 '<p>从任何一个入口开始，记录都可以在不同视图之间相互连接。</p>'+
 '<div class="command-list">'+
 '<button class="command-item" data-action="new-note">'+svg("book")+' 创建笔记</button>'+
 '<button class="command-item" data-action="new-lab">'+svg("flask")+' 设计实验</button>'+
 '<button class="command-item" data-action="new-session">'+svg("bot")+' 开启 Agent 协作</button>'+
 '<button class="command-item" data-action="add-task">'+svg("check")+' 添加待办任务</button>'+
 '</div>');
}
function taskModal(){
 modal(modalHead("添加一个行动")+
 '<p>留下一个明确、可完成的下一步。</p>'+
 '<input class="field" id="task-title" placeholder="例如：构造三个 Token 的注意力实验"/>'+
 '<div class="modal-actions">'+button("取消","modal-close","","ghost")+button("添加任务","task-confirm","","primary")+'</div>');
 setTimeout(()=>el("#task-title")?.focus(),40);
}
function permissionModal(evt){
 if(S.permission||el(".modal")){(S.permissionQueue=S.permissionQueue||[]).push(evt);return;}
 S.permission=evt;
 const opts=evt.options||[];
 const details=typeof evt.tool==="object"?JSON.stringify(evt.tool,null,2):String(evt.tool||"");
 const safeOpts=opts.map(o=>'<button class="btn" data-action="permission-select" data-choice="'+esc(o.optionId||"")+'">'+
 esc(o.name||o.optionId||"允许")+'</button>').join("");
 modal(modalHead("Agent 请求操作许可")+
 '<div class="permission-note">'+esc(evt.title||"即将执行操作")+'</div>'+
 '<pre class="context-code" style="max-height:145px;overflow:auto;white-space:pre-wrap">'+esc(details.slice(0,1600))+'</pre>'+
 '<p>确认前可以查看请求的工具操作。拒绝后 Agent 会收到取消结果。</p>'+
 '<div class="modal-actions">'+button("拒绝","permission-deny","","danger")+safeOpts+'</div>',"large",false);
}
async function onEvent(evt){
 if(evt.type==="lab"){
  if(evt.id!==S.labId)return;
  if(evt.kind==="output"){
   S.lab.output=(S.lab.output||"")+evt.text;
   const box=el("#lab-output");
   if(box){box.textContent=S.lab.output;box.scrollTop=box.scrollHeight;}
  }else if(evt.kind==="status"){
   S.lab.status=evt.status;
   const badge=el("#lab-state");
   if(badge){badge.className="run-state "+evt.status;badge.innerHTML='<i class="dot"></i>'+esc(evt.status);}
   if(evt.status!=="running"){
    S.lab=await rpc("experiment_get",{id:S.labId});
    await reloadData();refreshSidebar();
    toast("实验结束："+evt.status);
   }
  }else if(evt.kind==="error")toast("实验错误："+evt.message,"error");
  return;
 }
 if(evt.type!=="agent")return;
 if(evt.kind==="permission"){permissionModal(evt);return;}
 if(evt.kind==="error"){S.agentBusy=false;toast(evt.message||"Agent 失败","error");return;}
 if(evt.kind==="diagnostic"){console.warn("ACP",evt.message);return;}
 if(evt.kind==="finished"){
  if(evt.session_id===S.sessionId){
   S.agentBusy=false;S.agentStatus=evt.stop_reason||"ready";S.streaming="";
   S.agentMessages=await rpc("session_messages",{id:S.sessionId});
   await reloadData();if(S.view==="agents")render();
  }
  return;
 }
 if(evt.session_id!==S.sessionId)return;
 if(evt.kind==="status"){
  S.agentStatus=evt.state;
  const status=el("#agent-status");if(status)status.textContent=evt.state;
 }else if(evt.kind==="ready"){
  S.agentStatus="ready";
  const status=el("#agent-status");if(status)status.textContent="ready";
 }else if(evt.kind==="chunk"){
  S.streaming+=evt.text;
  const box=el("#chat-scroll");
  if(!box||S.view!=="agents")return;
  let row=el("#stream-row");
  if(!row){
   box.insertAdjacentHTML("beforeend",'<div class="message assistant" id="stream-row"><div class="avatar">'+svg("spark",15)+'</div>'+
    '<div class="message-body"><div class="who">AI Agent · 正在回答</div>'+
    '<div class="message-text markdown" id="streaming-text"></div></div></div>');
  }
  const target=el("#streaming-text");if(target)target.innerHTML=markdown(S.streaming);
  scrollChat();
 }else if(evt.kind==="tool"){
  const box=el("#chat-scroll");
  if(box)box.insertAdjacentHTML("beforeend",'<div class="chat-tool">'+svg("terminal")+' '+esc(evt.title)+
   ' <span class="subtle">· '+esc(evt.status)+'</span></div>');
  scrollChat();
 }
}
async function action(click){
 const a=click&&click.closest("[data-action]");if(!a)return;
 const kind=a.dataset.action,id=a.dataset.id;
 if(["nav","open-note","open-lab","open-session","go-learning"].includes(kind)&&S.commandOpen)closeModal();
 switch(kind){
 case "sidebar-toggle":
  S.sidebarCollapsed=!S.sidebarCollapsed;
  localStorage.setItem("lattice-sidebar-collapsed",String(S.sidebarCollapsed));
  refreshSidebar();return;
 case "nav":return await go(a.dataset.view==="connections"?"settings":a.dataset.view);
 case "theme":case "set-dark":case "set-light":
  S.theme=kind==="set-dark"?"dark":kind==="set-light"?"light":S.theme==="dark"?"light":"dark";
  localStorage.setItem("lattice-theme",S.theme);return render();
 case "quick-add":return quickAddMenu();
 case "search":return commandPalette();
 case "modal-close":return requestCloseModal();
 case "new-note":closeModal();return await createNote();
 case "open-note":return await openNote(id);
 case "note-mode":S.noteMode=a.dataset.mode;return render();
 case "save-note":return await saveNote(false);
 case "history-note":return await promptNoteHistory();
 case "revision-preview":return await showRevision(id);
 case "revision-restore":
  if(!S.note||!confirm("确定恢复这个版本吗？当前内容会自动成为一条可恢复的旧版本。"))return;
  S.note=await rpc("restore",{id:S.note.id,revision:Number(id)});
  S.noteDirty=false;closeModal();await reloadData();render();return toast("已恢复笔记版本");
 case "pin-note":
  if(!S.note)return;S.note.pinned=!S.note.pinned;S.noteDirty=true;await saveNote(true);await reloadData();return render();
 case "delete-note":{
  if(!S.note||!confirm("删除这篇笔记？此操作会移除它的历史版本。"))return;
  const doomed=S.note.id;
  await rpc("delete_note",{id:doomed});S.note=null;S.noteId=null;
  delete L.details.notes;
  await reloadData(false);return render();
 }
 case "new-lab":closeModal();return await createLab("新实验 · "+new Date().toLocaleDateString("zh-CN"));
 case "open-lab":return await openLab(id);
 case "lab-history":return await labHistory();
 case "lab-run-preview":{
  const run=await rpc("experiment_run_get",{id:Number(id)});
  if(!run)return;
  return modal(modalHead("实验结果 · "+fmtDate(run.ended_at,true))+
   '<p>退出码 '+run.exit_code+'</p><div class="section-label">当时运行的代码</div>'+ 
   '<pre class="terminal" style="max-height:200px">'+esc(run.code)+'</pre>'+ 
   '<div class="section-label mt-2">真实输出</div><pre class="terminal">'+esc(run.output)+'</pre>'+ 
   '<div class="modal-actions">'+button("返回历史","lab-history","","ghost")+'</div>',"large");
 }
 case "save-lab":return await saveLab();
 case "run-lab":return await runLab();
 case "stop-lab":return await rpc("experiment_stop",{id:S.labId});
 case "copy-lab":
  navigator.clipboard?.writeText(S.lab?.code||"");return toast("代码已复制");
 case "open-lab-dir":return await rpc("open_folder",{path:(await rpc("experiment_dir",{id:S.labId}))});
 case "new-session":return createSessionModal();
 case "session-confirm":return await createSession();
 case "open-session":return await openSession(id);
 case "go-learning":{
  if(typeof ld!=="function"||!ld())return await go("learning");
  const lk=a.dataset.lkind;
  if(lk==="topic"&&typeof focusTopic==="function"){await focusTopic(id);return await go("learning");}
  if(lk==="card"&&typeof openContent==="function")return await openContent("card",id);
  if(lk==="lesson"&&typeof openContent==="function")return await openContent("lesson",id);
  if(lk==="notebook"&&typeof openContent==="function"){if(id)L.notebookId=id;return await openContent("notebook");}
  return await go("learning");
 }
 case "agent-send":return await sendAgent();
 case "agent-cancel":return await rpc("agent_cancel",{id:S.sessionId});
 case "capture-message":return await captureMessage(id);
 case "copy-message":{
  const m=messageById(id);if(m){await navigator.clipboard.writeText(m.content);toast("消息已复制");}
  return;
 }
 case "insert-prompt":{const text=el("#chat-input");if(text){text.value=a.dataset.prompt;text.focus();}return;}
 case "rename-session":
  if(!S.sessionId)return;
  const title=prompt("为会话重新命名：",S.data.sessions.find(x=>x.id===S.sessionId)?.title||"");
  if(title){await rpc("session_rename",{id:S.sessionId,title});await reloadData();render();}return;
 case "permission-select":
  if(S.permission)await rpc("agent_permission",{id:S.permission.session_id,request_id:S.permission.request_id,option_id:a.dataset.choice});
  return closeModal();
 case "permission-deny":
  if(S.permission)await rpc("agent_permission",{id:S.permission.session_id,request_id:S.permission.request_id});
  return closeModal();
 case "add-project":return await addProject();
 case "project-enter":
  S.treePath=a.dataset.path;S.filePath=null;S.fileDirty=false;await loadTree();return render();
 case "project-up":
  S.treePath=S.treePath.split("/").slice(0,-1).join("/");S.filePath=null;await loadTree();return render();
 case "project-file":return await openProjectFile(a.dataset.path);
 case "file-save":return await saveProjectFile();
 case "file-external":return await rpc("file_open_external",{id:S.projectId,path:S.filePath});
 case "open-project-dir":return await rpc("open_folder",{path:S.data.projects.find(p=>p.id===S.projectId)?.path});
 case "timeline-event":
  if(a.dataset.kind==="note"&&id)return await openNote(id);
  if(a.dataset.kind==="experiment"&&id)return await openLab(id);
  if(a.dataset.kind==="agent"&&id)return await openSession(id);
  if(a.dataset.kind==="learning"){
   if(typeof focusTopic==="function"&&id&&typeof ld==="function"&&ld()?.topics?.some(t=>t.id===id))return await focusTopic(id);
   return await go("learning");
  }
  return;
 case "refresh":await reloadData();return render();
 case "add-task":return taskModal();
 case "task-confirm":{
  const title=el("#task-title")?.value.trim();if(title)await rpc("task_add",{label:title});
  closeModal();await reloadData();return render();
 }
 case "import":{
  closeModal();const r=await rpc("import",{},0);if(r){await reloadData();render();toast("导入 "+r.count+" 篇笔记");}return;
 }
 case "export":{
  closeModal();const r=await rpc("export",{},0);if(r)toast("已导出 "+r.count+" 篇笔记");return;
 }
 case "open-data":return await rpc("open_folder",{});
 case "go-graph":closeModal();return await go("graph");
 case "go-timeline":closeModal();return await go("timeline");
 case "go-projects":closeModal();return await go("projects");
 default:console.warn("unknown action",kind);
 }
}
async function onInput(e){
 const t=e.target;
 if(t.id==="note-title"||t.id==="note-body"||t.id==="note-folder"||t.id==="note-tags")markNote(t);
 if(["lab-title","lab-question","lab-hypothesis","lab-code"].includes(t.id))markLab();
 if(t.id==="project-editor")editProject(e);
 if(t.id==="note-filter"){
  S.noteFilter=t.value;
  const list=el(".notes-grid");if(list)list.innerHTML=notesListItems();
 }
 if(t.id==="palette-query")paletteFilter(t.value);
}
async function onChange(e){
 const t=e.target;
 if(t.dataset.task){
  await rpc("task_toggle",{id:t.dataset.task,done:t.checked});
  const row=t.closest(".check-row");if(row)row.classList.toggle("done",t.checked);
  await reloadData();refreshSidebar();
 }
 if(t.id==="note-folder-filter"){S.noteFolder=t.value;render();}
 if(t.id==="graph-filter"){S.graphFilter=t.value;render();}
 if(t.id==="project-select"){
  if(S.fileDirty&&!confirm("切换项目会丢弃未保存的文件修改，继续吗？"))return;
  S.projectId=t.value;S.treePath="";S.filePath=null;S.fileDirty=false;await loadTree();render();
 }
}
function initInteractions(){
 document.addEventListener("click",e=>{
  const wik=e.target.closest("a[data-wiki]");
  if(wik){e.preventDefault();safe(async()=>{
   const title=wik.dataset.wiki;
   const n=S.data.notes.find(x=>x.title.toLowerCase()===title.toLowerCase());
   if(n)await openNote(n.id);
   else if(confirm("知识卡「"+title+"」尚不存在，要为它创建一篇新笔记吗？"))await createNote(title);
  });return;}
  const modalBg=e.target.closest("[data-dismiss]");
  if(modalBg&&e.target===modalBg){if(!S.permission)requestCloseModal();return;}
  safe(()=>action(e.target));
 });
 document.addEventListener("input",e=>{safe(()=>onInput(e));});
 document.addEventListener("change",e=>{safe(()=>onChange(e));});
 document.addEventListener("keydown",e=>{
  const mod=e.ctrlKey||e.metaKey;
  if(e.key==="Escape"&&el(".modal-backdrop")&&!S.permission){requestCloseModal();return;}
  if(el(".modal"))return;
  if(mod&&e.key.toLowerCase()==="k"){e.preventDefault();commandPalette();return;}
  if(mod&&e.key.toLowerCase()==="n"){e.preventDefault();
   safe(()=>(S.view==="notes"||typeof topicModal!=="function")?createNote():topicModal());return;}
  if(mod&&e.key.toLowerCase()==="s"){
   e.preventDefault();safe(()=>{
   if(typeof LEARNING_PAGES!=="undefined"&&LEARNING_PAGES.has(S.view))return saveFocused();
   if(S.view==="labs")return saveLab(false);
   if(S.view==="projects")return saveProjectFile();
   return Promise.resolve();});return;
  }
  if(mod&&e.key==="Enter"&&e.target.id==="chat-input"){e.preventDefault();safe(()=>sendAgent());return;}
 });
}
async function boot(){
 try{
  if(typeof qt==="undefined"||!qt.webChannelTransport){
   throw new Error("必须由 Lattice 桌面程序启动（缺少本地 Qt WebChannel）");
  }
  new QWebChannel(qt.webChannelTransport,async channel=>{
   try{
    S.bridge=channel.objects.backend;
    S.bridge.event.connect(evt=>safe(()=>onEvent(JSON.parse(evt))));
    await reloadData(false);
    S.sessionId=(S.data.sessions.find(s=>!isLearningSession(s))||{}).id||null;
    S.labId=S.data.experiments[0]?.id||null;
    S.lab=S.data.experiments[0]||null;
    S.projectId=S.data.projects[0]?.id||null;
    if(S.projectId)await loadTree();
    initInteractions();
    render();
   }catch(err){console.error(err);el("#app").innerHTML='<div class="boot"><div class="boot-symbol">!</div>'+
    '<div>初始化失败：'+esc(err.message)+'</div>'+
    '<button class="btn" style="margin-top:14px" onclick="location.reload()">重试</button></div>';}
  });
 }catch(e){el("#app").innerHTML='<div class="boot">桌面启动失败：'+esc(e.message)+'</div>';}
}
window.addEventListener("beforeunload",()=>{
 try{
  if(S.noteDirty)saveNote(true);
  if(typeof flushCells==="function")flushCells();
  if(S.fileDirty)saveProjectFile();
 }catch(_){}
});
setInterval(()=>{
 try{
  if(S.noteDirty)saveNote(true);
  if(typeof flushCells==="function"&&typeof L!=="undefined"&&L.drafts.size)flushCells();
 }catch(_){}
},25000);
document.addEventListener("DOMContentLoaded",boot);
