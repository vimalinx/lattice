/* In place of Qt's web channel: this page's backend is the demo's (backend.js). Inside the site it is the page's one
   shared demo, so every window sees the same files and conversations; opened on its own, it brings its own.
   ?space= picks the working state the window opens in, ?theme= its look, ?run= a file it runs once open, ?key= whose
   work it keeps (the window's; one opened big passes its window's). */
(() => {
  "use strict";
  const q = new URLSearchParams(location.search), opts = { space: q.get("space"), theme: q.get("theme"), key: q.get("key") };
  let host = null;
  try { host = window.parent !== window && window.parent.LatticeDemo ? window.parent : null; } catch (_) {}
  window.qt = { webChannelTransport: {} };
  window.QWebChannel = function (_transport, ready) {
    const go = (w) => ready({ objects: { backend: w.LatticeDemo.connect(window, opts) } });
    if (host) return go(host);
    const s = document.createElement("script");
    s.src = "demo/backend.js";
    s.onload = () => go(window);
    document.head.appendChild(s);
  };
  // the app's modules as it runs them, for the page around it (its scroll scenes play on this app)
  window.latticeModule = (name) => import(new URL(name + ".js", location.href).href);
  // ?run=<path>: run that file once it is open, so its run panel shows the output, as the window showed it before
  const runPath = q.get("run");
  if (runPath) {
    const t = setInterval(() => {
      if (!document.querySelector("#status")) return;
      clearInterval(t);
      import(new URL("files.js", location.href).href).then((F) => setTimeout(() => F.runPath(runPath), 400)).catch(() => {});
    }, 200);
  }
  if (!host) return;

  // The wheel moves the site, not this window, until the window is clicked into; leaving it gives the wheel back.
  let engaged = false;
  addEventListener("pointerdown", () => { engaged = true; host.LatticeDemo.engaged?.(window, true); }, true);
  document.documentElement.addEventListener("mouseleave", () => { engaged = false; host.LatticeDemo.engaged?.(window, false); });
  addEventListener("wheel", (e) => {
    if (engaged || e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    host.LatticeDemo.wheel?.(e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? innerHeight : 1));
  }, { capture: true, passive: false });
})();
