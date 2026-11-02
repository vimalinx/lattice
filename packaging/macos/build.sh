#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
PYTHON="${PYTHON:-python3}"
export PYINSTALLER_CONFIG_DIR="$(pwd)/packaging/build/pyinstaller-cache"
export LATTICE_UV="${LATTICE_UV:-$(command -v uv)}"
VERSION="$("$PYTHON" -c 'from lattice import __version__; print(__version__)')"
DMG="dist/Lattice-$VERSION-macos-arm64-preview.dmg"
"$PYTHON" packaging/macos/icon.py
"$PYTHON" -m PyInstaller packaging/macos/lattice.spec --noconfirm --clean --distpath dist --workpath packaging/build/macos
mkdir -p packaging/build/dmg
cp -R dist/Lattice.app packaging/build/dmg/
ln -sfn /Applications packaging/build/dmg/Applications
cp packaging/macos/INSTALL.txt packaging/build/dmg/安装说明.txt
hdiutil create -volname Lattice -srcfolder packaging/build/dmg -ov -format UDZO "$DMG"
(cd dist && shasum -a 256 "$(basename "$DMG")" > SHA256SUMS.txt)
