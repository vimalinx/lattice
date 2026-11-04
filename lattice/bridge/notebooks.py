"""The bridge: notebooks."""
from __future__ import annotations

from ..i18n import tr

from pathlib import Path
import re
import time
from PySide6.QtCore import Slot
from ..envs import missing_module
from ..index import uid
from ..model import readable_outputs
from ..notebook import NotebookWorker
from .. import accel
from ..sandbox import on_gpu


class NotebooksPart:
    # ---- notebooks ------------------------------------------------------------------------------------
    def rpc_cell_save(self, path, source, kind="code", id=None, after=None):
        self.last_write = time.monotonic()
        _, rel = self.lattice.resolve(path)
        self.edits[rel] = time.monotonic()
        return {"id": self.lattice.cell_save(path, source, kind, id, after)}

    def rpc_cell_delete(self, path, id):
        nb = self.lattice.notebook(path)
        if nb["id"] in self.batches:
            raise ValueError(tr("这本实验笔记正在运行；先中断再删除单元格"))
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
            raise ValueError(tr("内核模式应为 sandbox 或 mine"))
        _, rel = self.lattice.resolve(path)
        nb = self.lattice.vault.read_json(rel)
        nb.setdefault("metadata", {}).setdefault("lattice", {})["kernel"] = mode
        self.lattice.vault.write_json(rel, nb)
        self.lattice.index.reindex(rel)
        self._stop_kernel(nb["metadata"]["lattice"].get("id"))
        return True

    def kernel_state(self, ident):
        return self.kernel_states.get(ident, {}).get("state", "offline")

    GPU_IDLE = 15 * 60

    def _gpu_idle(self):
        if self.closing:
            return
        for ident, state in list(self.kernel_states.items()):
            worker = self.kernels.get(ident)
            if not worker or not getattr(worker, "gpu", False) or state.get("state") == "busy" or ident in self.batches:
                continue
            if time.monotonic() - state.get("last", time.monotonic()) > self.GPU_IDLE:
                path = state.get("path")
                self._stop_kernel(ident)
                self.announce({"type": "notice", "message": tr("「{0}」用显卡的内核空闲了 15 分钟，先关掉让显卡休眠；再运行会自动重开（之前的变量要重新算）", Path(str(path)).name)})

    # Python that imports one of these wants the GPU when the learner runs it.
    GPU_IMPORT = re.compile(r"^\s*(?:import|from)\s+(?:torch|jax|tensorflow|cupy|triton|tinygrad|pycuda|numba\.cuda)\b", re.M)

    def _wants_gpu(self, absolute):
        if Path(absolute).suffix != ".py" or not self.gpu_ready():
            return False
        try:
            return bool(self.GPU_IMPORT.search(Path(absolute).read_text(encoding="utf-8", errors="replace")[:400_000]))
        except OSError:
            return False

    def gpu_ready(self):
        """Runs may use the NVIDIA GPU: allowed in the settings, and the wrapper and driver are on this computer."""
        info = self.accel()
        return bool(self.config.read().get("gpu", True)) and info["preferred"] != "cpu"

    def accel(self):
        """This computer's accelerator and how runs get it (accel.py), with the launcher from the settings."""
        return accel.detect(self.config.read().get("gpu_launcher") or "auto")

    def accel_brief(self):
        info = self.accel()
        # The Python that code runs with is the vault's environment, which may differ from the program's own.
        try:
            python = next((line.split("=", 1)[1].strip() for line in (self.root / ".lattice/venvs/default/pyvenv.cfg").read_text().splitlines()
                           if line.startswith(("version_info", "version "))), info["python"])
        except OSError:
            python = info["python"]
        return {"preferred": info["preferred"], "launcher": info["launcher"], "python": python, "machine": info["machine"],
                "accelerators": [{k: v for k, v in a.items() if k != "asleep"} for a in info["accelerators"]], **({"notes": info["notes"]} if info["notes"] else {})}

    def gpu_for_run(self):
        """What a GPU run needs (device nodes, launcher), or None when runs cannot use one."""
        return self.accel() if self.gpu_ready() else None

    def rpc_accelerator(self):
        return {**self.accel_brief(), "allowed": bool(self.config.read().get("gpu", True)), "setting": self.config.read().get("gpu_launcher") or "auto"}

    def _kernel_gpu(self, rel):
        try:
            return bool(((self.lattice.vault.read_json(rel).get("metadata") or {}).get("lattice") or {}).get("gpu")) if rel else False
        except (OSError, ValueError):
            return False

    def rpc_kernel_gpu(self, path, on=True):
        """A notebook's kernel on the GPU (it restarts): for training and anything CUDA. It stops by itself when idle."""
        _, rel = self.lattice.resolve(path)
        if on and not self.gpu_ready():
            raise ValueError(tr("用不了显卡：设置里关掉了，或者这台电脑上没有 nvidia-run / NVIDIA 驱动"))
        nb = self.lattice.vault.read_json(rel)
        nb.setdefault("metadata", {}).setdefault("lattice", {})["gpu"] = bool(on)
        self.lattice.vault.write_json(rel, nb)
        self.lattice.index.reindex(rel)
        self._stop_kernel(nb["metadata"]["lattice"].get("id"))
        return bool(on)

    def _kernel(self, nb, mode):
        worker = self.kernels.get(nb["id"])
        _, rel = self.lattice.resolve(nb["path"])
        gpu = self.gpu_for_run() if self._kernel_gpu(rel) else None
        if worker and worker.isRunning() and worker.mode == mode and worker.gpu == bool(gpu):
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
        if mode == "sandbox" and self.sandbox.isolated:
            extra = {"IPYTHONDIR": "/tmp/ipython", "JUPYTER_RUNTIME_DIR": "/tmp/jupyter", "JUPYTER_DATA_DIR": "/tmp/jupyter-data", "PYTHONUNBUFFERED": "1"}
            wrap = lambda command: self.sandbox.argv(command, cwd, extra, writable=[sockets], gpu=gpu)
        elif gpu:
            wrap = lambda command: on_gpu(command, gpu)
        worker = NotebookWorker(nb["id"], cwd, lambda progress: self.envs.ensure(env, progress), self.config.read()["kernel_timeout"], wrap, sockets, bool(gpu))
        worker.mode, worker.path = mode, nb["path"]
        worker.event.connect(self.notebook_event)
        self.kernels[nb["id"]] = worker
        self.kernel_states[nb["id"]] = {"state": "starting", "mode": mode, "path": nb["path"], "gpu": bool(gpu), "last": time.monotonic()}
        worker.start()
        return worker

    def run_notebook(self, path, cells=None, by="me", attempt=0, gpu=False):
        nb = self.lattice.notebook(path)
        _, rel = self.lattice.resolve(path)
        if gpu and rel and not self._kernel_gpu(rel):
            # Asked for the GPU: the kernel restarts on it (its variables are gone) and stays on it for this notebook.
            self.rpc_kernel_gpu(rel, True)
            nb = self.lattice.notebook(path)
        mode = self._kernel_mode(rel) if rel else "mine"
        if by != "me" and mode != "sandbox":
            raise ValueError(tr("这本实验笔记的内核切到了学习者自己的权限，AI 不能在里面运行；请学习者自己点运行"))
        if by != "me" and not self.sandbox.available():
            raise ValueError(self.sandbox.why_not())
        if nb["id"] in self.batches:
            raise ValueError(tr("这本实验笔记正在运行；可以先中断"))
        wanted = set(cells or [])
        targets = [c for c in nb["cells"] if c["kind"] == "code" and (not wanted or c["id"] in wanted)]
        if not targets:
            raise ValueError(tr("没有可以运行的代码单元格"))
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
        self.kernel_states.setdefault(ident, {})["last"] = time.monotonic()
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
            self.announce({"type": "kernel", "notebook": ident, "path": path, "kind": "status", "state": "installing", "message": tr("缺少 {0}，正在装进环境「{1}」…", package, env)})

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
