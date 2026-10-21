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
  if(b.error==="pending"){node.innerHTML='<div class="block-pending">正在生成 '+esc(b.type)+' …</div>';return;}
  const render=BLOCKS[b.type];
  if(b.error||!render){node.innerHTML='<pre class="block-raw">'+esc(b.raw)+'</pre>';return;}
  node.classList.add("block-"+b.type);
  safe(()=>render(b.data||{},node,{...ctx,index:+node.dataset.block}));
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
 let lo=Math.min(0,...ys),hi=Math.max(...ys);if(hi===lo)hi=lo+1;
 const xmin=numericX?Math.min(...xs):0,xmax=numericX?Math.max(...xs):Math.max(1,xs.length-1);
 const X=(v,i)=>P+((numericX?v:i)-xmin)/((xmax-xmin)||1)*(W-2*P),Y=v=>H-P-(v-lo)/(hi-lo)*(H-2*P);
 const colors=["#8bdcc5","#e0be88","#b5a8fa","#f3a09b","#86b8f0","#c9d6e4"];
 let body="";
 series.forEach((s,k)=>{
  const c=colors[k%colors.length];
  if(d.kind==="bar"){const bw=(W-2*P)/n/(series.length+1);s.y.forEach((v,i)=>{body+='<rect x="'+(P+i*(W-2*P)/n+k*bw+bw/2)+'" y="'+Y(Math.max(0,v))+'" width="'+bw+'" height="'+Math.abs(Y(v)-Y(0))+'" fill="'+c+'"><title>'+esc(xs[i])+": "+esc(v)+'</title></rect>';});}
  else if(d.kind==="scatter")s.y.forEach((v,i)=>{body+='<circle cx="'+X(xs[i],i)+'" cy="'+Y(v)+'" r="3.2" fill="'+c+'"><title>'+esc(xs[i])+", "+esc(v)+'</title></circle>';});
  else body+='<polyline fill="none" stroke="'+c+'" stroke-width="2" points="'+s.y.map((v,i)=>X(xs[i],i)+","+Y(v)).join(" ")+'"/>';
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
