"""Run Lattice offscreen on the promo demo home, log every rpc call (method, arguments, answer) and every event, and take
JavaScript to run in its page from a folder. What it logs is what tools/demo/build.py makes the site's demo from.

    python ~/Projects/Lattice-promo/capture/seed_promo.py <home>          # the demo vault
    QT_QPA_PLATFORM=offscreen python tools/demo/record.py <home> <cmd-dir> <calls.jsonl> &
    python tools/demo/send.py <cmd-dir> @tools/demo/setup.js               # the seven working states, once
    python tools/demo/send.py <cmd-dir> @tools/demo/ask.js                 # two questions on line 9, once
    python tools/demo/send.py <cmd-dir> @tools/demo/explore.js             # every file, thread and skill read
    python tools/demo/send.py <cmd-dir> @tools/demo/panels.js              # a run, searches, every kind of panel
    python tools/demo/build.py <calls.jsonl> <home>

setup.js and ask.js change the vault; record a fresh log after them (restart this), so the demo starts from the
finished setup. The vault also needs code/学习率扫描.py and the note on guessing first (see the site's ui/ws_work.htm and
ui/ws_write.htm), and the quick answer's two answers written after its questions, which a demo key cannot fetch.
"""
import functools, json, os, sys, time
from pathlib import Path

DEMO, CMD, LOGF = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), Path(sys.argv[3]).resolve()
os.environ["XDG_DATA_HOME"] = str(DEMO / "data")
os.environ["XDG_CONFIG_HOME"] = str(DEMO / "config")
os.environ["LATTICE_VAULT"] = str(DEMO / "vault")
LATTICE = Path.home() / "Projects/Lattice"
sys.path.insert(0, str(LATTICE))
os.chdir(LATTICE)

from lattice.bridge import core
LOG = open(LOGF, "a")
def log(rec):
    LOG.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n"); LOG.flush()
for name in dir(core.Bridge):
    if name.startswith("rpc_"):
        f = getattr(core.Bridge, name)
        def wrap(f=f, m=name[4:]):
            @functools.wraps(f)
            def g(self, **kw):
                t = time.time()
                try:
                    out = f(self, **kw)
                except Exception as e:
                    log({"m": m, "a": kw, "err": str(e), "t": t}); raise
                log({"m": m, "a": kw, "d": out, "t": t})
                return out
            return g
        setattr(core.Bridge, name, wrap())
_ann = core.Bridge.announce
def announce(self, data):
    log({"evt": data, "t": time.time()}); return _ann(self, data)
core.Bridge.announce = announce

from PySide6.QtCore import QTimer, Qt
from PySide6.QtWidgets import QApplication
QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
from main import MainWindow

CMD.mkdir(exist_ok=True)
app = QApplication([])
w = MainWindow(screenshot=None)
w.resize(1600, 1000)
w.show()
busy = {"n": None}

def finish(n, out, shot=None):
    if shot: w.view.grab().save(str(CMD.parent / f"{shot}.png"))
    (CMD / f"{n}.out").write_text(str(out)); (CMD / f"{n}.json").rename(CMD / f"{n}.done"); busy["n"] = None

def poll(n, wait, tries=0, shot=None):
    def got(v):
        if v in (None, "") and tries < 600: QTimer.singleShot(100, lambda: poll(n, wait, tries + 1, shot))
        else: QTimer.singleShot(wait, lambda: finish(n, v, shot))
    w.page.runJavaScript("window.__out", got)

def tick():
    if busy["n"] is None:
        jobs = sorted(CMD.glob("*.json"), key=lambda p: int(p.stem))
        if jobs:
            job = jobs[0]; n = job.stem; spec = json.loads(job.read_text())
            if spec.get("quit"): app.quit(); return
            busy["n"] = n
            code = "window.__out=null;(async()=>{" + (spec.get("js") or "return null") + "})().then(r=>{window.__out=JSON.stringify(r===undefined?null:r)}).catch(e=>{window.__out='ERR '+(e&&e.stack||e)})"
            w.page.runJavaScript(code, lambda _: poll(n, int(spec.get("wait", 300)), 0, spec.get("shot")))
    QTimer.singleShot(150, tick)

QTimer.singleShot(4000, tick)
print("DRIVER READY", flush=True)
app.exec()
