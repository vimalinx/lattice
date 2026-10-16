"""Qt 6 bridge: native OS integrations, local persistence, ACP and live lab processes."""
from __future__ import annotations

import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import subprocess
import sys

from PySide6.QtCore import QObject, Signal, Slot, QProcess, QProcessEnvironment, QTimer, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import QFileDialog

from .store import Store, APP_HOME
from .acp import AgentWorker

LOG = logging.getLogger("lattice")
LAB_TIMEOUT_MS = 10 * 60 * 1000


def compact(items):
    return json.dumps(items,ensure_ascii=False,default=str)


class Bridge(QObject):
    event = Signal(str)

    def __init__(self, parent=None, store=None):
        super().__init__(parent)
        self._init_log()
        self.store = store or Store()
        self.workers = {}
        self.processes = {}
        self.output = {}
        self.lab_timers = {}
        self.workspace = APP_HOME / "workspace"
        self.workspace.mkdir(parents=True,exist_ok=True)
        self.lab_home = APP_HOME / "experiments"
        self.lab_home.mkdir(parents=True,exist_ok=True)

    @staticmethod
    def _init_log():
        if LOG.handlers:
            return
        APP_HOME.mkdir(parents=True, exist_ok=True)
        path = APP_HOME / "lattice.log"
        handler = RotatingFileHandler(path, maxBytes=1_000_000,
                                      backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        LOG.addHandler(handler)
        LOG.setLevel(logging.INFO)
        try:
            path.chmod(0o600)
        except OSError:
            pass

    @staticmethod
    def _scrub(payload):
        # Requests may carry credentials (learn_settings_save); never log them.
        return re.sub(r'"(api_key|key|token|password|secret)"\s*:\s*"[^"]*"',
                      r'"\1":"[REDACTED]"', str(payload))[:400]

    def announce(self, data):
        self.event.emit(compact(data))

    def state(self):
        return {
            "notes":self.store.list_notes(limit=300),
            "projects":self.store.projects(),
            "experiments":self.store.experiments(),
            "sessions":self.store.sessions(),
            "tasks":self.store.tasks(),
            "stats":self.store.stats(),
            "events":self.store.events(100),
            "graph":self.store.graph(),
        }

    def _folder_picker(self, title):
        path=QFileDialog.getExistingDirectory(None,title,str(Path.home()),QFileDialog.Option.ShowDirsOnly)
        return path or None

    @Slot(str,result=str)
    def request(self, payload):
        try:
            req=json.loads(payload)
            method=req.pop("method")
            data=self.dispatch(method,req)
            return compact({"ok":True,"data":data})
        except Exception as e:
            LOG.exception("request failed: %s", self._scrub(payload))
            return compact({"ok":False,"error":str(e)})

    def dispatch(self, method, args):
        d=self.store
        if method=="bootstrap":
            return self.state()
        if method=="note":
            return d.get_note(args["id"])
        if method=="notes":
            return d.list_notes(args.get("query",""),args.get("folder",""))
        if method=="save_note":
            return d.save_note(args["note"])
        if method=="delete_note":
            return d.delete_note(args["id"])
        if method=="revisions":
            return d.revisions(args["id"])
        if method=="restore":
            return d.restore(args["id"],args["revision"])
        if method=="backlinks":
            return d.backlinks(args["id"])
        if method=="graph":
            return d.graph()
        if method=="stats":
            return d.stats()
        if method=="events":
            return d.events(args.get("limit",150))
        if method=="tasks":
            return d.tasks()
        if method=="task_add":
            return d.create_task(args["label"])
        if method=="task_toggle":
            d.toggle_task(args["id"],args["done"])
            return d.tasks()
        if method=="task_delete":
            d.delete_task(args["id"])
            return d.tasks()
        if method=="project_add":
            path=args.get("path") or self._folder_picker("选择本地代码或笔记目录")
            if not path:
                return None
            return d.add_project(args.get("name") or Path(path).name,path)
        if method=="project_remove":
            return d.remove_project(args["id"])
        if method=="project_files":
            return d.project_files(args["id"],args.get("path",""))
        if method=="file_read":
            return d.file_read(args["id"],args["path"])
        if method=="file_write":
            return d.file_write(args["id"],args["path"],args["content"])
        if method=="file_open_external":
            path,_=d._safe_path(args["id"],args["path"])
            return QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))
        if method=="experiments":
            return d.experiments()
        if method=="experiment_create":
            return d.new_experiment(args.get("title","新实验"),args.get("project_id"))
        if method=="experiment_get":
            return d.experiment(args["id"])
        if method=="experiment_dir":
            ident = args["id"]
            if not d.experiment(ident):
                raise ValueError("实验不存在")
            path = self.lab_home / ident
            path.mkdir(parents=True, exist_ok=True)
            return str(path)
        if method=="experiment_history":
            return d.experiment_history(args["id"])
        if method=="experiment_run_get":
            return d.experiment_run(args["id"])
        if method=="experiment_save":
            return d.save_experiment(args["experiment"])
        if method=="experiment_run":
            return self.run_experiment(args["id"])
        if method=="experiment_stop":
            return self.stop_experiment(args["id"])
        if method=="sessions":
            return d.sessions()
        if method=="session_create":
            return d.new_session(args.get("agent","codex"),args.get("project_id"),args.get("title"))
        if method=="session_messages":
            return d.messages(args["id"])
        if method=="session_rename":
            d.rename_session(args["id"],args["title"])
            return True
        if method=="agent_send":
            return self.send_agent(args["id"],args["text"])
        if method=="agent_cancel":
            w=self.workers.get(args["id"])
            if w:
                w.post("cancel")
            return True
        if method=="agent_permission":
            w=self.workers.get(args["id"])
            if w:
                w.post("permission",request_id=args["request_id"],option_id=args.get("option_id"))
            return True
        if method=="export":
            folder=self._folder_picker("选择 Markdown 导出目录")
            return d.export_markdown(folder) if folder else None
        if method=="import":
            folder=self._folder_picker("从已有 Markdown 笔记目录导入（仅复制，不修改原目录）")
            return self.import_markdown(folder) if folder else None
        if method=="open_folder":
            requested=Path(args.get("path") or str(APP_HOME)).resolve()
            allowed={APP_HOME.resolve(),self.lab_home.resolve()}
            allowed|={Path(p["path"]).resolve() for p in self.store.projects()}
            allowed|={self.lab_home.resolve()/e["id"] for e in self.store.experiments()}
            if requested not in allowed:
                raise ValueError("只能打开应用数据目录、实验目录或已挂载的项目目录")
            return QDesktopServices.openUrl(QUrl.fromLocalFile(str(requested)))
        if method=="open_url":
            url=QUrl(args["url"])
            if url.scheme() not in ("https","http"):
                raise ValueError("不支持该外部链接")
            return QDesktopServices.openUrl(url)
        raise ValueError("未知操作："+str(method))

    def import_markdown(self, folder):
        root=Path(folder).resolve()
        skip={".git",".obsidian","node_modules",".venv","dist","build","__pycache__"}
        count=0
        for current, dirs, names in os.walk(root):
            dirs[:]=[x for x in dirs if x not in skip and not x.startswith(".")]
            for filename in names:
                if not filename.lower().endswith(".md"):
                    continue
                path=Path(current)/filename
                if path.is_symlink() or path.stat().st_size>1024*1024:
                    continue
                try:
                    content=path.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    continue
                relative=path.relative_to(root)
                parent=relative.parts[0] if len(relative.parts)>1 else "Imported"
                # Re-importing the same folder updates in place instead of
                # duplicating every note.
                note={"title":path.stem,"body":content,"folder":parent,"tags":["导入"]}
                old=self.store.db.execute("SELECT id FROM notes WHERE title=? AND folder=?",
                                          (path.stem,parent)).fetchone()
                if old:
                    note["id"]=old[0]
                self.store.save_note(note)
                count+=1
                if count>=1000:
                    break
            if count>=1000:
                break
        if count:
            self.store.emit("import",f"导入 {count} 篇 Markdown 笔记",str(root))
        return {"count":count}

    def _agent_cwd(self, session):
        p=self.store.project(session.get("project_id"))
        return p["path"] if p else str(self.workspace)

    def send_agent(self, ident, text):
        message=text.strip()
        if not message:
            raise ValueError("请输入问题")
        session=self.store.session(ident)
        if not session:
            raise ValueError("会话不存在")
        w=self.workers.get(ident)
        if w and w.busy:
            raise ValueError("Agent 正在处理上一个任务")
        self.store.append_message(ident,"user",message)
        if not w or not w.isRunning():
            w=AgentWorker(ident,session["agent"],self._agent_cwd(session),session.get("remote_id"))
            providers=getattr(self,"providers",None)
            if providers:
                w.agent_config=providers.read()
            w.event.connect(self.agent_event)
            self.workers[ident]=w
            w.post("prompt",text=message)
            w.start()
        else:
            w.post("prompt",text=message)
        return True

    @Slot(dict)
    def agent_event(self, evt):
        ident=evt["session_id"]
        kind=evt["kind"]
        if kind=="ready":
            self.store.set_remote_id(ident,evt.get("remote_id"))
        if kind=="finished":
            body=evt.get("text","")
            if body.strip():
                self.store.append_message(ident,"assistant",body,
                    {"stop_reason":evt.get("stop_reason","end_turn")})
                self.store.emit("agent","Agent 完成回复",self.store.session(ident)["title"],ident)
        self.announce({"type":"agent",**evt})

    def run_experiment(self, ident):
        data=self.store.experiment(ident)
        if not data:
            raise ValueError("实验不存在")
        if ident in self.processes and self.processes[ident].state()!=QProcess.ProcessState.NotRunning:
            raise ValueError("实验已经在运行")
        directory=self.lab_home/ident
        directory.mkdir(parents=True,exist_ok=True)
        code=str(data["code"] or "print('从这里写下第一段验证代码')")
        source=directory/"main.py"
        source.write_text(code,encoding="utf-8")
        proc=QProcess(self)
        proc.setProgram(sys.executable)
        proc.setArguments(["-u",str(source)])
        proc.setWorkingDirectory(str(directory))
        env=QProcessEnvironment.systemEnvironment()
        project=self.store.project(data.get("project_id"))
        if project:
            prev=env.value("PYTHONPATH","")
            env.insert("PYTHONPATH",project["path"] + (os.pathsep+prev if prev else ""))
        proc.setProcessEnvironment(env)
        self.processes[ident]=proc
        self.output[ident]=""
        self.store.save_experiment({**data,"status":"running","output":""})
        proc.readyReadStandardOutput.connect(lambda lab=ident: self._lab_output(lab,False))
        proc.readyReadStandardError.connect(lambda lab=ident: self._lab_output(lab,True))
        proc.finished.connect(lambda code,status,lab=ident:self._lab_finished(lab,code,status))
        proc.errorOccurred.connect(lambda _error,lab=ident:self._lab_error(lab))
        proc.start()
        timer=QTimer(self)
        timer.setSingleShot(True)
        timer.timeout.connect(lambda lab=ident:self._lab_timeout(lab))
        timer.start(LAB_TIMEOUT_MS)
        self.lab_timers[ident]=timer
        self.announce({"type":"lab","kind":"status","id":ident,"status":"running"})
        return {"status":"running","path":str(source)}

    def _lab_output(self, ident, error):
        proc=self.processes.get(ident)
        if not proc:
            return
        raw=proc.readAllStandardError() if error else proc.readAllStandardOutput()
        text=bytes(raw).decode("utf-8","replace")
        if not text:
            return
        self.output[ident]=(self.output.get(ident,"")+text)[-220000:]
        self.announce({"type":"lab","kind":"output","id":ident,"text":text,"stream":"stderr" if error else "stdout"})

    def _lab_timeout(self, ident):
        proc=self.processes.get(ident)
        if not proc or proc.state()==QProcess.ProcessState.NotRunning:
            return
        LOG.warning("实验 %s 超过 %s 分钟，已停止", ident, LAB_TIMEOUT_MS//60000)
        self.output[ident]=(self.output.get(ident,"")+
            f"\n[Lattice] 执行超过 {LAB_TIMEOUT_MS//60000} 分钟，已自动停止。\n")[-220000:]
        proc.kill()

    def _lab_finished(self, ident, code, status):
        timer=self.lab_timers.pop(ident,None)
        if timer:
            timer.stop()
        proc=self.processes.get(ident)
        if not proc:
            return
        self._lab_output(ident,False)
        self._lab_output(ident,True)
        current=self.store.experiment(ident)
        if current:
            outcome="completed" if code==0 and status==QProcess.ExitStatus.NormalExit else "failed"
            self.store.save_experiment({**current,"status":outcome,"output":self.output.get(ident,"")})
            self.store.record_experiment_run(ident, code, self.output.get(ident,""))
            self.store.emit("experiment",f"实验{('完成' if outcome=='completed' else '异常')} · {current['title']}",
                            f"退出码 {code}",ident)
            self.announce({"type":"lab","kind":"status","id":ident,"status":outcome,"exit_code":code})

    def _lab_error(self, ident):
        proc=self.processes.get(ident)
        if not proc:
            return
        self.announce({"type":"lab","kind":"error","id":ident,"message":proc.errorString()})
        if proc.error()==QProcess.ProcessError.FailedToStart:
            # finished may never fire on a failed start; clean up eagerly or the
            # experiment stays "running" forever with a dead timer.
            timer=self.lab_timers.pop(ident,None)
            if timer:
                timer.stop()
            self.processes.pop(ident,None)
            current=self.store.experiment(ident)
            if current:
                self.store.save_experiment({**current,"status":"failed","output":self.output.get(ident,"") or proc.errorString()})
            self.announce({"type":"lab","kind":"status","id":ident,"status":"failed"})

    def stop_experiment(self, ident):
        proc=self.processes.get(ident)
        if not proc or proc.state()==QProcess.ProcessState.NotRunning:
            return False
        proc.kill()
        return True

    def shutdown(self):
        for proc in self.processes.values():
            if proc.state()!=QProcess.ProcessState.NotRunning:
                proc.kill()
                proc.waitForFinished(1500)
        for w in self.workers.values():
            if w.isRunning():
                w.post("stop")
                if not w.wait(1300):
                    # AgentWorker has its own process-group cleanup in finally.
                    w.running=False
                    w.wait(1400)
        self.store.close()
