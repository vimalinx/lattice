"""How long the things a learner waits for take, on the real page: python3 tests/bench.py [out.json]
Offscreen, on a vault of its own. Compare runs on one machine; the numbers mean little across machines."""
import json, os, sys, tempfile, time
from pathlib import Path

base = Path(tempfile.mkdtemp(prefix="lattice-bench-"))
for key, sub in (("XDG_DATA_HOME", "data"), ("XDG_CONFIG_HOME", "config"), ("LATTICE_VAULT", "vault")):
    os.environ[key] = str(base / sub)
os.environ["QT_QPA_PLATFORM"] = "offscreen"
sys.path[:0] = [str(Path(__file__).resolve().parent), str(Path(__file__).resolve().parents[1])]

from PySide6.QtCore import QCoreApplication, Qt
from PySide6.QtWidgets import QApplication

QCoreApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
import main  # noqa: F401  (the app scheme has to be registered first)

app = QApplication([])
from workbench import Workbench

results = {}
began = time.perf_counter()
bench = Workbench(app)
results["open the window (ms)"] = round((time.perf_counter() - began) * 1000)
l = bench.bridge.lattice


def timed(name, body):
    results[name] = bench.js(f"const t0=performance.now();{body};return Math.round(performance.now()-t0)", 60)


paths = [bench.file(f"bench{i}.py", "x = 1\n" * 40) for i in range(40)]
timed("open 40 files (ms)", "for(const path of " + json.dumps(paths) + ")openPanel({type:'file',path})")
timed("redraw with 40 tabs (ms)", "for(let i=0;i<20;i++)renderDock()")
results["redraw with 40 tabs (ms)"] = round(results["redraw with 40 tabs (ms)"] / 20)
timed("switch state and back (ms)", "for(let i=0;i<10;i++){switchSpace('write');switchSpace('chat');}")
results["switch state and back (ms)"] = round(results["switch state and back (ms)"] / 10)

big = "\n".join(f"第 {i} 行，带一点 **粗体** 和 `代码`。" for i in range(20000))
path = bench.file("big.md", big)
timed("open a 20000-line file (ms)", f"const pid=openPanel({{type:'file',path:{path!r}}});await new Promise(r=>{{const w=()=>document.querySelector('.panel[data-pid=\"'+pid+'\"] .cm-content')?r():setTimeout(w,5);w();}})")

thread = l.thread_new("tutor", None, "长对话")["id"]
for i in range(600):
    l.append_message(thread, "user" if i % 2 == 0 else "assistant", ("这是一段讲解，有公式 $a^2+b^2=c^2$ 和代码。\n\n```python\nprint(1)\n```\n\n" * 3), {})
timed("draw a conversation of 600 messages (ms)", f"const pid=openPanel({{type:'chat',agent:'tutor',thread:{thread!r}}});await new Promise(r=>{{const w=()=>document.querySelector('.panel[data-pid=\"'+pid+'\"] .msg')?r():setTimeout(w,5);w();}})")

began = time.perf_counter()
vault = l.root
(vault / "notes" / "bench").mkdir(parents=True, exist_ok=True)
for i in range(3000):
    (vault / "notes" / "bench" / f"n{i}.md").write_text(f"---\nid: n{i}\nkind: note\ntitle: 笔记 {i}\n---\n正文 {i}\n", encoding="utf-8")
written = time.perf_counter()
l.index.sync()
results["index 3000 new notes (ms)"] = round((time.perf_counter() - written) * 1000)
began = time.perf_counter()
for _ in range(10):
    l.index.sync()
results["look for changes among 3000 notes (ms)"] = round((time.perf_counter() - began) * 100)
began = time.perf_counter()
bench.bridge.rpc_bootstrap()
results["load the state with 3000 notes (ms)"] = round((time.perf_counter() - began) * 1000)

print(json.dumps(results, ensure_ascii=False, indent=1))
if len(sys.argv) > 1:
    Path(sys.argv[1]).write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
assert not bench.errors(), bench.errors()
bench.close()
