"use strict";
/* Changing a skill. An agent's proposed change (or the learner's own, e.g. bringing back an older version) is shown
   side by side: the left is the skill as it was, the right what it becomes, with what was taken out marked red and what
   was put in marked green. The right side is the learner's to edit: type into it, take any part (or all) of the left
   back with the arrows, or go back to the proposal; nothing changes until they approve. Every approved change is a
   commit with its reason, so a skill's history can be gone through and any version brought back the same way.

   Trying a change: one conversation is continued twice, once with each version of the skill, side by side; the
   learner keeps one reply (as it is or edited) as the conversation's next message, or neither.

   Both live where they came up: an agent's proposal inside its reply in the conversation, its comparisons under it;
   either can also be opened in a window of its own. A review or comparison is known by a key: a window's panel id,
   or "in:<change>" / "ic:<compare>" for one inside a reply. The ones inside replies keep their own elements, so a
   conversation redrawing puts them back as they were, edits included. */
const Changes={};    // key -> {data, view}
const Compares={};   // compare id -> {a:{text,done,thinking}, b:{...}} while it runs
const Inline={roots:{},meta:{}};   // key -> element / the comparison's own record, for the ones inside replies

function diffSide(doc,editable,onChange){
 const ext=[CL.syntaxHighlighting(cmHighlight),cmTheme,CV.EditorView.lineWrapping,CV.EditorView.contentAttributes.of({spellcheck:"false"}),
  CM.markdown({base:CM.markdownLanguage,codeLanguages:CM.languages}),CS.EditorState.phrases.of({"$ unchanged lines":"$ 行没变（点开）","Revert this chunk":"用左边这一段"})];
 if(editable)ext.push(CC.history(),CV.drawSelection(),CS.Prec.highest(CV.keymap.of([...CC.defaultKeymap,...CC.historyKeymap,...CQ.searchKeymap])),
  CV.EditorView.updateListener.of(u=>{if(u.docChanged)onChange?.();}));
 else ext.push(CS.EditorState.readOnly.of(true),CV.EditorView.editable.of(false));
 return {doc,extensions:ext};
}
// An agent's rules are changed the same way as a skill: their changes name "agent:<name>" and agents/<name>.md.
const isRules=d=>String(d?.skill||"").startsWith("agent:");
const changeId=key=>key.startsWith("in:")?key.slice(3):Dock.panels[key]?.change;
const changeRoot=key=>key.startsWith("in:")?Inline.roots[key]:Dock.els[key]?.querySelector(".sc");
panelType("skillchange",{side:"mine",icon:"edit",
 title:p=>(isRules(Changes[p.pid]?.data)?"改规则":"改技能")+(Changes[p.pid]?.data?" · "+Changes[p.pid].data.title:""),
 mount(p,node,pid){p.pid=pid;Changes[pid]={};node.innerHTML='<div class="sc"><div class="loading">正在打开这次修改…</div></div>';loadChange(pid);},
 unmount(p,node){Changes[node.dataset.pid]?.view?.destroy();delete Changes[node.dataset.pid];},
 screen(p,node){
  const c=Changes[node.dataset.pid],d=c?.data;if(!d)return {view:"改技能",change:p.change};
  return {view:(isRules(d)?"改规则":"改技能")+"（左右对照）",change:p.change,skill:d.skill,file:d.file,state:d.state,by:d.by,why:d.why,
   learner_edited:c.view?c.view.b.state.doc.toString()!==d.proposed:false,changes:c.view?c.view.chunks.length:0};
 }});
/* A proposal inside the reply that made it: the reply's placeholder gets the review's own element, made once. */
function mountInlineChanges(root){
 for(const slot of all(".sc-slot[data-change]",root)){
  const key="in:"+slot.dataset.change;
  if(!Inline.roots[key]){Inline.roots[key]=h('<div class="sc sc-inline"><div class="loading">正在打开这次修改…</div></div>');Changes[key]={};loadChange(key);}
  slot.replaceChildren(Inline.roots[key]);
 }
}
async function loadChange(key){
 const c=Changes[key];if(!c)return;
 const d=await safe(()=>rpc("skill_change",{id:changeId(key)}));if(!Changes[key])return;
 const root=changeRoot(key);
 if(!d){if(root)root.innerHTML=emptyState("edit","打不开这次修改","可能已经被删掉了。");return;}
 c.data=d;if(!key.startsWith("in:"))refreshTab(key);renderChange(key);
}
function changeBy(d){return d.by==="me"?"我":who(d.by);}
function renderChange(key){
 const c=Changes[key],d=c.data,root=changeRoot(key);if(!d||!root)return;
 const inline=key.startsWith("in:"),k=esc(key);
 c.view?.destroy();c.view=null;
 const keep=root.querySelector(".sc-compares");   // comparisons under an inline review stay as they are
 const open=d.state==="open",stale=open&&d.current!==d.base,rules=isRules(d),file=rules?d.file:d.file.split("/").slice(2).join("/"),comparable=rules||d.file.endsWith("/SKILL.md");
 root.innerHTML=
  '<div class="sc-head"><div class="sc-title">'+svg(rules?"bot":"store",15)+'<b>'+esc(d.title)+'</b><small>'+esc(file)+'</small>'+
   (d.base?"":'<span class="chip ai">新技能</span>')+'<span class="grow"></span>'+
   (open?'<span class="chip ai">等你审</span>':d.state==="approved"?'<span class="chip on">已批准'+(d.final!==d.proposed?"（你改过）":"")+'</span>':'<span class="chip">没采用</span>')+
   (inline?iconButton("float","sc-window","在窗口里打开",'data-pid="'+k+'"'):"")+'</div>'+
   '<div class="sc-why">'+esc(changeBy(d))+'提的 · '+esc(fmtDate(d.at,true))+(d.why?'：'+esc(d.why):"")+'</div>'+
   (d.questions?.length&&comparable?'<div class="sc-try"><span>'+svg("split",12)+' 拿这些问题对比两版：</span>'+
    d.questions.map((q,i)=>'<button class="chip toggle" data-action="sc-try-q" data-pid="'+k+'" data-q="'+i+'" data-tip="用左右两版'+(rules?"规则":"技能")+'各回答一次">'+esc(q)+'</button>').join("")+'</div>':"")+'</div>'+
  (stale?'<div class="sc-warn">'+svg("info",13)+'<span>'+(rules?"这份规则":"这个技能")+'在提出这次修改之后又被改过了，左边是提出时的样子。</span>'+button("左边换成现在的","sc-rebase",'data-pid="'+k+'"',"ghost xs")+'</div>':"")+
  '<div class="sc-cols"><div><b>原来</b><small>'+(open?"只读":"")+'</small></div><div><b>'+(open?'改成</b><small>可以直接改；每处修改旁的箭头把左边那一段拿回来</small>':d.state==="approved"?"改成了</b>":"提议的样子</b>")+
   (open?'<span class="grow"></span>'+button("全部用原文","sc-all-left",'data-pid="'+k+'" data-tip="右边换成左边的全文，再自己改"',"ghost xs")+button("换回提议的","sc-reset",'data-pid="'+k+'" data-tip="丢掉你在右边的改动"',"ghost xs"):"")+'</div></div>'+
  '<div class="sc-merge"></div>'+
  '<div class="sc-foot"><span class="sc-stat"></span><span class="grow"></span>'+
   button(svg("history",13)+" 历史","sc-history",'data-pid="'+k+'"',"ghost sm")+
   (comparable?button(svg("split",13)+" 两版对比试用","sc-compare",'data-pid="'+k+'" data-tip="接着这段对话，用原来和改过的'+(rules?"规则":"技能")+'各回答一次，挑一个"',"ghost sm"):"")+
   (open?button("不改了","sc-dismiss",'data-pid="'+k+'"',"ghost sm")+button(svg("check",13)+" 批准","sc-approve",'data-pid="'+k+'"',"primary sm"):
    (rules&&d.state!=="approved"?"":button(svg("document",13)+" 打开文件","open-file",'data-path="'+esc(d.file)+'"',"ghost sm")))+'</div>'+
  (inline?'<div class="sc-compares"></div>':"");
 if(inline){
  const box=root.querySelector(".sc-compares");if(keep)box.replaceWith(keep);
  else for(const cmp of d.compares||[])inlineCompare(key,{compare:cmp.id,slug:d.skill,title:d.title,question:cmp.question,thread:cmp.thread,thread_title:"这段对话",a:cmp.a,b:cmp.b,picked:cmp.picked||null},false);
 }
 const right=open?d.proposed:d.state==="approved"?d.final:d.proposed;
 c.view=new CM.merge.MergeView({a:diffSide(d.base,false),b:diffSide(right,open,()=>changeStat(key)),parent:root.querySelector(".sc-merge"),
  revertControls:open?"a-to-b":undefined,highlightChanges:true,gutter:true,collapseUnchanged:{margin:3,minSize:8},
  renderRevertControl:()=>{const b=document.createElement("button");b.className="sc-take";b.title="用左边这一段";b.innerHTML=svg("arrow",12);return b;}});
 changeStat(key);
}
function changeStat(key){
 const c=Changes[key],out=changeRoot(key)?.querySelector(".sc-stat");if(!c?.view||!out)return;
 const a=c.view.a.state.doc,b=c.view.b.state.doc,chunks=c.view.chunks;
 let del=0,add=0;for(const ch of chunks){if(ch.toA>ch.fromA)del+=a.lineAt(Math.max(ch.fromA,ch.toA-1)).number-a.lineAt(ch.fromA).number+1;if(ch.toB>ch.fromB)add+=b.lineAt(Math.max(ch.fromB,ch.toB-1)).number-b.lineAt(ch.fromB).number+1;}
 const mine=c.data.state==="open"&&b.toString()!==c.data.proposed;
 out.innerHTML=chunks.length?'改了 '+chunks.length+' 处 · <span class="sc-del">−'+del+' 行</span> <span class="sc-add">+'+add+' 行</span>'+(mine?' · <span class="sc-mine">右边有你的改动</span>':""):"和原来一样";
}
async function changeAction(kind,a){
 const key=a.dataset.pid,c=Changes[key],d=c?.data;if(!d)return;
 const right=c.view?.b,rightText=()=>right?right.state.doc.toString():d.final||d.proposed;
 if(kind==="sc-window")return wideWindow(openPanel({type:"skillchange",change:d.id}));
 if(kind==="sc-all-left"){right.dispatch({changes:{from:0,to:right.state.doc.length,insert:d.base}});return right.focus();}
 if(kind==="sc-reset"){if(right.state.doc.toString()!==d.proposed&&!await ask("右边你改的会丢掉。",{title:"换回提议的样子？",ok:"换回"}))return;right.dispatch({changes:{from:0,to:right.state.doc.length,insert:d.proposed}});return;}
 if(kind==="sc-rebase"){if(!await ask("左边会换成"+(isRules(d)?"规则":"技能")+"现在的样子，右边不动；对照的就是现在的版本和右边。",{title:"左边换成现在的？",ok:"换"}))return;d.base=d.current;return renderChange(key);}
 if(kind==="sc-history")return skillHistory(d.skill);
 if(kind==="sc-compare")return startCompare(key,d,rightText(),null);
 if(kind==="sc-try-q")return startCompare(key,d,rightText(),d.questions[+a.dataset.q]);
 if(kind==="sc-dismiss"){if(!await ask((isRules(d)?"规则":"技能")+"保持原来的样子，这次修改留在历史里。",{title:"不采用这次修改？",ok:"不改了"}))return;await rpc("skill_change_decide",{id:d.id,decision:"dismissed"});return;}
 if(kind==="sc-approve"){
  const content=right.state.doc.toString();
  if(d.current!==d.base&&!await ask((isRules(d)?"规则":"技能")+"在这次修改提出之后又被改过；批准会用右边的内容替换现在的版本（现在的留在历史里）。",{title:"还是批准？",ok:"批准",danger:true}))return;
  const r=await rpc("skill_change_decide",{id:d.id,decision:"approved",content});
  toast(r.edited?"已批准你改过的版本":"已批准");skillsChanged();
 }
}
/* Side by side needs room: a window that landed in a narrow place floats, large, over the workspace instead. */
function wideWindow(pid){
 requestAnimationFrame(()=>{
  const n=Dock.els[pid];if(!n||n.getBoundingClientRect().width>=720||Dock.layout.floats.some(f=>f.stack.tabs.includes(pid)))return;
  detach(pid);const r=el("#dock").getBoundingClientRect();
  Dock.layout.floats.push({id:newId("f"),x:Math.round(r.width*.06),y:36,w:Math.round(Math.min(1200,r.width*.88)),h:Math.round(r.height*.88),stack:stackNode([pid])});
  tidy();renderDock();saveLayout();
 });
 return pid;
}
function skillChangeEvent(evt){
 // An agent's proposal shows in its reply; the learner's own (from the store or a skill's history) has no conversation
 // to show in, so it opens in a window. A decision made in one place shows in every other.
 const keys=Object.keys(Changes).filter(k=>changeId(k)===evt.change);
 if(evt.state==="open"&&evt.by==="me"&&!keys.length)return wideWindow(openPanel({type:"skillchange",change:evt.change}));
 keys.forEach(k=>{if(Changes[k]?.data&&(Changes[k].data.state==="open"||evt.state==="open"))loadChange(k);});
}
/* A skill's history: every committed version of its SKILL.md with the reason; any one can be compared with now and
   brought back, which goes through the same review. */
let historyShown=[];
async function skillHistory(slug){
 const versions=historyShown=await rpc("skill_history",{slug}),rules=slug.startsWith("agent:");
 modal(modalHead((rules?"规则的历史 · "+who(slug.slice(6)):"技能的历史 · "+slug))+'<p class="muted">每次修改都是一条记录（批准时写了谁提的、为什么改）。点「和现在对照」会打开左右对照：左边是现在，右边是那个版本，批准就恢复成它。</p>'+
  (versions.length?'<div class="sc-history">'+versions.map((v,i)=>'<div class="version"><div><b>'+esc(v.subject)+'</b><small>'+(v.at?esc(fmtDate(v.at,true))+' · ':'')+esc(v.author)+(v.current?" · 现在的版本":"")+'</small></div>'+
   (v.current?"":button("和现在对照","sc-restore",'data-slug="'+esc(slug)+'" data-commit="'+esc(v.commit)+'" data-path="'+esc(v.path)+'" data-when="'+esc(v.at?fmtDate(v.at,true):v.subject)+'"',"ghost xs"))+'</div>').join("")+'</div>':'<p>还没有历史。</p>'),"large");
}
async function restoreVersion(a){
 const shown=historyShown.find(x=>x.commit===a.dataset.commit&&x.content!=null);
 const v=shown||await rpc("file_version",{path:a.dataset.path||"skills/"+a.dataset.slug+"/SKILL.md",commit:a.dataset.commit});
 closeModal();
 await rpc("skill_propose",{slug:a.dataset.slug,content:v.content||"",why:"恢复成 "+a.dataset.when+" 的版本"});
}
/* ---- trying two versions on one conversation ---------------------------------------------------------------- */
const cmpMeta=key=>key.startsWith("ic:")?Inline.meta[key]:Dock.panels[key];
const cmpRoot=key=>key.startsWith("ic:")?Inline.roots[key]:Dock.els[key]?.querySelector(".cmp");
async function startCompare(key,d,b,asked=null){
 if(d.base===b)return toast("两边一样，没什么可比的；先在右边改一改");
 const question=asked??await dialog({title:"两版对比试用",message:"接着同一段对话，原来的技能和改过的技能各回答一次。"+
   (d.questions?.length?"提修改时建议的问题："+d.questions.map(q=>"「"+q+"」").join(" "):""),
  input:{value:d.questions?.[0]||"",placeholder:"要它回答什么（不填就重新回答这段对话的最后一个问题）",allowEmpty:true},ok:"开始"});
 if(question==null)return;
 const r=await rpc("skill_compare",{slug:d.skill,a:d.base,b,thread:d.thread||null,message:question,change:d.id});
 Compares[r.compare]={a:{text:"",done:false},b:{text:"",done:false}};
 const meta={compare:r.compare,slug:d.skill,title:d.title,question:r.question,thread:r.thread,thread_title:r.title,agent:r.agent};
 // From a review inside a reply, the comparison shows right under it; from a window, in a window.
 if(key.startsWith("in:"))return inlineCompare(key,meta,true);
 wideWindow(openPanel({type:"skillcompare",...meta},{reuse:false}));
}
function inlineCompare(changeKey,meta,first){
 const key="ic:"+meta.compare,box=Inline.roots[changeKey]?.querySelector(".sc-compares");if(!box)return;
 Inline.meta[key]=meta;
 if(!Inline.roots[key])Inline.roots[key]=h('<div class="cmp cmp-inline"></div>');
 if(first)box.prepend(Inline.roots[key]);else box.append(Inline.roots[key]);
 renderCompare(key);
 if(first)Inline.roots[key].scrollIntoView({block:"nearest",behavior:"smooth"});
}
panelType("skillcompare",{side:"mine",icon:"split",
 title:p=>"对比试用 · "+(p.title||p.slug),
 mount(p,node,pid){p.pid=pid;node.innerHTML='<div class="cmp"></div>';renderCompare(pid);},
 screen(p){const c=Compares[p.compare];return {view:"技能两版对比",skill:p.slug,question:shorten(p.question,200),a_done:!!c?.a.done,b_done:!!c?.b.done,picked:p.picked||null};}});
function compareSide(key,side){
 const p=cmpMeta(key),c=Compares[p.compare]||{},s=c[side]||{text:p[side]||"",done:true},label=side==="a"?"左边：原来的":"右边：改成的",k=esc(key);
 const picked=p.picked;
 return '<div class="cmp-side'+(picked===side?" picked":"")+'" data-side="'+side+'"><div class="cmp-label">'+(side==="a"?svg("history",13):svg("edit",13))+' '+label+
  (s.done?"":'<span class="cmp-live">'+(s.thinking?"在想…":"在写…")+'</span>')+'</div>'+
  '<div class="cmp-body">'+(s.text?'<div class="markdown cmp-reply" data-side="'+side+'"></div>':'<div class="thinking"><span></span><span></span><span></span><b>正在想…</b></div>')+'</div>'+
  '<div class="cmp-foot">'+(picked?(picked===side?'<span class="chip on">用了这一边</span>':""):s.done&&s.text?
   button(svg("check",12)+" 用这个","cmp-pick",'data-pid="'+k+'" data-side="'+side+'" data-tip="这一边成为这段对话的下一条回答"',"primary xs"):"")+'</div></div>';
}
function compareHead(key){
 const p=cmpMeta(key),c=Compares[p.compare],running=c&&(!c.a.done||!c.b.done),inline=key.startsWith("ic:");
 return '<div class="cmp-head"><div class="cmp-title"><span>'+(inline?svg("split",13)+' 两版对比':'<b>'+esc(p.title||p.slug)+'</b> 两个版本接着「'+esc(p.thread_title||"这段对话")+'」回答')+'</span>'+
  '<span class="grow"></span>'+(running?button(svg("stop",12)+" 停止","cmp-stop",'data-pid="'+esc(key)+'"',"ghost xs"):"")+
  (inline?iconButton("float","cmp-window","在窗口里打开",'data-pid="'+esc(key)+'"'):"")+'</div>'+
  '<div class="cmp-q">'+svg("quote",12)+' '+esc(shorten(p.question,240))+'</div></div>';
}
// Each reply as a conversation shows it, blocks included (questions cannot be answered here).
function fillReplies(key,root){
 const p=cmpMeta(key),c=Compares[p.compare];
 for(const box of all(".cmp-reply",root)){const s=(c||{})[box.dataset.side]||{text:p[box.dataset.side]||"",done:true};const r=replyHtml(s.text,!s.done);box.innerHTML=r.html;
  if(r.blocks.length)mountBlocks(box,r.blocks,{thread:p.thread,message:0,answers:{},pid:key,live:true});}
}
function renderCompare(key){
 const p=cmpMeta(key),root=cmpRoot(key);if(!p||!root)return;
 const c=Compares[p.compare];
 root.innerHTML=compareHead(key)+
  (!c&&!p.a?'<div class="cmp-gone">'+emptyState("split","这次对比已经不在了","程序重启过；回到左右对照里再开一次。")+'</div>':
   '<div class="cmp-cols">'+compareSide(key,"a")+compareSide(key,"b")+'</div>');
 fillReplies(key,root);
}
/* While one side is still being written, only that side is redrawn, and where it was scrolled to stays: the other
   side, finished or not, can be read and scrolled meanwhile. */
function refreshSide(key,side){
 const p=cmpMeta(key),root=cmpRoot(key),old=root?.querySelector('.cmp-side[data-side="'+side+'"]');
 if(!old)return renderCompare(key);
 const top=old.querySelector(".cmp-body")?.scrollTop||0,fresh=h(compareSide(key,side));
 old.replaceWith(fresh);fillReplies(key,fresh);
 const body=fresh.querySelector(".cmp-body");if(body)body.scrollTop=top;
 const head=root.querySelector(".cmp-head");if(head)head.replaceWith(h(compareHead(key)));
}
const compareFrames={};
function compareEvent(evt){
 const [,id,side]=evt.thread.split(":"),c=Compares[id];if(!c)return;
 const s=c[side];
 if(evt.kind==="thinking")s.thinking=true;
 else if(evt.kind==="chunk"){s.thinking=false;s.text+=evt.text;}
 else if(evt.kind==="finished"){s.text=evt.text||s.text;s.done=true;s.thinking=false;}
 else if(evt.kind==="error"){s.text+=(s.text?"\n\n":"")+"（出错了："+(evt.message||"")+"）";}
 else return;
 const keys=[...Object.keys(Dock.panels).filter(x=>Dock.panels[x].compare===id),...Object.keys(Inline.meta).filter(x=>Inline.meta[x].compare===id)];
 for(const key of keys){
  if(evt.kind==="finished"){cmpMeta(key)[side]=s.text;if(!key.startsWith("ic:"))saveLayout();}
  const frame=key+":"+side;if(compareFrames[frame])continue;
  compareFrames[frame]=setTimeout(()=>{delete compareFrames[frame];refreshSide(key,side);},evt.kind==="finished"?0:120);
 }
}
async function compareAction(kind,a){
 const key=a.dataset.pid,p=cmpMeta(key);if(!p)return;
 const side=a.dataset.side,c=Compares[p.compare];
 if(kind==="cmp-stop")return rpc("compare_stop",{id:p.compare});
 if(kind==="cmp-window")return wideWindow(openPanel({type:"skillcompare",...p}));
 if(kind==="cmp-pick"){
  await rpc("compare_pick",{id:p.compare,side,content:c?.[side]?.text??p[side]??""});
  p.picked=side;if(!key.startsWith("ic:"))saveLayout();renderCompare(key);
  toast("这一边成了这段对话的下一条回答");
  const chat=Object.keys(Chat).find(x=>Chat[x].thread===p.thread);if(chat)loadChat(chat);
 }
}
/* ---- a skill in a window of its own: wherever a reply or a message names one, clicking it opens it here to read and
   change. Saving is one entry in the skill's history; closing with changes saves them. -------------------------- */
async function skillPopup(slug){
 const s=await safe(()=>rpc("skill_page",{slug}));if(!s)return;
 const box=modal(modalHead(s.title)+'<div class="skp"><div class="skp-meta">'+svg(typeof catIcon==="function"?catIcon(s.category):"store",13)+' '+esc(s.category)+
   ' · '+(s.enabled?'<span class="chip on">在用</span>':'<span class="chip">已停用</span>')+' · <code>'+esc(s.path)+'</code></div>'+
   (s.description?'<p class="skp-desc">'+esc(s.description)+'</p>':"")+
   '<div class="skp-edit">'+editorHost(s.content,'class="editor prose"',{markdown:true,live:true})+'</div>'+
   '<div class="modal-actions"><span class="skp-state"></span><span class="grow"></span>'+
   button(svg("history",13)+" 历史","skp-history","","ghost sm")+button(svg("bot",13)+" 试用","skp-try","","ghost sm")+
   button(svg("split",13)+" 左右对照着改","skp-revise","",'ghost sm" data-tip="把这里改的和现在的版本左右对照，审过再批准')+
   button(svg("check",13)+" 保存","skp-save","disabled","primary sm")+'</div></div>',"large skill-pop");
 mountEditors(box);
 const view=editorIn(box),now=()=>view.state.doc.toString();
 let saved=s.content,leaving=false;
 const mark=()=>{const dirty=now()!==saved;box.querySelector('[data-action="skp-save"]').disabled=!dirty;box.querySelector(".skp-state").textContent=dirty?"有没保存的修改，关掉时会自动保存":"";};
 const save=async()=>{const text=now();if(text===saved)return true;
  const r=await safe(()=>rpc("skill_save",{slug,content:text}));if(!r)return false;saved=text;mark();skillsChanged();toast("已保存，记进了这个技能的历史");return true;};
 view.dom.addEventListener("input",mark);view.dom.addEventListener("keyup",mark);
 box.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();e.stopPropagation();safe(save);}});
 box.addEventListener("click",e=>{
  const b=e.target.closest("[data-action^='skp-']");if(!b||b.disabled)return;e.stopPropagation();
  const kind=b.dataset.action;
  if(kind==="skp-save")return safe(save);
  safe(async()=>{
   if(kind==="skp-revise"){const text=now();leaving=true;closeModal();return rpc("skill_propose",{slug,why:text===s.content?"我自己改":"我在技能窗口里改的",...(text===s.content?{}:{content:text})});}
   if(!await save())return;leaving=true;closeModal();
   if(kind==="skp-history")return skillHistory(slug);
   if(kind==="skp-try")return skillAction("skill-try",{dataset:{slug}});
  });
 });
 // Esc or a click outside: what was changed is kept.
 const text0=()=>{try{return view.state.doc.toString();}catch(_){return saved;}};
 Modal.onClose=()=>{const text=text0();if(!leaving&&text!==saved)safe(()=>rpc("skill_save",{slug,content:text}).then(r=>{if(r?.saved){skillsChanged();toast("关掉前的修改已保存");}}));destroyEditors(box);};
 setTimeout(()=>view.focus(),50);
}
// A skill named in a reply or a message opens on the press itself: a reply still being written redraws many times a
// second, and a click would be lost between pressing and releasing.
document.addEventListener("mousedown",e=>{
 const a=e.button===0&&e.target.closest?.("[data-skill-open]");if(!a)return;
 e.preventDefault();e.stopPropagation();safe(()=>skillPopup(a.dataset.skillOpen));
},true);
