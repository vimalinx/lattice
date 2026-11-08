"""The bridge: annotations, cards and the map."""
from __future__ import annotations

from ..i18n import tr

from pathlib import Path
import time
from .. import annotations, books
from ..model import STAGES


class MarksPart:
    # ---- annotations ---------------------------------------------------------------------------------------------
    def rpc_annotations(self, source=None, query=None):
        return annotations.listing(self.lattice, source, query)

    def rpc_annotation_get(self, id):
        return annotations.get(self.lattice, id)

    def _annotated(self, result):
        self.lattice.vault.commit_only(annotations.FOLDER, "批注")
        self.announce({"type": "annotations"})
        return result

    def rpc_annotation_add(self, source, anchor, note="", color=None):
        return self._annotated(annotations.add(self.lattice, source, anchor, note, color))

    def rpc_annotation_update(self, id, note=None, color=None, at=None):
        return self._annotated(annotations.update(self.lattice, id, note, color, at))

    def rpc_annotation_delete(self, id):
        return self._annotated(annotations.remove(self.lattice, id))

    def rpc_annotation_card(self, id, title):
        """A card out of a highlight: the words and the learner's note, and a link back to where they stand."""
        l, item = self.lattice, annotations.get(self.lattice, id)
        quote = "\n".join("> " + line for line in item["text"].splitlines())
        said = item["note"]
        if item.get("ask"):
            got = annotations.asked(l, id)
            said = tr("**问**：") + got["question"] + tr("\n\n**答**：") + got["answer"]
        card = l.card_save({"title": title, "body": quote + ("\n\n" + said if said else ""), "topic": l.active_topic()})
        l.link(card["id"], "ann:" + item["id"], "explains", item["label"])
        self.last_write = time.monotonic()
        self.changed([card["path"]])
        return {"id": card["id"], "path": card["path"]}

    def rpc_annotation_unmount(self, id, also=()):
        return self._annotated(annotations.unmount(self.lattice, id, also))

    def rpc_annotation_asked(self, id, also=()):
        got = annotations.asked(self.lattice, id, also)
        return {**got, "answering": got.get("thread") in self.busy}

    def rpc_anchor_place(self, source, message=None):
        # Messages can move to another conversation; the place is where the message is now.
        row = self.lattice.index.one("SELECT thread FROM messages WHERE id=?", (message,)) if message else None
        return annotations.place(self.lattice, "thread:" + row["thread"] if row else annotations.source_of(self.lattice, source))

    def rpc_file_mentions(self, path):
        _, rel = self.lattice.resolve(path)
        return self.lattice.file_mentions(rel) if rel else []

    def rpc_books_add(self, paths=None):
        """Books chosen on this computer, copied into books/ in the vault."""
        out = []
        for raw in paths or []:
            source = Path(str(raw)).expanduser()
            if not source.is_file() or not books.is_book(source.name):
                continue
            rel = self.lattice.vault.unique("books", source.stem, source.suffix)
            self.lattice.vault.write_bytes(rel, source.read_bytes())
            self.lattice.index.reindex(rel)
            out.append(rel)
        if out:
            self.last_write = time.monotonic()
        return out

    def rpc_attach_files(self, paths=None):
        """Copy files chosen on this computer into data/附件/, so they can be attached to a message and read
        by the agents (whose sandbox sees only the vault and mounted folders). The originals stay untouched."""
        out = []
        for raw in paths or []:
            source = Path(raw)
            if not source.is_file() or source.stat().st_size > 50 * 1024 * 1024:
                raise ValueError(str(source.name) + tr(" 不是文件或超过 50MB"))
            rel = self.lattice.vault.unique("data/附件", source.stem or "附件", source.suffix)
            self.lattice.vault.write_bytes(rel, source.read_bytes())
            self.lattice.index.reindex(rel)
            out.append(rel)
        if out:
            self.last_write = time.monotonic()
        return out

    def rpc_project_remove(self, id):
        return self.lattice.remove_project(id)

    # ---- learner-owned parts of cards, and the rest of the map --------------------------------------
    def rpc_card_mine(self, id, stage=None, mine=None):
        if stage is not None and stage not in STAGES:
            raise ValueError(tr("理解阶段无效"))
        self.last_write = time.monotonic()
        return self.lattice.card_mine(id, stage, mine)

    def rpc_card_review(self, id, rating):
        return self.lattice.card_review(id, rating)

    def rpc_cards(self, refs):
        out = []
        for ref in refs[:30]:
            try:
                out.append(self.lattice.card(ref))
            except ValueError:
                out.append({"missing": str(ref)})
        return out

    def rpc_due(self):
        return self.lattice.due_cards()

    def rpc_topic_update(self, id, **change):
        allowed = {k: v for k, v in change.items() if k in ("title", "question", "state", "notes", "parent", "route")}
        return self.lattice.topic_save({"id": id, **allowed})

    def rpc_topic_delete(self, id):
        if any(self.contexts.get(t, (None, None))[1] == id for t in self.busy):
            raise ValueError(tr("这个主题还有正在生成的回答，请先停止或等它说完"))
        self.commit_mine()
        self.lattice.topic_delete(id)
        self.lattice.vault.commit("删除主题", "me")
        return self.rpc_state()

    def rpc_link(self, source, target, kind="related", why=""):
        return self.lattice.link(source, target, kind, why, "me")

    def rpc_unlink(self, id):
        return self.lattice.unlink(id)

    def rpc_insight_resolve(self, id):
        return self.lattice.insight_resolve(id, "me")

    def rpc_viewed(self, path, seconds, where=""):
        if seconds >= 30:
            self.lattice.record("viewed", {"file": path, "seconds": int(seconds), "where": str(where)[:200]}, "me", [path])
        return True

    def rpc_screen(self, state, window=None):
        """What the UI shows right now, the main window's or (window) a separate one's; agents read it with the screen tool."""
        state = state if isinstance(state, dict) else {}
        if window:
            if window in (self.lattice.setting("separate_windows") or {}):
                self.window_screens[window] = state
        else:
            self.screen = state
        for f in (state.get("mine") or {}).get("files") or []:
            if f.get("typing"):
                self.edits[f.get("path")] = time.monotonic()
        return True
