"""Unit tests never touch the real user profile: APP_HOME resolves at
lattice.store import time, so the XDG override must land before any import."""
import os, tempfile
for key, sub in (("XDG_DATA_HOME", "data"), ("XDG_CONFIG_HOME", "config")):
    os.environ.setdefault(key, tempfile.mkdtemp(prefix="lattice-test-" + sub + "-"))
