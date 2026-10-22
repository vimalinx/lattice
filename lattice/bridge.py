"""The Qt bridge: one request entry point for the UI, and the orchestration behind it.

It owns the vault (through the model), the agent turns, file runs and notebook
kernels, and the learner's interaction state as the UI reports it. Long work
(API calls, runs, installs, shell commands, web requests) happens off the GUI
thread; everything that touches the vault or the index happens on it.
"""
from __future__ import annotations

import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import threading
import time
import zipfile

from PySide6.QtCore import QObject, QTimer, QUrl, Signal, Slot
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import QFileDialog

from . import agents, tools
from .envs import Envs, missing_module
from .index import dump, uid
from .model import Lattice, STAGES, readable_outputs, text
from .notebook import NotebookWorker
from .providers import AGENT_NAMES, ApiWorker, Config
from .runner import RunWorker, command_for, missing_tool, runner_for, tool_hint
from .sandbox import MPL, Sandbox
from .vault import APPEND_ONLY, VAULT_PATH, VaultError, kind_of, split_frontmatter

LOG = logging.getLogger("lattice")
DATA_HOME = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
# Machine-local state that is not learning data: logs, web profile, the pre-vault database.
APP_HOME = DATA_HOME / "lattice"
LEGACY_DB = APP_HOME / "lattice.db"
TEXT_EXT = {".md", ".txt", ".py", ".js", ".mjs", ".ts", ".c", ".h", ".cpp", ".cc", ".hpp", ".rs", ".go", ".sh", ".json", ".yaml", ".yml",
            ".toml", ".csv", ".tsv", ".html", ".css", ".rb", ".lua", ".jl", ".r", ".R", ".java", ".pl", ".php", ".ini", ".cfg", ".tex", ".sql", ".jsonl"}
IMAGE_EXT = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp"}
CODE_EXT = {"python": ".py", "py": ".py", "c": ".c", "cpp": ".cpp", "c++": ".cpp", "rust": ".rs", "rs": ".rs", "go": ".go",
            "javascript": ".js", "js": ".js", "typescript": ".ts", "ts": ".ts", "bash": ".sh", "sh": ".sh", "shell": ".sh", "ruby": ".rb",
            "lua": ".lua", "julia": ".jl", "r": ".r", "java": ".java"}


def compact(items):
    return json.dumps(items, ensure_ascii=False, default=str)


class Bridge(QObject):
    event = Signal(str)
    _done = Signal(object, object)

    def __init__(self, parent=None, root=None, config_path=None, migrate=True):
        super().__init__(parent)
        self._init_log()
        self.config = Config(config_path)
        # LATTICE_VAULT wins; otherwise the location chosen in settings; otherwise ~/Lattice.
        chosen = self.config.read()["vault"] if not os.environ.get("LATTICE_VAULT") else ""
        self.lattice = Lattice(root or (Path(chosen).expanduser() if chosen else VAULT_PATH), migrate_from=LEGACY_DB if migrate and root is None else None)
        self.root = self.lattice.root
        self.envs = Envs(self.lattice.vault)
        if not self.lattice.vault.path("envs/default.txt").exists():
            self.envs.wanted("default")
            self.lattice.index.sync()
            self.lattice.vault.commit("建立默认的 Python 环境定义", "lattice")
        self.sandbox = Sandbox(self.root, self.lattice.projects, lambda: self.config.read()["sandbox_paths"])
        self.workers, self.turns, self.contexts, self.busy, self.status = {}, {}, {}, set(), {}
        self.reviews = {}
        self.runs, self.kernels, self.kernel_states, self.batches = {}, {}, {}, {}
        self.screen, self.edits, self.last_write = {}, {}, 0.0
        self.tests, self._retired = [], []
        self.ui_waiters = {}
        self.closing = False
        self.state_path = self.root / ".lattice" / "state.json"
        self._done.connect(lambda then, result: then(result))
        # Outside edits are picked up every couple of seconds; the learner's own edits are
        # committed once they pause, and before any agent action.
        self.sync_timer = QTimer(self)
        self.sync_timer.timeout.connect(self.sync)
        self.sync_timer.start(2000)
        self.commit_timer = QTimer(self)
        self.commit_timer.timeout.connect(lambda: time.monotonic() - self.last_write > self.config.read()["commit_idle"] and self.commit_mine())
        self.commit_timer.start(10000)

    @staticmethod
    def _init_log():
        if LOG.handlers:
            return
        APP_HOME.mkdir(parents=True, exist_ok=True)
        path = APP_HOME / "lattice.log"
        handler = RotatingFileHandler(path, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        LOG.addHandler(handler)
        LOG.setLevel(logging.INFO)
        try:
            path.chmod(0o600)
        except OSError:
            pass

    @staticmethod
    def _scrub(payload):
        # Requests may carry credentials (settings_save); never log them.
        return re.sub(r'"(api_key|key|token|password|secret|brave_key|tavily_key)"\s*:\s*"[^"]*"', r'"\1":"[REDACTED]"', str(payload))[:400]

    def announce(self, data):
        self.event.emit(compact(data))

    def background(self, work, then):
        """Run work() off the GUI thread, then then(result or exception) back on it."""
        def run():
            try:
                result = work()
            except Exception as exc:  # handed to then(), which decides what the learner sees
                result = exc
            self._done.emit(then, result)
        threading.Thread(target=run, daemon=True).start()

    @Slot(str, result=str)
    def request(self, payload):
        try:
            req = json.loads(payload)
            method = req.pop("method")
            handler = getattr(self, "rpc_" + str(method), None)
            if not handler:
                raise ValueError("未知操作：" + str(method))
            return compact({"ok": True, "data": handler(**req)})
        except VaultError as e:
            return compact({"ok": False, "error": str(e), "conflict": str(e) == "conflict"})
        except Exception as e:
            LOG.exception("request failed: %s", self._scrub(payload))
            return compact({"ok": False, "error": str(e)})

    # ---- the vault -------------------------------------------------------------------------------
    def sync(self):
        if self.closing:
            return
        try:
            changed, removed = self.lattice.index.sync()
            if changed or removed:
                self.announce({"type": "changed", "paths": changed + removed, "external": True})
        except Exception as exc:
            LOG.warning("vault sync failed: %s", exc)

    def changed(self, paths):
        self.announce({"type": "changed", "paths": list(paths), "external": False})

    def commit_mine(self):
        """Commit the learner's pending edits as their own step, and note in the journal what they wrote.

        Journal and conversation lines alone wait for the next real commit, so history stays readable."""
        vault = self.lattice.vault
        try:
            if not any(not rel.startswith(APPEND_ONLY) for _, rel in vault.changes()):
                return
            files = []
            for line in vault.git("diff", "HEAD", "--numstat", "--no-renames", check=False).splitlines():
                added, removed, rel = (line.split("\t") + ["", "", ""])[:3]
                if rel and not rel.startswith(APPEND_ONLY) and not rel.startswith("envs/"):
                    files.append({"file": rel, "added": int(added) if added.isdigit() else None, "removed": int(removed) if removed.isdigit() else None})
            commit = vault.commit("我的编辑", "me")
            if commit and files:
                self.lattice.record("wrote", {"files": files[:30], "commit": commit}, "me", [f["file"] for f in files[:30]])
        except Exception as exc:
            LOG.warning("commit failed: %s", exc)

    def rpc_bootstrap(self):
        try:
            state = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            state = {}
        return {**self.rpc_state(), "vault": str(self.root), "layout": state.get("layout"), "config": self.config.public(),
                "sandbox": {"ok": self.sandbox.available(), "why": self.sandbox.why_not()}, "migrated": self.lattice.migrated,
                "problems": self.lattice.index.problems[:20]}

    def catalog(self, kind, **filters):
        """Everything of one kind, whatever panels are open. Vault material comes from the model; the rest is this machine's."""
        if kind == "projects":
            return self.lattice.projects()
        if kind == "envs":
            return [{"name": n, "definition": self.envs.definition_rel(n), "packages": self.envs.wanted(n), "ready": self.envs.ready(n)} for n in self.envs.names()]
        return self.lattice.catalog(kind, **filters)

    def rpc_list(self, kind, **filters):
        return self.catalog(kind, **filters)

    def rpc_state(self):
        l = self.lattice
        docs = l.index.rows("SELECT id, kind, title, topic, path, updated FROM docs ORDER BY updated DESC LIMIT 3000")
        cards = self.catalog("cards")
        return {"topics": l.topics(), "active_topic": l.active_topic(), "docs": docs, "projects": self.catalog("projects"), "cards": cards,
                "insights": self.catalog("insights", state="active"),
                "due": sum(c["due_now"] for c in cards), "practices": self.catalog("practices"), "busy": sorted(self.busy), "status": self.status,
                "kernels": self.kernel_states, "running": [{"run": k, "path": v["path"], "by": v["by"]} for k, v in self.runs.items()],
                "agents": {name: AGENT_NAMES[name] for name in agents.NAMES}, "undone": sorted(l.undone())}

    def rpc_layout_save(self, layout):
        try:
            state = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            state = {}
        state["layout"] = layout
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.state_path)
        return True

    def rpc_tree(self, path=""):
        return self.lattice.tree(path)

    def rpc_search(self, query):
        return self.lattice.search(query)

    def rpc_graph(self, topic=None):
        return self.lattice.graph(topic or None)

    def rpc_journal(self, types=None, ref=None, since=None, until=None, actor=None, limit=200):
        return self.lattice.journal(types, ref, since, until, actor, limit)

    def rpc_focus(self, topic=None):
        self.lattice.focus(topic or None)
        return self.rpc_state()

    # ---- files -------------------------------------------------------------------------------------
    def rpc_file_read(self, path):
        l = self.lattice
        absolute, rel = l.resolve(path)
        if absolute.is_dir():
            return {"path": rel or str(absolute), "dir": True, "entries": l.tree(rel or str(absolute))}
        if not absolute.exists():
            raise ValueError("文件不存在：" + str(path))
        ext = absolute.suffix
        result = {"path": rel or str(absolute), "name": absolute.name, "ext": ext, "kind": kind_of(rel) if rel else "file",
                  "readonly": rel is None or rel.startswith(APPEND_ONLY) or rel.startswith(".lattice/"), "mtime": str(absolute.stat().st_mtime_ns),
                  "size": absolute.stat().st_size, "external": rel is None}
        if ext.lower() in IMAGE_EXT:
            import base64
            if absolute.stat().st_size > 12_000_000:
                return {**result, "binary": True}
            return {**result, "image": "data:" + IMAGE_EXT[ext.lower()] + ";base64," + base64.b64encode(absolute.read_bytes()).decode()}
        if result["kind"] == "notebook":
            nb = l.notebook(rel or str(absolute))
            return {**result, "notebook": nb, "kernel": self.kernel_states.get(nb["id"], {"state": "offline"}),
                    "mode": self._kernel_mode(rel) if rel else "mine", "env": self.envs.name_for(absolute)}
        got = l.read_file(rel or str(absolute))
        result.update({k: got[k] for k in ("content", "binary", "truncated") if k in got})
        if result["kind"] == "card":
            result["card"] = l.card(l.index.one("SELECT id FROM files WHERE path=?", (rel,))["id"])
        elif result["kind"] in ("topic", "lesson", "note", "insight"):
            row = l.index.one("SELECT id FROM files WHERE path=?", (rel,))
            if row and row["id"]:
                result["doc"] = l.doc(row["id"])
                if result["kind"] == "topic":
                    result["topic"] = l.topic(row["id"])
                    result["practices"] = l.practices(row["id"])
                    result["insights"] = l.insights(row["id"])
                    result["inside"] = l.index.rows("SELECT id, kind, title, path FROM docs WHERE topic=? ORDER BY kind, updated DESC", (row["id"],))
                result["links"] = l.links_of(row["id"])
        runnable = runner_for(absolute, self.config.read()["runners"])
        result["runnable"] = bool(runnable)
        if runnable and "{python}" in runnable:
            result["env"] = self.envs.name_for(absolute)
        return result

    def rpc_file_write(self, path, content, mtime=None):
        self.last_write = time.monotonic()
        _, rel = self.lattice.resolve(path)
        if rel and kind_of(rel) in ("topic", "card", "lesson", "note", "insight"):
            # The learner may write any text; a file Lattice knows keeps its id so links stay whole.
            attrs, _ = split_frontmatter(content)
            old = self.lattice.index.one("SELECT id FROM files WHERE path=?", (rel,))
            if old and old["id"] and attrs.get("id") not in (None, old["id"]):
                raise ValueError("请不要改文件开头的 id，它让别处的引用保持有效")
        result = self.lattice.write_file(path, content, mtime)
        if rel:
            self.edits[rel] = time.monotonic()
        return result

    def rpc_doc_save(self, path, mtime=None, **fields):
        """The learner's edits to a document's form: its body and the attributes that kind has."""
        l = self.lattice
        self.last_write = time.monotonic()
        _, rel = l.resolve(path)
        if mtime is not None and l.vault.mtime(rel) != str(mtime):
            raise VaultError("conflict")
        kind = kind_of(rel)
        ident = l.index.one("SELECT id FROM files WHERE path=?", (rel,))["id"]
        current = l.doc(ident)
        if kind == "card":
            card = l.card(ident)
            l.card_save({"id": ident, "title": fields.get("title", card["title"]), "body": fields.get("body", card["body"]),
                         "question": fields.get("question", card["question"]), "tags": fields.get("tags", card["tags"])}, "me")
        elif kind == "topic":
            change = {k: fields[k] for k in ("title", "question", "state") if k in fields}
            if "body" in fields:
                change["notes"] = fields["body"]
            l.topic_save({"id": ident, **change})
        elif kind == "lesson":
            l.lesson_save({"id": ident, **{k: fields[k] for k in ("title", "objective", "state", "body") if k in fields}})
        else:
            def change(a, b):
                if "title" in fields:
                    a["title"] = fields["title"].strip() or a.get("title") or "未命名"
                if "tags" in fields:
                    a["tags"] = [str(t)[:40] for t in fields["tags"]][:20]
                return a, text(fields["body"]) if "body" in fields else b
            l._edit_doc(ident, change)
        new = l.index.locate(ident) or rel
        self.edits[new] = time.monotonic()
        return {"path": new, "mtime": l.vault.mtime(new), "title": l.doc(ident)["title"] if l.index.locate(ident) else current["title"]}

    def rpc_file_create(self, folder="code", name="未命名.py", content=""):
        rel = self.lattice.create_file(folder, name, content)
        self.last_write = time.monotonic()
        return {"path": rel}

    def rpc_doc_create(self, kind, title, topic=None, body=""):
        l = self.lattice
        if kind == "topic":
            return {"path": l.topic_save({"title": title, "question": body})["path"]}
        if kind == "card":
            return {"path": l.card_save({"title": title, "topic": topic, "body": body})["path"]}
        if kind == "lesson":
            return {"path": l.lesson_save({"title": title, "topic": topic, "body": body})["path"]}
        if kind == "note":
            return {"path": l.note_create(title, body, "随手记", (), "me", topic)}
        if kind == "notebook":
            return {"path": l.notebook_create(title, topic)}
        raise ValueError("不知道怎么新建这种文档")

    def rpc_file_rename(self, path, name):
        return {"path": self.lattice.rename_file(path, name)}

    def rpc_file_delete(self, path):
        _, rel = self.lattice.resolve(path)
        if rel and rel.endswith(".ipynb"):
            nb = self.lattice.notebook(rel)
            self._stop_kernel(nb["id"])
        self.commit_mine()
        self.lattice.delete_file(path)
        self.lattice.vault.commit("删除 " + str(path), "me")
        return True

    def rpc_file_history(self, path):
        return self.lattice.history(path)

    def rpc_file_version(self, path, commit):
        _, rel = self.lattice.resolve(path)
        version = next((v for v in self.lattice.history(rel) if v["commit"] == commit), None)
        return {"content": self.lattice.vault.at(commit, version["path"] if version else rel)}

    def rpc_file_external(self, path):
        absolute, _ = self.lattice.resolve(path)
        return QDesktopServices.openUrl(QUrl.fromLocalFile(str(absolute)))

    def rpc_open_folder(self, path=""):
        absolute = self.lattice.resolve(path)[0] if path else self.root
        return QDesktopServices.openUrl(QUrl.fromLocalFile(str(absolute if absolute.is_dir() else absolute.parent)))

    def rpc_open_url(self, url):
        target = QUrl(url)
        if target.scheme() not in ("https", "http"):
            raise ValueError("不支持该外部链接")
        return QDesktopServices.openUrl(target)

    def rpc_project_add(self, path=None):
        path = path or QFileDialog.getExistingDirectory(None, "挂载一个本地目录（AI 只读）", str(Path.home()), QFileDialog.Option.ShowDirsOnly)
        return self.lattice.add_project(Path(path).name, path) if path else None

    def rpc_attach_files(self, paths=None):
        """Copy files chosen on this computer into data/附件/, so they can be attached to a message and read
        by the agents (whose sandbox sees only the vault and mounted folders). The originals stay untouched."""
        paths = paths or QFileDialog.getOpenFileNames(None, "附上文件（复制进学习库的 data/附件/）", str(Path.home()))[0]
        out = []
        for raw in paths or []:
            source = Path(raw)
            if not source.is_file() or source.stat().st_size > 50 * 1024 * 1024:
                raise ValueError(f"{source.name} 不是文件或超过 50MB")
            rel = self.lattice.vault.unique("data/附件", source.stem or "附件", source.suffix)
            self.lattice.vault.write_bytes(rel, source.read_bytes())
            self.lattice.index.reindex(rel)
            out.append(rel)
        if out:
            self.last_write = time.monotonic()
        return out

    def rpc_project_remove(self, id):
        return self.lattice.remove_project(id)

    # ---- learner-owned parts of cards, and the rest of the map --------------------------------------
    def rpc_card_mine(self, id, stage=None, mine=None):
        if stage is not None and stage not in STAGES:
            raise ValueError("理解阶段无效")
        self.last_write = time.monotonic()
        return self.lattice.card_mine(id, stage, mine)

    def rpc_card_review(self, id, rating):
        return self.lattice.card_review(id, rating)

    def rpc_cards(self, refs):
        out = []
        for ref in refs[:30]:
            try:
                out.append(self.lattice.card(ref))
            except ValueError:
                out.append({"missing": str(ref)})
        return out

    def rpc_due(self):
        return self.lattice.due_cards()

    def rpc_topic_update(self, id, **change):
        allowed = {k: v for k, v in change.items() if k in ("title", "question", "state", "notes", "parent", "route")}
        return self.lattice.topic_save({"id": id, **allowed})

    def rpc_topic_delete(self, id):
        if any(self.contexts.get(t, (None, None))[1] == id for t in self.busy):
            raise ValueError("这个主题还有正在生成的回答，请先停止或等它说完")
        self.commit_mine()
        self.lattice.topic_delete(id)
        self.lattice.vault.commit("删除主题", "me")
        return self.rpc_state()

    def rpc_link(self, source, target, kind="related", why=""):
        return self.lattice.link(source, target, kind, why, "me")

    def rpc_unlink(self, id):
        return self.lattice.unlink(id)

    def rpc_insight_resolve(self, id):
        return self.lattice.insight_resolve(id, "me")

    def rpc_viewed(self, path, seconds, where=""):
        if seconds >= 30:
            self.lattice.record("viewed", {"file": path, "seconds": int(seconds), "where": str(where)[:200]}, "me", [path])
        return True

    def rpc_screen(self, state):
        """What the UI shows right now; agents read it with the screen tool."""
        self.screen = state if isinstance(state, dict) else {}
        for f in (self.screen.get("mine") or {}).get("files") or []:
            if f.get("typing"):
                self.edits[f.get("path")] = time.monotonic()
        return True

    def rpc_typing(self, path):
        self.edits[path] = self.last_write = time.monotonic()
        return True

    def typing(self, rel):
        files = (self.screen.get("mine") or {}).get("files") or []
        return time.monotonic() - self.edits.get(rel, -99) < 10 or any(f.get("path") == rel and f.get("dirty") for f in files)

    def screen_state(self):
        l = self.lattice
        topic = l.active_topic()
        return {**self.screen, "conversation_topic": l.topic(topic)["title"] if topic else "默认对话（不属于任何主题）",
                "running": [{"file": v["path"], "by": v["by"]} for v in self.runs.values()],
                "kernels": {k: v.get("state") for k, v in self.kernel_states.items()},
                "recent_runs": [{"at": e["at"][:16], "by": e["actor"], **{k: e["data"].get(k) for k in ("file", "cell", "state", "summary")}}
                                for e in l.journal("ran", limit=4)],
                "active_practices": [p for p in l.practices() if p["state"] == "active"],
                "agent_may_run_code": bool(self.config.read()["agent_auto_run"]), "sandbox": self.sandbox.available(), "today": tools.today()}

    # ---- notebooks ------------------------------------------------------------------------------------
    def rpc_cell_save(self, path, source, kind="code", id=None, after=None):
        self.last_write = time.monotonic()
        _, rel = self.lattice.resolve(path)
        self.edits[rel] = time.monotonic()
        return {"id": self.lattice.cell_save(path, source, kind, id, after)}

    def rpc_cell_delete(self, path, id):
        nb = self.lattice.notebook(path)
        if nb["id"] in self.batches:
            raise ValueError("这本实验笔记正在运行；先中断再删除单元格")
        return self.lattice.cell_delete(path, id)

    def rpc_cell_move(self, path, id, direction):
        return self.lattice.cell_move(path, id, direction)

    def _kernel_mode(self, rel):
        try:
            return ((self.lattice.vault.read_json(rel).get("metadata") or {}).get("lattice") or {}).get("kernel") or "sandbox"
        except (OSError, ValueError):
            return "sandbox"

    def rpc_kernel_mode(self, path, mode):
        """A notebook's kernel runs in the sandbox by default; the learner can switch it to their own permissions."""
        if mode not in ("sandbox", "mine"):
            raise ValueError("内核模式应为 sandbox 或 mine")
        _, rel = self.lattice.resolve(path)
        nb = self.lattice.vault.read_json(rel)
        nb.setdefault("metadata", {}).setdefault("lattice", {})["kernel"] = mode
        self.lattice.vault.write_json(rel, nb)
        self.lattice.index.reindex(rel)
        self._stop_kernel(nb["metadata"]["lattice"].get("id"))
        return True

    def kernel_state(self, ident):
        return self.kernel_states.get(ident, {}).get("state", "offline")

    def _kernel(self, nb, mode):
        worker = self.kernels.get(nb["id"])
        if worker and worker.isRunning() and worker.mode == mode:
            return worker
        if worker:
            self._stop_kernel(nb["id"])
        absolute, _ = self.lattice.resolve(nb["path"])
        cwd, env = absolute.parent, self.envs.name_for(absolute)
        sockets = self.root / ".lattice" / "kernels"
        wrap = None
        # Unix sockets in a private folder, never loopback TCP, whichever permissions the kernel runs with.
        sockets.mkdir(parents=True, exist_ok=True)
        sockets.chmod(0o700)
        if mode == "sandbox":
            extra = {"IPYTHONDIR": "/tmp/ipython", "JUPYTER_RUNTIME_DIR": "/tmp/jupyter", "JUPYTER_DATA_DIR": "/tmp/jupyter-data", "PYTHONUNBUFFERED": "1"}
            wrap = lambda command: self.sandbox.argv(command, cwd, extra, writable=[sockets])
        worker = NotebookWorker(nb["id"], cwd, lambda progress: self.envs.ensure(env, progress), self.config.read()["kernel_timeout"], wrap, sockets)
        worker.mode, worker.path = mode, nb["path"]
        worker.event.connect(self.notebook_event)
        self.kernels[nb["id"]] = worker
        self.kernel_states[nb["id"]] = {"state": "starting", "mode": mode, "path": nb["path"]}
        worker.start()
        return worker

    def run_notebook(self, path, cells=None, by="me", attempt=0):
        nb = self.lattice.notebook(path)
        _, rel = self.lattice.resolve(path)
        mode = self._kernel_mode(rel) if rel else "mine"
        if by != "me" and mode != "sandbox":
            raise ValueError("这本实验笔记的内核切到了学习者自己的权限，AI 不能在里面运行；请学习者自己点运行")
        if by != "me" and not self.sandbox.available():
            raise ValueError(self.sandbox.why_not())
        if nb["id"] in self.batches:
            raise ValueError("这本实验笔记正在运行；可以先中断")
        wanted = set(cells or [])
        targets = [c for c in nb["cells"] if c["kind"] == "code" and (not wanted or c["id"] in wanted)]
        if not targets:
            raise ValueError("没有可以运行的代码单元格")
        runs = [{"id": uid(), "cell_id": c["id"], "source": c["source"]} for c in targets]
        self.batches[nb["id"]] = {"path": nb["path"], "by": by, "runs": runs, "results": {}, "waiters": [], "attempt": attempt, "mode": mode}
        try:
            self._kernel(nb, mode).submit(runs)
        except Exception:
            self.batches.pop(nb["id"], None)
            raise
        self.announce({"type": "kernel", "notebook": nb["id"], "path": nb["path"], "state": "queued", "cells": [r["cell_id"] for r in runs]})
        return {"notebook": nb["id"], "runs": [r["id"] for r in runs]}

    @Slot(dict)
    def notebook_event(self, evt):
        if self.closing:
            return
        ident, kind = evt["notebook_id"], evt["kind"]
        batch = self.batches.get(ident)
        path = (batch or {}).get("path") or self.kernel_states.get(ident, {}).get("path")
        out = {"type": "kernel", "notebook": ident, "path": path, "kind": kind}
        if kind == "run_started":
            self.kernel_states.setdefault(ident, {}).update(state="busy")
            out.update(cell=evt["cell_id"], state="busy")
        elif kind == "output":
            out.update(cell=evt["cell_id"], outputs=evt["outputs"])
        elif kind == "run_finished":
            run = next((r for r in (batch or {}).get("runs", []) if r["id"] == evt["run_id"]), None)
            if run and evt["state"] in ("completed", "error"):
                self.lattice.cell_result(path, run["cell_id"], evt["outputs"], evt.get("execution_count"), run["source"])
            if run and evt["state"] != "skipped":
                self._ran(path, evt["state"], evt["outputs"], batch["by"], batch["mode"] == "sandbox", cell=run["cell_id"])
            if batch is not None:
                batch["results"][evt["run_id"]] = evt
            out.update(cell=evt["cell_id"], state=evt["state"], outputs=evt["outputs"], count=evt.get("execution_count"))
        elif kind in ("status", "batch_finished", "error"):
            state = "error" if kind == "error" else evt["state"]
            self.kernel_states.setdefault(ident, {}).update(state=state, kernel_id=evt.get("kernel_id"))
            out.update(state=state, message=evt.get("message", ""))
            if kind != "status" or state == "offline":
                self._batch_done(ident, evt.get("message") if kind == "error" else None)
        self.announce(out)

    def _batch_done(self, ident, error=None):
        batch = self.batches.pop(ident, None)
        if not batch:
            return
        results = [batch["results"].get(r["id"]) for r in batch["runs"]]
        failed = next((r for r in results if r and r["state"] == "error"), None)
        package = missing_module(" ".join(readable_outputs(failed["outputs"]))) if failed else None
        if package and batch["attempt"] == 0 and self.config.read()["auto_install"]:
            # Install, then run the failed cell and the ones after it again.
            at = next(i for i, r in enumerate(results) if r is failed)
            cells = [r["cell_id"] for r in batch["runs"][at:]]
            path, env = batch["path"], self.envs.name_for(self.lattice.resolve(batch["path"])[0])
            self.announce({"type": "kernel", "notebook": ident, "path": path, "kind": "status", "state": "installing", "message": f"缺少 {package}，正在装进环境「{env}」…"})

            def then(result):
                if isinstance(result, Exception):
                    note = f"缺少 {package}，自动安装失败：{str(result)[-400:]}"
                    return self._reply_batch(batch, results, note)
                self._installed(env, [package], result[0], batch["by"])
                try:
                    again = self.run_notebook(path, cells, batch["by"], attempt=1)
                    self.batches[again["notebook"]]["waiters"] = batch["waiters"]
                except Exception as exc:
                    self._reply_batch(batch, results, str(exc))
            self.background(lambda: self.envs.install(env, [package], binary_only=batch["by"] != "me"), then)
            return
        self._reply_batch(batch, results, error)

    def _reply_batch(self, batch, results, note=None):
        cells = [{"cell": r["cell_id"], "state": (res or {}).get("state", "skipped"), "output": readable_outputs((res or {}).get("outputs"), 4000)}
                 for r, res in zip(batch["runs"], results)]
        state = "error" if any(c["state"] == "error" for c in cells) else "completed"
        outputs = [o for res in results if res for o in res.get("outputs") or []]
        for waiter in batch["waiters"]:
            waiter({"state": state, "cells": cells, "outputs": outputs, "note": note})

    def _stop_kernel(self, ident):
        worker = self.kernels.pop(ident, None)
        self.kernel_states.pop(ident, None)
        self.batches.pop(ident, None)
        if worker:
            self._detach(worker, self.notebook_event)
            if worker.isRunning():
                worker.stop()
                if not worker.wait(3000):
                    self._retire(worker)

    def rpc_kernel_interrupt(self, path):
        nb = self.lattice.notebook(path)
        worker = self.kernels.get(nb["id"])
        if worker:
            worker.interrupt()
        return bool(worker)

    def rpc_kernel_restart(self, path):
        nb = self.lattice.notebook(path)
        worker = self.kernels.get(nb["id"])
        if worker and worker.isRunning():
            worker.restart()
        else:
            self._kernel(nb, self._kernel_mode(nb["path"]))
        return True

    # ---- running any file --------------------------------------------------------------------------------
    def rpc_run(self, path, cells=None, code=None, lang=None):
        """The learner's run: a notebook in its kernel, any other file with the learner's own permissions.

        `code` runs a snippet from a conversation as a scratch file."""
        if code is not None:
            ext = CODE_EXT.get(str(lang or "python").lower(), ".py")
            scratch = self.root / ".lattice" / "scratch" / ("snippet-" + uid() + ext)
            scratch.parent.mkdir(parents=True, exist_ok=True)
            scratch.write_text(text(code, 400000), encoding="utf-8")
            return {"run": self.run_file(str(scratch), "me", False, cwd=self.root / "code")}
        if str(path).endswith(".ipynb"):
            return self.run_notebook(path, cells, "me")
        return {"run": self.run_file(path, "me", False)}

    def rpc_run_stop(self, run):
        info = self.runs.get(run)
        if info:
            info["worker"].stop()
        return bool(info)

    def python_for(self, absolute, rel, progress):
        """A file in a mounted folder with its own .venv uses it; everything else uses the vault's environment."""
        if rel is None:
            folder = absolute.parent
            while folder != folder.parent:
                if (folder / ".venv/bin/python").exists():
                    return str(folder / ".venv/bin/python")
                if any(folder == Path(p["path"]) for p in self.lattice.projects()):
                    break
                folder = folder.parent
        return self.envs.ensure(self.envs.name_for(absolute if rel else self.root), progress)

    def agent_shell(self, command, timeout):
        """One agent shell command in the sandbox, with the vault's default Python environment on PATH (runs off the GUI thread)."""
        python = Path(self.envs.ensure("default"))
        env = {"PATH": f"{python.parent}:" + ":".join([*(p for p in self.sandbox.visible() if p.endswith("bin")), "/usr/local/bin", "/usr/bin"]),
               "VIRTUAL_ENV": str(python.parent.parent), "MPLBACKEND": "Agg"}
        return self.sandbox.shell(command, timeout, env=env)

    def run_file(self, path, by="me", sandboxed=False, cwd=None, attempt=0):
        l = self.lattice
        absolute, rel = l.resolve(path) if not str(path).startswith(str(self.root / ".lattice" / "scratch")) else (Path(path), None)
        template = runner_for(absolute, self.config.read()["runners"])
        if not template:
            raise ValueError(f"不知道怎么运行 {absolute.suffix or '这种'} 文件；可以在设置的「运行器」里加一行，例如 {{\"{absolute.suffix or '.ext'}\": \"程序 {{file}}\"}}")
        missing = missing_tool(template, None)
        if missing:
            raise ValueError(tool_hint(missing))
        if sandboxed and not self.sandbox.available():
            raise ValueError(self.sandbox.why_not())
        run_id = uid()
        scratch = self.root / ".lattice" / "scratch" / run_id
        workdir = Path(cwd or absolute.parent)
        shown = rel or str(absolute)

        def prepare(progress):
            python = self.python_for(absolute, rel, progress) if "{python}" in template else "python3"
            command = command_for(template, absolute, python, scratch)
            figures = {"MPLBACKEND": "module://lattice_figures", "PYTHONPATH": str(MPL), "LATTICE_FIGURES": str(scratch / "figures"), "PYTHONUNBUFFERED": "1"}
            if sandboxed:
                venv = Path(python).parent.parent
                env = {**figures, "VIRTUAL_ENV": str(venv), "PATH": f"{Path(python).parent}:" + ":".join(
                    [*(p for p in self.sandbox.visible() if p.endswith("bin")), "/usr/local/bin", "/usr/bin"])}
                return self.sandbox.argv(["bash", "-c", command], workdir, env, writable=[scratch]), None
            env = {**os.environ, **figures, "PYTHONPATH": os.pathsep.join(x for x in (str(MPL), os.environ.get("PYTHONPATH")) if x)}
            return ["bash", "-c", command], env
        scratch.mkdir(parents=True, exist_ok=True)
        worker = RunWorker(run_id, None, str(workdir), None, self.config.read()["run_timeout"], scratch, prepare)
        self.runs[run_id] = {"path": shown, "by": by, "sandbox": sandboxed, "worker": worker, "waiters": [], "attempt": attempt,
                             "cwd": cwd, "snippet": rel is None and str(absolute).startswith(str(self.root / ".lattice"))}
        worker.event.connect(self.run_event)
        worker.start()
        self.announce({"type": "run", "run": run_id, "path": shown, "kind": "started", "by": by, "sandbox": sandboxed})
        return run_id

    @Slot(dict)
    def run_event(self, evt):
        if self.closing:
            return
        info = self.runs.get(evt["run"])
        if not info:
            return
        evt["path"] = info["path"]
        if evt["kind"] != "finished":
            return self.announce(evt)
        self.runs.pop(evt["run"], None)
        self._retire(info["worker"])
        (self.root / ".lattice" / "runs").mkdir(parents=True, exist_ok=True)
        (self.root / ".lattice" / "runs" / (evt["run"] + ".json")).write_text(dump(evt["outputs"]), encoding="utf-8")
        package = missing_module(" ".join(readable_outputs(evt["outputs"]))) if evt["state"] == "error" and info["path"].endswith(".py") else None
        if not info.get("snippet"):
            self._ran(info["path"], evt["state"], evt["outputs"], info["by"], info["sandbox"], run=evt["run"], seconds=evt.get("seconds"))
        if package and info["attempt"] == 0 and self.config.read()["auto_install"]:
            absolute = Path(info["path"]) if info["path"].startswith("/") else self.root / info["path"]
            env = self.envs.name_for(absolute if not info.get("snippet") else self.root)
            self.announce({**evt, "kind": "status", "message": f"缺少 {package}，正在装进环境「{env}」，装好后自动重跑…"})

            def then(result):
                if isinstance(result, Exception):
                    evt["note"] = f"缺少 {package}，自动安装没有成功（PyPI 上可能叫别的名字）：{str(result)[-300:]}"
                    return self._run_done(info, evt)
                self._installed(env, [package], result[0], info["by"])
                try:
                    again = self.run_file(absolute, info["by"], info["sandbox"], info.get("cwd"), attempt=1)
                    self.runs[again]["waiters"] = info["waiters"]
                    self.announce({"type": "run", "run": evt["run"], "path": info["path"], "kind": "retry", "next": again})
                except Exception as exc:
                    evt["note"] = str(exc)
                    self._run_done(info, evt)
            self.background(lambda: self.envs.install(env, [package], binary_only=info["by"] != "me"), then)
            return
        if package:
            # Installing is switched off: the learner decides, from the run's output.
            evt["missing"] = {"package": package, "env": self.envs.name_for(self.root / info["path"] if not info["path"].startswith("/") else Path(info["path"]))}
            evt["note"] = f"缺少 Python 包 {package}。自动安装已关闭；可以点下面的按钮装上再运行。"
        self._run_done(info, evt)

    def _run_done(self, info, evt):
        self.announce(evt)
        for waiter in info["waiters"]:
            waiter(evt)

    def run_outputs(self, run):
        try:
            return json.loads((self.root / ".lattice" / "runs" / (run + ".json")).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise ValueError("找不到这次运行的输出")

    def _ran(self, path, state, outputs, by, sandboxed, cell=None, run=None, seconds=None):
        # What a later reader needs: the end of what it printed, and how it failed.
        printed = "".join(o.get("text", "") if isinstance(o.get("text"), str) else "".join(o.get("text") or []) for o in outputs
                          if o.get("output_type") == "stream" and o.get("name") == "stdout")
        failure = " ".join(readable_outputs([o for o in outputs if o.get("output_type") == "error"]))
        summary = (printed[-400:] + (" " + failure if failure else "")).strip() or " ".join(readable_outputs(outputs, 300))[-400:]
        self.lattice.record("ran", {"file": path, "cell": cell, "state": state, "summary": summary, "sandbox": sandboxed, "run": run, "seconds": seconds},
                            by, [path, *([cell] if cell else []), *([run] if run else [])])

    def _installed(self, env, packages, added, by):
        self.lattice.index.sync()
        self.lattice.record("installed", {"env": env, "packages": packages, "added": added}, by, [f"envs/{env}.txt"])
        commit = self.lattice.vault.commit(f"{'我' if by == 'me' else by}：往环境「{env}」装了 " + "、".join(packages), by)
        self.lattice.action(by, f"往环境「{env}」装了 " + "、".join(packages), f"file:envs/{env}.txt", commit)

    def run_for_agent(self, ctx, path, cells, finish):
        if str(path).endswith(".ipynb"):
            batch = self.run_notebook(path, cells, ctx.agent)
            self.batches[batch["notebook"]]["waiters"].append(finish)
        else:
            run = self.run_file(path, ctx.agent, True)
            self.runs[run]["waiters"].append(finish)
        ctx.act("运行了 " + str(path).rsplit("/", 1)[-1], "file:" + str(path), False)

    def rpc_env_info(self, name="default"):
        return {**self.envs.info(name), "names": self.envs.names()}

    def rpc_env_install(self, name, packages):
        def then(result):
            if isinstance(result, Exception):
                return self.announce({"type": "env", "name": name, "ok": False, "message": str(result)[-600:]})
            self._installed(name, packages, result[0], "me")
            self.announce({"type": "env", "name": name, "ok": True, "message": "已安装 " + "、".join(packages)})
        self.background(lambda: self.envs.install(name, packages, binary_only=False), then)
        return {"state": "installing"}

    # ---- agents -------------------------------------------------------------------------------------------
    def rpc_chat(self, agent=None, topic=None, thread=None):
        """One conversation as an AI panel shows it."""
        l = self.lattice
        if not thread:
            topic = l.active_topic() if topic is None else (topic or None)
            thread = l.thread_for(agent, topic)
        head = l.thread_head(thread)
        decisions = {e["data"].get("suggestion"): e["data"].get("decision") for e in l.journal("wrote", ref=thread, limit=200) if e["data"].get("suggestion")}
        return {"thread": thread, "head": head, "messages": l.messages(thread), "busy": thread in self.busy, "status": self.status.get(thread),
                "undone": sorted(l.undone()), "decisions": decisions,
                "practice": l.practice(thread) if head.get("practice") else None}

    def rpc_thread_new(self, agent, topic=None):
        topic = self.lattice.active_topic() if topic is None else (topic or None)
        old = self.lattice.thread_for(agent, topic)
        if old in self.busy:
            raise ValueError("先停止当前的回答，再开新会话")
        name = self.lattice.topic(topic)["title"] if topic else None
        return {"thread": self.lattice.thread_new(agent, topic, AGENT_NAMES[agent] + (" · " + name if name else ""))["id"]}

    def rpc_send(self, agent, message="", thread=None, topic=None, selection="", task="", note="", answer=None, attach=None, model=None):
        return self.send(agent, message, thread, topic, selection, task, note, answer, attach=attach, model=model)

    def send(self, agent, message="", thread=None, topic=None, selection="", task="", note="", answer=None, extra="", attach=None, model=None):
        l = self.lattice
        definition = agents.load(self.root, agent)
        practice = None
        if agent == "coach":
            practice = l.practice(thread)
            if practice["state"] != "active":
                raise ValueError("这次练习已经结束")
            topic = practice["topic"]
            message = text(message, 18000).strip() or agents.PRACTICE_TASKS.get(task, "")
        else:
            if not thread:
                topic = l.active_topic() if topic is None else (topic or None)
                thread = l.thread_for(agent, topic)
            else:
                topic = l.thread_head(thread).get("topic")
            message = text(message, 18000).strip() or agents.TASKS.get(task, ("", ""))[0]
        if not message:
            raise ValueError("请输入想说的话")
        if thread in self.busy:
            raise ValueError("这段对话正在回答；等它说完或先停止")
        conn = self.config.agent(agent, use=model)
        if not conn["api_key"]:
            raise ValueError(f"请先在设置里给{AGENT_NAMES[agent]}填写 {conn['label']} 的 API Key")
        history = l.messages(thread)[-definition["history"]:] if definition["history"] else []
        attach = [str(x)[:500] for x in (attach or []) if str(x).strip()][:12]
        meta = {"agent": agent, **({"selection": selection} if selection else {}), **({"task": task} if task else {}), **({"answer": answer} if answer else {}),
                **({"attach": attach} if attach else {})}
        l.append_message(thread, "user", message, meta)
        l.record("answered" if answer else "asked", {"text": message[:600], "agent": agent, **({"question": answer.get("question", "")[:400]} if answer else {}),
                                                    **({"screen": note[:300]} if note else {})}, "me", [thread, *([topic] if topic else [])])
        user = agents.task_prompt(message, task) + extra
        notes = "；".join(x for x in (note.strip(), ("附上了这些文件，需要时用 read 读：" + "、".join(attach)) if attach else "",
                                      ("选中了这段内容：\n" + selection.strip()[:5000]) if selection.strip() else "") if x)
        if notes:
            user += "\n\n（界面附注：" + notes + "）"
        where = f"这段对话属于主题「{l.topic(topic)['title']}」（topic:{topic}）。" if topic else "这是默认对话，不属于任何主题。"
        context = f"现在是 {tools.today()}。{where}对话 id：{thread}。"
        if practice:
            context += (f"\n\n这次练习：practice:{thread}「{practice['title']}」，练习文件：{practice['file']}。"
                        + (f"\n目标：{practice['goal']}" if practice.get("goal") else "") + "\n\n练习依据的讲解：\n" + practice["seed"])
        system = agents.system_prompt(self.root, definition, context)
        self._turn(agent, thread, topic, thread if practice else None, conn, system, history, user, definition["tools"])
        return {"thread": thread, "state": "queued"}

    def _turn(self, agent, thread, topic, practice, conn, system, history, user, allowed):
        messages = [{"role": "system", "content": system}]
        messages += [{"role": m["role"], "content": m["content"]} for m in history if m["role"] in ("user", "assistant")]
        messages.append({"role": "user", "content": user})
        old = self.workers.get(thread)
        if old and old.isRunning():
            self._retire(old)
        worker = ApiWorker(agent, thread, conn, messages, tools=tools.schemas(allowed))
        worker.event.connect(self.api_event)
        self.workers[thread] = worker
        self.contexts[thread] = (agent, topic, practice, set(allowed))
        self.turns[thread] = tools.Turn()
        self.busy.add(thread)
        self.status[thread] = "connecting"
        worker.start()

    def rpc_cancel(self, thread):
        worker = self.workers.get(thread)
        if worker:
            worker.stop()
        return True

    @Slot(dict)
    def api_event(self, evt):
        if self.closing:
            return
        thread = evt.get("thread")
        if evt["kind"] == "tool_call":
            worker = self.workers.get(thread)
            self.run_tool(thread, evt["name"], evt["arguments"], lambda content, w=worker, c=evt["call_id"]: w and w.tool_result(c, content))
            return
        if evt["kind"] == "status":
            self.status[thread] = evt.get("state", "")
        elif evt["kind"] == "finished":
            self._finish(evt)
        elif evt["kind"] == "error":
            self.status[thread] = "error"
        self.announce(evt)

    def run_tool(self, thread, name, arguments, reply):
        """Execute one agent tool call on the GUI thread and hand the JSON result back."""
        agent, topic, practice, allowed = self.contexts.get(thread, (None, None, None, set()))
        if not agent:
            return reply(dump({"error": "这个会话不能使用工具"}))
        # The learner's pending edits get their own commit, so an agent's commit holds only its change.
        self.commit_mine()
        turn = self.turns.setdefault(thread, tools.Turn())
        ctx = tools.Context(self, agent, thread, turn.focus if turn.refocus else topic, practice)
        before = len(turn.actions)

        def answer(result):
            actions = turn.actions[before:]
            self.announce({"type": "agent", "kind": "tool", "agent": agent, "thread": thread, "name": name, "actions": actions,
                           "failed": isinstance(result, dict) and "error" in result})
            reply(dump(result))
        try:
            args = json.loads(arguments or "{}") if isinstance(arguments, str) else (arguments or {})
            result = tools.call(ctx, allowed, name, args)
        except Exception as exc:
            LOG.info("tool %s failed: %s", name, exc)
            result = {"error": str(exc)}
        if isinstance(result, tools.Later):
            self.announce({"type": "agent", "kind": "tool_wait", "agent": agent, "thread": thread, "name": name})
            try:
                result.start(answer)
            except Exception as exc:
                answer({"error": str(exc)})
        else:
            answer(result)

    def _finish(self, evt):
        l = self.lattice
        thread, agent = evt["thread"], evt["agent"]
        self.busy.discard(thread)
        turn = self.turns.pop(thread, tools.Turn())
        _, topic, practice, _ = self.contexts.get(thread, (agent, None, None, set()))
        reason = evt.get("stop_reason", "end_turn")
        self.status[thread] = "ready" if reason == "end_turn" else reason
        body = evt.get("text", "")
        sources = list({s["url"]: s for s in turn.sources if s.get("url")}.values())[:12]
        if body.strip() or turn.actions or turn.suggestions:
            evt["message"] = l.append_message(thread, "assistant", body, {"agent": agent, "stop_reason": reason, "usage": evt.get("usage"),
                                                                          "actions": turn.actions, "sources": sources, "suggestions": turn.suggestions,
                                                                          **({"thinking": evt["thinking"], "think_seconds": evt.get("think_seconds")} if evt.get("thinking") else {})})
        evt.update(actions=turn.actions, sources=sources, suggestions=turn.suggestions)
        errors = []
        for ident, review_thread in list(self.reviews.items()):
            if review_thread == thread:
                # finish_practice_review clears the entry; one still here means the review never landed.
                self.reviews.pop(ident, None)
                errors.append("复盘没有完成，可以在练习里重新复盘" if reason != "end_turn" else "主会话没有记下这次复盘的结论，可以在练习里重新复盘")
        if turn.refocus and agent == "tutor":
            target_topic = turn.focus
            if target_topic != topic:
                # The turn that created or chose another topic belongs to that topic's conversation.
                target = l.thread_for("tutor", target_topic)
                ids = [r["id"] for r in l.index.rows("SELECT id FROM messages WHERE thread=? ORDER BY id DESC LIMIT 2", (thread,))]
                l.move_messages(ids + turn.carry, target)
                evt["moved_to"] = target
            l.focus(target_topic)
            evt["focus"] = target_topic or ""
        if agent == "organizer" and turn.actions:
            l.record("organized", {"summary": (body.strip().splitlines() or [""])[-1][:400], "actions": [a["summary"] for a in turn.actions]},
                     agent, [a["ref"][5:] for a in turn.actions if (a.get("ref") or "").startswith("file:")][:5] + [thread])
        for job in turn.after:
            try:
                job()
            except Exception as exc:
                errors.append(str(exc))
        if errors:
            evt["errors"] = errors

    # ---- organizing, practices, suggestions, undo -------------------------------------------------------
    def rpc_organize(self, path):
        """Tidy something the learner just wrote, in the background."""
        _, rel = self.lattice.resolve(path)
        if rel is None or rel.startswith(APPEND_ONLY):
            raise ValueError("只整理学习库里自己写的文件")
        thread = self.lattice.setting("organizer_thread")
        if not thread or not self.lattice.index.one("SELECT 1 FROM threads WHERE id=?", (thread,)):
            thread = self.lattice.set_setting("organizer_thread", self.lattice.thread_new("organizer", None, "整理")["id"])
        if thread in self.busy:
            raise ValueError("上一次整理还没结束")
        conn = self.config.agent("organizer")
        if not conn["api_key"]:
            raise ValueError(f"请先在设置里给整理助手填写 {conn['label']} 的 API Key")
        self.commit_mine()
        definition = agents.load(self.root, "organizer")
        message = f"学习者刚写完 {rel}，请整理。"
        self.lattice.append_message(thread, "user", message, {"agent": "organizer", "file": rel})
        system = agents.system_prompt(self.root, definition, f"现在是 {tools.today()}。")
        self._turn("organizer", thread, self.lattice.active_topic(), None, conn, system, [], message, definition["tools"])
        return {"thread": thread}

    def rpc_practice_start(self, thread, message):
        """Start a practice from one of the tutor's replies."""
        row = self.lattice.index.one("SELECT content FROM messages WHERE id=? AND thread=?", (int(message), thread))
        if not row:
            raise ValueError("找不到这条回复")
        seed = re.sub(r"```lattice:[\w-]*\s*\n.*?(?:\n```|$)", "", row["content"], flags=re.S).strip()
        fence = re.search(r"```([\w+#-]+)", seed)
        ext = CODE_EXT.get((fence.group(1) if fence else "python").lower(), ".py")
        conn = self.config.agent("coach")
        if not conn["api_key"]:
            raise ValueError("请先在设置里给练习教练选一个已填 Key 的 API 连接")
        topic = self.lattice.thread_head(thread).get("topic")
        p = self.lattice.practice_create(topic, seed, "", ext, int(message), "me")
        self.lattice.vault.commit("开始练习 · " + p["title"], "me")
        self.practice_send(p["id"], task="start")
        return p

    def practice_send(self, ident, message="", task=""):
        return self.send("coach", message, ident, task=task)

    def rpc_practice(self, id):
        return self.lattice.practice(id)

    def rpc_practice_end(self, id):
        """Hand the whole practice to the tutor for review; its weak points are kept."""
        p = self.lattice.practice(id)
        if p["state"] == "done":
            raise ValueError("这次练习已经复盘过了")
        if id in self.busy:
            raise ValueError("练习教练还在回答，等它说完或先停止")
        tutor = self.lattice.thread_for("tutor", p["topic"])
        if tutor in self.busy:
            raise ValueError("主会话正在回答，等它说完再结束练习")
        pointer = (f"\n\n（这次练习是 practice:{id}，练习文件是 {p['file']}。先用 read 读 practice:{id}："
                   "练习依据、全部对话、练习文件的最终内容和运行记录，再复盘。）")
        self.lattice.practice_state(id, "reviewing")
        self.reviews[id] = tutor
        try:
            self.send("tutor", agents.TASKS["practice_review"][0], tutor, task="practice_review", extra=pointer)
        except Exception:
            self.reviews.pop(id, None)
            self.lattice.practice_state(id, "active")
            raise
        return {"tutor_thread": tutor}

    def rpc_suggestion(self, thread, message, id, decision):
        """The learner applies or dismisses one of an agent's suggested edits."""
        if decision not in ("applied", "dismissed"):
            raise ValueError("只能应用或忽略")
        row = self.lattice.index.one("SELECT meta FROM messages WHERE id=? AND thread=?", (int(message), thread))
        item = next((s for s in json.loads(row["meta"]).get("suggestions") or [] if s["id"] == id), None) if row else None
        if not item:
            raise ValueError("找不到这条建议")
        if decision == "applied":
            current = self.lattice.read_file(item["file"])["content"]
            if item["old"] and current.count(item["old"]) != 1:
                raise ValueError("文件已经变了，建议里要替换的原文找不到了")
            changed = current.replace(item["old"], item["new"], 1) if item["old"] else current.rstrip("\n") + "\n" + item["new"] + "\n"
            self.commit_mine()
            self.lattice.write_file(item["file"], changed)
            self.lattice.vault.commit("应用建议：" + (item.get("why") or item["file"])[:60], "me")
            self.changed([item["file"]])
        self.lattice.record("wrote", {"suggestion": f"{message}:{id}", "decision": decision, "file": item["file"]}, "me", [thread, item["file"]])
        return True

    def rpc_undo(self, id):
        touched = self.lattice.action_undo(id)
        self.changed(touched)
        return {"touched": touched}

    # ---- settings ---------------------------------------------------------------------------------------------
    def rpc_settings(self):
        from .runner import RUNNERS
        return {**self.config.public(), "vault_path": str(self.root), "env_vault": bool(os.environ.get("LATTICE_VAULT")),
                "default_runners": RUNNERS, "agent_names": AGENT_NAMES}

    def rpc_settings_save(self, config):
        return self.config.save(config)

    def rpc_test_api(self, agent="tutor"):
        self.tests = [w for w in self.tests if w.isRunning()]
        worker = ApiWorker(agent, "", self.config.agent(agent), [], test=True)
        self.tests.append(worker)
        worker.event.connect(self.api_event)
        worker.start()
        return {"state": "testing"}

    def rpc_ui_save(self, ui):
        return self.config.save_ui(ui)

    def ui_request(self, agent, ops, done):
        """Ask the interface to carry out an agent's UI operations; done() gets what actually happened."""
        ident = uid()
        self.ui_waiters[ident] = done
        self.announce({"type": "ui", "request": ident, "ops": ops, "agent": agent})
        QTimer.singleShot(20000, lambda: self.ui_waiters.pop(ident, None) and done({"error": "界面没有响应"}))

    def rpc_ui_done(self, request, result):
        waiter = self.ui_waiters.pop(request, None)
        if waiter:
            waiter(result)
        return bool(waiter)

    def rpc_agent_definition(self, name):
        shipped = agents.load(Path("/nonexistent"), name)
        return {"definition": agents.load(self.root, name), "shipped": shipped, "overridden": agents.overridden(self.root, name),
                "tools": [{"name": n, "description": t["description"]} for n, t in tools.TOOLS.items()]}

    def rpc_agent_save(self, name, history, tools, policy, blocks=True):
        self.commit_mine()
        rel = agents.save(self.lattice.vault, name, history, tools, policy, blocks)
        self.lattice.index.reindex(rel)
        self.lattice.vault.commit(f"改写了{AGENT_NAMES[name]}的规则", "me")
        return self.rpc_agent_definition(name)

    def rpc_agent_reset(self, name):
        self.commit_mine()
        rel = agents.reset(self.lattice.vault, name)
        self.lattice.index.unindex(rel)
        self.lattice.vault.commit(f"{AGENT_NAMES[name]}的规则恢复默认", "me")
        return self.rpc_agent_definition(name)

    def rpc_rules(self):
        from .model import RULES
        return {"text": self.lattice.vault.read_text("AGENTS.md") if self.lattice.vault.path("AGENTS.md").exists() else "",
                "shipped": RULES.read_text(encoding="utf-8")}

    def rpc_rules_save(self, text):
        self.commit_mine()
        self.lattice.vault.write_text("AGENTS.md", text)
        self.lattice.vault.commit("改写了学习库的规矩", "me")
        return True

    def rpc_env_save(self, name, text):
        """The learner edits an environment's definition; the environment follows it on its next use."""
        rel = self.envs.definition_rel(name)
        self.commit_mine()
        self.lattice.vault.write_text(rel, text if text.endswith("\n") else text + "\n")
        self.lattice.index.reindex(rel)
        self.lattice.vault.commit(f"改了环境「{name}」的定义", "me")
        return self.rpc_env_info(name)

    def rpc_export(self, path=None):
        """The vault is the archive: every file as it is, without the index, git or machine-local state."""
        path = path or QFileDialog.getSaveFileName(None, "导出学习库（不含 API Key）", str(Path.home() / "lattice-learning.zip"), "ZIP (*.zip)")[0]
        if not path:
            return None
        self.commit_mine()
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            for rel in self.lattice.vault.files():
                archive.write(self.lattice.vault.path(rel), rel)
        return str(path)

    def rpc_import_markdown(self, folder=None):
        """Copy a folder of Markdown notes into notes/<folder name>/; the original stays untouched."""
        folder = folder or QFileDialog.getExistingDirectory(None, "从已有 Markdown 笔记目录导入（只复制）", str(Path.home()), QFileDialog.Option.ShowDirsOnly)
        if not folder:
            return None
        source = Path(folder).resolve()
        count = 0
        for path in sorted(source.rglob("*.md")):
            if any(p.startswith(".") or p in {"node_modules", ".git"} for p in path.relative_to(source).parts) or path.is_symlink() or path.stat().st_size > 1024 * 1024:
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            rel = f"notes/{source.name}/" + path.relative_to(source).as_posix()
            self.lattice.vault.write_text(rel, content)
            self.lattice.index.reindex(rel)
            count += 1
            if count >= 2000:
                break
        self.lattice.vault.commit(f"导入 {count} 篇 Markdown 笔记", "me")
        return {"count": count}

    # ---- lifecycle -----------------------------------------------------------------------------------------------
    @staticmethod
    def _detach(worker, slot):
        # Removed things must not receive late worker events.
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

        def drop(w=worker):
            try:
                self._retired.remove(w)
            except ValueError:
                pass
        worker.finished.connect(drop)

    def shutdown(self):
        self.closing = True
        workers = list(self.workers.values()) + self.tests + [r["worker"] for r in self.runs.values()]
        for worker in workers + list(self.kernels.values()):
            if worker.isRunning():
                worker.stop()
        for worker in workers:
            if worker.isRunning():
                worker.wait(14000)
        for worker in self.kernels.values():
            if worker.isRunning():
                worker.wait(35000)
        self.commit_mine()
        self.lattice.vault.commit("轨迹与对话", "lattice")
        self.lattice.db.close()
