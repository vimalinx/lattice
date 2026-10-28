"use strict";
/* Apps: small web programs the app builder writes into apps/ for the learner to work with (hands-on practice,
   visualizations, simulations). Each is a site of its own (lattice-app://, see lattice/appscheme.py) in a sandboxed
   frame: it may use the internet and its own storage, not this computer, the local network or Lattice itself; it can
   only hand some text to the main conversation's input. Without a file the panel lists the apps and the ones being
   made, and takes a request for a new one. */
const Apps={};        // pid -> {data, error, list}
const AppBuilds={};   // the builder's conversation -> {build, title, file, since, existed, steps, tool, rounds}
panelType("app",{side:"mine",icon:"apps",
 title:(p,node)=>p.path?(Apps[node?.dataset.pid]?.data?.title||appBuildOf(p.path)?.title||baseName(p.path).replace(/\.html?$/i,"")):"应用",
 mount(p,node,pid){Apps[pid]={};node.innerHTML='<div class="app-panel"><div class="app-bar"></div><div class="app-body"></div></div>';appLoad(pid);},
 unmount(p,node){delete Apps[node.dataset.pid];},
 screen(p,node){
  const st=Apps[node.dataset.pid];
  return p.path?{view:"应用",file:p.path,title:st?.data?.title,about:st?.data?.about,being_built:!!appBuildOf(p.path)}
   :{view:"应用列表",apps:(st?.list?.apps||[]).slice(0,20).map(a=>a.file+"「"+a.title+"」"),being_built:Object.values(AppBuilds).map(b=>b.file)};
 }});
function appBuildOf(path){return Object.values(AppBuilds).find(b=>b.file===path)||null;}
function appPanels(path=null){return Object.keys(Apps).filter(pid=>(Dock.panels[pid]?.path||null)===path);}
async function appLoad(pid){
 const p=Dock.panels[pid],st=Apps[pid];if(!p||!st)return;
 if(!p.path){
  const list=await safe(()=>rpc("apps"));if(!Apps[pid])return;
  if(list){st.list=list;for(const b of list.builds)if(!AppBuilds[b.build])AppBuilds[b.build]={...b,steps:[],tool:null,rounds:0};}
  return appRender(pid);
 }
 if(!appBuildOf(p.path)&&!Object.keys(AppBuilds).length){const list=await safe(()=>rpc("apps"));for(const b of list?.builds||[])AppBuilds[b.build]??={...b,steps:[],tool:null,rounds:0};}
 try{st.data=await rpc("app_read",{path:p.path});st.error="";}
 catch(e){st.data=null;st.error=e.message;}
 if(!Apps[pid])return;
 appRender(pid);refreshTab(pid);
}
function appRender(pid){
 const p=Dock.panels[pid],st=Apps[pid],node=Dock.els[pid];if(!p||!st||!node)return;
 const bar=node.querySelector(".app-bar"),body=node.querySelector(".app-body");
 if(!p.path){
  bar.innerHTML='<span class="app-where">'+svg("apps",14)+'<b>应用</b><small>应用助手在后台做，做好了自动在这里打开</small></span>'+iconButton("refresh","app-reload","刷新",'data-pid="'+pid+'"');
  body.innerHTML=appGalleryHtml(pid);return;
 }
 const b=appBuildOf(p.path),d=st.data;
 bar.innerHTML='<span class="app-where">'+svg("apps",14)+'<b>'+esc(d?.title||b?.title||baseName(p.path))+'</b><small>'+esc(d?.about||p.path)+'</small></span>'+
  (b?'<span class="chip ai">'+(d?"正在改":"正在做")+'</span>':d?button(svg("edit",12)+" 让 AI 改","app-change",'data-pid="'+pid+'"',"ghost xs"):"")+
  (d?iconButton("refresh","app-reload","重新加载",'data-pid="'+pid+'"')+iconButton("code","app-source","看源码",'data-path="'+esc(p.path)+'"'):"")+iconButton("apps","open-apps","所有应用");
 const strip=b?'<div class="app-building">'+appProgressHtml(b)+'</div>':"";
 if(!d){body.innerHTML=b?strip:emptyState("apps","打不开这个应用",st.error||"");return;}
 body.innerHTML=strip+'<iframe class="app-frame" sandbox="'+APP_SANDBOX+'" title="'+esc(d.title||"")+'"></iframe>';
 body.querySelector("iframe").src=appUrl(d.url,d.mtime);
}
// Scripts, forms and its own storage; no popups, no leaving its frame. Its own site keeps it apart from Lattice's page.
const APP_SANDBOX="allow-scripts allow-forms allow-same-origin allow-downloads allow-pointer-lock";
function appGalleryHtml(pid){
 const list=Apps[pid].list||{apps:[]},builds=Object.values(AppBuilds);
 return '<div class="app-gallery"><div class="app-ask"><textarea rows="3" data-app-ask="'+pid+'" placeholder="想要一个什么样的应用？比如：一个能弹的钢琴键盘，按下去显示音名和频率；或者把排序算法一步步画出来"></textarea>'+
   button(svg("spark",12)+" 让应用助手做","app-build",'data-pid="'+pid+'"',"primary sm")+'</div>'+
  (builds.length?'<div class="menu-label">正在做</div>'+builds.map(b=>'<div class="app-card building" data-action="app-open" data-path="'+esc(b.file)+'">'+appProgressHtml(b)+'</div>').join(""):"")+
  '<div class="menu-label">学习库里的应用</div>'+
  (list.apps.length?'<div class="app-grid">'+list.apps.map(a=>'<button class="app-card" data-action="app-open" data-path="'+esc(a.file)+'"><b>'+esc(a.title)+'</b>'+
    (a.about?'<span>'+esc(a.about)+'</span>':"")+'<small>'+esc(a.file)+' · '+esc(fmtDate(a.updated))+'</small></button>').join("")+'</div>'
   :'<p class="menu-empty">还没有应用。在上面说想要什么，或者在主会话里让它做一个。</p>')+'</div>';
}
/* What the builder is at: how long, the notes it wrote between steps, and the tool working now. */
function appProgressHtml(b){
 const tool=b.tool?(WAIT_LABEL[b.tool.name]||({check_app:"正在检查应用",write:"正在写",edit:"正在改",read:"正在读"})[b.tool.name]||"正在用工具 "+b.tool.name)+(b.tool.detail?" · "+shorten(b.tool.detail,60):""):b.rounds?"正在想下一步…":"正在想…";
 return '<div class="app-progress"><div class="app-progress-head"><span class="thinking-dot"></span><b>应用助手正在做「'+esc(b.title)+'」</b><em data-since="'+b.since+'">'+elapsed(Date.now()-b.since)+'</em>'+
  button(svg("stop",11)+" 停止","app-stop",'data-build="'+esc(b.build)+'"',"ghost xs")+'</div>'+
  stepsHtml(b.steps,{now:false})+'<div class="app-progress-now">'+esc(tool)+'</div></div>';
}
/* Where the app loads from, told the look Lattice is in now (its colors and fonts, a theme of the learner's own too). */
const APP_LOOK=["bg","panel","panel-hi","surface","surface-hover","line","line-soft","text","muted","subtle","accent","accent-ink","accent-glow","ai","ai-glow","amber","red","green","code-bg","code-text","shadow","mono","sans"];
function appUrl(url,version=""){
 const css=getComputedStyle(document.documentElement),look={};
 for(const k of APP_LOOK){const v=css.getPropertyValue("--"+k).trim();if(v)look[k]=v;}
 return url+"?theme="+(document.documentElement.dataset.theme==="light"?"light":"dark")+"&look="+encodeURIComponent(JSON.stringify(look))+(version?"&v="+version:"");
}
// The learner switches the look: open apps load again in it.
new MutationObserver(()=>all("iframe.app-frame").forEach(f=>{const pid=f.closest(".panel")?.dataset.pid,d=Apps[pid]?.data;if(d)f.src=appUrl(d.url,d.mtime);}))
 .observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
function appsRedraw(path){
 for(const pid of Object.keys(Apps)){
  const p=Dock.panels[pid];if(!p)continue;
  if(!p.path){const g=Dock.els[pid]?.querySelector(".app-gallery");if(g){const ask=g.querySelector("textarea")?.value;appRender(pid);if(ask)Dock.els[pid].querySelector(".app-gallery textarea").value=ask;}}
  else if(p.path===path){const strip=Dock.els[pid]?.querySelector(".app-building"),b=appBuildOf(path);if(strip&&b)strip.innerHTML=appProgressHtml(b);else appRender(pid);}
 }
}
/* The builder's own conversation: only its progress is shown, in the app's window. */
const appFrames={};
function appAgentEvent(evt){
 const b=AppBuilds[evt.thread];if(!b)return;
 if(evt.kind==="step")b.steps.push(evt.text);
 else if(evt.kind==="tool_wait")b.tool={name:evt.name,detail:evt.detail||""};
 else if(evt.kind==="tool"){b.tool=null;b.rounds++;}
 else if(evt.kind==="retrying")b.tool=evt.attempt?{name:"retry",detail:"第 "+evt.attempt+" 次，"+evt.wait+" 秒后"}:{name:"extend",detail:""};
 else if(evt.kind==="chunk"&&b.tool&&["retry","extend"].includes(b.tool.name))b.tool=null;
 else return;
 if(appFrames[b.file])return;
 appFrames[b.file]=setTimeout(()=>{delete appFrames[b.file];appsRedraw(b.file);},150);
}
function appBuildEvent(evt){
 if(evt.state==="started"){
  AppBuilds[evt.build]={...evt,steps:[],tool:null,rounds:0};appTicker();
  const pid=appPanels(evt.file)[0];if(pid)appRender(pid);else openPanel({type:"app",path:evt.file});
  return appsRedraw(null);
 }
 delete AppBuilds[evt.build];
 if(evt.state==="done"||evt.state==="partial"){
  toast(evt.state==="done"?"应用「"+evt.title+"」做好了":"「"+evt.title+"」做到一半断了（"+(evt.reason==="max_tokens"?"写到了长度上限":"服务出错")+"）：先打开已保存的版本，可以点「让 AI 改」接着做",evt.state==="done"?"info":"error");
  const pids=appPanels(evt.file);if(pids.length)pids.forEach(pid=>appLoad(pid));else openPanel({type:"app",path:evt.file});
 }else{
  toast(evt.state==="stopped"?"已停止做「"+evt.title+"」":"「"+evt.title+"」没做成"+(evt.summary?"："+shorten(evt.summary,160):""),evt.state==="stopped"?"info":"error");
  appPanels(evt.file).forEach(pid=>appLoad(pid));
 }
 for(const pid of appPanels(null))appLoad(pid);
}
let appTick=null;
function appTicker(){
 if(appTick)return;
 appTick=setInterval(()=>{
  if(!Object.keys(AppBuilds).length){clearInterval(appTick);appTick=null;return;}
  all(".app-progress em[data-since]").forEach(em=>em.textContent=elapsed(Date.now()-Number(em.dataset.since)));
 },1000);
}
/* The builder's check: the app loaded the way the learner sees it, out of sight, and what it reported. */
function appCheck(evt){
 const frame=document.createElement("iframe");
 frame.setAttribute("sandbox",APP_SANDBOX);frame.className="app-check";
 frame.src=appUrl(evt.url);
 document.body.appendChild(frame);
 AppChecks[evt.request]=frame;
 setTimeout(()=>{if(AppChecks[evt.request]){AppChecks[evt.request].remove();delete AppChecks[evt.request];}},Number(evt.wait||1500)+20000);
}
const AppChecks={};
addEventListener("message",e=>{
 const d=e.data;if(!d||typeof d!=="object")return;
 if(d.lattice_check&&AppChecks[d.lattice_check]?.contentWindow===e.source){
  AppChecks[d.lattice_check].remove();delete AppChecks[d.lattice_check];
  const {lattice_check,...result}=d;return rpc("ui_done",{request:lattice_check,result});
 }
 if(d.lattice_live&&AppLive[d.lattice_live]){const {lattice_live,...live}=d;AppLive[lattice_live](live);return;}
 if(d.lattice==="ask"){
  const frame=all("iframe.app-frame").find(f=>f.contentWindow===e.source);if(!frame)return;
  const pid=frame.closest(".panel")?.dataset.pid,title=Apps[pid]?.data?.title||"应用";
  // Into the main conversation's input as a quote; the learner adds the question.
  let target=Object.keys(Chat).find(x=>Dock.panels[x]?.agent==="tutor"&&!Dock.panels[x].thread);
  if(!target)target=openPanel({type:"chat",agent:"tutor"});else activate(target);
  const go=()=>{if(!Chat[target]?.data)return setTimeout(go,150);Chat[target].quote="在应用「"+title+"」里："+String(d.text||"");updateComposer(target);Dock.els[target]?.querySelector(".composer textarea")?.focus();};
  go();
 }
});
/* What an app shows right now, for an agent reading its tab: its page answers with its text and its controls' values. */
const AppLive={};
function appLive(pid){
 const frame=Dock.els[pid]?.querySelector("iframe.app-frame");
 if(!frame?.contentWindow)return Promise.resolve({live_error:"这个应用还没打开"});
 const id=newId("l");
 return new Promise(resolve=>{
  const t=setTimeout(()=>{delete AppLive[id];resolve({live_error:"应用没有回应（可能还在加载，或者卡住了）"});},2500);
  AppLive[id]=live=>{clearTimeout(t);delete AppLive[id];resolve({live});};
  frame.contentWindow.postMessage({lattice_live:id},"*");
 });
}
async function appAction(kind,a){
 const pid=a.dataset.pid;
 if(kind==="open-apps")return openPanel({type:"app"});
 if(kind==="app-open")return openPanel({type:"app",path:a.dataset.path});
 if(kind==="app-source")return openPanel({type:"file",path:a.dataset.path});
 if(kind==="app-reload")return appLoad(pid);
 if(kind==="app-stop")return rpc("cancel",{thread:a.dataset.build});
 if(kind==="app-build"){
  const area=Dock.els[pid]?.querySelector("textarea[data-app-ask]"),brief=area?.value.trim();
  if(!brief)return toast("先写一下想要什么样的应用");
  await rpc("app_build",{brief});area.value="";return;
 }
 if(kind==="app-change"){
  const p=Dock.panels[pid],brief=await askText("想怎么改「"+(Apps[pid]?.data?.title||baseName(p.path))+"」？","",{placeholder:"比如：加一个速度滑块；按钮放大一点",ok:"让应用助手改"});
  if(!brief)return;
  return rpc("app_build",{brief,file:p.path,title:Apps[pid]?.data?.title||""});
 }
}
