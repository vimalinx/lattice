"""What this computer has for computing beyond the CPU, and how to use it, found without waking anything.

On Linux everything here is read from sysfs, /dev and PATH: never nvidia-smi, lspci or a CUDA call, which can wake a
sleeping GPU just to look at it. Windows has no such files; there nvidia-smi, which comes with the driver, is asked. The result is a description agents read (which accelerator, its driver, how a run gets it,
which build of a library fits) plus what the sandbox needs: which device nodes to let in, and the command a GPU run
is wrapped in. Machines differ, so the launcher is a setting: "auto" picks one, or the learner (or an agent on their
behalf) names the command that runs a program on the GPU here.
"""
from __future__ import annotations

import glob
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import subprocess
import sys
import time

from . import host

# The newest CUDA a driver can run, by the driver's major version (from NVIDIA's compatibility table).
CUDA_BY_DRIVER = [(580, "13.0"), (575, "12.9"), (570, "12.8"), (560, "12.6"), (550, "12.4"), (535, "12.2"), (530, "12.1"), (525, "12.0"),
                  (520, "11.8"), (450, "11.0")]
# PyTorch's CUDA builds (download.pytorch.org/whl/<tag>); which ones a release still offers changes, so agents check.
TORCH_CUDA = ["cu118", "cu121", "cu124", "cu126", "cu128", "cu129", "cu130"]
# NVIDIA device ids by generation, roughly; it decides the least CUDA a GPU needs (Blackwell: 12.8).
NVIDIA_ARCH = [(0x2B00, 0x2FFF, "Blackwell（RTX 50 系列等）", "12.8"), (0x2680, 0x28FF, "Ada（RTX 40 系列等）", "11.8"),
               (0x2300, 0x233F, "Hopper", "11.8"), (0x2200, 0x25FF, "Ampere（RTX 30 系列、A100 等）", "11.0"),
               (0x1E00, 0x21FF, "Turing（RTX 20 / GTX 16 系列）", "10.0")]
_cache = {"at": 0.0, "value": None}


def _read(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""


def _pci():
    """Display controllers on the PCI bus: vendor, device id, driver; read from sysfs, which does not wake them."""
    out = []
    for dev in sorted(glob.glob("/sys/bus/pci/devices/*")):
        if not _read(dev + "/class").startswith("0x03"):
            continue
        driver = os.path.basename(os.readlink(dev + "/driver")) if os.path.islink(dev + "/driver") else ""
        out.append({"slot": os.path.basename(dev), "vendor": _read(dev + "/vendor"), "device": _read(dev + "/device"), "driver": driver,
                    "power": _read(dev + "/power/runtime_status")})
    return out


def _which(name):
    found = shutil.which(name) or (str(Path.home() / ".local/bin" / name) if os.access(Path.home() / ".local/bin" / name, os.X_OK) else None)
    return found


def _cuda_max(driver):
    try:
        major = int(driver.split(".")[0])
    except (ValueError, IndexError):
        return None
    return next((cuda for least, cuda in CUDA_BY_DRIVER if major >= least), None)


def _arch(device):
    try:
        ident = int(device, 16)
    except ValueError:
        return None, None
    return next(((name, need) for lo, hi, name, need in NVIDIA_ARCH if lo <= ident <= hi), (None, None))


def detect(launcher="auto"):
    """The accelerators here and the one runs use, as a plain description. Cached for a minute."""
    if _cache["value"] and time.monotonic() - _cache["at"] < 60 and _cache["value"]["launcher_setting"] == launcher:
        return _cache["value"]
    found, notes = [], []
    if sys.platform == "darwin":
        apple = platform.machine() == "arm64"
        found.append({"kind": "apple", "name": "Apple 芯片（Metal / MPS）" if apple else "Mac（Intel）", "usable": apple,
                      "torch": "PyPI 默认的 torch 就带 MPS：device='mps'" if apple else "Intel Mac 上 torch 只能用 CPU"})
    if host.WINDOWS:
        found += _windows_nvidia()
    for d in _pci():
        if d["vendor"] == "0x10de" and d["driver"] == "nvidia":
            driver = _read("/sys/module/nvidia/version") or (re.search(r"Kernel Module\s+(?:for\s+\S+\s+)?([\d.]+)", _read("/proc/driver/nvidia/version")) or [None, ""])[1]
            found.append(_nvidia(d["device"], driver, os.path.exists("/dev/nvidiactl"), d["power"] == "suspended"))
        elif d["vendor"] == "0x1002" and d["driver"] == "amdgpu":
            found.append({"kind": "amd", "name": f"AMD 显卡（设备号 {d['device']}）", "usable": os.path.exists("/dev/kfd"),
                          "torch": "ROCm 版的 torch：index_url 用 https://download.pytorch.org/whl/rocmX.Y（按装的 ROCm 版本）；没有 /dev/kfd 说明没装 ROCm 驱动"})
        elif d["vendor"] == "0x8086" and d["driver"] in ("i915", "xe"):
            found.append({"kind": "intel", "name": f"Intel 显卡（设备号 {d['device']}，驱动 {d['driver']}）", "usable": bool(glob.glob("/dev/dri/renderD*")),
                          "torch": "Intel 显卡一般拿来显示；要用它算，torch 的 XPU 版：index_url 用 https://download.pytorch.org/whl/xpu"})
    order = {"nvidia": 0, "amd": 1, "apple": 2, "intel": 3}
    best = min((a for a in found if a["usable"]), key=lambda a: order[a["kind"]], default=None)
    run, how = _launcher(best, launcher)
    if best and best["kind"] == "nvidia" and run is None and launcher == "auto":
        notes.append("这台电脑没有 nvidia-run：显卡运行时直接用，驱动自己管它什么时候省电")
    value = {"preferred": best["kind"] if best else "cpu", "accelerators": found, "launcher": how, "launcher_setting": launcher,
             "python": platform.python_version(), "machine": platform.machine(), "notes": notes,
             "devices": _devices(best["kind"]) if best else [], "prefix": run or []}
    _cache.update(at=time.monotonic(), value=value)
    return value


def _nvidia(device, driver, usable, asleep=False, name=None):
    """An NVIDIA GPU as agents read it: which generation, the newest CUDA its driver runs, and which torch build fits."""
    cuda = _cuda_max(driver)
    arch, needs = _arch(device)
    tags = [t for t in TORCH_CUDA if cuda and float(f"{t[2:-1]}.{t[-1]}") <= float(cuda) and (not needs or float(f"{t[2:-1]}.{t[-1]}") >= float(needs))]
    index = (f"install 的 index_url 用 https://download.pytorch.org/whl/<{'|'.join(tags[-3:]) or 'cuXYZ'}>（不超过驱动支持的版本"
             + (f"，这块卡至少要 CUDA {needs}" if needs else "") + "）")
    torch = (f"Windows 上 PyPI 默认的 torch 只有 CPU 版，要用显卡必须装 CUDA 版：{index}。" if host.WINDOWS else
             f"PyPI 默认的 torch 在 Linux 上自带较新的 CUDA 运行库，驱动支持到 CUDA {cuda} 时一般直接能用；要指定 CUDA 版本，{index}。")
    return {"kind": "nvidia", "name": name or "NVIDIA " + (arch or "显卡") + f"（设备号 {device}）", "driver": driver, "cuda_max": cuda,
            "usable": usable, "asleep": asleep, "torch": torch + "装好后用 torch.cuda.is_available() 确认"}


def _windows_nvidia():
    """NVIDIA GPUs as their driver's nvidia-smi lists them (Windows)."""
    smi = shutil.which("nvidia-smi")
    if not smi:
        return []
    try:
        out = subprocess.run([smi, "--query-gpu=name,driver_version,pci.device_id", "--format=csv,noheader"], capture_output=True,
                             text=True, timeout=15, **host.QUIET).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    found = []
    for line in out.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) == 3:
            # pci.device_id reads 0xDDDDVVVV: the device id, then the vendor's.
            found.append(_nvidia("0x" + parts[2][2:6].lower(), parts[1], True, name=f"NVIDIA {parts[0]}"))
    return found


def _launcher(best, setting):
    """The command a GPU run is wrapped in, and how to say it. "auto": nvidia-run where there is one (it wakes the GPU
    for the run and puts it back to sleep), otherwise nothing. Otherwise the setting itself, e.g. "prime-run"."""
    if setting and setting not in ("auto", "none"):
        parts = shlex.split(setting)
        if parts and _which(parts[0]):
            return [_which(parts[0]), *parts[1:]], "设置里指定的：" + setting
        return None, f"设置里指定的「{setting}」在这台电脑上找不到，现在直接运行"
    if setting == "none" or not best:
        return None, "直接运行"
    if best["kind"] == "nvidia" and _which("nvidia-run"):
        return [_which("nvidia-run"), "--"], "nvidia-run：运行时唤醒显卡，结束后回到休眠"
    return None, "直接运行（显卡由驱动自己管）"


def _devices(kind):
    """The device nodes a sandboxed run needs for this kind of accelerator."""
    if kind == "nvidia":
        return sorted(glob.glob("/dev/nvidia*"))
    if kind == "amd":
        return ["/dev/kfd", *sorted(glob.glob("/dev/dri/renderD*"))]
    if kind == "intel":
        return sorted(glob.glob("/dev/dri/renderD*"))
    return []
