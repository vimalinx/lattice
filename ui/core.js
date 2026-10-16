"use strict";
/* Lattice UI Core - no remote web services; all data passes through QWebChannel. */
const S = {
  bridge:null, data:null, view:"learning", theme:localStorage.getItem("lattice-theme")||"dark",
  noteId:null, note:null, noteMode:"split", noteFilter:"", noteFolder:"All", sidebarCollapsed:localStorage.getItem("lattice-sidebar-collapsed")==="true",
  noteDirty:false,noteTimer:null,
  projectId:null,treePath:"",filePath:null,fileContent:"",fileDirty:false,
  graphFilter:"all",
  toastTimer:null, commandOpen:false, permission:null, permissionQueue:[], modalSnap:null
};
const el=(s)=>document.querySelector(s);
const all=(s)=>Array.from(document.querySelectorAll(s));
function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function fmtDate(iso,full=false){
  if(!iso)return "—";
  const date=new Date(iso);
  if(Number.isNaN(date.getTime()))return String(iso);
  return full ? date.toLocaleString("zh-CN",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) :
    date.toLocaleDateString("zh-CN",{month:"short",day:"numeric"});
}
function shorten(text,len=70){text=String(text||"").replace(/\s+/g," ");return text.length>len?text.slice(0,len)+"…":text;}
function svg(name,size=18){
 const paths={
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7H10v7H4a1 1 0 0 1-1-1z"/>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
  network:'<circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="19" r="2"/><circle cx="4" cy="19" r="2"/><path d="m9.8 9.8-3-2.5m7.5 2.5 3-3m-2.8 8 3 3m-7.5-3.5-4 3"/>',
  flask:'<path d="M9 3h6m-1 0v7l5.6 8.4A2 2 0 0 1 17.9 21H6.1a2 2 0 0 1-1.7-3L10 10V3"/><path d="M7 15h10"/>',
  bot:'<rect x="4" y="7" width="16" height="14" rx="3"/><path d="M12 7V3m-3 1h6M8 13h.01M16 13h.01M9 17h6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M19 12h3m-20 0h3m7-7V2m0 20v-3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  search:'<circle cx="10.6" cy="10.6" r="6.5"/><path d="m15.6 15.6 5 5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  chevron:'<path d="m9 18 6-6-6-6"/>',
  chevrondown:'<path d="m6 9 6 6 6-6"/>',
  arrow:'<path d="M5 12h14m-7-7 7 7-7 7"/>',
  document:'<path d="M6 2h8l5 5v14a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M14 2v6h6M8 12h8M8 16h7"/>',
  code:'<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-15-6 24"/>',
  play:'<path d="m8 5 12 7-12 7V5Z"/>',
  stop:'<rect x="5" y="5" width="14" height="14" rx="2"/>',
  git:'<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 8v5l6 4M18 8v5l-6 4"/>',
  spark:'<path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2Z"/>',
  edit:'<path d="m14 4 6 6M3 21l4.8-1 13-13a3 3 0 0 0-4.2-4.2l-13 13L3 21Z"/>',
  file:'<path d="M6 2h8l5 5v14H5a1 1 0 0 1-1-1V4a2 2 0 0 1 2-2Z"/><path d="M14 2v6h5"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>',
  dots:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  link:'<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  arrowup:'<path d="m12 19 0-14m-6 6 6-6 6 6"/>',
  inbox:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 14h5l2 3h4l2-3h5"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18"/>',
  eye:'<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  split:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  external:'<path d="M12 5H5v14h14v-7M14 4h6v6m0-6-9 9"/>',
  panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  save:'<path d="M4 3h14l3 3v15H3V3h1Z"/><path d="M7 3v7h10V3M7 21v-8h10v8"/>',
  close:'<path d="M5 5l14 14M19 5 5 19"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6M10 10v7m4-7v7"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  upload:'<path d="M12 20V8m-5 5 5-5 5 5M4 7V3h16v4"/>',
  refresh:'<path d="M20 7V3l-4 4a8 8 0 0 0-13 4M4 17v4l4-4a8 8 0 0 0 13-4"/>',
  bulb:'<path d="M9 18h6m-5 3h4M8 15a6 6 0 1 1 8 0l-1 3H9l-1-3Z"/>',
  quote:'<path d="M9 11H3v8h7V9H4m16 2h-6v8h7V9h-6"/>',
  terminal:'<rect x="2" y="3" width="20" height="18" rx="2"/><path d="m6 8 4 4-4 4m6 1h6"/>',
  layout:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M10 10v11"/>',
  info:'<circle cx="12" cy="12" r="10"/><path d="M12 10v6m0-10h.01"/>',
  slash:'<path d="M19 4 5 20"/>',
  pin:'<path d="m16 3 5 5-4 2-3 6-3 2-4-4-4 2 2-4 3-3 6-3z"/>',
  history:'<path d="M3 12a9 9 0 1 0 2-6.5L3 8V3m0 5h5M12 7v5l3 2"/>',
  sidebar:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  cmd:'<path d="M9 7V5a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v14a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V5"/>',
  tag:'<path d="m3 3 8 0 10 10-8 8L3 11z"/><circle cx="8" cy="8" r="1"/>',
  filter:'<path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z"/>',
  shield:'<path d="M12 2 4 5v6c0 5 3.5 8.3 8 11 4.5-2.7 8-6 8-11V5Z"/><path d="m9 12 2 2 4-4"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V4H5v12h3"/>',
  more:'<path d="M12 5v.01M12 12v.01M12 19v.01"/>'
 };
 return '<svg viewBox="0 0 24 24" width="'+esc(size)+'" height="'+esc(size)+'" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.spark)+'</svg>';
}
function logo(){
 return '<svg viewBox="0 0 128 128" fill="none" aria-hidden="true"><path d="M26 90 55 31 91 85M55 31l43 25M26 90l72-34" stroke="#83e2c7" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="55" cy="31" r="9" fill="#eef9f4"/><circle cx="26" cy="90" r="9" fill="#eef9f4"/><circle cx="91" cy="85" r="9" fill="#eef9f4"/><circle cx="98" cy="56" r="8" fill="#eef9f4"/></svg>';
}
/* ```mermaid fenced blocks render as diagrams instead of code. */
marked.use({renderer:{code(t){if((t.lang||"").trim().toLowerCase()==="mermaid")return '<div class="mermaid">'+esc(t.text)+'</div>';return false;}}});
let _mmTimer=null,_mmSeq=0,_mmInited=false;
function scheduleMermaid(){clearTimeout(_mmTimer);_mmTimer=setTimeout(runMermaid,40);}
async function runMermaid(){
 if(typeof mermaid==="undefined")return;
 if(!_mmInited){_mmInited=true;
  try{mermaid.initialize({startOnLoad:false,theme:"dark",securityLevel:"strict",fontFamily:"inherit"});}
  catch(_){return;}
 }
 for(const n of all(".mermaid:not([data-processed='true'])")){
  n.dataset.processed="true";
  const src=n.textContent;
  try{const out=await mermaid.render("mm"+(++_mmSeq),src);n.innerHTML=out.svg;}
  catch(_){n.innerHTML='<pre class="mermaid-error">'+esc(src)+'</pre><small class="mermaid-errnote">图表语法未能解析</small>';}
 }
}
/* Live widgets (cytoscape + resize observers) are rebuilt every render; the old
   DOM is dropped wholesale, so instances must be torn down explicitly or they
   leak listeners and keep observing detached nodes. */
const LIVE={cys:new Set(),ros:new Set()};
/* Stop a cy now, destroy it after the next frame: force-layout frames already
   queued before stop() flush a style batch on the next tick, and destroying the
   instance first nulls the renderer underneath them (cy.notify on null). */
function retireCy(c){
 try{c.__layout&&c.__layout.stop();}catch(_){ }
 requestAnimationFrame(()=>{try{if(!c.destroyed())c.destroy();}catch(_){ }});
}
function teardownLive(){
 LIVE.ros.forEach(r=>{try{r.disconnect();}catch(_){}});LIVE.ros.clear();
 LIVE.cys.forEach(retireCy);LIVE.cys.clear();
}
/* Shared Cytoscape mount: each container gets one instance, rebuilt per render. */
function mountCytoscape(container,{elements,style,layout,onTapNode,onTapEdge}){
 if(!container||typeof cytoscape==="undefined")return null;
 if(container.__cy){LIVE.cys.delete(container.__cy);retireCy(container.__cy);container.__cy=null;}
 if(container.__ro){LIVE.ros.delete(container.__ro);container.__ro.disconnect();container.__ro=null;}
 const cy=cytoscape({container,elements,style,wheelSensitivity:.25,minZoom:.25,maxZoom:3});
 // Keep a handle on the running layout: finishing callbacks fire after
 // destroy() otherwise and hit null internals (cy.notify).
 const lay=cy.layout(layout);cy.__layout=lay;lay.run();
 if(onTapNode)cy.on("tap","node",e=>onTapNode(e.target));
 if(onTapEdge)cy.on("tap","edge",e=>onTapEdge(e.target));
 cy.on("mouseover","node",e=>{cy.elements().addClass("faded");e.target.closedNeighborhood().removeClass("faded");});
 cy.on("mouseout","node",()=>cy.elements().removeClass("faded"));
 container.__cy=cy;LIVE.cys.add(cy);
 container.__ro=new ResizeObserver(()=>{if(container.__cy!==cy||cy.destroyed())return;cy.resize();cy.fit(undefined,26);});
 container.__ro.observe(container);LIVE.ros.add(container.__ro);
 return cy;
}
/* Post-render mounts for views that embed live widgets. */
function runAfterRender(){
 if(typeof mountKnowledgeGraph==="function")mountKnowledgeGraph();
 scheduleMermaid();
}
function markdown(text){
 const src=String(text||""),codes=[];
 const masked=src.replace(/(`+)([\s\S]*?)\1/g,m=>{codes.push(m);return "\u0000"+(codes.length-1)+"\u0000";});
 const linked=masked.replace(/\[\[([^\]]+)\]\]/g,(_,name)=>
   '<a class="wikilink" data-wiki="'+esc(name)+'">'+esc(name)+'</a>')
   .replace(/\u0000(\d+)\u0000/g,(_,i)=>codes[+i]);
 try{
  const out=DOMPurify.sanitize(marked.parse(linked,{breaks:true,gfm:true}),{ADD_ATTR:["data-wiki"]});
  if(out.includes('class="mermaid"'))scheduleMermaid();
  return out;
 }
 catch(_){return '<pre>'+esc(text)+'</pre>';}
}
async function rpc(method,args={},timeout=240000){
 if(!S.bridge)throw new Error("本地桌面桥尚未连接");
 return await new Promise((resolve,reject)=>{
  let done=false;
  const timer=timeout>0?setTimeout(()=>{if(!done){done=true;reject(new Error("本地调用超时："+method));}},timeout):null;
  S.bridge.request(JSON.stringify(Object.assign({method},args)),raw=>{
    if(done)return;done=true;if(timer)clearTimeout(timer);
    try{let r=JSON.parse(raw);if(r.ok)resolve(r.data);else reject(new Error(r.error||"未知错误"));}
    catch(err){reject(err);}
  });
 });
}
function toast(text,type="info"){
 const box=el("#toast");if(!box)return;
 box.textContent=text;box.classList.add("visible");
 box.style.borderColor=type==="error"?"var(--red)":"var(--line)";
 clearTimeout(S.toastTimer);S.toastTimer=setTimeout(()=>box.classList.remove("visible"),3700);
}
async function safe(fn){
 try{return await fn();}catch(e){console.error(e);toast(e.message||String(e),"error");return null;}
}
const NAV_ITEMS=[
 ["learning","学习对话","bot"],["classroom","课程","book"],
 ["notebook","实验笔记","flask"],["notes","知识笔记","document"],
 ["knowledge","知识卡","tag"],["graph","知识网络","git"],["flash","即时答疑","spark"]
];
function nav(name,label,icon){
 const active=S.view===name;
 return '<button class="nav-link'+(active?' active':'')+'" data-action="nav" data-view="'+esc(name)+'" title="'+esc(label)+'" aria-label="'+esc(label)+'"'+(active?' aria-current="page"':'')+'>'+svg(icon,18)+'<span>'+esc(label)+'</span></button>';
}
const PAGES={settings:"设置与数据",...Object.fromEntries(NAV_ITEMS.map(([id,label])=>[id,label]))};
function sidebar(){
 return '<aside class="sidebar" aria-label="主导航"><div class="brand"><div class="brand-icon">'+logo()+'</div><div class="brand-text"><div class="brand-name">lattice<span style="color:var(--accent)">.</span></div></div></div>'+
 '<button class="sidebar-toggle" data-action="sidebar-toggle" title="'+(S.sidebarCollapsed?'展开导航':'折叠导航')+'" aria-label="'+(S.sidebarCollapsed?'展开导航':'折叠导航')+'" aria-expanded="'+!S.sidebarCollapsed+'">'+svg('sidebar',18)+'<span>折叠导航</span></button>'+
 '<nav class="nav-list">'+NAV_ITEMS.map(x=>nav(...x)).join('')+'</nav><div class="side-spacer"></div><div class="side-foot">'+
 '<button data-action="search" title="全局搜索 · Ctrl K" aria-label="全局搜索">'+svg('search')+'<span>全局搜索</span></button>'+nav('settings','设置与数据','settings')+'</div></aside>';
}
function header(){
 const title=PAGES[S.view]||"工作台";
 return '<header class="topbar"><div class="breadcrumb"><span class="rootcrumb">工作空间</span>'+
 '<span class="chevron">'+svg("chevron",12)+'</span><strong>'+esc(title)+'</strong></div>'+
 '<div class="toolbar">'+
 '<button class="top-search" data-action="search">'+svg("search",15)+'<span>搜索笔记、知识卡、课程</span><span class="kbd">Ctrl K</span></button>'+
 '<button class="icon-btn" title="切换明暗主题" data-action="theme">'+svg(S.theme==="dark"?"sun":"moon")+'</button>'+
 
 '</div></header>';
}
function refreshSidebar(){
 const root=el('#root');if(!root)return;
 root.classList.toggle('nav-collapsed',S.sidebarCollapsed);
 root.querySelectorAll('.sidebar [data-view]').forEach(button=>{
  const active=button.dataset.view===S.view;
  button.classList.toggle('active',active);
  if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
 });
 const toggle=root.querySelector('.sidebar-toggle');
 if(toggle){
  const label=S.sidebarCollapsed?'展开导航':'折叠导航';
  toggle.title=label;toggle.setAttribute('aria-label',label);
  toggle.setAttribute('aria-expanded',String(!S.sidebarCollapsed));
 }
}

function modal(content,size="",guard=true){
 el("#overlays").innerHTML='<div class="modal-backdrop" data-dismiss="true"><div class="modal '+size+'" role="dialog" aria-modal="true">'+content+'</div></div>';
 S.modalSnap=guard?all(".modal input,.modal textarea,.modal select").map(i=>({el:i,v:i.type==="checkbox"||i.type==="radio"?i.checked:i.value})):null;
}
function modalDirty(){
 if(!S.modalSnap)return false;
 return S.modalSnap.some(s=>{const v=s.el.type==="checkbox"||s.el.type==="radio"?s.el.checked:s.el.value;return v!==s.v;});
}
function requestCloseModal(){
 if(modalDirty()&&!confirm("窗口里有未保存的修改，确定关闭？"))return;
 closeModal();
}
function closeModal(){
 el("#overlays").innerHTML="";S.commandOpen=false;S.permission=null;S.modalSnap=null;
 const next=S.permissionQueue.shift()||(typeof L!=="undefined"?L.permissions.shift():undefined);
 if(next)permissionModal(next);
}
/* Preserve scroll positions across innerHTML re-renders. Tag scrollable regions with
   data-scroll="key" data-scroll-ns="<view/tab it belongs to>". Positions only restore
   when the namespace still matches — view/tab switches start at the top. */
function scrollSnapshot(){
 const m={};
 all("[data-scroll]").forEach(n=>{m[n.dataset.scroll]={ns:n.dataset.scrollNs||"",top:n.scrollTop,
   atBottom:n.scrollHeight-n.scrollTop-n.clientHeight<130};});
 return m;
}
function scrollRestore(m,forceKey){
 all("[data-scroll]").forEach(n=>{
  const s=m[n.dataset.scroll];
  if(!s||s.ns!==(n.dataset.scrollNs||""))return;
  if(s.atBottom||n.dataset.scroll===forceKey)n.scrollTop=n.scrollHeight;
  else n.scrollTop=s.top;
 });
}
function modalHead(title){
 return '<div class="modal-top"><h2>'+esc(title)+'</h2><button class="icon-btn" data-action="modal-close" title="关闭">'+svg("close")+'</button></div>';
}
function button(label,action,extra="",variant=""){
 return '<button class="btn '+variant+'" data-action="'+esc(action)+'" '+extra+'>'+label+'</button>';
}
function emptyState(icon,title,desc,actionLabel,action){
 return '<div class="empty-state"><div class="symbol">'+svg(icon,33)+'</div><h2>'+esc(title)+'</h2>'+
 '<p>'+esc(desc)+'</p>'+(actionLabel?button(actionLabel,action,'','primary'):"")+'</div>';
}
