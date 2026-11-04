"""The bridge: apps the app builder makes."""
from __future__ import annotations

from ..i18n import tr

import json
import re
import time
from datetime import datetime
from PySide6.QtCore import QTimer
from .. import agents, skills, tools
from ..index import uid
from .. import appscheme
from ..vault import slug as vault_slug

from .common import CODE_EXT, app_meta


class AppsPart:
    # ---- apps the app builder makes ---------------------------------------------------------------------
    def build_app(self, title, brief, file=None, origin=None, topic=None, by="me"):
        """Hand a small app to the app builder. It works in a conversation of its own, in the background, so the one
        that asked goes on; the app opens on the learner's side when it is done."""
        l = self.lattice
        brief = str(brief or "").strip()
        if not brief:
            raise ValueError(tr("写一下这个应用要做什么"))
        conn = self.config.agent("builder")
        if not conn["api_key"]:
            raise ValueError(tr("请先在设置里给应用助手填写 {0} 的 API Key", conn['label']))
        # Asked without a name: the request's first clause, without "做一个".
        title = str(title or "").strip() or re.sub(r"^(请|帮我)?(做|写|弄)?(一个|个)?", "", re.split(r"[，。：:；;,.!?！？（(\n]", brief, maxsplit=1)[0]).strip()[:24] or tr("小应用")
        if file:
            _, rel = l.resolve(str(file).removeprefix("file:"))
            if not rel or not rel.startswith("apps/") or not rel.endswith(".html"):
                raise ValueError(tr("应用是 apps/ 下的 .html 文件"))
        else:
            base, n = "apps/" + vault_slug(title, 40), 2
            rel = base + ".html"
            while l.vault.path(rel).exists() or any(b["file"] == rel for b in self.builds.values()):
                rel, n = f"{base}-{n}.html", n + 1
        if any(b["file"] == rel for b in self.builds.values()):
            raise ValueError(tr("应用助手正在做这个应用，等它做完再改"))
        existed = l.vault.path(rel).is_file()
        spec = self._app_spec()
        thread = l.thread_new("builder", topic, tr("应用 · ") + title)["id"]
        message = tr("应用：{0}\n文件：{1}（", title, rel) + (tr("已经有了：先读它，在它的基础上改") if existed else tr("新建")) + tr("）\n\n要求：\n") + brief
        definition = agents.load(self.root, "builder")
        self.builds[thread] = {"build": thread, "title": title, "file": rel, "origin": origin, "topic": topic, "by": by,
                               "since": int(time.time() * 1000), "existed": existed,
                               "mtime": l.vault.path(rel).stat().st_mtime_ns if existed else 0}
        l.append_message(thread, "user", message, {"agent": "builder", "app": rel, **({"origin": origin} if origin else {})})
        system = agents.system_prompt(self.root, definition, tr("现在是 {0}。", tools.today()))
        # The rules for apps come with every request, whole: the builder works by them without having to look them up.
        user = message + (tr("\n\n（按技能「") + spec["title"] + tr("」来做。完整做法如下；说明里提到的附带文件用 skill 工具的 file 读。）\n\n") + skills.instructions(spec) if spec else "")
        self._turn("builder", thread, topic, None, conn, system, [], user, definition["tools"], spec)
        self.announce({"type": "app_build", "state": "started", **self._build_public(self.builds[thread])})
        return {"title": title, "file": rel, "build": thread}

    def _app_spec(self):
        """The skill the builder makes apps by: the learner's copy in the vault (installed the first time, then theirs to
        change like any skill), unless they switched it off."""
        own = next((s for s in skills.installed(self.root) if s["slug"] == "app-design"), None)
        if own is None:
            self.commit_mine()
            skills.install(self.lattice.vault, "app-design")
            self.lattice.vault.commit("装上技能「应用规范」，应用助手按它做应用", "lattice")
            own = next((s for s in skills.installed(self.root) if s["slug"] == "app-design"), None)
        return own if own and own["enabled"] else None

    @staticmethod
    def _build_public(build):
        return {k: build[k] for k in ("build", "title", "file", "origin", "since", "existed")}

    def _built(self, build, reason, body):
        """An app build ended: noted in the journal (the conversation that asked for it hears of it on its next turn),
        and the learner's side opens the app."""
        l = self.lattice
        path = l.vault.path(build["file"])
        made = path.is_file() and path.stat().st_mtime_ns != build["mtime"]
        # Cut off after the app was written (the service failed, it ran out of room): what it saved is there to open.
        state = "done" if made and reason == "end_turn" else "stopped" if reason == "cancelled" else "partial" if made else "failed"
        summary = body.strip()[-1200:]
        l.record("built", {"title": build["title"], "file": build["file"], "state": state, "summary": summary[:800], "by": build["by"]},
                 "builder", [build["origin"], build["build"], build["file"]])
        self.announce({"type": "app_build", "state": state, "summary": summary, "made": made, "reason": reason, **self._build_public(build)})

    def rpc_app_build(self, brief, file=None, title=""):
        """The learner asks the app builder for an app, or for a change to one, directly."""
        return self.build_app(title, brief, file, origin=None, topic=self.lattice.active_topic(), by="me")

    def rpc_apps(self):
        """The apps in the vault, newest first, and the ones being made."""
        folder, out = self.lattice.vault.path("apps"), []
        for path in sorted(folder.glob("*.html"), key=lambda x: x.stat().st_mtime, reverse=True) if folder.is_dir() else []:
            head = path.read_text(encoding="utf-8", errors="replace")[:8000]
            out.append({"file": "apps/" + path.name, **app_meta(head, path.stem),
                        "updated": datetime.fromtimestamp(path.stat().st_mtime).astimezone().isoformat(timespec="seconds")})
        return {"apps": out, "builds": [self._build_public(b) for b in self.builds.values()]}

    def rpc_app_read(self, path):
        absolute, rel = self.lattice.resolve(path)
        if rel is None or absolute.suffix.lower() not in (".html", ".htm"):
            raise ValueError(tr("应用是学习库里的 .html 文件"))
        if not absolute.is_file():
            raise ValueError(tr("文件不存在：") + str(rel))
        if absolute.stat().st_size > 8_000_000:
            raise ValueError(tr("这个应用太大了（超过 8MB）"))
        if not rel.startswith("apps/"):
            raise ValueError(tr("应用放在 apps/ 下"))
        head = absolute.read_text(encoding="utf-8", errors="replace")[:8000]
        return {"file": rel, "url": f"lattice-app://{appscheme.host_of(rel)}/{rel}", "mtime": str(absolute.stat().st_mtime_ns), **app_meta(head, absolute.stem)}

    def app_check(self, rel, html, probe, wait, done):
        """Load an app in the interface, from where it lives and as the learner would see it (its assets, the network),
        and hand back what it reported."""
        ident = uid()
        host = "c" + ident.lower()
        self.app_docs[host] = {"file": rel, "html": html, "probe": probe, "wait": wait, "request": ident}

        def finish(result):
            self.app_docs.pop(host, None)
            done(result)
        self.ui_waiters[ident] = finish
        self.announce({"type": "app_check", "request": ident, "url": f"lattice-app://{host}/{rel}", "wait": wait})
        QTimer.singleShot(wait + 20000, lambda: self.ui_waiters.pop(ident, None) and finish({"error": tr("界面没有交回结果：应用可能卡住了（死循环？），或者界面没有打开")}))

    def rpc_practice_start(self, thread, message):
        """Start a practice from one of the tutor's replies."""
        row = self.lattice.index.one("SELECT content FROM messages WHERE id=? AND thread=?", (int(message), thread))
        if not row:
            raise ValueError(tr("找不到这条回复"))
        seed = re.sub(r"```lattice:[\w-]*\s*\n.*?(?:\n```|$)", "", row["content"], flags=re.S).strip()
        fence = re.search(r"```([\w+#-]+)", seed)
        ext = CODE_EXT.get((fence.group(1) if fence else "python").lower(), ".py")
        conn = self.config.agent("coach")
        if not conn["api_key"]:
            raise ValueError(tr("请先在设置里给练习教练选一个已填 Key 的 API 连接"))
        topic = self.lattice.thread_head(thread).get("topic")
        p = self.lattice.practice_create(topic, seed, "", ext, int(message), "me")
        self.lattice.vault.commit("开始练习 · " + p["title"], "me")
        self.practice_send(p["id"], task="start")
        return p

    def practice_send(self, ident, message="", task=""):
        return self.send("coach", message, ident, task=task)

    def rpc_practice(self, id):
        return self.lattice.practice(id)

    def rpc_practice_end(self, id):
        """Hand the whole practice to the tutor for review; its weak points are kept."""
        p = self.lattice.practice(id)
        if p["state"] == "done":
            raise ValueError(tr("这次练习已经复盘过了"))
        if id in self.busy:
            raise ValueError(tr("练习教练还在回答，等它说完或先停止"))
        tutor = self.lattice.thread_for("tutor", p["topic"])
        if tutor in self.busy:
            raise ValueError(tr("主会话正在回答，等它说完再结束练习"))
        pointer = (tr("\n\n（这次练习是 practice:{0}，练习文件是 {1}。先用 read 读 practice:{2}：练习依据、全部对话、练习文件的最终内容和运行记录，再复盘。）", id, p['file'], id))
        self.lattice.practice_state(id, "reviewing")
        self.reviews[id] = tutor
        try:
            self.send("tutor", agents.TASKS["practice_review"][0], tutor, task="practice_review", extra=pointer)
        except Exception:
            self.reviews.pop(id, None)
            self.lattice.practice_state(id, "active")
            raise
        return {"tutor_thread": tutor}

    def rpc_suggestion(self, thread, message, id, decision):
        """The learner applies or dismisses one of an agent's suggested edits."""
        if decision not in ("applied", "dismissed"):
            raise ValueError(tr("只能应用或忽略"))
        row = self.lattice.index.one("SELECT meta FROM messages WHERE id=? AND thread=?", (int(message), thread))
        item = next((s for s in json.loads(row["meta"]).get("suggestions") or [] if s["id"] == id), None) if row else None
        if not item:
            raise ValueError(tr("找不到这条建议"))
        if decision == "applied":
            current = self.lattice.read_file(item["file"])["content"]
            if item["old"] and current.count(item["old"]) != 1:
                raise ValueError(tr("文件已经变了，建议里要替换的原文找不到了"))
            changed = current.replace(item["old"], item["new"], 1) if item["old"] else current.rstrip("\n") + "\n" + item["new"] + "\n"
            self.commit_mine()
            self.lattice.write_file(item["file"], changed)
            self.lattice.vault.commit("应用建议：" + (item.get("why") or item["file"])[:60], "me")
            self.changed([item["file"]])
        self.lattice.record("wrote", {"suggestion": f"{message}:{id}", "decision": decision, "file": item["file"]}, "me", [thread, item["file"]])
        return True

    def rpc_undo(self, id):
        touched = self.lattice.action_undo(id)
        self.changed(touched)
        return {"touched": touched}
