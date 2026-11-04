"""The one way between the interface and everything behind it: requests, events, and the parts it is made of."""
from __future__ import annotations

from ..i18n import tr

import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import threading
import time
from PySide6.QtCore import QObject, QTimer, Signal, Slot
from .. import agents
from ..envs import Envs
from ..model import Lattice
from ..providers import Config
from .. import host
from ..netproxy import NetProxy
from ..sandbox import Sandbox
from ..vault import VAULT_PATH, VaultError

from .common import APP_HOME, LEGACY_DB, LOG, compact
from .vault import VaultPart
from .files import FilesPart
from .skills import SkillsPart
from .imported import ImportedPart
from .notes import MarksPart
from .windows import WindowsPart
from .notebooks import NotebooksPart
from .running import RunningPart
from .turns import TurnsPart
from .background import BackgroundPart
from .apps import AppsPart
from .settings import SettingsPart


class Bridge(VaultPart, FilesPart, SkillsPart, ImportedPart, MarksPart, WindowsPart, NotebooksPart, RunningPart, TurnsPart, BackgroundPart, AppsPart, SettingsPart, QObject):
    event = Signal(str)
    _done = Signal(object, object)
    _progress = Signal(object)   # news from work off the GUI thread (how far an install is), announced on it

    def __init__(self, parent=None, root=None, config_path=None, migrate=True):
        super().__init__(parent)
        self._init_log()
        self.config = Config(config_path)
        # LATTICE_VAULT wins; otherwise the location chosen in settings; otherwise ~/Lattice.
        chosen = self.config.read()["vault"] if not os.environ.get("LATTICE_VAULT") else ""
        self.lattice = Lattice(root or (Path(chosen).expanduser() if chosen else VAULT_PATH), migrate_from=LEGACY_DB if migrate and root is None else None)
        self.root = self.lattice.root
        self.envs = Envs(self.lattice.vault)
        self._follow_shipped_rules()
        if not self.lattice.vault.path("envs/default.txt").exists():
            self.envs.wanted("default")
            self.lattice.index.sync()
            self.lattice.vault.commit("建立默认的 Python 环境定义", "lattice")
        # The sandbox's way out to the internet; its socket lives outside the vault (a socket's path has to be short).
        self.netproxy = NetProxy(host.runtime_dir() / f"lattice-net-{os.getpid()}.sock")
        self.sandbox = Sandbox(self.root, self.lattice.projects, lambda: self.config.read()["sandbox_paths"],
                               network=lambda: self.config.read()["agent_network"], proxy=self.netproxy)
        self.workers, self.turns, self.contexts, self.busy, self.status = {}, {}, {}, set(), {}
        # Replies under way, each by its own key (a run): the conversation's id for the first, the id and a suffix for
        # another one at the same time (the quick answer answers two questions at once). run -> the conversation it is
        # in, and run -> the question it answers. Workers, turns, contexts and checks are kept by run.
        self.active_runs, self.asking = {}, {}
        # Conversations whose next reply answers their last question again (see rpc_retry).
        self.retrying = set()
        # Quick-answer turns checking an answer to the tutor's question: their thread -> the tutor's conversation.
        self.checking = {}
        # Skill comparisons: id -> the conversation they continue and what each side wrote.
        self.compares = {}
        # The organizer's background work, one at a time: stretches of explanation to note as cards, and conversations
        # the learner left, to save where they stand. Saves tried this run, by the last message they covered.
        self.jobs, self.job_running, self.saves_tried = [], {}, {}
        self.failures = {}   # thread -> why its last turn failed, until the next one goes through
        # Apps the app builder is making, each in a conversation of its own, by that conversation.
        self.builds = {}
        # Apps being checked, by the site each one is loaded from for its check (see appscheme).
        self.app_docs = {}
        self.reviews = {}
        self.runs, self.kernels, self.kernel_states, self.batches = {}, {}, {}, {}
        self.screen, self.edits, self.last_write = {}, {}, 0.0
        self.window_screens = {}   # what each separate window shows, by its id
        self.thread_windows = {}   # a conversation last spoken to in a window holding a working state: that window
        self.imports_read = {}     # conversations read to be imported, by request
        self.book_files = {}       # the book window's way to a book's bytes: token -> where the file is
        # Panels left in windows of their own when Lattice last closed: they come back into the main window.
        self.returned_windows = [{"params": w["params"], "origin": w.get("origin") or {}} for w in (self.lattice.setting("separate_windows") or {}).values()
                                 if isinstance(w, dict) and w.get("params")]
        self.lattice.set_setting("separate_windows", {})
        self.tests, self._retired = [], []
        self.ui_waiters = {}
        self.closing = False
        self.history_warned = -60.0
        self.state_path = self.root / ".lattice" / "state.json"
        self._done.connect(lambda then, result: then(result))
        self._progress.connect(self.announce)
        # Outside edits are picked up every couple of seconds; the learner's own edits are
        # committed once they pause, and before any agent action.
        self.sync_timer = QTimer(self)
        self.sync_timer.timeout.connect(self.sync)
        self.sync_timer.start(2000)
        # A notebook kernel on the GPU that has been idle a while is stopped, so the GPU can go back to sleep.
        self.gpu_timer = QTimer(self)
        self.gpu_timer.timeout.connect(self._gpu_idle)
        self.gpu_timer.start(60000)
        self.commit_timer = QTimer(self)
        self.commit_timer.timeout.connect(lambda: time.monotonic() - self.last_write > self.config.read()["commit_idle"] and self.commit_mine())
        self.commit_timer.start(10000)
        # Conversations the learner has stepped away from are saved where they stand (also those left when Lattice closed).
        self.save_timer = QTimer(self)
        self.save_timer.timeout.connect(self.save_idle)
        self.save_timer.start(300000)

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

    def tool_progress(self, ctx):
        """A callable for work off the GUI thread to say how far a waiting tool is; repeats are dropped."""
        last = [None]

        def say(text):
            if text != last[0]:
                last[0] = text
                self._progress.emit({"type": "agent", "kind": "tool_progress", "agent": ctx.agent, "thread": ctx.thread, "text": str(text)[:120]})
        return say

    def announce(self, data):
        # What an agent opens or rearranges goes to the window its conversation was asked from.
        if data.get("type") in ("open", "ui") and "window" not in data and data.get("thread") in self.thread_windows:
            data = {**data, "window": self.thread_windows[data["thread"]]}
        self.event.emit(compact(data))

    def _follow_shipped_rules(self):
        """Rules the learner changed stay theirs, and what a newer Lattice changed in them arrives too."""
        l = self.lattice
        def first_before(rel):
            found = l.journal("skill_changed", ref=rel, limit=200)
            return found[-1]["data"].get("before") if found else None
        changed = agents.follow_shipped(l.vault, first_before)
        for rel in changed:
            l.index.reindex(rel)
        if changed:
            l.vault.commit("规则跟上了新版 Lattice，保留了学习者的修改", "lattice")

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
                raise ValueError(tr("未知操作：") + str(method))
            return compact({"ok": True, "data": handler(**req)})
        except VaultError as e:
            return compact({"ok": False, "error": str(e), "conflict": str(e) == "conflict"})
        except Exception as e:
            LOG.exception("request failed: %s", self._scrub(payload))
            return compact({"ok": False, "error": str(e)})

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
        self.netproxy.stop()
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
