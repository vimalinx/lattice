"""Opens everything the interface has, in whatever language LATTICE_LANG names, and prints the Chinese text left on show.
Used by tests/test_i18n.py; it needs a process of its own."""
import json, os, sys, tempfile
from pathlib import Path

base = Path(tempfile.mkdtemp(prefix="lattice-sweep-"))
for key, sub in (("XDG_DATA_HOME", "data"), ("XDG_CONFIG_HOME", "config"), ("LATTICE_VAULT", "vault")):
    os.environ[key] = str(base / sub)
os.environ["QT_QPA_PLATFORM"] = "offscreen"
sys.path[:0] = [str(Path(__file__).resolve().parent), str(Path(__file__).resolve().parents[1])]

from PySide6.QtCore import QCoreApplication, Qt
from PySide6.QtWidgets import QApplication

QCoreApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
import main  # noqa: F401

app = QApplication([])
from workbench import Workbench

bench = Workbench(app)
note = bench.file("sweep.py", "print(1)\n")
# Text the learner or an AI wrote is theirs, whatever language it is in.
OWN = ".cm-content,.cm-gutters,.markdown,.msg-body,.tab-title,.side-row .title,.st-tab span,code,pre,[data-path]"
COLLECT = """const own=%s;const texts=new Set();
 const walk=n=>{for(const c of n.childNodes){if(c.nodeType===3){const t=c.textContent.trim();if(t&&/[\\u4e00-\\u9fff]/.test(t)&&!c.parentElement.closest(own))texts.add(t.slice(0,120));}
  else if(c.nodeType===1&&!c.closest(own)){for(const a of ['title','placeholder','aria-label','data-tip'])if(/[\\u4e00-\\u9fff]/.test(c.getAttribute(a)||''))texts.add('@'+a+' '+c.getAttribute(a).slice(0,120));walk(c);}}};
 walk(document.body);return [...texts]""" % json.dumps(OWN)
found = {}


def look(where, body=""):
    found[where] = bench.js(body + ";await new Promise(r=>setTimeout(r,250));" + COLLECT, 40)


look("start")
for kind in ["home", "map", "journal", "review", "library", "memory", "noteinfo", "skills", "marks", "asked"]:
    look(kind, f"openPanel({{type:{kind!r}}})")
for page in ["look", "layout", "agents", "apis", "web", "run", "vault", "rules", "keys", "usage", "update"]:
    look("settings:" + page, f"openPanel({{type:'settings',page:{page!r}}});const pid=findPanel({{type:'settings'}});await rpc('ui_save',{{ui:S.ui}}).catch(()=>{{}});document.querySelector('[data-action=settings-page][data-page={page}]')?.click()")
look("file", f"openPanel({{type:'file',path:{note!r}}})")
for space in ["write", "cards"]:
    look("space:" + space, f"switchSpace({space!r})")
look("space menu", "switchSpace('chat');document.querySelector('[data-action=space-add]')?.click()")
look("new menu", "closeMenus();document.querySelector('.tab-add')?.click()")
look("tab menu", "closeMenus();const tab=document.querySelector('.tab');tab.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:60}))")
for i in range(1, 9):
    look(f"sidebar {i}", f"closeMenus();document.querySelectorAll('#activity [data-action=side-list]')[{i - 1}]?.click()")
look("palette", "closeMenus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))")
look("question", "document.querySelector('#overlays').innerHTML='';ask('x',{title:'y'})")
print("SWEEP " + json.dumps({"chinese": {k: v for k, v in found.items() if v}, "errors": bench.errors()}, ensure_ascii=False), flush=True)
bench.close()
