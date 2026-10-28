# PyInstaller: Lattice as a folder with Lattice.exe in it (pyinstaller packaging/lattice.spec, from the repository root).
# The interface, the agents' rules, the skills and the figures backend go along as they are; numpy and matplotlib
# stay out (they live in the learner's own Python environments, not in Lattice).
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, copy_metadata

ROOT = Path(SPECPATH).parent
icon = ROOT / "packaging" / "build" / "lattice.ico"

datas = [(str(ROOT / "ui"), "ui"),
         (str(ROOT / "lattice" / "agents"), "lattice/agents"),
         (str(ROOT / "lattice" / "skills"), "lattice/skills"),
         (str(ROOT / "lattice" / "mpl"), "lattice/mpl"),
         (str(ROOT / "lattice" / "rules.md"), "lattice"),
         (str(ROOT / "lattice" / "netfwd.py"), "lattice"),
         # jupyter_client finds how to start a kernel through its package metadata.
         *copy_metadata("jupyter_client")]

a = Analysis([str(ROOT / "main.py")], pathex=[str(ROOT)], datas=datas,
             hiddenimports=[*collect_submodules("jupyter_client"), *collect_submodules("lattice")],
             excludes=["numpy", "matplotlib", "tkinter", "IPython", "ipykernel", "pytest", "PIL"])


def wanted(entry):
    """Qt Quick's QML (this is a widgets and web program) and Qt's translations other than Chinese and English stay out."""
    path = entry[0].replace("\\", "/")
    if "PySide6/Qt/qml/" in path or "PySide6/qml/" in path:
        return False
    if "/translations/" in path:
        return any(lang in path for lang in ("zh_CN", "zh-CN", "zh_TW", "zh-TW", "_en.", "en-US", "en-GB"))
    return True


def version_file():
    """Lattice.exe's version, as Windows shows it in the file's properties (a build between releases, x.y.z-dev.N, as
    x.y.z.N)."""
    import re
    import sys
    from PyInstaller.utils.win32 import versioninfo as vi
    sys.path.insert(0, str(ROOT))
    from lattice import __version__
    numbers = [int(n) for n in re.findall(r"\d+", __version__)][:4]
    numbers = tuple(numbers + [0] * (4 - len(numbers)))
    strings = {"CompanyName": "Vimalinx", "FileDescription": "Lattice", "ProductName": "Lattice", "InternalName": "Lattice",
               "OriginalFilename": "Lattice.exe", "FileVersion": __version__, "ProductVersion": __version__,
               "LegalCopyright": "MIT License"}
    info = vi.VSVersionInfo(ffi=vi.FixedFileInfo(filevers=numbers, prodvers=numbers),
                            kids=[vi.StringFileInfo([vi.StringTable("040904B0", [vi.StringStruct(k, v) for k, v in strings.items()])]),
                                  vi.VarFileInfo([vi.VarStruct("Translation", [0x0409, 1200])])])
    path = ROOT / "packaging" / "build" / "version.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(info), encoding="utf-8")
    return str(path)


a.datas = [d for d in a.datas if wanted(d)]
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="Lattice", console=False, icon=str(icon) if icon.exists() else None,
          version=version_file())
coll = COLLECT(exe, a.binaries, a.datas, name="Lattice")
