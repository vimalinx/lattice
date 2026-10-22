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
 defineNodes:[{name:"WikiLink",style:CT.link},{name:"WikiEmbed",style:CT.link},{name:"WikiMark",style:CT.processingInstruction},{name:"HashTag",style:CT.labelName},
  {name:"InlineMath",style:CT.special(CT.string)},{name:"DisplayMath",style:CT.special(CT.string)}],
 parseInline:[{name:"Math",before:"Escape",parse(cx,next,pos){
  // $…$ and \(…\) in a line; $$…$$ and \[…\] when they open and close on the same line (longer ones: mathBlocks).
  const c1=cx.char(pos+1),line=i=>i<cx.end&&cx.char(i)!==10;
  const close=(from,a,b)=>{for(let i=from;line(i);i++){if(cx.char(i)===92&&a!==92){i++;continue;}if(cx.char(i)===a&&(b==null||cx.char(i+1)===b))return i;}return -1;};
  if(next===36&&c1===36){const e=close(pos+2,36,36);return e>pos+2?cx.addElement(cx.elt("DisplayMath",pos,e+2)):-1;}
  if(next===92&&(c1===40||c1===91)){const e=close(pos+2,92,c1===40?41:93);return e>pos+2?cx.addElement(cx.elt(c1===40?"InlineMath":"DisplayMath",pos,e+2)):-1;}
  if(next!==36||c1===32||c1===9||c1<0||(pos>cx.offset&&/[\w$\\]/.test(String.fromCharCode(cx.char(pos-1)))))return -1;
  for(let i=pos+1;line(i);i++){
   const ch=cx.char(i);if(ch===92){i++;continue;}
   if(ch===36){const prev=cx.char(i-1),after=cx.char(i+1);if(i===pos+1||prev===32||prev===9||(after>=48&&after<=57))return -1;return cx.addElement(cx.elt("InlineMath",pos,i+1));}
  }
  return -1;
 }},{name:"WikiLink",before:"Link",parse(cx,next,pos){
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
const MARKS={em:mark("cm-em"),strong:mark("cm-strong"),strike:mark("cm-strike"),code:mark("cm-icode"),src:mark("cm-linksrc"),math:mark("cm-mathsrc")};
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
class Embed extends CV.WidgetType{
 constructor(target,base,at,version){super();this.target=target;this.base=base;this.at=at;this.version=version;}
 eq(o){return o.target===this.target&&o.at===this.at&&o.version===this.version;}
 toDOM(view){
  const box=document.createElement("span");box.className="embed cm-embed";box.dataset.embed=this.target;box.dataset.filled="1";
  fillEmbed(box,this.base,0);
  // Links inside follow on click; anywhere else puts the cursor in the ![[…]] to change it.
  box.addEventListener("mousedown",e=>{if(e.button!==0||e.target.closest("a"))return;e.preventDefault();view.focus();view.dispatch({selection:{anchor:this.at}});});
  return box;
 }
 ignoreEvent(){return true;}
}
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
  const {from,to}=view.viewport,fm=frontmatter(doc),blocks=fm?[...mathBlocks(st),{from:fm.from,to:fm.to}]:mathBlocks(st);
  CL.syntaxTree(st).iterate({from,to,enter:n=>{
   const name=n.name;let m;
   // Inside a formula nothing is Markdown: no bold, no hidden marks.
   if(name!=="Document"&&blocks.some(b=>n.from>=b.from&&n.to<=b.to))return false;
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
     if(name==="WikiEmbed"&&!near(n.from,n.to)){
      const inner=doc.sliceString(n.from+3,n.to-2),bar2=inner.indexOf("|");
      out.push(CV.Decoration.replace({widget:new Embed((bar2<0?inner:inner.slice(0,bar2)).trim(),opts.path,n.from+3,typeof Embeds==="undefined"?0:Embeds.version)}).range(n.from,n.to));return false;
     }
     const cls="cm-wikilink"+(opts.resolve(target)?"":" cm-unresolved");
     if(near(n.from,n.to)){out.push(CV.Decoration.mark({class:cls+" cm-src",attributes:{"data-wiki":target}}).range(n.from,n.to));return false;}
     const start=n.from+skip+(bar<0?0:bar+1);hide(n.from,start);hide(n.to-2,n.to);
     if(n.to-2>start)out.push(CV.Decoration.mark({class:cls,attributes:{"data-wiki":target}}).range(start,n.to-2));
     return false;
    }
    case "InlineMath":case "DisplayMath":{
     if(near(n.from,n.to)){out.push(MARKS.math.range(n.from,n.to));return false;}
     out.push(CV.Decoration.replace({widget:new Formula(texOf(doc.sliceString(n.from,n.to)),name==="DisplayMath",n.from+1)}).range(n.from,n.to));return false;
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
/* A file's own attributes (the YAML between --- lines at the top, as in SKILL.md): shown as a small table of
   properties until the cursor goes in, and never read as Markdown (its --- would make the line above a heading). */
function frontmatter(doc){
 if(doc.lines<2||doc.line(1).text.trim()!=="---")return null;
 for(let i=2;i<=Math.min(doc.lines,300);i++){const t=doc.line(i).text.trim();if(t==="---"||t==="...")return {from:0,to:doc.line(i).to,last:i};}
 return null;
}
function propsHtml(yaml){
 const rows=String(yaml).split("\n").map(l=>/^([\w.-]+):\s*(.*)$/.exec(l)).filter(Boolean);
 return '<div class="props">'+rows.map(([,k,v])=>'<div class="prop"><span>'+esc(k)+'</span><b>'+esc(v.replace(/^\[|\]$/g,"").replace(/^["']|["']$/g,""))+'</b></div>').join("")+'</div>';
}
class Props extends CV.WidgetType{
 constructor(yaml){super();this.yaml=yaml;}
 eq(o){return o.yaml===this.yaml;}
 toDOM(view){
  const box=document.createElement("div");box.className="cm-props";box.innerHTML=propsHtml(this.yaml);
  box.addEventListener("mousedown",e=>{if(e.button!==0)return;e.preventDefault();view.focus();view.dispatch({selection:{anchor:Math.min(4,view.state.doc.length)}});});
  return box;
 }
 ignoreEvent(){return true;}
}
function propsPreview(){
 const build=state=>{
  const fm=frontmatter(state.doc);if(!fm)return CV.Decoration.none;
  // The cursor a new editor starts with (at the very top) does not count as being inside.
  if(state.selection.ranges.some(r=>r.from<=fm.to&&r.to>0))return CV.Decoration.set(Array.from({length:fm.last},(_,i)=>CV.Decoration.line({class:"cm-fm"}).range(state.doc.line(i+1).from)));
  return CV.Decoration.set([CV.Decoration.replace({widget:new Props(state.doc.sliceString(state.doc.line(2).from,state.doc.line(fm.last-1).to)),block:true}).range(fm.from,fm.to)]);
 };
 return CS.StateField.define({create:build,update(deco,tr){return tr.docChanged||tr.selection?build(tr.state):deco;},provide:f=>CV.EditorView.decorations.from(f)});
}
/* Maths renders as maths until the cursor goes into it; a click puts the cursor in its source. */
class Formula extends CV.WidgetType{
 constructor(tex,display,at){super();this.tex=tex;this.display=display;this.at=at;}
 eq(o){return o.tex===this.tex&&o.display===this.display&&o.at===this.at;}
 toDOM(view){
  const box=document.createElement(this.display?"div":"span");box.className=this.display?"cm-math-block":"cm-math";box.innerHTML=texHtml(this.tex,this.display);
  box.addEventListener("mousedown",e=>{if(e.button!==0)return;e.preventDefault();view.focus();view.dispatch({selection:{anchor:this.at}});});
  return box;
 }
 ignoreEvent(){return true;}
}
function texOf(src){
 for(const [a,b] of [["$$","$$"],["\\[","\\]"],["\\(","\\)"],["$","$"]])if(src.startsWith(a)&&src.endsWith(b)&&src.length>=a.length+b.length)return src.slice(a.length,src.length-b.length).trim();
 return src;
}
// $$ (or \[) on a line of its own, down to the line that closes it, outside code: display maths over several lines.
const blockCache=new WeakMap();
function mathBlocks(state){
 if(blockCache.has(state.doc))return blockCache.get(state.doc);
 const doc=state.doc,tree=CL.syntaxTree(state),out=[];
 const inCode=pos=>{for(let n=tree.resolveInner(pos,1);n;n=n.parent)if(/^(FencedCode|CodeBlock|InlineCode)$/.test(n.name))return true;return false;};
 for(let i=1;i<=doc.lines;i++){
  const l=doc.line(i),t=l.text.trim(),open=t.startsWith("$$")?"$$":t.startsWith("\\[")?"\\[":null;
  if(!open||t.length>2&&t.endsWith(open==="$$"?"$$":"\\]")&&t!==open)continue;
  if(inCode(l.from))continue;
  const shut=open==="$$"?"$$":"\\]";
  for(let j=i+1;j<=doc.lines&&j<i+200;j++){
   const e=doc.line(j);
   if(e.text.trim().endsWith(shut)){out.push({from:l.from,to:e.to,tex:doc.sliceString(l.from,e.to).trim()});i=j;break;}
  }
 }
 blockCache.set(state.doc,out);return out;
}
function mathPreview(){
 const build=state=>{
  const sel=state.selection.ranges,out=[];
  for(const b of mathBlocks(state))if(!sel.some(r=>r.from<=b.to&&r.to>=b.from))
   out.push(CV.Decoration.replace({widget:new Formula(texOf(b.tex),true,Math.min(b.from+3,b.to)),block:true}).range(b.from,b.to));
  return CV.Decoration.set(out);
 };
 return CS.StateField.define({
  create:build,
  update(deco,tr){return tr.docChanged||tr.selection||CL.syntaxTree(tr.startState)!==CL.syntaxTree(tr.state)?build(tr.state):deco;},
  provide:f=>CV.EditorView.decorations.from(f),
 });
}
/* Tables render as tables until the cursor goes into them; a click on a cell puts the cursor in that cell's text.
   They span lines, so they come from a state field (a view plugin may not replace line breaks). */
function cellStart(line,col){
 const t=line.text;let i=(/^\s*\|?/.exec(t)||[""])[0].length,n=0;
 while(n<col&&i<t.length){if(t[i]==="\\"){i+=2;continue;}if(t[i]==="|")n++;i++;}
 while(i<t.length&&t[i]===" ")i++;
 return line.from+Math.min(i,t.length);
}
/* ---- tables, edited in place cell by cell (as in Obsidian) ----------------------------------------------------------------
   The table is kept as rows of plain cell text; every change is written back to the Markdown as an aligned table, so the
   file stays an ordinary table and undo works on it. The cursor in a cell edits that cell's own Markdown. */
const WIDE=/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
function textWidth(s){let w=0;for(const ch of String(s))w+=WIDE.test(ch)?2:1;return w;}
function splitRow(line){
 let t=String(line).trim();if(t.startsWith("|"))t=t.slice(1);if(t.endsWith("|")&&!t.endsWith("\\|"))t=t.slice(0,-1);
 const cells=[];let cur="";
 for(let i=0;i<t.length;i++){const ch=t[i];if(ch==="\\"&&t[i+1]==="|"){cur+="|";i++;continue;}if(ch==="|"){cells.push(cur.trim());cur="";continue;}cur+=ch;}
 cells.push(cur.trim());return cells;
}
function parseTable(src){
 const lines=String(src).split("\n").filter(l=>l.trim()),head=splitRow(lines[0]||""),delim=splitRow(lines[1]||"");
 const rows=[head,...lines.slice(2).map(splitRow)],n=Math.max(1,...rows.map(r=>r.length));
 rows.forEach(r=>{while(r.length<n)r.push("");r.length=n;});
 const align=[...Array(n)].map((_,i)=>{const d=(delim[i]||"").trim();return d.startsWith(":")&&d.endsWith(":")?"center":d.endsWith(":")?"right":d.startsWith(":")?"left":null;});
 return {rows,align};
}
function writeTable(t){
 const n=t.align.length,cells=t.rows.map(r=>r.map(s=>String(s??"").replace(/\n/g,"<br>").replace(/\|/g,"\\|")));
 const widths=[...Array(n)].map((_,c)=>Math.max(3,...cells.map(r=>textWidth(r[c]||""))));
 const pad=(s,w,a)=>{const gap=w-textWidth(s);return a==="right"?" ".repeat(gap)+s:a==="center"?" ".repeat(gap>>1)+s+" ".repeat(gap-(gap>>1)):s+" ".repeat(gap);};
 const row=r=>"| "+r.map((s,c)=>pad(s,widths[c],t.align[c])).join(" | ")+" |";
 const delim="| "+widths.map((w,c)=>{const a=t.align[c];return a==="center"?":"+"-".repeat(w-2)+":":a==="right"?"-".repeat(w-1)+":":a==="left"?":"+"-".repeat(w-1):"-".repeat(w);}).join(" | ")+" |";
 return [row(cells[0]),delim,...cells.slice(1).map(row)].join("\n");
}
function inlineMd(text){return String(text).trim()?markdown(text).trim().replace(/^<p>([\s\S]*)<\/p>$/,"$1"):"";}
function gridRender(box){
 const t=box._table,cell=(tag,r,c,text)=>'<'+tag+' data-r="'+r+'" data-c="'+c+'" contenteditable="true" spellcheck="false"'+(t.align[c]?' style="text-align:'+t.align[c]+'"':"")+'>'+inlineMd(text)+'</'+tag+'>';
 box.innerHTML='<div class="markdown grid-wrap"><div class="table-wrap"><table><thead><tr>'+t.rows[0].map((x,c)=>cell("th",0,c,x)).join("")+'</tr></thead><tbody>'+
  t.rows.slice(1).map((row,i)=>'<tr>'+row.map((x,c)=>cell("td",i+1,c,x)).join("")+'</tr>').join("")+'</tbody></table></div>'+
  '<button class="grid-add grid-add-row" data-grid="row" title="加一行">+</button><button class="grid-add grid-add-col" data-grid="col" title="加一列">+</button></div>';
 hydrateVault(box,box._grid?.base);
}
function gridCell(box,r,c){return box.querySelector('[data-r="'+r+'"][data-c="'+c+'"]');}
function gridFocus(box,r,c,at="end"){
 const t=box._table;r=Math.max(0,Math.min(r,t.rows.length-1));c=Math.max(0,Math.min(c,t.align.length-1));
 const cell=gridCell(box,r,c);if(!cell)return;box._caret=at;cell.focus();
}
function caretTo(cell,at){
 const range=document.createRange();
 if(typeof at==="number"&&cell.firstChild){range.setStart(cell.firstChild,Math.min(at,cell.firstChild.length));range.collapse(true);}
 else{range.selectNodeContents(cell);range.collapse(at==="start");}
 const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
}
function caretOffset(cell){
 const sel=getSelection();if(!sel.rangeCount)return 0;const r=sel.getRangeAt(0).cloneRange();r.selectNodeContents(cell);r.setEnd(sel.focusNode,sel.focusOffset);return r.toString().length;
}
// Write the table back now (or soon, while typing). The widget keeps its DOM when its own text comes back.
function gridWrite(box,soon=false){
 clearTimeout(box._timer);
 if(soon){box._timer=setTimeout(()=>gridWrite(box),250);return;}
 const g=box._grid,view=box._view,src=writeTable(box._table);if(!g||!view||src===g.src)return;
 if(view.state.sliceDoc(g.from,g.from+g.src.length)!==g.src)return;
 box._writing=src;view.dispatch({changes:{from:g.from,to:g.from+g.src.length,insert:src},userEvent:"input.table"});
}
function gridLeave(box,below=true){
 gridWrite(box);
 const view=box._view,g=box._grid;document.activeElement?.blur();
 const end=g.from+g.src.length,doc=view.state.doc;
 view.focus();
 if(!below){view.dispatch({selection:{anchor:Math.max(0,g.from-1)},scrollIntoView:true});return;}
 if(end>=doc.length)view.dispatch({changes:{from:end,insert:"\n"},selection:{anchor:end+1}});
 else view.dispatch({selection:{anchor:end+1},scrollIntoView:true});
}
const Grids={box:null,r:0,c:0};
function gridChange(box,fn,focus){
 gridWrite(box);fn(box._table);gridRender(box);gridWrite(box);
 if(focus)gridFocus(box,...focus);
}
function gridAction(kind,a){
 const box=Grids.box,t=box?._table;if(!t||!box.isConnected)return null;
 const r=Grids.r,c=Grids.c,R=t.rows.length,C=t.align.length,blank=()=>Array(C).fill("");
 switch(kind){
  case "grid-row-above":return gridChange(box,t=>t.rows.splice(Math.max(1,r),0,blank()),[Math.max(1,r),c]);
  case "grid-row-below":return gridChange(box,t=>t.rows.splice(r+1,0,blank()),[r+1,c]);
  case "grid-col-left":return gridChange(box,t=>{t.rows.forEach(x=>x.splice(c,0,""));t.align.splice(c,0,null);},[r,c]);
  case "grid-col-right":return gridChange(box,t=>{t.rows.forEach(x=>x.splice(c+1,0,""));t.align.splice(c+1,0,null);},[r,c+1]);
  case "grid-row-up":if(r>1)gridChange(box,t=>{[t.rows[r-1],t.rows[r]]=[t.rows[r],t.rows[r-1]];},[r-1,c]);return;
  case "grid-row-down":if(r>=1&&r<R-1)gridChange(box,t=>{[t.rows[r+1],t.rows[r]]=[t.rows[r],t.rows[r+1]];},[r+1,c]);return;
  case "grid-col-left-move":if(c>0)gridChange(box,t=>{t.rows.forEach(x=>{[x[c-1],x[c]]=[x[c],x[c-1]];});[t.align[c-1],t.align[c]]=[t.align[c],t.align[c-1]];},[r,c-1]);return;
  case "grid-col-right-move":if(c<C-1)gridChange(box,t=>{t.rows.forEach(x=>{[x[c+1],x[c]]=[x[c],x[c+1]];});[t.align[c+1],t.align[c]]=[t.align[c],t.align[c+1]];},[r,c+1]);return;
  case "grid-align":return gridChange(box,t=>{t.align[c]=a.dataset.align||null;},[r,c]);
  case "grid-sort":{const dir=a.dataset.dir==="desc"?-1:1;return gridChange(box,t=>{const body=t.rows.slice(1).sort((x,y)=>dir*String(x[c]).localeCompare(String(y[c]),"zh",{numeric:true}));t.rows.splice(1,body.length,...body);},[r,c]);}
  case "grid-row-delete":if(r===0)return toast("表头这一行不能删；要删整个表格，用「删除表格」");return gridChange(box,t=>t.rows.splice(r,1),[Math.min(r,R-2),c]);
  case "grid-col-delete":if(C===1)return gridAction("grid-delete",a);return gridChange(box,t=>{t.rows.forEach(x=>x.splice(c,1));t.align.splice(c,1);},[r,Math.min(c,C-2)]);
  case "grid-source":{const view=box._view,g=box._grid,doc=view.state.doc,line=doc.line(Math.min(doc.lineAt(g.from).number+(r===0?0:r+1),doc.lines));view.focus();view.dispatch({selection:{anchor:cellStart(line,c)}});return;}
  case "grid-delete":{const view=box._view,g=box._grid,end=Math.min(view.state.doc.length,g.from+g.src.length+1);view.focus();view.dispatch({changes:{from:g.from,to:end,insert:""},selection:{anchor:g.from},userEvent:"delete"});return;}
 }
 return null;
}
function gridMenu(box,cell,at){
 const r=+cell.dataset.r,c=+cell.dataset.c,t=box._table;Grids.box=box;Grids.r=r;Grids.c=c;
 const b=(kind,icon,label,extra="",off=false)=>'<button data-action="'+kind+'" '+extra+(off?" disabled":"")+'>'+svg(icon,14)+'<span>'+label+'</span></button>';
 popMenu(at,'<div class="menu-label">行</div>'+b("grid-row-above","arrowup","上面加一行","",r===0)+b("grid-row-below","chevrondown","下面加一行")+
  b("grid-row-up","arrowup","这一行上移","",r<=1)+b("grid-row-down","chevrondown","这一行下移","",r===0||r>=t.rows.length-1)+b("grid-row-delete","trash","删掉这一行","",r===0)+
  '<hr/><div class="menu-label">列</div>'+b("grid-col-left","plus","左边加一列")+b("grid-col-right","plus","右边加一列")+
  b("grid-col-left-move","chevron","这一列左移","",c===0)+b("grid-col-right-move","chevron","这一列右移","",c>=t.align.length-1)+b("grid-col-delete","trash","删掉这一列")+
  '<div class="menu-row"><span>对齐</span><span class="seg">'+[["left","左"],["center","中"],["right","右"],["","默认"]].map(([v,l])=>'<button data-action="grid-align" data-align="'+v+'" class="'+((t.align[c]||"")===v?"on":"")+'">'+l+'</button>').join("")+'</span></div>'+
  '<div class="menu-row"><span>按这一列排序</span><span class="seg"><button data-action="grid-sort" data-dir="asc">升序</button><button data-action="grid-sort" data-dir="desc">降序</button></span></div>'+
  '<hr/>'+b("grid-source","code","编辑这个表格的源码")+b("grid-delete","trash","删除表格"),{cls:"menu-wide"});
}
class Grid extends CV.WidgetType{
 constructor(src,from,base){super();this.src=src;this.from=from;this.base=base;}
 eq(o){return o.src===this.src&&o.from===this.from;}
 toDOM(view){
  const box=document.createElement("div");box.className="cm-grid";box._view=view;box._grid=this;box._table=parseTable(this.src);
  gridRender(box);
  const cellOf=e=>e.target.closest?.("[data-r]");
  const where=cell=>({r:+cell.dataset.r,c:+cell.dataset.c});
  box.addEventListener("mousedown",e=>{
   const add=e.target.closest(".grid-add");
   if(add){e.preventDefault();const t=box._table;
    if(add.dataset.grid==="row")gridChange(box,t=>t.rows.push(Array(t.align.length).fill("")),[t.rows.length,0]);
    else gridChange(box,t=>{t.rows.forEach(x=>x.push(""));t.align.push(null);},[0,t.align.length]);return;}
   const cell=cellOf(e);if(!cell||cell.dataset.editing||e.button!==0)return;
   // A link in a cell that is not being edited is followed, not edited.
   if(e.target.closest("a")&&!(e.ctrlKey||e.metaKey)){e.preventDefault();return;}
   // Start editing with the cursor where the click was, counted in the cell's text.
   e.preventDefault();
   const hit=document.caretRangeFromPoint?.(e.clientX,e.clientY);let at="end";
   if(hit&&cell.contains(hit.startContainer)){const r=document.createRange();r.selectNodeContents(cell);r.setEnd(hit.startContainer,hit.startOffset);at=r.toString().length;}
   box._caret=at;cell.focus();
  });
  box.addEventListener("contextmenu",e=>{const cell=cellOf(e);if(!cell)return;e.preventDefault();e.stopPropagation();gridMenu(box,cell,{x:e.clientX,y:e.clientY});});
  box.addEventListener("focusin",e=>{
   const cell=cellOf(e);if(!cell||cell.dataset.editing)return;const {r,c}=where(cell);
   cell.dataset.editing="1";cell.textContent=box._table.rows[r][c];caretTo(cell,box._caret??"end");box._caret=null;
   box.classList.add("editing");Grids.box=box;Grids.r=r;Grids.c=c;
  });
  box.addEventListener("focusout",e=>{
   const cell=cellOf(e);if(!cell)return;const {r,c}=where(cell);
   delete cell.dataset.editing;cell.innerHTML=inlineMd(box._table.rows[r][c]);hydrateVault(cell,this.base);
   setTimeout(()=>{if(!box.contains(document.activeElement)){box.classList.remove("editing");gridWrite(box);}},0);
  });
  box.addEventListener("input",e=>{const cell=cellOf(e);if(!cell)return;const {r,c}=where(cell);box._table.rows[r][c]=cell.innerText.replace(/\n/g," ");gridWrite(box,true);});
  box.addEventListener("paste",e=>{if(!cellOf(e))return;e.preventDefault();document.execCommand("insertText",false,(e.clipboardData?.getData("text/plain")||"").replace(/\s*\n\s*/g," "));});
  box.addEventListener("keydown",e=>{
   const cell=cellOf(e);if(!cell||e.isComposing||e.keyCode===229)return;
   const {r,c}=where(cell),t=box._table,R=t.rows.length,C=t.align.length,mod=e.ctrlKey||e.metaKey,text=cell.textContent,off=caretOffset(cell);
   const done=()=>{e.preventDefault();e.stopPropagation();};
   if(e.key==="Tab"){done();
    if(e.shiftKey){if(c>0)gridFocus(box,r,c-1);else if(r>0)gridFocus(box,r-1,C-1);}
    else if(c<C-1)gridFocus(box,r,c+1);else if(r<R-1)gridFocus(box,r+1,0);
    else gridChange(box,t=>t.rows.push(Array(C).fill("")),[R,0]);
    return;}
   if(e.key==="Enter"&&!mod){done();
    if(e.shiftKey){document.execCommand("insertText",false,"<br>");return;}
    if(r<R-1)gridFocus(box,r+1,c);else gridChange(box,t=>t.rows.push(Array(C).fill("")),[R,c]);return;}
   if(e.key==="Escape"){done();return gridLeave(box);}
   if(e.key==="ArrowUp"&&!e.shiftKey){done();if(r>0)gridFocus(box,r-1,c);else gridLeave(box,false);return;}
   if(e.key==="ArrowDown"&&!e.shiftKey){done();if(r<R-1)gridFocus(box,r+1,c);else gridLeave(box);return;}
   if(e.key==="ArrowLeft"&&!e.shiftKey&&off===0&&getSelection().isCollapsed&&(c>0||r>0)){done();if(c>0)gridFocus(box,r,c-1);else gridFocus(box,r-1,C-1);return;}
   if(e.key==="ArrowRight"&&!e.shiftKey&&off===text.length&&getSelection().isCollapsed&&(c<C-1||r<R-1)){done();if(c<C-1)gridFocus(box,r,c+1,"start");else gridFocus(box,r+1,0,"start");return;}
   if(mod&&["b","i"].includes(e.key.toLowerCase())){done();const m=e.key.toLowerCase()==="b"?"**":"*",sel=getSelection().toString();document.execCommand("insertText",false,m+sel+m);return;}
   if(mod&&e.key==="Enter"){done();return gridLeave(box);}
  });
  return box;
 }
 updateDOM(dom,view){
  if(!dom.classList.contains("cm-grid"))return false;
  dom._view=view;dom._grid=this;
  // Our own edit coming back: the cells already show it, and the cursor stays in its cell.
  if(dom._writing===this.src||writeTable(dom._table)===this.src&&dom.contains(document.activeElement)){dom._writing=null;return true;}
  dom._table=parseTable(this.src);gridRender(dom);return true;
 }
 ignoreEvent(){return true;}
}
// A new table at the cursor, ready to type in its first cell.
function insertTable(view,cols=3,rows=2){
 const st=view.state,line=st.doc.lineAt(st.selection.main.head),t={rows:[Array(cols).fill(""),...[...Array(rows)].map(()=>Array(cols).fill(""))],align:Array(cols).fill(null)};
 const before=line.text.trim()?"\n\n":"",at=line.text.trim()?line.to:line.from,src=writeTable(t);
 const insert=before+src+"\n",from=at+before.length;
 view.dispatch({changes:{from:at,to:line.text.trim()?at:line.to,insert},selection:{anchor:from+src.length+1},scrollIntoView:true,userEvent:"input"});
 requestAnimationFrame(()=>{const box=[...view.dom.querySelectorAll(".cm-grid")].find(b=>b._grid?.from===from);if(box)gridFocus(box,0,0);});
 return true;
}
function tablePreview(opts){
 const build=state=>{
  const out=[],sel=state.selection.ranges,doc=state.doc;
  CL.syntaxTree(state).iterate({enter:n=>{
   if(n.name!=="Table")return;
   const from=doc.lineAt(n.from).from,to=doc.lineAt(Math.max(n.from,n.to-1)).to;
   if(!sel.some(r=>r.from<=to&&r.to>=from))out.push(CV.Decoration.replace({widget:new Grid(doc.sliceString(from,to),from,opts.path),block:true}).range(from,to));
   return false;
  }});
  return CV.Decoration.set(out);
 };
 return CS.StateField.define({
  create:build,
  update(deco,tr){return tr.docChanged||tr.selection||CL.syntaxTree(tr.startState)!==CL.syntaxTree(tr.state)?build(tr.state):deco;},
  provide:f=>CV.EditorView.decorations.from(f),
 });
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

/* ---- code in rendered Markdown (replies, previews, embeds): the editor's own grammars and colours --------------------- */
const codeLangs=new Map(),codeHtml=new Map();
// The grammar for a fence's language: ready (support), unknown (null), or still loading (undefined; drawn when it arrives).
function codeSupport(name){
 const key=String(name).toLowerCase();
 if(codeLangs.has(key)){const v=codeLangs.get(key);return v instanceof Promise?undefined:v;}
 const desc=CL.LanguageDescription.matchLanguageName(CM.languages,key,true);
 if(!desc){codeLangs.set(key,null);return null;}
 if(desc.support){codeLangs.set(key,desc.support);return desc.support;}
 codeLangs.set(key,desc.load().then(s=>{codeLangs.set(key,s);highlightPending();}).catch(()=>codeLangs.set(key,null)));
 return undefined;
}
function highlightedCode(text,support){
 const key=support.language.name+"\u0000"+text;if(codeHtml.has(key))return codeHtml.get(key);
 let out="";
 CM.highlight.highlightCode(text,support.language.parser.parse(text),cmHighlight,(t,cls)=>{out+=cls?'<span class="'+cls+'">'+esc(t)+'</span>':esc(t);},()=>{out+="\n";});
 if(codeHtml.size>300)codeHtml.clear();codeHtml.set(key,out);return out;
}
const unescapeHtml=s=>s.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&");
function highlightBlocks(html){
 return html.replace(/<pre><code class="language-([\w+#.-]+)">([\s\S]*?)<\/code><\/pre>/g,(m,lang,body)=>{
  const sup=codeSupport(lang);
  if(sup===null)return m;
  if(sup===undefined)return '<pre><code class="language-'+lang+'" data-hl="'+esc(lang)+'">'+body+'</code></pre>';
  return '<pre><code class="language-'+lang+' hl">'+highlightedCode(unescapeHtml(body),sup)+'</code></pre>';
 });
}
function highlightPending(){
 for(const c of all("code[data-hl]")){const sup=codeSupport(c.dataset.hl);if(sup===undefined)continue;delete c.dataset.hl;if(sup){c.innerHTML=highlightedCode(c.textContent,sup);c.classList.add("hl");}}
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
  ...(md?[{key:"Mod-Shift-t",run:v=>insertTable(v)},{key:"Mod-b",run:wrapWith("**")},{key:"Mod-i",run:wrapWith("*")},{key:"Mod-Shift-x",run:wrapWith("~~")},{key:"Mod-`",run:wrapWith("`")},{key:"Mod-Enter",run:toggleTask}]:[]),
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
  if(opts.live)ext.push(livePreview(opts),tablePreview(opts),mathPreview(),propsPreview());
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
