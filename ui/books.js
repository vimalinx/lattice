"use strict";
/* The book window: PDF, EPUB, MOBI, AZW3, FB2 and CBZ, drawn on a site of their own (ui/book/), as a book holds someone
   else's HTML and Lattice's page holds the agents' tools. This side only opens the book there and hears what it reports:
   where the learner is, what they selected, a link they followed. What an agent reads of a book comes from the vault. */
const Books={};   // pid -> {title, label, progress, showing, error}
const BOOK_NAME=/\.(pdf|epub|mobi|azw3?|prc|fb2|fb2\.zip|cbz)$/i;
function isBook(path){return BOOK_NAME.test(String(path||""));}
panelType("book",{side:"mine",icon:"book",
 title:p=>Books[p.pid]?.title||p.title||baseName(p.path),
 mount(p,node,pid){
  p.pid=pid;Books[pid]={};
  node.innerHTML='<iframe class="app-frame book-frame" sandbox="allow-scripts allow-same-origin" title="书"></iframe>';
  node.firstChild.src=appUrl("lattice-app://book/_lattice/book/index.html");
 },
 unmount(p,node){const st=Books[node.dataset.pid];clearTimeout(st?.placeTimer);if(st?.selected)clearSelection();delete Books[node.dataset.pid];},
 // What an agent sees of the book on screen.
 screen(p,node){
  const st=Books[node.dataset.pid];if(!st)return {view:"书",path:p.path};
  return {view:"书",path:p.path,title:st.title,where:st.label,section:st.section,progress:st.progress==null?undefined:Math.round(st.progress*100)+"%",showing:st.showing};
 }});
function frameRect(frame,r={}){
 const box=frame.getBoundingClientRect(),k=box.width/(frame.offsetWidth||box.width||1);
 return {left:box.left+(r.left||0)*k,top:box.top+(r.top||0)*k,bottom:box.top+(r.bottom||0)*k,width:(r.width||0)*k};
}
function bookPost(pid,message){Dock.els[pid]?.querySelector("iframe.book-frame")?.contentWindow?.postMessage(message,"*");}
function bookMarks(pid,items){bookPost(pid,{book:"marks",marks:items.map(m=>({id:m.id,color:markStyle(m),at:m.anchor.at||{},text:m.anchor.text}))});}
function bookGoto(pid,at){
 const st=Books[pid];if(!st)return;
 if(!st.ready||st.win!==Dock.els[pid]?.querySelector("iframe.book-frame")?.contentWindow){st.pendingAt=at;return;}
 bookPost(pid,{book:"goto",at:at.anchor?.at||(at.page?{page:at.page}:{}),text:at.anchor?.text||at.highlight||""});
}
function bookOf(source){return Object.keys(Books).find(pid=>Dock.els[pid]?.querySelector("iframe.book-frame")?.contentWindow===source);}
addEventListener("message",e=>{
 const d=e.data;if(!d||typeof d!=="object"||typeof d.book!=="string")return;
 const pid=bookOf(e.source),st=Books[pid],p=Dock.panels[pid];if(!st||!p)return;
 const frame=Dock.els[pid].querySelector("iframe.book-frame");
 // A tab left behind loses its page and starts here again: at the very place it was, not the last one saved.
 if(d.book==="ready")return safe(async()=>{st.ready=false;st.win=e.source;const r=await rpc("book_open",{path:p.path});if(Books[pid])frame.contentWindow.postMessage({book:"open",url:r.url,name:r.name,at:st.at||r.at||null},"*");});
 if(d.book==="info"){
  st.title=String(d.title||"").slice(0,200)||null;p.title=st.title||p.title;refreshTab(pid);st.ready=true;marksRefresh(pid);
  if(st.pendingAt){const at=st.pendingAt;st.pendingAt=null;bookGoto(pid,at);}
  return;
 }
 if(d.book==="at"){
  Object.assign(st,{label:String(d.label||"").slice(0,120),section:String(d.section||"").slice(0,120),progress:Number(d.progress)||0,showing:String(d.showing||"").slice(0,400)});
  st.at=String(d.at||"")||st.at;clearTimeout(st.placeTimer);st.placeTimer=setTimeout(()=>safe(()=>rpc("book_place",{path:p.path,at:String(d.at||"")})),800);return;
 }
 if(d.book==="focus"){closeMenus();hidePop();if(Dock.focus!==pid){Dock.focus=pid;remember(pid);}return;}
 if(d.book==="selection"){
  const text=String(d.text||"").slice(0,5000);
  st.selected=!!text.trim();
  if(!text.trim()){if(Sel.text)clearSelection();else hidePop();return;}
  Sel.text=text;Sel.el=null;Sel.anchor=d.anchor&&typeof d.anchor==="object"?{...d.anchor,source:p.path,text}:null;reportScreen();
  return showSelPop(frameRect(frame,d.rect));
 }
 // One of the book's annotations was clicked, or the book found where one stands.
 if(d.book==="mark"){const r=frameRect(frame,d.rect);return safe(()=>markOpen(String(d.id),{x:r.left,y:r.bottom}));}
 if(d.book==="located")return safe(()=>rpc("annotation_update",{id:String(d.id),at:d.at}));
 if(d.book==="marks-open")return openMarks(pid);
 // A link in a book: to the web only, in the reader.
 if(d.book==="link"&&/^https?:\/\//i.test(String(d.href||"")))return openWeb(String(d.href),pid);
 if(d.book==="error"){
  st.error=String(d.message||"打不开这本书").slice(0,300);
  Dock.els[pid].innerHTML=emptyState("book","打不开这本书",st.error)+'<div class="center">'+button(svg("external",13)+" 用系统程序打开","book-external",'data-pid="'+pid+'"',"")+'</div>';
 }
});
// The learner switches the look: the book follows.
new MutationObserver(()=>{
 const css=getComputedStyle(document.documentElement),look={};
 for(const k of ["bg","panel","text","muted","subtle","line","surface","accent"])look[k]=css.getPropertyValue("--"+k).trim();
 all("iframe.book-frame").forEach(f=>f.contentWindow?.postMessage({book:"look",look,theme:document.documentElement.dataset.theme==="light"?"light":"dark"},"*"));
}).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
