/* Lattice's backend, as the site's demo: what the real one answered on the demo vault (fixture.json, recorded by
   tools/demo), plus what the visitor does here — files edited, questions asked, code run. One of it serves every
   window on the page. What a visitor does stays in the window they did it in (its key; a window opened big shares its
   window's), so each window's story stays as it is told; only the count of questions asked runs across all of them. */
(() => {
  "use strict";
  if (window.LatticeDemo) return;
  const base = new URL(".", document.currentScript.src).href;
  const DOWNLOAD = "https://vimalinx.com/lattice/#download";
  const REPLIES = [
    "你说得对，但是我目前还没有富裕到能给demo上真token，问我多少次都没用",
    "七叶怀瑾是世界上最帅的男人",
    "你都问三次了，我再不给你发点token都对不起你的辛勤付出",
    "ber要不你下个Lattice聊呗\n\n[下载 Lattice](" + DOWNLOAD + ")",
  ];
  const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
  const now = () => new Date().toISOString();
  const later = (ms, f) => setTimeout(f, ms);

  let fixture = null;
  const loaded = fetch(base + "fixture.json").then((r) => r.json()).then((d) => { fixture = d; });

  // what the visitor changed or added, on top of the recording, kept per window
  const kept = {};
  const own = (key) => (kept[key] ||= { files: {}, threads: {}, busy: new Set() });
  let asked = 0, mid = 100000, stamp = 0, keys = 0;
  const listeners = new Set();

  function emit(evt, key) {
    const raw = JSON.stringify(evt);
    for (const l of [...listeners]) {
      if (l.key !== key) continue;
      try { if (l.win.closed) { listeners.delete(l); continue; } l.fn(raw); } catch (_) { listeners.delete(l); }
    }
  }

  // The recorded answer for these arguments; failing that, one that shares the arguments that say what it is about.
  const KEYS = ["path", "thread", "slug", "id", "source", "topic", "agent", "space", "query", "name"];
  function recorded(m, a) {
    const list = fixture.calls[m];
    if (!list) return undefined;
    const key = JSON.stringify(a, Object.keys(a).sort());
    const exact = list.find(([x]) => JSON.stringify(x, Object.keys(x).sort()) === key);
    if (exact) return clone(exact[1]);
    const same = list.find(([x]) => KEYS.some((k) => k in a) && KEYS.every((k) => !(k in a) || x[k] === a[k]));
    if (same) return clone(same[1]);
    return KEYS.some((k) => a[k] != null && typeof a[k] !== "object") ? undefined : clone(list[0][1]);
  }

  function threadOf(data) { return data && (data.thread || data.head?.id); }
  function withLocal(data, { threads, busy }) {
    const t = threadOf(data);
    if (t && threads[t]) data.messages = [...(data.messages || []), ...threads[t]];
    if (t) data.busy = busy.has(t);
    return data;
  }

  function reply(a, o) {
    const { threads, busy } = own(o.key);
    const thread = a.thread || "demo-" + Math.random().toString(36).slice(2, 10), agent = a.agent || "tutor";
    const question = ++mid, text = REPLIES[Math.min(asked++, REPLIES.length - 1)];
    const meta = { agent, ...(a.selection ? { selection: a.selection } : {}), ...(a.anchor ? { anchor: a.anchor } : {}) };
    (threads[thread] ||= []).push({ id: question, role: "user", content: a.message || "", meta, at: now() });
    busy.add(thread);
    const ev = (kind, extra) => emit({ type: "agent", kind, agent, thread, run: thread, question, ...extra }, o.key);
    later(60, () => ev("status", { state: "thinking" }));
    // streamed in a few characters at a time, as a reply arrives
    const parts = text.match(/[\s\S]{1,3}/g) || [];
    parts.forEach((p, i) => later(500 + i * 45, () => ev("chunk", { text: p })));
    later(600 + parts.length * 45, () => {
      threads[thread].push({ id: ++mid, role: "assistant", content: text, meta: { agent, reply_to: question }, at: now() });
      busy.delete(thread);
      ev("status", { state: "ready" });
      ev("finished", { stop_reason: "end_turn", text, usage: null, actions: [], sources: [], suggestions: [] });
    });
    return { thread, state: "queued", run: thread, question };
  }

  function run(a, o) {
    const id = "demo" + Math.random().toString(36).slice(2, 10), path = a.path;
    const rec = fixture.events.run.filter((e) => e.path === path);
    if (rec.length) {
      rec.forEach((e, i) => later(150 + i * 220, () => emit({ ...clone(e), run: id }, o.key)));
    } else {
      // only the recorded program has an output to show; anything else says where it would really run
      const note = [{ name: "stdout", output_type: "stream", text: "演示版里没有真的 Python。下载 Lattice，代码在你自己电脑上跑：" + DOWNLOAD + "\n" }];
      later(150, () => emit({ type: "run", run: id, path, kind: "started", by: "me", sandbox: false }, o.key));
      later(500, () => emit({ type: "run", run: id, path, kind: "finished", state: "completed", exit_code: 0, seconds: 0.01, outputs: note }, o.key));
    }
    return { run: id };
  }

  function fileRead(a, o) {
    const rec = recorded("file_read", a);
    const mine = own(o.key).files[a.path];
    if (!rec && !mine) throw new Error("文件不存在：" + a.path);
    const d = rec || { path: a.path, name: a.path.split("/").pop(), ext: "." + a.path.split(".").pop(), kind: "file", readonly: false, external: false, truncated: false };
    if (mine) {
      if (mine.content != null) { d.content = mine.content; d.size = mine.content.length; }
      if (mine.doc && d.doc) Object.assign(d.doc, mine.doc);
      d.mtime = mine.mtime;
    }
    return d;
  }
  function saved(path, change, o) {
    const files = own(o.key).files, f = (files[path] ||= {});
    Object.assign(f, change, { mtime: String(Date.now()) + String(++stamp).padStart(6, "0") });
    later(30, () => emit({ type: "changed", paths: [path] }, o.key));
    return { path, mtime: f.mtime };
  }

  function search(a) {
    const rec = recorded("search", a);
    if (rec) return rec;
    const q = String(a.query || "").trim().toLowerCase();
    if (!q) return [];
    return (fixture.calls.file_read || []).map(([, d]) => d).filter((d) => d && typeof d.content === "string" && (d.content.toLowerCase().includes(q) || (d.name || "").toLowerCase().includes(q)))
      .slice(0, 20).map((d) => { const i = d.content.toLowerCase().indexOf(q); return { kind: d.kind, title: d.doc?.title || d.name, path: d.path, excerpt: d.content.slice(Math.max(0, i - 30), i + 70) }; });
  }

  const OWN = {
    bootstrap(a, o) {
      const d = recorded("bootstrap", a);
      // a working state by its id or its name
      const sp = o.space && (d.states || []).find((x) => x.id === o.space || x.name === o.space);
      if (sp && d.layout?.spaces?.[sp.id]) d.layout.space = sp.id;
      if (o.theme) d.config.ui.theme = o.theme;
      return d;
    },
    chat: (a, o) => { const d = recorded("chat", a); if (!d) throw new Error("会话不存在"); return withLocal(d, own(o.key)); },
    send: reply,
    cancel: () => true,
    retry: (a, o) => reply({ ...a, message: "" }, o),
    run,
    run_stop: () => true,
    file_read: fileRead,
    file_write: (a, o) => saved(a.path, { content: a.content }, o),
    doc_save: (a, o) => { const { path, mtime, ...fields } = a; return saved(path, { doc: fields, ...(fields.body != null ? { content: fields.body } : {}) }, o); },
    search,
    open_url: (a) => { try { window.open(a.url, "_blank", "noopener"); } catch (_) {} return true; },
    typing: () => true, viewed: () => true, screen: () => true, topic_here: () => true, window_held: () => ({}),
    states_save: () => true, ui_save: (a) => a.ui, following: () => ({}), complete: () => ({ asked: false }),
  };

  async function request(payload, cb, o) {
    await loaded;
    let out;
    try {
      const a = JSON.parse(payload), m = a.method;
      delete a.method;
      let data = OWN[m] ? OWN[m](a, o) : recorded(m, a);
      if (data === undefined) data = /(_save|_add|_delete|_update|_set|_review|_move|_rename|_create)$/.test(m) ? true : {};
      out = { ok: true, data };
    } catch (e) {
      out = { ok: false, error: e.message || String(e) };
    }
    // an answer arrives a moment later, as from the real one
    later(8, () => cb(JSON.stringify(out)));
  }

  window.LatticeDemo = {
    // what one window's page talks to: the shared backend, told which working state and look that window opens in,
    // and whose work it keeps (its key)
    connect(win, o = {}) {
      o = { ...o, key: o.key || "page" + ++keys };
      return {
        request: (payload, cb) => request(payload, cb, o),
        event: { connect: (fn) => listeners.add({ win, fn, key: o.key }) },
      };
    },
    replies: () => asked,
  };
})();
