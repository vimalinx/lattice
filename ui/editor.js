"use strict";
/* The editor for notes and code, built on CodeMirror 6 (ui/vendor/codemirror.js).
   Markdown gets a live preview like Obsidian's: it renders in place and shows its marks only where the cursor is,
   with [[links]], #tags, checkboxes and embedded images. Code gets highlighting, bracket pairs, Tab out of a closing
   bracket, completion, folding and search. A host element stands in for the old textarea: it carries the same data
   attributes and a `value`, so the panels read and save it the same way. */
const CV=CM.view,CS=CM.state,CL=CM.language,CC=CM.commands,CA=CM.autocomplete,CQ=CM.search,CT=CM.highlight.tags;
const CMInit={};let cmSeq=0;
const IMAGE_RE=/\.(png|jpe?g|gif|svg|webp|bmp)$/i;

/* ---- the look: colours come from the page's own variables, so light and dark both follow ------------------- */
const cmHighlight=CL.HighlightStyle.define([
 {tag:CT.keyword,class:"tk-kw"},{tag:[CT.controlKeyword,CT.moduleKeyword,CT.definitionKeyword,CT.operatorKeyword],class:"tk-kw"},
 {tag:[CT.string,CT.special(CT.string),CT.regexp,CT.character],class:"tk-str"},{tag:[CT.number,CT.bool,CT.null,CT.atom],class:"tk-num"},
 {tag:[CT.comment,CT.lineComment,CT.blockComment,CT.docComment],class:"tk-com"},
 {tag:[CT.function(CT.variableName),CT.function(CT.propertyName),CT.function(CT.definition(CT.variableName)),CT.macroName],class:"tk-fn"},
 {tag:[CT.typeName,CT.className,CT.namespace,CT.standard(CT.typeName)],class:"tk-type"},
 {tag:[CT.definition(CT.variableName),CT.definition(CT.propertyName)],class:"tk-def"},{tag:CT.propertyName,class:"tk-prop"},
 {tag:[CT.operator,CT.derefOperator],class:"tk-op"},{tag:[CT.punctuation,CT.bracket,CT.separator],class:"tk-punc"},
 {tag:[CT.tagName,CT.self,CT.special(CT.variableName)],class:"tk-tag"},{tag:CT.attributeName,class:"tk-attr"},{tag:CT.invalid,class:"tk-bad"},
 {tag:CT.heading,class:"tk-head"},{tag:CT.strong,class:"tk-strong"},{tag:CT.emphasis,class:"tk-em"},{tag:CT.strikethrough,class:"tk-strike"},
 {tag:[CT.link,CT.url],class:"tk-link"},{tag:CT.monospace,class:"tk-mono"},{tag:[CT.processingInstruction,CT.contentSeparator,CT.meta],class:"tk-mark"},
 {tag:CT.quote,class:"tk-quote"},{tag:CT.labelName,class:"tk-label"},
]);
const cmTheme=CV.EditorView.theme({
 "&":{color:"var(--text)",backgroundColor:"transparent",fontSize:"inherit"},
 "&.cm-focused":{outline:"none"},
 ".cm-content":{caretColor:"var(--accent)",padding:"6px 0"},
 ".cm-cursor, .cm-dropCursor":{borderLeftColor:"var(--accent)",borderLeftWidth:"2px"},
 "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":{backgroundColor:"var(--select-bg) !important"},
 ".cm-activeLine":{backgroundColor:"var(--active-line)"},
 ".cm-gutters":{backgroundColor:"transparent",color:"var(--subtle)",border:"none"},
 ".cm-activeLineGutter":{backgroundColor:"transparent",color:"var(--text)"},
 ".cm-foldPlaceholder":{background:"var(--surface)",border:"1px solid var(--line)",color:"var(--muted)"},
 ".cm-matchingBracket":{backgroundColor:"var(--accent-glow)",outline:"1px solid var(--accent)",color:"inherit"},
 ".cm-nonmatchingBracket":{outline:"1px solid var(--red)"},
 ".cm-selectionMatch":{backgroundColor:"var(--accent-glow)"},
 ".cm-searchMatch":{backgroundColor:"rgba(236,201,148,.25)",outline:"1px solid var(--amber)"},
 ".cm-searchMatch.cm-searchMatch-selected":{backgroundColor:"rgba(236,201,148,.5)"},
 ".cm-tooltip":{background:"var(--panel)",border:"1px solid var(--line)",borderRadius:"8px",boxShadow:"var(--shadow)",color:"var(--text)"},
 ".cm-tooltip-autocomplete > ul > li":{padding:"3px 10px"},
 ".cm-tooltip-autocomplete > ul > li[aria-selected]":{background:"var(--accent-glow)",color:"var(--text)"},
 ".cm-completionDetail":{color:"var(--subtle)",fontStyle:"normal",marginLeft:"10px"},
 ".cm-panels":{background:"var(--panel)",color:"var(--text)",borderColor:"var(--line)"},
 ".cm-panels input, .cm-panels button":{fontSize:"12px"},
 ".cm-placeholder":{color:"var(--subtle)"},
});

/* ---- [[links]], ![[embeds]] and #tags, parsed as part of Markdown so code blocks are left alone ------------------- */
const wikiSyntax={
 defineNodes:[{name:"WikiLink",style:CT.link},{name:"WikiEmbed",style:CT.link},{name:"WikiMark",style:CT.processingInstruction},{name:"HashTag",style:CT.labelName}],
 parseInline:[{name:"WikiLink",before:"Link",parse(cx,next,pos){
  const embed=next===33;
  if(embed?cx.char(pos+1)!==91||cx.char(pos+2)!==91:next!==91||cx.char(pos+1)!==91)return -1;
  const open=pos+(embed?3:2);
  for(let i=open;i<cx.end;i++){
   const c=cx.char(i);if(c===10||c===91)return -1;
   if(c===93&&cx.char(i+1)===93)return i===open?-1:cx.addElement(cx.elt(embed?"WikiEmbed":"WikiLink",pos,i+2,[cx.elt("WikiMark",pos,open),cx.elt("WikiMark",i,i+2)]));
  }
  return -1;
 }},{name:"HashTag",parse(cx,next,pos){
  if(next!==35)return -1;
  if(pos>cx.offset&&!/\s/.test(String.fromCharCode(cx.char(pos-1))))return -1;
  let end=pos+1;
  while(end<cx.end){const ch=String.fromCharCode(cx.char(end));if(/[\s#.,;:!?，。；：！？、()（）\[\]{}<>"'`*]/.test(ch))break;end++;}
  if(end===pos+1||/^\d+$/.test(cx.slice(pos+1,end)))return -1;
  return cx.addElement(cx.elt("HashTag",pos,end));
 }}],
};
function wikiParts(inner){const bar=inner.indexOf("|");return {target:(bar<0?inner:inner.slice(0,bar)).split("#")[0].trim(),shown:bar<0?inner:inner.slice(bar+1),bar};}

/* ---- live preview ---------------------------------------------------------------------------------------------------- */
const Refresh=CS.StateEffect.define();
const HIDE=CV.Decoration.replace({});
const mark=cls=>CV.Decoration.mark({class:cls});
const MARKS={em:mark("cm-em"),strong:mark("cm-strong"),strike:mark("cm-strike"),code:mark("cm-icode"),src:mark("cm-linksrc")};
class Bullet extends CV.WidgetType{toDOM(){const s=document.createElement("span");s.className="cm-bullet";s.textContent="•";return s;}eq(){return true;}}
class Rule extends CV.WidgetType{toDOM(){const s=document.createElement("span");s.className="cm-hr";return s;}eq(){return true;}}
class Check extends CV.WidgetType{
 constructor(on,at){super();this.on=on;this.at=at;}
 eq(o){return o.on===this.on&&o.at===this.at;}
 toDOM(view){
  const box=document.createElement("input");box.type="checkbox";box.className="cm-check";box.checked=this.on;
  box.addEventListener("mousedown",e=>{e.preventDefault();view.dispatch({changes:{from:this.at+1,to:this.at+2,insert:this.on?" ":"x"}});});
  return box;
 }
 ignoreEvent(){return true;}
}
const imageCache=new Map();
class Picture extends CV.WidgetType{
 constructor(src,alt,base){super();this.src=src;this.alt=alt;this.base=base;}
 eq(o){return o.src===this.src&&o.alt===this.alt;}
 toDOM(){
  const box=document.createElement("span");box.className="cm-img";const img=document.createElement("img");img.alt=this.alt||"";box.appendChild(img);
  vaultImage(this.src,this.base).then(url=>{if(url)img.src=url;else box.textContent="图片找不到："+this.src;});
  return box;
 }
 ignoreEvent(){return false;}
}
/* An image named in a note: a web or data address as it is, otherwise a file in the vault, next to the note first. */
async function vaultImage(src,base){
 if(/^(https?:|data:)/.test(src))return src;
 const clean=decodeURI(src).replace(/^\.\//,""),dir=String(base||"").split("/").slice(0,-1).join("/");
 for(const path of [dir?dir+"/"+clean:null,clean].filter(Boolean)){
  if(!imageCache.has(path))imageCache.set(path,rpc("file_read",{path}).then(d=>d.image||null).catch(()=>null));
  const url=await imageCache.get(path);if(url)return url;
 }
 return null;
}
function livePreview(opts){
 const build=view=>{
  const st=view.state,doc=st.doc,out=[],focus=view.hasFocus,ranges=st.selection.ranges;
  const near=(from,to)=>focus&&ranges.some(r=>r.from<=to&&r.to>=from);
  const onLine=pos=>{const l=doc.lineAt(pos);return near(l.from,l.to);};
  const hide=(from,to)=>{if(to>from)out.push(HIDE.range(from,to));};
  const line=(pos,cls)=>out.push(CV.Decoration.line({class:cls}).range(doc.lineAt(pos).from));
  const lines=(from,to,cls)=>{for(let p=from;p<=to;){const l=doc.lineAt(p);out.push(CV.Decoration.line({class:cls}).range(l.from));p=l.to+1;}};
  const withSpace=e=>doc.sliceString(e,e+1)===" "?e+1:e;
  const {from,to}=view.viewport;
  CL.syntaxTree(st).iterate({from,to,enter:n=>{
   const name=n.name;let m;
   if((m=/^ATXHeading(\d)$/.exec(name))){line(n.from,"cm-h cm-h"+m[1]);return;}
   if((m=/^SetextHeading(\d)$/.exec(name))){lines(n.from,n.to,"cm-h cm-h"+m[1]);return;}
   switch(name){
    case "HeaderMark":{
     const p=n.node.parent;if(!p||!/^ATX/.test(p.name)||onLine(n.from))return;
     // The opening #s with the space after them; closing #s with the space before them.
     if(n.from===p.from)hide(n.from,withSpace(n.to));else hide(doc.sliceString(n.from-1,n.from)===" "?n.from-1:n.from,n.to);
     return;
    }
    case "Emphasis":out.push(MARKS.em.range(n.from,n.to));return;
    case "StrongEmphasis":out.push(MARKS.strong.range(n.from,n.to));return;
    case "Strikethrough":out.push(MARKS.strike.range(n.from,n.to));return;
    case "InlineCode":out.push(MARKS.code.range(n.from,n.to));return;
    case "EmphasisMark":case "StrikethroughMark":{const p=n.node.parent;if(p&&!near(p.from,p.to))hide(n.from,n.to);return;}
    case "CodeMark":{const p=n.node.parent;if(p?.name==="InlineCode"&&!near(p.from,p.to))hide(n.from,n.to);return;}
    case "Link":{
     const node=n.node,marks=node.getChildren("LinkMark"),url=node.getChild("URL");
     if(marks.length<2)return false;
     const href=url?doc.sliceString(url.from,url.to):"";
     if(near(n.from,n.to)){out.push(MARKS.src.range(n.from,n.to));return false;}
     hide(n.from,marks[0].to);hide(marks[1].from,n.to);
     if(marks[1].from>marks[0].to)out.push(CV.Decoration.mark({class:"cm-link",attributes:{"data-href":href}}).range(marks[0].to,marks[1].from));
     return false;
    }
    case "Image":{
     const node=n.node,url=node.getChild("URL");if(!url||near(n.from,n.to))return false;
     const marks=node.getChildren("LinkMark"),alt=marks.length>=2?doc.sliceString(marks[0].to,marks[1].from):"";
     out.push(CV.Decoration.replace({widget:new Picture(doc.sliceString(url.from,url.to),alt,opts.path)}).range(n.from,n.to));return false;
    }
    case "WikiLink":case "WikiEmbed":{
     const skip=name==="WikiEmbed"?3:2,{target,shown,bar}=wikiParts(doc.sliceString(n.from+skip,n.to-2));
     if(name==="WikiEmbed"&&IMAGE_RE.test(target)&&!near(n.from,n.to)){out.push(CV.Decoration.replace({widget:new Picture(target,shown,opts.path)}).range(n.from,n.to));return false;}
     const cls="cm-wikilink"+(opts.resolve(target)?"":" cm-unresolved");
     if(near(n.from,n.to)){out.push(CV.Decoration.mark({class:cls+" cm-src",attributes:{"data-wiki":target}}).range(n.from,n.to));return false;}
     const start=n.from+skip+(bar<0?0:bar+1);hide(n.from,start);hide(n.to-2,n.to);
     if(n.to-2>start)out.push(CV.Decoration.mark({class:cls,attributes:{"data-wiki":target}}).range(start,n.to-2));
     return false;
    }
    case "HashTag":out.push(CV.Decoration.mark({class:"cm-tag",attributes:{"data-tag":doc.sliceString(n.from+1,n.to)}}).range(n.from,n.to));return;
    case "Blockquote":lines(n.from,n.to,"cm-quote");return;
    case "QuoteMark":if(!onLine(n.from))hide(n.from,withSpace(n.to));return;
    case "ListMark":{
     if(onLine(n.from))return;
     if(n.node.nextSibling?.name==="Task"){hide(n.from,withSpace(n.to));return;}
     if(n.node.parent?.parent?.name==="BulletList")out.push(CV.Decoration.replace({widget:new Bullet()}).range(n.from,n.to));
     return;
    }
    case "TaskMarker":{
     const on=/x/i.test(doc.sliceString(n.from,n.to));if(on)line(n.from,"cm-done");
     if(!onLine(n.from))out.push(CV.Decoration.replace({widget:new Check(on,n.from)}).range(n.from,n.to));return;
    }
    case "HorizontalRule":if(!onLine(n.from))out.push(CV.Decoration.replace({widget:new Rule()}).range(n.from,n.to));return;
    case "FencedCode":lines(n.from,n.to,"cm-codeblock");line(n.from,"cm-codeblock-first");line(n.to,"cm-codeblock-last");return;
    case "CodeBlock":lines(n.from,n.to,"cm-codeblock");return;
    case "Table":lines(n.from,n.to,"cm-table");return false;
   }
  }});
  return CV.Decoration.set(out,true);
 };
 return CV.ViewPlugin.fromClass(class{
  constructor(view){this.decorations=build(view);}
  update(u){if(u.docChanged||u.viewportChanged||u.selectionSet||u.focusChanged||CL.syntaxTree(u.startState)!==CL.syntaxTree(u.state)||u.transactions.some(t=>t.effects.some(e=>e.is(Refresh))))this.decorations=build(u.view);}
 },{decorations:v=>v.decorations});
}
// A click on a rendered link follows it; with the cursor inside, Ctrl + click still does.
function linkClicks(opts){
 return CV.EditorView.domEventHandlers({mousedown(e){
  const t=e.target.closest?.("[data-wiki],[data-href],[data-tag]");if(!t||e.button!==0)return false;
  if(t.classList.contains("cm-src")&&!(e.ctrlKey||e.metaKey))return false;
  e.preventDefault();
  if(t.dataset.wiki!=null)opts.openWiki?.(t.dataset.wiki);else if(t.dataset.href)opts.openHref?.(t.dataset.href);else opts.openTag?.(t.dataset.tag);
  return true;
 }});
}

/* ---- rainbow brackets: each nesting level its own colour, an unmatched closing bracket in red ------------------------- */
const RAINBOW=[0,1,2].map(i=>CV.Decoration.mark({class:"cm-rb"+i})),RB_BAD=CV.Decoration.mark({class:"cm-rb-bad"});
function rainbowBrackets(){
 const build=view=>{
  const st=view.state,{from:vf,to:vt}=view.viewport,start=vt>300000?vf:0,skip=[];
  // Brackets inside strings and comments do not count; the depth is counted from the top of the file.
  CL.syntaxTree(st).iterate({from:start,to:vt,enter:n=>{if(/string|comment|char|regex/i.test(n.type.name)){skip.push([n.from,n.to]);return false;}}});
  const text=st.doc.sliceString(start,vt),out=[],stack=[];
  for(let i=0,k=0;i<text.length;i++){
   const pos=start+i;
   while(k<skip.length&&skip[k][1]<=pos)k++;
   if(k<skip.length&&skip[k][0]<=pos){i=skip[k][1]-start-1;continue;}
   const open="([{".indexOf(text[i]);
   if(open>=0){if(pos>=vf)out.push(RAINBOW[stack.length%3].range(pos,pos+1));stack.push(open);continue;}
   const close=")]}".indexOf(text[i]);if(close<0)continue;
   if(stack.length&&stack[stack.length-1]===close){stack.pop();if(pos>=vf)out.push(RAINBOW[stack.length%3].range(pos,pos+1));}
   else if(pos>=vf)out.push(RB_BAD.range(pos,pos+1));
  }
  return CV.Decoration.set(out,true);
 };
 return CV.ViewPlugin.fromClass(class{
  constructor(view){this.decorations=build(view);}
  update(u){if(u.docChanged||u.viewportChanged||CL.syntaxTree(u.startState)!==CL.syntaxTree(u.state))this.decorations=build(u.view);}
 },{decorations:v=>v.decorations});
}

/* ---- typing help --------------------------------------------------------------------------------------------------- */
// Tab steps over a closing bracket or quote right after the cursor; otherwise it indents.
function tabOut(view){
 const s=view.state.selection;if(s.ranges.some(r=>!r.empty))return false;
 const next=s.ranges.map(r=>{const c=view.state.sliceDoc(r.head,r.head+1);return c&&")]}\"'`".includes(c)?r.head+1:null;});
 if(next.some(x=>x===null))return false;
 view.dispatch({selection:CS.EditorSelection.create(next.map(p=>CS.EditorSelection.cursor(p))),scrollIntoView:true,userEvent:"select"});return true;
}
function tabIndent(markdownMode){
 return view=>{
  const st=view.state;
  if(st.selection.ranges.some(r=>!r.empty))return CC.indentMore(view);
  // In a Markdown list, Tab nests the item, as in Obsidian.
  if(markdownMode&&st.selection.ranges.every(r=>/^\s*([-*+]|\d+[.)])\s/.test(st.doc.lineAt(r.head).text)))return CC.indentMore(view);
  view.dispatch(st.replaceSelection(st.facet(CL.indentUnit)),{scrollIntoView:true,userEvent:"input"});return true;
 };
}
function wrapWith(m){
 return view=>{
  const st=view.state;
  view.dispatch(st.changeByRange(r=>{
   const inner=st.sliceDoc(r.from,r.to),before=st.sliceDoc(r.from-m.length,r.from),after=st.sliceDoc(r.to,r.to+m.length);
   if(before===m&&after===m)return {changes:[{from:r.from-m.length,to:r.from},{from:r.to,to:r.to+m.length}],range:CS.EditorSelection.range(r.from-m.length,r.to-m.length)};
   if(inner.length>=2*m.length&&inner.startsWith(m)&&inner.endsWith(m))return {changes:{from:r.from,to:r.to,insert:inner.slice(m.length,-m.length)},range:CS.EditorSelection.range(r.from,r.to-2*m.length)};
   return {changes:[{from:r.from,insert:m},{from:r.to,insert:m}],range:CS.EditorSelection.range(r.from+m.length,r.to+m.length)};
  }),{userEvent:"input"});
  return true;
 };
}
// Ctrl + Enter on a line: tick or untick its checkbox, or make it one.
function toggleTask(view){
 const st=view.state,changes=[],seen=new Set();
 for(const r of st.selection.ranges){
  const l=st.doc.lineAt(r.head);if(seen.has(l.from))continue;seen.add(l.from);
  const task=/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/.exec(l.text),item=/^(\s*(?:[-*+]|\d+[.)])\s+)/.exec(l.text);
  if(task){const at=l.from+task[1].length+1;changes.push({from:at,to:at+1,insert:task[2]===" "?"x":" "});}
  else if(item)changes.push({from:l.from+item[1].length,insert:"[ ] "});
  else{const lead=/^\s*/.exec(l.text)[0].length;changes.push({from:l.from+lead,insert:"- [ ] "});}
 }
 view.dispatch({changes,userEvent:"input"});return true;
}
function wikiComplete(ctx){
 const m=ctx.matchBefore(/!?\[\[[^\[\]\n|#]*$/);if(!m)return null;
 const from=m.from+m.text.indexOf("[[")+2;
 const seen=new Set(),options=[];
 for(const d of S.data.docs||[]){
  if(seen.has(d.title.toLowerCase()))continue;seen.add(d.title.toLowerCase());
  options.push({label:d.title,detail:(kindName[d.kind]||"")+" · "+d.path.split("/").slice(1,-1).join("/"),type:"text",apply:(view,c,f,t)=>{
   const close=view.state.sliceDoc(t,t+2)==="]]"?"":"]]";
   view.dispatch({changes:{from:f,to:t,insert:c.label+close},selection:{anchor:f+c.label.length+2},userEvent:"input.complete"});
  }});
 }
 return {from,options,validFor:/^[^\[\]\n|#]*$/};
}
let tagCache={at:0,list:[]};
async function knownTags(){if(Date.now()-tagCache.at>15000)tagCache={at:Date.now(),list:await rpc("tags").catch(()=>[])};return tagCache.list;}
async function tagComplete(ctx){
 const m=ctx.matchBefore(/(?:^|\s)#[^\s#]+$/);if(!m)return null;
 const from=m.from+m.text.indexOf("#")+1;
 const tags=await knownTags();
 return {from,options:tags.map(t=>({label:t.tag,detail:t.count+" 篇",type:"keyword"})),validFor:/^[^\s#]*$/};
}
async function insertImages(view,files,opts,at=null){
 for(const f of files){
  const data=await new Promise((ok,bad)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>bad(r.error);r.readAsDataURL(f);});
  const stamp=new Date().toISOString().slice(0,19).replace(/[-:T]/g,"");
  const name=f.name&&f.name!=="image.png"?f.name:"粘贴 "+stamp+"."+((f.type.split("/")[1]||"png").replace("jpeg","jpg").replace("svg+xml","svg"));
  const r=await rpc("attach_data",{name,data});
  const pos=at??view.state.selection.main.head,text="![["+r.path+"]]";
  view.dispatch({changes:{from:pos,insert:text},selection:{anchor:pos+text.length},userEvent:"input"});at=null;
 }
 opts.onAttach?.();
}
function dropAndPaste(opts){
 const images=list=>[...(list||[])].filter(f=>f.type.startsWith("image/"));
 return CV.EditorView.domEventHandlers({
  paste(e,view){const files=images(e.clipboardData?.files);if(!files.length)return false;e.preventDefault();safe(()=>insertImages(view,files,opts));return true;},
  drop(e,view){
   const pos=view.posAtCoords({x:e.clientX,y:e.clientY});
   // A note dragged in from the sidebar becomes a link to it.
   const title=e.dataTransfer?.getData("text/lattice-title");
   if(title&&pos!=null){e.preventDefault();const text="[["+title+"]]";view.dispatch({changes:{from:pos,insert:text},selection:{anchor:pos+text.length},userEvent:"input.drop"});view.focus();return true;}
   const files=images(e.dataTransfer?.files);if(!files.length)return false;
   e.preventDefault();safe(()=>insertImages(view,files,opts,pos));return true;
  },
 });
}

/* ---- making one ------------------------------------------------------------------------------------------------------ */
/* opts: markdown (bool), live (render in place), filename (picks the code language), readonly, placeholder, path (for images),
   onChange(host), onCursor(view), keys (extra key bindings, highest precedence). */
function editorHost(text,attrs,opts={}){
 const id=++cmSeq;CMInit[id]={text:String(text??""),opts};
 let cls="cm-host";attrs=String(attrs||"").replace(/\bclass="([^"]*)"/,(_,c)=>{cls+=" "+c;return "";});
 return '<div class="'+cls+'" data-cm="'+id+'" '+attrs+'></div>';
}
function mountEditors(root){
 for(const host of all(".cm-host[data-cm]",root)){
  const init=CMInit[host.dataset.cm];if(!init||host.cmView)continue;delete CMInit[host.dataset.cm];
  host.cmView=createEditor(host,init.text,init.opts);
  Object.defineProperty(host,"value",{get:()=>host.cmView.state.doc.toString(),configurable:true});
 }
}
function destroyEditors(root){all(".cm-host",root).forEach(h=>{h.cmView?.destroy();h.cmView=null;});}
function refreshEditors(){all(".cm-host").forEach(h=>h.cmView?.dispatch({effects:Refresh.of(null)}));}
function createEditor(host,text,opts){
 const md=!!opts.markdown,lang=new CS.Compartment();
 const keys=[
  ...(opts.keys||[]),
  {key:"Tab",run:CA.acceptCompletion},{key:"Tab",run:tabOut},{key:"Tab",run:tabIndent(md),shift:CC.indentLess},
  ...(md?[{key:"Mod-b",run:wrapWith("**")},{key:"Mod-i",run:wrapWith("*")},{key:"Mod-Shift-x",run:wrapWith("~~")},{key:"Mod-`",run:wrapWith("`")},{key:"Mod-Enter",run:toggleTask}]:[]),
  ...CA.closeBracketsKeymap,...CC.defaultKeymap,...CQ.searchKeymap,...CC.historyKeymap,...CL.foldKeymap,
 ];
 const ext=[
  CC.history(),CV.drawSelection(),CV.dropCursor(),CS.EditorState.allowMultipleSelections.of(true),CL.indentOnInput(),CL.bracketMatching(),
  CA.closeBrackets(),CQ.highlightSelectionMatches(),CV.rectangularSelection(),CV.crosshairCursor(),CQ.search({top:true}),
  CL.indentUnit.of("    "),CS.EditorState.tabSize.of(4),
  CS.Prec.highest(CV.keymap.of(keys)),CL.syntaxHighlighting(cmHighlight),cmTheme,...(md?[lang.of([])]:[]),
  CV.EditorView.updateListener.of(u=>{if(u.docChanged)opts.onChange?.(host);if(u.selectionSet||u.docChanged)opts.onCursor?.(u.view);}),
 ];
 if(opts.placeholder)ext.push(CV.placeholder(opts.placeholder));
 if(opts.readonly)ext.push(CS.EditorState.readOnly.of(true));
 if(md){
  ext.push(CV.EditorView.lineWrapping,CA.autocompletion({override:[wikiComplete,tagComplete],icons:false}),dropAndPaste(opts),linkClicks(opts),
   CV.EditorView.contentAttributes.of({spellcheck:"false"}));
  if(opts.live)ext.push(livePreview(opts));
 }else{
  if(opts.gutters!==false)ext.push(CV.lineNumbers(),CL.foldGutter(),CV.highlightActiveLineGutter());
  ext.push(CV.highlightActiveLine(),CA.autocompletion({icons:false}),rainbowBrackets());
  if(opts.wrap)ext.push(CV.EditorView.lineWrapping);
 }
 // Words already in the file, for languages that do not complete anything themselves.
 const words=CS.EditorState.languageData.of(()=>[{autocomplete:CA.completeAnyWord}]);
 if(!md)ext.push(lang.of(words));
 const view=new CV.EditorView({state:CS.EditorState.create({doc:text,extensions:ext}),parent:host});
 host.classList.toggle("cm-md",md);host.classList.toggle("cm-live",md&&!!opts.live);
 const language=md?CM.markdown({base:CM.markdownLanguage,codeLanguages:CM.languages,extensions:[wikiSyntax]}):null;
 if(language)view.dispatch({effects:lang.reconfigure(language)});
 else if(opts.filename){
  const desc=CL.LanguageDescription.matchFilename(CM.languages,opts.filename)||CL.LanguageDescription.matchLanguageName(CM.languages,opts.language||"",true);
  if(desc)desc.load().then(sup=>{
   if(!view.dom.isConnected&&!host.cmView)return;
   const own=CS.EditorState.create({extensions:sup}).languageDataAt("autocomplete",0).length>0;
   view.dispatch({effects:lang.reconfigure(own?sup:[sup,words])});
  }).catch(()=>{});
 }
 return view;
}
/* Helpers the panels use in place of textarea calls. */
function editorIn(root,field){const h=field?root?.querySelector('.cm-host[data-field="'+field+'"]'):root?.querySelector(".cm-host");return h?.cmView||null;}
function focusEditor(root,end=false){const v=editorIn(root);if(!v)return;v.focus();if(end)v.dispatch({selection:{anchor:v.state.doc.length}});}
function editorGoto(view,at){
 const doc=view.state.doc,text=doc.toString();let from=0,to=0;
 if(at.highlight&&text.includes(at.highlight)){from=text.indexOf(at.highlight);to=from+at.highlight.length;}
 else if(at.line){const l=doc.line(Math.min(Math.max(1,at.line),doc.lines));from=l.from;to=at.select===false?l.from:l.to;}
 view.focus();view.dispatch({selection:{anchor:from,head:to},effects:CV.EditorView.scrollIntoView(from,{y:"center"})});
}
// Which lines are on screen, for the agents' screen().
function editorViewport(view){
 const box=view.dom.closest("[data-keep-scroll]")||view.scrollDOM,r=box.getBoundingClientRect(),top=view.documentTop;
 const a=view.lineBlockAtHeight(Math.max(0,r.top-top)),b=view.lineBlockAtHeight(Math.max(0,r.bottom-top));
 return {from:view.state.doc.lineAt(a.from).number,to:view.state.doc.lineAt(b.from).number,lines:view.state.doc.lines};
}
