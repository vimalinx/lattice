"""Conversations had with an AI on the web, brought in to go on with: a shared link, or the site's data export.

Each site has a reader that turns what the site gives into one conversation: its title, where it came from, and its
messages as the learner saw them (their questions; the answers, with the model's thinking where the site kept it).
What the page hides (system messages, tool calls, search results) stays out.

ChatGPT: a share page (chatgpt.com/share/…) carries the conversation in its React Router data, a flat "turbo-stream"
array in which objects and lists refer to their values by position; the data export's conversations.json has the same
messages as a tree. Both are read the same way once the messages are in order.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import re
from urllib.parse import urlsplit

# ChatGPT marks where an answer cites a source with private-use characters around a reference: cite….
CITE = re.compile(".*?", re.S)
SITES = {"chatgpt.com": "ChatGPT", "chat.openai.com": "ChatGPT"}


class ImportError_(ValueError):
    pass


def site_of(url):
    host = (urlsplit(str(url).strip()).hostname or "").lower().removeprefix("www.")
    return SITES.get(host)


def is_share_link(text):
    """A link to a shared conversation this module can read."""
    text = str(text or "").strip()
    return bool(re.fullmatch(r"https?://(www\.)?(chatgpt\.com|chat\.openai\.com)/share/[\w-]+/?(\?.*)?", text))


def from_share(url, download):
    """A shared conversation from its link; `download(url)` gives (final url, content type, bytes)."""
    if not is_share_link(url):
        raise ImportError_("现在能导入的是 ChatGPT 的分享链接（chatgpt.com/share/…）")
    _, _, data = download(url)
    html = data.decode("utf-8", "replace")
    flat = _turbo_stream(html)
    if flat is None:
        raise ImportError_("这个页面里找不到对话：链接可能失效了，或者分享被关掉了")
    root = _decode(flat)
    response = next((route.get("serverResponse") for route in (root.get("loaderData") or {}).values()
                     if isinstance(route, dict) and isinstance(route.get("serverResponse"), dict)), None)
    conversation = (response or {}).get("data")
    if not isinstance(conversation, dict):
        raise ImportError_("这个页面里找不到对话：链接可能失效了，或者分享被关掉了")
    nodes = conversation.get("linear_conversation") or _path(conversation)
    return _conversation(conversation, nodes, "ChatGPT", url)


def from_export(raw):
    """Every conversation in a ChatGPT data export (conversations.json), newest first."""
    try:
        items = json.loads(raw)
    except ValueError:
        raise ImportError_("这不是 ChatGPT 导出的 conversations.json") from None
    if isinstance(items, dict):
        items = [items]
    out = []
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and isinstance(item.get("mapping"), dict):
            url = f"https://chatgpt.com/c/{item['conversation_id']}" if item.get("conversation_id") else ""
            found = _conversation(item, _path(item), "ChatGPT", url)
            if found["messages"]:
                out.append(found)
    if not out:
        raise ImportError_("这个文件里没有能导入的对话")
    return sorted(out, key=lambda c: c.get("created") or "", reverse=True)


# ---- reading ChatGPT's messages ---------------------------------------------------------------------

def _turbo_stream(html):
    """The first React Router data chunk of a page: the flat array it encodes, or None."""
    for chunk in re.findall(r'streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)', html):
        try:
            flat = json.loads(json.loads(chunk))
        except ValueError:
            continue
        if isinstance(flat, list) and flat and isinstance(flat[0], dict):
            return flat
    return None


def _decode(flat):
    """A turbo-stream array as plain values: {"_k": v} is an object whose key is flat[k] and value flat[v]; a list holds
    positions; negative positions are the special values (undefined, null, NaN…), read as None."""
    memo = {}

    def value(i):
        if not isinstance(i, int) or i < 0 or i >= len(flat):
            return None
        if i in memo:
            return memo[i]
        v = flat[i]
        if isinstance(v, dict):
            out = memo[i] = {}
            for key, at in v.items():
                if key.startswith("_") and key[1:].isdigit():
                    out[flat[int(key[1:])]] = value(at)
            return out
        if isinstance(v, list):
            if v and isinstance(v[0], str):
                return v   # a typed value (a date, a set…), kept as it is
            out = memo[i] = []
            out.extend(value(x) for x in v)
            return out
        return v
    return value(0) or {}


def _path(conversation):
    """The messages of the branch on show, from the first to current_node (an edited question starts a branch)."""
    mapping = conversation.get("mapping") or {}
    node, nodes = conversation.get("current_node"), []
    while node and node in mapping and len(nodes) < 100_000:
        nodes.append(mapping[node])
        node = mapping[node].get("parent")
    return list(reversed(nodes))


def _when(stamp):
    try:
        return datetime.fromtimestamp(float(stamp), timezone.utc).astimezone().isoformat(timespec="seconds")
    except (TypeError, ValueError, OverflowError):
        return None


def _text(content):
    parts = []
    for part in content.get("parts") or []:
        if isinstance(part, str):
            parts.append(part)
        elif isinstance(part, dict):
            parts.append("[图片]" if "image" in str(part.get("content_type", "")) else "[附件]")
    return CITE.sub("", "\n\n".join(p for p in parts if p)).strip()


def _conversation(conversation, nodes, source, url):
    """The conversation as the learner saw it: their questions and the answers, one answer per turn (its parts joined),
    with the thinking the site kept for it."""
    messages, thinking, seconds = [], [], 0
    for node in nodes:
        message = (node or {}).get("message") or {}
        role = (message.get("author") or {}).get("role")
        content = message.get("content") or {}
        meta = message.get("metadata") or {}
        kind = content.get("content_type")
        if meta.get("is_visually_hidden_from_conversation") or role not in ("user", "assistant"):
            continue
        if role == "assistant" and kind == "thoughts":
            thinking += [f"**{t.get('summary', '').strip()}**\n\n{t.get('content', '').strip()}".strip()
                         for t in content.get("thoughts") or [] if t.get("content") or t.get("summary")]
            continue
        if role == "assistant" and kind == "reasoning_recap":
            found = re.findall(r"(\d+)\s*(m|s)", content.get("content") or "")
            seconds += sum(int(n) * (60 if unit == "m" else 1) for n, unit in found)
            continue
        if kind not in ("text", "multimodal_text") or message.get("recipient") not in (None, "all"):
            continue
        text = _text(content)
        if not text:
            continue
        at = _when(message.get("create_time"))
        if role == "assistant" and messages and messages[-1]["role"] == "assistant":
            messages[-1]["content"] += "\n\n" + text   # one answer per turn, however many parts it came in
        else:
            messages.append({"role": role, "content": text, "at": at})
        if role == "assistant" and (thinking or seconds):
            messages[-1].setdefault("thinking", [])
            messages[-1]["thinking"] += thinking
            messages[-1]["think_seconds"] = messages[-1].get("think_seconds", 0) + seconds
            thinking, seconds = [], 0
        elif role == "user":
            thinking, seconds = [], 0
    for m in messages:
        if "thinking" in m:
            m["thinking"] = "\n\n".join(m["thinking"])
    return {"title": str(conversation.get("title") or "导入的对话").strip()[:120], "source": source, "url": url,
            "created": _when(conversation.get("create_time")), "messages": messages}
