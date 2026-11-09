/* Lattice's site: the app itself (ui/*.htm, real DOM) in frames, driven by the scroll. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const hasGsap = typeof gsap !== "undefined" && typeof ScrollTrigger !== "undefined";
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (hasGsap) gsap.registerPlugin(ScrollTrigger);

  // the wheel glides instead of stepping, and always moves the page, over the windows too; touch keeps the phone's own scrolling
  const lenis = hasGsap && !still && typeof Lenis !== "undefined"
    ? new Lenis({ lerp: .1, wheelMultiplier: 1, anchors: true, autoRaf: false })
    : null;
  // a window clicked into keeps the wheel for itself until the pointer leaves it
  document.addEventListener("pointerdown", (e) => {
    const w = e.target.closest?.(".win, .play-board");
    if (w && !w.closest("dialog")) w.setAttribute("data-lenis-prevent", "");
  });
  document.addEventListener("pointerout", (e) => {
    const w = e.target.closest?.("[data-lenis-prevent]");
    if (w && !w.contains(e.relatedTarget)) w.removeAttribute("data-lenis-prevent");
  });
  if (lenis) {
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  /* ---------------- the windows: Lattice itself ---------------- */
  // Every window is the real Lattice (app/), on the demo backend in app/demo that all of them share. The scenes below
  // play on it: what they draw sits over it, and what they move inside it they put back.
  const cache = {};
  const fragment = (name) => (cache[name] ||= fetch("ui/" + name + ".htm").then((r) => (r.ok ? r.text() : "")).catch(() => ""));
  const fit = (win) => win.style.setProperty("--k", win.clientWidth / 1600);
  const ro = new ResizeObserver((es) => es.forEach((e) => fit(e.target)));
  const appUrl = (space, o = {}) => "app/index.html?space=" + encodeURIComponent(space) + (o.dark ? "&theme=dark" : "") + (o.run ? "&run=" + encodeURIComponent(o.run) : "");
  function liveApp(win, space, o = {}) {
    const frame = el("iframe", "live-app" + (o.cls ? " " + o.cls : ""));
    $(".scale", win).insertBefore(frame, $(".ov", win));
    frame.title = "Lattice（可以直接用的演示）";
    const a = { win, frame, space, doc: null };
    a.ready = new Promise((done) => frame.addEventListener("load", () => {
      // booted: its states along the bottom and its panels in place, and a moment for them to fill
      const t = setInterval(() => {
        const d = frame.contentDocument;
        if (!d?.querySelector("#status .st-tab") || !d.querySelector("#dock .stack")) return;
        clearInterval(t);
        frame.classList.add("up");
        setTimeout(() => { a.doc = d; done(a); }, 900);
      }, 100);
    }, { once: true }));
    a.load = () => { if (!frame.src) frame.src = appUrl(space, o); };
    a.$ = (sel) => a.doc?.querySelector(sel) || null;
    a.$$ = (sel) => (a.doc ? [...a.doc.querySelectorAll(sel)] : []);
    // the app's own modules, the very ones running in it
    a.mod = (name) => frame.contentWindow.latticeModule(name);
    return a;
  }
  // a box inside an app, in its 1600x1000 frame; one on this page, in the frame of the window it sits over
  function box(el, win) {
    const r = el.getBoundingClientRect();
    if (el.ownerDocument !== document) return { x: r.left, y: r.top, w: r.width, h: r.height };
    const s = $(".scale", win).getBoundingClientRect(), k = s.width / 1600;
    return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k };
  }
  // a chat panel scrolled so this message sits at its top
  function scrollToMsg(msg, off = 16) {
    const sc = msg?.closest(".chat-scroll");
    if (sc) sc.scrollTop += msg.getBoundingClientRect().top - sc.getBoundingClientRect().top - off;
  }
  const findMsg = (a, cls, text) => a.$$(".msg." + cls).find((m) => m.textContent.includes(text));
  // where the learning windows start: the main session at the question that drew the graph, the quick answer from the top
  function pose(a) {
    scrollToMsg(findMsg(a, "from-me", "给我画个图"));
    const q = findMsg(a, "from-me", "这一行在干嘛");
    if (q) q.closest(".chat-scroll").scrollTop = 0;
  }
  const visible = (el) => el && el.getClientRects().length && el.getBoundingClientRect().width > 4;
  function el(tag, cls, html, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  const place = (e, b) => Object.assign(e.style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });

  /* ---------------- words ---------------- */
  function chars(root) {
    const out = [];
    const walk = (n) => [...n.childNodes].forEach((c) => {
      if (c.nodeType === 3) {
        const f = document.createDocumentFragment();
        for (const ch of c.nodeValue) { const s = el("span", "ch", null, f); s.textContent = ch === " " ? " " : ch; out.push(s); }
        c.replaceWith(f);
      } else if (c.nodeType === 1) walk(c);
    });
    walk(root);
    return out;
  }

  /* ---------------- header ---------------- */
  const bar = $("#top-bar");
  const solid = () => bar.classList.toggle("solid", scrollY > 30);
  addEventListener("scroll", solid, { passive: true });
  solid();

  /* ---------------- a lattice that breathes behind the hero ---------------- */
  function net(canvas, ink, line, count) {
    const ctx = canvas.getContext("2d");
    let w = 0, h = 0, pts = [], on = true, mouse = null;
    const size = () => {
      const r = canvas.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
      w = r.width; h = r.height; canvas.width = w * d; canvas.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0);
      pts = Array.from({ length: Math.round(count * Math.min(1, w / 1400)) }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .18, vy: (Math.random() - .5) * .18 }));
    };
    size();
    addEventListener("resize", size);
    canvas.parentElement.addEventListener("pointermove", (e) => { const r = canvas.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    canvas.parentElement.addEventListener("pointerleave", () => (mouse = null));
    new IntersectionObserver(([e]) => { on = e.isIntersecting; if (on) requestAnimationFrame(frame); }).observe(canvas);
    function frame() {
      if (!on) return;
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        if (!still) { p.x += p.vx; p.y += p.vy; }
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 150) continue;
        let al = (1 - d / 150) * .22;
        if (mouse) { const m = Math.hypot((a.x + b.x) / 2 - mouse.x, (a.y + b.y) / 2 - mouse.y); if (m < 180) al += (1 - m / 180) * .45; }
        ctx.strokeStyle = line.replace("A", al.toFixed(3));
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.fillStyle = ink;
      for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, 7); ctx.fill(); }
      if (!still) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  net($("#hero-net"), "rgba(22,38,43,.28)", "rgba(27,120,104,A)", 70);
  net($("#get-net"), "rgba(139,220,197,.5)", "rgba(139,220,197,A)", 60);

  /* ---------------- the windows' apps, then everything that moves ---------------- */
  const wins = $$(".win[data-space]");
  const APPS = {};
  wins.forEach((win) => {
    fit(win); ro.observe(win);
    APPS[win.id] = liveApp(win, win.dataset.space, { run: win.dataset.run });
    if (win.id === "theme-win") APPS["theme-dark"] = liveApp(win, win.dataset.space, { dark: true, cls: "dark-app" });
  });
  const apps = Object.values(APPS);
  apps.forEach((a) => a.ready.then(() => pose(a)));
  // the first window at once; the others as the page nears them (live())
  APPS["hero-win"].load();
  document.fonts.ready.then(setup);

  function setup() {
    words();
    hero();
    tabsScene();
    contextScene();
    flashScene();
    lab();
    route();
    deck();
    runScene();
    gitLog();
    models();
    theme();
    downloads();
    zoom();
    if (hasGsap) {
      gsap.to("#progress", { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: .3 } });
      ScrollTrigger.refresh();
    }
    live();
  }

  /* big words come up out of their lines; paragraphs rise */
  function words() {
    $$("[data-chars]").forEach((e) => {
      const cs = chars(e);
      if (!hasGsap || still) return;
      const inHero = e.closest(".hero");
      gsap.from(cs, { yPercent: 115, rotate: 6, opacity: 0, duration: 1.05, ease: "expo.out", stagger: .028, delay: inHero ? .15 : 0,
        scrollTrigger: inHero ? null : { trigger: e, start: "top 88%", once: true } });
    });
    $$("[data-rise]").forEach((e) => {
      if (!hasGsap || still) return;
      const inHero = e.closest(".hero");
      gsap.from(e, { y: 28, opacity: 0, duration: 1.1, ease: "power3.out", delay: inHero ? .55 : .1, scrollTrigger: inHero ? null : { trigger: e, start: "top 90%", once: true } });
    });
  }

  /* ---------------- hero: the window lands, then says what its parts are ---------------- */
  function hero() {
    const win = $("#hero-win"), ov = $("#hero-ov"), a = APPS["hero-win"];
    const tags = [["文件", "按主题和会话找"], ["主会话", "讲解、画图、出小实验"], ["快答", "小问题，不打断主讲", true], ["卡片库", "讲过的自动记成卡"], ["工作状态", "底栏一点，换整套窗口"]]
      .map(([title, sub, ai]) => el("div", "tagline" + (ai ? " ai" : ""), `<i></i>${title}<small>${sub}</small>`, ov));
    // placed by the panels they name, once the app has them
    a.ready.then(() => {
      const s = a.$$("#dock .stack").filter(visible).map((e) => box(e));
      const at = [[120, 560], s[0] && [s[0].x + s[0].w - 280, s[0].y + 150], s[1] && [s[1].x + 95, s[1].y + 340], s[2] && [s[2].x + 40, s[2].y + 190], [40, 905]];
      tags.forEach((t, i) => (at[i] ? Object.assign(t.style, { left: at[i][0] + "px", top: at[i][1] + "px" }) : t.remove()));
    });
    if (!hasGsap || still) { win.style.transform = "none"; tags.forEach((t) => (t.style.opacity = 1)); return; }
    // It lies back in the bottom of the first screen (site.css tilts it before anything loads) and comes upright as that screen scrolls away.
    gsap.set(win, { rotateX: 38, scale: .9, transformOrigin: "50% 0%" });
    const tl = gsap.timeline({ scrollTrigger: { trigger: win, start: 0, end: "top 9%", scrub: .8 } });
    tl.to(win, { rotateX: 0, scale: 1, ease: "none", duration: 1 })
      .to(tags, { opacity: 1, y: -8, stagger: .08, duration: .25 }, .78);
  }

  /* ---------------- 壹: take the window apart, then change what it is for ---------------- */
  const WORKSPACES = [["学习", "hero", "主会话、快答、卡片库"], ["写作", "ws_write", "一大块笔记，旁边是大纲与链接，没有 AI"], ["复习", "ws_cards", "卡片库、到期回顾、记忆，快答在下面"],
    ["阅读", "ws_read", "笔记在中间，大纲和快答在旁边"], ["动手", "ws_work", "代码和它的输出，快答在旁边"], ["梳理", "ws_map", "整张知识图，旁边一张卡和主会话"], ["定制", "ws_skills", "技能商城，打开的技能，主会话里试"]];
  function scene(section, build, length) {
    const tl = gsap.timeline({ paused: true });
    build(tl);
    if (still) { tl.progress(1); return tl; }
    const mm = gsap.matchMedia();
    mm.add("(min-width: 900px)", () => {
      ScrollTrigger.create({ trigger: section, start: "top top", end: "+=" + length, pin: true, scrub: 1.1, animation: tl, anticipatePin: 1 });
      return () => tl.progress(0);
    });
    mm.add("(max-width: 899px)", () => {
      ScrollTrigger.create({ trigger: section, start: "top 70%", once: true, onEnter: () => tl.timeScale(1.6).play() });
    });
    return tl;
  }
  function steps(tl, box, times) {
    const ss = $$(".step", box);
    times.forEach((t, i) => {
      tl.to(ss[i], { opacity: 0, y: -16, duration: .2 }, t);
      tl.fromTo(ss[i + 1], { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: .25 }, t + .12);
    });
  }

  // a colour with its alpha scaled, for a background going clear and coming back
  const fade = (c, k) => { const m = String(c).match(/[\d.]+/g) || [0, 0, 0, 0]; return `rgba(${m[0]},${m[1]},${m[2]},${(m[3] == null ? 1 : +m[3]) * k})`; };
  function tabsScene() {
    const win = $("#tabs-win"), ov = $("#tabs-ov"), list = $("#wslist"), a = APPS["tabs-win"];
    if (!a || !hasGsap) return;
    WORKSPACES.forEach(([name, , desc], i) => el("button", i ? "" : "on", `<span>0${i + 1}</span><b>${name}</b><small>${desc}</small>`, list).type = "button");
    const K = .82, C = { x: 800, y: 500 };
    // the pieces as the app has them when they move: [element, dx, dy, what it is]
    const pieces = () => {
      const st = a.$$("#dock .stack").filter(visible);
      return [[a.$("#activity"), -46, 0, ""], [a.$("#side"), -22, 0, "活动栏和左栏"], [st[0], 0, -10, "一组标签：主会话 · 代码 · 笔记"], [st[1], 34, -26, "快答"], [st[2], 34, 26, "卡片库 · 记忆"],
        [a.$("#status"), 0, 34, "底栏：工作状态"]].filter((p) => p[0]);
    };
    const NAMES = ["活动栏和左栏", "一组标签：主会话 · 代码 · 笔记", "快答", "卡片库 · 记忆", "底栏：工作状态"];
    const labels = NAMES.map((name) => el("div", "tagline", `<i></i>${name}`, ov));
    a.ready.then(() => pieces().forEach(([e, dx, dy, name]) => {
      const t = labels[NAMES.indexOf(name)];
      if (!t) return;
      const b = box(e), x = C.x + (b.x + dx - C.x) * K, y = C.y + (b.y + dy - C.y) * K;
      Object.assign(t.style, { left: x + 14 + "px", top: y + (/底栏/.test(name) ? -58 : 14) + "px" });
    }));
    // apart (v 0..1): the whole app a little smaller, what it stands on clear, its pieces pulled out and outlined
    const GROUNDS = ["body", "#app", "#shell", "#dock-wrap", "#dock"];
    let bgs = null;
    const apart = (v) => {
      const root = a.$("#app");
      if (!root) return;
      const cs = a.frame.contentWindow.getComputedStyle;
      bgs ||= GROUNDS.map((q) => a.$(q) && cs(a.$(q)).backgroundColor);
      Object.assign(root.style, { transformOrigin: "50% 50%", transform: v ? `scale(${1 - (1 - K) * v})` : "" });
      GROUNDS.forEach((q, i) => { const e = a.$(q); if (e) e.style.backgroundColor = v ? fade(bgs[i], 1 - v) : ""; });
      [root, a.$("#shell"), a.$("#dock-wrap"), a.$("#dock"), ...a.$$("#dock .split")].forEach((e) => e && (e.style.overflow = v ? "visible" : ""));
      pieces().forEach(([e, dx, dy]) => Object.assign(e.style, v
        ? { transform: `translate(${dx * v}px,${dy * v}px)`, borderRadius: 12 * v + "px", boxShadow: `0 0 0 2px rgba(27,120,104,${v}), 0 30px 60px -26px rgba(22,38,43,${.55 * v})` }
        : { transform: "", borderRadius: "", boxShadow: "" }));
    };
    const P = { v: 0 }, T0 = 2.0, STEP = .62;
    const tl = scene($("#tabs-scene"), (tl) => {
      tl.to(win, { backgroundColor: "rgba(253,253,249,0)", boxShadow: "0 0 0 0 rgba(22,38,43,0)", duration: .4 }, .1);
      tl.to(P, { v: 1, duration: .5, ease: "power2.out", onUpdate: () => apart(P.v) }, .2);
      tl.to(labels, { opacity: 1, y: -6, stagger: .05, duration: .25 }, .65);
      tl.to(labels, { opacity: 0, duration: .2 }, 1.3);
      tl.to(P, { v: 0, duration: .4, ease: "power2.inOut", onUpdate: () => apart(P.v) }, 1.35);
      tl.to(win, { backgroundColor: "rgba(253,253,249,1)", boxShadow: "0 30px 80px -30px rgba(22,38,43,.38)", duration: .4 }, 1.35);
      steps(tl, $("#tabs-steps"), [1.5]);
      tl.to({}, { duration: .5 }, T0 + 6 * STEP);
    }, "+=" + 420 + "%");
    // the working state the scroll has reached, switched in the app itself (the list beside it says which)
    let want = 0;
    const show = (i) => {
      want = i;
      if (!a.doc) return;
      const name = WORKSPACES[i][0];
      if (a.$("#status .st-tab.on")?.textContent.trim() === name) return;
      Promise.all([a.mod("spaces"), a.mod("core")]).then(([SP, CO]) => {
        if (want !== i) return;
        const sp = CO.S.states.find((x) => x.name === name);
        if (!sp) return;
        SP.switchSpace(sp.id);
        const dw = a.$("#dock-wrap");
        if (dw) gsap.fromTo(dw, { opacity: .15 }, { opacity: 1, duration: .3, ease: "power1.out" });
      });
    };
    a.ready.then(() => show(want));
    const btns = $$("button", list);
    const sync = () => {
      const t = tl.time(), i = t < T0 + .15 ? 0 : Math.min(6, Math.floor((t - T0 - .15) / STEP) + 1);
      btns.forEach((b, j) => b.classList.toggle("on", j === i));
      if (i !== want) show(i);
    };
    tl.eventCallback("onUpdate", sync);
    btns.forEach((b, i) => b.addEventListener("click", () => {
      const st = ScrollTrigger.getAll().find((s) => s.animation === tl);
      const t = i ? T0 + (i - 1) * STEP + .35 : 1.9;
      const top = st && st.start + (st.end - st.start) * (t / tl.duration());
      if (st) lenis ? lenis.scrollTo(top, { duration: 1.4 }) : scrollTo({ top, behavior: "smooth" });
      else { tl.time(t); sync(); }
    }));
  }

  /* ---------------- playground: real tabs you can drag ---------------- */
  const ICON = {
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 8l1.5 2.5L16 12l-2.5 1.5L12 16l-1.5-2.5L8 12l2.5-1.5Z"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"/></svg>',
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 13h6"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z"/><path d="M5 17a3 3 0 0 1 3-3h11"/></svg>',
  };
  const PTABS = {
    tutor: ["主会话", "bot", false, '<div style="text-align:right"><span class="q">学习率和梯度到底啥关系？</span></div><p>一句话：<b>梯度管方向，学习率管步长。</b></p><p class="muted">梯度告诉你往哪走损失降得最快；学习率决定这一步迈多远。</p>'],
    flash: ["快答", "spark", true, '<div style="text-align:right"><span class="q">lr 为什么大于 2 就停不下来？</span></div><p>每一步误差乘上 <code>1 − lr</code>；大于 2 时它的绝对值超过 1，一步比一步跨得远。</p>'],
    code: ["学习率扫描.py", "code", false, "<pre>for lr in (0.1, 0.5, 1.5, 2.5):\n    p = 0.0\n    for step in range(8):\n        error = target - p\n        p += lr * error</pre>"],
    note: ["为什么先猜再看答案", "doc", false, "<p><b>猜错的那一下才是学习</b></p><p class=\"muted\">预测和结果之间的落差，告诉你这里有东西值得记住。</p>"],
    cards: ["卡片库", "card", false, '<p><span class="ct ct-concept">概念</span> 学习率</p><p><span class="ct ct-principle">原理</span> 梯度方向</p><p><span class="ct ct-method">方法</span> 参数更新</p>'],
    book: ["一个数字怎样学习", "book", false, "<p><b>第一章 猜测</b></p><p class=\"muted\">每看到一次结果，他都把信念往结果那边挪一点。</p>"],
  };
  function playground() {
    const board = $("#play");
    if (!board) return;
    let uid = 0;
    const S = (tabs) => ({ t: "s", id: "s" + uid++, tabs, active: tabs[0] });
    const start = () => ({ t: "x", dir: "h", items: [S(["tutor", "code", "note"]), { t: "x", dir: "v", items: [S(["flash"]), S(["cards", "book"])] }] });
    let root = start(), fresh = null;
    const stacks = (n, out = []) => (n.t === "s" ? out.push(n) : n.items.forEach((c) => stacks(c, out)), out);
    const parentOf = (n, p = root) => (p.t === "x" ? (p.items.includes(n) ? p : p.items.map((c) => parentOf(n, c)).find(Boolean)) : null);
    function tidy(n) {
      if (n.t === "s") return n.tabs.length ? n : null;
      n.items = n.items.map(tidy).filter(Boolean).flatMap((c) => (c.t === "x" && c.dir === n.dir ? c.items : [c]));
      return n.items.length === 0 ? null : n.items.length === 1 ? n.items[0] : n;
    }
    function render() {
      const draw = (n) => {
        if (n.t === "s") {
          return `<div class="pl-stack" data-s="${n.id}"><div class="pl-tabs">${n.tabs.map((k) => `<div class="pl-tab${k === n.active ? " on" : ""}${PTABS[k][2] ? " ai" : ""}" data-k="${k}">${ICON[PTABS[k][1]]}${PTABS[k][0]}</div>`).join("")}</div><div class="pl-body markdown">${PTABS[n.active][3]}</div></div>`;
        }
        return `<div class="pl-split ${n.dir}">${n.items.map(draw).join("")}</div>`;
      };
      board.innerHTML = `<div class="dock-root">${draw(root)}</div><div class="pl-drop"></div>`;
      if (fresh && hasGsap) gsap.from(`[data-s="${fresh}"]`, { opacity: 0, scale: .94, duration: .45, ease: "back.out(1.6)" });
      fresh = null;
    }
    render();
    let drag = null;
    board.addEventListener("pointerdown", (e) => {
      stopDemo();
      const t = e.target.closest(".pl-tab");
      if (!t) return;
      drag = { k: t.dataset.k, from: t.closest(".pl-stack").dataset.s, x: e.clientX, y: e.clientY, moving: false, ghost: null, hit: null };
      t.setPointerCapture(e.pointerId);
    });
    const over = (x, y) => {
      if (!drag.moving) { drag.moving = true; drag.ghost = el("div", "pl-ghost lt light", ICON[PTABS[drag.k][1]] + PTABS[drag.k][0], document.body); }
      Object.assign(drag.ghost.style, { left: x + 12 + "px", top: y + 10 + "px" });
      const under = document.elementsFromPoint(x, y).find((n) => n.classList && n.classList.contains("pl-stack"));
      const mark = $(".pl-drop", board);
      if (!under) { drag.hit = null; mark.style.opacity = 0; return; }
      const r = under.getBoundingClientRect(), b = board.getBoundingClientRect(), fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
      const zone = fx < .24 ? "left" : fx > .76 ? "right" : fy < .3 && fy > .12 ? "top" : fy > .74 ? "bottom" : "center";
      drag.hit = { s: under.dataset.s, zone };
      const half = { left: [0, 0, .5, 1], right: [.5, 0, .5, 1], top: [0, 0, 1, .5], bottom: [0, .5, 1, .5], center: [0, 0, 1, 1] }[zone];
      Object.assign(mark.style, { opacity: 1, left: r.left - b.left + r.width * half[0] + 4 + "px", top: r.top - b.top + r.height * half[1] + 4 + "px", width: r.width * half[2] - 8 + "px", height: r.height * half[3] - 8 + "px" });
    };
    board.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (!drag.moving && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      over(e.clientX, e.clientY);
    });
    const end = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      d.ghost && d.ghost.remove();
      const all = stacks(root), src = all.find((s) => s.id === d.from);
      if (!d.moving) { src.active = d.k; render(); return; }
      if (!d.hit) return render();
      const dst = all.find((s) => s.id === d.hit.s);
      if (d.hit.zone === "center") {
        if (dst === src) return render();
        src.tabs = src.tabs.filter((k) => k !== d.k);
        dst.tabs.push(d.k); dst.active = d.k;
      } else {
        if (dst === src && src.tabs.length === 1) return render();
        src.tabs = src.tabs.filter((k) => k !== d.k);
        const made = S([d.k]), dir = d.hit.zone === "left" || d.hit.zone === "right" ? "h" : "v", before = d.hit.zone === "left" || d.hit.zone === "top";
        const p = parentOf(dst);
        if (p && p.dir === dir) p.items.splice(p.items.indexOf(dst) + (before ? 0 : 1), 0, made);
        else {
          const split = { t: "x", dir, items: before ? [made, dst] : [dst, made] };
          if (p) p.items[p.items.indexOf(dst)] = split; else root = split;
        }
        fresh = made.id;
      }
      if (!src.tabs.includes(src.active)) src.active = src.tabs[0];
      root = tidy(root) || start();
      render();
    };
    board.addEventListener("pointerup", end);
    board.addEventListener("pointercancel", end);

    // the first time it comes into view, a pointer shows what to do: it drags the code tab to the main session's right edge, which splits off a column
    let show = null;
    const cursor = el("div", "pl-cursor", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8.5-6.2 1.3 3.6 6.6-2.6 1.4-3.6-6.6L5 18.5z"/></svg>', document.body);
    function stopDemo() {
      if (!show) return;
      show.kill(); show = null;
      gsap.set(cursor, { opacity: 0 });
      if (drag && drag.demo) { drag.ghost && drag.ghost.remove(); drag = null; render(); }
    }
    function demo() {
      const tab = $('.pl-tab[data-k="code"]', board), from = tab && tab.closest(".pl-stack");
      if (!from || drag) return;
      // points kept relative to the board, so they hold while the page is still gliding
      const b0 = board.getBoundingClientRect(), t = tab.getBoundingClientRect(), f = from.getBoundingClientRect();
      const rel = (x, y) => [x - b0.left, y - b0.top];
      const P = { x: 0, y: 0 }, A = rel(b0.left + b0.width * .5, b0.top + b0.height * .8), B = rel(t.left + t.width / 2, t.top + t.height / 2), C = rel(f.right - f.width * .1, f.top + f.height * .55);
      const put = () => { const b = board.getBoundingClientRect(); gsap.set(cursor, { x: b.left + P.x, y: b.top + P.y }); if (drag && drag.demo) over(b.left + P.x, b.top + P.y); };
      [P.x, P.y] = A; put();
      show = gsap.timeline({ onComplete: () => { show = null; } })
        .to(cursor, { opacity: 1, duration: .3 })
        .to(P, { x: B[0], y: B[1], duration: .8, ease: "power2.inOut", onUpdate: put })
        .to(cursor, { scale: .82, duration: .12 })
        .add(() => { drag = { k: "code", from: from.dataset.s, demo: true, moving: false, ghost: null, hit: null }; })
        .to(P, { x: C[0], y: C[1], duration: 1.1, ease: "power2.inOut", onUpdate: put })
        .to({}, { duration: .35 })
        .add(() => { end(); })
        .to(cursor, { scale: 1, duration: .12 })
        .to(cursor, { opacity: 0, duration: .4 }, "+=.7");
    }
    // made before the pinned scenes above it, so it measures after them (their pins move it down the page)
    if (hasGsap && !still) ScrollTrigger.create({ trigger: board, start: "top 60%", once: true, onEnter: demo, refreshPriority: -1 });

    $("#play-reset").addEventListener("click", () => { stopDemo(); root = start(); fresh = null; render(); if (hasGsap) gsap.from(".pl-stack", { opacity: 0, y: 10, stagger: .06, duration: .35 }); });
  }
  playground();

  /* ---------------- 贰: what the quick answer is given, and what it reads ---------------- */
  function kindOf(title) {
    if (/\.py$|\.js$|\.c$/.test(title)) return "代码";
    if (/快答/.test(title)) return "快答";
    if (/主会话/.test(title)) return "主会话";
    if (/卡片库/.test(title)) return "卡片库";
    if (/记忆/.test(title)) return "记忆";
    return "笔记";
  }
  function contextScene() {
    const win = $("#ctx-win"), ov = $("#ctx-ov"), a = APPS["ctx-win"];
    if (!a || !hasGsap) return;
    const N = 6, NS = "http://www.w3.org/2000/svg";
    // drawn now, filled from the app once it is there: the catalog, a mark and a beam for each tab, the selection, the read
    const cat = el("div", "catalog", `<div class="head">${ICON.spark.replace("<svg", '<svg width="16" height="16"')}这一问附带的标签目录</div>`, ov);
    const rows = Array.from({ length: N }, () => el("div", "row", "", cat));
    const sel = el("div", "sel", `<span class="k">选中 </span><b>“梯度管方向，学习率管步长。”</b> <span class="k">· t1 主会话</span>`, cat);
    const tool = el("div", "tool", "", cat);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "beams"); svg.setAttribute("viewBox", "0 0 1600 1000");
    ov.insertBefore(svg, cat);
    const beam = () => { const p = document.createElementNS(NS, "path"); p.setAttribute("pathLength", "1"); p.style.strokeDasharray = 1; p.style.strokeDashoffset = 1; svg.appendChild(p); return p; };
    const hls = rows.map(() => el("div", "hl", "", ov)), beams = rows.map(beam);
    const selBox = el("div", "selbox", "", ov), selBeam = beam(), codeHl = el("div", "hl", "", ov), toolBeam = beam();
    const flyer = el("div", "tool-fly", "", ov), paneRing = el("div", "hl ai", "", ov);
    const curve = (p, f, t) => p.setAttribute("d", `M${f.x} ${f.y} C${f.x} ${f.y + 160}, ${t.x - 200} ${t.y}, ${t.x} ${t.y}`);
    let flash = null, from = null, codeAt = 2;
    a.ready.then(() => {
      const tabs = a.$$("#dock .tab").filter(visible).slice(0, N), stacks = a.$$("#dock .stack").filter(visible);
      flash = stacks[1];
      const fb = flash ? box(flash) : { x: 1086, y: 0, w: 500, h: 600 };
      Object.assign(cat.style, { left: fb.x + fb.w - 700 + "px", top: fb.y + 70 + "px", width: "680px" });
      rows.forEach((r, i) => {
        const t = tabs[i];
        if (!t) { r.remove(); return; }
        const title = (t.querySelector(".tab-title") || t).textContent.trim().replace(/\s+/g, " ");
        r.className = "row" + (/主会话/.test(title) ? " using" : t.classList.contains("active") ? " front" : "");
        r.innerHTML = `<span class="k">t${i + 1}</span><span>${kindOf(title)}</span><span>${title}</span>`;
        hls[i].className = "hl" + (/快答/.test(title) ? " ai" : "");
      });
      codeAt = Math.max(0, tabs.findIndex((t) => /\.py/.test(t.textContent)));
      tool.innerHTML = ICON.doc + `读了 <b style="color:#16262b">t${codeAt + 1} · 学习率扫描.py</b>　全文 12 行`;
      const rowAt = (r) => ({ x: cat.offsetLeft, y: cat.offsetTop + r.offsetTop + r.offsetHeight / 2 });
      tabs.forEach((t, i) => { const b = box(t); place(hls[i], { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 }); curve(beams[i], { x: b.x + b.w / 2, y: b.y + b.h }, rowAt(rows[i])); });
      const strong = a.$$(".msg-body strong").find((e) => /梯度管方向/.test(e.textContent));
      if (strong) { const b = box(strong); place(selBox, { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 }); curve(selBeam, { x: b.x + b.w / 2, y: b.y + b.h + 4 }, rowAt(sel)); }
      const code = tabs[codeAt];
      if (code) { const b = box(code); place(codeHl, { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 }); curve(toolBeam, { x: b.x + b.w / 2, y: b.y + b.h }, rowAt(tool)); }
      flyer.innerHTML = tool.innerHTML;
      from = { x: cat.offsetLeft + tool.offsetLeft, y: cat.offsetTop - 6 + tool.offsetTop };
      Object.assign(flyer.style, { left: from.x + "px", top: from.y + "px", width: tool.offsetWidth + "px" });
      place(paneRing, { x: fb.x + 4, y: fb.y + 4, w: fb.w - 8, h: fb.h - 8 });
      apply();
    });
    // The end, played in the app: question, then the read, then the answer. The quick answer scrolls up to make room,
    // the line flies in and becomes a line of that conversation, under the question, and the answer comes in below it.
    let geo = null, chip = null;
    const parts = () => {
      const q = findMsg(a, "from-me", "lr 为什么大于 2");
      let ans = q?.nextElementSibling;
      if (ans?.classList.contains("demo-read")) ans = ans.nextElementSibling;
      return { q, ans: ans?.classList.contains("from-ai") ? ans : null, sc: q?.closest(".chat-scroll") };
    };
    const measure = (p) => {
      const q = box(p.q), sc = p.sc, scb = box(sc), comp = flash && $(".composer", flash) || flash?.querySelector(".composer");
      const cb = comp ? box(comp) : { y: scb.y + scb.h };
      const ab = p.ans ? box(p.ans) : { y: q.y + q.h, h: 0 };
      const room = Math.max(0, ab.y + ab.h + 56 - Math.min(cb.y, scb.y + scb.h));
      const lift = Math.min(room, sc.scrollHeight - sc.clientHeight - sc.scrollTop + 56);
      geo = { base: sc.scrollTop, lift, x: box(flash).x + 22 - from.x, y: q.y + q.h - lift + 10 - from.y };
    };
    const fly = { p: 0, lift: 0, a: 0 };
    function apply() {
      if (ScrollTrigger.isRefreshing || !a.doc || !from) return;
      const p = parts();
      if (!p.q || !p.sc) return;
      if (!geo || !p.q.isConnected) measure(p);
      if (!chip || !chip.isConnected) {
        chip = a.doc.createElement("div");
        chip.className = "demo-read";
        chip.innerHTML = tool.innerHTML;
        Object.assign(chip.style, { display: "none", alignItems: "center", gap: "7px", margin: "4px 0 14px", padding: "8px 11px", borderRadius: "8px", font: "500 14.7px/1.3 var(--sans, sans-serif)", color: "var(--muted, #5b6b70)", background: "var(--hover, rgba(22,38,43,.05))", boxShadow: "0 0 0 1.5px #6b57b8", width: "fit-content" });
        chip.querySelector("svg")?.setAttribute("style", "width:15px;height:15px;flex:none");
        p.q.after(chip);
      }
      p.sc.scrollTop = geo.base + geo.lift * fly.lift;
      const landed = fly.p > .999;
      chip.style.display = landed ? "flex" : "none";
      flyer.style.visibility = landed ? "hidden" : "";
      gsap.set(flyer, { x: geo.x * fly.p, y: geo.y * fly.p, scale: 1 - .3 * fly.p });
      if (p.ans) Object.assign(p.ans.style, { opacity: fly.a, transform: fly.a < 1 ? `translateY(${(1 - fly.a) * 16}px)` : "" });
    }
    scene($("#ctx-scene"), (tl) => {
      tl.to(cat, { opacity: 1, y: -6, duration: .3 }, .1);
      rows.forEach((r, i) => {
        const at = .35 + i * .3;
        tl.to(hls[i], { opacity: 1, duration: .12 }, at);
        tl.to(beams[i], { opacity: .9, strokeDashoffset: 0, duration: .25, ease: "power1.inOut" }, at + .02);
        tl.to(r, { opacity: 1, duration: .12 }, at + .2);
        tl.to([hls[i], beams[i]], { opacity: 0, duration: .15 }, at + .4);
      });
      const t2 = .5 + N * .3;
      steps(tl, $("#ctx-steps"), [t2 - .1, t2 + 1.1]);
      tl.to(selBox, { scaleX: 1, duration: .45, ease: "power2.inOut" }, t2 + .1);
      tl.to(selBeam, { opacity: .9, strokeDashoffset: 0, duration: .3 }, t2 + .5);
      tl.to(sel, { opacity: 1, duration: .15 }, t2 + .75);
      tl.to(selBeam, { opacity: 0, duration: .2 }, t2 + 1.05);
      tl.to(codeHl, { opacity: 1, duration: .12 }, t2 + 1.35);
      tl.to(toolBeam, { opacity: .9, strokeDashoffset: 0, duration: .3 }, t2 + 1.4);
      tl.to(tool, { opacity: 1, duration: .15 }, t2 + 1.7);
      const t3 = t2 + 2.1;
      tl.to(flyer, { opacity: 1, duration: .01 }, t3).to(tool, { opacity: 0, duration: .01 }, t3);
      tl.to([cat, codeHl, selBox], { opacity: 0, scale: .97, duration: .35, ease: "power1.in" }, t3 + .05);
      tl.to(toolBeam, { opacity: 0, duration: .2 }, t3 + .05);
      tl.to(fly, { lift: 1, duration: .6, ease: "power2.inOut", onUpdate: apply }, t3 + .2);
      tl.to(fly, { p: 1, duration: .75, ease: "power2.inOut", onUpdate: apply }, t3 + .1);
      tl.to(flyer, { boxShadow: "0 0 0 2px #6b57b8", duration: .2 }, t3 + .8);
      tl.to(paneRing, { opacity: 1, duration: .15 }, t3 + .8).to(paneRing, { opacity: 0, duration: .4 }, t3 + 1.15);
      tl.to(fly, { a: 1, duration: .35, onUpdate: apply }, t3 + 1.05);
      tl.to({}, { duration: .4 }, t3 + 1.55);
    }, "+=" + 440 + "%");
  }

  /* ---------------- 叁: select, ask, and what stays ---------------- */
  function flashScene() {
    const win = $("#flash-win"), ov = $("#flash-ov"), a = APPS["flash-win"];
    if (!a || !hasGsap) return;
    const selBox = el("div", "selbox", "", ov), ring = el("div", "hl ai", "", ov);
    const pop = el("div", "selpop", `<span>${ICON.spark}问快答</span><span>${ICON.bot}问主会话</span>`, ov);
    const mark = () => a.$$(".lmark-ask").find(visible);
    a.ready.then(() => {
      const m = mark(), mb = m ? box(m) : { x: 300, y: 520, w: 150, h: 26 };
      place(selBox, { x: mb.x - 3, y: mb.y - 3, w: mb.w + 6, h: mb.h + 6 });
      Object.assign(pop.style, { left: mb.x + "px", top: mb.y - 62 + "px" });
      place(ring, { x: mb.x - 8, y: mb.y - 6, w: mb.w + 16, h: mb.h + 12 });
      reveal();
    });
    // the question asked about that line comes in, then its answer unrolls; at the end the underline is clicked, in the
    // app, and it lists what was asked there
    const R = { q: 0, a: 0, open: 0 };
    function reveal() {
      if (ScrollTrigger.isRefreshing || !a.doc) return;
      const q = findMsg(a, "from-me", "lr 为什么大于 2"), ans = q?.nextElementSibling;
      if (q) Object.assign(q.style, { opacity: R.q, transformOrigin: "100% 100%", transform: R.q < 1 ? `translateY(${(1 - R.q) * 24}px) scale(${.96 + .04 * R.q})` : "" });
      if (ans) ans.style.clipPath = R.a < 1 ? `inset(0 0 ${(1 - R.a) * 100}% 0)` : "";
      const open = !!a.$(".menu");
      if (R.open > .5 && !open) {
        const m = mark();
        if (m) { const r = m.getBoundingClientRect(); m.dispatchEvent(new a.frame.contentWindow.MouseEvent("click", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); }
      } else if (R.open <= .5 && open) a.mod("app").then((A) => A.closeMenus());
    }
    scene($("#flash-scene"), (tl) => {
      tl.to(selBox, { scaleX: 1, duration: .45, ease: "power2.inOut" }, .1);
      tl.fromTo(pop, { opacity: 0, y: 10, scale: .96 }, { opacity: 1, y: 0, scale: 1, duration: .2 }, .55);
      tl.to(pop.firstChild, { scale: 1.06, duration: .1, yoyo: true, repeat: 1 }, .85);
      steps(tl, $("#flash-steps"), [1.0, 2.3]);
      tl.to([pop, selBox], { opacity: 0, duration: .15 }, 1.05);
      tl.to(R, { q: 1, duration: .25, onUpdate: reveal }, 1.15);
      tl.to(R, { a: 1, duration: .8, ease: "none", onUpdate: reveal }, 1.45);
      tl.to(ring, { opacity: 1, duration: .15 }, 2.45);
      tl.to(ring, { scale: 1.08, opacity: 0, duration: .3 }, 2.65);
      tl.to(R, { open: 1, duration: .05, onUpdate: reveal }, 2.8);
      tl.to({}, { duration: .5 }, 3.2);
    }, "+=" + 300 + "%");
  }

  /* ---------------- 肆: an experiment that works ---------------- */
  function lab() {
    const input = $("#eta"), svg = $("#chart");
    if (!input) return;
    const X = (n) => 38 + n * 37, Y = (v) => 222 - (Math.max(-3, Math.min(4, v)) + 3) / 7 * 184;
    let auto = true;
    function draw(eta) {
      let p = 0;
      const pts = [[0, p]];
      for (let n = 1; n <= 12; n++) { p = p + eta * (1 - p); pts.push([n, p]); }
      const grid = [-3, .5, 4].map((v) => `<text x="32" y="${Y(v) + 4}" text-anchor="end">${v}</text><line x1="38" x2="482" y1="${Y(v)}" y2="${Y(v)}" class="grid"/>`).join("");
      const line = pts.map(([n, v]) => `${X(n)},${Y(v)}`).join(" ");
      svg.innerHTML = grid + `<text x="260" y="238" text-anchor="middle">6</text><text x="482" y="238" text-anchor="middle">12</text>` +
        `<polyline fill="none" stroke="#6b57b8" stroke-width="2" points="${X(0)},${Y(1)} ${X(12)},${Y(1)}"/>` +
        `<polyline fill="none" stroke="#1b7868" stroke-width="2.4" stroke-linejoin="round" points="${line}"/>` +
        pts.map(([n, v]) => (v >= -3 && v <= 4 ? `<circle class="pt" cx="${X(n)}" cy="${Y(v)}" r="3"/>` : "")).join("") +
        `<text x="260" y="256" text-anchor="middle" class="axis">更新次数</text>`;
      const k = Math.abs(1 - eta), how = eta === 0 ? "原地不动" : eta < 1 ? "单调靠近" : eta === 1 ? "一步到位" : eta < 2 ? "震荡但收敛" : eta === 2 ? "来回弹跳" : "发散";
      $("#eta-out").textContent = eta.toFixed(2).replace(/0$/, "");
      $("#eta-big").textContent = eta.toFixed(2);
      $("#read-k").textContent = k.toFixed(2).replace(/\.?0+$/, "") || "0";
      $("#read-v").textContent = how;
      const v = $("#verdict");
      v.textContent = how;
      v.className = "verdict " + (eta <= 1 ? "ok" : eta < 2 ? "wobble" : "bad");
    }
    input.addEventListener("input", () => { auto = false; draw(+input.value); });
    draw(+input.value);
    if (hasGsap && !still) {
      ScrollTrigger.create({ trigger: ".lab", start: "top 75%", end: "bottom 35%", scrub: true, onUpdate: (s) => {
        if (!auto) return;
        const eta = Math.round((.3 + s.progress * 2.15) / .05) * .05;
        input.value = eta; draw(+eta.toFixed(2));
      } });
    }
    const right = 1, judge = $("#judge");
    $$("#quiz input").forEach((r) => r.addEventListener("change", () => {
      $$("#quiz label").forEach((l) => l.classList.remove("right", "wrong"));
      const lab = r.closest("label"), ok = +r.value === right;
      lab.classList.add(ok ? "right" : "wrong");
      if (!ok) $$("#quiz label")[right].classList.add("right");
      judge.innerHTML = ok ? "<b>快答：</b>对。梯度只看损失函数在这一点有多陡，和学习率无关；学习率只管沿着它走多远。"
        : "<b>快答：</b>不太对。梯度是损失函数在当前这一点的斜率，起点没变它就没变；变的是 η 乘上它以后实际走的那一步。";
      if (hasGsap) gsap.from(judge, { opacity: 0, y: 6, duration: .35 });
    }));
  }

  /* ---------------- 伍: a route that grows a station ---------------- */
  function route() {
    const svg = $("#route-svg");
    if (!svg) return;
    const Y = 140, st = [[90, "损失函数", "已经会", "done"], [360, "梯度方向", "讲过了", "done"], [630, "参数更新", "现在在这", "here"], [1030, "学习率", "", ""], [1280, "学习曲线", "", ""]];
    const fill = [830, 280];
    const ns = "http://www.w3.org/2000/svg";
    const add = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text) e.textContent = text; svg.appendChild(e); return e; };
    const done = add("path", { class: "line done", d: `M${st[0][0]} ${Y} L${st[2][0]} ${Y}` });
    const rest = add("path", { class: "line", d: `M${st[2][0]} ${Y} L${st[4][0]} ${Y}` });
    const det = add("path", { class: "detour", d: `M${st[2][0]} ${Y} C ${st[2][0] + 90} ${Y}, ${fill[0] - 120} ${fill[1]}, ${fill[0]} ${fill[1]} S ${st[3][0] - 90} ${Y}, ${st[3][0]} ${Y}` });
    const pulse = add("circle", { class: "pulse", cx: st[2][0], cy: Y, r: 20 });
    const dots = st.map(([x, name, sub, cls]) => {
      const g = document.createElementNS(ns, "g"); svg.appendChild(g);
      const c = document.createElementNS(ns, "circle"); Object.entries({ cx: x, cy: Y, r: cls === "here" ? 15 : 13, class: cls }).forEach(([k, v]) => c.setAttribute(k, v)); g.appendChild(c);
      const t = document.createElementNS(ns, "text"); Object.entries({ x, y: Y - 40, "text-anchor": "middle" }).forEach(([k, v]) => t.setAttribute(k, v)); t.textContent = name; g.appendChild(t);
      if (sub) { const s = document.createElementNS(ns, "text"); Object.entries({ x, y: Y + 50, "text-anchor": "middle", class: "sub" }).forEach(([k, v]) => s.setAttribute(k, v)); s.textContent = sub; g.appendChild(s); }
      return g;
    });
    const fg = document.createElementNS(ns, "g"); svg.appendChild(fg);
    fg.innerHTML = `<circle cx="${fill[0]}" cy="${fill[1]}" r="14" class="fill"/><text x="${fill[0]}" y="${fill[1] + 48}" text-anchor="middle" class="fill">补 · 过冲震荡</text><text x="${fill[0]}" y="${fill[1] - 30}" text-anchor="middle" class="sub">为薄弱点补的一站</text>`;
    if (!hasGsap || still) return;
    // the main line draws itself; the detour is dashed, so it is revealed through a mask that draws
    [done, rest].forEach((p) => { const n = p.getTotalLength(); p.style.strokeDasharray = n; p.style.strokeDashoffset = n; });
    const dn = det.getTotalLength(), mask = document.createElementNS(ns, "mask"), mp = document.createElementNS(ns, "path");
    mask.id = "detour-mask";
    Object.entries({ d: det.getAttribute("d"), stroke: "#fff", "stroke-width": 12, fill: "none", "stroke-dasharray": dn, "stroke-dashoffset": dn }).forEach(([k, v]) => mp.setAttribute(k, v));
    mask.appendChild(mp); svg.insertBefore(mask, svg.firstChild); det.setAttribute("mask", "url(#detour-mask)");
    // like the other scenes: the page stops on the route while the scroll draws it, then moves on
    scene($("#route-scene"), (tl) => tl.to(done, { strokeDashoffset: 0, duration: 1, ease: "none" }, 0)
      .from(dots.slice(0, 3), { opacity: 0, scale: .4, transformOrigin: "center", stagger: .3, duration: .3 }, 0)
      .to(rest, { strokeDashoffset: 0, duration: 1, ease: "none" }, 1)
      .from(dots.slice(3), { opacity: 0, scale: .4, transformOrigin: "center", stagger: .3, duration: .3 }, 1.2)
      .to(mp, { attr: { "stroke-dashoffset": 0 }, duration: 1.1, ease: "power1.inOut" }, 2.1)
      .from(fg, { opacity: 0, y: 26, duration: .5, ease: "back.out(2)" }, 2.7)
      .from(".route-notes div", { opacity: 0, y: 20, stagger: .3, duration: .4 }, 1.6), "+=" + 160 + "%");
    gsap.to(pulse, { attr: { r: 34 }, opacity: 0, duration: 1.6, repeat: -1, ease: "power1.out" });
  }

  /* ---------------- 陆: cards fan out of a pile ---------------- */
  async function deck() {
    const host = $("#deck-lt");
    if (!host) return;
    const html = await fragment("ws_cards");
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const n = innerWidth < 760 ? 6 : 12;
    const cards = $$(".lib-card", tmp).slice(0, n).map((c) => { host.appendChild(c); return c; });
    if (!cards.length) return;
    const pos = () => {
      const W = host.clientWidth, cols = W >= 1180 ? 4 : W >= 780 ? 3 : 2, cw = W / cols, rows = Math.ceil(cards.length / cols), ch = Math.min(170, (host.clientHeight - 20) / rows);
      const s = Math.min(1, (cw - 18) / 330);
      return cards.map((_, i) => ({ x: (i % cols - (cols - 1) / 2) * cw, y: (Math.floor(i / cols) - (rows - 1) / 2) * ch, s }));
    };
    const rot = cards.map(() => (Math.random() - .5) * 14);
    if (!hasGsap || still) { const p = pos(); cards.forEach((c, i) => (c.style.transform = `translate(${p[i].x}px,${p[i].y}px) scale(${p[i].s})`)); return; }
    cards.forEach((c, i) => gsap.set(c, { x: (Math.random() - .5) * 30, y: (Math.random() - .5) * 20 - i * 2, rotation: rot[i], scale: .9 }));
    const tl = gsap.timeline({ scrollTrigger: { trigger: "#deck", start: "top 85%", end: "center 25%", scrub: 1, invalidateOnRefresh: true } });
    cards.forEach((c, i) => tl.to(c, { x: () => pos()[i].x, y: () => pos()[i].y, scale: () => pos()[i].s, rotation: 0, duration: 1, ease: "power3.inOut" }, i * .04));
    const fc = $("#flipcard");
    const flip = () => { fc.classList.toggle("on"); fc.setAttribute("aria-pressed", fc.classList.contains("on")); };
    fc.addEventListener("click", flip);
    fc.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
  }

  /* ---------------- 柒: output line by line, and the sandbox ---------------- */
  function runScene() {
    const win = $("#run-win"), ov = $("#run-ov"), a = APPS["run-win"];
    if (!a || !hasGsap) return;
    const ring = el("div", "hl", "", ov);
    const runBtn = () => a.$$("button").find((b) => /^\s*运行\s*$/.test(b.textContent) && visible(b));
    a.ready.then(() => { const b = runBtn(); if (b) { const r = box(b); place(ring, { x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 12 }); } show(); });
    // the output, line by line, and the state saying it runs meanwhile; in the app's own run panel
    const R = { lines: 0, run: 0 };
    function show() {
      if (ScrollTrigger.isRefreshing || !a.doc) return;
      const pre = a.$(".out-text"), state = a.$(".run-state");
      if (pre && !pre.querySelector(".ol")) {
        const text = pre.textContent.replace(/\n$/, "");
        pre.innerHTML = text.split("\n").map((l) => `<span class="ol" style="display:block">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;") || "&nbsp;"}</span>`).join("");
      }
      const ls = pre ? [...pre.querySelectorAll(".ol")] : [], t = R.lines * (.2 + .25 * Math.max(0, ls.length - 1));
      ls.forEach((l, i) => { const o = Math.min(1, Math.max(0, (t - .25 * i) / .2)); Object.assign(l.style, { opacity: o, transform: o < 1 ? `translateX(${(o - 1) * 10}px)` : "" }); });
      if (state) {
        state.dataset.done ||= state.textContent;
        const text = R.run > 0 && R.run < 1 ? "运行中…" : state.dataset.done;
        if (state.textContent !== text) state.textContent = text;
      }
    }
    // the output may come after the app is up
    a.ready.then(() => new MutationObserver(() => { const pre = a.$(".out-text"); if (pre && !pre.querySelector(".ol")) show(); }).observe(a.doc.body, { childList: true, subtree: true }));
    scene($("#run-scene"), (tl) => {
      tl.to(ring, { opacity: 1, duration: .12 }, .05).to(ring, { opacity: 0, scale: 1.1, duration: .25 }, .3);
      tl.to(R, { run: 1, duration: 1.15, ease: "none", onUpdate: show }, .2);
      tl.to(R, { lines: 1, duration: .95, ease: "none", onUpdate: show }, .35);
      steps(tl, $("#run-steps"), [1.8]);
      tl.from(".rings > div", { opacity: 0, scale: .86, stagger: .15, duration: .35, ease: "back.out(1.6)" }, 2.0);
      tl.from(".rings > span", { opacity: 0, y: 8, stagger: .1, duration: .2 }, 2.5);
      tl.to({}, { duration: .4 }, 3.0);
    }, "+=" + 260 + "%");
  }

  /* ---------------- 捌: the history, ticking by ---------------- */
  function gitLog() {
    const ol = $("#log");
    if (!ol) return;
    const LOG = [["a41c2e9", "tutor", "主会话", "建主题「一个数字怎样学习」，写下主干路线"], ["7b03d18", "me", "你", "改了笔记「为什么先猜再看答案」"], ["c9e5a02", "org", "整理", "记下 3 张卡：梯度方向、学习率、过冲震荡"],
      ["3f6d7b1", "flash", "快答", "记下：学习者先要结论再要细节"], ["e8a1904", "tutor", "主会话", "路线上补一站「过冲震荡」"], ["5d2c9fe", "me", "你", "运行 学习率扫描.py"],
      ["0b7e4c3", "org", "整理", "给会话存档：聊到哪、卡在哪、下次从哪接"], ["92fa11d", "tutor", "主会话", "修改建议：在笔记里补一张对比表（已应用）"], ["6c8d2a5", "me", "你", "回顾 5 张卡"],
      ["d17b3e0", "flash", "快答", "在 学习率扫描.py 第 9 行留下问答"], ["4ae9c71", "org", "整理", "把「学习曲线」连到「过拟合」"], ["8f20b6d", "me", "你", "装上技能「费曼讲解」"]];
    const row = ([h, who, name, msg]) => `<li><code>${h}</code><span class="who ${who}">${name}</span><span>${msg}</span><span class="undo">撤销</span></li>`;
    ol.innerHTML = LOG.map(row).join("") + LOG.map(row).join("");
    if (!hasGsap || still) return;
    const half = () => ol.scrollHeight / 2;
    const tick = gsap.to(ol, { y: () => -half(), duration: 36, ease: "none", repeat: -1 });
    ScrollTrigger.create({ trigger: ".log", start: "top bottom", end: "bottom top", onToggle: (s) => (s.isActive ? tick.play() : tick.pause()) });
  }

  /* ---------------- 玖: names going by ---------------- */
  function models() {
    const A = ["DeepSeek", "OpenAI", "Anthropic", "Gemini", "Kimi", "通义千问", "OpenRouter", "智谱 GLM", "豆包", "Mistral", "Groq", "SiliconFlow"];
    const B = ["Ollama", "LM Studio", "vLLM", "LocalRouter", "llama.cpp", "自定义 OpenAI 兼容", "Ollama", "LM Studio", "vLLM"];
    const fill = (e, names, local) => { const h = names.map((n) => `<span${local ? ' class="local"' : ""}>${n}</span>`).join(""); e.innerHTML = h + h; };
    fill($("#mq1"), A); fill($("#mq2"), B, false);
    $$("#mq2 span").forEach((s, i) => i % 3 === 0 && s.classList.add("local"));
    if (hasGsap && !still) {
      const r1 = gsap.to("#mq1", { xPercent: -50, duration: 40, ease: "none", repeat: -1 });
      const r2 = gsap.fromTo("#mq2", { xPercent: -50 }, { xPercent: 0, duration: 34, ease: "none", repeat: -1 });
      ScrollTrigger.create({ trigger: ".marquee", start: "top bottom", end: "bottom top", onUpdate: (s) => {
        const v = Math.min(4, 1 + Math.abs(s.getVelocity()) / 600);
        gsap.to([r1, r2], { timeScale: v, duration: .3, overwrite: true });
        gsap.to([r1, r2], { timeScale: 1, duration: 1, delay: .3 });
      } });
      $$("[data-count]").forEach((b) => {
        const o = { v: 0 };
        gsap.to(o, { v: +b.dataset.count, duration: 1.4, ease: "power2.out", scrollTrigger: { trigger: b, start: "top 85%", once: true }, onUpdate: () => (b.textContent = Math.round(o.v)) });
      });
    }
  }

  /* ---------------- 拾: night spreads from the moon ---------------- */
  function theme() {
    const win = $("#theme-win"), btn = $("#moon"), light = APPS["theme-win"], dark = APPS["theme-dark"];
    if (!light || !dark) return;
    // the night spreads from the app's own moon button, over the light app, as the dark one
    let at = "2.2% 90.5%", r = 0, isDark = false, st = null;
    const clip = () => { dark.frame.style.clipPath = `circle(${r}% at ${at})`; win.classList.toggle("is-dark", isDark); };
    light.ready.then(() => {
      const m = light.$$('[data-action="theme"]').find(visible);
      if (m) { const b = box(m); at = `${((b.x + b.w / 2) / 16).toFixed(2)}% ${((b.y + b.h / 2) / 10).toFixed(2)}%`; clip(); }
    });
    clip();
    const label = () => { btn.querySelector("span").textContent = isDark ? "换回白天" : "换成夜里"; btn.setAttribute("aria-pressed", isDark); };
    if (hasGsap && !still) {
      st = ScrollTrigger.create({ trigger: win, start: "top 70%", end: "center 50%", scrub: 1, onUpdate: (s) => {
        r = s.progress * 150; isDark = s.progress > .5; clip(); label();
      } });
    }
    btn.addEventListener("click", () => {
      if (st) { st.kill(); st = null; }
      isDark = !isDark; label();
      if (hasGsap) { const o = { r }; gsap.to(o, { r: isDark ? 150 : 0, duration: 1.1, ease: "power3.inOut", onUpdate: () => { r = o.r; clip(); } }); }
      else { r = isDark ? 150 : 0; clip(); }
    });
  }

  /* ---------------- the windows' apps: loaded as the page nears them, and the wheel ---------------- */
  function live() {
    if (!window.LatticeDemo) return;
    // over a window the wheel still moves the page, until the window is clicked into
    LatticeDemo.wheel = (dy) => (lenis ? lenis.scrollTo(lenis.targetScroll + dy) : scrollBy(0, dy));
    LatticeDemo.engaged = (inner, on) => apps.filter((x) => x.frame.contentWindow === inner).forEach((x) => x.win.classList.toggle("engaged", on));
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && apps.filter((x) => x.win === e.target).forEach((x) => x.load())), { rootMargin: "150% 0px" });
    wins.forEach((w) => io.observe(w));
  }

  /* ---------------- download ---------------- */
  function downloads() {
    const ua = navigator.userAgent, plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    const os = /win/i.test(plat) || /Windows/.test(ua) ? "windows" : /mac/i.test(plat) || /Mac OS X/.test(ua) ? "mac" : /linux/i.test(plat) && !/Android/.test(ua) ? "linux" : null;
    const names = { windows: "Windows", mac: "macOS", linux: "Linux" };
    if (os) {
      const card = $("#os-" + os);
      card.classList.add("mine"); $(".here", card).hidden = false; card.parentNode.prepend(card);
      $("#cta-label").textContent = "下载 " + names[os] + " 版";
      $("#cta").href = $("a", card).href;
    }
    fetch("https://api.github.com/repos/vimalinx/lattice/releases/latest").then((r) => (r.ok ? r.json() : null)).then((rel) => {
      if (!rel || !rel.assets) return;
      $("#version").textContent = String(rel.tag_name || "").replace(/^v/, "") || "0.3.3";
      $$("a[data-asset]").forEach((a) => {
        const asset = rel.assets.find((x) => x.name.endsWith(a.dataset.asset));
        if (!asset) return;
        a.href = asset.browser_download_url;
        $("small", a).textContent = $("small", a).textContent.split(" ")[0] + " · " + Math.round(asset.size / 1048576) + " MB";
      });
      if (os) $("#cta").href = $("#os-" + os + " a").href;
    }).catch(() => {});
    if (hasGsap && !still) gsap.from(".os", { y: 40, opacity: 0, stagger: .12, duration: .8, ease: "power3.out", scrollTrigger: { trigger: "#oses", start: "top 85%", once: true } });
  }

  /* ---------------- any app frame opens large ---------------- */
  // The corner piece at a window's top right opens it big: the same app, in the working state it is in.
  function zoom() {
    const dlg = $("#zoom");
    wins.forEach((w) => {
      const b = el("button", "win-max", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>', w);
      b.type = "button"; b.title = "放大看"; b.setAttribute("aria-label", "放大看");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const a = APPS[w.id], space = a?.$("#status .st-tab.on")?.textContent.trim() || w.dataset.space;
        const c = el("div", "win zoom-live", '<div class="scale"></div>');
        const f = el("iframe", "live-app", "", $(".scale", c));
        f.title = "Lattice（可以直接用的演示）";
        f.src = appUrl(space, { dark: w.classList.contains("is-dark") });
        f.addEventListener("load", () => { const t = setInterval(() => { if (f.contentDocument?.querySelector("#status .st-tab")) { clearInterval(t); f.classList.add("up"); } }, 80); }, { once: true });
        dlg.replaceChildren(c);
        dlg.showModal && dlg.showModal();
        requestAnimationFrame(() => fit(c));
      });
    });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }
})();
