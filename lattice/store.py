"""Notes, conversations, events and mounted folders, stored as files in the vault.

The SQLite database is only an index of the vault: every table here is filled
from files and can be dropped and rebuilt. Kinds register an indexer; the
learning model adds its own on top of the ones defined here.
"""
from __future__ import annotations

from datetime import datetime
import json
import os
from pathlib import Path
import re
import sqlite3
import uuid

from .vault import KIND_OF_FOLDER, Vault, VAULT_PATH, now as vault_now, split_frontmatter

DATA_HOME = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
# Machine-local state that is not learning data: logs, web profile, the pre-vault database.
APP_HOME = DATA_HOME / "lattice"
LEGACY_DB = APP_HOME / "lattice.db"


def stamp():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def identifier():
    return uuid.uuid4().hex[:16]


def records(cursor):
    return [dict(r) for r in cursor.fetchall()]


def words(body: str):
    return list(dict.fromkeys(re.findall(r"\[\[([^\]]+)\]\]", body or "")))


def journal_path(at):
    day = at[:10]
    return f"journal/{day[:4]}/{day}.jsonl"


class Store:
    def __init__(self, root: Path | str = VAULT_PATH):
        self.vault = Vault(root)
        self.root = self.vault.root
        self.path = self.root / ".lattice" / "index.db"
        self.db = sqlite3.connect(str(self.path))
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=3000")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, id TEXT, kind TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS files_id ON files(id);
        CREATE TABLE IF NOT EXISTS notes(
          id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
          folder TEXT NOT NULL DEFAULT 'Knowledge', tags TEXT NOT NULL DEFAULT '[]',
          pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events(
          id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
          title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', target TEXT DEFAULT '', at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(
          id TEXT PRIMARY KEY, agent TEXT NOT NULL, title TEXT NOT NULL,
          project_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS messages(
          id INTEGER PRIMARY KEY, session_id TEXT NOT NULL,
          role TEXT NOT NULL, content TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_events_time ON events(id DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id,id);
        """)
        self.db.commit()
        # kind -> function(rel, unindex=False); journal entry type -> function(entry)
        self.indexers = {"note": self._index_note, "thread": self._index_thread, "journal": self._index_journal}
        self.journal_indexers = {"event": self._index_event}
        self.index_tables = ["files", "notes", "events", "sessions", "messages"]
        self.settings_path = self.root / ".lattice" / "settings.json"

    # ---- index ------------------------------------------------------------------------
    def kind_of(self, rel):
        return KIND_OF_FOLDER.get(rel.split("/", 1)[0])

    def reindex(self, rel):
        kind = self.kind_of(rel)
        indexer = self.indexers.get(kind)
        if not indexer:
            return
        self._unindex(rel)
        if self.vault.path(rel).exists():
            indexer(rel)
        self.db.commit()

    def _unindex(self, rel):
        row = self.db.execute("SELECT id, kind FROM files WHERE path=?", (rel,)).fetchone()
        if row:
            self.indexers[row["kind"]](rel, unindex=row["id"])
        self.db.execute("DELETE FROM files WHERE path=?", (rel,))

    def unindex(self, rel):
        self._unindex(rel)
        self.db.commit()

    def adopt(self, rel, kind, attrs, body):
        """A Markdown file made outside Lattice gets an id and a kind written into it once, so links stay stable."""
        if attrs.get("id"):
            return attrs
        attrs = {"id": identifier(), "kind": kind, "title": attrs.get("title") or Path(rel).stem, **attrs,
                 "created": attrs.get("created") or stamp()}
        attrs["id"] = attrs["id"] or identifier()
        self.vault.write_md(rel, attrs, body)
        return attrs

    def register(self, rel, ident, kind):
        self.db.execute("INSERT OR REPLACE INTO files VALUES(?,?,?)", (rel, ident, kind))

    def locate(self, ident, kind=None):
        row = self.db.execute("SELECT path FROM files WHERE id=?" + (" AND kind=?" if kind else ""),
                              (ident, kind) if kind else (ident,)).fetchone()
        return row[0] if row else None

    def rebuild(self):
        """Throw the index away and read every file again."""
        for table in self.index_tables:
            self.db.execute("DELETE FROM " + table)
        self.vault.known.clear()
        # Topics first so everything that points at them resolves; journal last, in order.
        order = {"topic": 0, "thread": 1, "journal": 9}
        for rel in sorted(self.vault.files(), key=lambda r: (order.get(self.kind_of(r), 5), r)):
            kind = self.kind_of(rel)
            if kind in self.indexers:
                try:
                    self.indexers[kind](rel)
                except Exception as exc:  # one unreadable file must not hide the rest
                    self.db.execute("INSERT INTO events(kind,title,detail,target,at) VALUES(?,?,?,?,?)",
                                    ("index", "读不了这个文件", f"{rel}: {exc}"[:500], rel, stamp()))
            self.vault.known[rel] = self.vault._stat(rel)
        self.db.commit()

    def sync(self):
        """Pick up files changed outside Lattice. Returns whether anything changed."""
        changed, removed = self.vault.scan()
        if any(self.kind_of(r) == "journal" for r in changed + removed):
            # The journal is append-only; an outside edit to it is rare enough to re-read everything.
            self.rebuild()
            return True
        for rel in removed:
            self._unindex(rel)
        for rel in changed:
            self._unindex(rel)
            kind = self.kind_of(rel)
            if kind in self.indexers:
                try:
                    self.indexers[kind](rel)
                except Exception:
                    pass
        self.db.commit()
        return bool(changed or removed)

    # ---- settings (machine-local, not learning data) --------------------------------------
    def settings(self):
        try:
            return json.loads(self.settings_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def setting(self, key, default=None):
        return self.settings().get(key, default)

    def set_setting(self, key, value):
        data = self.settings()
        data[key] = value
        tmp = self.settings_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.settings_path)
        return value

    # ---- journal ------------------------------------------------------------------------
    def record(self, kind, data, actor="app", refs=()):
        """Append one entry to the learning journal and index it."""
        entry = {"id": identifier(), "at": vault_now(), "actor": actor, "type": kind, "refs": list(refs), "data": data}
        self.vault.append_line(journal_path(entry["at"]), entry)
        indexer = self.journal_indexers.get(kind)
        if indexer:
            indexer(entry)
        self.db.commit()
        return entry

    def _index_journal(self, rel, unindex=None):
        if unindex is not None:
            # Journal files only grow; re-reading one re-adds entries we may already hold.
            return
        self.register(rel, rel, "journal")
        for entry in self.vault.read_lines(rel):
            indexer = self.journal_indexers.get(entry.get("type"))
            if indexer:
                indexer(entry)

    def emit(self, kind, title, detail="", target=""):
        self.record("event", {"kind": kind, "title": title, "detail": detail, "target": target})

    def _index_event(self, entry):
        d = entry["data"]
        self.db.execute("INSERT INTO events(kind,title,detail,target,at) VALUES(?,?,?,?,?)",
                        (d.get("kind", ""), d.get("title", ""), d.get("detail", ""), d.get("target", ""), entry["at"]))

    # ---- notes ---------------------------------------------------------------------------
    def _index_note(self, rel, unindex=None):
        if unindex is not None:
            self.db.execute("DELETE FROM notes WHERE id=?", (unindex,))
            return
        attrs, body = self.vault.read_md(rel)
        attrs = self.adopt(rel, "note", attrs, body)
        ident = str(attrs["id"])
        folder = "/".join(rel.split("/")[1:-1]) or "Knowledge"
        t = str(attrs.get("created") or stamp())
        self.db.execute("INSERT OR REPLACE INTO notes VALUES(?,?,?,?,?,?,?,?)",
                        (ident, str(attrs.get("title") or Path(rel).stem), body, folder,
                         json.dumps([str(x) for x in attrs.get("tags") or []], ensure_ascii=False),
                         int(bool(attrs.get("pinned"))), t, str(attrs.get("updated") or t)))
        self.register(rel, ident, "note")

    def get_note(self, note_id):
        row = self.db.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
        return self._note(row) if row else None

    def _note(self, row):
        d = dict(row)
        d["tags"] = json.loads(d["tags"])
        d["pinned"] = bool(d["pinned"])
        return d

    def list_notes(self, query="", folder="", limit=300):
        condition = " WHERE 1=1 "
        params = []
        if query:
            condition += " AND (title LIKE ? OR body LIKE ? OR tags LIKE ?)"
            params += [f"%{query}%"] * 3
        if folder and folder != "All":
            condition += " AND folder=?"
            params.append(folder)
        params.append(min(max(int(limit), 1), 1000))
        return [self._note(row) for row in self.db.execute(
            "SELECT * FROM notes" + condition + " ORDER BY pinned DESC,updated_at DESC LIMIT ?", params
        ).fetchall()]

    def save_note(self, data):
        note_id = data.get("id") or identifier()
        title = str(data.get("title") or "无标题").strip()[:180]
        body = str(data.get("body") or "")
        folder = re.sub(r"[\\:*?\"<>|]", " ", str(data.get("folder") or "Knowledge")).strip(" /")[:80] or "Knowledge"
        tags = list(dict.fromkeys([str(x)[:40] for x in data.get("tags", [])]))[:20]
        old = self.get_note(note_id)
        current = self.locate(note_id, "note")
        if old and current and title == old["title"] and body == old["body"] and folder == old["folder"] \
                and tags == old["tags"] and bool(data.get("pinned", old["pinned"])) == old["pinned"]:
            return old
        attrs = self.vault.read_md(current)[0] if current else {}
        attrs.update(id=note_id, kind="note", title=title, tags=tags, pinned=bool(data.get("pinned", attrs.get("pinned", False))),
                     created=attrs.get("created") or stamp(), updated=stamp())
        rel = self.vault.unique(f"notes/{folder}", title, ".md", current if current and current.startswith(f"notes/{folder}/") else None)
        if current and current != rel:
            self.vault.move(current, rel)
            self.unindex(current)
        self.vault.write_md(rel, attrs, body)
        self.reindex(rel)
        self.emit("note", ("修订 · " if old else "新笔记 · ") + title, folder, note_id)
        return self.get_note(note_id)

    def delete_note(self, note_id):
        old = self.get_note(note_id)
        rel = self.locate(note_id, "note")
        if not old or not rel:
            return False
        self.vault.remove(rel)
        self.unindex(rel)
        self.emit("note", f"删除笔记 · {old['title']}")
        return True

    def revisions(self, note_id):
        """Earlier committed versions of a note, from the vault's git history."""
        current = self.get_note(note_id)
        if not current:
            return []
        out = []
        versions = self.vault.history(note_id, "notes")
        for v in versions:
            try:
                attrs, body = split_frontmatter(self.vault.show(v["commit"], v["path"]))
            except Exception:
                continue
            if not out and v is versions[0] and (attrs.get("title"), body.rstrip()) == (current["title"], current["body"].rstrip()):
                continue  # the latest commit is the version on disk now, not history
            out.append({"id": v["commit"], "note_id": note_id, "title": attrs.get("title", ""), "body": body.rstrip(), "created_at": v["at"]})
        return out

    def restore(self, note_id, rev_id):
        old = next((r for r in self.revisions(note_id) if r["id"] == rev_id), None)
        if not old:
            return None
        current = self.get_note(note_id)
        return self.save_note({**current, "title": old["title"], "body": old["body"]})

    def graph(self):
        ns = self.list_notes(limit=1000)
        by_title = {n["title"].casefold(): n["id"] for n in ns}
        edges = set()
        for n in ns:
            for linked in words(n["body"]):
                match = by_title.get(linked.casefold())
                if match and match != n["id"]:
                    edges.add((n["id"], match))
        nodes = [{"id": n["id"], "title": n["title"], "folder": n["folder"], "degree": 0} for n in ns]
        counts = {}
        for a, b in edges:
            counts[a] = counts.get(a, 0) + 1
            counts[b] = counts.get(b, 0) + 1
        for n in nodes:
            n["degree"] = counts.get(n["id"], 0)
        return {"nodes": nodes, "edges": [{"source": a, "target": b} for a, b in sorted(edges)]}

    def backlinks(self, note_id):
        n = self.get_note(note_id)
        if not n:
            return []
        title = n["title"].casefold()
        return [{"id": x["id"], "title": x["title"]} for x in self.list_notes(limit=1000)
                if x["id"] != note_id and title in [w.casefold() for w in words(x["body"])]]

    # ---- mounted folders (machine-local paths, so they live in settings) --------------------
    def add_project(self, name, path):
        p = Path(path).expanduser().resolve()
        if not p.is_dir():
            raise ValueError(f"目录不存在：{p}")
        projects = self.projects()
        existing = next((x for x in projects if x["path"] == str(p)), None)
        if existing:
            return existing
        project = {"id": identifier(), "name": str(name)[:120], "path": str(p), "created_at": stamp()}
        self.set_setting("projects", projects + [project])
        self.emit("project", f"连接工作区 · {name}", str(p), project["id"])
        return project

    def projects(self):
        return self.setting("projects", [])

    def project(self, ident):
        return next((p for p in self.projects() if p["id"] == ident), None)

    def remove_project(self, ident):
        p = self.project(ident)
        if p:
            self.set_setting("projects", [x for x in self.projects() if x["id"] != ident])
            self.emit("project", f"移除工作区引用 · {p['name']}")
        return bool(p)

    def _safe_path(self, project_id, relative):
        p = self.project(project_id)
        if not p:
            raise ValueError("未找到工作区")
        root = Path(p["path"]).resolve()
        resolved = (root / str(relative)).resolve()
        if not resolved.is_relative_to(root):
            raise ValueError("禁止访问工作区之外的路径")
        return resolved, root

    def project_files(self, project_id, relative=""):
        target, root = self._safe_path(project_id, relative)
        if not target.is_dir():
            return []
        skipped = {".git", "node_modules", ".venv", "venv", "dist", "build", ".next", "__pycache__", ".cache"}
        found = []
        for p in sorted(target.iterdir(), key=lambda x: (not x.is_dir(), x.name.casefold())):
            if p.name in skipped or p.name.startswith(".env"):
                continue
            # Never traverse symlinks outside the chosen project.
            if p.is_symlink():
                continue
            found.append({"name": p.name, "path": p.relative_to(root).as_posix(), "type": "dir" if p.is_dir() else "file"})
            if len(found) >= 180:
                break
        return found

    def file_read(self, project_id, relative):
        path, _ = self._safe_path(project_id, relative)
        if not path.is_file() or path.stat().st_size > 1024 * 1024:
            raise ValueError("只能打开不超过 1MB 的普通文本文件")
        if path.name.startswith(".env"):
            raise ValueError("为避免泄露凭据，不能在此预览环境密钥文件")
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            raise ValueError("二进制文件无法在文本编辑器中打开")
        return {"content": content, "path": str(path)}

    def file_write(self, project_id, relative, content):
        path, _ = self._safe_path(project_id, relative)
        if not path.is_file() or not os.access(path, os.W_OK):
            raise ValueError("只能修改已存在且可写的文本文件")
        if path.name.startswith(".env"):
            raise ValueError("不编辑环境密钥文件")
        if len(content) > 1024 * 1024:
            raise ValueError("文件超过 1MB")
        try:
            previous = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            raise ValueError("二进制文件无法在文本编辑器中打开")
        if previous != content:
            # Keep a safety copy alongside the application's local data, not beside user code.
            backup_dir = APP_HOME / "file-backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            (backup_dir / f"{path.name}.{identifier()}.bak").write_text(previous, encoding="utf-8")
            # Retention: unbounded .bak growth would silently fill the disk.
            backups = sorted(backup_dir.glob("*.bak"), key=lambda p: p.stat().st_mtime)
            for stale in backups[:-200]:
                stale.unlink(missing_ok=True)
            path.write_text(content, encoding="utf-8")
            self.emit("file", f"编辑文件 · {path.name}", str(path))
        return True

    # ---- conversations: one JSON-lines file per thread, header first --------------------------
    def _thread_rel(self, ident, created):
        return f"threads/{created[:7]}/{ident}.jsonl"

    def _index_thread(self, rel, unindex=None):
        if unindex is not None:
            self.db.execute("DELETE FROM messages WHERE session_id=?", (unindex,))
            self.db.execute("DELETE FROM sessions WHERE id=?", (unindex,))
            for hook in self.thread_hooks:
                hook(None, unindex)
            return
        lines = self.vault.read_lines(rel)
        if not lines or lines[0].get("kind") != "thread":
            return
        head, messages = lines[0], lines[1:]
        updated = messages[-1]["at"] if messages else head["created"]
        self.db.execute("INSERT OR REPLACE INTO sessions VALUES(?,?,?,?,?,?)",
                        (head["id"], head.get("agent", "api"), head.get("title", ""), head.get("project_id"), head["created"], updated))
        self.db.executemany("INSERT OR REPLACE INTO messages VALUES(?,?,?,?,?,?)",
                            [(m["id"], head["id"], m["role"], m["content"], json.dumps(m.get("meta") or {}, ensure_ascii=False), m["at"])
                             for m in messages])
        self.register(rel, head["id"], "thread")
        for hook in self.thread_hooks:
            hook(head, head["id"])

    thread_hooks = ()

    def new_session(self, agent, project_id=None, title=None, attrs=None):
        ident = identifier()
        t = stamp()
        head = {"id": ident, "kind": "thread", "agent": agent, "title": title or ("与 " + agent + " 探索"),
                "project_id": project_id, "created": t, **(attrs or {})}
        rel = self._thread_rel(ident, t)
        self.vault.write_lines(rel, [head])
        self.reindex(rel)
        self.emit("agent", f"开启会话 · {head['title']}", agent, ident)
        return self.session(ident)

    def session(self, ident):
        row = self.db.execute("SELECT * FROM sessions WHERE id=?", (ident,)).fetchone()
        return dict(row) if row else None

    def thread_head(self, ident):
        rel = self.locate(ident, "thread")
        if not rel:
            raise ValueError("会话不存在")
        return self.vault.read_lines(rel)[0]

    def update_thread(self, ident, **attrs):
        """Change a conversation's header attributes (title, practice state…)."""
        rel = self.locate(ident, "thread")
        lines = self.vault.read_lines(rel)
        lines[0].update(attrs)
        self.vault.write_lines(rel, lines)
        self.reindex(rel)
        return lines[0]

    def append_message(self, session_id, role, content, meta=None):
        rel = self.locate(session_id, "thread")
        if not rel:
            raise ValueError("会话不存在")
        ident = (self.db.execute("SELECT MAX(id) FROM messages").fetchone()[0] or 0) + 1
        message = {"id": ident, "role": role, "content": content, "meta": meta or {}, "at": stamp()}
        self.vault.append_line(rel, message)
        self.db.execute("INSERT INTO messages VALUES(?,?,?,?,?,?)",
                        (ident, session_id, role, content, json.dumps(meta or {}, ensure_ascii=False), message["at"]))
        self.db.execute("UPDATE sessions SET updated_at=? WHERE id=?", (message["at"], session_id))
        self.db.commit()
        return ident

    def move_messages(self, ids, target):
        """Move some messages into another conversation, keeping their ids and times."""
        ids = {int(i) for i in ids}
        moved = []
        for rel in {r[0] for r in self.db.execute(
                f"SELECT f.path FROM messages m JOIN files f ON f.id=m.session_id AND f.kind='thread' WHERE m.id IN ({','.join('?' * len(ids))})", tuple(ids))}:
            lines = self.vault.read_lines(rel)
            moved += [m for m in lines[1:] if m.get("id") in ids]
            self.vault.write_lines(rel, [lines[0]] + [m for m in lines[1:] if m.get("id") not in ids])
            self.reindex(rel)
        if moved:
            rel = self.locate(target, "thread")
            lines = self.vault.read_lines(rel)
            self.vault.write_lines(rel, [lines[0]] + sorted(lines[1:] + moved, key=lambda m: m["id"]))
            self.reindex(rel)
        return len(moved)

    def messages(self, session_id):
        rows = records(self.db.execute(
            "SELECT * FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 1500", (session_id,)))
        rows.reverse()
        return rows

    def export_markdown(self, dest):
        target = Path(dest).expanduser().resolve()
        if target.exists() and not target.is_dir():
            raise ValueError("导出目标不是文件夹")
        target.mkdir(parents=True, exist_ok=True)
        count = 0
        for n in self.list_notes(limit=1000):
            folder = target / re.sub(r"[^\w\-一-鿿]", "_", n["folder"])
            folder.mkdir(exist_ok=True)
            safe_title = re.sub(r"[\\/:*?\"<>|]", "_", n["title"]).strip()[:120]
            path = folder / f"{safe_title}-{n['id'][:6]}.md"
            path.write_text(n["body"], encoding="utf-8")
            count += 1
        self.emit("export", f"导出 {count} 篇笔记", str(target))
        return {"count": count, "path": str(target)}

    def close(self):
        self.vault.commit("我的编辑", "me")
        self.db.close()
