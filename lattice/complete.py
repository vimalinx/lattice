"""Python completion for the editor: completer.py kept running on each environment it is asked of, so jedi reads the
packages that environment has. Asked off the GUI thread, one question at a time per environment."""
from __future__ import annotations

import json
import subprocess
import threading
from pathlib import Path

from . import host

SCRIPT = Path(__file__).with_name("completer.py")


class Completers:
    def __init__(self, cwd):
        self.cwd = str(cwd)
        self.procs = {}
        self.locks = {}
        self.lock = threading.Lock()

    def ask(self, python, request, timeout=10):
        """What jedi offers at the cursor, or {"error": …}. A completer that hangs is stopped and started again next time."""
        with self.lock:
            lock = self.locks.setdefault(python, threading.Lock())
        with lock:
            proc = self.procs.get(python)
            if proc is None or proc.poll() is not None:
                # -I: the learner's PYTHONPATH and the folder it starts in stay out; the environment's packages are what count.
                proc = self.procs[python] = subprocess.Popen([python, "-I", str(SCRIPT)], cwd=self.cwd, stdin=subprocess.PIPE,
                                                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                                                             encoding="utf-8", errors="replace", **host.GROUP)
            watchdog = threading.Timer(timeout, proc.kill)
            watchdog.start()
            try:
                proc.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
                proc.stdin.flush()
                line = proc.stdout.readline()
            except OSError as exc:
                return {"error": str(exc)}
            finally:
                watchdog.cancel()
            return json.loads(line) if line else {"error": "the completer stopped"}

    def close(self):
        for proc in self.procs.values():
            if proc.poll() is None:
                proc.kill()
        self.procs.clear()
