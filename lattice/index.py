"""The SQLite index of the vault. Every row comes from a file and can be rebuilt.

One indexer per kind of file: Markdown documents and notebooks become `docs`
rows (with their `links`), conversations become `threads` and `messages`, the
journal becomes `journal` rows, and every other file is just listed in `files`.
"""
from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import sqlite3
import uuid

from .vault import kind_of, now

SCHEMA = """
CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, id TEXT, kind TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS files_id ON files(id);
CREATE TABLE IF NOT EXISTS docs(id TEXT PRIMARY KEY, path TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
  topic TEXT, attrs TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS docs_kind ON docs(kind, updated DESC);
CREATE TABLE IF NOT EXISTS links(id TEXT PRIMARY KEY, source TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS links_target ON links(target);
CREATE TABLE IF NOT EXISTS journal(id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, type TEXT NOT NULL,
  refs TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS journal_type ON journal(type, at DESC);
CREATE INDEX IF NOT EXISTS journal_at ON journal(at DESC);
CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY, path TEXT NOT NULL, agent TEXT NOT NULL, title TEXT NOT NULL,
  topic TEXT, head TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, thread TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread, id);
CREATE TABLE IF NOT EXISTS annotations(id TEXT PRIMARY KEY, path TEXT NOT NULL, source TEXT NOT NULL, author TEXT NOT NULL, color TEXT NOT NULL,
  note TEXT NOT NULL, text TEXT NOT NULL, label TEXT NOT NULL, anchor TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, ask TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS annotations_source ON annotations(source);
"""
TABLES = ("files", "docs", "links", "journal", "threads", "messages", "annotations")


def uid():
    return uuid.uuid4().hex[:16]


def stamp_of(value, fallback=None):
    # YAML turns unquoted timestamps into datetimes; the index keeps ISO strings.
    if isinstance(value, datetime):
        return value.astimezone().isoformat(timespec="milliseconds")
    return str(value) if value else (fallback or now())


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


class Index:
    def __init__(self, vault):
        self.vault = vault
        self.db = sqlite3.connect(str(vault.root / ".lattice" / "index.db"))
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=3000")
        self.db.executescript(SCHEMA)
        if not any(r["name"] == "ask" for r in self.rows("PRAGMA table_info(annotations)")):
            self.db.execute("ALTER TABLE annotations ADD COLUMN ask TEXT NOT NULL DEFAULT ''")
        self.db.commit()
        self.problems = []
        self.rebuild()

    def rows(self, sql, args=()):
        return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def one(self, sql, args=()):
        row = self.db.execute(sql, args).fetchone()
        return dict(row) if row else None

    # ---- whole index -----------------------------------------------------------------
    def rebuild(self):
        """Throw the index away and read every file again."""
        for table in TABLES:
            self.db.execute("DELETE FROM " + table)
        self.vault.known.clear()
        self.problems = []
        # Journal last so entries can point at everything else.
        for rel in sorted(self.vault.files(), key=lambda r: (kind_of(r) == "journal", r)):
            self._add(rel)
            try:
                self.vault.known[rel] = self.vault._stat(rel)
            except OSError:
                pass
        self.db.commit()

    def sync(self):
        """Pick up files changed outside Lattice. Returns the changed and removed paths."""
        changed, removed = self.vault.scan()
        if any(kind_of(r) == "journal" and r in removed for r in removed) or \
                any(kind_of(r) == "journal" and self.one("SELECT 1 FROM files WHERE path=?", (r,)) for r in changed):
            # The journal only grows; an outside edit to an existing day file is rare enough to re-read everything.
            self.rebuild()
            return changed, removed
        for rel in removed + changed:
            self._drop(rel)
        for rel in changed:
            self._add(rel)
        self.db.commit()
        return changed, removed

    def reindex(self, rel):
        self._drop(rel)
        if self.vault.path(rel).is_file():
            self._add(rel)
        self.db.commit()

    def unindex(self, rel):
        self._drop(rel)
        self.db.commit()

    def _add(self, rel):
        kind = kind_of(rel)
        try:
            getattr(self, "_index_" + kind, self._index_file)(rel)
        except Exception as exc:  # one unreadable file must not hide the rest
            self.problems.append(f"{rel}: {exc}"[:300])
            self._index_file(rel)

    def _drop(self, rel):
        row = self.one("SELECT id, kind FROM files WHERE path=?", (rel,))
        self.db.execute("DELETE FROM files WHERE path=?", (rel,))
        if not row or not row["id"]:
            return
        ident, kind = row["id"], row["kind"]
        if kind == "thread":
            self.db.execute("DELETE FROM messages WHERE thread=?", (ident,))
            self.db.execute("DELETE FROM threads WHERE id=?", (ident,))
        elif kind == "annotation":
            self.db.execute("DELETE FROM annotations WHERE path=?", (rel,))
        elif kind != "journal":
            # Another path may carry the same id (a copy); only drop rows that came from this one.
            if self.one("SELECT 1 FROM docs WHERE id=? AND path=?", (ident, rel)):
                self.db.execute("DELETE FROM docs WHERE id=?", (ident,))
                self.db.execute("DELETE FROM links WHERE source=?", (ident,))

    def locate(self, ident):
        row = self.one("SELECT path FROM files WHERE id=?", (ident,))
        return row["path"] if row else None

    # ---- indexers ------------------------------------------------------------------------
    def _index_file(self, rel):
        self.db.execute("INSERT OR REPLACE INTO files VALUES(?,?,?)", (rel, None, "file"))

    def adopt(self, rel, kind, attrs, body):
        """A Markdown file made outside Lattice gets an id written into it once, so links stay stable."""
        if attrs.get("id"):
            return attrs
        attrs = {"id": uid(), "kind": kind, "title": attrs.get("title") or Path(rel).stem, **attrs,
                 "created": stamp_of(attrs.get("created"))}
        attrs["id"] = attrs["id"] or uid()
        self.vault.write_md(rel, attrs, body)
        return attrs

    def _doc_row(self, rel, kind, attrs, body):
        ident = str(attrs["id"])
        created = stamp_of(attrs.get("created"))
        title = str(attrs.get("title") or Path(rel).stem)
        topic = attrs.get("topic")
        self.db.execute("INSERT OR REPLACE INTO docs VALUES(?,?,?,?,?,?,?,?,?)",
                        (ident, rel, kind, title, str(topic) if topic else None, dump(attrs), body, created, stamp_of(attrs.get("updated"), created)))
        self.db.execute("INSERT OR REPLACE INTO files VALUES(?,?,?)", (rel, ident, kind))
        return ident

    def _index_md(self, rel, kind):
        attrs, body = self.vault.read_md(rel)
        attrs = self.adopt(rel, kind, attrs, body)
        ident = self._doc_row(rel, kind, attrs, body)
        for link in attrs.get("links") or []:
            if isinstance(link, dict) and link.get("to"):
                self.db.execute("INSERT OR REPLACE INTO links VALUES(?,?,?,?,?,?)",
                                (str(link.get("id") or uid()), ident, str(link["to"]), str(link.get("as") or "related"),
                                 str(link.get("why") or ""), stamp_of(link.get("created"))))

    def _index_topic(self, rel):
        self._index_md(rel, "topic")

    def _index_card(self, rel):
        self._index_md(rel, "card")

    def _index_lesson(self, rel):
        self._index_md(rel, "lesson")

    def _index_note(self, rel):
        self._index_md(rel, "note")

    def _index_insight(self, rel):
        self._index_md(rel, "insight")

    def _index_notebook(self, rel):
        nb = self.vault.read_json(rel)
        meta = nb.setdefault("metadata", {}).setdefault("lattice", {})
        if not meta.get("id"):
            meta.update(id=uid(), title=meta.get("title") or Path(rel).stem, created=now())
            self.vault.write_json(rel, nb)
        text = "\n\n".join("".join(c.get("source", "")) if isinstance(c.get("source"), list) else str(c.get("source", ""))
                           for c in nb.get("cells") or [])
        self._doc_row(rel, "notebook", {**meta, "title": meta.get("title") or Path(rel).stem}, text)

    def _index_thread(self, rel):
        lines = self.vault.read_lines(rel)
        if not lines or lines[0].get("kind") != "thread":
            return self._index_file(rel)
        head, messages = lines[0], lines[1:]
        updated = messages[-1]["at"] if messages else head["created"]
        self.db.execute("INSERT OR REPLACE INTO threads VALUES(?,?,?,?,?,?,?,?)",
                        (head["id"], rel, head.get("agent", "tutor"), head.get("title", ""), head.get("topic"), dump(head), head["created"], updated))
        self.db.executemany("INSERT OR REPLACE INTO messages VALUES(?,?,?,?,?,?)",
                            [(m["id"], head["id"], m["role"], m["content"], dump(m.get("meta") or {}), m["at"]) for m in messages if "id" in m])
        self.db.execute("INSERT OR REPLACE INTO files VALUES(?,?,?)", (rel, head["id"], "thread"))

    def _index_annotation(self, rel):
        data = self.vault.read_json(rel)
        self.db.execute("INSERT OR REPLACE INTO files VALUES(?,?,?)", (rel, rel, "annotation"))
        for item in data.get("items") or []:
            anchor = dict(item.get("anchor") or {})
            quoted = str(anchor.pop("text", ""))
            self.db.execute("INSERT OR REPLACE INTO annotations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                            (str(item["id"]), rel, str(data["source"]), str(item.get("by") or "me"), str(item.get("color") or "yellow"), str(item.get("note") or ""),
                             quoted, str(anchor.get("label") or ""), dump(anchor), stamp_of(item.get("created")), stamp_of(item.get("updated"), stamp_of(item.get("created"))),
                             dump(item["ask"]) if item.get("ask") else ""))

    def _index_journal(self, rel):
        self.db.execute("INSERT OR REPLACE INTO files VALUES(?,?,?)", (rel, rel, "journal"))
        for entry in self.vault.read_lines(rel):
            if entry.get("id") and entry.get("type"):
                self.add_entry(entry)

    def add_entry(self, entry):
        self.db.execute("INSERT OR REPLACE INTO journal VALUES(?,?,?,?,?,?)",
                        (entry["id"], entry["at"], entry.get("actor", "app"), entry["type"], dump(entry.get("refs") or []), dump(entry.get("data") or {})))
