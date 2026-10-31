/* A book, drawn: PDFs through pdf.js as a scrolling column of pages with their text selectable, everything else through
   foliate-js. This page knows nothing of Lattice but the messages it exchanges with the window it sits in. */
const VENDOR = "/_lattice/vendor/";
const $ = id => document.getElementById(id);
const send = message => parent.postMessage(message, "*");
const query = new URLSearchParams(location.search);
let look = {};
try { look = JSON.parse(query.get("look") || "{}"); } catch { /* the defaults in book.css stand */ }
let theme = query.get("theme") === "light" ? "light" : "dark";
function applyLook() {
    for (const [k, v] of Object.entries(look)) if (typeof v === "string" && v) document.documentElement.style.setProperty("--" + k, v);
    document.documentElement.style.colorScheme = theme;
}
applyLook();

const clip = text => String(text || "").replace(/\s+/g, " ").trim();
let reader = null, reportTimer = null, marks = [];
// What is reported as the learner reads, at most a few times a second.
function report(state) {
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => { $("where").textContent = state.label || ""; send({ book: "at", ...state }); }, 250);
}
const place = (range, frame) => {
    const r = range.getBoundingClientRect(), f = frame?.getBoundingClientRect() || { left: 0, top: 0 };
    return { left: r.left + f.left, top: r.top + f.top, bottom: r.bottom + f.top, width: r.width };
};
function selected(win, frame, anchor) {
    const selection = win.getSelection(), text = selection?.toString() || "";
    if (!text.trim() || !selection.rangeCount) return send({ book: "selection", text: "" });
    const range = selection.getRangeAt(0);
    send({ book: "selection", text, rect: place(range, frame), anchor: anchor(range) });
}
// A selection can end on elements (three clicks take a paragraph), and a CFI of those comes out empty: its text, then.
function onText(range) {
    if (range.startContainer.nodeType === 3 && range.endContainer.nodeType === 3) return range;
    const walker = range.startContainer.ownerDocument.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT), out = range.cloneRange();
    let first = null, last = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data.trim() && range.intersectsNode(node)) { first ??= node; last = node; }
    if (first && range.startContainer.nodeType !== 3) out.setStart(first, 0);
    if (last && range.endContainer.nodeType !== 3) out.setEnd(last, last.length);
    return out;
}
// What stands just before and after a selection, to tell one place from another with the same words.
function around(start, end, range) {
    const make = () => start.ownerDocument.createRange(), a = make(), b = make();
    a.selectNodeContents(start);
    a.setEnd(range.startContainer, range.startOffset);
    b.selectNodeContents(end);
    b.setStart(range.endContainer, range.endOffset);
    return { before: a.toString().slice(-50), after: b.toString().slice(0, 50) };
}
// Words in a page's text, whatever the spacing between them there.
function rangeOf(root, quote) {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT), map = [];
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode())
        for (let i = 0; i < node.data.length; i++) if (!/\s/.test(node.data[i])) { text += node.data[i]; map.push([node, i]); }
    const want = quote.replace(/\s+/g, ""), at = want ? text.indexOf(want) : -1;
    if (at < 0) return null;
    const range = root.ownerDocument.createRange(), last = map[at + want.length - 1];
    range.setStart(...map[at]);
    range.setEnd(last[0], last[1] + 1);
    return range;
}
const COLORS = { yellow: "#f5c518", green: "#5ecb7c", blue: "#5aa7f0", pink: "#f27fb2", ai: "#8f7ff0", ask: "#12917f" };
function followLink(event) {
    const a = event.target.closest?.("a[href]");
    if (!a || !/^https?:/i.test(a.href)) return;
    event.preventDefault();
    event.stopPropagation();
    send({ book: "link", href: a.href });
}
function list(items, draw) {
    const side = $("side");
    side.replaceChildren(...items.map(draw));
    if (!items.length) side.append(Object.assign(document.createElement("p"), { textContent: "这本书没有目录" }));
}
function entry(text, go, depth = 0, note = "") {
    const button = document.createElement("button");
    button.textContent = text;
    button.style.paddingLeft = 8 + depth * 14 + "px";
    if (note) button.append(Object.assign(document.createElement("small"), { textContent: note }));
    button.onclick = go;
    return button;
}

/* ---- PDF ---------------------------------------------------------------------------------------------------- */
async function openPdf(data, name, at) {
    await import(VENDOR + "pdfjs/pdf.min.mjs");
    const pdfjs = globalThis.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = VENDOR + "pdfjs/pdf.worker.min.mjs";
    const { EventBus, PDFFindController, PDFLinkService, PDFViewer } = (await import(VENDOR + "pdfjs/web/pdf_viewer.mjs"), globalThis.pdfjsViewer);
    document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: VENDOR + "pdfjs/web/pdf_viewer.css" }));
    const stage = $("stage"), box = document.createElement("div"), inner = document.createElement("div");
    box.id = "pdf"; inner.className = "pdfViewer"; box.append(inner); stage.append(box);
    const eventBus = new EventBus(), links = new PDFLinkService({ eventBus });
    const finder = new PDFFindController({ eventBus, linkService: links });
    const viewer = new PDFViewer({ container: box, viewer: inner, eventBus, linkService: links, findController: finder, removePageBorders: true });
    links.setViewer(viewer);
    // Set before the document goes in: the viewer says the pages are ready as soon as the first one has loaded.
    let doc = null;
    const showing = async page => clip((await (await doc.getPage(page)).getTextContent()).items.map(i => i.str).join(" ")).slice(0, 400);
    const where = async page => ({ at: "p" + page, label: `第 ${page} / ${doc.numPages} 页`, section: "", progress: page / doc.numPages, showing: await showing(page) });
    eventBus.on("pagesinit", () => {
        viewer.currentScaleValue = "page-width";
        const page = Number(/^p(\d+)$/.exec(at || "")?.[1]);
        if (page) viewer.currentPageNumber = Math.min(page, doc.numPages);
        where(viewer.currentPageNumber).then(report);
    });
    eventBus.on("pagechanging", ({ pageNumber }) => where(pageNumber).then(report));
    doc = await pdfjs.getDocument({ data, cMapUrl: VENDOR + "pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: VENDOR + "pdfjs/standard_fonts/",
        wasmUrl: VENDOR + "pdfjs/wasm/", isEvalSupported: false }).promise;
    viewer.setDocument(doc);
    links.setDocument(doc);
    const meta = await doc.getMetadata().catch(() => ({}));
    const title = clip(meta.info?.Title) || name;
    eventBus.on("updatefindmatchescount", ({ matchesCount }) => { $("found").textContent = matchesCount.total ? `${matchesCount.current} / ${matchesCount.total}` : ""; });
    eventBus.on("updatefindcontrolstate", ({ state, matchesCount }) => { $("found").textContent = state === 1 ? "没找到" : matchesCount?.total ? `${matchesCount.current} / ${matchesCount.total}` : ""; });
    box.addEventListener("click", followLink, true);
    /* Marks are kept in shares of their page, one rectangle a line, so they stand through zooming. */
    const pageDiv = n => viewer.getPageView(n - 1)?.div;
    const pageOf = node => (node.nodeType === 1 ? node : node.parentElement).closest(".page");
    const layerOf = div => div.querySelector(".textLayer") || div;
    const rectsOf = (range, first, last) => {
        const pages = [];
        for (let n = first; n <= last; n++) pages.push([n, pageDiv(n).getBoundingClientRect()]);
        const rects = [];
        for (const r of range.getClientRects()) {
            const held = pages.find(([, b]) => r.top + r.height / 2 >= b.top && r.top + r.height / 2 <= b.bottom);
            if (held && r.width >= 1 && r.height >= 1) {
                const [n, b] = held;
                rects.push([n, (r.left - b.left) / b.width, (r.top - b.top) / b.height, r.width / b.width, r.height / b.height]);
            }
        }
        rects.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
        const out = [];
        for (const r of rects) {
            const line = out[out.length - 1];
            if (line && line[0] === r[0] && Math.abs(line[2] - r[2]) < Math.min(line[4], r[4]) * .6) {
                const right = Math.max(line[1] + line[3], r[1] + r[3]);
                line[1] = Math.min(line[1], r[1]);
                line[3] = right - line[1];
            } else out.push([...r]);
        }
        return out.map(r => [r[0], ...r.slice(1).map(x => Math.round(x * 1e4) / 1e4)]);
    };
    const anchorOf = range => {
        const first = pageOf(range.startContainer), last = pageOf(range.endContainer);
        if (!first || !last) return null;
        const page = Number(first.dataset.pageNumber);
        return { at: { page, rects: rectsOf(range, page, Number(last.dataset.pageNumber)) }, label: `第 ${page} 页`, ...around(layerOf(first), layerOf(last), range) };
    };
    const paint = n => {
        const div = pageDiv(n);
        if (!div) return;
        div.querySelector(".lmarks")?.remove();
        const here = marks.flatMap(m => (m.at.rects || []).filter(r => r[0] === n).map(r => [m, r]));
        if (!here.length) return;
        const layer = Object.assign(document.createElement("div"), { className: "lmarks" });
        for (const [m, [, x, y, w, h]] of here) {
            const bit = document.createElement("i");
            bit.className = m.color === "ai" || m.color === "ask" ? m.color : "";
            bit.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%;background:${COLORS[m.color] || COLORS.yellow}`;
            layer.append(bit);
            // Over a page's picture the words take the colour by blending, which a line under them would not survive.
            if (m.color === "ask") {
                const line = document.createElement("i");
                line.className = "ask-line";
                line.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%`;
                layer.append(line);
            }
        }
        div.append(layer);
    };
    // A mark an agent left has a page and words; the rectangles are worked out when that page's text is there.
    const seen = new Set();
    const settle = n => {
        const div = pageDiv(n);
        for (const m of marks) {
            if (m.at.page !== n || m.at.rects?.length) continue;
            const range = rangeOf(layerOf(div), m.text);
            if (range) {
                m.at.rects = rectsOf(range, n, n);
                send({ book: "located", id: m.id, at: { rects: m.at.rects } });
            }
        }
        paint(n);
    };
    eventBus.on("pagerendered", ({ pageNumber }) => paint(pageNumber));
    eventBus.on("textlayerrendered", ({ pageNumber }) => { seen.add(pageNumber); settle(pageNumber); });
    box.addEventListener("mouseup", () => setTimeout(() => selected(window, null, anchorOf), 0));
    box.addEventListener("click", event => {
        if (!getSelection().isCollapsed) return;
        const div = event.target.closest?.(".page");
        if (!div) return;
        const n = Number(div.dataset.pageNumber), b = div.getBoundingClientRect(), x = (event.clientX - b.left) / b.width, y = (event.clientY - b.top) / b.height;
        const hit = marks.find(m => (m.at.rects || []).some(r => r[0] === n && x >= r[1] && x <= r[1] + r[3] && y >= r[2] && y <= r[2] + r[4]));
        if (hit) send({ book: "mark", id: hit.id, rect: { left: event.clientX, top: event.clientY, bottom: event.clientY, width: 0 } });
    });
    new ResizeObserver(() => { if (viewer.pagesCount && /^page-/.test(viewer.currentScaleValue)) viewer.currentScaleValue = viewer.currentScaleValue; }).observe(box);
    reader = {
        title,
        async contents() {
            const walk = (items, depth) => (items || []).flatMap(item => [entry(item.title, () => links.goToDestination(item.dest), depth), ...walk(item.items, depth + 1)]);
            list(walk(await doc.getOutline(), 0), x => x);
        },
        search(words, again, back) {
            eventBus.dispatch("find", { source: null, type: again ? "again" : "", query: words, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: back, matchDiacritics: false });
        },
        zoom(step) { viewer.currentScale = Math.min(5, Math.max(0.3, viewer.currentScale * (step > 0 ? 1.15 : 1 / 1.15))); },
        marks() { for (let n = 1; n <= viewer.pagesCount; n++) seen.has(n) ? settle(n) : paint(n); },
        goto(at, text) {
            const page = at?.page;
            if (!page) return text && this.search(text.slice(0, 80));
            viewer.currentPageNumber = Math.min(page, doc.numPages);
            const r = at.rects?.find(x => x[0] === page), div = pageDiv(page);
            if (r && div) box.scrollTop = div.offsetTop + r[2] * div.clientHeight - box.clientHeight / 3;
        },
        unselect() { getSelection().removeAllRanges(); },
    };
}

/* ---- EPUB, MOBI, AZW3, FB2, CBZ ------------------------------------------------------------------------------- */
async function openBook(data, name, at) {
    await import(VENDOR + "foliate/view.js");
    const { Overlayer } = await import(VENDOR + "foliate/overlayer.js");
    const view = document.createElement("foliate-view");
    $("stage").append(view);
    await view.open(new File([data], name));
    const { book } = view, renderer = view.renderer;
    let size = 100, section = "", fraction = 0, shown = new Map();
    const styles = () => {
        const css = getComputedStyle(document.documentElement), color = css.getPropertyValue("--text").trim(), accent = css.getPropertyValue("--accent").trim();
        renderer.setStyles?.(`html{color-scheme:${theme};font-size:${size}%}
            html,body{background:transparent!important;color:${color}!important}
            p,li,blockquote,dd,div,span,h1,h2,h3,h4,h5,h6,td,th{color:inherit!important;background-color:transparent!important}
            a,a *{color:${accent}!important}
            ::highlight(lmark-ask){color:${accent}}
            p,li,blockquote,dd{line-height:1.7}`);
    };
    const paged = book.rendition?.layout === "pre-paginated";
    if (!paged) {
        renderer.setAttribute("flow", "scrolled");
        renderer.setAttribute("gap", "6%");
        renderer.setAttribute("max-inline-size", "760px");
        $("flow").hidden = false;
        $("flow").onclick = () => {
            const scrolled = renderer.getAttribute("flow") === "scrolled";
            renderer.setAttribute("flow", scrolled ? "paginated" : "scrolled");
            $("flow").textContent = scrolled ? "滚动" : "翻页";
        };
    }
    styles();
    // The view draws a mark in whichever sections are loaded, and asks again as each one loads.
    view.addEventListener("draw-annotation", ({ detail: { draw, annotation, doc, range } }) => {
        // A question's words change colour in the page itself; the overlay draws over it and cannot.
        if (annotation.ask) {
            const win = doc.defaultView, asked = win.CSS.highlights.get("lmark-ask") || new win.Highlight();
            asked.add(range);
            win.CSS.highlights.set("lmark-ask", asked);
        }
        const line = annotation.color === "ai" || annotation.color === "ask";
        draw(line ? Overlayer.underline : Overlayer.highlight, { color: COLORS[annotation.color] || COLORS.yellow });
    });
    view.addEventListener("create-overlay", () => { for (const mark of shown.values()) view.addAnnotation(mark); });
    view.addEventListener("show-annotation", ({ detail: { value, range } }) => {
        const mark = shown.get(value);
        if (mark) send({ book: "mark", id: mark.id, rect: place(range, range.startContainer.ownerDocument.defaultView.frameElement) });
    });
    view.addEventListener("load", ({ detail: { doc, index } }) => {
        const frame = doc.defaultView.frameElement;
        doc.addEventListener("pointerdown", () => send({ book: "focus" }));
        const anchorOf = range => ({ at: { cfi: view.getCFI(index, onText(range)) }, label: (section ? section + " · " : "") + Math.round(fraction * 100) + "%", ...around(doc.body, doc.body, range) });
        doc.addEventListener("mouseup", () => setTimeout(() => selected(doc.defaultView, frame, anchorOf), 0));
        doc.addEventListener("keydown", event => {
            if (event.key === "ArrowLeft") view.goLeft();
            else if (event.key === "ArrowRight") view.goRight();
        });
    });
    // Links inside the book are followed by the view; one going out of it goes to Lattice's reader.
    view.addEventListener("external-link", event => { event.preventDefault(); send({ book: "link", href: event.detail.href_ }); });
    view.addEventListener("relocate", ({ detail }) => {
        section = detail.tocItem?.label || section;
        fraction = detail.fraction || 0;
        const percent = Math.round((detail.fraction || 0) * 100);
        report({ at: detail.cfi || "", label: (section ? section + " · " : "") + percent + "%", section, progress: detail.fraction || 0, showing: clip(detail.range?.toString()).slice(0, 400) });
    });
    await view.init({ lastLocation: at || undefined, showTextStart: !at });
    if (!view.lastLocation) await view.goToFraction(0);
    reader = {
        title: (typeof book.metadata?.title === "string" ? book.metadata.title : Object.values(book.metadata?.title || {})[0]) || name,
        contents() {
            const walk = (items, depth) => (items || []).flatMap(item => [entry(item.label, () => view.goTo(item.href), depth), ...walk(item.subitems, depth + 1)]);
            list(walk(book.toc, 0), x => x);
        },
        async search(words) {
            view.clearSearch();
            const side = $("side"), rows = [];
            side.hidden = false;
            side.replaceChildren(Object.assign(document.createElement("p"), { textContent: "正在搜索…" }));
            for await (const result of view.search({ query: words })) {
                if (result === "done" || !result.subitems) continue;
                for (const item of result.subitems) rows.push(entry(item.excerpt.pre.slice(-20) + item.excerpt.match + item.excerpt.post.slice(0, 40), () => view.goTo(item.cfi), 0, result.label || ""));
                if (rows.length > 200) break;
            }
            $("found").textContent = rows.length ? rows.length + " 处" : "没找到";
            list(rows, x => x);
        },
        zoom(step) { size = Math.min(220, Math.max(60, size + step * 10)); styles(); },
        look: styles,
        async marks() {
            // A mark an agent left has only its words: found once, and kept with its place.
            for (const m of marks) {
                if (m.at.cfi) continue;
                for await (const result of view.search({ query: m.text.replace(/\s+/g, " ").trim().slice(0, 120) })) {
                    const hit = result !== "done" && result.subitems?.[0];
                    if (hit) {
                        m.at.cfi = hit.cfi;
                        send({ book: "located", id: m.id, at: { cfi: hit.cfi } });
                        break;
                    }
                }
                view.clearSearch();
            }
            // One place drawn once: a highlight and a question on the same words show as both, and open the question.
            const next = new Map();
            for (const m of marks) {
                if (!m.at.cfi) continue;
                const had = next.get(m.at.cfi), ask = m.color === "ask";
                next.set(m.at.cfi, { value: m.at.cfi, color: ask ? had?.color || "ask" : m.color, id: ask || !had?.ask ? m.id : had.id, ask: ask || had?.ask });
            }
            for (const [value, mark] of shown) if (next.get(value)?.color !== mark.color || next.get(value)?.ask !== mark.ask) view.deleteAnnotation(mark);
            for (const { doc } of renderer.getContents()) doc.defaultView.CSS.highlights.delete("lmark-ask");
            shown = next;
            for (const mark of shown.values()) view.addAnnotation(mark);
        },
        goto(at, text) { return at?.cfi ? view.goTo(at.cfi) : text && this.search(text.slice(0, 80)); },
        unselect() { for (const { doc } of renderer.getContents()) doc.getSelection()?.removeAllRanges(); },
    };
}

/* ---- this page --------------------------------------------------------------------------------------------------- */
$("toc-toggle").onclick = () => {
    const side = $("side");
    side.hidden = !side.hidden;
    if (!side.hidden) reader?.contents();
};
$("smaller").onclick = () => reader?.zoom(-1);
$("bigger").onclick = () => reader?.zoom(1);
$("marks-open").onclick = () => send({ book: "marks-open" });
let searched = "";
$("search").addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    const words = event.target.value.trim();
    if (words) reader?.search(words, words === searched, event.shiftKey);
    searched = words;
});
document.addEventListener("pointerdown", () => send({ book: "focus" }), true);
addEventListener("message", async event => {
    if (event.source !== parent || !event.data?.book) return;
    const d = event.data;
    if (d.book === "look") {
        look = d.look || look;
        theme = d.theme === "light" ? "light" : "dark";
        applyLook();
        reader?.look?.();
    }
    if (d.book === "marks") {
        marks = (d.marks || []).map(m => ({ ...m, at: { ...m.at } }));
        reader?.marks();
    }
    if (d.book === "goto") reader?.goto(d.at, d.text);
    if (d.book === "unselect") reader?.unselect();
    if (d.book === "open" && !reader) {
        try {
            const data = await (await fetch(d.url)).arrayBuffer();
            const magic = String.fromCharCode(...new Uint8Array(data.slice(0, 5)));
            await (magic === "%PDF-" ? openPdf(data, d.name, d.at) : openBook(data, d.name, d.at));
            $("loading").remove();
            $("book-title").textContent = reader.title;
            send({ book: "info", title: reader.title });
        } catch (error) {
            console.error(error);
            const drm = /DRM|encrypt/i.test(String(error?.message || error));
            send({ book: "error", message: drm ? "这本书有 DRM 保护，打不开" : "打不开这本书：" + String(error?.message || error) });
        }
    }
});
send({ book: "ready" });
