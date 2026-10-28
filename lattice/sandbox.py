"""The agents' sandbox: bubblewrap with the vault writable and mounted folders read-only. It has no network of its
own; when the learner allows it (on by default), what runs inside reaches the internet through Lattice's proxy
(netproxy.py), never this machine or the local network. Downloads are cached in the vault's .lattice/cache.

A run that asks for the GPU also gets the device nodes of the accelerator found here (see accel.py), and is wrapped in
this machine's launcher when it has one (nvidia-run wakes the GPU for that run only and puts it back to sleep). Runs are
stopped gently (the whole process group is asked to end, and only killed if it will not), so a launcher always gets to
clean up.

Everything an agent runs goes through here: shell commands, files it runs and
notebook kernels. The rest of the home directory, system configuration and
credentials are not visible. Lattice's own records (conversations, journal,
rules, index, environments) are mounted read-only, so the sandbox cannot plant
anything the learner would later run unsandboxed or rewrite the history.
"""
from __future__ import annotations

import glob
import os
from pathlib import Path
import shutil
import signal
import subprocess
import threading
import time

from .netproxy import PORT

# Just enough of /etc for programs to run: libraries, fonts, certificates, time zone, user names.
ETC = ["ld.so.cache", "ld.so.conf", "ld.so.conf.d", "fonts", "ssl", "ca-certificates", "localtime", "passwd", "group",
       "nsswitch.conf", "mime.types", "alternatives", "os-release", "java-openjdk", "java21-openjdk", "java17-openjdk", "java11-openjdk"]
# Inside the vault, these stay read-only for the sandbox.
PROTECTED = (".git", ".lattice", "threads", "journal", "AGENTS.md", "me.md", "agents")
MPL = Path(__file__).with_name("mpl")
FORWARD = Path(__file__).with_name("netfwd.py")


def on_gpu(command, gpu):
    """A command (a list) run on the GPU outside the sandbox (the learner's own runs): in this machine's launcher, if any.
    gpu is accel.detect()'s description."""
    return [*(gpu.get("prefix") or []), *command]


def stop_group(proc, grace=20, wait=True):
    """End a process and everything it started: asked first, killed only if it is still there after `grace` seconds.
    With wait=False the waiting happens on a thread of its own."""
    def finish():
        try:
            proc.wait(grace)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                proc.kill()
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        proc.terminate()
    if wait:
        finish()
    else:
        threading.Thread(target=finish, daemon=True).start()


class Sandbox:
    def __init__(self, root, projects=lambda: [], extra=lambda: [], network=lambda: False, proxy=None):
        self.root = Path(root).resolve()
        self.projects, self.extra, self.network, self.proxy = projects, extra, network, proxy
        self.bwrap = shutil.which("bwrap")
        self._ok = None

    def available(self):
        if self._ok is None:
            self._ok = bool(self.bwrap) and subprocess.run([self.bwrap, "--unshare-all", "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin",
                                                            "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib", "/lib64", "true"],
                                                           capture_output=True, timeout=20).returncode == 0
        return self._ok

    def why_not(self):
        return "" if self.available() else ("沙箱不可用：系统里没有 bubblewrap（Arch：pacman -S bubblewrap；Debian/Ubuntu：apt install bubblewrap）"
                                            if not self.bwrap else "沙箱不可用：bubblewrap 无法创建隔离环境（可能是系统禁用了非特权用户命名空间）")

    def visible(self):
        """Read-only paths beyond /usr: toolchains under home, interpreters of the vault's environments."""
        paths = set(self.extra())
        home = Path.home()
        for tool in ("rustc", "cargo", "go", "node", "java", "julia"):
            found = shutil.which(tool)
            if found and Path(found).resolve().is_relative_to(home):
                paths.add(str(Path(found).parent))
                paths.add(str(Path(found).resolve().parent))
        if Path(shutil.which("rustc") or "/").resolve().is_relative_to(home):
            paths |= {str(home / ".rustup"), str(home / ".cargo/bin")}
        for cfg in glob.glob(str(self.root / ".lattice/venvs/*/pyvenv.cfg")):
            for line in Path(cfg).read_text(encoding="utf-8").splitlines():
                if line.startswith("home = ") and Path(line[7:]).resolve().is_relative_to(home):
                    paths.add(str(Path(line[7:]).resolve().parent))
        return sorted(p for p in paths if Path(p).exists())

    def argv(self, command, cwd, env=None, writable=(), gpu=None):
        """bwrap command line running `command` (a list) in `cwd` with `env` added to a clean environment; with gpu
        (accel.detect()'s description) the accelerator's device nodes are inside and it runs in the machine's launcher."""
        if not self.available():
            raise RuntimeError(self.why_not())
        args = [self.bwrap, "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL"]
        for top in ("/bin", "/lib", "/lib64", "/sbin"):
            if os.path.islink(top):
                args += ["--symlink", os.readlink(top), top]
            elif os.path.isdir(top):
                args += ["--ro-bind", top, top]
        args += ["--ro-bind", "/usr", "/usr"]
        if os.path.isdir("/opt"):
            args += ["--ro-bind", "/opt", "/opt"]
        for name in ETC:
            if os.path.exists("/etc/" + name):
                args += ["--ro-bind", "/etc/" + name, "/etc/" + name]
        args += ["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/tmp/home"]
        if gpu:
            if not gpu.get("devices"):
                raise RuntimeError("这台电脑上没有能在沙箱里用的显卡")
            for node in gpu["devices"]:
                if os.path.exists(node):
                    args += ["--dev-bind", node, node]
            args += ["--ro-bind", "/sys", "/sys"]
        for path in self.visible():
            args += ["--ro-bind", path, path]
        for p in self.projects():
            if os.path.isdir(p["path"]):
                args += ["--ro-bind", p["path"], p["path"]]
        root = str(self.root)
        args += ["--bind", root, root]
        for name in PROTECTED:
            if (self.root / name).exists():
                args += ["--ro-bind", f"{root}/{name}", f"{root}/{name}"]
        # Downloaded models and datasets stay between runs (inside the sandbox home is in memory and gone after each).
        cache = self.root / ".lattice" / "cache"
        for path in (*writable, cache):
            Path(path).mkdir(parents=True, exist_ok=True)
            args += ["--bind", str(path), str(path)]
        online = bool(self.proxy) and self.network()
        if online:
            args += ["--dir", "/run/lattice", "--bind", str(self.proxy.start()), "/run/lattice/net.sock", "--ro-bind", str(FORWARD), "/run/lattice/forward.py"]
        args += ["--ro-bind", str(MPL), str(MPL), "--chdir", str(cwd), "--clearenv"]
        base = {"HOME": "/tmp/home", "LANG": os.environ.get("LANG", "C.UTF-8"), "TERM": "dumb", "TMPDIR": "/tmp",
                "MPLCONFIGDIR": "/tmp/mpl", "GOCACHE": "/tmp/go-cache", "GOPATH": "/tmp/go", "CARGO_HOME": "/tmp/cargo",
                "PATH": ":".join([*(p for p in self.visible() if p.endswith("bin")), "/usr/local/bin", "/usr/bin"])}
        if (Path.home() / ".rustup").as_posix() in self.visible():
            base["RUSTUP_HOME"] = str(Path.home() / ".rustup")
        base.update({"XDG_CACHE_HOME": str(cache), "HF_HOME": str(cache / "huggingface"), "TORCH_HOME": str(cache / "torch")})
        if online:
            proxy = "http://127.0.0.1:%d" % PORT
            base.update({"HTTP_PROXY": proxy, "HTTPS_PROXY": proxy, "http_proxy": proxy, "https_proxy": proxy, "NODE_USE_ENV_PROXY": "1",
                         "NO_PROXY": "localhost,127.0.0.1,::1", "no_proxy": "localhost,127.0.0.1,::1"})
            command = [shutil.which("python3") or "/usr/bin/python3", "-I", "/run/lattice/forward.py", "/run/lattice/net.sock", str(PORT), "--", *command]
        for key, value in {**base, **(env or {})}.items():
            args += ["--setenv", key, str(value)]
        return [*((gpu or {}).get("prefix") or [])] + args + ["--", *command]

    def shell(self, command, timeout=60, limit=24000, cwd=None, env=None, gpu=None):
        """Run one shell command; returns its combined output, exit code and whether it was cut short."""
        started = time.monotonic()
        proc = subprocess.Popen(self.argv(["bash", "-c", command], cwd or self.root, env, gpu=gpu), stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, start_new_session=True)
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
            code, out, timed_out = proc.returncode, stdout + (b"\n" + stderr if stderr else b""), False
        except subprocess.TimeoutExpired:
            stop_group(proc)
            stdout, stderr = proc.communicate()
            code, out, timed_out = None, (stdout or b"") + (stderr or b""), True
        text = out.decode("utf-8", "replace")
        cut = len(text) > limit
        if cut:
            text = text[: limit // 2] + f"\n…（中间省略 {len(text) - limit} 个字符）…\n" + text[-limit // 2:]
        return {"exit_code": code, "output": text, "truncated": cut, "timed_out": timed_out, "seconds": round(time.monotonic() - started, 2)}
