"""Transactional learning data model. No model call is needed to use this module.

The database distinguishes suggested knowledge, self-explanation and executable
artifacts. A successful Python process never promotes a knowledge card by itself.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
import json
import re
import uuid

VERSION = 1
SCHEMA_VERSION = 1
STAGES = {"suggested", "seen", "explained", "applied"}
RELATIONS = {"prerequisite", "part_of", "related", "applies_to", "contrasts"}
TABLES = ("learn_settings", "learn_topics", "learn_lessons", "learn_cards", "learn_relations",
          "learn_evidence", "learn_notebooks", "learn_cells", "learn_runs", "learn_threads", "learn_proposals")
# Tables keyed by a real `id` column. learn_settings/learn_threads use different
# primary keys and must be queried directly, never through one().
ID_TABLES = frozenset(TABLES) - {"learn_settings", "learn_threads"}


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


class LearningStore:
    def __init__(self, store, seed=True):
        self.store, self.db = store, store.db
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS learn_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS learn_topics(
          id TEXT PRIMARY KEY, title TEXT NOT NULL, question TEXT NOT NULL DEFAULT '',
          parent_id TEXT REFERENCES learn_topics(id), state TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS learn_lessons(
          id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES learn_topics(id),
          title TEXT NOT NULL, objective TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
          state TEXT NOT NULL DEFAULT 'draft', position INTEGER NOT NULL, origin TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS learn_cards(
          id TEXT PRIMARY KEY, title TEXT NOT NULL, canonical TEXT NOT NULL UNIQUE,
          body TEXT NOT NULL DEFAULT '', understanding TEXT NOT NULL DEFAULT '',
          question TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'suggested',
          topic_id TEXT REFERENCES learn_topics(id), tags TEXT NOT NULL DEFAULT '[]',
          origin TEXT NOT NULL DEFAULT 'manual', provenance TEXT NOT NULL DEFAULT '{}',
          due_at TEXT, review_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS learn_relations(
          id TEXT PRIMARY KEY, source TEXT NOT NULL REFERENCES learn_cards(id) ON DELETE CASCADE,
          target TEXT NOT NULL REFERENCES learn_cards(id) ON DELETE CASCADE,
          kind TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
          UNIQUE(source,target,kind), CHECK(source != target));
        CREATE TABLE IF NOT EXISTS learn_evidence(
          id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES learn_cards(id) ON DELETE CASCADE,
          kind TEXT NOT NULL, content TEXT NOT NULL, run_id TEXT, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS learn_notebooks(
          id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES learn_topics(id),
          title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS learn_cells(
          id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL REFERENCES learn_notebooks(id) ON DELETE CASCADE,
          kind TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL,
          outputs TEXT NOT NULL DEFAULT '[]', execution_count INTEGER, run_source TEXT,
          last_run_id TEXT, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS learn_runs(
          id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, cell_id TEXT NOT NULL,
          source TEXT NOT NULL, outputs TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL,
          execution_count INTEGER, kernel_id TEXT, started_at TEXT NOT NULL, ended_at TEXT);
        CREATE TABLE IF NOT EXISTS learn_threads(
          topic_id TEXT PRIMARY KEY REFERENCES learn_topics(id),
          tutor_session TEXT NOT NULL, flash_session TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS learn_proposals(
          id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES learn_topics(id), lane TEXT NOT NULL,
          message_id INTEGER, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
          result TEXT, created_at TEXT NOT NULL, applied_at TEXT);
        CREATE INDEX IF NOT EXISTS learn_cells_order ON learn_cells(notebook_id,position);
        CREATE INDEX IF NOT EXISTS learn_runs_cell ON learn_runs(cell_id,started_at DESC);
        CREATE INDEX IF NOT EXISTS learn_cards_topic ON learn_cards(topic_id,updated_at DESC);
        CREATE INDEX IF NOT EXISTS learn_proposals_topic ON learn_proposals(topic_id,state);
        CREATE INDEX IF NOT EXISTS learn_evidence_card ON learn_evidence(card_id,created_at DESC);
        CREATE INDEX IF NOT EXISTS learn_runs_nb ON learn_runs(notebook_id,started_at DESC);
        """)
        self.db.commit()
        # In-flight executions do not survive process restart. Keep the original
        # source and any received output; never label interrupted work successful.
        self.db.execute("UPDATE learn_runs SET state='interrupted',ended_at=? WHERE state IN ('queued','running')", (now(),))
        self.db.commit()
        self._migrate()
        if seed and not self.db.execute("SELECT 1 FROM learn_topics LIMIT 1").fetchone():
            self.seed()

    def _migrate(self):
        """Track the schema in PRAGMA user_version. When the schema evolves, add
        a stepwise branch below keyed by the version being upgraded FROM, then
        bump SCHEMA_VERSION — CREATE TABLE IF NOT EXISTS alone cannot add
        columns to databases that already exist."""
        version = self.db.execute("PRAGMA user_version").fetchone()[0]
        # if version < 2: self.db.executescript("ALTER TABLE learn_cards ADD COLUMN ...")
        if version < SCHEMA_VERSION:
            self.db.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
            self.db.commit()

    @contextmanager
    def transaction(self):
        """Savepoints make proposal application atomic, including nested writes.

        Never call Store methods that commit() (emit/save_note/new_session/...)
        inside a learning transaction: COMMIT releases every savepoint and
        silently breaks atomicity. Use self.event(), which does not commit."""
        name = "sp_" + uid()
        self.db.execute("SAVEPOINT " + name)
        try:
            yield
        except Exception:
            self.db.execute("ROLLBACK TO " + name)
            self.db.execute("RELEASE " + name)
            raise
        else:
            self.db.execute("RELEASE " + name)

    def event(self, heading, detail="", target=""):
        self.db.execute("INSERT INTO events(kind,title,detail,target,at) VALUES('learning',?,?,?,?)",
                        (heading, detail, target, now()))

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
        r = self.db.execute("SELECT value FROM learn_settings WHERE key=?", (key,)).fetchone()
        return json.loads(r[0]) if r else default

    def set_setting(self, key, value):
        with self.transaction():
            self.db.execute("INSERT INTO learn_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, dump(value)))
        return value

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
        with self.transaction():
            self.db.execute("""INSERT INTO learn_topics VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
              title=excluded.title,question=excluded.question,parent_id=excluded.parent_id,state=excluded.state,updated_at=excluded.updated_at""",
              (ident, title(data.get("title", old.get("title", ""))), text(data.get("question", old.get("question", "")), 6000),
               parent, state, old.get("created_at", now()), now()))
            self.event("更新探索主题" if old else "开始新的探索", data.get("title", old.get("title", "")), ident)
        return self.one("learn_topics", ident)

    def focus(self, ident):
        self.one("learn_topics", ident)
        return self.set_setting("active_topic", ident)

    def topic_delete(self, ident):
        topic = self.one("learn_topics", ident)
        children = self.rows("SELECT id FROM learn_topics WHERE parent_id=?", (ident,))
        notebooks = self.rows("SELECT id FROM learn_notebooks WHERE topic_id=?", (ident,))
        with self.transaction():
            # Branches reattach to the deleted topic's parent; cards are kept
            # but detached. Lessons, notebooks, runs, threads and proposals go.
            for child in children:
                self.db.execute("UPDATE learn_topics SET parent_id=? WHERE id=?", (topic["parent_id"], child["id"]))
            self.db.execute("UPDATE learn_cards SET topic_id=NULL WHERE topic_id=?", (ident,))
            for nb in notebooks:
                self._notebook_delete(nb["id"])
            self.db.execute("DELETE FROM learn_lessons WHERE topic_id=?", (ident,))
            self.db.execute("DELETE FROM learn_proposals WHERE topic_id=?", (ident,))
            # learn_threads rows go, but the backing sessions/messages are kept:
            # they remain readable in the AI 协作 history archive.
            self.db.execute("DELETE FROM learn_threads WHERE topic_id=?", (ident,))
            self.db.execute("DELETE FROM learn_topics WHERE id=?", (ident,))
            if self.setting("active_topic") == ident:
                self.set_setting("active_topic", None)
            self.event("删除探索主题 · " + topic["title"], f"{len(children)} 条分支并入上级", ident)
        return True

    def lesson_delete(self, ident):
        lesson = self.one("learn_lessons", ident)
        with self.transaction():
            self.db.execute("DELETE FROM learn_lessons WHERE id=?", (ident,))
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
        with self.transaction():
            if state == "current":
                self.db.execute("UPDATE learn_lessons SET state='draft' WHERE topic_id=? AND state='current' AND id!=?", (topic, ident))
            self.db.execute("""INSERT INTO learn_lessons VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
              title=excluded.title,objective=excluded.objective,body=excluded.body,state=excluded.state,updated_at=excluded.updated_at""",
              (ident, topic, title(data.get("title", old.get("title", ""))), text(data.get("objective", old.get("objective", "")), 2000),
               text(data.get("body", old.get("body", ""))), state, position, old.get("origin", origin), old.get("created_at", now()), now()))
            self.event("保存课程 · " + data.get("title", old.get("title", "")), state, ident)
        return self.one("learn_lessons", ident)

    def card(self, ident):
        r = self.one("learn_cards", ident)
        r["tags"], r["provenance"] = json.loads(r["tags"]), json.loads(r["provenance"])
        r["evidence"] = self.rows("SELECT * FROM learn_evidence WHERE card_id=? ORDER BY created_at DESC", (ident,))
        return r

    def card_save(self, data, origin="manual"):
        ident = data.get("id") or uid()
        old = self.card(ident) if data.get("id") else {}
        name = title(data.get("title", old.get("title", "")))
        canonical = name.casefold()
        duplicate = self.db.execute("SELECT id FROM learn_cards WHERE canonical=? AND id!=?", (canonical, ident)).fetchone()
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
        tags = [text(x, 60) for x in tags]
        with self.transaction():
            self.db.execute("""INSERT INTO learn_cards(id,title,canonical,body,understanding,question,stage,topic_id,tags,origin,provenance,due_at,review_count,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,canonical=excluded.canonical,
              body=excluded.body,understanding=excluded.understanding,question=excluded.question,stage=excluded.stage,
              topic_id=excluded.topic_id,tags=excluded.tags,updated_at=excluded.updated_at""",
              (ident, name, canonical, text(data.get("body", old.get("body", ""))),
               text(data.get("understanding", old.get("understanding", "")), 20000), text(data.get("question", old.get("question", "")), 5000),
               stage, topic, dump(tags), old.get("origin", origin), dump(old.get("provenance", data.get("provenance", {}))),
               old.get("due_at"), old.get("review_count", 0), old.get("created_at", now()), now()))
            self.event("保存知识卡 · " + name, stage, ident)
        return self.card(ident)

    def card_delete(self, ident):
        card = self.card(ident)
        with self.transaction():
            self.db.execute("DELETE FROM learn_cards WHERE id=?", (ident,))
            self.event("删除知识卡 · " + card["title"])
        return True

    def evidence_add(self, card_id, kind, content, run_id=None):
        self.card(card_id)
        if kind not in {"explanation", "experiment", "counterexample", "review", "question"}:
            raise ValueError("证据类型无效")
        if run_id:
            run = self.one("learn_runs", run_id)
            if run["state"] != "completed":
                raise ValueError("请选择一次已经成功完成的实验作为证据")
        ident = uid()
        with self.transaction():
            self.db.execute("INSERT INTO learn_evidence VALUES(?,?,?,?,?,?)", (ident, card_id, kind, title_or_body(content), run_id, now()))
            self.event("添加学习证据", kind, card_id)
        return self.card(card_id)

    def review(self, card_id, reflection, again=False):
        from datetime import timedelta
        card = self.card(card_id)
        # A transparent, user-rated interval schedule, not an inferred mastery score.
        days = 1 if again else (1, 3, 7, 14, 30)[min(card["review_count"], 4)]
        due = (datetime.now().astimezone() + timedelta(days=days)).isoformat(timespec="seconds")
        with self.transaction():
            self.evidence_add(card_id, "review", reflection or "我手动完成了这次回顾。")
            self.db.execute("UPDATE learn_cards SET due_at=?,review_count=review_count+1,updated_at=? WHERE id=?", (due, now(), card_id))
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
        with self.transaction():
            self.db.execute("INSERT INTO learn_relations VALUES(?,?,?,?,?,?) ON CONFLICT(source,target,kind) DO UPDATE SET reason=excluded.reason",
                            (uid(), source, target, kind, text(reason, 2000), now()))
        return True

    def relation_delete(self, ident):
        with self.transaction():
            self.db.execute("DELETE FROM learn_relations WHERE id=?", (ident,))
        return True

    def notebook_create(self, topic_id, name="实验笔记"):
        self.one("learn_topics", topic_id)
        ident = uid()
        with self.transaction():
            self.db.execute("INSERT INTO learn_notebooks VALUES(?,?,?,?,?)", (ident, topic_id, title(name), now(), now()))
        return self.notebook(ident)

    def notebook(self, ident):
        result = self.one("learn_notebooks", ident)
        result["cells"] = self.rows("SELECT * FROM learn_cells WHERE notebook_id=? ORDER BY position,id", (ident,))
        for cell in result["cells"]:
            cell["outputs"] = json.loads(cell["outputs"])
            cell["stale"] = cell["run_source"] is not None and cell["source"] != cell["run_source"]
        return result

    def cell_save(self, data):
        ident = data.get("id") or uid()
        old = self.one("learn_cells", ident) if data.get("id") else {}
        nb = data.get("notebook_id", old.get("notebook_id"))
        self.one("learn_notebooks", nb)
        if old and nb != old["notebook_id"]:
            raise ValueError("单元格不能跨笔记本移动")
        kind = data.get("kind", old.get("kind", "code"))
        if kind not in {"code", "markdown"}:
            raise ValueError("不支持的单元格类型")
        source = text(data.get("source", old.get("source", "")), 200000)
        position = old.get("position", self.db.execute("SELECT COALESCE(MAX(position),-1)+1 FROM learn_cells WHERE notebook_id=?", (nb,)).fetchone()[0])
        with self.transaction():
            self.db.execute("""INSERT INTO learn_cells(id,notebook_id,kind,source,position,updated_at) VALUES(?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,source=excluded.source,updated_at=excluded.updated_at""",
                            (ident, nb, kind, source, position, now()))
            self.db.execute("UPDATE learn_notebooks SET updated_at=? WHERE id=?", (now(), nb))
        return next(c for c in self.notebook(nb)["cells"] if c["id"] == ident)

    def cell_delete(self, ident):
        cell = self.one("learn_cells", ident)
        with self.transaction():
            self.db.execute("DELETE FROM learn_cells WHERE id=?", (ident,))
        return self.notebook(cell["notebook_id"])

    def cell_move(self, ident, direction):
        cell = self.one("learn_cells", ident)
        cells = self.notebook(cell["notebook_id"])["cells"]
        at = next(i for i, c in enumerate(cells) if c["id"] == ident)
        target = max(0, min(len(cells)-1, at + (-1 if int(direction) < 0 else 1)))
        cells[at], cells[target] = cells[target], cells[at]
        with self.transaction():
            for i, row in enumerate(cells):
                self.db.execute("UPDATE learn_cells SET position=? WHERE id=?", (i, row["id"]))
        return self.notebook(cell["notebook_id"])

    def _notebook_delete(self, ident):
        # learn_cells cascade; learn_runs has no FK and must go explicitly.
        # Evidence keeps its text; a deleted run_id just becomes a dead link.
        self.db.execute("DELETE FROM learn_runs WHERE notebook_id=?", (ident,))
        self.db.execute("DELETE FROM learn_notebooks WHERE id=?", (ident,))

    def notebook_delete(self, ident):
        nb = self.one("learn_notebooks", ident)
        with self.transaction():
            self._notebook_delete(ident)
            self.event("删除实验笔记 · " + nb["title"], "", ident)
        return True

    def run_create(self, cell_id):
        cell = self.one("learn_cells", cell_id)
        if cell["kind"] != "code":
            raise ValueError("Markdown 单元格不执行 Python")
        ident = uid()
        with self.transaction():
            self.db.execute("INSERT INTO learn_runs(id,notebook_id,cell_id,source,state,started_at) VALUES(?,?,?,?,'queued',?)",
                            (ident, cell["notebook_id"], cell_id, cell["source"], now()))
        return self.one("learn_runs", ident)

    def run_finish(self, ident, outputs, state, execution_count=None, kernel_id=None):
        run = self.one("learn_runs", ident)
        if state not in {"completed", "error", "cancelled", "interrupted", "skipped"}:
            raise ValueError("执行状态无效")
        encoded = dump(outputs)
        if len(encoded) > 16000000:
            raise ValueError("运行输出超过大小限制")
        with self.transaction():
            self.db.execute("UPDATE learn_runs SET outputs=?,state=?,execution_count=?,kernel_id=?,ended_at=? WHERE id=?",
                            (encoded, state, execution_count, kernel_id, now(), ident))
            if state in {"completed", "error"}:
                self.db.execute("UPDATE learn_cells SET outputs=?,execution_count=?,run_source=?,last_run_id=? WHERE id=?",
                                (encoded, execution_count, run["source"], ident, run["cell_id"]))
            else:
                self.db.execute("UPDATE learn_cells SET last_run_id=? WHERE id=?", (ident, run["cell_id"]))
            self.event("Python 单元格执行 · " + state, "真实内核结果；未自动改变知识掌握程度", run["notebook_id"])
        return self.one("learn_runs", ident)

    def completed_runs(self, limit=100):
        return self.rows("SELECT id, cell_id, source, execution_count, ended_at FROM learn_runs WHERE state='completed' ORDER BY ended_at DESC LIMIT ?", (limit,))

    def run_history(self, cell_id):
        rows = self.rows("SELECT * FROM learn_runs WHERE cell_id=? ORDER BY started_at DESC LIMIT 100", (cell_id,))
        for row in rows:
            row["outputs"] = json.loads(row["outputs"])
        return rows

    def ipynb(self, ident):
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
        with self.transaction():
            nb = self.notebook_create(topic_id, name)
            for c in payload["cells"]:
                kind = c.get("cell_type")
                if kind not in {"code", "markdown"}:
                    continue
                src = c.get("source", "")
                if isinstance(src, list):
                    src = "".join(src)
                self.cell_save({"notebook_id": nb["id"], "kind": kind, "source": src})
            # Untrusted imported outputs are not claimed as local executions.
            self.event("导入 Jupyter Notebook", "代码与 Markdown 已导入；请本地运行以获得可追溯结果", nb["id"])
        return self.notebook(nb["id"])

    def threads(self, topic_id, agent="codex"):
        self.one("learn_topics", topic_id)
        row = self.db.execute("SELECT * FROM learn_threads WHERE topic_id=?", (topic_id,)).fetchone()
        if row:
            return dict(row)
        # Base Store commits its writes; do not place these calls in a savepoint.
        topic = self.one("learn_topics", topic_id)
        tutor = self.store.new_session(agent, title="主讲 · " + topic["title"])
        flash = self.store.new_session("deepseek", title="快答 · " + topic["title"])
        with self.transaction():
            self.db.execute("INSERT INTO learn_threads VALUES(?,?,?)", (topic_id, tutor["id"], flash["id"]))
        return {"topic_id": topic_id, "tutor_session": tutor["id"], "flash_session": flash["id"]}

    def validate_payload(self, payload):
        if not isinstance(payload, dict) or payload.get("version") != 1:
            raise ValueError("学习建议需使用 version: 1 的 JSON 对象")
        if set(payload) - {"version", "summary", "lessons", "cards", "relations", "cells", "notes"}:
            raise ValueError("学习建议含不支持的字段")
        result = {"version": 1, "summary": text(payload.get("summary", ""), 2500)}
        schemas = {"lessons": {"title", "objective", "body"}, "cards": {"title", "body", "question", "tags"},
                   "relations": {"source", "target", "kind", "reason"}, "cells": {"kind", "source"},
                   "notes": {"title", "body", "folder"}}
        caps = {"lessons": 5, "cards": 8, "cells": 8, "relations": 24, "notes": 3}
        for key, allowed in schemas.items():
            items = payload.get(key, [])
            if not isinstance(items, list) or len(items) > caps.get(key, 24):
                raise ValueError(key + " 应是不超过 " + str(caps.get(key, 24)) + " 项的列表")
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
                        raise ValueError("建议关系类型无效")
                    if not item.get("source") or not item.get("target"):
                        raise ValueError("建议关系需同时给出 source 与 target")
                if key == "cells" and item.get("kind") not in {"markdown", "code"}:
                    raise ValueError("建议单元格类型无效")
            result[key] = items
        if not any(result[k] for k in schemas):
            raise ValueError("这份建议没有可以采纳的内容")
        return result

    def proposal_create(self, topic_id, lane, payload, message_id=None):
        self.one("learn_topics", topic_id)
        payload = self.validate_payload(payload)
        ident = uid()
        with self.transaction():
            self.db.execute("INSERT INTO learn_proposals(id,topic_id,lane,message_id,payload,created_at) VALUES(?,?,?,?,?,?)",
                            (ident, topic_id, lane, message_id, dump(payload), now()))
        return ident

    def proposal_extract(self, topic_id, lane, body, message_id=None):
        found, errors = [], []
        for match in re.finditer(r"```lattice\s*\n(.*?)\n```", body, re.S):
            try:
                found.append(self.proposal_create(topic_id, lane, json.loads(match.group(1)), message_id))
            except (ValueError, TypeError, KeyError) as e:
                errors.append(str(e))
        return {"proposals": found, "errors": errors}

    def proposal_apply(self, ident, notebook_id=None):
        proposal = self.one("learn_proposals", ident)
        if proposal["state"] == "applied":
            return json.loads(proposal["result"] or "{}")
        if proposal["state"] != "pending":
            raise ValueError("这份建议已被略过")
        payload = self.validate_payload(json.loads(proposal["payload"]))
        topic = proposal["topic_id"]
        result = {"lessons": [], "cards": [], "cells": [], "relations": 0, "notes": []}
        with self.transaction():
            for item in payload["lessons"]:
                result["lessons"].append(self.lesson_save({**item, "topic_id": topic}, origin=proposal["lane"])["id"])
            for item in payload["cards"]:
                canonical = item["title"].strip().casefold()
                old = self.db.execute("SELECT id FROM learn_cards WHERE canonical=?", (canonical,)).fetchone()
                if old:
                    # New AI text is evidence, not an overwrite of personal understanding.
                    card_id = old[0]
                    self.evidence_add(card_id, "question", "补充解释（AI 建议，已手动采纳）：\n" + item.get("body", ""))
                else:
                    card_id = self.card_save({**item, "topic_id": topic, "stage": "seen", "provenance": {
                        "proposal_id": ident, "message_id": proposal["message_id"], "lane": proposal["lane"]}}, origin=proposal["lane"])["id"]
                result["cards"].append(card_id)
            for relation in payload["relations"]:
                self.relation_add(**relation)
                result["relations"] += 1
            for item in payload.get("notes", []):
                # save_note() commits, which would release this savepoint; write
                # the row directly to keep proposal application atomic.
                note_id, t = uid(), now()
                self.db.execute(
                    "INSERT INTO notes(id,title,body,folder,tags,pinned,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                    (note_id, title(item.get("title", "")), text(item.get("body", "")),
                     text(item.get("folder") or "经验", 80), dump(["AI建议已采纳"]), 0, t, t))
                result["notes"].append(note_id)
            if payload["cells"]:
                if notebook_id:
                    notebook = self.one("learn_notebooks", notebook_id)
                    if notebook["topic_id"] != topic:
                        raise ValueError("建议只能写入所属主题的笔记本")
                else:
                    rows = self.rows("SELECT id FROM learn_notebooks WHERE topic_id=? ORDER BY created_at", (topic,))
                    notebook_id = rows[0]["id"] if rows else self.notebook_create(topic)["id"]
                for item in payload["cells"]:
                    result["cells"].append(self.cell_save({**item, "notebook_id": notebook_id})["id"])
                result["notebook_id"] = notebook_id
            self.db.execute("UPDATE learn_proposals SET state='applied',result=?,applied_at=? WHERE id=?", (dump(result), now(), ident))
            self.event("采纳教学建议", payload["summary"], topic)
        return result

    def proposal_dismiss(self, ident):
        with self.transaction():
            self.db.execute("UPDATE learn_proposals SET state='dismissed' WHERE id=? AND state='pending'", (ident,))
        return True

    def snapshot(self, topic_id=None):
        topics = self.rows("SELECT * FROM learn_topics ORDER BY created_at")
        topic_id = topic_id or self.setting("active_topic") or (topics[0]["id"] if topics else None)
        # A stored active_topic may point at a deleted topic; fall back instead
        # of letting one() fail the whole bootstrap.
        if topic_id and not any(t["id"] == topic_id for t in topics):
            topic_id = topics[0]["id"] if topics else None
        cards = [self.card(r["id"]) for r in self.rows("SELECT id FROM learn_cards ORDER BY updated_at DESC")]
        result = {"version": VERSION, "topics": topics, "active_topic": topic_id, "cards": cards,
                  "all_lessons": self.rows("SELECT * FROM learn_lessons ORDER BY topic_id, position"),
                  "relations": self.rows("SELECT * FROM learn_relations ORDER BY created_at"),
                  # Topic-scoped keys always exist so the frontend never has to
                  # distinguish "no topic yet" from "missing field".
                  "lessons": [], "notebooks": [], "threads": None,
                  "tutor_messages": [], "flash_messages": [], "proposals": [],
                  "stats": {"topics": len(topics), "cards": len(cards), "seen": sum(c["stage"] != "suggested" for c in cards),
                            "evidence": sum(len(c["evidence"]) for c in cards), "runs": self.db.execute("SELECT COUNT(*) FROM learn_runs WHERE state='completed'").fetchone()[0]}}
        if topic_id:
            threads = self.threads(topic_id)
            result.update(lessons=self.rows("SELECT * FROM learn_lessons WHERE topic_id=? ORDER BY position", (topic_id,)),
                          notebooks=[self.notebook(r["id"]) for r in self.rows("SELECT id FROM learn_notebooks WHERE topic_id=? ORDER BY created_at", (topic_id,))],
                          threads=threads,
                          tutor_messages=self.store.messages(threads["tutor_session"]),
                          flash_messages=self.store.messages(threads["flash_session"]),
                          proposals=self.rows("SELECT * FROM learn_proposals WHERE topic_id=? ORDER BY created_at DESC LIMIT 80", (topic_id,)))
            for p in result["proposals"]:
                p["payload"] = json.loads(p["payload"])
        return result

    def context(self, topic_id, lane="tutor", selection="", notebook_id=None):
        if not isinstance(selection, str):
            selection = ""
        s = self.snapshot(topic_id)
        topic = self.one("learn_topics", topic_id)
        ancestors, current = [], topic
        while current["parent_id"]:
            current = self.one("learn_topics", current["parent_id"])
            ancestors.append({"title": current["title"], "question": current["question"]})
        cards = [c for c in s["cards"] if c["topic_id"] == topic_id or c["title"].casefold() in selection.casefold()][:18]
        context = {"topic": topic, "return_path": ancestors, "selected_text": selection[:5000],
                   "lessons": [{k: l[k] for k in ("title", "objective", "state")} for l in s["lessons"]][-12:],
                   "knowledge": [{"title": c["title"], "stage": c["stage"], "my_understanding": c["understanding"][:900],
                                  "open_question": c["question"], "recent_evidence": c["evidence"][:2]} for c in cards]}
        notebooks = [n for n in s["notebooks"] if not notebook_id or n["id"] == notebook_id]
        context["notebooks"] = []
        for nb in notebooks[:2]:
            cells = []
            for c in nb["cells"][-10:]:
                readable = []
                for out in c["outputs"]:
                    if out.get("output_type") == "stream":
                        readable.append(str(out.get("text", ""))[:1800])
                    elif out.get("output_type") == "error":
                        readable.append(str(out.get("ename", "")) + ": " + str(out.get("evalue", "")))
                    else:
                        data = out.get("data", {})
                        readable.append(str(data.get("text/plain", "[图形输出已保存]"))[:1800])
                cells.append({"id": c["id"], "kind": c["kind"], "source": c["source"][:2500], "actual_output": readable,
                              "output_stale": c["stale"], "execution_count": c["execution_count"]})
            context["notebooks"].append({"title": nb["title"], "cells": cells})
        context["other_assistant_recent_dialogue"] = [{"role": m["role"], "content": m["content"][:2200]} for m in
                                                     (s["flash_messages"] if lane == "tutor" else s["tutor_messages"])[-6:]]
        context["provenance_notice"] = "这些是持久化记录；程序重启后变量不一定仍在内核中。代码成功不等于概念已掌握。"
        return context

    def seed(self):
        topic = self.topic_save({"title": "从 Python 到会学习的小模型", "question": "一个程序，怎样从数据里逐渐改变自己的判断？"})
        self.focus(topic["id"])
        self.lesson_save({"topic_id": topic["id"], "title": "让一个数字，根据新见到的样本调整", "objective": "先观察调整方向，再解释每一行代码。", "state": "current",
            "body": "# 先看一个会改变的判断\n\n假设我们用一个数字 `p` 表示对下一次结果为 1 的估计。开始时，先取 `p = 0.5`。\n\n当你看到一个新的样本是 1，你希望这个估计往上调一点；看到 0，就往下调一点。问题来了：**一次该调多少？**\n\n先到「实验笔记」运行前两个单元格，把 `y` 从 1 改成 0，再运行第二格，看看结果向哪里移动。暂时不必记住定义。\n\n接着试着改 `eta`：它越大，新的样本对判断的影响就越明显。先试出这种感觉，再用自己的话描述。\n\n你可以选中一行代码，让右边的快答助手解释语法；需要继续推导时，再请 Codex 接着讲。\n\n> 这是内置的可编辑起点，不是 AI 已经为你生成的课程，也不代表你已经学过。"}, origin="builtin")
        nb = self.notebook_create(topic["id"], "实验 001 · 一个数字怎样学习")
        sources = [("markdown", "## 观察 → 改变 → 解释\n先逐格执行，再改变一个数。每格都使用同一个 Python 内核。"),
                   ("code", "p = 0.5\neta = 0.2\ny = 1\np"),
                   ("code", "p = p + eta * (y - p)\np"),
                   ("markdown", "## 写下你的观察\n我改变了什么？结果变大了还是变小了？\n\n我的猜想：\n"),
                   ("code", "# 在这里尝试你自己的代码\n")]
        for kind, source in sources:
            self.cell_save({"notebook_id": nb["id"], "kind": kind, "source": source})
        examples = [("变量", "一个名字可以指向一个值。执行 `p = 0.5` 后，可在后续单元格里使用 `p`。"),
                    ("列表", "用 `[1, 0, 1]` 把多个值按顺序放在一起。"),
                    ("预测误差", "在这个小实验里，可以先比较 `y - p`：实际观察与当前预测差多少。"),
                    ("更新步长", "实验中的 `eta` 控制每次向新观察移动多远。先改变它，再观察更新。")]
        ids = {}
        for name, body in examples:
            ids[name] = self.card_save({"topic_id": topic["id"], "title": name, "body": body, "stage": "suggested", "tags": ["内置示例", "待探索"]}, origin="builtin")["id"]
        self.relation_add(ids["变量"], ids["预测误差"], "prerequisite", "先理解数值如何被命名，再比较预测与观察。")
        self.relation_add(ids["预测误差"], ids["更新步长"], "prerequisite", "把更新方向与移动幅度区分开。")
        self.relation_add(ids["列表"], ids["变量"], "related", "列表也可以由一个变量名引用。")


def title_or_body(value):
    value = text(value, 20000).strip()
    if not value:
        raise ValueError("请先写下观察、理解或证据")
    return value
