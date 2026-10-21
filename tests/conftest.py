"""Unit tests never touch the real user profile or vault: APP_HOME and VAULT_PATH
resolve at import time, so the overrides must land before any import."""
import os, tempfile
for key, sub in (("XDG_DATA_HOME", "data"), ("XDG_CONFIG_HOME", "config"), ("LATTICE_VAULT", "vault")):
    os.environ.setdefault(key, tempfile.mkdtemp(prefix="lattice-test-" + sub + "-"))
