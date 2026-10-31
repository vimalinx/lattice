"""Highlights and notes on anything the learner reads: books, notes, code, notebooks, web pages, conversations.

One file per thing annotated, in annotations/: its `source` and a list of `items`. Each item has an `anchor`, which says
where it sits twice over: `at` to go there at once (a page, a CFI, a line, a cell, a message), and the quoted `text` with a
little of what is `before` and `after` it, to find it again once the file has changed. An annotation is `ann:<id>`
wherever something refers to it: cards, the journal, [[links]].

A question put to the quick answer about selected words leaves an annotation too, with `ask` in place of a note: the
message it was. It stays where the words are, whatever becomes of the window it was asked in.
"""
from __future__ import annotations

import json
from pathlib import Path
import re

from .index import uid
from .vault import now

FOLDER = "annotations"
COLORS = ("yellow", "green", "blue", "pink")
# What can differ between a file's source and the same words as shown: spacing and Markdown's marks. Matches marks.js.
LOOSE = re.compile(r"[\s*_`~#>|]+")
CHECKED = {"note", "card", "topic", "lesson", "insight", "notebook"}
TEXT_LIMIT = 2_000_000


def loose(value):
    return LOOSE.sub("", str(value or ""))


def still_there(doc, quote):
    """Whether a quote can still be found in a text: whole, or by its two ends when something inside it was rendered."""
    doc, quote = loose(doc), loose(quote)
    if quote in doc:
        return True
    if len(quote) < 16:
        return False
    head = doc.find(quote[:8])
    return head >= 0 and doc.find(quote[-8:], head + 8, head + len(quote) * 3) >= 0


def clean(anchor):
    """An anchor as it may be kept: what comes from a page is only trusted to be of these shapes and sizes."""
    a = anchor if isinstance(anchor, dict) else {}
    raw = a.get("at") if isinstance(a.get("at"), dict) else {}
    at = {}
    for key in ("page", "line", "message"):
        if isinstance(raw.get(key), int) and not isinstance(raw.get(key), bool) and raw[key] > 0:
            at[key] = raw[key]
    for key, limit in (("cfi", 400), ("cell", 64), ("field", 32)):
        if isinstance(raw.get(key), str) and raw[key]:
            at[key] = raw[key][:limit]
    rects = [[float(x) for x in r] for r in (raw.get("rects") or [])[:200]
             if isinstance(r, list) and len(r) == 5 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in r)]
    if rects:
        at["rects"] = rects
    return {"at": at, "label": str(a.get("label") or "")[:120], "text": str(a.get("text") or "")[:5000],
            "before": str(a.get("before") or "")[-80:], "after": str(a.get("after") or "")[:80]}


def source_of(l, where):
    """What an annotation is attached to: a document's id (it survives renames), file:<path>, thread:<id> or web:<url>."""
    where = str(where or "").strip()
    if where.startswith(("thread:", "web:")):
        return where
    path = where[5:] if where.startswith("file:") else where
    row = l.index.one("SELECT id, kind FROM files WHERE path=?", (path,))
    if row:
        return row["id"] if row["id"] and row["kind"] in CHECKED else "file:" + path
    if l.index.one("SELECT 1 FROM docs WHERE id=?", (path,)):
        return path
    absolute, rel = l.resolve(path)
    return "file:" + (rel or str(absolute))


def place(l, source):
    """Where a source is now, for going there and for naming it."""
    if source.startswith("thread:"):
        row = l.index.one("SELECT title, agent FROM threads WHERE id=?", (source[7:],))
        return {"kind": "thread", "thread": source[7:], "agent": row["agent"] if row else "tutor", "title": (row or {}).get("title") or "对话", "gone": not row}
    if source.startswith("web:"):
        url = source[4:]
        return {"kind": "web", "url": url, "title": re.sub(r"^https?://(www\.)?", "", url).split("/")[0] or url}
    if source.startswith("file:"):
        path = source[5:]
        return {"kind": "file", "path": path, "title": path.rsplit("/", 1)[-1], "gone": not Path(l.resolve(path)[0]).exists()}
    row = l.index.one("SELECT kind, title, path FROM docs WHERE id=?", (source,))
    return {"kind": row["kind"], "path": row["path"], "title": row["title"]} if row else {"kind": "gone", "title": "已删除的文档", "gone": True}


def describe(l, source, anchor):
    """Where something is, in the words an agent gets: enough to read around it."""
    p, label = place(l, source), (anchor or {}).get("label") or ""
    if p["kind"] == "thread":
        return f"对话「{p['title']}」（thread:{p['thread']}" + (f"，第 {anchor['at']['message']} 条消息" if (anchor or {}).get("at", {}).get("message") else "") + "）"
    if p["kind"] == "web":
        return f"网页 {p['url']}" + (f"（{label}）" if label else "")
    return (p.get("path") or p["title"]) + (f"（{label}）" if label else "")


def _source_text(l, source):
    """The text a quote should still be in, for sources that change; None when there is nothing to check against."""
    if source.startswith(("thread:", "web:")):
        return None
    if source.startswith("file:"):
        try:
            got = l.read_file(source[5:], TEXT_LIMIT)
        except (OSError, ValueError):
            return None
        return None if got.get("binary") or got.get("truncated") else got.get("content")
    row = l.index.one("SELECT body FROM docs WHERE id=?", (source,))
    return row["body"] if row else None


def _view(l, row, places, texts):
    source = row["source"]
    if source not in places:
        places[source] = place(l, source)
    pl = places[source]
    anchor = {**json.loads(row["anchor"]), "text": row["text"]}
    item = {"id": row["id"], "source": source, "by": row["author"], "color": row["color"], "note": row["note"], "text": row["text"],
            "label": row["label"], "anchor": anchor, "created": row["created"], "updated": row["updated"], "place": pl}
    if row["ask"]:
        item["ask"] = json.loads(row["ask"])
    if pl.get("gone"):
        item["lost"] = "gone"
    else:
        if source not in texts:
            suffix = Path(pl.get("path") or "").suffix.lower()
            texts[source] = None if suffix in (".pdf", ".epub", ".mobi", ".azw", ".azw3", ".prc", ".fb2", ".cbz", ".zip") else _source_text(l, source)
        if texts[source] is not None and not still_there(texts[source], row["text"]):
            item["lost"] = "changed"
    return item


def get(l, ident):
    row = l.index.one("SELECT * FROM annotations WHERE id=?", (str(ident).removeprefix("ann:"),))
    if not row:
        raise ValueError("找不到这条批注")
    return _view(l, row, {}, {})


def listing(l, where=None, query=None, by=None, limit=500):
    """Annotations, newest first: of one source or of everything."""
    sql, args = ["1=1"], []
    if where:
        sql.append("source=?")
        args.append(source_of(l, where))
    if query:
        sql.append("(note LIKE ? OR text LIKE ? OR label LIKE ? OR ask LIKE ?)")
        args += ["%" + str(query).strip() + "%"] * 4
    if by:
        sql.append("author=?")
        args.append(str(by))
    rows = l.index.rows(f"SELECT * FROM annotations WHERE {' AND '.join(sql)} ORDER BY created DESC LIMIT ?", (*args, max(1, min(int(limit), 1000))))
    places, texts = {}, {}
    return [_view(l, r, places, texts) for r in rows]


def _write(l, rel, data):
    if data["items"]:
        l.vault.write_json(rel, data)
        l.index.reindex(rel)
    else:
        l.vault.remove(rel)
        l.index.unindex(rel)


def _holder(l, ident):
    row = l.index.one("SELECT path FROM annotations WHERE id=?", (ident,))
    if not row:
        raise ValueError("找不到这条批注")
    data = l.vault.read_json(row["path"])
    item = next((x for x in data["items"] if x.get("id") == ident), None)
    if not item:
        raise ValueError("找不到这条批注")
    return row["path"], data, item


def add(l, where, anchor, note="", color=None, by="me", ask=None):
    source = source_of(l, where)
    anchor = clean(anchor)
    if not anchor["text"].strip():
        raise ValueError("批注要有一段原文")
    item = {"id": uid(), "by": str(by), "color": color if color in COLORS else COLORS[0], "note": str(note or "").strip()[:20000],
            "created": now(), "anchor": anchor, **({"ask": ask} if ask else {})}
    row = l.index.one("SELECT path FROM annotations WHERE source=? LIMIT 1", (source,))
    rel = row["path"] if row else l.vault.unique(FOLDER, place(l, source)["title"], ".json")
    data = l.vault.read_json(rel) if row else {"source": source, "items": []}
    data["items"].append(item)
    _write(l, rel, data)
    if ask:     # the journal has the question already
        return get(l, item["id"])
    named = source[5:] if source.startswith("file:") else source.split(":", 1)[-1] if source.startswith("thread:") else None if source.startswith("web:") else source
    summary = shorten(anchor["text"], 60) + ("  ——  " + shorten(item["note"], 80) if item["note"] else "")
    l.record("annotated", {"summary": summary, "text": anchor["text"][:300], "note": item["note"][:600], "source": source, "topic": l.active_topic()}, str(by),
             [x for x in ("ann:" + item["id"], named) if x])
    return get(l, item["id"])


def update(l, ident, note=None, color=None, at=None):
    """A changed note or colour, or a place found for an annotation that came without one."""
    ident = str(ident).removeprefix("ann:")
    rel, data, item = _holder(l, ident)
    if note is not None:
        item["note"] = str(note).strip()[:20000]
    if color in COLORS:
        item["color"] = color
    if note is not None or color in COLORS:
        item["updated"] = now()
    if isinstance(at, dict):
        item["anchor"]["at"] = {**item["anchor"].get("at", {}), **clean({"at": at})["at"]}
    _write(l, rel, data)
    return get(l, ident)


def remove(l, ident):
    ident = str(ident).removeprefix("ann:")
    rel, data, item = _holder(l, ident)
    data["items"] = [x for x in data["items"] if x is not item]
    _write(l, rel, data)
    return True


def asked(l, ident):
    """The question an annotation stands for and what was answered, from the conversation as it is now."""
    item = get(l, ident)
    if not item.get("ask"):
        raise ValueError("这条批注不是一个问题")
    # The same words can be asked about again: those questions stand on the same place, and open together.
    same = [json.loads(r["ask"]) for r in l.index.rows("SELECT ask FROM annotations WHERE source=? AND text=? AND ask!='' AND id!=? ORDER BY created DESC",
                                                       (item["source"], item["text"], item["id"]))]
    return {"id": item["id"], "quote": item["text"], "label": item["label"], "place": item["place"], "source": item["source"], "anchor": item["anchor"],
            "created": item["created"], **_answered(l, item["ask"]), "also": [_answered(l, x) for x in same]}


def _answered(l, ask):
    out = {"question": ask.get("question", ""), "message": ask["message"], "answer": ""}
    row = l.index.one("SELECT thread FROM messages WHERE id=?", (ask["message"],))
    if not row:
        return {**out, "gone": True}
    # A reply that was given again stands in the conversation twice; the last before the next question is the answer.
    for m in l.index.rows("SELECT role, content FROM messages WHERE thread=? AND id>? ORDER BY id LIMIT 30", (row["thread"], ask["message"])):
        if m["role"] == "user":
            break
        if m["content"].strip():
            out["answer"] = m["content"]
    head = l.index.one("SELECT agent FROM threads WHERE id=?", (row["thread"],))
    return {**out, "thread": row["thread"], "agent": head["agent"] if head else "flash"}


def unmount(l, ident):
    """Take a place's questions off it; the conversations they were asked in stay."""
    item = get(l, ident)
    for row in l.index.rows("SELECT id FROM annotations WHERE source=? AND text=? AND ask!=''", (item["source"], item["text"])):
        remove(l, row["id"])
    return True


def carried(l, ids, target):
    """Messages moved to another conversation (a topic grew out of them): what marks them goes along."""
    wanted = "thread:" + target
    for row in l.index.rows("SELECT DISTINCT path, source FROM annotations WHERE source LIKE 'thread:%' AND source!=?", (wanted,)):
        data = l.vault.read_json(row["path"])
        going = [x for x in data["items"] if x.get("anchor", {}).get("at", {}).get("message") in ids]
        if not going:
            continue
        data["items"] = [x for x in data["items"] if x not in going]
        _write(l, row["path"], data)
        held = l.index.one("SELECT path FROM annotations WHERE source=? LIMIT 1", (wanted,))
        rel = held["path"] if held else l.vault.unique(FOLDER, place(l, wanted)["title"], ".json")
        into = l.vault.read_json(rel) if held else {"source": wanted, "items": []}
        into["items"] += going
        _write(l, rel, into)


def moved(l, old, new):
    """A plain file moved: what annotates it goes with it. Documents are followed by their id."""
    for row in l.index.rows("SELECT DISTINCT path FROM annotations WHERE source=?", ("file:" + old,)):
        data = l.vault.read_json(row["path"])
        data["source"] = "file:" + new
        _write(l, row["path"], data)


def shorten(value, size):
    value = re.sub(r"\s+", " ", str(value or "")).strip()
    return value if len(value) <= size else value[:size - 1] + "…"
