"""Bridge-layer invariants: state shape, runs and kernels, busy conversations, the journal."""
import json
from pathlib import Path
import sys
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QCoreApplication
from lattice.bridge import Bridge


@pytest.fixture
def bridge(tmp_path):
    QCoreApplication.instance() or QCoreApplication([])
    b = Bridge(root=tmp_path / "vault", config_path=tmp_path / "providers.json")
    yield b
    b.closing = True
    b.lattice.db.close()


def test_state_shape_is_stable_on_an_empty_vault(bridge):
    state = bridge.rpc_bootstrap()
    for key in ("topics", "active_topic", "docs", "projects", "due", "practices", "busy", "status", "kernels", "running", "config", "sandbox", "layout"):
        assert key in state
    assert state["active_topic"] is None and state["topics"] == []
    chat = bridge.rpc_chat("tutor")
    assert chat["head"]["topic"] is None and chat["messages"] == []


def test_stale_active_topic_falls_back_to_the_default_conversation(bridge):
    t = bridge.lattice.topic_save({"title": "会被删掉"})["id"]
    bridge.lattice.focus(t)
    bridge.lattice.delete_file(bridge.lattice.topic(t)["path"])
    assert bridge.lattice.active_topic() is None
    assert bridge.rpc_chat("tutor")["head"]["topic"] is None


def test_relations_require_real_endpoints(bridge):
    card = bridge.lattice.card_save({"title": "A"})
    with pytest.raises(ValueError):
        bridge.rpc_link(card["id"], "nothing-here", "related")


def test_cancelled_run_keeps_cell_output(bridge):
    l = bridge.lattice
    nb = l.notebook_create("实验")
    cell = l.cell_save(nb, "1+1")
    l.cell_result(nb, cell, [{"output_type": "stream", "name": "stdout", "text": "2\n"}], 1, "1+1")
    ident = l.notebook(nb)["id"]
    bridge.batches[ident] = {"path": nb, "by": "me", "runs": [{"id": "r1", "cell_id": cell, "source": "1+1"}], "results": {}, "waiters": [], "attempt": 0, "mode": "sandbox"}
    bridge.notebook_event({"notebook_id": ident, "kind": "run_finished", "run_id": "r1", "cell_id": cell, "outputs": [], "state": "cancelled"})
    assert l.notebook(nb)["cells"][0]["outputs"][0]["text"] == "2\n"
    assert l.journal("ran")[0]["data"]["state"] == "cancelled"


def test_cell_delete_blocked_while_notebook_running(bridge):
    l = bridge.lattice
    nb = l.notebook_create("实验")
    cell = l.cell_save(nb, "1")
    bridge.batches[l.notebook(nb)["id"]] = {"path": nb}
    with pytest.raises(ValueError):
        bridge.rpc_cell_delete(nb, cell)


def test_topic_delete_waits_for_an_answering_conversation(bridge):
    t = bridge.lattice.topic_save({"title": "还在回答"})["id"]
    thread = bridge.lattice.thread_for("tutor", t)
    bridge.contexts[thread] = ("tutor", t, None, set())
    bridge.busy.add(thread)
    with pytest.raises(ValueError):
        bridge.rpc_topic_delete(t)
    bridge.busy.discard(thread)
    bridge.rpc_topic_delete(t)
    assert not bridge.lattice.topics()


def test_finished_runs_move_through_the_journal(bridge):
    bridge._ran("code/a.py", "completed", [{"output_type": "stream", "name": "stdout", "text": "hi\n"}], "me", False, run="r1")
    entry = bridge.rpc_journal(types=["ran"])[0]
    assert entry["data"]["summary"] == "hi" and entry["refs"][:2] == ["code/a.py", "r1"]


def test_agent_tools_refuse_protected_files_and_typing(bridge):
    from lattice import tools
    l = bridge.lattice
    rel = l.create_file("code", "mine.py", "x = 1\n")
    thread = l.thread_for("tutor", None)
    ctx = tools.Context(bridge, "tutor", thread, None)
    with pytest.raises(ValueError):
        tools.call(ctx, {"write"}, "write", {"file": "journal/2026/x.jsonl", "content": "{}"})
    bridge.rpc_typing(rel)
    with pytest.raises(ValueError):
        tools.call(ctx, {"edit"}, "edit", {"file": rel, "edits": [{"old": "x = 1", "new": "x = 2"}], "why": "改成 2"})
    assert l.read_file(rel)["content"] == "x = 1\n"
