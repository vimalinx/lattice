"use strict";
/* Lattice Application Controller — all controls are actionable. */
async function reloadData(keepSelection=true){
 const data=await rpc("bootstrap");
 S.data=data;
 if(typeof adoptLearning==="function"&&data.learning)adoptLearning(data.learning);
 if(keepSelection){
  if(S.noteId&&!S.noteDirty)S.note=data.notes.find(n=>n.id===S.noteId)||null;
 }else{
  S.noteId=data.notes[0]?.id||null;S.note=data.notes[0]||null;
 }
 if(!S.projectId&&data.projects.length)S.projectId=data.projects[0].id;
}
async function go(view){
 if(S.noteDirty)await saveNote(true);
 S.view=view;
 if(view==="notes"&&!S.note&&S.data.notes.length){
  S.note=S.data.notes[0];S.noteId=S.note.id;
 }
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
async function loadTree(){
 if(!S.projectId){S.projectFiles=[];return;}
 S.projectFiles=await rpc("project_files",{id:S.projectId,path:S.treePath});
}
async function addProject(){
 const project=await rpc("project_add",{},0);
 if(!project)return;
 S.projectId=project.id;S.treePath="";S.filePath=null;S.fileDirty=false;
 await reloadData();await loadTree();render();toast("已连接本地目录："+project.name);
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
const PALETTE_COMMANDS=[
 ["新建知识笔记","new-note","document"],["新建知识卡","l-card-new","tag"],
 ["新建课程","l-lesson-new","book"],["新探索主题","l-topic-new","plus"],
 ["打开知识网络","nav","git",'data-view="graph"'],["设置与数据","nav","settings",'data-view="settings"'],
 ["导入 Markdown","import","upload"],["导出 Markdown","export","download"],["导出学习档案","l-export","download"]];
function commandPalette(){
 S.commandOpen=true;
 modal('<div style="display:flex;align-items:center;gap:9px">'+svg("search",21)+
 '<input class="field command-palette-input" id="palette-query" placeholder="搜索笔记、知识卡、课程、主题、实验笔记，或输入命令…" autofocus/></div>'+
 '<div class="command-list" id="palette-list" style="margin-top:16px"></div>'+
 '<div class="palette-hint">↑↓ 选择 · Enter 打开 · Esc 关闭</div>',"palette",false);
 paletteFilter("");
 setTimeout(()=>el("#palette-query")?.focus(),20);
}
/* Title hits rank above body hits; non-title hits show where the term matched. */
function paletteMatch(fields,term){
 const [head,...rest]=fields.map(f=>String(f||""));
 if(!term)return {score:1,snippet:""};
 if(head.toLowerCase().includes(term))return {score:2,snippet:""};
 for(const f of rest){
  const at=f.toLowerCase().indexOf(term);
  if(at>=0){const from=Math.max(0,at-18);return {score:1,snippet:(from?"…":"")+shorten(f.slice(from),60)};}
 }
 return null;
}
function paletteSearch(items,fields,term,limit){
 return items.map(x=>({x,m:paletteMatch(fields(x),term)})).filter(r=>r.m).sort((a,b)=>b.m.score-a.m.score).slice(0,limit);
}
function paletteRow(attrs,icon,title,kind,snippet){
 return '<button class="command-item" '+attrs+'>'+svg(icon)+'<span class="command-main"><span>'+esc(title)+'</span>'+
 (snippet?'<small class="command-snippet">'+esc(snippet)+'</small>':'')+'</span><span class="command-kind" title="'+esc(kind)+'">'+esc(kind)+'</span></button>';
}
function paletteFilter(query){
 const term=String(query||"").trim().toLowerCase(),learn=typeof ld==="function"?ld():null;
 const topicName=id=>(learn?.topics||[]).find(t=>t.id===id)?.title||"";
 const jump=(kind,id,extra="")=>'data-action="go-learning" data-lkind="'+kind+'" data-id="'+esc(id)+'"'+extra;
 const commands=PALETTE_COMMANDS.filter(c=>!term||c[0].toLowerCase().includes(term))
  .map(c=>'<button class="command-item" data-action="'+esc(c[1])+'" '+(c[3]||'')+'>'+svg(c[2])+'<span>'+esc(c[0])+'</span><span class="command-kind">命令</span></button>');
 if(!term){
  const box=el("#palette-list");if(box)box.innerHTML=commands.join("");
  return;
 }
 const liveCells=new Map((learn?.notebooks||[]).map(n=>[n.id,(n.cells||[]).map(c=>c.source).join("\n")]));
 const rows=[
  ...paletteSearch(learn?.cards||[],c=>[c.title,(c.tags||[]).join(" "),c.understanding,c.body,c.question],term,8)
   .map(({x,m})=>paletteRow(jump("card",x.id),"tag",x.title,"知识卡"+(x.topic_id?" · "+topicName(x.topic_id):""),m.snippet)),
  ...paletteSearch(S.data.notes||[],n=>[n.title,(n.tags||[]).join(" "),n.folder,n.body],term,8)
   .map(({x,m})=>paletteRow('data-action="open-note" data-id="'+esc(x.id)+'"',"document",x.title,"笔记 · "+x.folder,m.snippet)),
  ...paletteSearch(learn?.all_lessons||[],l=>[l.title,l.objective,l.body],term,6)
   .map(({x,m})=>paletteRow(jump("lesson",x.id),"book",x.title,"课程 · "+topicName(x.topic_id),m.snippet)),
  ...paletteSearch(learn?.topics||[],t=>[t.title,t.question],term,4)
   .map(({x,m})=>paletteRow(jump("topic",x.id),"spark",x.title,"主题",m.snippet)),
  ...paletteSearch(learn?.all_notebooks||[],n=>[n.title,liveCells.get(n.id)],term,5)
   .map(({x,m})=>paletteRow(jump("notebook",x.id,' data-topic="'+esc(x.topic_id)+'"'),"terminal",x.title,"实验笔记 · "+topicName(x.topic_id),m.snippet)),
  ...commands
 ];
 const box=el("#palette-list");if(box)box.innerHTML=rows.join("")||
 '<div class="muted text-sm" style="padding:14px">没有找到匹配结果</div>';
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
async function onEvent(_evt){}
async function action(click){
 const a=click&&click.closest("[data-action]");if(!a)return;
 const kind=a.dataset.action,id=a.dataset.id;
 if(S.commandOpen&&a.closest("#palette-list"))closeModal();
 switch(kind){
 case "sidebar-toggle":
  S.sidebarCollapsed=!S.sidebarCollapsed;
  localStorage.setItem("lattice-sidebar-collapsed",String(S.sidebarCollapsed));
  refreshSidebar();return;
 case "nav":return await go(a.dataset.view==="connections"?"settings":a.dataset.view);
 case "theme":case "set-dark":case "set-light":
  S.theme=kind==="set-dark"?"dark":kind==="set-light"?"light":S.theme==="dark"?"light":"dark";
  localStorage.setItem("lattice-theme",S.theme);return render();
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
 case "go-learning":{
  if(typeof ld!=="function"||!ld())return await go("learning");
  const lk=a.dataset.lkind;
  if(lk==="topic"&&typeof focusTopic==="function"){await focusTopic(id);return await go("learning");}
  if(lk==="card"&&typeof openContent==="function")return await openContent("card",id);
  if(lk==="lesson"&&typeof openContent==="function")return await openContent("lesson",id);
  if(lk==="notebook"&&typeof openContent==="function"){
   if(a.dataset.topic&&a.dataset.topic!==ld().active_topic)await focusTopic(a.dataset.topic);
   if(id)L.notebookId=id;return await openContent("notebook");
  }
  return await go("learning");
 }
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
 case "import":{
  closeModal();const r=await rpc("import",{},0);if(r){await reloadData();render();toast("导入 "+r.count+" 篇笔记");}return;
 }
 case "export":{
  closeModal();const r=await rpc("export",{},0);if(r)toast("已导出 "+r.count+" 篇笔记");return;
 }
 case "open-data":return await rpc("open_folder",{});
 default:console.warn("unknown action",kind);
 }
}
async function onInput(e){
 const t=e.target;
 if(t.id==="note-title"||t.id==="note-body"||t.id==="note-folder"||t.id==="note-tags")markNote(t);
 if(t.id==="project-editor")editProject(e);
 if(t.id==="note-filter"){
  S.noteFilter=t.value;
  const list=el(".notes-grid");if(list)list.innerHTML=notesListItems();
 }
 if(t.id==="palette-query")paletteFilter(t.value);
}
async function onChange(e){
 const t=e.target;
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
   const key=title.trim().toLowerCase();
   const n=S.data.notes.find(x=>x.title.toLowerCase()===key);
   if(n)return await openNote(n.id);
   const card=typeof ld==="function"&&ld()?.cards.find(c=>c.title.toLowerCase()===key);
   if(card)return await openContent("card",card.id);
   if(confirm("「"+title+"」还没有对应的笔记或知识卡，要新建一篇笔记吗？"))await createNote(title);
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
  if(S.commandOpen&&["ArrowDown","ArrowUp","Enter"].includes(e.key)){
   const items=all("#palette-list .command-item");if(!items.length)return;
   if(e.key==="Enter"){if(e.target.id==="palette-query"){e.preventDefault();items[0].click();}return;}
   e.preventDefault();const at=items.indexOf(document.activeElement);
   const next=e.key==="ArrowDown"?Math.min(at+1,items.length-1):at-1;
   if(next<0)el("#palette-query")?.focus();else items[next].focus();
   return;
  }
  if(el(".modal"))return;
  if(mod&&e.key.toLowerCase()==="k"){e.preventDefault();commandPalette();return;}
  if(mod&&e.key.toLowerCase()==="n"){e.preventDefault();
   safe(()=>(S.view==="notes"||typeof topicModal!=="function")?createNote():topicModal());return;}
  if(mod&&e.key.toLowerCase()==="s"){
   e.preventDefault();safe(()=>{
   if(typeof LEARNING_PAGES!=="undefined"&&LEARNING_PAGES.has(S.view))return saveFocused();
   return Promise.resolve();});return;
  }
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
