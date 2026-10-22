"use strict";
/* The learner's other panels: the start page, the knowledge map, the journal, reviews and settings. */
/* ---- the knowledge map ---------------------------------------------------------------------------------- */
const MapState={};
panelType("map",{side:"mine",icon:"network",title:p=>p.topic?"知识图 · "+topicTitle(p.topic):"知识图",
 mount(p,node,pid){
  node.innerHTML='<div class="map"><div class="map-bar"><select data-map-topic="'+pid+'"></select><span class="map-stats muted"></span><span class="grow"></span>'+
   iconButton("refresh","map-relayout","重新排布",'data-pid="'+pid+'"')+'</div><div class="map-body"><div class="map-canvas"></div><aside class="map-route"></aside></div></div>';
  loadMap(pid);
 },
 shown(p,node){const c=node.querySelector(".map-canvas"),cy=c?.__cy;if(cy&&!cy.destroyed()){cy.resize();cy.fit(undefined,20);}else if(c&&c.clientWidth&&!c.firstChild)loadMap(node.dataset.pid);},
 screen(p){return {view:"知识图",topic:p.topic||null};}});
async function loadMap(pid){
 const p=Dock.panels[pid],node=Dock.els[pid];if(!node)return;
 const sel=node.querySelector("[data-map-topic]");
 sel.innerHTML='<option value="">整张图</option>'+(S.data.topics||[]).map(t=>'<option value="'+esc(t.id)+'"'+(p.topic===t.id?" selected":"")+'>'+esc((t.parent?"↳ ":"")+t.title)+'</option>').join("");
 const g=await rpc("graph",{topic:p.topic||null});
 MapState[pid]=g;
 node.querySelector(".map-stats").textContent=g.nodes.length+" 个节点 · "+g.edges.length+" 条关系";
 const canvas=node.querySelector(".map-canvas");
 if(!g.nodes.length){canvas.innerHTML=emptyState("map","图还是空的","和主会话聊着聊着，它会把讲过的东西存成卡片、连成关系，并给每个主题定一条主干路线。");node.querySelector(".map-route").innerHTML="";return;}
 canvas.innerHTML="";
 if(!canvas.clientWidth)return;  // not on screen yet; drawn when the panel is shown
 mountGraph(canvas,g,{topic:p.topic});
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
panelType("review",{side:"mine",icon:"refresh",title:()=>"回顾",
 mount(p,node){node.innerHTML='<div class="review"><div class="review-body"></div></div>';loadReview(node);},
 screen(){return {view:"回顾到期的卡"};}});
async function loadReview(node){
 const due=await rpc("due");
 const body=node.querySelector(".review-body");
 if(!due.length){body.innerHTML=emptyState("check","现在没有到期的卡","接触过的卡会在保存一天后到期；每次自评以后，间隔会按你记得的程度拉长或缩短。");return;}
 body.innerHTML='<div class="lblock"></div>';
 await BLOCKS.cards({cards:due.map(c=>c.id),review:true},body.firstElementChild,{});
}

/* ---- the start page: where I am, what is waiting, what changed ---------------------------------------- */
panelType("home",{side:"mine",icon:"home",title:()=>"开始",mount(p,node){node.innerHTML='<div class="home" data-keep-scroll></div>';renderHome(node);},
 screen(){return {view:"开始"};}});
async function renderHome(node){
 const box=node.querySelector(".home");if(!box)return;
 const t=(S.data.topics||[]).find(x=>x.id===S.data.active_topic),docs=new Map((S.data.docs||[]).map(d=>[d.id,d]));
 const recent=await safe(()=>rpc("journal",{types:["wrote","ran","viewed"],limit:60}))||[];
 const files=[...new Set(recent.flatMap(e=>(e.data.files||[]).map(f=>f.file).concat(e.data.file?[e.data.file]:[])))].filter(x=>!x.startsWith(".lattice")).slice(0,10);
 const lately=await safe(()=>rpc("journal",{limit:10}))||[];
 const active=(S.data.practices||[]).filter(x=>x.state==="active");
 box.innerHTML='<section class="home-now">'+(t?'<div class="overline">正在学</div><h2><a data-action="open-doc" data-id="'+esc(t.id)+'">'+esc(t.title)+'</a></h2><p class="muted">'+esc(t.question||"")+'</p>'+
   ((t.route||[]).length?'<ol class="home-route">'+t.route.slice(0,9).map(s=>'<li>'+(s.ref&&docs.get(s.ref)?'<a data-action="open-doc" data-id="'+esc(s.ref)+'">'+esc(s.title)+'</a>':esc(s.title))+'</li>').join("")+'</ol>':'<p class="muted">还没有主干路线。</p>')
   :'<div class="overline">默认对话</div><h2>想到什么，直接和主会话说。</h2><p class="muted">值得长期深入的内容，主会话会建成主题，并定一条主干路线；你在左栏「主题」里能看到它们。</p>')+'</section>'+
  '<div class="home-grid">'+
  '<section class="home-box"><h4>'+svg("refresh",14)+' 回顾</h4>'+(S.data.due?'<p>'+S.data.due+' 张卡到期。</p>'+button("开始回顾","open-review","","primary sm"):'<p class="muted">现在没有到期的卡。</p>')+'</section>'+
  '<section class="home-box"><h4>'+svg("code",14)+' 进行中的练习</h4>'+(active.map(x=>'<a data-action="open-practice" data-id="'+esc(x.id)+'">'+esc(x.title)+'</a>').join("")||'<p class="muted">没有。</p>')+'</section>'+
  '<section class="home-box"><h4>'+svg("file",14)+' 最近碰过的文件</h4>'+(files.map(f=>'<a data-action="open-file" data-path="'+esc(f)+'">'+svg(fileIcon(f),12)+' '+esc(baseName(f))+'</a>').join("")||'<p class="muted">还没有。</p>')+'</section>'+
  '<section class="home-box wide"><h4>'+svg("history",14)+' 刚才发生了什么</h4>'+(lately.map(journalRow).join("")||'<p class="muted">还没有记录。</p>')+button("打开学习轨迹","open-journal","","ghost xs")+'</section></div>';
}
function homesChanged(){clearTimeout(MapState.htimer);MapState.htimer=setTimeout(()=>Object.keys(Dock.panels).filter(pid=>Dock.panels[pid].type==="home").forEach(pid=>renderHome(Dock.els[pid])),1200);}

/* ---- settings: everything is changeable here ------------------------------------------------------------- */
const SETTINGS_PAGES=[["look","外观与交互","sun"],["layout","布局与左栏","layout"],["agents","四个 AI","bot"],["apis","模型连接","link"],["web","联网","search"],
 ["run","运行与环境","terminal"],["vault","学习库","folder"],["rules","学习库的规矩","shield"],["keys","快捷键","cmd"]];
panelType("settings",{side:"mine",icon:"sliders",title:()=>"设置",
 mount(p,node,pid){node.innerHTML='<div class="settings-shell"><nav class="settings-nav"></nav><div class="settings" data-keep-scroll></div></div>';renderSettings(node,p.page||"look");},
 screen(p){return {view:"设置",page:p.page||"look"};}});
async function renderSettings(node,page){
 const p=Dock.panels[node.dataset.pid];if(p)p.page=page;
 node.querySelector(".settings-nav").innerHTML=SETTINGS_PAGES.map(([k,t,i])=>'<button class="'+(k===page?"on":"")+'" data-action="settings-page" data-page="'+k+'" title="'+esc(t)+'">'+svg(i,14)+'<span>'+esc(t)+'</span></button>').join("");
 const box=node.querySelector(".settings");box.dataset.page=page;
 box.innerHTML='<div class="loading">…</div>';
 S.config=await rpc("settings");
 box.innerHTML=await SETTINGS_RENDER[page](S.config,node);
}
const opt=(value,list)=>list.map(([v,t])=>'<option value="'+esc(v)+'"'+(String(value)===String(v)?" selected":"")+'>'+esc(t)+'</option>').join("");
const SETTINGS_RENDER={
 look(c){
  const u=S.ui;
  return '<h3>外观</h3><div class="three"><label>主题<select data-ui="theme">'+opt(u.theme,[["dark","深色"],["light","浅色"]])+'</select></label>'+
   '<label>正文字号<input type="number" step="0.5" min="11" max="24" data-ui="font_size" value="'+esc(u.font_size)+'"/></label>'+
   '<label>代码字号<input type="number" step="0.5" min="10" max="24" data-ui="code_font_size" value="'+esc(u.code_font_size)+'"/></label></div>'+
   '<div class="three"><label>行距<input type="number" step="0.05" min="1.3" max="2.4" data-ui="line_height" value="'+esc(u.line_height)+'"/></label>'+
   '<label>阅读宽度 <small>对话和文档正文一行最多多宽</small><select data-ui="read_width">'+opt(u.read_width,[["narrow","窄 · 约 32 字"],["medium","中 · 约 40 字"],["wide","宽 · 约 52 字"],["none","不限"]])+'</select></label>'+
   '<label>密度<select data-ui="density">'+opt(u.density,[["comfortable","舒适"],["compact","紧凑"]])+'</select></label></div>'+
   '<h3>每种窗口的大小</h3><p class="muted">新开的窗口按这里的比例显示，文字、代码、间距和图标一起缩放。某一个窗口还可以单独调：鼠标放在它上面按 Ctrl + 滚轮，或者聚焦后按 Ctrl + = / Ctrl + - / Ctrl + 0，标签上右键也能调；单独调过的会在标签上显示百分比，存布局时一起存下。</p>'+
   '<div class="zoom-grid">'+ZOOM_KINDS.map(([k,t])=>'<label>'+esc(t)+'<span class="unit"><input type="number" step="5" min="60" max="250" data-zoom-kind="'+k+'" value="'+Math.round((Number(u.zoom?.[k])||1)*100)+'"/>%</span></label>').join("")+'</div>'+
   (Object.values(Dock.panels).some(p=>p.zoom)?'<div class="inline"><span class="muted">有 '+Object.values(Dock.panels).filter(p=>p.zoom).length+' 个窗口单独调过大小。</span>'+button("全部恢复成各自的默认","zoom-reset-all","","ghost sm")+'</div>':"")+
   '<h3>交互</h3><label>发送消息<select data-ui="send_key">'+opt(u.send_key,[["enter","Enter 发送，Shift + Enter 换行"],["ctrl","Ctrl + Enter 发送，Enter 换行"]])+'</select></label>'+
   '<label class="check"><input type="checkbox" data-ui="selection_popup"'+(u.selection_popup?" checked":"")+'/> 选中文字时出现「问快答 / 问主会话」</label>'+
   '<label class="check"><input type="checkbox" data-cfg="agent_auto_organize"'+(c.agent_auto_organize?" checked":"")+'/> 关掉随手写的记录或代码后，自动交给 AI 整理</label>'+
   '<label>停下多少秒后提交我的编辑<input type="number" min="5" max="3600" data-cfg="commit_idle" value="'+esc(c.commit_idle)+'"/></label>'+
   '<p class="muted">外观改了立刻生效；交互和提交间隔点下面的保存。</p>'+saveBar();
 },
 layout(){
  const u=S.ui,presets=Object.keys(u.presets||{});
  return '<h3>布局</h3><p class="muted">面板随你拖：拖到另一组标签上并排，拖到边缘分栏，标签上的按钮可以浮出。把满意的样子存下来，以后一键套用；设为默认的那个，在「恢复默认布局」和新学习库里都会用到。</p>'+
   '<div class="inline"><input data-preset-name placeholder="给当前布局起个名字"/>'+button(svg("save",13)+" 存为布局","preset-save","","primary sm")+button("把当前布局设为默认","preset-default-current","","ghost sm")+'</div>'+
   (presets.length?'<div class="preset-list">'+presets.map(n=>'<div class="preset"><b>'+esc(n)+'</b>'+(u.default_preset===n?'<span class="chip on">默认</span>':"")+'<span class="grow"></span>'+
    button("套用","preset-apply",'data-name="'+esc(n)+'"',"ghost xs")+(u.default_preset===n?button("取消默认","preset-default",'data-name=""',"ghost xs"):button("设为默认","preset-default",'data-name="'+esc(n)+'"',"ghost xs"))+
    button("用当前布局覆盖","preset-overwrite",'data-name="'+esc(n)+'"',"ghost xs")+button("删除","preset-delete",'data-name="'+esc(n)+'"',"ghost xs")+'</div>').join("")+'</div>':'<p class="muted">还没有存过布局。</p>')+
   '<div class="inline">'+button("恢复默认布局","layout-default","","ghost sm")+button("恢复出厂布局","layout-factory","","ghost sm")+'</div>'+
   '<h3>左栏</h3><label class="check"><input type="checkbox" data-side-open'+(u.side.open?" checked":"")+'/> 展开左栏 <small>（点活动栏上当前分区的图标也能收起）</small></label>'+
   '<label>左栏宽度<input type="number" min="180" max="560" data-side-width value="'+esc(u.side.width)+'"/></label>'+
   '<div class="field-label">分区：顺序和显示</div><div class="section-list">'+[...sideOrder(),...(u.side.hidden||[])].filter((k,i,a)=>a.indexOf(k)===i&&SIDE_SECTIONS[k]).map((k,i)=>'<div class="preset">'+svg(SIDE_SECTIONS[k].icon,14)+' '+esc(SIDE_SECTIONS[k].title)+'<span class="grow"></span>'+
    '<label class="check inline-check"><input type="checkbox" data-side-show="'+k+'"'+((u.side.hidden||[]).includes(k)?"":" checked")+'/> 显示</label>'+iconButton("arrowup","side-move","上移",'data-key="'+k+'"')+'</div>').join("")+'</div>';
 },
 async agents(c){
  const cards=[];
  for(const [name,a] of Object.entries(c.agents)){
   const d=await rpc("agent_definition",{name}),def=d.definition,apiOpts=c.apis.map(x=>[x.id,x.label+(x.has_key?"":" · 没有 Key")]);
   cards.push('<details class="agent-edit"'+(name==="tutor"?" open":"")+'><summary><b>'+esc(a.title)+'</b> <span class="muted">'+esc(a.label)+(d.overridden?" · 规则已改写":"")+'</span></summary>'+
    '<div class="three"><label>API 连接<select data-cfg-agent="'+name+'" data-key="api">'+opt(a.api,apiOpts)+'</select></label><label>模型<input data-cfg-agent="'+name+'" data-key="model" value="'+esc(a.model)+'"/></label>'+
    '<label>回复上限（含思考）<input type="number" min="256" max="64000" data-cfg-agent="'+name+'" data-key="max_tokens" value="'+esc(a.max_tokens)+'"/></label></div>'+
    '<div class="three"><label>Temperature <small>留空用全局</small><input type="number" step="0.05" min="0" max="2" data-cfg-agent="'+name+'" data-key="temperature" value="'+esc(a.temperature??"")+'"/></label>'+
    '<label>每轮带上多少条历史<input type="number" min="0" max="200" data-agent-history="'+name+'" value="'+esc(def.history)+'"/></label>'+
    '<label class="check"><input type="checkbox" data-agent-blocks="'+name+'"'+(def.blocks?" checked":"")+'/> 能用展示块</label></div>'+
    '<div class="field-label">能用的工具</div><div class="tool-grid">'+d.tools.map(t=>'<label class="check" title="'+esc(t.description)+'"><input type="checkbox" data-agent-tool="'+name+'" value="'+t.name+'"'+(def.tools.includes(t.name)?" checked":"")+'/> '+esc(t.name)+'</label>').join("")+'</div>'+
    '<label>规则 <small>它每一轮都读；改了存进学习库的 agents/'+name+'.md</small><textarea rows="14" data-agent-policy="'+name+'">'+esc(def.policy)+'</textarea></label>'+
    '<div class="inline">'+button(svg("save",13)+" 保存这个 AI 的规则","agent-save",'data-name="'+name+'"',"primary sm")+(d.overridden?button("恢复默认规则","agent-reset",'data-name="'+name+'"',"ghost sm"):"")+button("测试连接","cfg-test",'data-agent="'+name+'"',"ghost sm")+'</div></details>');
  }
  return '<h3>四个 AI</h3><p class="muted">模型连接点下面的「保存设置」；工具、历史条数和规则点各自的「保存这个 AI 的规则」。所有 AI 都还会先读学习库的规矩（AGENTS.md）。</p>'+cards.join("")+'<div class="test-result" id="cfg-test-result"></div>'+saveBar();
 },
 apis(c){
  return '<h3>模型连接</h3><p class="muted">都是 OpenAI 兼容的 Chat Completions。每个连接各存一份 Key；Key 只保存在本机，界面拿不到它。</p>'+c.apis.map(a=>'<details class="api" open><summary><b>'+esc(a.label)+'</b><span class="muted">Key：'+esc(a.key_source)+'</span></summary>'+
   '<label>Base URL<input data-cfg-api="'+a.id+'" data-key="base_url" value="'+esc(a.base_url)+'" placeholder="https://…/v1"/></label>'+
   '<label>API Key <small>留空表示不改</small><input type="password" autocomplete="new-password" data-cfg-api="'+a.id+'" data-key="api_key" placeholder="'+(a.has_key?"已保存，不会回传":"sk-…")+'"/></label>'+
   '<div class="two"><label>请求头 <small>{session} 会换成会话 id</small><textarea rows="2" data-cfg-api="'+a.id+'" data-key="headers">'+esc(JSON.stringify(a.headers))+'</textarea></label>'+
   '<label>附加参数<textarea rows="2" data-cfg-api="'+a.id+'" data-key="extra_body">'+esc(JSON.stringify(a.extra_body))+'</textarea></label></div>'+
   button("清除本机 Key","cfg-clear-key",'data-api="'+a.id+'"',"ghost xs")+'</details>').join("")+
   '<div class="two"><label>超时（秒）<input type="number" data-cfg="timeout" value="'+esc(c.timeout)+'"/></label><label>全局 Temperature<input type="number" step="0.05" data-cfg="temperature" value="'+esc(c.temperature)+'"/></label></div>'+saveBar();
 },
 web(c){
  return '<h3>联网</h3><p class="muted">AI 有两个联网接口：搜索和读网页。什么时候查由它判断；来源列在回复下面，并记进轨迹。读网页不会访问本机和局域网地址。</p>'+
   '<label>搜索服务<select data-cfg-web="search">'+opt(c.web.search,Object.entries(c.web_backends))+'</select></label>'+
   '<label>SearXNG 地址<input data-cfg-web="searxng_url" value="'+esc(c.web.searxng_url)+'" placeholder="https://searx.example"/></label>'+
   '<div class="two"><label>Brave Key <small>'+(c.web.brave_key?"已保存":"未填")+'</small><input type="password" data-cfg-web="brave_key"/></label><label>Tavily Key <small>'+(c.web.tavily_key?"已保存":"未填")+'</small><input type="password" data-cfg-web="tavily_key"/></label></div>'+saveBar();
 },
 async run(c){
  const env=await rpc("env_info",{name:Settings.env||"default"}).catch(()=>null);
  const rows=Object.keys({...c.default_runners,...c.runners}).sort().map(ext=>'<div class="runner-row"><code>'+esc(ext)+'</code><input data-runner="'+esc(ext)+'" value="'+esc(c.runners[ext]??"")+'" placeholder="'+esc(c.default_runners[ext]||"")+'"/></div>').join("");
  return '<h3>运行</h3><label class="check"><input type="checkbox" data-cfg="agent_auto_run"'+(c.agent_auto_run?" checked":"")+'/> 允许 AI 自己运行代码和命令 <small>都在沙箱里：看不到家目录，不联网</small></label>'+
   '<label class="check"><input type="checkbox" data-cfg="auto_install"'+(c.auto_install?" checked":"")+'/> 运行时缺 Python 包就自动装进环境，再跑一次 <small>关掉以后，运行结果里会给一个「装上再运行」的按钮</small></label>'+
   '<div class="three"><label>实验笔记单格时限（秒）<input type="number" data-cfg="kernel_timeout" value="'+esc(c.kernel_timeout)+'"/></label><label>运行文件时限（秒）<input type="number" data-cfg="run_timeout" value="'+esc(c.run_timeout)+'"/></label><label>AI 命令时限（秒）<input type="number" data-cfg="shell_timeout" value="'+esc(c.shell_timeout)+'"/></label></div>'+
   '<div class="field-label">运行器 <small>每种扩展名用什么命令运行。留空用默认（灰字）；可用 {file} {dir} {stem} {out} {python}</small></div><div class="runners">'+rows+'</div>'+
   '<div class="inline"><input data-runner-new placeholder=".ext"/><input data-runner-new-cmd placeholder="程序 {file}"/>'+button("加一行","runner-add","","ghost xs")+'</div>'+
   '<h3>Python 环境</h3>'+(env?'<div class="inline"><select data-env-pick>'+opt(env.name,env.names.map(n=>[n,n]))+'</select><input data-env-new placeholder="新环境的名字"/>'+button("新建环境","env-create","","ghost xs")+'</div>'+
   '<p class="muted">'+(env.ready?"已建好":"第一次用时自动建好")+' · 定义在 '+esc(env.definition)+'。在某个目录里放一个内容是环境名的 .lattice-env 文件，那个目录下的文件就用这个环境。</p>'+
   '<label>这个环境里的包（一行一个，可以带版本）<textarea rows="6" data-env-text>'+esc(env.wanted.join("\n"))+'</textarea></label>'+
   '<div class="inline">'+button(svg("save",13)+" 保存环境定义","env-save","","ghost sm")+'<input data-env-install placeholder="现在就装：包名，空格分开"/>'+button("安装","env-install","","ghost sm")+'</div>'+
   (env.installed.length?'<details><summary class="muted">已经装了 '+env.installed.length+' 个包</summary><p class="small muted">'+env.installed.map(x=>esc(x.name+" "+x.version)).join("、")+'</p></details>':""):"")+
   '<h3>沙箱</h3><p class="'+(S.data.sandbox?.ok?"muted":"warn")+'">'+(S.data.sandbox?.ok?svg("shield",13)+" 沙箱可用（bubblewrap）。AI 的命令和运行都在里面：学习库可写，挂载的目录只读，看不到家目录的其余部分，不联网。":esc(S.data.sandbox?.why||""))+'</p>'+
   '<label>沙箱里额外可见的只读路径 <small>一行一个，比如装在家目录里的工具链</small><textarea rows="2" data-cfg="sandbox_paths">'+esc((c.sandbox_paths||[]).join("\n"))+'</textarea></label>'+saveBar();
 },
 vault(c){
  const projects=S.data.projects||[];
  return '<h3>学习库</h3><p class="muted">所有学习数据都是普通文件，放在 <code>'+esc(c.vault_path)+'</code>，它本身是一个 git 仓库，可以用任何编辑器直接改。</p>'+
   '<label>学习库的位置 <small>'+(c.env_vault?"现在由环境变量 LATTICE_VAULT 决定，这里的设置不生效":"重启 Lattice 后生效；留空就是 ~/Lattice")+'</small><input data-cfg="vault" value="'+esc(c.vault)+'" placeholder="~/Lattice"/></label>'+
   '<div class="inline">'+button(svg("folder",13)+" 在系统里打开","open-vault","","ghost sm")+button(svg("download",13)+" 导出整个学习库","export","","ghost sm")+button(svg("upload",13)+" 导入 Markdown 笔记","import-md","","ghost sm")+'</div>'+
   '<h3>挂载的目录</h3><p class="muted">你能读写，AI 只读。</p>'+projects.map(x=>'<div class="preset">'+svg("link",13)+' <b>'+esc(x.name)+'</b><span class="muted small">'+esc(x.path)+'</span><span class="grow"></span>'+button("取消挂载","project-remove",'data-id="'+esc(x.id)+'"',"ghost xs")+'</div>').join("")+
   button(svg("plus",13)+" 挂载一个目录","project-add","","ghost sm")+saveBar();
 },
 async rules(){
  const r=await rpc("rules");
  return '<h3>学习库的规矩</h3><p class="muted">学习库根目录的 AGENTS.md：目录约定、属性格式、谁能改什么。每个 AI 每一轮都先读它。</p><textarea rows="26" data-rules>'+esc(r.text)+'</textarea>'+
   '<div class="inline">'+button(svg("save",13)+" 保存规矩","rules-save","","primary sm")+button("恢复成默认的规矩","rules-reset","","ghost sm")+button("在编辑器里打开","open-file",'data-path="AGENTS.md"',"ghost sm")+'</div>';
 },
 keys(){
  const send=S.ui.send_key==="ctrl"?"Ctrl + Enter 发送，Enter 换行":"Enter 发送，Shift + Enter 换行";
  return '<h3>快捷键</h3><table class="keys">'+[["Ctrl + K","搜索或输入命令"],["Ctrl + N","写记录"],["Ctrl + S","保存"],["Ctrl + J","快答"],["Ctrl + W","关闭当前面板"],["Ctrl + B","展开或收起左栏"],["消息框",send],["Ctrl + Enter","在代码文件里：运行"],["Shift + Enter","在实验笔记里：运行当前格"],["Tab","在代码里缩进"],["Esc","关闭弹窗"]].map(([k,t])=>'<tr><td><kbd>'+esc(k)+'</kbd></td><td>'+esc(t)+'</td></tr>').join("")+'</table>'+
   '<p class="muted">发送键在「外观与交互」里改。</p>';
 },
};
const Settings={env:"default"};
function saveBar(){return '<div class="settings-save">'+button(svg("save",14)+" 保存设置","cfg-save","","primary")+'</div>';}
function collectSettings(node){
 const cfg={};
 all("[data-cfg-agent]",node).forEach(i=>{cfg.agents=cfg.agents||{};(cfg.agents[i.dataset.cfgAgent]=cfg.agents[i.dataset.cfgAgent]||{})[i.dataset.key]=i.type==="number"?(i.value===""?null:Number(i.value)):i.value;});
 all("[data-cfg-api]",node).forEach(i=>{cfg.apis=cfg.apis||{};const a=cfg.apis[i.dataset.cfgApi]=cfg.apis[i.dataset.cfgApi]||{};
  if(i.dataset.key==="headers"||i.dataset.key==="extra_body"){try{a[i.dataset.key]=JSON.parse(i.value||"{}");}catch(_){throw new Error("「"+i.dataset.cfgApi+"」的 "+i.dataset.key+" 不是合法的 JSON");}}
  else if(i.dataset.key!=="api_key"||i.value)a[i.dataset.key]=i.value;});
 all("[data-cfg-web]",node).forEach(i=>{cfg.web=cfg.web||{};if(i.type!=="password"||i.value)cfg.web[i.dataset.cfgWeb]=i.value;});
 all("[data-cfg]",node).forEach(i=>{
  const k=i.dataset.cfg;
  if(i.type==="checkbox")cfg[k]=i.checked;else if(i.type==="number")cfg[k]=Number(i.value);
  else if(k==="sandbox_paths")cfg[k]=i.value.split("\n").map(x=>x.trim()).filter(Boolean);else cfg[k]=i.value;
 });
 const runners=all("[data-runner]",node);
 if(runners.length){cfg.runners={};runners.forEach(i=>{if(i.value.trim())cfg.runners[i.dataset.runner]=i.value.trim();});}
 return cfg;
}
async function saveSettings(node){
 S.config=await rpc("settings_save",{config:collectSettings(node)});
 toast("设置已保存");refreshChats();renderSettings(node,node.querySelector(".settings").dataset.page);
}
function settingsTestResult(evt){const box=el("#cfg-test-result");const text=(evt.ok?"✓ ":"连接失败：")+evt.message;if(box)box.textContent=text;toast(text,evt.ok?"info":"error");}
async function settingsAction(kind,a){
 const node=a.closest(".panel"),page=()=>node.querySelector(".settings").dataset.page,again=()=>renderSettings(node,page());
 switch(kind){
 case "settings-page":return renderSettings(node,a.dataset.page);
 case "cfg-save":return saveSettings(node);
 case "cfg-test":await saveSettings(node);el("#cfg-test-result").textContent="正在读取模型列表…";return rpc("test_api",{agent:a.dataset.agent});
 case "cfg-clear-key":if(!confirm("清除本机保存的这个 Key？环境变量里的不受影响。"))return;await rpc("settings_save",{config:{apis:{[a.dataset.api]:{clear_key:true}}}});return again();
 case "agent-save":{
  const n=a.dataset.name,q=s=>node.querySelector(s);
  await rpc("agent_save",{name:n,history:Number(q('[data-agent-history="'+n+'"]').value),blocks:q('[data-agent-blocks="'+n+'"]').checked,
   tools:all('[data-agent-tool="'+n+'"]',node).filter(i=>i.checked).map(i=>i.value),policy:q('[data-agent-policy="'+n+'"]').value});
  await saveSettings(node);return toast("已存进学习库的 agents/"+n+".md");
 }
 case "agent-reset":if(!confirm("删掉你改写的规则，恢复成默认的？改写过的版本留在学习库的历史里。"))return;await rpc("agent_reset",{name:a.dataset.name});return again();
 case "preset-save":case "preset-overwrite":{
  const name=kind==="preset-save"?node.querySelector("[data-preset-name]").value.trim():a.dataset.name;if(!name)return toast("先给布局起个名字");
  S.ui.presets={...(S.ui.presets||{}),[name]:currentLayout()};await saveUi(true);toast("已存为布局「"+name+"」");return again();
 }
 case "preset-apply":return applyLayout(S.ui.presets[a.dataset.name]);
 case "preset-default":S.ui.default_preset=a.dataset.name||null;await saveUi(true);return again();
 case "preset-default-current":S.ui.presets={...(S.ui.presets||{}),"默认":currentLayout()};S.ui.default_preset="默认";await saveUi(true);toast("当前布局已设为默认");return again();
 case "preset-delete":if(!confirm("删除布局「"+a.dataset.name+"」？"))return;delete S.ui.presets[a.dataset.name];if(S.ui.default_preset===a.dataset.name)S.ui.default_preset=null;await saveUi(true);return again();
 case "layout-default":return applyLayout(defaultChoice());
 case "layout-factory":if(!confirm("换回出厂的布局？现在开着的面板会关掉（内容都已保存）。"))return;return applyLayout(factoryLayout());
 case "side-move":{const order=sideOrder(),i=order.indexOf(a.dataset.key);if(i>0){[order[i-1],order[i]]=[order[i],order[i-1]];S.ui.side.order=order;saveUi();renderSide();}return again();}
 case "runner-add":{const ext=node.querySelector("[data-runner-new]").value.trim(),cmd=node.querySelector("[data-runner-new-cmd]").value.trim();if(!ext||!cmd)return;
  S.config=await rpc("settings_save",{config:{runners:{...S.config.runners,[ext.startsWith(".")?ext:"."+ext]:cmd}}});return again();}
 case "env-create":{const n=node.querySelector("[data-env-new]").value.trim();if(!n)return;await rpc("env_save",{name:n,text:"ipykernel\nnumpy\nmatplotlib\n"});Settings.env=n;return again();}
 case "env-save":await rpc("env_save",{name:Settings.env,text:node.querySelector("[data-env-text]").value});toast("环境定义已保存，下次运行时环境会跟着改");return again();
 case "env-install":{const input=node.querySelector("[data-env-install]"),pkgs=input.value.split(/\s+/).filter(Boolean);if(!pkgs.length)return;await rpc("env_install",{name:Settings.env,packages:pkgs});input.value="";return toast("正在安装 "+pkgs.join("、")+"…");}
 case "rules-save":await rpc("rules_save",{text:node.querySelector("[data-rules]").value});return toast("规矩已保存，所有 AI 下一轮起照这个来");
 case "rules-reset":{if(!confirm("把 AGENTS.md 恢复成默认的？现在的版本留在学习库的历史里。"))return;const r=await rpc("rules");await rpc("rules_save",{text:r.shipped});return again();}
 }
 return null;
}
const ZOOM_KINDS=[["chat:tutor","主会话"],["chat:flash","快答"],["chat:coach","练习教练"],["file","文件"],["home","开始"],["map","知识图"],["journal","学习轨迹"],["review","回顾"],["settings","设置"]];
function settingsChange(t){
 if(t.dataset.zoomKind){const v=Math.max(60,Math.min(250,Number(t.value)||100))/100;S.ui.zoom={...(S.ui.zoom||{}),[t.dataset.zoomKind]:v};applyUi();saveUi();return true;}
 if(t.dataset.ui){const k=t.dataset.ui;S.ui[k]=t.type==="checkbox"?t.checked:t.type==="number"?Number(t.value):t.value;applyUi();saveUi();return true;}
 if(t.dataset.sideOpen!==undefined){S.ui.side.open=t.checked;saveUi();renderSide();return true;}
 if(t.dataset.sideWidth!==undefined){S.ui.side.width=Math.max(180,Math.min(560,Number(t.value)));saveUi();renderSide();return true;}
 if(t.dataset.sideShow){const k=t.dataset.sideShow,hidden=new Set(S.ui.side.hidden||[]);t.checked?hidden.delete(k):hidden.add(k);S.ui.side.hidden=[...hidden];if(!t.checked&&S.ui.side.section===k)S.ui.side.section=sideOrder()[0];saveUi();renderSide();return true;}
 if(t.dataset.envPick!==undefined){Settings.env=t.value;renderSettings(t.closest(".panel"),"run");return true;}
 if(t.dataset.cfgAgent&&t.dataset.key==="api"){const api=S.config.apis.find(x=>x.id===t.value);const m=t.closest(".agent-edit").querySelector('[data-key="model"]');if(api?.default_model&&m)m.value=api.default_model;return true;}
 return false;
}
