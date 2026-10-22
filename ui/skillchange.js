"use strict";
/* Changing a skill. An agent's proposed change (or the learner's own, e.g. bringing back an older version) opens side by
   side: the left is the skill as it was, the right what it becomes, with what was taken out marked red and what was
   put in marked green. The right side is the learner's to edit: type into it, take any part (or all) of the left back
   with the arrows, or go back to the proposal; nothing changes until they approve. Every approved change is a commit
   with its reason, so a skill's history can be gone through and any version brought back the same way.

   Trying a change: one conversation is continued twice, once with each version of the skill, side by side; the
   learner keeps one reply (as it is or edited) as the conversation's next message, or neither. */
const Changes={};   // pid -> {data, view}
const Compares={};  // compare id -> {a:{text,done,thinking}, b:{...}}

function diffSide(doc,editable,onChange){
 const ext=[CL.syntaxHighlighting(cmHighlight),cmTheme,CV.EditorView.lineWrapping,CV.EditorView.contentAttributes.of({spellcheck:"false"}),
  CM.markdown({base:CM.markdownLanguage,codeLanguages:CM.languages})];
 if(editable)ext.push(CC.history(),CV.drawSelection(),CS.Prec.highest(CV.keymap.of([...CC.defaultKeymap,...CC.historyKeymap,...CQ.searchKeymap])),
  CV.EditorView.updateListener.of(u=>{if(u.docChanged)onChange?.();}));
 else ext.push(CS.EditorState.readOnly.of(true),CV.EditorView.editable.of(false));
 return {doc,extensions:ext};
}
panelType("skillchange",{side:"mine",icon:"edit",
 title:p=>"改技能"+(Changes[p.pid]?.data?" · "+Changes[p.pid].data.title:""),
 mount(p,node,pid){p.pid=pid;Changes[pid]={};node.innerHTML='<div class="sc"><div class="loading">正在打开这次修改…</div></div>';loadChange(pid);},
 unmount(p,node){Changes[node.dataset.pid]?.view?.destroy();delete Changes[node.dataset.pid];},
 screen(p,node){
  const c=Changes[node.dataset.pid],d=c?.data;if(!d)return {view:"改技能",change:p.change};
  return {view:"改技能（左右对照）",change:p.change,skill:d.skill,file:d.file,state:d.state,by:d.by,why:d.why,
   learner_edited:c.view?c.view.b.state.doc.toString()!==d.proposed:false,changes:c.view?c.view.chunks.length:0};
 }});
async function loadChange(pid){
 const p=Dock.panels[pid],c=Changes[pid];if(!p||!c)return;
 const d=await safe(()=>rpc("skill_change",{id:p.change}));if(!Changes[pid])return;
 if(!d){Dock.els[pid].querySelector(".sc").innerHTML=emptyState("edit","打不开这次修改","可能已经被删掉了。");return;}
 c.data=d;refreshTab(pid);renderChange(pid);
}
function changeBy(d){return d.by==="me"?"我":who(d.by);}
function renderChange(pid){
 const c=Changes[pid],d=c.data,node=Dock.els[pid];if(!d||!node)return;
 c.view?.destroy();c.view=null;
 const open=d.state==="open",stale=open&&d.current!==d.base,file=d.file.split("/").slice(2).join("/");
 node.querySelector(".sc").innerHTML=
  '<div class="sc-head"><div class="sc-title">'+svg("store",15)+'<b>'+esc(d.title)+'</b><small>'+esc(file)+'</small>'+
   (d.base?"":'<span class="chip ai">新技能</span>')+'<span class="grow"></span>'+
   (open?'<span class="chip ai">等你审</span>':d.state==="approved"?'<span class="chip on">已批准'+(d.final!==d.proposed?"（你改过）":"")+'</span>':'<span class="chip">没采用</span>')+'</div>'+
   '<div class="sc-why">'+esc(changeBy(d))+'提的 · '+esc(fmtDate(d.at,true))+(d.why?'：'+esc(d.why):"")+'</div></div>'+
  (stale?'<div class="sc-warn">'+svg("info",13)+'<span>这个技能在提出这次修改之后又被改过了，左边是提出时的样子。</span>'+button("左边换成现在的","sc-rebase",'data-pid="'+pid+'"',"ghost xs")+'</div>':"")+
  '<div class="sc-cols"><div><b>原来</b><small>'+(open?"只读":"")+'</small></div><div><b>'+(open?'改成</b><small>可以直接改；每处修改旁的箭头把左边那一段拿回来</small>':d.state==="approved"?"改成了</b>":"提议的样子</b>")+
   (open?'<span class="grow"></span>'+button("全部用原文","sc-all-left",'data-pid="'+pid+'" data-tip="右边换成左边的全文，再自己改"',"ghost xs")+button("换回提议的","sc-reset",'data-pid="'+pid+'" data-tip="丢掉你在右边的改动"',"ghost xs"):"")+'</div></div>'+
  '<div class="sc-merge"></div>'+
  '<div class="sc-foot"><span class="sc-stat"></span><span class="grow"></span>'+
   button(svg("history",13)+" 历史","sc-history",'data-pid="'+pid+'"',"ghost sm")+
   (d.file.endsWith("/SKILL.md")?button(svg("split",13)+" 两版对比试用","sc-compare",'data-pid="'+pid+'" data-tip="接着一段对话，用原来和改过的技能各回答一次，挑一个"',"ghost sm"):"")+
   (open?button("不改了","sc-dismiss",'data-pid="'+pid+'"',"ghost sm")+button(svg("check",13)+" 批准","sc-approve",'data-pid="'+pid+'"',"primary sm"):
    button(svg("document",13)+" 打开文件","open-file",'data-path="'+esc(d.file)+'"',"ghost sm"))+'</div>';
 const right=open?d.proposed:d.state==="approved"?d.final:d.proposed;
 c.view=new CM.merge.MergeView({a:diffSide(d.base,false),b:diffSide(right,open,()=>changeStat(pid)),parent:node.querySelector(".sc-merge"),
  revertControls:open?"a-to-b":undefined,highlightChanges:true,gutter:true,collapseUnchanged:{margin:3,minSize:8},
  renderRevertControl:()=>{const b=document.createElement("button");b.className="sc-take";b.title="用左边这一段";b.innerHTML=svg("arrow",12);return b;}});
 changeStat(pid);
}
function changeStat(pid){
 const c=Changes[pid],out=Dock.els[pid]?.querySelector(".sc-stat");if(!c?.view||!out)return;
 const a=c.view.a.state.doc,b=c.view.b.state.doc,chunks=c.view.chunks;
 let del=0,add=0;for(const ch of chunks){if(ch.toA>ch.fromA)del+=a.lineAt(Math.max(ch.fromA,ch.toA-1)).number-a.lineAt(ch.fromA).number+1;if(ch.toB>ch.fromB)add+=b.lineAt(Math.max(ch.fromB,ch.toB-1)).number-b.lineAt(ch.fromB).number+1;}
 const mine=c.data.state==="open"&&b.toString()!==c.data.proposed;
 out.innerHTML=chunks.length?'改了 '+chunks.length+' 处 · <span class="sc-del">−'+del+' 行</span> <span class="sc-add">+'+add+' 行</span>'+(mine?' · <span class="sc-mine">右边有你的改动</span>':""):"和原来一样";
}
async function changeAction(kind,a){
 const pid=a.dataset.pid,c=Changes[pid],d=c?.data;if(!d)return;
 const right=c.view?.b;
 if(kind==="sc-all-left"){right.dispatch({changes:{from:0,to:right.state.doc.length,insert:d.base}});return right.focus();}
 if(kind==="sc-reset"){if(right.state.doc.toString()!==d.proposed&&!await ask("右边你改的会丢掉。",{title:"换回提议的样子？",ok:"换回"}))return;right.dispatch({changes:{from:0,to:right.state.doc.length,insert:d.proposed}});return;}
 if(kind==="sc-rebase"){if(!await ask("左边会换成技能现在的样子，右边不动；对照的就是现在的版本和右边。",{title:"左边换成现在的？",ok:"换"}))return;d.base=d.current;return renderChange(pid);}
 if(kind==="sc-history")return skillHistory(d.skill);
 if(kind==="sc-compare")return startCompare(d.skill,d.title,d.base,right?right.state.doc.toString():d.final||d.proposed,d.thread);
 if(kind==="sc-dismiss"){if(!await ask("技能保持原来的样子，这次修改留在历史里。",{title:"不采用这次修改？",ok:"不改了"}))return;await rpc("skill_change_decide",{id:d.id,decision:"dismissed"});return loadChange(pid);}
 if(kind==="sc-approve"){
  const content=right.state.doc.toString();
  if(d.current!==d.base&&!await ask("技能在这次修改提出之后又被改过；批准会用右边的内容替换现在的版本（现在的留在历史里）。",{title:"还是批准？",ok:"批准",danger:true}))return;
  const r=await rpc("skill_change_decide",{id:d.id,decision:"approved",content});
  toast(r.edited?"已批准你改过的版本":"已批准");skillsChanged();return loadChange(pid);
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
 // An agent's proposal opens at once; a decision made elsewhere shows in any window on it.
 const shown=Object.keys(Changes).filter(pid=>Dock.panels[pid]?.change===evt.change);
 if(evt.state==="open"&&(evt.by==="me"||!shown.length))return wideWindow(openPanel({type:"skillchange",change:evt.change}));
 shown.forEach(pid=>{if(Changes[pid]?.data?.state==="open")loadChange(pid);});
}
/* A skill's history: every committed version of its SKILL.md with the reason; any one can be compared with now and
   brought back, which goes through the same review. */
async function skillHistory(slug){
 const versions=await rpc("skill_history",{slug});
 modal(modalHead("技能的历史 · "+slug)+'<p class="muted">每次修改都是一条记录（批准时写了谁提的、为什么改）。点「和现在对照」会打开左右对照：左边是现在，右边是那个版本，批准就恢复成它。</p>'+
  (versions.length?'<div class="sc-history">'+versions.map((v,i)=>'<div class="version"><div><b>'+esc(v.subject)+'</b><small>'+esc(fmtDate(v.at,true))+' · '+esc(v.author)+(v.current?" · 现在的版本":"")+'</small></div>'+
   (v.current?"":button("和现在对照","sc-restore",'data-slug="'+esc(slug)+'" data-commit="'+esc(v.commit)+'" data-when="'+esc(fmtDate(v.at,true))+'"',"ghost xs"))+'</div>').join("")+'</div>':'<p>还没有历史。</p>'),"large");
}
async function restoreVersion(a){
 const v=await rpc("file_version",{path:"skills/"+a.dataset.slug+"/SKILL.md",commit:a.dataset.commit});
 closeModal();
 await rpc("skill_propose",{slug:a.dataset.slug,content:v.content||"",why:"恢复成 "+a.dataset.when+" 的版本"});
}
/* ---- trying two versions on one conversation ---------------------------------------------------------------- */
async function startCompare(slug,title,a,b,thread){
 if(a===b)return toast("两边一样，没什么可比的；先在右边改一改");
 const question=await dialog({title:"两版对比试用",message:"接着同一段对话，原来的技能和改过的技能各回答一次。",
  input:{placeholder:"要它回答什么（不填就重新回答这段对话的最后一个问题）",allowEmpty:true},ok:"开始"});
 if(question==null)return;
 const r=await rpc("skill_compare",{slug,a,b,thread:thread||null,message:question});
 Compares[r.compare]={a:{text:"",done:false},b:{text:"",done:false}};
 wideWindow(openPanel({type:"skillcompare",compare:r.compare,slug,title,question:r.question,thread:r.thread,thread_title:r.title,agent:r.agent},{reuse:false}));
}
panelType("skillcompare",{side:"mine",icon:"split",
 title:p=>"对比试用 · "+(p.title||p.slug),
 mount(p,node,pid){p.pid=pid;node.innerHTML='<div class="cmp"></div>';renderCompare(pid);},
 screen(p){const c=Compares[p.compare];return {view:"技能两版对比",skill:p.slug,question:shorten(p.question,200),a_done:!!c?.a.done,b_done:!!c?.b.done,picked:p.picked||null};}});
function compareSide(pid,side){
 const p=Dock.panels[pid],c=Compares[p.compare]||{},s=c[side]||{text:p[side]||"",done:true},label=side==="a"?"左边：原来的":"右边：改成的";
 const editing=p.editing===side,picked=p.picked;
 return '<div class="cmp-side'+(picked===side?" picked":"")+'" data-side="'+side+'"><div class="cmp-label">'+(side==="a"?svg("history",13):svg("edit",13))+' '+label+
  (s.done?"":'<span class="cmp-live">'+(s.thinking?"在想…":"在写…")+'</span>')+'</div>'+
  '<div class="cmp-body">'+(editing?editorHost(s.text,'class="editor prose" data-cmp-edit="'+side+'"',{markdown:true}):
   s.text?'<div class="markdown cmp-reply" data-side="'+side+'"></div>':'<div class="thinking"><span></span><span></span><span></span><b>正在想…</b></div>')+'</div>'+
  '<div class="cmp-foot">'+(picked?(picked===side?'<span class="chip on">用了这一边</span>':""):s.done&&s.text?
   (editing?"":button(svg("edit",12)+" 改一改","cmp-edit",'data-pid="'+pid+'" data-side="'+side+'"',"ghost xs"))+button(svg("check",12)+" 用这个","cmp-pick",'data-pid="'+pid+'" data-side="'+side+'"',"primary xs"):"")+'</div></div>';
}
function renderCompare(pid){
 const p=Dock.panels[pid],node=Dock.els[pid];if(!p||!node)return;
 const c=Compares[p.compare],running=c&&(!c.a.done||!c.b.done);
 destroyEditors(node);
 node.querySelector(".cmp").innerHTML='<div class="cmp-head"><div><b>'+esc(p.title||p.slug)+'</b> 两个版本接着「'+esc(p.thread_title||"这段对话")+'」回答</div>'+
  '<div class="cmp-q">'+svg("quote",12)+' '+esc(shorten(p.question,240))+'</div>'+(running?button(svg("stop",12)+" 停止","cmp-stop",'data-pid="'+pid+'"',"ghost xs"):"")+'</div>'+
  (!c&&!p.a?'<div class="cmp-gone">'+emptyState("split","这次对比已经不在了","程序重启过；回到左右对照里再开一次。")+'</div>':
   '<div class="cmp-cols">'+compareSide(pid,"a")+compareSide(pid,"b")+'</div>');
 mountEditors(node);
 // Each reply as a conversation shows it, blocks included (questions cannot be answered here).
 for(const box of all(".cmp-reply",node)){const s=(c||{})[box.dataset.side]||{text:p[box.dataset.side]||"",done:true};const r=replyHtml(s.text,!s.done);box.innerHTML=r.html;
  if(r.blocks.length)mountBlocks(box,r.blocks,{thread:p.thread,message:0,answers:{},pid,live:true});}
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
 for(const pid of Object.keys(Dock.panels).filter(x=>Dock.panels[x].compare===id)){
  if(evt.kind==="finished"){Dock.panels[pid][side]=s.text;saveLayout();}
  if(compareFrames[pid])continue;
  compareFrames[pid]=setTimeout(()=>{delete compareFrames[pid];renderCompare(pid);},evt.kind==="finished"?0:120);
 }
}
async function compareAction(kind,a){
 const pid=a.dataset.pid,p=Dock.panels[pid];if(!p)return;
 const side=a.dataset.side,c=Compares[p.compare];
 if(kind==="cmp-stop")return rpc("compare_stop",{id:p.compare});
 if(kind==="cmp-edit"){p.editing=side;renderCompare(pid);return setTimeout(()=>focusEditor(Dock.els[pid]),50);}
 if(kind==="cmp-pick"){
  const edited=p.editing===side?editorIn(Dock.els[pid].querySelector('.cmp-side[data-side="'+side+'"]'))?.state.doc.toString():null;
  const text=edited??c?.[side]?.text??p[side]??"";
  await rpc("compare_pick",{id:p.compare,side,content:text});
  p.picked=side;p.editing=null;saveLayout();renderCompare(pid);
  toast("这一边成了「"+(p.thread_title||"那段对话")+"」的下一条回答");
  const chat=Object.keys(Chat).find(x=>Chat[x].thread===p.thread);if(chat)loadChat(chat);
 }
}
