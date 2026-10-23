"use strict";
/* What comes with a message, as tiles above the input (and in the message once sent): pictures as thumbnails, a long
   piece of pasted text as a card of its first lines, any other file by its name. Pasting a picture or a file, or a
   lot of text, or dropping files on the input, makes a tile instead of filling the box; every tile opens to be seen,
   and text to be edited in place. Everything attached is a file under data/附件/ in the vault. */
const IMAGE_FILE=/\.(png|jpe?g|gif|webp|svg)$/i,TEXT_FILE=/\.(md|txt|py|js|mjs|ts|json|csv|tsv|ya?ml|toml|ini|c|h|cc|cpp|hpp|rs|go|sh|tex|html?|css|log|sql)$/i;
const PASTE_CHARS=800,PASTE_LINES=15;
function attachKind(path){return IMAGE_FILE.test(path)?"image":TEXT_FILE.test(path)?"text":"file";}
const pastedName=path=>/^粘贴的文字/.test(baseName(path));
function attachTile(a,attrs,removable){
 const path=a.path,kind=attachKind(path),name=baseName(path);
 const body=kind==="image"?'<img data-vault-src="'+esc(path)+'" alt="'+esc(name)+'"/>':
  kind==="text"&&a.preview!=null?'<div class="att-text">'+esc(a.preview)+'</div>':
  '<div class="att-icon">'+svg(fileIcon(path),22)+'<small>'+esc((name.match(/\.([^.]+)$/)||[,"文件"])[1].toUpperCase())+'</small></div>';
 const label=pastedName(path)?"粘贴的文字"+(a.chars?" · "+a.chars.toLocaleString()+" 字":""):name;
 return '<div class="att-tile kind-'+kind+'" data-action="att-open" data-path="'+esc(path)+'" '+attrs+' data-tip="'+esc(path+"（点开看"+(kind==="text"?"、改":"")+"）")+'">'+body+
  '<span class="att-name">'+esc(label)+'</span>'+(removable?'<button class="att-x" '+removable+' title="不附上">'+svg("close",11)+'</button>':"")+'</div>';
}
function composerTiles(pid){
 const st=Chat[pid];if(!st?.attach.length)return "";
 return '<div class="att-row">'+st.attach.map((a,i)=>attachTile(a,'data-pid="'+pid+'"','data-action="chat-attach-remove" data-pid="'+pid+'" data-index="'+i+'"')).join("")+'</div>';
}
function messageTiles(paths){return paths?.length?'<div class="att-row in-msg">'+paths.map(p=>attachTile({path:p},"",null)).join("")+'</div>':"";}
function addAttachment(pid,item){const st=Chat[pid];if(!st||st.attach.some(x=>x.path===item.path))return;st.attach.push(item);updateComposer(pid);}
async function attachFiles(pid,files){
 for(const f of files){
  if(f.size>50*1024*1024){toast(f.name+" 超过 50MB","error");continue;}
  const data=await new Promise((ok,bad)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>bad(r.error);r.readAsDataURL(f);});
  const name=f.name||("粘贴的图片."+((f.type.split("/")[1]||"png").replace("jpeg","jpg")));
  const r=await safe(()=>rpc("attach_data",{name,data}));if(r)addAttachment(pid,{path:r.path});
 }
 refreshState();
}
async function attachText(pid,text){
 const r=await safe(()=>rpc("attach_text",{text}));if(!r)return;
 addAttachment(pid,{path:r.path,preview:text.split("\n").slice(0,8).join("\n").slice(0,400),chars:text.length});
}
document.addEventListener("paste",e=>{
 const t=e.target,pid=t?.dataset?.composer;if(!pid||!Chat[pid])return;
 const files=[...(e.clipboardData?.files||[])],text=e.clipboardData?.getData("text/plain")||"";
 if(files.length){e.preventDefault();safe(()=>attachFiles(pid,files));return;}
 if(text.length>=PASTE_CHARS||text.split("\n").length>=PASTE_LINES){e.preventDefault();safe(()=>attachText(pid,text));}
},true);
// Files dropped from outside on a conversation's input (not windows or notes dragged inside the program).
document.addEventListener("dragover",e=>{const c=e.target.closest?.(".composer");if(c&&e.dataTransfer?.types?.includes("Files")){e.preventDefault();c.classList.add("dropping");}},true);
document.addEventListener("dragleave",e=>{const c=e.target.closest?.(".composer");if(c&&!c.contains(e.relatedTarget))c.classList.remove("dropping");},true);
document.addEventListener("drop",e=>{
 const c=e.target.closest?.(".composer");if(!c||!e.dataTransfer?.files?.length)return;
 e.preventDefault();e.stopPropagation();c.classList.remove("dropping");
 const pid=c.closest(".panel")?.dataset.pid;if(pid&&Chat[pid])safe(()=>attachFiles(pid,[...e.dataTransfer.files]));
},true);
/* A tile opened: a picture large, text in an editor (saving writes the file; closing with changes saves them), any
   other file in a window of its own. */
async function openAttachment(path){
 const kind=attachKind(path);
 if(kind==="file")return openFile(path);
 if(kind==="image"){
  const box=modal(modalHead(baseName(path))+'<div class="att-view"><img data-vault-src="'+esc(path)+'" alt=""/></div>'+
   '<div class="modal-actions"><code class="att-path">'+esc(path)+'</code><span class="grow"></span>'+button(svg("float",13)+" 在窗口里打开","open-file",'data-path="'+esc(path)+'"',"ghost sm")+'</div>',"large att-pop");
  return hydrateVault(box);
 }
 const f=await safe(()=>rpc("file_read",{path}));if(!f)return;
 const box=modal(modalHead(pastedName(path)?"粘贴的文字":baseName(path))+'<div class="att-edit">'+editorHost(f.content||"",'class="editor prose"',{markdown:/\.md$/i.test(path)})+'</div>'+
  '<div class="modal-actions"><code class="att-path">'+esc(path)+'</code><span class="att-state"></span><span class="grow"></span>'+
  button(svg("float",13)+" 在窗口里打开","att-window","","ghost sm")+button(svg("check",13)+" 保存","att-save","disabled","primary sm")+'</div>',"large att-pop");
 mountEditors(box);
 const view=editorIn(box),now=()=>view.state.doc.toString();let saved=f.content||"",leaving=false;
 const mark=()=>{const dirty=now()!==saved;box.querySelector('[data-action="att-save"]').disabled=!dirty;box.querySelector(".att-state").textContent=dirty?"有没保存的修改，关掉时会自动保存":"";};
 const save=async()=>{const text=now();if(text===saved)return true;if(!await safe(()=>rpc("file_write",{path,content:text})))return false;saved=text;mark();tilesChanged(path,text);toast("已保存");return true;};
 view.dom.addEventListener("input",mark);view.dom.addEventListener("keyup",mark);
 box.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();e.stopPropagation();safe(save);}});
 box.addEventListener("click",e=>{const b=e.target.closest("[data-action^='att-']");if(!b||b.disabled)return;e.stopPropagation();
  if(b.dataset.action==="att-save")return safe(save);
  safe(async()=>{if(!await save())return;leaving=true;closeModal();openFile(path);});});
 Modal.onClose=()=>{let text=saved;try{text=now();}catch(_){}
  if(!leaving&&text!==saved)safe(()=>rpc("file_write",{path,content:text}).then(()=>{tilesChanged(path,text);toast("关掉前的修改已保存");}));destroyEditors(box);};
 setTimeout(()=>view.focus(),50);
}
// A pasted text changed in its editor: the tile above the input shows its new first lines.
function tilesChanged(path,text){
 tilePreviews.delete(path);
 for(const pid of Object.keys(Chat)){const a=Chat[pid].attach?.find(x=>x.path===path);if(a&&a.preview!=null){a.preview=text.split("\n").slice(0,8).join("\n").slice(0,400);a.chars=text.length;updateComposer(pid);}}
}
// Text tiles in sent messages show their first lines too, read once per file.
const tilePreviews=new Map();
function fillTextTiles(root){
 for(const t of all(".att-tile.kind-text",root)){
  if(t.querySelector(".att-text"))continue;const path=t.dataset.path;
  const show=text=>{const icon=t.querySelector(".att-icon");if(icon&&text!=null)icon.outerHTML='<div class="att-text">'+esc(text)+'</div>';};
  if(tilePreviews.has(path)){show(tilePreviews.get(path));continue;}
  rpc("file_read",{path}).then(f=>{const text=(f.content||"").split("\n").slice(0,8).join("\n").slice(0,400);tilePreviews.set(path,text);show(text);}).catch(()=>{});
 }
}
