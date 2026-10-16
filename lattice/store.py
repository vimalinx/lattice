"""Lattice local-first SQLite model: notes, revisions, mounted folders and AI sessions."""
from __future__ import annotations

from datetime import datetime
import json
import os
from pathlib import Path
import re
import sqlite3
import uuid

DATA_HOME = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
APP_HOME = DATA_HOME / "lattice"
DB_PATH = APP_HOME / "lattice.db"


def stamp():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def identifier():
    return uuid.uuid4().hex[:16]


def records(cursor):
    return [dict(r) for r in cursor.fetchall()]


def words(body: str):
    return list(dict.fromkeys(re.findall(r"\[\[([^\]]+)\]\]", body or "")))


class Store:
    def __init__(self, path: Path | str = DB_PATH, seed: bool = True):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(self.path))
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=3000")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS notes(
          id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
          folder TEXT NOT NULL DEFAULT 'Knowledge', tags TEXT NOT NULL DEFAULT '[]',
          pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS revisions(
          id INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL,
          title TEXT, body TEXT, created_at TEXT NOT NULL,
          FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS events(
          id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
          title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
          target TEXT DEFAULT '', at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects(
          id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions(
          id TEXT PRIMARY KEY, agent TEXT NOT NULL, title TEXT NOT NULL,
          project_id TEXT, remote_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages(
          id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
          role TEXT NOT NULL, content TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_revision_note ON revisions(note_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_events_time ON events(id DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id,id);
        """)
        self.db.commit()
        if seed:
            self._seed()

    def _seed(self):
        if self.db.execute("SELECT count(*) FROM notes").fetchone()[0]:
            return
        self.save_note({
            "title": "从这里开始 · 一张可以生长的工作台",
            "folder": "Home", "tags": ["起点"],
            "body": """# 欢迎来到 Lattice

这是你的本地 AI 学习与创造工作台。这里连接**理解、实验、行动与历史**。

### 一种工作的节奏
从真实困惑出发，先形成直觉和可证伪的猜测，再在实验笔记里构造一个足够小的实验，把真实结果带回自己的理解里。

- **笔记**留住想法，而不是复制大段答案。
- **版本历史**让你比较从前的理解与现在的判断。
- **知识网络**由 `[[双向链接]]` 自动组织。

试试在笔记中输入 `[[Attention]]`，然后在「知识网络」里观察连接。

> 这些是示例内容，不代表你已经完成了相关学习。
""",
        })
        self.save_note({
            "title": "Attention", "folder": "Knowledge", "tags": ["Transformer", "待验证"],
            "body": """# Attention · 一个正在展开的问题

为什么序列模型需要一种**根据当前内容选择信息来源**的机制？

## 直觉
想象你在读「小猫趴在椅子上，因为它很舒服」。
当模型试着理解「它」时，哪些之前的词应该提供更多信息？

## 可验证的猜测
如果注意力权重均匀分配，模型还能利用不同上下文建立区别吗？

## 可动手的实验
用三组小向量计算 `QKᵀ / √d`，再经过 softmax；有意识地改变一组 Key。

## 关联
[[Transformer]] · [[从这里开始 · 一张可以生长的工作台]]

> 这是探索模板，等待实际实验结果。
""",
        })
        self.save_note({
            "title": "Transformer", "folder": "Knowledge", "tags": ["模型结构"],
            "body": """# Transformer

从序列中提取结构的信息处理架构。

## 我真正关心的问题
在语言建模中，为什么会有表示层、[[Attention]]、MLP、残差连接和输出投影？每一层分别解决什么问题？

## 等待实验
比较无注意力的极简模型与一个单头注意力模型的行为。

## 关联
[[Attention]]
""",
        })
        study = Path.home() / "Projects" / "StudyLab"
        if study.is_dir():
            self.add_project("StudyLab · 既有学习目录", str(study))

    def emit(self, kind, title, detail="", target=""):
        self.db.execute("INSERT INTO events(kind,title,detail,target,at) VALUES(?,?,?,?,?)",
                        (kind, title, detail, target, stamp()))
        self.db.commit()

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
        folder = str(data.get("folder") or "Knowledge").strip()[:80]
        tags = json.dumps(list(dict.fromkeys([str(x)[:40] for x in data.get("tags", [])]))[:20], ensure_ascii=False)
        pinned = int(bool(data.get("pinned", False)))
        old = self.db.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
        now = stamp()
        if old:
            if title == old["title"] and body == old["body"] and folder == old["folder"] and tags == old["tags"] and pinned == old["pinned"]:
                return self.get_note(note_id)
            # A new revision on explicit save; UI handles debounce and cadence.
            self.db.execute("INSERT INTO revisions(note_id,title,body,created_at) VALUES(?,?,?,?)",
                            (note_id, old["title"], old["body"], now))
            self.db.execute(
                "UPDATE notes SET title=?,body=?,folder=?,tags=?,pinned=?,updated_at=? WHERE id=?",
                (title, body, folder, tags, pinned, now, note_id),
            )
            self.db.commit()
            self.emit("note", f"修订 · {title}", f"{folder} · {len(body)} 字符", note_id)
        else:
            self.db.execute(
                "INSERT INTO notes(id,title,body,folder,tags,pinned,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                (note_id, title, body, folder, tags, pinned, now, now)
            )
            self.db.commit()
            self.emit("note", f"新笔记 · {title}", folder, note_id)
        return self.get_note(note_id)

    def delete_note(self, note_id):
        old = self.get_note(note_id)
        if not old:
            return False
        self.db.execute("DELETE FROM notes WHERE id=?", (note_id,))
        self.db.commit()
        self.emit("note", f"删除笔记 · {old['title']}")
        return True

    def revisions(self, note_id):
        return records(self.db.execute(
            "SELECT id,note_id,title,body,created_at FROM revisions WHERE note_id=? ORDER BY id DESC LIMIT 200",
            (note_id,)
        ))

    def restore(self, note_id, rev_id):
        old = self.db.execute("SELECT title,body FROM revisions WHERE id=? AND note_id=?",
                              (rev_id, note_id)).fetchone()
        if not old:
            return None
        current = self.get_note(note_id)
        return self.save_note({**current, "title":old["title"], "body":old["body"]})

    def graph(self):
        ns = self.list_notes(limit=1000)
        by_title = {n["title"].casefold(): n["id"] for n in ns}
        edges = set()
        for n in ns:
            for linked in words(n["body"]):
                match = by_title.get(linked.casefold())
                if match and match != n["id"]:
                    edges.add((n["id"], match))
        nodes = [{"id": n["id"], "title": n["title"], "folder":n["folder"], "degree":0} for n in ns]
        counts = {}
        for a,b in edges:
            counts[a] = counts.get(a,0)+1
            counts[b] = counts.get(b,0)+1
        for n in nodes:
            n["degree"] = counts.get(n["id"],0)
        return {"nodes":nodes,"edges":[{"source":a,"target":b} for a,b in sorted(edges)]}

    def backlinks(self, note_id):
        n = self.get_note(note_id)
        if not n:
            return []
        title = n["title"].casefold()
        return [{"id":x["id"],"title":x["title"]} for x in self.list_notes(limit=1000)
                if x["id"] != note_id and title in [w.casefold() for w in words(x["body"])]]

    def add_project(self, name, path):
        p = Path(path).expanduser().resolve()
        if not p.is_dir():
            raise ValueError(f"目录不存在：{p}")
        existing = self.db.execute("SELECT * FROM projects WHERE path=?", (str(p),)).fetchone()
        if existing:
            return dict(existing)
        ident = identifier()
        self.db.execute("INSERT INTO projects VALUES(?,?,?,?)",(ident,str(name)[:120],str(p),stamp()))
        self.db.commit()
        self.emit("project",f"连接工作区 · {name}",str(p),ident)
        return dict(self.db.execute("SELECT * FROM projects WHERE id=?",(ident,)).fetchone())

    def projects(self):
        return records(self.db.execute("SELECT * FROM projects ORDER BY created_at"))

    def project(self, ident):
        row=self.db.execute("SELECT * FROM projects WHERE id=?",(ident,)).fetchone()
        return dict(row) if row else None

    def remove_project(self, ident):
        p = self.project(ident)
        if p:
            self.db.execute("DELETE FROM projects WHERE id=?",(ident,))
            self.db.commit()
            self.emit("project",f"移除工作区引用 · {p['name']}")
        return bool(p)

    def _safe_path(self, project_id, relative):
        p = self.project(project_id)
        if not p:
            raise ValueError("未找到工作区")
        root = Path(p["path"]).resolve()
        resolved = (root / str(relative)).resolve()
        if not resolved.is_relative_to(root):
            raise ValueError("禁止访问工作区之外的路径")
        return resolved,root

    def project_files(self, project_id, relative=""):
        target,root = self._safe_path(project_id,relative)
        if not target.is_dir():
            return []
        skipped={".git","node_modules",".venv","venv","dist","build",".next","__pycache__",".cache"}
        found=[]
        for p in sorted(target.iterdir(),key=lambda x:(not x.is_dir(),x.name.casefold())):
            if p.name in skipped or p.name.startswith(".env"):
                continue
            # Never traverse symlinks outside the chosen project.
            if p.is_symlink():
                continue
            found.append({
                "name":p.name,"path":p.relative_to(root).as_posix(),
                "type":"dir" if p.is_dir() else "file"
            })
            if len(found)>=180:
                break
        return found

    def file_read(self, project_id, relative):
        path,_=self._safe_path(project_id,relative)
        if not path.is_file() or path.stat().st_size>1024*1024:
            raise ValueError("只能打开不超过 1MB 的普通文本文件")
        if path.name.startswith(".env"):
            raise ValueError("为避免泄露凭据，不能在此预览环境密钥文件")
        try:
            content=path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            raise ValueError("二进制文件无法在文本编辑器中打开")
        return {"content":content,"path":str(path)}

    def file_write(self, project_id, relative, content):
        path,_=self._safe_path(project_id,relative)
        if not path.is_file() or not os.access(path,os.W_OK):
            raise ValueError("只能修改已存在且可写的文本文件")
        if path.name.startswith(".env"):
            raise ValueError("不编辑环境密钥文件")
        if len(content)>1024*1024:
            raise ValueError("文件超过 1MB")
        try:
            previous=path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            raise ValueError("二进制文件无法在文本编辑器中打开")
        if previous != content:
            # Keep a safety copy alongside the application's local data, not beside user code.
            backup_dir=APP_HOME/"file-backups"
            backup_dir.mkdir(parents=True,exist_ok=True)
            (backup_dir/f"{path.name}.{identifier()}.bak").write_text(previous,encoding="utf-8")
            # Retention: unbounded .bak growth would silently fill the disk.
            backups=sorted(backup_dir.glob("*.bak"),key=lambda p:p.stat().st_mtime)
            for stale in backups[:-200]:
                stale.unlink(missing_ok=True)
            path.write_text(content,encoding="utf-8")
            self.emit("file", f"编辑文件 · {path.name}",str(path))
        return True

    def new_session(self, agent, project_id=None, title=None):
        ident=identifier()
        t=stamp()
        title=title or ("与 "+agent+" 探索")
        self.db.execute(
            "INSERT INTO sessions(id,agent,title,project_id,created_at,updated_at) VALUES(?,?,?,?,?,?)",
            (ident, agent,title,project_id,t,t))
        self.db.commit()
        self.emit("agent",f"开启会话 · {title}",agent,ident)
        return self.session(ident)

    def session(self, ident):
        row=self.db.execute("SELECT * FROM sessions WHERE id=?",(ident,)).fetchone()
        return dict(row) if row else None

    def set_remote_id(self, ident, remote_id):
        self.db.execute("UPDATE sessions SET remote_id=? WHERE id=?",(remote_id,ident))
        self.db.commit()

    def append_message(self, session_id, role, content, meta=None):
        t=stamp()
        self.db.execute("INSERT INTO messages(session_id,role,content,meta,created_at) VALUES(?,?,?,?,?)",
                        (session_id,role,content,json.dumps(meta or {},ensure_ascii=False),t))
        self.db.execute("UPDATE sessions SET updated_at=? WHERE id=?",(t,session_id))
        self.db.commit()
        return True

    def messages(self, session_id):
        rows = records(self.db.execute(
            "SELECT * FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 1500",(session_id,)))
        rows.reverse()
        return rows

    def export_markdown(self, dest):
        target=Path(dest).expanduser().resolve()
        if target.exists() and not target.is_dir():
            raise ValueError("导出目标不是文件夹")
        target.mkdir(parents=True,exist_ok=True)
        count=0
        for n in self.list_notes(limit=1000):
            folder=target/re.sub(r"[^\w\-\u4e00-\u9fff]","_",n["folder"])
            folder.mkdir(exist_ok=True)
            safe_title=re.sub(r"[\\/:*?\"<>|]","_",n["title"]).strip()[:120]
            path=folder/f"{safe_title}-{n['id'][:6]}.md"
            path.write_text(n["body"],encoding="utf-8")
            count+=1
        self.emit("export",f"导出 {count} 篇笔记",str(target))
        return {"count":count,"path":str(target)}

    def close(self):
        self.db.close()
