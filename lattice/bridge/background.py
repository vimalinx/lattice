"""The bridge: organizing, practices, suggestions, undo, saving where a conversation stands."""
from __future__ import annotations

from ..i18n import tr

from datetime import datetime, timedelta
from PySide6.QtCore import QTimer
from .. import agents, tools
from ..vault import APPEND_ONLY


class BackgroundPart:
    # ---- organizing, practices, suggestions, undo -------------------------------------------------------
    def _organizer(self):
        """The organizer's one conversation, and its connection; None while it is busy or has no key."""
        thread = self.lattice.setting("organizer_thread")
        if not thread or not self.lattice.index.one("SELECT 1 FROM threads WHERE id=?", (thread,)):
            thread = self.lattice.set_setting("organizer_thread", self.lattice.thread_new("organizer", None, tr("整理"))["id"])
        return thread, self.config.agent("organizer")

    def next_job(self):
        """The organizer's next piece of background work, after any tidying under way: cards noted from a stretch of
        explanation (sorted by kind and area, joined to the cards already there), or a conversation the learner left,
        saved where it stands."""
        if not self.jobs:
            return
        thread, conn = self._organizer()
        if thread in self.busy or not conn["api_key"]:
            return
        job, l = self.jobs.pop(0), self.lattice
        message = self._save_message(job) if job["kind"] == "save" else self._cards_message(job)
        if not message:
            return self.next_job()
        self.job_running[thread] = job
        definition = agents.load(self.root, "organizer")
        l.append_message(thread, "user", message, {"agent": "organizer", ("save_for" if job["kind"] == "save" else "cards_for"): job})
        system = agents.system_prompt(self.root, definition, tr("现在是 {0}。", tools.today()))
        self._turn("organizer", thread, job.get("topic"), None, conn, system, [], message, definition["tools"])

    def _cards_message(self, job):
        l = self.lattice
        msgs = l.messages(job["thread"])
        at = next((i for i, m in enumerate(msgs) if m["id"] == job["message"]), None)
        if at is None:
            return None
        asked = next((m["content"] for m in reversed(msgs[:at]) if m["role"] == "user"), "")
        where = tr("主题「{0}」", l.topic(job['topic'])['title']) if job.get("topic") and l.doc(job["topic"], "topic") else tr("默认对话")
        return tr("主会话在{0}里刚讲完一段。请按「边学边记知识卡」整理这一段。\n\n学习者说：\n{1}\n\n主会话讲的：\n", where, asked[:4000]) + str(msgs[at]['content'][:16000])

    # ---- saving where a conversation stands, when the learner leaves it ----------------------------------------
    def save_later(self, thread):
        """Queue a save of a tutor's conversation the learner just left, when something was said since the last one."""
        l = self.lattice
        if not thread or any(j["kind"] == "save" and j["thread"] == thread for j in self.jobs + list(self.job_running.values())):
            return
        try:
            head = l.thread_head(thread)
        except ValueError:
            return
        if head.get("agent") != "tutor" or head.get("practice") or head.get("trial"):
            return
        upto = (head.get("summary") or {}).get("upto") or 0
        last = l.index.one("SELECT MAX(id) AS id FROM messages WHERE thread=?", (thread,))["id"] or 0
        answered = l.index.one("SELECT 1 FROM messages WHERE thread=? AND role='assistant' AND id>?", (thread, upto))
        if last <= upto or not answered or self.saves_tried.get(thread) == last:
            return
        self.saves_tried[thread] = last
        self.jobs.append({"kind": "save", "thread": thread, "upto": last, "topic": head.get("topic")})
        QTimer.singleShot(0, self.next_job)

    def save_idle(self):
        """Every conversation nobody has said anything in for a while, with something new since its last save."""
        cutoff = datetime.now().astimezone() - timedelta(minutes=15)
        for row in self.lattice.unsaved_threads():
            if row["thread"] not in self.busy and datetime.fromisoformat(row["at"]) < cutoff:
                self.save_later(row["thread"])

    def _save_message(self, job):
        l = self.lattice
        try:
            head = l.thread_head(job["thread"])
        except ValueError:
            return None
        topic = head.get("topic")
        t = l.topic(topic) if topic and l.doc(topic, "topic") else None
        before = (head.get("summary") or {})
        msgs = [m for m in l.messages(job["thread"]) if m["id"] > (before.get("upto") or 0) and m["id"] <= job["upto"] and m["role"] in ("user", "assistant")]
        if not msgs:
            return None
        said, size = [], 0
        for m in reversed(msgs):   # the latest first, within about 40k characters
            line = (tr("学习者：") if m["role"] == "user" else tr("主会话：")) + m["content"][:4000]
            if size + len(line) > 40000:
                said.append(tr("（更早的 {0} 条略去，需要时用 conversation 读 thread {1}）", len(msgs) - len(said), job['thread']))
                break
            said.append(line)
            size += len(line)
        route = (t or {}).get("route") or []
        return (tr("学习者离开了一段主会话，请按「存档」整理，最后用 checkpoint 写下摘要。\n\n会话：「{0}」（thread {1}），{2}\n\n这段会话上次存档的摘要：\n{3}\n\n{4}上次存档之后的对话：\n\n", head.get('title') or job['thread'], job['thread'], tr("属于主题「{0}」（topic:{1}），这个主题想弄懂：", t['title'], t['id']) + str(t['question'][:400]) if t else tr("在默认对话里，不属于任何主题"), before.get("text") or tr("（还没有存过）"), tr("主题档案（主会话维护，供参考）：\n{0}\n\n", (t.get("notes") or "").strip() or tr("（空）")) + str(tr("主干路线：") + "；".join(f"{i + 1}.{s['title']}" + {"done": "✓", "now": tr("（现在）")}.get(s.get("state"), "") for i, s in enumerate(route)) + "\n\n" if route else "")
                   if t else "") + str("\n\n".join(reversed(said))))

    def rpc_organize(self, path):
        """Tidy something the learner just wrote, in the background."""
        _, rel = self.lattice.resolve(path)
        if rel is None or rel.startswith(APPEND_ONLY):
            raise ValueError(tr("只整理学习库里自己写的文件"))
        thread, conn = self._organizer()
        if thread in self.busy:
            raise ValueError(tr("上一次整理还没结束"))
        if not conn["api_key"]:
            raise ValueError(tr("请先在设置里给整理助手填写 {0} 的 API Key", conn['label']))
        self.commit_mine()
        definition = agents.load(self.root, "organizer")
        message = tr("学习者刚写完 {0}，请整理。", rel)
        self.lattice.append_message(thread, "user", message, {"agent": "organizer", "file": rel})
        system = agents.system_prompt(self.root, definition, tr("现在是 {0}。", tools.today()))
        self._turn("organizer", thread, self.lattice.active_topic(), None, conn, system, [], message, definition["tools"])
        return {"thread": thread}
