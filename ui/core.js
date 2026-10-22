"use strict";
/* Lattice UI core: no remote services; all data passes through QWebChannel. */
const S={bridge:null,ui:{theme:"dark",side:{width:270,closed:[]},spaces:[]},data:null,config:null,toastTimer:null};
const el=s=>document.querySelector(s);
const all=(s,root=document)=>Array.from(root.querySelectorAll(s));
function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function h(html){const t=document.createElement("template");t.innerHTML=html.trim();return t.content.firstElementChild;}
function fmtDate(iso,full=false){
 if(!iso)return "—";
 const d=new Date(iso);if(Number.isNaN(d.getTime()))return String(iso);
 return full?d.toLocaleString("zh-CN",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):d.toLocaleDateString("zh-CN",{month:"short",day:"numeric"});
}
function shorten(t,n=70){t=String(t||"").replace(/\s+/g," ");return t.length>n?t.slice(0,n)+"…":t;}
function baseName(p){return String(p||"").split("/").pop();}
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
  list:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  star:'<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  sort:'<path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3"/>',
  folderplus:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6m-3-3h6"/>',
  notenew:'<path d="M6 2h8l5 5v14a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M14 2v6h6M12 11v6m-3-3h6"/>',
  fold:'<path d="m7 20 5-5 5 5M7 4l5 5 5-5"/>',
  collapse:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-11-3 3 3 3"/>',
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
  more:'<path d="M12 5v.01M12 12v.01M12 19v.01"/>',
  sliders:'<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  float:'<rect x="3" y="8" width="13" height="13" rx="2"/><path d="M8 8V4h13v13h-5"/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15m6-12v15"/>',
  card:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 13h6"/>'
 };
 return '<svg viewBox="0 0 24 24" width="'+esc(size)+'" height="'+esc(size)+'" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.spark)+'</svg>';
}
function logo(){
 return '<svg viewBox="0 0 128 128" fill="none" aria-hidden="true"><path d="M26 90 55 31 91 85M55 31l43 25M26 90l72-34" stroke="#83e2c7" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="55" cy="31" r="9" fill="#eef9f4"/><circle cx="26" cy="90" r="9" fill="#eef9f4"/><circle cx="91" cy="85" r="9" fill="#eef9f4"/><circle cx="98" cy="56" r="8" fill="#eef9f4"/></svg>';
}
/* ```mermaid fenced blocks render as diagrams instead of code. */
// CommonMark does not open **bold** between a CJK character and punctuation (就是**「…」**的), which Chinese replies do all the time.
marked.use({extensions:[{name:"strongCjk",level:"inline",start(src){const i=src.indexOf("**");return i<0?undefined:i;},
 tokenizer(src,tokens){
  const prev=tokens?.length?tokens[tokens.length-1].raw.slice(-1):"",m=/^\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(src);
  if(!m||/[A-Za-z0-9]/.test(prev)||/[A-Za-z0-9]/.test(src[m[0].length]||""))return;
  if(/[\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]/.test(m[0]))return {type:"strong",raw:m[0],text:m[1],tokens:this.lexer.inlineTokens(m[1])};}}]});
marked.use({renderer:{code(t){if((t.lang||"").trim().toLowerCase()==="mermaid")return '<div class="mermaid">'+esc(t.text)+'</div>';return false;}}});
let _mmTimer=null,_mmSeq=0,_mmInited=false;
function scheduleMermaid(){clearTimeout(_mmTimer);_mmTimer=setTimeout(runMermaid,60);}
async function runMermaid(){
 if(typeof mermaid==="undefined")return;
 if(!_mmInited){_mmInited=true;try{mermaid.initialize({startOnLoad:false,theme:S.ui.theme==="dark"?"dark":"default",securityLevel:"strict",fontFamily:"inherit"});}catch(_){return;}}
 for(const n of all(".mermaid:not([data-processed='true'])")){
  n.dataset.processed="true";const src=n.textContent;
  try{const out=await mermaid.render("mm"+(++_mmSeq),src);n.innerHTML=out.svg;}
  catch(_){n.innerHTML='<pre class="mermaid-error">'+esc(src)+'</pre><small class="muted">图表语法未能解析</small>';}
 }
}
/* Maths, drawn by KaTeX (ui/vendor/katex): $…$ and \(…\) in a line, $$…$$ and \[…\] on their own. A $ that opens
   before a space, or closes before a digit, is a price, not maths. Drawings are cached, so streaming replies stay quick. */
const MATH_RE=/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?=[^\s$])((?:\\\$|[^$\n])+?)(?<=[^\s\\])\$(?![\d$])/g;
const texCache=new Map();
function texHtml(tex,display){
 const key=(display?"D":"I")+tex;if(texCache.has(key))return texCache.get(key);
 let out;
 try{out=typeof katex==="undefined"?'<code>'+esc(tex)+'</code>':katex.renderToString(tex,{displayMode:display,throwOnError:false,strict:"ignore",output:"html"});}
 catch(_){out='<code class="math-error" title="公式写错了">'+esc(tex)+'</code>';}
 if(texCache.size>800)texCache.clear();texCache.set(key,out);return out;
}
function markdown(text){
 const src=String(text||""),codes=[],maths=[];
 const masked=src.replace(/(`+)([\s\S]*?)\1/g,m=>{codes.push(m);return "\u0000"+(codes.length-1)+"\u0000";})
  .replace(MATH_RE,(m,a,b,c,d)=>{maths.push({tex:a??b??c??d,display:a!=null||b!=null});return "\uE000"+(maths.length-1)+"\uE001";});
 // [[target|shown]] links, ![[image]] and ![[note]] embeds, #tags; what comes from the vault is filled in afterwards (hydrateVault).
 const linked=masked.replace(/(!?)\[\[([^\]\n]+)\]\]/g,(_,bang,inner)=>{
   const bar=inner.indexOf("|"),target=(bar<0?inner:inner.slice(0,bar)).split("#")[0].trim(),shown=bar<0?inner:inner.slice(bar+1);
   if(bang&&/\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(target))return '<img data-vault-src="'+esc(target)+'" alt="'+esc(bar<0?"":shown)+'"/>';
   if(bang)return '<span class="embed" data-embed="'+esc(bar<0?inner:inner.slice(0,bar))+'"></span>';
   return '<a class="wikilink" data-wiki="'+esc(target)+'">'+esc(shown)+'</a>';})
  .replace(/(^|[\s(（])#([^\s#.,;:!?，。；：！？、()（）\[\]{}<>"'`*]+)/gm,(m,pre,tag)=>/^\d+$/.test(tag)?m:pre+'<a class="tag" data-tag="'+esc(tag)+'">#'+esc(tag)+'</a>')
  .replace(/\u0000(\d+)\u0000/g,(_,i)=>codes[+i]);
 try{
  // A table scrolls inside its own frame when it is wider than the text.
  const out=DOMPurify.sanitize(marked.parse(linked,{breaks:true,gfm:true}),{ADD_ATTR:["data-wiki","data-tag","data-vault-src","data-embed"]}).replace(/<table>/g,'<div class="table-wrap"><table>').replace(/<\/table>/g,"</table></div>")
   .replace(/\uE000(\d+)\uE001/g,(_,i)=>maths[+i]?texHtml(maths[+i].tex.trim(),maths[+i].display):"");if(out.includes('class="mermaid"'))scheduleMermaid();return out;}
 catch(_){return '<pre>'+esc(text)+'</pre>';}
}
/* What rendered Markdown names in the vault: images, loaded through the backend (the page cannot read the vault),
   and embedded notes (notes.js). depth counts embeds inside embeds. */
function hydrateVault(root,base,depth=0){
 if(!root)return;
 if(typeof fillEmbed==="function")for(const e of all(".embed[data-embed]:not([data-filled])",root)){e.dataset.filled="1";fillEmbed(e,base,depth);}
 if(typeof vaultImage!=="function")return;
 for(const img of all("img",root)){
  const src=img.dataset.vaultSrc||(img.getAttribute("src")&&!/^(https?:|data:|qrc:|blob:)/.test(img.getAttribute("src"))?img.getAttribute("src"):null);
  if(!src||img.dataset.hydrated)continue;img.dataset.hydrated="1";img.removeAttribute("src");
  vaultImage(src,base).then(url=>{if(url)img.src=url;else img.alt="图片找不到："+src;});
 }
}
async function rpc(method,args={},timeout=240000){
 if(!S.bridge)throw new Error("本地桌面桥尚未连接");
 return await new Promise((resolve,reject)=>{
  let done=false;
  const timer=timeout>0?setTimeout(()=>{if(!done){done=true;reject(new Error("本地调用超时："+method));}},timeout):null;
  S.bridge.request(JSON.stringify(Object.assign({method},args)),raw=>{
   if(done)return;done=true;if(timer)clearTimeout(timer);
   try{const r=JSON.parse(raw);if(r.ok)resolve(r.data);else{const e=new Error(r.error||"未知错误");e.conflict=!!r.conflict;reject(e);}}catch(err){reject(err);}
  });
 });
}
function toast(text,type="info"){
 const box=el("#toast");if(!box)return;
 box.textContent=text;box.className="visible"+(type==="error"?" error":"");
 clearTimeout(S.toastTimer);S.toastTimer=setTimeout(()=>box.className="",3800);
}
async function safe(fn){try{return await fn();}catch(e){console.error(e);toast(e.message||String(e),"error");return null;}}
function button(label,action,attrs="",variant=""){return '<button class="btn '+variant+'" data-action="'+esc(action)+'" '+attrs+'>'+label+'</button>';}
function iconButton(icon,action,title,attrs=""){return '<button class="icon" data-action="'+esc(action)+'" title="'+esc(title)+'" aria-label="'+esc(title)+'" '+attrs+'>'+svg(icon,15)+'</button>';}
function modal(content,size=""){
 el("#overlays").innerHTML='<div class="modal-backdrop" data-dismiss="1"><div class="modal '+size+'" role="dialog" aria-modal="true">'+content+'</div></div>';
 return el("#overlays .modal");
}
function closeModal(){el("#overlays").innerHTML="";}
/* The program's own question box instead of the system's confirm() and prompt(): same look as the rest, Enter to agree,
   Esc or a click outside to cancel. It sits above any open window, so a question asked from one does not close it. */
function dialog({title,message="",ok="确定",cancel="取消",danger=false,input=null}){
 return new Promise(done=>{
  const box=h('<div class="dialog-backdrop"><div class="dialog'+(danger?" danger":"")+'" role="alertdialog" aria-modal="true">'+
   (title?'<h3>'+esc(title)+'</h3>':"")+(message?'<p>'+esc(message)+'</p>':"")+
   (input?'<input class="dialog-input" value="'+esc(input.value||"")+'" placeholder="'+esc(input.placeholder||"")+'" spellcheck="false"/>'+(input.hint?'<small>'+esc(input.hint)+'</small>':""):"")+
   '<div class="dialog-actions"><button class="btn ghost" data-answer="no">'+esc(cancel)+'</button><button class="btn '+(danger?"danger":"primary")+'" data-answer="yes">'+esc(ok)+'</button></div></div></div>');
  const field=box.querySelector(".dialog-input");
  const finish=yes=>{document.removeEventListener("keydown",keys,true);box.classList.add("leaving");setTimeout(()=>box.remove(),120);
   done(input?(yes?field.value.trim()||null:null):yes);};
  const keys=e=>{
   if(e.key==="Escape"){e.preventDefault();e.stopPropagation();finish(false);}
   else if(e.key==="Enter"&&!e.isComposing&&e.keyCode!==229){e.preventDefault();e.stopPropagation();finish(true);}
  };
  box.addEventListener("mousedown",e=>{if(e.target===box)finish(false);});
  box.addEventListener("click",e=>{const b=e.target.closest("[data-answer]");if(b)finish(b.dataset.answer==="yes");});
  document.addEventListener("keydown",keys,true);document.body.appendChild(box);
  requestAnimationFrame(()=>{if(field){field.focus();const dot=field.value.lastIndexOf(".");field.setSelectionRange(0,input.selectStem&&dot>0?dot:field.value.length);}else box.querySelector('[data-answer="yes"]').focus();});
 });
}
function ask(message,opts={}){return dialog({message,...opts});}
function askText(title,value="",opts={}){return dialog({title,input:{value,...opts},ok:opts.ok||"好"});}
function modalHead(title){return '<div class="modal-top"><h2>'+esc(title)+'</h2>'+iconButton("close","modal-close","关闭")+'</div>';}
function emptyState(icon,title,desc){return '<div class="empty"><div class="empty-icon">'+svg(icon,30)+'</div><h3>'+esc(title)+'</h3><p>'+esc(desc)+'</p></div>';}
function stripAnsi(t){return String(t||"").replace(/\x1b\[[0-9;]*m/g,"");}
function joined(v){return Array.isArray(v)?v.join(""):String(v||"");}
/* Run and kernel outputs share one shape (nbformat outputs). Kernel HTML is sanitized, never executed. */
function outputHtml(outputs){
 return (outputs||[]).map(o=>{
  if(o.output_type==="stream")return '<pre class="out-text'+(o.name==="stderr"?" stderr":"")+'">'+esc(stripAnsi(joined(o.text)))+'</pre>';
  if(o.output_type==="error")return '<pre class="out-error">'+esc(stripAnsi((o.traceback||[]).length?o.traceback.join("\n"):(o.ename+": "+o.evalue)))+'</pre>';
  const d=o.data||{};
  if(d["image/png"])return '<img class="out-image" alt="运行输出的图像" src="data:image/png;base64,'+esc(joined(d["image/png"]))+'"/>';
  if(d["image/jpeg"])return '<img class="out-image" alt="运行输出的图像" src="data:image/jpeg;base64,'+esc(joined(d["image/jpeg"]))+'"/>';
  if(d["text/html"])return '<div class="out-html">'+DOMPurify.sanitize(joined(d["text/html"]),{ALLOWED_TAGS:["table","thead","tbody","tr","td","th","div","span","p","b","strong","em","br","pre","code"],ALLOWED_ATTR:["colspan","rowspan"]})+'</div>';
  if(d["text/markdown"])return '<div class="markdown">'+markdown(joined(d["text/markdown"]))+'</div>';
  return d["text/plain"]?'<pre class="out-text">'+esc(joined(d["text/plain"]))+'</pre>':"";
 }).join("");
}
const stageName={suggested:"待探索",seen:"接触过",explained:"能解释",applied:"能应用"};
const stageColor={suggested:"#5b6675",seen:"#e0be88",explained:"#b5a8fa",applied:"#83e2c7"};
const linkName={prerequisite:"是前置",part_of:"是一部分",related:"有关联",applies_to:"应用于",contrasts:"对比",explains:"解释了",branch_of:"分支自",mentions:"提到"};
const kindName={topic:"主题",card:"知识卡",lesson:"课程",note:"笔记",insight:"薄弱点",notebook:"实验笔记",file:"文件"};
const journalName={asked:"提问",answered:"作答",judged:"AI 判断",explained:"讲解",ran:"运行",viewed:"查看",wrote:"写作",staged:"理解阶段",reviewed:"回顾",detour:"岔开",bridged:"接回主干",insight:"薄弱点",organized:"整理",searched:"联网",installed:"装包",action:"AI 动作",undo:"撤销"};
function who(actor){return actor==="me"?"我":({tutor:"主会话",flash:"快答",coach:"练习教练",organizer:"整理",lattice:"Lattice",app:"Lattice"})[actor]||actor;}
