"""The learning model on top of the vault: topics, cards, lessons, notebooks, practices, insights.

Each kind is one file with a few attributes (see docs/DESIGN.md). Writes go to the
file first and then refresh that file's rows in the index; reads use the index.
A successful Python process never promotes a knowledge card by itself.
"""
from __future__ import annotations

from datetime import datetime, timedelta
import json
import re
import uuid

from .store import words

VERSION = 1
STAGES = {"suggested", "seen", "explained", "applied"}
RELATIONS = {"prerequisite", "part_of", "related", "applies_to", "contrasts"}
# The default conversation is not a topic to the learner; it only needs a name where topics are listed.
CHAT_TITLE = "未归入主题"
MINE = "## 我的理解"
TABLES = ("learn_topics", "learn_threads", "learn_lessons", "learn_cards", "learn_relations", "learn_evidence",
          "learn_notebooks", "learn_cells", "learn_runs", "learn_practices", "learn_insights", "learn_actions")
ID_TABLES = frozenset(TABLES) - {"learn_threads"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS learn_topics(id TEXT PRIMARY KEY, title TEXT NOT NULL, question TEXT NOT NULL DEFAULT '',
  parent_id TEXT, state TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '', is_default INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS learn_threads(topic_id TEXT PRIMARY KEY, tutor_session TEXT NOT NULL, flash_session TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS learn_lessons(id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, title TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'draft',
  position INTEGER NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS learn_cards(id TEXT PRIMARY KEY, title TEXT NOT NULL, canonical TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '', understanding TEXT NOT NULL DEFAULT '', question TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'suggested', topic_id TEXT, tags TEXT NOT NULL DEFAULT '[]',
  origin TEXT NOT NULL DEFAULT 'manual', provenance TEXT NOT NULL DEFAULT '{}', due_at TEXT,
  review_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS learn_relations(id TEXT PRIMARY KEY, source TEXT NOT NULL, target TEXT NOT NULL,
  kind TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS learn_evidence(id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL,
  content TEXT NOT NULL, run_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS learn_notebooks(id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, title TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS learn_cells(id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, kind TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, outputs TEXT NOT NULL DEFAULT '[]', execution_count INTEGER,
  run_source TEXT, last_run_id TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS learn_runs(id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, cell_id TEXT NOT NULL,
  source TEXT NOT NULL, outputs TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL, execution_count INTEGER,
  kernel_id TEXT, started_at TEXT NOT NULL, ended_at TEXT);
CREATE TABLE IF NOT EXISTS learn_practices(id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, title TEXT NOT NULL,
  seed TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL, notebook_id TEXT NOT NULL, source_message_id INTEGER,
  state TEXT NOT NULL DEFAULT 'active', next_focus TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, ended_at TEXT);
CREATE TABLE IF NOT EXISTS learn_insights(id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, practice_id TEXT,
  kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS learn_actions(id TEXT PRIMARY KEY, topic_id TEXT, actor TEXT NOT NULL, summary TEXT NOT NULL,
  ref TEXT, commit_id TEXT, undoable INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS learn_cells_order ON learn_cells(notebook_id,position);
CREATE INDEX IF NOT EXISTS learn_runs_cell ON learn_runs(cell_id,started_at DESC);
CREATE INDEX IF NOT EXISTS learn_cards_topic ON learn_cards(topic_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS learn_evidence_card ON learn_evidence(card_id,created_at DESC);
"""


def uid():
    return uuid.uuid4().hex[:20]


def now():
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def text(value, maximum=50000):
    if not isinstance(value, str):
        raise ValueError("文本字段必须是字符串")
    if len(value) > maximum:
        raise ValueError(f"文本超过 {maximum} 字符限制")
    return value


def title(value):
    value = text(value, 180).strip()
    if not value:
        raise ValueError("标题不能为空")
    return value


def stamp_of(value, fallback=None):
    # YAML turns unquoted timestamps into datetimes; the index keeps ISO strings.
    if isinstance(value, datetime):
        return value.astimezone().isoformat(timespec="milliseconds")
    return str(value) if value else (fallback or now())


def split_mine(body):
    """A card body and the learner's own section under '## 我的理解'."""
    match = re.search(r"^## 我的理解[ \t]*$", body, re.M)
    if not match:
        return body.rstrip(), ""
    return body[:match.start()].rstrip(), body[match.end():].strip()


class LearningStore:
    def __init__(self, store, migrate_from=None):
        self.store, self.db, self.vault = store, store.db, store.vault
        self.db.executescript(SCHEMA)
        self.db.commit()
        store.indexers.update({"topic": self._index_topic, "card": self._index_card, "lesson": self._index_lesson,
                               "insight": self._index_insight, "notebook": self._index_notebook})
        store.journal_indexers.update({"evidence": self._index_evidence, "run": self._index_run,
                                       "action": self._index_action, "undo": self._index_undo})
        store.thread_hooks = [self._index_practice]
        store.index_tables += list(TABLES)
        # Files may have changed while Lattice was closed; the index is cheap to rebuild.
        store.rebuild()
        if migrate_from and migrate_from.exists() and not self.db.execute("SELECT 1 FROM learn_topics").fetchone():
            from .migrate import migrate
            self.migrated = migrate(migrate_from, self)
        self.chat_topic()

    # ---- basics ------------------------------------------------------------------------------
    def rows(self, sql, args=()):
        return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def one(self, table, ident):
        if table not in ID_TABLES:
            raise ValueError("该表不支持按 id 查询")
        row = self.db.execute(f"SELECT * FROM {table} WHERE id=?", (ident,)).fetchone()
        if not row:
            raise ValueError("记录不存在")
        return dict(row)

    def setting(self, key, default=None):
        return self.store.setting(key, default)

    def set_setting(self, key, value):
        return self.store.set_setting(key, value)

    def event(self, heading, detail="", target=""):
        self.store.emit("learning", heading, detail, target)

    def _doc(self, ident, kind):
        rel = self.store.locate(ident, kind)
        if not rel:
            raise ValueError("记录不存在")
        attrs, body = self.vault.read_md(rel)
        return rel, attrs, body

    def _write_md(self, kind, folder, attrs, body, current=None):
        rel = self.vault.unique(folder, attrs["title"], ".md", current)
        if current and current != rel:
            self.vault.move(current, rel)
            self.store.unindex(current)
        self.vault.write_md(rel, attrs, body)
        self.store.reindex(rel)
        return rel

    # ---- topics --------------------------------------------------------------------------------
    def _index_topic(self, rel, unindex=None):
        if unindex is not None:
            self.db.execute("DELETE FROM learn_topics WHERE id=?", (unindex,))
            self.db.execute("DELETE FROM learn_threads WHERE topic_id=?", (unindex,))
            return
        a, body = self.vault.read_md(rel)
        a = self.store.adopt(rel, "topic", a, body)
        created = stamp_of(a.get("created"))
        self.db.execute("INSERT OR REPLACE INTO learn_topics VALUES(?,?,?,?,?,?,?,?,?)",
                        (a["id"], str(a.get("title") or ""), str(a.get("question") or ""), a.get("parent"), a.get("state") or "active",
                         created, stamp_of(a.get("updated"), created), body, int(bool(a.get("default")))))
        threads = a.get("threads") or {}
        if threads.get("tutor") and threads.get("flash"):
            self.db.execute("INSERT OR REPLACE INTO learn_threads VALUES(?,?,?)", (a["id"], threads["tutor"], threads["flash"]))
        self.store.register(rel, a["id"], "topic")

    def topic_save(self, data):
        ident = data.get("id") or uid()
        old = self.one("learn_topics", ident) if data.get("id") else {}
        parent = data.get("parent_id", old.get("parent_id")) or None
        if parent:
            self.one("learn_topics", parent)
            ancestor, visited = parent, {ident}
            while ancestor:
                if ancestor in visited:
                    raise ValueError("兴趣分支不能形成循环")
                visited.add(ancestor)
                ancestor = self.one("learn_topics", ancestor)["parent_id"]
        state = data.get("state", old.get("state", "active"))
        if state not in {"active", "parked", "completed"}:
            raise ValueError("主题状态无效")
        current, attrs, body = self._doc(ident, "topic") if old else (None, {}, "")
        attrs.update(id=ident, kind="topic", title=title(data.get("title", old.get("title", ""))),
                     question=text(data.get("question", old.get("question", "")), 6000), parent=parent, state=state,
                     created=attrs.get("created") or now(), updated=now())
        if data.get("default"):
            attrs["default"] = True
        self._write_md("topic", "topics", attrs, data.get("notes", body), current)
        self.event("更新探索主题" if old else "开始新的探索", attrs["title"], ident)
        return self.one("learn_topics", ident)

    def topic_notes(self, ident):
        return self.one("learn_topics", ident)["notes"]

    def set_topic_notes(self, ident, notes):
        current, attrs, _ = self._doc(ident, "topic")
        attrs["updated"] = now()
        self._write_md("topic", "topics", attrs, text(notes, 8000).strip(), current)

    def chat_topic(self):
        """The always-present default conversation, marked `default: true` in its topic file."""
        row = self.db.execute("SELECT id FROM learn_topics WHERE is_default=1 ORDER BY created_at LIMIT 1").fetchone()
        if row:
            return row[0]
        ident = self.topic_save({"title": CHAT_TITLE, "question": "", "default": True})["id"]
        if not self.setting("active_topic"):
            self.focus(ident)
        return ident

    def focus(self, ident):
        self.one("learn_topics", ident)
        return self.set_setting("active_topic", ident)

    def topic_delete(self, ident):
        topic = self.one("learn_topics", ident)
        if topic["is_default"]:
            raise ValueError("默认对话不能删除")
        # Branches reattach to the deleted topic's parent; cards are kept but detached.
        # Lessons, notebooks, insights and practices go; conversations stay readable.
        for child in self.rows("SELECT id FROM learn_topics WHERE parent_id=?", (ident,)):
            self.topic_save({"id": child["id"], "parent_id": topic["parent_id"]})
        for card in self.rows("SELECT id FROM learn_cards WHERE topic_id=?", (ident,)):
            self.card_save({"id": card["id"], "topic_id": None})
        for table, kind in (("learn_lessons", "lesson"), ("learn_notebooks", "notebook"), ("learn_insights", "insight")):
            for row in self.rows(f"SELECT id FROM {table} WHERE topic_id=?", (ident,)):
                self._remove(row["id"], kind)
        for row in self.rows("SELECT id FROM learn_practices WHERE topic_id=?", (ident,)):
            self.store.update_thread(row["id"], practice=None)
        self._remove(ident, "topic")
        if self.setting("active_topic") == ident:
            self.set_setting("active_topic", None)
        self.event("删除探索主题 · " + topic["title"], "", ident)
        return True

    def _remove(self, ident, kind):
        rel = self.store.locate(ident, kind)
        if rel:
            self.vault.remove(rel)
            self.store.unindex(rel)

    # ---- lessons -------------------------------------------------------------------------------
    def _index_lesson(self, rel, unindex=None):
        if unindex is not None:
            self.db.execute("DELETE FROM learn_lessons WHERE id=?", (unindex,))
            return
        a, body = self.vault.read_md(rel)
        a = self.store.adopt(rel, "lesson", a, body)
        created = stamp_of(a.get("created"))
        self.db.execute("INSERT OR REPLACE INTO learn_lessons VALUES(?,?,?,?,?,?,?,?,?,?)",
                        (a["id"], a.get("topic") or "", str(a.get("title") or ""), str(a.get("objective") or ""), body,
                         a.get("state") or "draft", int(a.get("position") or 0), a.get("by") or "manual", created, stamp_of(a.get("updated"), created)))
        self.store.register(rel, a["id"], "lesson")

    def lesson_delete(self, ident):
        lesson = self.one("learn_lessons", ident)
        self._remove(ident, "lesson")
        self.event("删除课程 · " + lesson["title"], "", lesson["topic_id"])
        return True

    def lesson_save(self, data, origin="manual"):
        ident = data.get("id") or uid()
        old = self.one("learn_lessons", ident) if data.get("id") else {}
        if old and data.get("topic_id") and data["topic_id"] != old["topic_id"]:
            raise ValueError("课程不能跨主题移动；请在目标主题下新建")
        topic = data.get("topic_id", old.get("topic_id"))
        self.one("learn_topics", topic)
        state = data.get("state", old.get("state", "draft"))
        if state not in {"draft", "current", "done"}:
            raise ValueError("课程状态无效")
        position = old.get("position", self.db.execute("SELECT COALESCE(MAX(position),-1)+1 FROM learn_lessons WHERE topic_id=?", (topic,)).fetchone()[0])
        if state == "current":
            for other in self.rows("SELECT id FROM learn_lessons WHERE topic_id=? AND state='current' AND id!=?", (topic, ident)):
                self.lesson_save({"id": other["id"], "state": "draft"})
        current, attrs, _ = self._doc(ident, "lesson") if old else (None, {}, "")
        attrs.update(id=ident, kind="lesson", title=title(data.get("title", old.get("title", ""))), topic=topic,
                     objective=text(data.get("objective", old.get("objective", "")), 2000), state=state, position=position,
                     by=old.get("origin", origin), created=attrs.get("created") or now(), updated=now())
        self._write_md("lesson", "lessons", attrs, text(data.get("body", old.get("body", ""))), current)
        self.event("保存课程 · " + attrs["title"], state, ident)
        return self.one("learn_lessons", ident)

    # ---- cards and relations ----------------------------------------------------------------------
    def _index_card(self, rel, unindex=None):
        if unindex is not None:
            self.db.execute("DELETE FROM learn_cards WHERE id=?", (unindex,))
            self.db.execute("DELETE FROM learn_relations WHERE source=?", (unindex,))
            return
        a, raw = self.vault.read_md(rel)
        a = self.store.adopt(rel, "card", a, raw)
        body, mine = split_mine(raw)
        created = stamp_of(a.get("created"))
        name = str(a.get("title") or "")
        self.db.execute("INSERT OR REPLACE INTO learn_cards VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (a["id"], name, name.casefold(), body, mine, str(a.get("question") or ""), a.get("stage") or "suggested",
                         a.get("topic"), dump([str(t) for t in a.get("tags") or []]), a.get("by") or "manual", dump(a.get("provenance") or {}),
                         stamp_of(a.get("due")) if a.get("due") else None, int(a.get("reviews") or 0), created, stamp_of(a.get("updated"), created)))
        for link in a.get("links") or []:
            self.db.execute("INSERT OR REPLACE INTO learn_relations VALUES(?,?,?,?,?,?)",
                            (link.get("id") or uid(), a["id"], link["to"], link.get("as", "related"), link.get("why", ""), stamp_of(link.get("created"))))
        self.store.register(rel, a["id"], "card")

    def card(self, ident):
        r = self.one("learn_cards", ident)
        r["tags"], r["provenance"] = json.loads(r["tags"]), json.loads(r["provenance"])
        r["evidence"] = self.rows("SELECT * FROM learn_evidence WHERE card_id=? ORDER BY created_at DESC", (ident,))
        return r

    def _write_card(self, ident, change):
        """Rewrite one card file from its current file plus `change` (attrs, body, mine, links)."""
        rel = self.store.locate(ident, "card")
        attrs, raw = self.vault.read_md(rel) if rel else ({}, "")
        body, mine = split_mine(raw)
        attrs.update(change.get("attrs", {}))
        attrs["updated"] = now()
        if "links" in change:
            attrs["links"] = change["links"]
        body = change.get("body", body)
        mine = change.get("mine", mine)
        self._write_md("card", "cards", attrs, body.rstrip() + "\n\n" + MINE + "\n\n" + mine.strip(), rel)

    def card_save(self, data, origin="manual"):
        ident = data.get("id") or uid()
        old = self.card(ident) if data.get("id") else {}
        name = title(data.get("title", old.get("title", "")))
        duplicate = self.db.execute("SELECT id FROM learn_cards WHERE canonical=? AND id!=?", (name.casefold(), ident)).fetchone()
        if duplicate:
            raise ValueError("同名知识卡已存在，请编辑现有卡片或使用不同标题")
        stage = data.get("stage", old.get("stage", "suggested"))
        if stage not in STAGES:
            raise ValueError("理解阶段无效")
        topic = data.get("topic_id", old.get("topic_id")) or None
        if topic:
            self.one("learn_topics", topic)
        tags = data.get("tags", old.get("tags", []))
        if not isinstance(tags, list) or len(tags) > 25:
            raise ValueError("标签应为不超过 25 项的列表")
        attrs = {"id": ident, "kind": "card", "title": name, "by": old.get("origin", origin), "topic": topic, "stage": stage,
                 "tags": [text(x, 60) for x in tags], "question": text(data.get("question", old.get("question", "")), 5000),
                 "provenance": old.get("provenance", data.get("provenance", {})), "created": old.get("created_at") or now()}
        self._write_card(ident, {"attrs": attrs, "body": text(data.get("body", old.get("body", ""))),
                                 "mine": text(data.get("understanding", old.get("understanding", "")), 20000)})
        self.event("保存知识卡 · " + name, stage, ident)
        return self.card(ident)

    def card_supplement(self, ident, addition, by):
        """AI text never overwrites the learner's card; it is appended to the card's explanation."""
        card = self.card(ident)
        self._write_card(ident, {"body": card["body"].rstrip() + f"\n\n**补充（{by}）**\n\n" + text(addition).strip()})

    def card_delete(self, ident):
        card = self.card(ident)
        for row in self.rows("SELECT DISTINCT source FROM learn_relations WHERE target=?", (ident,)):
            self._drop_links(row["source"], lambda link: link["to"] == ident)
        self._remove(ident, "card")
        self.event("删除知识卡 · " + card["title"])
        return True

    def _links(self, ident):
        rel = self.store.locate(ident, "card")
        return list(self.vault.read_md(rel)[0].get("links") or [])

    def _drop_links(self, ident, match):
        self._write_card(ident, {"links": [l for l in self._links(ident) if not match(l)]})

    def evidence_add(self, card_id, kind, content, run_id=None):
        self.card(card_id)
        if kind not in {"explanation", "experiment", "counterexample", "review", "question"}:
            raise ValueError("证据类型无效")
        if run_id:
            run = self.one("learn_runs", run_id)
            if run["state"] != "completed":
                raise ValueError("请选择一次已经成功完成的实验作为证据")
        self.store.record("evidence", {"id": uid(), "card": card_id, "kind": kind, "content": title_or_body(content), "run": run_id},
                          actor="me", refs=[card_id])
        return self.card(card_id)

    def _index_evidence(self, entry):
        d = entry["data"]
        self.db.execute("INSERT OR REPLACE INTO learn_evidence VALUES(?,?,?,?,?,?)",
                        (d["id"], d["card"], d["kind"], d["content"], d.get("run"), entry["at"]))

    def review(self, card_id, reflection, again=False):
        card = self.card(card_id)
        # A transparent, user-rated interval schedule, not an inferred mastery score.
        days = 1 if again else (1, 3, 7, 14, 30)[min(card["review_count"], 4)]
        due = (datetime.now().astimezone() + timedelta(days=days)).isoformat(timespec="seconds")
        self.evidence_add(card_id, "review", reflection or "我手动完成了这次回顾。")
        self._write_card(card_id, {"attrs": {"due": due, "reviews": card["review_count"] + 1}})
        return self.card(card_id)

    def resolve_card(self, ref):
        row = self.db.execute("SELECT id FROM learn_cards WHERE id=? OR canonical=?", (str(ref), str(ref).casefold())).fetchone()
        if not row:
            raise ValueError("找不到关系引用的知识卡：" + str(ref))
        return row[0]

    def relation_add(self, source, target, kind="related", reason=""):
        source, target = self.resolve_card(source), self.resolve_card(target)
        if source == target or kind not in RELATIONS:
            raise ValueError("关系类型无效或关系指向自身")
        if kind in {"prerequisite", "part_of"}:
            # A prerequisite graph and a composition graph each stay acyclic.
            adjacency = {}
            for r in self.rows("SELECT source,target FROM learn_relations WHERE kind=?", (kind,)):
                adjacency.setdefault(r["source"], []).append(r["target"])
            pending, visited = [target], set()
            while pending:
                item = pending.pop()
                if item == source:
                    raise ValueError("这条关系将造成依赖循环")
                if item in visited:
                    continue
                visited.add(item)
                pending.extend(adjacency.get(item, []))
        links = [l for l in self._links(source) if not (l["to"] == target and l.get("as") == kind)]
        ident = uid()
        links.append({"id": ident, "to": target, "as": kind, "why": text(reason, 2000), "created": now()})
        self._write_card(source, {"links": links})
        return ident

    def relation_delete(self, ident):
        row = self.one("learn_relations", ident)
        self._drop_links(row["source"], lambda link: link.get("id") == ident)
        return True

    # ---- notebooks ------------------------------------------------------------------------------
    def _index_notebook(self, rel, unindex=None):
        if unindex is not None:
            self.db.execute("DELETE FROM learn_cells WHERE notebook_id=?", (unindex,))
            self.db.execute("DELETE FROM learn_notebooks WHERE id=?", (unindex,))
            return
        nb = self.vault.read_json(rel)
        meta = (nb.get("metadata") or {}).get("lattice") or {}
        ident = meta.get("id") or uid()
        created = stamp_of(meta.get("created"))
        self.db.execute("INSERT OR REPLACE INTO learn_notebooks VALUES(?,?,?,?,?)",
                        (ident, meta.get("topic") or self.chat_topic_id(), meta.get("title") or rel.rsplit("/", 1)[-1][:-6], created, stamp_of(meta.get("updated"), created)))
        for i, c in enumerate(nb.get("cells") or []):
            cm = (c.get("metadata") or {}).get("lattice") or {}
            src = c.get("source", "")
            self.db.execute("INSERT OR REPLACE INTO learn_cells VALUES(?,?,?,?,?,?,?,?,?,?)",
                            (cm.get("id") or c.get("id") or uid(), ident, "code" if c.get("cell_type") == "code" else "markdown",
                             "".join(src) if isinstance(src, list) else src, i, dump(c.get("outputs") or []), c.get("execution_count"),
                             cm.get("run_source"), cm.get("last_run_id"), stamp_of(cm.get("updated"), created)))
        self.store.register(rel, ident, "notebook")

    def chat_topic_id(self):
        row = self.db.execute("SELECT id FROM learn_topics WHERE is_default=1 LIMIT 1").fetchone()
        return row[0] if row else ""

    def _nb_file(self, ident):
        rel = self.store.locate(ident, "notebook")
        if not rel:
            raise ValueError("记录不存在")
        return rel, self.vault.read_json(rel)

    def _nb_write(self, rel, nb):
        nb["metadata"]["lattice"]["updated"] = now()
        self.vault.write_json(rel, nb)
        self.store.reindex(rel)

    def notebook_create(self, topic_id, name="实验笔记"):
        self.one("learn_topics", topic_id)
        ident, t = uid(), now()
        nb = {"nbformat": 4, "nbformat_minor": 5, "cells": [],
              "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                           "language_info": {"name": "python"},
                           "lattice": {"id": ident, "title": title(name), "topic": topic_id, "created": t, "updated": t}}}
        self._nb_write(self.vault.unique("notebooks", name, ".ipynb"), nb)
        return self.notebook(ident)

    def notebook(self, ident):
        result = self.one("learn_notebooks", ident)
        result["cells"] = self.rows("SELECT * FROM learn_cells WHERE notebook_id=? ORDER BY position,id", (ident,))
        for cell in result["cells"]:
            cell["outputs"] = json.loads(cell["outputs"])
            cell["stale"] = cell["run_source"] is not None and cell["source"] != cell["run_source"]
        return result

    @staticmethod
    def _cell_find(nb, ident):
        for i, c in enumerate(nb["cells"]):
            if ((c.get("metadata") or {}).get("lattice") or {}).get("id") == ident or c.get("id") == ident:
                return i, c
        raise ValueError("记录不存在")

    def cell_save(self, data):
        ident = data.get("id") or uid()
        old = self.one("learn_cells", ident) if data.get("id") else {}
        nb_id = data.get("notebook_id", old.get("notebook_id"))
        self.one("learn_notebooks", nb_id)
        if old and nb_id != old["notebook_id"]:
            raise ValueError("单元格不能跨笔记本移动")
        kind = data.get("kind", old.get("kind", "code"))
        if kind not in {"code", "markdown"}:
            raise ValueError("不支持的单元格类型")
        source = text(data.get("source", old.get("source", "")), 200000)
        rel, nb = self._nb_file(nb_id)
        if old:
            _, cell = self._cell_find(nb, ident)
        else:
            cell = {"id": ident, "metadata": {"lattice": {"id": ident}}}
            nb["cells"].append(cell)
        cell["cell_type"] = kind
        cell["source"] = source.splitlines(True)
        cell.setdefault("metadata", {}).setdefault("lattice", {"id": ident})["updated"] = now()
        if kind == "code":
            cell.setdefault("outputs", [])
            cell.setdefault("execution_count", None)
        else:
            cell.pop("outputs", None)
            cell.pop("execution_count", None)
        self._nb_write(rel, nb)
        return next(c for c in self.notebook(nb_id)["cells"] if c["id"] == ident)

    def cell_delete(self, ident):
        cell = self.one("learn_cells", ident)
        rel, nb = self._nb_file(cell["notebook_id"])
        i, _ = self._cell_find(nb, ident)
        nb["cells"].pop(i)
        self._nb_write(rel, nb)
        return self.notebook(cell["notebook_id"])

    def cell_move(self, ident, direction):
        cell = self.one("learn_cells", ident)
        rel, nb = self._nb_file(cell["notebook_id"])
        at, _ = self._cell_find(nb, ident)
        target = max(0, min(len(nb["cells"]) - 1, at + (-1 if int(direction) < 0 else 1)))
        nb["cells"][at], nb["cells"][target] = nb["cells"][target], nb["cells"][at]
        self._nb_write(rel, nb)
        return self.notebook(cell["notebook_id"])

    def notebook_delete(self, ident):
        nb = self.one("learn_notebooks", ident)
        self._remove(ident, "notebook")
        self.event("删除实验笔记 · " + nb["title"], "", ident)
        return True

    # ---- runs: queued and running live only in the index; finished runs go to the journal --------
    def _runs_dir(self):
        path = self.store.root / ".lattice" / "runs"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def run_create(self, cell_id):
        cell = self.one("learn_cells", cell_id)
        if cell["kind"] != "code":
            raise ValueError("Markdown 单元格不执行 Python")
        ident = uid()
        self.db.execute("INSERT INTO learn_runs(id,notebook_id,cell_id,source,state,started_at) VALUES(?,?,?,?,'queued',?)",
                        (ident, cell["notebook_id"], cell_id, cell["source"], now()))
        self.db.commit()
        return self.one("learn_runs", ident)

    def run_started(self, ident, kernel_id):
        self.db.execute("UPDATE learn_runs SET state='running',kernel_id=? WHERE id=?", (kernel_id, ident))
        self.db.commit()

    def run_finish(self, ident, outputs, state, execution_count=None, kernel_id=None):
        run = self.one("learn_runs", ident)
        if state not in {"completed", "error", "cancelled", "interrupted", "skipped"}:
            raise ValueError("执行状态无效")
        encoded = dump(outputs)
        if len(encoded) > 16000000:
            raise ValueError("运行输出超过大小限制")
        (self._runs_dir() / f"{ident}.json").write_text(encoded, encoding="utf-8")
        try:
            rel, nb = self._nb_file(run["notebook_id"])
            _, cell = self._cell_find(nb, run["cell_id"])
            meta = cell.setdefault("metadata", {}).setdefault("lattice", {})
            meta["last_run_id"] = ident
            if state in {"completed", "error"}:
                cell["outputs"], cell["execution_count"], meta["run_source"] = outputs, execution_count, run["source"]
            self._nb_write(rel, nb)
        except ValueError:
            pass  # the notebook or cell was deleted while running; the run itself is still recorded
        self.store.record("run", {"id": ident, "notebook": run["notebook_id"], "cell": run["cell_id"], "source": run["source"],
                                  "state": state, "execution_count": execution_count, "kernel_id": kernel_id,
                                  "started": run["started_at"], "summary": " ".join(readable_outputs(outputs))[:400]},
                          actor="me", refs=[run["notebook_id"], run["cell_id"]])
        return self.one("learn_runs", ident)

    def _index_run(self, entry):
        d = entry["data"]
        try:
            outputs = (self._runs_dir() / f"{d['id']}.json").read_text(encoding="utf-8")
        except OSError:
            outputs = "[]"
        self.db.execute("INSERT OR REPLACE INTO learn_runs VALUES(?,?,?,?,?,?,?,?,?,?)",
                        (d["id"], d["notebook"], d["cell"], d["source"], outputs, d["state"], d.get("execution_count"),
                         d.get("kernel_id"), d.get("started") or entry["at"], entry["at"]))

    def completed_runs(self, limit=100):
        return self.rows("SELECT id, cell_id, source, execution_count, ended_at FROM learn_runs WHERE state='completed' ORDER BY ended_at DESC LIMIT ?", (limit,))

    def run_history(self, cell_id):
        rows = self.rows("SELECT * FROM learn_runs WHERE cell_id=? ORDER BY started_at DESC LIMIT 100", (cell_id,))
        for row in rows:
            row["outputs"] = json.loads(row["outputs"])
        return rows

    def ipynb(self, ident):
        """A clean copy for export: stale outputs are omitted rather than shown as current."""
        nb = self.notebook(ident)
        cells = []
        for c in nb["cells"]:
            cell = {"cell_type": c["kind"], "id": c["id"], "metadata": {}, "source": c["source"].splitlines(True)}
            if c["kind"] == "code":
                cell.update(outputs=[] if c["stale"] else c["outputs"], execution_count=None if c["stale"] else c["execution_count"])
                if c["stale"]:
                    cell["metadata"]["lattice"] = {"stale_output_omitted": True, "historical_source": c["run_source"]}
            cells.append(cell)
        return {"nbformat": 4, "nbformat_minor": 5, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                "language_info": {"name": "python"}, "lattice": {"title": nb["title"]}}, "cells": cells}

    def ipynb_import(self, topic_id, payload, name="导入的实验笔记"):
        if not isinstance(payload, dict) or payload.get("nbformat") != 4 or not isinstance(payload.get("cells"), list):
            raise ValueError("请选择合法的 nbformat 4 Jupyter Notebook")
        if len(payload["cells"]) > 500:
            raise ValueError("一份笔记本最多导入 500 个单元格")
        nb = self.notebook_create(topic_id, name)
        rel, data = self._nb_file(nb["id"])
        for c in payload["cells"]:
            kind = c.get("cell_type")
            if kind not in {"code", "markdown"}:
                continue
            src = c.get("source", "")
            ident = uid()
            # Untrusted imported outputs are not claimed as local executions.
            data["cells"].append({"cell_type": kind, "id": ident, "source": "".join(src) if isinstance(src, list) else src,
                                  "metadata": {"lattice": {"id": ident}}, **({"outputs": [], "execution_count": None} if kind == "code" else {})})
        self._nb_write(rel, data)
        self.event("导入 Jupyter Notebook", "代码与 Markdown 已导入；请本地运行以获得可追溯结果", nb["id"])
        return self.notebook(nb["id"])

    # ---- conversations of a topic -------------------------------------------------------------------
    def threads(self, topic_id):
        self.one("learn_topics", topic_id)
        row = self.db.execute("SELECT * FROM learn_threads WHERE topic_id=?", (topic_id,)).fetchone()
        if row:
            return dict(row)
        topic = self.one("learn_topics", topic_id)
        tutor = self.store.new_session("api", title="主讲 · " + topic["title"])
        flash = self.store.new_session("api", title="快答 · " + topic["title"])
        self.set_thread(topic_id, tutor=tutor["id"], flash=flash["id"])
        return {"topic_id": topic_id, "tutor_session": tutor["id"], "flash_session": flash["id"]}

    def set_thread(self, topic_id, **sessions):
        current, attrs, body = self._doc(topic_id, "topic")
        attrs["threads"] = {**(attrs.get("threads") or {}), **sessions}
        self._write_md("topic", "topics", attrs, body, current)

    def validate_payload(self, payload):
        """Check AI-proposed knowledge before saving; unknown fields and invalid relations are refused."""
        if not isinstance(payload, dict) or set(payload) - {"lessons", "cards", "relations", "notes"}:
            raise ValueError("要保存的内容含不支持的字段")
        result = {}
        schemas = {"lessons": {"title", "objective", "body"}, "cards": {"title", "body", "question", "tags"},
                   "relations": {"source", "target", "kind", "reason"}, "notes": {"title", "body", "folder"}}
        caps = {"lessons": 5, "cards": 8, "relations": 24, "notes": 3}
        for key, allowed in schemas.items():
            items = payload.get(key) or []
            if not isinstance(items, list) or len(items) > caps[key]:
                raise ValueError(key + " 应是不超过 " + str(caps[key]) + " 项的列表")
            for item in items:
                if not isinstance(item, dict) or set(item) - allowed:
                    raise ValueError(key + " 存在不支持的字段")
                for field, val in item.items():
                    if field == "tags":
                        if not isinstance(val, list) or len(val) > 25:
                            raise ValueError("标签格式无效")
                        for v in val:
                            text(v, 60)
                    else:
                        text(val, 50000)
                if key in {"lessons", "cards", "notes"}:
                    title(item.get("title", ""))
                if key == "relations":
                    if item.get("kind") not in RELATIONS:
                        raise ValueError("关系类型无效")
                    if not item.get("source") or not item.get("target"):
                        raise ValueError("关系需同时给出 source 与 target")
            result[key] = items
        if not any(result.values()):
            raise ValueError("没有可以保存的内容")
        return result

    # ---- practices: a conversation whose header carries the practice ------------------------------------
    def _index_practice(self, head, ident):
        if head is None or not head.get("practice"):
            self.db.execute("DELETE FROM learn_practices WHERE id=?", (ident,))
            return
        p = head["practice"]
        self.db.execute("INSERT OR REPLACE INTO learn_practices VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        (ident, p["topic"], head.get("title", ""), p.get("seed", ""), ident, p["notebook"], p.get("source_message"),
                         p.get("state", "active"), p.get("next_focus", ""), head["created"], p.get("ended")))

    def practice_create(self, topic_id, seed, source_message_id=None, name=None):
        """A practice branch: its own coach conversation and its own notebook."""
        topic = self.one("learn_topics", topic_id)
        if self.db.execute("SELECT 1 FROM learn_practices WHERE topic_id=? AND state!='done'", (topic_id,)).fetchone():
            raise ValueError("这个主题还有一个没结束的练习；先结束它，再开新的练习")
        seed = text(seed, 30000).strip()
        if not seed:
            raise ValueError("没有可以练习的讲解内容")
        # Name it after the lesson's first heading or bold phrase, never its opening sentence.
        found = re.search(r"^#+\s*(.+)$", seed, re.M) or re.search(r"\*\*(.+?)\*\*", seed)
        heading = found.group(1).strip(" #*：:。.") if found else ""
        short = re.split(r"[，。；：,;:（(]", (name or "").strip())[0][:32].strip()
        name = "练习 · " + (short or heading[:32] or topic["title"])
        notebook = self.notebook_create(topic_id, name)
        session = self.store.new_session("api", title=name, attrs={"practice": {
            "topic": topic_id, "state": "active", "seed": seed, "notebook": notebook["id"], "source_message": source_message_id}})
        self.event("开始练习 · " + name, "", session["id"])
        return self.practice(session["id"])

    def practice(self, ident):
        result = self.one("learn_practices", ident)
        result["messages"] = self.store.messages(result["session_id"])
        result["insights"] = self.rows("SELECT * FROM learn_insights WHERE practice_id=? ORDER BY created_at", (ident,))
        return result

    def practice_state(self, ident, state, next_focus=None):
        head = self.store.thread_head(ident)
        p = dict(head.get("practice") or {})
        p["state"] = state
        if state == "done":
            p["ended"] = now()
        if next_focus is not None:
            p["next_focus"] = next_focus
        self.store.update_thread(ident, practice=p)
        return self.practice(ident)

    def insights_record(self, practice_id, review):
        """Store a tutor's review of one practice; weak points stay active until the learner clears them."""
        practice = self.one("learn_practices", practice_id)
        if not isinstance(review, dict):
            raise ValueError("复盘结果应为 JSON 对象")
        for row in self.rows("SELECT id FROM learn_insights WHERE practice_id=?", (practice_id,)):
            self._remove(row["id"], "insight")
        for kind, key in (("weak", "weak_points"), ("strength", "strengths")):
            items = review.get(key) or []
            if not isinstance(items, list):
                raise ValueError(key + " 应为数组")
            for item in items[:8]:
                if isinstance(item, str):
                    item = {"title": item}
                if isinstance(item, dict) and str(item.get("title", "")).strip():
                    self.insight_add(practice["topic_id"], kind, str(item["title"]), str(item.get("detail", "")), practice_id)
        self.practice_state(practice_id, "done", text(str(review.get("next_focus", "")), 2000).strip())
        return self.practice(practice_id)

    # ---- insights --------------------------------------------------------------------------------------
    def _index_insight(self, rel, unindex=None):
        if unindex is not None:
            self.db.execute("DELETE FROM learn_insights WHERE id=?", (unindex,))
            return
        a, body = self.vault.read_md(rel)
        a = self.store.adopt(rel, "insight", a, body)
        self.db.execute("INSERT OR REPLACE INTO learn_insights VALUES(?,?,?,?,?,?,?,?)",
                        (a["id"], a.get("topic") or "", a.get("practice"), a.get("insight") or "weak", str(a.get("title") or ""),
                         body, a.get("state") or "active", stamp_of(a.get("created"))))
        self.store.register(rel, a["id"], "insight")

    def insight_add(self, topic_id, kind, name, detail, practice_id=None):
        if kind not in {"weak", "strength"}:
            raise ValueError("只能记薄弱点或做得好的地方")
        ident = uid()
        self._write_md("insight", "insights", {"id": ident, "kind": "insight", "insight": kind, "title": title(name),
                                                "topic": topic_id, "practice": practice_id, "state": "active", "created": now()},
                       text(detail, 2000))
        return ident

    def insight_resolve(self, ident, state="resolved"):
        rel, attrs, body = self._doc(ident, "insight")
        attrs["state"] = state
        self._write_md("insight", "insights", attrs, body, rel)
        return True

    def learner_profile(self, topic_id):
        """Weak points from practice reviews on this topic and its main lines."""
        ids, current = [topic_id], self.one("learn_topics", topic_id)
        while current["parent_id"]:
            current = self.one("learn_topics", current["parent_id"])
            ids.append(current["id"])
        marks = ",".join("?" * len(ids))
        weak = self.rows(f"SELECT title,detail,created_at FROM learn_insights WHERE kind='weak' AND state='active' AND topic_id IN ({marks}) ORDER BY created_at DESC LIMIT 12", ids)
        strong = self.rows(f"SELECT title,created_at FROM learn_insights WHERE kind='strength' AND topic_id IN ({marks}) ORDER BY created_at DESC LIMIT 6", ids)
        last = self.db.execute("SELECT title,next_focus,ended_at FROM learn_practices WHERE topic_id=? AND state='done' ORDER BY ended_at DESC LIMIT 1", (topic_id,)).fetchone()
        return {"weak_points": weak, "recent_strengths": strong, "last_practice": dict(last) if last else None}

    # ---- agent actions: each is one vault commit, undone by reverting it ----------------------------------
    def action_add(self, topic_id, actor, summary, ref, commit, undoable):
        ident = uid()
        self.store.record("action", {"id": ident, "topic": topic_id, "summary": summary, "ref": ref, "commit": commit,
                                     "undoable": bool(undoable and commit)}, actor=actor)
        return ident

    def _index_action(self, entry):
        d = entry["data"]
        self.db.execute("INSERT OR REPLACE INTO learn_actions VALUES(?,?,?,?,?,?,?,?,?)",
                        (d["id"], d.get("topic"), entry["actor"], d["summary"], d.get("ref"), d.get("commit"),
                         int(bool(d.get("undoable"))), "done", entry["at"]))

    def _index_undo(self, entry):
        self.db.execute("UPDATE learn_actions SET state='undone' WHERE id=?", (entry["data"]["action"],))

    def action_undo(self, ident):
        action = self.one("learn_actions", ident)
        if action["state"] != "done" or not action["undoable"]:
            raise ValueError("这个操作不能撤销")
        touched = self.vault.revert(action["commit_id"])
        # Removed paths first: a moved file keeps its id, so unindexing the old path afterwards would drop it.
        for rel in sorted(touched, key=lambda r: self.vault.path(r).exists()):
            self.store.reindex(rel)
        self.store.record("undo", {"action": ident}, actor="me", refs=[ident])
        return touched

    # ---- whole views -------------------------------------------------------------------------------
    def snapshot(self, topic_id=None):
        chat = self.chat_topic()
        topics = sorted(self.rows("SELECT * FROM learn_topics ORDER BY created_at"), key=lambda t: t["id"] != chat)
        topic_id = topic_id or self.setting("active_topic") or chat
        # A stored active_topic may point at a deleted topic; fall back instead of failing the bootstrap.
        if not any(t["id"] == topic_id for t in topics):
            topic_id = chat
        cards = [self.card(r["id"]) for r in self.rows("SELECT id FROM learn_cards ORDER BY updated_at DESC")]
        threads = self.threads(topic_id)
        practices = self.rows("SELECT id,title,state,next_focus,notebook_id,created_at,ended_at FROM learn_practices WHERE topic_id=? ORDER BY created_at DESC", (topic_id,))
        active = next((p for p in practices if p["state"] != "done"), None)
        return {"version": VERSION, "topics": topics, "active_topic": topic_id, "chat_topic": chat, "cards": cards,
                "all_lessons": self.rows("SELECT * FROM learn_lessons ORDER BY topic_id, position"),
                "all_notebooks": self.rows("SELECT id,title,topic_id FROM learn_notebooks ORDER BY updated_at DESC"),
                "relations": self.rows("SELECT * FROM learn_relations ORDER BY created_at"),
                "lessons": self.rows("SELECT * FROM learn_lessons WHERE topic_id=? ORDER BY position", (topic_id,)),
                "notebooks": [self.notebook(r["id"]) for r in self.rows("SELECT id FROM learn_notebooks WHERE topic_id=? ORDER BY created_at", (topic_id,))],
                "threads": threads,
                "tutor_messages": self.store.messages(threads["tutor_session"]),
                "flash_messages": self.store.messages(threads["flash_session"]),
                "practices": practices, "practice": self.practice(active["id"]) if active else None,
                "insights": self.rows("SELECT * FROM learn_insights WHERE topic_id=? ORDER BY created_at DESC", (topic_id,)),
                "undone_actions": [r["id"] for r in self.rows("SELECT id FROM learn_actions WHERE state='undone' ORDER BY created_at DESC LIMIT 400")],
                "stats": {"topics": len(topics), "cards": len(cards), "seen": sum(c["stage"] != "suggested" for c in cards),
                          "evidence": sum(len(c["evidence"]) for c in cards),
                          "runs": self.db.execute("SELECT COUNT(*) FROM learn_runs WHERE state='completed'").fetchone()[0]}}

    def graph(self):
        """One graph for notes and cards: typed card relations plus [[links]].

        A [[name]] resolves to a note first, then to a card with that title. A
        link between two cards that already share a typed relation is dropped
        so the typed edge carries the meaning."""
        notes = self.store.list_notes(limit=1000)
        cards = self.rows("SELECT id,title,canonical,body,understanding,stage,topic_id FROM learn_cards")
        card_ids = {c["id"] for c in cards}
        relations = [r for r in self.rows("SELECT id,source,target,kind,reason FROM learn_relations") if r["target"] in card_ids]
        note_by = {n["title"].casefold(): n["id"] for n in notes}
        card_by = {c["canonical"]: c["id"] for c in cards}
        typed = {frozenset((r["source"], r["target"])) for r in relations}
        sources = [(n["id"], n["body"]) for n in notes] + [(c["id"], c["body"] + "\n" + c["understanding"]) for c in cards]
        links, seen = [], set(typed)
        for source, body in sources:
            for name in words(body):
                key = name.strip().casefold()
                target = note_by.get(key) or card_by.get(key)
                pair = frozenset((source, target))
                # [[links]] are undirected; mutual links draw one edge.
                if target and target != source and pair not in seen:
                    seen.add(pair)
                    links.append((source, target))
        edges = [{"id": "r:" + r["id"], "source": r["source"], "target": r["target"], "kind": r["kind"], "reason": r["reason"]} for r in relations]
        edges += [{"id": "l:" + a + ":" + b, "source": a, "target": b, "kind": "link", "reason": ""} for a, b in links]
        degree = {}
        for e in edges:
            degree[e["source"]] = degree.get(e["source"], 0) + 1
            degree[e["target"]] = degree.get(e["target"], 0) + 1
        nodes = [{"id": n["id"], "kind": "note", "title": n["title"], "folder": n["folder"], "degree": degree.get(n["id"], 0)} for n in notes]
        nodes += [{"id": c["id"], "kind": "card", "title": c["title"], "stage": c["stage"], "topic_id": c["topic_id"], "degree": degree.get(c["id"], 0)} for c in cards]
        return {"nodes": nodes, "edges": edges}


def readable_outputs(outputs):
    """Notebook outputs as text a model can read; figures become a marker."""
    readable = []
    for out in outputs:
        if out.get("output_type") == "stream":
            readable.append(str(out.get("text", ""))[:1800])
        elif out.get("output_type") == "error":
            readable.append(str(out.get("ename", "")) + ": " + str(out.get("evalue", "")))
        else:
            data = out.get("data", {})
            readable.append(str(data.get("text/plain", "[图形输出已保存]"))[:1800])
    return readable


def title_or_body(value):
    value = text(value, 20000).strip()
    if not value:
        raise ValueError("请先写下观察、理解或证据")
    return value
