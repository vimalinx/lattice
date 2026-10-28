"use strict";
/* ChatGPT's interactive widgets, run here. An answer can carry a small interface written in markup: layout tags (box,
   row, grid, text…), controls (segmented-control, slider, button…), inline SVG, {expressions}, {#each}/{#if} blocks
   and {@body …} statements whose DIL.useState() holds the widget's state. The markup is parsed once and compiled to
   a function that builds the tree; each change of state builds it again. This page is its own site in a sandboxed
   frame (see lattice/appscheme.py), which is why it may compile code: the program's own page may not. The source
   comes from the page that frames it, and the frame's height is sent back as it changes. */

// ---- the look Lattice is in, from the query (?theme=…&look=…) ----------------------------------------------------
(() => {
 const q = new URLSearchParams(location.search), root = document.documentElement;
 root.dataset.theme = q.get("theme") === "light" ? "light" : "dark";
 try { for (const [k, v] of Object.entries(JSON.parse(q.get("look") || "{}"))) if (/^[\w-]+$/.test(k) && !/[;{}<>]/.test(v)) root.style.setProperty("--" + k, v); } catch (e) {}
})();

// ---- parsing -------------------------------------------------------------------------------------------------------
// Nodes: {t:"text",parts:[string|{expr}]}, {t:"el",name,attrs:[[name,value]],kids} (value: {s} a string, {e} an
// expression, true a bare flag), {t:"each",expr,item,index,kids}, {t:"if",arms:[[cond|null,kids]]}, {t:"body",code}.
function parse(src) {
 let i = 0;
 const fail = what => { throw new Error(what + "（第 " + (src.slice(0, i).split("\n").length) + " 行）"); };
 // A {…} from i (at "{"): its inside, braces and strings inside it accounted for.
 function braced() {
  let depth = 0, start = i + 1, quote = null;
  for (; i < src.length; i++) {
   const c = src[i];
   if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
   if (c === '"' || c === "'" || c === "`") quote = c;
   else if (c === "{") depth++;
   else if (c === "}" && --depth === 0) { i++; return src.slice(start, i - 1); }
  }
  fail("花括号没有配对");
 }
 function attrs() {
  const out = [];
  for (;;) {
   while (/\s/.test(src[i])) i++;
   if (src[i] === "/" || src[i] === ">" || i >= src.length) return out;
   const m = /^[\w:.@-]+/.exec(src.slice(i));
   if (!m) fail("属性写法不对");
   i += m[0].length;
   while (/\s/.test(src[i])) i++;
   if (src[i] !== "=") { out.push([m[0], true]); continue; }
   i++;
   while (/\s/.test(src[i])) i++;
   if (src[i] === '"' || src[i] === "'") { const q = src[i], end = src.indexOf(q, i + 1); out.push([m[0], { s: src.slice(i + 1, end) }]); i = end + 1; }
   else if (src[i] === "{") out.push([m[0], { e: braced() }]);
   else { const v = /^[^\s/>]+/.exec(src.slice(i))[0]; out.push([m[0], { s: v }]); i += v.length; }
  }
 }
 // Nodes up to a closing tag (closer: its name) or the end of a block (one of the stops: "/each", ":else", "/if"…).
 function nodes(closer, stops) {
  const out = [];
  let text = [];
  const flush = () => { if (text.length) { out.push({ t: "text", parts: text }); text = []; } };
  // Text next to text is one piece, so **strong \(maths\)** is read as a whole.
  const add = t => { if (typeof text[text.length - 1] === "string") text[text.length - 1] += t; else text.push(t); };
  while (i < src.length) {
   if (src.startsWith("</", i)) {
    const end = src.indexOf(">", i), name = src.slice(i + 2, end).trim();
    if (name !== closer) fail("</" + name + "> 前面少了它的开头");
    i = end + 1; flush(); return out;
   }
   if (src[i] === "<" && /[A-Za-z]/.test(src[i + 1] || "")) {
    flush();
    const name = /^<([\w:.-]+)/.exec(src.slice(i))[1];
    i += name.length + 1;
    const a = attrs();
    if (src.startsWith("/>", i)) { i += 2; out.push({ t: "el", name, attrs: a, kids: [] }); continue; }
    i++;
    out.push({ t: "el", name, attrs: a, kids: nodes(name, null) });
    continue;
   }
   if (src[i] === "{") {
    const at = i, inner = braced().trim();
    if (stops && stops.some(s => inner.startsWith(s))) { i = at; flush(); return out; }
    if (inner.startsWith("#each")) {
     flush();
     const m = /^#each\s+([\s\S]+?)\s+as\s+([\s\S]+?)(?:\s*,\s*(\w+))?\s*$/.exec(inner);
     if (!m) fail("{#each} 写法不对");
     const kids = nodes(null, ["/each"]); braced();
     out.push({ t: "each", expr: m[1], item: m[2], index: m[3], kids });
    } else if (inner.startsWith("#if")) {
     flush();
     const arms = [[inner.slice(3).trim(), nodes(null, [":else", "/if"])]];
     for (;;) {
      const next = (braced() || "").trim();
      if (next.startsWith("/if")) break;
      if (next.startsWith(":else if")) arms.push([next.slice(8).trim(), nodes(null, [":else", "/if"])]);
      else if (next.startsWith(":else")) arms.push([null, nodes(null, ["/if"])]);
      else fail("{#if} 没有结尾");
     }
     out.push({ t: "if", arms });
    } else if (inner.startsWith("@body") || inner.startsWith("@const")) {
     flush(); out.push({ t: "body", code: inner.replace(/^@(body|const)/, inner.startsWith("@const") ? "const" : "").trim() });
    } else if (!inner.startsWith("/") && !inner.startsWith(":")) text.push({ e: inner });
    else fail("多出来的 {" + inner + "}");
    continue;
   }
   // Maths in the text (\(…\), \[…\], $…$) is text: its braces are TeX's, not expressions.
   const math = /^(\\\(|\\\[|\$\$?)/.exec(src.slice(i));
   if (math) {
    const closer = { "\\(": "\\)", "\\[": "\\]", "$": "$", "$$": "$$" }[math[1]], end = src.indexOf(closer, i + math[1].length);
    if (end > 0 && !src.slice(i, end).includes("\n\n")) { add(src.slice(i, end + closer.length)); i = end + closer.length; continue; }
   }
   const next = src.slice(i + 1).search(/[<{\\$]/), chunk = next < 0 ? src.slice(i) : src.slice(i, i + 1 + next);
   add(chunk);
   i += chunk.length;
  }
  if (closer) fail("<" + closer + "> 没有结尾");
  flush(); return out;
 }
 return nodes(null, null);
}

// ---- compiling: the tree as a function that builds it ------------------------------------------------------------
function compile(tree) {
 let n = 0;
 const gen = (list, into) => list.map(node => {
  if (node.t === "body") return node.code + ";\n";
  if (node.t === "text") return node.parts.map(p => typeof p === "string" ? into + ".push(" + JSON.stringify(p) + ");\n" : into + ".push((" + p.e + "));\n").join("");
  if (node.t === "each") {
   const index = node.index || "__i" + (n++);
   return "for (const [" + index + ", " + node.item + "] of Array.from((" + node.expr + ") || []).entries()) {\n" + gen(node.kids, into) + "}\n";
  }
  if (node.t === "if") return node.arms.map(([cond, kids], k) => (k ? " else " : "") + (cond === null ? "" : "if (" + cond + ") ") + "{\n" + gen(kids, into) + "}").join("") + "\n";
  const v = "__n" + (n++);
  const props = node.attrs.map(([k, val]) => JSON.stringify(k) + ": " + (val === true ? "true" : "s" in val ? JSON.stringify(val.s) : "(" + val.e + ")")).join(", ");
  return "const " + v + " = {name: " + JSON.stringify(node.name) + ", props: {" + props + "}, kids: []};\n" + into + ".push(" + v + ");\n{\n" + gen(node.kids, v + ".kids") + "}\n";
 }).join("");
 return new Function("DIL", "const __root = [];\n" + gen(tree, "__root") + "return __root;");
}

// ---- state ---------------------------------------------------------------------------------------------------------
const hooks = [], effects = [];
let hookAt = 0, scheduled = false, render = null;
// Changes made together (one handler setting several states) are drawn once, right after the handler.
function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; draw(); }); } }
const DIL = new Proxy({
 useState(initial) {
  const at = hookAt++;
  if (!(at in hooks)) hooks[at] = typeof initial === "function" ? initial() : initial;
  return [hooks[at], value => { hooks[at] = typeof value === "function" ? value(hooks[at]) : value; schedule(); }];
 },
 useMemo(fn) { hookAt++; return fn(); },
 useRef(initial) { const at = hookAt++; if (!(at in hooks)) hooks[at] = { current: initial }; return hooks[at]; },
 useEffect(fn) { hookAt++; effects.push(fn); },
}, { get: (o, k) => k in o ? o[k] : () => undefined });

// ---- drawing -------------------------------------------------------------------------------------------------------
const SVG = "http://www.w3.org/2000/svg";
// SVG attributes that keep their capitals; the rest are written as attributes are (strokeWidth -> stroke-width).
const CAMEL = new Set(["viewBox", "preserveAspectRatio", "gradientTransform", "gradientUnits", "patternUnits", "patternTransform", "patternContentUnits",
 "markerWidth", "markerHeight", "markerUnits", "refX", "refY", "pathLength", "textLength", "lengthAdjust", "stdDeviation", "baseFrequency", "numOctaves",
 "clipPathUnits", "maskUnits", "maskContentUnits", "spreadMethod", "startOffset", "attributeName", "repeatCount", "keyTimes", "keySplines", "calcMode",
 "filterUnits", "primitiveUnits", "tableValues", "kernelMatrix", "diffuseConstant", "specularConstant", "specularExponent", "surfaceScale"]);
const SPACE = { 0: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
const space = v => v === undefined ? null : (typeof v === "number" ? v * 4 : SPACE[v] ?? (parseFloat(v) * 4 || 0)) + "px";
const SIZE = { xs: 12, sm: 13.5, md: 15, lg: 17, xl: 20, "2xl": 24, "3xl": 30 };
const WEIGHT = { regular: 400, normal: 400, medium: 500, semibold: 600, bold: 700 };
const COLOR = { default: "var(--text)", primary: "var(--text)", secondary: "var(--muted)", tertiary: "var(--subtle)", accent: "var(--accent)",
 success: "var(--green)", danger: "var(--red)", error: "var(--red)", warning: "var(--amber)", info: "var(--ai)" };
const BACKGROUND = { surface: "var(--panel)", "surface-secondary": "var(--surface)", "surface-tertiary": "var(--surface-hover)", accent: "var(--accent-glow)" };
const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch", baseline: "baseline" };
const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around", evenly: "space-evenly" };
const RADIUS = { none: 0, sm: 6, md: 8, lg: 12, xl: 16, full: 999 };

function layout(el, p, dir) {
 Object.assign(el.style, { display: "flex", flexDirection: dir, gap: space(p.gap) || (dir === "row" ? "8px" : "0"), padding: space(p.padding),
  alignItems: ALIGN[p.align] || (dir === "row" ? "center" : ""), justifyContent: JUSTIFY[p.justify] || "", flexWrap: p.wrap ? "wrap" : "",
  borderRadius: p.radius !== undefined ? (RADIUS[p.radius] ?? p.radius) + "px" : "", background: BACKGROUND[p.background] || p.background || "",
  height: p.height ?? "", width: p.width ?? "", flex: p.flex ?? "" });
 if (p.border) el.style.border = typeof p.border === "object" ? (p.border.size ?? 1) + "px solid " + (COLOR[p.border.color] || p.border.color || "var(--line)") : "1px solid var(--line)";
}
function typeset(el, p, size, weight, color) {
 Object.assign(el.style, { fontSize: (SIZE[p.size] || SIZE[size]) + "px", fontWeight: WEIGHT[p.weight] || weight || "", color: COLOR[p.color] || p.color || COLOR[color] || "",
  textAlign: p.align || "", fontVariantNumeric: p.tabularNums ? "tabular-nums" : "" });
}
const call = (fn, ...args) => { if (typeof fn === "function") fn(...args); };
// A listener that calls whatever handler the latest drawing gave the element (see morph): a handler closes over the
// state of the drawing that made it.
function on(el, type, fn) {
 (el.__h ||= {})[type] = fn;
 (el.__on ||= new Set());
 if (!el.__on.has(type)) { el.__on.add(type); el.addEventListener(type, e => el.__h?.[type]?.(e)); }
}
const options = p => (Array.isArray(p.options) ? p.options : []).map(o => typeof o === "object" ? o : { label: String(o), value: o });

/* Text in a widget is Markdown in a line: **strong**, *em*, `code`, and maths, drawn by KaTeX as in Lattice. */
const MATH = /\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;
const escape = t => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function tex(src, display) {
 try { return window.katex ? katex.renderToString(src, { displayMode: display, throwOnError: false, strict: "ignore", output: "html" }) : "<code>" + escape(src) + "</code>"; }
 catch (e) { return "<code>" + escape(src) + "</code>"; }
}
function rich(text) {
 // The maths is set aside first, so **strong \(M_t\)** is strong around its formula.
 const maths = [];
 const marked = text.replace(MATH, (m, a, b, c, d) => { maths.push(tex(a ?? b ?? c ?? d, a !== undefined || b !== undefined)); return "\u0000" + (maths.length - 1) + "\u0000"; });
 return inline(marked).replace(/\u0000(\d+)\u0000/g, (m, k) => maths[+k]);
}
const inline = t => escape(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
const ICONS = { "arrow-down": "M12 5v14m-6-6 6 6 6-6", "arrow-up": "M12 19V5m-6 6 6-6 6 6", "arrow-right": "M5 12h14m-6-6 6 6-6 6", "arrow-left": "M19 12H5m6-6-6 6 6 6",
 check: "m5 12 4 4L19 6", x: "M6 6l12 12M18 6 6 18", close: "M6 6l12 12M18 6 6 18", plus: "M12 5v14M5 12h14", minus: "M5 12h14", "chevron-down": "m6 9 6 6 6-6",
 "chevron-right": "m9 6 6 6-6 6", "chevron-up": "m6 15 6-6 6 6", "chevron-left": "m15 6-6 6 6 6", info: "M12 11v6m0-10h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" };

function build(node, svg) {
 if (node === null || node === undefined || node === false || node === true) return null;
 if (typeof node !== "object") {
  const t = String(node);
  if (svg || !/[*`$\\]/.test(t)) return document.createTextNode(t);
  const span = document.createElement("span"); span.innerHTML = rich(t); return span;
 }
 if (Array.isArray(node)) { const f = document.createDocumentFragment(); node.forEach(x => { const c = build(x, svg); if (c) f.append(c); }); return f; }
 const { name, props: p, kids } = node, inSvg = svg || name === "svg";
 const children = el => kids.forEach(k => { const c = build(k, inSvg); if (c) el.append(c); });
 if (inSvg) {
  const el = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(p)) {
   if (v === undefined || v === null || v === false) continue;
   if (/^on[A-Z]/.test(k) && typeof v === "function") { on(el, k.slice(2).toLowerCase(), v); continue; }
   const attr = k === "className" ? "class" : k === "xlinkHref" ? "href" : CAMEL.has(k) ? k : k.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
   el.setAttribute(attr, k === "style" && typeof v === "object" ? Object.entries(v).map(([a, b]) => a.replace(/[A-Z]/g, c => "-" + c.toLowerCase()) + ":" + b).join(";") : String(v));
  }
  if (name === "svg") { el.classList.add("dw-svg"); if (!p.width && !p.style) el.setAttribute("width", "100%"); }
  children(el); return el;
 }
 let el;
 switch (name) {
  case "box": case "column": case "col": case "stack": case "card": el = document.createElement("div"); layout(el, p, "column"); if (name === "card") el.classList.add("dw-card"); break;
  case "row": el = document.createElement("div"); layout(el, p, "row"); break;
  case "grid":
   el = document.createElement("div");
   Object.assign(el.style, { display: "grid", gap: space(p.gap) || "8px", gridTemplateColumns: typeof p.columns === "number" ? "repeat(" + p.columns + ", minmax(0, 1fr))" : p.columns || "" });
   el.classList.add("dw-grid"); break;
  case "grid-item": el = document.createElement("div"); el.style.minWidth = "0"; if (p.span) el.style.gridColumn = "span " + p.span; break;
  case "text": case "paragraph": el = document.createElement("div"); typeset(el, p, "sm"); break;
  case "title": case "heading": el = document.createElement("div"); typeset(el, p, "lg", 600); break;
  case "caption": el = document.createElement("div"); typeset(el, p, "xs", null, "secondary"); break;
  case "label": el = document.createElement("label"); typeset(el, p, "xs", 500, "secondary"); break;
  case "code": el = document.createElement("code"); break;
  case "math": { el = document.createElement("div"); el.className = "dw-math"; el.innerHTML = tex(String(p.value ?? p.tex ?? ""), p.inline ? false : true); return el; }
  case "icon": {
   el = document.createElementNS(SVG, "svg"); el.setAttribute("viewBox", "0 0 24 24"); el.setAttribute("class", "dw-icon");
   const size = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 }[p.size] || 16;
   el.setAttribute("width", size); el.setAttribute("height", size); el.style.color = COLOR[p.color] || p.color || "";
   const path = document.createElementNS(SVG, "path"); path.setAttribute("d", ICONS[p.name] || "M12 12h.01"); el.append(path); return el;
  }
  case "divider": case "separator": return document.createElement("hr");
  case "spacer": el = document.createElement("div"); el.style.flex = "1"; break;
  case "badge": case "chip": case "tag": el = document.createElement("span"); el.className = "dw-badge"; typeset(el, p, "xs", 500); break;
  case "image": case "img": el = document.createElement("img"); el.src = p.src || ""; el.alt = p.alt || ""; el.style.maxWidth = "100%"; return el;
  case "segmented-control": case "segmented": case "tabs": {
   el = document.createElement("div"); el.className = "dw-seg" + (p.block ? " block" : "");
   for (const o of options(p)) {
    const b = document.createElement("button"); b.textContent = o.label ?? o.value;
    if (String(o.value) === String(p.value)) b.classList.add("on");
    on(b, "click", () => call(p.onChange, o.value)); el.append(b);
   }
   return el;
  }
  case "slider": case "range": {
   el = document.createElement("div"); el.className = "dw-slider";
   const input = document.createElement("input"); input.type = "range";
   for (const k of ["min", "max", "step"]) if (p[k] !== undefined) input[k] = p[k];
   input.value = p.value ?? 0;
   on(input, "input", () => call(p.onChange, Number(input.value)));
   if (p.label) { const l = document.createElement("span"); l.textContent = p.label; el.append(l); }
   el.append(input);
   if (p.showValue !== false) { const out = document.createElement("output"); out.textContent = p.value ?? ""; el.append(out); }
   return el;
  }
  case "button": {
   el = document.createElement("button"); el.className = "dw-button" + (p.variant === "primary" || p.primary ? " primary" : "");
   if (p.label) el.textContent = p.label;
   on(el, "click", () => call(p.onClick ?? p.onPress)); el.disabled = !!p.disabled; break;
  }
  case "switch": case "toggle": case "checkbox": {
   el = document.createElement("label"); el.className = "dw-check";
   const input = document.createElement("input"); input.type = "checkbox"; input.checked = !!(p.checked ?? p.value);
   on(input, "change", () => call(p.onChange, input.checked));
   el.append(input); if (p.label) el.append(" " + p.label); break;
  }
  case "select": {
   el = document.createElement("select");
   for (const o of options(p)) { const op = document.createElement("option"); op.value = String(o.value); op.textContent = o.label ?? o.value; el.append(op); }
   el.value = String(p.value ?? ""); on(el, "change", () => { const o = options(p).find(x => String(x.value) === el.value); call(p.onChange, o ? o.value : el.value); });
   return el;
  }
  case "input": case "text-input": case "number-input": case "textfield": {
   el = document.createElement("input"); el.type = name === "number-input" || p.type === "number" ? "number" : "text"; el.value = p.value ?? "";
   if (p.placeholder) el.placeholder = p.placeholder;
   on(el, "input", () => call(p.onChange, el.type === "number" ? Number(el.value) : el.value)); return el;
  }
  default: el = document.createElement("div");
 }
 children(el);
 return el;
}

/* A new drawing laid over the one on show, changing only what differs: a control being used (a slider dragged, a field
   typed in) stays the same element, so it is not interrupted. */
function morph(old, fresh) {
 if (old.nodeType !== fresh.nodeType || old.nodeName !== fresh.nodeName || old.namespaceURI !== fresh.namespaceURI) { old.replaceWith(fresh); return; }
 if (old.nodeType === 3) { if (old.data !== fresh.data) old.data = fresh.data; return; }
 for (const a of [...old.attributes]) if (!fresh.hasAttribute(a.name)) old.removeAttribute(a.name);
 for (const a of [...fresh.attributes]) if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
 if (fresh.__h) for (const [type, fn] of Object.entries(fresh.__h)) on(old, type, fn);
 if (old.tagName === "INPUT" || old.tagName === "SELECT") {
  if (old !== document.activeElement || old.type !== "range") old.value = fresh.value;
  old.checked = fresh.checked; old.disabled = fresh.disabled;
 }
 if (old.tagName === "BUTTON") old.disabled = fresh.disabled;
 const a = [...old.childNodes], b = [...fresh.childNodes];
 b.forEach((child, k) => a[k] ? morph(a[k], child) : old.append(child));
 a.slice(b.length).forEach(child => child.remove());
}
function draw() {
 const root = document.getElementById("root"), fresh = document.createElement("div");
 hookAt = 0; effects.length = 0;
 try {
  fresh.id = "root";
  const built = build(render(DIL), false);
  if (built) fresh.append(built);
  morph(root, fresh);
  effects.forEach(fn => { try { fn(); } catch (e) {} });
 } catch (e) { fault(e); }
}
function fault(e) {
 const root = document.getElementById("root");
 root.innerHTML = '<div class="dw-fault">这个小部件没能在 Lattice 里运行：<span></span></div>';
 root.querySelector("span").textContent = e.message;
}

// ---- talking to the page that frames it ----------------------------------------------------------------------------
addEventListener("message", e => {
 if (e.source !== parent || typeof e.data?.lattice_widget !== "string") return;
 hooks.length = 0;
 try { render = compile(parse(e.data.lattice_widget)); draw(); } catch (err) { fault(err); }
});
// The frame is as tall as what it shows, told again whenever that changes (a redraw, the frame's width, fonts arriving).
const tell = () => parent.postMessage({ lattice_widget_height: Math.ceil(document.getElementById("root").getBoundingClientRect().height) + 4 }, "*");
new ResizeObserver(tell).observe(document.getElementById("root"));
addEventListener("resize", tell);
document.fonts?.ready.then(tell);
parent.postMessage({ lattice_widget_ready: true }, "*");
