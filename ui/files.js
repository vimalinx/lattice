"use strict";
/* The learner's panels: one workbench for every file in the vault or a mounted folder.
   Text autosaves; notes, cards and topics get a form over their file; notebooks run in their kernel;
   any other file can be run. Agents only point at things here, or suggest changes from their panel. */
const Files={};
const MD_KINDS=new Set(["note","lesson","insight","topic","card"]);
function fileIcon(path){
 const p=String(path||""),ext=(p.match(/\.[^./]+$/)||[""])[0].toLowerCase();
 if(p.startsWith("topics/"))return "map";if(p.startsWith("cards/"))return "card";if(p.startsWith("lessons/"))return "book";if(p.startsWith("insights/"))return "bulb";
 if(ext===".ipynb")return "flask";if(ext===".md")return "document";if([".png",".jpg",".jpeg",".gif",".svg",".webp"].includes(ext))return "eye";
 if([".csv",".tsv",".json",".jsonl"].includes(ext))return "layout";return ext?"code":"file";
}
panelType("file",{side:"mine",icon:p=>fileIcon(p.path),
 title(p,node){
  const st=Files[node?.dataset.pid],skill=/^skills\/([^/]+)\/SKILL\.md$/.exec(p.path||"");
  if(skill)return "技能 · "+((typeof SkillBook!=="undefined"&&SkillBook.list?.find(s=>s.slug===skill[1])?.title)||skill[1]);
  return st?.data?.doc?.title||st?.data?.card?.title||st?.data?.notebook?.title||baseName(p.path);
 },
 dirty(p,node){const st=Files[node?.dataset.pid];return !!(st&&(st.dirty||[...(st.cellDrafts||new Map()).keys()].length));},
 mount(p,node,pid){Files[pid]={dirty:false,mode:[p.mode,S.ui.md_mode].find(m=>MD_MODES.some(x=>x[0]===m))||"live",cellDrafts:new Map(),timers:{},edited:false};node.innerHTML='<div class="loading">正在打开 '+esc(baseName(p.path))+'…</div>';loadFile(pid);},
 async beforeClose(p,node){
  const pid=node.dataset.pid,st=Files[pid];
  await flushFile(pid);
  if(p.scratch&&st?.edited&&S.config?.agent_auto_organize)safe(()=>organize(p.path));
  return true;
 },
 unmount(p,node){const pid=node.dataset.pid;viewedFlush(pid);destroyEditors(node);delete Files[pid];},
 shown(p,node){if(node)fitAreas(node);},
 screen(p,node){return fileScreen(node.dataset.pid);}});
function openFile(path,at=null){
 if(!path)return;
 return openPanel({type:"file",path},{then:pid=>{if(at)gotoIn(pid,at);}});
}
function filePanels(path){return Object.keys(Files).filter(pid=>Dock.panels[pid]?.path===path);}
async function loadFile(pid,keep=false){
 const p=Dock.panels[pid],st=Files[pid];if(!p||!st)return;
 const node=Dock.els[pid];
 const view=keep?captureView(node):null;
 let data;
 try{data=await rpc("file_read",{path:p.path});}
 catch(e){node.innerHTML=emptyState("file","打不开这个文件",e.message);return;}
 if(!Files[pid])return;
 // Our own save coming back, or a change elsewhere in the file: keep the editor (and its undo) when its text is the same.
 if(keep&&st.data&&!st.dirty&&!st.cellDrafts.size&&sameText(pid,data)){st.data=data;st.mtime=data.mtime;st.conflict=null;refreshTab(pid);noteFollow();return;}
 st.data=data;st.mtime=data.mtime;st.dirty=false;st.conflict=null;
 st.text=data.content??"";
 renderFile(pid);restoreView(node,view);refreshTab(pid);noteFollow();
 if(st.pendingAt){gotoIn(pid,st.pendingAt);st.pendingAt=null;}
}
function sameText(pid,data){
 const node=Dock.els[pid],old=Files[pid].data,val=f=>node?.querySelector('.cm-host[data-field="'+f+'"]')?.value;
 if(Boolean(old.notebook)!==Boolean(data.notebook)||Boolean(old.doc)!==Boolean(data.doc)||Boolean(old.card)!==Boolean(data.card)||Files[pid].raw)return false;
 if(data.notebook){
  const cells=data.notebook.cells,shown=all(".cm-host[data-cell-editor]",node);
  return cells.length===shown.length&&cells.every((c,i)=>shown[i].dataset.cellEditor===c.id&&shown[i].value===c.source&&c.kind===(old.notebook.cells[i]?.kind));
 }
 if(data.card)return val("body")===data.card.body&&val("mine")===data.card.mine&&data.card.title===old.card.title&&data.card.stage===old.card.stage;
 if(data.topic)return val("notes")===data.topic.notes&&data.topic.title===old.topic.title&&JSON.stringify(data.topic.route)===JSON.stringify(old.topic.route);
 if(data.doc)return val("body")===data.doc.body&&data.doc.title===old.doc.title;
 return data.content!=null&&val("text")===data.content;
}
function captureView(node){
 const out={scroll:[...all("[data-keep-scroll]",node)].map(n=>n.scrollTop)},active=document.activeElement,host=active?.closest?.(".cm-host");
 if(host&&node.contains(host)&&host.cmView){const s=host.cmView.state.selection.main;out.field=host.dataset.field;out.sel=[s.anchor,s.head];out.cm=true;}
 else if(active&&node.contains(active)&&active.dataset.field){out.field=active.dataset.field;out.sel=[active.selectionStart,active.selectionEnd];}
 return out;
}
function restoreView(node,v){
 if(!v)return;all("[data-keep-scroll]",node).forEach((n,i)=>{if(v.scroll[i]!=null)n.scrollTop=v.scroll[i];});
 if(!v.field)return;
 if(v.cm){const view=editorIn(node,v.field);if(view){const n=view.state.doc.length;view.focus();view.dispatch({selection:{anchor:Math.min(v.sel[0],n),head:Math.min(v.sel[1],n)}});}return;}
 const f=node.querySelector('[data-field="'+v.field+'"]');if(f){f.focus();try{f.setSelectionRange(v.sel[0],v.sel[1]);}catch(_){}}
}
function renderFile(pid){
 const st=Files[pid],d=st.data,node=Dock.els[pid];if(!node)return;
 let body;
 if(d.dir)body=dirView(pid);
 else if(d.image)body='<div class="image-view"><img src="'+d.image+'" alt="'+esc(d.name)+'"/></div>';
 else if(d.binary)body=emptyState("file","这是二进制文件","可以用系统里的程序打开它。")+'<div class="center">'+button(svg("external",13)+" 用系统程序打开","file-external",'data-pid="'+pid+'"',"")+'</div>';
 else if(d.notebook)body=notebookView(pid);
 else if(d.card)body=cardView(pid);
 else if(d.topic)body=topicView(pid);
 else if(d.doc)body=docView(pid);
 else body=textView(pid);
 destroyEditors(node);
 node.innerHTML='<div class="file">'+fileBar(pid)+(st.conflict?conflictBar(pid):"")+body+'</div>';
 mountEditors(node);fitAreas(node);hydrateVault(node,d.path);
}
function fileBar(pid){
 const st=Files[pid],d=st.data,p=Dock.panels[pid];
 const crumbs=String(d.path).split("/").map(esc).join('<i>/</i>');
 const state=st.conflict?'<span class="save-state bad">有冲突</span>':st.dirty?'<span class="save-state">编辑中…</span>':'<span class="save-state">已保存</span>';
 const run=d.runnable&&!d.notebook?button(svg("play",13)+" 运行","file-run",'data-pid="'+pid+'" title="以你的权限运行（Ctrl + Enter）"',"primary sm")+(d.env?'<span class="chip" title="Python 环境">'+esc(d.env)+'</span>':""):"";
 return '<div class="file-bar"><span class="crumbs" title="'+esc(d.path)+'">'+(d.external?svg("folder",12)+" ":"")+crumbs+'</span>'+state+'<span class="grow"></span>'+run+
  (d.readonly?'<span class="chip">只读</span>':"")+
  (d.doc||d.card||d.topic||(d.ext||"").toLowerCase()===".md"?iconButton("dots","file-menu","显示方式和原文",'data-pid="'+pid+'"'):"")+
  (d.external?"":iconButton("history","file-history","历史版本",'data-pid="'+pid+'"'))+
  iconButton("external","file-external","用系统程序打开",'data-pid="'+pid+'"')+
  (!d.readonly&&!d.external&&d.path!=="AGENTS.md"?iconButton("trash","file-delete","删除这个文件",'data-pid="'+pid+'"'):"")+'</div>';
}
function conflictBar(pid){
 return '<div class="conflict">'+svg("info",14)+' 这个文件在别处被改了，你这边也有没保存的修改。'+button("载入新版本（丢掉我的）","file-conflict",'data-pid="'+pid+'" data-keep="disk"',"ghost xs")+button("保留我的（覆盖）","file-conflict",'data-pid="'+pid+'" data-keep="mine"',"ghost xs")+'</div>';
}
function fitAreas(root){all("textarea.grow-area",root).forEach(t=>{t.style.height="auto";t.style.height=Math.max(60,Math.min(1400,t.scrollHeight+2))+"px";});}

/* ---- plain text and code -------------------------------------------------------------------------- */
// What every editor in a file panel does on typing, and how Markdown links, tags and images behave in it.
function editorHooks(pid,extra={}){
 return {onChange:host=>{fileInput(host);reportScreen();},onCursor:()=>noteCursor(pid),path:Dock.panels[pid]?.path,
  resolve:resolveWiki,openWiki:name=>openWiki(name,pid),openHref:href=>openHref(href,pid),openTag:tag=>showTag(tag),onAttach:()=>sideChanged(["data/附件/x"]),...extra};
}
function mdEditor(pid,text,attrs,opts={}){
 const st=Files[pid];
 return editorHost(text,attrs,{markdown:true,live:st.mode!=="source"&&st.mode!=="split",...editorHooks(pid,{keys:[{key:"Mod-e",run:()=>{safe(()=>toggleReading(pid));return true;}}]}),...opts});
}
function mdBody(pid,text,attrs,opts={}){
 const st=Files[pid];
 return '<div class="md-split mode-'+st.mode+'"><div class="md-edit" data-keep-scroll>'+mdEditor(pid,text,'class="editor prose" '+attrs,opts)+'</div><div class="md-preview markdown" data-keep-scroll>'+markdown(text)+'</div></div>';
}
function textView(pid){
 const st=Files[pid],d=st.data,ext=(d.ext||"").toLowerCase(),isCsv=[".csv",".tsv"].includes(ext);
 const md=ext===".md";
 if(isCsv&&st.mode!=="raw")return '<div class="file-tools">'+button("编辑原文","file-mode",'data-pid="'+pid+'" data-mode="raw"',"ghost xs")+'</div><div class="table-view" data-keep-scroll>'+csvTable(st.text,ext===".tsv"?"\t":",")+'</div>';
 const attrs='data-field="text" data-file-text="'+pid+'"';
 if(md)return mdBody(pid,st.text,attrs,{readonly:d.readonly});
 const editor=editorHost(st.text,'class="editor code" '+attrs,{filename:d.name,readonly:d.readonly,wrap:[".txt",".log"].includes(ext),
  ...editorHooks(pid,{keys:[{key:"Mod-Enter",run:()=>{if(!Files[pid]?.data?.runnable)return false;safe(()=>runFile(pid));return true;}}]})});
 const out=d.runnable?runOutput(pid):"";
 return '<div class="code-wrap" data-keep-scroll>'+editor+'</div>'+out+(isCsv?'<div class="file-tools">'+button("表格视图","file-mode",'data-pid="'+pid+'" data-mode="split"',"ghost xs")+'</div>':"");
}
function csvTable(text,sep){
 const rows=String(text).split(/\r?\n/).filter(Boolean).slice(0,300).map(r=>r.split(sep));
 if(!rows.length)return '<p class="muted">空表格</p>';
 return '<table><thead><tr>'+rows[0].map(c=>'<th>'+esc(c)+'</th>').join("")+'</tr></thead><tbody>'+rows.slice(1).map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join("")+'</tr>').join("")+'</tbody></table>';
}
// Live preview renders in place (the cursor's own line shows its marks); source shows the plain text; reading only renders.
const MD_MODES=[["live","实时预览"],["source","源码"],["split","分屏"],["preview","阅读"]];
// How a Markdown file shows, and the raw file behind a form: in the file's ⋯ menu, not on the page.
function fileMenu(pid,anchor){
 const st=Files[pid],d=st.data,form=d.doc||d.card||d.topic,mode=st.raw?"":st.mode;
 popMenu(anchor,'<div class="menu-label">显示方式 <small>Ctrl + E 在编辑和阅读之间切换</small></div>'+
  MD_MODES.map(([m,t])=>'<button data-action="file-mode" data-pid="'+pid+'" data-mode="'+m+'"'+(st.raw?" disabled":"")+'>'+svg(mode===m?"check":"document",14)+'<span>'+t+'</span></button>').join("")+
  (st.mode!=="preview"&&!st.raw?'<hr/><button data-action="file-table" data-pid="'+pid+'">'+svg("layout",14)+'<span>插入表格 · Ctrl Shift T</span></button>':"")+
  (form?'<hr/><button data-action="file-raw" data-pid="'+pid+'">'+svg(st.raw?"layout":"code",14)+'<span>'+(st.raw?"回到表单":"编辑原文（包括开头的属性）")+'</span></button>':"")+
  '<hr/><button data-action="open-settings" data-page="look">'+svg("sliders",14)+'<span>笔记默认的显示方式…</span></button>',{cls:"menu-wide"});
}
function runOutput(pid){
 const r=Files[pid].run;
 if(!r)return '<div class="run-out empty" data-run-out="'+pid+'"></div>';
 const label={running:"运行中…",completed:"完成",error:"出错",cancelled:"已停止",timeout:"超时"}[r.state]||r.state;
 return '<div class="run-out" data-run-out="'+pid+'"><div class="run-head"><span class="run-state s-'+esc(r.state)+'">'+esc(label)+'</span>'+(r.message?'<span>'+esc(r.message)+'</span>':"")+(r.seconds!=null?'<span>'+esc(r.seconds)+' 秒</span>':"")+
  '<span class="grow"></span>'+(r.state==="running"?button(svg("stop",12)+" 停止","run-stop",'data-run="'+esc(r.id)+'"',"ghost xs"):iconButton("close","run-clear","收起",'data-pid="'+pid+'"'))+'</div>'+
  '<div class="run-body">'+outputHtml(r.outputs)+(r.note?'<p class="run-note">'+esc(r.note)+'</p>':"")+
  (r.missing?'<p class="run-note">'+button("装上 "+esc(r.missing.package)+" 再运行","install-run",'data-pid="'+pid+'" data-package="'+esc(r.missing.package)+'" data-env="'+esc(r.missing.env)+'"',"primary xs")+'</p>':"")+'</div></div>';
}
function patchRun(pid){const box=Dock.els[pid]?.querySelector('[data-run-out="'+pid+'"]');if(box)box.outerHTML=runOutput(pid);}
async function runFile(pid){
 const st=Files[pid],p=Dock.panels[pid];
 await flushFile(pid);
 const r=await rpc("run",{path:p.path});
 st.run={id:r.run,state:"running",outputs:[],message:""};patchRun(pid);
}
function runEvent(evt){
 // Runs started from a file panel, and snippets run from a conversation.
 for(const pid of Object.keys(Files)){
  const r=Files[pid].run;if(!r||r.id!==evt.run)continue;
  if(evt.kind==="retry"){r.id=evt.next;r.message="装好了，正在重跑…";patchRun(pid);continue;}
  if(evt.kind==="output")r.outputs=evt.outputs;
  if(evt.kind==="status")r.message=evt.message||"";
  if(evt.kind==="finished")Object.assign(r,{state:evt.state,outputs:evt.outputs,seconds:evt.seconds,note:evt.note||"",message:"",missing:evt.missing||null});
  patchRun(pid);
 }
 for(const [id,r] of Object.entries(snippetRuns)){
  if(r.run!==evt.run)continue;
  if(evt.kind==="retry"){r.run=evt.next;continue;}
  const box=el('[data-snippet="'+id+'"]');
  if(evt.kind==="output")r.outputs=evt.outputs;
  if(evt.kind==="status")r.message=evt.message;
  if(evt.kind==="finished")Object.assign(r,{state:evt.state,outputs:evt.outputs});
  if(box)box.innerHTML='<div class="run-head"><span class="run-state s-'+esc(r.state||"running")+'">'+esc({completed:"完成",error:"出错",cancelled:"已停止",timeout:"超时"}[r.state]||"运行中…")+'</span>'+(r.message?'<span>'+esc(r.message)+'</span>':"")+'</div>'+outputHtml(r.outputs);
 }
 if(evt.kind==="finished"||evt.kind==="started")refreshState();
}

/* ---- Markdown documents with a form over their attributes ------------------------------------------------ */
function docView(pid){
 const st=Files[pid],d=st.data,a=d.doc.attrs||{},kind=d.kind;
 if(st.raw)return rawView(pid);
 const fields='<input class="doc-title" data-field="title" data-doc-field="title" value="'+esc(d.doc.title)+'" placeholder="标题"/>'+
  (kind==="note"?'<input class="doc-meta" data-field="tags" data-doc-field="tags" value="'+esc((a.tags||[]).join(", "))+'" placeholder="标签，用逗号分开"/>':"")+
  (kind==="lesson"?'<input class="doc-meta" data-field="objective" data-doc-field="objective" value="'+esc(a.objective||"")+'" placeholder="这一节想弄懂什么"/>':"")+
  (kind==="insight"?'<div class="doc-meta">'+(a.insight==="strength"?"做得好的地方":"薄弱点")+' · '+(a.state==="resolved"?"已克服":"主会话正在留意")+(a.state!=="resolved"?button("已克服","insight-resolve",'data-id="'+esc(d.doc.id)+'"',"ghost xs"):"")+'</div>':"");
 return '<div class="doc-head">'+fields+'</div>'+mdBody(pid,d.doc.body,'data-field="body" data-doc-field="body"',{placeholder:"开始写…  [[ 链接别的笔记，# 加标签，粘贴图片直接放进来"})+linksBlock(pid,d.links||[],d.doc.id);
}
function rawView(pid){
 return '<div class="code-wrap" data-keep-scroll>'+editorHost(Files[pid].text,'class="editor code" data-field="text" data-file-text="'+pid+'"',{markdown:true,live:false,...editorHooks(pid)})+'</div>';
}
function linksBlock(pid,links,id){
 const docs=new Map((S.data.docs||[]).map(d=>[d.id,d]));
 const rows=links.map(l=>{
  const out=l.source===id,other=out?l.target:l.source,doc=docs.get(other);
  const name=doc?doc.title:(other.startsWith("file:")?baseName(other.slice(5)):other);
  return '<div class="link-row">'+(out?"":'<a data-action="open-doc" data-id="'+esc(other)+'">'+esc(name)+'</a> ')+'<span class="link-kind">'+esc(linkName[l.kind]||l.kind)+'</span>'+(out?' <a data-action="'+(other.startsWith("file:")?"open-file":"open-doc")+'" data-id="'+esc(other)+'" data-path="'+esc(other.slice(5))+'">'+esc(name)+'</a>':" 这里")+
   (l.why?'<small>'+esc(l.why)+'</small>':"")+(out?iconButton("close","unlink","去掉这条关系",'data-id="'+esc(l.id)+'" data-pid="'+pid+'"'):"")+'</div>';
 }).join("");
 return '<details class="links"><summary>关系 · '+links.length+'</summary>'+rows+
  '<div class="link-add"><select data-link-kind="'+pid+'">'+Object.entries(linkName).filter(([k])=>!["branch_of","mentions"].includes(k)).map(([k,v])=>'<option value="'+k+'">'+esc(v)+'</option>').join("")+'</select>'+
  '<input data-link-target="'+pid+'" data-suggest="doc-titles" placeholder="连到哪个卡片、笔记或主题（输入标题）"/>'+button("连上","link-add",'data-pid="'+pid+'"',"ghost xs")+'</div></details>';
}

/* ---- knowledge cards: the learner's own parts are only edited here -------------------------------------- */
function cardView(pid){
 const st=Files[pid],c=st.data.card;
 if(st.raw)return rawView(pid);
 const due=c.due?new Date(c.due):null;
 return '<div class="card-view" data-keep-scroll><div class="doc-head"><input class="doc-title" data-field="title" data-card-field="title" value="'+esc(c.title)+'"/>'+
  '<label class="stage-pick">我到了哪一步<select data-card-stage="'+pid+'">'+Object.entries(stageName).map(([v,t])=>'<option value="'+v+'"'+(c.stage===v?" selected":"")+'>'+t+'</option>').join("")+'</select></label></div>'+
  '<label class="field-label">自测题<input data-field="question" data-card-field="question" value="'+esc(c.question)+'" placeholder="一个要求预测、解释或判断的问题"/></label>'+
  '<div class="mine-box"><div class="mine-title">'+svg("edit",13)+' 我的理解 <small>只有你能写，AI 读得到改不了</small></div>'+mdEditor(pid,c.mine,'class="mine-editor prose" data-field="mine" data-card-mine="'+pid+'"',{live:true,placeholder:"先理解，再用自己的话写下来。"})+'</div>'+
  '<div class="field-label">解释与例子</div>'+mdBody(pid,c.body,'data-field="body" data-card-field="body"')+
  '<div class="card-sort"><label class="field-label">哪一类<select data-field="type" data-card-field="type">'+opt(c.type||"",[["","没分"],...Object.entries(cardTypeName)])+'</select></label>'+
   '<label class="field-label">领域 <small>同一领域的卡在卡片库里排在一起</small><input data-field="area" data-card-field="area" data-suggest="card-areas" value="'+esc(c.area||"")+'" placeholder="例如：线性代数、注意力机制"/></label></div>'+cardAreas()+
  '<label class="field-label">标签<input data-field="tags" data-card-field="tags" value="'+esc((c.tags||[]).join(", "))+'"/></label>'+
  '<div class="review-row">'+svg("history",14)+' 回顾 '+c.reviews+' 次'+(due?' · 下次 '+esc(fmtDate(c.due,true)):"")+'<span class="grow"></span>记得多少：'+
  button("忘了","card-rate",'data-rating="again" data-id="'+esc(c.id)+'"',"sm")+button("模糊","card-rate",'data-rating="hard" data-id="'+esc(c.id)+'"',"sm")+button("记得","card-rate",'data-rating="good" data-id="'+esc(c.id)+'"',"sm primary")+'</div>'+
  linksBlock(pid,c.links||[],c.id)+
  '<details class="evidence" open><summary>证据 · 轨迹里和它有关的 '+c.evidence.length+' 条</summary>'+(c.evidence.map(journalRow).join("")||'<p class="muted">还没有。作答、运行、回顾和 AI 的判断都会记在这里。</p>')+'</details></div>';
}

// The areas cards already have, offered when one is named.
function cardAreas(){return '<datalist id="card-areas">'+[...new Set((S.data.cards||[]).map(c=>c.area).filter(Boolean))].map(a=>'<option value="'+esc(a)+'">').join("")+'</datalist>';}

/* ---- topics: the archive, the route, and what hangs off it --------------------------------------------- */
function topicView(pid){
 const st=Files[pid],t=st.data.topic,d=st.data;
 if(st.raw)return rawView(pid);
 const active=S.data.active_topic===t.id;
 const route=t.route||[],docs=new Map((S.data.docs||[]).map(x=>[x.id,x]));
 const branches=(S.data.topics||[]).filter(x=>x.parent===t.id);
 return '<div class="topic-view" data-keep-scroll><div class="doc-head"><input class="doc-title" data-field="title" data-topic-field="title" value="'+esc(t.title)+'"/>'+
  '<select data-topic-state="'+pid+'">'+[["active","进行中"],["parked","先放一放"],["completed","学完了"]].map(([v,n])=>'<option value="'+v+'"'+(t.state===v?" selected":"")+'>'+n+'</option>').join("")+'</select>'+
  (active?'<span class="chip on">正在学</span>':button(svg("bot",13)+" 在这里接着学","topic-focus",'data-id="'+esc(t.id)+'"',"primary sm"))+iconButton("trash","topic-delete","删除主题",'data-id="'+esc(t.id)+'"')+'</div>'+
  '<label class="field-label">想弄懂的问题<textarea class="grow-area" data-field="question" data-topic-field="question" rows="2">'+esc(t.question)+'</textarea></label>'+
  (t.parent?'<p class="muted">是「<a data-action="open-doc" data-id="'+esc(t.parent)+'">'+esc(topicTitle(t.parent))+'</a>」的分支</p>':"")+
  '<section class="route"><h4>'+svg("map",14)+' 主干路线 <small>主会话维护，你也可以直接改</small></h4><ol>'+route.map((s,i)=>'<li'+routeClass(s)+'><span class="route-title">'+routeStep(s,docs)+'</span>'+(s.why?'<small>'+esc(s.why)+'</small>':"")+
   '<span class="route-ops">'+iconButton("arrowup","route-move",'上移','data-pid="'+pid+'" data-i="'+i+'" data-d="-1"')+iconButton("close","route-drop","去掉这一站",'data-pid="'+pid+'" data-i="'+i+'"')+'</span></li>').join("")+'</ol>'+
   '<div class="route-add"><input data-route-add="'+pid+'" placeholder="加一站：写下标题，回车"/></div></section>'+
  '<div class="field-label">主题档案 <small>讲到了哪里、留下的疑问、接下来往哪走。主会话跨天续讲时读它</small></div>'+
  mdBody(pid,t.notes,'data-field="notes" data-topic-field="notes"')+
  '<section class="topic-lists">'+
  listBox("里面的内容",(d.inside||[]).map(x=>'<a data-action="open-file" data-path="'+esc(x.path)+'">'+svg(fileIcon(x.path),12)+' '+esc(x.title)+'</a>'))+
  listBox("分支",branches.map(b=>'<a data-action="open-doc" data-id="'+esc(b.id)+'">'+svg("map",12)+' '+esc(b.title)+'</a>'))+
  listBox("练习",(d.practices||[]).map(x=>'<a data-action="open-practice" data-id="'+esc(x.id)+'">'+svg("code",12)+' '+esc(x.title)+' <small>'+esc({active:"进行中",reviewing:"复盘中",done:"已复盘"}[x.state]||x.state)+'</small></a>'))+
  listBox("薄弱点和做得好的地方",(d.insights||[]).map(x=>'<span class="insight '+esc(x.kind)+(x.state==="resolved"?" resolved":"")+'"><a data-action="open-doc" data-id="'+esc(x.id)+'">'+esc(x.title)+'</a>'+(x.kind==="weak"&&x.state==="active"?button("已克服","insight-resolve",'data-id="'+esc(x.id)+'"',"ghost xs"):"")+'</span>'))+
  '</section></div>';
}
function listBox(title,items){return '<div class="list-box"><h5>'+esc(title)+'</h5>'+(items.join("")||'<p class="muted">还没有</p>')+'</div>';}

/* ---- notebooks ------------------------------------------------------------------------------------------- */
function notebookView(pid){
 const st=Files[pid],d=st.data,nb=d.notebook,k=d.kernel||{},sandboxed=d.mode!=="mine";
 const state={offline:"内核未启动",starting:"正在启动",ready:"就绪",busy:"运行中",restarting:"重启中",error:"内核出错",queued:"排队中",installing:"正在装包"}[k.state]||k.state||"内核未启动";
 return '<div class="nb-bar"><span class="kernel-chip k-'+esc(k.state||"offline")+'" data-kernel-chip="'+pid+'">'+svg("terminal",12)+' '+esc(state)+(k.message?' · '+esc(k.message):"")+'</span>'+
  '<button class="chip toggle'+(sandboxed?" on":"")+'" data-action="kernel-mode" data-pid="'+pid+'" title="'+(sandboxed?"内核在沙箱里：看不到家目录、不联网；AI 也能在里面运行。点一下改成用你的权限":"内核用你的权限运行（能联网、能读你的文件），AI 不能在里面运行。点一下改回沙箱")+'">'+(sandboxed?svg("shield",12)+" 沙箱":"我的权限")+'</button>'+
  (d.gpu_ready||d.gpu?'<button class="chip toggle'+(d.gpu?" on":"")+'" data-action="kernel-gpu" data-pid="'+pid+'" title="'+(d.gpu?"内核在显卡上（经 nvidia-run）：训练、CUDA 都能用；空闲 15 分钟自动关掉让显卡休眠。点一下改回只用 CPU":"内核只用 CPU。点一下换到显卡上（内核会重启，变量要重新算）")+'">'+svg("spark",12)+(d.gpu?" 显卡":" CPU")+'</button>':"")+
  '<span class="chip" title="Python 环境">'+esc(d.env||"default")+'</span><span class="grow"></span>'+
  button(svg("play",13)+" 全部运行","nb-run-all",'data-pid="'+pid+'"',"primary sm")+iconButton("stop","nb-interrupt","中断",'data-pid="'+pid+'"')+iconButton("refresh","nb-restart","重启内核（清空变量）",'data-pid="'+pid+'"')+'</div>'+
  '<div class="cells" data-keep-scroll>'+nb.cells.map((c,i)=>cellHtml(pid,c,i)).join("")+
  '<div class="cell-add">'+button(svg("plus",13)+" 代码","nb-add",'data-pid="'+pid+'" data-kind="code"',"ghost sm")+button(svg("plus",13)+" 文字","nb-add",'data-pid="'+pid+'" data-kind="markdown"',"ghost sm")+'</div>'+
  '<p class="muted small">Shift + Enter 运行当前格 · Tab 缩进 · 每本实验笔记有自己的内核，重启后输出还在、变量要重新算</p></div>';
}
function cellHtml(pid,c,i){
 const st=Files[pid],src=st.cellDrafts.get(c.id)??c.source,stale=c.run_source!=null&&c.run_source!==src;
 return '<section class="cell '+c.kind+'" data-cell="'+esc(c.id)+'"><div class="cell-bar"><span class="cell-count" data-cell-count="'+esc(c.id)+'">'+(c.kind==="code"?"In ["+(c.count??" ")+"]":"文字")+'</span>'+
  (c.by?'<span class="chip ai">'+esc(who(c.by))+' 写的</span>':"")+'<span class="grow"></span>'+
  (c.kind==="code"?iconButton("play","nb-run","运行这一格",'data-pid="'+pid+'" data-cell="'+esc(c.id)+'"'):"")+
  iconButton("arrowup","nb-move","上移",'data-pid="'+pid+'" data-cell="'+esc(c.id)+'" data-d="-1"')+
  '<button class="icon" data-action="nb-move" data-pid="'+pid+'" data-cell="'+esc(c.id)+'" data-d="1" title="下移">↓</button>'+
  iconButton("trash","nb-delete","删除这一格",'data-pid="'+pid+'" data-cell="'+esc(c.id)+'"')+'</div>'+
  editorHost(src,'class="cell-editor '+(c.kind==="code"?"code":"prose")+'" data-field="cell-'+esc(c.id)+'" data-cell-editor="'+esc(c.id)+'" data-pid="'+pid+'"',
  {markdown:c.kind!=="code",live:true,language:"python",filename:"cell.py",gutters:false,placeholder:c.kind==="code"?"":"（空的文字格，在这里写）",
   ...editorHooks(pid,{keys:[{key:"Shift-Enter",run:()=>{safe(()=>runCells(pid,[c.id]));return true;}}]})})+
  '<div class="cell-out" data-cell-out="'+esc(c.id)+'">'+outputHtml(c.outputs)+'</div>'+
  '<div class="cell-stale'+(stale?" on":"")+'" data-cell-stale="'+esc(c.id)+'">代码改过了：上面的输出属于之前那次运行</div></section>';
}
function kernelEvent(evt){
 for(const pid of filePanels(evt.path)){
  const st=Files[pid],node=Dock.els[pid];if(!st?.data?.notebook||!node)continue;
  if(evt.state)st.data.kernel={...(st.data.kernel||{}),state:evt.state,message:evt.message||""};
  const chip=node.querySelector('[data-kernel-chip="'+pid+'"]');
  if(chip&&evt.state){const label={offline:"内核未启动",starting:"正在启动",ready:"就绪",busy:"运行中",restarting:"重启中",error:"内核出错",queued:"排队中",installing:"正在装包"}[evt.state]||evt.state;
   chip.className="kernel-chip k-"+evt.state;chip.innerHTML=svg("terminal",12)+" "+esc(label)+(evt.message?" · "+esc(evt.message):"");}
  if(!evt.cell)continue;
  const cell=st.data.notebook.cells.find(c=>c.id===evt.cell);
  const out=node.querySelector('[data-cell-out="'+evt.cell+'"]'),count=node.querySelector('[data-cell-count="'+evt.cell+'"]');
  if(evt.kind==="run_started"){if(out)out.innerHTML="";if(count)count.textContent="In [*]";}
  if(evt.kind==="output"&&out)out.innerHTML=outputHtml(evt.outputs);
  if(evt.kind==="run_finished"){
   if(cell&&["completed","error"].includes(evt.state)){cell.outputs=evt.outputs;cell.count=evt.count;cell.run_source=st.cellDrafts.get(cell.id)??cell.source;}
   if(out)out.innerHTML=outputHtml(evt.outputs);
   if(count)count.textContent="In ["+(evt.count??" ")+"] · "+({completed:"完成",error:"出错",cancelled:"已停止",skipped:"跳过"}[evt.state]||evt.state);
   const stale=node.querySelector('[data-cell-stale="'+evt.cell+'"]');if(stale)stale.classList.remove("on");
  }
 }
}
async function saveCell(pid,id){
 const st=Files[pid];if(!st)return;const src=st.cellDrafts.get(id);if(src==null)return;
 clearTimeout(st.timers[id]);
 const c=st.data.notebook.cells.find(x=>x.id===id);
 await rpc("cell_save",{path:Dock.panels[pid].path,id,source:src,kind:c?.kind||"code"});
 if(c)c.source=src;
 if(st.cellDrafts.get(id)===src)st.cellDrafts.delete(id);
 st.edited=true;refreshTab(pid);
}
async function runCells(pid,cells){
 const st=Files[pid];for(const id of [...st.cellDrafts.keys()])await saveCell(pid,id);
 await rpc("run",{path:Dock.panels[pid].path,cells:cells||null});
}

/* ---- saving, conflicts, closing -------------------------------------------------------------------------- */
function markDirty(pid){
 const st=Files[pid];st.dirty=true;st.edited=true;st.lastKey=Date.now();refreshTab(pid);
 const s=Dock.els[pid]?.querySelector(".save-state");if(s&&!st.conflict){s.textContent="编辑中…";s.className="save-state";}
 clearTimeout(st.timers.save);st.timers.save=setTimeout(()=>safe(()=>saveFile(pid)),900);
 if(!st.typingSent||Date.now()-st.typingSent>2500){st.typingSent=Date.now();rpc("typing",{path:Dock.panels[pid].path}).catch(()=>{});}
}
async function saveFile(pid){
 const st=Files[pid],p=Dock.panels[pid];if(!st||!st.dirty||st.conflict)return;
 clearTimeout(st.timers.save);
 const d=st.data;st.dirty=false;
 try{
  let r;
  if(st.raw||(!d.doc&&!d.card&&!d.topic))r=await rpc("file_write",{path:p.path,content:st.text,mtime:st.mtime});
  else r=await rpc("doc_save",{path:p.path,mtime:st.mtime,...st.fields});
  st.mtime=r.mtime;st.fields=null;
  if(r.path&&r.path!==p.path){p.path=r.path;saveLayout();}
 }catch(e){
  if(e.conflict){st.conflict=true;st.dirty=true;renderFile(pid);return;}
  st.dirty=true;throw e;
 }
 refreshTab(pid);
 // Wherever this note is embedded, show what was just saved.
 embedsChanged([p.path,d.path]);
 const s=Dock.els[pid]?.querySelector(".save-state");if(s){s.textContent="已保存";s.className="save-state";}
}
async function flushFile(pid){
 const st=Files[pid];if(!st)return;
 if(st.dirty&&!st.conflict)await saveFile(pid);
 for(const id of [...st.cellDrafts.keys()])await saveCell(pid,id);
}
async function flushAll(){for(const pid of Object.keys(Files))await safe(()=>flushFile(pid));}
function fileChanged(evt){
 for(const path of evt.paths||[]){
  for(const pid of filePanels(path)){
   const st=Files[pid];if(!st)continue;
   if(st.dirty||st.cellDrafts.size){if(evt.external||!st.saving){st.conflict=true;renderFile(pid);}continue;}
   loadFile(pid,true);
  }
 }
}
function gotoIn(pid,at){
 const st=Files[pid],node=Dock.els[pid];
 if(!st?.data){if(st)st.pendingAt=at;return;}
 if(at.cell){const c=node.querySelector('[data-cell="'+at.cell+'"]');if(c){c.scrollIntoView({block:"center"});c.classList.add("flash");setTimeout(()=>c.classList.remove("flash"),1600);}return;}
 if(st.mode==="preview"){st.mode="live";renderFile(pid);}
 const view=node.querySelector(".cm-host.editor")?.cmView;if(view)editorGoto(view,at);
}
async function organize(path){
 await rpc("organize",{path});
 Organizer.busy=true;Organizer.path=path;Organizer.actions=[];renderOrganizer();
}
const Organizer={busy:false,path:null,actions:[],text:""};
function renderOrganizer(){
 const box=el("#organizer");if(!box)return;
 if(!Organizer.busy&&!Organizer.text){box.innerHTML="";box.hidden=true;return;}
 box.hidden=false;
 box.innerHTML=(Organizer.busy?'<span class="thinking-dot"></span> 正在整理 '+esc(baseName(Organizer.path))+'…':svg("check",13)+' '+esc(Organizer.text||"整理好了"))+
  actionChips(Organizer.actions,[])+(Organizer.busy?"":iconButton("close","organizer-dismiss","收起"));
}
function organizeFinished(evt){
 Organizer.busy=false;Organizer.actions=evt.actions||[];
 Organizer.text=evt.stop_reason==="end_turn"?(String(evt.text||"").trim().split("\n").filter(Boolean).pop()||"整理好了"):"整理没有完成："+evt.stop_reason;
 renderOrganizer();
}
function dirView(pid){
 const d=Files[pid].data;
 return '<div class="dir-view">'+(d.entries||[]).map(e=>'<a data-action="'+(e.type==="dir"?"open-dir":"open-file")+'" data-path="'+esc(e.path)+'">'+svg(e.type==="dir"?"folder":fileIcon(e.path),14)+' '+esc(e.name)+'</a>').join("")+'</div>';
}
/* What this panel shows right now, for the agents' screen(). */
function fileScreen(pid){
 const st=Files[pid],p=Dock.panels[pid],node=Dock.els[pid];if(!st?.data||!node)return {path:p.path};
 const out={path:p.path,kind:st.data.kind,dirty:!!(st.dirty||st.cellDrafts.size),typing:!!st.lastKey&&Date.now()-st.lastKey<5000};
 const view=node.querySelector(".cm-host.editor")?.cmView;
 if(view&&view.dom.offsetParent){
  out.viewport=editorViewport(view);
  const lines=view.state.doc.toString().split("\n"),head=lines.slice(0,out.viewport.from+2).reverse().find(l=>/^#{1,4}\s/.test(l));if(head)out.viewport.section=head.replace(/^#+\s*/,"");
  if(view.hasFocus){const s=view.state.selection.main;out.cursor_line=view.state.doc.lineAt(s.head).number;if(!s.empty)out.selection=view.state.sliceDoc(s.from,s.to).slice(0,600);}
 }
 if(st.data.notebook){
  const cells=all(".cell",node),scroller=node.querySelector(".cells"),r=scroller?.getBoundingClientRect();
  const seen=cells.map((c,i)=>({c,i})).filter(({c})=>{const b=c.getBoundingClientRect();return r&&b.bottom>r.top&&b.top<r.bottom;});
  out.visible_cells=seen.map(({c,i})=>({index:i+1,id:c.dataset.cell}));
  const focused=document.activeElement?.dataset?.cellEditor;if(focused)out.cursor_cell=focused;
  out.kernel=st.data.kernel?.state||"offline";out.kernel_mode=st.data.mode;
 }
 if(st.run)out.last_run={state:st.run.state,seconds:st.run.seconds};
 return out;
}

/* ---- input on file panels ---------------------------------------------------------------------------------- */
function fileInput(t){
 const node=t.closest(".panel"),pid=node?.dataset.pid,st=Files[pid];if(!st)return false;
 if(t.dataset.fileText){st.text=t.value;markDirty(pid);previewSoon(pid,t.value);return true;}
 const field=t.dataset.docField||t.dataset.cardField||t.dataset.topicField;
 if(field){
  const name=field==="notes"?"body":field,value=name==="tags"?t.value.split(/[,，\s]+/).map(x=>x.trim().replace(/^#/,"")).filter(Boolean):t.value;
  st.fields={...(st.fields||{}),[name]:value};markDirty(pid);
  if(name==="body")previewSoon(pid,t.value);
  if(t.classList.contains("grow-area"))fitAreas(t.parentElement);
  return true;
 }
 if(t.dataset.cardMine){
  st.edited=true;fitAreas(t.parentElement);clearTimeout(st.timers.mine);
  st.timers.mine=setTimeout(()=>safe(()=>rpc("card_mine",{id:st.data.card.id,mine:t.value})),900);return true;
 }
 if(t.dataset.cellEditor){
  const id=t.dataset.cellEditor,c=st.data.notebook.cells.find(x=>x.id===id);
  st.cellDrafts.set(id,t.value);refreshTab(pid);fitAreas(t.parentElement);
  const prev=t.parentElement.querySelector(".cell-preview");if(prev)prev.innerHTML=markdown(t.value);
  const stale=node.querySelector('[data-cell-stale="'+id+'"]');if(stale&&c)stale.classList.toggle("on",c.run_source!=null&&c.run_source!==t.value);
  clearTimeout(st.timers[id]);st.timers[id]=setTimeout(()=>safe(()=>saveCell(pid,id)),800);
  st.lastKey=Date.now();if(!st.typingSent||Date.now()-st.typingSent>2500){st.typingSent=Date.now();rpc("typing",{path:Dock.panels[pid].path}).catch(()=>{});}
  return true;
 }
 return false;
}
function previewSoon(pid,text){
 const st=Files[pid];clearTimeout(st.timers.preview);
 st.timers.preview=setTimeout(()=>{const pv=Dock.els[pid]?.querySelector(".md-preview");if(pv&&pv.offsetParent){pv.innerHTML=markdown(text);hydrateVault(pv,Dock.panels[pid]?.path);}},250);
}
// Ctrl + E: between editing (live preview, or whichever editing view was last used) and reading.
async function toggleReading(pid){
 const st=Files[pid],p=Dock.panels[pid];if(!st)return;
 await flushFile(pid);
 if(st.mode==="preview")st.mode=st.lastEdit||"live";else{st.lastEdit=st.mode;st.mode="preview";}
 p.mode=st.mode;saveLayout();renderFile(pid);
 if(st.mode!=="preview")focusEditor(Dock.els[pid]);else Dock.els[pid]?.querySelector(".md-preview")?.focus?.();
}
async function fileChange(t){
 const pid=t.closest(".panel")?.dataset.pid,st=Files[pid];if(!st)return false;
 if(t.dataset.cardStage){await rpc("card_mine",{id:st.data.card.id,stage:t.value});await loadFile(pid,true);toast("理解阶段已更新为「"+stageName[t.value]+"」");return true;}
 if(t.dataset.topicState){st.fields={...(st.fields||{}),state:t.value};st.dirty=true;await saveFile(pid);await refreshState();return true;}
 return false;
}
function fileKey(e){
 const t=e.target,pid=t.closest?.(".panel")?.dataset.pid,st=Files[pid];if(!st)return false;
 const code=t.classList.contains("code")||t.dataset.cellEditor;
 if(e.key==="Tab"&&code&&!e.ctrlKey){e.preventDefault();t.setRangeText("    ",t.selectionStart,t.selectionEnd,"end");t.dispatchEvent(new Event("input",{bubbles:true}));return true;}
 if(t.dataset.cellEditor&&e.key==="Enter"&&e.shiftKey){e.preventDefault();safe(()=>runCells(pid,[t.dataset.cellEditor]));return true;}
 if(t.dataset.fileText&&e.key==="Enter"&&(e.ctrlKey||e.metaKey)&&st.data.runnable){e.preventDefault();safe(()=>runFile(pid));return true;}
 // From the title, Enter moves into the text, as in Obsidian.
 if((t.dataset.docField==="title"||t.dataset.cardField==="title"||t.dataset.topicField==="title")&&e.key==="Enter"){e.preventDefault();focusEditor(t.closest(".panel"));return true;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="e"&&(st.data.doc||st.data.card||st.data.topic||(st.data.ext||"").toLowerCase()===".md")){e.preventDefault();safe(()=>toggleReading(pid));return true;}
 if(t.dataset.routeAdd&&e.key==="Enter"&&t.value.trim()){e.preventDefault();const route=[...(st.data.topic.route||[]),{title:t.value.trim()}];safe(()=>saveRoute(pid,route));return true;}
 return false;
}
async function saveRoute(pid,route){
 const st=Files[pid];await rpc("topic_update",{id:st.data.topic.id,route});await loadFile(pid,true);
}
async function fileAction(kind,a){
 const pid=a.dataset.pid,st=Files[pid],p=Dock.panels[pid];
 switch(kind){
 case "file-run":return runFile(pid);
 case "run-stop":return rpc("run_stop",{run:a.dataset.run});
 case "run-clear":st.run=null;return patchRun(pid);
 case "install-run":{
  st.run.missing=null;st.run.note="正在安装 "+a.dataset.package+"…";patchRun(pid);
  Files[pid].afterInstall=a.dataset.package;await rpc("env_install",{name:a.dataset.env,packages:[a.dataset.package]});return;
 }
 case "file-menu":return fileMenu(pid,a);
 case "file-table":{const v=Dock.els[pid]?.querySelector(".cm-host.editor")?.cmView;if(!v)return;if(Files[pid].mode!=="live"){Files[pid].mode="live";p.mode="live";renderFile(pid);}
  const view=Dock.els[pid].querySelector(".cm-host.editor").cmView;view.focus();return insertTable(view);}
 case "file-mode":await flushFile(pid);st.mode=a.dataset.mode;p.mode=st.mode;saveLayout();renderFile(pid);return st.mode!=="preview"&&focusEditor(Dock.els[pid]);
 case "file-raw":await flushFile(pid);st.raw=!st.raw;return loadFile(pid);
 case "file-external":return rpc("file_external",{path:p.path});
 case "file-delete":
  if(!await ask("它会留在学习库的历史里，可以恢复。",{title:"删除「"+baseName(p.path)+"」？",...{danger:true,ok:"删除"}}))return;
  await rpc("file_delete",{path:p.path});st.dirty=false;st.cellDrafts.clear();await closePanel(pid);return refreshState();
 case "file-conflict":
  if(a.dataset.keep==="disk"){st.dirty=false;st.cellDrafts.clear();st.conflict=null;return loadFile(pid);}
  st.conflict=null;st.mtime=null;st.dirty=true;return saveFile(pid);
 case "file-history":return showHistory(pid);
 case "nb-run-all":return runCells(pid,null);
 case "nb-run":return runCells(pid,[a.dataset.cell]);
 case "nb-interrupt":return rpc("kernel_interrupt",{path:p.path});
 case "nb-restart":if(!await ask("变量会清空，笔记和输出都会保留。",{title:"重启内核？",ok:"重启"}))return;return rpc("kernel_restart",{path:p.path});
 case "nb-move":await saveCell(pid,a.dataset.cell);await rpc("cell_move",{path:p.path,id:a.dataset.cell,direction:Number(a.dataset.d)});return loadFile(pid,true);
 case "nb-delete":if(!await ask("",{title:"删除这一格？",...{danger:true,ok:"删除"}}))return;st.cellDrafts.delete(a.dataset.cell);await rpc("cell_delete",{path:p.path,id:a.dataset.cell});return loadFile(pid,true);
 case "nb-add":{await flushFile(pid);const last=st.data.notebook.cells.at(-1)?.id;await rpc("cell_save",{path:p.path,source:"",kind:a.dataset.kind,after:last||null});await loadFile(pid,true);
  all(".cm-host[data-cell-editor]",Dock.els[pid]).at(-1)?.cmView?.focus();return;}
 case "kernel-gpu":{
  if(st.data.kernel?.state==="busy"&&!await ask("正在运行的会被中断，内核重启后变量要重新算。",{title:(st.data.gpu?"换回只用 CPU？":"换到显卡上？"),ok:"换"}))return;
  await rpc("kernel_gpu",{path:p.path,on:!st.data.gpu});return loadFile(pid,true);
 }
 case "kernel-mode":{
  const next=st.data.mode==="mine"?"sandbox":"mine";
  if(next==="mine"&&!await ask("它就能联网、能读你的文件，AI 也就不能在里面运行了。",{title:"把内核切到你自己的权限？",ok:"切过去"}))return;
  await rpc("kernel_mode",{path:p.path,mode:next});return loadFile(pid,true);
 }
 case "card-rate":{const id=a.dataset.id;const c=await rpc("card_review",{id,rating:a.dataset.rating});toast("下次回顾："+fmtDate(c.due,true));
  const mini=a.closest(".mini-card");if(mini){mini.querySelector(".mini-rate").innerHTML='<small>已记下 · 下次 '+esc(fmtDate(c.due,true))+'</small>';}
  for(const x of filePanels(c.path))loadFile(x,true);return refreshState();}
 case "insight-resolve":await rpc("insight_resolve",{id:a.dataset.id});toast("已标为克服");if(pid)await loadFile(pid,true);return refreshState();
 case "link-add":{
  const node=Dock.els[pid],kindSel=node.querySelector('[data-link-kind="'+pid+'"]'),target=node.querySelector('[data-link-target="'+pid+'"]').value.trim();
  if(!target)return;const id=st.data.card?.id||st.data.doc?.id;
  await rpc("link",{source:id,target,kind:kindSel.value});return loadFile(pid,true);
 }
 case "unlink":await rpc("unlink",{id:a.dataset.id});return loadFile(pid,true);
 case "route-move":{const r=[...st.data.topic.route],i=+a.dataset.i;if(i<1)return;[r[i-1],r[i]]=[r[i],r[i-1]];return saveRoute(pid,r);}
 case "route-drop":{const r=st.data.topic.route.filter((_,i)=>i!==+a.dataset.i);return saveRoute(pid,r);}
 }
}
async function showHistory(pid){
 const p=Dock.panels[pid],versions=await rpc("file_history",{path:p.path});
 modal(modalHead("历史版本 · "+baseName(p.path))+'<p class="muted">每一次保存、每一个 AI 动作都是学习库里的一次提交。打开一个版本对照，或者把它恢复成现在的内容。</p>'+
  (versions.map(v=>'<div class="version"><div><b>'+esc(v.subject)+'</b><small>'+esc(fmtDate(v.at,true))+' · '+esc(v.author)+'</small></div>'+
   button("查看","version-view",'data-pid="'+pid+'" data-commit="'+esc(v.commit)+'"',"ghost xs")+button("恢复","version-restore",'data-pid="'+pid+'" data-commit="'+esc(v.commit)+'"',"ghost xs")+'</div>').join("")||'<p>还没有更早的版本。</p>'),"large");
}
async function versionAction(kind,a){
 const pid=a.dataset.pid,p=Dock.panels[pid],v=await rpc("file_version",{path:p.path,commit:a.dataset.commit});
 if(kind==="version-view")return modal(modalHead("版本预览")+'<pre class="version-text">'+esc(v.content||"（这个版本里文件不存在）")+'</pre>'+'<div class="modal-actions">'+button("返回","file-history",'data-pid="'+pid+'"',"ghost")+button("恢复这个版本","version-restore",'data-pid="'+pid+'" data-commit="'+esc(a.dataset.commit)+'"',"primary")+'</div>',"large");
 if(!await ask("现在的内容会留在历史里。",{title:"把这个文件恢复成这个版本？",ok:"恢复"}))return;
 await rpc("file_write",{path:p.path,content:v.content||""});closeModal();await loadFile(pid);toast("已恢复");
}
