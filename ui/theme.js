import {$t,$p} from "./i18n.js";
import {S,all,button,el,esc,toast} from "./core.js";
import {renderSettings} from "./panels.js";
import {colorPicker} from "./popups.js";
import {applyUi,saveUi} from "./app.js";
/* Themes: colours and style that the learner or the AI can change. A theme starts from the dark or the light look and
   overrides some of its colour variables, its fonts, and if it wants, adds a little CSS (corners, shadows, spacing).
   Themes are kept by name in the interface settings; one of them, or none, is in use. Nothing in a theme can load
   anything from outside: no url(), no @import. */
const THEME_VARS={
 bg:$t("整个窗口的底色"),panel:$t("面板底色"),"panel-hi":$t("弹窗、输入框的底色"),surface:$t("卡片、按钮的底色"),"surface-hover":$t("鼠标移上去的底色"),
 line:$t("边框"),  "line-soft":$t("浅边框"),text:$t("正文文字"),muted:$t("次要文字"),subtle:$t("最淡的文字"),
 accent:$t("强调色（按钮、链接、选中）"),"accent-ink":$t("强调色上的文字"),"accent-glow":$t("强调色的浅底"),ai:$t("AI 的颜色"),"ai-glow":$t("AI 颜色的浅底"),
 amber:$t("提醒（黄）"),red:$t("错误（红）"),green:$t("成功（绿）"),"code-bg":$t("代码块底色"),"code-text":$t("代码文字"),"select-bg":$t("选中文字的底色"),"active-line":$t("编辑器当前行"),
 "tk-kw":$t("代码：关键字"),"tk-str":$t("代码：字符串"),"tk-num":$t("代码：数字"),"tk-com":$t("代码：注释"),"tk-fn":$t("代码：函数"),"tk-type":$t("代码：类型"),"tk-prop":$t("代码：属性"),"tk-op":$t("代码：符号"),"tk-tag":$t("代码：标签"),
 rb0:$t("彩虹括号第一层"),rb1:$t("彩虹括号第二层"),rb2:$t("彩虹括号第三层"),shadow:$t("阴影（完整的 box-shadow，如 0 18px 50px rgba(0,0,0,.3)）"),"pop-shadow":$t("弹出层阴影（同上）"),veil:$t("弹窗背后的遮罩"),
};
const COLOR_OK=/^[#\w\s(),.%+\-\/]{1,160}$/,FONT_OK=/^[\w\s",'\-一-鿿]{1,200}$/;
function cleanCss(css){
 const text=String(css||"").slice(0,20000);
 if(/url\s*\(|@import|expression\s*\(|<\/?style|javascript:/i.test(text))throw new Error($t("主题的 CSS 不能引用外部资源（url()、@import）"));
 return text;
}
/* A theme as stored: only known variables, colour-like values, plain font names, CSS without outside references. */
function cleanTheme(t){
 const vars={};
 for(const [k,v] of Object.entries(t.vars||{})){
  const key=String(k).replace(/^--/,"");
  if(!THEME_VARS[key])throw new Error($t("没有这个颜色变量：{0}；能改的有",k)+" "+Object.keys(THEME_VARS).join("、"));
  if(!COLOR_OK.test(String(v))||/url\s*\(/i.test(v))throw new Error($t("颜色值不对：{0} =",key)+" "+v);
  vars[key]=String(v).trim();
  // A shadow given as just a colour becomes a soft shadow in that colour.
  if(/shadow$/.test(key)&&!/\d+px/.test(vars[key]))vars[key]="0 18px 50px "+vars[key];
 }
 for(const k of ["font","mono"])if(t[k]&&!FONT_OK.test(String(t[k])))throw new Error($t("字体名只能是字体的名字：")+t[k]);
 return {base:t.base==="light"?"light":"dark",vars,font:t.font?String(t.font):"",mono:t.mono?String(t.mono):"",css:cleanCss(t.css),note:String(t.note||"").slice(0,200)};
}
export function activeTheme(){const n=S.ui.theme_custom;return n&&S.ui.themes?.[n]?{name:n,...S.ui.themes[n]}:null;}
export function applyTheme(){
 let tag=el("#theme-css");if(!tag){tag=document.createElement("style");tag.id="theme-css";document.head.appendChild(tag);}
 const t=activeTheme();
 if(!t){tag.textContent="";return;}
 const decl=Object.entries(t.vars).map(([k,v])=>"--"+k+":"+v+";").join("")+(t.font?"--sans:"+t.font+";":"")+(t.mono?"--mono:"+t.mono+";":"");
 // Beats both built-in looks: :root and :root[data-theme="light"].
 tag.textContent="html:root[data-theme]{"+decl+"}\n"+(t.css||"");
}
/* Contrast, so an AI can tell when its colours make text hard to read (WCAG: 4.5 for body text). */
function luminance(color){
 const probe=document.createElement("i");probe.style.color=color;document.body.appendChild(probe);
 const m=getComputedStyle(probe).color.match(/[\d.]+/g);probe.remove();if(!m)return null;
 const [r,g,b]=m.slice(0,3).map(x=>{x=Number(x)/255;return x<=.03928?x/12.92:((x+.055)/1.055)**2.4;});
 return .2126*r+.7152*g+.0722*b;
}
function contrast(a,b){const x=luminance(a),y=luminance(b);if(x==null||y==null)return null;return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function themeWarnings(){
 const cs=getComputedStyle(document.documentElement),v=k=>cs.getPropertyValue("--"+k).trim(),out=[];
 for(const [fg,bg,need] of [["text","bg",4.5],["text","panel",4.5],["muted","panel",3],["accent-ink","accent",4.5],["code-text","code-bg",4.5]]){
  const c=contrast(v(fg),v(bg));if(c!=null&&c<need)out.push(fg+" "+$t("在 {0} 上的对比度只有 {1}（至少要",bg,c.toFixed(1))+" "+need+"）");
 }
 return out;
}
/* The ui tool's theme operation. */
export function themeOp(op){
 const themes={...(S.ui.themes||{})};
 if(op.delete){delete themes[op.name];S.ui.themes=themes;if(S.ui.theme_custom===op.name)S.ui.theme_custom=null;applyUi();saveUi();return {ok:true,deleted:op.name};}
 if(!op.name||[$t("默认"),"default","none"].includes(op.name)){S.ui.theme_custom=null;if(op.base)S.ui.theme=op.base==="light"?"light":"dark";applyUi();saveUi();return {ok:true,theme:$t("默认（")+(S.ui.theme==="light"?$t("浅色"):$t("深色"))+"）"};}
 const name=String(op.name).slice(0,40),old=themes[name]||{};
 const next=cleanTheme({base:op.base||old.base||S.ui.theme,vars:op.replace?op.vars||{}:{...(old.vars||{}),...(op.vars||{})},font:op.font??old.font,mono:op.mono??old.mono,
  css:op.css??old.css,note:op.note??old.note});
 themes[name]=next;S.ui.themes=themes;
 if(op.apply!==false){S.ui.theme_custom=name;S.ui.theme=next.base;}
 applyUi();saveUi();
 const warnings=op.apply!==false?themeWarnings():[];
 return {ok:true,theme:name,applied:op.apply!==false,...(warnings.length?{warnings}:{})};
}
/* Settings: the themes kept, and the main colours of the one in use. */
export function themeSettings(){
 const u=S.ui,names=Object.keys(u.themes||{}),t=activeTheme(),cs=getComputedStyle(document.documentElement);
 const hex=k=>{const c=cs.getPropertyValue("--"+k).trim();return /^#[0-9a-f]{6}$/i.test(c)?c:"#888888";};
 return "<h3>"+$p("外观","主题")+"</h3><p class=\"muted\">"+$t("颜色和风格都能改，也可以直接跟 AI 说「换个暖一点的配色」「做一个护眼的主题」，它会设计好套上；不满意就点它回复下的「还原界面」，或者在这里换回去。")+"</p><div class=\"theme-list\">"+[["",$t("默认")]].concat(names.map(n=>[n,n])).map(([n,l])=>'<div class="theme-item'+((u.theme_custom||"")===n?" on":"")+'">'+
   '<span class="theme-swatch" style="'+(n?themeSwatch(u.themes[n]):"")+'"></span><b>'+esc(l)+'</b>'+(n&&u.themes[n].note?'<small>'+esc(u.themes[n].note)+'</small>':"")+'<span class="grow"></span>'+
   ((u.theme_custom||"")===n?"<span class=\"chip on\">"+$t("在用")+"</span>":button($t("用这个"),"theme-use",'data-name="'+esc(n)+'"',"ghost xs"))+
   (n?button($t("删除"),"theme-delete",'data-name="'+esc(n)+'"',"ghost xs"):"")+'</div>').join("")+"</div><div class=\"field-label\">"+(t?$t("改「{0}」的主要颜色",esc(t.name)):$t("改主要颜色（会存成「我的主题」）"))+"</div><div class=\"theme-colors\">"+["bg","panel","surface","text","muted","accent","ai","line"].map(k=>'<button class="color-pick" data-action="theme-color" data-color-var="'+k+'" data-value="'+hex(k)+'"><i class="swatch" style="background:'+hex(k)+'"></i><span>'+esc(THEME_VARS[k])+'</span></button>').join("")+"</div>";
}
function themeSwatch(t){const v=t.vars||{};return "background:linear-gradient(135deg,"+(v.bg||(t.base==="light"?"#f3f4ef":"#0d1117"))+" 50%,"+(v.accent||(t.base==="light"?"#1b7868":"#8bdcc5"))+" 50%)";}
/* A colour swatch in settings opens the colour picker; each change is applied at once and kept in the theme in use. */
export function themeColorPick(button){
 const key=button.dataset.colorVar,was=S.ui.theme_custom,panel=button.closest(".panel");
 colorPicker(button,button.dataset.value,value=>{
  const name=S.ui.theme_custom||$t("我的主题");
  try{themeOp({name,vars:{[key]:value},note:S.ui.themes?.[name]?.note||$t("在设置里调的")});}catch(e){return toast(e.message,"error");}
  all('[data-color-var="'+key+'"]').forEach(b=>{b.dataset.value=value;b.querySelector(".swatch").style.background=value;});
 // The first change makes 「我的主题」: the list above shows it once the picker closes.
 },()=>{if(S.ui.theme_custom!==was&&panel?.isConnected)renderSettings(panel,"look");});
}
