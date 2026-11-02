from pathlib import Path
import os
from importlib.metadata import distributions
from PyInstaller.utils.hooks import collect_submodules, copy_metadata
import sys
ROOT = Path(SPECPATH).parents[1]
sys.path.insert(0, str(ROOT))
from lattice import __version__ as VERSION
SIGN = os.environ.get('LATTICE_SIGN_IDENTITY')
ENT = str(ROOT/'packaging/macos/entitlements.plist')
licenses = []
for dist in distributions():
    for f in dist.files or []:
        if any(part.lower() in ('licenses', 'license', 'copying') for part in f.parts) or f.name.lower().startswith(('license', 'copying', 'notice')):
            path = Path(dist.locate_file(f))
            if path.is_file():
                licenses.append((str(path), 'licenses/' + dist.metadata['Name'] + '/' + str(f.parent)))
a = Analysis([str(ROOT / 'main.py')], pathex=[str(ROOT)],
    datas=[(str(ROOT/'ui'),'ui'), (str(ROOT/'lattice/agents'),'lattice/agents'),
           (str(ROOT/'lattice/skills'),'lattice/skills'), (str(ROOT/'lattice/mpl'),'lattice/mpl'),
           (str(ROOT/'lattice/rules.md'),'lattice'), (str(ROOT/'lattice/netfwd.py'),'lattice'),
           (str(ROOT/'LICENSE'),'licenses/Lattice'), *copy_metadata('jupyter_client'), *licenses],
    binaries=[(os.environ['LATTICE_UV'], 'bin')],
    hiddenimports=[*collect_submodules('jupyter_client'), *collect_submodules('lattice')],
    excludes=['numpy','matplotlib','tkinter','IPython','ipykernel','pytest','PIL'])
a.datas = [d for d in a.datas if '/qml/' not in d[0].replace('\\','/')]
pyz = PYZ(a.pure)
exe = EXE(pyz,a.scripts,[],exclude_binaries=True,name='Lattice',console=False,target_arch='arm64', codesign_identity=SIGN, entitlements_file=ENT)
coll = COLLECT(exe,a.binaries,a.datas,name='Lattice')
app = BUNDLE(coll,name='Lattice.app',icon=str(ROOT/'packaging/macos/Lattice.icns'),
    bundle_identifier='com.vimalinx.lattice',version=VERSION, codesign_identity=SIGN, entitlements_file=ENT,
    info_plist={'CFBundleDisplayName':'Lattice','CFBundleShortVersionString':VERSION,
                'LSMinimumSystemVersion':'13.0','NSHighResolutionCapable':True,
                'NSPrincipalClass':'NSApplication','NSSupportsAutomaticGraphicsSwitching':True})
