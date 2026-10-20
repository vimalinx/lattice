"use strict";
/* Native learning workspace; all persistent actions go through the Qt backend. */
const L = {
 filesOpen:false, data:null, notebookId:null, lessonId:null, cardView:"cards", search:"", stage:"", scope:"",
 inputs:{tutor:"",flash:"",practice:""}, practiceId:null, practiceCache:null, liveActions:{}, undone:new Set(), streams:{}, errors:{}, localBusy:new Set(), selection:"", drafts:new Map(), timers:new Map(),
 editingCard:null, editingLesson:null, permissions:[], testResult:"", scrollBottom:null,
 cardDrafts:new Map(), details:{},
};
const CARD_FIELDS=new Set(['title','stage','body','understanding','question','tags','topic']);

S.view="learning";
const stageName={suggested:"待探索",seen:"接触过",explained:"能解释",applied:"能应用"};
const stateName={connecting:"正在连接",initialised:"协议已握手",ready:"已连接",thinking:"思考中",responding:"回答中",offline:"未连接",error:"连接异常",cancelled:"已停止",max_tokens:"已达回复长度",queued:"请求已提交",starting:"启动中",busy:"执行中",restarting:"重启中"};
const relationName={prerequisite:"是其前置知识",part_of:"分解为",related:"有关联",applies_to:"应用于",contrasts:"对比"};
const lk=(topic,lane)=>topic+":"+lane;
function ld(){if(!L.data&&S.data?.learning)adoptLearning(S.data.learning);return L.data;}
function lt(){return ld()?.topics.find(t=>t.id===ld()?.active_topic);}
function activeNotebook(){const d=ld();return d?.notebooks?.find(n=>n.id===L.notebookId)||d?.notebooks?.[0]||null;}
function activeLesson(){const d=ld();return d?.lessons?.find(n=>n.id===L.lessonId)||d?.lessons?.find(n=>n.state==="current")||d?.lessons?.[0]||null;}
function adoptLearning(data){
 L.data=data;if(S.data)S.data.learning=data;
 for(const id of data.undone_actions||[])L.undone.add(id);
 if(!data.notebooks?.some(n=>n.id===L.notebookId))L.notebookId=data.notebooks?.[0]?.id||null;
 if(!data.lessons?.some(n=>n.id===L.lessonId))L.lessonId=data.lessons?.find(n=>n.state==="current")?.id||data.lessons?.[0]?.id||null;
}
async function learnRefresh(redraw=true){adoptLearning(await rpc("learn_snapshot",{topic_id:ld()?.active_topic}));if(redraw)render();}
function laneBusy(lane){return L.localBusy.has(lk(lt()?.id,lane))||(ld()?.runtime?.busy||[]).some(x=>x[0]===lt()?.id&&x[1]===lane);}
function laneStatus(lane){const key=lane==="tutor"?"tutor_session":"flash_session";const id=ld()?.threads?.[key];const api=lane==="flash"||ld()?.providers?.tutor_agent==="api";return ld()?.runtime?.agents?.[id]||(api?(lane==="flash"?ld()?.providers?.has_key:ld()?.providers?.tutor_ready)?"ready":"offline":"offline");}
function lbutton(label,action,attrs="",variant=""){return button(label,action,attrs,variant);}
/* Each navigation entry owns one page. Detail cards expand in that page only. */
const CONTENT_ROUTES={dialogue:'learning',practice:'practice',classroom:'classroom',lesson:'classroom',notebook:'notebook',flash:'flash',knowledge:'knowledge',card:'knowledge',note:'notes'};
const LEARNING_PAGES=new Set(['learning','practice','classroom','notebook','flash','knowledge','notes']);
function currentDetail(){return L.details[S.view]||null;}
async function openContent(kind,ref=null){
 const page=CONTENT_ROUTES[kind];if(!page)return;
 await flushCells();
 if(S.noteDirty)await saveNote(true);
 if(['card','note','lesson'].includes(kind)){
  if(kind==='card'&&ref!=='new'&&!visibleCards().some(c=>String(c.id)===String(ref))){L.search='';L.stage='';L.scope='';}
  if(kind==='note'){S.noteFilter='';S.noteFolder='All';}
  if(kind==='lesson'&&(ld()?.lessons||[]).some(l=>String(l.id)===String(ref)))L.lessonId=ref;
  const old=L.details[page];
  L.details[page]={kind,ref,uid:kind+':'+ref,collapsed:false};
  if(old?.ref===ref)L.details[page].uid=old.uid;
  if(kind==='note'){
   const note=S.data.notes.find(n=>String(n.id)===String(ref));
   if(note){S.note=note;S.noteId=note.id;}
  }
 }
 await go(page);
 requestAnimationFrame(()=>el('.content-detail.expanded')?.scrollIntoView({block:'nearest',behavior:'smooth'}));
}
async function toggleContent(kind,ref){
 const d=currentDetail();
 if(d?.kind===kind&&String(d.ref)===String(ref)&&!d.collapsed){
  if(S.noteDirty)await saveNote(true);
  d.collapsed=true;return render();
 }
 return openContent(kind,ref);
}
async function collapseContent(){
 if(S.noteDirty)await saveNote(true);
 const d=currentDetail();if(d)d.collapsed=true;
 render();
}
function detailCard(kind,ref,title,meta,body){
 const d=currentDetail(),expanded=d?.kind===kind&&String(d.ref)===String(ref)&&!d.collapsed;
 return '<section class="flat-item'+(expanded?' content-detail expanded':'')+'"><button class="flat-item-toggle" data-action="l-content-toggle" data-kind="'+esc(kind)+'" data-id="'+esc(ref)+'" aria-expanded="'+expanded+'">'+
 '<span><strong>'+esc(title)+'</strong><small>'+esc(meta||'')+'</small></span>'+svg(expanded?'chevrondown':'chevron',16)+'</button>'+
 (expanded?'<div class="flat-item-body">'+body(d)+'</div>':'')+'</section>';
}
function coursesPage(){
 const d=ld(),lessons=d.all_lessons||d.lessons||[];
 return '<section class="flat-page"><div class="flat-heading"><div><h1>课程</h1><p>按主题整理课程，点击展开阅读。</p></div>'+lbutton(svg('plus',14)+' 新建课程','l-lesson-new','','primary')+'</div>'+
 '<div class="flat-grid">'+(lessons.map(l=>detailCard('lesson',l.id,l.title,(d.topics.find(t=>t.id===l.topic_id)?.title||'未分类')+' · '+(l.state==='done'?'已完成':'待探索'),()=>lessonPageBody(l.id))).join('')||'<div class="learn-empty"><h3>还没有课程</h3><p>开始一段学习对话，或创建自己的第一节课程。</p>'+lbutton('开始学习对话','nav','data-view="learning"','primary')+'</div>')+'</div></section>';
}
function learningPage(){
 switch(S.view){
  case 'learning':return tutorChatView();
  case 'practice':return practicePage();
  case 'classroom':return coursesPage();
  case 'notebook':return notebookShell();
  case 'flash':return flashPanel();
  case 'knowledge':return knowledgeView();
  case 'notes':return notesView();
 }
}
function topicOptions(value,empty="所有主题"){return '<option value="">'+esc(empty)+'</option>'+(ld()?.topics||[]).map(t=>'<option value="'+esc(t.id)+'" '+(value===t.id?'selected':'')+'>'+esc((t.parent_id?'↳ ':'')+t.title)+'</option>').join('');}
function badge(stage){return '<span class="learn-stage stage-'+esc(stage)+'">'+esc(stageName[stage]||stage)+'</span>';}
function cleanReply(body){return String(body||"").replace(/```lattice[\w-]*\s*\n[\s\S]*?(?:\n```|$)/g,"").trim();}
function replyHtml(body){return markdown(cleanReply(body));}

function learningHeader(){
 const t=lt();
 const topicBar=t?'<div class="topic-bar">'+
 '<select id="learn-topic-select" aria-label="切换学习主题" class="topic-select">'+d_topics().map(x=>'<option value="'+esc(x.id)+'" '+(x.id===t.id?'selected':'')+'>'+esc((x.parent_id?'↳ ':'')+x.title)+'</option>').join('')+'</select>'+
 '<button class="icon-btn sq" data-action="l-topic-new" title="新探索主题">'+svg("plus",14)+'</button>'+
 '<button class="icon-btn sq" data-action="l-topic-branch" title="开一条兴趣分支">'+svg("git",14)+'</button>'+
 (t.parent_id?'<button class="icon-btn sq" data-action="l-topic-focus" data-id="'+esc(t.parent_id)+'" title="回到上级主线">'+svg("arrowup",14)+'</button>':'')+
 '<button class="icon-btn sq" data-action="l-topic-edit" title="编辑主题">'+svg("edit",14)+'</button>'+
 '<span class="topic-q" title="'+esc(t.question||'')+'">'+esc(t.question||(isChat()?'想聊什么都行；需要时让 AI 建一个主题':'今天你想弄明白什么？'))+'</span></div>'
 :'<div class="topic-bar"><button class="btn primary sm" data-action="l-topic-new">'+svg("plus",14)+' 开始一个探索主题</button></div>';
 return '<header class="topbar learning-topbar"><h1 class="learning-page-title">'+esc(PAGES[S.view])+'</h1>'+topicBar+
 '<div class="learn-header-tools">'+'<span class="learn-agent-chip '+(laneBusy("tutor")?'working':'')+'"><i></i> '+esc(tutorLabel())+' · '+esc(laneBusy("tutor")?'正在思考':stateName[laneStatus("tutor")]||laneStatus("tutor"))+'</span>'+
 lbutton(svg("download",15),'l-export','title="导出完整学习档案"','ghost sm')+
 lbutton(svg(S.theme==="dark"?"sun":"moon",16),"theme",'title="切换主题"',"ghost sm")+
 lbutton(svg("settings",15),'nav','data-view="settings" title="设置"','ghost sm')+'</div></header>';
}
function d_topics(){return ld()?.topics||[];}
function isChat(t=lt()){return !!t&&t.id===ld()?.chat_topic;}
function tutorLabel(){return ld()?.providers?.tutor_label||'主讲';}
function flashLabel(){return ld()?.providers?.flash_label||'快答';}
/* A card never reviewed comes due one day after it was saved. */
function isDue(c){return c.stage!=='suggested'&&(c.due_at?new Date(c.due_at)<=new Date():Date.now()-new Date(c.created_at)>=864e5);}
function lessonReading(lesson,actions=true){
 return '<div class="lesson-origin">'+(lesson.origin==='builtin'?'内置起点 · 可编辑':lesson.origin==='manual'?'你的课程笔记':'由 '+esc(lesson.origin==='tutor'?tutorLabel():'AI')+' 提议，已采纳')+'</div>'+
 '<div class="lesson-objective">'+svg("bulb",17)+'<span>'+esc(lesson.objective||'记录这个问题如何一步步变得清楚。')+'</span></div>'+
 '<div class="markdown learning-prose" id="lesson-content">'+markdown(lesson.body)+'</div>'+
 (actions?'<div class="lesson-reading-footer">'+lbutton(svg("edit",14)+' 修改内容',"l-lesson-edit","","ghost sm")+
 lbutton(lesson.state==='done'?'重新探索':svg("check",14)+' 标记这一节完成',"l-lesson-done","","ghost sm")+'</div>':'');
}
function stripAnsi(t){return String(t||"").replace(/\x1b\[[0-9;]*m/g,"");}
function outputHtml(outputs){
 return (outputs||[]).map(o=>{
  if(o.output_type==='stream')return '<pre class="nb-output-text '+(o.name==='stderr'?'nb-stderr':'')+'">'+esc(stripAnsi(Array.isArray(o.text)?o.text.join(''):o.text))+'</pre>';
  if(o.output_type==='error')return '<pre class="nb-error">'+esc(stripAnsi((o.traceback||[]).length?o.traceback.join('\n'):(o.ename+': '+o.evalue)))+'</pre>';
  const d=o.data||{};
  if(d['image/png'])return '<img class="nb-output-image" alt="Python 实验的实际绘图输出" src="data:image/png;base64,'+esc(Array.isArray(d['image/png'])?d['image/png'].join(''):d['image/png'])+'"/>';
  if(d['image/jpeg'])return '<img class="nb-output-image" alt="Python 实验输出" src="data:image/jpeg;base64,'+esc(d['image/jpeg'])+'"/>';
  if(d['text/html'])return '<div class="nb-table-output">'+DOMPurify.sanitize(Array.isArray(d['text/html'])?d['text/html'].join(''):d['text/html'],{ALLOWED_TAGS:['table','thead','tbody','tr','td','th','div','span','p','b','strong','em','br','pre','code'],ALLOWED_ATTR:['colspan','rowspan']})+'</div>';
  if(d['text/markdown'])return '<div class="markdown">'+markdown(Array.isArray(d['text/markdown'])?d['text/markdown'].join(''):d['text/markdown'])+'</div>';
  return d['text/plain']?'<pre class="nb-output-text">'+esc(Array.isArray(d['text/plain'])?d['text/plain'].join(''):d['text/plain'])+'</pre>':'';
 }).join('');
}
function filePane(){
 const files=S.projectFiles||[],projects=S.data?.projects||[];
 return '<aside class="nb-file-pane"><div class="nb-file-head">'+
 '<select id="project-select" class="field" aria-label="选择代码工作区"><option value="">选择代码工作区</option>'+projects.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===S.projectId?"selected":"")+'>'+esc(p.name)+'</option>').join('')+'</select>'+
 '<div class="nb-file-ops">'+lbutton(svg("plus",13)+' 挂载目录','add-project','','ghost sm')+(S.projectId?lbutton(svg("folder",13)+' 返回','project-up','','ghost sm'):'')+'</div>'+
 (S.projectId?'<div class="nb-file-path" title="'+esc(S.treePath||"/")+'">'+esc(S.treePath||"/")+'</div>':'')+'</div>'+
 '<div class="nb-file-tree" data-scroll="files" data-scroll-ns="'+esc(S.projectId||'')+'">'+
 (S.projectId?(files.map(f=>'<button class="tree-folder" data-action="'+esc((f.type==="dir"?"project-enter":"project-file"))+'" data-path="'+esc(f.path)+'">'+svg(f.type==="dir"?"folder":"file",15)+'<span class="truncate">'+esc(f.name)+'</span>'+(f.type==="dir"?svg("chevron",12):"")+'</button>').join('')||'<p class="learn-caption" style="padding:9px">这个目录是空的。</p>'):'<p class="learn-caption" style="padding:9px">挂载一个本地目录，就能在看笔记的同时浏览和编辑里面的代码。</p>')+
 '</div></aside>';
}
function fileEditor(){
 return '<div class="nb-file-editor"><div class="work-toolbar"><span class="path">'+esc(S.filePath)+'</span>'+
 '<div class="work-actions"><span class="subtle text-xs" id="file-dirty-status">'+(S.fileDirty?"尚未保存":"已加载")+'</span>'+
 lbutton(svg("arrow",13)+' 返回笔记','nb-file-close','','ghost sm')+
 '<button class="btn ghost sm" data-action="file-external">'+svg("external")+' 外部打开</button>'+
 '<button class="btn primary sm" data-action="file-save">'+svg("save")+' 保存文件</button></div></div>'+
 '<textarea id="project-editor" class="project-code" spellcheck="false">'+esc(S.fileContent)+'</textarea></div>';
}
/* Files and the kernel share one workspace surface, JupyterLab-style. */
function notebookShell(){
 return '<div class="notebook-layout">'+(L.filesOpen?filePane():'')+
 '<div class="nb-main">'+(L.filesOpen&&S.filePath?fileEditor():notebookView())+'</div></div>';
}
function notebookView(){
 const d=ld(),nb=activeNotebook();if(!nb)return emptyState("flask","给想法一个可以运行的地方","代码、文字和真实输出保存在同一份 Notebook。","创建实验笔记","nb-new");
 const ks=d.runtime?.notebooks?.[nb.id]?.state||'offline';
 return '<div class="notebook-workspace"><div class="notebook-toolbar"><select id="notebook-select" aria-label="选择实验笔记">'+d.notebooks.map(n=>'<option value="'+esc(n.id)+'" '+(n.id===nb.id?'selected':'')+'>'+esc(n.title)+'</option>').join('')+'</select>'+
 '<div class="notebook-actions">'+lbutton(svg("folder",14)+' 文件','nb-files','title="'+(L.filesOpen?'收起':'打开')+'代码工作区"','ghost sm')+
 lbutton(svg("plus",14),'nb-new','title="新建笔记本"','ghost sm')+
 lbutton(svg("play",14)+' 全部运行','nb-run-all','','primary sm')+
 lbutton(svg("stop",14),'nb-stop','title="中断执行"','ghost sm')+
 lbutton(svg("refresh",14),'nb-restart','title="重启内核，清空运行变量"','ghost sm')+
 lbutton(svg("download",14),'nb-export','title="导出 .ipynb"','ghost sm')+
 lbutton(svg("upload",14),'nb-import','title="导入 .ipynb"','ghost sm')+
 lbutton(svg("trash",14),'nb-remove','title="删除这份笔记本"','ghost sm')+'</div></div>'+
 '<div class="notebook-state-row"><span id="nb-kernel-state">'+svg("terminal",13)+' Python · '+esc(ks==='offline'?'尚未启动内核':stateName[ks]||ks)+'</span><span>Shift + Enter 运行当前格 · Tab 缩进</span></div>'+
 '<div class="notebook-scroll" id="notebook-scroll" data-scroll="nb" data-scroll-ns="'+esc(nb.id)+'">'+nb.cells.map(cellHtml).join('')+notebookAdd()+'<p class="notebook-disclaimer">运行会在你本机的 Python 内核中执行代码。每份笔记本独立保留变量；重启内核后，历史输出仍在，变量需重新计算。</p></div></div>';
}
function cellHtml(cell){
  const src=L.drafts.get(cell.id)?.source??cell.source;
  const stale=cell.run_source!==null&&src!==cell.run_source;
  return '<section class="notebook-cell '+cell.kind+'" data-cell="'+esc(cell.id)+'"><div class="cell-topline"><span class="cell-kind">'+svg(cell.kind==='code'?'code':'document',13)+' '+(cell.kind==='code'?'PYTHON':'MARKDOWN')+'</span>'+
 '<span class="cell-saved" id="cell-save-'+cell.id+'">'+(L.drafts.has(cell.id)?'待保存':'已保存')+'</span><span class="cell-count" id="cell-count-'+cell.id+'">'+(cell.kind==='code'?'In ['+(cell.execution_count??' ')+']':'')+'</span><div class="cell-actions">'+
 (cell.kind==='code'?lbutton(svg("play",13),'nb-run','data-id="'+esc(cell.id)+'" title="运行这一格"','ghost sm'):'')+
 lbutton(svg("arrowup",13),'nb-move','data-id="'+esc(cell.id)+'" data-direction="-1" title="上移"','ghost sm')+
 lbutton('↓','nb-move','data-id="'+esc(cell.id)+'" data-direction="1" title="下移"','ghost sm')+
 lbutton(svg("clock",13),'nb-history','data-id="'+esc(cell.id)+'" title="运行历史与当时的源码"','ghost sm')+
 lbutton(svg("trash",13),'nb-delete','data-id="'+esc(cell.id)+'" title="删除单元格"','ghost sm')+'</div></div>'+
 '<textarea aria-label="'+esc((cell.kind==='code'?'Python 代码':'Markdown 笔记'))+'" class="cell-editor '+(cell.kind==='code'?'code-editor':'')+'" data-cell-editor="'+esc(cell.id)+'" spellcheck="false" rows="'+esc(Math.max(3,Math.min(20,src.split('\n').length+1)))+'">'+esc(src)+'</textarea>'+
 (cell.kind==='markdown'?'<div class="markdown cell-markdown-preview" id="md-preview-'+cell.id+'">'+markdown(src)+'</div>':'')+
 '<div class="cell-output" id="cell-output-'+cell.id+'">'+outputHtml(cell.outputs)+'</div>'+
 '<div class="cell-stale '+(stale?'visible':'')+'" id="cell-stale-'+cell.id+'">代码已修改：上方输出属于之前的运行，重新执行后更新。</div></section>';
 }
function notebookAdd(){
 return '<div class="notebook-add">'+lbutton(svg("plus",14)+' Python 单元格','nb-add','data-kind="code"','ghost')+lbutton(svg("plus",14)+' 文字与观察','nb-add','data-kind="markdown"','ghost')+'</div>';
}
/* Practice branch: the coach on the left, the learner's own notebook on the right. */
function practiceLabel(){return ld()?.providers?.practice_label||'练习教练';}
function shownPractice(){
 const cur=ld()?.practice;
 if(cur&&(!L.practiceId||L.practiceId===cur.id))return cur;
 const p=L.practiceCache;
 return p&&p.id===L.practiceId&&p.topic_id===lt()?.id?p:null;
}
function insightList(items,resolvable){
 if(!items.length)return '';
 return '<ul class="insight-list">'+items.map(i=>'<li class="insight-'+esc(i.kind)+(i.state==='resolved'?' resolved':'')+'"><div><strong>'+esc(i.title)+'</strong>'+(i.detail?'<p>'+esc(i.detail)+'</p>':'')+'</div>'+
 (resolvable&&i.kind==='weak'&&i.state==='active'?lbutton('已克服','l-insight-resolve','data-id="'+esc(i.id)+'" title="不再提醒主讲关注这一点"','ghost sm'):i.state==='resolved'?'<small>已克服</small>':'')+'</li>').join('')+'</ul>';
}
function practiceHome(){
 const d=ld(),weak=(d.insights||[]).filter(i=>i.kind==='weak'&&i.state==='active'),past=(d.practices||[]).filter(p=>p.state==='done');
 return '<section class="flat-page practice-home"><div class="flat-heading"><div><h1>练习</h1><p>主讲讲完一段能动手的内容后，点那条回复下的「开始练习」。'+esc(practiceLabel())+' 会在左边一步步带你写，右边是你自己的实验笔记，代码在本机 Jupyter 里真实运行。结束练习后，主讲会读完整记录复盘，记下你的薄弱点，并决定接下来怎么讲。</p></div>'+lbutton(svg('bot',14)+' 回到学习对话','nav','data-view="learning"','primary')+'</div>'+
 '<div class="practice-home-grid"><section class="practice-panel"><h3>'+svg('bulb',15)+' 主讲正在留意的薄弱点</h3>'+(weak.length?insightList(weak,true):'<p class="learn-caption">还没有。完成一次练习并复盘后，这里会出现主讲发现的薄弱点；主讲、快答和练习教练每一轮都会参考它们。</p>')+'</section>'+
 '<section class="practice-panel"><h3>'+svg('history',15)+' 做过的练习</h3>'+(past.length?past.map(p=>'<button class="practice-row" data-action="l-practice-open" data-id="'+esc(p.id)+'"><strong>'+esc(p.title)+'</strong><small>'+esc(fmtDate(p.ended_at||p.created_at,true))+(p.next_focus?' · 接下来：'+shorten(p.next_focus,60):'')+'</small></button>').join(''):'<p class="learn-caption">还没有做完的练习。</p>')+'</section></div></section>';
}
function practiceSide(p){
 if(p.state==='active')return composer('practice');
 if(p.state==='reviewing')return '<div class="practice-review-note">'+(laneBusy('tutor')?'<span class="learn-thinking"><span></span><span></span><span></span></span> '+esc(tutorLabel())+' 正在读这次练习的完整记录并复盘。复盘会出现在学习对话里。':'复盘还没有完成。')+
 '<div>'+(laneBusy('tutor')?lbutton(svg('bot',14)+' 去学习对话看复盘','nav','data-view="learning"','ghost sm'):lbutton('重新复盘','l-practice-end','data-id="'+esc(p.id)+'"','primary sm'))+'</div></div>';
 const weak=p.insights.filter(i=>i.kind==='weak'),strong=p.insights.filter(i=>i.kind==='strength');
 return '<div class="practice-review-note done"><h3>主讲的复盘</h3>'+(p.next_focus?'<p><b>接下来的讲解重点：</b>'+esc(p.next_focus)+'</p>':'')+
 (weak.length?'<h4>薄弱点</h4>'+insightList(weak,true):'')+(strong.length?'<h4>做得好的地方</h4>'+insightList(strong,false):'')+
 '<div>'+lbutton(svg('bot',14)+' 回到学习对话','nav','data-view="learning"','primary sm')+(L.practiceId?lbutton('返回练习列表','l-practice-close','','ghost sm'):'')+'</div></div>';
}
function practicePage(){
 const p=shownPractice();if(!p)return practiceHome();
 const d=ld(),nb=d.notebooks.find(n=>n.id===p.notebook_id);
 if(nb)L.notebookId=nb.id;
 const ks=nb?d.runtime?.notebooks?.[nb.id]?.state||'offline':'offline',active=p.state==='active';
 return '<div class="practice-layout"><section class="practice-coach"><div class="tutor-dialogue-tools"><span>'+svg('code',15)+' '+esc(p.title)+' · '+esc({active:'练习中',reviewing:'复盘中',done:'已复盘'}[p.state]||p.state)+'</span>'+
 (active?lbutton('看看我的代码','l-practice-task','data-task="check"','ghost sm')+lbutton('给点提示','l-practice-task','data-task="hint"','ghost sm')+lbutton(svg('check',14)+' 结束练习并复盘','l-practice-end','data-id="'+esc(p.id)+'"','primary sm'):'')+'</div>'+
 '<details class="practice-seed"><summary>这次练习依据的讲解</summary><div class="markdown">'+replyHtml(p.seed)+'</div></details>'+
 '<div class="learn-chat-scroll" id="learn-chat-practice" data-scroll="chat-practice" data-scroll-ns="'+esc(p.id)+'">'+conversationHtml('practice')+'</div>'+practiceSide(p)+'</section>'+
 '<section class="practice-code">'+(nb?'<div class="notebook-workspace"><div class="notebook-toolbar"><strong class="practice-nb-title">'+esc(nb.title)+'</strong><div class="notebook-actions">'+
 lbutton(svg("play",14)+' 全部运行','nb-run-all','','primary sm')+lbutton(svg("stop",14),'nb-stop','title="中断执行"','ghost sm')+lbutton(svg("refresh",14),'nb-restart','title="重启内核，清空运行变量"','ghost sm')+'</div></div>'+
 '<div class="notebook-state-row"><span id="nb-kernel-state">'+svg("terminal",13)+' Python · '+esc(ks==='offline'?'尚未启动内核':stateName[ks]||ks)+'</span><span>Shift + Enter 运行当前格 · 写完点「看看我的代码」</span></div>'+
 '<div class="notebook-scroll" id="notebook-scroll" data-scroll="nb" data-scroll-ns="'+esc(nb.id)+'">'+(nb.cells.length?nb.cells.map(cellHtml).join(''):'<p class="learn-caption practice-empty">教练给出的骨架代码可以点代码块上的「放到右侧」，也可以自己新建单元格。</p>')+notebookAdd()+'</div></div>':emptyState('flask','这次练习的笔记本已被删除','练习对话仍然保留。'))+'</section></div>';
}
/* Each thing an agent did shows as one line with view and undo. */
function actionChips(actions,live=false){
 if(!actions?.length)return '';
 return '<div class="agent-actions">'+actions.map(a=>'<div class="agent-action'+(a.undone?' undone':'')+'">'+svg(live?'spark':'check',12)+'<span>'+esc(a.summary)+'</span>'+
 (a.ref&&!a.undone?(a.ref.startsWith('handoff:')?lbutton('请主讲接住','l-handoff','','ghost sm'):lbutton('查看','l-ref-open','data-ref="'+esc(a.ref)+'"','ghost sm')):'')+
 (a.undoable&&!a.undone?lbutton('撤销','l-action-undo','data-id="'+esc(a.id)+'"','ghost sm'):a.undone?'<small>已撤销</small>':'')+'</div>').join('')+'</div>';
}
const convCache={};
const laneWho=lane=>({tutor:tutorLabel()+' · 主讲',flash:flashLabel()+' · 快答',practice:practiceLabel()+' · 练习教练'})[lane];
// Saved messages are cached apart from the live tail, so a streamed chunk only
// re-renders the reply being written, not the whole conversation.
function messagesHtml(lane){
 const d=ld(),messages=lane==='tutor'?d.tutor_messages:lane==='flash'?d.flash_messages:shownPractice()?.messages||[];
 const last=messages?.[messages.length-1];
 const ck=(lt()?.id||'')+'|'+L.undone.size+'|'+(lane==='practice'?shownPractice()?.id||'':'')+'|'+(messages?.length||0)+'|'+(last?.id||'')+'|'+(last?.meta||'')+'|'+tutorLabel()+'|'+flashLabel();
 if(convCache[lane]?.key===ck)return convCache[lane].html;
 const who=laneWho(lane);
 const html=(messages||[]).map(m=>{
  let meta={};try{meta=JSON.parse(m.meta||'{}');}catch(_){}
  const incomplete=m.role==='assistant'&&meta.stop_reason&&meta.stop_reason!=='end_turn';
  return '<div class="learn-message '+(m.role==='user'?'from-user':'from-ai')+'"><div class="learn-message-meta"><span>'+esc(m.role==='user'?'你':who)+'</span><time>'+esc(fmtDate(m.created_at,true))+'</time></div>'+
  '<div class="markdown learn-message-content">'+wrapCodeBlocks(m.role==='user'?markdown(m.content):replyHtml(m.content))+'</div>'+
  actionChips((meta.actions||[]).map(a=>({...a,undone:L.undone.has(a.id)||a.undone})))+
  (incomplete?'<div class="answer-incomplete">'+esc(meta.stop_reason==='cancelled'?'已停止 · 保留部分回答':meta.stop_reason==='max_tokens'?'达到回复长度限制':'未正常完成 · 仅保留已收到内容')+'</div>':'')+
  (m.role==='assistant'&&lane!=='practice'?'<div class="learn-message-actions">'+lbutton(svg("book",12)+' 存为卡片','l-message-card','data-lane="'+esc(lane)+'" data-id="'+esc(m.id)+'"','ghost sm')+
  (lane==='tutor'&&/```(?:python|py)\s*\n/.test(m.content)?lbutton(svg("flask",12)+' 加入实验','l-message-code','data-id="'+esc(m.id)+'"','ghost sm'):'')+
  (lane==='tutor'?lbutton(svg("code",12)+' 开始练习','l-practice-start','data-id="'+esc(m.id)+'" title="进入练习分支，由练习教练带着一步步写代码"','ghost sm'):'')+
  (lane==='flash'?lbutton('交给主讲深入讲','l-escalate','data-id="'+esc(m.id)+'"','ghost sm'):'')+'</div>':'')+'</div>';
 }).join('');
 convCache[lane]={key:ck,html};
 return html;
}
function conversationHtml(lane){
 const key=lk(lt()?.id,lane),stream=L.streams[key]||'';
 let html=messagesHtml(lane);
 const live=L.liveActions[key]||[];
 if(stream||live.length)html+='<div class="learn-message from-ai streaming"><div class="learn-message-meta"><span>'+esc(laneWho(lane))+'</span><span>正在回答</span></div><div class="markdown">'+wrapCodeBlocks(replyHtml(stream))+'</div><div class="live-actions">'+actionChips(live,true)+'</div></div>';
 else if(laneBusy(lane))html+='<div class="learn-thinking"><span></span><span></span><span></span><b>'+esc(lane==='tutor'?'正在组织这个问题的下一步…':'正在解释…')+'</b></div>';
 if(L.errors[key])html+='<div class="learn-inline-error">'+esc(L.errors[key])+'</div>';
 return html;
}
function tutorChatView(){
 const messages=ld()?.tutor_messages||[];
 return '<div class="tutor-dialogue"><div class="tutor-dialogue-tools"><span>'+svg("bot",15)+' 主讲负责：讲清机制、安排实验、串联知识</span>'+(ld()?.providers?.tutor_agent==='api'?'':lbutton(svg("link",14)+' 连接 ACP','l-connect','','ghost sm'))+
 lbutton(svg("plus",14)+' 新会话','l-tutor-new','','ghost sm')+lbutton(svg("book",14)+' 提炼知识卡','l-tutor-task','data-task="capture"','ghost sm')+'</div><div class="learn-chat-scroll" id="learn-chat-tutor" data-scroll="chat-tutor" data-scroll-ns="'+esc(lt()?.id||'')+'">'+
 (messages.length||laneBusy('tutor')?conversationHtml('tutor'):isChat()?'<div class="tutor-welcome"><div class="learn-empty-icon">'+svg("spark",30)+'</div><h2>想到什么，直接说。</h2><p>'+esc(tutorLabel())+' 会跟着你的话题走，需要时去查你以前学过的内容。想把某段讨论单独整理成一个主题时，直接告诉它。</p></div>':'<div class="tutor-welcome"><div class="learn-empty-icon">'+svg("spark",30)+'</div><h2>不是从目录开始，<br>是从你想知道的事开始。</h2><p>'+esc(tutorLabel())+' 会参考当前课程、实验输出、快答讨论和知识卡。你不需要每次重新说明自己学到了哪里。</p><div>'+lbutton('为当前兴趣规划起点','l-tutor-task','data-task="plan"','primary')+'</div></div>')+
 '</div>'+composer('tutor')+'</div>';
}
function composer(lane){
 const busy=laneBusy(lane),ready=!!lt()&&({flash:ld()?.providers?.has_key,tutor:ld()?.providers?.tutor_ready,practice:ld()?.providers?.practice_ready&&shownPractice()?.state==='active'})[lane];
 const hint={flash:'这个词是什么意思？这行代码为什么这样写？',tutor:'告诉 '+tutorLabel()+'：你观察到了什么，又想继续追问什么？',practice:'说说你的想法、预测，或者哪里卡住了'}[lane];
 return '<div class="learn-composer '+lane+'"><textarea id="learn-input-'+lane+'" rows="'+esc((lane==='flash'?3:2))+'" placeholder="'+esc(hint)+'" aria-label="'+esc({flash:'快速答疑问题',tutor:'主讲问题',practice:'对练习教练说'}[lane])+'" '+(lt()?'':'disabled')+'>'+esc(L.inputs[lane])+'</textarea>'+
 '<div class="composer-bottom"><span>'+({flash:'当前主题与选中内容会随问题传入',tutor:'Ctrl + Enter 发送 · AI 做的改动都能在对话里撤销',practice:'Ctrl + Enter 发送 · 教练会看到右侧代码的真实输出'})[lane]+'</span>'+
 (busy?lbutton(svg("stop",14)+' 停止','l-cancel','data-lane="'+esc(lane)+'"','ghost sm'):lbutton(svg("arrowup",15)+(lane==='flash'?' 提问':' 发送'),'l-send','data-lane="'+esc(lane)+'" '+(!ready?'disabled':''),'primary sm'))+'</div></div>';
}
function flashPanel(){
 const d=ld(),config=d?.providers||{};
 return '<aside class="flash-panel"><div class="flash-heading"><div class="flash-avatar">'+svg("spark",20)+'</div><div><h3>随问随答</h3><p>'+esc(flashLabel())+' · 基础知识与即时解释</p></div>'+lbutton(svg("settings",15),'nav','data-view="settings" title="配置快答模型"','ghost sm')+'</div>'+
 '<div class="flash-status"><i class="'+esc((config.has_key?'configured':''))+'"></i>'+esc(config.has_key?(laneBusy('flash')?'正在回答':config.flash_model+' · 已配置'):'API 尚未接入')+'<span>FAST LANE</span></div>'+
 '<div class="flash-selection '+(L.selection?'has-selection':'')+'" id="flash-selection">'+selectionHtml()+'</div>'+
 '<div class="learn-chat-scroll flash-chat" id="learn-chat-flash" data-scroll="chat-flash" data-scroll-ns="'+esc(lt()?.id||'')+'">'+(d?.flash_messages?.length||laneBusy('flash')?conversationHtml('flash'):
 '<div class="flash-welcome"><div class="flash-decor">'+svg("quote",28)+'</div><h4>小问题，不必打断大思路。</h4><p>选中课堂里的词语或代码，再在这里提问。主讲下一次会看到这段答疑。</p>'+
 (config.has_key?'<div class="flash-prompt-list">'+lbutton('用一个生活中的例子解释','l-quick-question','data-question="请用一个生活中的例子解释当前选中内容；没有选中内容时解释本节最核心的概念。"','ghost sm')+
 lbutton('这行 Python 怎么读？','l-quick-question','data-question="请解释选中这段 Python 的每个符号和执行顺序；没有选中内容时先说明当前实验的第一行。"','ghost sm')+'</div>':
 '<div class="flash-config-note"><span>'+svg("link",15)+' 留好了 OpenAI 兼容接口</span><p>填写 Base URL、模型名和 Key 后即可使用，也可以接入你的 LocalRouter。</p>'+lbutton('设置 API 连接 '+svg("arrow",13),'nav','data-view="settings"','primary sm')+'</div>')+'</div>')+'</div>'+composer('flash')+
 '<div class="flash-footnote">快答与主讲独立运行 · 记录在本机共享</div></aside>';
}
function selectionHtml(){return L.selection?'<div><span>已选中 · '+L.selection.length+' 字符</span>'+lbutton(svg("close",12),'l-clear-selection','','ghost sm')+'</div><pre>'+esc(shorten(L.selection,200))+'</pre>'+lbutton('解释选中内容','l-explain-selection','','ghost sm'):'<span>'+svg("eye",13)+' 选中文字或代码，带着上下文提问</span>';}
function proposalRibbon(){
 const pending=(ld()?.proposals||[]).filter(p=>p.state==='pending');
 if(!pending.length)return '';
 return '<div class="proposal-ribbon"><div><span class="proposal-dot"></span><strong>'+pending.length+' 份教学建议待采纳</strong><span>'+esc(shorten(pending[0].payload.summary,55))+'</span></div>'+lbutton('预览并采纳 '+svg("arrow",14),'l-proposals','','primary sm')+'</div>';
}
function visibleCards(){
 const q=L.search.trim().toLocaleLowerCase();
 return (ld()?.cards||[]).filter(c=>(!L.stage||c.stage===L.stage)&&(!L.scope||c.topic_id===L.scope)&&(!q||[c.title,c.body,c.understanding,c.question,...c.tags].join(' ').toLocaleLowerCase().includes(q)));
}
function knowledgeView(){
 const d=ld(),cards=visibleCards(),due=d.cards.filter(isDue);
 return '<section class="knowledge-workspace"><div class="knowledge-heading"><div class="learn-title-row"><h1>知识卡</h1>'+lbutton(svg("plus",14)+' 知识卡','l-card-new','','primary sm')+'</div><p class="learn-question">'+d.stats.cards+' 张知识卡 · '+d.relations.length+' 条关联 · '+d.stats.evidence+' 条学习证据。关系图与笔记一起放在「知识网络」里。</p></div>'+
 '<div class="knowledge-toolbar"><div class="knowledge-view-tabs">'+[['cards','卡片'],['tree','知识树']].map(([v,t])=>'<button data-action="l-card-view" data-mode="'+esc(v)+'" class="'+esc((L.cardView===v?'active':''))+'">'+t+'</button>').join('')+'<button data-action="nav" data-view="graph" title="在知识网络中查看卡片、笔记与它们的连接">知识网络 '+svg('arrow',12)+'</button></div>'+
 '<input id="knowledge-search" value="'+esc(L.search)+'" placeholder="搜索概念、自己的理解…" aria-label="搜索知识卡"/>'+
 '<select id="knowledge-stage" aria-label="按理解阶段筛选"><option value="">所有阶段</option>'+Object.entries(stageName).map(([v,t])=>'<option value="'+esc(v)+'" '+(L.stage===v?'selected':'')+'>'+t+'</option>').join('')+'</select>'+
 '<select id="knowledge-topic" aria-label="按主题筛选">'+topicOptions(L.scope)+'</select></div>'+
 '<div class="knowledge-body" id="knowledge-body" data-scroll="kbody" data-scroll-ns="'+esc(L.cardView)+'">'+knowledgeBody(cards)+'</div>'+
 '<footer class="knowledge-footer"><span>理解阶段由你确认；实验和自述作为证据保留。</span>'+lbutton(svg("history",14)+' 回顾 '+due.length+' 张卡','l-review-next','','ghost sm')+
 lbutton(svg("link",14)+' 建立关系','l-relation-new','','ghost sm')+'</footer></section>';
}
function knowledgeBody(cards){
 if(!cards.length&&currentDetail()?.ref!=='new')return '<div class="learn-empty"><h3>这里还没有符合条件的知识卡。</h3><p>你可以新建一张，或在主讲对话中提炼已经讨论过的概念。</p></div>';
 if(L.cardView==='tree')return knowledgeTree(cards)+knowledgeDetail();
 const current=currentDetail();
 return '<div class="flat-grid knowledge-grid">'+
 (current?.ref==='new'?detailCard('card','new','新知识卡','填写后保存',cardPageBody):'')+
 cards.map(c=>detailCard('card',c.id,c.title,stageName[c.stage]+' · '+c.evidence.length+' 条学习证据',cardPageBody)).join('')+'</div>';

}
function knowledgeDetail(){
 const d=currentDetail();if(d?.kind!=='card'||d.collapsed)return '';
 const c=ld().cards.find(c=>String(c.id)===String(d.ref));
 return detailCard('card',d.ref,c?.title||'新知识卡',c?stageName[c.stage]:'填写后保存',cardPageBody);
}
function knowledgeTree(cards){
 const ids=new Set(cards.map(c=>c.id)),byId=Object.fromEntries(cards.map(c=>[c.id,c]));
 const edges=ld().relations.filter(r=>['prerequisite','part_of'].includes(r.kind)&&ids.has(r.source)&&ids.has(r.target));
 const parents=new Set(edges.map(r=>r.target)),visited=new Set();
 function node(card,level=0,relation=''){
  const shared=visited.has(card.id);visited.add(card.id);
  const children=shared?[]:edges.filter(e=>e.source===card.id).map(e=>[byId[e.target],e.kind]);
  const row='<button class="knowledge-tree-row" data-action="l-card-open" data-id="'+esc(card.id)+'">'+svg('book',15)+'<strong>'+esc(card.title)+'</strong>'+badge(card.stage)+'<small>'+esc(shared?'共享节点':relation?relationName[relation]:'起点')+'</small></button>';
  return children.length?'<details class="knowledge-tree-group" open><summary>'+row+'</summary><div class="knowledge-tree-children">'+children.map(([c,k])=>node(c,level+1,k)).join('')+'</div></details>':'<div class="knowledge-tree-leaf">'+row+'</div>';
 }
 let html=cards.filter(c=>!parents.has(c.id)).map(c=>node(c)).join('');
 html+=cards.filter(c=>!visited.has(c.id)).map(c=>node(c)).join('');
 return '<div class="knowledge-tree"><p class="learn-caption">从前置知识和整体—部分关系展开。共享概念会出现在多个学习路径里。</p>'+html+'</div>';
}
const relationShort={prerequisite:"前置",part_of:"分解",related:"关联",applies_to:"应用",contrasts:"对比"};
const stageColor={suggested:"#5b6675",seen:"#e0be88",explained:"#b5a8fa",applied:"#83e2c7"};
function apiOptions(selected){return (ld().providers.apis||[]).map(a=>'<option value="'+esc(a.id)+'" '+(a.id===selected?'selected':'')+'>'+esc(a.label)+(a.has_key?'':' · 未填 Key')+'</option>').join('');}
function laneFields(lane,c){
 return '<label>API 连接<select class="field" id="cfg-'+lane+'-api" data-lane="'+lane+'">'+apiOptions(c[lane+'_api'])+'</select></label>'+
 '<label>模型名 <span class="learn-caption">换连接时会填入它的常用模型</span><input class="field" id="cfg-'+lane+'-model" value="'+esc(c[lane+'_model'])+'" placeholder="填写网关实际支持的模型 ID"/></label>'+
 '<label>回复上限 <span class="learn-caption">思考内容也计入这个上限</span><input class="field" type="number" id="cfg-'+lane+'-tokens" min="256" max="64000" value="'+esc(c[lane+'_max_tokens'])+'"/></label>'+
 '<div class="connection-buttons">'+lbutton('保存并测试','l-test-api','data-lane="'+lane+'"','primary sm')+'</div>';
}
function apiBlock(a){
 return '<details class="api-connection" '+([ld().providers.flash_api,ld().providers.tutor_api].includes(a.id)?'open':'')+'><summary><b>'+esc(a.label)+'</b><span class="learn-caption">'+esc(a.base_url||'尚未填写地址')+' · Key：'+esc(a.key_source)+'</span></summary>'+
 '<label>Base URL<input class="field" id="cfg-api-'+a.id+'-base" value="'+esc(a.base_url)+'" placeholder="https://…/v1"/></label>'+
 '<label>API Key <span class="learn-caption">留空不改现有 Key</span><input type="password" autocomplete="new-password" class="field" id="cfg-api-'+a.id+'-key" placeholder="'+esc((a.has_key?'已保存，后端不回传密钥':'sk-…'))+'"/></label>'+
 '<div class="connection-inline"><label>请求头 <span class="learn-caption">{session} 会换成会话 ID</span><textarea class="field config-json" rows="2" id="cfg-api-'+a.id+'-headers">'+esc(JSON.stringify(a.headers))+'</textarea></label>'+
 '<label>附加参数 <span class="learn-caption">网关不支持时改为 {}</span><textarea class="field config-json" rows="2" id="cfg-api-'+a.id+'-extra">'+esc(JSON.stringify(a.extra_body))+'</textarea></label></div>'+
 '<div class="connection-buttons">'+lbutton('清除本机 Key','l-clear-key','data-api="'+esc(a.id)+'"','ghost sm')+'</div></details>';
}
function connectionsBody(){
 const c=ld().providers,acp=c.acp_agents||[];
 return '<div class="connection-page">'+
 '<div class="connection-grid"><section class="connection-card"><div class="connection-title"><span class="connection-symbol">'+svg("spark",22)+'</span><div><h2>快答</h2><p>'+esc(c.flash_label)+' · OpenAI 兼容 Chat Completions / SSE</p></div><span class="learn-stage">'+esc(c.has_key?'已保存凭据':'等待接入')+'</span></div>'+
 laneFields('flash',c)+'<p class="connection-foot">测试只读取模型列表，不生成回答。</p></section>'+
 '<section class="connection-card"><div class="connection-title"><span class="connection-symbol">'+svg("code",22)+'</span><div><h2>练习教练</h2><p>'+esc(c.practice_label)+' · 在练习分支里一步步带你写代码</p></div><span class="learn-stage">'+esc(c.practice_ready?'已保存凭据':'等待接入')+'</span></div>'+
 laneFields('practice',c)+'<p class="connection-foot">每轮发送练习规则、练习依据的讲解、右侧笔记本的代码与真实输出，以及最近 40 条练习对话。</p></section>'+
 '<section class="connection-card"><div class="connection-title"><span class="connection-symbol codex">'+svg("bot",22)+'</span><div><h2>主讲</h2><p>'+esc(c.tutor_label)+'</p></div><span class="learn-stage">'+esc(c.tutor_agent==='api'?(c.tutor_ready?'已保存凭据':'等待接入'):acp.find(a=>a.id===c.tutor_agent)?.installed?'适配器已安装':'路径待配置')+'</span></div>'+
 '<label>主讲方式<select class="field" id="cfg-tutor-agent"><option value="api" '+(c.tutor_agent==='api'?'selected':'')+'>OpenAI 兼容 API</option>'+acp.map(a=>'<option value="'+esc(a.id)+'" '+(c.tutor_agent===a.id?'selected':'')+'>'+esc(a.label)+' · ACP'+(a.installed?'':' · 未安装')+'</option>').join('')+'</select></label>'+
 '<div class="agent-fields" data-agent="api"'+(c.tutor_agent==='api'?'':' hidden')+'>'+laneFields('tutor',c)+'<p class="connection-foot">每轮发送教学规则、学习状态和最近 24 条主讲对话。</p></div>'+
 '<div class="agent-fields" data-agent="codex"'+(c.tutor_agent==='codex'?'':' hidden')+'>'+
 '<label>ACP 可执行文件<input class="field config-path" id="cfg-codex" value="'+esc(c.codex_command)+'"/></label>'+
 '<label>启动参数 <span class="learn-caption">JSON 字符串数组，不经 Shell 执行</span><input class="field config-json" id="cfg-codex-args" value="'+esc(JSON.stringify(c.codex_args))+'"/></label>'+
 '<label>Codex 模型 <span class="learn-caption">留空沿用当前 Codex 默认值</span><input class="field" id="cfg-codex-model" value="'+esc(c.codex_model)+'" placeholder="沿用 Codex 默认模型"/></label>'+
 '<label>推理强度<select class="field" id="cfg-effort">'+['','low','medium','high','xhigh'].map(e=>'<option value="'+esc(e)+'" '+(c.codex_effort===e?'selected':'')+'>'+esc(e||'沿用默认')+'</option>').join('')+'</select></label></div>'+
 '<div class="agent-fields" data-agent="devin"'+(c.tutor_agent==='devin'?'':' hidden')+'>'+
 '<label>Devin 可执行文件<input class="field config-path" id="cfg-devin" value="'+esc(c.devin_command)+'"/></label>'+
 '<label>Devin 模型 <span class="learn-caption">以 --model 传入 devin acp</span><input class="field" id="cfg-devin-model" value="'+esc(c.devin_model)+'"/></label></div>'+
 '<div class="agent-fields" data-agent="custom"'+(c.tutor_agent==='custom'?'':' hidden')+'>'+
 '<label>ACP 可执行文件 <span class="learn-caption">任何实现了 ACP 协议的 Agent</span><input class="field config-path" id="cfg-custom" value="'+esc(c.custom_command)+'" placeholder="/path/to/agent-acp"/></label>'+
 '<label>启动参数 <span class="learn-caption">JSON 字符串数组，不经 Shell 执行</span><input class="field config-json" id="cfg-custom-args" value="'+esc(JSON.stringify(c.custom_args))+'"/></label></div>'+
 '<div class="agent-fields" data-agent="acp"'+(c.tutor_agent==='api'?' hidden':'')+'><div class="connection-buttons">'+lbutton('保存并连接 ACP','l-test-codex','','primary sm')+'</div><p class="connection-foot">登录凭据由所选 Agent 自行管理。支持会话恢复、流式回复、停止与权限确认。模型设置在新连接 / 新会话生效。</p></div></section></div>'+
 '<section class="connection-card api-connections"><div class="connection-title"><span class="connection-symbol">'+svg("link",22)+'</span><div><h2>API 连接</h2><p>每个连接各存一份 Key，快答和主讲可以选同一个</p></div></div>'+
 (c.apis||[]).map(apiBlock).join('')+
 '<div class="connection-inline"><label>超时 / 秒<input class="field" type="number" id="cfg-timeout" min="5" max="600" value="'+esc(c.timeout)+'"/></label><label>Temperature<input class="field" type="number" step="0.05" id="cfg-temperature" min="0" max="2" value="'+esc(c.temperature)+'"/></label></div>'+
 '<p class="connection-foot">密钥保存在本机 0600 权限文件中，不进入学习档案导出。也可以用环境变量提供 Key。</p>'+
 '<div class="kernel-settings"><h3>'+svg("terminal",16)+' 本地 Jupyter 内核</h3><div class="connection-inline"><label>Kernel 名称<input class="field" id="cfg-kernel" value="'+esc(c.kernel_name)+'"/></label><label>单格时限 / 秒<input class="field" type="number" id="cfg-kernel-timeout" min="3" max="3600" value="'+esc(c.kernel_timeout)+'"/></label></div>'+
 '<label class="connection-check"><input type="checkbox" id="cfg-auto-run" '+(c.agent_auto_run?'checked':'')+'/> 允许 AI 自己运行实验笔记里的代码并读取结果 <span class="learn-caption">代码以你的用户权限在本机运行，不是沙箱</span></label></div></section>'+
 '<div class="connection-save-row"><div class="connection-test-result" id="connection-test-result">'+esc(L.testResult||'尚未执行连接测试。其他本地功能不依赖 API 配置。')+'</div>'+lbutton(svg("save",15)+' 保存全部设置','l-settings-save','','primary')+'</div>'+
 '<section class="connection-data"><div><h3>可以带走的学习档案</h3><p>SQLite 全量记录、知识卡 Markdown、关系 JSON 和标准 .ipynb。API Key 与 Codex 凭据不包含在内。</p></div>'+lbutton(svg("download",15)+' 导出学习档案','l-export','','ghost')+'</section></div>';
}
function fitCodeEditors(){all('.cell-editor').forEach(t=>{t.style.height='auto';t.style.height=Math.max(74,Math.min(560,t.scrollHeight))+'px';});}
/* Chat code blocks get a title bar with copy / run-into-notebook actions. */
let snippetSeq=0;
function wrapCodeBlocks(html){
 return html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g,(m,attrs,code)=>{
  const lang=(attrs.match(/language-(\w+)/)||[])[1]||'code',id='snip'+(++snippetSeq);
  return '<div class="code-block"><div class="code-block-bar"><span>'+esc(lang)+'</span>'+
  '<button data-action="l-code-copy" data-target="'+esc(id)+'" title="复制代码">'+svg("copy",11)+'</button>'+
  (S.view==='practice'?'<button data-action="l-code-run" data-target="'+esc(id)+'" title="作为新单元格放到右侧笔记本，不会自动运行">'+svg("arrow",11)+' 放到右侧</button>':'<button data-action="l-code-run" data-target="'+esc(id)+'" title="放进实验笔记并用本机 Jupyter 运行">'+svg("play",11)+' 运行</button>')+'</div>'+
  '<pre><code id="'+esc(id)+'"'+attrs+'>'+code+'</code></pre></div>';
 });
}
/* Floating "ask about this" chip that follows text selection. */
let selPopEl=null;
function hideSelPop(){if(selPopEl){selPopEl.remove();selPopEl=null;}}
function showSelPop(rect){
 hideSelPop();
 const p=document.createElement('div');p.id='sel-pop';p.className='sel-pop';
 p.innerHTML='<button data-action="l-explain-selection">'+svg('spark',13)+' 解释</button><button data-action="l-ask-tutor">'+svg('bot',13)+' 问主讲</button>';
 document.body.appendChild(p);selPopEl=p;
 const w=p.offsetWidth,h=p.offsetHeight;
 let x=Math.min(Math.max(8,rect.left+rect.width/2-w/2),window.innerWidth-w-8);
 let y=rect.top-h-8;if(y<8)y=rect.bottom+8;
 p.style.left=x+'px';p.style.top=Math.min(y,window.innerHeight-h-8)+'px';
}
// Chunks arrive far faster than anyone reads; coalesce them to a few redraws
// a second and rewrite only the streaming bubble when it is already on screen.
const streamFrames={};
function patchStream(lane){
 if(streamFrames[lane])return;
 streamFrames[lane]=setTimeout(()=>requestAnimationFrame(()=>{
  delete streamFrames[lane];
  const b=el('#learn-chat-'+lane),live=b?.querySelector('.streaming .markdown');
  if(!live)return patchChat(lane);
  const stick=b.scrollHeight-b.scrollTop-b.clientHeight<130;
  live.innerHTML=wrapCodeBlocks(replyHtml(L.streams[lk(lt()?.id,lane)]||''));
  if(stick)b.scrollTop=b.scrollHeight;
 }),80);
}
function patchChat(lane){const b=el('#learn-chat-'+lane);if(!b)return;const stick=b.scrollHeight-b.scrollTop-b.clientHeight<130;b.innerHTML=conversationHtml(lane);if(stick)b.scrollTop=b.scrollHeight;}
function findCell(id){return ld()?.notebooks?.flatMap(n=>n.cells).find(c=>c.id===id);}
async function saveCell(id){
 const draft=L.drafts.get(id);if(!draft)return;
 clearTimeout(L.timers.get(id));
 const saved=await rpc('nb_cell_save',{cell:draft});
 if(L.drafts.get(id)?.source===draft.source)L.drafts.delete(id);
 const nb=ld()?.notebooks.find(n=>n.id===saved.notebook_id);if(nb){const at=nb.cells.findIndex(c=>c.id===id);if(at>=0)nb.cells[at]=saved;}
 const label=el('#cell-save-'+id);if(label)label.textContent=L.drafts.has(id)?'待保存':'已保存';
}
async function flushCells(){for(const id of [...L.drafts.keys()])await saveCell(id);}
async function focusTopic(id){await flushCells();adoptLearning(await rpc('learn_focus',{id}));L.inputs={tutor:'',flash:''};L.selection='';render();}
/* What the learner has on screen goes with their words; agents look up the rest. */
function screenRef(){
 const d=currentDetail(),p=S.view==='practice'?shownPractice():null,nb=S.view==='notebook'?activeNotebook():null;
 if(p)return 'practice:'+p.id+'「'+p.title+'」';
 if(nb)return 'notebook:'+nb.id+'「'+nb.title+'」';
 if(d&&!d.collapsed&&d.ref!=='new'){
  const item=d.kind==='card'?ld().cards.find(c=>String(c.id)===String(d.ref)):d.kind==='lesson'?(ld().all_lessons||[]).find(l=>String(l.id)===String(d.ref)):d.kind==='note'?S.data?.notes?.find(n=>String(n.id)===String(d.ref)):null;
  if(item)return d.kind+':'+d.ref+'「'+item.title+'」';
 }
 return '';
}
async function sendLearning(lane,message=null,task=''){
 if(!lt())return toast('先创建一个探索主题，再开始提问。','error');
 if(laneBusy(lane))return toast('这个通道正在回答，另一位助手仍可提问。');
 await flushCells();
 const value=(message??L.inputs[lane]).trim();if(!value&&!task)return;
 const actual=value||(lane==='practice'?({start:'开始练习。',check:'我写好了，帮我看看右侧的代码和运行结果。',hint:'我卡住了，给我一点提示，先别直接给答案。'}[task]||''):'')||({plan:'我想从这个主题开始学。',continue:'接着上次的地方继续。',bridge:'我好像卡在某个前置知识上了。',capture:'把我们讨论过的内容整理成知识卡。',experiment:'给我设计一个能亲手改的小实验。'}[task]||'');
 const key=lk(lt().id,lane);L.localBusy.add(key);L.streams[key]='';L.errors[key]='';
 /* Snapshot-and-clear the composer and selection up front: anything typed while
    the bridge call is in flight must survive the send. */
 const sel=L.selection;
 if(message==null){L.inputs[lane]='';const inp=el('#learn-input-'+lane);if(inp)inp.value='';}
 L.selection='';const selBox=el('#flash-selection');if(selBox){selBox.classList.remove('has-selection');selBox.innerHTML=selectionHtml();}
 try{
  const page=PAGES[S.view],open=screenRef();
  if(lane==='practice')await rpc('learn_practice_send',{id:shownPractice().id,text:actual,task,page,open});
  else await rpc('learn_send',{topic_id:lt().id,lane,text:actual,selection:sel,task,page,open});
  ({tutor:ld().tutor_messages,flash:ld().flash_messages,practice:shownPractice()?.messages||[]})[lane].push({id:'pending-'+Date.now(),role:'user',content:actual,created_at:new Date().toISOString()});
  L.scrollBottom=lane;
  await openContent({tutor:'dialogue',flash:'flash',practice:'practice'}[lane]);
 }catch(e){L.localBusy.delete(key);L.errors[key]=e.message;if(message==null)L.inputs[lane]=value;render();throw e;}
}
function topicModal(branch=false,edit=false){
 const t=edit?lt():null;
 modal(modalHead(edit?'调整当前探索':'从一个好奇开始')+'<p>给问题留出空间。可以独立探索，也可以作为现有主线的一条分支。</p>'+
 '<label class="learn-form-label">主题<input id="topic-title" class="field" value="'+esc(t?.title||'')+'" placeholder="例如：为什么概率可以用来生成一句话？"/></label>'+
 '<label class="learn-form-label">我真正想知道的问题<textarea id="topic-question" class="field" rows="3">'+esc(t?.question||'')+'</textarea></label>'+
 '<label class="learn-form-label">所属主线<select id="topic-parent" class="field">'+topicOptions(branch?lt().id:t?.parent_id,'独立的探索主线')+'</select></label>'+
 (edit?'<label class="learn-form-label">状态<select id="topic-state" class="field">'+[['active','正在探索'],['parked','暂时搁置'],['completed','阶段完成']].map(([v,n])=>'<option value="'+esc(v)+'" '+(t.state===v?'selected':'')+'>'+n+'</option>').join('')+'</select></label>':'')+
 '<div class="modal-actions">'+lbutton('取消','modal-close','','ghost')+(edit&&!isChat(t)?lbutton('删除这条探索','l-topic-delete','','ghost sm'):'')+lbutton(edit?'保存':'开始探索','l-topic-confirm',edit?'data-id="'+esc(t.id)+'"':'','primary')+'</div>');
}
function lessonModal(lesson=null){
 L.editingLesson=lesson;
 modal(modalHead(lesson?'编辑课程':'自己写一节课')+'<label class="learn-form-label">标题<input class="field" id="lesson-title" value="'+esc(lesson?.title||'')+'"/></label>'+
 '<label class="learn-form-label">这一节想理解什么<input class="field" id="lesson-objective" value="'+esc(lesson?.objective||'')+'"/></label>'+
 '<label class="learn-form-label">课程内容 · Markdown<textarea class="field lesson-edit-body" id="lesson-body" rows="14">'+esc(lesson?.body||'')+'</textarea></label>'+
 '<div class="modal-actions">'+lbutton('取消','modal-close','','ghost')+(lesson?lbutton('删除这节课','l-lesson-delete','','ghost sm'):'')+lbutton('保存课程','l-lesson-save','','primary')+'</div>','large');
}
function cardForm(c,card,draft={}){
 const f=k=>k in draft?draft[k]:c[k==='topic'?'topic_id':k];
 const relations=card?ld().relations.filter(r=>r.source===c.id||r.target===c.id):[];
 const evidence=(c.evidence||[]).map(e=>'<div class="evidence-item"><span>'+esc({explanation:'自己的解释',experiment:'实验观察',counterexample:'反例',review:'回顾',question:'补充 / 疑问'}[e.kind]||e.kind)+' · '+esc(fmtDate(e.created_at,true))+'</span><p>'+esc(e.content)+'</p>'+(e.run_id?'<small>关联真实运行 #'+esc(e.run_id)+'</small>':'')+'</div>').join('');
 return '<input type="hidden" data-f="cardid" value="'+esc(card?card.id:'new')+'"/><div class="card-form-grid"><label class="learn-form-label">概念标题<input data-f="title" class="field" value="'+esc(f('title'))+'"/></label><label class="learn-form-label">我目前到哪一步<select data-f="stage" class="field">'+Object.entries(stageName).map(([v,n])=>'<option value="'+esc(v)+'" '+(f('stage')===v?'selected':'')+'>'+n+'</option>').join('')+'</select></label></div>'+
 '<label class="learn-form-label">解释与例子 · Markdown<textarea data-f="body" class="field" rows="5">'+esc(f('body'))+'</textarea></label>'+
 '<label class="learn-form-label personal-understanding">用自己的话说<textarea data-f="understanding" class="field" rows="3" placeholder="先理解，再写下你自己的说法。">'+esc(f('understanding'))+'</textarea></label>'+
 '<label class="learn-form-label">仍然想问什么<input data-f="question" class="field" value="'+esc(f('question'))+'"/></label>'+
 '<div class="card-form-grid"><label class="learn-form-label">标签，用逗号分隔<input data-f="tags" class="field" value="'+esc('tags' in draft?draft.tags:c.tags.join(', '))+'"/></label><label class="learn-form-label">学习主题<select data-f="topic" class="field">'+topicOptions(f('topic'),'不绑定主题')+'</select></label></div>'+
 (card?'<details class="card-detail-section"><summary>关系 · '+relations.length+' 条</summary>'+relations.map(r=>{const a=ld().cards.find(x=>x.id===r.source),b=ld().cards.find(x=>x.id===r.target);return '<div class="card-relation-row"><span>'+esc(a?.title)+' → '+esc(relationName[r.kind])+' → '+esc(b?.title)+'<small>'+esc(r.reason)+'</small></span>'+lbutton(svg('trash',12),'l-relation-delete','data-id="'+esc(r.id)+'"','ghost sm')+'</div>';}).join('')+
 lbutton('添加关联','l-relation-new','data-source="'+esc(c.id)+'"','ghost sm')+'</details><details class="card-detail-section" open><summary>学习证据 · '+c.evidence.length+' 条</summary>'+evidence+
 '<label class="learn-form-label">补充一条证据<textarea class="field" rows="2" data-f="evidence" placeholder="这次我观察到…… / 我能解释……"></textarea></label><div class="card-evidence-actions"><select data-f="evkind" class="field"><option value="explanation">自己的解释</option><option value="experiment">实验观察</option><option value="counterexample">发现反例</option><option value="question">补充疑问</option></select>'+lbutton('添加证据','l-evidence-add','','ghost sm')+lbutton('关联一次真实实验','l-evidence-run','','ghost sm')+'</div></details>':'')+
 '<div class="modal-actions card-modal-actions">'+(card?lbutton('删除','l-card-delete','','ghost sm')+lbutton('再巩固 · 明天回顾','l-review','data-again="true"','ghost sm')+lbutton('完成这次回顾','l-review','data-again="false"','ghost sm'):'')+
 lbutton('保存知识卡','l-card-save','','primary')+'</div>';
}
async function cardModal(card=null,prefill={}){
 L.editingCard=card||prefill;
 const c=card||{title:'',body:'',understanding:'',question:'',tags:[],stage:'suggested',topic_id:lt()?.id,...prefill};
 modal(modalHead(card?'知识卡 · '+c.title:'留下一张知识卡')+cardForm(c,card),'large');
}
/* Read fields from the expanded content card or its editing dialog. */
function scopeRoot(a){return a?.closest?.('.content-detail')||a?.closest?.('.modal')||document;}
function scopedField(root,f){return root?.querySelector?.('[data-f="'+esc(f)+'"]')||null;}
function lessonFromAction(a){
 const slot=a?.closest?.('.content-detail');
 const ref=slot&&currentDetail()?.kind==='lesson'?currentDetail().ref:null;
 return ref?((ld()?.all_lessons||[]).concat(ld()?.lessons||[])).find(l=>String(l.id)===String(ref)):activeLesson();
}
async function saveCard(root=document,opts={}){
 const slot=root?.classList?.contains('content-detail')?root:null;
 const sobj=slot?currentDetail():null;
 const ref=sobj?.ref??null;
 const cid=scopedField(root,'cardid')?.value||(ref&&ref!=='new'?ref:null);
 const existing=cid?(ld().cards||[]).find(c=>String(c.id)===String(cid)):null;
 const base=existing||(!slot?L.editingCard:null)||{title:'',body:'',understanding:'',question:'',tags:[],stage:'suggested',topic_id:lt()?.id};
 const body={...base,title:scopedField(root,'title')?.value??base.title,body:scopedField(root,'body')?.value??base.body,
  understanding:scopedField(root,'understanding')?.value??base.understanding,question:scopedField(root,'question')?.value??base.question,
  stage:scopedField(root,'stage')?.value??base.stage,topic_id:scopedField(root,'topic')?.value||null,
  tags:(scopedField(root,'tags')?.value??base.tags.join(', ')).split(/[,，]/).map(x=>x.trim()).filter(Boolean)};
 const result=await rpc('learn_card_save',{card:body});L.editingCard=result;
 if(sobj){L.cardDrafts.delete(sobj.uid);if(sobj.ref==='new'){sobj.ref=result.id;sobj.uid='card:'+result.id;}}
 if(!slot&&opts.close!==false)closeModal();await learnRefresh();return result;
}
function cardPageBody(s){
 const ref=s.ref,isNew=ref==='new',card=(ld().cards||[]).find(c=>String(c.id)===String(ref));
 if(!isNew&&!card)return '<div class="content-missing">'+emptyState("tag","这张卡片不存在","它可能已被删除，或在另一个学习档案里。")+'</div>';
 const c=isNew?{title:'',body:'',understanding:'',question:'',tags:[],stage:'suggested',topic_id:lt()?.id}:card;
 const draft=L.cardDrafts.get(s.uid)||{};
 return '<div class="card-page"><div class="content-tools"><span class="learn-caption">'+(isNew?'保存后进入卡片库':(c.origin==='builtin'?'内置示例':c.origin==='manual'?'自己记录':'AI 建议 · 已采纳'))+(Object.keys(draft).length?' · 有未保存修改':'')+'</span>'+(isNew?'':badge(c.stage))+'</div>'+
 '<div class="card-page-body" data-scroll="cardpage" data-scroll-ns="'+esc(ref)+'">'+cardForm(c,card,draft)+'</div></div>';
}
function notePageBody(ref){
 /* The dirty edit buffer outranks the notes array: a background reloadData can
    replace the array with older server state while edits are still pending. */
 const note=(String(S.noteId)===String(ref)&&S.note)?S.note:(S.data?.notes||[]).find(n=>String(n.id)===String(ref));
 if(!note)return '<div class="content-missing">'+emptyState("document","这篇笔记不存在","它可能已被删除。")+'</div>';
 const modes=[["edit","编辑"],["split","分屏"],["preview","预览"]].map(m=>
 '<button data-action="note-mode" data-mode="'+esc(m[0])+'" class="'+esc((S.noteMode===m[0]?"active":""))+'">'+m[1]+'</button>').join("");
 return '<div class="card-page note-page"><div class="content-tools"><span class="learn-caption">'+esc(note.folder)+'</span>'+
 '<div class="mode-toggle">'+modes+'</div>'+
 '<button class="icon-btn" data-action="history-note" title="版本历史">'+svg("history",15)+'</button>'+
 '<button class="icon-btn" data-action="delete-note" title="删除笔记">'+svg("trash",15)+'</button>'+
 '<button class="btn primary sm" data-action="save-note">'+svg("save",15)+' 保存</button></div>'+
 '<div class="card-page-body note-page-body" data-scroll="notepage" data-scroll-ns="'+esc(ref)+'">'+notePane(note)+'</div></div>';
}
function lessonPageBody(ref){
 const lesson=((ld()?.all_lessons||[]).concat(ld()?.lessons||[])).find(l=>String(l.id)===String(ref));
 if(!lesson)return '<div class="content-missing">'+emptyState("book","这节课不存在","它可能已被删除。")+'</div>';
 const home=lesson.topic_id===lt()?.id;
 const topic=(ld()?.topics||[]).find(t=>t.id===lesson.topic_id);
 return '<div class="card-page"><div class="content-tools"><span class="learn-caption">课程 · '+esc(topic?.title||'')+(lesson.state==='done'?' · 已完成':'')+(home?'':' · 其他主题 · 只读')+'</span>'+(home?'':lbutton('切换到此主题','l-lesson-topic','data-ref="'+esc(ref)+'"','ghost sm'))+'</div>'+
 '<div class="lesson-pane-body"><article class="lesson-reading" data-scroll="lessonpage" data-scroll-ns="'+esc(ref)+'">'+lessonReading(lesson,home)+'</article></div></div>';
}
function relationModal(source=''){
 const cards=ld().cards;
 if(cards.length<2)return toast('至少需要两张知识卡才能建立关系','error');
 const options=(s)=>cards.map(c=>'<option value="'+esc(c.id)+'" '+(String(c.id)===String(s)?'selected':'')+'>'+esc(c.title)+'</option>').join('');
 modal(modalHead('建立一个有含义的连接')+'<label class="learn-form-label">从这个知识出发<select class="field" id="relation-source">'+options(source)+'</select></label>'+
 '<label class="learn-form-label">关系<select class="field" id="relation-kind">'+Object.entries(relationName).map(([v,n])=>'<option value="'+esc(v)+'">'+n+'</option>').join('')+'</select></label>'+
 '<label class="learn-form-label">连接到<select class="field" id="relation-target">'+options(cards.find(c=>c.id!==source)?.id)+'</select></label>'+
 '<label class="learn-form-label">为什么相连<textarea class="field" rows="3" id="relation-reason"></textarea></label><p>前置知识与整体—部分关系会用于知识树；其他关联会出现在关系图中。</p>'+
 '<div class="modal-actions">'+lbutton('取消','modal-close','','ghost')+lbutton('建立关系','l-relation-save','','primary')+'</div>');
}
function proposalsModal(){
 const proposals=ld().proposals.filter(p=>p.state==='pending');
 modal(modalHead('把建议变成可继续使用的学习材料')+'<p>这里是模型提出的草案。采纳会添加内容，不会执行 Python，也不会自动标记你已经掌握知识。</p>'+
 proposals.map(p=>{const pl=p.payload||{},les=pl.lessons||[],cds=pl.cards||[],cls=pl.cells||[],rls=pl.relations||[],pnotes=pl.notes||[];return '<section class="proposal-preview"><h3>'+esc(pl.summary||'一份新的教学建议')+'</h3><div class="proposal-counts">'+les.length+' 节课 · '+cds.length+' 张卡 · '+cls.length+' 个单元格 · '+rls.length+' 条关系'+(pnotes.length?' · '+pnotes.length+' 篇经验文档':'')+'</div>'+
 les.map(l=>'<details><summary>课程 · '+esc(l.title)+'</summary><div class="markdown">'+markdown(l.body||'')+'</div></details>').join('')+
 cds.map(c=>'<details><summary>知识卡 · '+esc(c.title)+'</summary><div class="markdown">'+markdown(c.body||'')+'</div><p>'+esc(c.question||'')+'</p></details>').join('')+
 pnotes.map(n=>'<details><summary>经验文档 · '+esc(n.title)+'</summary><div class="markdown">'+markdown(n.body||'')+'</div></details>').join('')+
 cls.map((c,i)=>'<details><summary>单元格 '+(i+1)+' · '+esc(c.kind)+'</summary><pre>'+esc(c.source)+'</pre></details>').join('')+
 (rls.length?'<div class="proposal-relations">'+rls.map(r=>'<p>'+esc(r.source+' → '+(relationName[r.kind]||r.kind)+' → '+r.target)+'<small>'+esc(r.reason||'')+'</small></p>').join('')+'</div>':'')+
 '<div class="modal-actions">'+lbutton('先略过','l-proposal-dismiss','data-id="'+esc(p.id)+'"','ghost sm')+lbutton('采纳这一份','l-proposal-apply','data-id="'+esc(p.id)+'"','primary sm')+'</div></section>';}).join(''),'large');
}
async function settingsSave(){
 const apis={};
 for(const a of ld().providers.apis){const v=k=>el('#cfg-api-'+a.id+'-'+k).value;apis[a.id]={base_url:v('base'),api_key:v('key'),headers:JSON.parse(v('headers')||'{}'),extra_body:JSON.parse(v('extra')||'{}')};}
 const cfg={apis,timeout:Number(el('#cfg-timeout').value),temperature:Number(el('#cfg-temperature').value),tutor_agent:el('#cfg-tutor-agent').value,
 flash_api:el('#cfg-flash-api').value,flash_model:el('#cfg-flash-model').value,flash_max_tokens:Number(el('#cfg-flash-tokens').value),
 practice_api:el('#cfg-practice-api').value,practice_model:el('#cfg-practice-model').value,practice_max_tokens:Number(el('#cfg-practice-tokens').value),
 tutor_api:el('#cfg-tutor-api').value,tutor_model:el('#cfg-tutor-model').value,tutor_max_tokens:Number(el('#cfg-tutor-tokens').value),
 codex_command:el('#cfg-codex').value,codex_args:JSON.parse(el('#cfg-codex-args').value),codex_model:el('#cfg-codex-model').value,
 codex_effort:el('#cfg-effort').value,devin_command:el('#cfg-devin').value,devin_model:el('#cfg-devin-model').value,
 custom_command:el('#cfg-custom').value,custom_args:JSON.parse(el('#cfg-custom-args').value||'[]'),
 kernel_name:el('#cfg-kernel').value,kernel_timeout:Number(el('#cfg-kernel-timeout').value),agent_auto_run:el('#cfg-auto-run').checked};
 ld().providers=await rpc('learn_settings_save',{config:cfg});all('[id^="cfg-api-"][id$="-key"]').forEach(x=>x.value='');toast('模型设置已保存');
}
const originalGo=go;
go=async function(view){
 await flushCells();
 if(LEARNING_PAGES.has(view)&&!ld())await learnRefresh(false);
 return originalGo(view);
};
const originalAction=action;
action=async function(target){
 const a=target&&target.closest('[data-action]');if(!a)return;
 const kind=a.dataset.action,id=a.dataset.id;
 // A close button on a permission dialog also sends an explicit rejection.
 if(S.permission&&['modal-close','permission-select','permission-deny'].includes(kind)){
  const p=S.permission;
  await rpc('agent_permission',{id:p.session_id,request_id:p.request_id,option_id:kind==='permission-select'?a.dataset.choice:undefined});
  S.permission=null;closeModal();if(L.permissions.length)permissionModal(L.permissions.shift());return;
 }
 if(S.commandOpen&&a.closest('#palette-list'))closeModal();
 if(!kind.startsWith('l-')&&!kind.startsWith('nb-'))return originalAction(target);
 switch(kind){
 case 'l-content-toggle':return toggleContent(a.dataset.kind,id);
 case 'l-content-collapse':return collapseContent();
  case 'l-ask-tutor':{const sel=L.selection;hideSelPop();return sendLearning('tutor',sel?'请结合当前学习主题，解释我选中的内容。':null);}
 case 'l-topic-new':return topicModal();
 case 'l-topic-branch':return topicModal(true);
 case 'l-topic-edit':return topicModal(false,true);
 case 'l-topic-confirm':{
  const topic={title:el('#topic-title').value,question:el('#topic-question').value,parent_id:el('#topic-parent').value||null};if(id){topic.id=id;topic.state=el('#topic-state').value;}
  const result=await rpc('learn_topic_save',{topic});closeModal();return focusTopic(result.id);
 }
 case 'l-topic-focus':return focusTopic(id);
 case 'l-topic-delete':{
  if(!confirm('删除这条探索主线？知识卡会保留（改为不绑定主题），兴趣分支会并入上一级主线，课程、实验笔记与对话线程会一并删除。'))return;
  const doomed=new Set((ld()?.notebooks||[]).flatMap(n=>n.cells.map(c=>c.id)));
  for(const cid of [...L.drafts.keys()])if(doomed.has(cid)){clearTimeout(L.timers.get(cid));L.timers.delete(cid);L.drafts.delete(cid);}
  const st=await rpc('learn_topic_delete',{id:lt().id});closeModal();adoptLearning(st);
  L.lessonId=null;L.notebookId=null;return render();
 }
 case 'l-lesson-open':return openContent('lesson',id);
 case 'l-lesson-new':return lessonModal();
 case 'l-lesson-edit':{
  const lesson=lessonFromAction(a);
  if(lesson&&lesson.topic_id!==lt()?.id)return toast('这节课属于其他主题，只能阅读。','error');
  return lessonModal(lesson);
 }
 case 'l-lesson-save':{
  const l=await rpc('learn_lesson_save',{lesson:{...(L.editingLesson||{}),topic_id:lt().id,title:el('#lesson-title').value,objective:el('#lesson-objective').value,body:el('#lesson-body').value}});
  L.lessonId=l.id;closeModal();return learnRefresh();
 }
 case 'l-lesson-done':{
  const lesson=lessonFromAction(a);if(!lesson)return;
  if(lesson.topic_id!==lt()?.id)return toast('这节课属于其他主题，只能阅读。','error');
  await rpc('learn_lesson_save',{lesson:{...lesson,state:lesson.state==='done'?'current':'done'}});return learnRefresh();
 }
 case 'l-lesson-delete':{
  const lesson=L.editingLesson;if(!lesson)return;
  if(!confirm('删除课程「'+lesson.title+'」？'))return;
  await rpc('learn_lesson_delete',{id:lesson.id});
  if(L.lessonId===lesson.id)L.lessonId=null;
  L.editingLesson=null;closeModal();return learnRefresh();
 }
 case 'l-send':return sendLearning(a.dataset.lane);
 case 'l-cancel':return rpc('learn_cancel',{topic_id:lt().id,lane:a.dataset.lane});
 case 'l-tutor-task':return sendLearning('tutor',null,a.dataset.task);
 case 'l-practice-start':{
  if(ld().practice)return toast('还有一个练习没结束：先在「练习」页结束它，再开新的。','error');
  await flushCells();
  adoptLearning(await rpc('learn_practice_start',{topic_id:lt().id,message_id:Number(id)}));
  L.practiceId=null;L.inputs.practice='';L.localBusy.add(lk(lt().id,'practice'));L.scrollBottom='practice';
  return openContent('practice');
 }
 case 'l-practice-task':return sendLearning('practice',null,a.dataset.task);
 case 'l-action-undo':{
  adoptLearning(await rpc('learn_action_undo',{id,topic_id:lt()?.id}));L.undone.add(id);render();return toast('已撤销');
 }
 case 'l-handoff':await go('learning');return sendLearning('tutor','快答刚把一个问题转交给你了，请接住它。');
 case 'l-ref-open':{
  const [kind,ref]=[a.dataset.ref.split(':')[0],a.dataset.ref.slice(a.dataset.ref.indexOf(':')+1)];
  if(kind==='topic')return focusTopic(ref);
  if(kind==='practice'){L.practiceId=ref;L.practiceCache=await rpc('learn_practice_get',{id:ref});return go('practice');}
  if(kind==='notebook'||kind==='cell'){const nb=kind==='notebook'?ref:ld().notebooks.find(n=>n.cells.some(c=>c.id===ref))?.id;if(nb)L.notebookId=nb;return openContent('notebook');}
  if(['card','lesson','note'].includes(kind)){await learnRefresh(false);if(kind==='note')await reloadData();return openContent(kind,ref);}
  return;
 }
 case 'l-practice-end':{
  if(!confirm('结束这次练习，交给主讲复盘？结束后不能再在这个分支里继续对话。'))return;
  await flushCells();
  adoptLearning(await rpc('learn_practice_end',{id}));
  L.practiceId=id;L.practiceCache=await rpc('learn_practice_get',{id});L.localBusy.add(lk(lt().id,'tutor'));
  render();return toast('已交给主讲复盘');
 }
 case 'l-practice-open':L.practiceId=id;L.practiceCache=await rpc('learn_practice_get',{id});return render();
 case 'l-practice-close':L.practiceId=null;L.practiceCache=null;return render();
 case 'l-insight-resolve':await rpc('learn_insight_resolve',{id});if(L.practiceCache)L.practiceCache=await rpc('learn_practice_get',{id:L.practiceCache.id});return learnRefresh();
 case 'l-connect':await rpc('learn_connect',{topic_id:lt().id});return toast('正在进行真实 ACP 握手');
 case 'l-tutor-new':
  if(!confirm('开启新的主讲会话？学习数据会保留，之前的对话仍在 AI 协作历史里。'))return;
  adoptLearning(await rpc('learn_new_tutor',{topic_id:lt().id}));return render();
 case 'l-quick-question':return sendLearning('flash',a.dataset.question);
 case 'l-explain-selection':hideSelPop();return sendLearning('flash','请解释我选中的内容，结合当前学习主题给一个容易理解的例子。');
 case 'l-clear-selection':L.selection='';if(el('#flash-selection'))el('#flash-selection').innerHTML=selectionHtml();return;
 case 'l-code-copy':{const n=el('#'+a.dataset.target);if(n)await navigator.clipboard.writeText(n.textContent);return toast('代码已复制');}
 case 'l-code-run':{
  const n=el('#'+a.dataset.target),code=n?n.textContent.trim():'';
  if(!code)return;
  await flushCells();
  if(S.view==='practice'&&shownPractice()?.state==='active'){
   const nb=ld().notebooks.find(x=>x.id===shownPractice().notebook_id);if(!nb)return toast('这次练习的笔记本已被删除','error');
   await rpc('nb_cell_save',{cell:{notebook_id:nb.id,kind:'code',source:code}});await learnRefresh();
   const b=el('#notebook-scroll');if(b)b.scrollTop=b.scrollHeight;
   return toast('已放到右侧。补全空白后按 Shift + Enter 运行');
  }
  let nb=activeNotebook();
  if(!nb){if(!lt())return toast('先创建一个探索主题');nb=await rpc('nb_create',{topic_id:lt().id,title:'对话片段实验'});}
  const cell=await rpc('nb_cell_save',{cell:{notebook_id:nb.id,kind:'code',source:code}});
  L.notebookId=nb.id;await rpc('nb_run',{id:nb.id,cell_id:cell.id});
  await learnRefresh();await openContent('notebook');
  return toast('已放进实验笔记并交给 Jupyter 运行');
 }
 case 'l-proposals':return proposalsModal();
 case 'l-proposal-apply':{
  await flushCells();const result=await rpc('learn_proposal_apply',{id,notebook_id:activeNotebook()?.id});closeModal();
  if(result.notebook_id)L.notebookId=result.notebook_id;if(result.lessons?.[0])L.lessonId=result.lessons[0];
  await learnRefresh();
  if(result.lessons?.length)await openContent('classroom');else if(result.cells?.length)await openContent('notebook');
  return toast('已写入学习档案；新增代码尚未执行');
 }
 case 'l-proposal-dismiss':await rpc('learn_proposal_dismiss',{id});closeModal();return learnRefresh();
 case 'l-card-view':L.cardView=a.dataset.mode;return render();
 case 'l-toggle-flash':return go('flash');
 case 'l-lesson-topic':{
  const ref=a.dataset.ref||currentDetail()?.ref;
  const lesson=(ld().all_lessons||ld().lessons||[]).find(l=>String(l.id)===String(ref));
  if(lesson?.topic_id!==lt()?.id&&lesson?.topic_id)await focusTopic(lesson.topic_id);
  L.lessonId=ref;
  return openContent('lesson',ref);
 }
 case 'l-card-new':return openContent('card','new');
 case 'l-card-open':return openContent('card',id);
 case 'l-item-back':return collapseContent();
 case 'l-card-save':await saveCard(scopeRoot(a));return toast('知识卡已保存');
 case 'l-card-delete':{
  const root=scopeRoot(a),slot=root?.classList?.contains('content-detail')?root:null;
  const ref=scopedField(root,'cardid')?.value||(slot?currentDetail()?.ref:L.editingCard?.id);
  const card=(ld().cards||[]).find(c=>String(c.id)===String(ref))||L.editingCard;
  if(!card||!confirm('删除这张知识卡及其关联和证据？'))return;
  await rpc('learn_card_delete',{id:card.id});closeModal();
  if(slot){L.cardDrafts.delete(currentDetail()?.uid);delete L.details[S.view];}
  else L.editingCard=null;
  return learnRefresh();
 }
 case 'l-evidence-add':{
  const root=scopeRoot(a),content=scopedField(root,'evidence').value,kind=scopedField(root,'evkind').value;
  const card=await saveCard(root,{close:false});await rpc('learn_evidence',{card_id:card.id,kind,content});await learnRefresh(false);
  return a.closest('.content-detail')?render():cardModal(ld().cards.find(c=>c.id===card.id));
 }
 case 'l-evidence-run':{
  const card=await saveCard(scopeRoot(a),{close:false});const runs=await rpc('learn_completed_runs');
  modal(modalHead('把实际实验关联到知识卡')+'<p>关联的是不可变的运行记录，包括当时的源码与输出。</p>'+
  '<label class="learn-form-label">成功完成的运行<select class="field" id="evidence-run">'+runs.map(r=>'<option value="'+esc(r.id)+'">'+esc(fmtDate(r.ended_at,true)+' · '+shorten(r.source,80))+'</option>').join('')+'</select></label>'+
  '<label class="learn-form-label">这次实验说明了什么<textarea class="field" id="evidence-run-content" rows="3"></textarea></label><div class="modal-actions">'+lbutton('记录实验依据','l-evidence-run-save','data-id="'+esc(card.id)+'" '+(!runs.length?'disabled':''),'primary')+'</div>');return;
 }
 case 'l-evidence-run-save':{
  const inSlot=a.closest('.content-detail');
  await rpc('learn_evidence',{card_id:id,kind:'experiment',content:el('#evidence-run-content').value,run_id:el('#evidence-run').value});closeModal();await learnRefresh(false);
  return inSlot?render():cardModal(ld().cards.find(c=>c.id===id));
 }
 case 'l-review':{
  const root=scopeRoot(a),reflection=(scopedField(root,'evidence')||scopedField(root,'understanding'))?.value||'';const card=await saveCard(root,{close:false});
  await rpc('learn_review',{card_id:card.id,reflection,again:a.dataset.again==='true'});closeModal();await learnRefresh();return toast('回顾已记录；不会自动提升理解阶段');
 }
 case 'l-review-next':{
  if(!ld().cards.some(c=>c.stage!=='suggested'))return toast('先把实际接触过的卡片从「待探索」改为「接触过」，再开始回顾。');
  const cards=ld().cards.filter(isDue).sort((a,b)=>(a.due_at||a.created_at).localeCompare(b.due_at||b.created_at));
  if(!cards.length)return toast('现在没有到期的卡。');
  return openContent('card',cards[0].id);
 }
 case 'l-relation-new':return relationModal(a.dataset.source||'');
 case 'l-relation-save':{const src=el('#relation-source').value,tgt=el('#relation-target').value;if(src===tgt)return toast('不能连接到同一张卡','error');await rpc('learn_relation',{source:src,target:tgt,kind:el('#relation-kind').value,reason:el('#relation-reason').value});closeModal();return learnRefresh();}
 case 'l-relation-delete':{await rpc('learn_relation_delete',{id});await learnRefresh(false);if(a.closest('.content-detail'))return render();const cid=scopedField(a.closest('.modal'),'cardid')?.value||L.editingCard?.id;return cardModal(ld().cards.find(c=>String(c.id)===String(cid)));}
 case 'l-message-card':{
  const messages=a.dataset.lane==='flash'?ld().flash_messages:ld().tutor_messages,m=messages.find(m=>String(m.id)===String(id));if(!m)return;
  return cardModal(null,{title:'',body:cleanReply(m.content),origin:a.dataset.lane,provenance:'会话消息 #'+m.id,tags:['来自'+(a.dataset.lane==='flash'?'快答':'主讲')],stage:'suggested'});
 }
 case 'l-message-code':{
  const m=ld().tutor_messages.find(m=>String(m.id)===String(id));if(!m)return;
  await flushCells();let nb=activeNotebook();if(!nb)nb=await rpc('nb_create',{topic_id:lt().id,title:'来自主讲的小实验'});
  const blocks=[...m.content.matchAll(/```(?:python|py)\s*\n([\s\S]*?)\n```/g)];for(const b of blocks)await rpc('nb_cell_save',{cell:{notebook_id:nb.id,kind:'code',source:b[1]}});
  L.notebookId=nb.id;await learnRefresh();await openContent('notebook');return toast('代码已加入实验笔记，尚未运行');
 }
 case 'l-escalate':{const m=ld().flash_messages.find(m=>String(m.id)===String(id));if(m)return sendLearning('tutor','我刚才和快答助手讨论了下面的内容。请检查它是否准确，再帮我深入理解，并接回主线：\n\n'+m.content);return;}
 case 'l-graph-zoom':{const cy=graphCy();if(!cy)return;const r=cy.container().getBoundingClientRect();cy.zoom({level:cy.zoom()*Number(a.dataset.factor),renderedPosition:{x:r.width/2,y:r.height/2}});return;}
 case 'l-graph-reset':{const cy=graphCy();if(cy)cy.animate({fit:{padding:30}},{duration:300});return;}
 case 'l-graph-relayout':{const cy=graphCy();if(cy)cy.layout(GRAPH_LAYOUT).run();return;}
 case 'l-settings-save':await settingsSave();return render();
 case 'l-test-api':await settingsSave();L.testResult='正在读取 API 模型列表…';render();await rpc('learn_test_api',{lane:a.dataset.lane});return;
 case 'l-test-codex':await settingsSave();L.testResult='正在进行 ACP 握手与会话创建…';render();await rpc('learn_connect',{topic_id:lt().id});return;
 case 'l-clear-key':{const api=ld().providers.apis.find(x=>x.id===a.dataset.api);if(!confirm('清除保存在本机配置文件中的 '+api.label+' Key？环境变量不会被修改。'))return;ld().providers=await rpc('learn_settings_save',{config:{apis:{[api.id]:{clear_key:true}}}});return render();}
 case 'l-export':{await flushCells();const file=await rpc('learn_export',{},0);if(file)toast('学习档案已导出：'+file);return;}
 case 'nb-new':{const name=prompt('实验笔记名称：','新的小实验');if(!name)return;await flushCells();const nb=await rpc('nb_create',{topic_id:lt().id,title:name});await rpc('nb_cell_save',{cell:{notebook_id:nb.id,kind:'code',source:'# 从这里开始你的实验\n'}});L.notebookId=nb.id;await learnRefresh();return openContent('notebook');}
 case 'nb-files':L.filesOpen=!L.filesOpen;if(L.filesOpen&&S.projectId)await loadTree();return render();
 case 'nb-file-close':if(S.fileDirty&&!confirm('当前文件有未保存的更改，放弃并关闭吗？'))return;S.filePath=null;S.fileDirty=false;return render();
 case 'nb-add':{await flushCells();await rpc('nb_cell_save',{cell:{notebook_id:activeNotebook().id,kind:a.dataset.kind,source:a.dataset.kind==='markdown'?'## 我的观察\n':'# 写下你的 Python 代码\n'}});await learnRefresh();const b=el('#notebook-scroll');if(b)b.scrollTop=b.scrollHeight;return;}
 case 'nb-delete':if(!confirm('删除这个单元格？它的历史运行记录仍会保留在档案中。'))return;clearTimeout(L.timers.get(id));L.drafts.delete(id);await rpc('nb_cell_delete',{id});return learnRefresh();
 case 'nb-move':await flushCells();await rpc('nb_cell_move',{id,direction:Number(a.dataset.direction)});return learnRefresh();
 case 'nb-run':case 'nb-run-all':await flushCells();await rpc('nb_run',{id:activeNotebook().id,cell_id:kind==='nb-run'?id:undefined});return toast('已交给本机 Jupyter 内核执行');
 case 'nb-stop':return rpc('nb_interrupt',{id:activeNotebook().id});
 case 'nb-restart':if(!confirm('重启这份笔记本的内核？运行中的代码将停止、变量将清空，笔记和历史输出会保留。'))return;return rpc('nb_restart',{id:activeNotebook().id});
 case 'nb-history':{
  const runs=await rpc('nb_history',{cell_id:id});modal(modalHead('这个单元格实际执行过什么')+(runs.length?runs.map(r=>'<details class="run-history-item"><summary>'+esc(fmtDate(r.started_at,true)+' · '+r.state+' · In ['+(r.execution_count??' ')+']')+'</summary><pre>'+esc(r.source)+'</pre>'+outputHtml(r.outputs)+'</details>').join(''):'<p>还没有实际运行记录。</p>'),'large');return;
 }
 case 'nb-export':await flushCells();{const p=await rpc('nb_export',{id:activeNotebook().id},0);if(p)toast('已导出标准 .ipynb：'+p);}return;
 case 'nb-import':await flushCells();{const n=await rpc('nb_import',{topic_id:lt().id},0);if(n){L.notebookId=n.id;await learnRefresh();await openContent('notebook');toast('已导入代码与 Markdown；请运行以生成本地结果。');}}return;
 case 'nb-remove':{
  const nb=activeNotebook();if(!nb)return;
  if(!confirm('删除实验笔记「'+nb.title+'」？所有单元格与运行历史会一并删除。'))return;
  for(const cid of [...L.drafts.keys()]){
   const d=L.drafts.get(cid);if(d?.notebook_id===nb.id){clearTimeout(L.timers.get(cid));L.timers.delete(cid);L.drafts.delete(cid);}
  }
  await rpc('nb_delete',{id:nb.id});
  if(L.notebookId===nb.id)L.notebookId=null;
  return learnRefresh();
 }
 }
};
const originalOnInput=onInput;
onInput=async function(e){
 const t=e.target;
 if(t.id==='learn-input-tutor'){L.inputs.tutor=t.value;return;}
 if(t.id==='learn-input-flash'){L.inputs.flash=t.value;return;}
 if(t.id==='learn-input-practice'){L.inputs.practice=t.value;return;}
 if(t.dataset.f&&CARD_FIELDS.has(t.dataset.f)){
  const slot=t.closest('.content-detail'),s=slot?currentDetail():null;
  if(s?.kind==='card'){const d=L.cardDrafts.get(s.uid)||{};d[t.dataset.f]=t.value;L.cardDrafts.set(s.uid,d);}
 }
 if(t.dataset.cellEditor){
  const id=t.dataset.cellEditor,c=findCell(id);if(!c)return;
  L.drafts.set(id,{id,notebook_id:c.notebook_id,kind:c.kind,source:t.value});
  const label=el('#cell-save-'+id);if(label)label.textContent='待保存';
  const preview=el('#md-preview-'+id);if(preview)preview.innerHTML=markdown(t.value);
  const stale=el('#cell-stale-'+id);if(stale)stale.classList.toggle('visible',c.run_source!==null&&c.run_source!==t.value);
  t.style.height='auto';t.style.height=Math.max(74,Math.min(560,t.scrollHeight))+'px';
  clearTimeout(L.timers.get(id));L.timers.set(id,setTimeout(()=>safe(()=>saveCell(id)),750));return;
 }
 if(t.id==='knowledge-search'){L.search=t.value;el('#knowledge-body').innerHTML=knowledgeBody(visibleCards());return;}
 return originalOnInput(e);
};
const originalOnChange=onChange;
onChange=async function(e){
 const t=e.target;
 if(t.id==='learn-topic-select')return focusTopic(t.value);
 if(t.id==='cfg-tutor-agent'){all('.agent-fields').forEach(d=>d.hidden=d.dataset.agent==='acp'?t.value==='api':d.dataset.agent!==t.value);return;}
 if(['cfg-flash-api','cfg-tutor-api','cfg-practice-api'].includes(t.id)){const m=ld().providers.apis.find(x=>x.id===t.value)?.default_model;if(m)el('#cfg-'+t.dataset.lane+'-model').value=m;return;}
 if(t.id==='notebook-select'){await flushCells();L.notebookId=t.value;return render();}
 if(t.id==='knowledge-stage'){L.stage=t.value;el('#knowledge-body').innerHTML=knowledgeBody(visibleCards());return;}
 if(t.id==='knowledge-topic'){L.scope=t.value;el('#knowledge-body').innerHTML=knowledgeBody(visibleCards());return;}
 return originalOnChange(e);
};
const originalOnEvent=onEvent;
onEvent=async function(evt){
 if(evt.type==='learning_agent'){
  if(evt.kind==='connection_test'){L.testResult=(evt.ok?'✓ ':'连接失败：')+evt.message;const b=el('#connection-test-result');if(b)b.textContent=L.testResult;toast(L.testResult,evt.ok?'info':'error');return;}
  const key=lk(evt.topic_id,evt.lane),same=evt.topic_id===lt()?.id;
  if(evt.kind==='permission'){if(S.permission)L.permissions.push(evt);else permissionModal(evt);return;}
  if(evt.kind==='chunk'){L.streams[key]=(L.streams[key]||'')+evt.text;if(same)patchStream(evt.lane);return;}
  if(evt.kind==='error'){L.localBusy.delete(key);L.errors[key]=evt.message||'请求失败，没有收到错误说明。请重试。';if(same)patchChat(evt.lane);L.testResult=evt.message;const b=el('#connection-test-result');if(b)b.textContent=evt.message;return;}
  if(evt.kind==='ready'){ld().runtime.agents[evt.session_id]='ready';L.testResult='✓ ACP 已完成握手并建立真实会话。';const b=el('#connection-test-result');if(b)b.textContent=L.testResult;return;}
  if(evt.kind==='status'){ld().runtime.agents[evt.session_id]=evt.state;if(evt.state==='offline')L.localBusy.delete(key);const chip=el('.learn-agent-chip');if(chip&&evt.lane==='tutor'&&same)chip.innerHTML='<i></i> '+esc(tutorLabel())+' · '+esc(stateName[evt.state]||evt.state);return;}
  if(evt.kind==='tool'){
   if(!evt.actions?.length)return;
   (L.liveActions[key]=L.liveActions[key]||[]).push(...evt.actions);
   if(same){const box=el('#learn-chat-'+evt.lane+' .streaming .live-actions');if(box)box.innerHTML=actionChips(L.liveActions[key],true);else patchChat(evt.lane);}
   return;
  }
  if(evt.kind==='finished'){
   L.localBusy.delete(key);L.streams[key]='';L.liveActions[key]=[];
   if(evt.focus&&evt.focus!==lt()?.id){adoptLearning(await rpc('learn_snapshot',{topic_id:evt.focus}));if(LEARNING_PAGES.has(S.view))render();return;}
   if(same){await learnRefresh(false);if(L.practiceId&&L.practiceId!==ld().practice?.id)L.practiceCache=await rpc('learn_practice_get',{id:L.practiceId});if(LEARNING_PAGES.has(S.view))render();}
   if(evt.artifacts?.errors?.length)toast('建议格式未通过验证：'+evt.artifacts.errors.join('；'),'error');
   return;
  }
  return;
 }
 if(evt.type==='learning_changed'){
  if(evt.topic_id===lt()?.id){await learnRefresh(false);if(['notebook','practice'].includes(S.view))render();}
  return;
 }
 if(evt.type==='notebook'){
  const same=activeNotebook()?.id===evt.notebook_id;
  if(evt.kind==='output'){const c=findCell(evt.cell_id);if(c)c.outputs=evt.outputs;const b=el('#cell-output-'+evt.cell_id);if(b)b.innerHTML=outputHtml(evt.outputs);return;}
  if(evt.kind==='run_started'){ld().runtime.notebooks[evt.notebook_id]={state:'busy',kernel_id:evt.kernel_id};const c=el('#cell-count-'+evt.cell_id);if(c)c.textContent='In [*]';const b=el('#cell-output-'+evt.cell_id);if(b)b.innerHTML='';}
  if(evt.kind==='run_finished'){
   const nb=await rpc('nb_get',{id:evt.notebook_id});const pos=ld().notebooks.findIndex(n=>n.id===nb.id);if(pos>=0)ld().notebooks[pos]=nb;
   const c=el('#cell-count-'+evt.cell_id);if(c)c.textContent='In ['+(evt.execution_count??' ')+'] · '+({completed:'完成',error:'异常',cancelled:'已停止',skipped:'已跳过'}[evt.state]||evt.state);
   const b=el('#cell-output-'+evt.cell_id);if(b)b.innerHTML=outputHtml(evt.outputs);
   const cell=findCell(evt.cell_id),stale=el('#cell-stale-'+evt.cell_id);if(cell&&stale)stale.classList.toggle('visible',(L.drafts.get(cell.id)?.source??cell.source)!==cell.run_source);
  }
  if(evt.kind==='status'||evt.kind==='batch_finished')ld().runtime.notebooks[evt.notebook_id]={state:evt.state,kernel_id:evt.kernel_id};
  if(evt.kind==='error')toast(evt.message,'error');
  if(same){const k=el('#nb-kernel-state'),state=ld().runtime.notebooks[evt.notebook_id]?.state;if(k)k.innerHTML=svg('terminal',13)+' Python · '+esc(stateName[state]||state||'未启动');}
  return;
 }
 return originalOnEvent(evt);
};
function graphCy(){return document.getElementById("main-cy")?.__cy||null;}
async function saveFocused(){
 if(S.view==='notes'){await saveNote(false);return;}
 if(currentDetail()?.kind==='card'&&!currentDetail().collapsed){
  const root=el('.content-detail');if(root){await saveCard(root);toast('知识卡已保存');}return;
 }
 if(L.filesOpen&&S.filePath&&S.fileDirty)await saveProjectFile();
 await flushCells();toast('已保存');
}
document.addEventListener('keydown',e=>{
 const t=e.target,mod=e.ctrlKey||e.metaKey;
 if(e.key==='Escape'){
  if(el('.modal'))return;
  hideSelPop();
  return;
 }
 if(!LEARNING_PAGES.has(S.view))return;
 if(mod&&e.key.toLowerCase()==='j'){e.preventDefault();safe(()=>go('flash'));return;}
 if(t.dataset.cellEditor&&e.key==='Tab'){
  e.preventDefault();const start=t.selectionStart,end=t.selectionEnd;t.setRangeText('    ',start,end,'end');t.dispatchEvent(new Event('input',{bubbles:true}));return;
 }
 if(t.dataset.cellEditor&&e.key==='Enter'&&e.shiftKey){e.preventDefault();safe(async()=>{await flushCells();await rpc('nb_run',{id:activeNotebook().id,cell_id:t.dataset.cellEditor});});return;}
 if(mod&&e.key==='Enter'&&t.id.startsWith('learn-input-')){e.preventDefault();safe(()=>sendLearning(t.id.slice(12)));return;}
 
});
document.addEventListener('mouseup',e=>{
 if(!LEARNING_PAGES.has(S.view)||e.target.closest('.flash-panel,#overlays,#sel-pop,.toc-drawer'))return;
 let selected='';const t=e.target;
 let rect=null;
 if(t.tagName==='TEXTAREA'){selected=t.value.slice(t.selectionStart,t.selectionEnd);rect=t.getBoundingClientRect();}
 else{
  const sel=window.getSelection();selected=sel?.toString()||'';
  if(sel&&sel.rangeCount)rect=sel.getRangeAt(0).getBoundingClientRect();
 }
 if(selected.trim().length>=1){
  L.selection=selected.slice(0,5000);
  const b=el('#flash-selection');if(b){b.classList.add('has-selection');b.innerHTML=selectionHtml();}
  if(rect&&(rect.width||rect.height))showSelPop(rect);
 }else hideSelPop();
});

