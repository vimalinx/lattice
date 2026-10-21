"use strict";
/* Lattice Views: functional panels backed by live local data. */
function notesListItems(){
 const term=S.noteFilter.toLowerCase().trim();
 const notes=(S.data.notes||[]).filter(n=>(S.noteFolder==='All'||n.folder===S.noteFolder)&&(!term||[n.title,n.body,...(n.tags||[])].join(' ').toLowerCase().includes(term)));
 return notes.map(n=>detailCard('note',n.id,n.title,n.folder+' · '+fmtDate(n.updated_at),()=>notePageBody(n.id))).join('')||'<div class="learn-empty"><h3>没有匹配的笔记</h3><p>调整搜索条件，或新建一篇笔记。</p></div>';
}
function notePane(n){
 return '<div class="note-head">'+
 '<input id="note-title" class="note-title" placeholder="笔记标题" value="'+esc(n.title)+'"/>'+
 '<div class="note-meta">'+
 '<select id="note-folder">'+["Knowledge","Daily","Ideas","Projects","Home","Research","Imported"].filter((x,i,a)=>a.indexOf(x)===i).concat([n.folder]).filter((x,i,a)=>a.indexOf(x)===i).map(f=>
 '<option '+(n.folder===f?"selected":"")+' value="'+esc(f)+'">'+esc(f)+'</option>').join("")+'</select>'+
 '<input id="note-tags" placeholder="标签，以逗号分开" title="标签，以逗号分开" value="'+esc((n.tags||[]).join(", "))+'"/>'+
 '<span id="note-saved" class="save-state">已保存 · '+esc(fmtDate(n.updated_at,true))+'</span></div></div>'+
 '<div class="note-content '+(S.noteMode==="edit"?"edit-only":S.noteMode==="preview"?"preview-only":"")+'">'+
 '<textarea id="note-body" spellcheck="false" class="markdown-editor" placeholder="从这里开始思考…&#10;&#10;## 我真正想理解的是什么？&#10;&#10;[[链接另一条笔记]]">'+esc(n.body)+'</textarea>'+
 '<div class="markdown-preview markdown" id="note-preview">'+markdown(n.body)+'</div></div>'+
 '<div class="note-footer"><span>Markdown · [[双向链接]] · 本地修订版本</span><span>'+n.body.length+' 字符</span></div>';
}
function notesView(){
 const folders=['All',...new Set((S.data.notes||[]).map(n=>n.folder))];
 return '<section class="flat-page"><div class="flat-heading"><div><h1>知识笔记</h1><p>'+(S.data.notes||[]).length+' 篇笔记 · 点击展开编辑，再次点击收起。</p></div>'+button(svg('plus',14)+' 新建笔记','new-note','','primary')+'</div>'+
 '<div class="flat-toolbar"><input id="note-filter" class="search-input" aria-label="搜索笔记" placeholder="搜索笔记…" value="'+esc(S.noteFilter)+'"/>'+
 '<select id="note-folder-filter" class="field" aria-label="笔记分类">'+folders.map(f=>'<option value="'+esc(f)+'" '+(S.noteFolder===f?'selected':'')+'>'+esc(f==='All'?'全部分类':f)+'</option>').join('')+'</select></div>'+
 '<div class="flat-grid notes-grid">'+notesListItems()+'</div></section>';
}
const GRAPH_FILTERS=[["all","笔记与知识卡"],["note","只看笔记"],["card","只看知识卡"]];
/* Mixed node sizes (label-sized cards, small note dots with labels below) need
   label-aware spacing, or the force layout stacks cards on each other. */
const GRAPH_LAYOUT={name:"cose",animate:"end",animationDuration:450,nodeDimensionsIncludeLabels:true,
 idealEdgeLength:120,nodeRepulsion:450000,nodeOverlap:40,componentSpacing:120,gravity:.6,numIter:2000,padding:40};
function graphView(){
 const g=S.data.graph||{nodes:[],edges:[]};
 const notes=g.nodes.filter(n=>n.kind==="note").length,cards=g.nodes.length-notes;
 return '<div style="height:100%"><div class="graph-toolbar"><div><div class="overline">KNOWLEDGE NETWORK</div>'+
 '<div style="font-size:17px;font-weight:680;margin-top:6px">笔记与知识卡，在同一张网里。</div></div>'+
 '<div class="flex"><span class="text-xs subtle">'+notes+' 篇笔记 · '+cards+' 张知识卡 · '+g.edges.length+' 条连接</span>'+
 '<select id="graph-filter" class="field" style="width:140px" aria-label="显示哪些节点">'+GRAPH_FILTERS.map(([v,t])=>
 '<option value="'+v+'" '+(S.graphFilter===v?"selected":"")+'>'+t+'</option>').join("")+'</select>'+
 button('+','l-graph-zoom','data-factor="1.25" title="放大"','ghost sm')+button('−','l-graph-zoom','data-factor="0.8" title="缩小"','ghost sm')+
 button('复位','l-graph-reset','','ghost sm')+button('重排','l-graph-relayout','','ghost sm')+'</div></div>'+
 '<div class="graph-stage">'+(g.nodes.length?'<div id="main-cy" class="main-cy" role="img" aria-label="知识网络"></div>':emptyState("network","还没有知识网络","在笔记里写 [[标题]] 连接笔记或知识卡，或在知识卡之间建立关系。","新建笔记","new-note"))+
 '<div class="graph-guide">● 笔记 · ▢ 知识卡（边框色＝理解阶段）· 箭头实线：前置 / 分解 · 虚线：关联 / 应用 / 对比 · 细线：[[链接]] · 点击节点打开</div></div></div>';
}
/* Positions survive re-renders and page switches so the map stays familiar. */
const graphPositions={};
function mountKnowledgeGraph(){
 const c=document.getElementById("main-cy");if(!c)return;
 const g=S.data.graph||{nodes:[],edges:[]},filter=S.graphFilter||"all";
 const nodes=g.nodes.filter(n=>filter==="all"||n.kind===filter).slice(0,400);
 const ids=new Set(nodes.map(n=>n.id)),edges=g.edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
 const known=nodes.length&&nodes.every(n=>graphPositions[n.id]);
 const cy=mountCytoscape(c,{
  elements:[
   ...nodes.map(n=>({data:{id:n.id,label:n.title,kind:n.kind,folder:n.folder||"",degree:n.degree||0,stageCol:stageColor[n.stage]||"#5b6675"},classes:n.kind})),
   ...edges.map(e=>({data:{id:e.id,source:e.source,target:e.target,kind:e.kind,reason:e.reason||"",label:relationShort[e.kind]||""},classes:e.kind==="link"?"link":"typed"}))],
  style:[
   {selector:"node.note",style:{"background-color":"#8bdcc5","label":"data(label)","color":"#c9d6e4","font-size":11,"font-family":"inherit","text-valign":"bottom","text-margin-y":7,"width":"mapData(degree,0,8,22,48)","height":"mapData(degree,0,8,22,48)","border-width":2,"border-color":"#0e141b","text-wrap":"ellipsis","text-max-width":"112px"}},
   {selector:'node.note[folder="Home"]',style:{"background-color":"#b5a8fa"}},
   {selector:'node.note[folder="Daily"]',style:{"background-color":"#e0be88"}},
   {selector:"node.card",style:{"shape":"round-rectangle","background-color":"#141b25","border-width":1.8,"border-color":"data(stageCol)","label":"data(label)","color":"#dbe7f3","font-size":12,"font-family":"inherit","font-weight":600,"text-valign":"center","text-halign":"center","text-wrap":"wrap","text-max-width":"120px","width":"label","height":"label","padding":"11px"}},
   {selector:"edge.typed",style:{"width":1.5,"line-color":"#4a5b70","curve-style":"bezier","target-arrow-shape":"triangle","target-arrow-color":"#4a5b70","arrow-scale":.9,"label":"data(label)","font-size":9,"color":"#7f8ea1","text-rotation":"autorotate","text-margin-y":-6}},
   {selector:'edge[kind="related"],edge[kind="applies_to"],edge[kind="contrasts"]',style:{"line-style":"dashed","line-color":"#55637a","target-arrow-color":"#55637a"}},
   {selector:"edge.link",style:{"width":1.1,"line-color":"#42566b","curve-style":"bezier","opacity":.7}},
   {selector:".faded",style:{"opacity":.15}}],
  layout:known?{name:"preset",positions:n=>graphPositions[n.id()],fit:true,padding:30}:GRAPH_LAYOUT,
  onTapNode:n=>n.data("kind")==="note"?openNote(n.id()):openContent("card",n.id()),
  onTapEdge:e=>{
   const title=id=>g.nodes.find(n=>n.id===id)?.title||"";
   const kind=e.data("kind"),how=kind==="link"?"链接到":relationName[kind]||kind;
   toast(title(e.data("source"))+" "+how+" "+title(e.data("target"))+(e.data("reason")?"："+e.data("reason"):""));
  }});
 if(!cy)return;
 const remember=()=>{if(!cy.destroyed())cy.nodes().forEach(n=>{graphPositions[n.id()]={...n.position()};});};
 cy.on("dragfree","node",remember);cy.on("layoutstop",remember);
 if(known)remember();
}
function settingsView(){
 return '<div class="page"><div class="overline">CUSTOMISE · OWN · PRESERVE</div>'+
 '<h1 class="page-title">设置。</h1>'+
 '<p class="page-sub">模型连接、外观与数据迁移，全部只保存在本机。</p>'+
 '<div class="section-label" style="margin-top:26px">模型连接 · AI 通道</div>'+connectionsBody()+
 '<div class="section-label" style="margin-top:30px">工作台</div>'+
 '<div class="two-columns mt-3"><div class="stack">'+
 '<section class="card"><div class="card-header"><span class="card-title">外观与操作</span></div>'+
 '<div style="padding:20px"><div class="section-label">APPEARANCE</div>'+
 '<p class="muted text-sm">根据心情切换色彩。对话、知识图谱和实验可长期共存。</p>'+
 '<div class="flex">'+button(svg("moon")+' 深色',"set-dark","","")+button(svg("sun")+' 浅色',"set-light","","")+'</div>'+
 '<div class="divider"></div><div class="section-label">SHORTCUTS</div>'+
 '<p class="context-tip">Ctrl + K · 全局搜索<br>Ctrl + N · 新建笔记 / 主题<br>Ctrl + S · 保存当前内容<br>Ctrl + J · 即时答疑<br>Ctrl + Enter · 发送 AI 消息</p></div></section>'+
 '<section class="card"><div class="card-header"><span class="card-title">数据与迁移</span></div>'+
 '<div style="padding:20px"><p class="muted text-sm">支持无损导出 Markdown，也可以从已有笔记目录复制导入。导入不会修改原文件。</p>'+
 '<div class="flex" style="flex-wrap:wrap">'+button(svg("upload")+' 导入 Markdown',"import","","")+
 button(svg("download")+' 导出 Markdown',"export","","")+
 button(svg("folder")+' 打开数据目录',"open-data","","ghost")+'</div></div></section></div>'+
 '<div class="stack"><section class="card"><div class="card-header"><span class="card-title">关于 Lattice</span></div>'+
 '<div style="padding:20px"><div class="overline">VERSION 0.1</div>'+
 '<p class="muted text-sm">Qt 6 原生桌面外壳 · SQLite · Agent Client Protocol · Jupyter 内核</p>'+
 '<p class="context-tip">以知识为中心，不强迫你进入某种固定的学习流程。课程、实验笔记、知识卡和笔记互相引用。</p></div></section></div></div></div>';
}
function viewHtml(){
 if(S.view==="graph")return graphView();
 return settingsView();
}
function render(){
 hideSelPop();teardownLive();
 // A reply finishing re-renders the page; whoever is typing keeps their caret.
 const typing=document.activeElement,focusId=typing?.id&&/^(TEXTAREA|INPUT)$/.test(typing.tagName)?typing.id:null;
 const caret=focusId?[typing.selectionStart,typing.selectionEnd,typing.scrollTop]:null;
 const sc=scrollSnapshot(),learning=LEARNING_PAGES.has(S.view);
 document.documentElement.setAttribute('data-theme',S.theme);
 const contextual=['learning','practice','classroom','notebook','flash'].includes(S.view);
 // Keep the shell mounted so page updates cannot interrupt navigation motion
 // or replace the focused navigation button.
 if(!el('#root'))el('#app').innerHTML='<div id="root" class="'+(S.sidebarCollapsed?'nav-collapsed':'')+'">'+sidebar()+'<main class="main"></main></div>';
 refreshSidebar();
 el('#root > .main').innerHTML=(contextual?learningHeader():header())+
 '<section class="content '+(learning?'page-surface':'')+'" data-scroll="page" data-scroll-ns="'+esc(S.view)+'">'+
 (learning?learningPage():'<div class="page '+(S.view==='graph'?'wide':'')+'">'+viewHtml()+'</div>')+
 '</section>';
 scrollRestore(sc,L.scrollBottom?'chat-'+L.scrollBottom:null);L.scrollBottom=null;
 fitCodeEditors();runAfterRender();
 const again=focusId&&document.getElementById(focusId);
 if(again){again.focus();try{again.setSelectionRange(caret[0],caret[1]);}catch(_){}again.scrollTop=caret[2];}
}
