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
let reader = null, reportTimer = null;
// What is reported as the learner reads, at most a few times a second.
function report(state) {
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => { $("where").textContent = state.label || ""; send({ book: "at", ...state }); }, 250);
}
function selected(win, frame) {
    const selection = win.getSelection(), text = selection?.toString() || "";
    if (!text.trim() || !selection.rangeCount) return send({ book: "selection", text: "" });
    const r = selection.getRangeAt(0).getBoundingClientRect(), f = frame?.getBoundingClientRect() || { left: 0, top: 0 };
    send({ book: "selection", text, rect: { left: r.left + f.left, top: r.top + f.top, bottom: r.bottom + f.top, width: r.width } });
}
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
    box.addEventListener("mouseup", () => setTimeout(() => selected(window), 0));
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
    };
}

/* ---- EPUB, MOBI, AZW3, FB2, CBZ ------------------------------------------------------------------------------- */
async function openBook(data, name, at) {
    await import(VENDOR + "foliate/view.js");
    const view = document.createElement("foliate-view");
    $("stage").append(view);
    await view.open(new File([data], name));
    const { book } = view, renderer = view.renderer;
    let size = 100, section = "";
    const styles = () => {
        const css = getComputedStyle(document.documentElement), color = css.getPropertyValue("--text").trim(), accent = css.getPropertyValue("--accent").trim();
        renderer.setStyles?.(`html{color-scheme:${theme};font-size:${size}%}
            html,body{background:transparent!important;color:${color}!important}
            p,li,blockquote,dd,div,span,h1,h2,h3,h4,h5,h6,td,th{color:inherit!important;background-color:transparent!important}
            a,a *{color:${accent}!important}
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
    view.addEventListener("load", ({ detail: { doc } }) => {
        const frame = doc.defaultView.frameElement;
        doc.addEventListener("pointerdown", () => send({ book: "focus" }));
        doc.addEventListener("mouseup", () => setTimeout(() => selected(doc.defaultView, frame), 0));
        doc.addEventListener("keydown", event => {
            if (event.key === "ArrowLeft") view.goLeft();
            else if (event.key === "ArrowRight") view.goRight();
        });
    });
    // Links inside the book are followed by the view; one going out of it goes to Lattice's reader.
    view.addEventListener("external-link", event => { event.preventDefault(); send({ book: "link", href: event.detail.href_ }); });
    view.addEventListener("relocate", ({ detail }) => {
        section = detail.tocItem?.label || section;
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
