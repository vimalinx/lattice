"""The bridge: skills, and changing them."""
from __future__ import annotations

from ..i18n import tr

import os
from pathlib import Path
import re
import time
from PySide6.QtCore import QUrl
from PySide6.QtGui import QDesktopServices
from .. import agents, skills
from ..index import uid
from ..model import outside_code, text
from ..providers import AGENT_NAMES, ApiWorker

from .common import _places, line_diff, notebook_sources


class SkillsPart:
    # ---- skills: the store ships them, the vault keeps the ones in use ------------------------------------------
    def rpc_skills(self):
        return skills.catalog(self.root)

    def rpc_skill_read(self, slug, shipped=False):
        source = [s for s in (skills.shipped() if shipped else skills.installed(self.root)) if s["slug"] == slug]
        if not source:
            raise ValueError(tr("没有这个技能"))
        return source[0]

    def rpc_skill_install(self, slug):
        self.commit_mine()
        target = skills.install(self.lattice.vault, slug)
        self.lattice.vault.commit("装上技能 " + slug, "me")
        return {"path": target + "/SKILL.md"}

    def rpc_skill_trial(self, slug, agent="tutor"):
        """A conversation of its own for trying a skill, apart from the main conversation and its history."""
        found = skills.find(self.root, slug)
        agent = agent if agent in found["agents"] else found["agents"][0]
        return {"thread": self.lattice.thread_new(agent, None, tr("试用 · ") + found["title"], {"trial": found["slug"]})["id"], "agent": agent}

    # ---- changing a skill: proposed (by an agent, or by the learner restoring a version), reviewed side by side,
    # approved or dismissed. Proposals and decisions are journal entries, so every change keeps its history.
    def propose_skill_change(self, slug, title, rel, base, after, why, by, thread=None, questions=()):
        ident = uid()
        self.lattice.record("skill_proposed", {"change": ident, "skill": slug, "title": title, "file": rel, "base": base, "proposed": after,
                                               "why": why, "by": by, "thread": thread, "questions": list(questions)}, by, [rel, "skillchange:" + ident, *([thread] if thread else [])])
        self.announce({"type": "skill_change", "change": ident, "state": "open", "by": by})
        return ident

    @staticmethod
    def rules_of(target):
        """An agent's rules as a target of the same changes as a skill: "agent:<name>" is (name, title, path)."""
        name = str(target)[6:] if str(target).startswith("agent:") else None
        if name not in agents.NAMES:
            return None
        return name, AGENT_NAMES[name] + tr("的规则"), f"agents/{name}.md"

    def _now_text(self, rel):
        """A changed file as it is: an agent's rules not rewritten in the vault are the shipped ones."""
        if self.lattice.vault.path(rel).exists():
            return self.lattice.vault.read_text(rel)
        if rel.startswith("agents/") and rel.endswith(".md") and rel[7:-3] in agents.NAMES:
            return agents.shipped(rel[7:-3])
        return ""

    def rpc_skill_change(self, id):
        l = self.lattice
        entries = l.journal(["skill_proposed", "skill_changed", "skill_change_dismissed", "skill_compare_done", "skill_compared"], ref="skillchange:" + str(id), limit=60)
        picked = {e["data"].get("compare"): e["data"].get("picked") for e in entries if e["type"] == "skill_compared"}
        compares = [{"id": e["data"]["compare"], "question": e["data"]["question"], "thread": e["data"].get("thread"), "a": e["data"]["a"], "b": e["data"]["b"],
                     "picked": picked.get(e["data"]["compare"])} for e in entries if e["type"] == "skill_compare_done"]
        entries = [e for e in entries if e["type"] in ("skill_proposed", "skill_changed", "skill_change_dismissed")]
        proposed = next((e for e in entries if e["type"] == "skill_proposed"), None)
        if not proposed:
            raise ValueError(tr("找不到这次修改"))
        decided = next((e for e in entries if e["type"] != "skill_proposed"), None)
        d = proposed["data"]
        current = self._now_text(d["file"])
        return {**d, "id": id, "at": proposed["at"], "current": current,
                "state": {"skill_changed": "approved", "skill_change_dismissed": "dismissed"}.get(decided["type"], "open") if decided else "open",
                **({"decided_at": decided["at"], "final": decided["data"].get("after")} if decided else {}), "compares": compares}

    def rpc_skill_propose(self, slug, content=None, why="", file="SKILL.md"):
        """The learner's own change, e.g. bringing back an older version: reviewed the same way as an agent's.
        Without content it starts from the skill as it is, to be changed by hand on the right."""
        rules = self.rules_of(slug)
        if rules:
            slug, title, rel = f"agent:{rules[0]}", rules[1], rules[2]
        else:
            found = skills.find(self.root, slug)
            slug, title = found["slug"], found["title"]
            _, _, rel = skills.change_target(self.root, slug, file)
        base = self._now_text(rel)
        return {"change": self.propose_skill_change(slug, title, rel, base, base if content is None else text(content, 200_000), text(why, 500), "me")}

    def rpc_skill_change_decide(self, id, decision, content=None):
        l, change = self.lattice, self.rpc_skill_change(id)
        if change["state"] != "open":
            raise ValueError(tr("这次修改已经处理过了"))
        refs = [change["file"], "skillchange:" + str(id)]
        if decision != "approved":
            l.record("skill_change_dismissed", {"change": id, "skill": change["skill"], "title": change["title"], "file": change["file"], "why": change["why"]}, "me", refs)
            self.announce({"type": "skill_change", "change": id, "state": "dismissed"})
            return {"state": "dismissed"}
        after = text(content if content is not None else change["proposed"], 200_000)
        rules = self.rules_of(change["skill"])
        if change["file"].endswith("/SKILL.md"):
            skills.check_page(after)
        elif rules:
            agents.parse(rules[0], after)
        self.commit_mine()
        l.vault.write_text(change["file"], after)
        if rules:
            agents.keep_shipped(l.vault, rules[0])
            l.index.reindex(change["file"])
        edited = after != change["proposed"]
        who = {"me": "我"}.get(change["by"], AGENT_NAMES.get(change["by"], change["by"]))
        l.vault.commit(tr("改{0}「{1}」：{2}（{3}提的{4}）", '' if rules else tr('技能'), change['title'], change['why'] or tr('（没写原因）'), who, tr('，我改过再批准') if edited else tr('，我批准'))[:200], "me")
        l.record("skill_changed", {"change": id, "skill": change["skill"], "title": change["title"], "file": change["file"], "before": change["current"],
                                   "after": after, "why": change["why"], "by": change["by"], "edited": edited}, "me", refs)
        self.changed([change["file"]])
        self.announce({"type": "skill_change", "change": id, "state": "approved"})
        return {"state": "approved", "edited": edited}

    def rpc_skill_page(self, slug):
        """A skill's SKILL.md as it is, for editing it in place."""
        found = skills.find(self.root, slug)
        rel = f"{skills.FOLDER}/{found['slug']}/SKILL.md"
        return {**{k: found[k] for k in ("slug", "title", "description", "category", "enabled", "files")}, "path": rel, "content": self.lattice.vault.read_text(rel)}

    def rpc_skill_save(self, slug, content):
        """The learner's own edit of a skill: one commit, and noted like any other change, so it is in the history."""
        page = self.rpc_skill_page(slug)
        content = text(content, 200_000)
        if content == page["content"]:
            return {"saved": False}
        skills.check_page(content)
        self.commit_mine()
        self.lattice.vault.write_text(page["path"], content)
        self.lattice.vault.commit(f"改技能「{page['title']}」（我自己改的）", "me")
        self.lattice.record("skill_changed", {"skill": page["slug"], "title": page["title"], "file": page["path"], "before": page["content"],
                                              "after": content, "why": tr("我自己改的"), "by": "me", "edited": True}, "me", [page["path"]])
        self.changed([page["path"]])
        return {"saved": True}

    def rpc_skill_history(self, slug):
        """Every committed version of a skill's SKILL.md, newest first, the one on disk now marked."""
        rules = self.rules_of(slug)
        rel = rules[2] if rules else f"{skills.FOLDER}/{skills.find(self.root, slug)['slug']}/SKILL.md"
        vault = self.lattice.vault
        current = vault.read_text(rel) if vault.path(rel).exists() else None
        versions = vault.history(rel)
        for i, v in enumerate(versions):
            v["current"] = i == 0 and vault.at(v["commit"], v["path"]) == current
        if rules:
            # The rules Lattice ships are a version too: the one in use while the vault has none of its own.
            versions.append({"commit": "shipped", "path": rel, "subject": tr("程序自带的默认规则"), "author": "Lattice", "at": "",
                             "current": current is None, "content": agents.shipped(rules[0])})
        return versions

    def rpc_skill_compare(self, slug, a, b, thread=None, message="", change=None):
        """Continue one conversation twice, once with each version of a skill's instructions, without tools and without
        writing anything to the conversation; the learner then picks one side (or edits it) or neither."""
        l, rules = self.lattice, self.rules_of(slug)
        found = None if rules else skills.find(self.root, slug)
        if not thread:
            row = None if rules else l.index.one("SELECT id FROM threads WHERE json_extract(head,'$.trial')=? ORDER BY created DESC LIMIT 1", (found["slug"],))
            thread = row["id"] if row else l.thread_for(rules[0] if rules else "tutor", l.active_topic())
        head = l.thread_head(thread)
        if rules:
            agent = rules[0]
        else:
            agent = head.get("agent") if head.get("agent") in found["agents"] else found["agents"][0]
        definition, msgs = agents.load(self.root, agent), l.messages(thread)
        question = str(message or "").strip()
        if question:
            history = self._history(thread, definition["history"])
        else:
            last = next((i for i in range(len(msgs) - 1, -1, -1) if msgs[i]["role"] == "user"), None)
            if last is None:
                raise ValueError(tr("这段对话里还没有问题；写一句要它接着回答的话"))
            question, history = msgs[last]["content"], self._history(thread, definition["history"], before=last)
        conn = self.config.agent(agent)
        if not conn["api_key"]:
            raise ValueError(tr("请先在设置里给{0}填写 {1} 的 API Key", AGENT_NAMES[agent], conn['label']))
        ident = uid()
        self.compares[ident] = {"thread": thread, "agent": agent, "question": question, "skill": slug if rules else found["slug"], "change": change}
        for side, page in (("a", a), ("b", b)):
            if rules:
                user, system = self._compose(agents.parse(agent, page), thread, head.get("topic"), None, question, "", "", [], "",
                                             tr("\n\n（这一轮不调用工具，直接写出回答。）"))
            else:
                version = {**found, "body": skills.check_page(page)}
                user, system = self._compose(definition, thread, head.get("topic"), None, question, "", "", [], "",
                                             tr("\n\n（这一轮不调用工具，直接写出回答。）"), version)
            messages = [{"role": "system", "content": system}, *({"role": m["role"], "content": m["content"]} for m in history if m["role"] in ("user", "assistant")),
                        {"role": "user", "content": user}]
            key = f"compare:{ident}:{side}"
            worker = ApiWorker(agent, key, conn, messages)
            worker.event.connect(self.api_event)
            self.workers[key] = worker
            self.compares[ident][side] = {"text": "", "done": False}
            worker.start()
        return {"compare": ident, "thread": thread, "agent": agent, "question": question[:2000], "title": head.get("title")}

    def rpc_compare_stop(self, id):
        for side in ("a", "b"):
            worker = self.workers.get(f"compare:{id}:{side}")
            if worker:
                worker.stop()
        return True

    def rpc_compare_pick(self, id, side, content):
        """The side the learner chose (as they left it) becomes the conversation's next reply."""
        found = self.compares.get(str(id))
        if not found:
            raise ValueError(tr("这次比较已经不在了"))
        content = text(content, 200_000).strip()
        if not content:
            raise ValueError(tr("这一边是空的"))
        l = self.lattice
        msgs = l.messages(found["thread"])
        last = next((i for i in range(len(msgs) - 1, -1, -1) if msgs[i]["role"] == "user"), None)
        # The last question answered again: the chosen reply supersedes the old one, as a retry does. A new question is
        # asked first.
        again = last is not None and msgs[last]["content"] == found["question"]
        if not again:
            l.append_message(found["thread"], "user", found["question"], {"agent": found["agent"]})
        edited = content != (found.get(side) or {}).get("text", "").strip()
        message = l.append_message(found["thread"], "assistant", content, {"agent": found["agent"], "compare": {"id": id, "side": side, "edited": edited},
                                                                          **({"retry": True} if again and last < len(msgs) - 1 else {})})
        l.record("skill_compared", {"compare": id, "change": found.get("change"), "skill": found["skill"], "picked": side, "edited": edited, "question": found["question"][:400]},
                 "me", [found["thread"], "compare:" + str(id), *(["skillchange:" + found["change"]] if found.get("change") else [])])
        self.announce({"type": "agent", "kind": "finished", "agent": found["agent"], "thread": found["thread"], "text": content})
        return {"message": message, "thread": found["thread"]}

    def rpc_skill_install_many(self, slugs):
        self.commit_mine()
        for slug in slugs[:100]:
            skills.install(self.lattice.vault, slug)
        self.lattice.vault.commit(f"装上 {len(slugs)} 个技能", "me")
        return True

    def rpc_skill_uninstall(self, slug):
        self.commit_mine()
        skills.uninstall(self.lattice.vault, slug)
        self.lattice.vault.commit("卸下技能 " + slug, "me")
        return True

    def rpc_skill_enable(self, slug, on=True):
        return skills.set_enabled(self.lattice.vault, slug, on)

    def rpc_skill_create(self, title, description="", category=tr("其他"), agents=None):
        return {"path": skills.create(self.lattice.vault, title, description, category, agents or skills.AGENTS)}

    def rpc_skill_import(self, folder=None):
        if not folder:
            return None
        self.commit_mine()
        target = skills.import_folder(self.lattice.vault, folder)
        self.lattice.vault.commit("导入技能 " + target, "me")
        return {"path": target + "/SKILL.md"}

    def rpc_tags(self):
        return self.lattice.tags()

    def rpc_link_mention(self, path, title):
        """Turn the first plain mention of a title in a document into a [[link]], keeping the words as written."""
        l = self.lattice
        _, rel = l.resolve(path)
        row = l.index.one("SELECT id FROM files WHERE path=?", (rel,))
        if not row or not row["id"] or not title:
            raise ValueError(tr("这个文件不是学习库里的文档"))
        pattern = re.compile(r"(?<!\[\[)" + re.escape(title) + r"(?![^\[\n]*\]\])", re.I)
        swap = lambda m: "[[" + title + ("" if m.group(0) == title else "|" + m.group(0)) + "]]"
        done = []

        def once(part):
            if done or not pattern.search(part):
                return part
            done.append(True)
            return pattern.sub(swap, part, count=1)
        self.changed([l._edit_doc(row["id"], lambda a, b: (a, outside_code(b, once)))])
        self.last_write = time.monotonic()
        return True

    def rpc_attach_data(self, name, data):
        """An image pasted or dropped into a note: saved under data/附件/, so the note can embed it."""
        import base64
        raw = base64.b64decode(str(data).split(",", 1)[-1])
        if len(raw) > 50 * 1024 * 1024:
            raise ValueError(tr("文件超过 50MB"))
        stem, _, ext = str(name or "粘贴").rpartition(".")
        rel = self.lattice.vault.unique("data/附件", stem or ext or "粘贴", "." + ext if stem and ext else ".png")
        self.lattice.vault.write_bytes(rel, raw)
        self.lattice.index.reindex(rel)
        self.last_write = time.monotonic()
        return {"path": rel}

    def rpc_attach_text(self, text):
        """A long piece of text pasted into a message, kept as a file of its own under data/附件/ (shown as a tile,
        opened and edited like any file) instead of filling the input."""
        rel = self.lattice.vault.unique("data/附件", "粘贴的文字", ".md")
        self.lattice.vault.write_text(rel, str(text)[:2_000_000])
        self.lattice.index.reindex(rel)
        self.last_write = time.monotonic()
        return {"path": rel}

    def rpc_file_delete(self, path):
        _, rel = self.lattice.resolve(path)
        if rel and rel.endswith(".ipynb"):
            nb = self.lattice.notebook(rel)
            self._stop_kernel(nb["id"])
        self.commit_mine()
        self.lattice.delete_file(path)
        self.lattice.vault.commit("删除 " + str(path), "me")
        return True

    def rpc_file_history(self, path):
        return self.lattice.history(path)

    def rpc_file_diff(self, path, commit, against="previous"):
        """What one version changed from the one before it, or (against="now") how the file now differs from it; line by
        line, with a few unchanged lines around each change. A notebook is compared by its cells' sources."""
        l = self.lattice
        _, rel = l.resolve(path)
        versions = l.history(rel)
        at = next((i for i, v in enumerate(versions) if v["commit"] == commit), None)
        if at is None:
            raise ValueError(tr("找不到这个版本"))
        content = lambda v: (l.vault.at(v["commit"], v["path"]) or "") if v else ""
        if against == "now":
            before, after = content(versions[at]), l.vault.read_text(rel) if l.vault.path(rel).exists() else ""
        else:
            before, after = content(versions[at + 1] if at + 1 < len(versions) else None), content(versions[at])
        if rel.endswith(".ipynb"):
            before, after = notebook_sources(before), notebook_sources(after)
        return line_diff(before, after)

    def rpc_file_version(self, path, commit):
        _, rel = self.lattice.resolve(path)
        version = next((v for v in self.lattice.history(rel) if v["commit"] == commit), None)
        return {"content": self.lattice.vault.at(commit, version["path"] if version else rel)}

    def rpc_file_external(self, path):
        absolute, _ = self.lattice.resolve(path)
        return QDesktopServices.openUrl(QUrl.fromLocalFile(str(absolute)))

    def rpc_open_folder(self, path=""):
        absolute = self.lattice.resolve(path)[0] if path else self.root
        return QDesktopServices.openUrl(QUrl.fromLocalFile(str(absolute if absolute.is_dir() else absolute.parent)))

    def rpc_open_url(self, url):
        target = QUrl(url)
        if target.scheme() not in ("https", "http"):
            raise ValueError(tr("不支持该外部链接"))
        return QDesktopServices.openUrl(target)

    def rpc_browse(self, path=None, hidden=False):
        """One folder of this computer for the program's own file picker (choosing where to import from, what to
        attach, where to export): its folders, then its files. Only the learner's picker asks; agents never do."""
        folder = Path(path).expanduser().resolve() if path else Path.home()
        if not folder.is_dir():
            raise ValueError(tr("不是一个文件夹：") + str(folder))
        try:
            items = list(os.scandir(folder))
        except PermissionError:
            raise ValueError(tr("没有权限打开这个文件夹：") + str(folder)) from None
        entries = []
        for item in items:
            if not hidden and item.name.startswith("."):
                continue
            try:
                is_dir = item.is_dir()
                size = 0 if is_dir else item.stat().st_size
            except OSError:
                continue
            entries.append({"name": item.name, "dir": is_dir, "size": size})
        entries.sort(key=lambda e: (not e["dir"], e["name"].lower()))
        return {"path": str(folder), "parent": str(folder.parent) if folder.parent != folder else None,
                "entries": entries[:3000], "more": max(0, len(entries) - 3000), "places": _places()}
