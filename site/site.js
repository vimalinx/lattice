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
    ? new Lenis({ lerp: .08, wheelMultiplier: .85, anchors: true, autoRaf: false })
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

  /* ---------------- the app in frames ---------------- */
  const cache = {};
  const fragment = (name) => (cache[name] ||= fetch("ui/" + name + ".htm").then((r) => (r.ok ? r.text() : "")).catch(() => ""));
  const fit = (win) => win.style.setProperty("--k", win.clientWidth / 1600);
  const ro = new ResizeObserver((es) => es.forEach((e) => fit(e.target)));
  async function mount(win) {
    const names = win.dataset.layers.split(/\s+/), scale = $(".scale", win), ov = $(".ov", scale);
    const htmls = await Promise.all(names.map(fragment));
    names.forEach((name, i) => {
      const layer = document.createElement("div");
      layer.className = "layer";
      layer.dataset.layer = name;
      layer.innerHTML = htmls[i];
      scale.insertBefore(layer, ov || null);
    });
    fit(win);
    ro.observe(win);
    restoreScroll(win);
  }
  // The dumps keep each panel's scroll offset in data-st / data-sl.
  const restoreScroll = (root) => $$("[data-st],[data-sl]", root).forEach((e) => { e.scrollTop = +(e.dataset.st || 0); e.scrollLeft = +(e.dataset.sl || 0); });
  const layer = (win, name) => $(`.layer[data-layer="${name}"]`, win);
  // An element's box in the frame's own 1600x1000 coordinates (measured before anything tilts the frame).
  function box(el, win) {
    const r = el.getBoundingClientRect(), s = $(".scale", win).getBoundingClientRect(), k = s.width / 1600;
    return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k };
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

  /* ---------------- the relations graph, drawn here (the dumps can't carry cytoscape's canvas) ---------------- */
  // x is a share of the width, y a row in a 340-high frame; the loop runs L → G → S → U → P → R → L
  const GRAPH = {
    nodes: [["L", "损失函数 L(p)", .7, 290, "#1b7868", true], ["G", "梯度 ∂L/∂p", .3, 290, "#6b57b8"], ["E", "学习率 η", .12, 50, "#8a6a1f"],
      ["S", "实际步长 η·∂L/∂p", .45, 170, "#8a6a1f"], ["U", "更新 p←p−η·∂L/∂p", .52, 50, "#1f5fa8"], ["P", "新参数 p", .87, 50, "#b05855"], ["R", "重算损失和梯度", .85, 170, "#1b7868"]],
    // [from, to, label, colour, dash, where along the edge the label sits]
    edges: [["L", "G", "求导得到", "#a87e00"], ["G", "S", "提供方向", "#1b7868"], ["E", "S", "提供幅度", "#1b7868"], ["S", "U", "", "#5b6b70", "2 5"], ["U", "P", "变成", "#5b6b70"],
      ["P", "R", "", "#a87e00"], ["R", "L", "下一轮", "#5b6b70", "6 5"], ["E", "G", "算出来的 vs 定好的", "#b05855", "6 5", .42]],
  };
  const measure = document.createElement("canvas").getContext("2d");
  // the colour behind the canvas, so a box can hide the lines under it
  const ground = (e) => {
    for (; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && c !== "transparent" && !/,\s*0\)$/.test(c)) return c; }
    return "#fff";
  };
  let graphs = 0;
  function drawGraph(host) {
    host.innerHTML = "";
    const tag = "ah" + graphs++ + "-";
    const W = host.clientWidth || 940, H = host.clientHeight || 340, sy = H / 340, HH = 17, bg = ground(host);
    measure.font = `600 13.5px ${getComputedStyle(host).fontFamily}`;
    const at = Object.fromEntries(GRAPH.nodes.map(([id, label, fx, y]) => {
      const w = Math.ceil(measure.measureText(label).width) + 28;
      return [id, { x: Math.min(W - w / 2 - 6, Math.max(w / 2 + 6, fx * W)), y: y * sy, w }];
    }));
    // where the line from a box's centre toward (tx, ty) leaves the box, a few px out
    const rim = (n, tx, ty, gap) => {
      const dx = tx - n.x, dy = ty - n.y, len = Math.hypot(dx, dy) || 1;
      const t = Math.min((n.w / 2) / (Math.abs(dx) || 1e-9), HH / (Math.abs(dy) || 1e-9));
      return [n.x + dx * t + (dx / len) * gap, n.y + dy * t + (dy / len) * gap];
    };
    const colours = [...new Set(GRAPH.edges.map((e) => e[3]))];
    let svg = `<svg class="relg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="position:absolute;inset:0"><defs>` +
      colours.map((c, i) => `<marker id="${tag}${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="${c}"/></marker>`).join("") + "</defs>";
    const labels = [];
    for (const [a, b, label, c, dash, along = .5] of GRAPH.edges) {
      const A = at[a], B = at[b], [x1, y1] = rim(A, B.x, B.y, 3), [x2, y2] = rim(B, A.x, A.y, 4);
      svg += `<g class="ge"><path d="M${x1} ${y1} L${x2} ${y2}" stroke="${c}" stroke-width="1.8" fill="none" ${dash ? `stroke-dasharray="${dash}"` : ""} marker-end="url(#${tag}${colours.indexOf(c)})"/></g>`;
      if (label) labels.push(`<text x="${x1 + (x2 - x1) * along}" y="${y1 + (y2 - y1) * along + 4}" text-anchor="middle" font-size="12" fill="#5b6b70" stroke="${bg}" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${label}</text>`);
    }
    for (const [id, label, , , c, main] of GRAPH.nodes) {
      const { x, y, w } = at[id];
      svg += `<g class="gn" style="transform-origin:${x}px ${y}px"><rect x="${x - w / 2}" y="${y - HH}" width="${w}" height="${HH * 2}" rx="8" fill="${bg}"/><rect x="${x - w / 2}" y="${y - HH}" width="${w}" height="${HH * 2}" rx="8" fill="${c}1c" stroke="${c}" stroke-width="${main ? 3 : 1.6}"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-size="13.5" font-weight="600" fill="#16262b">${label}</text></g>`;
    }
    host.insertAdjacentHTML("beforeend", svg + labels.join("") + "</svg>");
    return $("svg", host);
  }
  const mountGraphs = (root) => $$(".rel-canvas", root).map((c) => { c.style.position = "relative"; return drawGraph(c); });

  /* ---------------- frames mounted, then everything that moves ---------------- */
  const wins = $$(".win[data-layers]");
  Promise.all(wins.map(mount)).then(() => document.fonts.ready).then(() => {
    wins.forEach((w) => mountGraphs(w));
    // the dark copy's graph reads on dark
    $$('.layer[data-layer="hero_dark"] .relg text').forEach((t) => t.setAttribute("fill", "#e7edf2"));
    setup();
  });

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
    // pinning moves sections into a wrapper, and a moved node forgets where its panels were scrolled
    wins.forEach(restoreScroll);
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
    const win = $("#hero-win"), L = layer(win, "hero"), ov = $("#hero-ov");
    if (!L) return;
    const stacks = $$(".stack", L).filter(visible);
    const tag = (title, sub, x, y, ai) => {
      const t = el("div", "tagline" + (ai ? " ai" : ""), `<i></i>${title}<small>${sub}</small>`, ov);
      Object.assign(t.style, { left: x + "px", top: y + "px" });
      return t;
    };
    const s = stacks.map((st) => box(st, win));
    const tags = [
      tag("文件", "按主题和会话找", 120, 560),
      s[0] && tag("主会话", "讲解、画图、出小实验", s[0].x + s[0].w - 280, s[0].y + 150),
      s[1] && tag("快答", "小问题，不打断主讲", s[1].x + 95, s[1].y + 340, true),
      s[2] && tag("卡片库", "讲过的自动记成卡", s[2].x + 40, s[2].y + 190),
      tag("工作状态", "底栏一点，换整套窗口", 40, 905),
    ].filter(Boolean);
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

  function tabsScene() {
    const win = $("#tabs-win"), L = layer(win, "hero"), ov = $("#tabs-ov"), list = $("#wslist");
    if (!L || !hasGsap) return;
    WORKSPACES.forEach(([name, , desc], i) => el("button", i ? "" : "on", `<span>0${i + 1}</span><b>${name}</b><small>${desc}</small>`, list).type = "button");
    const pieces = [[$('[data-id="activity"]', L), -46, 0, ""], [$('[data-id="side"]', L), -22, 0, "活动栏和左栏"], ...$$(".stack", L).filter(visible).map((s, i) => [s, i ? 34 : 0, i === 1 ? -26 : i === 2 ? 26 : -10, ["一组标签：主会话 · 代码 · 笔记", "快答", "卡片库 · 记忆"][i]]),
      [$('[data-id="status"]', L), 0, 34, "底栏：工作状态"]].filter((p) => p[0]);
    const K = .82, C = { x: 800, y: 500 };
    // the pieces may leave the boxes that held them
    [$('[data-id="app"]', L), $('[data-id="shell"]', L), $('[data-id="dock-wrap"]', L), $('[data-id="dock"]', L), ...$$(".split", L)].filter(Boolean).forEach((e) => (e.style.overflow = "visible"));
    const labels = pieces.filter((p) => p[3]).map(([e, dx, dy, name]) => {
      const b = box(e, win), t = el("div", "tagline", `<i></i>${name}`, ov);
      const x = C.x + (b.x + dx - C.x) * K, y = C.y + (b.y + dy - C.y) * K;
      Object.assign(t.style, { left: x + 14 + "px", top: y + (/底栏/.test(name) ? -58 : 14) + "px" });
      return t;
    });
    const layers = WORKSPACES.map(([, n]) => layer(win, n));
    // what the pieces stand on goes clear while they are apart, then comes back as it was
    const grounds = [$(".app-frame", L), $('[data-id="app"]', L), $('[data-id="shell"]', L), $('[data-id="dock-wrap"]', L), $('[data-id="dock"]', L)].filter(Boolean).map((e) => [e, getComputedStyle(e).backgroundColor]);
    const T0 = 2.0, STEP = .62;
    const tl = scene($("#tabs-scene"), (tl) => {
      tl.to(L, { scale: K, duration: .5, ease: "power2.inOut", transformOrigin: "50% 50%" }, .1);
      tl.to(win, { backgroundColor: "rgba(253,253,249,0)", boxShadow: "0 0 0 0 rgba(22,38,43,0)", duration: .4 }, .1);
      grounds.forEach(([e]) => tl.to(e, { backgroundColor: "rgba(0,0,0,0)", duration: .4 }, .1));
      pieces.forEach(([e, dx, dy], i) => tl.to(e, { x: dx, y: dy, borderRadius: 12, boxShadow: "0 0 0 2px rgba(27,120,104,1), 0 30px 60px -26px rgba(22,38,43,.55)", duration: .5, ease: "power2.out" }, .2 + i * .05));
      tl.to(labels, { opacity: 1, y: -6, stagger: .05, duration: .25 }, .65);
      tl.to(labels, { opacity: 0, duration: .2 }, 1.3);
      pieces.forEach(([e]) => tl.to(e, { x: 0, y: 0, borderRadius: 0, boxShadow: "0 0 0 0px rgba(27,120,104,0), 0 0px 0px 0px rgba(22,38,43,0)", duration: .4, ease: "power2.inOut" }, 1.35));
      tl.to(L, { scale: 1, duration: .4, ease: "power2.inOut" }, 1.35);
      tl.to(win, { backgroundColor: "rgba(253,253,249,1)", boxShadow: "0 30px 80px -30px rgba(22,38,43,.38)", duration: .4 }, 1.35);
      grounds.forEach(([e, bg]) => tl.to(e, { backgroundColor: bg, duration: .4 }, 1.35));
      steps(tl, $("#tabs-steps"), [1.5]);
      layers.slice(1).forEach((ly, i) => {
        tl.fromTo(ly, { opacity: 0, scale: 1.015 }, { opacity: 1, scale: 1, duration: .3, ease: "power1.inOut" }, T0 + i * STEP);
      });
      tl.to({}, { duration: .5 }, T0 + 6 * STEP);
    }, "+=" + 630 + "%");
    // which workspace is showing, for the list beside it
    const btns = $$("button", list);
    const sync = () => {
      const t = tl.time(), i = t < T0 + .15 ? 0 : Math.min(6, Math.floor((t - T0 - .15) / STEP) + 1);
      btns.forEach((b, j) => b.classList.toggle("on", j === i));
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
    if (hasGsap && !still) ScrollTrigger.create({ trigger: board, start: "top 60%", once: true, onEnter: demo });

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
    const win = $("#ctx-win"), L = layer(win, "hero"), ov = $("#ctx-ov");
    if (!L || !hasGsap) return;
    const tabs = $$(".tab", L).filter(visible).filter((t) => !t.classList.contains("tab-add"));
    const flash = $$(".stack", L).filter(visible)[1];
    const fb = flash ? box(flash, win) : { x: 1086, y: 0, w: 500, h: 600 };
    const cat = el("div", "catalog", `<div class="head">${ICON.spark.replace("<svg", '<svg width="16" height="16"')}这一问附带的标签目录</div>`, ov);
    Object.assign(cat.style, { left: fb.x + fb.w - 700 + "px", top: fb.y + 70 + "px", width: "680px" });
    const rows = tabs.map((t, i) => {
      const title = ($(".tab-title", t) || t).textContent.trim().replace(/\s+/g, " ");
      const r = el("div", "row" + (/主会话/.test(title) ? " using" : t.classList.contains("active") ? " front" : ""), `<span class="k">t${i + 1}</span><span>${kindOf(title)}</span><span>${title}</span>`, cat);
      return r;
    });
    const strong = $$(".msg-body strong", L).find((s) => /梯度管方向/.test(s.textContent));
    const sel = el("div", "sel", `<span class="k">选中 </span><b>“梯度管方向，学习率管步长。”</b> <span class="k">· t1 主会话</span>`, cat);
    const code = tabs.find((t) => /\.py/.test(t.textContent));
    const tool = el("div", "tool", ICON.doc + `读了 <b style="color:#16262b">t${tabs.indexOf(code) + 1} · 学习率扫描.py</b>　全文 12 行`, cat);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "beams"); svg.setAttribute("viewBox", "0 0 1600 1000");
    ov.insertBefore(svg, cat);
    const beam = (from, to) => {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", `M${from.x} ${from.y} C${from.x} ${from.y + 160}, ${to.x - 200} ${to.y}, ${to.x} ${to.y}`);
      svg.appendChild(p);
      return p;
    };
    const rowAt = (r) => ({ x: cat.offsetLeft, y: cat.offsetTop + r.offsetTop + r.offsetHeight / 2 });
    const hls = tabs.map((t) => { const b = box(t, win), h = el("div", "hl" + (/快答/.test(t.textContent) ? " ai" : ""), "", ov); place(h, { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 }); return h; });
    const beams = tabs.map((t, i) => { const b = box(t, win); return beam({ x: b.x + b.w / 2, y: b.y + b.h }, rowAt(rows[i])); });
    let selBox = null, selBeam = null;
    if (strong) {
      const b = box(strong, win);
      selBox = el("div", "selbox", "", ov); place(selBox, { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 });
      selBeam = beam({ x: b.x + b.w / 2, y: b.y + b.h + 4 }, rowAt(sel));
    }
    const codeHl = code && hls[tabs.indexOf(code)], toolBeam = code && beam((() => { const b = box(code, win); return { x: b.x + b.w / 2, y: b.y + b.h }; })(), rowAt(tool));
    [...beams, selBeam, toolBeam].filter(Boolean).forEach((p) => { const n = p.getTotalLength(); p.style.strokeDasharray = n; p.style.strokeDashoffset = n; });
    // at the end the "read" line leaves the catalog and lands in the quick answer, as the step it shows there
    const composer = flash && $(".composer", flash), cb = composer ? box(composer, win) : { x: fb.x + 20, y: fb.y + fb.h - 120, w: fb.w - 40, h: 90 };
    const flyer = el("div", "tool-fly", tool.innerHTML, ov);
    const from = { x: cat.offsetLeft + tool.offsetLeft, y: cat.offsetTop - 6 + tool.offsetTop };
    Object.assign(flyer.style, { left: from.x + "px", top: from.y + "px", width: tool.offsetWidth + "px" });
    // question, then the read, then the answer: the conversation moves up, the line lands under the last question,
    // and the answer comes in below it. Measured when it plays, after the panels' scroll is restored.
    const scroller = flash && $(".chat-scroll", flash), lastQ = flash && $$(".msg.from-me", flash).pop();
    const answer = lastQ && lastQ.nextElementSibling;
    // measured when it first plays, not while the page refreshes (pinning lays things out oddly then), less any lift already applied
    let geo = null;
    const measure = () => {
      const q = lastQ ? box(lastQ, win) : { y: cb.y - 140, h: 40 }, qy = q.y - (lastQ ? +gsap.getProperty(lastQ, "y") : 0);
      // enough room for the answer to come in under the line, above the composer
      const a = answer && box(answer, win), ay = a ? a.y - +gsap.getProperty(answer, "y") : 0;
      const lift = Math.max(0, a ? ay + a.h + 46 - cb.y + 10 : qy + q.h + 110 - cb.y);
      geo = { lift, x: fb.x + 22 - from.x, y: qy + q.h - lift + 14 - from.y };
    };
    ScrollTrigger.addEventListener("refresh", () => { geo = null; });
    const fly = { p: 0, lift: 0, a: 0 };
    const apply = () => {
      if (ScrollTrigger.isRefreshing) return;
      if (!geo) measure();
      if (scroller) gsap.set([...scroller.children].filter((c) => c !== answer), { y: -geo.lift * fly.lift });
      if (answer) gsap.set(answer, { y: -geo.lift * fly.lift + 16 + 30 * fly.a, opacity: fly.a });
      gsap.set(flyer, { x: geo.x * fly.p, y: geo.y * fly.p, scale: 1 - .3 * fly.p });
    };
    if (answer) gsap.set(answer, { opacity: 0 });
    const paneRing = el("div", "hl ai", "", ov); place(paneRing, { x: fb.x + 4, y: fb.y + 4, w: fb.w - 8, h: fb.h - 8 });
    scene($("#ctx-scene"), (tl) => {
      tl.to(cat, { opacity: 1, y: -6, duration: .3 }, .1);
      tabs.forEach((t, i) => {
        const at = .35 + i * .3;
        tl.to(hls[i], { opacity: 1, duration: .12 }, at);
        tl.to(beams[i], { opacity: .9, strokeDashoffset: 0, duration: .25, ease: "power1.inOut" }, at + .02);
        tl.to(rows[i], { opacity: 1, duration: .12 }, at + .2);
        tl.to([hls[i], beams[i]], { opacity: 0, duration: .15 }, at + .4);
      });
      const t2 = .5 + tabs.length * .3;
      steps(tl, $("#ctx-steps"), [t2 - .1, t2 + 1.1]);
      if (selBox) {
        tl.to(selBox, { scaleX: 1, duration: .45, ease: "power2.inOut" }, t2 + .1);
        tl.to(selBeam, { opacity: .9, strokeDashoffset: 0, duration: .3 }, t2 + .5);
        tl.to(sel, { opacity: 1, duration: .15 }, t2 + .75);
        tl.to(selBeam, { opacity: 0, duration: .2 }, t2 + 1.05);
      }
      if (code) {
        tl.to(codeHl, { opacity: 1, duration: .12 }, t2 + 1.35);
        tl.to(toolBeam, { opacity: .9, strokeDashoffset: 0, duration: .3 }, t2 + 1.4);
        tl.to(tool, { opacity: 1, duration: .15 }, t2 + 1.7);
      }
      const t3 = t2 + 2.1;
      tl.to(flyer, { opacity: 1, duration: .01 }, t3).to(tool, { opacity: 0, duration: .01 }, t3);
      tl.to([cat, codeHl].filter(Boolean), { opacity: 0, scale: .97, duration: .35, ease: "power1.in" }, t3 + .05);
      if (toolBeam) tl.to(toolBeam, { opacity: 0, duration: .2 }, t3 + .05);
      tl.to(fly, { lift: 1, duration: .6, ease: "power2.inOut", onUpdate: apply }, t3 + .2);
      tl.to(fly, { p: 1, duration: .75, ease: "power2.inOut", onUpdate: apply }, t3 + .1);
      tl.to(fly, { a: 1, duration: .35, onUpdate: apply }, t3 + 1.05);
      tl.to(flyer, { boxShadow: "0 0 0 2px #6b57b8", duration: .2 }, t3 + .8);
      tl.to(paneRing, { opacity: 1, duration: .15 }, t3 + .8).to(paneRing, { opacity: 0, duration: .4 }, t3 + 1.15);
      tl.to({}, { duration: .4 }, t3 + 1.55);
    }, "+=" + 660 + "%");
  }

  /* ---------------- 叁: select, ask, and what stays ---------------- */
  function flashScene() {
    const win = $("#flash-win"), L = layer(win, "ws_work"), A = layer(win, "asked"), ov = $("#flash-ov");
    if (!L || !hasGsap) return;
    const mark = $$(".lmark-ask", L).find(visible);
    const flashPanel = $$(".panel-chat", L).find(visible);
    const msgs = flashPanel ? $$(".msg", flashPanel) : [];
    const [qMsg, aMsg] = msgs.slice(-2);
    const mb = mark ? box(mark, win) : { x: 300, y: 520, w: 150, h: 26 };
    const selBox = el("div", "selbox", "", ov); place(selBox, { x: mb.x - 3, y: mb.y - 3, w: mb.w + 6, h: mb.h + 6 });
    const pop = el("div", "selpop", `<span>${ICON.spark}问快答</span><span>${ICON.bot}问主会话</span>`, ov);
    Object.assign(pop.style, { left: mb.x + "px", top: mb.y - 62 + "px" });
    const ring = el("div", "hl ai", "", ov); place(ring, { x: mb.x - 8, y: mb.y - 6, w: mb.w + 16, h: mb.h + 12 });
    if (qMsg) gsap.set([qMsg, aMsg], { opacity: 0 });
    scene($("#flash-scene"), (tl) => {
      tl.to(selBox, { scaleX: 1, duration: .45, ease: "power2.inOut" }, .1);
      tl.fromTo(pop, { opacity: 0, y: 10, scale: .96 }, { opacity: 1, y: 0, scale: 1, duration: .2 }, .55);
      tl.to(pop.firstChild, { scale: 1.06, duration: .1, yoyo: true, repeat: 1 }, .85);
      steps(tl, $("#flash-steps"), [1.0, 2.3]);
      tl.to([pop, selBox], { opacity: 0, duration: .15 }, 1.05);
      if (qMsg) {
        tl.fromTo(qMsg, { opacity: 0, y: 24, scale: .96 }, { opacity: 1, y: 0, scale: 1, duration: .25, transformOrigin: "100% 100%" }, 1.15);
        tl.fromTo(aMsg, { opacity: 1, clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)", duration: .8, ease: "none" }, 1.45);
      }
      tl.to(ring, { opacity: 1, duration: .15 }, 2.45);
      tl.to(ring, { scale: 1.08, opacity: 0, duration: .3 }, 2.65);
      tl.to(A, { opacity: 1, duration: .35 }, 2.8);
      tl.to({}, { duration: .5 }, 3.2);
    }, "+=" + 450 + "%");
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
      .from(".route-notes div", { opacity: 0, y: 20, stagger: .3, duration: .4 }, 1.6), "+=" + 240 + "%");
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
    const win = $("#run-win"), L = layer(win, "ws_work"), ov = $("#run-ov");
    if (!L || !hasGsap) return;
    const pre = $(".out-text", L), state = $(".run-state", L), runBtn = $$("button", L).find((b) => /运行/.test(b.textContent) && visible(b));
    let lines = [];
    if (pre) {
      const text = pre.textContent.replace(/\n$/, "");
      pre.innerHTML = text.split("\n").map((l) => `<span class="ol" style="display:block">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;") || "&nbsp;"}</span>`).join("");
      lines = $$(".ol", pre);
    }
    const ring = runBtn ? (() => { const b = box(runBtn, win), h = el("div", "hl", "", ov); place(h, { x: b.x - 6, y: b.y - 6, w: b.w + 12, h: b.h + 12 }); return h; })() : null;
    const done = state ? state.textContent : "";
    gsap.set(lines, { opacity: 0, x: -10 });
    scene($("#run-scene"), (tl) => {
      if (ring) tl.to(ring, { opacity: 1, duration: .12 }, .05).to(ring, { opacity: 0, scale: 1.1, duration: .25 }, .3);
      if (state) tl.call(() => { state.textContent = "运行中…"; }, null, .2).call(() => { state.textContent = done; }, null, 1.35);
      tl.to(lines, { opacity: 1, x: 0, stagger: .25, duration: .2 }, .35);
      steps(tl, $("#run-steps"), [1.8]);
      tl.from(".rings > div", { opacity: 0, scale: .86, stagger: .15, duration: .35, ease: "back.out(1.6)" }, 2.0);
      tl.from(".rings > span", { opacity: 0, y: 8, stagger: .1, duration: .2 }, 2.5);
      tl.to({}, { duration: .4 }, 3.0);
      // a state reached by scrolling back up
      tl.eventCallback("onReverseComplete", () => state && (state.textContent = done));
    }, "+=" + 390 + "%");
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
    const win = $("#theme-win"), dark = layer(win, "hero_dark"), light = layer(win, "hero"), btn = $("#moon");
    if (!dark) return;
    dark.classList.add("dark-layer");
    const moon = $$('[data-action="theme"]', light).find(visible);
    const at = moon ? (() => { const b = box(moon, win); return `${((b.x + b.w / 2) / 16).toFixed(2)}% ${((b.y + b.h / 2) / 10).toFixed(2)}%`; })() : "2.2% 90.5%";
    const clip = (r) => `circle(${r}% at ${at})`;
    dark.style.clipPath = clip(0);
    let isDark = false, st = null;
    const label = () => { btn.querySelector("span").textContent = isDark ? "换回白天" : "换成夜里"; btn.setAttribute("aria-pressed", isDark); };
    if (hasGsap && !still) {
      const o = { r: 0 };
      st = ScrollTrigger.create({ trigger: win, start: "top 70%", end: "bottom 35%", scrub: 1, onUpdate: (s) => {
        o.r = s.progress * 150; dark.style.clipPath = clip(o.r); isDark = s.progress > .5; label();
      } });
    }
    btn.addEventListener("click", () => {
      if (st) { st.kill(); st = null; }
      isDark = !isDark; label();
      const from = parseFloat((dark.style.clipPath.match(/circle\(([\d.]+)%/) || [0, 0])[1]);
      if (hasGsap) { const o = { r: from }; gsap.to(o, { r: isDark ? 150 : 0, duration: 1.1, ease: "power3.inOut", onUpdate: () => (dark.style.clipPath = clip(o.r)) }); }
      else dark.style.clipPath = clip(isDark ? 150 : 0);
    });
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
  // A click inside a window stays in it; the corner piece at its top right is what enlarges it.
  function zoom() {
    const dlg = $("#zoom");
    $$(".win[data-layers]").forEach((w) => {
      const b = el("button", "win-max", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>', w);
      b.type = "button"; b.title = "放大看"; b.setAttribute("aria-label", "放大看");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const c = w.cloneNode(true);
        c.removeAttribute("id"); c.style.transform = "none";
        $(".win-max", c)?.remove();
        dlg.replaceChildren(c);
        dlg.showModal && dlg.showModal();
        requestAnimationFrame(() => { fit(c); restoreScroll(c); });
      });
    });
    dlg.addEventListener("click", () => dlg.close());
  }
})();
