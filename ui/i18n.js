import EN from "./locales/en.js";
/* The interface's language. The Chinese text in the code is the key: in Chinese it is shown as it is, in another language
   it is looked up, so a string with no translation yet still shows. {0}, {1} stand for what is put into a sentence, so a
   translation can order them as its language needs.
   The language comes in the page's address, set by whoever loads it, so that text worked out as modules load has it too;
   changing it loads the page again. This module imports nothing else and so runs before everything that uses it. */
const CATALOGS={en:EN};
export const LANG=new URLSearchParams(location.search).get("lang")||"zh";
export const LOCALE=LANG==="zh"?"zh-CN":"en-US";
const catalog=CATALOGS[LANG]||{};
document.documentElement.lang=LOCALE;
/* The same Chinese word can need two words in another language ("应用": an app, and to apply a change); the context says
   which, and Chinese shows the word as it is. */
export function $p(context,text,...values){const key=context+"|"+text;return catalog[key]?$t(key,...values):$t(text,...values);}
export function $t(text,...values){
 const shown=catalog[text]||text;
 return values.length?shown.replace(/\{(\d+)\}/g,(whole,i)=>i in values?values[i]:whole):shown;
}
