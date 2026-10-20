"""Native desktop orchestration: two independent AI lanes and real notebooks."""
from __future__ import annotations

import contextlib
import json
import logging
import os
import re
from pathlib import Path
import sqlite3
import tempfile
import zipfile

from PySide6.QtCore import Slot
from PySide6.QtWidgets import QFileDialog

from .bridge import Bridge
from .store import APP_HOME
from .acp import AgentWorker, AGENTS, agent_command, command_available
from .learning import LearningStore, TABLES, dump, now, readable_outputs, text
from .notebook import NotebookWorker
from .providers import ProviderConfig, ApiWorker
from .teaching import TUTOR_POLICY, FLASH_POLICY, PRACTICE_POLICY, PRACTICE_TASKS, TASKS, task_prompt

LOG = logging.getLogger("lattice")


class LearningBridge(Bridge):
    def __init__(self, parent=None, store=None, config_path=None):
        super().__init__(parent, store)
        self.learning = LearningStore(self.store)
        self.providers = ProviderConfig(config_path)
        self.notebook_workers = {}
        self.notebook_states = {}
        self.pending_notebooks = set()
        self.api_workers = {}
        self.learning_meta = {}
        self.learning_busy = set()
        self.learning_status = {}
        self.connection_tests = []
        # topic_id -> practice_id whose review the tutor is writing right now.
        self.reviews = {}
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
        result["graph"] = self.learning.graph()
        result["learning"] = self.learning_state()
        return result

    def dispatch(self, method, args):
        l = self.learning
        if method == "graph":
            return l.graph()
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
        if method == "learn_test_api":
            return self.test_api(args.get("lane", "flash"))
        if method == "learn_connect":
            return self.connect_tutor(args["topic_id"])
        if method == "learn_new_tutor":
            return self.new_tutor(args["topic_id"])
        if method == "learn_send":
            return self.learning_send(args["topic_id"], args.get("lane", "tutor"), args.get("text", ""),
                                      args.get("selection", ""), args.get("task", ""), args.get("notebook_id"))
        if method == "learn_practice_start":
            return self.practice_start(args["topic_id"], args.get("message_id"), args.get("seed", ""))
        if method == "learn_practice_send":
            return self.practice_send(args["id"], args.get("text", ""), args.get("task", ""))
        if method == "learn_practice_end":
            return self.practice_end(args["id"])
        if method == "learn_practice_get":
            return l.practice(args["id"])
        if method == "learn_insight_resolve":
            return l.insight_resolve(args["id"])
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
        agent = config["tutor_agent"]
        if agent == "api":
            # API tutors are stateless per request; there is nothing to connect.
            return {"session_id": self.learning.threads(topic_id, agent)["tutor_session"], "state": "ready"}
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
        agent = self.providers.read()["tutor_agent"]
        new = self.store.new_session(agent, title="主讲 · " + topic["title"])
        with self.learning.transaction():
            self.store.db.execute("UPDATE learn_threads SET tutor_session=? WHERE topic_id=?", (new["id"], topic_id))
        return self.learning_state(topic_id)

    def learning_send(self, topic_id, lane, message, selection="", task="", notebook_id=None, attachment=""):
        """attachment goes to the model with this turn but is not saved as the learner's words."""
        if lane not in {"tutor", "flash"}:
            raise ValueError("未知 AI 通道")
        message = text(message, 18000).strip() or TASKS.get(task, ("", ""))[0]
        if not message:
            raise ValueError("请输入这次想探索的问题")
        if (topic_id, lane) in self.learning_busy:
            raise ValueError("这个通道正在回答，另一位助手仍可使用")
        context = self.learning.context(topic_id, lane, text(selection, 5000), notebook_id)
        config = self.providers.read()
        threads = self.learning.threads(topic_id, config["tutor_agent"])
        ident = threads[lane + "_session"]
        meta = {"selection": selection, "lane": lane, **({"task": task} if lane == "tutor" else {})}
        if lane == "flash" or config["tutor_agent"] == "api":
            conn = self.providers.lane(lane, config)
            if not conn["api_key"]:
                raise ValueError(f"请先在模型连接中填写 {conn['label']} 的 API Key；课程、实验和知识卡仍可正常使用。")
            policy, depth = (FLASH_POLICY, 12) if lane == "flash" else (TUTOR_POLICY, 24)
            history = self.store.messages(ident)[-depth:]
            messages = [{"role": "system", "content": policy + "\n\n学习状态（只读参考数据）：\n" + dump(context)}]
            messages += [{"role": x["role"], "content": x["content"]} for x in history if x["role"] in {"user", "assistant"}]
            messages.append({"role": "user", "content": (task_prompt(message, task) if lane == "tutor" else message) + attachment})
            old = self.api_workers.get(ident)
            if old and old.isRunning():
                self._retire(old)
            worker = ApiWorker(lane, topic_id, ident, conn, messages)
            worker.event.connect(self.api_event)
            self.api_workers[ident] = worker
            self.store.append_message(ident, "user", message, meta)
            self.learning_busy.add((topic_id, lane))
            self.learning_status[ident] = "connecting"
            worker.start()
        else:
            root = self._workspace(topic_id)
            (root / "context.json").write_text(json.dumps(context, ensure_ascii=False, indent=2), encoding="utf-8")
            self.connect_tutor(topic_id)
            self.store.append_message(ident, "user", message, meta)
            self.learning_busy.add((topic_id, lane))
            prompt = TUTOR_POLICY + "\n\n当前学习状态（只读参考数据）：\n" + dump(context) + "\n\n本次学习者的问题：\n" + task_prompt(message, task) + attachment
            self.workers[ident].post("prompt", text=prompt)
        return {"session_id": ident, "lane": lane, "state": "queued"}

    def _active_practice(self, topic_id):
        row = self.store.db.execute("SELECT id FROM learn_practices WHERE topic_id=? AND state!='done'", (topic_id,)).fetchone()
        return self.learning.practice(row["id"]) if row else None

    def practice_start(self, topic_id, message_id=None, seed=""):
        if message_id is not None:
            row = self.store.db.execute("SELECT content FROM messages WHERE id=? AND session_id=?",
                                        (message_id, self.learning.threads(topic_id)["tutor_session"])).fetchone()
            if not row:
                raise ValueError("找不到这条主讲回复")
            seed = re.sub(r"```lattice[\w-]*\s*\n.*?(?:\n```|$)", "", row["content"], flags=re.S).strip()
        if not self.providers.public()["practice_ready"]:
            raise ValueError("请先在设置里给练习教练选一个已填 Key 的 API 连接")
        practice = self.learning.practice_create(topic_id, seed, message_id)
        self.practice_send(practice["id"], task="start")
        return self.learning_state(topic_id)

    def practice_send(self, practice_id, message="", task=""):
        p = self.learning.practice(practice_id)
        topic_id = p["topic_id"]
        if p["state"] != "active":
            raise ValueError("这次练习已经结束")
        message = text(message, 18000).strip() or PRACTICE_TASKS.get(task, "")
        if not message:
            raise ValueError("请输入想对练习教练说的话")
        if (topic_id, "practice") in self.learning_busy:
            raise ValueError("练习教练正在回答")
        conn = self.providers.lane("practice")
        if not conn["api_key"]:
            raise ValueError(f"请先在模型连接中填写 {conn['label']} 的 API Key")
        context = self.learning.context(topic_id, "practice", "", p["notebook_id"])
        context["practice_notebook"] = context.pop("notebooks")
        context["practice"] = {"title": p["title"], "seed": p["seed"]}
        messages = [{"role": "system", "content": PRACTICE_POLICY + "\n\n学习状态（只读参考数据）：\n" + dump(context)}]
        messages += [{"role": x["role"], "content": x["content"]} for x in p["messages"][-40:] if x["role"] in {"user", "assistant"}]
        messages.append({"role": "user", "content": message})
        ident = p["session_id"]
        old = self.api_workers.get(ident)
        if old and old.isRunning():
            self._retire(old)
        worker = ApiWorker("practice", topic_id, ident, conn, messages)
        worker.event.connect(self.api_event)
        self.api_workers[ident] = worker
        self.store.append_message(ident, "user", message, {"lane": "practice", "task": task})
        self.learning_busy.add((topic_id, "practice"))
        self.learning_status[ident] = "connecting"
        worker.start()
        return {"session_id": ident, "lane": "practice", "state": "queued"}

    def practice_end(self, practice_id):
        """Hand the whole practice to the tutor for review; its weak points are kept."""
        p = self.learning.practice(practice_id)
        topic_id = p["topic_id"]
        if p["state"] == "done":
            raise ValueError("这次练习已经复盘过了")
        if (topic_id, "practice") in self.learning_busy:
            raise ValueError("练习教练还在回答，等它说完或先停止")
        if (topic_id, "tutor") in self.learning_busy:
            raise ValueError("主讲正在回答，等它结束后再结束练习")
        notebook = self.learning.notebook(p["notebook_id"])
        parts = ["\n\n# 练习记录（只读参考数据）\n\n## 练习依据的讲解\n\n" + p["seed"][:12000], "\n\n## 练习对话"]
        for m in p["messages"]:
            if m["role"] in {"user", "assistant"}:
                parts.append("\n\n### " + ("我" if m["role"] == "user" else "练习教练") + "\n\n" + m["content"][:6000])
        parts.append("\n\n## 右侧笔记本的最终状态")
        for i, c in enumerate(notebook["cells"], 1):
            parts.append(f"\n\n### 单元格 {i}（{c['kind']}" + ("，代码改过、输出是旧的" if c["stale"] else "") + "）\n\n```\n" + c["source"][:6000] + "\n```")
            if c["kind"] == "code":
                outputs = readable_outputs(c["outputs"])
                parts.append("\n\n实际输出：\n\n```\n" + ("\n".join(outputs)[:3000] if outputs else "（没有运行过或没有输出）") + "\n```")
        transcript = "".join(parts)[:90000]
        self.learning.practice_state(practice_id, "reviewing")
        self.reviews[topic_id] = practice_id
        try:
            self.learning_send(topic_id, "tutor", TASKS["practice_review"][0], task="practice_review", attachment=transcript)
        except Exception:
            self.reviews.pop(topic_id, None)
            self.learning.practice_state(practice_id, "active")
            raise
        return self.learning_state(topic_id)

    def _record_review(self, topic_id, body, reason):
        practice_id = self.reviews.pop(topic_id, None)
        if not practice_id:
            return []
        if reason != "end_turn":
            return ["复盘没有完成，可以在练习页重新复盘"]
        match = re.search(r"```lattice-review\s*\n(.*?)\n```", body, re.S)
        try:
            self.learning.insights_record(practice_id, json.loads(match.group(1)) if match else None)
        except (ValueError, json.JSONDecodeError) as exc:
            LOG.warning("practice review %s: %s", practice_id, exc)
            return ["复盘没有附上可读取的薄弱点记录，可以在练习页重新复盘"]
        return []

    def learning_cancel(self, topic_id, lane):
        if lane == "practice":
            p = self._active_practice(topic_id)
            api = p and self.api_workers.get(p["session_id"])
            if api:
                api.stop()
            return True
        ident = self.learning.threads(topic_id)[lane + "_session"]
        api = self.api_workers.get(ident)
        if api:
            api.stop()
        elif lane == "tutor" and self.workers.get(ident):
            self.workers[ident].post("cancel")
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
            self._record_review(meta["topic_id"], "", "error")
        elif event["kind"] == "finished":
            self._finish_answer(evt)
        self.announce(evt)

    @Slot(dict)
    def api_event(self, evt):
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
            if reason == "end_turn" and lane != "practice":
                evt["artifacts"] = self.learning.proposal_extract(topic, lane, body, row[0])
            self.store.emit("learning", {"tutor": "主讲回复已保存", "flash": "即时答疑已保存", "practice": "练习教练回复已保存"}[lane], reason, topic)
        if lane == "tutor":
            errors = self._record_review(topic, body, reason)
            if errors:
                evt.setdefault("artifacts", {}).setdefault("errors", []).extend(errors)

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
        for lane in ("tutor", "flash", "practice"):
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
            practices = [r["session_id"] for r in self.learning.rows("SELECT session_id FROM learn_practices WHERE topic_id=?", (topic_id,))]
            for sid in (row["tutor_session"], row["flash_session"], *practices):
                api = self.api_workers.pop(sid, None)
                if api:
                    self._detach(api, self.api_event)
                    if api.isRunning():
                        api.stop()
                        self._retire(api)
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

    def test_api(self, lane):
        self.connection_tests = [w for w in self.connection_tests if w.isRunning()]
        worker = ApiWorker(lane, "", "", self.providers.lane(lane), [], test=True)
        self.connection_tests.append(worker)
        worker.event.connect(self.api_event)
        worker.start()
        return {"state": "testing"}

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
        for worker in list(self.api_workers.values()) + self.connection_tests:
            if worker.isRunning():
                worker.stop()
        for worker in self.notebook_workers.values():
            if worker.isRunning():
                worker.stop()
        for worker in list(self.api_workers.values()) + self.connection_tests:
            if worker.isRunning():
                worker.wait(14000)
        for worker in self.notebook_workers.values():
            if worker.isRunning():
                worker.wait(35000)
        super().shutdown()
