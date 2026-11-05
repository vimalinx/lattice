import {$t,$p,LOCALE} from "./i18n.js";
import {Dock,panelHand,panelType} from "./state.js";
import {S,WINDOW,all,ask,askText,button,cardTypeName,esc,fmtDate,h,hydrateVault,iconButton,markdown,rpc,safe,shorten,svg,toast} from "./core.js";
import {activate,onePanel,openPanel,panelTitle,refreshTab,runHand,saveLayout,stackOf,viewOf,zoomOf,followingPanel} from "./dock.js";
import {setTopicOf,topicOf} from "./spaces.js";
import {BLOCK_RE,mountBlocks,replyHtml} from "./blocks.js";
import {adaptImported,importedDivider} from "./imports.js";
import {composerTiles,fillTextTiles,messageTiles} from "./attach.js";
import {fileIcon,flushAll,openFile,organizeFinished} from "./files.js";
import {hostOf} from "./reader.js";
import {marksRefresh} from "./marks.js";
import {mountInlineChanges} from "./skillchange.js";
import {Side,sideChanged} from "./side.js";
import {settingsTestResult} from "./panels.js";
import {Dwell,Menus,Sel,popMenu,readChars,refreshState,screenNote,screenTimer,sendScreen} from "./app.js";
/* AI panels: one conversation with one agent. Everything an agent shows lives in its own panel;
   the learner reads, answers its questions, and takes what they want to their side. */
export const Chat={};
const AGENT_ICON={tutor:"bot",flash:"spark",coach:"code",organizer:"edit",builder:"apps"};
const AGENT_HINT={tutor:$t("想到什么，直接说"),flash:$t("这个词什么意思？这行为什么这样写？"),coach:$t("说说你的想法、预测，或者哪里卡住了")};
function sendHint(){return S.ui.send_key==="ctrl"?$t("Ctrl + Enter 发送"):$t("Enter 发送，Shift + Enter 换行");}
export function agentTitle(agent){return S.data?.agents?.[agent]||agent;}
export function topicTitle(id){return id?(S.data?.topics||[]).find(t=>t.id===id)?.title||$t("已删除的主题"):"";}
panelType("chat",{side:"ai",icon:p=>AGENT_ICON[p.agent]||"bot",
 title(p,node){
  const st=Chat[node?.dataset.pid],head=st?.data?.head;
  if(p.agent==="coach"||head?.trial)return head?.title||$t("练习");
  // The quick answer belongs to no topic.
  const topic=p.agent==="flash"?null:head?.topic;return agentTitle(p.agent)+(topic?" · "+topicTitle(topic):"");
 },
 mount(p,node,pid){
  Chat[pid]={input:"",error:"",data:null,attach:[],quote:"",opened:new Set(),thoughts:{},runs:{}};
  node.innerHTML="<div class=\"chat-frame\"><div class=\"chat\"><div class=\"chat-head\"></div><div class=\"chat-scroll\"><div class=\"loading\">"+$t("正在打开对话…")+"</div></div><div class=\"composer\"></div><div class=\"chat-starters\"></div></div></div>";
  loadChat(pid);
 },
 unmount(p,node){delete Chat[node.dataset.pid];},
 shown(p,node){const pid=node.dataset.pid,st=Chat[pid],box=node.querySelector(".chat-scroll");if(st&&box&&st.bottom!==false)box.scrollTop=box.scrollHeight;fitComposer(pid);},
 screen(p,node){
  const st=Chat[node.dataset.pid];if(!st?.data)return {agent:p.agent};
  const answers=answersOf(st.data),open=[];
  st.data.messages.forEach(m=>{if(m.role!=="assistant")return;let i=0;String(m.content).replace(BLOCK_RE,(x,type)=>{if(type==="quiz"&&!answers[m.id+":"+i])open.push(m.id+":"+i);i++;return x;});});
  return {agent:p.agent,thread:st.thread,title:panelTitle(node.dataset.pid),messages:st.data.messages.length,unanswered_quizzes:open.slice(-5),busy:st.data.busy,draft:st.input?shorten(st.input,200):"",
   ...(st.attach.length?{attached:st.attach.map(a=>a.path)}:{}),...(p.model?{model:p.model.model}:{})};
 }});
export async function loadChat(pid,keepScroll=true){
 const p=Dock.panels[pid],st=Chat[pid];if(!p||!st)return;
 // Without a thread of its own, a panel shows the conversation the topic being learned opens (the one last picked).
 const data=await safe(()=>rpc("chat",p.thread?{agent:p.agent,thread:p.thread}:{agent:p.agent,topic:(p.space?topicOf(p.space):S.data.active_topic)||"",...(p.space?{space:p.space}:{})}));
 if(!data||!Chat[pid])return;
 // Going to the end is for a conversation that changed; one reloaded where it was (another opened elsewhere) stays put.
 const moved=st.thread!==data.thread;
 if(st.thread&&moved){st.runs={};st.error="";st.anchored=false;st.bottom=undefined;}
 st.thread=data.thread;st.data=data;
 renderChat(pid,keepScroll||!moved);refreshTab(pid);
}
/* ---- a topic's conversations, listed under their topics in the sidebar. Opening one makes its topic the one being
   learned and it the conversation that topic opens, in every panel following along. The quick answer is one
   conversation of its own, about whatever is on screen. Rename (double-click), archive or delete in place. ------------------------------------------------------- */
export const SESSION_AGENTS=new Set(["tutor","flash"]);
export function sessionMeta(x){return (x.busy?'<i class="ss-busy"></i>':"")+x.messages+" "+$t("条");}
export function sessionTip(x){return fmtDate(x.updated,true)+" · "+(x.summary?shorten(x.summary,160):x.last?$t("最近问：")+x.last:$t("还没有消息"));}
// Every list of conversations, after one was opened, started, renamed, archived or deleted.
function sessionsChanged(){sideChanged([]);}
export async function openSession(id,space=Dock.space){
 const r=await rpc("session_open",{id,space});setTopicOf(space,r.topic);
 await refreshState();followingChanged(space,false);sessionsChanged();
}
// The tutor's panel that follows along, brought forward (or opened) when a conversation is picked in the sidebar.
export function showTutor(hand=null){return toConversation("tutor",hand);}
/* An AI's conversation that follows along in this state, shown (or opened) and handed something to do (hand: dock.js);
   open in another window, it is done there. */
export function toConversation(agent,hand=null){
 const pid=followingPanel(agent);
 if(!pid)return openPanel({type:"chat",agent},hand?{hand}:{});
 activate(pid);if(hand)runHand(pid,hand);return pid;
}
// A conversation just opened can be handed something once it has loaded.
export async function chatReady(pid){
 for(let i=0;i<60&&Dock.panels[pid]&&!Chat[pid]?.data;i++)await new Promise(r=>setTimeout(r,100));
 if(Chat[pid]?.data)return true;
 if(Dock.panels[pid])toast($t("对话还没打开，等一下再试"),"error");
 return false;
}
function focusComposer(pid){Dock.els[pid]?.querySelector("[data-composer]")?.focus();}
panelHand("send",async(pid,h)=>{if(await chatReady(pid))await chatSend(pid,h.text,h.extra||{});});
panelHand("quote",async(pid,h)=>{if(!await chatReady(pid))return;Chat[pid].quote=h.text;Chat[pid].quoteAt=h.anchor||null;updateComposer(pid);focusComposer(pid);});
panelHand("focus",async pid=>{if(await chatReady(pid))focusComposer(pid);});
panelHand("load",(pid,h,fresh)=>fresh?null:loadChat(pid));
/* Which conversation a state follows changed (its topic, set here already; the session a topic opens): every window loads
   again the ones it shows, a state's conversation in another window included, and the window holding the state keeps
   the topic. */
export function followingChanged(space=null,keep=true){
 followingPanels().forEach(x=>loadChat(x,keep));
 safe(()=>rpc("following",{window:WINDOW,...(space?{space,topic:topicOf(space)}:{}),changed:true,keep}));
}
export function followingHeard(evt){
 if(evt.from===WINDOW)return;
 const moved=!!evt.space&&!!Dock.spaces[evt.space]&&topicOf(evt.space)!==(evt.topic||null);
 if(moved)setTopicOf(evt.space,evt.topic);
 if(evt.changed)followingPanels().forEach(x=>loadChat(x,evt.keep));
 else if(moved)followingPanels().filter(x=>Dock.panels[x].space===evt.space).forEach(x=>loadChat(x,false));
}
// A window showing a conversation of a state this window holds is told the topic that state is on.
export function tellFollowing(panels){
 if(onePanel())return;
 const spaces=new Set((panels||[]).filter(p=>p.type==="chat"&&!p.thread&&p.space&&Dock.spaces[p.space]&&!Dock.out[p.space]).map(p=>p.space));
 spaces.forEach(space=>safe(()=>rpc("following",{window:WINDOW,space,topic:topicOf(space)})));
}
// Renaming in place: Enter keeps it, Esc leaves it as it was, an empty name goes back to the first question.
function renameSession(id){
 const span=document.querySelector('[data-session-title="'+CSS.escape(id)+'"]');if(!span)return;
 const input=h('<input class="ss-rename" value="'+esc(span.textContent)+'"/>');span.replaceWith(input);input.focus();input.select();
 let done=false;const finish=async keep=>{if(done)return;done=true;if(keep)await safe(()=>rpc("session_update",{id,title:input.value}));sessionsChanged();};
 input.addEventListener("keydown",e=>{e.stopPropagation();if(e.key==="Enter")finish(true);else if(e.key==="Escape")finish(false);});
 input.addEventListener("click",e=>e.stopPropagation());input.addEventListener("blur",()=>finish(true));
}
document.addEventListener("dblclick",e=>{const t=e.target.closest?.("[data-session-title]");if(!t)return;e.preventDefault();renameSession(t.dataset.sessionTitle);});
export async function sessionAction(kind,a){
 const pid=a.dataset.pid,p=Dock.panels[pid];
 if(kind==="session-new"){
  const agent=a.dataset.agent||p?.agent||"tutor",topic=a.dataset.topic??(Chat[pid]?.data?.head?.topic||S.data.active_topic||"");
  const r=await rpc("thread_new",{agent,topic,...(p?.space?{space:p.space}:{})});await openSession(r.thread,p?.space);
  if(!p&&agent==="tutor")return showTutor({do:"focus"});
  if(!p)showTutor();
  return setTimeout(()=>{const t=pid||followingPanel(agent);Dock.els[t]?.querySelector("[data-composer]")?.focus();},60);
 }
 if(kind==="session-open"){await openSession(a.dataset.id);return a.closest("#side")?showTutor():undefined;}
 const id=a.dataset.id,archived=a.dataset.archived==="1";
 if(kind==="session-more")return popMenu(a,"<button data-action=\"session-rename\" data-id=\""+esc(id)+"\">"+svg("edit",14)+"<span>"+$t("改名")+"</span></button><button data-action=\"session-archive\" data-id=\""+esc(id)+"\" data-archived=\""+(archived?1:0)+"\">"+svg("history",14)+"<span>"+(archived?$t("取消归档"):$t("归档"))+"</span></button><hr/><button class=\"danger\" data-action=\"session-delete\" data-id=\""+esc(id)+"\">"+svg("trash",14)+"<span>"+$t("删除")+"</span></button>");
 if(kind==="session-rename")return renameSession(id);
 if(kind==="session-archive"){await rpc("session_update",{id,archived:!archived});followingChanged(null,false);return sessionsChanged();}
 if(kind==="session-delete"){
  if(!await ask($t("对话会从会话列表和学习库里删掉，学习库的历史里还能找回。"),{title:$t("删除这段会话？"),danger:true,ok:$t("删除")}))return;
  await rpc("session_delete",{id});followingChanged(null,false);return sessionsChanged();
 }
}
function chatPanels(thread){return Object.keys(Chat).filter(pid=>Chat[pid].thread===thread);}
export function followingPanels(){return Object.keys(Chat).filter(pid=>Dock.panels[pid]&&!Dock.panels[pid].thread);}
/* Answers to this conversation's questions: given here, or (for the tutor's) checked over in the quick-answer side. */
function answersOf(data){
 const out={};
 for(const [k,v] of Object.entries(data?.answers||{}))out[k]=String(v).replace(/^我的回答：/,"");
 (data?.messages||[]).forEach(m=>{const a=m.meta?.answer;if(a&&!a.thread)out[a.message+":"+a.block]=m.content.replace(/^我的回答：/,"");});
 return out;
}
export function renderChat(pid,keepScroll=true){
 const node=Dock.els[pid],st=Chat[pid],p=Dock.panels[pid];if(!node||!st?.data)return;
 const scroll=node.querySelector(".chat-scroll"),stick=!keepScroll||st.bottom!==false,was=scroll.scrollTop;
 if(!scroll.__watched){
  scroll.__watched=true;
  // Only the learner's own scrolling (wheel, touch, keys, the scrollbar) decides whether the view follows the reply:
  // scrolling up always stops it, even within the room kept below a fresh question; scrolling down to the end starts it.
  // Scrolling done by the program changes nothing.
  const mine=()=>{st.userAt=Date.now();};
  for(const ev of ["wheel","touchmove","keydown"])scroll.addEventListener(ev,mine,{passive:true});
  scroll.addEventListener("mousedown",e=>{if(e.target===scroll){st.dragBar=true;addEventListener("mouseup",()=>{st.dragBar=false;},{once:true});}});
  scroll.addEventListener("scroll",()=>{
   if(!scroll.isConnected||!scroll.clientHeight)return;
   const top=scroll.scrollTop,up=top<(st.lastTop??top)-1;st.lastTop=top;
   if(st.dragBar||Date.now()-(st.userAt||0)<700)st.bottom=!up&&toEnd(scroll)<60;
   toBottomButton(pid);
  });
  // Which folded parts are open survives re-rendering.
  scroll.addEventListener("toggle",e=>{
   const box=e.target,mid=box.closest?.("[data-mid]")?.dataset.mid;
   if(box.matches("details.actions")&&mid)box.open?st.opened.add(mid):st.opened.delete(mid);
   if(box.matches("details.steps-box")&&mid)box.open?st.opened.add("steps:"+mid):st.opened.delete("steps:"+mid);
   if(box.matches("details.thinking-box")){if(box.classList.contains("live")){const L=st.runs[box.closest(".live-slot")?.dataset.run];if(L&&L.liveOpen!==box.open){L.liveOpen=box.open;patchLive(pid);}}else if(mid)st.thoughts[mid]=box.open;}
  },true);
 }
 node.querySelector(".chat-head").innerHTML=chatHead(pid);
 const answers=answersOf(st.data);
 // Messages already drawn stay as they are, with whatever was opened, revealed, run or dragged in them; only new or
 // changed ones are drawn, so a long conversation does not redraw all its formulas each time a reply comes.
 if(scroll.__thread!==st.thread){scroll.innerHTML="";scroll.__thread=st.thread;}
 const drawn=new Map();for(const n of scroll.querySelectorAll(":scope>.msg[data-mid]"))drawn.set(n.dataset.mid,n);
 const msgs=st.data.messages,empty=!msgs.length&&!st.data.busy;
 node.querySelector(".chat").classList.toggle("blank",empty);
 const want=empty?[h('<div class="chat-welcome">'+chatWelcome(p.agent)+'</div>')]:[];
 const divider=importedDivider(st),placed=new Set();
 const slotFor=run=>scroll.querySelector(':scope>.live-slot[data-run="'+CSS.escape(run)+'"]')||h('<div class="live-slot" data-run="'+esc(run)+'"></div>');
 msgs.forEach(m=>{
  const key=messageKey(pid,m,answers),old=drawn.get(String(m.id));
  want.push(old?.__key===key?old:messageEl(pid,m,answers,key));
  if(divider&&m.id===divider.after)want.push(h(divider.html));
  // A reply under way sits under the question it answers.
  if(m.role==="user")for(const [run,L] of Object.entries(st.runs))if(String(L.question)===String(m.id)){want.push(slotFor(run));placed.add(run);}
 });
 for(const run of Object.keys(st.runs))if(!placed.has(run))want.push(slotFor(run));
 want.push(slotFor(""),scroll.querySelector(":scope>.chat-spacer")||h('<div class="chat-spacer"></div>'));
 let at=scroll.firstChild;
 for(const n of want){if(n===at)at=at.nextSibling;else scroll.insertBefore(n,at);}
 while(at){const next=at.nextSibling;at.remove();at=next;}
 renderLive(pid);
 node.querySelector(".chat-starters").innerHTML=empty?chatStarters(pid):"";
 if(!node.querySelector(".composer textarea"))node.querySelector(".composer").innerHTML=composerHtml(pid);
 updateComposer(pid);
 fitSpacer(pid);
 scroll.scrollTop=stick?scroll.scrollHeight:was;
 // Code, formulas and diagrams finish drawing a moment later: while following, the view keeps to the end.
 st.sizes?.disconnect();
 st.sizes=new ResizeObserver(()=>{if(st.bottom!==false&&scroll.isConnected&&scroll.clientHeight)scroll.scrollTop=scroll.scrollHeight;toBottomButton(pid);});
 all(".msg,.live-slot",scroll).forEach(n=>st.sizes.observe(n));
 toBottomButton(pid);
 marksRefresh(pid);
}
/* How far the end of the conversation (not the room kept below the last question) is under the visible part. */
function toEnd(scroll){return scroll.scrollHeight-(scroll.querySelector(".chat-spacer")?.offsetHeight||0)-scroll.scrollTop-scroll.clientHeight;}
export function toBottomButton(pid){
 const node=Dock.els[pid],b=node?.querySelector(".to-bottom"),scroll=node?.querySelector(".chat-scroll");if(!b||!scroll)return;
 b.hidden=Chat[pid]?.bottom!==false||node.querySelector(".chat")?.classList.contains("blank")||toEnd(scroll)<60;
}
/* After a question is sent it moves up to about a fifth of the way down (a long one shows its end), and the reply
   grows under it without moving the view: room kept below the question holds it there and shrinks as the reply
   fills the window. */
function questionTop(height,size){return size>height*.4?Math.max(8,height*.6-size):height*.2;}
function lastQuestion(scroll){return [...scroll.querySelectorAll(".msg.from-me")].at(-1)||null;}
// Screen positions are scaled by the window's own zoom, scroll positions are not.
function offsetIn(scroll,node){const k=scroll.getBoundingClientRect().height/(scroll.offsetHeight||1)||1;return (node.getBoundingClientRect().top-scroll.getBoundingClientRect().top)/k+scroll.scrollTop;}
function fitSpacer(pid){
 const st=Chat[pid],scroll=Dock.els[pid]?.querySelector(".chat-scroll"),gap=scroll?.querySelector(".chat-spacer");if(!gap)return;
 const q=st.anchored&&lastQuestion(scroll);
 if(!q){gap.style.height="0px";return;}
 const H=scroll.clientHeight,content=scroll.scrollHeight-gap.offsetHeight;
 gap.style.height=Math.max(0,Math.round(offsetIn(scroll,q)-questionTop(H,q.offsetHeight)+H-content))+"px";
}
function anchorQuestion(pid){
 const st=Chat[pid],scroll=Dock.els[pid]?.querySelector(".chat-scroll");if(!st||!scroll)return;
 st.anchored=true;st.bottom=false;fitSpacer(pid);
 const q=lastQuestion(scroll);
 if(q)scroll.scrollTo({top:Math.max(0,offsetIn(scroll,q)-questionTop(scroll.clientHeight,q.offsetHeight)),behavior:"smooth"});
 toBottomButton(pid);
}
function chatWelcome(agent){
 if(agent==="coach")return "<h3>"+$t("练习开始了")+"</h3><p>"+$t("教练会一步步带你写。")+"</p>";
 if(agent==="flash")return "<h3>"+$t("小问题，不必打断大思路。")+"</h3><p>"+$t("界面上开着的标签它都能去读，不用另外说明在看什么；选中文字再问，就针对那一段解释。")+"</p>";
 return "<h3>"+$t("想到什么，直接说。")+"</h3><p>"+$t("值得长期深入的内容，主会话会整理成主题，并定一条主干路线。")+"</p>";
}
/* Where to start, from what is actually in the vault and on screen. */
function chatStarters(pid){
 const p=Dock.panels[pid],d=S.data||{};if(p.agent!=="tutor")return "";
 const out=[],topics=d.topics||[];
 const current=topics.find(t=>t.id===d.active_topic);
 (current?[current]:topics.filter(t=>t.state==="active").slice(0,2)).forEach(t=>out.push({icon:"map",text:$t("接着学「{0}」",t.title),say:$t("我们接着学「{0}」吧。上次讲到哪了，下一步学什么？",t.title)}));
 if(d.due)out.push({icon:"refresh",text:$t("回顾 {0} 张到期的卡",d.due),say:$t("我有 {0} 张知识卡到期了，带我回顾一下。",d.due)});
 const practice=(d.practices||[]).find(x=>x.state==="active");
 if(practice)out.push({icon:"code",text:$t("回到练习「{0}」",practice.title),action:'data-action="open-practice" data-id="'+esc(practice.id)+'"'});
 const recent=(Dwell.recent||[])[0];
 if(recent)out.push({icon:fileIcon(recent.path),text:$t("聊聊我刚才看的")+" "+recent.path.split("/").pop(),say:$t("看看我刚才在看的 {0}，帮我理一理要点，指出值得深入的地方。",recent.path)});
 return out.slice(0,4).map(x=>'<button class="starter" '+(x.action||'data-action="chat-starter" data-pid="'+pid+'" data-say="'+esc(x.say)+'"')+'>'+svg(x.icon,15)+'<span>'+esc(x.text)+'</span></button>').join("");
}
function chatHead(pid){
 const p=Dock.panels[pid],st=Chat[pid],d=st.data;
 if(p.agent==="coach"){
  const pr=d.practice;if(!pr)return "";
  return '<span class="head-title">'+esc(pr.title||$t("练习"))+'</span><div class="chat-tools">'+button(svg("file",13)+" "+$t("练习文件"),"open-file",'data-path="'+esc(pr.file||"")+'"',"ghost sm")+
   (pr.state==="active"?button($t("看看我的代码"),"chat-task",'data-pid="'+pid+'" data-task="check"',"ghost sm")+button($t("给点提示"),"chat-task",'data-pid="'+pid+'" data-task="hint"',"ghost sm")+
    button(svg("check",13)+" "+$t("结束并复盘"),"practice-end",'data-pid="'+pid+'"',"primary sm"):'<span class="chip">'+(pr.state==="reviewing"?$t("主会话复盘中"):$t("已复盘"))+'</span>')+'</div>';
 }
 const topic=d.head?.topic;
 const tools=iconButton("edit","chat-new",p.agent==="flash"?$t("清空快答，重新开始（主会话不变）"):$t("开新会话"),'data-pid="'+pid+'"')+
  iconButton("dots","chat-more",$t("显示和更多"),'data-pid="'+pid+'"');
 // The quick answer is about whatever is on screen, not one topic.
 if(p.agent==="flash")return "<span class=\"head-title quiet\">"+svg("spark",12)+" "+$t("能读界面上所有标签")+"</span><div class=\"chat-tools\">"+tools+"</div>";
 return "<button class=\"topic-chip"+(topic?"":" quiet")+"\" data-action=\"chat-topic-menu\" data-pid=\""+pid+"\" title=\""+$t("这段对话属于哪个主题")+"\">"+svg(topic?"map":"bot",12)+"<span>"+esc(topic?topicTitle(topic):$t("默认对话"))+"</span>"+svg("chevrondown",11)+"</button><div class=\"chat-tools\">"+tools+"</div>";
}
export function topicMenu(pid,anchor){
 const st=Chat[pid],topic=st?.data?.head?.topic,topics=(S.data.topics||[]).filter(t=>t.state==="active"&&t.id!==topic);
 popMenu(anchor,(topic?"<button data-action=\"open-doc\" data-id=\""+esc(topic)+"\">"+svg("map",14)+"<span>"+$t("打开主题页")+"</span></button><hr/>":"")+"<div class=\"menu-label\">"+$t("在哪里接着聊")+"</div>"+(topic?"<button data-action=\"topic-focus\" data-id=\"\">"+svg("bot",14)+"<span>"+$t("默认对话")+"</span></button>":"")+topics.slice(0,14).map(t=>'<button data-action="topic-focus" data-id="'+esc(t.id)+'">'+svg("map",14)+'<span>'+esc(t.title)+'</span></button>').join("")+(!topic&&!topics.length?"<p class=\"menu-empty\">"+$t("还没有主题。聊着聊着，主会话会把值得深入的内容建成主题。")+"</p>":""));
}
/* What a message's drawing depends on: itself, where it stands, and the state of what it holds (its steps undone, its
   suggestions decided, its questions answered, cards noted from it), so a change elsewhere leaves it as it is. */
function messageKey(pid,m,answers){
 const st=Chat[pid],meta=m.meta||{},list=st.data.messages,at=list.indexOf(m),next=list[at+1];
 const undone=new Set([...(st.data.undone||[]),...(S.data?.undone||[])]);
 const mine=Object.keys(answers).filter(k=>k.startsWith(m.id+":")).map(k=>k+"="+answers[k].length);
 return [m.id,m.content.length,JSON.stringify(meta).length,!!next,next?.meta?.retry,!next&&st.data.busy,S.ui.thinking,
  (meta.actions||[]).filter(a=>undone.has(a.id)).map(a=>a.id),(meta.suggestions||[]).map(x=>st.data.decisions?.[m.id+":"+x.id]||""),mine,
  (st.data.cards?.[m.id]||[]).map(c=>c.id)].join("|");
}
// Questions an old bug lost, put back from what the AI wrote down at the time.
const RESTORED={words:$t("当时没存下来，这是从 AI 的思考记录里找回的原话，可能不完整"),gist:$t("当时没存下来，这是根据 AI 的思考记录写的转述，不是原话")};
/* What a reply calls a file becomes a link to it, once the program has checked there is such a file. */
const FILE_WORD=/(?:~\/|\.{0,2}\/)?[\w\u4e00-\u9fff+-][\w\u4e00-\u9fff.+-]*(?:\/[\w\u4e00-\u9fff.+-]+)*\.[A-Za-z][A-Za-z0-9]{0,7}(?![\w\u4e00-\u9fff])/g;
const FileLinks={spots:[],timer:null};
function fileLink(path,inner){const a=document.createElement("a");a.className="file-ref";a.dataset.action="open-file";a.dataset.path=path;a.title=$t("打开")+" "+path;a.append(inner);return a;}
function linkFiles(root){
 for(const body of all(".msg-body",root)){
  for(const code of all("code",body))if(!code.closest("pre,a,.lblock"))FileLinks.spots.push({code,words:[code.textContent.trim()]});
  const walk=document.createTreeWalker(body,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest("code,pre,a,.katex,.lblock")?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  for(let n=walk.nextNode();n;n=walk.nextNode()){const words=n.nodeValue.match(FILE_WORD);if(words)FileLinks.spots.push({text:n,words});}
 }
 clearTimeout(FileLinks.timer);FileLinks.timer=setTimeout(fileLinksCheck,60);
}
async function fileLinksCheck(){
 const spots=FileLinks.spots;FileLinks.spots=[];if(!spots.length)return;
 const refs=await safe(()=>rpc("file_refs",{words:[...new Set(spots.flatMap(s=>s.words))]}));if(!refs)return;
 for(const s of spots){
  if(s.code){const r=refs[s.words[0]];if(r?.text===s.words[0]&&s.code.isConnected!==false&&s.code.parentNode)s.code.replaceWith(fileLink(r.path,s.code.cloneNode(true)));continue;}
  const parts=[];let rest=s.text.nodeValue;
  for(const w of s.words){const r=refs[w];if(!r)continue;const at=rest.indexOf(w);if(at<0)continue;const cut=at+w.length-r.text.length;parts.push(rest.slice(0,cut),fileLink(r.path,r.text));rest=rest.slice(at+w.length);}
  if(parts.length&&s.text.parentNode)s.text.replaceWith(...parts,rest);
 }
}
function messageEl(pid,m,answers,key){
 const st=Chat[pid],p=Dock.panels[pid],meta=m.meta||{},list=st.data.messages,at=list.indexOf(m),next=list[at+1];
 // A reply that broke off: the last one can be answered again; one already answered again says so.
 const redone=m.role==="assistant"&&next?.role==="assistant"&&next.meta?.retry,canRetry=!next&&!st.data.busy;
 const mine=m.role==="user";
 const r=mine?{html:markdown(m.content),blocks:[]}:replyHtml(meta.imported?adaptImported(m.content):m.content);
 const incomplete=!mine&&meta.stop_reason&&meta.stop_reason!=="end_turn";
 const foot='<div class="msg-foot">'+(mine?"":'<span>'+esc(meta.imported||agentTitle(meta.agent||p.agent))+'</span>')+(meta.restored?"":'<time>'+esc(fmtDate(m.at,true))+'</time>')+(mine?"":usageLabel(meta.usage))+
  (m.content.trim()?iconButton("copy","msg-copy",$t("复制"),'data-pid="'+pid+'" data-mid="'+m.id+'"'):"")+(!mine&&m.content.trim()?messageTools(pid,m):"")+'</div>';
 const html=mine?'<div class="msg from-me" data-mid="'+m.id+'"><div class="bubble">'+
   (meta.skill_title?"<div class=\"msg-skill\""+(meta.skill?" data-skill-open=\""+esc(meta.skill)+"\" data-tip=\""+$t("看看、改改这个技能")+"\"":"")+">"+svg("store",11)+" "+$t("按技能「{0}」",esc(meta.skill_title))+"</div>":"")+
   (meta.selection?'<div class="msg-quote"'+(meta.anchor?" data-action=\"quote-go\" data-pid=\""+pid+"\" data-mid=\""+m.id+"\" title=\""+$t("回到原处")+"\"":"")+'>'+esc(shorten(meta.selection,180))+(meta.anchor?.label?'<small>'+esc(meta.anchor.label)+'</small>':"")+'</div>':"")+
   (meta.attach?.length?messageTiles(meta.attach):"")+
   '<div class="markdown msg-body">'+r.html+'</div></div>'+(RESTORED[meta.restored]?'<div class="msg-note">'+RESTORED[meta.restored]+'</div>':"")+foot+'</div>'
  :'<div class="msg from-ai" data-mid="'+m.id+'">'+skillsUsed(meta.skills||olderSkills(list,at))+thinkingHtml(meta.thinking,meta.think_seconds)+stepsHtml(meta.steps)+'<div class="markdown msg-body">'+r.html+'</div>'+
   (redone?"<div class=\"msg-note\">"+$t("这次没有答完，下面是重新回答的")+"</div>":incomplete?'<div class="msg-note">'+esc(meta.stop_reason==="cancelled"?$t("已停止 · 保留了部分回答"):meta.stop_reason==="max_tokens"?$t("达到回复长度上限"):$t("没有正常结束 · 只保留了收到的部分"))+
    (canRetry?button(svg("refresh",12)+" "+$t("重新回答"),"chat-retry",'data-pid="'+pid+'"',"ghost xs"):"")+'</div>':"")+
   actionChips((meta.actions||[]).filter(a=>!/^(skill|me):/.test(String(a.ref||""))),st.data.undone||[])+remembered(meta.actions,st.data.undone||[])+sourcesHtml(meta.sources)+cardsNoted(st.data.cards?.[m.id])+suggestionsHtml(pid,m)+changesHtml(meta.changes)+foot+'</div>';
 const node=h(html);node.__key=key;
 const fold=node.querySelector("details.actions");if(fold)fold.open=st.opened.has(String(m.id));
 const thought=node.querySelector("details.thinking-box");if(thought)thought.open=st.thoughts[m.id]??S.ui.thinking==="open";
 const steps=node.querySelector("details.steps-box");if(steps)steps.open=st.opened.has("steps:"+m.id);
 if(r.blocks.length)mountBlocks(node,r.blocks,{thread:st.thread,message:m.id,answers,pid});
 if(meta.changes?.length)mountInlineChanges(node);
 if(meta.attach?.length){hydrateVault(node);fillTextTiles(node);}
 if(!mine)linkFiles(node);
 return node;
}
function messageTools(pid,m){
 const agent=Dock.panels[pid].agent,out=[];
 if(agent==="tutor")out.push(button(svg("code",12)+" "+$t("开始练习"),"practice-start","data-pid=\""+pid+"\" data-mid=\""+m.id+"\" title=\""+$t("让练习教练带着你一步步把这段内容写出来")+"\"","ghost xs"));
 if(agent==="tutor"||agent==="flash")out.push(button(svg("card",12)+" "+$t("存成卡片"),"message-card",'data-pid="'+pid+'" data-mid="'+m.id+'"',"ghost xs"));
 if(agent==="flash")out.push(button($t("交给主会话深入讲"),"message-escalate",'data-pid="'+pid+'" data-mid="'+m.id+'"',"ghost xs"));
 return out.join("");
}
/* What the agent did, folded to one line; the steps that need the learner now stay outside the fold. */
/* Which skills a reply followed, at its top: picked by the learner for the message, or looked up by the agent. */
function skillsUsed(list){
 if(!list?.length)return "";
 return "<div class=\"msg-skills\">"+svg("store",12)+"<span>"+$t("按技能")+"</span>"+list.map(s=>'<a data-skill-open="'+esc(s.slug)+'" data-tip="'+esc(s.picked?$t("你为这条消息选的技能"):$t("AI 判断这件事该照这个技能做"))+'">'+esc(s.title)+'</a>').join("")+"</div>";
}
// Replies from before the skills were noted with them: the skill picked for the question, and any the agent read.
function olderSkills(list,at){
 const m=list[at],q=[...list.slice(0,at)].reverse().find(x=>x.role==="user"),out=[];
 if(q?.meta?.skill)out.push({slug:q.meta.skill,title:q.meta.skill_title||q.meta.skill,picked:true});
 for(const a of m.meta?.actions||[]){const k=String(a.ref||"").match(/^skill:(.+)$/);if(k&&!out.some(s=>s.slug===k[1]))out.push({slug:k[1],title:(a.summary.match(/「(.+)」/)||[,k[1]])[1]});}
 return out;
}
function liveSkills(st){
 const out=st.liveSkill?[{...st.liveSkill,picked:true}]:[];
 for(const a of st.live||[]){const m=String(a.ref||"").match(/^skill:(.+)$/);if(m&&!out.some(s=>s.slug===m[1]))out.push({slug:m[1],title:(a.summary.match(/「(.+)」/)||[,m[1]])[1]});}
 return out;
}
export function actionChips(actions,undone=[],live=false){
 if(!actions?.length)return "";
 const gone=a=>undone.includes(a.id)||(S.data?.undone||[]).includes(a.id);
 const rows=actions.map(a=>'<div class="action'+(gone(a)?" undone":"")+'">'+svg(live?"spark":"check",12)+'<span>'+esc(a.summary)+'</span>'+
   (a.ref&&!gone(a)&&!a.ref.startsWith("handoff:")&&!a.ref.startsWith("ui:")?button($t("查看"),"open-ref",'data-ref="'+esc(a.ref)+'"',"ghost xs"):"")+
   (a.undoable&&!gone(a)&&!live?button(svg("undo",11)+" "+$t("撤销"),"undo",'data-id="'+esc(a.id)+'"',"ghost xs"):gone(a)?"<small>"+$t("已撤销")+"</small>":"")+'</div>').join("");
 const lead=live?"":actions.filter(a=>a.ref&&!gone(a)&&(a.ref.startsWith("handoff:")||a.ref.startsWith("ui:"))).map(a=>a.ref.startsWith("handoff:")?
   button($t("请主会话接住"),"handoff",'data-topic="'+esc(a.ref.slice(8))+'"',"ghost xs"):button(svg("undo",11)+" "+$t("还原界面"),"ui-restore",'data-snapshot="'+esc(a.ref.slice(3))+'"',"ghost xs")).join("");
 const line=live?$t("正在：")+actions[actions.length-1].summary:actions.map(a=>a.summary).join(" · ");
 return "<details class=\"actions"+(live?" live":"")+"\"><summary>"+svg(live?"spark":"check",12)+"<b>"+actions.length+" "+$t("步")+"</b><span>"+esc(line)+"</span>"+svg("chevrondown",11)+"</summary><div class=\"action-list\">"+rows+"</div></details>"+(lead?'<div class="action-lead">'+lead+'</div>':"");
}
// A search result's title can be a PDF's raw bytes read as text; the site's name says more then.
function sourceTitle(s){const t=String(s.title||"");return !t||(t.match(/[\u0080-\u00ff\ufffd]/g)||[]).length>t.length*.15?hostOf(s.url):t;}
/* Skill changes an agent proposed in this reply: each is reviewed right here, side by side (see skillchange.js). */
// What the agent noted about the learner in this reply (me.md): each line on its own, to keep or undo.
function remembered(actions,undone=[]){
 const notes=(actions||[]).filter(a=>a.ref==="me:");if(!notes.length)return "";
 const gone=a=>undone.includes(a.id)||(S.data?.undone||[]).includes(a.id);
 return notes.map(a=>"<div class=\"remembered"+(gone(a)?" undone":"")+"\">"+svg("bulb",12)+"<a data-action=\"open-file\" data-path=\"me.md\" data-tip=\""+$t("打开「关于我」")+"\">"+esc(a.summary)+"</a>"+(gone(a)?"<small>"+$t("已撤销")+"</small>":a.undoable?button(svg("undo",11)+" "+$t("撤销"),"undo",'data-id="'+esc(a.id)+'"',"ghost xs"):"")+"</div>").join("");
}
// The cards the organizer noted from a reply, by kind; each opens.
function cardsNoted(list){
 if(!list?.length)return "";
 const seen=new Set(),cards=list.filter(c=>!seen.has(c.id)&&seen.add(c.id));
 return "<div class=\"cards-noted\"><span>"+svg("card",12)+" "+$t("记下了")+"</span>"+cards.map(c=>'<a data-action="open-doc" data-id="'+esc(c.id)+'" data-tip="'+esc((c.new?$t("新卡"):$t("补充到已有的卡"))+(c.area?" · "+c.area:""))+'">'+
  (c.type?'<i class="ct ct-'+esc(c.type)+'">'+esc(cardTypeName[c.type]||c.type)+'</i>':"")+esc(c.title)+(c.new?"":"<small>"+$t("补充")+"</small>")+'</a>').join("")+"</div>";
}
function changesHtml(list){return (list||[]).map(c=>'<div class="sc-slot" data-change="'+esc(c.change)+'"></div>').join("");}
function sourcesHtml(sources){
 if(!sources?.length)return "";
 return "<div class=\"sources\"><span>"+svg("link",12)+" "+$t("来源")+"</span>"+sources.map(s=>'<a data-action="open-web" data-url="'+esc(s.url)+'" title="'+esc(s.url)+'">'+esc(shorten(sourceTitle(s),48))+'</a>').join("")+"</div>";
}
function suggestionsHtml(pid,m){
 const list=m.meta?.suggestions||[];if(!list.length)return "";
 const decided=Chat[pid].data.decisions||{};
 return list.map(s=>{
  const state=decided[m.id+":"+s.id];
  const diff=(s.old?s.old.split("\n").map(l=>'<div class="del">- '+esc(l)+'</div>').join(""):"<div class=\"ctx\">"+$t("（加到文件末尾）")+"</div>")+s.new.split("\n").map(l=>'<div class="add">+ '+esc(l)+'</div>').join("");
  return "<div class=\"suggestion\"><div class=\"suggestion-head\">"+svg("edit",13)+" "+$t("建议修改")+" <a data-action=\"open-file\" data-path=\""+esc(s.file)+"\""+(s.old?' data-highlight="'+esc(s.old.split("\n")[0].slice(0,80))+'"':"")+">"+esc(s.file)+"</a>"+(s.why?'<span>'+esc(s.why)+'</span>':"")+"</div><div class=\"diff\">"+diff+"</div><div class=\"suggestion-actions\">"+(state?'<small>'+(state==="applied"?$t("已应用"):$t("已忽略"))+'</small>':
   button($p("动作","应用"),"suggestion",'data-pid="'+pid+'" data-mid="'+m.id+'" data-sid="'+esc(s.id)+'" data-decision="applied"',"primary xs")+button($t("忽略"),"suggestion",'data-pid="'+pid+'" data-mid="'+m.id+'" data-sid="'+esc(s.id)+'" data-decision="dismissed"',"ghost xs"))+"</div></div>";
 }).join("");
}
/* What the model thought before answering: folded to how long and one line, the full text one click away. */
function freshThinking(){return {think:"",thinkingNow:false,thinkMs:0,thinkFrom:0,liveOpen:null,steps:[],stepAt:0};}
function thinkSummary(text){
 const plain=String(text||"").replace(/[#*`>_|]/g," ").replace(/\s+/g," ").trim();
 return shorten((plain.match(/^.*?(?:[。！？]|[.!?](?=\s|$))/)||[plain])[0],90);
}
function lastThought(text){const lines=String(text||"").split("\n").map(x=>x.trim()).filter(Boolean);return lines.length?"…"+lines[lines.length-1].slice(-80):"";}
function seconds(s){return s<1?$t("不到 1 秒"):s<60?Math.round(s)+" "+$t("秒"):Math.floor(s/60)+" "+$t("分 {0} 秒",Math.round(s%60));}
function thinkingHtml(text,secs,live=null){
 if(S.ui.thinking==="hidden"||!String(text||"").trim())return "";
 const head=live?(live.now?$t("正在思考"):$t("思考了")+" "+seconds(live.secs)):secs?$t("思考了")+" "+seconds(secs):$t("思考过程");
 const open=live?live.open:false;
 return '<details class="thinking-box'+(live?" live":"")+(live?.now?" now":"")+'"'+(open?" open":"")+'><summary>'+svg("bulb",13)+'<b>'+head+'</b><span>'+esc(live?.now?lastThought(text):thinkSummary(text))+'</span>'+svg("chevrondown",11)+'</summary>'+
  (live&&!open?"":'<div class="thinking-text markdown">'+markdown(text)+'</div>')+'</details>';
}
/* The one-line notes written between tool rounds: where a long reply has got to while it works, folded once it is done. */
export function stepsHtml(steps,live=null){
 if(!steps?.length)return "";
 const list='<ol class="steps-list">'+steps.map((s,i)=>'<li'+(live?.now&&i===steps.length-1?' class="now"':"")+'>'+esc(s).replace(/`([^`]+)`/g,"<code>$1</code>")+'</li>').join("")+'</ol>';
 if(live)return '<div class="steps-box live">'+list+'</div>';
 return "<details class=\"steps-box\"><summary>"+svg("check",12)+"<b>"+$t("经过 {0} 步",steps.length)+"</b><span>"+esc(steps.at(-1))+"</span>"+svg("chevrondown",11)+"</summary>"+list+"</details>";
}
function atScrollEnd(box){return box.scrollHeight-box.scrollTop-box.clientHeight<24;}
/* Replies under way, each drawn in its own place: what it has written, thought and done so far. A conversation can
   have more than one at a time (the quick answer's), each under the question it answers. */
function newRun(question=null,skill=null){return {stream:"",live:[],waiting:"",error:"",lastChunk:0,question,liveSkill:skill,...freshThinking()};}
function runOf(st,run,question){const L=st.runs[run]||(st.runs[run]=newRun(question??null));if(L.question==null&&question!=null)L.question=question;return L;}
function answering(st){return Object.keys(st?.runs||{}).length>0||!!st?.data?.busy;}
/* Only the replies being written re-render while they stream. */
function renderLive(pid){
 const node=Dock.els[pid],st=Chat[pid];if(!node||!st)return;
 for(const slot of node.querySelectorAll(".chat-scroll>.live-slot")){
  const run=slot.dataset.run||"";
  if(run&&st.runs[run])renderRun(pid,slot,st.runs[run]);
  else if(!run)renderRest(pid,slot);
 }
}
/* Below every reply: why the last question went unanswered, or what went wrong sending one; and, for a conversation
   answering where this panel does not know the reply yet (opened meanwhile), that it is at work. */
function renderRest(pid,slot){
 const st=Chat[pid],busy=answering(st),last=st.data?.messages?.at(-1);
 if(busy&&!Object.keys(st.runs).length){renderRun(pid,slot,st.idle||(st.idle=newRun()));return;}
 st.idle=null;
 const html=st.error?'<div class="chat-error">'+esc(st.error)+(busy?"":button(svg("refresh",12)+" "+$t("重试"),"chat-retry",'data-pid="'+pid+'"',"ghost xs"))+'</div>':
  // A question left without any answer (the reply failed before a word came back, or the program was closed meanwhile).
  !busy&&last?.role==="user"?"<div class=\"chat-error quiet\">"+$t("这一问还没有得到回答")+(st.data.failure?.message?'<small class="fail-why">'+esc(st.data.failure.at+" "+$t("那次出错：")+shorten(st.data.failure.message,240))+(/502|503|forbidden|upstream/i.test(st.data.failure.message)?$t("。这是服务那边拒绝了，可以换个模型试试"):"")+'</small>':"")+button(svg("refresh",12)+" "+$t("重新回答"),"chat-retry",'data-pid="'+pid+'"',"ghost xs")+"</div>":"";
 if(slot.__frame!==html){slot.innerHTML=html;slot.__frame=html;}
}
function renderRun(pid,slot,L){
 const st=Chat[pid],busy=true;
 const r=replyHtml(L.stream,true);
 const secs=(L.thinkMs+(L.thinkingNow?Date.now()-L.thinkFrom:0))/1000;
 const open=L.liveOpen??S.ui.thinking==="open",thought=thinkingHtml(L.think,0,{now:L.thinkingNow,secs,open});
 const used=liveSkills(L);
 const steps=stepsHtml(L.steps,{now:L.stream.length===L.stepAt&&!L.thinkingNow});
 const frame=(L.stream||L.live.length||thought||steps||used.length?'<div class="msg from-ai streaming">'+skillsUsed(used)+"\u0000"+steps+'<div class="markdown msg-body">'+r.html+'</div>'+actionChips(L.live.filter(a=>!String(a.ref||"").startsWith("skill:")),[],true)+'</div>':"")+
  waitingHtml(L,busy)+(L.error?'<div class="chat-error">'+esc(L.error)+'</div>':"");
 // While only the thinking grows, it is updated in place, so the learner can scroll through it as it is written;
 // it follows the newest line until they scroll up, and follows again once they scroll back to its end.
 const box=slot.querySelector(".thinking-box.live"),text=box?.querySelector(".thinking-text");
 if(box&&thought&&slot.__frame===frame&&box.open===open){
  const fresh=h(thought),grown=fresh.querySelector(".thinking-text");
  box.className=fresh.className;box.querySelector("summary").replaceWith(fresh.querySelector("summary"));
  if(text&&grown){const end=atScrollEnd(text);text.innerHTML=grown.innerHTML;if(end)text.scrollTop=text.scrollHeight;}
  return;
 }
 const was=text&&{top:text.scrollTop,end:atScrollEnd(text)};
 // Blocks already drawn (a relation graph, an experiment…) stay as they are while the rest of the reply grows.
 const kept=new Map();for(const n of slot.querySelectorAll(".lblock[data-live-key]"))kept.set(n.dataset.liveKey,n);
 slot.innerHTML=frame.replace("\u0000",()=>thought);slot.__frame=frame;
 const shown=slot.querySelector(".thinking-box.live .thinking-text");if(shown)shown.scrollTop=!was||was.end?shown.scrollHeight:was.top;
 if(r.blocks.length){
  for(const node of slot.querySelectorAll(".lblock[data-block]")){
   const b=r.blocks[+node.dataset.block];if(!b||b.error==="pending")continue;
   const key=b.type+"\u0000"+b.raw,old=kept.get(key);
   if(old){old.dataset.block=node.dataset.block;node.replaceWith(old);}else node.dataset.liveKey=key;
  }
  mountBlocks(slot,r.blocks,{thread:st.thread,message:0,answers:{},pid,live:true});
 }
}
/* What the reply is doing while no words come: a tool at work (with what it works on and for how long), or thinking
   between steps. Shown under what is written so far, so a long install never looks like the reply has stalled. */
export const WAIT_LABEL={retry:$t("服务暂时出错，正在重试"),extend:$t("写到了长度上限，接着往下写"),install:$t("正在安装"),run:$t("正在运行代码"),shell:$t("正在执行命令"),web_search:$t("正在联网搜索"),web_fetch:$t("正在读网页"),ui:$t("正在调整界面"),skill_edit:$t("正在准备修改"),route:$t("正在调整路线"),replan:$t("正在调整路线")};
export function elapsed(ms){const s=Math.floor(ms/1000);return s<60?s+" "+$t("秒"):Math.floor(s/60)+" "+$t("分 {0} 秒",String(s%60).padStart(2,"0"));}
function waitingHtml(st,busy){
 if(!busy||st.thinkingNow)return "";
 const w=st.waiting,quiet=!st.stream||Date.now()-(st.lastChunk||0)>1500;
 if(!w&&!quiet)return "";
 const label=w?(WAIT_LABEL[w.name]||$t("正在用工具")+" "+w.name):st.stream||st.live.length?$t("正在想下一步…"):$t("正在想…");
 const long=w&&w.name==="install"&&Date.now()-w.since>20000?"<small>"+$t("大的包（比如 torch 连同 CUDA 的库约 3GB）可能要十几分钟")+"</small>":"";
 return '<div class="thinking working"><span></span><span></span><span></span><b>'+esc(label)+'</b>'+(w?.gpu?"<span class=\"chip ai\">"+$t("用显卡")+"</span>":"")+(w?.detail?'<code>'+esc(shorten(w.detail,90))+'</code>':"")+
  (w?'<em data-since="'+w.since+'">'+elapsed(Date.now()-w.since)+'</em>':"")+(w?'<span class="wait-progress">'+esc(w.progress||"")+'</span>':"")+long+'</div>';
}
// While a tool works, the time on its line moves, and the "thinking" line appears once words stop coming.
const liveTicks={};
function liveTicker(pid){
 if(liveTicks[pid])return;
 liveTicks[pid]=setInterval(()=>{
  const st=Chat[pid],node=Dock.els[pid];
  if(!answering(st)||!node){clearInterval(liveTicks[pid]);delete liveTicks[pid];return;}
  // Only the time changes in place; a reply is redrawn just when its line comes or goes (a selection survives).
  let redraw=false;
  for(const slot of node.querySelectorAll(".chat-scroll>.live-slot")){
   const L=st.runs[slot.dataset.run]||(!slot.dataset.run&&st.idle);if(!L)continue;
   const em=slot.querySelector("em[data-since]");if(em)em.textContent=elapsed(Date.now()-Number(em.dataset.since));
   const shown=slot.querySelector(".thinking.working"),want=waitingHtml(L,true);
   if(!!shown!==!!want||(want.includes("<small>")&&!shown?.querySelector("small")))redraw=true;
  }
  if(redraw)patchLive(pid);
 },1000);
}
const liveFrames={};
function patchLive(pid){
 if(liveFrames[pid])return;
 liveFrames[pid]=setTimeout(()=>requestAnimationFrame(()=>{
  delete liveFrames[pid];
  const scroll=Dock.els[pid]?.querySelector(".chat-scroll");if(!scroll)return;
  const stick=Chat[pid]?.bottom!==false;
  renderLive(pid);fitSpacer(pid);if(stick)scroll.scrollTop=scroll.scrollHeight;toBottomButton(pid);
 }),90);
}
/* The input: a capsule while it holds one line, a rounded box once it needs more. */
function composerHtml(pid){
 return "<button class=\"to-bottom\" data-action=\"chat-bottom\" data-pid=\""+pid+"\" title=\""+$t("回到最新")+"\" hidden>"+svg("arrowup",15)+"</button><div class=\"attach-row\"></div><div class=\"capsule\"><button class=\"cap-btn\" data-action=\"chat-attach\" data-pid=\""+pid+"\" title=\""+$t("附上文件或选中的文字")+"\">"+svg("plus",17)+"<span class=\"cap-label\">"+$t("附件")+"</span></button><textarea rows=\"1\" data-composer=\""+pid+"\"></textarea><button class=\"model-tag\" data-action=\"chat-model\" data-pid=\""+pid+"\" title=\""+$t("这个窗口用的模型")+"\"></button><span class=\"send-slot\"></span></div>";
}
export function chatModel(pid){
 const p=Dock.panels[pid],cfg=S.config?.agents?.[p.agent]||{},use=p.model;
 const api=use?.api||cfg.api,ready=use?!!(S.config?.apis||[]).find(a=>a.id===api)?.has_key:!!cfg.ready;
 return {api,model:use?.model||cfg.model||"",own:!!use,ready};
}
export function updateComposer(pid){
 const node=Dock.els[pid],st=Chat[pid],p=Dock.panels[pid];if(!node||!st?.data)return;
 const area=node.querySelector(".composer textarea");if(!area)return;
 const ended=p.agent==="coach"&&st.data.practice&&st.data.practice.state!=="active",m=chatModel(pid),busy=answering(st),more=busy&&canAskMore(pid);
 area.disabled=ended;
 area.placeholder=ended?$t("这次练习已经结束"):!m.ready?$t("还没接入模型"):(AGENT_HINT[p.agent]||"")+" · "+sendHint();
 node.querySelector(".attach-row").innerHTML=(st.skill?"<span class=\"sel-chip skill\">"+svg("store",11)+" "+$t("技能：")+esc(st.skill.title)+"<button data-action=\"skill-clear\" data-pid=\""+pid+"\" title=\""+$t("不用这个技能")+"\">×</button></span>":"")+(st.quote?"<span class=\"sel-chip\" title=\""+esc(shorten(st.quote,400))+"\">"+svg("quote",11)+" "+$t("“{0}” · {1} 字",esc(shorten(st.quote.replace(/\s+/g," "),28)),st.quote.length)+"<button data-action=\"quote-clear\" data-pid=\""+pid+"\" title=\""+$t("不带")+"\">×</button></span>":"")+
  composerTiles(pid);
 hydrateVault(node.querySelector(".attach-row"));
 const tag=node.querySelector(".model-tag");
 const lvl=S.config?.effort_levels?.[p.effort||S.config?.agents?.[p.agent]?.effort||""];
 tag.innerHTML='<span>'+esc(modelName(m.model))+'</span>'+(lvl?"<i class=\"model-effort\" data-tip=\""+$t("思考强度")+"\">"+esc(lvl)+"</i>":"")+svg("chevrondown",10);tag.hidden=!m.ready;tag.classList.toggle("own",m.own);tag.classList.toggle("working",!!busy);
 node.querySelector(".send-slot").innerHTML=busy?"<button class=\"send-round stop\" data-action=\"chat-cancel\" data-pid=\""+pid+"\" title=\""+$t("停止")+"\">"+svg("stop",13)+"</button>"+
  (more?"<button class=\"send-round\" data-action=\"chat-send\" data-pid=\""+pid+"\" title=\""+$t("再问一个，和正在回答的同时答")+"\">"+svg("arrowup",16)+"</button>":""):
  !m.ready?button($t("去设置"),"open-settings",'data-page="agents"',"primary sm pill"):"<button class=\"send-round\" data-action=\"chat-send\" data-pid=\""+pid+"\" title=\""+$t("发送")+"\""+(ended?" disabled":"")+">"+svg("arrowup",16)+"</button>";
 fitComposer(pid);
}
function modelName(model){return String(model||"").split("/").pop()||$t("未选择模型");}
export function fitComposer(pid){
 const area=Dock.els[pid]?.querySelector(".composer textarea"),cap=area?.closest(".capsule");if(!area||!area.isConnected)return;
 // Measured in the one-line shape, so it does not flip back and forth at the edge.
 if(Dock.els[pid].dataset.composer==="line"){cap.classList.remove("multi");area.style.height="auto";area.style.height=area.scrollHeight+"px";area.style.overflowY=area.scrollHeight>area.clientHeight+1?"auto":"hidden";return;}
 cap.classList.remove("multi");area.style.height="auto";
 const multi=area.value.includes("\n")||area.scrollHeight>area.clientHeight+2;
 cap.classList.toggle("multi",multi);
 area.style.height="auto";area.style.height=area.scrollHeight+"px";
 area.style.overflowY=area.scrollHeight>area.clientHeight+1?"auto":"hidden";
}
export function attachMenu(pid,anchor){
 const st=Chat[pid],have=new Set(st.attach.map(a=>a.path));
 const open=Object.values(Dock.panels).filter(p=>p.type==="file"&&p.path).map(p=>p.path);
 const paths=[...new Set([...open,...(Dwell.recent||[]).map(r=>r.path)])].filter(x=>!have.has(x)).slice(0,10);
 popMenu(anchor,(Sel.text?"<button data-action=\"chat-attach-sel\" data-pid=\""+pid+"\">"+svg("quote",14)+"<span>"+$t("带上选中的文字")+"<small>"+$t("“{0}” · {1} 字",esc(shorten(Sel.text.replace(/\s+/g," "),36)),Sel.text.length)+"</small></span></button><hr/>":"")+"<button data-action=\"skill-menu\" data-pid=\""+pid+"\">"+svg("store",14)+"<span>"+$t("用一个技能…")+"<small>"+$t("这条消息按某个技能的做法来（也可以在输入框里打 /）")+"</small></span></button><button data-action=\"chat-attach-pick\" data-pid=\""+pid+"\">"+svg("upload",14)+"<span>"+$t("从电脑里选文件…")+"<small>"+$t("复制进学习库的 data/附件/，AI 也能读")+"</small></span></button>"+(paths.length?"<hr/><div class=\"menu-label\">"+$t("学习库里的文件，AI 需要时会去读")+"</div>"+paths.map(x=>'<button data-action="chat-attach-add" data-pid="'+pid+'" data-path="'+esc(x)+'">'+svg(fileIcon(x),14)+'<span>'+esc(x.split("/").pop())+'<small>'+esc(x)+'</small></span></button>').join(""):""),{above:true});
}
export function modelMenu(pid,anchor){
 const p=Dock.panels[pid],m=chatModel(pid),apis=S.config?.apis||[],seen=new Set(),items=[];
 const add=(api,model,note)=>{const k=api+"|"+model;if(!model||seen.has(k))return;seen.add(k);const a=apis.find(x=>x.id===api);if(!a)return;
  items.push('<button data-action="chat-model-set" data-pid="'+pid+'" data-api="'+esc(api)+'" data-model="'+esc(model)+'"'+(a.has_key?"":" disabled")+'>'+(m.api===api&&m.model===model?svg("check",14):'<i class="menu-gap"></i>')+
   '<span>'+esc(modelName(model))+'<small>'+esc(a.label+(note?" · "+note:"")+(a.has_key?"":" "+$t("· 没有 Key")))+'</small></span></button>');};
 const own=S.config?.agents?.[p.agent];if(own)add(own.api,own.model,agentTitle(p.agent)+$t("的默认"));
 Object.entries(S.config?.agents||{}).forEach(([name,a])=>add(a.api,a.model,agentTitle(name)+$t("在用")));
 apis.filter(a=>a.has_key).forEach(a=>add(a.id,a.default_model||a.model,""));
 // How hard it thinks: this window's own level, or the agent's default from the settings.
 const conn=apis.find(x=>x.id===m.api),levels=S.config?.effort_levels||{},style=conn?.effort_style||"standard",dflt=S.config?.agents?.[p.agent]?.effort||"";
 const effort=style==="none"?"<div class=\"menu-row\"><span>"+$t("思考强度")+"</span><small>"+$t("这个连接不支持调")+"</small></div>":
  "<div class=\"menu-row\"><span>"+$t("思考强度")+"</span><div class=\"seg\">"+[["",$t("默认")],...Object.entries(levels)].map(([v,t])=>'<button class="'+((p.effort||"")===v?"on":"")+'" data-action="chat-effort" data-pid="'+pid+'" data-value="'+v+'"'+
   (v?"":' data-tip="'+esc(agentTitle(p.agent)+$t("在设置里的默认：")+(levels[dflt]||$t("服务默认")))+'"')+'>'+t+'</button>').join("")+"</div></div>";
 popMenu(anchor,"<div class=\"menu-label\">"+$t("只改这个窗口，存在布局里")+"</div>"+items.join("")+"<hr/>"+effort+"<hr/><button data-action=\"chat-model-other\" data-pid=\""+pid+"\">"+svg("edit",14)+"<span>"+$t("填写别的模型名…")+"</span></button>"+(m.own?"<button data-action=\"chat-model-set\" data-pid=\""+pid+"\" data-api=\"\" data-model=\"\">"+svg("undo",14)+"<span>"+$t("恢复成{0}的默认",esc(agentTitle(p.agent)))+"</span></button>":"")+"<button data-action=\"open-settings\" data-page=\"agents\">"+svg("sliders",14)+"<span>"+$t("模型和连接设置")+"</span></button>",{above:true});
 Menus.reopen=()=>{if(anchor.isConnected)modelMenu(pid,anchor);};
}
export function setChatModel(pid,api,model){
 const p=Dock.panels[pid],own=S.config?.agents?.[p.agent];if(!p)return;
 if(!model||(own&&own.api===api&&own.model===model))delete p.model;else p.model={api,model};
 saveLayout();updateComposer(pid);
}
// The quick answer answers a second (and third) question while it is still answering one; the others one at a time.
const SIMULTANEOUS=3;
function canAskMore(pid){const p=Dock.panels[pid],st=Chat[pid];return p?.agent==="flash"&&Object.keys(st?.runs||{}).length<SIMULTANEOUS;}
export async function chatSend(pid,text,extra={}){
 const st=Chat[pid],p=Dock.panels[pid];if(!st)return;
 const node=Dock.els[pid],area=node?.querySelector(".composer textarea");
 const message=(text??area?.value??"").trim();
 if(!message&&!extra.task)return;
 if(answering(st)&&!canAskMore(pid))return toast($t("这段对话正在回答；可以先停止"));
 await flushAll();
 const selection=extra.selection??st.quote??"",anchor=extra.selection==null?st.quoteAt||null:null,attach=text==null?st.attach.map(a=>a.path):[];
 if(text==null&&area){area.value="";fitComposer(pid);}st.input="";
 st.error="";
 try{
  const skill=text==null?st.skill:null;
  // The screen as it is now, so the tab directory sent along says what the learner was just using.
  clearTimeout(screenTimer);await safe(sendScreen);
  const from=Dock.space,r=await rpc("send",{agent:p.agent,message,thread:st.thread,...(p.space?{space:p.space}:{}),selection,task:extra.task||"",note:screenNote(),answer:extra.answer||null,attach,model:p.model||null,skill:skill?.slug||null,effort:p.effort||null,anchor,...(WINDOW?{window:WINDOW}:{})});
  st.thread=r.thread;Dock.origin[r.thread]=from;if(extra.selection==null){st.quote="";st.quoteAt=null;}if(text==null){st.attach=[];st.skill=null;}
  const L=runOf(st,r.run||r.thread,r.question);if(skill&&!L.liveSkill)L.liveSkill={slug:skill.slug,title:skill.title};
  if(!st.data.messages.some(m=>String(m.id)===String(r.question)))st.data.messages.push({id:r.question??"pending",role:"user",content:message||({check:$t("我写好了，帮我看看我的代码和运行结果。"),hint:$t("我卡住了，给我一点提示，先别直接给答案。"),capture:$t("把我们讨论过的内容整理成知识卡。")})[extra.task]||"",meta:{selection,answer:extra.answer,attach,skill:skill?.slug,skill_title:skill?.title},at:new Date().toISOString()});
  st.data.busy=true;st.anchored=false;renderChat(pid);anchorQuestion(pid);liveTicker(pid);
 }catch(e){if(text==null&&area){area.value=message;fitComposer(pid);}st.error=e.message;renderLive(pid);updateComposer(pid);throw e;}
}
// Answer the last question again, after a stop, a cut-off or a failure.
export async function chatRetry(pid){
 const st=Chat[pid],p=Dock.panels[pid];if(!st?.data)return;
 if(answering(st))return toast($t("这段对话正在回答；可以先停止"));
 st.error="";
 const question=[...st.data.messages].reverse().find(m=>m.role==="user"),asked=question?.meta;
 try{const r=await rpc("retry",{thread:st.thread,note:screenNote(),model:p.model||null,effort:p.effort||null});
  const L=runOf(st,r.run||st.thread,r.question??question?.id);L.liveSkill=asked?.skill?{slug:asked.skill,title:asked.skill_title||asked.skill}:null;st.data.busy=true;st.anchored=false;renderChat(pid);anchorQuestion(pid);liveTicker(pid);}
 catch(e){st.error=e.message;renderLive(pid);}
}
export function chatEvent(evt){
 if(evt.kind==="connection_test")return settingsTestResult(evt);
 for(const pid of chatPanels(evt.thread)){
  const st=Chat[pid];
  // Each reply under way has its own place; one that says nothing of which it is, is the conversation's only one.
  const run=evt.run||evt.thread,L=evt.kind==="status"||evt.kind==="finished"?st.runs[run]:runOf(st,run,evt.question);
  if(evt.kind==="thinking"){if(!L.thinkingNow){L.thinkingNow=true;L.thinkFrom=Date.now();}L.think+=evt.text;patchLive(pid);continue;}
  if(L?.thinkingNow&&["chunk","tool","tool_wait","finished","error"].includes(evt.kind)){L.thinkingNow=false;L.thinkMs+=Date.now()-L.thinkFrom;}
  // A short note before tool calls moves out of the answer into the list of steps.
  if(evt.kind==="step"){const at=L.stream.lastIndexOf(evt.text);if(at>=0)L.stream=L.stream.slice(0,at).trimEnd();L.steps.push(evt.text);L.stepAt=L.stream.length;patchLive(pid);continue;}
  if(evt.kind==="chunk"){L.stream+=evt.text;L.waiting="";L.lastChunk=Date.now();patchLive(pid);continue;}
  if(evt.kind==="status"){if(st.data){st.data.status=evt.state;st.data.busy=!["ready","offline","error","cancelled"].includes(evt.state)||st.data.busy;}const head=Dock.els[pid]?.querySelector(".chat-head");if(head)head.innerHTML=chatHead(pid);continue;}
  if(evt.kind==="tool_wait"){L.waiting={name:evt.name,detail:evt.detail||"",since:Date.now(),gpu:!!evt.gpu};patchLive(pid);liveTicker(pid);continue;}
  if(evt.kind==="retrying"){
   // The service failed for a moment (or the reply ran out of room): it is tried again and goes on where it stopped.
   L.waiting=evt.attempt?{name:"retry",detail:$t("第 {0} 次，{1} 秒后",evt.attempt,evt.wait),since:Date.now(),progress:shorten(String(evt.message||"").replace(/^API\s*/,""),120)}:{name:"extend",detail:"",since:Date.now()};
   patchLive(pid);liveTicker(pid);continue;
  }
  if(evt.kind==="tool_progress"){if(L.waiting){L.waiting.progress=evt.text;const p=Dock.els[pid]?.querySelector('.live-slot[data-run="'+CSS.escape(run)+'"] .thinking.working .wait-progress');if(p)p.textContent=evt.text;else patchLive(pid);}continue;}
  if(evt.kind==="tool"){L.waiting="";L.lastChunk=Date.now();if(evt.actions?.length){L.live.push(...evt.actions);patchLive(pid);}continue;}
  if(evt.kind==="error"){L.error=evt.message||$t("请求失败");patchLive(pid);continue;}
  if(evt.kind==="finished"){
   // Done: what went wrong stays under the conversation; the rest is in the reply now saved.
   if(L?.error)st.error=L.error;delete st.runs[run];st.idle=null;
   if(evt.errors?.length)toast(evt.errors.join("；"),"error");
   if(evt.focus!==undefined){
    // The topic changes in the state this conversation is in, not in the others.
    const space=Dock.panels[pid]?.space||Dock.space;setTopicOf(space,evt.focus);
    refreshState().then(()=>followingChanged(space));
   }else loadChat(pid);
  }
 }
 if(evt.kind==="finished"&&evt.agent==="organizer"&&!evt.cards_for&&!evt.saved)organizeFinished(evt);
 if(evt.kind==="finished")refreshState();
 // The lists of conversations show which one is answering, and a first question names a new one.
 if((evt.kind==="finished"||evt.kind==="status")&&SESSION_AGENTS.has(evt.agent)){clearTimeout(Side.sessionsTimer);Side.sessionsTimer=setTimeout(sessionsChanged,300);}
}
export async function startPractice(pid,mid){
 const st=Chat[pid];
 const p=await rpc("practice_start",{thread:st.thread,message:Number(mid)});
 await refreshState();
 const here=stackOf(pid)?.id;
 openPanel({type:"chat",agent:"coach",thread:p.id},{stack:here});
 openFile(p.file);
 toast($t("练习开始了：左边是教练，右边是你的练习文件"));
}
export async function openPractice(id){
 const p=await rpc("practice",{id});
 openPanel({type:"chat",agent:"coach",thread:id});
 if(p.file)openFile(p.file);
}
export async function endPractice(pid){
 const st=Chat[pid];
 if(!await ask($t("结束后这个练习就不能再继续对话了。"),{title:$t("结束这次练习，交给主会话复盘？"),ok:$t("结束练习")}))return;
 await flushAll();
 const r=await rpc("practice_end",{id:st.thread});
 toConversation("tutor");
 // The tutor's review is under way by then, in whichever window shows it.
 await loadChat(pid);setTimeout(()=>{Object.keys(Chat).filter(x=>Chat[x].thread===r.tutor_thread||Dock.panels[x]?.agent==="tutor").forEach(x=>loadChat(x));if(!followingPanel("tutor"))toConversation("tutor",{do:"load"});},300);
 toast($t("已交给主会话复盘"));
}
export async function messageToCard(pid,mid){
 const st=Chat[pid],m=st.data.messages.find(x=>String(x.id)===String(mid));if(!m)return;
 const body=m.content.replace(BLOCK_RE,"").trim();
 const guess=(body.match(/^#+\s*(.+)$/m)||body.match(/\*\*(.+?)\*\*/)||[])[1]||"";
 const title=await askText($t("这张知识卡的标题"),guess.replace(/[#*]/g,"").trim().slice(0,60),{ok:$t("存成卡片")});if(!title)return;
 const r=await rpc("doc_create",{kind:"card",title,topic:st.data.head?.topic||null,body});
 await refreshState();openFile(r.path);
}
export function escalate(pid,mid){
 const m=Chat[pid].data.messages.find(x=>String(x.id)===String(mid));if(!m)return;
 toConversation("tutor",{do:"send",text:$t("我刚才和快答讨论了下面的内容。请检查它是否准确，再帮我深入理解，并接回主线：")+"\n\n"+m.content});
}
/* The ⋯ menu: how this window shows the conversation, how all windows do, and the rest of what a conversation can do. */
/* Token counts: compact numbers, a short label under each reply, the full breakdown when the mouse rests on it. */
export function tokenNum(n){n=Number(n)||0;const cut=(x,d)=>x.toFixed(d).replace(/\.0+$/,"");return n<1000?String(n):n<10000?cut(n/1000,1)+"k":new Intl.NumberFormat(LOCALE,{notation:"compact",maximumFractionDigits:n<1e5?1:n<1e8?0:2}).format(n);}
function normUsage(u){
 if(!u)return null;
 // Replies saved before the counts were unified carry the service's own field names.
 if(u.input==null)u={input:u.prompt_tokens||u.input_tokens||0,output:u.completion_tokens||u.output_tokens||0,cached:u.prompt_tokens_details?.cached_tokens||u.prompt_cache_hit_tokens||0,
  reasoning:u.completion_tokens_details?.reasoning_tokens||0,requests:1,estimated:0};
 return u.input||u.output?u:null;
}
function usageTip(u){
 const n=x=>Number(x||0).toLocaleString();
 return [$t("输入")+" "+n(u.input)+(u.cached?$t("（缓存命中")+" "+n(u.cached)+"）":""),$t("输出")+" "+n(u.output)+(u.reasoning?$t("（其中思考")+" "+n(u.reasoning)+"）":""),
  (u.requests||1)+" "+$t("次请求")+(u.model?" · "+u.model:""),u.estimated?(u.estimated>=(u.requests||1)?$t("服务没有报用量，这是按字数估算的"):u.estimated+" "+$t("次请求没报用量，按字数估算")):""].filter(Boolean).join("\n");
}
function usageLabel(raw){const u=normUsage(raw);return u?"<span class=\"msg-tokens\" data-tip=\""+esc(usageTip(u))+"\">"+(u.estimated?"≈":"")+tokenNum(u.input)+" "+$t("入 · {0} 出",tokenNum(u.output))+"</span>":"";}
function threadUsage(st){
 const t={input:0,output:0,cached:0,reasoning:0,requests:0,estimated:0};
 for(const m of st.data?.messages||[]){const u=m.role==="assistant"&&normUsage(m.meta?.usage);if(u)for(const k in t)t[k]+=Number(u[k]||0);}
 return t.input||t.output?t:null;
}
export function chatMoreMenu(pid,anchor){
 const p=Dock.panels[pid],st=Chat[pid],u=S.ui;if(!p||!st)return;
 const lh=Number(viewOf(p,"line_height"))||1.8,rw=readChars(viewOf(p,"read_width")),own=p.zoom||p.line_height||p.read_width||p.composer;
 const row=(label,ctl)=>'<div class="menu-row"><span>'+esc(label)+'</span><div class="ctl">'+ctl+'</div></div>';
 const step=(action,key,dir,label,title)=>'<button class="step" data-action="'+action+'" data-pid="'+pid+'" data-key="'+key+'" data-dir="'+dir+'" title="'+esc(title||"")+'">'+label+'</button>';
 const seg=(action,key,cur,list)=>'<div class="seg">'+list.map(([v,t])=>'<button class="'+(String(cur)===String(v)?"on":"")+'" data-action="'+action+'" data-pid="'+pid+'" data-key="'+key+'" data-value="'+v+'">'+esc(t)+'</button>').join("")+'</div>';
 const item=(icon,text,action,attrs="")=>'<button data-action="'+action+'" data-pid="'+pid+'" '+attrs+'>'+svg(icon,14)+'<span>'+esc(text)+'</span></button>';
 popMenu(anchor,"<div class=\"menu-label\">"+$t("这个窗口")+"</div>"+row($t("大小"),step("view-step","zoom",-1,"A−","Ctrl -")+'<b>'+Math.round(zoomOf(p)*100)+'%</b>'+step("view-step","zoom",1,"A+","Ctrl ="))+row($t("行距"),step("view-step","line_height",-1,"−")+'<b>'+lh.toFixed(2)+'</b>'+step("view-step","line_height",1,"+"))+row($t("阅读宽度"),(rw?step("view-step","read_width",-1,"−",$t("窄一点"))+"<b>"+rw+" "+$t("字")+"</b>"+step("view-step","read_width",1,"+",$t("宽一点")):"<b>"+$t("不限")+"</b>")+"<button class=\"step wide"+(rw?"":" on")+"\" data-action=\"view-set\" data-pid=\""+pid+"\" data-key=\"read_width\" data-value=\"toggle\">"+$t("不限")+"</button>")+row($t("输入框"),seg("view-set","composer",viewOf(p,"composer"),[["capsule",$t("胶囊")],["line",$t("线条")]]))+(own?item("undo",$t("这个窗口恢复成默认显示"),"view-reset"):"")+"<hr/><div class=\"menu-label\">"+$t("所有窗口")+"</div>"+row($t("思考过程"),seg("ui-set","thinking",u.thinking||"collapsed",[["collapsed",$t("折叠")],["open",$t("展开")],["hidden",$t("不显示")]]))+row($t("正文字号"),step("ui-step","font_size",-1,"−")+'<b>'+(Number(u.font_size)||14.5)+'</b>'+step("ui-step","font_size",1,"+"))+row($t("笔记字号"),step("ui-step","note_font_size",-1,"−")+'<b>'+(Number(u.note_font_size)||16)+'</b>'+step("ui-step","note_font_size",1,"+"))+row($t("代码字号"),step("ui-step","code_font_size",-1,"−")+'<b>'+(Number(u.code_font_size)||13)+'</b>'+step("ui-step","code_font_size",1,"+"))+row($t("密度"),seg("ui-set","density",u.density||"comfortable",[["comfortable",$t("舒适")],["compact",$t("紧凑")]]))+row($t("明暗"),seg("ui-set","theme",u.theme||"dark",[["dark",$t("深色")],["light",$t("浅色")]]))+"<hr/>"+(p.agent==="coach"?"":item("edit",$t("开新会话"),"chat-new"))+(p.agent==="tutor"?item("book",$t("把整段对话补记成卡"),"chat-task",'data-task="capture"'):"")+item("bot",$t("换这个窗口的模型…"),"chat-model")+item("copy",$t("复制整段对话"),"chat-copy-all")+(()=>{const u=threadUsage(st);return "<button data-action=\"open-settings\" data-page=\"usage\" data-tip=\""+esc(u?usageTip(u):$t("这段对话还没有用量记录"))+"\">"+svg("bars",14)+"<span>"+$t("这段对话用了")+" "+(u?(u.estimated?"≈":"")+tokenNum(u.input+u.output)+" tokens<small>"+tokenNum(u.input)+" "+$t("入 · {0} 出 · 点开看全部用量",tokenNum(u.output))+"</small>":"0 tokens")+"</span></button>";})()+item("document",$t("把这段对话存成笔记"),"chat-save-note")+(st.data?.head?.topic?"<button data-action=\"open-doc\" data-id=\""+esc(st.data.head.topic)+"\">"+svg("map",14)+"<span>"+$t("打开主题页")+"</span></button>":"")+"<hr/>"+item("float",$t("浮出"),"dock-float")+item("close",$t("关闭"),"dock-close")+"<button data-action=\"open-settings\" data-page=\"look\">"+svg("sliders",14)+"<span>"+$t("全部外观设置")+"</span></button>",{cls:"menu-wide"});
 Menus.reopen=()=>{const b=Dock.els[pid]?.querySelector('[data-action="chat-more"]');if(b&&b.isConnected)chatMoreMenu(pid,b);};
}
export function conversationMarkdown(pid){
 const st=Chat[pid],p=Dock.panels[pid];
 return (st.data?.messages||[]).map(m=>"**"+(m.role==="user"?$t("我"):agentTitle(m.meta?.agent||p.agent))+"**（"+fmtDate(m.at,true)+"）\n\n"+m.content.trim()).join("\n\n---\n\n");
}
