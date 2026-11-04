"""The bridge: files."""
from __future__ import annotations

from ..i18n import tr

import time
from ..model import text
from ..runner import runner_for
from ..vault import APPEND_ONLY, VaultError, kind_of, split_frontmatter

from .common import IMAGE_EXT


class FilesPart:
    # ---- files -------------------------------------------------------------------------------------
    def rpc_file_map(self):
        return self.lattice.file_map()

    def rpc_file_read(self, path):
        l = self.lattice
        absolute, rel = l.resolve(path)
        if absolute.is_dir():
            return {"path": rel or str(absolute), "dir": True, "entries": l.tree(rel or str(absolute))}
        if not absolute.exists():
            raise ValueError(tr("文件不存在：") + str(path))
        ext = absolute.suffix
        result = {"path": rel or str(absolute), "name": absolute.name, "ext": ext, "kind": kind_of(rel) if rel else "file",
                  "readonly": rel is None or rel.startswith(APPEND_ONLY) or rel.startswith(".lattice/"), "mtime": str(absolute.stat().st_mtime_ns),
                  "size": absolute.stat().st_size, "external": rel is None}
        if ext.lower() in IMAGE_EXT:
            import base64
            if absolute.stat().st_size > 12_000_000:
                return {**result, "binary": True}
            return {**result, "image": "data:" + IMAGE_EXT[ext.lower()] + ";base64," + base64.b64encode(absolute.read_bytes()).decode()}
        if result["kind"] == "notebook":
            nb = l.notebook(rel or str(absolute))
            return {**result, "notebook": nb, "kernel": self.kernel_states.get(nb["id"], {"state": "offline"}),
                    "mode": self._kernel_mode(rel) if rel else "mine", "env": self.envs.name_for(absolute),
                    "gpu": self._kernel_gpu(rel), "gpu_ready": self.gpu_ready()}
        got = l.read_file(rel or str(absolute))
        result.update({k: got[k] for k in ("content", "binary", "truncated") if k in got})
        if result["kind"] == "card":
            result["card"] = l.card(l.index.one("SELECT id FROM files WHERE path=?", (rel,))["id"])
        elif result["kind"] in ("topic", "lesson", "note", "insight"):
            row = l.index.one("SELECT id FROM files WHERE path=?", (rel,))
            if row and row["id"]:
                result["doc"] = l.doc(row["id"])
                if result["kind"] == "topic":
                    result["topic"] = l.topic(row["id"])
                    result["practices"] = l.practices(row["id"])
                    result["insights"] = l.insights(row["id"])
                    result["inside"] = l.index.rows("SELECT id, kind, title, path FROM docs WHERE topic=? ORDER BY kind, updated DESC", (row["id"],))
                result["links"] = l.links_of(row["id"])
        runnable = runner_for(absolute, self.config.read()["runners"])
        result["runnable"] = bool(runnable)
        if runnable and "{python}" in runnable:
            result["env"] = self.envs.name_for(absolute)
        return result

    def rpc_file_write(self, path, content, mtime=None):
        self.last_write = time.monotonic()
        _, rel = self.lattice.resolve(path)
        if rel and kind_of(rel) in ("topic", "card", "lesson", "note", "insight"):
            # The learner may write any text; a file Lattice knows keeps its id so links stay whole.
            attrs, _ = split_frontmatter(content)
            old = self.lattice.index.one("SELECT id FROM files WHERE path=?", (rel,))
            if old and old["id"] and attrs.get("id") not in (None, old["id"]):
                raise ValueError(tr("请不要改文件开头的 id，它让别处的引用保持有效"))
        result = self.lattice.write_file(path, content, mtime)
        if rel:
            self.edits[rel] = time.monotonic()
        return result

    def rpc_doc_save(self, path, mtime=None, **fields):
        """The learner's edits to a document's form: its body and the attributes that kind has."""
        l = self.lattice
        self.last_write = time.monotonic()
        _, rel = l.resolve(path)
        if mtime is not None and l.vault.mtime(rel) != str(mtime):
            raise VaultError("conflict")
        kind = kind_of(rel)
        ident = l.index.one("SELECT id FROM files WHERE path=?", (rel,))["id"]
        current = l.doc(ident)
        renamed = "title" in fields and str(fields["title"]).strip() and str(fields["title"]).strip() != current["title"]
        if kind == "card":
            card = l.card(ident)
            l.card_save({"id": ident, "title": fields.get("title", card["title"]), "body": fields.get("body", card["body"]),
                         "question": fields.get("question", card["question"]), "tags": fields.get("tags", card["tags"]),
                         **{k: fields[k] for k in ("type", "area") if k in fields}}, "me")
        elif kind == "topic":
            change = {k: fields[k] for k in ("title", "question", "state") if k in fields}
            if "body" in fields:
                change["notes"] = fields["body"]
            l.topic_save({"id": ident, **change})
        elif kind == "lesson":
            l.lesson_save({"id": ident, **{k: fields[k] for k in ("title", "objective", "state", "body") if k in fields}})
        else:
            def change(a, b):
                if "title" in fields:
                    a["title"] = fields["title"].strip() or a.get("title") or "未命名"
                if "tags" in fields:
                    a["tags"] = [str(t)[:40] for t in fields["tags"]][:20]
                return a, text(fields["body"]) if "body" in fields else b
            l._edit_doc(ident, change)
        new = l.index.locate(ident) or rel
        self.edits[new] = time.monotonic()
        title = l.doc(ident)["title"] if l.index.locate(ident) else current["title"]
        # Renaming keeps every [[link]] to it working.
        relinked = l.relink(current["title"], title) if renamed else []
        if relinked:
            # Other notes were rewritten: open windows showing them reload.
            self.changed(relinked)
        return {"path": new, "mtime": l.vault.mtime(new), "title": title, "relinked": len(relinked)}

    def rpc_file_create(self, folder="code", name="未命名.py", content=""):
        rel = self.lattice.create_file(folder, name, content)
        self.last_write = time.monotonic()
        return {"path": rel}

    def rpc_doc_create(self, kind, title, topic=None, body="", folder=None):
        l = self.lattice
        if kind == "topic":
            return {"path": l.topic_save({"title": title, "question": body})["path"]}
        if kind == "card":
            return {"path": l.card_save({"title": title, "topic": topic, "body": body})["path"]}
        if kind == "lesson":
            return {"path": l.lesson_save({"title": title, "topic": topic, "body": body})["path"]}
        if kind == "note":
            return {"path": l.note_create(title, body, "随手记" if folder is None else folder, (), "me", topic)}
        if kind == "notebook":
            return {"path": l.notebook_create(title, topic)}
        raise ValueError(tr("不知道怎么新建这种文档"))

    def rpc_file_rename(self, path, name):
        return {"path": self.lattice.rename_file(path, name)}

    def rpc_move(self, path, folder):
        self.last_write = time.monotonic()
        return {"path": self.lattice.move_into(path, folder)}

    def rpc_folder_create(self, parent, name):
        return {"path": self.lattice.folder_create(parent, name)}

    def rpc_folder_rename(self, path, name):
        self.last_write = time.monotonic()
        return {"path": self.lattice.folder_rename(path, name)}

    def rpc_note_links(self, path):
        _, rel = self.lattice.resolve(path)
        row = self.lattice.index.one("SELECT id FROM files WHERE path=?", (rel,)) if rel else None
        if not row or not row["id"]:
            return {"title": "", "backlinks": [], "unlinked": [], "outgoing": []}
        return self.lattice.note_links(row["id"])
