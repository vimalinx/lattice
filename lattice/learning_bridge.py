"""Native desktop orchestration: two independent AI lanes and real notebooks."""
from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import zipfile

from PySide6.QtCore import Slot
from PySide6.QtWidgets import QFileDialog

from .bridge import Bridge
from .store import APP_HOME
from .acp import AgentWorker, AGENTS, agent_command, command_available
from .learning import LearningStore, TABLES, dump, now, text
from .notebook import NotebookWorker
from .providers import ProviderConfig, FlashWorker
from .teaching import TUTOR_POLICY, FLASH_POLICY, TASKS


class LearningBridge(Bridge):
    def __init__(self, parent=None, store=None, config_path=None):
        super().__init__(parent, store)
        self.learning = LearningStore(self.store)
        self.providers = ProviderConfig(config_path)
        self.notebook_workers = {}
        self.notebook_states = {}
        self.pending_notebooks = set()
        self.flash_workers = {}
        self.learning_meta = {}
        self.learning_busy = set()
        self.learning_status = {}
        self.connection_tests = []
        self._retired = []
        self.closing = False
        # Isolate tests and alternate profiles from the user's normal data.
        self.learning_home = self.store.path.parent / "learning"
        self.learning_home.mkdir(parents=True, exist_ok=True)

    def learning_state(self, topic_id=None):
        result = self.learning.snapshot(topic_id)
        result["providers"] = self.providers.public()
        result["runtime"] = {
            "agents": self.learning_status,
            "busy": [list(x) for x in self.learning_busy],
            "notebooks": self.notebook_states,
        }
        return result

    def state(self):
        result = super().state()
        result["learning"] = self.learning_state()
        return result

    def dispatch(self, method, args):
        l = self.learning
        if method == "learn_snapshot":
            return self.learning_state(args.get("topic_id"))
        if method == "learn_topic_save":
            return l.topic_save(args["topic"])
        if method == "learn_topic_delete":
            return self.topic_delete(args["id"])
        if method == "learn_focus":
            l.focus(args["id"])
            return self.learning_state(args["id"])
        if method == "learn_lesson_save":
            return l.lesson_save(args["lesson"])
        if method == "learn_lesson_delete":
            return l.lesson_delete(args["id"])
        if method == "learn_card_save":
            return l.card_save(args["card"])
        if method == "learn_card_delete":
            return l.card_delete(args["id"])
        if method == "learn_completed_runs":
            return l.completed_runs()
        if method == "learn_evidence":
            return l.evidence_add(args["card_id"], args["kind"], args["content"], args.get("run_id"))
        if method == "learn_review":
            return l.review(args["card_id"], args.get("reflection", ""), args.get("again", False))
        if method == "learn_relation":
            return l.relation_add(args["source"], args["target"], args.get("kind", "related"), args.get("reason", ""))
        if method == "learn_relation_delete":
            return l.relation_delete(args["id"])
        if method == "learn_proposal_apply":
            return l.proposal_apply(args["id"], args.get("notebook_id"))
        if method == "learn_proposal_dismiss":
            return l.proposal_dismiss(args["id"])
        if method == "learn_settings":
            return self.providers.public()
        if method == "learn_settings_save":
            return self.providers.save(args["config"])
        if method == "learn_test_flash":
            return self.test_flash()
        if method == "learn_connect":
            return self.connect_tutor(args["topic_id"])
        if method == "learn_new_tutor":
            return self.new_tutor(args["topic_id"])
        if method == "learn_send":
            return self.learning_send(args["topic_id"], args.get("lane", "tutor"), args.get("text", ""),
                                      args.get("selection", ""), args.get("task", ""), args.get("notebook_id"))
        if method == "learn_cancel":
            return self.learning_cancel(args["topic_id"], args.get("lane", "tutor"))
        if method == "learn_context":
            return l.context(args["topic_id"], args.get("lane", "tutor"), args.get("selection", ""), args.get("notebook_id"))
        if method == "nb_create":
            return l.notebook_create(args["topic_id"], args.get("title", "实验笔记"))
        if method == "nb_delete":
            return self.notebook_delete(args["id"])
        if method == "nb_get":
            return l.notebook(args["id"])
        if method == "nb_cell_save":
            return l.cell_save(args["cell"])
        if method == "nb_cell_delete":
            cell = l.one("learn_cells", args["id"])
            if cell["notebook_id"] in self.pending_notebooks:
                raise ValueError("这份笔记本正在运行；请先中断再删除单元格")
            return l.cell_delete(args["id"])
        if method == "nb_cell_move":
            return l.cell_move(args["id"], args["direction"])
        if method == "nb_run":
            return self.run_notebook(args["id"], args.get("cell_id"))
        if method == "nb_interrupt":
            w = self.notebook_workers.get(args["id"])
            if w:
                w.interrupt()
            return bool(w)
        if method == "nb_restart":
            return self.restart_notebook(args["id"])
        if method == "nb_history":
            return l.run_history(args["cell_id"])
        if method == "nb_import":
            return self.import_notebook(args["topic_id"], args.get("path"))
        if method == "nb_export":
            return self.export_notebook(args["id"], args.get("path"))
        if method == "learn_export":
            return self.export_learning(args.get("path"))
        return super().dispatch(method, args)

    def _workspace(self, topic_id):
        self.learning.one("learn_topics", topic_id)
        root = self.learning_home / "workspaces" / topic_id
        root.mkdir(parents=True, exist_ok=True)
        (root / "AGENTS.md").write_text(TUTOR_POLICY, encoding="utf-8")
        return root

    def connect_tutor(self, topic_id):
        config = self.providers.read()
        agent = config.get("tutor_agent") or "codex"
        threads = self.learning.threads(topic_id, agent)
        ident = threads["tutor_session"]
        worker = self.workers.get(ident)
        if worker and worker.isRunning():
            return {"session_id": ident, "state": self.learning_status.get(ident, "connecting")}
        session = self.store.session(ident)
        command, env = agent_command(agent, config)
        label = AGENTS.get(agent, {}).get("label", agent)
        if not command_available(command):
            raise ValueError(f"找不到 {label} 的可执行文件，请在模型连接中配置 ACP 路径")
        worker = AgentWorker(ident, agent, str(self._workspace(topic_id)), session.get("remote_id"))
        worker.command = command
        worker.extra_env = env
        self.learning_meta[ident] = {"topic_id": topic_id, "lane": "tutor"}
        worker.event.connect(self.tutor_event)
        self.workers[ident] = worker
        self.learning_status[ident] = "connecting"
        worker.start()
        return {"session_id": ident, "state": "connecting"}

    def new_tutor(self, topic_id):
        old = self.learning.threads(topic_id)
        if (topic_id, "tutor") in self.learning_busy:
            raise ValueError("请先停止当前主讲回复，再创建新会话")
        worker = self.workers.get(old["tutor_session"])
        if worker and worker.isRunning():
            worker.post("stop")
            if not worker.wait(4000):
                raise ValueError("旧 ACP 连接尚未关闭，请稍后重试")
        self.workers.pop(old["tutor_session"], None)
        self.learning_meta.pop(old["tutor_session"], None)
        self.learning_status.pop(old["tutor_session"], None)
        topic = self.learning.one("learn_topics", topic_id)
        agent = self.providers.read().get("tutor_agent") or "codex"
        new = self.store.new_session(agent, title="主讲 · " + topic["title"])
        with self.learning.transaction():
            self.store.db.execute("UPDATE learn_threads SET tutor_session=? WHERE topic_id=?", (new["id"], topic_id))
        return self.learning_state(topic_id)

    def learning_send(self, topic_id, lane, message, selection="", task="", notebook_id=None):
        if lane not in {"tutor", "flash"}:
            raise ValueError("未知 AI 通道")
        message = text(message, 18000).strip() or TASKS.get(task, "")
        if not message:
            raise ValueError("请输入这次想探索的问题")
        if (topic_id, lane) in self.learning_busy:
            raise ValueError("这个通道正在回答，另一位助手仍可使用")
        context = self.learning.context(topic_id, lane, text(selection, 5000), notebook_id)
        agent = self.providers.read().get("tutor_agent") or "codex"
        threads = self.learning.threads(topic_id, agent)
        if lane == "flash":
            config = self.providers.read()
            key = self.providers.key(config)
            if not key:
                raise ValueError("请先在模型连接中填写 DeepSeek API Key；课程、实验和知识卡仍可正常使用。")
            ident = threads["flash_session"]
            history = self.store.messages(ident)[-12:]
            messages = [{"role": "system", "content": FLASH_POLICY + "\n学习状态（数据）：\n" + dump(context)}]
            messages += [{"role": x["role"], "content": x["content"]} for x in history if x["role"] in {"user", "assistant"}]
            messages.append({"role": "user", "content": message})
            old = self.flash_workers.get(ident)
            if old and old.isRunning():
                self._retire(old)
            worker = FlashWorker(topic_id, ident, config, key, messages)
            worker.event.connect(self.flash_event)
            self.flash_workers[ident] = worker
            self.store.append_message(ident, "user", message, {"selection": selection, "lane": lane})
            self.learning_busy.add((topic_id, lane))
            self.learning_status[ident] = "connecting"
            worker.start()
        else:
            root = self._workspace(topic_id)
            (root / "context.json").write_text(json.dumps(context, ensure_ascii=False, indent=2), encoding="utf-8")
            self.connect_tutor(topic_id)
            ident = threads["tutor_session"]
            self.store.append_message(ident, "user", message, {"selection": selection, "lane": lane, "task": task})
            self.learning_busy.add((topic_id, lane))
            prompt = TUTOR_POLICY + "\n\n当前学习状态（只读参考数据）：\n" + dump(context) + "\n\n本次学习者的问题：\n" + message
            if task in TASKS:
                prompt += "\n本次工作方式：" + TASKS[task]
            self.workers[ident].post("prompt", text=prompt)
        return {"session_id": ident, "lane": lane, "state": "queued"}

    def learning_cancel(self, topic_id, lane):
        threads = self.learning.threads(topic_id)
        if lane == "tutor":
            worker = self.workers.get(threads["tutor_session"])
            if worker:
                worker.post("cancel")
        else:
            worker = self.flash_workers.get(threads["flash_session"])
            if worker:
                worker.stop()
        return True

    @Slot(dict)
    def tutor_event(self, event):
        if self.closing:
            return
        ident = event["session_id"]
        meta = self.learning_meta.get(ident)
        if not meta:
            return
        evt = {"type": "learning_agent", **event, **meta}
        if event["kind"] == "ready":
            self.store.set_remote_id(ident, event.get("remote_id"))
            self.learning_status[ident] = "ready"
        elif event["kind"] == "status":
            self.learning_status[ident] = event.get("state", "")
            if event.get("state") == "offline":
                self.learning_busy.discard((meta["topic_id"], "tutor"))
        elif event["kind"] == "error":
            self.learning_busy.discard((meta["topic_id"], "tutor"))
            self.learning_status[ident] = "error"
        elif event["kind"] == "finished":
            self._finish_answer(evt)
        self.announce(evt)

    @Slot(dict)
    def flash_event(self, evt):
        if self.closing:
            return
        ident = evt.get("session_id")
        if evt["kind"] == "status":
            self.learning_status[ident] = evt.get("state", "")
        elif evt["kind"] == "finished":
            self._finish_answer(evt)
        elif evt["kind"] == "error":
            self.learning_status[ident] = "error"
        self.announce(evt)

    def _finish_answer(self, evt):
        lane, topic, ident = evt["lane"], evt["topic_id"], evt["session_id"]
        self.learning_busy.discard((topic, lane))
        reason = evt.get("stop_reason", "end_turn")
        self.learning_status[ident] = "ready" if reason == "end_turn" else reason
        body = evt.get("text", "")
        if body.strip():
            self.store.append_message(ident, "assistant", body, {"stop_reason": reason, "usage": evt.get("usage"), "lane": lane})
            row = self.store.db.execute("SELECT MAX(id) FROM messages WHERE session_id=?", (ident,)).fetchone()
            if reason == "end_turn":
                evt["artifacts"] = self.learning.proposal_extract(topic, lane, body, row[0])
            self.store.emit("learning", "主讲回复已保存" if lane == "tutor" else "即时答疑已保存", reason, topic)

    @staticmethod
    def _detach(worker, slot):
        # Deleted entities must not receive late worker events (e.g. the final
        # "offline" status or a cancelled-stream finish).
        try:
            worker.event.disconnect(slot)
        except (TypeError, RuntimeError):
            pass

    def _retire(self, worker):
        # A running QThread must keep a strong reference until its loop exits;
        # CPython destroying a live QThread makes Qt abort the whole process.
        if not worker or not worker.isRunning():
            return
        self._retired.append(worker)
        def _drop(w=worker):
            try:
                self._retired.remove(w)
            except ValueError:
                pass
        worker.finished.connect(_drop)

    def _stop_kernel(self, notebook_id):
        worker = self.notebook_workers.pop(notebook_id, None)
        self.notebook_states.pop(notebook_id, None)
        self.pending_notebooks.discard(notebook_id)
        if worker:
            self._detach(worker, self.notebook_event)
            if worker.isRunning():
                worker.stop()
                if not worker.wait(3000):
                    self._retire(worker)

    def topic_delete(self, topic_id):
        for lane in ("tutor", "flash"):
            if (topic_id, lane) in self.learning_busy:
                raise ValueError("这个主题还有正在生成的回答，请先取消或等待完成")
        row = self.store.db.execute("SELECT * FROM learn_threads WHERE topic_id=?", (topic_id,)).fetchone()
        if row:
            tutor = self.workers.pop(row["tutor_session"], None)
            if tutor:
                self._detach(tutor, self.tutor_event)
                if tutor.isRunning():
                    tutor.post("stop")
                    self._retire(tutor)
            flash = self.flash_workers.pop(row["flash_session"], None)
            if flash:
                self._detach(flash, self.flash_event)
                if flash.isRunning():
                    flash.stop()
                    self._retire(flash)
            for sid in (row["tutor_session"], row["flash_session"]):
                self.learning_meta.pop(sid, None)
                self.learning_status.pop(sid, None)
        for nb in self.learning.rows("SELECT id FROM learn_notebooks WHERE topic_id=?", (topic_id,)):
            self._stop_kernel(nb["id"])
        self.learning.topic_delete(topic_id)
        return self.learning_state()

    def notebook_delete(self, notebook_id):
        if notebook_id in self.pending_notebooks:
            raise ValueError("这份笔记本正在运行；请先中断再删除")
        self._stop_kernel(notebook_id)
        self.learning.notebook_delete(notebook_id)
        return True

    def test_flash(self):
        config = self.providers.read()
        self.connection_tests = [w for w in self.connection_tests if w.isRunning()]
        worker = FlashWorker("", "", config, self.providers.key(config), [], test=True)
        self.connection_tests.append(worker)
        worker.event.connect(self.flash_event)
        worker.start()
        return {"state": "testing"}

    def send_agent(self, ident, message):
        """Avoid sending DeepSeek history to the legacy Devin ACP route."""
        session = self.store.session(ident)
        if session and session["agent"] == "deepseek":
            row = self.store.db.execute("SELECT topic_id FROM learn_threads WHERE flash_session=?", (ident,)).fetchone()
            if not row:
                raise ValueError("这是历史快答会话，请到学习空间继续答疑")
            return self.learning_send(row[0], "flash", message)
        return super().send_agent(ident, message)

    def _kernel(self, notebook_id):
        self.learning.one("learn_notebooks", notebook_id)
        worker = self.notebook_workers.get(notebook_id)
        if not worker or not worker.isRunning():
            config = self.providers.read()
            worker = NotebookWorker(notebook_id, self.learning_home / "notebooks" / notebook_id,
                                    config["kernel_name"], config["kernel_timeout"])
            worker.event.connect(self.notebook_event)
            self.notebook_workers[notebook_id] = worker
            self.notebook_states[notebook_id] = {"state": "starting"}
            worker.start()
        return worker

    def run_notebook(self, notebook_id, cell_id=None):
        if notebook_id in self.pending_notebooks:
            raise ValueError("这份笔记本正在运行；可以中断或在另一份笔记本中实验")
        notebook = self.learning.notebook(notebook_id)
        cells = [c for c in notebook["cells"] if c["kind"] == "code" and (not cell_id or c["id"] == cell_id)]
        if not cells:
            raise ValueError("没有找到可以执行的 Python 单元格")
        runs = [self.learning.run_create(c["id"]) for c in cells]
        self.pending_notebooks.add(notebook_id)
        try:
            self._kernel(notebook_id).submit(runs)
        except Exception:
            self.pending_notebooks.discard(notebook_id)
            for r in runs:
                try:
                    self.learning.run_finish(r["id"], [], "error")
                except Exception:
                    pass
            raise
        return {"run_ids": [r["id"] for r in runs], "state": "queued"}

    def restart_notebook(self, notebook_id):
        self.learning.one("learn_notebooks", notebook_id)
        worker = self.notebook_workers.get(notebook_id)
        if not worker or not worker.isRunning():
            self._kernel(notebook_id)
        else:
            worker.restart()
        return True

    @Slot(dict)
    def notebook_event(self, evt):
        if self.closing:
            return
        ident, kind = evt["notebook_id"], evt["kind"]
        if kind == "run_started":
            self.notebook_states[ident] = {"state": "busy", "kernel_id": evt.get("kernel_id")}
            self.store.db.execute("UPDATE learn_runs SET state='running',kernel_id=? WHERE id=?", (evt.get("kernel_id"), evt["run_id"]))
            self.store.db.commit()
        elif kind == "run_finished":
            self.learning.run_finish(evt["run_id"], evt.get("outputs", []), evt["state"], evt.get("execution_count"), evt.get("kernel_id"))
        elif kind in {"status", "batch_finished"}:
            self.notebook_states[ident] = {"state": evt["state"], "kernel_id": evt.get("kernel_id")}
            if kind == "batch_finished" or evt["state"] == "offline":
                self.pending_notebooks.discard(ident)
        elif kind == "error":
            self.pending_notebooks.discard(ident)
            self.notebook_states[ident] = {"state": "error"}
        self.announce(evt)

    def import_notebook(self, topic_id, path=None):
        if path is None:
            path, _ = QFileDialog.getOpenFileName(None, "导入 Jupyter Notebook", str(Path.home()), "Jupyter Notebook (*.ipynb)")
        if not path:
            return None
        path = Path(path)
        if path.stat().st_size > 20_000_000:
            raise ValueError("Notebook 超过 20 MB；请先清理大体积输出")
        return self.learning.ipynb_import(topic_id, json.loads(path.read_text(encoding="utf-8")), path.stem)

    def export_notebook(self, ident, path=None):
        nb = self.learning.notebook(ident)
        if path is None:
            path, _ = QFileDialog.getSaveFileName(None, "导出 Jupyter Notebook", str(Path.home() / (nb["title"] + ".ipynb")), "Jupyter Notebook (*.ipynb)")
        if not path:
            return None
        Path(path).write_text(json.dumps(self.learning.ipynb(ident), ensure_ascii=False, indent=2), encoding="utf-8")
        return str(path)

    def export_learning(self, path=None):
        if path is None:
            path, _ = QFileDialog.getSaveFileName(None, "导出学习档案（不含 API Key）", str(Path.home() / "lattice-learning.zip"), "ZIP archive (*.zip)")
        if not path:
            return None
        with tempfile.TemporaryDirectory() as tmp:
            snapshot = Path(tmp) / "lattice.db"
            # sqlite3.connect's context manager only commits; the connection
            # itself needs closing or the temp cleanup can race an open handle.
            with contextlib.closing(sqlite3.connect(snapshot)) as destination:
                self.store.db.backup(destination)
            with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.write(snapshot, "lattice.db")
                archive.writestr("learning.json", json.dumps({table: self.learning.rows("SELECT * FROM " + table) for table in TABLES}, ensure_ascii=False, indent=2))
                for row in self.learning.rows("SELECT id FROM learn_notebooks"):
                    archive.writestr("notebooks/" + row["id"] + ".ipynb", json.dumps(self.learning.ipynb(row["id"]), ensure_ascii=False, indent=2))
                for row in self.learning.rows("SELECT id FROM learn_cards"):
                    c = self.learning.card(row["id"])
                    archive.writestr("cards/" + c["id"] + ".md", "# " + c["title"] + "\n\n" + c["body"] + "\n\n## 我的理解\n\n" + c["understanding"] + "\n\n## 仍然想问\n\n" + c["question"] + "\n")
                archive.writestr("README.txt", "Lattice 本地学习档案。包括 SQLite 全量记录、学习图谱 JSON、知识卡 Markdown 和 Jupyter Notebook。\n不包含 providers.json/API Key 或 Codex 登录凭据。\n恢复时先关闭应用并备份原数据库；然后用 lattice.db 替换应用数据目录内的数据库。")
        self.store.emit("export", "导出完整学习档案", str(path))
        return str(path)

    def shutdown(self):
        self.closing = True
        for worker in list(self.flash_workers.values()) + self.connection_tests:
            if worker.isRunning():
                worker.stop()
        for worker in self.notebook_workers.values():
            if worker.isRunning():
                worker.stop()
        for worker in list(self.flash_workers.values()) + self.connection_tests:
            if worker.isRunning():
                worker.wait(14000)
        for worker in self.notebook_workers.values():
            if worker.isRunning():
                worker.wait(35000)
        super().shutdown()
