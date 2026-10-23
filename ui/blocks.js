"use strict";
/* What an agent shows: Markdown plus fenced ```lattice:<type> JSON blocks that the UI renders.
   The model never sends HTML or scripts; a block only names data that the UI fetches itself. */
const BLOCK_RE=/```lattice:([\w-]+)[^\n]*\n([\s\S]*?)(?:\n```|$)/g;
const CODE_EXT={python:".py",py:".py",c:".c",cpp:".cpp","c++":".cpp",rust:".rs",rs:".rs",go:".go",javascript:".js",js:".js",typescript:".ts",ts:".ts",bash:".sh",sh:".sh",shell:".sh",ruby:".rb",lua:".lua",julia:".jl",r:".r",java:".java"};
let snippetSeq=0;
const snippetRuns={};
/* Reply text -> {html, blocks}; blocks are mounted after the HTML is in the page. */
function replyHtml(text,live=false){
 const blocks=[];
 const src=String(text||"").replace(BLOCK_RE,(m,type,body)=>{
  let data=null,error=null;
  try{data=JSON.parse(body);}catch(e){error=live&&!/\n```\s*$/.test(m)?"pending":"展示块的格式不对";}
  blocks.push({type,data,error,raw:body});
  return "\n\nLATTICEBLOCK"+(blocks.length-1)+"X\n\n";
 });
 let html=markdown(src).replace(/<p>LATTICEBLOCK(\d+)X<\/p>/g,(_,i)=>'<div class="lblock" data-block="'+i+'"></div>');
 html=html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g,(m,attrs,code)=>{
  const lang=(attrs.match(/language-([\w+#-]+)/)||[])[1]||"",id="snip"+(++snippetSeq),runnable=!!CODE_EXT[lang.toLowerCase()];
  return '<div class="code-block"><div class="code-bar"><span>'+esc(lang||"text")+'</span>'+
   '<button data-action="code-copy" data-target="'+id+'" title="复制">'+svg("copy",11)+'</button>'+
   (runnable?'<button data-action="code-run" data-target="'+id+'" data-lang="'+esc(lang)+'" title="运行看结果（以你的权限，在学习库的环境里）">'+svg("play",11)+' 运行</button>':"")+
   '<button data-action="code-take" data-target="'+id+'" data-lang="'+esc(lang)+'" title="存成我这边的一个文件">'+svg("arrow",11)+' 拿到我这边</button></div>'+
   '<pre><code id="'+id+'"'+attrs+'>'+code+'</code></pre><div class="snippet-out" data-snippet="'+id+'"></div></div>';
 });
 return {html,blocks};
}
function mountBlocks(root,blocks,ctx){
 all(".lblock",root).forEach(node=>{
  const b=blocks[+node.dataset.block];if(!b)return;
  // drawn already and kept as it is (a reply still being written puts its finished blocks back)
  if(node.dataset.drawn===b.type+"\u0000"+b.raw)return;
  if(b.error==="pending"){node.innerHTML='<div class="block-pending">正在生成 '+esc(b.type)+' …</div>';return;}
  const render=BLOCKS[b.type];
  if(b.error||!render){node.innerHTML='<pre class="block-raw">'+esc(b.raw)+'</pre>';return;}
  node.classList.add("block-"+b.type);
  safe(()=>render(b.data||{},node,{...ctx,index:+node.dataset.block}));
  if(ctx.live)node.dataset.drawn=b.type+"\u0000"+b.raw;
 });
}
const BLOCKS={
 quiz(d,node,ctx){
  const key=ctx.message+":"+ctx.index,answered=ctx.answers?.[key];
  const opts=Array.isArray(d.options)?d.options:[];
  node.innerHTML='<div class="quiz-q">'+svg("bulb",15)+'<div class="markdown">'+markdown(d.question||"")+'</div></div>'+
   (answered?'<div class="quiz-answered">你的回答：'+esc(answered)+'</div>':
    (opts.length?'<div class="quiz-options">'+opts.map((o,i)=>'<label><input type="radio" name="q'+esc(key)+'" value="'+esc(o)+'"/> '+esc(o)+'</label>').join("")+'</div>':
     '<textarea class="quiz-free" rows="3" placeholder="先自己想一想，再写下你的预测或解释"></textarea>')+
    (ctx.live?'':'<div class="quiz-actions">'+button("交给 AI","quiz-answer",'data-key="'+esc(key)+'"',"primary sm")+'</div>'));
  node.dataset.question=d.question||"";
 },
 async cards(d,node,ctx){
  const refs=(d.cards||[]).slice(0,30);
  node.innerHTML='<div class="block-pending">读取知识卡…</div>';
  const cards=await rpc("cards",{refs});
  node.innerHTML='<div class="cards-head">'+svg("card",14)+' '+(d.review?"回顾 "+cards.length+" 张卡 · 先自己回想，再看答案并自评":cards.length+" 张知识卡")+'</div>'+
   cards.map(c=>c.missing?'<div class="mini-card missing">找不到「'+esc(c.missing)+'」</div>':
   '<div class="mini-card" data-card="'+esc(c.id)+'"><div class="mini-card-top"><a data-action="open-file" data-path="'+esc(c.path)+'">'+esc(c.title)+'</a><span class="stage stage-'+esc(c.stage)+'">'+esc(stageName[c.stage]||c.stage)+'</span></div>'+
   (d.review?'<div class="mini-q">'+esc(c.question||"用自己的话说说它是什么、为什么。")+'</div><div class="mini-reveal">'+button("想好了，看答案","card-reveal","","sm")+'</div>'+
    '<div class="mini-answer" hidden><div class="markdown">'+markdown(c.body)+'</div>'+(c.mine?'<div class="mini-mine"><b>我的理解</b><div class="markdown">'+markdown(c.mine)+'</div></div>':"")+
    '<div class="mini-rate">记得多少：'+button("忘了","card-rate",'data-rating="again" data-id="'+esc(c.id)+'"',"sm")+button("模糊","card-rate",'data-rating="hard" data-id="'+esc(c.id)+'"',"sm")+button("记得","card-rate",'data-rating="good" data-id="'+esc(c.id)+'"',"sm primary")+'</div></div>':
    '<div class="mini-q">'+esc(shorten(c.question||c.body,140))+'</div>')+'</div>').join("");
 },
 async graph(d,node){
  node.innerHTML='<div class="mini-graph"></div><div class="graph-caption"></div>';
  const g=await rpc("graph",{topic:d.topic||null});
  mountGraph(node.firstElementChild,g,{topic:d.topic,focus:d.focus||[],here:d.here,compact:true});
  const route=d.topic&&g.routes[d.topic];
  node.lastElementChild.textContent=route?.length?"主干路线 "+route.length+" 站"+(d.here?" · 高亮的是你现在的位置":""):"";
 },
 chart(d,node){node.innerHTML=chartSvg(d);},
 relations(d,node){
  const count=(d.nodes||[]).length;
  if(!count){node.innerHTML='<p class="muted">关系图没有节点</p>';return;}
  node.innerHTML=relationsHtml(d,Math.max(240,Math.min(520,200+count*20)));
  const note=node.querySelector(".rel-note"),say=html=>{note.hidden=!html;note.innerHTML=html;};
  const draw=()=>relationsGraph(node.querySelector(".rel-canvas"),d,{say});
  // Drawn once the block is on screen (a hidden container has no size to lay out in).
  requestAnimationFrame(draw);
  node.querySelector('[data-action="rel-relayout"]').onclick=e=>{e.stopPropagation();draw();};
  node.querySelector('[data-action="rel-zoom"]').onclick=e=>{e.stopPropagation();
   modal(modalHead(d.title||"关系图")+relationsHtml(d,Math.round(innerHeight*.62)),"large");
   const box=el(".modal .rel"),n2=box.querySelector(".rel-note");box.querySelector(".rel-head").remove();
   requestAnimationFrame(()=>relationsGraph(box.querySelector(".rel-canvas"),d,{say:h=>{n2.hidden=!h;n2.innerHTML=h;}}));};
 },
 explore(d,node,ctx){
  const params=(d.params||[]).slice(0,8),values={};
  params.forEach(p=>{values[p.name]=Number(p.value??p.min??0);});
  node.innerHTML='<div class="explore"><div class="explore-head">'+svg("sliders",14)+'<b>'+esc(d.title||"动手试试")+'</b></div>'+(d.note?'<div class="explore-note markdown">'+markdown(d.note)+'</div>':"")+
   '<div class="explore-params">'+params.map(p=>'<label class="explore-param"><span>'+esc(p.label||p.name)+'</span>'+
    '<input type="range" data-param="'+esc(p.name)+'" min="'+esc(p.min??0)+'" max="'+esc(p.max??1)+'" step="'+esc(p.step??((Number(p.max??1)-Number(p.min??0))/100))+'" value="'+esc(values[p.name])+'"/>'+
    '<b data-param-out="'+esc(p.name)+'">'+esc(values[p.name])+'</b></label>').join("")+'</div>'+
   '<div class="explore-chart"></div><div class="explore-reads"></div>'+
   (ctx?.pid&&!ctx.live?'<div class="explore-actions">'+button(svg("quote",12)+" 带着现在的设置问 AI","explore-ask","","ghost xs")+'</div>':"")+'</div>';
  const chart=node.querySelector(".explore-chart"),reads=node.querySelector(".explore-reads");
  const draw=()=>{
   try{const st=exploreState(d,values);
    chart.innerHTML=chartSvg({kind:d.kind||"line",x:st.xs,series:st.series,xlabel:d.x?.label,ylabel:d.ylabel,ymin:d.ymin,ymax:d.ymax,title:""});
    reads.innerHTML=st.reads.map(r=>'<span><small>'+esc(r.label)+'</small><b>'+esc(r.v)+'</b></span>').join("");
   }catch(e){chart.innerHTML='<p class="muted">这个式子算不了：'+esc(e.message)+'</p>';}
  };
  node.addEventListener("input",e=>{const t=e.target.closest("[data-param]");if(!t)return;values[t.dataset.param]=Number(t.value);
   node.querySelector('[data-param-out="'+CSS.escape(t.dataset.param)+'"]').textContent=t.value;draw();});
  const ask=node.querySelector('[data-action="explore-ask"]');
  if(ask)ask.onclick=e=>{e.stopPropagation();const st=Chat[ctx.pid];if(!st)return;
   st.quote="「"+(d.title||"动手试试")+"」里我把 "+params.map(p=>(p.label||p.name)+" = "+values[p.name]).join("，")+(reads.textContent?"；这时 "+[...reads.children].map(x=>x.innerText.replace(/\n/," = ")).join("，"):"");
   updateComposer(ctx.pid);Dock.els[ctx.pid]?.querySelector(".composer textarea")?.focus();};
  draw();
 },
 async timeline(d,node){
  node.innerHTML='<div class="block-pending">读取轨迹…</div>';
  const since=d.days?new Date(Date.now()-d.days*864e5).toISOString():null;
  let rows=[];
  for(const ref of (d.refs&&d.refs.length?d.refs:[null]))rows=rows.concat(await rpc("journal",{types:d.types||null,ref,since,limit:60}));
  rows=[...new Map(rows.map(r=>[r.id,r])).values()].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,40);
  node.innerHTML='<div class="cards-head">'+svg("history",14)+' 学习轨迹</div>'+(rows.map(journalRow).join("")||'<p class="muted">没有找到记录。</p>');
 },
 async excerpt(d,node){
  const f=await rpc("file_read",{path:d.file});
  const lines=String(f.content||"").split("\n"),from=Math.max(1,d.from||1),to=Math.min(lines.length,d.to||Math.min(lines.length,from+30));
  const body=lines.slice(from-1,to).map((l,i)=>'<span class="ln">'+(from+i)+'</span>'+(d.highlight&&l.includes(d.highlight)?esc(l).split(esc(d.highlight)).join('<mark>'+esc(d.highlight)+'</mark>'):esc(l))).join("\n");
  node.innerHTML='<div class="excerpt-head">'+svg("file",13)+' '+esc(f.path)+' · 第 '+from+'–'+to+' 行'+button("在我这边打开到这里","open-file",'data-path="'+esc(f.path)+'" data-line="'+from+'"'+(d.highlight?' data-highlight="'+esc(d.highlight)+'"':""),"ghost sm")+'</div><pre class="excerpt">'+body+'</pre>';
 },
};
function journalRow(e){
 const d=e.data||{},refs=(e.refs||[]).filter(r=>r.includes("/")||r.includes("."));
 const what=d.summary||d.text||d.title||d.query||d.url||(d.files?d.files.map(f=>f.file).join("、"):"")||d.file||d.excerpt||"";
 return '<div class="jrow"><time>'+esc(fmtDate(e.at,true))+'</time><span class="jtype j-'+esc(e.type)+'">'+esc(journalName[e.type]||e.type)+'</span><span class="jwho">'+esc(who(e.actor))+'</span>'+
  '<span class="jwhat">'+esc(shorten(what,160))+(d.state?' <small>'+esc(d.state)+'</small>':"")+'</span>'+
  refs.filter(r=>!String(what).includes(r)).slice(0,2).map(r=>'<a class="jref" data-action="open-file" data-path="'+esc(r)+'">'+esc(baseName(r))+'</a>').join("")+'</div>';
}
/* A small dependency-free chart: line, bar or scatter, as SVG. */
function chartSvg(d){
 const W=520,H=260,P=38,series=(d.series||[]).filter(s=>Array.isArray(s.y)).slice(0,6);
 if(!series.length)return '<p class="muted">图表没有数据</p>';
 const n=Math.max(...series.map(s=>s.y.length)),xs=Array.isArray(d.x)&&d.x.length?d.x:[...Array(n).keys()];
 const numericX=xs.every(v=>typeof v==="number"),ys=series.flatMap(s=>s.y.filter(v=>typeof v==="number"&&isFinite(v)));
 let lo=Math.min(0,...ys),hi=Math.max(...ys);
 // A fixed range (ymin / ymax) keeps a blow-up from flattening everything else; values outside are clipped.
 if(d.ymin!=null)lo=Number(d.ymin);if(d.ymax!=null)hi=Number(d.ymax);if(!(hi>lo))hi=lo+1;
 const clip=v=>typeof v==="number"&&isFinite(v)?Math.min(hi,Math.max(lo,v)):null;
 const xmin=numericX?Math.min(...xs):0,xmax=numericX?Math.max(...xs):Math.max(1,xs.length-1);
 const X=(v,i)=>P+((numericX?v:i)-xmin)/((xmax-xmin)||1)*(W-2*P),Y=v=>H-P-(clip(v)-lo)/(hi-lo)*(H-2*P);
 const colors=vizPalette();
 let body="";
 series.forEach((s,k)=>{
  const c=colors[k%colors.length];
  if(d.kind==="bar"){const bw=(W-2*P)/n/(series.length+1);s.y.forEach((v,i)=>{body+='<rect x="'+(P+i*(W-2*P)/n+k*bw+bw/2)+'" y="'+Y(Math.max(0,v))+'" width="'+bw+'" height="'+Math.abs(Y(v)-Y(0))+'" fill="'+c+'" data-tip="'+esc(xs[i])+": "+esc(v)+'"></rect>';});}
  else if(d.kind==="scatter")s.y.forEach((v,i)=>{if(clip(v)==null)return;body+='<circle cx="'+X(xs[i],i)+'" cy="'+Y(v)+'" r="3.2" fill="'+c+'" data-tip="'+esc(xs[i])+", "+esc(v)+'"></circle>';});
  else{
   // A gap (a value that is not a number) breaks the line instead of drawing it to nowhere.
   let seg=[];const flush=()=>{if(seg.length>1)body+='<polyline fill="none" stroke="'+c+'" stroke-width="2" points="'+seg.join(" ")+'"/>';seg=[];};
   s.y.forEach((v,i)=>{if(clip(v)==null){flush();return;}seg.push(X(xs[i],i)+","+Y(v));});flush();
  }
 });
 const ticks=[lo,(lo+hi)/2,hi].map(v=>'<text x="'+(P-6)+'" y="'+(Y(v)+4)+'" text-anchor="end">'+esc(+v.toPrecision(3))+'</text><line x1="'+P+'" x2="'+(W-P)+'" y1="'+Y(v)+'" y2="'+Y(v)+'" class="grid"/>').join("");
 const xt=[0,Math.floor((xs.length-1)/2),xs.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>'<text x="'+X(xs[i],i)+'" y="'+(H-P+16)+'" text-anchor="middle">'+esc(shorten(xs[i],10))+'</text>').join("");
 const legend=series.map((s,k)=>'<span><i style="background:'+colors[k%colors.length]+'"></i>'+esc(s.name||"系列 "+(k+1))+'</span>').join("");
 return '<div class="chart">'+(d.title?'<div class="chart-title">'+esc(d.title)+'</div>':"")+'<svg viewBox="0 0 '+W+' '+H+'" class="chart-svg">'+ticks+xt+body+
  (d.xlabel?'<text x="'+W/2+'" y="'+(H-4)+'" text-anchor="middle" class="axis">'+esc(d.xlabel)+'</text>':"")+(d.ylabel?'<text x="12" y="'+H/2+'" transform="rotate(-90 12 '+H/2+')" text-anchor="middle" class="axis">'+esc(d.ylabel)+'</text>':"")+
  '</svg><div class="chart-legend">'+legend+'</div></div>';
}
/* The knowledge graph, shared by the map panel and graph blocks. A topic's route is drawn as a numbered chain. */
const GRAPH_STYLE=[
 {selector:"node",style:{"label":"data(label)","color":"#c9d6e4","font-size":11,"font-family":"inherit","text-valign":"bottom","text-margin-y":6,"width":18,"height":18,"background-color":"#5b6675","text-wrap":"ellipsis","text-max-width":"120px"}},
 {selector:"node.card",style:{"shape":"round-rectangle","background-color":"#141b25","border-width":2,"border-color":"data(color)","text-valign":"center","text-margin-y":0,"width":"label","height":"label","padding":"9px","font-weight":600,"color":"#dbe7f3"}},
 {selector:"node.topic",style:{"shape":"hexagon","background-color":"#2c5d53","width":30,"height":30,"font-weight":700,"font-size":12}},
 {selector:"node.note",style:{"background-color":"#8bdcc5"}},
 {selector:"node.lesson",style:{"shape":"diamond","background-color":"#b5a8fa"}},
 {selector:"node.notebook,node.file",style:{"shape":"rectangle","background-color":"#e0be88","width":14,"height":14}},
 {selector:"node.insight",style:{"shape":"triangle","background-color":"#f3a09b","width":14,"height":14}},
 {selector:"node.route",style:{"shape":"round-rectangle","background-color":"#173a33","border-width":1.5,"border-color":"#8bdcc5","width":"label","height":"label","padding":"8px","text-valign":"center","text-margin-y":0,"color":"#e7edf2"}},
 {selector:"node.here",style:{"border-width":4,"border-color":"#ecc994","underlay-color":"#ecc994","underlay-opacity":.25,"underlay-padding":6}},
 {selector:"node.focus",style:{"underlay-color":"#8bdcc5","underlay-opacity":.22,"underlay-padding":5}},
 {selector:"edge",style:{"width":1.4,"line-color":"#4a5b70","curve-style":"bezier","target-arrow-shape":"triangle","target-arrow-color":"#4a5b70","arrow-scale":.8,"label":"data(label)","font-size":9,"color":"#7f8ea1","text-rotation":"autorotate"}},
 {selector:"edge.mentions,edge.related",style:{"line-style":"dashed","target-arrow-shape":"none","opacity":.75}},
 {selector:"edge.trunk",style:{"width":3,"line-color":"#8bdcc5","target-arrow-color":"#8bdcc5"}},
 {selector:"edge.explains",style:{"line-color":"#ecc994","target-arrow-color":"#ecc994","line-style":"dashed"}},
 {selector:".faded",style:{"opacity":.15}}];
function mountGraph(container,g,opt={}){
 if(typeof cytoscape==="undefined"||!container)return null;
 if(container.__cy){try{container.__cy.destroy();}catch(_){ }}
 const docs=new Map((S.data?.docs||[]).map(d=>[d.id,d])),els=[];
 g.nodes.forEach(n=>els.push({data:{id:n.id,label:n.title,kind:n.kind,color:stageColor[n.stage]||"#5b6675"},classes:[n.kind,opt.here===n.id?"here":"",(opt.focus||[]).includes(n.id)?"focus":""].join(" ")}));
 g.edges.forEach(e=>els.push({data:{id:e.id,source:e.source,target:e.target,label:opt.compact?"":(linkName[e.kind]||e.kind),why:e.why||""},classes:e.kind}));
 const route=opt.topic&&g.routes[opt.topic]||[];
 route.forEach((s,i)=>{
  const id=s.ref&&g.nodes.some(n=>n.id===s.ref)?s.ref:"route:"+i;
  if(id.startsWith("route:"))els.push({data:{id,label:(i+1)+". "+s.title,kind:"route"},classes:"route"+(opt.here===id?" here":"")});
  else{const n=els.find(x=>x.data.id===id);if(n)n.data.label=(i+1)+". "+n.data.label;}
  if(i){const prev=route[i-1].ref&&g.nodes.some(n=>n.id===route[i-1].ref)?route[i-1].ref:"route:"+(i-1);els.push({data:{id:"trunk:"+i,source:prev,target:id,label:""},classes:"trunk"});}
 });
 const cy=cytoscape({container,elements:els,style:GRAPH_STYLE,wheelSensitivity:.25,minZoom:.2,maxZoom:3,
  layout:{name:"cose",animate:false,nodeDimensionsIncludeLabels:true,idealEdgeLength:90,nodeRepulsion:300000,padding:24,numIter:1500}});
 cy.on("tap","node",e=>{const id=e.target.id(),doc=docs.get(id);if(doc)openFile(doc.path);else if(id.startsWith("file:"))openFile(id.slice(5));});
 cy.on("tap","edge",e=>{const d=e.target.data();if(d.why)toast(d.why);});
 cy.on("mouseover","node",e=>{cy.elements().addClass("faded");e.target.closedNeighborhood().removeClass("faded");});
 cy.on("mouseout","node",()=>cy.elements().removeClass("faded"));
 container.__cy=cy;
 new ResizeObserver(()=>{if(!cy.destroyed()){cy.resize();cy.fit(undefined,20);}}).observe(container);
 return cy;
}

/* ---- colours from the theme in use, so charts and diagrams follow it ------------------------------------------------ */
function themeColor(name,fallback){const v=getComputedStyle(document.documentElement).getPropertyValue("--"+name).trim();return v||fallback;}
function vizPalette(){return ["accent","ai","amber","tk-fn","red","green","tk-type","tk-str"].map((k,i)=>themeColor(k,["#8bdcc5","#b5a8fa","#ecc994","#84c9f2","#f3a09b","#86dbc0","#ecc994","#a8d8a0"][i]));}

/* ---- relation diagrams the AI draws for one explanation: its own nodes and edges, not the vault's graph ------------- */
const REL_KINDS={prerequisite:"是…的前提",causes:"导致",part_of:"是…的一部分",contrasts:"对比",example:"例子",related:"相关",uses:"用到",becomes:"变成"};
function relationsGraph(container,d,opts={}){
 if(typeof cytoscape==="undefined"||!container)return null;
 if(container.__cy){try{container.__cy.destroy();}catch(_){}}
 const pal=vizPalette(),groups=[...new Set((d.nodes||[]).map(n=>n.group||""))],color=g=>pal[Math.max(0,groups.indexOf(g||""))%pal.length];
 const text=themeColor("text","#e7edf2"),muted=themeColor("muted","#95a1af"),line=themeColor("subtle","#7e8b99"),panel=themeColor("panel","#121820");
 const ids=new Set(),els=[];
 for(const n of (d.nodes||[]).slice(0,80)){
  const id=String(n.id??n.label);if(!id||ids.has(id))continue;ids.add(id);
  const path=n.ref&&typeof resolveWiki==="function"?resolveWiki(n.ref):null;
  els.push({data:{id,label:String(n.label??id),c:color(n.group),note:n.note||"",path:path||"",group:n.group||""},classes:(path?"linked ":"")+(n.main?"main":"")});
 }
 (d.edges||[]).slice(0,200).forEach((e,i)=>{
  const a=String(e.from??e.source),b=String(e.to??e.target);if(!ids.has(a)||!ids.has(b))return;
  // A long label would lie across the nodes; it is shortened on the line and shown whole when the edge is clicked.
  const full=String(e.label??(REL_KINDS[e.kind]||""));
  els.push({data:{id:"e"+i,source:a,target:b,label:full.length>8?full.slice(0,7)+"…":full,full,note:e.note||""},classes:e.kind||"plain"});
 });
 const style=[
  {selector:"node",style:{"label":"data(label)","shape":"round-rectangle","width":"label","height":"label","padding":"9px","text-valign":"center","text-halign":"center",
   "font-size":12,"font-family":getComputedStyle(document.body).fontFamily,"color":text,"background-color":"data(c)","background-opacity":.16,"border-width":1.5,"border-color":"data(c)",
   "text-wrap":"wrap","text-max-width":"150px"}},
  {selector:"node.main",style:{"border-width":3,"font-weight":700,"font-size":13,"background-opacity":.28}},
  {selector:"node.linked",style:{"underlay-color":"data(c)","underlay-opacity":.12,"underlay-padding":4}},
  {selector:"edge",style:{"width":1.5,"line-color":line,"target-arrow-color":line,"target-arrow-shape":"triangle","arrow-scale":.85,"curve-style":"bezier",
   "label":"data(label)","font-size":10,"color":muted,"text-rotation":"autorotate","text-background-color":panel,"text-background-opacity":.85,"text-background-padding":"2px"}},
  {selector:"edge.causes",style:{"line-color":pal[2],"target-arrow-color":pal[2],"width":2}},
  {selector:"edge.prerequisite",style:{"line-color":pal[0],"target-arrow-color":pal[0]}},
  {selector:"edge.part_of",style:{"line-style":"dotted","target-arrow-shape":"diamond"}},
  {selector:"edge.contrasts",style:{"line-style":"dashed","line-color":pal[4],"target-arrow-shape":"none","source-arrow-shape":"none"}},
  {selector:"edge.related",style:{"line-style":"dashed","target-arrow-shape":"none","opacity":.8}},
  {selector:"edge.example",style:{"line-style":"dotted","line-color":pal[1],"target-arrow-color":pal[1]}},
  {selector:".faded",style:{"opacity":.14}},
  {selector:"node.picked",style:{"border-width":3,"underlay-color":"data(c)","underlay-opacity":.3,"underlay-padding":6}}];
 const tree=["tree","LR","TB"].includes(d.layout)||d.direction;
 const layout=tree?{name:"breadthfirst",directed:true,spacingFactor:1,padding:20,avoidOverlap:true}:
  d.layout==="circle"?{name:"circle",padding:20,avoidOverlap:true}:d.layout==="grid"?{name:"grid",padding:20,avoidOverlap:true}:
  d.layout==="concentric"?{name:"concentric",padding:20,minNodeSpacing:30,concentric:n=>n.hasClass("main")?2:1,levelWidth:()=>1}:
  {name:"cose",animate:false,nodeDimensionsIncludeLabels:true,idealEdgeLength:110,nodeRepulsion:420000,padding:24,numIter:1500};
 const cy=cytoscape({container,elements:els,style,wheelSensitivity:.25,minZoom:.25,maxZoom:2.5,layout});
 // A tree read left to right: the top-down layout turned on its side.
 if(tree&&(d.direction||"").toUpperCase()==="LR"){cy.nodes().positions(n=>({x:n.position("y")*1.25,y:n.position("x")*.9}));cy.fit(undefined,20);}
 // Never so small that the labels cannot be read: past that, the diagram is panned instead (drag the background).
 const readable=()=>{if(cy.zoom()<.72){const c=cy.nodes(".main").length?cy.nodes(".main"):cy.nodes();cy.zoom(.72);cy.center(c);}};
 readable();
 // The canvas takes the height the diagram needs at this zoom (200 to 560 px): no empty band, no cut-off top.
 const bb=cy.elements().boundingBox(),need=Math.round(bb.h*cy.zoom()+48);
 if(opts.fitHeight!==false&&need!==container.clientHeight){container.style.height=Math.max(200,Math.min(560,need))+"px";cy.resize();cy.fit(undefined,20);readable();}
 const say=opts.say||(()=>{});
 cy.on("mouseover","node",e=>{cy.elements().addClass("faded");e.target.closedNeighborhood().removeClass("faded");});
 cy.on("mouseout","node",()=>cy.elements().removeClass("faded"));
 cy.on("tap","node",e=>{
  const n=e.target.data();cy.nodes().removeClass("picked");e.target.addClass("picked");
  const links=e.target.connectedEdges().map(x=>{const s=x.source().data("label"),t=x.target().data("label");return s+" —"+(x.data("full")||"")+"→ "+t;});
  say('<b>'+esc(n.label)+'</b>'+(n.group?' <small>'+esc(n.group)+'</small>':"")+(n.note?'<div class="markdown">'+markdown(n.note)+'</div>':"")+
   (links.length?'<div class="rel-links">'+links.map(l=>'<span>'+esc(l)+'</span>').join("")+'</div>':"")+
   (n.path?button(svg("document",12)+" 打开「"+esc(baseName(n.path).replace(/\.md$/,""))+"」","open-file",'data-path="'+esc(n.path)+'"',"ghost xs"):""));
 });
 cy.on("tap","edge",e=>{const x=e.target;say('<b>'+esc(x.source().data("label"))+'</b> —'+esc(x.data("full")||"")+'→ <b>'+esc(x.target().data("label"))+'</b>'+(x.data("note")?'<div class="markdown">'+markdown(x.data("note"))+'</div>':""));});
 cy.on("tap",e=>{if(e.target===cy){cy.nodes().removeClass("picked");say("");}});
 container.__cy=cy;
 new ResizeObserver(()=>{if(!cy.destroyed()){cy.resize();cy.fit(undefined,20);readable();}}).observe(container);
 return cy;
}
function relationsHtml(d,height){
 const groups=[...new Set((d.nodes||[]).map(n=>n.group||""))].filter(Boolean),pal=vizPalette();
 const kinds=[...new Set((d.edges||[]).map(e=>e.kind).filter(k=>REL_KINDS[k]))];
 return '<div class="rel"><div class="rel-head">'+svg("network",14)+'<b>'+esc(d.title||"关系图")+'</b><span class="grow"></span>'+
  iconButton("refresh","rel-relayout","重新排布")+iconButton("float","rel-zoom","放大看")+'</div>'+
  '<div class="rel-canvas" style="height:'+height+'px"></div>'+
  ((groups.length||kinds.length)?'<div class="rel-legend">'+groups.map((g,i)=>'<span><i style="background:'+pal[i%pal.length]+'"></i>'+esc(g)+'</span>').join("")+
   kinds.map(k=>'<span class="rel-kind k-'+k+'">'+esc(REL_KINDS[k])+'</span>').join("")+'</div>':"")+
  '<div class="rel-note" hidden></div>'+(d.caption?'<div class="rel-caption">'+esc(d.caption)+'</div>':"")+'</div>';
}

/* ---- something to play with: sliders that drive a chart and a few numbers ------------------------------------------------
   Formulas are parsed by a small evaluator of its own: numbers, the parameters, + - * / % ^, comparisons, and a fixed set of
   maths functions. Nothing else can run. */
const EXPR_FN={sin:Math.sin,cos:Math.cos,tan:Math.tan,asin:Math.asin,acos:Math.acos,atan:Math.atan,atan2:Math.atan2,exp:Math.exp,log:Math.log,ln:Math.log,log2:Math.log2,log10:Math.log10,
 sqrt:Math.sqrt,abs:Math.abs,min:Math.min,max:Math.max,pow:Math.pow,floor:Math.floor,ceil:Math.ceil,round:Math.round,sign:Math.sign,tanh:Math.tanh,sinh:Math.sinh,cosh:Math.cosh,
 sigmoid:x=>1/(1+Math.exp(-x)),relu:x=>Math.max(0,x),clamp:(x,a,b)=>Math.min(b,Math.max(a,x))};
const EXPR_CONST={pi:Math.PI,e:Math.E,inf:Infinity};
function compileExpr(src){
 const s=String(src??""),toks=[];let i=0;
 while(i<s.length){
  const c=s[i];
  if(/\s/.test(c)){i++;continue;}
  // Words in quotes, for a readout that names what is happening: eta < 1 ? '单调靠近' : '震荡'.
  if(c==="'"||c==='"'||c==="「"){const end=s.indexOf(c==="「"?"」":c,i+1);if(end<0)throw new Error("引号没有配对");toks.push({t:"s",v:s.slice(i+1,end)});i=end+1;continue;}
  const num=/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));if(num){toks.push({t:"n",v:Number(num[0])});i+=num[0].length;continue;}
  const id=/^[A-Za-z_Ͱ-Ͽ][\wͰ-Ͽ]*/.exec(s.slice(i));if(id){toks.push({t:"id",v:id[0]});i+=id[0].length;continue;}
  const op=/^(<=|>=|==|!=|&&|\|\||\*\*|[-+*/%^()<>,?:!])/.exec(s.slice(i));if(op){toks.push({t:"op",v:op[0]==="**"?"^":op[0]});i+=op[0].length;continue;}
  throw new Error("看不懂的符号「"+c+"」");
 }
 let k=0;const peek=()=>toks[k],take=v=>{const t=toks[k];if(v&&(!t||t.v!==v))throw new Error("这里少了「"+v+"」");k++;return t;};
 const BIN={"||":[1,(a,b)=>a||b],"&&":[2,(a,b)=>a&&b],"==":[3,(a,b)=>+(a===b)],"!=":[3,(a,b)=>+(a!==b)],"<":[4,(a,b)=>+(a<b)],">":[4,(a,b)=>+(a>b)],"<=":[4,(a,b)=>+(a<=b)],">=":[4,(a,b)=>+(a>=b)],
  "+":[5,(a,b)=>a+b],"-":[5,(a,b)=>a-b],"*":[6,(a,b)=>a*b],"/":[6,(a,b)=>a/b],"%":[6,(a,b)=>a%b],"^":[8,(a,b)=>Math.pow(a,b)]};
 const atom=()=>{
  const t=take();if(!t)throw new Error("式子没写完");
  if(t.t==="n"||t.t==="s")return()=>t.v;
  if(t.t==="op"&&t.v==="("){const e=expr(0);take(")");return e;}
  if(t.t==="op"&&(t.v==="-"||t.v==="+"||t.v==="!")){const e=unary();return t.v==="-"?v=>-e(v):t.v==="!"?v=>+!e(v):e;}
  if(t.t==="id"){
   if(peek()?.v==="("){const f=EXPR_FN[t.v];if(!f)throw new Error("没有这个函数："+t.v);take("(");const args=[];if(peek()?.v!==")")do{args.push(expr(0));}while(peek()?.v===","&&take(","));take(")");return v=>f(...args.map(a=>a(v)));}
   if(t.v in EXPR_CONST)return()=>EXPR_CONST[t.v];
   return v=>{if(!(t.v in v))throw new Error("不认识的变量："+t.v);return v[t.v];};
  }
  throw new Error("这里不该出现「"+t.v+"」");
 };
 const unary=()=>{const a=atom();if(peek()?.v==="^"){take();const b=unary();return v=>Math.pow(a(v),b(v));}return a;};
 const expr=min=>{
  let left=unary();
  for(;;){
   const t=peek();if(!t||t.t!=="op")break;
   if(t.v==="?"&&min<=0){take();const a=expr(0);take(":");const b=expr(0);const c=left;left=v=>c(v)?a(v):b(v);continue;}
   const b=BIN[t.v];if(!b||b[0]<min||t.v==="^")break;take();const right=expr(b[0]+1),l=left;left=v=>b[1](l(v),right(v));
  }
  return left;
 };
 const out=expr(0);if(k<toks.length)throw new Error("多出来的「"+toks[k].v+"」");
 return out;
}
function exploreState(d,values){
 const scope={...values},xs=[],xn=d.x?.name||"x",from=Number(d.x?.from??0),to=Number(d.x?.to??10),n=Math.min(2000,Math.max(2,d.x?.points||Math.round((to-from)/(Number(d.x?.step)||1))+1));
 for(let i=0;i<n;i++)xs.push(+(from+(to-from)*i/(n-1)).toFixed(10));
 const series=[];
 for(const s of (d.series||[]).slice(0,6)){
  const y=[];
  if(s.next!=null){
   const init=compileExpr(s.init??0),next=compileExpr(s.next);let cur=init(scope);
   for(let i=0;i<n;i++){y.push(cur);cur=next({...scope,[s.name||"y"]:cur,n:i,[xn]:xs[i]});}
  }else{const f=compileExpr(s.expr??0);for(let i=0;i<n;i++)y.push(f({...scope,[xn]:xs[i],n:i}));}
  series.push({name:s.label||s.name,y:y.map(v=>isFinite(v)?+v.toPrecision(6):null)});
 }
 const reads=(d.readouts||[]).slice(0,8).map(r=>{let v;try{v=compileExpr(r.expr)(scope);}catch(e){v=e.message;}return {label:r.label||r.expr,v:typeof v==="number"?(isFinite(v)?+v.toPrecision(r.digits||4):"∞"):v};});
 return {xs,series,reads};
}
