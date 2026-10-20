"""Workspace tools the learning agents call to read and change Lattice.

Agents are told which tools exist and look things up themselves; nothing is
pushed into their context. One registry serves the API lanes (OpenAI tool
calls) and Codex (through the MCP bridge in mcp_server.py). Every write is
journaled in learn_actions so the learner can undo it from the conversation.
Learner-owned fields (stage, own understanding, own explanations, review
self-ratings) and deletions are never exposed.
"""
from __future__ import annotations

import json

from datetime import datetime, timedelta

from .learning import dump, now, readable_outputs, text, title as clean_title, uid

ROLES = {"tutor", "flash", "practice"}
NOTE_KEY = "topic_notes:"


class Deferred:
    """A result that arrives later, e.g. when a notebook batch finishes."""

    def __init__(self, notebook_id, cell_ids):
        self.notebook_id, self.cell_ids = notebook_id, cell_ids


class Context:
    """Who is calling: role, the topic its conversation belongs to, and the turn's actions."""

    def __init__(self, bridge, role, topic_id, session_id, practice_id=None):
        self.bridge, self.role, self.topic_id = bridge, role, topic_id
        self.session_id, self.practice_id = session_id, practice_id
        self.l, self.store = bridge.learning, bridge.store

    def act(self, summary, undo=None, ref=None):
        ident = uid()
        with self.l.transaction():
            self.l.db.execute("INSERT INTO learn_actions(id,topic_id,actor,summary,ref,undo,state,created_at) VALUES(?,?,?,?,?,?,?,?)",
                              (ident, self.topic_id, self.role, summary, ref, dump(undo) if undo else None, "done", now()))
        action = {"id": ident, "summary": summary, "ref": ref, "undoable": bool(undo)}
        self.bridge.turn_actions.setdefault(self.session_id, []).append(action)
        return action


def _obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


S = {"type": "string"}
TOOLS = {}


def tool(name, roles, description, params=None, required=()):
    def wrap(fn):
        TOOLS[name] = {"roles": set(roles), "description": description, "parameters": _obj(params or {}, required), "fn": fn}
        return fn
    return wrap


def schemas(role):
    """OpenAI-compatible tool list for one role."""
    return [{"type": "function", "function": {"name": n, "description": t["description"], "parameters": t["parameters"]}}
            for n, t in TOOLS.items() if role in t["roles"]]


def call(ctx, name, args):
    spec = TOOLS.get(name)
    if not spec or ctx.role not in spec["roles"]:
        raise ValueError(f"没有可用的工具 {name}")
    if not isinstance(args, dict):
        raise ValueError("工具参数应为 JSON 对象")
    return spec["fn"](ctx, **args)


# ---- reading ---------------------------------------------------------------

def _topic_brief(l, t):
    return {"id": t["id"], "title": t["title"], "question": t["question"], "parent_id": t["parent_id"], "state": t["state"]}


def _cell(c, full=True):
    return {"id": c["id"], "kind": c["kind"], "source": c["source"] if full else c["source"][:400],
            "output": readable_outputs(c["outputs"]) if c["kind"] == "code" else [],
            "output_is_stale": c["stale"], "ran": c["execution_count"] is not None}


@tool("look_around", ROLES, "看看学习者现在在哪：所在页面、正在打开的内容、当前焦点主题和它所在的主线、进行中的练习，以及是否允许你自动运行代码。")
def look_around(ctx):
    l, ws = ctx.l, ctx.bridge.workspace
    topic = l.one("learn_topics", ctx.topic_id)
    path, current = [], topic
    while current["parent_id"]:
        current = l.one("learn_topics", current["parent_id"])
        path.append(current["title"])
    practice = ctx.bridge._active_practice(ctx.topic_id)
    return {"page": ws.get("page"), "open": ws.get("open"), "focus_topic": _topic_brief(l, topic), "main_lines": path,
            "active_practice": practice and {"id": practice["id"], "title": practice["title"], "state": practice["state"]},
            "auto_run_code": bool(ctx.bridge.providers.read()["agent_auto_run"]), "today": now()[:10]}


@tool("list_topics", ROLES, "列出所有学习主题（含分支关系和上次学习时间）。")
def list_topics(ctx):
    l = ctx.l
    rows = l.rows("SELECT * FROM learn_topics ORDER BY created_at")
    last = {r["topic_id"]: r["at"] for r in l.rows(
        "SELECT t.topic_id, MAX(m.created_at) at FROM learn_threads t JOIN messages m ON m.session_id IN (t.tutor_session,t.flash_session) GROUP BY t.topic_id")}
    return [{**_topic_brief(l, t), "last_studied": last.get(t["id"])} for t in rows]


@tool("read", ROLES, "读取一样东西的全文。ref 形如 topic:<id>（含主题档案、课程、笔记本、知识卡、练习列表）、card:<id或标题>、lesson:<id>、note:<id>、notebook:<id>（全部单元格与真实输出）、cell:<id>、practice:<id>（练习依据、对话与复盘）。",
      {"ref": S}, ["ref"])
def read(ctx, ref):
    l = ctx.l
    kind, _, ident = str(ref).partition(":")
    if kind == "topic":
        t = l.one("learn_topics", ident)
        return {**_topic_brief(l, t), "topic_notes": l.setting(NOTE_KEY + ident, ""),
                "lessons": l.rows("SELECT id,title,objective,state FROM learn_lessons WHERE topic_id=? ORDER BY position", (ident,)),
                "notebooks": l.rows("SELECT id,title FROM learn_notebooks WHERE topic_id=? ORDER BY created_at", (ident,)),
                "cards": l.rows("SELECT id,title,stage FROM learn_cards WHERE topic_id=? ORDER BY updated_at DESC", (ident,)),
                "practices": l.rows("SELECT id,title,state,next_focus FROM learn_practices WHERE topic_id=? ORDER BY created_at DESC", (ident,)),
                "branches": l.rows("SELECT id,title FROM learn_topics WHERE parent_id=?", (ident,))}
    if kind == "card":
        c = l.card(l.resolve_card(ident))
        return {k: c[k] for k in ("id", "title", "body", "understanding", "question", "stage", "topic_id", "tags", "due_at")} | {
            "my_understanding_note": "understanding 和 stage 由学习者本人填写",
            "evidence": [{k: e[k] for k in ("kind", "content", "run_id", "created_at")} for e in c["evidence"][:12]],
            "relations": l.rows("""SELECT r.kind, s.title source, t.title target, r.reason FROM learn_relations r
                JOIN learn_cards s ON s.id=r.source JOIN learn_cards t ON t.id=r.target WHERE r.source=? OR r.target=?""", (c["id"], c["id"]))}
    if kind == "lesson":
        return l.one("learn_lessons", ident)
    if kind == "note":
        note = ctx.store.get_note(ident)
        if not note:
            raise ValueError("找不到这篇笔记")
        return note
    if kind == "notebook":
        nb = l.notebook(ident)
        return {"id": nb["id"], "title": nb["title"], "topic_id": nb["topic_id"], "cells": [_cell(c) for c in nb["cells"]],
                "kernel": ctx.bridge.notebook_states.get(ident, {}).get("state", "offline")}
    if kind == "cell":
        c = l.one("learn_cells", ident)
        return next(_cell(x) for x in l.notebook(c["notebook_id"])["cells"] if x["id"] == ident)
    if kind == "practice":
        p = l.practice(ident)
        return {k: p[k] for k in ("id", "title", "state", "seed", "notebook_id", "next_focus")} | {
            "dialogue": [{"role": m["role"], "content": m["content"]} for m in p["messages"]],
            "insights": [{k: i[k] for k in ("kind", "title", "detail", "state")} for i in p["insights"]]}
    raise ValueError("ref 应形如 topic:<id>、card:<id>、lesson:<id>、note:<id>、notebook:<id>、cell:<id> 或 practice:<id>")


@tool("search", ROLES, "在全部学习资料里搜索：知识卡、课程、笔记、主题、实验单元格和以往对话。返回引用和片段，再用 read 读全文。",
      {"query": S}, ["query"])
def search(ctx, query):
    l, q = ctx.l, "%" + text(query, 200).strip() + "%"
    if q == "%%":
        raise ValueError("请给出搜索词")
    hits = []
    for kind, sql in (("card", "SELECT id, title, body||' '||understanding AS body FROM learn_cards WHERE title LIKE ? OR body LIKE ? OR understanding LIKE ?"),
                      ("lesson", "SELECT id, title, body FROM learn_lessons WHERE title LIKE ? OR body LIKE ? OR objective LIKE ?"),
                      ("note", "SELECT id, title, body FROM notes WHERE title LIKE ? OR body LIKE ? OR tags LIKE ?"),
                      ("topic", "SELECT id, title, question AS body FROM learn_topics WHERE title LIKE ? OR question LIKE ? OR id LIKE ?"),
                      ("cell", "SELECT c.id, n.title, c.source AS body FROM learn_cells c JOIN learn_notebooks n ON n.id=c.notebook_id WHERE c.source LIKE ? OR n.title LIKE ? OR c.id LIKE ?")):
        for r in l.rows(sql + " LIMIT 8", (q, q, q)):
            hits.append({"ref": kind + ":" + r["id"], "title": r["title"], "excerpt": _excerpt(r["body"], query)})
    for r in l.rows("""SELECT m.id, m.role, m.content, s.title FROM messages m JOIN sessions s ON s.id=m.session_id
                       WHERE m.content LIKE ? ORDER BY m.id DESC LIMIT 6""", (q,)):
        hits.append({"ref": "message:" + str(r["id"]), "title": r["title"] + " · " + r["role"], "excerpt": _excerpt(r["content"], query)})
    return hits


def _excerpt(body, query, width=160):
    body = str(body or "")
    at = body.casefold().find(str(query).casefold())
    start = max(0, at - width // 3) if at >= 0 else 0
    return body[start:start + width].replace("\n", " ")


@tool("conversation", ROLES, "读取一段对话的最近消息。lane 为 tutor（主讲）、flash（快答）或 practice（练习，需给 practice_id）；不给 topic_id 时用当前主题。",
      {"lane": {"type": "string", "enum": ["tutor", "flash", "practice"]}, "topic_id": S, "practice_id": S, "limit": {"type": "integer"}}, ["lane"])
def conversation(ctx, lane, topic_id=None, practice_id=None, limit=12):
    l = ctx.l
    if lane == "practice":
        if not practice_id:
            raise ValueError("读取练习对话需要 practice_id")
        session = l.one("learn_practices", practice_id)["session_id"]
    else:
        session = l.threads(topic_id or ctx.topic_id)[lane + "_session"]
    rows = ctx.store.messages(session)[-max(1, min(int(limit), 40)):]
    return [{"role": m["role"], "content": m["content"][:8000], "at": m["created_at"]} for m in rows]


@tool("recent_changes", ROLES, "最近发生的事：学习者和各个 AI 做过的修改、运行、保存、练习和转交，最新的在前。",
      {"limit": {"type": "integer"}})
def recent_changes(ctx, limit=20):
    rows = ctx.l.rows("SELECT kind,title,detail,target,at FROM events ORDER BY id DESC LIMIT ?", (max(1, min(int(limit), 60)),))
    actions = ctx.l.rows("SELECT actor,summary,ref,state,created_at FROM learn_actions ORDER BY created_at DESC LIMIT ?", (max(1, min(int(limit), 60)),))
    return {"events": rows, "ai_actions": actions}


@tool("learner_profile", ROLES, "练习复盘记下的薄弱点、做得好的地方，以及最近一次练习后定下的讲解重点（含当前主题的上级主线）。",
      {"topic_id": S})
def learner_profile(ctx, topic_id=None):
    return ctx.l.learner_profile(topic_id or ctx.topic_id)


@tool("due_cards", {"tutor"}, "列出现在到期、需要回顾的知识卡。回顾时由你提问，记不记得住由学习者自己在界面里点。")
def due_cards(ctx):
    # Same rule as the knowledge page: a card never reviewed comes due a day after it was saved.
    cards = ctx.l.rows("SELECT id,title,question,due_at,created_at,stage FROM learn_cards WHERE stage!='suggested'")
    current = datetime.now().astimezone()
    return [c for c in cards if (datetime.fromisoformat(c["due_at"]) if c["due_at"] else datetime.fromisoformat(c["created_at"]) + timedelta(days=1)) <= current]


@tool("list_files", {"tutor"}, "列出学习者挂载的代码目录；给 project_id 时列出该目录里的文件（path 为相对路径）。只读。",
      {"project_id": S, "path": S})
def list_files(ctx, project_id=None, path=""):
    if not project_id:
        return ctx.store.projects()
    return ctx.store.project_files(project_id, path)


@tool("read_file", {"tutor"}, "读取挂载目录里的一个文本文件。只读。", {"project_id": S, "path": S}, ["project_id", "path"])
def read_file(ctx, project_id, path):
    content = ctx.store.file_read(project_id, path)
    ctx.act(f"读取了文件 {path}", ref=None)
    return content


# ---- changing things ---------------------------------------------------------

@tool("create_topic", {"tutor"}, "新建一个学习主题；parent_id 给出时作为那条主线下的兴趣分支。建好后，这一轮结束时界面会切到它，这轮对话也会归到它下面。",
      {"title": S, "question": S, "parent_id": S}, ["title", "question"])
def create_topic(ctx, title, question, parent_id=None):
    t = ctx.l.topic_save({"title": title, "question": question, "parent_id": parent_id or None})
    ctx.bridge.turn_focus[ctx.session_id] = t["id"]
    ctx.act(("开了分支" if parent_id else "新建了主题") + f"「{t['title']}」", {"op": "delete_topic", "id": t["id"]}, "topic:" + t["id"])
    return _topic_brief(ctx.l, t)


@tool("focus_topic", {"tutor"}, "把焦点切到另一个已有主题。这一轮结束时界面会切过去，这轮对话也会归到它下面。", {"topic_id": S}, ["topic_id"])
def focus_topic(ctx, topic_id):
    t = ctx.l.one("learn_topics", topic_id)
    ctx.bridge.turn_focus[ctx.session_id] = topic_id
    ctx.act(f"切换到主题「{t['title']}」", None, "topic:" + topic_id)
    return _topic_brief(ctx.l, t)


@tool("update_topic_notes", {"tutor"}, "改写当前主题的档案：讲到了哪里、学习者留下的疑问、接下来往哪走。这是跨天续讲时的长期记忆，整篇替换，保持精炼。",
      {"notes": S}, ["notes"])
def update_topic_notes(ctx, notes):
    key = NOTE_KEY + ctx.topic_id
    old = ctx.l.setting(key, "")
    ctx.l.set_setting(key, text(notes, 8000).strip())
    ctx.act("更新了主题档案", {"op": "setting", "key": key, "value": old}, "topic:" + ctx.topic_id)
    return {"ok": True}


@tool("save_knowledge", {"tutor"}, "把已经讲过、学习者也回应过的内容存进学习档案（直接保存，学习者可以撤销）。lessons 是值得以后回看的完整讲解；cards 一张一个脱离对话也成立的知识点，已有同名卡时内容作为补充附上；relations 的 kind 为 prerequisite/part_of/related/applies_to/contrasts；notes 是依赖情境的经验。",
      {"lessons": {"type": "array", "items": _obj({"title": S, "objective": S, "body": S}, ["title", "body"])},
       "cards": {"type": "array", "items": _obj({"title": S, "body": S, "question": S, "tags": {"type": "array", "items": S}}, ["title", "body"])},
       "relations": {"type": "array", "items": _obj({"source": S, "target": S, "kind": S, "reason": S}, ["source", "target", "kind"])},
       "notes": {"type": "array", "items": _obj({"title": S, "body": S, "folder": S}, ["title", "body"])}})
def save_knowledge(ctx, lessons=(), cards=(), relations=(), notes=()):
    l, topic, done = ctx.l, ctx.topic_id, {"lessons": [], "cards": [], "supplements": [], "relations": [], "notes": []}
    payload = l.validate_payload({"version": 1, "lessons": list(lessons), "cards": list(cards), "relations": list(relations), "notes": list(notes)})
    with l.transaction():
        for item in payload["lessons"]:
            done["lessons"].append(l.lesson_save({**item, "topic_id": topic}, origin=ctx.role)["id"])
        for item in payload["cards"]:
            old = l.db.execute("SELECT id FROM learn_cards WHERE canonical=?", (item["title"].strip().casefold(),)).fetchone()
            if old:
                # AI text never overwrites the learner's own card; it is attached as a supplement.
                l.evidence_add(old[0], "question", "补充解释（AI）：\n" + item.get("body", ""))
                done["supplements"].append(l.db.execute("SELECT id FROM learn_evidence WHERE card_id=? ORDER BY rowid DESC LIMIT 1", (old[0],)).fetchone()[0])
            else:
                done["cards"].append(l.card_save({**item, "topic_id": topic, "stage": "seen", "provenance": {"lane": ctx.role}}, origin=ctx.role)["id"])
        for r in payload["relations"]:
            l.relation_add(**r)
            done["relations"].append(l.db.execute("SELECT id FROM learn_relations WHERE source=? AND target=? AND kind=?",
                                                  (l.resolve_card(r["source"]), l.resolve_card(r["target"]), r["kind"])).fetchone()[0])
        for item in payload["notes"]:
            note_id, t = uid(), now()
            l.db.execute("INSERT INTO notes(id,title,body,folder,tags,pinned,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                         (note_id, clean_title(item["title"]), text(item["body"]), text(item.get("folder") or "经验", 80), dump(["AI"]), 0, t, t))
            done["notes"].append(note_id)
    parts = [f"{len(done[k])} {n}" for k, n in (("lessons", "节课"), ("cards", "张卡"), ("supplements", "条卡片补充"),
                                                ("relations", "条关系"), ("notes", "篇经验文档")) if done[k]]
    first = ("lesson:" + done["lessons"][0]) if done["lessons"] else ("card:" + done["cards"][0]) if done["cards"] else None
    ctx.act("保存了 " + "、".join(parts), {"op": "knowledge", **done}, first)
    return done


def _notebook_for(ctx, notebook_id):
    l = ctx.l
    if ctx.role == "practice":
        own = l.one("learn_practices", ctx.practice_id)["notebook_id"]
        if notebook_id and notebook_id != own:
            raise ValueError("练习教练只能写这次练习的笔记本")
        return own
    if notebook_id:
        if l.one("learn_notebooks", notebook_id)["topic_id"] != ctx.topic_id:
            raise ValueError("只能写当前主题的笔记本")
        return notebook_id
    practice_nbs = {r["notebook_id"] for r in l.rows("SELECT notebook_id FROM learn_practices WHERE topic_id=?", (ctx.topic_id,))}
    rows = [r["id"] for r in l.rows("SELECT id FROM learn_notebooks WHERE topic_id=? ORDER BY created_at", (ctx.topic_id,)) if r["id"] not in practice_nbs]
    return rows[0] if rows else l.notebook_create(ctx.topic_id)["id"]


@tool("write_cell", {"tutor", "practice"}, "在实验笔记里新增或改写一个单元格（kind 为 code 或 markdown）。给 cell_id 时改写那一格；不给 notebook_id 时，主讲写进当前主题的实验笔记，练习教练写进这次练习的笔记本。想看结果就接着调用 run_cells。",
      {"source": S, "kind": {"type": "string", "enum": ["code", "markdown"]}, "notebook_id": S, "cell_id": S}, ["source"])
def write_cell(ctx, source, kind="code", notebook_id=None, cell_id=None):
    l = ctx.l
    if cell_id:
        old = l.one("learn_cells", cell_id)
        nb = _notebook_for(ctx, old["notebook_id"])
        cell = l.cell_save({"id": cell_id, "source": source, "kind": kind})
        ctx.act("改写了一个单元格", {"op": "cell_source", "id": cell_id, "source": old["source"]}, "cell:" + cell_id)
    else:
        nb = _notebook_for(ctx, notebook_id)
        cell = l.cell_save({"notebook_id": nb, "kind": kind, "source": source})
        ctx.act("写了一个" + ("代码" if kind == "code" else "文字") + "单元格", {"op": "delete_cell", "id": cell["id"]}, "cell:" + cell["id"])
    ctx.bridge.changed(ctx.topic_id)
    return {"cell_id": cell["id"], "notebook_id": nb}


@tool("run_cells", {"tutor", "practice"}, "在学习者本机的 Jupyter 内核里运行单元格并等待真实输出。不给 cell_ids 时运行整本笔记本。学习者关掉自动运行时，这个工具会拒绝，请让学习者自己点运行。",
      {"notebook_id": S, "cell_ids": {"type": "array", "items": S}})
def run_cells(ctx, notebook_id=None, cell_ids=None):
    if not ctx.bridge.providers.read()["agent_auto_run"]:
        raise ValueError("学习者关闭了自动运行代码。请告诉学习者在实验笔记里自己运行，再读取输出。")
    nb = _notebook_for(ctx, notebook_id)
    cells = [c for c in ctx.l.notebook(nb)["cells"] if c["kind"] == "code" and (not cell_ids or c["id"] in cell_ids)]
    if not cells:
        raise ValueError("没有可以运行的代码单元格")
    ctx.bridge.run_notebook(nb, cell_ids=[c["id"] for c in cells])
    ctx.act(f"运行了 {len(cells)} 个单元格", None, "notebook:" + nb)
    return Deferred(nb, [c["id"] for c in cells])


@tool("start_practice", {"tutor"}, "开一个练习分支：练习教练会带着学习者在一份专属笔记本里一步步实现刚讲过的内容。lesson 写清这次练习依据的讲解要点（教练只看得到它），goal 是练习要达到的目标。每个主题同时只能有一个进行中的练习。",
      {"lesson": S, "goal": S}, ["lesson", "goal"])
def start_practice(ctx, lesson, goal):
    seed = text(lesson, 20000).strip() + "\n\n**练习目标：** " + text(goal, 1000).strip()
    practice = ctx.l.practice_create(ctx.topic_id, seed, name=text(goal, 1000).strip().rstrip("。"))
    ctx.bridge.after_turn.setdefault(ctx.session_id, []).append(lambda: ctx.bridge.practice_send(practice["id"], task="start"))
    ctx.act(f"开了练习「{practice['title']}」", None, "practice:" + practice["id"])
    return {"practice_id": practice["id"], "title": practice["title"]}


@tool("record_insight", {"tutor"}, "记下学习者的一个薄弱点（kind=weak）或做得好的地方（kind=strength），需有对话或运行记录里的证据。之后各个 AI 都能通过 learner_profile 看到。",
      {"kind": {"type": "string", "enum": ["weak", "strength"]}, "title": S, "detail": S}, ["kind", "title", "detail"])
def record_insight(ctx, kind, title, detail):
    ident = uid()
    with ctx.l.transaction():
        ctx.l.db.execute("INSERT INTO learn_insights(id,topic_id,practice_id,kind,title,detail,created_at) VALUES(?,?,?,?,?,?,?)",
                         (ident, ctx.topic_id, None, kind, clean_title(title), text(detail, 2000), now()))
    ctx.act(("记下薄弱点" if kind == "weak" else "记下做得好的地方") + f"「{title}」", {"op": "delete_insight", "id": ident})
    return {"id": ident}


@tool("resolve_insight", {"tutor"}, "学习者已经用证据表明克服了某个薄弱点时，把它标记为已克服。", {"id": S}, ["id"])
def resolve_insight(ctx, id):
    ctx.l.insight_resolve(id)
    ctx.act("把一个薄弱点标为已克服", {"op": "insight_active", "id": id})
    return {"ok": True}


@tool("finish_practice_review", {"tutor"}, "复盘一次练习时调用一次：记下这次练习暴露的薄弱点和做得好的地方（各附证据），以及接下来讲解的重点，并把练习标记为已复盘。",
      {"practice_id": S, "next_focus": S,
       "weak_points": {"type": "array", "items": _obj({"title": S, "detail": S}, ["title", "detail"])},
       "strengths": {"type": "array", "items": _obj({"title": S, "detail": S}, ["title", "detail"])}},
      ["practice_id", "next_focus", "weak_points", "strengths"])
def finish_practice_review(ctx, practice_id, next_focus, weak_points, strengths):
    p = ctx.l.insights_record(practice_id, {"weak_points": weak_points, "strengths": strengths, "next_focus": next_focus})
    ctx.bridge.reviews.pop(ctx.topic_id, None)
    ctx.act(f"复盘了练习，记下 {len(weak_points)} 个薄弱点", None, "practice:" + practice_id)
    return {"state": p["state"]}


@tool("hand_to_tutor", {"flash"}, "发现学习者缺的是一整块基础、不是一个小障碍时，转交给主讲系统讲。summary 写清学习者卡在哪里、你已经解释了什么。",
      {"summary": S}, ["summary"])
def hand_to_tutor(ctx, summary):
    ctx.store.emit("handoff", "快答转交主讲", text(summary, 3000), ctx.topic_id)
    ctx.act("转交给主讲：" + text(summary, 3000)[:60], None, "handoff:" + ctx.topic_id)
    return {"ok": True}


# ---- undo ------------------------------------------------------------------------

def undo(bridge, action_id):
    l = bridge.learning
    a = l.one("learn_actions", action_id)
    if a["state"] != "done" or not a["undo"]:
        raise ValueError("这个操作不能撤销")
    u = json.loads(a["undo"])
    op = u["op"]
    if op == "delete_topic":
        bridge.topic_delete(u["id"])
    elif op == "setting":
        l.set_setting(u["key"], u["value"])
    elif op == "knowledge":
        with l.transaction():
            for ident in u["relations"]:
                l.db.execute("DELETE FROM learn_relations WHERE id=?", (ident,))
            for ident in u["supplements"]:
                l.db.execute("DELETE FROM learn_evidence WHERE id=?", (ident,))
            for ident in u["cards"]:
                l.db.execute("DELETE FROM learn_cards WHERE id=?", (ident,))
            for ident in u["lessons"]:
                l.db.execute("DELETE FROM learn_lessons WHERE id=?", (ident,))
            for ident in u["notes"]:
                l.db.execute("DELETE FROM notes WHERE id=?", (ident,))
    elif op == "delete_cell":
        l.cell_delete(u["id"])
    elif op == "cell_source":
        l.cell_save({"id": u["id"], "source": u["source"]})
    elif op == "delete_insight":
        with l.transaction():
            l.db.execute("DELETE FROM learn_insights WHERE id=?", (u["id"],))
    elif op == "insight_active":
        with l.transaction():
            l.db.execute("UPDATE learn_insights SET state='active' WHERE id=?", (u["id"],))
    with l.transaction():
        l.db.execute("UPDATE learn_actions SET state='undone' WHERE id=?", (action_id,))
    return True
