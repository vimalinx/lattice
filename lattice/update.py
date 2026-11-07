"""Lattice's own updates: the newest release on GitHub, compared with this version, and how this copy of Lattice is
replaced by it. How depends on how it was installed: the Windows installer runs the new one silently, a folder
(the Windows zip, the Linux tar.gz) is unpacked beside the old one and swapped in once Lattice has closed, the macOS
disk image is downloaded and opened for the learner to drag over, and a Lattice run from source only says so.

The swap is done by a small script started just before Lattice closes; it waits for Lattice to be gone, puts the new
copy in its place and starts it."""
from __future__ import annotations

from .i18n import tr

import hashlib
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import zipfile

import httpx

from . import __version__, host

REPO = "vimalinx/lattice"
LATEST = f"https://api.github.com/repos/{REPO}/releases/latest"
RELEASES = f"https://github.com/{REPO}/releases"
FROZEN = bool(getattr(sys, "frozen", False))
# The folder Lattice runs from when it is a built program (on macOS, the app bundle's Contents/MacOS).
APP_DIR = Path(sys.executable).resolve().parent
EXE = Path(sys.executable).name
# Each way of installing, by the release file it takes.
ASSETS = {"windows-setup": r"Lattice-.+-setup\.exe", "windows-zip": r"Lattice-.+-windows-x64\.zip",
          "linux": r"Lattice-.+-linux-x64\.tar\.gz", "macos": r"Lattice-.+-macos-arm64.*\.dmg"}

# Waits for Lattice to close, swaps the new folder in for the old one (putting the old one back if that fails), starts it.
SWAP_SH = """while kill -0 "$1" 2>/dev/null; do sleep 0.5; done
old="$2.old-$$"
if mv "$2" "$old"; then
  if mv "$3" "$2"; then rm -rf "$old"; else mv "$old" "$2"; fi
fi
rm -rf "$4"
exec "$2/$5"
"""
SWAP_PS1 = """param([int]$Wait, [string]$Mode, [string]$Setup, [string]$App, [string]$New, [string]$Staging, [string]$Exe)
Wait-Process -Id $Wait -ErrorAction SilentlyContinue
if ($Mode -eq "setup") {
  Start-Process -FilePath $Setup -ArgumentList '/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/update=1'
  exit
}
# Files the closed Lattice had open can take a moment to be let go.
$old = "$App.old"
Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue
for ($i = 0; $i -lt 30; $i++) {
  try { Move-Item $App $old -ErrorAction Stop; break } catch { Start-Sleep -Seconds 1 }
}
if (Test-Path $old) {
  try { Move-Item $New $App -ErrorAction Stop; Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue }
  catch { Move-Item $old $App }
}
Remove-Item $Staging -Recurse -Force -ErrorAction SilentlyContinue
Start-Process -FilePath (Join-Path $App $Exe)
"""


def numbers(version):
    """x.y.z of a version or tag (v0.3.2, 0.3.2-dev.7), as numbers to compare; None when it is not one."""
    m = re.match(r"v?(\d+)\.(\d+)\.(\d+)", str(version or "").strip())
    return tuple(int(n) for n in m.groups()) if m else None


def newer(version, than=__version__):
    """Whether a release is newer than this Lattice. A build between releases (x.y.z-dev.N) counts as x.y.z."""
    a, b = numbers(version), numbers(than)
    return bool(a and b and a > b)


def how():
    """How this Lattice was installed, which decides how it is updated."""
    if not FROZEN:
        return "source"
    if host.WINDOWS:
        return "windows-setup" if (APP_DIR / "unins000.exe").exists() else "windows-zip"
    return "macos" if host.MACOS else "linux"


def staging():
    """Where a new folder is unpacked: beside the one it replaces, on the same disk, so it can be moved in place."""
    return APP_DIR.parent / f".{APP_DIR.name}-update"


def asset(release, kind=None):
    """The release's file for this way of installing on this machine, or None."""
    kind = kind or how()
    machine = platform.machine().lower()
    if kind not in ASSETS or (kind == "macos" and machine != "arm64") or (kind != "macos" and machine not in ("x86_64", "amd64")):
        return None
    return next((a for a in release.get("assets") or [] if re.fullmatch(ASSETS[kind], a.get("name") or "")), None)


def blocked(release, kind=None):
    """Why this Lattice cannot update itself to a release; empty when it can."""
    kind = kind or how()
    if kind == "source":
        return tr("从源码运行的 Lattice 用 git pull 更新")
    if not asset(release, kind):
        return tr("这个版本没有适合这台电脑的安装包，可以到发布页看看")
    if kind in ("windows-zip", "linux") and not (os.access(APP_DIR, os.W_OK) and os.access(APP_DIR.parent, os.W_OK)):
        return tr("Lattice 所在的文件夹 {0} 不能写，请到发布页下载新版替换", APP_DIR)
    return ""


def latest():
    """The newest release on GitHub, as the interface shows it."""
    try:
        r = httpx.get(LATEST, timeout=20, follow_redirects=True,
                      headers={"Accept": "application/vnd.github+json", "User-Agent": f"Lattice/{__version__}"})
        if r.status_code in (403, 429):
            # GitHub's API answers a computer 60 times an hour, and everyone behind one address shares that.
            return _from_site()
    except httpx.HTTPError as exc:
        raise RuntimeError(tr("连不上 GitHub：{0}", exc)) from exc
    if r.status_code != 200:
        raise RuntimeError(tr("GitHub 回答了 {0}", r.status_code))
    data = r.json()
    return {"version": str(data.get("tag_name") or "").lstrip("v"), "name": data.get("name") or "", "notes": (data.get("body") or "")[:20000],
            "page": data.get("html_url") or RELEASES, "published": data.get("published_at") or "",
            "assets": [{k: a.get(k) for k in ("name", "size", "digest", "browser_download_url")} for a in data.get("assets") or []]}


def _from_site():
    """The newest release as the website has it, when the API will not answer: its tag from where the releases page
    sends a browser, its notes from the repository, its files by the names a release gives them (their size and
    checksum unknown, so a download is checked against what the server says it sends)."""
    agent = {"User-Agent": f"Lattice/{__version__}"}
    found = re.search(r"/releases/tag/(v?\d+\.\d+\.\d+[^/?#]*)$", httpx.get(RELEASES + "/latest", timeout=20, headers=agent).headers.get("location", ""))
    if not found:
        raise RuntimeError(tr("GitHub 暂时不让查了（请求太频繁），过一会儿再试"))
    tag = found.group(1)
    version = tag.lstrip("v")
    notes = httpx.get(f"https://raw.githubusercontent.com/{REPO}/{tag}/docs/releases/{tag}.md", timeout=20, headers=agent)
    names = [f"Lattice-{version}-setup.exe", f"Lattice-{version}-windows-x64.zip", f"Lattice-{version}-linux-x64.tar.gz",
             f"Lattice-{version}-macos-arm64-preview.dmg"]
    return {"version": version, "name": f"Lattice {tag}", "notes": notes.text[:20000] if notes.status_code == 200 else "",
            "page": f"{RELEASES}/tag/{tag}", "published": "",
            "assets": [{"name": n, "size": 0, "digest": "", "browser_download_url": f"{RELEASES}/download/{tag}/{n}"} for n in names]}


def download(item, folder, progress, cancelled):
    """Fetch a release file into folder, checked against its size and SHA-256; progress(got, total) as it comes.
    Other files left there by earlier updates go."""
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.iterdir():
        if old.is_file():
            old.unlink(missing_ok=True)
    target, part = folder / item["name"], folder / (item["name"] + ".part")
    digest, total, got = hashlib.sha256(), int(item.get("size") or 0), 0
    try:
        with httpx.stream("GET", item["browser_download_url"], timeout=httpx.Timeout(60, connect=20), follow_redirects=True,
                          headers={"User-Agent": f"Lattice/{__version__}"}) as r:
            r.raise_for_status()
            total = total or int(r.headers.get("content-length") or 0)
            with part.open("wb") as out:
                for chunk in r.iter_bytes(1 << 20):
                    if cancelled():
                        raise RuntimeError(tr("下载已取消"))
                    out.write(chunk)
                    digest.update(chunk)
                    got += len(chunk)
                    progress(got, total)
    except httpx.HTTPError as exc:
        part.unlink(missing_ok=True)
        raise RuntimeError(tr("下载失败：{0}", exc)) from exc
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    expected = str(item.get("digest") or "")
    if (total and got != total) or (expected.startswith("sha256:") and digest.hexdigest() != expected[7:].lower()):
        part.unlink(missing_ok=True)
        raise RuntimeError(tr("下载的文件和发布页上的对不上，没有用它"))
    part.replace(target)
    return target


def prepare(kind, file):
    """Unpack a downloaded folder beside the one it replaces; returns the new folder (None when nothing is unpacked)."""
    if kind not in ("windows-zip", "linux"):
        return None
    place = staging()
    shutil.rmtree(place, ignore_errors=True)
    place.mkdir(parents=True)
    try:
        if kind == "linux":
            with tarfile.open(file) as archive:
                archive.extractall(place, filter="data")
            new = place / "Lattice"
        else:
            with zipfile.ZipFile(file) as archive:
                archive.extractall(place)
            new = place
    except (OSError, tarfile.TarError, zipfile.BadZipFile) as exc:
        shutil.rmtree(place, ignore_errors=True)
        raise RuntimeError(tr("解开安装包失败：{0}", exc)) from exc
    if not (new / EXE).is_file():
        shutil.rmtree(place, ignore_errors=True)
        raise RuntimeError(tr("安装包里没有 Lattice 程序"))
    return new


def _clean_env():
    """This process's environment without what the built program's launcher set for it, so the Lattice started after
    the update starts as a program of its own."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("_PYI_", "_MEI"))}
    for key in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"):
        if key + "_ORIG" in env:
            env[key] = env.pop(key + "_ORIG")
        else:
            env.pop(key, None)
    env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
    return env


def hand_over(kind, file, new, folder):
    """Start what finishes the update once Lattice has closed: the installer, or the swap of the folders."""
    # It runs outside Lattice's folder: a folder something is working in cannot be moved on Windows.
    pid, quiet = str(os.getpid()), {"env": _clean_env(), "cwd": str(folder), "stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL,
                                    "stderr": subprocess.DEVNULL, "close_fds": True}
    if kind == "linux":
        subprocess.Popen(["sh", "-c", SWAP_SH, "lattice-update", pid, str(APP_DIR), str(new), str(staging()), EXE], start_new_session=True, **quiet)
    elif kind in ("windows-setup", "windows-zip"):
        script = folder / "lattice-update.ps1"
        script.write_text(SWAP_PS1, encoding="utf-8-sig")
        args = ["-Wait", pid, "-Exe", EXE] + (["-Mode", "setup", "-Setup", str(file)] if kind == "windows-setup" else
                                              ["-Mode", "zip", "-App", str(APP_DIR), "-New", str(new), "-Staging", str(staging())])
        subprocess.Popen(["powershell", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script), *args],
                         creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW, **quiet)
    else:
        raise ValueError(tr("这种安装方式不能自己更新"))
