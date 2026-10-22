"use strict";
/* The reader: a web page or PDF an agent cites (or any link the learner follows) opens here, as readable text in the
   program's own look, instead of in a browser. The page itself is never loaded into the program: Lattice reads it and
   shows its text, links and tables, so nothing from the page can run here. The original is one click away. */
const Reader={};   // pid -> {page, error, loading}
panelType("web",{side:"mine",icon:"external",
 title:p=>Reader[p.pid]?.page?.title||p.title||hostOf(p.url),
 mount(p,node,pid){
  p.pid=pid;Reader[pid]={};
  node.innerHTML='<div class="reader"><div class="reader-bar"></div><div class="reader-body" data-keep-scroll></div></div>';
  readerLoad(pid);
 },
 unmount(p,node){delete Reader[node.dataset.pid];},
 // What an agent sees of the page on screen: which page, the section and the text at the top of the view.
 screen(p,node){
  const page=Reader[node.dataset.pid]?.page,body=node.querySelector(".reader-body");
  if(!page||!body)return {view:"网页",url:p.url,loading:true};
  const top=body.getBoundingClientRect().top,blocks=all(".markdown>*",body);
  const at=blocks.find(b=>b.getBoundingClientRect().bottom>top+8);
  const heading=at&&[...blocks.slice(0,blocks.indexOf(at)+1)].reverse().find(b=>/^H[1-6]$/.test(b.tagName));
  return {view:"网页",url:page.url,title:page.title,kind:page.kind,section:heading?.textContent.trim().slice(0,120),
   showing:at?shorten(at.textContent,300):"",progress:Math.round(100*body.scrollTop/Math.max(1,body.scrollHeight-body.clientHeight))+"%"};
 }});
function hostOf(url){try{return new URL(url).hostname.replace(/^www\./,"");}catch(_){return String(url||"网页");}}
async function readerLoad(pid,refresh=false){
 const p=Dock.panels[pid],st=Reader[pid];if(!p||!st)return;
 st.loading=true;st.error="";if(refresh||!st.page)readerRender(pid);
 const r=await safe(()=>rpc("web_open",{url:p.url,refresh}));
 if(!Reader[pid])return;
 if(r?.state==="ready"){st.page=r.page;st.loading=false;readerRender(pid);}
 else if(!r){st.loading=false;st.error="打不开这个网页";readerRender(pid);}
}
function readerEvent(evt){
 for(const pid of Object.keys(Reader)){
  const p=Dock.panels[pid],st=Reader[pid];if(!p||p.url!==evt.url||!st.loading)continue;
  st.loading=false;if(evt.page)st.page=evt.page;else st.error=evt.error||"打不开这个网页";
  readerRender(pid);refreshTab(pid);
 }
}
function readerRender(pid){
 const p=Dock.panels[pid],st=Reader[pid],node=Dock.els[pid];if(!p||!st||!node)return;
 const page=st.page,url=page?.url||p.url;
 node.querySelector(".reader-bar").innerHTML=
  ((p.back||[]).length?iconButton("arrowup","web-back","返回上一页",'data-pid="'+pid+'" style="transform:rotate(-90deg)"'):"")+
  '<span class="reader-where" data-tip="'+esc(url)+'">'+svg(page?.kind==="pdf"?"document":"external",13)+'<b>'+esc(hostOf(url))+'</b><small>'+esc(url.replace(/^https?:\/\/(www\.)?/,""))+'</small></span>'+
  (page?.fetched?'<small class="reader-when" data-tip="Lattice 读到这一页的时间；点「重新读取」看最新的">'+esc(fmtDate(page.fetched,true))+'</small>':"")+
  iconButton("refresh","web-refresh","重新读取",'data-pid="'+pid+'"')+iconButton("save","web-save","存进学习库（notes/网页/）",'data-pid="'+pid+'"')+
  iconButton("link","web-copy","复制链接",'data-pid="'+pid+'"')+button(svg("external",12)+" 在浏览器打开","open-url",'data-url="'+esc(url)+'"',"ghost xs");
 const body=node.querySelector(".reader-body");
 if(st.loading&&!page){body.innerHTML='<div class="loading">正在读这个网页…</div>';return;}
 if(st.error&&!page){body.innerHTML=emptyState("external","没能读出这个网页",st.error+"。可以点上面的「在浏览器打开」。");return;}
 body.innerHTML='<article class="markdown reader-page">'+(page.title&&!/^#\s/.test(page.markdown)?'<h1>'+esc(page.title)+'</h1>':"")+markdown(page.markdown)+'</article>'+
  (st.loading?'<div class="reader-note">正在重新读取…</div>':"")+(page.truncated?'<div class="reader-note">这一页太长，后面的没有显示；完整的请在浏览器里看。</div>':"");
 // Images on the page are not loaded into the program; each one is a link that opens the reader on it.
 all("img",body).forEach(img=>img.replaceWith(h('<a href="'+esc(img.getAttribute("src")||"")+'">'+esc("[图片："+(img.alt||"")+"]")+'</a>')));
}
/* A web link: the reader, unless the learner asks for the browser (Ctrl or the middle button). Next to a reader it
   reuses that window and keeps a way back; elsewhere it opens one beside what is on screen. */
function openWeb(url,from=null,browser=false){
 if(browser)return safe(()=>rpc("open_url",{url}));
 const here=from&&Dock.panels[from]?.type==="web"?from:null;
 if(here){const p=Dock.panels[here];if(p.url===url)return;p.back=[...(p.back||[]),p.url].slice(-30);p.url=url;Reader[here].page=null;saveLayout();refreshTab(here);return readerLoad(here);}
 return openPanel({type:"web",url});
}
function readerAction(kind,a,pid){
 const p=Dock.panels[pid];if(!p)return;
 if(kind==="web-back"){const back=(p.back||[]).pop();if(!back)return;p.url=back;Reader[pid].page=null;saveLayout();refreshTab(pid);return readerLoad(pid);}
 if(kind==="web-refresh")return readerLoad(pid,true);
 if(kind==="web-copy")return writeClipboard(Reader[pid]?.page?.url||p.url).then(()=>toast("已复制链接"));
 if(kind==="web-save")return safe(async()=>{const r=await rpc("web_save",{url:p.url});await refreshState();toast("存进了 "+r.path);openFile(r.path);});
}
// The middle button opens a web link in the browser, as it would anywhere else.
document.addEventListener("auxclick",e=>{
 if(e.button!==1)return;const a=e.target.closest?.(".markdown a[href^='http'],a[data-action='open-web']");
 if(a){e.preventDefault();safe(()=>rpc("open_url",{url:a.dataset.url||a.href}));}
});
