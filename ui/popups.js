"use strict";
/* Every small window the program shows is its own and looks the same as its menus and dialogs: hover hints, dropdown
   lists, suggestions while typing, the right-click menu, the colour picker and the file picker. The system's versions
   (Qt's tooltips, the select and datalist popups, the colour and file dialogs, the browser's right-click menu with
   back/reload/inspect) never show. */

/* ---- hover hints: title="…" shows ours ----------------------------------------------------------------------- */
const Tip={node:null,target:null,timer:0,watch:0,warm:0};
function hideTip(){
 clearTimeout(Tip.timer);clearInterval(Tip.watch);
 if(Tip.node){Tip.node.remove();Tip.node=null;Tip.warm=Date.now()+600;}
 Tip.target=null;
}
function showTip(t){
 if(!t.isConnected||Tip.target!==t||!t.dataset.tip)return;
 const tip=h('<div id="tip" role="tooltip"></div>');tip.textContent=t.dataset.tip;document.body.appendChild(tip);Tip.node=tip;
 const r=t.getBoundingClientRect(),w=tip.offsetWidth,ht=tip.offsetHeight;
 // Beside the icons of the left bar, under (or above, at the bottom) everything else.
 if(t.closest("#activity")){tip.style.left=r.right+8+"px";tip.style.top=Math.max(6,Math.min(r.top+r.height/2-ht/2,innerHeight-ht-6))+"px";}
 else{
  const y=r.bottom+7+ht<=innerHeight-6?r.bottom+7:r.top-ht-7;
  tip.style.left=Math.max(6,Math.min(r.left+r.width/2-w/2,innerWidth-w-6))+"px";tip.style.top=Math.max(6,y)+"px";
 }
 // The thing under the mouse can be re-rendered away without the mouse moving.
 Tip.watch=setInterval(()=>{if(!t.isConnected)hideTip();},300);
}
document.addEventListener("mouseover",e=>{
 const t=e.target.closest?.("[title],[data-tip]");
 // The title moves to data-tip the first time the mouse is on it, so the system's tooltip never appears.
 if(t?.hasAttribute("title")){const v=t.getAttribute("title");t.removeAttribute("title");if(v)t.dataset.tip=v;else delete t.dataset.tip;}
 if(t===Tip.target)return;
 hideTip();if(!t?.dataset.tip)return;
 Tip.target=t;Tip.timer=setTimeout(()=>showTip(t),Tip.warm>Date.now()?60:450);
},true);
document.addEventListener("mouseout",e=>{if(!e.relatedTarget)hideTip();});
for(const ev of ["wheel","scroll"])document.addEventListener(ev,hideTip,{capture:true,passive:true});
addEventListener("blur",hideTip);

/* ---- menus by keyboard ---------------------------------------------------------------------------------------- */
const editable=t=>!!t?.closest?.("input,textarea,[contenteditable]");
document.addEventListener("keydown",e=>{
 const t=e.target;hideTip();
 if(t.tagName==="SELECT"&&!t.multiple&&!e.ctrlKey&&(e.key===" "||e.key==="Enter"||e.key==="F4"||e.altKey&&/^Arrow(Down|Up)$/.test(e.key))){
  e.preventDefault();e.stopPropagation();return selectMenu(t);
 }
 const menu=el(".menu");if(!menu)return;
 const suggest=menu.classList.contains("menu-suggest")&&Menus.owner===t;
 if(e.key==="Escape"){e.preventDefault();e.stopPropagation();const owner=Menus.owner;closeMenus();if(!suggest&&owner?.isConnected&&owner.focus)owner.focus();return;}
 if(!["ArrowDown","ArrowUp","Home","End","Enter"].includes(e.key))return;
 const items=all("button:not(:disabled)",menu).filter(b=>!b.dataset.tone);
 if(!items.length)return;
 if(suggest){
  // The caret stays in the field; the arrows move a highlight through the suggestions.
  const at=items.findIndex(b=>b.classList.contains("active"));
  if(e.key==="Enter"){if(at>=0){e.preventDefault();e.stopPropagation();items[at].click();}else closeMenus();return;}
  e.preventDefault();e.stopPropagation();
  const next=e.key==="Home"?0:e.key==="End"?items.length-1:e.key==="ArrowDown"?(at+1)%items.length:(at<=0?items.length-1:at-1);
  items.forEach((b,i)=>b.classList.toggle("active",i===next));items[next].scrollIntoView({block:"nearest"});
  return;
 }
 if(e.key==="Enter"||!(menu.contains(document.activeElement)||!editable(t)))return;
 e.preventDefault();e.stopPropagation();
 const at=items.indexOf(document.activeElement);
 const next=e.key==="Home"?0:e.key==="End"?items.length-1:e.key==="ArrowDown"?(at+1)%items.length:(at<=0?items.length-1:at-1);
 items[next].focus({preventScroll:true});items[next].scrollIntoView({block:"nearest"});
},true);

/* ---- dropdown lists: a <select> opens our list ----------------------------------------------------------------- */
function selectMenu(sel){
 if(sel.disabled||sel.multiple)return;hideTip();
 const opts=[...sel.options];
 const html=opts.map((o,i)=>(o.parentElement.tagName==="OPTGROUP"&&o===o.parentElement.firstElementChild?'<div class="menu-label">'+esc(o.parentElement.label)+'</div>':"")+
  '<button type="button" role="option" data-pick="'+i+'"'+(o.selected?' class="on" aria-selected="true"':"")+(o.disabled?" disabled":"")+'>'+svg("check",13)+'<span>'+esc(o.textContent)+'</span></button>').join("");
 const menu=popMenu(sel,html||'<p class="menu-empty">没有可选的</p>',{cls:"menu-select",width:sel.offsetWidth});
 menu.setAttribute("role","listbox");Menus.owner=sel;
 menu.addEventListener("click",e=>{
  const b=e.target.closest("[data-pick]");if(!b||b.disabled)return;
  closeMenus();sel.focus();
  const o=opts[Number(b.dataset.pick)];if(!o||o.selected)return;
  sel.value=o.value;sel.dispatchEvent(new Event("input",{bubbles:true}));sel.dispatchEvent(new Event("change",{bubbles:true}));
 });
 const on=menu.querySelector(".on")||menu.querySelector("button:not(:disabled)");
 if(on){on.scrollIntoView({block:"nearest"});on.focus({preventScroll:true});}
}
const Press={at:0,select:null};
document.addEventListener("mousedown",e=>{
 hideTip();Press.at=Date.now();Press.select=null;
 const sel=e.target.closest?.("select");
 if(!sel||e.button!==0||sel.multiple||sel.disabled)return;
 // No system popup: the list opens on the click that follows; a second press on the same select closes it.
 e.preventDefault();sel.focus();
 if(Menus.owner===sel&&el(".menu-select"))closeMenus();else Press.select=sel;
},true);
addEventListener("click",e=>{
 const sel=e.target.closest?.("select");
 if(sel&&Press.select===sel){Press.select=null;return selectMenu(sel);}
 const field=e.target.closest?.("input[data-suggest]");if(field)suggest(field);
});

/* ---- suggestions while typing: <input data-suggest="id of a datalist"> ------------------------------------------ */
function suggest(input){
 const list=document.getElementById(input.dataset.suggest);if(!list||input.disabled||input.readOnly)return;
 const q=input.value.trim().toLowerCase(),values=[...new Set([...list.options].map(o=>o.value).filter(Boolean))];
 // An empty field shows everything when that is a short list; a value that is already one of them shows all to switch.
 const hits=!q?(values.length<=60?values:[]):values.some(v=>v.toLowerCase()===q)?values:values.filter(v=>v.toLowerCase().includes(q));
 if(!hits.length){if(Menus.owner===input)closeMenus();return;}
 const html=hits.slice(0,80).map(v=>'<button type="button" data-pick="'+esc(v)+'"'+(v===input.value?' class="on"':"")+'>'+svg("check",13)+'<span>'+esc(v)+'</span></button>').join("")+
  (hits.length>80?'<p class="menu-empty">还有 '+(hits.length-80)+' 个，接着输入缩小范围</p>':"");
 let menu=Menus.owner===input&&el(".menu-suggest");
 if(menu){menu.innerHTML=html;return;}
 menu=popMenu(input,html,{cls:"menu-select menu-suggest",width:input.offsetWidth});Menus.owner=input;
 menu.addEventListener("mousedown",e=>e.preventDefault());
 menu.addEventListener("click",e=>{
  const b=e.target.closest("[data-pick]");if(!b)return;closeMenus();
  input.value=b.dataset.pick;Menus.picking=true;
  try{input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));}finally{Menus.picking=false;}
 });
}
document.addEventListener("input",e=>{if(e.target.dataset?.suggest&&!Menus.picking)suggest(e.target);},true);
document.addEventListener("focusin",e=>{if(e.target.dataset?.suggest&&Date.now()-Press.at>400)suggest(e.target);});
document.addEventListener("focusout",e=>{
 const t=e.target;if(!t.dataset?.suggest||Menus.owner!==t)return;
 setTimeout(()=>{if(document.activeElement!==t&&Menus.owner===t)closeMenus();},0);
});

/* ---- the right-click menu ------------------------------------------------------------------------------------- */
const TEXT_INPUT=/^(text|search|url|email|password|number|tel)$/;
function fieldOf(t){
 const cm=t.closest?.(".cm-editor");if(cm)return cm;
 const f=t.closest?.("input,textarea,[contenteditable]");if(!f)return null;
 if(f.tagName==="INPUT")return TEXT_INPUT.test(f.type||"text")?f:null;
 return f.tagName==="TEXTAREA"||f.isContentEditable?f:null;
}
const cmOf=f=>f?.classList?.contains("cm-editor")?CV.EditorView.findFromDOM(f):null;
const plainField=f=>f&&(f.tagName==="INPUT"||f.tagName==="TEXTAREA");
function fieldSelection(f){
 const view=cmOf(f);
 if(view){const s=view.state.selection.main;return view.state.sliceDoc(s.from,s.to);}
 if(plainField(f))return f.value.slice(f.selectionStart??0,f.selectionEnd??0);
 return String(getSelection()?.toString()||"");
}
function fieldLocked(f){const view=cmOf(f);return view?view.state.readOnly:!!(f.readOnly||f.disabled);}
function fieldInsert(f,text){
 const view=cmOf(f);
 if(view){view.dispatch(view.state.replaceSelection(text));view.focus();return;}
 f.focus();document.execCommand(text?"insertText":"delete",false,text);
}
async function writeClipboard(text){
 try{await navigator.clipboard.writeText(text);}
 catch(_){const t=document.createElement("textarea");t.value=text;document.body.appendChild(t);t.select();document.execCommand("copy");t.remove();}
}
async function contextDo(kind,ctx){
 const f=ctx.field;
 if(kind==="copy"||kind==="cut"){await writeClipboard(ctx.text);if(kind==="cut")fieldInsert(f,"");return;}
 if(kind==="paste"){const text=await rpc("clipboard_text");if(text)fieldInsert(f,text);return;}
 if(kind==="all"){
  const view=cmOf(f);
  if(view){view.dispatch({selection:{anchor:0,head:view.state.doc.length}});view.focus();}
  else if(plainField(f)){f.focus();f.select();}
  else{f.focus();document.execCommand("selectAll");}
  return;
 }
 if(kind==="open")return ctx.link.dataset.wiki?ctx.link.click():openWeb(ctx.link.href||ctx.link.dataset.url,ctx.link.closest(".panel")?.dataset.pid);
 if(kind==="browser")return rpc("open_url",{url:ctx.link.href||ctx.link.dataset.url});
 if(kind==="link")return writeClipboard(ctx.link.href||ctx.link.dataset.url);
}
addEventListener("contextmenu",e=>{
 // The tab, workspace, note-tree and table menus handled it already; everywhere else the system menu never shows.
 if(e.defaultPrevented)return;
 e.preventDefault();hideTip();
 const t=e.target,field=fieldOf(t),text=fieldSelection(field),link=t.closest?.("a[href^='http'],a[data-wiki],a[data-action='open-web']");
 const row=(kind,icon,label,keys="",off=false)=>'<button type="button" data-ctx="'+kind+'"'+(off?" disabled":"")+'>'+svg(icon,14)+'<span>'+label+'</span>'+(keys?'<kbd>'+keys+'</kbd>':"")+'</button>';
 const parts=[];
 if(link)parts.push(link.dataset.wiki?row("open","document","打开「"+esc(shorten(link.dataset.wiki,24))+"」"):
  row("open","document","在 Lattice 里读")+row("browser","external","在浏览器里打开","Ctrl 点击")+row("link","link","复制链接地址"));
 if(field){
  const locked=fieldLocked(field);
  parts.push(row("cut","cut","剪切","Ctrl X",!text||locked)+row("copy","copy","复制","Ctrl C",!text)+row("paste","paste","粘贴","Ctrl V",locked)+row("all","selectall","全选","Ctrl A"));
 }else if(text.trim())parts.push(row("copy","copy","复制","Ctrl C"));
 if(text.trim()&&!t.closest?.(".composer")){
  Sel.text=text.slice(0,5000);Sel.el=plainField(field)?field:null;
  parts.push('<button type="button" data-action="ask-flash">'+svg("spark",14)+'<span>问快答</span></button><button type="button" data-action="ask-tutor">'+svg("bot",14)+'<span>问主会话</span></button>');
 }
 if(!parts.length)return closeMenus();
 const ctx={field,text,link},menu=popMenu({x:e.clientX,y:e.clientY},parts.join("<hr/>"),{cls:"menu-context"});
 // The field keeps its focus and selection while the menu is used.
 menu.addEventListener("mousedown",ev=>ev.preventDefault());
 menu.addEventListener("click",ev=>{const b=ev.target.closest("[data-ctx]");if(!b||b.disabled)return;closeMenus();safe(()=>contextDo(b.dataset.ctx,ctx));});
});

/* ---- the colour picker ---------------------------------------------------------------------------------------- */
function hexToHsv(hex){
 const n=parseInt(hex.slice(1),16),r=(n>>16&255)/255,g=(n>>8&255)/255,b=(n&255)/255,max=Math.max(r,g,b),d=max-Math.min(r,g,b);
 let hue=d===0?0:max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;hue*=60;if(hue<0)hue+=360;
 return [hue,max?d/max:0,max];
}
function hsvToHex(hue,s,v){
 const f=k=>{const x=(k+hue/60)%6;return Math.round(255*(v-v*s*Math.max(0,Math.min(x,4-x,1))));};
 return "#"+[f(5),f(3),f(1)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
/* A colour next to `anchor`: a saturation/brightness square, a hue bar, the hex value, and the colours of the theme
   in use. onInput gets each colour as it changes; onDone runs when the picker closes. */
function colorPicker(anchor,value,onInput,onDone){
 let [hue,sat,val]=hexToHsv(/^#[0-9a-f]{6}$/i.test(value||"")?value:"#888888"),frame=0,sent=value;
 const cs=getComputedStyle(document.documentElement);
 const tones=[...new Set(["bg","panel","surface","line","text","muted","accent","ai","amber","red","green"].map(k=>cs.getPropertyValue("--"+k).trim().toLowerCase()).filter(c=>/^#[0-9a-f]{6}$/.test(c)))];
 const menu=popMenu(anchor,'<div class="cp-sv"><i></i></div><div class="cp-hue"><i></i></div>'+
  '<div class="cp-row"><span class="cp-now"></span><input class="cp-hex" maxlength="7" spellcheck="false" aria-label="颜色值"/></div>'+
  (tones.length?'<div class="menu-label">现在主题里的颜色</div><div class="cp-tones">'+tones.map(c=>'<button type="button" data-tone="'+c+'" style="background:'+c+'" title="'+c+'"></button>').join("")+'</div>':""),
  {cls:"color-pop"});
 Menus.owner=anchor;
 const sv=menu.querySelector(".cp-sv"),bar=menu.querySelector(".cp-hue"),hex=menu.querySelector(".cp-hex"),now=menu.querySelector(".cp-now");
 const send=()=>{const c=hsvToHex(hue,sat,val);if(c===sent)return;sent=c;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>onInput(c));};
 const paint=typed=>{
  sv.style.setProperty("--hue","hsl("+hue+",100%,50%)");
  sv.firstElementChild.style.left=sat*100+"%";sv.firstElementChild.style.top=(1-val)*100+"%";bar.firstElementChild.style.left=hue/360*100+"%";
  const c=hsvToHex(hue,sat,val);now.style.background=c;if(!typed)hex.value=c;
 };
 const drag=(area,move)=>area.addEventListener("pointerdown",e=>{
  e.preventDefault();area.setPointerCapture(e.pointerId);
  const at=ev=>{const r=area.getBoundingClientRect();move(Math.min(1,Math.max(0,(ev.clientX-r.left)/r.width)),Math.min(1,Math.max(0,(ev.clientY-r.top)/r.height)));paint();send();};
  at(e);area.onpointermove=at;area.onpointerup=()=>{area.onpointermove=null;};
 });
 drag(sv,(x,y)=>{sat=x;val=1-y;});drag(bar,x=>{hue=x*360;});
 hex.addEventListener("input",()=>{const v="#"+hex.value.trim().replace(/^#/,"");if(/^#[0-9a-f]{6}$/i.test(v)){[hue,sat,val]=hexToHsv(v.toLowerCase());paint(true);send();}});
 hex.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();closeMenus();}});
 menu.addEventListener("click",e=>{const b=e.target.closest("[data-tone]");if(b){[hue,sat,val]=hexToHsv(b.dataset.tone);paint();send();}});
 paint();
 if(onDone){const watch=new MutationObserver(()=>{if(!menu.isConnected){watch.disconnect();onDone();}});watch.observe(document.body,{childList:true});}
}

/* ---- the file picker: folders and files on this computer, in a window like the others --------------------------- */
const Picker={last:{}};
const joinPath=(dir,name)=>dir.endsWith("/")?dir+name:dir+"/"+name;
function sizeText(n){return n<1024?n+" B":n<1048576?(n/1024).toFixed(n<10240?1:0)+" KB":(n/1048576).toFixed(1)+" MB";}
/* mode "dir" chooses a folder, "files" one or more files, "save" a folder and a file name (ext is added if left out).
   Resolves with the full path (an array for "files"), or null when cancelled. */
function pickPath({mode="dir",title="选择",ok="确定",hint="",name="",ext="",start=null}={}){
 return new Promise(done=>{
  const st={data:null,chosen:new Set(),hidden:false,result:null};
  const box=modal(modalHead(title)+(hint?'<p class="pk-hint">'+esc(hint)+'</p>':"")+
   '<div class="pk-bar"><button class="icon" type="button" data-pk="up" title="上一级">'+svg("arrowup",15)+'</button>'+
   '<input class="pk-path" spellcheck="false" aria-label="位置" placeholder="输入路径，回车打开"/>'+
   '<button class="chip toggle pk-hidden" type="button" data-pk="hidden">显示隐藏的</button></div>'+
   '<div class="pk-body"><nav class="pk-places"></nav><div class="pk-list"></div></div>'+
   '<div class="pk-foot">'+(mode==="save"?'<label class="pk-name">文件名<input class="pk-file" spellcheck="false" value="'+esc(name)+'"/></label>':'<span class="pk-info"></span>')+
   '<span class="grow"></span><button class="btn ghost" type="button" data-pk="cancel">取消</button><button class="btn primary" type="button" data-pk="ok">'+esc(ok)+'</button></div>',
   "large picker-modal");
  Modal.onClose=()=>done(st.result);
  const q=s=>box.querySelector(s),list=q(".pk-list"),okBtn=q('[data-pk="ok"]');
  const info=()=>{
   const n=st.chosen.size,line=q(".pk-info");
   if(mode==="files"){okBtn.disabled=!n;if(line)line.textContent=n?"选了 "+n+" 个文件":"点文件选中，可以多选；双击直接附上";}
   else if(mode==="dir"&&line)line.textContent=st.data?"选的是：「"+(baseName(st.data.path)||st.data.path)+"」":"";
  };
  const render=()=>{
   const d=st.data,vault=S.data?.vault;
   q(".pk-path").value=d.path;q('[data-pk="up"]').disabled=!d.parent;q(".pk-hidden").classList.toggle("on",st.hidden);
   q(".pk-places").innerHTML=[...d.places,...(vault?[{name:"学习库",path:vault}]:[])].map(p=>'<button type="button" data-place="'+esc(p.path)+'"'+(p.path===d.path?' class="on"':"")+'>'+
    svg(p.name==="学习库"?"book":p.name==="家目录"?"home":"folder",14)+'<span>'+esc(p.name)+'</span></button>').join("");
   list.innerHTML=d.entries.length?d.entries.map((e,i)=>'<button type="button" class="pk-item'+(e.dir?" dir":"")+(st.chosen.has(e.name)?" on":"")+'" data-entry="'+i+'"'+(mode==="dir"&&!e.dir?" disabled":"")+'>'+
    svg(e.dir?"folder":fileIcon(e.name),15)+'<span class="pk-n">'+esc(e.name)+'</span><small>'+(e.dir?"":sizeText(e.size))+'</small></button>').join("")+(d.more?'<p class="pk-empty">还有 '+d.more+' 项没列出来</p>':""):
    '<p class="pk-empty">这个文件夹是空的'+(st.hidden?"":"（隐藏的没显示）")+'</p>';
   list.scrollTop=0;info();
  };
  const go=async path=>{
   let d;
   try{d=await rpc("browse",{path,hidden:st.hidden});}
   catch(e){toast(e.message,"error");if(!st.data)go(null);return;}
   if(!box.isConnected)return;
   st.data=d;st.chosen.clear();Picker.last[mode]=d.path;render();
  };
  const finish=async()=>{
   const d=st.data;if(!d)return;
   if(mode==="dir")st.result=d.path;
   else if(mode==="files"){if(!st.chosen.size)return;st.result=[...st.chosen].map(n=>joinPath(d.path,n));}
   else{
    let n=q(".pk-file").value.trim();
    if(!n)return toast("写一个文件名","error");
    if(n.includes("/"))return toast("文件名里不能有 /；换文件夹请在左边或上面选","error");
    if(ext&&!n.toLowerCase().endsWith(ext))n+=ext;
    if(d.entries.some(e=>e.name===n&&e.dir))return toast("「"+n+"」是个文件夹","error");
    if(d.entries.some(e=>e.name===n)&&!await ask("这里已经有「"+n+"」了，要覆盖它吗？",{title:"覆盖文件",ok:"覆盖",danger:true}))return;
    st.result=joinPath(d.path,n);
   }
   closeModal();
  };
  box.addEventListener("click",e=>{
   const b=e.target.closest("[data-pk],[data-place],[data-entry]");if(!b||b.disabled)return;
   if(b.dataset.place)return go(b.dataset.place);
   if(b.dataset.entry){
    const it=st.data.entries[Number(b.dataset.entry)];
    if(it.dir)return go(joinPath(st.data.path,it.name));
    if(mode==="files"){st.chosen.has(it.name)?st.chosen.delete(it.name):st.chosen.add(it.name);b.classList.toggle("on");return info();}
    if(mode==="save")q(".pk-file").value=it.name;
    return;
   }
   const k=b.dataset.pk;
   if(k==="up")return st.data?.parent&&go(st.data.parent);
   if(k==="hidden"){st.hidden=!st.hidden;return go(st.data?.path);}
   if(k==="cancel")return closeModal();
   if(k==="ok")return safe(finish);
  });
  box.addEventListener("dblclick",e=>{
   const b=e.target.closest("[data-entry]");if(!b||mode!=="files")return;
   const it=st.data.entries[Number(b.dataset.entry)];if(it.dir)return;
   st.chosen=new Set([it.name]);safe(finish);
  });
  box.addEventListener("keydown",e=>{
   if(e.key!=="Enter"||e.isComposing)return;
   if(e.target.classList.contains("pk-path")){e.preventDefault();go(e.target.value.trim()||null);}
   else if(e.target.classList.contains("pk-file")){e.preventDefault();safe(finish);}
  });
  go(start||Picker.last[mode]||null).then(()=>{const f=q(".pk-file");if(f){f.focus();const dot=f.value.lastIndexOf(".");f.setSelectionRange(0,dot>0?dot:f.value.length);}});
 });
}
