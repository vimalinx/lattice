"""Smoke-test both local ACP adapters without requesting model completions."""
from PySide6.QtCore import QCoreApplication,QTimer
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lattice.acp import AgentWorker
from lattice.store import APP_HOME

APP_HOME.joinpath("workspace").mkdir(parents=True,exist_ok=True)
app=QCoreApplication([])
agents=["codex","devin"]
workers=[]
results={}

def next_agent():
    if not agents:
        print("ACP_RESULTS",results,flush=True)
        app.quit()
        return
    agent=agents.pop(0)
    worker=AgentWorker("probe-"+agent,agent,str(APP_HOME/"workspace"))
    workers.append(worker)
    def event(data):
        print("ACP",agent,data.get("kind"),data.get("state",data.get("message",""))[:90],flush=True)
        if data.get("kind")=="ready":
            results[agent]=True
            worker.post("stop")
        elif data.get("kind")=="error":
            results[agent]=False
            worker.post("stop")
    worker.event.connect(event)
    worker.finished.connect(lambda: QTimer.singleShot(0,next_agent))
    worker.start()

QTimer.singleShot(0,next_agent)
QTimer.singleShot(60000,app.quit)
app.exec()
if not all(results.get(x,False) for x in ("codex","devin")):
    sys.exit(1)
