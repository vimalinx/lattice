"use strict";
/* The learner's other panels: the vault browser, the knowledge map, the journal, reviews and settings. */
const FOLDER_NAME={topics:"主题",cards:"知识卡",lessons:"课程",notes:"笔记",insights:"薄弱点",notebooks:"实验笔记",code:"代码",data:"数据",envs:"环境",threads:"对话",journal:"轨迹",agents:"AI 的规矩"};
const Browser={entries:{},open:new Set(["topics","cards","notes","code","notebooks"]),query:"",hits:null};
panelType("browser",{side:"mine",icon:"folder",title:()=>"学习库",
 mount(p,node){node.innerHTML='<div class="browser"><div class="browser-head"><input class="search-box" data-browser-search placeholder="搜索标题、正文、文件名和对话…"/>'+
  '<button class="btn sm" data-action="new-menu" title="新建">'+svg("plus",13)+' 新建</button></div><div class="tree" data-keep-scroll></div></div>';renderBrowser();},
 screen(){return {view:"学习库",expanded:[...Browser.open],search:Browser.query||undefined};}});
async function treeEntries(path){if(!Browser.entries[path])Browser.entries[path]=await rpc("tree",{path});return Browser.entries[path];}
async function renderBrowser(){
 for(const node of Object.values(Dock.els).map(n=>n.querySelector(".browser .tree")).filter(Boolean)){
  if(Browser.hits){node.innerHTML=Browser.hits.length?Browser.hits.map(hitHtml).join(""):'<p class="muted pad">没有找到。</p>';continue;}
  node.innerHTML=await treeHtml("",0);
 }
}
async function treeHtml(path,depth){
 const entries=await treeEntries(path);
 let out="";
 for(const e of entries){
  const open=Browser.open.has(e.path),label=depth===0&&!e.project?FOLDER_NAME[e.name]||e.name:e.name.replace(/\.md$/,"");
  if(e.type==="dir"){
   out+='<div class="tree-row dir'+(open?" open":"")+'" style="--d:'+depth+'" data-action="tree-toggle" data-path="'+esc(e.path)+'">'+svg(open?"chevrondown":"chevron",12)+svg(e.project?"link":"folder",13)+'<span>'+esc(label)+'</span>'+
    (e.project?'<small>挂载 · AI 只读</small>'+iconButton("close","project-remove","取消挂载",'data-id="'+esc(e.project)+'"'):"")+'</div>';
   if(open)out+=await treeHtml(e.path,depth+1);
  }else out+='<div class="tree-row file" style="--d:'+depth+'" data-action="open-file" data-path="'+esc(e.path)+'" draggable="false">'+svg(fileIcon(e.path),13)+'<span>'+esc(label)+'</span></div>';
 }
 return out||(depth?'<div class="tree-row empty" style="--d:'+depth+'">空</div>':"");
}
function hitHtml(x){
 const action=x.kind==="message"?'data-action="open-thread" data-thread="'+esc(x.thread)+'" data-agent="'+esc(x.agent||"tutor")+'"':'data-action="open-file" data-path="'+esc(x.path)+'"';
 return '<div class="hit" '+action+'>'+svg(x.kind==="message"?"bot":fileIcon(x.path),13)+'<div><b>'+esc(x.title)+'</b><small>'+esc(kindName[x.kind]||x.kind)+(x.path?" · "+esc(x.path):"")+'</small><p>'+esc(x.excerpt)+'</p></div></div>';
}
function browserChanged(paths){
 for(const path of paths||[]){const parts=path.split("/");for(let i=0;i<parts.length;i++)delete Browser.entries[parts.slice(0,i).join("/")];}
 renderBrowser();
}

/* ---- the knowledge map ---------------------------------------------------------------------------------- */
const MapState={};
panelType("map",{side:"mine",icon:"map",title:p=>p.topic?"知识图 · "+topicTitle(p.topic):"知识图",
 mount(p,node,pid){
  node.innerHTML='<div class="map"><div class="map-bar"><select data-map-topic="'+pid+'"></select><span class="map-stats muted"></span><span class="grow"></span>'+
   iconButton("refresh","map-relayout","重新排布",'data-pid="'+pid+'"')+'</div><div class="map-body"><div class="map-canvas"></div><aside class="map-route"></aside></div></div>';
  loadMap(pid);
 },
 screen(p){return {view:"知识图",topic:p.topic||null};}});
async function loadMap(pid){
 const p=Dock.panels[pid],node=Dock.els[pid];if(!node)return;
 const sel=node.querySelector("[data-map-topic]");
 sel.innerHTML='<option value="">整张图</option>'+(S.data.topics||[]).map(t=>'<option value="'+esc(t.id)+'"'+(p.topic===t.id?" selected":"")+'>'+esc((t.parent?"↳ ":"")+t.title)+'</option>').join("");
 const g=await rpc("graph",{topic:p.topic||null});
 MapState[pid]=g;
 node.querySelector(".map-stats").textContent=g.nodes.length+" 个节点 · "+g.edges.length+" 条关系";
 const canvas=node.querySelector(".map-canvas");
 if(!g.nodes.length){canvas.innerHTML=emptyState("map","图还是空的","和主讲聊着聊着，它会把讲过的东西存成卡片、连成关系，并给每个主题定一条主干路线。");node.querySelector(".map-route").innerHTML="";return;}
 canvas.innerHTML="";mountGraph(canvas,g,{topic:p.topic});
 const route=p.topic?g.routes[p.topic]||[]:[],docs=new Map((S.data.docs||[]).map(d=>[d.id,d]));
 node.querySelector(".map-route").innerHTML=p.topic?'<h4>主干路线</h4>'+(route.length?'<ol>'+route.map(s=>'<li>'+(s.ref&&docs.get(s.ref)?'<a data-action="open-doc" data-id="'+esc(s.ref)+'">'+esc(s.title)+'</a>':esc(s.title))+(s.why?'<small>'+esc(s.why)+'</small>':"")+'</li>').join("")+'</ol>':'<p class="muted">还没有路线。</p>')+
  button(svg("document",12)+" 打开主题","open-doc",'data-id="'+esc(p.topic)+'"',"ghost xs"):'<h4>图例</h4><p class="legend">⬢ 主题 · ▢ 知识卡（边框色＝理解阶段）· ● 笔记 · ◆ 课程 · ■ 实验笔记和文件 · ▲ 薄弱点</p><p class="muted">选一个主题，就能看到它的主干路线和挂着的岔路。</p>';
}
function mapsChanged(){clearTimeout(MapState.timer);MapState.timer=setTimeout(()=>Object.keys(Dock.panels).filter(pid=>Dock.panels[pid].type==="map").forEach(loadMap),800);}

/* ---- the journal ------------------------------------------------------------------------------------------- */
const JOURNAL_GROUPS={"":"全部",asked:"提问与作答",ran:"运行",wrote:"写作",viewed:"查看",reviewed:"回顾",judged:"AI 判断与讲解",detour:"岔路与主干",insight:"薄弱点",searched:"联网",action:"AI 动作"};
const GROUP_TYPES={asked:["asked","answered"],judged:["judged","explained"],detour:["detour","bridged"],reviewed:["reviewed","staged"],action:["action","undo","installed","organized"]};
panelType("journal",{side:"mine",icon:"history",title:()=>"学习轨迹",
 mount(p,node,pid){node.innerHTML='<div class="journal"><div class="map-bar"><select data-journal-type="'+pid+'">'+Object.entries(JOURNAL_GROUPS).map(([k,v])=>'<option value="'+k+'"'+((p.group||"")===k?" selected":"")+'>'+esc(v)+'</option>').join("")+'</select>'+
  '<select data-journal-days="'+pid+'">'+[[1,"今天"],[7,"近 7 天"],[30,"近 30 天"],[0,"全部"]].map(([d,t])=>'<option value="'+d+'"'+((p.days??7)==d?" selected":"")+'>'+t+'</option>').join("")+'</select></div><div class="journal-list" data-keep-scroll></div></div>';loadJournal(pid);},
 screen(p){return {view:"学习轨迹",filter:p.group||"all"};}});
async function loadJournal(pid){
 const p=Dock.panels[pid],node=Dock.els[pid];if(!node)return;
 const days=p.days??7,group=p.group||"";
 const types=group?GROUP_TYPES[group]||[group]:null;
 const since=days?new Date(Date.now()-(days===1?(Date.now()-new Date().setHours(0,0,0,0)):days*864e5)).toISOString():null;
 const rows=await rpc("journal",{types,since,limit:400});
 const byDay={};rows.forEach(r=>(byDay[r.at.slice(0,10)]=byDay[r.at.slice(0,10)]||[]).push(r));
 node.querySelector(".journal-list").innerHTML=Object.entries(byDay).map(([day,list])=>'<h5>'+esc(new Date(day).toLocaleDateString("zh-CN",{month:"long",day:"numeric",weekday:"short"}))+' · '+list.length+' 条</h5>'+list.map(journalRow).join("")).join("")||emptyState("history","这段时间没有记录","提问、作答、运行、写作和 AI 的判断都会记在这里。");
}
function journalsChanged(){clearTimeout(MapState.jtimer);MapState.jtimer=setTimeout(()=>Object.keys(Dock.panels).filter(pid=>Dock.panels[pid].type==="journal").forEach(loadJournal),1500);}

/* ---- reviewing due cards ------------------------------------------------------------------------------------ */
panelType("review",{side:"mine",icon:"card",title:()=>"回顾",
 mount(p,node){node.innerHTML='<div class="review"><div class="review-body"></div></div>';loadReview(node);},
 screen(){return {view:"回顾到期的卡"};}});
async function loadReview(node){
 const due=await rpc("due");
 const body=node.querySelector(".review-body");
 if(!due.length){body.innerHTML=emptyState("check","现在没有到期的卡","接触过的卡会在保存一天后到期；每次自评以后，间隔会按你记得的程度拉长或缩短。");return;}
 body.innerHTML='<div class="lblock"></div>';
 await BLOCKS.cards({cards:due.map(c=>c.id),review:true},body.firstElementChild,{});
}

/* ---- settings ------------------------------------------------------------------------------------------------- */
panelType("settings",{side:"mine",icon:"sliders",title:()=>"设置",mount(p,node){renderSettings(node);},screen(){return {view:"设置"};}});
async function renderSettings(node){
 const c=S.config=await rpc("settings"),env=await rpc("env_info",{name:"default"}).catch(()=>null);
 const apiOptions=sel=>c.apis.map(a=>'<option value="'+a.id+'"'+(a.id===sel?" selected":"")+'>'+esc(a.label)+(a.has_key?"":" · 没有 Key")+'</option>').join("");
 node.innerHTML='<div class="settings" data-keep-scroll>'+
  '<section><h3>'+svg("bot",15)+' 四个 AI 用哪个模型</h3><div class="agent-grid">'+Object.entries(c.agents).map(([name,a])=>'<div class="agent-card"><h4>'+esc(a.title)+'</h4>'+
   '<label>API 连接<select data-cfg-agent="'+name+'" data-key="api">'+apiOptions(a.api)+'</select></label><label>模型<input data-cfg-agent="'+name+'" data-key="model" value="'+esc(a.model)+'"/></label>'+
   '<label>回复上限（含思考）<input type="number" min="256" max="64000" data-cfg-agent="'+name+'" data-key="max_tokens" value="'+esc(a.max_tokens)+'"/></label>'+button("测试连接","cfg-test",'data-agent="'+name+'"',"ghost xs")+'</div>').join("")+'</div>'+
   '<p class="muted">每个 AI 的工作方式写在它的规则文件里；在学习库里放一份 agents/&lt;名字&gt;.md 就能改写它。学习库根目录的 AGENTS.md 是所有 AI 共同遵守的规矩。</p><div class="test-result" id="cfg-test-result"></div></section>'+
  '<section><h3>'+svg("link",15)+' API 连接</h3>'+c.apis.map(a=>'<details class="api"'+(Object.values(c.agents).some(x=>x.api===a.id)?" open":"")+'><summary><b>'+esc(a.label)+'</b><span class="muted">'+esc(a.base_url||"还没填地址")+' · Key：'+esc(a.key_source)+'</span></summary>'+
   '<label>Base URL<input data-cfg-api="'+a.id+'" data-key="base_url" value="'+esc(a.base_url)+'" placeholder="https://…/v1"/></label>'+
   '<label>API Key <small>留空表示不改</small><input type="password" autocomplete="new-password" data-cfg-api="'+a.id+'" data-key="api_key" placeholder="'+(a.has_key?"已保存，不会回传":"sk-…")+'"/></label>'+
   '<div class="two"><label>请求头 <small>{session} 会换成会话 id</small><textarea rows="2" data-cfg-api="'+a.id+'" data-key="headers">'+esc(JSON.stringify(a.headers))+'</textarea></label>'+
   '<label>附加参数<textarea rows="2" data-cfg-api="'+a.id+'" data-key="extra_body">'+esc(JSON.stringify(a.extra_body))+'</textarea></label></div>'+
   button("清除本机 Key","cfg-clear-key",'data-api="'+a.id+'"',"ghost xs")+'</details>').join("")+
   '<div class="two"><label>超时（秒）<input type="number" data-cfg="timeout" value="'+esc(c.timeout)+'"/></label><label>Temperature<input type="number" step="0.05" data-cfg="temperature" value="'+esc(c.temperature)+'"/></label></div></section>'+
  '<section><h3>'+svg("search",15)+' 联网</h3><p class="muted">AI 有两个联网接口：搜索和读网页。什么时候查由它判断；搜到的来源会列在回复下面，并记进轨迹。命令行沙箱本身不联网。</p>'+
   '<label>搜索服务<select data-cfg-web="search">'+Object.entries(c.web_backends).map(([k,v])=>'<option value="'+k+'"'+(c.web.search===k?" selected":"")+'>'+esc(v)+'</option>').join("")+'</select></label>'+
   '<div class="two"><label>SearXNG 地址<input data-cfg-web="searxng_url" value="'+esc(c.web.searxng_url)+'" placeholder="https://searx.example"/></label>'+
   '<label>Brave Key <small>'+(c.web.brave_key?"已保存":"未填")+'</small><input type="password" data-cfg-web="brave_key"/></label><label>Tavily Key <small>'+(c.web.tavily_key?"已保存":"未填")+'</small><input type="password" data-cfg-web="tavily_key"/></label></div></section>'+
  '<section><h3>'+svg("terminal",15)+' 运行与环境</h3>'+
   '<label class="check"><input type="checkbox" data-cfg="agent_auto_run"'+(c.agent_auto_run?" checked":"")+'/> 允许 AI 自己运行代码和命令 <small>都在沙箱里：看不到家目录，不联网</small></label>'+
   '<label class="check"><input type="checkbox" data-cfg="auto_install"'+(c.auto_install?" checked":"")+'/> 运行时缺 Python 包就自动装进学习库的环境，再重跑一次 <small>装了什么会记进轨迹，可以撤销</small></label>'+
   '<label class="check"><input type="checkbox" data-cfg="agent_auto_organize"'+(c.agent_auto_organize?" checked":"")+'/> 关掉随手写的记录或代码后，自动交给 AI 整理</label>'+
   '<div class="three"><label>实验笔记单格时限（秒）<input type="number" data-cfg="kernel_timeout" value="'+esc(c.kernel_timeout)+'"/></label><label>运行文件时限（秒）<input type="number" data-cfg="run_timeout" value="'+esc(c.run_timeout)+'"/></label><label>AI 命令时限（秒）<input type="number" data-cfg="shell_timeout" value="'+esc(c.shell_timeout)+'"/></label></div>'+
   '<label>运行器 <small>按扩展名添加或改写，例如 {".lua": "lua {file}"}；可用 {file} {dir} {stem} {out} {python}</small><textarea rows="3" data-cfg="runners">'+esc(JSON.stringify(c.runners,null,1))+'</textarea></label>'+
   '<label>沙箱里额外可见的只读路径 <small>一行一个，比如装在家目录里的工具链</small><textarea rows="2" data-cfg="sandbox_paths">'+esc((c.sandbox_paths||[]).join("\n"))+'</textarea></label>'+
   '<p class="'+(S.data.sandbox?.ok?"muted":"warn")+'">'+(S.data.sandbox?.ok?svg("shield",13)+" 沙箱可用（bubblewrap）":esc(S.data.sandbox?.why||""))+'</p>'+
   (env?'<div class="env-box"><b>Python 环境「default」</b> <span class="muted">'+(env.ready?"已建好":"第一次运行时自动建好")+' · 定义在 '+esc(env.definition)+'</span><p class="muted">'+esc(env.wanted.join("、"))+'</p>'+
    '<div class="inline"><input data-env-install placeholder="要装的包，空格分开"/>'+button("安装","env-install","","ghost xs")+'</div></div>':"")+'</section>'+
  '<section><h3>'+svg("folder",15)+' 学习库</h3><p class="muted">所有学习数据都是普通文件，放在 <code>'+esc(S.data.vault)+'</code>，它本身是一个 git 仓库。可以用任何编辑器直接改。</p>'+
   '<div class="inline">'+button(svg("folder",13)+" 打开文件夹","open-vault","","ghost sm")+button(svg("link",13)+" 挂载一个本地目录","project-add","","ghost sm")+button(svg("upload",13)+" 导入 Markdown 笔记","import-md","","ghost sm")+button(svg("download",13)+" 导出整个学习库","export","","ghost sm")+'</div></section>'+
  '<div class="settings-save">'+button(svg("save",14)+" 保存设置","cfg-save","","primary")+'</div></div>';
}
function collectSettings(node){
 const cfg={agents:{},apis:{},web:{}};
 all("[data-cfg-agent]",node).forEach(i=>{(cfg.agents[i.dataset.cfgAgent]=cfg.agents[i.dataset.cfgAgent]||{})[i.dataset.key]=i.type==="number"?Number(i.value):i.value;});
 all("[data-cfg-api]",node).forEach(i=>{const a=cfg.apis[i.dataset.cfgApi]=cfg.apis[i.dataset.cfgApi]||{};
  if(i.dataset.key==="headers"||i.dataset.key==="extra_body"){try{a[i.dataset.key]=JSON.parse(i.value||"{}");}catch(_){throw new Error("「"+i.dataset.cfgApi+"」的 "+i.dataset.key+" 不是合法的 JSON");}}
  else if(i.dataset.key!=="api_key"||i.value)a[i.dataset.key]=i.value;});
 all("[data-cfg-web]",node).forEach(i=>{if(i.type!=="password"||i.value)cfg.web[i.dataset.cfgWeb]=i.value;});
 all("[data-cfg]",node).forEach(i=>{
  const k=i.dataset.cfg;
  if(i.type==="checkbox")cfg[k]=i.checked;else if(i.type==="number")cfg[k]=Number(i.value);
  else if(k==="runners"){try{cfg[k]=JSON.parse(i.value||"{}");}catch(_){throw new Error("运行器不是合法的 JSON");}}
  else if(k==="sandbox_paths")cfg[k]=i.value.split("\n").map(x=>x.trim()).filter(Boolean);else cfg[k]=i.value;
 });
 return cfg;
}
async function saveSettings(node){S.config=await rpc("settings_save",{config:collectSettings(node)});toast("设置已保存");await renderSettings(node);refreshChats();}
function settingsTestResult(evt){const box=el("#cfg-test-result");const text=(evt.ok?"✓ ":"连接失败：")+evt.message;if(box)box.textContent=text;toast(text,evt.ok?"info":"error");}
