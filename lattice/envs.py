"""Python environments managed by uv. The definition file is the source; the venv follows it.

`envs/<name>.txt` lists the packages, one per line, and is part of the vault
(so it has history and an install can be undone). The venv lives in
`.lattice/venvs/<name>` and is rebuilt from the definition when needed. A
directory containing a `.lattice-env` file (holding an environment name) makes
every file below it use that environment; otherwise `default` is used.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import shutil
import subprocess
import threading

BASE = ["ipykernel", "numpy", "matplotlib"]
# Import names whose package on PyPI is called something else.
PACKAGES = {"cv2": "opencv-python", "sklearn": "scikit-learn", "PIL": "pillow", "yaml": "pyyaml", "bs4": "beautifulsoup4",
            "skimage": "scikit-image", "Crypto": "pycryptodome", "dateutil": "python-dateutil", "dotenv": "python-dotenv",
            "serial": "pyserial", "attr": "attrs", "jwt": "PyJWT", "docx": "python-docx", "pptx": "python-pptx", "fitz": "pymupdf",
            "google.protobuf": "protobuf", "OpenGL": "PyOpenGL", "Bio": "biopython", "mpl_toolkits": "matplotlib"}
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$")
REQUIREMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-\[\],]*\s*([<>=!~]=?\s*[\w.*+!-]+\s*,?\s*)*$")


def missing_module(text):
    """The package to install for a 'No module named X' error, or None."""
    found = re.search(r"No module named '([\w.]+)'", text or "")
    if not found:
        return None
    module = found.group(1)
    return PACKAGES.get(module) or PACKAGES.get(module.split(".")[0]) or module.split(".")[0].replace("_", "-")


class EnvError(RuntimeError):
    pass


class Envs:
    def __init__(self, vault, python=None):
        self.vault, self.root = vault, vault.root
        self.uv = shutil.which("uv")
        self.python_base = python or shutil.which("python3") or "python3"
        self.locks = {}

    def lock(self, name):
        return self.locks.setdefault(name, threading.Lock())

    def name_for(self, path):
        """The environment a file uses: the nearest .lattice-env above it, else default."""
        path = Path(path).resolve()
        root = self.root.resolve()
        folder = path if path.is_dir() else path.parent
        while folder.is_relative_to(root):
            marker = folder / ".lattice-env"
            if marker.is_file():
                name = marker.read_text(encoding="utf-8").strip()
                if NAME.match(name):
                    return name
            if folder == root:
                break
            folder = folder.parent
        return "default"

    def definition_rel(self, name):
        if not NAME.match(name):
            raise EnvError("环境名只能用字母、数字、点、下划线和连字符")
        return f"envs/{name}.txt"

    def wanted(self, name):
        rel = self.definition_rel(name)
        # Written as a plain file: this runs off the GUI thread, and the vault picks it up as an outside edit.
        if not self.vault.path(rel).exists():
            self.vault.path(rel).write_text("# 这个 Python 环境里的包，一行一个。改了以后，下次运行时环境会跟着改。\n" + "\n".join(BASE) + "\n", encoding="utf-8")
        lines = [l.split("#", 1)[0].strip() for l in self.vault.read_text(rel).splitlines()]
        return [l for l in lines if l]

    def venv(self, name):
        return self.root / ".lattice" / "venvs" / name

    def python(self, name):
        return self.venv(name) / "bin" / "python"

    def ready(self, name):
        return self.python(name).exists()

    def _applied_path(self, name):
        return self.venv(name) / "lattice-applied.json"

    def _run(self, args, timeout=900):
        if not self.uv:
            raise EnvError("没有找到 uv。安装方法：curl -LsSf https://astral.sh/uv/install.sh | sh，或用系统包管理器安装 uv")
        proc = subprocess.run([self.uv, *args], capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        if proc.returncode != 0:
            raise EnvError((proc.stderr or proc.stdout).strip()[-1500:] or "uv 失败")
        return proc.stdout + proc.stderr

    def ensure(self, name, progress=None):
        """Create the venv if needed and bring it in line with its definition. Returns the python path."""
        with self.lock(name):
            wanted = self.wanted(name)
            if not self.ready(name):
                if progress:
                    progress(f"正在准备 Python 环境「{name}」（第一次需要联网下载，可能要一两分钟）…")
                self.venv(name).parent.mkdir(parents=True, exist_ok=True)
                self._run(["venv", "-q", "--python", self.python_base, str(self.venv(name))])
            try:
                applied = json.loads(self._applied_path(name).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                applied = []
            add = [p for p in wanted if p not in applied]
            drop = [p for p in applied if p not in wanted]
            if add:
                if progress:
                    progress("正在安装 " + "、".join(add) + " …")
                self._run(["pip", "install", "-q", "-p", str(self.python(name)), *add])
            if drop:
                names = [re.split(r"[<>=!~\[ ]", p, 1)[0] for p in drop]
                self._run(["pip", "uninstall", "-q", "-p", str(self.python(name)), *names])
            if add or drop or not self._applied_path(name).exists():
                self._applied_path(name).write_text(json.dumps(wanted), encoding="utf-8")
            return str(self.python(name))

    def _stream(self, args, timeout, progress):
        """uv with its output read as it comes, so a long install can say how far it is."""
        if not self.uv:
            raise EnvError("没有找到 uv。安装方法：curl -LsSf https://astral.sh/uv/install.sh | sh，或用系统包管理器安装 uv")
        proc = subprocess.Popen([self.uv, *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, stdin=subprocess.DEVNULL,
                                start_new_session=True)
        timer = threading.Timer(timeout, proc.kill)
        timer.start()
        lines, sizes, done = [], {}, set()
        try:
            for line in proc.stdout:
                lines.append(line)
                found = re.match(r"\s*Downloading (\S+) \(([\d.]+)\s*([KMG]i?B)\)", line)
                if found:
                    sizes[found.group(1)] = float(found.group(2)) * {"K": 1 / 1024, "M": 1, "G": 1024}[found.group(3)[0]]
                elif (found := re.match(r"\s*Downloaded (\S+)", line)):
                    done.add(found.group(1))
                elif not re.match(r"\s*(Resolved|Prepared|Installed|Uninstalled|Audited|Building|Built)\b", line):
                    continue
                if progress and sizes:
                    total, got = sum(sizes.values()), sum(v for k, v in sizes.items() if k in done)
                    amount = f"{got / 1024:.1f}/{total / 1024:.1f} GB" if total > 200 else f"{got:.0f}/{total:.0f} MB"
                    progress(f"已下载 {len(done & sizes.keys())}/{len(sizes)} 个文件 · {amount}")
                elif progress and line.strip():
                    progress(line.strip()[:80])
            code = proc.wait()
        finally:
            timer.cancel()
        out = "".join(lines)
        if code != 0:
            raise EnvError(("安装超过 %d 分钟，停下了" % (timeout // 60)) if code < 0 else out.strip()[-1500:] or "uv 失败")
        return out

    def install(self, name, packages, binary_only=True, progress=None, index_url=None, extra_index_url=None):
        """Install packages into an environment and add them to its definition. Returns (added, output).
        Large packages (torch with its CUDA libraries is about 3 GB) are given up to an hour; progress gets how far."""
        packages = [str(p).strip() for p in packages if str(p).strip()]
        if not packages or len(packages) > 20 or not all(REQUIREMENT.match(p) for p in packages):
            raise EnvError("请给出 1～20 个包名（可以带版本，例如 numpy>=2）")
        self.ensure(name)
        with self.lock(name):
            # Agents never run a package's own build code on this machine: wheels only.
            # A library built for this machine's accelerator comes from its own index (e.g. torch for one CUDA version).
            indexes = [*(["--index-url", index_url] if index_url else []), *(["--extra-index-url", extra_index_url] if extra_index_url else [])]
            out = self._stream(["pip", "install", "-p", str(self.python(name)), *(["--only-binary", ":all:"] if binary_only else []), *indexes, *packages],
                               3600, progress)
            rel = self.definition_rel(name)
            current = self.vault.read_text(rel)
            have = set(self.wanted(name))
            added = [p for p in packages if p not in have]
            if added:
                self.vault.path(rel).write_text(current.rstrip("\n") + "\n" + "\n".join(added) + "\n", encoding="utf-8")
            self._applied_path(name).write_text(json.dumps(self.wanted(name)), encoding="utf-8")
            return added, out[-1500:]

    def names(self):
        return sorted({p.stem for p in (self.root / "envs").glob("*.txt")} | {"default"})

    def info(self, name):
        installed = []
        if self.ready(name) and self.uv:
            try:
                installed = json.loads(self._run(["pip", "list", "-p", str(self.python(name)), "--format", "json"], 60).split("\n", 1)[0] or "[]")
            except (EnvError, ValueError, subprocess.TimeoutExpired):
                installed = []
        return {"name": name, "ready": self.ready(name), "definition": self.definition_rel(name), "wanted": self.wanted(name),
                "installed": [{"name": p["name"], "version": p["version"]} for p in installed], "uv": bool(self.uv)}
