"""What the files in the vault mean, and who may change what.

Topics, cards, lessons, notes and insights are Markdown files; notebooks are
.ipynb; conversations and the journal are JSON lines; everything else is a
plain file referred to by its path. Writes go to the file first and then
refresh that file's rows in the index; reads use the index.

Ownership is decided here, in one place: a card's stage, its review schedule,
its "## 我的理解" section, the learner's side of the journal and every deletion
belong to the learner. Agents can read them and never change them.
"""
from __future__ import annotations

from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import re

from .index import Index, dump, stamp_of, uid
from .vault import APPEND_ONLY, KEPT, ME, MD_KINDS, VAULT_PATH, Vault, VaultError, join_frontmatter, kind_of, now, slug, split_frontmatter

STAGES = ("suggested", "seen", "explained", "applied")
# What kind of knowledge a card holds: what something is, why it holds, how to do it, a way of seeing, a fact to know.
CARD_TYPES = ("concept", "principle", "method", "idea", "fact")
LINK_KINDS = {"prerequisite", "part_of", "related", "applies_to", "contrasts", "explains"}
ACYCLIC = {"prerequisite", "part_of"}
FOLDER = {kind: folder for folder, kind in MD_KINDS.items()}
MINE = "## 我的理解"
# Learner-owned card attributes; agents never write them, and a shell command that does is undone.
CARD_OWNED = ("stage", "due", "reviews")
# Journal entries the agents may write with `record`; everything else is written by Lattice itself.
AGENT_RECORDS = {"judged", "explained", "detour", "bridged"}
RULES = Path(__file__).with_name("rules.md")


def text(value, maximum=50000):
    if not isinstance(value, str):
        raise ValueError("文本字段必须是字符串")
    if len(value) > maximum:
        raise ValueError(f"文本超过 {maximum} 字符限制")
    return value


def title_of(value):
    value = text(value, 180).strip()
    if not value:
        raise ValueError("标题不能为空")
    return value


# [[target]], [[target|shown text]], [[target#heading]], and ![[embedded]].
WIKI = re.compile(r"!?\[\[([^\]\n]+)\]\]")
TAG = re.compile(r"(?<![\w#&/])#([^\s#.,;:!?，。；：！？、()（）\[\]{}<>\"'`*]+)")
CODE = re.compile(r"```.*?```|~~~.*?~~~|`[^`\n]*`", re.S)


def wiki_target(raw):
    return raw.split("|", 1)[0].split("#", 1)[0].strip()


def outside_code(body, change):
    """Apply change() to the parts of a Markdown text that are not code."""
    out, last = [], 0
    for m in CODE.finditer(body or ""):
        out += [change(body[last:m.start()]), m.group(0)]
        last = m.end()
    return "".join(out + [change((body or "")[last:])])


def inline_tags(body):
    """#tags in a document's text, outside code; a tag needs something besides digits."""
    return [t for t in dict.fromkeys(TAG.findall(CODE.sub("", body or ""))) if not t.isdigit()]


def split_mine(body):
    """A card body and the learner's own section under '## 我的理解'."""
    match = re.search(r"^## 我的理解[ \t]*$", body, re.M)
    if not match:
        return body.rstrip(), ""
    return body[:match.start()].rstrip(), body[match.end():].strip()


def join_mine(body, mine):
    return body.rstrip() + "\n\n" + MINE + "\n\n" + mine.strip()


def readable_outputs(outputs, limit=1800):
    """Run outputs as text a model can read; figures become a marker."""
    readable = []
    for out in outputs or []:
        kind = out.get("output_type")
        if kind == "stream":
            value = out.get("text", "")
            readable.append(("".join(value) if isinstance(value, list) else str(value))[-limit:])
        elif kind == "error":
            readable.append(str(out.get("ename", "")) + ": " + str(out.get("evalue", "")))
        else:
            data = out.get("data", {})
            plain = data.get("text/plain")
            readable.append(("".join(plain) if isinstance(plain, list) else str(plain))[:limit] if plain else
                            "[图像输出]" if any(k.startswith("image/") for k in data) else "[输出]")
    return readable


def source_of(cell):
    src = cell.get("source", "")
    return "".join(src) if isinstance(src, list) else str(src)


class Lattice:
    def __init__(self, root=VAULT_PATH, migrate_from=None):
        self.vault = Vault(root)
        self.root = self.vault.root
        self.index = Index(self.vault)
        self.db = self.index.db
        self.settings_path = self.root / ".lattice" / "settings.json"
        if not self.vault.path("AGENTS.md").exists():
            self.vault.write_text("AGENTS.md", RULES.read_text(encoding="utf-8"))
            self.index.reindex("AGENTS.md")
        self.migrated = None
        if migrate_from and Path(migrate_from).exists() and not self.index.one("SELECT 1 FROM docs LIMIT 1"):
            from .migrate import migrate
            self.migrated = migrate(migrate_from, self)
        self.vault.commit("我的编辑", "me")

    rows = property(lambda self: self.index.rows)

    # ---- machine-local settings ------------------------------------------------------
    def settings(self):
        try:
            return json.loads(self.settings_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def setting(self, key, default=None):
        return self.settings().get(key, default)

    def set_setting(self, key, value):
        data = self.settings()
        data[key] = value
        tmp = self.settings_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.settings_path)
        return value

    # ---- documents ---------------------------------------------------------------------
    def doc(self, ident, kind=None):
        row = self.index.one("SELECT * FROM docs WHERE id=?" + (" AND kind=?" if kind else ""), (ident, kind) if kind else (ident,))
        if not row:
            raise ValueError(("找不到这个" + {"topic": "主题", "card": "知识卡", "lesson": "课程", "note": "笔记",
                                               "insight": "薄弱点记录", "notebook": "实验笔记"}.get(kind, "内容")) + "：" + str(ident))
        row["attrs"] = json.loads(row["attrs"])
        return row

    def docs(self, kind, where="", args=()):
        out = self.index.rows(f"SELECT * FROM docs WHERE kind=? {where} ORDER BY updated DESC", (kind, *args))
        for row in out:
            row["attrs"] = json.loads(row["attrs"])
        return out

    def _write_doc(self, folder, attrs, body, current=None):
        """Write one Markdown document; a new title renames its file."""
        attrs["updated"] = now()
        attrs.setdefault("created", attrs["updated"])
        rel = self.vault.unique(folder, attrs["title"], ".md", current)
        if current and current != rel:
            self.vault.move(current, rel)
            self.index.unindex(current)
        self.vault.write_md(rel, attrs, body)
        self.index.reindex(rel)
        return rel

    def _edit_doc(self, ident, change):
        """Read a document's file, let `change(attrs, body)` return the new (attrs, body), write it back."""
        row = self.doc(ident)
        attrs, body = self.vault.read_md(row["path"])
        attrs, body = change(attrs, body)
        folder = row["path"].rsplit("/", 1)[0]
        return self._write_doc(folder, attrs, body, row["path"])

    def _remove(self, rel):
        self.vault.remove(rel)
        self.index.unindex(rel)

    # ---- topics ---------------------------------------------------------------------
    def topics(self):
        out = []
        for row in self.docs("topic"):
            a = row["attrs"]
            out.append({"id": row["id"], "title": row["title"], "path": row["path"], "question": a.get("question", ""),
                        "parent": a.get("parent"), "state": a.get("state", "active"), "route": a.get("route") or [],
                        "notes": row["body"], "created": row["created"], "updated": row["updated"]})
        return out

    def topic(self, ident):
        return next((t for t in self.topics() if t["id"] == ident), None) or self.doc(ident, "topic")

    def topic_save(self, data, by="me"):
        ident = data.get("id")
        old = self.doc(ident, "topic") if ident else None
        attrs = dict(old["attrs"]) if old else {"id": uid(), "kind": "topic", "by": by}
        ident = attrs["id"]
        parent = data.get("parent", attrs.get("parent")) or None
        if parent:
            ancestor, seen = parent, {ident}
            while ancestor:
                if ancestor in seen:
                    raise ValueError("主题分支不能形成循环")
                seen.add(ancestor)
                ancestor = self.doc(ancestor, "topic")["attrs"].get("parent")
        state = data.get("state", attrs.get("state", "active"))
        if state not in {"active", "parked", "completed"}:
            raise ValueError("主题状态应为 active、parked 或 completed")
        attrs.update(title=title_of(data.get("title", attrs.get("title", ""))), question=text(data.get("question", attrs.get("question", "")), 6000),
                     parent=parent, state=state)
        if "route" in data:
            attrs["route"] = self._route(data["route"])
        body = text(data["notes"], 20000).strip() if "notes" in data else (old["body"] if old else "")
        self._write_doc("topics", attrs, body, old["path"] if old else None)
        return self.topic(ident)

    def _route(self, items):
        if not isinstance(items, list) or len(items) > 60:
            raise ValueError("路线应是不超过 60 站的列表")
        route = []
        for item in items:
            item = {"title": item} if isinstance(item, str) else item
            if not isinstance(item, dict) or not str(item.get("title", "")).strip():
                raise ValueError("路线的每一站都要有 title")
            step = {"title": title_of(str(item["title"]))}
            if item.get("ref"):
                step["ref"] = str(item["ref"])
            if item.get("why"):
                step["why"] = text(str(item["why"]), 500)
            # where the learner is (one station is "now"), and the weak point a station was put in to fill
            if item.get("state") in ("done", "now"):
                step["state"] = item["state"]
            if item.get("gap"):
                step["gap"] = title_of(str(item["gap"]))
                if item.get("insight"):
                    step["insight"] = str(item["insight"])
            route.append(step)
        if sum(s.get("state") == "now" for s in route) > 1:
            raise ValueError("路线上只能有一站是 now（现在在讲的）")
        return route

    def topic_delete(self, ident):
        """Only the learner deletes. Branches move up a level; everything that pointed at the topic stays, detached."""
        topic = self.doc(ident, "topic")
        for child in self.docs("topic"):
            if child["attrs"].get("parent") == ident:
                self.topic_save({"id": child["id"], "parent": topic["attrs"].get("parent")})
        for row in self.index.rows("SELECT id, kind FROM docs WHERE topic=? AND kind IN ('card','lesson','note','insight')", (ident,)):
            self._edit_doc(row["id"], lambda a, b: ({**a, "topic": None}, b))
        self._remove(topic["path"])
        if self.setting("active_topic") == ident:
            self.set_setting("active_topic", None)
        return True

    def active_topic(self):
        ident = self.setting("active_topic")
        return ident if ident and self.index.one("SELECT 1 FROM docs WHERE id=? AND kind='topic'", (ident,)) else None

    def focus(self, ident):
        if ident:
            self.doc(ident, "topic")
        return self.set_setting("active_topic", ident or None)

    # ---- cards ------------------------------------------------------------------------------
    def card(self, ident):
        row = self.doc(self.resolve_card(ident), "card")
        a = row["attrs"]
        body, mine = split_mine(row["body"])
        return {"id": row["id"], "path": row["path"], "title": row["title"], "topic": row["topic"], "body": body, "mine": mine,
                "stage": a.get("stage", "suggested"), "question": a.get("question", ""), "tags": a.get("tags") or [],
                "type": a.get("type"), "area": a.get("area"), "due": stamp_of(a["due"]) if a.get("due") else None, "reviews": int(a.get("reviews") or 0), "by": a.get("by", "me"),
                "created": row["created"], "updated": row["updated"],
                "links": self.links_of(row["id"]), "evidence": self.journal(ref=row["id"], limit=30)}

    def cards(self):
        out = []
        for row in self.docs("card"):
            a = row["attrs"]
            # The opening words of the explanation, so a list of cards says what each is about.
            excerpt = re.sub(r"\s+", " ", re.sub(r"[#>*`_|]|\[\[|\]\]", "", split_mine(row["body"])[0])).strip()[:140]
            out.append({"id": row["id"], "path": row["path"], "title": row["title"], "topic": row["topic"], "stage": a.get("stage", "suggested"),
                        "type": a.get("type"), "area": a.get("area"), "question": a.get("question", ""), "excerpt": excerpt, "due": stamp_of(a["due"]) if a.get("due") else None,
                        "reviews": int(a.get("reviews") or 0), "created": row["created"], "updated": row["updated"]})
        return out

    def resolve_card(self, ref):
        ref = str(ref)
        row = self.index.one("SELECT id FROM docs WHERE kind='card' AND (id=? OR lower(title)=lower(?))", (ref, ref))
        if not row:
            raise ValueError("找不到知识卡：" + ref)
        return row["id"]

    def card_save(self, data, by="me"):
        """Create a card, or change its shared parts. An agent's text for an existing card is appended, never replacing."""
        name = title_of(data.get("title", ""))
        existing = self.index.one("SELECT id FROM docs WHERE kind='card' AND lower(title)=lower(?)", (name,))
        ident = data.get("id") or (existing["id"] if existing else None)
        if existing and data.get("id") and existing["id"] != data["id"]:
            raise ValueError("同名知识卡已存在，请编辑现有卡片或使用不同标题")
        tags = data.get("tags", [])
        if not isinstance(tags, list) or len(tags) > 25:
            raise ValueError("标签应为不超过 25 项的列表")
        if data.get("type") and data["type"] not in CARD_TYPES:
            raise ValueError("知识卡的类型只能是 " + "、".join(CARD_TYPES))
        sort = {k: text(str(data[k]), 40).strip() for k in ("type", "area") if data.get(k)}
        if not ident:
            stage = data.get("stage", "suggested")
            if stage not in STAGES:
                raise ValueError("理解阶段无效")
            if by != "me" and stage not in {"suggested", "seen"}:
                raise ValueError("理解阶段由学习者本人确认")
            topic = data.get("topic") or None
            if topic:
                self.doc(topic, "topic")
            attrs = {"id": uid(), "kind": "card", "title": name, "by": by, "topic": topic, "stage": stage, **sort,
                     "tags": [text(x, 60) for x in tags], "question": text(data.get("question", ""), 5000)}
            self._write_doc("cards", attrs, join_mine(text(data.get("body", "")), text(data.get("mine", ""), 20000) if by == "me" else ""))
            return self.card(attrs["id"])
        if by != "me":
            # An agent adds to a card, and sorts one that was never sorted; it does not resort the learner's.
            addition = text(data.get("body", "")).strip()
            self._edit_doc(ident, lambda a, b: ({**a, **{k: v for k, v in sort.items() if not a.get(k)}},
                                                join_mine(split_mine(b)[0] + f"\n\n**补充（{by}）**\n\n" + addition, split_mine(b)[1]) if addition else b))
            return self.card(ident)

        def change(a, b):
            body, mine = split_mine(b)
            a.update(title=name, tags=[text(x, 60) for x in data.get("tags", a.get("tags") or [])],
                     question=text(data.get("question", a.get("question", "")), 5000))
            for k in ("type", "area"):
                if k in data:
                    a[k] = sort.get(k) or None
            if "topic" in data:
                a["topic"] = data["topic"] or None
            return a, join_mine(text(data.get("body", body)), mine)
        self._edit_doc(ident, change)
        return self.card(ident)

    def card_mine(self, ident, stage=None, mine=None):
        """The learner's own parts of a card: understanding stage and their own words."""
        card = self.card(ident)
        if stage is not None and stage not in STAGES:
            raise ValueError("理解阶段无效")

        def change(a, b):
            body, old = split_mine(b)
            if stage is not None:
                a["stage"] = stage
            return a, join_mine(body, text(mine, 20000) if mine is not None else old)
        self._edit_doc(card["id"], change)
        if stage is not None and stage != card["stage"]:
            self.record("staged", {"from": card["stage"], "to": stage, "title": card["title"]}, "me", [card["id"]])
        if mine is not None and mine.strip() != card["mine"].strip():
            self.record("wrote", {"what": "我的理解", "title": card["title"], "excerpt": mine.strip()[:400]}, "me", [card["id"]])
        return self.card(card["id"])

    def card_review(self, ident, rating):
        """A transparent schedule driven by the learner's own rating, not an inferred mastery score."""
        card = self.card(ident)
        if rating not in {"again", "hard", "good"}:
            raise ValueError("自评应为 again、hard 或 good")
        level = min(card["reviews"], 5)
        days = 1 if rating == "again" else ((1, 2, 4, 7, 14, 30) if rating == "hard" else (1, 3, 7, 14, 30, 60))[level]
        due = (datetime.now().astimezone() + timedelta(days=days)).isoformat(timespec="seconds")
        reviews = card["reviews"] if rating == "again" else card["reviews"] + 1
        self._edit_doc(card["id"], lambda a, b: ({**a, "due": due, "reviews": reviews}, b))
        self.record("reviewed", {"rating": rating, "title": card["title"], "next": due}, "me", [card["id"]])
        return self.card(card["id"])

    def due_cards(self):
        current = datetime.now().astimezone()
        due = []
        for c in self.cards():
            if c["stage"] == "suggested":
                continue
            # A card never reviewed comes due a day after it was saved.
            at = datetime.fromisoformat(c["due"]) if c["due"] else datetime.fromisoformat(c["created"]) + timedelta(days=1)
            if at <= current:
                due.append(c)
        return sorted(due, key=lambda c: c["due"] or c["created"])

    # ---- links: stored on the source document, any document can link to any other ------------------------
    def resolve_ref(self, ref):
        """A document id, a card title, or file:<path>."""
        ref = str(ref).strip()
        if ref.startswith("file:"):
            self.resolve(ref[5:])
            return ref
        for prefix in ("topic:", "card:", "lesson:", "note:", "insight:", "notebook:"):
            if ref.startswith(prefix):
                ref = ref[len(prefix):]
        if self.index.one("SELECT 1 FROM docs WHERE id=?", (ref,)):
            return ref
        row = self.index.one("SELECT id FROM docs WHERE lower(title)=lower(?) ORDER BY kind='card' DESC", (ref,))
        if row:
            return row["id"]
        raise ValueError("找不到要连接的内容：" + ref)

    def links_of(self, ident):
        rows = self.index.rows("""SELECT l.*, s.title source_title, t.title target_title FROM links l
            LEFT JOIN docs s ON s.id=l.source LEFT JOIN docs t ON t.id=l.target WHERE l.source=? OR l.target=?""", (ident, ident))
        return rows

    def link(self, source, target, kind="related", why="", by="me"):
        source, target = self.resolve_ref(source), self.resolve_ref(target)
        if source.startswith("file:"):
            raise ValueError("关系要从 Markdown 文档出发（主题、卡片、课程、笔记）")
        if source == target or kind not in LINK_KINDS:
            raise ValueError("关系类型应为 " + "/".join(sorted(LINK_KINDS)) + "，且不能指向自己")
        if kind in ACYCLIC:
            adjacency = {}
            for r in self.index.rows("SELECT source, target FROM links WHERE kind=?", (kind,)):
                adjacency.setdefault(r["source"], []).append(r["target"])
            pending, visited = [target], set()
            while pending:
                item = pending.pop()
                if item == source:
                    raise ValueError("这条关系会造成依赖循环")
                if item not in visited:
                    visited.add(item)
                    pending.extend(adjacency.get(item, []))
        ident = uid()

        def change(a, b):
            links = [l for l in a.get("links") or [] if not (l.get("to") == target and l.get("as") == kind)]
            links.append({"id": ident, "to": target, "as": kind, "why": text(why, 2000), "by": by, "created": now()})
            return {**a, "links": links}, b
        self._edit_doc(source, change)
        return ident

    def unlink(self, ident):
        row = self.index.one("SELECT source FROM links WHERE id=?", (ident,))
        if not row:
            raise ValueError("找不到这条关系")
        self._edit_doc(row["source"], lambda a, b: ({**a, "links": [l for l in a.get("links") or [] if l.get("id") != ident]}, b))
        return True

    # ---- lessons, notes, insights -----------------------------------------------------------------------
    def lesson_save(self, data, by="me"):
        old = self.doc(data["id"], "lesson") if data.get("id") else None
        attrs = dict(old["attrs"]) if old else {"id": uid(), "kind": "lesson", "by": by}
        state = data.get("state", attrs.get("state", "draft"))
        if state not in {"draft", "current", "done"}:
            raise ValueError("课程状态无效")
        attrs.update(title=title_of(data.get("title", attrs.get("title", ""))), topic=data.get("topic", attrs.get("topic")) or None,
                     objective=text(data.get("objective", attrs.get("objective", "")), 2000), state=state)
        body = text(data.get("body", old["body"] if old else ""))
        self._write_doc("lessons", attrs, body, old["path"] if old else None)
        return self.doc(attrs["id"])

    def note_create(self, title, body, folder="随手记", tags=(), by="me", topic=None):
        """A note in a folder under notes/; an empty folder means notes/ itself."""
        clean = "/".join(p for p in re.sub(r'[\\:*?"<>|]', " ", str("随手记" if folder is None else folder)).split("/") if p.strip() and p.strip() not in (".", ".."))
        folder = "notes" + ("/" + clean.strip()[:120] if clean.strip() else "")
        attrs = {"id": uid(), "kind": "note", "title": title_of(title), "tags": [text(str(t), 40) for t in list(tags)[:20]], "by": by, "topic": topic}
        return self._write_doc(folder, attrs, text(body))

    def insight_add(self, topic, kind, name, detail, practice=None, by="tutor"):
        if kind not in {"weak", "strength"}:
            raise ValueError("只能记薄弱点（weak）或做得好的地方（strength）")
        attrs = {"id": uid(), "kind": "insight", "insight": kind, "title": title_of(name), "topic": topic, "practice": practice,
                 "state": "active", "by": by}
        self._write_doc("insights", attrs, text(detail, 2000))
        self.record("insight", {"kind": kind, "title": attrs["title"], "detail": detail[:400]}, by, [attrs["id"], *([topic] if topic else [])])
        return attrs["id"]

    def insight_resolve(self, ident, by="me"):
        row = self.doc(ident, "insight")
        self._edit_doc(ident, lambda a, b: ({**a, "state": "resolved"}, b))
        self.record("insight", {"resolved": True, "title": row["title"]}, by, [ident])
        return True

    def insights(self, topic=None, state=None):
        where, args = "", []
        if topic is not None:
            where += " AND topic=?"
            args.append(topic)
        out = []
        for row in self.docs("insight", where, args):
            a = row["attrs"]
            if state and a.get("state", "active") != state:
                continue
            out.append({"id": row["id"], "kind": a.get("insight", "weak"), "title": row["title"], "detail": row["body"],
                        "topic": row["topic"], "practice": a.get("practice"), "state": a.get("state", "active"), "created": row["created"]})
        return out

    # ---- files: the vault and the learner's mounted folders --------------------------------------------
    def projects(self):
        return self.setting("projects", [])

    def add_project(self, name, path):
        p = Path(path).expanduser().resolve()
        if not p.is_dir():
            raise ValueError(f"目录不存在：{p}")
        if p == self.root or p.is_relative_to(self.root) or self.root.is_relative_to(p):
            raise ValueError("学习库本身不用挂载")
        projects = self.projects()
        existing = next((x for x in projects if x["path"] == str(p)), None)
        if existing:
            return existing
        project = {"id": uid(), "name": str(name or p.name)[:120], "path": str(p), "created": now()}
        self.set_setting("projects", projects + [project])
        return project

    def remove_project(self, ident):
        self.set_setting("projects", [x for x in self.projects() if x["id"] != ident])
        return True

    def resolve(self, path):
        """A vault-relative path or an absolute path inside a mounted folder -> (absolute path, vault rel or None)."""
        raw = str(path or "").strip()
        if not raw:
            raise ValueError("请给出文件路径")
        candidate = Path(raw).expanduser()
        if candidate.is_absolute():
            resolved = candidate.resolve()
            if resolved.is_relative_to(self.root.resolve()):
                return resolved, self.vault.rel(resolved)
            for p in self.projects():
                if resolved.is_relative_to(Path(p["path"]).resolve()):
                    if any(part.startswith(".env") for part in resolved.parts):
                        raise ValueError("为避免泄露凭据，不读写环境密钥文件")
                    return resolved, None
            raise ValueError("只能访问学习库和挂载的目录：" + raw)
        resolved = self.vault.path(raw)
        return resolved, self.vault.rel(resolved)

    def read_file(self, path, limit=2 * 1024 * 1024):
        absolute, rel = self.resolve(path)
        if not absolute.is_file():
            raise ValueError("文件不存在：" + str(path))
        size = absolute.stat().st_size
        data = absolute.read_bytes()[:limit]
        try:
            content = data.decode("utf-8")
        except UnicodeDecodeError:
            return {"path": rel or str(absolute), "binary": True, "size": size, "mtime": str(absolute.stat().st_mtime_ns)}
        return {"path": rel or str(absolute), "content": content, "truncated": size > limit, "size": size, "mtime": str(absolute.stat().st_mtime_ns)}

    def write_file(self, path, content, expected=None):
        absolute, rel = self.resolve(path)
        if len(content) > 4 * 1024 * 1024:
            raise ValueError("文件超过 4MB")
        if expected is not None and absolute.exists() and str(absolute.stat().st_mtime_ns) != str(expected):
            raise VaultError("conflict")
        if rel is None:
            absolute.write_text(content, encoding="utf-8")
            return {"path": str(absolute), "mtime": str(absolute.stat().st_mtime_ns)}
        if rel.startswith(APPEND_ONLY) or rel.startswith(".lattice/"):
            raise ValueError("对话、轨迹和 .lattice 由 Lattice 自己维护")
        self.vault.write_text(rel, content)
        self.index.reindex(rel)
        return {"path": rel, "mtime": self.vault.mtime(rel)}

    def create_file(self, folder, name, content=""):
        folder = str(folder or "code").strip("/")
        stem, ext = os.path.splitext(slug(name, 80))
        rel = self.vault.unique(folder, stem or "未命名", ext)
        if rel.endswith(".ipynb") and not content:
            content = json.dumps(self._empty_notebook(stem or "实验笔记"), ensure_ascii=False, indent=1) + "\n"
        self.write_file(rel, content)
        return rel

    def rename_file(self, path, new_name):
        _, rel = self.resolve(path)
        if rel is None or rel.startswith(APPEND_ONLY) or rel in KEPT:
            raise ValueError("这个文件不能在这里改名")
        target = rel.rsplit("/", 1)[0] + "/" + slug(new_name, 120) if "/" in rel else slug(new_name, 120)
        self.vault.move(rel, target)
        self.index.unindex(rel)
        self.index.reindex(target)
        return target

    def delete_file(self, path):
        absolute, rel = self.resolve(path)
        if rel is None or rel.startswith(APPEND_ONLY) or rel in {*KEPT, ""} or "/" not in rel and absolute.is_dir():
            raise ValueError("这个文件不能删除")
        inside = [self.vault.rel(p) for p in absolute.rglob("*") if p.is_file()] if absolute.is_dir() else [rel]
        self.vault.remove(rel)
        for f in inside:
            self.index.unindex(f)
        return True

    # ---- managing notes and their folders: the learner's own filing ------------------------------------------
    def _movable(self, path):
        absolute, rel = self.resolve(path)
        if rel is None or "/" not in rel or rel.startswith(APPEND_ONLY) or rel.startswith(".lattice/") or not absolute.exists():
            raise ValueError("这个不能移动或改名")
        return absolute, rel

    def _relocate(self, rel, target):
        absolute = self.vault.path(rel)
        if self.vault.path(target).exists():
            raise ValueError("那里已经有同名的了：" + target)
        inside = [self.vault.rel(p) for p in absolute.rglob("*") if p.is_file()] if absolute.is_dir() else [rel]
        self.vault.move(rel, target)
        for old in inside:
            self.index.unindex(old)
            self.index.reindex(target + old[len(rel):])
        return target

    def move_into(self, path, folder):
        """Move a file or folder into another folder of the same kind, so a note stays a note."""
        _, rel = self._movable(path)
        dest_abs, dest = self.resolve(folder)
        if dest is None or not dest_abs.is_dir():
            raise ValueError("目标不是学习库里的文件夹")
        if dest.split("/", 1)[0] != rel.split("/", 1)[0]:
            raise ValueError("只能移到同一类的文件夹里（笔记留在笔记里）")
        if dest == rel or dest.startswith(rel + "/"):
            raise ValueError("不能把文件夹移进它自己里面")
        if rel.rsplit("/", 1)[0] == dest:
            return rel
        return self._relocate(rel, dest + "/" + rel.rsplit("/", 1)[-1])

    def folder_rename(self, path, name):
        absolute, rel = self._movable(path)
        if not absolute.is_dir():
            raise ValueError("这不是文件夹")
        clean = re.sub(r'[\\/:*?"<>|]', " ", str(name)).strip()[:120]
        if not clean or clean in (".", ".."):
            raise ValueError("文件夹名不能为空")
        return self._relocate(rel, rel.rsplit("/", 1)[0] + "/" + clean)

    def folder_create(self, parent, name):
        absolute, rel = self.resolve(parent)
        clean = "/".join(p.strip() for p in re.sub(r'[\\:*?"<>|]', " ", str(name)).split("/") if p.strip() and p.strip() not in (".", ".."))
        if rel is None or not rel or rel.startswith(APPEND_ONLY) or rel.startswith(".lattice") or not clean:
            raise ValueError("这里不能建文件夹")
        target = self.vault.path(rel + "/" + clean[:120])
        target.mkdir(parents=True, exist_ok=True)
        return self.vault.rel(target)

    def relink(self, old, new):
        """A renamed document keeps its links: [[old]] (with a heading or shown text) becomes [[new]] everywhere."""
        if not old or not new or old == new:
            return []
        pattern = re.compile(r"(!?\[\[)" + re.escape(old) + r"(?=\s*[\]|#])", re.I)
        changed = []
        for d in self.index.rows("SELECT id, body FROM docs WHERE body LIKE ?", ("%[[%",)):
            if pattern.search(d["body"] or ""):
                changed.append(self._edit_doc(d["id"], lambda a, b: (a, outside_code(b, lambda part: pattern.sub(lambda m: m.group(1) + new, part)))))
        return changed

    def note_links(self, ident):
        """For one document: what links to it, where its title appears without a link, and what it links to."""
        row = self.doc(ident)
        key = row["title"].casefold()
        docs = self.index.rows("SELECT id, kind, title, path, body FROM docs")
        by_title = {}
        for d in docs:
            by_title.setdefault(d["title"].casefold(), d)
        brief = lambda d: {"id": d["id"], "kind": d["kind"], "title": d["title"], "path": d["path"]}
        backlinks, unlinked = [], []
        for d in docs:
            if d["id"] == row["id"]:
                continue
            lines = (d["body"] or "").split("\n")
            linked = [i for i, l in enumerate(lines) if any(wiki_target(m).casefold() == key for m in WIKI.findall(l))]
            if linked:
                backlinks.append({**brief(d), "lines": [{"line": i + 1, "text": lines[i].strip()[:240]} for i in linked[:5]]})
                continue
            if len(key) >= 2:
                plain = [i for i, l in enumerate(lines) if key in WIKI.sub("", l).casefold()]
                if plain:
                    unlinked.append({**brief(d), "lines": [{"line": i + 1, "text": lines[i].strip()[:240]} for i in plain[:3]]})
        known = {b["id"] for b in backlinks}
        for l in self.links_of(row["id"]):
            other = l["source"] if l["target"] == row["id"] else None
            if other and other not in known:
                d = next((x for x in docs if x["id"] == other), None)
                if d:
                    known.add(other)
                    backlinks.append({**brief(d), "lines": [], "link": l["kind"]})
        outgoing, seen = [], set()
        for raw in WIKI.findall(row["body"] or ""):
            name = wiki_target(raw)
            if not name or name.casefold() in seen:
                continue
            seen.add(name.casefold())
            d = by_title.get(name.casefold())
            path = d["path"] if d else (name if self.vault.path(name).is_file() else None) if "/" in name or "." in name else None
            outgoing.append({"name": name, "path": path, "kind": d["kind"] if d else ("file" if path else None)})
        return {"title": row["title"], "backlinks": backlinks[:100], "unlinked": unlinked[:60], "outgoing": outgoing[:200]}

    def tags(self):
        """Every tag, from documents' attributes and #tags in their text, with the documents that carry it."""
        out = {}
        for d in self.index.rows("SELECT id, kind, title, path, attrs, body FROM docs"):
            a = json.loads(d["attrs"])
            names = {str(t).strip().lstrip("#") for t in (a.get("tags") or []) if str(t).strip()} | set(inline_tags(d["body"]))
            for n in names:
                out.setdefault(n, []).append({"id": d["id"], "kind": d["kind"], "title": d["title"], "path": d["path"]})
        return sorted(({"tag": k, "count": len(v), "docs": v} for k, v in out.items()), key=lambda x: (-x["count"], x["tag"].casefold()))

    def tree(self, path=""):
        """One level of a folder: the vault root, a vault folder, or a mounted folder."""
        if not path:
            entries = [{"name": d, "path": d, "type": "dir"} for d in self._dirs(self.root)]
            entries += [{"name": f.name, "path": f.name, "type": "file"} for f in sorted(self.root.iterdir()) if f.is_file() and not f.name.startswith(".")]
            entries += [{"name": p["name"], "path": p["path"], "type": "dir", "project": p["id"]} for p in self.projects()]
            return entries
        absolute, rel = self.resolve(path)
        if not absolute.is_dir():
            return []
        out = []
        for child in sorted(absolute.iterdir(), key=lambda x: (not x.is_dir(), x.name.casefold())):
            if child.name.startswith(".") or child.name in {"__pycache__", "node_modules", "target"} or child.is_symlink():
                continue
            out.append({"name": child.name, "path": self.vault.rel(child) if rel is not None else str(child), "type": "dir" if child.is_dir() else "file"})
            if len(out) >= 400:
                break
        return out

    ORDER = ("topics", "cards", "notes", "lessons", "notebooks", "code", "data", "insights", "skills", "envs", "agents", "threads", "journal")

    def _dirs(self, base):
        names = [d.name for d in base.iterdir() if d.is_dir() and not d.name.startswith(".")]
        return sorted(names, key=lambda n: (self.ORDER.index(n) if n in self.ORDER else len(self.ORDER), n))

    def history(self, path):
        """A file's versions, newest first, each numbered from the first; the newest is marked current when it is what
        the file holds now (edits not yet committed make the file newer than every version)."""
        _, rel = self.resolve(path)
        if rel is None:
            return []
        row = self.index.one("SELECT id FROM files WHERE path=? AND kind IN ('topic','card','lesson','note','insight')", (rel,))
        versions = self.vault.history(rel, row["id"] if row else None)
        for i, v in enumerate(versions):
            v["number"] = len(versions) - i
        if versions and self.vault.at(versions[0]["commit"], versions[0]["path"]) == (self.vault.read_text(rel) if self.vault.path(rel).exists() else None):
            versions[0]["current"] = True
        return versions

    # ---- notebooks: standard .ipynb files ------------------------------------------------------------
    @staticmethod
    def _empty_notebook(name, topic=None):
        return {"nbformat": 4, "nbformat_minor": 5, "cells": [],
                "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                             "language_info": {"name": "python"}, "lattice": {"id": uid(), "title": name, "topic": topic, "created": now()}}}

    def notebook_create(self, name, topic=None, folder="notebooks"):
        rel = self.vault.unique(folder, name, ".ipynb")
        self.vault.write_json(rel, self._empty_notebook(title_of(name), topic))
        self.index.reindex(rel)
        return rel

    def notebook(self, path):
        _, rel = self.resolve(path)
        nb = self.vault.read_json(rel) if rel else json.loads(self.resolve(path)[0].read_text(encoding="utf-8"))
        cells = []
        for c in nb.get("cells") or []:
            meta = (c.get("metadata") or {}).get("lattice") or {}
            src = source_of(c)
            cells.append({"id": c.get("id") or meta.get("id"), "kind": "code" if c.get("cell_type") == "code" else "markdown", "source": src,
                          "outputs": c.get("outputs") or [], "count": c.get("execution_count"), "run_source": meta.get("run_source"),
                          "stale": meta.get("run_source") is not None and meta.get("run_source") != src, "by": meta.get("by")})
        meta = (nb.get("metadata") or {}).get("lattice") or {}
        return {"path": rel or str(path), "id": meta.get("id"), "title": meta.get("title") or Path(str(path)).stem, "topic": meta.get("topic"),
                "env": meta.get("env"), "cells": cells}

    def _nb_change(self, path, change):
        _, rel = self.resolve(path)
        if rel is None:
            raise ValueError("只能修改学习库里的实验笔记")
        nb = self.vault.read_json(rel)
        for c in nb.setdefault("cells", []):
            # nbformat 4.5 ids; older notebooks get one the first time Lattice touches them.
            c.setdefault("id", ((c.get("metadata") or {}).get("lattice") or {}).get("id") or uid())
        result = change(nb["cells"])
        nb["nbformat_minor"] = max(int(nb.get("nbformat_minor") or 0), 5)
        nb.setdefault("metadata", {}).setdefault("lattice", {})["updated"] = now()
        self.vault.write_json(rel, nb)
        self.index.reindex(rel)
        return result

    @staticmethod
    def _find(cells, ident):
        for i, c in enumerate(cells):
            if c.get("id") == ident:
                return i, c
        raise ValueError("找不到这个单元格：" + str(ident))

    def cell_save(self, path, source, kind="code", ident=None, after=None, by="me"):
        if kind not in {"code", "markdown"}:
            raise ValueError("单元格类型应为 code 或 markdown")
        text(source, 400000)

        def change(cells):
            if ident:
                _, cell = self._find(cells, ident)
            else:
                cell = {"id": uid(), "metadata": {}}
                cells.insert(self._find(cells, after)[0] + 1 if after else len(cells), cell)
            cell["cell_type"], cell["source"] = kind, source.splitlines(True)
            meta = cell.setdefault("metadata", {}).setdefault("lattice", {})
            if by != "me":
                meta["by"] = by
            if kind == "code":
                cell.setdefault("outputs", [])
                cell.setdefault("execution_count", None)
            else:
                cell.pop("outputs", None)
                cell.pop("execution_count", None)
            return cell["id"]
        return self._nb_change(path, change)

    def cell_delete(self, path, ident):
        return self._nb_change(path, lambda cells: cells.pop(self._find(cells, ident)[0]) and True)

    def cell_move(self, path, ident, direction):
        def change(cells):
            at, _ = self._find(cells, ident)
            to = max(0, min(len(cells) - 1, at + (-1 if int(direction) < 0 else 1)))
            cells[at], cells[to] = cells[to], cells[at]
            return True
        return self._nb_change(path, change)

    def cell_result(self, path, ident, outputs, count, source):
        def change(cells):
            try:
                _, cell = self._find(cells, ident)
            except ValueError:
                return False  # deleted while it ran; the run itself is still in the journal
            cell["outputs"], cell["execution_count"] = outputs, count
            cell.setdefault("metadata", {}).setdefault("lattice", {})["run_source"] = source
            return True
        return self._nb_change(path, change)

    # ---- what the agents know about the learner -------------------------------------------------------------
    ME_HEAD = ("# 关于我\n\nLattice 的每个 AI 每一轮都会读这份记录。AI 记下的每一条都显示在当时那条回复下面，点「撤销」就去掉；"
               "你也可以直接改这个文件。\n\n")

    def me(self):
        """What holds about the learner whatever they are learning: one line each."""
        if not self.vault.path(ME).exists():
            return []
        return [line[2:].strip() for line in self.vault.read_text(ME).splitlines() if line.startswith("- ") and line[2:].strip()]

    def remember(self, text, replace=None):
        """Note one thing about the learner, or change (or, with no text, drop) the line `replace`."""
        lines = self.vault.read_text(ME).splitlines() if self.vault.path(ME).exists() else self.ME_HEAD.splitlines()
        text = re.sub(r"\s+", " ", str(text or "")).strip()[:300]
        if replace is not None:
            at = next((i for i, line in enumerate(lines) if line.startswith("- ") and line[2:].strip() == str(replace).strip()), None)
            if at is None:
                raise ValueError("没有这一条：replace 要和记录里的某一条一字不差")
            lines[at:at + 1] = ["- " + text] if text else []
        elif not text:
            raise ValueError("要记的内容是空的")
        elif text in self.me():
            return False
        elif len(self.me()) >= 40:
            raise ValueError("记录已经有 40 条：先用 replace 把相近的几条合并")
        else:
            while lines and not lines[-1].strip():
                lines.pop()
            lines += ([""] if lines and not lines[-1].startswith("- ") else []) + ["- " + text]
        self.vault.write_text(ME, "\n".join(lines).rstrip() + "\n")
        return True

    # ---- conversations ------------------------------------------------------------------------------
    def thread_new(self, agent, topic=None, title=None, attrs=None):
        t = now()
        head = {"id": uid(), "kind": "thread", "agent": agent, "title": title or agent, "topic": topic, "created": t, **(attrs or {})}
        rel = f"threads/{t[:7]}/{head['id']}.jsonl"
        self.vault.write_lines(rel, [head])
        self.index.reindex(rel)
        return head

    def thread_for(self, agent, topic=None):
        """The conversation an agent is having about a topic (None: the default conversation). The quick answer's is the
        one that goes with the tutor's conversation there."""
        if agent == "flash":
            return self.flash_for(self.thread_for("tutor", topic))
        current = self.current_thread(agent, topic)
        if current:
            return current
        name = self.doc(topic, "topic")["title"] if topic else None
        return self.thread_new(agent, topic, ({"tutor": "主会话", "flash": "快答"}.get(agent, agent)) + (" · " + name if name else ""))["id"]

    def paired_flash(self, tutor):
        """The quick-answer conversation beside one of the tutor's (the newest, when a fresh one was started), if any."""
        row = self.index.one("SELECT id FROM threads WHERE agent='flash' AND json_extract(head,'$.pair')=? ORDER BY created DESC LIMIT 1", (tutor,))
        return row["id"] if row else None

    def flash_for(self, tutor, fresh=False):
        """Each of the tutor's conversations has a quick-answer conversation of its own beside it, made when first
        needed (or again, fresh, when the learner starts it over)."""
        found = None if fresh else self.paired_flash(tutor)
        if found:
            return found
        topic = self.thread_head(tutor).get("topic")
        name = self.doc(topic, "topic")["title"] if topic else None
        return self.thread_new("flash", topic, "快答" + (" · " + name if name else ""), {"pair": tutor})["id"]

    def current_thread(self, agent, topic=None):
        """The one the learner last opened about this topic, while it is still there and not archived; else the newest."""
        # Practice conversations and skill trials are threads of their own, never the conversation itself.
        live = ("agent=? AND topic IS ? AND json_extract(head,'$.practice') IS NULL AND json_extract(head,'$.trial') IS NULL "
                "AND COALESCE(json_extract(head,'$.archived'),0)=0")
        picked = (self.setting("current_threads") or {}).get(f"{agent}:{topic or ''}")
        row = (picked and self.index.one(f"SELECT id FROM threads WHERE id=? AND {live}", (picked, agent, topic))
               or self.index.one(f"SELECT id FROM threads WHERE {live} ORDER BY created DESC LIMIT 1", (agent, topic)))
        return row["id"] if row else None

    def thread_pick(self, ident):
        """Open a conversation as its agent's one about its topic, until another is picked."""
        head = self.thread_head(ident)
        picked = self.setting("current_threads") or {}
        picked[f"{head['agent']}:{head.get('topic') or ''}"] = ident
        self.set_setting("current_threads", picked)
        return head

    def sessions(self, agent, topic=None, every=False):
        """An agent's conversations about a topic (None: the default conversation; every: about any topic), newest first:
        a topic can have many, each named by the learner or else by its first question."""
        rows = self.index.rows("SELECT t.id, t.head, t.created, t.updated, COUNT(m.id) AS n, "
                               "(SELECT content FROM messages WHERE thread=t.id AND role='user' ORDER BY id LIMIT 1) AS first, "
                               "(SELECT content FROM messages WHERE thread=t.id AND role='user' ORDER BY id DESC LIMIT 1) AS last, "
                               "(SELECT content FROM messages WHERE thread=t.id AND role='assistant' ORDER BY id DESC LIMIT 1) AS answer "
                               "FROM threads t LEFT JOIN messages m ON m.thread=t.id WHERE t.agent=? AND (? OR t.topic IS ?) "
                               "AND json_extract(t.head,'$.practice') IS NULL AND json_extract(t.head,'$.trial') IS NULL "
                               "GROUP BY t.id ORDER BY t.created DESC", (agent, every, topic))
        out = []
        for r in rows:
            head = json.loads(r["head"])
            first = re.sub(r"\s+", " ", r["first"] or "").strip()
            out.append({"id": r["id"], "topic": head.get("topic"), "summary": (head.get("summary") or {}).get("text", ""), "title": head["title"] if head.get("named") else (first[:28] or "新会话"), "named": bool(head.get("named")),
                        "archived": bool(head.get("archived")), "created": r["created"], "updated": r["updated"], "messages": r["n"],
                        "last": re.sub(r"\s+", " ", r["last"] or "").strip()[:120],
                        "answer": re.sub(r"\s+", " ", re.sub(r"```.*?(```|$)", "", r["answer"] or "", flags=re.S)).strip()[:160]})
        return out

    # Folders that are Lattice's own records or the learner's settings, not material to look for.
    UNLISTED = (*APPEND_ONLY, ".lattice/", "agents/", "skills/", "envs/", "apps/assets/", ".git")

    def file_map(self):
        """Every file of the vault by where it came up: under its topic, in the conversations it was written, changed,
        opened, attached, noted or built in (a quick answer's, a practice's or an app build's count as the tutor
        conversation they go with); the rest by folder. Newest first everywhere."""
        docs = {r["path"]: r for r in self.index.rows("SELECT id, path, kind, title, topic, attrs, updated FROM docs")}
        by_id = {r["id"]: r["path"] for r in docs.values()}
        paths = [r["path"] for r in self.index.rows("SELECT path FROM files")
                 if not r["path"].startswith(self.UNLISTED) and r["path"] not in KEPT and docs.get(r["path"], {"kind": ""})["kind"] != "topic"]
        threads = {r["id"]: {"agent": r["agent"], "topic": r["topic"], "head": json.loads(r["head"])}
                   for r in self.index.rows("SELECT id, agent, topic, head FROM threads")}
        built = {}
        for r in self.index.rows("SELECT refs FROM journal WHERE type='built'"):
            refs = json.loads(r["refs"])
            if len(refs) >= 2:
                built[refs[1]] = refs[0]

        def tutor_of(thread, depth=0):
            t = threads.get(thread)
            if not t or depth > 3:
                return None
            head = t["head"]
            if t["agent"] == "tutor":
                return None if head.get("trial") else thread
            if t["agent"] == "flash":
                return tutor_of(head.get("pair"), depth + 1)
            if t["agent"] == "builder":
                return tutor_of(built.get(thread), depth + 1)
            if t["agent"] == "coach" and head.get("practice", {}).get("source_message"):
                row = self.index.one("SELECT thread FROM messages WHERE id=?", (head["practice"]["source_message"],))
                return tutor_of(row["thread"], depth + 1) if row else None
            return None

        touched, topic_hint = {}, {}

        def touch(path, thread, at, topic=None):
            path = str(path or "").split("#", 1)[0]
            if not path:
                return
            tutor = tutor_of(thread) if thread else None
            if tutor:
                touched.setdefault(path, {})
                touched[path][tutor] = max(at, touched[path].get(tutor, ""))
            if topic and path not in topic_hint:
                topic_hint[path] = topic

        for r in self.index.rows("SELECT at, type, refs, data FROM journal WHERE type IN ('action','wrote','built','carded') ORDER BY at DESC"):
            data, refs = json.loads(r["data"]), json.loads(r["refs"])
            if r["type"] == "action":
                ref = str(data.get("ref") or "")
                if ref.startswith(("file:", "cell:")):
                    touch(ref.split(":", 1)[1], data.get("thread"), r["at"], data.get("topic"))
            elif r["type"] == "wrote":
                for f in data.get("files") or []:
                    touch(f.get("file"), data.get("thread"), r["at"], data.get("topic"))
                if data.get("file"):
                    touch(data["file"], refs[0] if refs else None, r["at"])
            elif r["type"] == "built":
                touch(data.get("file"), refs[0] if refs else None, r["at"])
            elif r["type"] == "carded":
                for card in data.get("cards") or []:
                    touch(by_id.get(card.get("id") if isinstance(card, dict) else card), refs[0] if refs else None, r["at"])
        for r in self.index.rows("SELECT thread, meta, at FROM messages WHERE meta LIKE '%\"attach\"%'"):
            for path in json.loads(r["meta"]).get("attach") or []:
                touch(path, r["thread"], r["at"])
        for t_id, t in threads.items():
            practice = t["head"].get("practice")
            if practice and practice.get("file"):
                touch(practice["file"], t_id, t["head"].get("created", ""), practice.get("topic"))

        sessions = {s["id"]: s for s in self.sessions("tutor", every=True)}
        topics = {r["id"]: r for r in docs.values() if r["kind"] == "topic"}
        tree, loose = {}, {}
        for path in paths:
            doc = docs.get(path)
            try:
                mtime = datetime.fromtimestamp(self.vault.path(path).stat().st_mtime).astimezone().isoformat(timespec="seconds")
            except OSError:
                continue
            convs = touched.get(path, {})
            entry = {"path": path, "title": doc["title"] if doc else path.rsplit("/", 1)[-1], "kind": doc["kind"] if doc else kind_of(path),
                     "at": max([mtime, *convs.values()])}
            topic = (doc["topic"] if doc and doc["topic"] in topics else None) or next(
                (sessions[c]["topic"] for c in convs if c in sessions), None) or (topic_hint.get(path) if topic_hint.get(path) in topics else None)
            if not convs and not topic:
                loose.setdefault(path.split("/", 1)[0] if "/" in path else "", []).append(entry)
                continue
            node = tree.setdefault(topic or "", {"threads": {}, "files": []})
            listed = False
            for conv in convs:
                if conv in sessions and (sessions[conv]["topic"] or "") == (topic or ""):
                    node["threads"].setdefault(conv, []).append({**entry, "at": convs[conv]})
                    listed = True
            if not listed:
                node["files"].append(entry)
        newest = lambda files: max((f["at"] for f in files), default="")
        out, active = [], self.active_topic()
        for key, node in tree.items():
            convs = [{"id": c, "title": sessions[c]["title"], "archived": sessions[c]["archived"], "current": False,
                      "files": sorted(files, key=lambda f: f["at"], reverse=True)} for c, files in node["threads"].items()]
            convs.sort(key=lambda c: newest(c["files"]), reverse=True)
            files = sorted(node["files"], key=lambda f: f["at"], reverse=True)
            topic = topics.get(key)
            out.append({"id": key, "title": topic["title"] if topic else "默认对话", "path": topic["path"] if topic else None,
                        "state": json.loads(topic["attrs"]).get("state") if topic else None, "active": (key or None) == active,
                        "threads": convs, "files": files, "at": max(newest(files), *(newest(c["files"]) for c in convs), "")})
        out = [t for t in out if t["active"]] + sorted((t for t in out if not t["active"]), key=lambda t: t["at"], reverse=True)
        current = self.current_thread("tutor", active)
        for t in out:
            for c in t["threads"]:
                c["current"] = c["id"] == current
        return {"topics": out, "loose": [{"folder": k, "files": sorted(v, key=lambda f: f["at"], reverse=True)}
                                         for k, v in sorted(loose.items(), key=lambda kv: newest(kv[1]), reverse=True)]}

    def unsaved_threads(self):
        """The tutor's conversations with replies since they were last saved, and when the last thing was said in each."""
        return self.index.rows("SELECT t.id AS thread, MAX(m.at) AS at FROM threads t JOIN messages m ON m.thread=t.id "
                               "WHERE t.agent='tutor' AND json_extract(t.head,'$.practice') IS NULL AND json_extract(t.head,'$.trial') IS NULL "
                               "AND m.id > COALESCE(json_extract(t.head,'$.summary.upto'),0) GROUP BY t.id "
                               "HAVING SUM(m.role='assistant') > 0")

    def thread_head(self, ident):
        row = self.index.one("SELECT head FROM threads WHERE id=?", (ident,))
        if not row:
            raise ValueError("会话不存在")
        return json.loads(row["head"])

    def thread_update(self, ident, **attrs):
        rel = self.index.one("SELECT path FROM threads WHERE id=?", (ident,))["path"]
        lines = self.vault.read_lines(rel)
        lines[0].update(attrs)
        self.vault.write_lines(rel, lines)
        self.index.reindex(rel)
        return lines[0]

    def messages(self, thread, limit=1500):
        rows = self.index.rows("SELECT * FROM messages WHERE thread=? ORDER BY id DESC LIMIT ?", (thread, limit))
        rows.reverse()
        for r in rows:
            r["meta"] = json.loads(r["meta"])
        return rows

    def append_message(self, thread, role, content, meta=None):
        row = self.index.one("SELECT path FROM threads WHERE id=?", (thread,))
        if not row:
            raise ValueError("会话不存在")
        ident = (self.db.execute("SELECT MAX(id) FROM messages").fetchone()[0] or 0) + 1
        message = {"id": ident, "role": role, "content": content, "meta": meta or {}, "at": now()}
        self.vault.append_line(row["path"], message)
        self.db.execute("INSERT INTO messages VALUES(?,?,?,?,?,?)", (ident, thread, role, content, dump(meta or {}), message["at"]))
        self.db.execute("UPDATE threads SET updated=? WHERE id=?", (message["at"], thread))
        self.db.commit()
        return ident

    def move_messages(self, ids, target):
        """Move some messages into another conversation, keeping their ids and times."""
        ids = {int(i) for i in ids}
        if not ids:
            return 0
        moved = []
        sources = {r["path"] for r in self.index.rows(f"SELECT t.path FROM messages m JOIN threads t ON t.id=m.thread WHERE m.id IN ({','.join('?' * len(ids))})", tuple(ids))}
        target_rel = self.index.one("SELECT path FROM threads WHERE id=?", (target,))["path"]
        for rel in sources - {target_rel}:
            lines = self.vault.read_lines(rel)
            moved += [m for m in lines[1:] if m.get("id") in ids]
            self.vault.write_lines(rel, [lines[0]] + [m for m in lines[1:] if m.get("id") not in ids])
            self.index.reindex(rel)
        if moved:
            lines = self.vault.read_lines(target_rel)
            self.vault.write_lines(target_rel, [lines[0]] + sorted(lines[1:] + moved, key=lambda m: m["id"]))
            self.index.reindex(target_rel)
        return len(moved)

    # ---- practices: a coach conversation whose header carries the practice ----------------------------------
    def practice_create(self, topic, seed, goal, ext=".py", source_message=None, by="me"):
        seed, goal = text(seed, 30000).strip(), text(goal, 1000).strip()
        if not seed:
            raise ValueError("没有可以练习的讲解内容")
        short = re.split(r"[，。；：,;:（(\n]", goal)[0][:32].strip() if goal else ""
        found = re.search(r"^#+\s*(.+)$", seed, re.M) or re.search(r"\*\*(.+?)\*\*", seed)
        name = "练习 · " + (short or (found.group(1).strip(" #*：:。.")[:32] if found else "") or (self.doc(topic)["title"] if topic else "动手"))
        ext = ext if re.fullmatch(r"\.[A-Za-z0-9]{1,8}", ext or "") else ".py"
        file = self.notebook_create(name, topic, "code") if ext == ".ipynb" else self.create_file("code", name + ext, "")
        head = self.thread_new("coach", topic, name, {"practice": {"topic": topic, "state": "active", "seed": seed, "goal": goal,
                                                                     "file": file, "source_message": source_message, "by": by}})
        return self.practice(head["id"])

    def practice(self, ident):
        head = self.thread_head(ident)
        if not head.get("practice"):
            raise ValueError("这不是练习")
        return {"id": ident, "title": head["title"], **head["practice"], "created": head["created"],
                "insights": [i for i in self.insights() if i["practice"] == ident]}

    def practices(self, topic=None):
        out = []
        for row in self.index.rows("SELECT id, head FROM threads WHERE json_extract(head,'$.practice') IS NOT NULL ORDER BY created DESC"):
            head = json.loads(row["head"])
            if topic is None or head["practice"].get("topic") == topic:
                out.append({"id": row["id"], "title": head["title"], **{k: head["practice"].get(k) for k in ("topic", "state", "file", "next_focus", "ended")}})
        return out

    def practice_state(self, ident, state, next_focus=None):
        practice = dict(self.thread_head(ident)["practice"])
        practice["state"] = state
        if state == "done":
            practice["ended"] = now()
        if next_focus is not None:
            practice["next_focus"] = text(next_focus, 2000).strip()
        self.thread_update(ident, practice=practice)
        return self.practice(ident)

    def practice_review(self, ident, weak, strong, next_focus, by="tutor"):
        """A tutor's review of one practice; weak points stay active until resolved."""
        p = self.practice(ident)
        for insight in p["insights"]:
            self._remove(self.doc(insight["id"])["path"])
        for kind, items in (("weak", weak), ("strength", strong)):
            if not isinstance(items, list):
                raise ValueError("薄弱点和做得好的地方应为数组")
            for item in items[:8]:
                item = {"title": item} if isinstance(item, str) else item
                if isinstance(item, dict) and str(item.get("title", "")).strip():
                    self.insight_add(p["topic"], kind, str(item["title"]), str(item.get("detail", "")), ident, by)
        return self.practice_state(ident, "done", next_focus)

    # ---- the journal: append-only, one file per day -------------------------------------------------------
    def record(self, kind, data, actor="app", refs=()):
        entry = {"id": uid(), "at": now(), "actor": actor, "type": kind, "refs": [str(r) for r in refs if r], "data": data}
        self.vault.append_line(f"journal/{entry['at'][:4]}/{entry['at'][:10]}.jsonl", entry)
        self.index.add_entry(entry)
        self.db.commit()
        return entry

    def journal(self, types=None, ref=None, since=None, until=None, actor=None, limit=50):
        where, args = ["1=1"], []
        if types:
            types = [types] if isinstance(types, str) else list(types)
            where.append(f"type IN ({','.join('?' * len(types))})")
            args += types
        if ref:
            where.append("refs LIKE ?")
            args.append('%"' + str(ref).replace('"', "") + '"%')
        if since:
            where.append("at >= ?")
            args.append(str(since))
        if until:
            where.append("at < ?")
            args.append(str(until))
        if actor:
            where.append("actor=?")
            args.append(actor)
        rows = self.index.rows(f"SELECT * FROM journal WHERE {' AND '.join(where)} ORDER BY at DESC LIMIT ?", (*args, max(1, min(int(limit), 500))))
        for r in rows:
            r["refs"], r["data"] = json.loads(r["refs"]), json.loads(r["data"])
        return rows

    # ---- agent actions: each is one vault commit, undone by reverting it ----------------------------------------
    def action(self, actor, summary, ref=None, commit=None, topic=None, thread=None):
        entry = self.record("action", {"summary": summary, "ref": ref, "commit": commit, "topic": topic, "thread": thread}, actor,
                            [x for x in (ref and ref.split(":", 1)[-1], topic, thread) if x])
        return entry["id"]

    def undone(self):
        return {e["refs"][0] for e in self.journal("undo", limit=500) if e["refs"]}

    def action_undo(self, ident):
        entry = self.index.one("SELECT data FROM journal WHERE id=? AND type='action'", (ident,))
        commit = entry and json.loads(entry["data"]).get("commit")
        if not commit or ident in self.undone():
            raise ValueError("这个操作不能撤销")
        summary = json.loads(entry["data"]).get("summary", "")
        touched = self.vault.revert(commit)
        # Removed paths first: a moved file keeps its id, so unindexing the old path afterwards would drop it.
        for rel in sorted(touched, key=lambda r: self.vault.path(r).exists()):
            self.index.reindex(rel)
        self.record("undo", {"commit": commit, "summary": "撤销了「" + summary + "」", "files": touched}, "me", [ident])
        return touched

    # ---- ownership after a shell command -----------------------------------------------------------------------
    def police(self):
        """Undo the parts of uncommitted changes an agent's shell may not make; returns what was put back."""
        fixed = []
        for status, rel in self.vault.changes():
            before = self.vault.at("HEAD", rel)
            # Lattice's own conversation and journal lines wait uncommitted for the next commit; only a change it did
            # not write itself is put back, or every shell command would throw away what was said since.
            if (rel.startswith(APPEND_ONLY) or rel.startswith(".lattice/") or rel in KEPT or rel.startswith("agents/")) and not self.vault.ours(rel):
                self._put_back(rel, before)
                fixed.append(f"{rel}：对话、轨迹和规则只由 Lattice 和学习者维护，已还原")
            elif status == "D":
                self._put_back(rel, before)
                fixed.append(f"{rel}：删除只由学习者做，已还原")
            elif kind_of(rel) == "card" and before is not None and status == "M" and self.keep_owned(rel, before):
                fixed.append(f"{rel}：理解阶段、回顾安排和「我的理解」只归学习者，已还原这几处")
        return fixed

    def keep_owned(self, rel, before):
        """Put a card's learner-owned parts back to what they were in `before`. Returns whether anything changed."""
        old_attrs, old_body = split_frontmatter(before)
        new_attrs, new_body = self.vault.read_md(rel)
        if all(old_attrs.get(k) == new_attrs.get(k) for k in CARD_OWNED) and split_mine(old_body)[1] == split_mine(new_body)[1] \
                and old_attrs.get("id") == new_attrs.get("id"):
            return False
        for k in (*CARD_OWNED, "id", "kind"):
            if k in old_attrs:
                new_attrs[k] = old_attrs[k]
            else:
                new_attrs.pop(k, None)
        self.vault.write_text(rel, join_frontmatter(new_attrs, join_mine(split_mine(new_body)[0], split_mine(old_body)[1])))
        return True

    def _put_back(self, rel, content):
        if content is None:
            self.vault.remove(rel)
        else:
            self.vault.write_text(rel, content)

    # ---- the whole map --------------------------------------------------------------------------------------
    def graph(self, topic=None):
        """Every document and relation: explicit links, [[wiki links]], branches and each topic's route.

        With a topic, only what belongs to it and its branches, plus their direct neighbours."""
        docs = self.index.rows("SELECT id, kind, title, topic, attrs, body, updated FROM docs")
        activity, counts = {}, {}
        for r in self.index.rows("SELECT refs, at FROM journal WHERE type NOT IN ('action','undo')"):
            for ref in json.loads(r["refs"]):
                counts[ref] = counts.get(ref, 0) + 1
                activity[ref] = max(activity.get(ref, ""), r["at"])
        nodes, edges, routes = {}, [], {}
        by_title = {}
        for d in docs:
            a = json.loads(d["attrs"])
            node = {"id": d["id"], "kind": d["kind"], "title": d["title"], "topic": d["topic"], "evidence": counts.get(d["id"], 0),
                    "last": max(activity.get(d["id"], ""), d["updated"])}
            if d["kind"] == "card":
                node["stage"] = a.get("stage", "suggested")
            if d["kind"] in ("topic", "insight", "lesson"):
                node["state"] = a.get("state", "active")
            if d["kind"] == "insight":
                node["insight"] = a.get("insight", "weak")
            if d["kind"] == "topic":
                if a.get("parent"):
                    edges.append({"id": "b:" + d["id"], "source": d["id"], "target": a["parent"], "kind": "branch_of"})
                routes[d["id"]] = a.get("route") or []
            nodes[d["id"]] = node
            by_title.setdefault(d["title"].casefold(), d["id"])
        for l in self.index.rows("SELECT * FROM links"):
            if l["target"].startswith("file:") and l["target"] not in nodes:
                nodes[l["target"]] = {"id": l["target"], "kind": "file", "title": l["target"][5:].rsplit("/", 1)[-1], "topic": None,
                                      "evidence": counts.get(l["target"][5:], 0), "last": activity.get(l["target"][5:], "")}
            edges.append({"id": "r:" + l["id"], "source": l["source"], "target": l["target"], "kind": l["kind"], "why": l["why"]})
        pairs = {frozenset((e["source"], e["target"])) for e in edges}
        for d in docs:
            for name in dict.fromkeys(wiki_target(m) for m in WIKI.findall(d["body"] or "")):
                target = by_title.get(name.casefold())
                if target and target != d["id"] and frozenset((d["id"], target)) not in pairs:
                    pairs.add(frozenset((d["id"], target)))
                    edges.append({"id": "w:" + d["id"] + ":" + target, "source": d["id"], "target": target, "kind": "mentions"})
        edges = [e for e in edges if e["source"] in nodes and e["target"] in nodes]
        if topic:
            family, grew = {topic}, True
            while grew:
                more = {e["source"] for e in edges if e["kind"] == "branch_of" and e["target"] in family}
                grew = bool(more - family)
                family |= more
            core = {n for n, v in nodes.items() if n in family or v["topic"] in family}
            core |= {s.get("ref") for t in family for s in routes.get(t, []) if s.get("ref")}
            keep = core | {e["target"] for e in edges if e["source"] in core} | {e["source"] for e in edges if e["target"] in core}
            nodes = {k: v for k, v in nodes.items() if k in keep}
            edges = [e for e in edges if e["source"] in nodes and e["target"] in nodes]
            routes = {k: v for k, v in routes.items() if k in family}
        return {"nodes": list(nodes.values()), "edges": edges, "routes": routes}

    # ---- one catalog for everything: the UI's lists and the agents' list tool both read it ---------------
    KINDS = ("topics", "cards", "notes", "lessons", "insights", "notebooks", "practices", "threads", "files")

    def catalog(self, kind, topic=None, stage=None, state=None, query=None, limit=500):
        """Every item of one kind, briefly, with the attributes that kind has. Filters: topic ('' for none), stage, state, query."""
        if kind not in self.KINDS:
            raise ValueError("kind 应为 " + "、".join(self.KINDS))
        due = {c["id"] for c in self.due_cards()} if kind == "cards" else set()
        if kind == "topics":
            rows = [{k: t[k] for k in ("id", "title", "path", "question", "parent", "state", "created", "updated")} | {"route_steps": len(t["route"])}
                    for t in self.topics()]
        elif kind == "cards":
            rows = [{**c, "due_now": c["id"] in due} for c in self.cards()]
        elif kind == "practices":
            rows = self.practices()
        elif kind == "insights":
            rows = [{k: i[k] for k in ("id", "kind", "title", "topic", "practice", "state", "created")} for i in self.insights()]
        elif kind == "threads":
            rows = [{**r, "messages": r.pop("n")} for r in self.index.rows(
                """SELECT t.id, t.agent, t.title, t.topic, t.created, t.updated, json_extract(t.head,'$.practice.state') practice,
                   (SELECT COUNT(*) FROM messages m WHERE m.thread=t.id) n FROM threads t ORDER BY t.updated DESC""")]
        elif kind == "files":
            rows = [{"path": r["path"]} for r in self.index.rows("SELECT path FROM files WHERE kind='file' ORDER BY path")]
        else:
            rows = []
            for d in self.docs(kind[:-1]):
                a = d["attrs"]
                rows.append({"id": d["id"], "title": d["title"], "path": d["path"], "topic": d["topic"], "updated": d["updated"],
                             **{k: a[k] for k in ("tags", "state", "objective") if a.get(k)}})
        if topic is not None:
            rows = [r for r in rows if (r.get("topic") or None) == (topic or None)]
        if stage:
            rows = [r for r in rows if r.get("stage") == stage]
        if state:
            rows = [r for r in rows if r.get("state") == state]
        if query:
            q = str(query).casefold()
            rows = [r for r in rows if q in str(r.get("title") or r.get("path") or "").casefold()]
        return rows[:max(1, min(int(limit), 2000))]

    def search(self, query, limit=40):
        q = "%" + text(query, 200).strip() + "%"
        if q == "%%":
            raise ValueError("请给出搜索词")
        hits = []
        for r in self.index.rows("SELECT id, kind, title, path, body FROM docs WHERE title LIKE ? OR body LIKE ? ORDER BY title LIKE ? DESC, updated DESC LIMIT ?",
                                 (q, q, q, limit)):
            hits.append({"ref": r["kind"] + ":" + r["id"], "kind": r["kind"], "title": r["title"], "path": r["path"], "excerpt": excerpt(r["body"], query)})
        for r in self.index.rows("SELECT path FROM files WHERE kind='file' AND path LIKE ? LIMIT 20", (q,)):
            hits.append({"ref": "file:" + r["path"], "kind": "file", "title": r["path"].rsplit("/", 1)[-1], "path": r["path"], "excerpt": r["path"]})
        for r in self.index.rows("""SELECT m.id, m.role, m.content, m.thread, t.title, t.agent FROM messages m JOIN threads t ON t.id=m.thread
                                    WHERE m.content LIKE ? ORDER BY m.id DESC LIMIT 12""", (q,)):
            hits.append({"ref": "message:" + str(r["id"]), "kind": "message", "title": r["title"] + " · " + ("我" if r["role"] == "user" else "AI"),
                         "thread": r["thread"], "agent": r["agent"], "excerpt": excerpt(r["content"], query)})
        return hits


def excerpt(body, query, width=160):
    body = str(body or "")
    at = body.casefold().find(str(query).casefold())
    start = max(0, at - width // 3) if at >= 0 else 0
    return body[start:start + width].replace("\n", " ")
