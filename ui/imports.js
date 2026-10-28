"use strict";
/* Bringing in a conversation had with an AI on the web, to go on with here: paste its shared link (in the window opened
   from the + menu or the topics list, or straight into a conversation's input), look at what was read, and it becomes
   one of the tutor's conversations under the topic being learned, opened where it left off. */
const SHARE_LINK=/^https?:\/\/(www\.)?(chatgpt\.com|chat\.openai\.com)\/share\/[\w-]+\/?(\?\S*)?$/;
const Importing={request:null,pid:null};
function importChat(url="",pid=null){
 Importing.request=null;Importing.pid=pid;
 const box=modal(modalHead("导入网页上的 AI 对话")+
  '<p class="muted">在 ChatGPT 里打开那段对话，点右上角的「分享」→「复制链接」，贴到下面。导入后它成为主会话的一段会话，接着聊；主会话知道前面是另一个 AI 说的。</p>'+
  '<div class="import-row"><input class="import-url" placeholder="https://chatgpt.com/share/…" value="'+esc(url)+'" spellcheck="false"/>'+button("读取","import-read","","primary sm")+'</div>'+
  '<div class="import-preview"></div>'+
  '<div class="modal-actions">'+(pid?button("只把链接贴进输入框","import-paste","","ghost"):"")+'<span class="grow"></span>'+button("导入并接着聊","import-save","disabled","primary")+'</div>',"import-pop");
 const input=box.querySelector(".import-url");
 input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.isComposing){e.preventDefault();importRead();}});
 setTimeout(()=>input.focus(),30);
 if(url)importRead();
}
async function importRead(){
 const box=el(".import-pop");if(!box)return;
 const url=box.querySelector(".import-url").value.trim(),preview=box.querySelector(".import-preview");
 box.querySelector('[data-action="import-save"]').disabled=true;
 if(!SHARE_LINK.test(url)){preview.innerHTML='<p class="warn">现在能导入的是 ChatGPT 的分享链接（chatgpt.com/share/…）。</p>';return;}
 preview.innerHTML='<div class="loading">正在读这段对话…</div>';
 try{Importing.request=(await rpc("import_read",{url})).request;}
 catch(e){preview.innerHTML='<p class="warn">'+esc(e.message)+'</p>';}
}
function importEvent(evt){
 const box=el(".import-pop");if(!box||evt.request!==Importing.request)return;
 const preview=box.querySelector(".import-preview");
 if(evt.error){preview.innerHTML='<p class="warn">没能读出这段对话：'+esc(evt.error)+'</p>';return;}
 const topic=S.data.active_topic?topicTitle(S.data.active_topic):"默认对话";
 preview.innerHTML='<div class="import-card"><b>'+esc(evt.title)+'</b><small>'+esc(evt.source)+(evt.created?' · '+esc(fmtDate(evt.created,true)):"")+' · '+evt.turns+' 轮问答，'+evt.count+' 条</small>'+
  (evt.first?'<p>'+esc(shorten(evt.first,220))+'</p>':"")+'<small>会放进「'+esc(topic)+'」，成为一段新的主会话。</small></div>';
 const save=box.querySelector('[data-action="import-save"]');save.disabled=false;save.focus();
}
async function importAction(kind){
 if(kind==="import-read")return importRead();
 if(kind==="import-paste"){
  const box=el(".import-pop"),url=box?.querySelector(".import-url").value||"",pid=Importing.pid;closeModal();
  const area=pid&&Dock.els[pid]?.querySelector("[data-composer]");if(area){area.focus();document.execCommand("insertText",false,url);}
  return;
 }
 if(kind==="import-save"){
  if(!Importing.request)return;
  const r=await rpc("import_save",{request:Importing.request});Importing.request=null;closeModal();
  await openSession(r.thread);showTutor();toast("导入好了，接着聊吧");
 }
}
// A shared link pasted into a conversation's input: offered for import.
document.addEventListener("paste",e=>{
 const pid=e.target?.dataset?.composer,text=(e.clipboardData?.getData("text/plain")||"").trim();
 if(!pid||!SHARE_LINK.test(text))return;
 e.preventDefault();e.stopImmediatePropagation();importChat(text,pid);
},true);
/* In a conversation: where the imported part ends, and who said it. */
function importedDivider(st){
 const list=st.data?.messages||[],last=list.map(m=>!!m.meta?.imported).lastIndexOf(true);if(last<0)return null;
 const head=st.data.head?.imported||{},source=list[last].meta.imported;
 return {after:list[last].id,html:'<div class="import-divider"><span>以上 '+(head.count||last+1)+' 条从 '+esc(source)+' 导入'+
  (head.url?' · <a data-action="open-url" data-url="'+esc(head.url)+'">原对话</a>':"")+'，从这里接着聊</span></div>'};
}
