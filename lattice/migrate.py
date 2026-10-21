"""One-time move from the old SQLite database into the vault. The old database is only read.

The old default conversation ("未归入主题") was a topic; in the vault it is just
conversations without a topic, so its threads and cards lose the topic. Old
app events are not learning evidence and are left behind, as are the old
action log and proposals: history starts with the vault's first commit.
"""
from __future__ import annotations

import json
import sqlite3

from .model import join_mine
from .index import uid
from .vault import now


def _rows(db, sql, args=()):
    try:
        return [dict(r) for r in db.execute(sql, args).fetchall()]
    except sqlite3.OperationalError:  # tables that older databases never had
        return []


def migrate(source, lattice):
    """Write every record of `source` (a lattice.db path) as files, keeping ids and times."""
    vault = lattice.vault
    db = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    settings = {r["key"]: json.loads(r["value"]) for r in _rows(db, "SELECT * FROM learn_settings")}
    chat = settings.get("chat_topic")
    topic_of = lambda t: None if not t or t == chat else t  # noqa: E731
    by_of = lambda origin: {"manual": "me", "builtin": "lattice", None: "me", "": "me"}.get(origin, origin)  # noqa: E731
    counts = {}

    def count(kind):
        counts[kind] = counts.get(kind, 0) + 1

    # Which conversation is which: a topic's tutor and flash, a practice's coach, the organizer.
    roles = {}
    for r in _rows(db, "SELECT * FROM learn_threads"):
        roles[r["tutor_session"]] = ("tutor", topic_of(r["topic_id"]))
        roles[r["flash_session"]] = ("flash", topic_of(r["topic_id"]))
    practices = {p["session_id"]: p for p in _rows(db, "SELECT * FROM learn_practices")}
    for sid, p in practices.items():
        roles[sid] = ("coach", topic_of(p["topic_id"]))
    if settings.get("organizer_session"):
        roles[settings["organizer_session"]] = ("organizer", None)

    for t in _rows(db, "SELECT * FROM learn_topics"):
        if t["id"] == chat:
            continue
        attrs = {"id": t["id"], "kind": "topic", "title": t["title"], "question": t["question"], "parent": topic_of(t["parent_id"]),
                 "state": t["state"], "by": "me", "created": t["created_at"], "updated": t["updated_at"]}
        vault.write_md(vault.unique("topics", t["title"], ".md"), attrs, settings.get("topic_notes:" + t["id"], ""))
        count("主题")
    links = {}
    for r in _rows(db, "SELECT * FROM learn_relations"):
        links.setdefault(r["source"], []).append({"id": r["id"], "to": r["target"], "as": r["kind"], "why": r["reason"], "by": "me", "created": r["created_at"]})
    for c in _rows(db, "SELECT * FROM learn_cards"):
        attrs = {"id": c["id"], "kind": "card", "title": c["title"], "by": by_of(c["origin"]), "topic": topic_of(c["topic_id"]), "stage": c["stage"],
                 "tags": json.loads(c["tags"] or "[]"), "question": c["question"], "due": c["due_at"], "reviews": c["review_count"] or None,
                 "links": links.get(c["id"]), "created": c["created_at"], "updated": c["updated_at"]}
        vault.write_md(vault.unique("cards", c["title"], ".md"), attrs, join_mine(c["body"] or "", c["understanding"] or ""))
        count("知识卡")
    for l in _rows(db, "SELECT * FROM learn_lessons"):
        attrs = {"id": l["id"], "kind": "lesson", "title": l["title"], "topic": topic_of(l["topic_id"]), "objective": l["objective"],
                 "state": l["state"], "by": by_of(l["origin"]), "created": l["created_at"], "updated": l["updated_at"]}
        vault.write_md(vault.unique("lessons", l["title"], ".md"), attrs, l["body"])
        count("课程")
    for n in _rows(db, "SELECT * FROM notes"):
        attrs = {"id": n["id"], "kind": "note", "title": n["title"], "tags": json.loads(n["tags"] or "[]"), "pinned": bool(n["pinned"]) or None,
                 "by": "me", "created": n["created_at"], "updated": n["updated_at"]}
        vault.write_md(vault.unique(f"notes/{n['folder'] or 'Knowledge'}", n["title"], ".md"), attrs, n["body"])
        count("笔记")
    notebooks = {}
    for nb in _rows(db, "SELECT * FROM learn_notebooks"):
        cells = []
        for c in _rows(db, "SELECT * FROM learn_cells WHERE notebook_id=? ORDER BY position, id", (nb["id"],)):
            cell = {"cell_type": c["kind"], "id": c["id"], "source": c["source"].splitlines(True),
                    "metadata": {"lattice": {k: v for k, v in (("run_source", c["run_source"]),) if v is not None}}}
            if c["kind"] == "code":
                cell.update(outputs=json.loads(c["outputs"] or "[]"), execution_count=c["execution_count"])
            cells.append(cell)
        rel = vault.unique("notebooks", nb["title"], ".ipynb")
        vault.write_json(rel, {"nbformat": 4, "nbformat_minor": 5, "cells": cells,
                               "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                                            "language_info": {"name": "python"},
                                            "lattice": {"id": nb["id"], "title": nb["title"], "topic": topic_of(nb["topic_id"]),
                                                        "created": nb["created_at"], "updated": nb["updated_at"]}}})
        notebooks[nb["id"]] = rel
        count("实验笔记")
    # A practice's id becomes its conversation's id.
    practice_ids = {p["id"]: sid for sid, p in practices.items()}
    for s in _rows(db, "SELECT * FROM sessions"):
        agent, topic = roles.get(s["id"], ("archive", None))
        title = {"tutor": "主讲", "flash": "快答"}.get(agent, s["title"]) if topic is None and agent in ("tutor", "flash") else s["title"]
        head = {"id": s["id"], "kind": "thread", "agent": agent, "title": title, "topic": topic, "created": s["created_at"]}
        p = practices.get(s["id"])
        if p:
            head["practice"] = {"topic": topic, "state": p["state"], "seed": p["seed"], "goal": "", "file": notebooks.get(p["notebook_id"]),
                                "source_message": p["source_message_id"], "next_focus": p["next_focus"], "ended": p["ended_at"], "by": "me"}
            head["title"] = p["title"]
        lines = [head]
        for m in _rows(db, "SELECT * FROM messages WHERE session_id=? ORDER BY id", (s["id"],)):
            meta = json.loads(m["meta"] or "{}")
            # The old action log is not carried over, so those actions can no longer be undone.
            for action in meta.get("actions") or []:
                action["undoable"] = False
            lines.append({"id": m["id"], "role": m["role"], "content": m["content"], "meta": meta, "at": m["created_at"]})
        vault.write_lines(f"threads/{s['created_at'][:7]}/{s['id']}.jsonl", lines)
        count("对话")
    for i in _rows(db, "SELECT * FROM learn_insights"):
        attrs = {"id": i["id"], "kind": "insight", "insight": i["kind"], "title": i["title"], "topic": topic_of(i["topic_id"]),
                 "practice": practice_ids.get(i["practice_id"], i["practice_id"]), "state": i["state"], "by": "tutor", "created": i["created_at"]}
        vault.write_md(vault.unique("insights", i["title"], ".md"), attrs, i["detail"])
        count("薄弱点")
    # Evidence and finished runs become journal entries, in time order.
    entries = []
    for e in _rows(db, "SELECT * FROM learn_evidence"):
        kind = "reviewed" if e["kind"] == "review" else "wrote"
        entries.append({"id": uid(), "at": e["created_at"], "actor": "me", "type": kind, "refs": [x for x in (e["card_id"], e["run_id"]) if x],
                        "data": {"what": e["kind"], "excerpt": e["content"][:2000], **({"run": e["run_id"]} if e["run_id"] else {})}})
    runs_dir = lattice.root / ".lattice" / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    readable = lambda outputs: " ".join(str(o.get("text") or o.get("evalue") or "") for o in outputs)[-400:]  # noqa: E731
    for r in _rows(db, "SELECT * FROM learn_runs WHERE ended_at IS NOT NULL"):
        outputs = json.loads(r["outputs"] or "[]")
        (runs_dir / f"{r['id']}.json").write_text(json.dumps(outputs, ensure_ascii=False), encoding="utf-8")
        path = notebooks.get(r["notebook_id"], r["notebook_id"])
        entries.append({"id": uid(), "at": r["ended_at"], "actor": "me", "type": "ran", "refs": [path, r["cell_id"], r["id"]],
                        "data": {"file": path, "cell": r["cell_id"], "state": r["state"], "summary": readable(outputs), "sandbox": False, "run": r["id"]}})
        count("运行记录")
    for entry in sorted(entries, key=lambda x: x["at"]):
        vault.append_line(f"journal/{entry['at'][:4]}/{entry['at'][:10]}.jsonl", entry)
    projects = [{"id": p["id"], "name": p["name"], "path": p["path"], "created": p["created_at"]} for p in _rows(db, "SELECT * FROM projects")]
    if projects:
        lattice.set_setting("projects", projects)
    db.close()
    if settings.get("active_topic"):
        lattice.set_setting("active_topic", topic_of(practice_ids.get(settings["active_topic"], settings["active_topic"])))
    if settings.get("organizer_session"):
        lattice.set_setting("organizer_thread", settings["organizer_session"])
    lattice.index.rebuild()
    vault.commit("从 lattice.db 迁移：" + "、".join(f"{k} {v}" for k, v in counts.items()), "lattice")
    counts["at"] = now()
    return counts
