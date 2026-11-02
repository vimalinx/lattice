"""Platform regressions: macOS must not pretend to offer Linux isolation."""
from pathlib import Path
import sys
import pytest
from lattice import host
from lattice.sandbox import Sandbox

# Pretending to be macOS still runs real commands, which need a POSIX shell.
pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="needs a POSIX shell")


def test_macos_launch_is_direct_and_keeps_environment(monkeypatch, tmp_path):
    monkeypatch.setattr(host, 'MACOS', True)
    monkeypatch.setattr(host, 'LINUX', False)
    monkeypatch.setattr(host, 'WINDOWS', False)
    box = Sandbox(tmp_path)
    assert box.available() and not box.isolated
    assert box.bwrap is None
    argv, env = box.launch(['/bin/echo', 'hello'], tmp_path, bins=[tmp_path/'bin'])
    assert argv == ['/bin/echo', 'hello']
    assert env['PATH'].startswith(str(tmp_path/'bin'))
    result = box.shell('printf macos', timeout=5)
    assert result['exit_code'] == 0 and result['output'] == 'macos'


def test_macos_paths_honor_explicit_overrides(monkeypatch, tmp_path):
    monkeypatch.setattr(host, 'MACOS', True)
    monkeypatch.setattr(host, 'WINDOWS', False)
    monkeypatch.delenv('XDG_CONFIG_HOME', raising=False)
    monkeypatch.delenv('XDG_DATA_HOME', raising=False)
    assert host.config_home() == Path.home()/'Library/Application Support'
    assert host.data_home() == Path.home()/'Library/Application Support'
    monkeypatch.setenv('XDG_CONFIG_HOME', str(tmp_path/'config'))
    monkeypatch.setenv('XDG_DATA_HOME', str(tmp_path/'data'))
    assert host.config_home() == tmp_path/'config'
    assert host.data_home() == tmp_path/'data'
