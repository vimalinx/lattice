"""Unit tests never touch the real user profile or vault: APP_HOME and VAULT_PATH
resolve at import time, so the overrides must land before any import. The application object is made here, first,
because the interface tests need a full one and Qt allows one per process."""
import os, sys, tempfile
from pathlib import Path

for key, sub in (("XDG_DATA_HOME", "data"), ("XDG_CONFIG_HOME", "config"), ("LATTICE_VAULT", "vault")):
    os.environ.setdefault(key, tempfile.mkdtemp(prefix="lattice-test-" + sub + "-"))
os.environ.setdefault("LATTICE_LANG", "zh")  # the tests read the Chinese text
os.environ["QT_QPA_PLATFORM"] = "offscreen"  # never a real window, whatever the desktop session asks for
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from PySide6.QtCore import QCoreApplication, Qt
from PySide6.QtWidgets import QApplication

QCoreApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
import main  # registers the app scheme, which has to happen before the application exists

APP = QApplication.instance() or QApplication([])


@pytest.fixture(scope="session")
def _window():
    from workbench import Workbench
    bench = Workbench(APP)
    yield bench
    bench.close()


@pytest.fixture
def ui(_window):
    """The real interface, offscreen, in its first arrangement; every test starts from there."""
    _window.reset()
    yield _window
    assert not _window.errors(), _window.errors()
