"""The bridge: the vault."""
from __future__ import annotations

from ..i18n import tr

import time
import json
import os
from .. import __version__, agents, annotations
from .. import states as st
from ..providers import AGENT_NAMES
from ..vault import APPEND_ONLY

from .common import LOG


class VaultPart:
    # ---- the vault -------------------------------------------------------------------------------
    def sync(self):
        if self.closing:
            return
        try:
            changed, removed = self.lattice.index.sync()
            if changed or removed:
                self.announce({"type": "changed", "paths": changed + removed, "external": True})
        except Exception as exc:
            LOG.warning("vault sync failed: %s", exc)

    def changed(self, paths):
        self.announce({"type": "changed", "paths": list(paths), "external": False})

    def commit_mine(self):
        """Commit the learner's pending edits as their own step, and note in the journal what they wrote.

        Journal and conversation lines alone wait for the next real commit, so history stays readable."""
        vault = self.lattice.vault
        try:
            if not any(not rel.startswith(APPEND_ONLY) for _, rel in vault.changes()):
                return
            files = []
            for line in vault.git("diff", "HEAD", "--numstat", "--no-renames", check=False).splitlines():
                added, removed, rel = (line.split("\t") + ["", "", ""])[:3]
                if rel and not rel.startswith(APPEND_ONLY) and not rel.startswith(("envs/", annotations.FOLDER + "/", st.FOLDER + "/")):
                    files.append({"file": rel, "added": int(added) if added.isdigit() else None, "removed": int(removed) if removed.isdigit() else None})
            commit = vault.commit("我的编辑", "me")
            if commit and files:
                # Where the learner was when they wrote it, so the file is found under that topic and conversation.
                topic = self.lattice.active_topic()
                thread = self.lattice.current_thread("tutor", topic)
                self.lattice.record("wrote", {"files": files[:30], "commit": commit, "topic": topic, "thread": thread}, "me",
                                    [f["file"] for f in files[:30]] + [x for x in (topic, thread) if x])
        except Exception as exc:
            self.history_failed(exc)

    def history_failed(self, exc):
        """Undo stands on the vault's history, so the learner hears when it stops being written; once a minute at most."""
        LOG.warning("commit failed: %s", exc)
        if self.closing or time.monotonic() - self.history_warned < 60:
            return
        self.history_warned = time.monotonic()
        self.announce({"type": "notice", "message": tr("学习库的历史写不进去了，这之后的改动暂时不能撤销。详情在日志里。")})

    def _local_state(self):
        """This machine's state for the vault (layout, bookmarks); it can be lost without losing any learning."""
        try:
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _local_save(self, key, value):
        state = self._local_state()
        state[key] = value
        self._local_write(state)

    def _local_write(self, state):
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.state_path)

    # ---- working states, a file each in the vault (states.py) ---------------------------------------------------
    def states(self):
        found = st.read_all(self.lattice.vault)
        return found or self._states_moved()

    def _states_moved(self):
        """States kept before they had files of their own (the list in this machine's settings, each one's arrangement in
        the vault's local state) are written out as files, once; that is then where they are."""
        local, ui = self._local_state(), self.config.read()["ui"]
        listed = [x for x in ui.get("spaces") or [] if isinstance(x, dict) and x.get("id") and x.get("name")]
        if not listed:
            return {}
        old = local.get("states") if isinstance(local.get("states"), dict) else {}
        if not old and isinstance(local.get("layout"), dict):
            # Saved before states were kept one by one: one layout of them all.
            one = local["layout"]
            panels = one.get("panels") or {}
            old = {k: {"layout": v, "panels": {pid: panels[pid] for pid in self._tabs(v) if pid in panels}} for k, v in (one.get("spaces") or {}).items() if isinstance(v, dict)}
            local["state_now"] = one.get("space")
        taken = set()
        for i, m in enumerate(listed):
            rel = st.file_for(m["name"], taken)
            taken.add(rel)
            data = {"id": m["id"], **{k: m[k] for k in st.META if m.get(k) not in (None, False)}, "order": i, "rel": rel, "layout": {}}
            self._state_write(st.merged(data, old.get(m["id"]) or {}))
        local.pop("states", None)
        local.pop("layout", None)
        self._local_write(local)
        self.config.save_ui({k: v for k, v in ui.items() if k != "spaces"})
        return st.read_all(self.lattice.vault)

    @staticmethod
    def _tabs(layout):
        def walk(n):
            if not isinstance(n, dict):
                return
            if n.get("t") == "stack":
                yield from n.get("tabs") or []
            for k in n.get("kids") or []:
                yield from walk(k)
        yield from walk(layout.get("root"))
        for f in layout.get("floats") or []:
            yield from walk(f.get("stack"))

    def _state_write(self, data):
        if st.write(self.lattice.vault, data):
            self.lattice.index.reindex(data["rel"])

    def rpc_states_save(self, states=None, list=None, now=None):
        """The main window saves the list of states (list: what the status bar shows, in order) and every state it holds;
        a window holding one state of its own saves that one, and the main window leaves it be."""
        vault, found = self.lattice.vault, self.states()
        if list is not None:
            before = [st.meta(d) for d in found.values()]
            taken = {d["rel"] for d in found.values()}
            for i, m in enumerate(list):
                ident = str((m or {}).get("id") or "")
                if not ident or not m.get("name"):
                    continue
                data = found.get(ident) or {"id": ident, "layout": {}}
                data = {**{k: v for k, v in data.items() if k not in st.META}, **{k: m[k] for k in st.META if m.get(k) not in (None, False, "")}, "order": i}
                # Its file is named for it: renamed, the file is too.
                rel = st.file_for(m["name"], taken - {data.get("rel")})
                if data.get("rel") and data["rel"] != rel and vault.path(data["rel"]).is_file():
                    vault.move(data["rel"], rel)
                    self.lattice.index.unindex(data["rel"])
                taken = (taken - {data.get("rel")}) | {rel}
                found[ident] = {**data, "rel": rel}
                self._state_write(found[ident])
            after = [st.meta(found[str(m["id"])]) for m in list if str((m or {}).get("id") or "") in found]
            if after != before:
                self.announce({"type": "states", "list": after})
        for ident, given in (states or {}).items():
            if ident in found and isinstance(given, dict):
                found[ident] = st.merged(found[ident], given)
                self._state_write(found[ident])
        if now:
            self._local_save("state_now", now)
        return True

    def rpc_state_delete(self, space):
        """A state deleted: its file goes (it stays in the vault's history)."""
        data = self.states().get(space)
        if data:
            self.lattice.vault.remove(data["rel"])
            self.lattice.index.unindex(data["rel"])
        return True

    def saved_state(self, space):
        data = self.states().get(space)
        return st.unit(data) if data else None

    def rpc_bootstrap(self):
        returned, self.returned_windows = self.returned_windows, []
        found = self.states()
        units = {k: st.unit(v) for k, v in found.items()}
        # The page takes them all at once: every state's arrangement, and the panels of all of them together.
        layout = {"spaces": {k: u["layout"] for k, u in units.items()}, "panels": {pid: p for u in units.values() for pid, p in u["panels"].items()},
                  "space": self._local_state().get("state_now")} if found else None
        return {**self.rpc_state(), "version": __version__, "vault": str(self.root), "layout": layout, "states": [st.meta(d) for d in found.values()],
                "returned_windows": returned, "config": self.config.public(),
                "sandbox": {"ok": self.sandbox.available(), "isolated": self.sandbox.isolated, "why": self.sandbox.why_not()}, "migrated": self.lattice.migrated,
                "problems": self.lattice.index.problems[:20]}

    def catalog(self, kind, **filters):
        """Everything of one kind, whatever panels are open. Vault material comes from the model; the rest is this machine's."""
        if kind == "projects":
            return self.lattice.projects()
        if kind == "envs":
            return [{"name": n, "definition": self.envs.definition_rel(n), "packages": self.envs.wanted(n), "ready": self.envs.ready(n)} for n in self.envs.names()]
        return self.lattice.catalog(kind, **filters)

    def rpc_list(self, kind, **filters):
        return self.catalog(kind, **filters)

    def rpc_state(self):
        l = self.lattice
        docs = l.index.rows("SELECT id, kind, title, topic, path, updated FROM docs ORDER BY updated DESC LIMIT 3000")
        cards = self.catalog("cards")
        return {"topics": l.topics(), "active_topic": l.active_topic(), "docs": docs, "projects": self.catalog("projects"), "cards": cards,
                "insights": self.catalog("insights", state="active"),
                "due": sum(c["due_now"] for c in cards), "practices": self.catalog("practices"), "busy": sorted(self.busy), "status": self.status,
                "kernels": self.kernel_states, "running": [{"run": k, "path": v["path"], "by": v["by"]} for k, v in self.runs.items()],
                "agents": {name: AGENT_NAMES[name] for name in agents.NAMES}, "undone": sorted(l.undone()),
                "starred": self._local_state().get("starred", [])}

    def rpc_star(self, id, on=True):
        """Bookmark a document (by id, so it survives renames and moves)."""
        starred = [x for x in self._local_state().get("starred", []) if x != id]
        if on:
            starred.insert(0, id)
        self._local_save("starred", starred[:200])
        return starred[:200]

    def rpc_file_refs(self, words):
        """Which of these words in a reply name a file that is there: {word: {"text": the file's part of it, "path": what to open}}.
        A bare name counts when only one file has it; words run into the text before them are tried from each later start."""
        l = self.lattice
        by_name = {}
        for rel in l.vault.files():
            by_name.setdefault(rel.rsplit("/", 1)[-1], []).append(rel)
        found = {}
        for word in [str(w)[:200] for w in (words or [])[:400]]:
            try:
                absolute, rel = l.resolve(word)
                if absolute.is_file():
                    found[word] = {"text": word, "path": rel or str(absolute)}
                    continue
            except (ValueError, OSError):
                pass
            for start in range(len(word)):
                tail = word[start:]
                if "/" not in tail and len(by_name.get(tail, ())) == 1:
                    found[word] = {"text": tail, "path": by_name[tail][0]}
                    break
        return found

    def rpc_tree(self, path=""):
        return self.lattice.tree(path)

    def rpc_search(self, query):
        return self.lattice.search(query)

    def rpc_graph(self, topic=None):
        return self.lattice.graph(topic or None)

    def rpc_journal(self, types=None, ref=None, since=None, until=None, actor=None, limit=200):
        return self.lattice.journal(types, ref, since, until, actor, limit)

    def rpc_topic_here(self, topic=None):
        """The working state in front learns this topic (each keeps its own): what is done without saying where, a note
        written or a passage annotated, is about it."""
        topic = topic or None
        if topic != self.lattice.active_topic() and (not topic or self.lattice.index.one("SELECT 1 FROM docs WHERE id=? AND kind='topic'", (topic,))):
            self.lattice.focus(topic)
        return True

    def rpc_focus(self, topic=None):
        if (topic or None) != self.lattice.active_topic():
            self.save_later(self.lattice.current_thread("tutor", self.lattice.active_topic()))
        self.lattice.focus(topic or None)
        return self.rpc_state()
