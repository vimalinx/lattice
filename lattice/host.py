"""This computer: where Lattice keeps its own files, where it finds the programs it uses (git, uv, a shell), how it
starts and stops a program with everything that program started, and where a Python environment keeps its
interpreter. All that differs between Linux and Windows is here, so the rest of Lattice reads the same on both.

Programs Lattice ships with (git and uv in the Windows build) sit in a bin folder next to it and are found before the
ones on PATH."""
from __future__ import annotations

import os
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import threading

WINDOWS = sys.platform == "win32"
# Where Lattice's own files are: next to main.py when run from source, the bundle's folder when frozen.
APP = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
# Its bin folder holds uv, and MinGit (whose git.exe is in cmd).
BUNDLED = [p for base in dict.fromkeys((Path(sys.executable).parent, APP)) for p in (base / "bin", base / "bin" / "git" / "cmd")
           if p.is_dir()] if getattr(sys, "frozen", False) else []


# ---- folders ----------------------------------------------------------------------------------------

def config_home():
    """Settings (providers.json, localrouter.toml): ~/.config on Linux, %APPDATA% on Windows."""
    if WINDOWS:
        return Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    return Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")


def data_home():
    """Lattice's own data (logs, web profile, usage): ~/.local/share on Linux, %LOCALAPPDATA% on Windows."""
    if WINDOWS:
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")


def runtime_dir():
    """Short-lived files such as sockets, whose paths have to be short."""
    return Path(os.environ.get("XDG_RUNTIME_DIR") or tempfile.gettempdir()) if not WINDOWS else Path(tempfile.gettempdir())


# ---- programs ---------------------------------------------------------------------------------------

def tool(name):
    """A program by name: the one Lattice ships with, else the one on PATH; None when there is none."""
    for folder in BUNDLED:
        found = shutil.which(name, path=str(folder))
        if found:
            return found
    return shutil.which(name)


def venv_bin(venv):
    return Path(venv) / ("Scripts" if WINDOWS else "bin")


def venv_python(venv):
    return venv_bin(venv) / ("python.exe" if WINDOWS else "python")


def git_bash():
    """Git for Windows' bash, found from its git: AI commands written for bash run in it when it is there."""
    git = shutil.which("git")
    for root in ([Path(git).resolve().parents[1]] if git else []) + [Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git"]:
        bash = root / "bin" / "bash.exe"
        if bash.is_file():
            return str(bash)
    return None


def shell_name():
    """The shell an agent's commands are written for, as the agents are told."""
    return "bash" if not WINDOWS else "bash（Git for Windows）" if git_bash() else "Windows PowerShell"


def shell_argv(command):
    """One agent command as a program to start, in the shell shell_name() names."""
    if not WINDOWS:
        return ["bash", "-c", command]
    bash = git_bash()
    if bash:
        return [bash, "-c", command]
    # Its output in UTF-8, as everything Lattice reads back is.
    return ["powershell", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; " + command]


def runner_argv(command):
    """A runner's command line (python file.py, gcc … && ./out) as a program to start: bash on Linux, cmd on Windows."""
    if WINDOWS:
        return ["cmd.exe", "/d", "/s", "/c", command]
    return ["bash", "-c", command]


def quote(text):
    """One argument for runner_argv's shell."""
    if WINDOWS:
        return '"' + str(text).replace('"', '""') + '"'
    return shlex.quote(str(text))


# What a program started here is told so that what it prints comes back as UTF-8 (Windows' consoles default to the
# locale's code page).
UTF8 = {"PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"} if WINDOWS else {}

# ---- starting and stopping --------------------------------------------------------------------------

# Passed to Popen: the program and whatever it starts form one group, ended together (and on Windows, no console window
# flashes up).
GROUP = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW} if WINDOWS
         else {"start_new_session": True})
# For a short command whose end Lattice waits for: just no console window.
QUIET = {"creationflags": subprocess.CREATE_NO_WINDOW} if WINDOWS else {}


def stop_group(proc, grace=20, wait=True):
    """End a program and everything it started. On Linux it is asked first and killed only if it is still there after
    `grace` seconds (so a launcher such as nvidia-run gets to clean up); on Windows the whole tree is ended at once.
    With wait=False the waiting happens on a thread of its own."""
    if proc.poll() is not None:
        return
    if WINDOWS:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
        return

    def finish():
        try:
            proc.wait(grace)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                proc.kill()
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        proc.terminate()
    if wait:
        finish()
    else:
        threading.Thread(target=finish, daemon=True).start()
