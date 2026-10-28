"""Running any file: a table from extension to command, run as a streamed, interruptible subprocess.

The table is configuration (providers.json `runners` adds or overrides rows).
Placeholders: {file} the file, {dir} its folder, {stem} its name without the
extension, {out} a scratch path for a compiled program, {python} the file's
Python environment. A run started by the learner has the learner's own
permissions; a run started by an agent goes through the sandbox.
"""
from __future__ import annotations

import base64
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time

from PySide6.QtCore import QThread, Signal

from . import host
from .host import stop_group

RUNNERS = {
    ".py": "{python} -u {file}",
    ".js": "node {file}", ".mjs": "node {file}", ".ts": "node {file}",
    ".c": "gcc {file} -O1 -lm -o {out} && {out}",
    ".cpp": "g++ -std=c++20 -O1 {file} -o {out} && {out}", ".cc": "g++ -std=c++20 -O1 {file} -o {out} && {out}",
    ".rs": "rustc --edition 2021 -O {file} -o {out} && {out}",
    ".go": "go run {file}",
    ".sh": "bash {file}",
    ".rb": "ruby {file}", ".lua": "lua {file}", ".jl": "julia {file}", ".r": "Rscript {file}", ".R": "Rscript {file}",
    ".java": "java {file}", ".pl": "perl {file}", ".php": "php {file}",
}
# What to tell the learner when a compiler or interpreter is missing.
INSTALL_HINTS = {"gcc": "gcc", "g++": "gcc", "node": "nodejs", "go": "go", "ruby": "ruby", "lua": "lua", "julia": "julia",
                 "Rscript": "r", "java": "jdk-openjdk", "perl": "perl", "php": "php", "rustc": None}
MAX_OUTPUT = 4_000_000


def runner_for(path, overrides=None):
    table = {**RUNNERS, **(overrides or {})}
    return table.get(Path(path).suffix) or table.get(Path(path).suffix.lower())


def missing_tool(template, python):
    """The first program of a runner command that this machine does not have, or None."""
    for part in template.replace("&&", ";").split(";"):
        words = part.split()
        if not words:
            continue
        program = words[0]
        if program == "{python}":
            continue
        if program.startswith("{"):
            continue
        if not shutil.which(program):
            return program
    return None


def tool_hint(program):
    if program == "rustc":
        return "系统里找不到 rustc。安装 Rust：curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    package = INSTALL_HINTS.get(program, program)
    return f"系统里找不到 {program}。装好以后再运行（Arch：pacman -S {package}；Debian/Ubuntu：apt install {package}）。"


def command_for(template, path, python, scratch):
    """A runner's command line for one file, its paths quoted for the shell that runs it (host.runner_argv)."""
    q = host.quote
    return template.format(file=q(str(path)), dir=q(str(Path(path).parent)), stem=q(Path(path).stem),
                           out=q(str(Path(scratch) / Path(path).stem)), python=q(str(python)))


class RunWorker(QThread):
    """One file run as a subprocess: streamed stdout and stderr, figures collected at the end."""
    event = Signal(dict)

    def __init__(self, run_id, argv, cwd, env, timeout, scratch, prepare=None):
        super().__init__()
        self.run_id, self.argv, self.cwd, self.env = run_id, argv, cwd, env
        # Compiled programs and figures go to a scratch folder that is removed afterwards.
        self.timeout, self.scratch, self.prepare = timeout, Path(scratch), prepare
        self.figures = self.scratch / "figures"
        self.cancelled = threading.Event()
        self.proc = None

    def emit(self, kind, **data):
        self.event.emit({"type": "run", "run": self.run_id, "kind": kind, **data})

    def stop(self):
        self.cancelled.set()
        self._kill()

    def _kill(self):
        # Asked to end before being killed, so a run on the GPU still puts it back to sleep (see sandbox.stop_group).
        proc = self.proc
        if proc and proc.poll() is None:
            stop_group(proc, wait=False)

    def run(self):
        outputs, started, state, code, used = [], time.monotonic(), "completed", None, 0
        try:
            if self.prepare:
                # Building an environment can take a while the first time; it happens off the GUI thread.
                self.argv, self.env = self.prepare(lambda message: self.emit("status", message=message))
            if self.cancelled.is_set():
                raise InterruptedError
            self.figures.mkdir(parents=True, exist_ok=True)
            self.emit("status", message="")
            self.proc = subprocess.Popen(self.argv, cwd=self.cwd, env=self.env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                         stderr=subprocess.PIPE, **host.GROUP)
            pieces = queue.Queue()

            def pump(stream, name):
                for chunk in iter(lambda: stream.read1(65536), b""):
                    pieces.put((name, chunk))
                pieces.put((name, None))
            readers = [threading.Thread(target=pump, args=(self.proc.stdout, "stdout"), daemon=True),
                       threading.Thread(target=pump, args=(self.proc.stderr, "stderr"), daemon=True)]
            for r in readers:
                r.start()
            open_streams, last_emit, dirty = 2, 0.0, False
            while open_streams:
                if self.cancelled.is_set():
                    state = "cancelled"
                    self._kill()
                if time.monotonic() - started > self.timeout and state == "completed":
                    state = "timeout"
                    self._kill()
                try:
                    name, chunk = pieces.get(timeout=0.1)
                except queue.Empty:
                    name = chunk = None
                if name and chunk is None:
                    open_streams -= 1
                elif chunk:
                    used += len(chunk)
                    if used > MAX_OUTPUT:
                        if state == "completed":
                            state = "error"
                            outputs.append({"output_type": "stream", "name": "stderr", "text": "\n输出超过 4 MB，已停止运行。\n"})
                        self._kill()
                    else:
                        text = chunk.decode("utf-8", "replace")
                        if outputs and outputs[-1].get("output_type") == "stream" and outputs[-1]["name"] == name:
                            outputs[-1]["text"] += text
                        else:
                            outputs.append({"output_type": "stream", "name": name, "text": text})
                        dirty = True
                if dirty and time.monotonic() - last_emit > 0.15:
                    self.emit("output", outputs=outputs)
                    last_emit, dirty = time.monotonic(), False
            code = self.proc.wait()
            if state == "completed" and code != 0:
                state = "error"
        except InterruptedError:
            state = "cancelled"
        except Exception as exc:
            state = "error"
            outputs.append({"output_type": "error", "ename": type(exc).__name__, "evalue": str(exc)[:2000], "traceback": []})
        if state == "timeout":
            outputs.append({"output_type": "error", "ename": "Timeout", "evalue": f"运行超过 {self.timeout} 秒，已停止。", "traceback": []})
        elif state == "error" and code not in (None, 0):
            outputs.append({"output_type": "error", "ename": "ExitCode", "evalue": f"程序以退出码 {code} 结束", "traceback": []})
        for png in sorted(self.figures.glob("*.png"))[:40] if self.figures.exists() else []:
            outputs.append({"output_type": "display_data", "data": {"image/png": base64.b64encode(png.read_bytes()).decode()}, "metadata": {}})
        shutil.rmtree(self.scratch, ignore_errors=True)
        self.emit("finished", state=state, exit_code=code, outputs=outputs, seconds=round(time.monotonic() - started, 2))
