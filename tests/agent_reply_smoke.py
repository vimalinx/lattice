"""Exercise one actual message over ACP (no shell tools requested)."""
import sys
from pathlib import Path
from PySide6.QtCore import QCoreApplication,QTimer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lattice.acp import AgentWorker
from lattice.store import APP_HOME

agent=sys.argv[1] if len(sys.argv)>1 else "codex"
app=QCoreApplication([])
w=AgentWorker("reply-probe",agent,str(APP_HOME/"workspace"))
result={"ready":False,"finished":False,"text":""}

def notify(d):
    kind=d.get("kind")
    if kind=="ready":
        result["ready"]=True
        print("READY",agent,flush=True)
        w.post("prompt",text="请用中文仅回复：收到。不要调用工具或访问文件。")
    elif kind=="chunk":
        result["text"]+=d.get("text","")
        print("CHUNK",repr(d.get("text","")[:100]),flush=True)
    elif kind=="permission":
        print("PERMISSION_REQUIRED",d.get("title"),flush=True)
        w.post("permission",request_id=d["request_id"],option_id=None)
    elif kind=="finished":
        result["finished"]=True
        print("FINISHED",agent,repr(d.get("text","")[:500]),flush=True)
        w.post("stop")
    elif kind=="error":
        print("ERROR",agent,d.get("message","")[:600],flush=True)
        w.post("stop")

def done():
    print("DONE",result,flush=True)
    app.quit()

w.event.connect(notify)
w.finished.connect(done)
QTimer.singleShot(90000,lambda:(print("TIMEOUT",flush=True),w.post("stop")))
w.start()
app.exec()
if not result["finished"] or not result["text"].strip():
    sys.exit(1)
