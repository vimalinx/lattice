"""The bridge: running any file."""
from __future__ import annotations

from ..i18n import tr

import json
import os
from pathlib import Path
from PySide6.QtCore import Slot
from ..envs import missing_module
from ..index import dump, uid
from ..model import readable_outputs, text
from ..runner import RunWorker, command_for, missing_tool, runner_for, tool_hint
from .. import host
from ..sandbox import MPL, on_gpu

from .common import CODE_EXT


class RunningPart:
    # ---- running any file --------------------------------------------------------------------------------
    def rpc_run(self, path, cells=None, code=None, lang=None):
        """The learner's run: a notebook in its kernel, any other file with the learner's own permissions.

        `code` runs a snippet from a conversation as a scratch file."""
        if code is not None:
            ext = CODE_EXT.get(str(lang or "python").lower(), ".py")
            scratch = self.root / ".lattice" / "scratch" / ("snippet-" + uid() + ext)
            scratch.parent.mkdir(parents=True, exist_ok=True)
            scratch.write_text(text(code, 400000), encoding="utf-8")
            return {"run": self.run_file(str(scratch), "me", False, cwd=self.root / "code", gpu=self._wants_gpu(scratch))}
        if str(path).endswith(".ipynb"):
            return self.run_notebook(path, cells, "me")
        absolute, _ = self.lattice.resolve(path)
        return {"run": self.run_file(path, "me", False, gpu=self._wants_gpu(absolute))}

    def rpc_run_stop(self, run):
        info = self.runs.get(run)
        if info:
            info["worker"].stop()
        return bool(info)

    def rpc_complete(self, path, code, line, column, typed="", ask="", editor=""):
        """Python completion at the cursor, answered as a "complete" event: jedi can take a second the first time it reads
        a big package. Only the latest question from an editor is answered; the ones typed over are dropped."""
        absolute, rel = self.lattice.resolve(path)
        python = self._completion_python(absolute, rel)
        if not python:
            return {"asked": False}
        self.complete_asks[editor] = ask

        def work():
            if self.complete_asks.get(editor) != ask:
                return {"stale": True}
            return self.completers.ask(python, {"code": text(code, 400000), "line": int(line), "column": int(column), "typed": str(typed)[:80],
                                                "path": str(absolute.with_suffix(".py"))})
        self.background(work, lambda got: self.announce({"type": "complete", "ask": ask, **(got if isinstance(got, dict) else {"error": str(got)})}))
        return {"asked": True}

    def _completion_python(self, absolute, rel):
        """The environment a file runs on, if it is there already: completing never sets one up."""
        if rel is None:
            folder = absolute.parent
            while folder != folder.parent:
                if host.venv_python(folder / ".venv").exists():
                    return str(host.venv_python(folder / ".venv"))
                folder = folder.parent
            return None
        python = self.envs.python(self.envs.name_for(absolute))
        return str(python) if python.exists() else None

    def python_for(self, absolute, rel, progress):
        """A file in a mounted folder with its own .venv uses it; everything else uses the vault's environment."""
        if rel is None:
            folder = absolute.parent
            while folder != folder.parent:
                if host.venv_python(folder / ".venv").exists():
                    return str(host.venv_python(folder / ".venv"))
                if any(folder == Path(p["path"]) for p in self.lattice.projects()):
                    break
                folder = folder.parent
        return self.envs.ensure(self.envs.name_for(absolute if rel else self.root), progress)

    def agent_shell(self, command, timeout, gpu=False):
        """One agent shell command in the sandbox, with the vault's default Python environment on PATH (runs off the GUI thread)."""
        python = Path(self.envs.ensure("default"))
        env = {"VIRTUAL_ENV": str(python.parent.parent), "MPLBACKEND": "Agg"}
        return self.sandbox.shell(command, timeout, env=env, gpu=self.gpu_for_run() if gpu else None, bins=[python.parent])

    def run_file(self, path, by="me", sandboxed=False, cwd=None, attempt=0, gpu=False, timeout=None):
        l = self.lattice
        absolute, rel = l.resolve(path) if not str(path).startswith(str(self.root / ".lattice" / "scratch")) else (Path(path), None)
        template = runner_for(absolute, self.config.read()["runners"])
        if not template:
            raise ValueError(tr("不知道怎么运行 {0} 文件；可以在设置的「运行器」里加一行，例如 {\"{1}\": \"程序 {file}\"}", absolute.suffix or tr('这种'), absolute.suffix or '.ext'))
        missing = missing_tool(template, None)
        if missing:
            raise ValueError(tool_hint(missing))
        if sandboxed and not self.sandbox.available():
            raise ValueError(self.sandbox.why_not())
        run_id = uid()
        scratch = self.root / ".lattice" / "scratch" / run_id
        workdir = Path(cwd or absolute.parent)
        shown = rel or str(absolute)

        accelerated = self.gpu_for_run() if gpu else None

        def prepare(progress):
            python = self.python_for(absolute, rel, progress) if "{python}" in template else "python3"
            command = command_for(template, absolute, python, scratch)
            figures = {"MPLBACKEND": "module://lattice_figures", "PYTHONPATH": str(MPL), "LATTICE_FIGURES": str(scratch / "figures"), "PYTHONUNBUFFERED": "1"}
            if sandboxed:
                return self.sandbox.launch(host.runner_argv(command), workdir, {**figures, "VIRTUAL_ENV": str(Path(python).parent.parent)},
                                           writable=[scratch], gpu=accelerated, bins=[Path(python).parent])
            env = {**os.environ, **host.UTF8, **figures, "PYTHONPATH": os.pathsep.join(x for x in (str(MPL), os.environ.get("PYTHONPATH")) if x)}
            return (on_gpu(host.runner_argv(command), accelerated) if accelerated else host.runner_argv(command)), env
        scratch.mkdir(parents=True, exist_ok=True)
        worker = RunWorker(run_id, None, str(workdir), None, max(self.config.read()["run_timeout"], int(timeout or 0)), scratch, prepare)
        self.runs[run_id] = {"path": shown, "by": by, "sandbox": sandboxed, "gpu": gpu, "worker": worker, "waiters": [], "attempt": attempt, "timeout": timeout,
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
            self.announce({**evt, "kind": "status", "message": tr("缺少 {0}，正在装进环境「{1}」，装好后自动重跑…", package, env)})

            def then(result):
                if isinstance(result, Exception):
                    evt["note"] = f"缺少 {package}，自动安装没有成功（PyPI 上可能叫别的名字）：{str(result)[-300:]}"
                    return self._run_done(info, evt)
                self._installed(env, [package], result[0], info["by"])
                try:
                    again = self.run_file(absolute, info["by"], info["sandbox"], info.get("cwd"), attempt=1, gpu=info["gpu"],
                                         timeout=info["timeout"])
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
            raise ValueError(tr("找不到这次运行的输出"))

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

    def run_for_agent(self, ctx, path, cells, finish, gpu=False, timeout=None):
        if gpu and not self.gpu_ready():
            raise ValueError(tr("用不了显卡：学习者在设置里关掉了，或者这台电脑上没有 nvidia-run / NVIDIA 驱动"))
        if str(path).endswith(".ipynb"):
            batch = self.run_notebook(path, cells, ctx.agent, gpu=gpu)
            self.batches[batch["notebook"]]["waiters"].append(finish)
        else:
            run = self.run_file(path, ctx.agent, True, gpu=gpu, timeout=timeout)
            self.runs[run]["waiters"].append(finish)
        ctx.act(tr("运行了 ") + str(path).rsplit("/", 1)[-1], "file:" + str(path), False)

    def rpc_env_info(self, name="default"):
        return {**self.envs.info(name), "names": self.envs.names()}

    def rpc_env_install(self, name, packages):
        def then(result):
            if isinstance(result, Exception):
                return self.announce({"type": "env", "name": name, "ok": False, "message": str(result)[-600:]})
            self._installed(name, packages, result[0], "me")
            self.announce({"type": "env", "name": name, "ok": True, "message": tr("已安装 ") + str("、".join(packages))})
        self.background(lambda: self.envs.install(name, packages, binary_only=False), then)
        return {"state": "installing"}
