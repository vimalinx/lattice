"""One-time move from the old SQLite database into the vault. The old database is only read."""
from __future__ import annotations

import json
import sqlite3

from .learning import MINE, now, stamp_of, uid


def _rows(db, sql, args=()):
    try:
        return [dict(r) for r in db.execute(sql, args).fetchall()]
    except sqlite3.OperationalError:  # tables that older databases never had
        return []


def migrate(source, learning):
    """Write every record of `source` (a lattice.db path) as files, keeping ids and times."""
    store, vault = learning.store, learning.vault
    db = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    settings = {r["key"]: json.loads(r["value"]) for r in _rows(db, "SELECT * FROM learn_settings")}
    chat = settings.get("chat_topic")
    threads = {r["topic_id"]: r for r in _rows(db, "SELECT * FROM learn_threads")}
    counts = {}

    def note(kind):
        counts[kind] = counts.get(kind, 0) + 1

    # Conversations first: topics and practices point at them.
    for s in _rows(db, "SELECT * FROM sessions"):
        head = {"id": s["id"], "kind": "thread", "agent": "api" if s["agent"] in {"codex", "devin", "custom"} else s["agent"],
                "title": s["title"], "project_id": s["project_id"], "created": s["created_at"]}
        lines = [head]
        for m in _rows(db, "SELECT * FROM messages WHERE session_id=? ORDER BY id", (s["id"],)):
            meta = json.loads(m["meta"] or "{}")
            # The old action log is not carried over, so those actions can no longer be undone.
            for action in meta.get("actions") or []:
                action["undoable"] = False
            lines.append({"id": m["id"], "role": m["role"], "content": m["content"], "meta": meta, "at": m["created_at"]})
        vault.write_lines(store._thread_rel(s["id"], s["created_at"]), lines)
        note("thread")
    for t in _rows(db, "SELECT * FROM learn_topics"):
        th = threads.get(t["id"])
        attrs = {"id": t["id"], "kind": "topic", "title": t["title"], "question": t["question"], "parent": t["parent_id"],
                 "state": t["state"], "default": t["id"] == chat or None,
                 "threads": {"tutor": th["tutor_session"], "flash": th["flash_session"]} if th else None,
                 "created": t["created_at"], "updated": t["updated_at"]}
        vault.write_md(vault.unique("topics", t["title"], ".md"), attrs, settings.get("topic_notes:" + t["id"], ""))
        note("topic")
    links = {}
    for r in _rows(db, "SELECT * FROM learn_relations"):
        links.setdefault(r["source"], []).append({"id": r["id"], "to": r["target"], "as": r["kind"], "why": r["reason"], "created": r["created_at"]})
    for c in _rows(db, "SELECT * FROM learn_cards"):
        attrs = {"id": c["id"], "kind": "card", "title": c["title"], "by": c["origin"], "topic": c["topic_id"], "stage": c["stage"],
                 "tags": json.loads(c["tags"] or "[]"), "question": c["question"], "due": c["due_at"], "reviews": c["review_count"] or None,
                 "provenance": json.loads(c["provenance"] or "{}"), "links": links.get(c["id"]),
                 "created": c["created_at"], "updated": c["updated_at"]}
        vault.write_md(vault.unique("cards", c["title"], ".md"), attrs, c["body"].rstrip() + "\n\n" + MINE + "\n\n" + (c["understanding"] or ""))
        note("card")
    for l in _rows(db, "SELECT * FROM learn_lessons"):
        attrs = {"id": l["id"], "kind": "lesson", "title": l["title"], "topic": l["topic_id"], "objective": l["objective"],
                 "state": l["state"], "position": l["position"], "by": l["origin"], "created": l["created_at"], "updated": l["updated_at"]}
        vault.write_md(vault.unique("lessons", l["title"], ".md"), attrs, l["body"])
        note("lesson")
    for n in _rows(db, "SELECT * FROM notes"):
        attrs = {"id": n["id"], "kind": "note", "title": n["title"], "tags": json.loads(n["tags"] or "[]"), "pinned": bool(n["pinned"]),
                 "created": n["created_at"], "updated": n["updated_at"]}
        vault.write_md(vault.unique(f"notes/{n['folder'] or 'Knowledge'}", n["title"], ".md"), attrs, n["body"])
        note("note")
    for nb in _rows(db, "SELECT * FROM learn_notebooks"):
        cells = []
        for c in _rows(db, "SELECT * FROM learn_cells WHERE notebook_id=? ORDER BY position, id", (nb["id"],)):
            cell = {"cell_type": c["kind"], "id": c["id"], "source": c["source"].splitlines(True),
                    "metadata": {"lattice": {"id": c["id"], "run_source": c["run_source"], "last_run_id": c["last_run_id"], "updated": c["updated_at"]}}}
            if c["kind"] == "code":
                cell.update(outputs=json.loads(c["outputs"] or "[]"), execution_count=c["execution_count"])
            cells.append(cell)
        vault.write_json(vault.unique("notebooks", nb["title"], ".ipynb"), {
            "nbformat": 4, "nbformat_minor": 5, "cells": cells,
            "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python"},
                         "lattice": {"id": nb["id"], "title": nb["title"], "topic": nb["topic_id"], "created": nb["created_at"], "updated": nb["updated_at"]}}})
        note("notebook")
    for i in _rows(db, "SELECT * FROM learn_insights"):
        attrs = {"id": i["id"], "kind": "insight", "insight": i["kind"], "title": i["title"], "topic": i["topic_id"],
                 "practice": i["practice_id"], "state": i["state"], "created": i["created_at"]}
        vault.write_md(vault.unique("insights", i["title"], ".md"), attrs, i["detail"])
        note("insight")
    # A practice becomes attributes on its own conversation; its id becomes that conversation's id.
    practice_ids = {}
    for p in _rows(db, "SELECT * FROM learn_practices"):
        rel = store._thread_rel(p["session_id"], next((s["created_at"] for s in _rows(db, "SELECT created_at FROM sessions WHERE id=?", (p["session_id"],))), now()))
        lines = vault.read_lines(rel)
        lines[0].update(title=p["title"], practice={"topic": p["topic_id"], "state": p["state"], "seed": p["seed"], "notebook": p["notebook_id"],
                                                    "source_message": p["source_message_id"], "next_focus": p["next_focus"], "ended": p["ended_at"]})
        vault.write_lines(rel, lines)
        practice_ids[p["id"]] = p["session_id"]
        note("practice")
    if practice_ids:
        for rel in [r for r in vault.files() if r.startswith("insights/")]:
            attrs, body = vault.read_md(rel)
            if attrs.get("practice") in practice_ids:
                attrs["practice"] = practice_ids[attrs["practice"]]
                vault.write_md(rel, attrs, body)
    # Evidence and finished runs become journal entries, in time order.
    entries = []
    for e in _rows(db, "SELECT * FROM learn_evidence"):
        entries.append({"id": uid(), "at": stamp_of(e["created_at"]), "actor": "me", "type": "evidence", "refs": [e["card_id"]],
                        "data": {"id": e["id"], "card": e["card_id"], "kind": e["kind"], "content": e["content"], "run": e["run_id"]}})
    runs_dir = store.root / ".lattice" / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    for r in _rows(db, "SELECT * FROM learn_runs WHERE ended_at IS NOT NULL"):
        (runs_dir / f"{r['id']}.json").write_text(r["outputs"] or "[]", encoding="utf-8")
        entries.append({"id": uid(), "at": stamp_of(r["ended_at"]), "actor": "me", "type": "run", "refs": [r["notebook_id"], r["cell_id"]],
                        "data": {"id": r["id"], "notebook": r["notebook_id"], "cell": r["cell_id"], "source": r["source"], "state": r["state"],
                                 "execution_count": r["execution_count"], "kernel_id": r["kernel_id"], "started": r["started_at"]}})
        note("run")
    for e in _rows(db, "SELECT * FROM events ORDER BY id"):
        entries.append({"id": uid(), "at": stamp_of(e["at"]), "actor": "app", "type": "event", "refs": [],
                        "data": {"kind": e["kind"], "title": e["title"], "detail": e["detail"], "target": e["target"]}})
    from .store import journal_path
    for entry in sorted(entries, key=lambda x: x["at"]):
        vault.append_line(journal_path(entry["at"]), entry)
    projects = [{"id": p["id"], "name": p["name"], "path": p["path"], "created_at": p["created_at"]} for p in _rows(db, "SELECT * FROM projects")]
    if projects:
        store.set_setting("projects", projects)
    db.close()
    for key in ("active_topic", "organizer_session"):
        if settings.get(key):
            store.set_setting(key, practice_ids.get(settings[key], settings[key]))
    store.rebuild()
    vault.commit("从 lattice.db 迁移：" + "、".join(f"{k} {v}" for k, v in counts.items()), "lattice")
    return counts
