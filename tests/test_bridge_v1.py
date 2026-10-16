"""Bridge-layer and store invariants added after the whole-project review."""
import json
from pathlib import Path
import sys
import time
import zipfile
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QCoreApplication, QThread, Signal
from lattice.store import Store
from lattice.learning import LearningStore
from lattice.learning_bridge import LearningBridge


@pytest.fixture
def model(tmp_path):
    s = Store(tmp_path / "data.db", seed=False)
    l = LearningStore(s)
    yield l
    s.close()


@pytest.fixture
def bridge(tmp_path):
    QCoreApplication.instance() or QCoreApplication([])
    b = LearningBridge(store=Store(tmp_path / "data.db", seed=False), config_path=tmp_path / "providers.json")
    yield b
    b.closing = True
    b.store.close()


def topic(l):
    return l.snapshot()["active_topic"]


def test_snapshot_shape_is_stable_without_topics(tmp_path):
    s = Store(tmp_path / "data.db", seed=False)
    l = LearningStore(s)
    l.db.execute("DELETE FROM learn_threads")
    l.db.execute("DELETE FROM learn_lessons")
    l.db.execute("DELETE FROM learn_cells")
    l.db.execute("DELETE FROM learn_notebooks")
    l.db.execute("DELETE FROM learn_cards")
    l.db.execute("DELETE FROM learn_topics")
    l.db.commit()
    snap = l.snapshot()
    for key in ("lessons", "notebooks", "threads", "tutor_messages", "flash_messages", "proposals"):
        assert key in snap
    assert snap["active_topic"] is None
    s.close()


def test_snapshot_stale_active_topic_falls_back(model):
    tid = topic(model)
    model.db.execute("UPDATE learn_cards SET topic_id=NULL WHERE topic_id=?", (tid,))
    for table in ("learn_threads", "learn_lessons", "learn_notebooks", "learn_topics"):
        model.db.execute(f"DELETE FROM {table} WHERE {'id' if table == 'learn_topics' else 'topic_id'}=?", (tid,))
    model.db.commit()
    model.set_setting("active_topic", tid)
    snap = model.snapshot()
    assert snap["active_topic"] is None
    assert snap["lessons"] == []


def test_proposal_relations_require_endpoints(model):
    with pytest.raises(ValueError):
        model.validate_payload({"version": 1, "relations": [{"kind": "related", "source": "x"}]})


def test_lesson_cannot_move_across_topics(model):
    other = model.topic_save({"title": "另一个主题"})["id"]
    lesson = model.lesson_save({"topic_id": topic(model), "title": "第一节"})
    with pytest.raises(ValueError):
        model.lesson_save({"id": lesson["id"], "topic_id": other, "title": "第一节"})


def test_cancelled_run_keeps_cell_output(model):
    nb = model.notebook_create(topic(model))
    cell = model.cell_save({"notebook_id": nb["id"], "kind": "code", "source": "1+1"})
    run = model.run_create(cell["id"])
    model.run_finish(run["id"], [{"output_type": "stream", "name": "stdout", "text": "2\n"}], "completed", 1)
    second = model.run_create(cell["id"])
    model.run_finish(second["id"], [], "cancelled")
    now = next(c for c in model.notebook(nb["id"])["cells"] if c["id"] == cell["id"])
    assert now["outputs"][0]["text"] == "2\n"
    assert now["last_run_id"] == second["id"]


def test_cell_delete_blocked_while_notebook_running(bridge):
    nb = bridge.learning.notebook_create(topic(bridge.learning))
    cell = bridge.learning.cell_save({"notebook_id": nb["id"], "kind": "code", "source": "1"})
    bridge.pending_notebooks.add(nb["id"])
    with pytest.raises(ValueError):
        bridge.dispatch("nb_cell_delete", {"id": cell["id"]})


class _Spin(QThread):
    """A running worker that accepts the calls topic_delete makes."""
    event = Signal(dict)

    def __init__(self):
        super().__init__()
        self.calls = []

    def post(self, kind, **kw):
        self.calls.append(kind)

    def stop(self):
        self.calls.append("stop")

    def run(self):
        time.sleep(0.6)


def test_topic_delete_retires_running_workers(bridge):
    tid = topic(bridge.learning)
    threads = bridge.learning.threads(tid)
    spin = _Spin()
    spin.event.connect(bridge.tutor_event)
    spin.start()
    bridge.workers[threads["tutor_session"]] = spin
    bridge.topic_delete(tid)
    # Retiring keeps the QThread alive; destroying it here would qFatal the app.
    assert spin.isRunning()
    assert "stop" in spin.calls
    spin.wait(3000)


def test_export_excludes_credentials(bridge, tmp_path):
    out = tmp_path / "archive.zip"
    assert bridge.export_learning(str(out))
    with zipfile.ZipFile(out) as z:
        names = z.namelist()
        assert "providers.json" not in names
        assert "lattice.db" in names and "learning.json" in names
        assert "auth.json" not in names


def test_completed_runs_moves_through_store(bridge):
    nb = bridge.learning.notebook_create(topic(bridge.learning))
    cell = bridge.learning.cell_save({"notebook_id": nb["id"], "kind": "code", "source": "1"})
    run = bridge.learning.run_create(cell["id"])
    bridge.learning.run_finish(run["id"], [], "completed", 1)
    result = bridge.dispatch("learn_completed_runs", {})
    assert result and result[0]["id"] == run["id"]
