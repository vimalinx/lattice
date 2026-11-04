"""The bridge: agents and their conversations."""
from __future__ import annotations

from ..i18n import tr

import json
from pathlib import Path
import re
import time
from datetime import datetime, timedelta
from PySide6.QtCore import QTimer, Slot
from .. import agents, annotations, skills, tools
from ..index import dump, uid
from ..model import BY_STATE, FIRST_STATE, text
from ..providers import AGENT_NAMES, ApiWorker
from ..vault import VaultError

from .common import IMAGE_EXT, LOG, TEXT_EXT, USAGE_LOG


class TurnsPart:
    # ---- agents -------------------------------------------------------------------------------------------
    def rpc_chat(self, agent=None, topic=None, thread=None, space=None):
        """One conversation as an AI panel shows it; a quick answer's is its working state's (space)."""
        l = self.lattice
        if not thread:
            topic = l.active_topic() if topic is None else (topic or None)
            thread = l.thread_for(agent, topic, space)
        head = l.thread_head(thread)
        decisions = {e["data"].get("suggestion"): e["data"].get("decision") for e in l.journal("wrote", ref=thread, limit=200) if e["data"].get("suggestion")}
        # Questions of this conversation answered in another one (the quick-answer side checks them, not the tutor).
        answers = {f"{d['message']}:{d['block']}": d["text"] for d in (e["data"] for e in l.journal("answered", ref=thread, limit=300))
                   if d.get("source") == thread and "message" in d}
        # Cards noted from each reply while learning, newest last.
        cards = {}
        for e in reversed(l.journal("carded", ref=thread, limit=300)):
            cards.setdefault(str(e["data"].get("message")), []).extend(e["data"].get("cards") or [])
        return {"thread": thread, "head": head, "messages": self.in_order(l.messages(thread)), "busy": thread in self.busy, "status": self.status.get(thread), "cards": cards,
                **({"failure": self.failures[thread]} if thread in self.failures else {}),
                "undone": sorted(l.undone()), "decisions": decisions, "answers": answers,
                "practice": l.practice(thread) if head.get("practice") else None}

    def rpc_thread_new(self, agent, topic=None, space=None):
        topic = self.lattice.active_topic() if topic is None else (topic or None)
        name = self.lattice.topic(topic)["title"] if topic else None
        if agent == "flash":
            # The quick answer starts over; it belongs to no topic.
            topic = name = None
        ident = self.lattice.thread_new(agent, topic, AGENT_NAMES[agent] + (" · " + name if name else ""),
                                        {"space": space} if agent in BY_STATE and space else None)["id"]
        if agent in ("tutor", "flash"):
            self.lattice.thread_pick(ident, space)
        return {"thread": ident}

    # ---- a topic's conversations, listed under it in the sidebar ------------------------------------
    def rpc_sessions(self, agent, topic=None, every=False, space=None):
        """One topic's conversations, or (every) all of them, each saying whether it is the one its topic opens (in the
        working state asking)."""
        l = self.lattice
        topic = l.active_topic() if topic is None else (topic or None)
        current = {}
        def is_current(s):
            if s["topic"] not in current:
                current[s["topic"]] = l.current_thread(agent, s["topic"], space)
            return current[s["topic"]] == s["id"]
        return {"topic": topic, "sessions": [{**s, "busy": s["id"] in self.busy, "current": is_current(s)} for s in l.sessions(agent, topic, every)]}

    def rpc_session_open(self, id, space=None):
        """Learn in this conversation: its topic becomes the one being learned, and it the conversation that topic opens."""
        head = self.lattice.thread_head(id)
        if head.get("agent") == "flash" and not head.get("practice") and not head.get("trial"):
            # The quick answer's conversation is about no topic: opening one leaves the topic being learned as it is, and
            # makes it the quick answer of the working state it was opened in.
            self.lattice.thread_pick(id, space)
            return {"topic": self.lattice.active_topic() or ""}
        if head.get("practice") or head.get("trial") or head.get("agent") != "tutor":
            raise ValueError(tr("练习和试用的对话不在会话列表里"))
        left = self.lattice.current_thread(head["agent"], self.lattice.active_topic(), space)
        if left != id:
            self.save_later(left)
        self.lattice.thread_pick(id, space)
        self.lattice.focus(head.get("topic"))
        return {"topic": head.get("topic") or ""}

    def rpc_session_update(self, id, title=None, archived=None):
        head = self.lattice.thread_head(id)
        if head.get("practice") or head.get("trial"):
            raise ValueError(tr("练习和试用的对话不在会话列表里"))
        change = {}
        if title is not None:
            title = text(title, 80).strip()
            change.update(title=title or head["title"], named=bool(title))
        if archived is not None:
            change["archived"] = bool(archived)
        self.lattice.thread_update(id, **change)
        return {"ok": True}

    def rpc_session_delete(self, id):
        """The learner deletes a conversation; it stays in the vault's history and can be brought back from there."""
        l, head = self.lattice, self.lattice.thread_head(id)
        if id in self.busy:
            raise ValueError(tr("这段对话正在回答；先停止"))
        rel = l.index.one("SELECT path FROM threads WHERE id=?", (id,))["path"]
        self.commit_mine()
        l.vault.commit("轨迹与对话", "lattice")
        l.vault.remove(rel)
        l.index.unindex(rel)
        l.vault.commit(f"删除会话「{head.get('title') or id}」", "me")
        return {"ok": True}

    def rpc_send(self, agent, message="", thread=None, topic=None, selection="", task="", note="", answer=None, attach=None, model=None, skill=None, effort=None, anchor=None,
                 space=None, window=None):
        r = self.send(agent, message, thread, topic, selection, task, note, answer, attach=attach, model=model, skill=skill, effort=effort, anchor=anchor,
                      space=space)
        if window and window in (self.lattice.setting("separate_windows") or {}):
            self.thread_windows[r["thread"]] = window
        else:
            self.thread_windows.pop(r["thread"], None)
        return r

    def send(self, agent, message="", thread=None, topic=None, selection="", task="", note="", answer=None, extra="", attach=None, model=None, skill=None,
             effort=None, anchor=None, space=None):
        l = self.lattice
        definition = agents.load(self.root, agent)
        practice = None
        if agent == "coach":
            practice = l.practice(thread)
            if practice["state"] != "active":
                raise ValueError(tr("这次练习已经结束"))
            topic = practice["topic"]
            message = text(message, 18000).strip() or agents.PRACTICE_TASKS.get(task, "")
        else:
            if not thread:
                topic = l.active_topic() if topic is None else (topic or None)
                thread = l.thread_for(agent, topic, space)
            else:
                topic = l.thread_head(thread).get("topic")
            if agent == "flash":
                # The quick answer's conversation belongs to no topic; it works where the learner is now.
                topic = l.active_topic()
            message = text(message, 18000).strip() or agents.TASKS.get(task, ("", ""))[0]
        if not message:
            raise ValueError(tr("请输入想说的话"))
        # The quick answer takes a second question while it answers the first (a small question of the tutor's answered
        # meanwhile, say); every other conversation answers one at a time.
        running = self._runs_of(thread)
        if running and (agent != "flash" or len(running) >= self.SIMULTANEOUS):
            raise ValueError(tr("这段对话正在回答；等它说完或先停止"))
        conn = self.config.agent(agent, use=model, effort=effort)
        if not conn["api_key"]:
            raise ValueError(tr("请先在设置里给{0}填写 {1} 的 API Key", AGENT_NAMES[agent], conn['label']))
        # A question still being answered is not part of what this one sees: the two requests then start the same, so
        # the service reads that shared start from its cache once.
        history = self._history(thread, definition["history"], skip={self.asking[r] for r in running if r in self.asking})
        run = self._free_run(thread)
        attach = [str(x)[:500] for x in (attach or []) if str(x).strip()][:12]
        picked = skills.find(self.root, skill) if skill else None
        selected_at, anchor = anchor, self._quoted_from(anchor) if selection else None
        meta = {"agent": agent, **({"selection": selection} if selection else {}), **({"anchor": anchor} if anchor else {}), **({"task": task} if task else {}), **({"answer": answer} if answer else {}),
                **({"attach": attach} if attach else {}), **({"skill": picked["slug"], "skill_title": picked["title"]} if picked else {})}
        source = str(answer.get("thread") or "") if answer else ""
        source = source if source and source != thread else ""
        self.checking.pop(run, None)
        if source:
            self.checking[run] = (source, str(answer.get("question") or "")[:400])
            # The learner answers a small question the tutor asked; the quick-answer agent checks it so the tutor's
            # explanation goes on undisturbed. The answer is noted against the tutor's conversation too.
            extra += (tr("\n\n（这是学习者在回答主会话讲解里出的一个小问题：{0}\n请判断回答对不对、哪里对哪里偏，点出关键的一两句；简短。不要接着往下讲主会话的主线，主会话会接着讲。）", str(answer.get("question") or "")[:1500]))
        asked = l.append_message(thread, "user", message, meta)
        if agent == "flash" and anchor and not answer:
            self._mount(selected_at, selection, asked, message)
        l.record("answered" if answer else "asked", {"text": message[:600], "agent": agent, "topic": topic, **({"question": answer.get("question", "")[:400]} if answer else {}),
                                                    **({"source": source, "message": answer.get("message"), "block": answer.get("block")} if source else {}),
                                                    **({"screen": note[:300]} if note else {})}, "me", [thread, *([source] if source else []), *([topic] if topic else [])])
        user, system = self._compose(definition, thread, topic, practice, message, task, selection, attach, note, extra, picked, anchor)
        self.asking[run] = asked
        self._turn(agent, thread, topic, thread if practice else None, conn, system, history, user, definition["tools"], picked, run)
        return {"thread": thread, "state": "queued", "run": run, "question": asked}

    SIMULTANEOUS = 3

    def _runs_of(self, thread):
        return [run for run, of in self.active_runs.items() if of == thread]

    def _free_run(self, thread):
        return thread if thread not in self.active_runs else f"{thread}~{uid()[:6]}"

    def _mount(self, anchor, selection, message, question):
        """A question about selected words stays with those words. A place that cannot be kept does not stop the question."""
        try:
            self._annotated(annotations.add(self.lattice, anchor["source"], {**anchor, "text": selection}, ask={"message": message, "question": question[:600]}))
        except (ValueError, VaultError, OSError) as exc:
            LOG.warning("could not keep where a question was asked: %s", exc)

    def _quoted_from(self, anchor):
        """Where a selection came from, as a message keeps it. The words themselves are the message's selection."""
        if not isinstance(anchor, dict) or not anchor.get("source"):
            return None
        try:
            source = annotations.source_of(self.lattice, anchor["source"])
        except (ValueError, VaultError):
            return None
        kept = annotations.clean(anchor)
        kept["at"].pop("rects", None)
        del kept["text"]
        return {"source": source, **kept}

    def _compose(self, definition, thread, topic, practice, message, task, selection, attach, note, extra="", skill=None, anchor=None):
        """The learner's turn as the model gets it, and the system prompt around it."""
        l = self.lattice
        user = agents.task_prompt(message, task) + extra
        if skill:
            # The learner picked a skill for this message: its whole way of working comes with it, so no lookup is needed.
            user += tr("\n\n（学习者要求这一轮按技能「{0}」来做。完整做法如下，照着做；说明里提到的附带文件用 skill 工具的 file 读。）\n\n", skill["title"]) + str(skills.instructions(skill))
            l.record("skill", {"skill": skill["slug"], "title": skill["title"], "by": "learner"}, "me", [thread])
        # Short text attachments (a long paste among them) come with the message; larger files and the rest are listed
        # to be read when needed. Images are named, but their content cannot be seen.
        inline, listed, images = [], [], []
        for rel in attach or []:
            suffix = Path(rel).suffix.lower()
            if suffix in IMAGE_EXT:
                images.append(rel)
                continue
            try:
                content = l.vault.read_text(rel) if suffix in TEXT_EXT and l.vault.path(rel).stat().st_size <= 60_000 else None
            except (OSError, UnicodeDecodeError, VaultError):
                content = None
            (inline.append((rel, content)) if content is not None and len(content) <= 30_000 else listed.append(rel))
        flash = definition["name"] == "flash"
        notes = tr("；").join(x for x in ("" if flash else note.strip(), (tr("附上了这些文件，需要时用 read 读：") + str("、".join(listed))) if listed else "",
                                      (tr("附上了图片（你看不到图里的内容，需要时请学习者描述）：") + str("、".join(images))) if images else "",
                                      ((tr("选中了这段内容{0}：\n", tr("（出自 {0}，要看前后文就读那里）", annotations.describe(l, anchor['source'], anchor)) if anchor else "") + str(selection.strip()[:5000])) if selection.strip() else "")) if x)
        if notes:
            user += tr("\n\n（界面附注：{0}）", notes)
        if definition["name"] == "tutor":
            user += self._since(thread, topic)
        if flash:
            user += "\n\n（" + self.tab_directory(thread) + "）"
            where = (tr("快答不属于哪个主题或主会话，学习者在哪里有小问题就在这里问。") + str(tr("学习者现在在学的主题是「{0}」（topic:{1}）。", l.topic(topic)['title'], topic) if topic else tr("学习者现在在默认对话里，没有在学哪个主题。")))
        else:
            where = self._topic_brief(definition["name"], thread, topic) if topic else tr("这是默认对话，不属于任何主题。")
        if definition["name"] in ("tutor", "coach") and self.config.read()["ui"].get("ai_annotate") == "asked":
            where += tr("（学习者把 AI 批注设成了只在 TA 开口要求时才留：TA 没要求就不要用 annotate。）")
        # The route and the archive change often, so they come with the message, after the history: services cache the start
        # of a request, and anything changing before the history would make all of it count as new.
        user += tr("\n\n（现在的情况：{0}）", where.strip())
        for rel, content in inline:
            user += tr("\n\n（学习者附上的「{0}」，全文如下）\n```\n{1}\n```", rel, content)
        context = tr("现在是 {0}。对话 id：{1}。", tools.today(), thread) + str(self._imported(thread)) + str(self._earlier(thread, definition["history"]))
        if practice:
            context += (tr("\n\n这次练习：practice:{0}「{1}」，练习文件：{2}。{3}\n\n练习依据的讲解：\n", thread, practice['title'], practice['file'], tr("\n目标：") + str(practice['goal']) if practice.get("goal") else "") + str(practice["seed"]))
        return user, agents.system_prompt(self.root, definition, context)

    def _topic_brief(self, agent, thread, topic):
        """What the topic as a whole is about, for each of its conversations: its question, where the route stands,
        its archive and, for the tutor, what its other conversations are on."""
        l, t = self.lattice, self.lattice.topic(topic)
        lines = [tr("这段对话属于主题「{0}」（topic:{1}），这个主题想弄懂：", t['title'], topic) + str(t['question'][:300])]
        route = t.get("route") or []
        if route:
            now = next((i for i, s in enumerate(route) if s.get("state") == "now"), None)
            lines.append(tr("主干路线 {0} 站{1}：", len(route), tr("，现在在第 {0} 站「{1}」", now + 1, route[now]['title']) if now is not None else "") + str(tr("；").join(f"{i + 1}.{s['title']}" + ("✓" if s.get("state") == "done" else "") for i, s in enumerate(route))))
        if t.get("notes", "").strip():
            lines.append(tr("主题档案（节选）：") + str(re.sub(r"\s+", " ", t["notes"]).strip()[:1200]))
        if agent == "tutor":
            others = [x for x in l.sessions("tutor", topic) if x["id"] != thread and not x["archived"] and x["messages"]][:6]
            if others:
                lines.append(tr("这个主题下的其他主会话（要细看用 conversation 的 thread 读）：") + str(tr("；").join(tr("「{0}」(thread {1}，{2} 条，{3})", x['title'], x['id'], x['messages'], tr("存档摘要：{0}", x['summary'][:300]) if x["summary"] else tr("最近问：{0}；最近讲的开头：{1}", x['last'][:60], x['answer'][:120])) for x in others)))
        return "\n".join(lines) + "\n"

    def _imported(self, thread):
        """A conversation brought in from another AI: which part was said there, so the tutor goes on from it as itself."""
        found = self.lattice.thread_head(thread).get("imported")
        if not found:
            return ""
        return (tr("\n\n这段对话开头的 {0} 条是学习者从 {1} 导入的（{2}）：那里的回答是另一个 AI 说的，不是你。学习者想在这里接着聊；先接住那边讲到的地方和 TA 最后的问题，用你自己的方式往下讲，那边讲错或讲得不清楚的地方直接指出来。", found.get('count', 0), found.get('source'), found.get('url')))

    def _earlier(self, thread, history):
        """What a conversation said before the stretch the model sees: its saved summary, once it runs past that stretch."""
        l = self.lattice
        saved = (l.thread_head(thread).get("summary") or {}).get("text")
        count = l.index.one("SELECT COUNT(*) AS n FROM messages WHERE thread=?", (thread,))["n"]
        if not saved or count <= history:
            return ""
        return tr("\n\n这段对话比你看到的长；更早的部分存档时的摘要（要细看用 conversation 读）：\n") + str(saved)

    def _since(self, thread, topic):
        """What the learner did since the tutor last spoke, which says where they are unsure: the questions they put to
        the quick-answer agent beside it, what it handed over, and how the small questions the tutor asked were judged."""
        l = self.lattice
        last = l.index.one("SELECT at FROM messages WHERE thread=? AND role='assistant' ORDER BY id DESC LIMIT 1", (thread,))
        if not last:
            return ""
        # The quick answer belongs to no topic: what was put to it while this topic was the one being learned.
        here = [e for e in l.journal(["asked", "action"], None, last["at"], limit=60)
                if e["data"].get("agent", e["actor"]) == "flash" and (e["data"].get("topic") or None) == topic]
        asked = [e["data"].get("text", "") for e in here if e["type"] == "asked"][:8]
        judged = l.journal("judged", thread, last["at"], limit=6)
        handed = [e["data"]["handoff"] for e in here if e["data"].get("handoff")][:4]
        parts = []
        marked = [e for e in l.journal("annotated", None, last["at"], actor="me", limit=20) if (e["data"].get("topic") or None) == topic][:6]
        if marked:
            parts.append(tr("标下了") + str(tr("；").join(tr("「{0}」", e['data'].get('text', '')[:80]) + (tr("（TA 写：{0}）", e['data']['note'][:120]) if e["data"].get("note") else "") for e in reversed(marked))))
        if asked:
            parts.append(tr("在快答里问了") + str(tr("；").join(tr("「{0}」", q[:160]) for q in reversed(asked))))
        if handed:
            parts.append(tr("快答判断 TA 缺一整块基础，转交给你：") + str(tr("；").join(h[:400] for h in reversed(handed))))
        if judged:
            parts.append(tr("答了你出的小题，快答的判断是") + str(tr("；").join(tr("「{0}」：{1}", e['data'].get('question', '')[:80], e['data'].get('text', '')[:240]) for e in reversed(judged))))
        built = l.journal("built", thread, last["at"], limit=4)
        apps = tr("；").join({"done": tr("做好了"), "partial": tr("做到一半断了（已保存的版本能打开）")}.get(e["data"]["state"], tr("没做成")) + tr("「{0}」（{1}）：", e['data']['title'], e['data']['file']) + f"{e['data'].get('summary', '')[:400]}"
                        for e in reversed(built))
        return (((tr("\n\n（上次回复之后，学习者{0}。这些说明 TA 现在哪里还不熟。）", "。".join(parts))) if parts else "")
                + (tr("\n\n（你请应用助手做的应用：{0}。做好的已经在学习者那边打开了。）", apps) if apps else ""))

    @staticmethod
    def in_order(msgs):
        """Each question followed by its answers. Two questions to the quick answer are answered at once and the second
        may finish first: the record keeps the order things happened in, the conversation reads question by question."""
        ids = {m["id"] for m in msgs}
        replies = {}
        for m in msgs:
            to = m["meta"].get("reply_to") if m["role"] == "assistant" else None
            if to in ids:
                replies.setdefault(to, []).append(m)
        out = []
        for m in msgs:
            if m["role"] == "assistant" and m["meta"].get("reply_to") in ids:
                continue
            out.append(m)
            if m["role"] == "user":
                out += replies.get(m["id"], [])
        return out

    def _history(self, thread, limit, before=None, skip=()):
        """What the model sees of a conversation. A reply that broke off and was then answered again stays in the record
        (conversations are append-only) but is left out here, so the model reads one answer per question; a question
        still being answered (skip) is left out too."""
        if not limit:
            return []
        msgs = self.lattice.messages(thread)
        msgs = self.in_order([m for m in (msgs if before is None else msgs[:before]) if m["id"] not in skip])
        kept = [m for i, m in enumerate(msgs) if not (m["role"] == "assistant" and i + 1 < len(msgs)
                                                      and msgs[i + 1]["role"] == "assistant" and msgs[i + 1]["meta"].get("retry"))]
        # At least the last `limit`, starting at a place that moves in steps of half of that: while it stays put the
        # request starts the same as the last one, and the service counts all of it as already read.
        step = max(1, limit // 2)
        return kept[max(0, len(kept) - limit) // step * step:]

    def rpc_retry(self, thread, note="", model=None, effort=None):
        """Answer the last question again after its reply was stopped, cut off or failed, without asking it twice."""
        l = self.lattice
        if thread in self.busy:
            raise ValueError(tr("这段对话正在回答；等它说完或先停止"))
        msgs = l.messages(thread)
        last = next((i for i in range(len(msgs) - 1, -1, -1) if msgs[i]["role"] == "user"), None)
        if last is None:
            raise ValueError(tr("这段对话里还没有可以重新回答的问题"))
        question, head = msgs[last], l.thread_head(thread)
        meta = question["meta"]
        agent = meta.get("agent") or head.get("agent") or "tutor"
        practice = l.practice(thread) if head.get("practice") else None
        if practice and practice["state"] != "active":
            raise ValueError(tr("这次练习已经结束"))
        topic = practice["topic"] if practice else head.get("topic")
        definition = agents.load(self.root, agent)
        conn = self.config.agent(agent, use=model, effort=effort)
        if not conn["api_key"]:
            raise ValueError(tr("请先在设置里给{0}填写 {1} 的 API Key", AGENT_NAMES[agent], conn['label']))
        picked = None
        if meta.get("skill"):
            try:
                picked = skills.find(self.root, meta["skill"])
            except ValueError:
                picked = None
        user, system = self._compose(definition, thread, topic, practice, question["content"], meta.get("task", ""), meta.get("selection", ""),
                                     meta.get("attach") or [], note, "", picked, meta.get("anchor"))
        self.retrying.add(thread)
        self.asking[thread] = question["id"]
        self._turn(agent, thread, topic, thread if practice else None, conn, system, self._history(thread, definition["history"], last), user,
                   definition["tools"], picked)
        return {"thread": thread, "state": "queued", "run": thread, "question": question["id"]}

    def _turn(self, agent, thread, topic, practice, conn, system, history, user, allowed, picked=None, run=None):
        run = run or thread
        if conn.get("notice"):
            self.announce({"type": "notice", "message": conn["notice"]})
        messages = [{"role": "system", "content": system}]
        messages += [{"role": m["role"], "content": m["content"]} for m in history if m["role"] in ("user", "assistant")]
        messages.append({"role": "user", "content": user})
        # A skill picked for this message may come with files, read through the tool, whatever the agent has otherwise.
        allowed = [*allowed, "skill"] if picked and "skill" not in allowed else allowed
        old = self.workers.get(run)
        if old and old.isRunning():
            self._retire(old)
        worker = ApiWorker(agent, run, conn, messages, tools=tools.schemas(allowed))
        worker.event.connect(self.api_event)
        self.workers[run] = worker
        self.contexts[run] = (agent, topic, practice, set(allowed))
        self.turns[run] = tools.Turn()
        if picked:
            self.turns[run].skills.append({"slug": picked["slug"], "title": picked["title"], "picked": True})
        self.active_runs[run] = thread
        self.busy.add(thread)
        self.status[thread] = "connecting"
        worker.start()

    @staticmethod
    def _record_usage(agent, thread, usage):
        """Every finished turn's token counts, on this computer (not in the vault, which would get a commit each time)."""
        if not usage:
            return
        row = {"at": datetime.now().astimezone().isoformat(timespec="seconds"), "agent": agent, "thread": thread, **usage}
        try:
            USAGE_LOG.parent.mkdir(parents=True, exist_ok=True)
            with USAGE_LOG.open("a", encoding="utf-8") as log:
                log.write(json.dumps(row, ensure_ascii=False) + "\n")
        except OSError as exc:
            LOG.warning("could not record token usage: %s", exc)

    def rpc_usage(self):
        """Token counts added up: today, the last 7 and 30 days, everything; by model, by agent, and day by day."""
        keys = ("input", "output", "cached", "reasoning", "requests", "estimated")
        blank = lambda: dict.fromkeys(keys, 0)
        today = datetime.now().astimezone().date()
        periods = {"today": blank(), "week": blank(), "month": blank(), "all": blank()}
        models, agents, days = {}, {}, {(today - timedelta(days=i)).isoformat(): blank() for i in range(13, -1, -1)}
        try:
            lines = USAGE_LOG.read_text(encoding="utf-8").splitlines()
        except OSError:
            lines = []
        first = None
        for line in lines:
            try:
                row = json.loads(line)
                day = datetime.fromisoformat(row["at"]).date()
            except (ValueError, KeyError, TypeError):
                continue
            first = first or row["at"]
            age = (today - day).days
            model = f"{row.get('model') or tr('未知模型')}" + (f" · {row['api']}" if row.get("api") else "")
            targets = [periods["all"], models.setdefault(model, blank()), agents.setdefault(row.get("agent") or "?", blank())]
            targets += [periods[k] for k, n in (("today", 0), ("week", 6), ("month", 29)) if age <= n]
            if day.isoformat() in days:
                targets.append(days[day.isoformat()])
            for target in targets:
                for key in keys:
                    target[key] += int(row.get(key) or 0)
        rank = lambda table: sorted(({"name": k, **v} for k, v in table.items()), key=lambda r: -(r["input"] + r["output"]))
        return {"periods": periods, "models": rank(models), "agents": rank(agents), "days": [{"day": k, **v} for k, v in days.items()], "since": first}

    def rpc_cancel(self, thread, run=None):
        """Stop a reply (run), or every reply under way in the conversation."""
        for key in ([run] if run else self._runs_of(thread) or [thread]):
            worker = self.workers.get(key)
            if worker:
                worker.stop()
        return True

    @Slot(dict)
    def api_event(self, evt):
        if self.closing:
            return
        run = thread = evt.get("thread")
        if run in self.active_runs:
            # A reply says which conversation it belongs to, and which of the replies under way there it is.
            thread = self.active_runs[run]
            evt = {**evt, "thread": thread, "run": run, **({"question": self.asking[run]} if run in self.asking else {})}
        if evt["kind"] == "tool_call":
            worker = self.workers.get(run)
            self.run_tool(run, evt["name"], evt["arguments"], lambda content, w=worker, c=evt["call_id"]: w and w.tool_result(c, content))
            return
        if str(thread).startswith("compare:"):
            # One side of a skill comparison: nothing is written to a conversation until the learner picks it.
            if evt["kind"] == "finished":
                self._record_usage(evt.get("agent"), thread, evt.get("usage"))
                ident, side = thread.split(":")[1:3]
                found = self.compares.get(ident)
                if found:
                    found[side] = {"text": evt.get("text", ""), "done": True, "stop_reason": evt.get("stop_reason")}
                    # Both sides written: kept with the proposal it tried, so its review shows it again later.
                    if all((found.get(s) or {}).get("done") for s in ("a", "b")):
                        self.lattice.record("skill_compare_done", {"compare": ident, "change": found.get("change"), "skill": found["skill"], "thread": found["thread"],
                                                                   "question": found["question"][:2000], "a": found["a"]["text"], "b": found["b"]["text"]},
                                            "me", ["compare:" + ident, *(["skillchange:" + found["change"]] if found.get("change") else [])])
                # The thread is still winding down when it reports finishing; it is let go only once it has stopped.
                self._retire(self.workers.pop(thread, None))
            self.announce(evt)
            return
        if evt["kind"] == "status":
            self.status[thread] = evt.get("state", "")
        elif evt["kind"] == "finished":
            self._finish(evt)
        elif evt["kind"] == "error":
            self.status[thread] = "error"
            # Kept, so a question left without an answer still says why after the conversation is reopened.
            self.failures[thread] = {"message": str(evt.get("message") or "")[:600], "at": time.strftime("%H:%M")}
        elif evt["kind"] == "connection_test" and evt.get("ok") and evt.get("models") and evt.get("api"):
            self.config.remember_models(evt["api"], evt["models"])
        self.announce(evt)

    def run_tool(self, run, name, arguments, reply):
        """Execute one agent tool call on the GUI thread and hand the JSON result back."""
        agent, topic, practice, allowed = self.contexts.get(run, (None, None, None, set()))
        if not agent:
            return reply(dump({"error": tr("这个会话不能使用工具")}))
        thread = self.active_runs.get(run, run)
        # The learner's pending edits get their own commit, so an agent's commit holds only its change.
        self.commit_mine()
        turn = self.turns.setdefault(run, tools.Turn())
        ctx = tools.Context(self, agent, thread, turn.focus if turn.refocus else topic, practice, turn)
        before = len(turn.actions)

        def answer(result):
            actions = turn.actions[before:]
            self.announce({"type": "agent", "kind": "tool", "agent": agent, "thread": thread, "run": run, "name": name, "actions": actions,
                           "failed": isinstance(result, dict) and "error" in result})
            reply(dump(result))
        try:
            args = json.loads(arguments or "{}") if isinstance(arguments, str) else (arguments or {})
            result = tools.call(ctx, allowed, name, args)
        except Exception as exc:
            LOG.info("tool %s failed: %s", name, exc)
            result = {"error": str(exc)}
        if isinstance(result, tools.Later):
            # A tool that takes a while (installing, running, a command, the web): the reply says what it is doing.
            self.announce({"type": "agent", "kind": "tool_wait", "agent": agent, "thread": thread, "run": run, "name": name, "detail": self._tool_detail(name, args),
                           **({"gpu": True} if isinstance(args, dict) and args.get("gpu") else {})})
            try:
                result.start(answer)
            except Exception as exc:
                answer({"error": str(exc)})
        else:
            answer(result)

    @staticmethod
    def _tool_detail(name, args):
        """A few words on what a waiting tool is working on: the packages, the command, the search, the page, the file."""
        a = args if isinstance(args, dict) else {}
        found = {"install": "、".join(str(p) for p in (a.get("packages") or [])) + (tr("（环境 {0}）", a['env']) if a.get("env") and a.get("env") != "default" else ""),
                 "shell": a.get("command"), "run": a.get("file"), "web_search": a.get("query"), "web_fetch": a.get("url")}.get(name) or ""
        return str(found).strip()[:160]

    def _finish(self, evt):
        l = self.lattice
        thread, agent = evt["thread"], evt["agent"]
        run = evt.get("run") or thread
        self.active_runs.pop(run, None)
        question = self.asking.pop(run, None)
        others = self._runs_of(thread)
        if not others:
            self.busy.discard(thread)
        retried = thread in self.retrying and run == thread
        if retried:
            self.retrying.discard(thread)
        if evt.get("stop_reason", "end_turn") == "end_turn":
            self.failures.pop(thread, None)
        turn = self.turns.pop(run, tools.Turn())
        _, topic, practice, _ = self.contexts.get(run, (agent, None, None, set()))
        if run != thread:
            self.contexts.pop(run, None)
            self._retire(self.workers.pop(run, None))
        reason = evt.get("stop_reason", "end_turn")
        if not others:
            self.status[thread] = "ready" if reason == "end_turn" else reason
        body = evt.get("text", "")
        self._record_usage(agent, thread, evt.get("usage"))
        checked = self.checking.pop(run, None)
        if checked and body.strip():
            l.record("judged", {"text": body[:800], "agent": agent, "question": checked[1], "source": checked[0]}, agent, [checked[0], thread])
        sources = list({s["url"]: s for s in turn.sources if s.get("url")}.values())[:12]
        if body.strip() or turn.actions or turn.suggestions or turn.changes or evt.get("steps"):
            evt["message"] = l.append_message(thread, "assistant", body, {"agent": agent, "stop_reason": reason, "usage": evt.get("usage"),
                                                                          "actions": turn.actions, "sources": sources, "suggestions": turn.suggestions,
                                                                          **({"changes": turn.changes} if turn.changes else {}),
                                                                          **({"skills": turn.skills} if turn.skills else {}),
                                                                          **({"retry": True} if retried else {}),
                                                                          **({"reply_to": question} if question is not None else {}),
                                                                          **({"steps": evt["steps"]} if evt.get("steps") else {}),
                                                                          **({"thinking": evt["thinking"], "think_seconds": evt.get("think_seconds")} if evt.get("thinking") else {})})
        evt.update(actions=turn.actions, sources=sources, suggestions=turn.suggestions)
        errors = []
        for ident, review_thread in list(self.reviews.items()):
            if review_thread == thread:
                # finish_practice_review clears the entry; one still here means the review never landed.
                self.reviews.pop(ident, None)
                errors.append(tr("复盘没有完成，可以在练习里重新复盘") if reason != "end_turn" else tr("主会话没有记下这次复盘的结论，可以在练习里重新复盘"))
        if turn.refocus and agent == "tutor":
            target_topic = turn.focus
            if target_topic != topic:
                # The turn that created or chose another topic belongs to that topic's conversation.
                target = l.thread_for("tutor", target_topic, l.thread_head(thread).get("space") or FIRST_STATE)
                ids = [r["id"] for r in l.index.rows("SELECT id FROM messages WHERE thread=? ORDER BY id DESC LIMIT 2", (thread,))]
                l.move_messages(ids + turn.carry, target)
                evt["moved_to"] = target
                self.save_later(thread)
            l.focus(target_topic)
            evt["focus"] = target_topic or ""
        if agent == "tutor" and reason == "end_turn" and evt.get("message") and len(body.strip()) >= 200 and self.config.read().get("auto_cards", True):
            home = evt.get("moved_to") or thread
            if not {"trial", "practice"} & set(l.thread_head(home)):
                self.jobs.append({"kind": "cards", "thread": home, "message": evt["message"], "topic": evt.get("focus", topic) if turn.refocus else topic})
        build = self.builds.pop(thread, None) if agent == "builder" else None
        if build:
            self._built(build, reason, body)
        job = self.job_running.pop(thread, None) if agent == "organizer" else None
        if job and job["kind"] == "save":
            evt["saved"] = job["thread"]   # quiet: no tidying notice
            job = None
        elif job:
            evt["cards_for"] = job["thread"]   # shown under the reply it came from, not as a tidying notice
        if job and turn.cards:
            l.record("carded", {"message": job["message"], "cards": turn.cards}, "organizer", [job["thread"], *(c["id"] for c in turn.cards)])
            self.announce({"type": "cards", "thread": job["thread"], "message": job["message"], "cards": turn.cards})
        if agent == "organizer" and turn.actions and not job:
            l.record("organized", {"summary": (body.strip().splitlines() or [""])[-1][:400], "actions": [a["summary"] for a in turn.actions]},
                     agent, [a["ref"][5:] for a in turn.actions if (a.get("ref") or "").startswith("file:")][:5] + [thread])
        for job in turn.after:
            try:
                job()
            except Exception as exc:
                errors.append(str(exc))
        if errors:
            evt["errors"] = errors
        if evt.get("saved"):
            self.announce({"type": "saved", "thread": evt["saved"]})
        if agent in ("tutor", "organizer") and self.jobs:
            QTimer.singleShot(0, self.next_job)
