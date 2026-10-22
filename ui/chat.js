"use strict";
/* AI panels: one conversation with one agent. Everything an agent shows lives in its own panel;
   the learner reads, answers its questions, and takes what they want to their side. */
const Chat={};
const AGENT_ICON={tutor:"bot",flash:"spark",coach:"code",organizer:"edit"};
const AGENT_HINT={tutor:"想到什么，直接说",flash:"这个词什么意思？这行为什么这样写？",coach:"说说你的想法、预测，或者哪里卡住了"};
function sendHint(){return S.ui.send_key==="ctrl"?"Ctrl + Enter 发送":"Enter 发送，Shift + Enter 换行";}
function agentTitle(agent){return S.data?.agents?.[agent]||agent;}
function topicTitle(id){return id?(S.data?.topics||[]).find(t=>t.id===id)?.title||"已删除的主题":"";}
panelType("chat",{side:"ai",icon:p=>AGENT_ICON[p.agent]||"bot",
 title(p,node){
  const st=Chat[node?.dataset.pid],head=st?.data?.head;
  if(p.agent==="coach")return head?.title||"练习";
  const topic=head?.topic;return agentTitle(p.agent)+(topic?" · "+topicTitle(topic):"");
 },
 mount(p,node,pid){
  Chat[pid]={input:"",stream:"",live:[],waiting:"",error:"",data:null,cache:{},attach:[],opened:new Set()};
  node.innerHTML='<div class="chat"><div class="chat-head"></div><div class="chat-scroll"><div class="loading">正在打开对话…</div></div><div class="composer"></div><div class="chat-starters"></div></div>';
  loadChat(pid);
 },
 unmount(p,node){delete Chat[node.dataset.pid];},
 shown(p,node){const pid=node.dataset.pid,st=Chat[pid],box=node.querySelector(".chat-scroll");if(st&&box&&st.bottom!==false)box.scrollTop=box.scrollHeight;fitComposer(pid);},
 screen(p,node){
  const st=Chat[node.dataset.pid];if(!st?.data)return {agent:p.agent};
  const answers=answersOf(st.data.messages),open=[];
  st.data.messages.forEach(m=>{if(m.role!=="assistant")return;let i=0;String(m.content).replace(BLOCK_RE,(x,type)=>{if(type==="quiz"&&!answers[m.id+":"+i])open.push(m.id+":"+i);i++;return x;});});
  return {agent:p.agent,thread:st.thread,title:panelTitle(node.dataset.pid),messages:st.data.messages.length,unanswered_quizzes:open.slice(-5),busy:st.data.busy,draft:st.input?shorten(st.input,200):"",
   ...(st.attach.length?{attached:st.attach.map(a=>a.path)}:{}),...(p.model?{model:p.model.model}:{})};
 }});
async function loadChat(pid,keepScroll=true){
 const p=Dock.panels[pid],st=Chat[pid];if(!p||!st)return;
 const data=await safe(()=>rpc("chat",p.thread?{agent:p.agent,thread:p.thread}:{agent:p.agent,topic:S.data.active_topic||""}));
 if(!data||!Chat[pid])return;
 if(st.thread&&st.thread!==data.thread){st.cache={};st.stream="";st.live=[];st.error="";}
 st.thread=data.thread;st.data=data;
 renderChat(pid,keepScroll);refreshTab(pid);
}
function chatPanels(thread){return Object.keys(Chat).filter(pid=>Chat[pid].thread===thread);}
function followingPanels(){return Object.keys(Chat).filter(pid=>Dock.panels[pid]&&!Dock.panels[pid].thread);}
function answersOf(messages){const out={};(messages||[]).forEach(m=>{const a=m.meta?.answer;if(a)out[a.message+":"+a.block]=m.content.replace(/^我的回答：/,"");});return out;}
function renderChat(pid,keepScroll=true){
 const node=Dock.els[pid],st=Chat[pid],p=Dock.panels[pid];if(!node||!st?.data)return;
 const scroll=node.querySelector(".chat-scroll"),stick=!keepScroll||st.bottom!==false;
 if(!scroll.__watched){
  scroll.__watched=true;
  scroll.addEventListener("scroll",()=>{if(!scroll.isConnected||!scroll.clientHeight)return;st.bottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<140;toBottomButton(pid);});
  // Which folded action lists are open survives re-rendering.
  scroll.addEventListener("toggle",e=>{const mid=e.target.closest?.("[data-mid]")?.dataset.mid;if(mid&&e.target.matches("details.actions"))e.target.open?st.opened.add(mid):st.opened.delete(mid);},true);
 }
 node.querySelector(".chat-head").innerHTML=chatHead(pid);
 const answers=answersOf(st.data.messages);
 scroll.innerHTML="";
 const msgs=st.data.messages,empty=!msgs.length&&!st.data.busy;
 node.querySelector(".chat").classList.toggle("blank",empty);
 if(empty)scroll.appendChild(h('<div class="chat-welcome">'+chatWelcome(p.agent)+'</div>'));
 msgs.forEach(m=>scroll.appendChild(messageEl(pid,m,answers)));
 scroll.appendChild(h('<div class="live-slot"></div>'));
 renderLive(pid);
 node.querySelector(".chat-starters").innerHTML=empty?chatStarters(pid):"";
 if(!node.querySelector(".composer textarea"))node.querySelector(".composer").innerHTML=composerHtml(pid);
 updateComposer(pid);
 if(stick)scroll.scrollTop=scroll.scrollHeight;
 toBottomButton(pid);
}
function toBottomButton(pid){
 const node=Dock.els[pid],b=node?.querySelector(".to-bottom");if(!b)return;
 b.hidden=Chat[pid]?.bottom!==false||node.querySelector(".chat")?.classList.contains("blank");
}
function chatWelcome(agent){
 if(agent==="coach")return '<h3>练习开始了</h3><p>教练会一步步带你写。</p>';
 if(agent==="flash")return '<h3>小问题，不必打断大思路。</h3><p>选中任何地方的文字或代码再问，快答会结合你正在看的内容来解释。</p>';
 return '<h3>想到什么，直接说。</h3><p>值得长期深入的内容，主会话会整理成主题，并定一条主干路线。</p>';
}
/* Where to start, from what is actually in the vault and on screen. */
function chatStarters(pid){
 const p=Dock.panels[pid],d=S.data||{};if(p.agent!=="tutor")return "";
 const out=[],topics=d.topics||[];
 const current=topics.find(t=>t.id===d.active_topic);
 (current?[current]:topics.filter(t=>t.state==="active").slice(0,2)).forEach(t=>out.push({icon:"map",text:"接着学「"+t.title+"」",say:"我们接着学「"+t.title+"」吧。上次讲到哪了，下一步学什么？"}));
 if(d.due)out.push({icon:"refresh",text:"回顾 "+d.due+" 张到期的卡",say:"我有 "+d.due+" 张知识卡到期了，带我回顾一下。"});
 const practice=(d.practices||[]).find(x=>x.state==="active");
 if(practice)out.push({icon:"code",text:"回到练习「"+practice.title+"」",action:'data-action="open-practice" data-id="'+esc(practice.id)+'"'});
 const recent=(Dwell.recent||[])[0];
 if(recent)out.push({icon:fileIcon(recent.path),text:"聊聊我刚才看的 "+recent.path.split("/").pop(),say:"看看我刚才在看的 "+recent.path+"，帮我理一理要点，指出值得深入的地方。"});
 return out.slice(0,4).map(x=>'<button class="starter" '+(x.action||'data-action="chat-starter" data-pid="'+pid+'" data-say="'+esc(x.say)+'"')+'>'+svg(x.icon,15)+'<span>'+esc(x.text)+'</span></button>').join("");
}
function chatHead(pid){
 const p=Dock.panels[pid],st=Chat[pid],d=st.data;
 if(p.agent==="coach"){
  const pr=d.practice;if(!pr)return "";
  return '<span class="head-title">'+esc(pr.title||"练习")+'</span><div class="chat-tools">'+button(svg("file",13)+" 练习文件","open-file",'data-path="'+esc(pr.file||"")+'"',"ghost sm")+
   (pr.state==="active"?button("看看我的代码","chat-task",'data-pid="'+pid+'" data-task="check"',"ghost sm")+button("给点提示","chat-task",'data-pid="'+pid+'" data-task="hint"',"ghost sm")+
    button(svg("check",13)+" 结束并复盘","practice-end",'data-pid="'+pid+'"',"primary sm"):'<span class="chip">'+(pr.state==="reviewing"?"主会话复盘中":"已复盘")+'</span>')+'</div>';
 }
 const topic=d.head?.topic;
 const tools=(p.agent==="tutor"?iconButton("book","chat-task","提炼知识卡",'data-pid="'+pid+'" data-task="capture"'):"")+iconButton("edit","chat-new","开新会话",'data-pid="'+pid+'"');
 return '<button class="topic-chip'+(topic?"":" quiet")+'" data-action="chat-topic-menu" data-pid="'+pid+'" title="这段对话属于哪个主题">'+svg(topic?"map":"bot",12)+'<span>'+esc(topic?topicTitle(topic):"默认对话")+'</span>'+svg("chevrondown",11)+'</button>'+
  '<div class="chat-tools">'+tools+'</div>';
}
function topicMenu(pid,anchor){
 const st=Chat[pid],topic=st?.data?.head?.topic,topics=(S.data.topics||[]).filter(t=>t.state==="active"&&t.id!==topic);
 popMenu(anchor,(topic?'<button data-action="open-doc" data-id="'+esc(topic)+'">'+svg("map",14)+'<span>打开主题页</span></button><hr/>':"")+
  '<div class="menu-label">在哪里接着聊</div>'+(topic?'<button data-action="topic-focus" data-id="">'+svg("bot",14)+'<span>默认对话</span></button>':"")+
  topics.slice(0,14).map(t=>'<button data-action="topic-focus" data-id="'+esc(t.id)+'">'+svg("map",14)+'<span>'+esc(t.title)+'</span></button>').join("")+
  (!topic&&!topics.length?'<p class="menu-empty">还没有主题。聊着聊着，主会话会把值得深入的内容建成主题。</p>':""));
}
function messageEl(pid,m,answers){
 const st=Chat[pid],p=Dock.panels[pid],meta=m.meta||{};
 const key=m.id+"|"+m.content.length+"|"+(st.data.undone||[]).length+"|"+JSON.stringify(st.data.decisions||{}).length+"|"+Object.keys(answers).length;
 let cached=st.cache[m.id];
 if(!cached||cached.key!==key){
  const mine=m.role==="user";
  const r=mine?{html:markdown(m.content),blocks:[]}:replyHtml(m.content);
  const incomplete=!mine&&meta.stop_reason&&meta.stop_reason!=="end_turn";
  const foot='<div class="msg-foot">'+(mine?"":'<span>'+esc(agentTitle(meta.agent||p.agent))+'</span>')+'<time>'+esc(fmtDate(m.at,true))+'</time>'+
   (m.content.trim()?iconButton("copy","msg-copy","复制",'data-pid="'+pid+'" data-mid="'+m.id+'"'):"")+(!mine&&m.content.trim()?messageTools(pid,m):"")+'</div>';
  const html=mine?'<div class="msg from-me" data-mid="'+m.id+'"><div class="bubble">'+
    (meta.selection?'<div class="msg-quote">'+esc(shorten(meta.selection,180))+'</div>':"")+
    (meta.attach?.length?'<div class="msg-attach">'+meta.attach.map(x=>'<a data-action="open-file" data-path="'+esc(x)+'">'+svg(fileIcon(x),12)+' '+esc(x.split("/").pop())+'</a>').join("")+'</div>':"")+
    '<div class="markdown msg-body">'+r.html+'</div></div>'+foot+'</div>'
   :'<div class="msg from-ai" data-mid="'+m.id+'"><div class="markdown msg-body">'+r.html+'</div>'+
    (incomplete?'<div class="msg-note">'+esc(meta.stop_reason==="cancelled"?"已停止 · 保留了部分回答":meta.stop_reason==="max_tokens"?"达到回复长度上限":"没有正常结束 · 只保留了收到的部分")+'</div>':"")+
    actionChips(meta.actions||[],st.data.undone||[])+sourcesHtml(meta.sources)+suggestionsHtml(pid,m)+foot+'</div>';
  cached=st.cache[m.id]={key,html,blocks:r.blocks};
 }
 const node=h(cached.html);
 const fold=node.querySelector("details.actions");if(fold)fold.open=st.opened.has(String(m.id));
 if(cached.blocks.length)mountBlocks(node,cached.blocks,{thread:st.thread,message:m.id,answers,pid});
 return node;
}
function messageTools(pid,m){
 const agent=Dock.panels[pid].agent,out=[];
 if(agent==="tutor")out.push(button(svg("code",12)+" 开始练习","practice-start",'data-pid="'+pid+'" data-mid="'+m.id+'" title="让练习教练带着你一步步把这段内容写出来"',"ghost xs"));
 if(agent==="tutor"||agent==="flash")out.push(button(svg("card",12)+" 存成卡片","message-card",'data-pid="'+pid+'" data-mid="'+m.id+'"',"ghost xs"));
 if(agent==="flash")out.push(button("交给主会话深入讲","message-escalate",'data-pid="'+pid+'" data-mid="'+m.id+'"',"ghost xs"));
 return out.join("");
}
/* What the agent did, folded to one line; the steps that need the learner now stay outside the fold. */
function actionChips(actions,undone=[],live=false){
 if(!actions?.length)return "";
 const gone=a=>undone.includes(a.id)||(S.data?.undone||[]).includes(a.id);
 const rows=actions.map(a=>'<div class="action'+(gone(a)?" undone":"")+'">'+svg(live?"spark":"check",12)+'<span>'+esc(a.summary)+'</span>'+
   (a.ref&&!gone(a)&&!a.ref.startsWith("handoff:")&&!a.ref.startsWith("ui:")?button("查看","open-ref",'data-ref="'+esc(a.ref)+'"',"ghost xs"):"")+
   (a.undoable&&!gone(a)&&!live?button(svg("undo",11)+" 撤销","undo",'data-id="'+esc(a.id)+'"',"ghost xs"):gone(a)?'<small>已撤销</small>':"")+'</div>').join("");
 const lead=live?"":actions.filter(a=>a.ref&&!gone(a)&&(a.ref.startsWith("handoff:")||a.ref.startsWith("ui:"))).map(a=>a.ref.startsWith("handoff:")?
   button("请主会话接住","handoff",'data-topic="'+esc(a.ref.slice(8))+'"',"ghost xs"):button(svg("undo",11)+" 还原界面","ui-restore",'data-snapshot="'+esc(a.ref.slice(3))+'"',"ghost xs")).join("");
 const line=live?"正在："+actions[actions.length-1].summary:actions.map(a=>a.summary).join(" · ");
 return '<details class="actions'+(live?" live":"")+'"><summary>'+svg(live?"spark":"check",12)+'<b>'+actions.length+' 步</b><span>'+esc(line)+'</span>'+svg("chevrondown",11)+'</summary><div class="action-list">'+rows+'</div></details>'+
  (lead?'<div class="action-lead">'+lead+'</div>':"");
}
function sourcesHtml(sources){
 if(!sources?.length)return "";
 return '<div class="sources"><span>'+svg("link",12)+' 来源</span>'+sources.map(s=>'<a data-action="open-url" data-url="'+esc(s.url)+'" title="'+esc(s.url)+'">'+esc(shorten(s.title||s.url,48))+'</a>').join("")+'</div>';
}
function suggestionsHtml(pid,m){
 const list=m.meta?.suggestions||[];if(!list.length)return "";
 const decided=Chat[pid].data.decisions||{};
 return list.map(s=>{
  const state=decided[m.id+":"+s.id];
  const diff=(s.old?s.old.split("\n").map(l=>'<div class="del">- '+esc(l)+'</div>').join(""):'<div class="ctx">（加到文件末尾）</div>')+s.new.split("\n").map(l=>'<div class="add">+ '+esc(l)+'</div>').join("");
  return '<div class="suggestion"><div class="suggestion-head">'+svg("edit",13)+' 建议修改 <a data-action="open-file" data-path="'+esc(s.file)+'"'+(s.old?' data-highlight="'+esc(s.old.split("\n")[0].slice(0,80))+'"':"")+'>'+esc(s.file)+'</a>'+(s.why?'<span>'+esc(s.why)+'</span>':"")+'</div>'+
   '<div class="diff">'+diff+'</div><div class="suggestion-actions">'+(state?'<small>'+(state==="applied"?"已应用":"已忽略")+'</small>':
   button("应用","suggestion",'data-pid="'+pid+'" data-mid="'+m.id+'" data-sid="'+esc(s.id)+'" data-decision="applied"',"primary xs")+button("忽略","suggestion",'data-pid="'+pid+'" data-mid="'+m.id+'" data-sid="'+esc(s.id)+'" data-decision="dismissed"',"ghost xs"))+'</div></div>';
 }).join("");
}
/* Only the reply being written re-renders while it streams. */
function renderLive(pid){
 const node=Dock.els[pid],st=Chat[pid];if(!node||!st)return;
 const slot=node.querySelector(".live-slot");if(!slot)return;
 const busy=st.data?.busy;
 if(!st.stream&&!st.live.length&&!busy&&!st.error){slot.innerHTML="";return;}
 const r=replyHtml(st.stream,true);
 slot.innerHTML=(st.stream||st.live.length?'<div class="msg from-ai streaming"><div class="markdown msg-body">'+r.html+'</div>'+actionChips(st.live,[],true)+'</div>':"")+
  (busy&&!st.stream?'<div class="thinking"><span></span><span></span><span></span><b>'+esc(st.waiting||"正在想…")+'</b></div>':"")+
  (st.error?'<div class="chat-error">'+esc(st.error)+'</div>':"");
 if(r.blocks.length)mountBlocks(slot,r.blocks,{thread:st.thread,message:0,answers:{},pid,live:true});
}
const liveFrames={};
function patchLive(pid){
 if(liveFrames[pid])return;
 liveFrames[pid]=setTimeout(()=>requestAnimationFrame(()=>{
  delete liveFrames[pid];
  const scroll=Dock.els[pid]?.querySelector(".chat-scroll");if(!scroll)return;
  const stick=Chat[pid]?.bottom!==false;
  renderLive(pid);if(stick)scroll.scrollTop=scroll.scrollHeight;
 }),90);
}
/* The input: a capsule while it holds one line, a rounded box once it needs more. */
function composerHtml(pid){
 return '<button class="to-bottom" data-action="chat-bottom" data-pid="'+pid+'" title="回到最新" hidden>'+svg("arrowup",15)+'</button>'+
  '<div class="attach-row"></div><div class="capsule">'+
  '<button class="cap-btn" data-action="chat-attach" data-pid="'+pid+'" title="附上文件">'+svg("plus",17)+'</button>'+
  '<textarea rows="1" data-composer="'+pid+'"></textarea>'+
  '<button class="model-tag" data-action="chat-model" data-pid="'+pid+'" title="这个窗口用的模型"></button><span class="send-slot"></span></div>';
}
function chatModel(pid){
 const p=Dock.panels[pid],cfg=S.config?.agents?.[p.agent]||{},use=p.model;
 const api=use?.api||cfg.api,ready=use?!!(S.config?.apis||[]).find(a=>a.id===api)?.has_key:!!cfg.ready;
 return {api,model:use?.model||cfg.model||"",own:!!use,ready};
}
function updateComposer(pid){
 const node=Dock.els[pid],st=Chat[pid],p=Dock.panels[pid];if(!node||!st?.data)return;
 const area=node.querySelector(".composer textarea");if(!area)return;
 const ended=p.agent==="coach"&&st.data.practice&&st.data.practice.state!=="active",m=chatModel(pid),busy=st.data.busy;
 area.disabled=ended;
 area.placeholder=ended?"这次练习已经结束":!m.ready?"还没接入模型":(AGENT_HINT[p.agent]||"")+" · "+sendHint();
 node.querySelector(".attach-row").innerHTML=(Sel.text?'<span class="sel-chip">'+svg("quote",11)+' 带上选中的 '+Sel.text.length+' 字<button data-action="sel-clear" title="不带">×</button></span>':"")+
  st.attach.map((a,i)=>'<span class="sel-chip file">'+svg(fileIcon(a.path),11)+' '+esc(a.path.split("/").pop())+'<button data-action="chat-attach-remove" data-pid="'+pid+'" data-index="'+i+'" title="不附上">×</button></span>').join("");
 const tag=node.querySelector(".model-tag");
 tag.innerHTML='<span>'+esc(modelName(m.model))+'</span>'+svg("chevrondown",10);tag.hidden=!m.ready;tag.classList.toggle("own",m.own);tag.classList.toggle("working",!!busy);
 node.querySelector(".send-slot").innerHTML=busy?'<button class="send-round stop" data-action="chat-cancel" data-pid="'+pid+'" title="停止">'+svg("stop",13)+'</button>':
  !m.ready?button("去设置","open-settings",'data-page="agents"',"primary sm pill"):'<button class="send-round" data-action="chat-send" data-pid="'+pid+'" title="发送"'+(ended?" disabled":"")+'>'+svg("arrowup",16)+'</button>';
 fitComposer(pid);
}
function modelName(model){return String(model||"").split("/").pop()||"未选择模型";}
function fitComposer(pid){
 const area=Dock.els[pid]?.querySelector(".composer textarea"),cap=area?.closest(".capsule");if(!area||!area.isConnected)return;
 // Measured in the one-line shape, so it does not flip back and forth at the edge.
 cap.classList.remove("multi");area.style.height="auto";
 const multi=area.value.includes("\n")||area.scrollHeight>area.clientHeight+2;
 cap.classList.toggle("multi",multi);
 area.style.height="auto";area.style.height=area.scrollHeight+"px";
 area.style.overflowY=area.scrollHeight>area.clientHeight+1?"auto":"hidden";
}
function attachMenu(pid,anchor){
 const st=Chat[pid],have=new Set(st.attach.map(a=>a.path));
 const open=Object.values(Dock.panels).filter(p=>p.type==="file"&&p.path).map(p=>p.path);
 const paths=[...new Set([...open,...(Dwell.recent||[]).map(r=>r.path)])].filter(x=>!have.has(x)).slice(0,10);
 popMenu(anchor,'<div class="menu-label">附上文件，AI 需要时会去读</div>'+(paths.map(x=>'<button data-action="chat-attach-add" data-pid="'+pid+'" data-path="'+esc(x)+'">'+svg(fileIcon(x),14)+'<span>'+esc(x.split("/").pop())+'<small>'+esc(x)+'</small></span></button>').join("")||
  '<p class="menu-empty">先打开一个文件，或者在左栏里点开一个，就能附上。</p>'),{above:true});
}
function modelMenu(pid,anchor){
 const p=Dock.panels[pid],m=chatModel(pid),apis=S.config?.apis||[],seen=new Set(),items=[];
 const add=(api,model,note)=>{const k=api+"|"+model;if(!model||seen.has(k))return;seen.add(k);const a=apis.find(x=>x.id===api);if(!a)return;
  items.push('<button data-action="chat-model-set" data-pid="'+pid+'" data-api="'+esc(api)+'" data-model="'+esc(model)+'"'+(a.has_key?"":" disabled")+'>'+(m.api===api&&m.model===model?svg("check",14):'<i class="menu-gap"></i>')+
   '<span>'+esc(modelName(model))+'<small>'+esc(a.label+(note?" · "+note:"")+(a.has_key?"":" · 没有 Key"))+'</small></span></button>');};
 const own=S.config?.agents?.[p.agent];if(own)add(own.api,own.model,agentTitle(p.agent)+"的默认");
 Object.entries(S.config?.agents||{}).forEach(([name,a])=>add(a.api,a.model,agentTitle(name)+"在用"));
 apis.forEach(a=>add(a.id,a.default_model||a.model,""));
 popMenu(anchor,'<div class="menu-label">只改这个窗口，存在布局里</div>'+items.join("")+'<hr/>'+
  '<button data-action="chat-model-other" data-pid="'+pid+'">'+svg("edit",14)+'<span>填写别的模型名…</span></button>'+
  (m.own?'<button data-action="chat-model-set" data-pid="'+pid+'" data-api="" data-model="">'+svg("undo",14)+'<span>恢复成'+esc(agentTitle(p.agent))+'的默认</span></button>':"")+
  '<button data-action="open-settings" data-page="agents">'+svg("sliders",14)+'<span>模型和连接设置</span></button>',{above:true});
}
function setChatModel(pid,api,model){
 const p=Dock.panels[pid],own=S.config?.agents?.[p.agent];if(!p)return;
 if(!model||(own&&own.api===api&&own.model===model))delete p.model;else p.model={api,model};
 saveLayout();updateComposer(pid);
}
async function chatSend(pid,text,extra={}){
 const st=Chat[pid],p=Dock.panels[pid];if(!st)return;
 const node=Dock.els[pid],area=node?.querySelector(".composer textarea");
 const message=(text??area?.value??"").trim();
 if(!message&&!extra.task)return;
 if(st.data?.busy)return toast("这段对话正在回答；可以先停止");
 if(typeof flushAll==="function")await flushAll();
 const selection=extra.selection??Sel.text,attach=text==null?st.attach.map(a=>a.path):[];
 if(text==null&&area){area.value="";fitComposer(pid);}st.input="";
 st.error="";st.stream="";st.live=[];st.waiting="";
 try{
  const r=await rpc("send",{agent:p.agent,message,thread:st.thread,selection,task:extra.task||"",note:screenNote(),answer:extra.answer||null,attach,model:p.model||null});
  st.thread=r.thread;Sel.text="";if(text==null)st.attach=[];
  st.data.messages.push({id:"pending",role:"user",content:message||({check:"我写好了，帮我看看我的代码和运行结果。",hint:"我卡住了，给我一点提示，先别直接给答案。",capture:"把我们讨论过的内容整理成知识卡。"})[extra.task]||"",meta:{selection,answer:extra.answer,attach},at:new Date().toISOString()});
  st.data.busy=true;renderChat(pid,false);
 }catch(e){if(text==null&&area){area.value=message;fitComposer(pid);}st.error=e.message;renderLive(pid);throw e;}
}
function chatEvent(evt){
 if(evt.kind==="connection_test")return settingsTestResult(evt);
 for(const pid of chatPanels(evt.thread)){
  const st=Chat[pid];
  if(evt.kind==="chunk"){st.stream+=evt.text;st.waiting="";patchLive(pid);continue;}
  if(evt.kind==="status"){if(st.data){st.data.status=evt.state;st.data.busy=!["ready","offline","error","cancelled"].includes(evt.state)||st.data.busy;}const head=Dock.els[pid]?.querySelector(".chat-head");if(head)head.innerHTML=chatHead(pid);continue;}
  if(evt.kind==="tool_wait"){st.waiting={ui:"正在调整界面…",shell:"正在命令行里查看…",run:"正在运行代码…",web_search:"正在联网搜索…",web_fetch:"正在读网页…",install:"正在装包…"}[evt.name]||"";patchLive(pid);continue;}
  if(evt.kind==="tool"){st.waiting="";if(evt.actions?.length){st.live.push(...evt.actions);patchLive(pid);}continue;}
  if(evt.kind==="error"){st.error=evt.message||"请求失败";patchLive(pid);continue;}
  if(evt.kind==="finished"){
   st.stream="";st.live=[];st.waiting="";
   if(evt.errors?.length)toast(evt.errors.join("；"),"error");
   if(evt.focus!==undefined){
    S.data.active_topic=evt.focus||null;
    refreshState().then(()=>followingPanels().forEach(x=>loadChat(x)));
   }else loadChat(pid);
  }
 }
 if(evt.kind==="finished"&&evt.agent==="organizer")organizeFinished(evt);
 if(evt.kind==="finished")refreshState();
}
async function startPractice(pid,mid){
 const st=Chat[pid];
 const p=await rpc("practice_start",{thread:st.thread,message:Number(mid)});
 await refreshState();
 const here=stackOf(pid)?.id;
 openPanel({type:"chat",agent:"coach",thread:p.id},{stack:here});
 openFile(p.file);
 toast("练习开始了：左边是教练，右边是你的练习文件");
}
async function openPractice(id){
 const p=await rpc("practice",{id});
 openPanel({type:"chat",agent:"coach",thread:id});
 if(p.file)openFile(p.file);
}
async function endPractice(pid){
 const st=Chat[pid];
 if(!confirm("结束这次练习，交给主会话复盘？结束后这个练习就不能再继续对话了。"))return;
 if(typeof flushAll==="function")await flushAll();
 const r=await rpc("practice_end",{id:st.thread});
 let tutor=Object.keys(Chat).find(x=>Dock.panels[x]?.agent==="tutor");
 if(!tutor)tutor=openPanel({type:"chat",agent:"tutor"});else activate(tutor);
 await loadChat(pid);setTimeout(()=>Object.keys(Chat).filter(x=>Chat[x].thread===r.tutor_thread||Dock.panels[x]?.agent==="tutor").forEach(x=>loadChat(x)),300);
 toast("已交给主会话复盘");
}
async function messageToCard(pid,mid){
 const st=Chat[pid],m=st.data.messages.find(x=>String(x.id)===String(mid));if(!m)return;
 const body=m.content.replace(BLOCK_RE,"").trim();
 const guess=(body.match(/^#+\s*(.+)$/m)||body.match(/\*\*(.+?)\*\*/)||[])[1]||"";
 const title=prompt("这张知识卡的标题：",guess.replace(/[#*]/g,"").trim().slice(0,60));if(!title)return;
 const r=await rpc("doc_create",{kind:"card",title,topic:st.data.head?.topic||null,body});
 await refreshState();openFile(r.path);
}
function escalate(pid,mid){
 const m=Chat[pid].data.messages.find(x=>String(x.id)===String(mid));if(!m)return;
 let tutor=Object.keys(Chat).find(x=>Dock.panels[x]?.agent==="tutor"&&!Dock.panels[x].thread);
 if(!tutor)tutor=openPanel({type:"chat",agent:"tutor"});else activate(tutor);
 const send=()=>Chat[tutor]?.thread?chatSend(tutor,"我刚才和快答讨论了下面的内容。请检查它是否准确，再帮我深入理解，并接回主线：\n\n"+m.content):setTimeout(send,200);
 send();
}
