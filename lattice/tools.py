"""The agents' tools, in three layers: a sandboxed shell, Lattice commands, and the web.

Agents are told which tools exist and look things up themselves; nothing is
pushed into their context. Structured state (the knowledge map, routes, the
journal, insights) only changes through these commands. Every change to files
becomes its own vault commit and journal entry, so the learner can undo it
from the conversation. Learner-owned parts are never exposed for writing.
"""
from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path

from .model import AGENT_RECORDS, LINK_KINDS, readable_outputs, text, title_of
from .vault import APPEND_ONLY, kind_of, slug

ALL = {"tutor", "flash", "coach", "organizer"}


class Later:
    """A result that arrives later: `start(done)` begins the work and calls done(result) on the GUI thread."""

    def __init__(self, start):
        self.start = start


class Turn:
    """What one agent turn did, shown under its reply: actions, web sources, suggestions."""

    def __init__(self):
        self.actions, self.sources, self.suggestions, self.after, self.carry = [], [], [], [], []
        self.focus = None
        self.refocus = False


class Context:
    """Who is calling: the agent, its conversation, the topic it is about, and the turn so far."""

    def __init__(self, bridge, agent, thread, topic, practice=None):
        self.bridge, self.agent, self.thread, self.topic, self.practice = bridge, agent, thread, topic, practice
        self.l = bridge.lattice
        self.turn = bridge.turns.setdefault(thread, Turn())

    def act(self, summary, ref=None, undoable=True):
        """Record one agent action. A change to files becomes its own vault commit, so undo is a revert."""
        commit = self.l.vault.commit(f"{self.agent}：{summary}", self.agent) if undoable else None
        ident = self.l.action(self.agent, summary, ref, commit, self.topic, self.thread)
        action = {"id": ident, "summary": summary, "ref": ref, "undoable": bool(commit)}
        self.turn.actions.append(action)
        return action


def _obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


S = {"type": "string"}
I = {"type": "integer"}
LIST = {"type": "array", "items": S}
TOOLS = {}


def tool(name, agents, description, params=None, required=()):
    def wrap(fn):
        TOOLS[name] = {"agents": set(agents), "description": description, "parameters": _obj(params or {}, required), "fn": fn}
        return fn
    return wrap


def schemas(names):
    """OpenAI-compatible tool list for the tools an agent's definition names."""
    return [{"type": "function", "function": {"name": n, "description": TOOLS[n]["description"], "parameters": TOOLS[n]["parameters"]}}
            for n in names if n in TOOLS]


def call(ctx, allowed, name, args):
    spec = TOOLS.get(name)
    if not spec or name not in allowed:
        raise ValueError(f"没有可用的工具 {name}")
    if not isinstance(args, dict):
        raise ValueError("工具参数应为 JSON 对象")
    return spec["fn"](ctx, **args)


def _brief(row):
    return {k: row[k] for k in ("id", "title") if k in row}


def _path_of(ctx, ref):
    """A vault path from a path, an id or kind:id."""
    ref = str(ref).strip()
    for prefix in ("file:", "notebook:", "note:", "card:", "lesson:", "topic:", "insight:"):
        if ref.startswith(prefix):
            ref = ref[len(prefix):]
    if "/" in ref or "." in Path(ref).name:
        return ref
    located = ctx.l.index.locate(ref)
    if located:
        return located
    return ctx.l.doc(ctx.l.resolve_ref(ref))["path"]


def _guard(ctx, path):
    """Files the agents may not write directly, and files the learner is typing in right now."""
    _, rel = ctx.l.resolve(path)
    if rel is None:
        raise ValueError("挂载的外部目录对你只读；需要改的话用 suggest 提给学习者")
    if rel.startswith(APPEND_ONLY) or rel.startswith(".lattice/") or rel == "AGENTS.md" or rel.startswith("agents/"):
        raise ValueError("对话、轨迹、规则和 .lattice 只由 Lattice 和学习者维护")
    if ctx.bridge.typing(rel):
        raise ValueError("学习者正在编辑这个文件；不要直接改，用 suggest 提出修改建议")
    return rel


# ---- state ------------------------------------------------------------------------------------

@tool("screen", ALL, "学习者此刻的界面：开着哪些面板、哪个在前台、每个文件看到哪一节或哪几格、光标和选中的内容、没保存的草稿、最近看过的文件和停留时间、正在运行什么和最近一次运行的结果。")
def screen(ctx):
    return ctx.bridge.screen_state()


@tool("graph", ALL, "整张知识图：全部节点（id、种类、标题、所属主题、理解阶段、证据数、最近活动）、全部关系，以及每个主题的主干路线。给 topic 时只看这个主题和它的分支，加上直接相连的节点。用它判断学习者在哪、学过什么、该往哪走。",
      {"topic": S})
def graph(ctx, topic=None):
    g = ctx.l.graph(topic or None)
    nodes = [{k: v for k, v in n.items() if v not in (None, "", 0) or k == "evidence"} for n in g["nodes"]]
    for n in nodes:
        n["last"] = (n.get("last") or "")[:16]
    return {"nodes": nodes, "edges": [{k: e[k] for k in ("id", "source", "target", "kind") if k in e} | ({"why": e["why"]} if e.get("why") else {}) for e in g["edges"]],
            "routes": g["routes"], "active_topic": ctx.topic}


@tool("read", ALL, "读一样东西的全文。ref 可以是：文件路径（学习库里的相对路径，或挂载目录里的绝对路径；from/to 取其中几行）；文档 id 或 topic:/card:/lesson:/note:/insight:<id>（主题会带上它的路线、档案和里面的内容）；实验笔记的路径或 id（全部单元格和真实输出）；practice:<id>（练习依据、对话、练习文件和运行记录）；run:<id>（一次运行的完整输出）；message:<id>。",
      {"ref": S, "from": I, "to": I}, ["ref"])
def read(ctx, ref, **span):
    l, ref = ctx.l, str(ref).strip()
    kind, _, ident = ref.partition(":")
    if kind == "practice":
        p = l.practice(ident)
        return {**{k: p[k] for k in ("id", "title", "state", "seed", "goal", "file", "next_focus") if k in p},
                "dialogue": [{"role": m["role"], "content": m["content"]} for m in l.messages(ident)],
                "file_content": _file(ctx, p["file"]) if p.get("file") else None,
                "runs": [_run_brief(e) for e in l.journal("ran", ref=p["file"], limit=8)],
                "insights": [{k: i[k] for k in ("kind", "title", "detail", "state")} for i in p["insights"]]}
    if kind == "run":
        return {"id": ident, "outputs": readable_outputs(ctx.bridge.run_outputs(ident), 20000)}
    if kind == "message":
        row = l.index.one("SELECT m.*, t.title FROM messages m JOIN threads t ON t.id=m.thread WHERE m.id=?", (int(ident),))
        if not row:
            raise ValueError("找不到这条消息")
        return {"id": row["id"], "thread": row["thread"], "conversation": row["title"], "role": row["role"], "content": row["content"], "at": row["at"]}
    path = _path_of(ctx, ref)
    _, rel = l.resolve(path)
    k = kind_of(rel) if rel else "file"
    if k == "topic":
        t = l.topic(_id_at(l, rel))
        inside = l.index.rows("SELECT id, kind, title, path FROM docs WHERE topic=? ORDER BY kind, updated DESC", (t["id"],))
        return {**{k2: t[k2] for k2 in ("id", "title", "question", "parent", "state", "route", "path")}, "topic_notes": t["notes"],
                "contents": inside, "branches": [_brief(x) for x in l.topics() if x["parent"] == t["id"]],
                "practices": l.practices(t["id"]), "insights": l.insights(t["id"], "active")}
    if k == "card":
        c = l.card(_id_at(l, rel))
        return {**{k2: c[k2] for k2 in ("id", "path", "title", "topic", "body", "question", "tags", "stage", "due", "reviews")},
                "my_understanding": c["mine"], "note": "stage、due、reviews 和「我的理解」只由学习者填写",
                "links": [{k2: x[k2] for k2 in ("id", "source", "source_title", "target", "target_title", "kind", "why")} for x in c["links"]],
                "evidence": [_entry(e) for e in c["evidence"]]}
    if k == "notebook":
        nb = l.notebook(rel)
        state = ctx.bridge.kernel_state(nb["id"])
        return {"path": rel, "id": nb["id"], "title": nb["title"], "topic": nb["topic"], "kernel": state,
                "cells": [{"id": c["id"], "kind": c["kind"], "source": c["source"], "output": readable_outputs(c["outputs"]),
                           "output_is_stale": c["stale"], "ran": c["count"] is not None} for c in nb["cells"]]}
    if k in ("lesson", "note", "insight"):
        row = l.doc(_id_at(l, rel))
        return {"id": row["id"], "path": rel, "kind": k, "title": row["title"], "attrs": row["attrs"], "body": row["body"],
                "links": [{k2: x[k2] for k2 in ("id", "source", "target", "kind", "why")} for x in l.links_of(row["id"])]}
    return _file(ctx, path, span.get("from"), span.get("to"))


def _id_at(l, rel):
    row = l.index.one("SELECT id FROM files WHERE path=?", (rel,))
    if not row or not row["id"]:
        raise ValueError("这个文件还没有被索引：" + rel)
    return row["id"]


def _file(ctx, path, start=None, end=None):
    got = ctx.l.read_file(path, 400000)
    if got.get("binary"):
        return {"path": got["path"], "binary": True, "size": got["size"], "note": "二进制文件；可以用 shell 里的工具查看"}
    lines = got["content"].splitlines()
    if start or end:
        start, end = max(1, int(start or 1)), min(len(lines), int(end or len(lines)))
        return {"path": got["path"], "from": start, "to": end, "lines": len(lines), "content": "\n".join(lines[start - 1:end])}
    content = got["content"]
    if len(content) > 60000:
        content = content[:60000] + f"\n…（文件共 {len(lines)} 行，后面没有返回；用 from/to 读其余部分）"
    return {"path": got["path"], "lines": len(lines), "content": content}


def _entry(e):
    return {"at": e["at"][:16], "actor": e["actor"], "type": e["type"], "refs": e["refs"], "data": e["data"]}


def _run_brief(e):
    return {"at": e["at"][:16], "by": e["actor"], **{k: e["data"].get(k) for k in ("file", "cell", "state", "summary", "sandbox")}}


LIST_KINDS = ["topics", "cards", "notes", "lessons", "insights", "notebooks", "practices", "threads", "files", "projects", "envs"]


@tool("list", ALL, "列出学习库里某一类东西的全部（和界面上开着什么无关）：topics 主题、cards 知识卡（含理解阶段和是否到期）、notes 笔记、lessons 课程、insights 薄弱点和做得好的地方、notebooks 实验笔记、practices 练习、threads 全部对话、files 代码和数据文件、projects 挂载的目录（只读）、envs Python 环境和包。可以按 topic（给空字符串就是不属于任何主题的）、stage（卡片）、state、query（标题里包含）筛选。",
      {"kind": {"type": "string", "enum": LIST_KINDS}, "topic": S, "stage": S, "state": S, "query": S, "limit": I}, ["kind"])
def list_kind(ctx, kind, topic=None, stage=None, state=None, query=None, limit=200):
    if kind in ("projects", "envs"):
        return ctx.bridge.catalog(kind)
    return ctx.bridge.catalog(kind, topic=topic, stage=stage, state=state, query=query, limit=limit)


@tool("search", ALL, "在学习库里搜索：文档（主题、卡片、课程、笔记、实验笔记）的标题和正文、文件名、以往对话。返回引用和片段，再用 read 读全文。代码内容的搜索用 shell 里的 rg。", {"query": S}, ["query"])
def search(ctx, query):
    return ctx.l.search(query)


@tool("journal", ALL, "读学习轨迹（最新的在前）。types 可选：asked、answered、judged、explained、ran、viewed、wrote、staged、reviewed、detour、bridged、insight、organized、searched、installed、action。ref 筛出和某个 id 或文件路径有关的记录；since 是 ISO 日期时间。",
      {"types": LIST, "ref": S, "since": S, "actor": S, "limit": I})
def journal(ctx, types=None, ref=None, since=None, actor=None, limit=40):
    return [_entry(e) for e in ctx.l.journal(types, ref, since, None, actor, min(int(limit), 200))]


@tool("conversation", ALL, "读一段对话的最近消息（带消息 id）。agent 是 tutor（主会话）或 flash（快答），topic 不给就是当前主题，给空字符串就是默认对话；或者直接给 thread（例如练习的 id）。",
      {"agent": {"type": "string", "enum": ["tutor", "flash", "coach"]}, "topic": S, "thread": S, "limit": I})
def conversation(ctx, agent="tutor", topic=None, thread=None, limit=12):
    ident = thread or ctx.l.thread_for(agent, ctx.topic if topic is None else (topic or None))
    rows = ctx.l.messages(ident, max(1, min(int(limit), 60)))
    return {"thread": ident, "messages": [{"id": m["id"], "role": m["role"], "content": m["content"][:8000], "at": m["at"][:16]} for m in rows]}


@tool("due", ALL, "现在到期、需要回顾的知识卡。要回顾时用 lattice:cards 展示块（review 设为 true），自评由学习者自己点。")
def due(ctx):
    return [{k: c[k] for k in ("id", "title", "question", "due", "stage", "topic")} for c in ctx.l.due_cards()]


# ---- the shell ------------------------------------------------------------------------------------

@tool("shell", {"tutor", "coach", "organizer"}, "在沙箱里运行一条 bash 命令，工作目录是学习库：用来查看、搜索、分析和按规矩组织文件（ls、rg、cat、head、git log、python…）。学习库可写，挂载的外部目录只读，不联网，看不到家目录的其余部分。Python 用学习库的环境。命令有时限，输出过长会截断。命令改动的文件会作为一次可撤销的操作提交；改到只归学习者的部分会被自动退回。",
      {"command": S, "timeout": I}, ["command"])
def shell(ctx, command, timeout=None):
    command = text(command, 20000)
    bridge = ctx.bridge
    limit = max(3, min(int(timeout or bridge.config.read()["shell_timeout"]), 600))

    def start(done):
        def finish(result):
            if isinstance(result, Exception):
                return done({"error": str(result)})
            restored = ctx.l.police()
            changed = [rel for _, rel in ctx.l.vault.changes()]
            ctx.l.index.sync()
            if changed:
                ctx.act(f"用命令行改了 {len(changed)} 个文件", "file:" + changed[0] if len(changed) == 1 else None)
                bridge.changed(changed)
            done({**result, "changed_files": changed[:50], **({"restored": restored} if restored else {})})
        bridge.background(lambda: bridge.agent_shell(command, limit), finish)
    return Later(start)


# ---- the web --------------------------------------------------------------------------------------

@tool("web_search", {"tutor", "flash", "coach"}, "联网搜索。返回标题、链接和摘要；需要细读时用 web_fetch。什么时候需要查、信哪个来源由你判断；用到的内容在回复里注明出处。", {"query": S}, ["query"])
def web_search(ctx, query):
    from . import web

    def start(done):
        def finish(result):
            if isinstance(result, Exception):
                return done({"error": "搜索失败：" + str(result)})
            ctx.l.record("searched", {"query": result["query"], "backend": result["backend"], "urls": [r["url"] for r in result["results"]][:8]},
                         ctx.agent, [ctx.thread])
            ctx.turn.sources += [{"title": r["title"], "url": r["url"]} for r in result["results"][:5]]
            done(result)
        ctx.bridge.background(lambda: web.search(ctx.bridge.config.read()["web"], query), finish)
    return Later(start)


@tool("web_fetch", {"tutor", "flash", "coach"}, "读一个网页的正文（转成纯文本，过长会截断）。不能读本机和局域网地址。", {"url": S}, ["url"])
def web_fetch(ctx, url):
    from . import web

    def start(done):
        def finish(result):
            if isinstance(result, Exception):
                return done({"error": "读取失败：" + str(result)})
            ctx.l.record("searched", {"url": result["url"], "title": result["title"]}, ctx.agent, [ctx.thread])
            ctx.turn.sources.append({"title": result["title"] or result["url"], "url": result["url"]})
            done(result)
        ctx.bridge.background(lambda: web.fetch(url), finish)
    return Later(start)


# ---- topics and the map ---------------------------------------------------------------------------

@tool("create_topic", {"tutor"}, "新建一个学习主题；parent 给出时作为那条主线下的分支。这一轮结束时界面会切到它，这一轮的问答会归到它下面。carry_ids 是要一起带过去的更早消息的 id（先用 conversation 看清哪些问答属于这个主题，提问和回答都要带上；别的话题的消息留在原处）。route 可以顺便给出主干路线。",
      {"title": S, "question": S, "parent": S, "carry_ids": {"type": "array", "items": I},
       "route": {"type": "array", "items": _obj({"title": S, "ref": S, "why": S}, ["title"])}}, ["title", "question"])
def create_topic(ctx, title, question, parent=None, carry_ids=(), route=None):
    t = ctx.l.topic_save({"title": title, "question": question, "parent": parent or None, **({"route": route} if route else {})}, ctx.agent)
    ctx.turn.focus, ctx.turn.refocus = t["id"], True
    ctx.turn.carry = [int(i) for i in carry_ids][:200]
    ctx.act(("开了分支" if parent else "新建了主题") + f"「{t['title']}」", "topic:" + t["id"])
    return {"id": t["id"], "title": t["title"], "path": t["path"]}


@tool("focus_topic", {"tutor"}, "把焦点切到另一个已有主题（给空字符串就是回到默认对话）。这一轮结束时界面会切过去，这一轮的问答也会归到它下面；carry_ids 是要一起带过去的更早消息的 id（比如你刚出的题和学习者之前的提问），用法同 create_topic。",
      {"topic": S, "carry_ids": {"type": "array", "items": I}}, ["topic"])
def focus_topic(ctx, topic, carry_ids=()):
    t = ctx.l.topic(topic) if topic else None
    ctx.turn.focus, ctx.turn.refocus = (t["id"] if t else None), True
    ctx.turn.carry = [int(i) for i in carry_ids][:200]
    ctx.act(f"切换到主题「{t['title']}」" if t else "回到默认对话", "topic:" + t["id"] if t else None, False)
    return {"id": t["id"], "title": t["title"]} if t else {"default_conversation": True}


@tool("update_topic", {"tutor"}, "更新一个主题（不给 topic 就是当前主题）：notes 整篇替换主题档案（讲到了哪里、学习者留下的疑问、接下来往哪走；这是跨天续讲的记忆，保持精炼）；也可以改 question 和 state（active / parked / completed）。",
      {"topic": S, "notes": S, "question": S, "state": {"type": "string", "enum": ["active", "parked", "completed"]}})
def update_topic(ctx, topic=None, notes=None, question=None, state=None):
    ident = topic or ctx.topic
    if not ident:
        raise ValueError("默认对话没有主题档案；先建一个主题")
    change = {k: v for k, v in (("notes", notes), ("question", question), ("state", state)) if v is not None}
    t = ctx.l.topic_save({"id": ident, **change}, ctx.agent)
    ctx.act("更新了主题档案" if notes is not None else "更新了主题", "topic:" + ident)
    return {"id": t["id"], "title": t["title"]}


@tool("route", {"tutor"}, "写下或调整一个主题的主干路线：按顺序给出全部关键节点（整条替换）。每一站有 title，可以用 ref 指向已有的卡片、课程或文件，why 说明这一站为什么在这里。",
      {"topic": S, "steps": {"type": "array", "items": _obj({"title": S, "ref": S, "why": S}, ["title"])}}, ["steps"])
def route(ctx, steps, topic=None):
    ident = topic or ctx.topic
    if not ident:
        raise ValueError("默认对话没有路线；先建一个主题")
    for step in steps:
        if step.get("ref"):
            step["ref"] = ctx.l.resolve_ref(step["ref"])
    ctx.l.topic_save({"id": ident, "route": steps}, ctx.agent)
    ctx.act(f"把主干路线定为 {len(steps)} 站", "topic:" + ident)
    return {"topic": ident, "steps": len(steps)}


@tool("link", {"tutor", "organizer"}, "在知识图上加一条关系。source 是一个文档（主题、卡片、课程、笔记），target 是另一个文档或 file:<路径>；都可以用 id 或标题。kind：prerequisite（source 是 target 的前置）、part_of（source 是 target 的一部分）、related、applies_to、contrasts、explains（source 解释了 target 的什么，岔路接回主干时用）。why 写清理由。",
      {"source": S, "target": S, "kind": {"type": "string", "enum": sorted(LINK_KINDS)}, "why": S}, ["source", "target", "kind"])
def link(ctx, source, target, kind, why=""):
    ident = ctx.l.link(source, target, kind, why, ctx.agent)
    ctx.act(f"在知识图上加了一条「{kind}」关系", None)
    return {"id": ident}


@tool("unlink", {"tutor", "organizer"}, "去掉知识图上的一条关系（id 来自 graph 或 read）。", {"id": S}, ["id"])
def unlink(ctx, id):
    ctx.l.unlink(id[2:] if id.startswith("r:") else id)
    ctx.act("去掉了一条关系")
    return {"ok": True}


@tool("save_knowledge", {"tutor", "organizer"}, "把已经讲过、学习者也回应过的内容存进学习库（直接保存，学习者可以撤销）。lessons 是值得以后回看的完整讲解；cards 一张一个脱离对话也成立的知识点（已有同名卡时内容作为补充附在后面）；notes 是依赖情境的经验；relations 同 link。都归到当前主题下。",
      {"lessons": {"type": "array", "items": _obj({"title": S, "objective": S, "body": S}, ["title", "body"])},
       "cards": {"type": "array", "items": _obj({"title": S, "body": S, "question": S, "tags": LIST}, ["title", "body"])},
       "notes": {"type": "array", "items": _obj({"title": S, "body": S, "folder": S}, ["title", "body"])},
       "relations": {"type": "array", "items": _obj({"source": S, "target": S, "kind": S, "why": S}, ["source", "target", "kind"])}})
def save_knowledge(ctx, lessons=(), cards=(), notes=(), relations=()):
    l, done = ctx.l, {"lessons": [], "cards": [], "supplements": [], "notes": [], "relations": []}
    if len(lessons) > 5 or len(cards) > 10 or len(notes) > 5 or len(relations) > 30:
        raise ValueError("一次最多 5 节课、10 张卡、5 篇文档、30 条关系")
    if not (lessons or cards or notes or relations):
        raise ValueError("没有可以保存的内容")
    for item in lessons:
        done["lessons"].append(l.lesson_save({**item, "topic": ctx.topic}, ctx.agent)["id"])
    for item in cards:
        existed = l.index.one("SELECT id FROM docs WHERE kind='card' AND lower(title)=lower(?)", (title_of(item["title"]),))
        card = l.card_save({**item, "topic": ctx.topic, "stage": "seen"}, ctx.agent)
        done["supplements" if existed else "cards"].append(card["id"])
    for item in notes:
        rel = l.note_create(item["title"], item["body"], item.get("folder") or "经验", ["AI"], ctx.agent, ctx.topic)
        done["notes"].append(rel)
    for r in relations:
        done["relations"].append(l.link(r["source"], r["target"], r["kind"], r.get("why", ""), ctx.agent))
    parts = [f"{len(done[k])} {n}" for k, n in (("lessons", "节课"), ("cards", "张卡"), ("supplements", "条卡片补充"),
                                                ("notes", "篇经验文档"), ("relations", "条关系")) if done[k]]
    first = ("lesson:" + done["lessons"][0]) if done["lessons"] else ("card:" + (done["cards"] or done["supplements"])[0]) if (done["cards"] or done["supplements"]) \
        else ("file:" + done["notes"][0]) if done["notes"] else None
    ctx.act("保存了 " + "、".join(parts), first)
    return done


@tool("record", {"tutor", "coach"}, "写一条学习轨迹。type：judged（对学习者某个回答或某段代码的判断和理由）、explained（讲了哪个概念、讲到什么深度）、detour（从主干哪里岔出去、为什么）、bridged（岔路和主干接上了什么）。refs 是相关的 id 或文件路径。",
      {"type": {"type": "string", "enum": sorted(AGENT_RECORDS)}, "summary": S, "detail": S, "refs": LIST}, ["type", "summary"])
def record(ctx, type, summary, detail="", refs=()):
    if type not in AGENT_RECORDS:
        raise ValueError("只能记 " + "、".join(sorted(AGENT_RECORDS)))
    entry = ctx.l.record(type, {"summary": text(summary, 1000), "detail": text(detail, 4000)}, ctx.agent,
                         [*refs, *([ctx.topic] if ctx.topic else []), ctx.thread])
    return {"id": entry["id"]}


@tool("insight", {"tutor"}, "记下学习者的一个薄弱点（kind=weak）或做得好的地方（kind=strength），需要对话、运行记录或作答里的证据；或者在学习者已经用证据表明克服了某个薄弱点时，给出 resolve（它的 id）把它划掉。",
      {"kind": {"type": "string", "enum": ["weak", "strength"]}, "title": S, "detail": S, "resolve": S})
def insight(ctx, kind=None, title=None, detail="", resolve=None):
    if resolve:
        ctx.l.insight_resolve(resolve, ctx.agent)
        ctx.act("把一个薄弱点标为已克服", "insight:" + resolve)
        return {"ok": True}
    if not kind or not title:
        raise ValueError("记录要给出 kind 和 title；划掉要给出 resolve")
    ident = ctx.l.insight_add(ctx.topic, kind, title, detail, ctx.practice, ctx.agent)
    ctx.act(("记下薄弱点" if kind == "weak" else "记下做得好的地方") + f"「{title}」", "insight:" + ident)
    return {"id": ident}


# ---- practices ----------------------------------------------------------------------------------

@tool("start_practice", {"tutor"}, "开一个练习：练习教练会带着学习者在一个专属的练习文件里一步步实现刚讲过的内容。lesson 写清这次练习依据的讲解要点（教练只看得到它），goal 是练习要达到的目标，file_type 是练习文件的扩展名（.py、.ipynb、.c、.rs、.js…，按内容选，默认 .py）。",
      {"lesson": S, "goal": S, "file_type": S}, ["lesson", "goal"])
def start_practice(ctx, lesson, goal, file_type=".py"):
    p = ctx.l.practice_create(ctx.topic, lesson, goal, file_type if file_type.startswith(".") else "." + file_type, None, ctx.agent)
    ctx.turn.after.append(lambda: ctx.bridge.practice_send(p["id"], task="start"))
    ctx.act(f"开了练习「{p['title']}」", "practice:" + p["id"])
    return {"practice": p["id"], "title": p["title"], "file": p["file"]}


@tool("finish_practice_review", {"tutor"}, "复盘一次练习时调用一次：记下这次练习暴露的薄弱点和做得好的地方（各附证据），以及接下来讲解的重点，并把练习标记为已复盘。",
      {"practice": S, "next_focus": S,
       "weak_points": {"type": "array", "items": _obj({"title": S, "detail": S}, ["title", "detail"])},
       "strengths": {"type": "array", "items": _obj({"title": S, "detail": S}, ["title", "detail"])}},
      ["practice", "next_focus", "weak_points", "strengths"])
def finish_practice_review(ctx, practice, next_focus, weak_points, strengths):
    p = ctx.l.practice_review(practice, weak_points, strengths, next_focus, ctx.agent)
    ctx.bridge.reviews.pop(practice, None)
    ctx.act(f"复盘了练习，记下 {len(weak_points)} 个薄弱点", "practice:" + practice)
    return {"state": p["state"]}


@tool("hand_to_tutor", {"flash"}, "发现学习者缺的是一整块基础、不是一个小障碍时，转交给主会话系统讲。summary 写清学习者卡在哪里、你已经解释了什么。", {"summary": S}, ["summary"])
def hand_to_tutor(ctx, summary):
    ctx.act("转交给主会话：" + text(summary, 3000)[:80], "handoff:" + (ctx.topic or ""), False)
    ctx.l.record("action", {"summary": "快答转交主会话", "handoff": text(summary, 3000), "topic": ctx.topic}, ctx.agent, [ctx.thread])
    return {"ok": True}


# ---- the interface ----------------------------------------------------------------------------------

UI_OP = {"type": "object", "properties": {"do": {"type": "string", "enum": ["open", "close", "focus", "move", "float", "layout", "workspace", "sidebar", "set"]},
                                          "panel": S, "agent": S, "path": S, "topic": S, "where": S, "to": S, "name": S, "icon": S,
                                          "side": {"type": "array", "items": S}, "new": {"type": "boolean"},
                                          "open": {"type": "boolean"}, "key": S, "value": {}, "spec": {"type": "object"}}, "required": ["do"]}


@tool("ui", {"tutor", "flash", "coach"}, "控制整个界面，ops 按顺序执行。界面分成几个工作区（活动栏上的图标，见 screen 的 workspace），每个是一套窗口组合，左栏放它自己的列表；"
      "同一个面板（比如主会话）可以同时出现在几个工作区。下面的操作都作用在学习者眼前的这个工作区；对话工作区可以放任何面板，由你按需要安排。\n"
      "- open：打开面板。panel 是 chat（给 agent：tutor 主会话 / flash 快答）、file（给 path）、map（可给 topic）、journal、review（回顾到期的卡）、library（卡片库）、memory（记忆：理解阶段、到期预报、回顾记录）、settings、home；where 是 left / right / top / bottom（贴着 to 指定的面板分栏）、float（浮出）或 tab（默认：放进 to 所在的那组标签，不给 to 就放进同一侧最近用的那组）。\n"
      "- close / focus / float：panel 是面板 id 或标题（从 screen 里看）。\n"
      "- move：把 panel 移到 to 旁边，where 同上。\n"
      "- layout：整个替换这个工作区的布局。spec 是 {\"split\": \"h\"或\"v\", \"sizes\": [0.5, 0.5], \"parts\": [spec, ...]}，叶子是 {\"tabs\": [面板, ...]}；面板可以是已有面板的 id，也可以是一个 open 那样的对象。\n"
      "- workspace：切到 name 那个工作区（名字或 id）。new 为 true 时新建一个并切过去：name、icon、side（左栏的列表：topics、cards、notes、lessons、work、practice、files、search）、spec（同 layout，不给就照现在的样子）。"
      "sidebar：open 为 false 时收起这个工作区的左栏，true 展开。\n"
      "- set：改外观，key 是 theme（dark / light）、font_size、code_font_size、line_height、read_width（一行最多多少字，20～120，或 none 不限）、density（compact / comfortable）；"
      "key 为 zoom 时只改 panel 那一个窗口的大小，value 是倍数（1.2 即 120%）；给了 panel 的 line_height、read_width 也只改那一个窗口；value 为 null 恢复默认。\n"
      "界面只决定显示什么，不代表学习库里有什么：要知道有哪些卡片、笔记、主题、练习，用 list、graph 或 read 去查，不要从面板上推断。\n"
      "学习者可以一键还原你改动前的界面。正在打字的面板不要关、不要挪。", {"ops": {"type": "array", "items": UI_OP}}, ["ops"])
def ui(ctx, ops):
    if not isinstance(ops, list) or not ops or len(ops) > 40:
        raise ValueError("ops 应是 1～40 个界面操作")

    def start(done):
        def finish(result):
            if isinstance(result, dict) and result.get("snapshot"):
                ctx.act("调整了界面：" + "、".join(dict.fromkeys(o.get("do", "") for o in ops)), "ui:" + result["snapshot"], False)
                result = {**result, "note": "这里只有面板的情况。学习库里有什么（卡片、笔记、主题、练习……）用 list、graph、read 查"}
            done(result)
        ctx.bridge.ui_request(ctx.agent, ops, finish)
    return Later(start)


# ---- the learner's side ----------------------------------------------------------------------------

@tool("open", {"tutor", "flash", "coach"}, "在学习者自己的面板里打开一个文件，用来指给 TA 看：line 定位到某一行，highlight 高亮一段原文，cell 定位到实验笔记的某一格。要摆放面板用 ui。",
      {"file": S, "line": I, "highlight": S, "cell": S}, ["file"])
def open_file(ctx, file, line=None, highlight=None, cell=None):
    path = _path_of(ctx, file)
    absolute, rel = ctx.l.resolve(path)
    if not absolute.exists():
        raise ValueError("文件不存在：" + path)
    ctx.bridge.announce({"type": "open", "path": rel or str(absolute), "line": line, "highlight": highlight, "cell": cell, "agent": ctx.agent})
    ctx.act("在你那边打开了 " + (rel or str(absolute)).rsplit("/", 1)[-1], "file:" + (rel or str(absolute)), False)
    return {"opened": rel or str(absolute)}


@tool("suggest", {"tutor", "coach"}, "对学习者的一个文件提修改建议：old 是文件里现有的一段原文（必须只出现一次；不给 old 表示把 new 加到文件末尾），new 是改成什么，why 一句话说明。建议显示在你的回复下面，学习者点了才应用。",
      {"file": S, "old": S, "new": S, "why": S}, ["file", "new"])
def suggest(ctx, file, new, old="", why=""):
    path = _path_of(ctx, file)
    got = ctx.l.read_file(path, 4 * 1024 * 1024)
    if got.get("binary"):
        raise ValueError("不能对二进制文件提建议")
    if old and got["content"].count(old) != 1:
        raise ValueError("old 必须在文件里恰好出现一次（现在出现了 %d 次）" % got["content"].count(old))
    item = {"id": f"s{len(ctx.turn.suggestions) + 1}", "file": got["path"], "old": text(old), "new": text(new), "why": text(why, 500)}
    ctx.turn.suggestions.append(item)
    return {"suggestion": item["id"], "note": "已显示给学习者，等 TA 决定"}


def _write(ctx, rel, content, summary):
    """Write a file for an agent; a card's learner-owned parts are put back. Returns a note when that happened."""
    before = ctx.l.vault.read_text(rel) if ctx.l.vault.path(rel).exists() else None
    ctx.l.write_file(rel, content)
    restored = kind_of(rel) == "card" and before is not None and ctx.l.keep_owned(rel, before)
    ctx.l.index.reindex(rel)
    ctx.bridge.changed([rel])
    ctx.act(summary, "file:" + rel)
    return {"restored": "理解阶段、回顾安排和「我的理解」只归学习者，这几处已还原"} if restored else {}


@tool("edit", {"tutor", "coach", "organizer"}, "直接改学习库里的一个文件：把 old（必须只出现一次）换成 new。只用于你自己的示例和实验文件、整理学习者刚写完的东西，或者学习者明确让你改的时候；其余情况用 suggest。",
      {"file": S, "old": S, "new": S}, ["file", "old", "new"])
def edit(ctx, file, old, new):
    rel = _guard(ctx, _path_of(ctx, file))
    content = ctx.l.vault.read_text(rel)
    if content.count(old) != 1:
        raise ValueError("old 必须在文件里恰好出现一次（现在出现了 %d 次）" % content.count(old))
    return {"file": rel, **_write(ctx, rel, content.replace(old, text(new), 1), "改了 " + rel.rsplit("/", 1)[-1])}


@tool("write", {"tutor", "coach", "organizer"}, "新建或整篇改写学习库里的一个文件（不给目录时放进 code/）。Markdown 文档要保留开头的属性块。规则同 edit。",
      {"file": S, "content": S}, ["file", "content"])
def write(ctx, file, content):
    path = str(file).strip()
    if "/" not in path:
        path = "code/" + slug(path, 120)
    rel = _guard(ctx, path)
    existed = ctx.l.vault.path(rel).exists()
    return {"file": rel, "created": not existed, **_write(ctx, rel, text(content, 2_000_000), ("改写了 " if existed else "新建了 ") + rel.rsplit("/", 1)[-1])}


@tool("write_cell", {"tutor", "coach", "organizer"}, "在实验笔记里新增或改写一个单元格（kind 为 code 或 markdown）。notebook 是路径或 id；不给时写进当前练习的笔记本，或者当前主题最近的实验笔记（没有就新建一本）。给 cell 时改写那一格；after 指定插在哪一格后面。想看结果就接着用 run。",
      {"source": S, "kind": {"type": "string", "enum": ["code", "markdown"]}, "notebook": S, "cell": S, "after": S}, ["source"])
def write_cell(ctx, source, kind="code", notebook=None, cell=None, after=None):
    l = ctx.l
    if notebook:
        path = _path_of(ctx, notebook)
    elif ctx.practice and l.practice(ctx.practice).get("file", "").endswith(".ipynb"):
        path = l.practice(ctx.practice)["file"]
    else:
        recent = l.index.one("SELECT path FROM docs WHERE kind='notebook' AND topic IS ? ORDER BY updated DESC LIMIT 1", (ctx.topic,))
        path = recent["path"] if recent else l.notebook_create("实验笔记" if not ctx.topic else l.doc(ctx.topic)["title"] + " · 实验", ctx.topic)
    rel = _guard(ctx, path)
    ident = l.cell_save(rel, text(source, 400000), kind, cell, after, ctx.agent)
    ctx.bridge.changed([rel])
    ctx.act(("改写了一个单元格" if cell else "写了一个" + ("代码" if kind == "code" else "文字") + "单元格"), "cell:" + rel + "#" + ident)
    return {"notebook": rel, "cell": ident}


@tool("run", {"tutor", "coach"}, "运行一个文件并等它结束，取回真实输出：.py、.ipynb（cells 指定单元格，不给就全部）、.c、.cpp、.rs、.go、.js、.ts、.sh 等。在沙箱里执行（不联网）；缺 Python 包时会自动装上再跑一次。学习者关掉了「允许 AI 运行代码」时会拒绝，这时请学习者自己点运行。",
      {"file": S, "cells": LIST}, ["file"])
def run(ctx, file, cells=None):
    bridge = ctx.bridge
    if not bridge.config.read()["agent_auto_run"]:
        raise ValueError("学习者关闭了「允许 AI 运行代码」。请学习者自己点运行，再读取输出。")
    path = _path_of(ctx, file)
    absolute, rel = ctx.l.resolve(path)
    if not absolute.is_file():
        raise ValueError("文件不存在：" + path)

    def start(done):
        def finish(result):
            outputs = result.get("outputs") or []
            readable = "\n".join(readable_outputs(outputs, 6000))
            done({"state": result.get("state"), "exit_code": result.get("exit_code"), "seconds": result.get("seconds"),
                  "output": readable[-12000:], "figures": sum(1 for o in outputs if "image/png" in (o.get("data") or {})),
                  **({"cells": result["cells"]} if result.get("cells") else {}), **({"note": result["note"]} if result.get("note") else {})})
        try:
            bridge.run_for_agent(ctx, rel or str(absolute), cells, finish)
        except Exception as exc:
            done({"error": str(exc)})
    return Later(start)


@tool("install", {"tutor", "coach"}, "往学习库的 Python 环境装包（只装预编译的 wheel），并写进环境定义 envs/<env>.txt，学习者可以撤销。env 默认 default。", {"packages": LIST, "env": S}, ["packages"])
def install(ctx, packages, env="default"):
    bridge = ctx.bridge

    def start(done):
        def finish(result):
            if isinstance(result, Exception):
                return done({"error": "安装失败：" + str(result)[-1200:]})
            added, out = result
            ctx.l.index.sync()
            ctx.l.record("installed", {"env": env, "packages": list(packages), "added": added}, ctx.agent, ["envs/" + env + ".txt"])
            ctx.act(f"往环境「{env}」装了 " + "、".join(packages), "file:envs/" + env + ".txt")
            done({"installed": list(packages), "added_to_definition": added, "log": out[-600:]})
        bridge.background(lambda: bridge.envs.install(env or "default", packages, binary_only=True), finish)
    return Later(start)


def today():
    return datetime.now().astimezone().strftime("%Y-%m-%d %A")


def dump(value):
    return json.dumps(value, ensure_ascii=False, default=str)
