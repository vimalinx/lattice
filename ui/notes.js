"use strict";
/* Notes, kept the way Obsidian keeps them: a folder tree to file them in (new, rename, move by dragging, bookmarks,
   daily notes, templates), [[links]] that follow renames, and beside the note its outline, backlinks, outgoing links
   and tags. The editor itself is editor.js; this is everything around it. */
const Notes={current:null,renaming:null,query:"",drag:null,links:null,tags:null,cursorLine:0,timer:null};
const NOTE_SORT=[["name","名称 A → Z"],["name-desc","名称 Z → A"],["updated","最近修改的在前"],["updated-asc","最早修改的在前"]];
const TEMPLATE_DIR="notes/模板",DAILY_DIR="日记";

/* ---- links between notes ---------------------------------------------------------------------------------------- */
function docByTitle(name){const n=String(name||"").trim().toLowerCase();return (S.data.docs||[]).find(d=>d.title.toLowerCase()===n)||null;}
// A [[link]] names a document by its title, or a file by its path (with or without .md).
function resolveWiki(name){
 const n=String(name||"").trim();if(!n)return null;
 const d=docByTitle(n);if(d)return d.path;
 const byPath=(S.data.docs||[]).find(x=>x.path===n||x.path===n+".md"||x.path.endsWith("/"+n)||x.path.endsWith("/"+n+".md"));
 if(byPath)return byPath.path;
 return /\.[a-z0-9]{1,6}$/i.test(n)?n:null;
}
function folderOf(path){return String(path||"").startsWith("notes/")?path.split("/").slice(1,-1).join("/"):"";}
async function openWiki(name,pid){
 const path=resolveWiki(name);
 if(path)return openFile(path);
 // As in Obsidian, a link to a note that does not exist yet creates it, next to the note the link is in.
 const r=await rpc("doc_create",{kind:"note",title:String(name).trim(),folder:folderOf(Dock.panels[pid]?.path)});
 await refreshState();toast("新建了笔记「"+String(name).trim()+"」");return openFile(r.path);
}
function openHref(href,pid){
 if(/^https?:/i.test(href))return rpc("open_url",{url:href});
 const p=decodeURI(href.replace(/^\.\//,"")),base=String(Dock.panels[pid]?.path||"").split("/").slice(0,-1).join("/");
 return openFile(/^(notes|cards|topics|lessons|insights|notebooks|code|data)\//.test(p)||!base?p:base+"/"+p);
}
// When something moves or is renamed, the windows showing it, the open folders and the bookmarks follow.
function pathMoved(old,now){
 if(!old||!now||old===now)return;
 const swap=p=>p===old?now:p.startsWith(old+"/")?now+p.slice(old.length):p;
 for(const pid of Object.keys(Dock.panels)){const p=Dock.panels[pid];if(p.path&&swap(p.path)!==p.path){p.path=swap(p.path);if(Files[pid])safe(()=>loadFile(pid,true));}}
 Side.open=new Set([...Side.open].map(swap));Side.entries={};
 if(Notes.current)Notes.current=swap(Notes.current);
 saveLayout();
}

/* ---- ![[note]] and ![[note#section]]: another note's text shown in this one ------------------------------------ */
const Embeds={cache:new Map(),version:0};
function noteContent(path){
 if(!Embeds.cache.has(path))Embeds.cache.set(path,rpc("file_read",{path}).then(d=>({title:d.doc?.title||d.card?.title||d.topic?.title||baseName(path),
  body:d.doc?.body??d.card?.body??d.topic?.notes??d.content??""})).catch(()=>null));
 return Embeds.cache.get(path);
}
// One section: from its heading down to the next heading of the same or a higher level.
function sectionOf(body,heading){
 const lines=String(body||"").split("\n"),want=heading.trim().toLowerCase();let start=-1,level=0;
 for(let i=0;i<lines.length;i++){
  const m=/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);if(!m)continue;
  if(start<0){if(m[2].trim().toLowerCase()===want){start=i;level=m[1].length;}}
  else if(m[1].length<=level)return lines.slice(start,i).join("\n");
 }
 return start<0?null:lines.slice(start).join("\n");
}
async function fillEmbed(box,base,depth=0){
 const raw=box.dataset.embed,hash=raw.indexOf("#"),name=(hash<0?raw:raw.slice(0,hash)).trim(),section=hash<0?"":raw.slice(hash+1).trim();
 const path=resolveWiki(name),label=esc(name)+(section?" › "+esc(section):"");
 if(!path){box.innerHTML='<div class="embed-head">'+svg("document",12)+' <a data-wiki="'+esc(name)+'">'+label+'</a><small>还没有这篇，点一下新建</small></div>';return;}
 if(path===base||depth>=3){box.innerHTML='<div class="embed-head">'+svg(fileIcon(path),12)+' <a data-action="open-file" data-path="'+esc(path)+'">'+label+'</a><small>'+(path===base?"不能嵌入它自己":"嵌得太深了，点开看")+'</small></div>';return;}
 const note=await noteContent(path);
 if(!note){box.innerHTML='<div class="embed-head">'+label+'<small>读不到</small></div>';return;}
 const text=section?sectionOf(note.body,section):note.body;
 box.innerHTML='<div class="embed-head">'+svg(fileIcon(path),12)+' <a data-action="open-file" data-path="'+esc(path)+'">'+esc(note.title)+(section?" › "+esc(section):"")+'</a></div>'+
  '<div class="embed-body markdown">'+(text==null?'<p class="muted">这篇里没有「'+esc(section)+'」这一节。</p>':text.trim()?markdown(text):'<p class="muted">（还是空的）</p>')+'</div>';
 hydrateVault(box.querySelector(".embed-body"),path,depth+1);
}
// A note that changed is shown anew wherever it is embedded.
function embedsChanged(paths){
 let hit=false;for(const p of paths||[])if(Embeds.cache.delete(p))hit=true;
 if(!hit)return;
 Embeds.version++;
 all(".embed[data-embed][data-filled]").forEach(box=>{const base=box.closest(".panel")&&Dock.panels[box.closest(".panel").dataset.pid]?.path;fillEmbed(box,base,box.parentElement?.closest(".embed")?1:0);});
 refreshEditors();
}

/* ---- which note the side panels follow --------------------------------------------------------------------------- */
function isNotePanel(pid){const st=Files[pid];return !!(st?.data&&(st.data.doc||st.data.card||st.data.topic||(st.data.ext||"").toLowerCase()===".md"));}
function noteFollow(){
 const here=[];eachStack(s=>here.push(...s.tabs));
 const shown=[];eachStack(s=>{if(s.active)shown.push(s.active);});
 let pid=isNotePanel(Dock.focus)&&here.includes(Dock.focus)?Dock.focus:null;
 if(!pid){const kept=here.find(x=>isNotePanel(x)&&Dock.panels[x].path===Notes.current);pid=kept||shown.find(isNotePanel)||null;}
 const path=pid?Dock.panels[pid].path:null;
 if(path===Notes.current)return;
 Notes.current=path;Notes.links=null;Notes.cursorLine=0;
 noteInfoChanged();
 if((currentSpace().side||[]).includes("notes")&&sideOpen()){
  // The tree opens the folders of the note on screen, as Obsidian's "reveal" does.
  if(path?.startsWith("notes/")&&!el('#side .note-row[data-path="'+CSS.escape(path)+'"]')){revealPath(path);renderSide();}
  else all("#side .note-row").forEach(r=>r.classList.toggle("on",r.dataset.path===path));
 }
}
function noteCursor(pid){
 if(Dock.panels[pid]?.path!==Notes.current)return;
 clearTimeout(Notes.timer);
 Notes.timer=setTimeout(()=>{
  const view=Dock.els[pid]?.querySelector(".cm-host.editor")?.cmView;if(!view)return;
  Notes.cursorLine=view.state.doc.lineAt(view.state.selection.main.head).number;
  all(".panel-noteinfo").forEach(n=>{if(Dock.panels[n.dataset.pid]?.tab==="outline"||!Dock.panels[n.dataset.pid]?.tab)renderOutline(n.dataset.pid);});
 },250);
}
// The text of the note as it is in its editor right now, saved or not.
function noteText(path){
 const pid=Object.keys(Files).find(x=>Dock.panels[x]?.path===path),node=Dock.els[pid];
 const host=node?.querySelector('.cm-host[data-field="body"],.cm-host[data-field="notes"],.cm-host[data-field="text"]');
 if(host?.cmView)return host.value;
 const d=Files[pid]?.data;return d?.doc?.body??d?.card?.body??d?.topic?.notes??d?.content??"";
}
function headingsOf(text){
 const out=[];let fence=false;
 String(text||"").split("\n").forEach((l,i)=>{
  if(/^\s*(```|~~~)/.test(l)){fence=!fence;return;}
  const m=!fence&&/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);if(m)out.push({level:m[1].length,title:m[2].replace(/\*\*|__|`/g,""),line:i+1});
 });
 return out;
}

/* ---- the panel beside a note: outline, backlinks, outgoing links, tags ------------------------------------------- */
panelType("noteinfo",{side:"mine",host:false,icon:"list",title:()=>"大纲与链接",
 mount(p,node,pid){node.innerHTML='<div class="noteinfo"><div class="ni-tabs"></div><div class="ni-body" data-keep-scroll></div></div>';renderNoteInfo(pid);},
 shown(p,node){renderNoteInfo(node.dataset.pid);},
 screen(p){return {view:"笔记旁边的"+({outline:"大纲",links:"反向链接",out:"出链",tags:"标签"}[p.tab||"outline"]),note:Notes.current};}});
const NI_TABS=[["outline","大纲"],["links","反向链接"],["out","出链"],["tags","标签"]];
function noteInfoChanged(){all(".panel-noteinfo").forEach(n=>{if(n.isConnected)safe(()=>renderNoteInfo(n.dataset.pid));});}
async function renderNoteInfo(pid){
 const p=Dock.panels[pid],node=Dock.els[pid]?.querySelector(".noteinfo");if(!p||!node)return;
 const tab=p.tab||"outline",cur=Notes.current;
 node.querySelector(".ni-tabs").innerHTML='<div class="segmented">'+NI_TABS.map(([k,t])=>'<button class="'+(k===tab?"on":"")+'" data-action="ni-tab" data-pid="'+pid+'" data-tab="'+k+'">'+t+'</button>').join("")+'</div>'+
  (cur&&tab!=="tags"?'<div class="ni-note">'+svg(fileIcon(cur),12)+' '+esc((S.data.docs||[]).find(d=>d.path===cur)?.title||baseName(cur))+'</div>':"");
 const body=node.querySelector(".ni-body");
 if(tab==="tags")return renderTags(pid);
 if(!cur){body.innerHTML=emptyState("document","没有打开笔记","打开一篇笔记，这里会显示它的大纲、谁链接到它、它链接到谁。");return;}
 if(tab==="outline")return renderOutline(pid);
 if(!Notes.links||Notes.links.path!==cur)Notes.links={path:cur,data:await rpc("note_links",{path:cur}).catch(()=>null)};
 const data=Notes.links.data;if(!data){body.innerHTML='<p class="muted pad">读不到这篇的链接。</p>';return;}
 if(Dock.panels[pid]?.tab!==tab||Notes.current!==cur)return;
 const snippet=(d,l)=>'<a class="ni-line" data-action="open-file" data-path="'+esc(d.path)+'" data-line="'+l.line+'">'+esc(shorten(l.text,140))+'</a>';
 const docRow=(d,extra="")=>'<div class="ni-doc"><div class="ni-doc-head"><a data-action="open-file" data-path="'+esc(d.path)+'">'+svg(fileIcon(d.path),12)+' '+esc(d.title)+'</a>'+(d.link?'<small>'+esc(linkName[d.link]||d.link)+'</small>':"")+extra+'</div>'+(d.lines||[]).map(l=>snippet(d,l)).join("")+'</div>';
 if(tab==="links"){
  body.innerHTML='<h5>链接到这里的 · '+data.backlinks.length+'</h5>'+(data.backlinks.map(d=>docRow(d)).join("")||'<p class="muted">还没有。在别的笔记里写 [[' +esc(data.title)+']] 就连过来了。</p>')+
   '<h5>提到了「'+esc(data.title)+'」但没有链接的 · '+data.unlinked.length+'</h5>'+(data.unlinked.map(d=>docRow(d,button("链上","ni-linkup",'data-path="'+esc(d.path)+'"',"ghost xs"))).join("")||'<p class="muted">没有。</p>');
 }else{
  body.innerHTML='<h5>这篇链接到的 · '+data.outgoing.length+'</h5>'+(data.outgoing.map(o=>'<div class="ni-doc"><div class="ni-doc-head">'+
   (o.path?'<a data-action="open-file" data-path="'+esc(o.path)+'">'+svg(fileIcon(o.path),12)+' '+esc(o.name)+'</a><small>'+esc(kindName[o.kind]||"文件")+'</small>':
    '<span class="ni-missing">'+svg("document",12)+' '+esc(o.name)+'</span><small>还没有</small>'+button("新建","ni-create",'data-name="'+esc(o.name)+'"',"ghost xs"))+'</div></div>').join("")||'<p class="muted">这篇还没有链接。写 [[ 就能挑一篇连过去。</p>');
 }
}
function renderOutline(pid){
 const node=Dock.els[pid]?.querySelector(".ni-body");if(!node||(Dock.panels[pid].tab||"outline")!=="outline"||!Notes.current)return;
 const heads=headingsOf(noteText(Notes.current)),top=Math.min(...heads.map(h=>h.level),6);
 const at=heads.filter(h=>h.line<=Notes.cursorLine).pop();
 node.innerHTML=heads.map(h=>'<a class="ni-head'+(h===at?" on":"")+'" style="--d:'+(h.level-top)+'" data-action="ni-goto" data-line="'+h.line+'">'+esc(h.title)+'</a>').join("")||
  '<p class="muted pad">这篇没有标题。用 # 开头写一行就是一个标题，这里会列出来，点一下跳过去。</p>';
}
async function renderTags(pid){
 const p=Dock.panels[pid],node=Dock.els[pid]?.querySelector(".ni-body");if(!node)return;
 if(!Notes.tags)Notes.tags=await rpc("tags").catch(()=>[]);
 const q=(p.tagQuery||"").trim().toLowerCase(),cur=Notes.current,doc=cur&&(S.data.docs||[]).find(d=>d.path===cur);
 const mine=doc?Notes.tags.filter(t=>t.docs.some(d=>d.path===cur)).map(t=>t.tag):[];
 const list=Notes.tags.filter(t=>!q||t.tag.toLowerCase().includes(q));
 node.innerHTML='<input class="side-input" data-ni-tag-query="'+pid+'" placeholder="筛选标签…" value="'+esc(p.tagQuery||"")+'"/>'+
  (mine.length?'<h5>这篇的标签</h5><div class="ni-chips">'+mine.map(t=>'<button class="chip" data-action="ni-tag" data-pid="'+pid+'" data-tag="'+esc(t)+'">#'+esc(t)+'</button>').join("")+'</div>':"")+
  '<h5>全部标签 · '+Notes.tags.length+'</h5>'+(list.map(t=>'<div class="ni-tag'+(p.tag===t.tag?" open":"")+'"><a data-action="ni-tag" data-pid="'+pid+'" data-tag="'+esc(t.tag)+'">#'+esc(t.tag)+'<small>'+t.count+'</small></a>'+
   (p.tag===t.tag?t.docs.map(d=>'<a class="ni-line" data-action="open-file" data-path="'+esc(d.path)+'">'+svg(fileIcon(d.path),12)+' '+esc(d.title)+'</a>').join(""):"")+'</div>').join("")||
   '<p class="muted">还没有标签。在笔记的标签栏里写，或者正文里写 #标签。</p>');
}
// A tag clicked anywhere opens the tag list beside the note, with that tag's notes.
function showTag(tag){
 let pid=null;eachStack(s=>{if(!pid)pid=s.tabs.find(x=>Dock.panels[x]?.type==="noteinfo")||null;});
 if(!pid)pid=openPanel({type:"noteinfo"});else activate(pid);
 Object.assign(Dock.panels[pid],{tab:"tags",tag,tagQuery:""});saveLayout();Notes.tags=null;renderNoteInfo(pid);
}

/* ---- the folder tree ------------------------------------------------------------------------------------------------ */
async function notesSection(){
 const tools=iconButton("notenew","note-new","新笔记",'data-folder=""')+iconButton("folderplus","folder-new","新文件夹",'data-folder=""')+iconButton("calendar","note-daily","今天的日记")+
  iconButton("more","note-more","排序、折叠和更多");
 const starred=(S.data.starred||[]).map(id=>(S.data.docs||[]).find(d=>d.id===id)).filter(Boolean);
 const q=Notes.query.trim().toLowerCase();
 let body;
 if(q)body=(S.data.docs||[]).filter(d=>d.path.startsWith("notes/")&&(d.title.toLowerCase().includes(q)||d.path.toLowerCase().includes(q))).map(d=>noteRow(d,0,true)).join("")||'<p class="side-empty">没有符合的笔记。</p>';
 else body=await noteTree("notes",0)||'<p class="side-empty">还没有笔记。点上面的「新笔记」，或者 Ctrl+N 随手写一篇。</p>';
 return {tools,body:'<input class="side-input" data-side-input="notes" placeholder="筛选笔记…  Ctrl+O 快速打开" value="'+esc(Notes.query)+'"/>'+
  (starred.length?sideGroup("收藏",starred.map(d=>noteRow(d,0,true))):"")+'<div class="note-tree" data-drop-folder="notes" data-note-root>'+body+'</div>'};
}
async function noteTree(path,depth){
 const entries=await treeEntries(path),docs=new Map((S.data.docs||[]).map(d=>[d.path,d])),sort=S.ui.note_sort||"name";
 const name=e=>docs.get(e.path)?.title||e.name.replace(/\.md$/,"");
 const files=entries.filter(e=>e.type==="file").sort((a,b)=>{
  if(sort.startsWith("updated")){const x=String(docs.get(a.path)?.updated||""),y=String(docs.get(b.path)?.updated||"");return sort==="updated"?y.localeCompare(x):x.localeCompare(y);}
  const c=name(a).localeCompare(name(b),"zh",{numeric:true});return sort==="name-desc"?-c:c;
 });
 let out="";
 for(const e of entries.filter(e=>e.type==="dir")){
  const open=Side.open.has(e.path);
  out+=folderRow(e,depth,open);
  if(open)out+=await noteTree(e.path,depth+1);
 }
 for(const e of files)out+=docs.get(e.path)?noteRow(docs.get(e.path),depth):fileRow(e,depth);
 return out;
}
function renameBox(path,value){return '<input class="side-rename" data-rename="'+esc(path)+'" value="'+esc(value)+'"/>';}
function folderRow(e,depth,open){
 const renaming=Notes.renaming===e.path;
 return '<div class="side-row note-folder" '+(renaming?"":'data-action="tree-toggle"')+' data-path="'+esc(e.path)+'" data-note-path="'+esc(e.path)+'" data-note-kind="folder" data-drop-folder="'+esc(e.path)+'" draggable="true" style="--d:'+depth+'">'+
  svg(open?"chevrondown":"chevron",12)+svg("folder",14)+(renaming?renameBox(e.path,e.name):'<span class="t">'+esc(e.name)+'</span>')+'</div>';
}
function noteRow(d,depth,flat=false){
 const renaming=Notes.renaming===d.path,sort=S.ui.note_sort||"name";
 const where=flat?d.path.split("/").slice(1,-1).join("/"):"";
 return '<div class="side-row note-row'+(d.path===Notes.current?" on":"")+'" '+(renaming?"":'data-action="open-file"')+' data-path="'+esc(d.path)+'" data-note-path="'+esc(d.path)+'" data-note-kind="note" data-note-id="'+esc(d.id)+'" data-title="'+esc(d.title)+'" draggable="true" style="--d:'+depth+'" title="'+esc(d.path)+'">'+
  svg((S.data.starred||[]).includes(d.id)?"star":"document",13)+(renaming?renameBox(d.path,d.title):'<span class="t">'+esc(d.title)+'</span>')+
  (where?'<small>'+esc(where)+'</small>':sort.startsWith("updated")?'<small>'+esc(fmtDate(d.updated))+'</small>':"")+'</div>';
}
function fileRow(e,depth){
 const renaming=Notes.renaming===e.path;
 return '<div class="side-row note-row" '+(renaming?"":'data-action="open-file"')+' data-path="'+esc(e.path)+'" data-note-path="'+esc(e.path)+'" data-note-kind="file" draggable="true" style="--d:'+depth+'">'+
  svg(fileIcon(e.path),13)+(renaming?renameBox(e.path,e.name):'<span class="t">'+esc(e.name)+'</span>')+'</div>';
}
// Open the folders a path sits in, so its row is on screen.
function revealPath(path){const parts=String(path).split("/");for(let i=2;i<parts.length;i++)Side.open.add(parts.slice(0,i).join("/"));}
async function startRename(path){
 Notes.renaming=path;Notes.query="";revealPath(path);await renderSide();
 const box=el(".side-rename");if(!box)return;box.focus();box.select();
}
async function finishRename(box,keep=true){
 const path=box.dataset.rename,value=box.value.trim();Notes.renaming=null;
 const row=box.closest("[data-note-kind]"),kind=row?.dataset.noteKind,old=kind==="note"?row.dataset.title:kind==="folder"?baseName(path):baseName(path);
 if(!keep||!value||value===old)return renderSide();
 try{
  await flushAll();
  let now;
  if(kind==="note"){const r=await rpc("doc_save",{path,title:value});now=r.path;if(r.relinked)toast("改了名，"+r.relinked+" 篇里链到它的 [[链接]] 也跟着改了");}
  else if(kind==="folder")now=(await rpc("folder_rename",{path,name:value})).path;
  else now=(await rpc("file_rename",{path,name:value})).path;
  pathMoved(path,now);
 }catch(e){toast(e.message,"error");}
 await refreshState();Side.entries={};renderSide();
}
function uniqueTitle(base){
 const taken=new Set((S.data.docs||[]).map(d=>d.title.toLowerCase()));
 if(!taken.has(base.toLowerCase()))return base;
 for(let i=2;;i++)if(!taken.has((base+" "+i).toLowerCase()))return base+" "+i;
}
// The folder new things go into: the one asked for, else the open note's.
function targetFolder(a){return a?.dataset.folder!=null&&a.dataset.folder!==""?a.dataset.folder.replace(/^notes\/?/,""):folderOf(Notes.current);}
async function newNote(folder,body="",title=null){
 const r=await rpc("doc_create",{kind:"note",title:title||uniqueTitle("未命名"),folder,body});
 if(folder)Side.open.add("notes/"+folder);
 await refreshState();Side.entries={};
 openFile(r.path);
 // Straight into the title, selected, as Obsidian does.
 for(let i=0;i<30;i++){await new Promise(ok=>setTimeout(ok,80));const pid=Object.keys(Files).find(x=>Dock.panels[x]?.path===r.path);const t=Dock.els[pid]?.querySelector(".doc-title");if(t){t.focus();t.select();break;}}
 return r.path;
}
function fillTemplate(text,title){
 const now=new Date(),pad=n=>String(n).padStart(2,"0");
 const date=now.getFullYear()+"-"+pad(now.getMonth()+1)+"-"+pad(now.getDate()),time=pad(now.getHours())+":"+pad(now.getMinutes());
 return String(text||"").replace(/\{\{\s*title\s*\}\}/g,title).replace(/\{\{\s*date\s*\}\}/g,date).replace(/\{\{\s*time\s*\}\}/g,time);
}
function templates(){return (S.data.docs||[]).filter(d=>d.path.startsWith(TEMPLATE_DIR+"/"));}
async function templateBody(path){return (await rpc("file_read",{path})).doc?.body||"";}
async function dailyNote(){
 const now=new Date(),pad=n=>String(n).padStart(2,"0"),title=now.getFullYear()+"-"+pad(now.getMonth()+1)+"-"+pad(now.getDate());
 const had=(S.data.docs||[]).find(d=>d.title===title&&d.path.startsWith("notes/"+DAILY_DIR+"/"));
 if(had)return openFile(had.path);
 const tpl=templates().find(d=>d.title===DAILY_DIR||d.title==="日记模板");
 const r=await rpc("doc_create",{kind:"note",title,folder:DAILY_DIR,body:tpl?fillTemplate(await templateBody(tpl.path),title):""});
 Side.open.add("notes/"+DAILY_DIR);await refreshState();Side.entries={};
 return openFile(r.path,{line:1,select:false});
}
function noteMenu(path,kind,at){
 const d=(S.data.docs||[]).find(x=>x.path===path),item=(action,icon,label,extra="")=>'<button data-action="'+action+'" data-path="'+esc(path)+'" data-kind="'+kind+'" '+extra+'>'+svg(icon,14)+'<span>'+label+'</span></button>';
 const folder=kind==="folder"?path:kind==="root"?"notes":"";
 const tpl=templates();
 let html="";
 if(kind==="note"||kind==="file")html=item("open-file","document","打开")+item("note-open-side","split","在旁边打开")+'<hr/>'+item("note-rename","edit","重命名")+item("note-move","folder","移动到…")+
  (d?item("note-dup","copy","复制一份")+item("note-star","star",(S.data.starred||[]).includes(d.id)?"取消收藏":"收藏",'data-id="'+esc(d.id)+'"')+item("note-copylink","link","复制链接 [[…]]",'data-title="'+esc(d.title)+'"'):"")+
  '<hr/>'+item("note-delete","trash","删除");
 else html=item("note-new","notenew","新笔记",'data-folder="'+esc(folder)+'"')+item("folder-new","folderplus","新文件夹",'data-folder="'+esc(folder)+'"')+
  (tpl.length?'<div class="menu-label">从模板新建</div>'+tpl.map(t=>'<button data-action="note-template" data-folder="'+esc(folder)+'" data-template="'+esc(t.path)+'">'+svg("document",14)+'<span>'+esc(t.title)+'</span></button>').join(""):
   '<div class="menu-empty">在 notes/模板/ 里放笔记就能当模板用（{{title}} {{date}} {{time}} 会被替换）</div>')+
  (kind==="folder"?'<hr/>'+item("note-rename","edit","重命名")+item("note-move","folder","移动到…")+item("note-delete","trash","删除这个文件夹"):"");
 popMenu(at,html,{cls:"menu-wide"});
}
async function moveDialog(path){
 const folders=["notes"];
 const walk=async p=>{for(const e of await treeEntries(p))if(e.type==="dir"&&e.path!==path){folders.push(e.path);await walk(e.path);}};
 await walk("notes");
 modal(modalHead("把「"+baseName(path)+"」移到…")+'<div class="move-list">'+folders.filter(f=>f!==path.split("/").slice(0,-1).join("/")).map(f=>
  '<button class="pal-item" data-action="note-move-to" data-path="'+esc(path)+'" data-folder="'+esc(f)+'">'+svg("folder",14)+'<span>'+esc(f==="notes"?"笔记（最外层）":f.slice(6))+'</span></button>').join("")+'</div>');
}
async function moveNote(path,folder){
 if(!path||!folder||path===folder)return;
 try{await flushAll();const r=await rpc("move",{path,folder});pathMoved(path,r.path);Side.open.add(folder);}
 catch(e){toast(e.message,"error");}
 await refreshState();Side.entries={};renderSide();
}
async function notesAction(kind,a){
 const path=a.dataset.path;
 switch(kind){
  case "note-new":return newNote(targetFolder(a));
  case "note-template":{const title=uniqueTitle("未命名");return newNote(targetFolder(a),fillTemplate(await templateBody(a.dataset.template),title),title);}
  case "folder-new":{
   const parent=a.dataset.folder?"notes/"+targetFolder(a):"notes",base="新文件夹",names=new Set((await treeEntries(parent)).map(e=>e.name));
   let name=base;for(let i=2;names.has(name);i++)name=base+" "+i;
   const r=await rpc("folder_create",{parent,name});Side.open.add(parent);Side.entries={};return startRename(r.path);
  }
  case "note-daily":return dailyNote();
  case "note-more":return popMenu(a,'<div class="menu-label">排序</div>'+NOTE_SORT.map(([v,t])=>'<button data-action="note-sort-set" data-sort="'+v+'">'+svg((S.ui.note_sort||"name")===v?"check":"sort",14)+'<span>'+t+'</span></button>').join("")+'<hr/>'+
   '<button data-action="note-fold">'+svg("fold",14)+'<span>全部折叠</span></button><button data-action="note-switcher">'+svg("search",14)+'<span>快速打开 · Ctrl O</span></button>'+
   '<button data-action="noteinfo-open">'+svg("list",14)+'<span>大纲与链接</span></button>');
  case "noteinfo-open":return openPanel({type:"noteinfo"});
  case "note-sort-set":S.ui.note_sort=a.dataset.sort;saveUi();return renderSide();
  case "note-fold":Side.open=new Set([...Side.open].filter(p=>!p.startsWith("notes/")));return renderSide();
  case "note-rename":return startRename(path);
  case "note-move":return moveDialog(path);
  case "note-move-to":closeModal();return moveNote(path,a.dataset.folder);
  case "note-open-side":{
   const anchor=stackOf(Dock.focus)||targetStack("mine"),pid=findPanel({type:"file",path})||openPanel({type:"file",path});
   detach(pid);splitBeside(anchor,"right",stackNode([pid]));tidy();renderDock();saveLayout();return;
  }
  case "note-dup":{const d=(await rpc("file_read",{path})).doc;if(!d)return;return newNote(folderOf(path),d.body,uniqueTitle(d.title+" 副本"));}
  case "note-star":{const on=!(S.data.starred||[]).includes(a.dataset.id);S.data.starred=await rpc("star",{id:a.dataset.id,on});toast(on?"已收藏，在笔记列表最上面":"已取消收藏");return renderSide();}
  case "note-copylink":{const text="[["+a.dataset.title+"]]";await writeClipboard(text);return toast("已复制 "+text);}
  case "note-delete":{
   const folder=a.dataset.kind==="folder";
   const inside=folder?(S.data.docs||[]).filter(d=>d.path.startsWith(path+"/")).length:0;
   if(!await ask(folder?"它们会留在学习库的历史里，可以恢复。":"它会留在学习库的历史里，可以恢复。",{title:folder?"删除文件夹「"+baseName(path)+"」"+(inside?"和里面的 "+inside+" 篇笔记":"")+"？":"删除「"+baseName(path)+"」？",...{danger:true,ok:"删除"}}))return;
   await flushAll();await rpc("file_delete",{path});
   for(const pid of Object.keys(Dock.panels)){const p=Dock.panels[pid];if(p.path===path||p.path?.startsWith(path+"/")){if(Files[pid]){Files[pid].dirty=false;Files[pid].cellDrafts.clear();}await closePanel(pid);}}
   Side.entries={};await refreshState();return renderSide();
  }
  case "ni-tab":Dock.panels[a.dataset.pid].tab=a.dataset.tab;saveLayout();if(a.dataset.tab==="tags")Notes.tags=null;return renderNoteInfo(a.dataset.pid);
  case "ni-goto":{
   const pid=Object.keys(Files).find(x=>Dock.panels[x]?.path===Notes.current&&stackOf(x));if(!pid)return openFile(Notes.current,{line:Number(a.dataset.line),select:false});
   activate(pid);if(Files[pid].mode==="preview"){Files[pid].mode="live";renderFile(pid);}return gotoIn(pid,{line:Number(a.dataset.line),select:false});
  }
  case "ni-tag":{const p=Dock.panels[a.dataset.pid];p.tag=p.tag===a.dataset.tag?null:a.dataset.tag;saveLayout();return renderTags(a.dataset.pid);}
  case "ni-linkup":{await rpc("link_mention",{path:a.dataset.path,title:Notes.links?.data?.title});Notes.links=null;toast("链上了");return noteInfoChanged();}
  case "ni-create":return openWiki(a.dataset.name,Object.keys(Files).find(x=>Dock.panels[x]?.path===Notes.current));
  case "note-switcher":return switcher();
  case "switcher-create":return newNote(folderOf(Notes.current),"",a.dataset.title);
 }
 return null;
}

/* ---- quick switcher: Ctrl + O --------------------------------------------------------------------------------------- */
function switcher(){
 modal('<div class="palette"><div class="palette-input">'+svg("document",18)+'<input id="palette-q" data-switcher placeholder="输入标题打开一篇；没有就新建" autocomplete="off"/></div><div class="palette-list" id="palette-list"></div><div class="palette-hint">↑↓ 选择 · Enter 打开 · 找不到时最后一项是新建 · Esc 关闭</div></div>',"palette-modal");
 switcherFilter("");setTimeout(()=>el("#palette-q")?.focus(),20);
}
// Letters in order, closer together and earlier scoring higher; recent notes first when nothing is typed.
function fuzzy(q,s){
 q=q.toLowerCase();s=s.toLowerCase();if(!q)return 1;
 const at=s.indexOf(q);if(at>=0)return 100-at;
 let i=0,score=0,last=-1;for(const ch of q){const j=s.indexOf(ch,i);if(j<0)return 0;score+=j===last+1?3:1;last=j;i=j+1;}
 return score;
}
function switcherFilter(q){
 const box=el("#palette-list");if(!box)return;
 const term=q.trim(),docs=(S.data.docs||[]).map(d=>({d,s:fuzzy(term,d.title)*2+fuzzy(term,d.path)/2})).filter(x=>x.s>0);
 docs.sort((a,b)=>term?b.s-a.s:String(b.d.updated).localeCompare(String(a.d.updated)));
 const rows=docs.slice(0,40).map(({d})=>'<button class="pal-item" data-action="open-file" data-path="'+esc(d.path)+'">'+svg(fileIcon(d.path),14)+'<span>'+esc(d.title)+'<small>'+esc(d.path)+'</small></span><em>'+esc(kindName[d.kind]||d.kind)+'</em></button>');
 if(term&&!docByTitle(term))rows.push('<button class="pal-item" data-action="switcher-create" data-title="'+esc(term)+'">'+svg("notenew",14)+'<span>新建笔记「'+esc(term)+'」<small>放在 notes/'+esc(folderOf(Notes.current)||"")+'</small></span><em>新建</em></button>');
 box.innerHTML=rows.join("")||'<p class="muted pad">还没有笔记</p>';
}

/* ---- dragging in the tree: onto a folder moves it; into a note's text links to it --------------------------------- */
document.addEventListener("dragstart",e=>{
 const row=e.target.closest?.("#side [data-note-path]");if(!row)return;
 Notes.drag=row.dataset.notePath;e.dataTransfer.effectAllowed="copyMove";
 e.dataTransfer.setData("text/lattice-path",Notes.drag);
 if(row.dataset.title){e.dataTransfer.setData("text/lattice-title",row.dataset.title);e.dataTransfer.setData("text/plain","[["+row.dataset.title+"]]");}
});
document.addEventListener("dragend",()=>{Notes.drag=null;all(".drop-on").forEach(x=>x.classList.remove("drop-on"));});
document.addEventListener("dragover",e=>{
 if(!Notes.drag)return;const t=e.target.closest?.("[data-drop-folder]");
 all(".drop-on").forEach(x=>{if(x!==t)x.classList.remove("drop-on");});
 if(t&&t.dataset.dropFolder!==Notes.drag){e.preventDefault();t.classList.add("drop-on");}
});
document.addEventListener("drop",e=>{
 if(!Notes.drag)return;const t=e.target.closest?.("[data-drop-folder]");if(!t)return;
 e.preventDefault();const path=Notes.drag;Notes.drag=null;all(".drop-on").forEach(x=>x.classList.remove("drop-on"));
 safe(()=>moveNote(path,t.dataset.dropFolder));
});
document.addEventListener("keydown",e=>{
 const box=e.target.closest?.(".side-rename");if(!box)return;
 if(e.key==="Enter"){e.preventDefault();safe(()=>finishRename(box));}
 else if(e.key==="Escape"){e.preventDefault();e.stopPropagation();safe(()=>finishRename(box,false));}
},true);
document.addEventListener("focusout",e=>{const box=e.target.closest?.(".side-rename");if(box&&Notes.renaming===box.dataset.rename)safe(()=>finishRename(box));});
document.addEventListener("contextmenu",e=>{
 const row=e.target.closest?.("#side [data-note-path]"),root=e.target.closest?.("#side [data-note-root]");
 if(!row&&!root)return;e.preventDefault();
 noteMenu(row?row.dataset.notePath:"notes",row?row.dataset.noteKind:"root",{x:e.clientX,y:e.clientY});
});
