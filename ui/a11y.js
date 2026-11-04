import {$t} from "./i18n.js";
import {saveLayout,activate,closePanel,findSplit} from "./dock.js";
import {tabMenu} from "./app.js";
import {all,el} from "./core.js";
import {setSideWidth,sideWidth} from "./side.js";
/* What a screen reader and the keyboard need, kept in one place. Panels are drawn from strings all over the interface, so
   roles and names are put on as elements arrive, not written at each of those places.
   F6 goes round the areas of the window; arrows move along tabs, and Enter opens one; Delete closes a tab; the menu key or
   Shift+F10 opens its menu, which also holds what dragging does; arrows on a divider move it. */
const FOCUSABLE='a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
const set=(node,attrs)=>{for(const [k,v] of Object.entries(attrs))if(node.getAttribute(k)!==String(v))node.setAttribute(k,v);};
const named=node=>node.getAttribute("title")||node.dataset.tip||"";
const RULES=[
 [".tabs",n=>set(n,{role:"tablist","aria-label":$t("这一组的标签")})],
 [".tab",n=>set(n,{role:"tab",tabindex:n.classList.contains("active")?0:-1,"aria-selected":n.classList.contains("active")})],
 // A button inside a tab has no place in the tab order: Delete and the tab's menu do the same.
 [".tab-btn",n=>set(n,{tabindex:-1,"aria-label":named(n)})],
 [".stack-body",n=>set(n,{role:"tabpanel"})],
 [".st-tabs",n=>set(n,{role:"tablist","aria-label":$t("工作状态")})],
 [".st-tab",n=>set(n,{role:"tab","aria-selected":n.classList.contains("on")})],
 [".menu:not(.menu-suggest)",n=>set(n,{role:"menu"})],
 [".menu:not(.menu-suggest) button",n=>set(n,{role:"menuitem"})],
 [".menu-suggest",n=>set(n,{role:"listbox"})],
 [".menu-suggest button",n=>set(n,{role:"option"})],
 [".gutter",n=>{const h=n.parentElement?.classList.contains("h");set(n,{role:"separator",tabindex:0,"aria-orientation":h?"vertical":"horizontal","aria-label":$t("调整两块的大小")});}],
 ["#side-gutter",n=>set(n,{role:"separator",tabindex:0,"aria-orientation":"vertical","aria-label":$t("调整左栏宽度")})],
 ["[data-action]:not(button,a,input,textarea,select,.tab)",n=>set(n,{role:n.getAttribute("role")||"button",tabindex:0})],
 ["button:not([aria-label])",n=>{if(!n.textContent.trim()&&named(n))set(n,{"aria-label":named(n)});}],
 ["input:not([aria-label]),textarea:not([aria-label])",n=>{if(!n.closest("label")&&(n.placeholder||named(n)))set(n,{"aria-label":n.placeholder||named(n)});}],
 [".modal,.dialog",n=>{const t=n.querySelector("h2,h3")?.textContent.trim();set(n,{"aria-label":t||$t("对话框")});}],
 [".chat-scroll",n=>set(n,{role:"log","aria-label":$t("对话")})],
 ["iframe:not([aria-label])",n=>set(n,{"aria-label":$t("嵌入的页面")})],
];
function decorate(root){
 for(const [selector,apply] of RULES){
  if(root.matches(selector))apply(root);
  root.querySelectorAll(selector).forEach(apply);
 }
}
// The editors change their own nodes with every keystroke; what they contain is theirs.
new MutationObserver(records=>{
 for(const r of records)for(const node of r.addedNodes)if(node.nodeType===1&&!node.closest(".cm-editor"))decorate(node);
}).observe(document.documentElement,{childList:true,subtree:true});

/* ---- going round the window --------------------------------------------------------------------------------------- */
function regions(){
 const shown=node=>node&&!node.hidden&&node.offsetParent!==null;
 const stacks=all(".stack").filter(shown).sort((a,b)=>Number(a.closest(".float")?1:0)-Number(b.closest(".float")?1:0));
 return [el("#activity"),el("#side"),...stacks,el("#status")].filter(shown);
}
function enter(region){
 const target=region.querySelector(".tab.active,.st-tab.on")||region.querySelector(FOCUSABLE);
 if(target)target.focus();
}
function nextRegion(back){
 const list=regions();if(!list.length)return;
 const at=list.findIndex(r=>r.contains(document.activeElement));
 enter(list[at<0?0:(at+(back?-1:1)+list.length)%list.length]);
}
function focusInside(pid){const panel=document.querySelector('.panel[data-pid="'+pid+'"]');(panel?.querySelector(".cm-content,"+FOCUSABLE))?.focus();}
function tabKeys(e,tab){
 const pid=tab.dataset.pid,tabs=all(".tab",tab.parentElement),at=tabs.indexOf(tab);
 const step={ArrowLeft:at-1,ArrowRight:at+1,Home:0,End:tabs.length-1}[e.key];
 if(step!==undefined){e.preventDefault();tabs[(step+tabs.length)%tabs.length].focus();return;}
 if(e.key==="Enter"||e.key===" "){e.preventDefault();activate(pid);focusInside(pid);return;}
 if(e.key==="Delete"){e.preventDefault();const left=tabs[at-1]?.dataset.pid||tabs[at+1]?.dataset.pid;closePanel(pid).then(()=>{decorate(document.body);document.querySelector('.tab[data-pid="'+left+'"]')?.focus();});return;}
 if(e.key==="ContextMenu"||e.key==="F10"&&e.shiftKey){e.preventDefault();tabMenu(pid,tab);document.querySelector(".menu button")?.focus();}
}
function spaceKeys(e,tab){
 const tabs=all(".st-tab"),at=tabs.indexOf(tab),step={ArrowLeft:at-1,ArrowRight:at+1,Home:0,End:tabs.length-1}[e.key];
 if(step!==undefined){e.preventDefault();tabs[(step+tabs.length)%tabs.length].focus();}
}
function gutterKeys(e,gutter){
 const across=gutter.getAttribute("aria-orientation")==="vertical",forward=across?"ArrowRight":"ArrowDown",back=across?"ArrowLeft":"ArrowUp";
 if(e.key!==forward&&e.key!==back)return;
 e.preventDefault();const by=e.key===forward?1:-1;
 if(gutter.id==="side-gutter")return setSideWidth(sideWidth()+by*16);
 const split=findSplit(gutter.dataset.split);if(!split)return;
 const i=+gutter.dataset.index,sum=split.sizes[i-1]+split.sizes[i],min=.08,a=Math.max(min,Math.min(sum-min,split.sizes[i-1]+by*.02));
 split.sizes[i-1]=a;split.sizes[i]=sum-a;
 // In place, as the mouse does it: drawing the windows again would take the focus off the divider.
 const cells=[...gutter.parentElement.children].filter(c=>!c.classList.contains("gutter"));
 cells[i-1].style.flex=a+" 1 0";cells[i].style.flex=sum-a+" 1 0";saveLayout();
}
function holdFocus(e){
 const box=[...document.querySelectorAll(".dialog,.modal")].pop();if(!box)return;
 const items=all(FOCUSABLE,box).filter(n=>n.offsetParent!==null);if(!items.length){e.preventDefault();return;}
 const first=items[0],last=items[items.length-1],inside=box.contains(document.activeElement);
 if(!inside||e.shiftKey&&document.activeElement===first){e.preventDefault();(e.shiftKey?last:first).focus();}
 else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
}
document.addEventListener("keydown",e=>{
 if(e.key==="F6"){e.preventDefault();return nextRegion(e.shiftKey);}
 if(e.key==="Tab")return holdFocus(e);
 const t=e.target;if(t.nodeType!==1)return;
 if(t.matches(".tab"))return tabKeys(e,t);
 if(t.matches(".st-tab"))return spaceKeys(e,t);
 if(t.matches(".gutter,#side-gutter"))return gutterKeys(e,t);
 // What is drawn as something else but acts as a button answers as one.
 if((e.key==="Enter"||e.key===" ")&&t.matches('[role="button"]')){e.preventDefault();t.click();}
});
decorate(document.documentElement);
