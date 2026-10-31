"use strict";
/* Highlights and notes, the same on everything that is read: a selection anywhere becomes an anchor (annotations.py keeps
   them), and each kind of window draws its own: editors with decorations, rendered text with the browser's text
   highlights, a book in its own frame. The 批注 window lists them and goes back to where they stand. */
const Marks={items:{},ranges:new Map(),here:null,hereTitle:"",color:"yellow"};
const MARK_COLORS={yellow:"黄",green:"绿",blue:"蓝",pink:"粉"};
const markStyle=m=>m.ask?"ask":m.by==="me"?m.color:"ai";
// What a window's content is, as annotations know it.
function markWhere(pid){
 const p=Dock.panels[pid];if(!p)return null;
 if(p.type==="file"||p.type==="book")return p.path||null;
 if(p.type==="web")return "web:"+(Reader[pid]?.page?.url||p.url);
 if(p.type==="chat"){const t=Chat[pid]?.thread||p.thread;return t?"thread:"+t:null;}
 return null;
}

/* ---- finding words again ---------------------------------------------------------------------------------------- */
// Spacing and Markdown's marks are what differ between a source and the same words shown. Matches annotations.py.
const LOOSE_CHAR=/[\s*_`~#>|]/;
function looseText(s){return String(s||"").replace(/[\s*_`~#>|]+/g,"");}
function looseMap(s){const chars=[],map=[];for(let i=0;i<s.length;i++)if(!LOOSE_CHAR.test(s[i])){chars.push(s[i]);map.push(i);}return {text:chars.join(""),map};}
function sharedEnd(a,b){let n=0;while(n<a.length&&n<b.length&&a[a.length-1-n]===b[b.length-1-n])n++;return n;}
function sharedStart(a,b){let n=0;while(n<a.length&&n<b.length&&a[n]===b[n])n++;return n;}
/* The quote in a text: the place whose surroundings fit best when it occurs more than once, and by its two ends when
   something inside it was rendered differently (a link's address). Offsets are into the original text. */
function locateText(m,a){
 const want=looseText(a.text),before=looseText(a.before),after=looseText(a.after);if(!want)return null;
 let best=-1,score=-1,size=want.length;
 for(let i=m.text.indexOf(want);i>=0;i=m.text.indexOf(want,i+1)){
  const s=sharedEnd(m.text.slice(Math.max(0,i-before.length),i),before)+sharedStart(m.text.slice(i+size,i+size+after.length),after);
  if(s>score){score=s;best=i;}
 }
 if(best<0&&size>=16){
  const head=m.text.indexOf(want.slice(0,8)),tail=head<0?-1:m.text.indexOf(want.slice(-8),head+8);
  if(tail>=0&&tail<head+size*3){best=head;size=tail+8-head;}
 }
 return best<0?null:{from:m.map[best],to:m.map[best+size-1]+1};
}
function textIndex(root){
 const skip=n=>n.parentElement?.closest(".katex-mathml,script,style")?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:skip}),nodes=[],starts=[];let text="";
 for(let n=walker.nextNode();n;n=walker.nextNode()){nodes.push(n);starts.push(text.length);text+=n.data;}
 return {nodes,starts,map:looseMap(text)};
}
function indexRange(ix,hit){
 const at=pos=>{let lo=0,hi=ix.nodes.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(ix.starts[mid]<=pos)lo=mid;else hi=mid-1;}return [ix.nodes[lo],pos-ix.starts[lo]];};
 const range=document.createRange();range.setStart(...at(hit.from));const [node,off]=at(hit.to-1);range.setEnd(node,off+1);return range;
}
function domLocate(root,a){const ix=textIndex(root),hit=locateText(ix.map,a);return hit?indexRange(ix,hit):null;}

/* ---- a selection, as an anchor ------------------------------------------------------------------------------------ */
function aroundRange(root,range){
 const a=document.createRange(),b=document.createRange();
 a.selectNodeContents(root);a.setEnd(range.startContainer,range.startOffset);
 b.selectNodeContents(root);b.setStart(range.endContainer,range.endOffset);
 return {before:a.toString().slice(-50),after:b.toString().slice(0,50)};
}
function sectionOfLine(doc,line){
 for(let n=line,low=Math.max(1,line-400);n>=low;n--){const m=/^#{1,6}\s+(.+?)\s*#*\s*$/.exec(doc.line(n).text);if(m)return m[1].slice(0,60);}
 return "";
}
function selectionAnchor(t,text){
 const pid=t.closest?.(".panel")?.dataset.pid,where=pid&&markWhere(pid);if(!where)return null;
 const p=Dock.panels[pid],cm=t.closest?.(".cm-editor"),view=cm&&CV.EditorView.findFromDOM(cm);
 if(view){
  const s=view.state.selection.main;if(s.empty||p.type!=="file")return null;
  const doc=view.state.doc,line=doc.lineAt(s.from).number,host=view.dom.closest(".cm-host"),at={line};
  if(host?.dataset.cellEditor)at.cell=host.dataset.cellEditor;else if(host?.dataset.field&&host.dataset.field!=="text")at.field=host.dataset.field;
  return {source:where,at,label:sectionOfLine(doc,line)||"第 "+line+" 行",text:view.state.sliceDoc(s.from,s.to),before:view.state.sliceDoc(Math.max(0,s.from-50),s.from),after:view.state.sliceDoc(s.to,s.to+50)};
 }
 const sel=getSelection();if(!sel?.rangeCount||sel.isCollapsed)return null;
 const range=sel.getRangeAt(0),box=range.commonAncestorContainer,start=box.nodeType===1?box:box.parentElement;
 if(p.type==="chat"){
  const m=start.closest(".msg[data-mid]"),root=m?.querySelector(".msg-body")||m?.querySelector(".bubble");
  if(!root||!root.contains(start)||!/^\d+$/.test(m.dataset.mid))return null;
  return {source:where,at:{message:Number(m.dataset.mid)},label:"",text,...aroundRange(root,range)};
 }
 const root=start.closest(".md-preview,.reader-page,.cell .markdown");if(!root)return null;
 const cell=start.closest(".cell")?.dataset.cell,heads=all("h1,h2,h3,h4",root).filter(h=>h.compareDocumentPosition(start)&Node.DOCUMENT_POSITION_FOLLOWING);
 return {source:where,at:cell?{cell}:{},label:heads.length?heads[heads.length-1].textContent.trim().slice(0,60):"",text,...aroundRange(root,range)};
}

/* ---- loading and drawing ---------------------------------------------------------------------------------------- */
async function marksOf(where){
 // A change while this is on its way empties the cache: what comes back is still the answer for now, not kept.
 if(Marks.items[where])return Marks.items[where];
 const held=Marks.items,items=await rpc("annotations",{source:where}).catch(()=>[]);
 held[where]=items;return items;
}
async function marksRefresh(pid){
 const where=markWhere(pid);if(!where)return;
 const items=await marksOf(where);
 if(Dock.els[pid]&&markWhere(pid)===where)marksPaint(pid,items);
}
// Taking a window out of the page empties the ranges drawn in it: they are found again when it is back.
function marksShown(pid){if(Marks.ranges.get(pid)?.length)marksRefresh(pid);}
function marksChanged(){
 Marks.items={};
 Object.keys(Dock.panels).forEach(marksRefresh);
 Object.keys(Dock.panels).filter(pid=>Dock.panels[pid].type==="marks").forEach(renderMarks);
}
function marksPaint(pid,items){
 const p=Dock.panels[pid],node=Dock.els[pid],hits=[];if(!p||!node)return;
 if(p.type==="book")return bookMarks(pid,items);
 const onCell=(m,cell)=>!m.anchor.at?.cell||m.anchor.at.cell===cell;
 const dom=(root,list)=>{
  if(!list.length)return;const ix=textIndex(root);
  for(const m of list){const hit=locateText(ix.map,m.anchor);if(hit)hits.push({range:indexRange(ix,hit),item:m});}
 };
 if(p.type==="file"){
  for(const host of all(".cm-host",node)){
   const view=host.cmView;if(!view)continue;
   const cell=host.dataset.cellEditor,field=host.dataset.field,map=items.length?looseMap(view.state.doc.toString()):null,ranges=[];
   for(const m of items){
    if(!onCell(m,cell)||(m.anchor.at?.field&&field&&m.anchor.at.field!==field))continue;
    const hit=locateText(map,m.anchor);if(hit)ranges.push({...hit,id:m.id,style:markStyle(m),note:m.note});
   }
   setEditorMarks(view,ranges);
  }
  for(const root of all(".md-preview",node))dom(root,items);
  for(const root of all(".cell .markdown",node)){const cell=root.closest(".cell").dataset.cell;dom(root,items.filter(m=>m.anchor.at?.cell===cell));}
 }
 if(p.type==="web"){const root=node.querySelector(".reader-page");if(root)dom(root,items);}
 if(p.type==="chat")for(const box of all(".msg[data-mid]",node)){
  const here=items.filter(m=>String(m.anchor.at?.message)===box.dataset.mid),root=here.length&&(box.querySelector(".msg-body")||box.querySelector(".bubble"));
  if(root)dom(root,here);
 }
 Marks.ranges.set(pid,hits);marksDraw();
}
function marksDraw(){
 if(!window.Highlight||!CSS.highlights)return;
 const groups={yellow:[],green:[],blue:[],pink:[],ai:[],ask:[]};
 for(const [pid,hits] of Marks.ranges){if(!Dock.panels[pid]){Marks.ranges.delete(pid);continue;}hits.forEach(x=>groups[markStyle(x.item)]?.push(x.range));}
 for(const [k,ranges] of Object.entries(groups))CSS.highlights.set("lmark-"+k,new Highlight(...ranges));
}
function markFlash(range){
 (range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement)?.scrollIntoView({block:"center"});
 if(!window.Highlight)return;CSS.highlights.set("lmark-flash",new Highlight(range));setTimeout(()=>CSS.highlights.delete("lmark-flash"),1800);
}
function markAtPoint(e){
 const cm=e.target.closest?.("[data-mark]");if(cm)return cm.dataset.mark;
 const hits=Marks.ranges.get(e.target.closest?.(".panel")?.dataset.pid);if(!hits?.length)return null;
 const c=document.caretRangeFromPoint(e.clientX,e.clientY);
 return c?hits.find(x=>x.range.isPointInRange(c.startContainer,c.startOffset))?.item.id||null:null;
}
// Text that is only read opens its annotation on a click; in an editor a click places the cursor (the right button has it).
document.addEventListener("click",e=>{
 if(e.target.closest?.("a,button,input,textarea,select,.menu")||!getSelection()?.isCollapsed)return;
 if(e.target.closest?.(".cm-editor")&&!e.target.closest(".lmark-ask"))return;
 const id=markAtPoint(e),at={x:e.clientX,y:e.clientY};
 if(id)setTimeout(()=>safe(()=>markOpen(id,at)),0);
});

/* ---- one annotation ----------------------------------------------------------------------------------------------- */
function noteDialog(title,value=""){return dialog({title,input:{value,multiline:true,allowEmpty:true,placeholder:"写下你的想法（可以空着）",hint:"Ctrl Enter 存下"},ok:"存下"});}
async function markCreate(withNote){
 const anchor=Sel.anchor;if(!anchor)return;
 hidePop();
 const note=withNote?await noteDialog("批注这段话"):"";
 if(note==null)return;
 await rpc("annotation_add",{source:anchor.source,anchor,note,color:Marks.color});
 clearSelection();
}
function markWho(m){return (m.by==="me"?"":who(m.by)+" · ")+fmtDate(m.created,true);}
async function markOpen(id,at){
 const m=await rpc("annotation_get",{id}),mine=m.by==="me";
 if(m.ask)return askedOpen(id,at);
 popMenu(at,'<div class="mark-pop"><small>'+esc((m.label?m.label+" · ":"")+markWho(m))+(m.lost==="changed"?" · 原文已改":"")+'</small>'+
  '<blockquote>'+esc(shorten(m.text,160))+'</blockquote>'+(m.note?'<div class="mark-note">'+esc(m.note)+'</div>':"")+
  (mine?'<div class="mark-colors">'+Object.entries(MARK_COLORS).map(([c,t])=>'<button class="dot lmark-c-'+c+(m.color===c?" on":"")+'" data-action="mark-color" data-id="'+esc(id)+'" data-color="'+c+'" title="'+t+'"></button>').join("")+'</div>':"")+'</div>'+
  '<hr/><button data-action="mark-edit" data-id="'+esc(id)+'">'+svg("edit",14)+'<span>'+(m.note?"改批注":"写批注")+'</span></button>'+
  '<button data-action="mark-ask" data-id="'+esc(id)+'" data-agent="flash">'+svg("spark",14)+'<span>问快答</span></button>'+
  '<button data-action="mark-ask" data-id="'+esc(id)+'" data-agent="tutor">'+svg("bot",14)+'<span>问主会话</span></button>'+
  '<button data-action="mark-card" data-id="'+esc(id)+'">'+svg("card",14)+'<span>做成知识卡</span></button>'+
  '<button data-action="mark-link" data-id="'+esc(id)+'">'+svg("link",14)+'<span>复制链接，贴进笔记</span></button>'+
  '<hr/><button data-action="mark-delete" data-id="'+esc(id)+'">'+svg("trash",14)+'<span>删除</span></button>',{cls:"menu-mark",width:260});
}
/* ---- a question left where it was asked: a small window on the spot, or the 问答 window at the side once that is open ---- */
function askedBody(a){
 const said=x=>'<div class="asked-q">'+esc(x.question)+'</div>'+
  (x.gone?'<p class="muted">这段对话已经删除了。</p>':x.answer?'<div class="markdown asked-a">'+markdown(x.answer)+'</div>':'<p class="muted">'+(a.answering&&x===a?"快答正在回答…":"还没有回答。")+'</p>');
 return '<blockquote>'+esc(shorten(a.quote,200))+'</blockquote>'+said(a)+(a.also||[]).map(x=>'<div class="asked-more">'+said(x)+'</div>').join("");
}
async function askedOpen(id,at){
 const side=findPanel({type:"asked"});
 if(side){Dock.panels[side].ann=id;saveLayout();activate(side);return renderAsked(side);}
 const a=await rpc("annotation_asked",{id}),row=(action,icon,text)=>'<button data-action="'+action+'" data-id="'+esc(id)+'">'+svg(icon,14)+'<span>'+text+'</span></button>';
 const menu=popMenu(at,'<div class="mark-pop asked-pop">'+askedBody(a)+'</div><hr/>'+row("mark-side","layout","放到右侧")+(a.gone?"":row("mark-thread","spark","接着问"))+row("mark-deeper","bot","交给主会话深入讲")+row("mark-card","card","做成知识卡")+row("mark-go","marker","回到原处")+row("mark-delete","trash","去掉挂载点"),{cls:"menu-mark menu-asked",width:340});
 hydrateVault(menu,null);
}
function openAsked(id){
 const had=findPanel({type:"asked"});
 if(had){Dock.panels[had].ann=id;saveLayout();activate(had);renderAsked(had);return had;}
 const stack=stackOf(Dock.focus);
 if(WINDOW||!stack||Dock.layout.floats.some(f=>f.stack===stack))return openPanel({type:"asked",ann:id});
 const beside=stackNode([]);splitBeside(stack,"right",beside);
 return openPanel({type:"asked",ann:id},{stack:beside.id});
}
panelType("asked",{side:"mine",icon:"spark",title:()=>"问答",
 mount(p,node,pid){node.innerHTML='<div class="asked" data-keep-scroll></div>';renderAsked(pid);},
 screen(p){return {view:"问答",annotation:p.ann||null};}});
async function renderAsked(pid){
 const p=Dock.panels[pid],box=Dock.els[pid]?.querySelector(".asked");if(!box)return;
 if(!p.ann){box.innerHTML=emptyState("spark","点一处问过的话","带下划线的文字是你问过快答的地方，内容会显示在这里。");return;}
 const a=await rpc("annotation_asked",{id:p.ann}).catch(()=>null);
 if(!Dock.els[pid])return;
 if(!a){box.innerHTML=emptyState("spark","这条问答的挂载点已经去掉了","点别处带下划线的文字，内容会显示在这里。");return;}
 box.innerHTML='<small>'+esc(a.place.title+(a.label?" · "+a.label:"")+" · "+fmtDate(a.created,true))+'</small>'+askedBody(a)+'<div class="asked-tools">'+
  (a.gone?"":button(svg("spark",12)+" 接着问","mark-thread",'data-id="'+esc(p.ann)+'"',"ghost xs"))+button(svg("bot",12)+" 交给主会话深入讲","mark-deeper",'data-id="'+esc(p.ann)+'"',"ghost xs")+button(svg("marker",12)+" 回到原处","mark-go",'data-id="'+esc(p.ann)+'"',"ghost xs")+button(svg("card",12)+" 做成知识卡","mark-card",'data-id="'+esc(p.ann)+'"',"ghost xs")+'</div>';
 hydrateVault(box,null);
}
// An answer that was still on its way when the window opened.
function askedFinished(thread){
 Object.keys(Dock.panels).filter(pid=>Dock.panels[pid].type==="asked").forEach(renderAsked);
 const pop=el(".asked-pop");if(pop)closeMenus();
}
async function openAnnotation(id){const m=await rpc("annotation_get",{id});return anchorGo(m.source,m.anchor);}
/* Back to where something was marked or quoted, wherever that is now. */
async function anchorGo(source,a){
 const pl=await rpc("anchor_place",{source,message:a.at?.message||null});
 if(pl.gone)return toast("它已经不在了","error");
 if(pl.kind==="thread"){
  const pid=openPanel({type:"chat",agent:pl.agent,thread:pl.thread});
  const go=(n=0)=>{
   const box=Dock.els[pid]?.querySelector('.msg[data-mid="'+a.at?.message+'"]');
   if(!box)return n<40&&setTimeout(()=>go(n+1),100);
   const root=box.querySelector(".msg-body")||box.querySelector(".bubble"),r=root&&domLocate(root,a);
   if(r)markFlash(r);else box.scrollIntoView({block:"center"});
  };
  return go();
 }
 if(pl.kind==="web"){
  const pid=openWeb(pl.url);
  const go=(n=0)=>{
   const root=Dock.els[pid]?.querySelector(".reader-page");
   if(!root)return n<80&&setTimeout(()=>go(n+1),100);
   const r=domLocate(root,a);if(r)markFlash(r);else toast("这一页上找不到那段话了");
  };
  return go();
 }
 return openFile(pl.path,{anchor:a});
}
/* In a file's window: the rendered text when that is what shows, else the editor that has the words. */
function gotoAnchor(pid,a){
 const node=Dock.els[pid],st=Files[pid],cell=a.at?.cell;
 if(cell)node.querySelector('[data-cell="'+cell+'"]')?.scrollIntoView({block:"center"});
 if(st.mode==="preview"){const root=node.querySelector(".md-preview"),r=root&&domLocate(root,a);if(r){markFlash(r);return true;}}
 for(const host of all(".cm-host",node)){
  const view=host.cmView;if(!view||(cell&&host.dataset.cellEditor!==cell))continue;
  const hit=locateText(looseMap(view.state.doc.toString()),a);
  if(hit){view.focus();view.dispatch({selection:{anchor:hit.from,head:hit.to},effects:CV.EditorView.scrollIntoView(hit.from,{y:"center"})});return true;}
 }
 toast("原文已经改过，找不到这一段了");
 return false;
}
async function markAction(kind,a){
 const id=a.dataset.id;
 switch(kind){
 case "mark-side":return openAsked(id);
 case "mark-thread":{
  const q=await rpc("annotation_asked",{id}),pid=openPanel({type:"chat",agent:q.agent,thread:q.thread});
  const go=(n=0)=>{
   const box=Dock.els[pid]?.querySelector('.msg[data-mid="'+q.message+'"]');
   if(!box)return n<40&&setTimeout(()=>go(n+1),100);
   if(Chat[pid])Chat[pid].bottom=false;box.scrollIntoView({block:"start"});Dock.els[pid].querySelector(".composer textarea")?.focus();
  };
  return go();
 }
 case "mark-deeper":{
  // The question comes along with what the quick answer said, for the main conversation to take further.
  const q=await rpc("annotation_asked",{id});
  return askAbout("tutor",q.quote+"\n\n我在快答里问过：\n"+[q,...(q.also||[])].map(x=>"问："+x.question+"\n答："+x.answer).join("\n\n"),{source:q.source,...q.anchor});
 }
 case "mark-add":return markCreate(false);
 case "mark-note":return markCreate(true);
 case "mark-go":return openAnnotation(id);
 case "mark-more":return markOpen(id,a);
 case "mark-color":Marks.color=a.dataset.color;return rpc("annotation_update",{id,color:a.dataset.color});
 case "mark-edit":{const m=await rpc("annotation_get",{id}),note=await noteDialog(m.note?"改批注":"写批注",m.note);if(note!=null)await rpc("annotation_update",{id,note});return;}
 case "mark-delete":{const m=await rpc("annotation_get",{id});if(m.ask)return rpc("annotation_unmount",{id});if(m.note&&!await ask(shorten(m.note,120),{title:"删除这条批注？",danger:true,ok:"删除"}))return;return rpc("annotation_delete",{id});}
 case "mark-ask":{const m=await rpc("annotation_get",{id});return askAbout(a.dataset.agent,m.text,{source:m.source,...m.anchor});}
 case "mark-card":{
  const m=await rpc("annotation_get",{id}),title=await askText("知识卡的标题",shorten(m.text.replace(/\s+/g," "),30),{ok:"做成卡片",hint:"出处会记在卡上，复习时能回到这里"});if(!title)return;
  const r=await rpc("annotation_card",{id,title});await refreshState();return openFile(r.path);
 }
 case "mark-link":{
  const m=await rpc("annotation_get",{id}),target=["thread","web"].includes(m.place.kind)?"":m.place.kind==="file"?m.place.path:m.place.title;
  await writeClipboard("[["+target+"#ann:"+id+"|"+(m.label||shorten(m.text,20)).replace(/[|\]]/g," ")+"]]");return toast("已复制，贴进笔记就是一条指回这里的链接");
 }
 case "marks-scope":{const p=Dock.panels[a.dataset.pid];if(p){p.scope=a.dataset.scope;saveLayout();renderMarks(a.dataset.pid);}return;}
 }
 return null;
}

/* ---- the 批注 window ------------------------------------------------------------------------------------------------ */
panelType("marks",{side:"mine",icon:"marker",title:()=>"批注",
 mount(p,node,pid){
  node.innerHTML='<div class="marks"><div class="marks-bar"></div><div class="marks-list" data-keep-scroll></div></div>';
  renderMarks(pid);
 },
 screen(p){return {view:"批注",scope:p.scope||"here",showing:Marks.hereTitle};}});
// Beside what is being read, as a row in it takes the reader back there.
function openMarks(from=Dock.focus){
 const mine=from&&Dock.panels[from]&&sideOf(from)==="mine",where=mine&&markWhere(from);
 if(where){Marks.here=where;Marks.hereTitle=panelTitle(from);}
 const had=findPanel({type:"marks"}),stack=mine&&stackOf(from);
 if(had){activate(had);renderMarks(had);return had;}
 if(WINDOW||!stack||Dock.layout.floats.some(f=>f.stack===stack))return openPanel({type:"marks"});
 const beside=stackNode([]);splitBeside(stack,"right",beside);
 return openPanel({type:"marks"},{stack:beside.id});
}
// The window follows what the learner is reading.
function marksFollow(){
 const pid=Dock.focus;if(!pid||Dock.panels[pid]?.type==="marks"||sideOf(pid)!=="mine")return;
 const where=markWhere(pid);if(!where||where===Marks.here)return;
 Marks.here=where;Marks.hereTitle=panelTitle(pid);
 Object.keys(Dock.panels).filter(x=>Dock.panels[x].type==="marks"&&Dock.panels[x].scope!=="all").forEach(renderMarks);
}
function markRow(m,place){
 const said=m.ask?m.ask.question:m.note;
 return '<div class="mark-row'+(m.lost?" lost":"")+'" data-action="'+(m.ask?"mark-more":"mark-go")+'" data-id="'+esc(m.id)+'"><i class="mark-bar lmark-c-'+markStyle(m)+'"></i><div class="mark-main">'+
  '<blockquote>'+esc(shorten(m.text,200))+'</blockquote>'+(said?'<div class="mark-note">'+esc(said)+'</div>':"")+
  '<small>'+esc((place?m.place.title+" · ":"")+(m.label?m.label+" · ":"")+markWho(m))+(m.lost==="changed"?' · <b>原文已改</b>':m.lost==="gone"?' · <b>来源已删除</b>':"")+'</small></div>'+
  iconButton("dots","mark-more","这条批注",'data-id="'+esc(m.id)+'"')+'</div>';
}
async function renderMarks(pid){
 const p=Dock.panels[pid],node=Dock.els[pid];if(!p||!node)return;
 const every=p.scope==="all"||p.scope==="asked"||!Marks.here,bar=node.querySelector(".marks-bar");
 if(!bar.firstChild){
  bar.innerHTML='<div class="marks-scope"></div><input placeholder="搜原文和批注" autocomplete="off"/>';
  bar.lastChild.value=p.query||"";bar.lastChild.addEventListener("input",e=>{p.query=e.target.value;clearTimeout(p.queryTimer);p.queryTimer=setTimeout(()=>renderMarks(pid),200);});
 }
 bar.firstChild.innerHTML=[["here",Marks.hereTitle?shorten(Marks.hereTitle,24):"这里"],["all","全部"],["asked","问过的"]].map(([k,t])=>'<button class="'+(k===(every?(p.scope==="asked"?"asked":"all"):"here")?"on":"")+'" data-action="marks-scope" data-pid="'+pid+'" data-scope="'+k+'">'+esc(t)+'</button>').join("");
 const query=(p.query||"").trim(),[found,mentions]=await Promise.all([rpc("annotations",{source:every?null:Marks.here,query:query||null}),
  every||/^(thread|web):/.test(Marks.here)?[]:rpc("file_mentions",{path:Marks.here}).catch(()=>[])]);
 if(!Dock.els[pid])return;
 const list=node.querySelector(".marks-list"),items=p.scope==="asked"?found.filter(m=>m.ask):found;
 list.innerHTML=(items.map(m=>markRow(m,every)).join("")||emptyState("marker",query?"没有找到":"这里还没有批注","选中一段文字，点「高亮」或「批注」。"))+
  (mentions.length?'<div class="marks-mentions"><h5>提到它的笔记</h5>'+mentions.map(d=>'<a data-action="open-file" data-path="'+esc(d.path)+'">'+svg("document",12)+' '+esc(d.title)+'</a>').join("")+'</div>':"");
}
