"""A persistent Jupyter kernel per notebook, never a simulated Python result."""
from __future__ import annotations

import copy
import json
import logging
from pathlib import Path
import queue
import threading
import time
import uuid

from PySide6.QtCore import QThread, Signal

LOG = logging.getLogger("lattice")
MAX_OUTPUT = 8_000_000


class NotebookWorker(QThread):
    event = Signal(dict)

    def __init__(self, notebook_id, directory, kernel_name="python3", timeout=120):
        super().__init__()
        self.notebook_id = notebook_id
        self.directory = Path(directory)
        self.kernel_name = kernel_name
        self.timeout = max(3, min(int(timeout), 3600))
        self.commands = queue.Queue()
        self.cancelled = threading.Event()
        self.stopping = threading.Event()
        self.km = self.client = None
        self.epoch = uuid.uuid4().hex
        self.busy = False

    def emit(self, kind, **data):
        if kind == "error":
            LOG.warning("Notebook kernel %s: %s", self.notebook_id, data.get("message"))
        self.event.emit({"type": "notebook", "notebook_id": self.notebook_id, "kind": kind, **data})

    def submit(self, runs):
        self.cancelled.clear()
        self.commands.put(("execute", runs))

    def interrupt(self):
        self.cancelled.set()

    def restart(self):
        self.cancelled.set()
        self.commands.put(("restart", []))

    def stop(self):
        self.stopping.set()
        self.cancelled.set()
        self.commands.put(("stop", []))

    def _setup(self):
        from jupyter_client import KernelManager
        self.directory.mkdir(parents=True, exist_ok=True)
        self.emit("status", state="starting")
        self.km = KernelManager(kernel_name=self.kernel_name)
        self.km.start_kernel(cwd=str(self.directory))
        self.client = self.km.blocking_client()
        self.client.start_channels()
        self.client.wait_for_ready(timeout=30)
        self._inline()
        self.emit("status", state="ready", kernel_id=self.epoch)

    def _inline(self):
        # This setup turn is silent and does not enter the user's execution history.
        mid = self.client.execute("%matplotlib inline", silent=True, store_history=False, allow_stdin=False)
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            try:
                msg = self.client.get_iopub_msg(timeout=.2)
            except queue.Empty:
                continue
            if msg.get("parent_header", {}).get("msg_id") == mid and msg["msg_type"] == "status" and msg["content"].get("execution_state") == "idle":
                break

    def _restart(self):
        self.emit("status", state="restarting")
        self.km.restart_kernel(now=True)
        self.client.wait_for_ready(timeout=30)
        self.epoch = uuid.uuid4().hex
        self.cancelled.clear()
        self._inline()
        self.emit("status", state="ready", kernel_id=self.epoch, restarted=True)

    def _execute(self, run):
        if self.cancelled.is_set() or self.stopping.is_set():
            self.emit("run_finished", run_id=run["id"], cell_id=run["cell_id"], outputs=[], state="cancelled", execution_count=None, kernel_id=self.epoch)
            return "cancelled"
        self.emit("run_started", run_id=run["id"], cell_id=run["cell_id"], kernel_id=self.epoch)
        mid = self.client.execute(run["source"], store_history=True, allow_stdin=False, stop_on_error=True)
        outputs, count, status, used = [], None, "completed", 0
        clear_wait, displays = False, {}
        output_limited = False
        deadline, interrupted_at, needs_restart = time.monotonic() + self.timeout, None, False
        while True:
            clock = time.monotonic()
            if (self.cancelled.is_set() or self.stopping.is_set() or clock >= deadline) and interrupted_at is None:
                if status != "error":
                    status = "cancelled" if clock < deadline else "error"
                if clock >= deadline:
                    outputs.append({"output_type": "error", "ename": "ExecutionTimeout", "evalue": f"执行超过 {self.timeout} 秒，已发送中断。", "traceback": []})
                self.km.interrupt_kernel()
                interrupted_at = clock
            if interrupted_at is not None and clock - interrupted_at > 4:
                needs_restart = True
                break
            try:
                msg = self.client.get_iopub_msg(timeout=.15)
            except queue.Empty:
                if not self.km.is_alive():
                    status, needs_restart = "error", True
                    outputs.append({"output_type": "error", "ename": "KernelDied", "evalue": "Python 内核意外退出。", "traceback": []})
                    break
                continue
            if msg.get("parent_header", {}).get("msg_id") != mid:
                continue
            kind, content = msg["msg_type"], msg["content"]
            if kind == "status" and content.get("execution_state") == "idle":
                break
            if kind == "execute_input":
                count = content.get("execution_count")
            if kind == "clear_output":
                clear_wait = bool(content.get("wait"))
                if not clear_wait:
                    outputs.clear()
                    displays.clear()
                self.emit("output", run_id=run["id"], cell_id=run["cell_id"], outputs=copy.deepcopy(outputs))
                continue
            out = None
            if kind == "stream":
                out = {"output_type": "stream", "name": content.get("name", "stdout"), "text": str(content.get("text", ""))}
            elif kind in {"display_data", "execute_result", "update_display_data"}:
                # Never execute HTML or JavaScript received from a kernel.
                data = {k: v for k, v in content.get("data", {}).items() if k in {"text/plain", "text/html", "text/markdown", "image/png", "image/jpeg"}}
                out = {"output_type": "execute_result" if kind == "execute_result" else "display_data", "data": data, "metadata": {}}
                if kind == "execute_result":
                    count = content.get("execution_count", count)
                    out["execution_count"] = count
            elif kind == "error":
                if status != "cancelled":
                    status = "error"
                out = {"output_type": "error", "ename": content.get("ename", "Error"), "evalue": content.get("evalue", ""), "traceback": content.get("traceback", [])}
            if out is None or output_limited:
                continue
            if clear_wait:
                outputs.clear()
                displays.clear()
                clear_wait = False
            size = len(json.dumps(out, ensure_ascii=False))
            if used + size > MAX_OUTPUT:
                output_limited = True
                outputs.append({"output_type": "stream", "name": "stderr", "text": "\n输出达到 8 MB 上限，已中断执行。\n"})
                status = "error"
                self.cancelled.set()
                continue
            used += size
            display_id = content.get("transient", {}).get("display_id")
            if kind == "update_display_data" and display_id in displays:
                outputs[displays[display_id]] = out
            elif out["output_type"] == "stream" and outputs and outputs[-1].get("output_type") == "stream" and outputs[-1].get("name") == out["name"]:
                outputs[-1]["text"] += out["text"]
            else:
                if display_id:
                    displays[display_id] = len(outputs)
                outputs.append(out)
            self.emit("output", run_id=run["id"], cell_id=run["cell_id"], outputs=copy.deepcopy(outputs))
        self.emit("run_finished", run_id=run["id"], cell_id=run["cell_id"], outputs=outputs, state=status, execution_count=count, kernel_id=self.epoch)
        if needs_restart and not self.stopping.is_set():
            self._restart()
        return status

    def run(self):
        current_runs = []
        try:
            self._setup()
            while not self.stopping.is_set():
                try:
                    command, runs = self.commands.get(timeout=.2)
                except queue.Empty:
                    continue
                if command == "stop":
                    break
                if command == "restart":
                    self._restart()
                    continue
                self.busy = True
                current_runs = list(runs)
                for at, run in enumerate(runs):
                    if self.stopping.is_set():
                        break
                    status = self._execute(run)
                    current_runs = runs[at+1:]
                    if status != "completed" or self.cancelled.is_set():
                        for skipped in current_runs:
                            self.emit("run_finished", run_id=skipped["id"], cell_id=skipped["cell_id"], outputs=[], state="skipped", execution_count=None, kernel_id=self.epoch)
                        current_runs = []
                        break
                self.busy = False
                self.emit("batch_finished", state="ready", kernel_id=self.epoch)
        except Exception as exc:
            # Startup failure must finish every queued run too, not leave a spinner.
            queued = list(current_runs)
            while not self.commands.empty():
                command, runs = self.commands.get_nowait()
                if command == "execute":
                    queued.extend(runs)
            for run in queued:
                self.emit("run_finished", run_id=run["id"], cell_id=run["cell_id"], state="error", execution_count=None, kernel_id=self.epoch,
                          outputs=[{"output_type": "error", "ename": "KernelError", "evalue": str(exc), "traceback": []}])
            self.emit("error", message="Jupyter 内核错误：" + str(exc))
        finally:
            self.busy = False
            if self.client:
                self.client.stop_channels()
            if self.km:
                try:
                    self.km.shutdown_kernel(now=True)
                except Exception:
                    pass
            self.emit("status", state="offline")
