#!/bin/bash
# Run only after building with LATTICE_SIGN_IDENTITY=Developer ID Application: ...
set -euo pipefail
cd "$(dirname "$0")/../.."
DMG="dist/Lattice-$(${PYTHON:-python3} -c 'from lattice import __version__; print(__version__)')-macos-arm64.dmg"
: "${LATTICE_NOTARY_PROFILE:?Set an existing notarytool keychain profile}"
codesign --verify --deep --strict --verbose=2 dist/Lattice.app
ditto -c -k --keepParent dist/Lattice.app dist/Lattice-notarize.zip
xcrun notarytool submit dist/Lattice-notarize.zip --keychain-profile "$LATTICE_NOTARY_PROFILE" --wait
xcrun stapler staple dist/Lattice.app
xcrun stapler validate dist/Lattice.app
spctl --assess --type execute --verbose=2 dist/Lattice.app
# Rebuild the DMG from the stapled application, then notarize and staple the DMG too.
cp -R dist/Lattice.app packaging/build/dmg/
hdiutil create -volname Lattice -srcfolder packaging/build/dmg -ov -format UDZO "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$LATTICE_NOTARY_PROFILE" --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
(cd dist && shasum -a 256 "$(basename "$DMG")" > SHA256SUMS.txt)
