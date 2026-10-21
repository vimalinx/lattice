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
  Chat[pid]={input:"",stream:"",live:[],waiting:"",error:"",data:null,cache:{}};
  node.innerHTML='<div class="chat"><div class="chat-head"></div><div class="chat-scroll"><div class="loading">正在打开对话…</div></div><div class="composer"></div></div>';
  loadChat(pid);
 },
 unmount(p,node){delete Chat[node.dataset.pid];},
 shown(p,node){const st=Chat[node.dataset.pid],box=node.querySelector(".chat-scroll");if(st&&box&&st.bottom!==false)box.scrollTop=box.scrollHeight;},
 screen(p,node){
  const st=Chat[node.dataset.pid];if(!st?.data)return {agent:p.agent};
  const answers=answersOf(st.data.messages),open=[];
  st.data.messages.forEach(m=>{if(m.role!=="assistant")return;let i=0;String(m.content).replace(BLOCK_RE,(x,type)=>{if(type==="quiz"&&!answers[m.id+":"+i])open.push(m.id+":"+i);i++;return x;});});
  return {agent:p.agent,thread:st.thread,title:panelTitle(node.dataset.pid),messages:st.data.messages.length,unanswered_quizzes:open.slice(-5),busy:st.data.busy,draft:st.input?shorten(st.input,200):""};
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
 if(!scroll.__watched){scroll.__watched=true;scroll.addEventListener("scroll",()=>{if(scroll.isConnected&&scroll.clientHeight)st.bottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<140;});}
 node.querySelector(".chat-head").innerHTML=chatHead(pid);
 const answers=answersOf(st.data.messages);
 scroll.innerHTML="";
 const msgs=st.data.messages;
 if(!msgs.length&&!st.data.busy)scroll.appendChild(h('<div class="chat-welcome">'+chatWelcome(p.agent,st.data)+'</div>'));
 msgs.forEach(m=>scroll.appendChild(messageEl(pid,m,answers)));
 scroll.appendChild(h('<div class="live-slot"></div>'));
 renderLive(pid);
 if(!node.querySelector(".composer textarea"))node.querySelector(".composer").innerHTML=composerHtml(pid);
 updateComposer(pid);
 if(stick)scroll.scrollTop=scroll.scrollHeight;
}
function chatWelcome(agent,data){
 if(agent==="coach")return '<h3>练习开始了</h3><p>教练会一步步带你写。</p>';
 if(agent==="flash")return '<h3>小问题，不必打断大思路。</h3><p>选中任何地方的文字或代码再提问，快答会结合你正在看的内容来解释。</p>';
 return '<h3>想到什么，直接说。</h3><p>主会话会跟着你的话题走。它能看到你的知识图、学习轨迹和你此刻打开的东西；值得长期深入的内容，它会整理成主题，并定一条主干路线。</p>';
}
function chatHead(pid){
 const p=Dock.panels[pid],st=Chat[pid],d=st.data,cfg=S.config?.agents?.[p.agent]||{};
 const busy=d.busy,state=busy?(st.waiting||({thinking:"思考中",responding:"回答中",connecting:"连接中"})[d.status]||"正在想"):cfg.ready?"就绪":"未接入";
 let tools="";
 if(p.agent==="coach"&&d.practice){
  const pr=d.practice;
  tools=button(svg("file",13)+" 练习文件","open-file",'data-path="'+esc(pr.file||"")+'"',"ghost sm")+
   (pr.state==="active"?button("看看我的代码","chat-task",'data-pid="'+pid+'" data-task="check"',"ghost sm")+button("给点提示","chat-task",'data-pid="'+pid+'" data-task="hint"',"ghost sm")+
    button(svg("check",13)+" 结束并复盘","practice-end",'data-pid="'+pid+'"',"primary sm"):'<span class="chip">'+(pr.state==="reviewing"?"主会话复盘中":"已复盘")+'</span>');
 }else if(p.agent==="tutor"){
  tools=button(svg("book",13)+" 提炼知识卡","chat-task",'data-pid="'+pid+'" data-task="capture"',"ghost sm")+iconButton("plus","chat-new","开新会话",'data-pid="'+pid+'"');
 }else if(p.agent==="flash")tools=iconButton("plus","chat-new","开新会话",'data-pid="'+pid+'"');
 const topic=d.head?.topic;
 return '<div class="chat-who"><b>'+esc(agentTitle(p.agent))+'</b><small>'+esc(cfg.label||"")+' · <span class="'+(busy?"working":"")+'">'+esc(state)+'</span></small></div>'+
  (p.agent!=="coach"?(topic?'<a class="topic-chip" data-action="open-doc" data-id="'+esc(topic)+'" title="打开主题">'+svg("map",12)+' '+esc(topicTitle(topic))+'</a>':'<span class="topic-chip quiet">默认对话</span>'):"")+
  '<div class="chat-tools">'+tools+'</div>';
}
function messageEl(pid,m,answers){
 const st=Chat[pid],p=Dock.panels[pid],meta=m.meta||{};
 const key=m.id+"|"+m.content.length+"|"+(st.data.undone||[]).length+"|"+JSON.stringify(st.data.decisions||{}).length+"|"+Object.keys(answers).length;
 let cached=st.cache[m.id];
 if(!cached||cached.key!==key){
  const mine=m.role==="user";
  const r=mine?{html:markdown(m.content),blocks:[]}:replyHtml(m.content);
  const incomplete=!mine&&meta.stop_reason&&meta.stop_reason!=="end_turn";
  const html='<div class="msg '+(mine?"from-me":"from-ai")+'" data-mid="'+m.id+'"><div class="msg-meta"><span>'+(mine?"我":esc(agentTitle(meta.agent||p.agent)))+'</span><time>'+esc(fmtDate(m.at,true))+'</time></div>'+
   (mine&&meta.selection?'<div class="msg-quote">'+esc(shorten(meta.selection,180))+'</div>':"")+
   '<div class="markdown msg-body">'+r.html+'</div>'+
   (incomplete?'<div class="msg-note">'+esc(meta.stop_reason==="cancelled"?"已停止 · 保留了部分回答":meta.stop_reason==="max_tokens"?"达到回复长度上限":"没有正常结束 · 只保留了收到的部分")+'</div>':"")+
   actionChips(meta.actions||[],st.data.undone||[])+sourcesHtml(meta.sources)+suggestionsHtml(pid,m)+
   (!mine&&m.content.trim()?messageTools(pid,m):"")+'</div>';
  cached=st.cache[m.id]={key,html,blocks:r.blocks};
 }
 const node=h(cached.html);
 if(cached.blocks.length)mountBlocks(node,cached.blocks,{thread:st.thread,message:m.id,answers,pid});
 return node;
}
function messageTools(pid,m){
 const agent=Dock.panels[pid].agent,out=[];
 if(agent==="tutor")out.push(button(svg("code",12)+" 开始练习","practice-start",'data-pid="'+pid+'" data-mid="'+m.id+'" title="让练习教练带着你一步步把这段内容写出来"',"ghost sm"));
 if(agent==="tutor"||agent==="flash")out.push(button(svg("card",12)+" 存成卡片","message-card",'data-pid="'+pid+'" data-mid="'+m.id+'"',"ghost sm"));
 if(agent==="flash")out.push(button("交给主会话深入讲","message-escalate",'data-pid="'+pid+'" data-mid="'+m.id+'"',"ghost sm"));
 return '<div class="msg-tools">'+out.join("")+'</div>';
}
function actionChips(actions,undone=[],live=false){
 if(!actions?.length)return "";
 return '<div class="actions">'+actions.map(a=>{
  const gone=undone.includes(a.id)||(S.data?.undone||[]).includes(a.id);
  return '<div class="action'+(gone?" undone":"")+'">'+svg(live?"spark":"check",12)+'<span>'+esc(a.summary)+'</span>'+
   (a.ref&&!gone?(a.ref.startsWith("handoff:")?button("请主会话接住","handoff",'data-topic="'+esc(a.ref.slice(8))+'"',"ghost xs"):
    a.ref.startsWith("ui:")?(live?"":button(svg("undo",11)+" 还原界面","ui-restore",'data-snapshot="'+esc(a.ref.slice(3))+'"',"ghost xs")):button("查看","open-ref",'data-ref="'+esc(a.ref)+'"',"ghost xs")):"")+
   (a.undoable&&!gone&&!live?button(svg("undo",11)+" 撤销","undo",'data-id="'+esc(a.id)+'"',"ghost xs"):gone?'<small>已撤销</small>':"")+'</div>';
 }).join("")+'</div>';
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
 slot.innerHTML=(st.stream||st.live.length?'<div class="msg from-ai streaming"><div class="msg-meta"><span>'+esc(agentTitle(Dock.panels[pid].agent))+'</span><span>正在回答</span></div><div class="markdown msg-body">'+r.html+'</div>'+actionChips(st.live,[],true)+'</div>':"")+
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
function composerHtml(pid){
 const p=Dock.panels[pid];
 return '<textarea rows="2" data-composer="'+pid+'" placeholder="'+esc((AGENT_HINT[p.agent]||"")+" · "+sendHint())+'"></textarea><div class="composer-bar"><span class="composer-note"></span><span class="composer-btn"></span></div>';
}
function updateComposer(pid){
 const node=Dock.els[pid],st=Chat[pid],p=Dock.panels[pid];if(!node||!st?.data)return;
 const area=node.querySelector(".composer textarea"),bar=node.querySelector(".composer-btn"),note=node.querySelector(".composer-note");
 const ended=p.agent==="coach"&&st.data.practice&&st.data.practice.state!=="active",ready=!!S.config?.agents?.[p.agent]?.ready;
 area.disabled=ended;
 if(ended)area.placeholder="这次练习已经结束";
 note.innerHTML=!ready?'还没接入模型：'+button("去设置","open-settings","","ghost xs"):Sel.text?'<span class="sel-chip">'+svg("quote",11)+' 带上选中的 '+Sel.text.length+' 字 <button data-action="sel-clear">×</button></span>':esc(p.agent==="coach"?"教练能看到你的练习文件和运行结果":"AI 做的改动都能在对话里撤销");
 bar.innerHTML=st.data.busy?button(svg("stop",13)+" 停止","chat-cancel",'data-pid="'+pid+'"',"ghost sm"):button(svg("arrowup",14)+" 发送","chat-send",'data-pid="'+pid+'"'+(ready&&!ended?"":" disabled"),"primary sm");
}
async function chatSend(pid,text,extra={}){
 const st=Chat[pid],p=Dock.panels[pid];if(!st)return;
 const node=Dock.els[pid],area=node?.querySelector(".composer textarea");
 const message=(text??area?.value??"").trim();
 if(!message&&!extra.task)return;
 if(st.data?.busy)return toast("这段对话正在回答；可以先停止");
 if(typeof flushAll==="function")await flushAll();
 const selection=extra.selection??Sel.text;
 if(text==null&&area)area.value="";st.input="";
 st.error="";st.stream="";st.live=[];st.waiting="";
 try{
  const r=await rpc("send",{agent:p.agent,message,thread:st.thread,selection,task:extra.task||"",note:screenNote(),answer:extra.answer||null});
  st.thread=r.thread;Sel.text="";
  st.data.messages.push({id:"pending",role:"user",content:message||({check:"我写好了，帮我看看我的代码和运行结果。",hint:"我卡住了，给我一点提示，先别直接给答案。",capture:"把我们讨论过的内容整理成知识卡。"})[extra.task]||"",meta:{selection,answer:extra.answer},at:new Date().toISOString()});
  st.data.busy=true;renderChat(pid,false);
 }catch(e){if(text==null&&area)area.value=message;st.error=e.message;renderLive(pid);throw e;}
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
