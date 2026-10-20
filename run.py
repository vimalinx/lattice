#!/usr/bin/env python3
"""Launch Lattice using the current desktop session; no global environment changes."""
from pathlib import Path
import os
import runpy
import stat

ROOT = Path(__file__).resolve().parent
if os.name == 'posix':
    runtime = Path(os.environ.get('XDG_RUNTIME_DIR', f'/run/user/{os.getuid()}'))
    if runtime.is_dir():
        os.environ.setdefault('XDG_RUNTIME_DIR', str(runtime))
        if not os.environ.get('WAYLAND_DISPLAY') and not os.environ.get('DISPLAY'):
            for socket in sorted(runtime.glob('wayland-[0-9]*')):
                if stat.S_ISSOCK(socket.stat().st_mode) and socket.name.count('-') == 1:
                    os.environ['WAYLAND_DISPLAY'] = socket.name
                    break
        if (runtime/'bus').exists():
            os.environ.setdefault('DBUS_SESSION_BUS_ADDRESS', 'unix:path='+str(runtime/'bus'))
    if os.environ.get('WAYLAND_DISPLAY'):
        os.environ.setdefault('QT_QPA_PLATFORM','wayland')
# Software rendering repaints the whole window on the CPU and makes typing lag,
# so render on the integrated GPU. Pin GL/EGL to Mesa so the web engine never
# loads the NVIDIA vendor library and wakes a compute-only discrete GPU.
# Explicit user overrides are kept.
mesa=Path('/usr/share/glvnd/egl_vendor.d/50_mesa.json')
if mesa.exists():
    os.environ.setdefault('__EGL_VENDOR_LIBRARY_FILENAMES',str(mesa))
    os.environ.setdefault('__GLX_VENDOR_LIBRARY_NAME','mesa')
os.chdir(ROOT)
runpy.run_path(str(ROOT/'main.py'),run_name='__main__')
