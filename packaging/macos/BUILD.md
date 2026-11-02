# macOS build

This is the Apple Silicon preview of Lattice, first adapted by a friend of the project. macOS 13+ is the deployment target; the local validation machine runs macOS 26.6.2. Intel and macOS 13 runtime validation have not been performed.

Install Apple Command Line Tools (Git). In a Python 3.13 virtual environment:

```sh
python -m pip install -r requirements.txt pyinstaller==6.22.3 pillow uv==0.13.6 pytest
QT_QPA_PLATFORM=offscreen python -m pytest tests/ -q
QT_QPA_PLATFORM=offscreen bash packaging/macos/build.sh
```

The build includes Python, Qt WebEngine, uv, application resources and dependency license files. Git is an external prerequisite; a startup dialog explains how to install it. Learning Python environments use uv-managed Python 3.12 downloaded on demand. No account credentials or vault contents are included.

The default output is ad hoc signed, **not Developer ID signed or notarized**. It must be labelled as a preview; it is not a Gatekeeper-approved release.

For a production release, configure a Developer ID Application identity in the build machine's keychain, set `LATTICE_SIGN_IDENTITY` before running the build, and use a registered app identifier in `lattice.spec`. Create a notarytool keychain profile through Apple's supported credential setup, then set `LATTICE_NOTARY_PROFILE` and run `bash packaging/macos/notarize.sh`. Do not store secrets in source control. These credentialed steps have not been tested in this adaptation.

Before a signed release, replace the preview wording in INSTALL.txt, test on a clean Mac with the minimum OS version, test Gatekeeper on a quarantined downloaded copy, test a real model connection with your own key, and validate notebook execution and MPS if advertised. The GitHub workflow builds unsigned preview artifacts only; it does not publish a release.

macOS changes: platform detection, Library/Application Support paths (XDG overrides retained), Finder tool PATH, direct execution status, automatic agent execution disabled by default, correct model platform context, managed Python selection, missing Git dialog, .app/.dmg packaging and regression tests. The existing UI already supports Command for its main shortcuts.

No macOS code isolation is provided. Enabling AI execution grants it current-user permissions; the UI states this. Existing local API and app-network protections remain as implemented by the upstream project.
