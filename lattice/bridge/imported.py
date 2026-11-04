"""The bridge: conversations brought in from the web."""
from __future__ import annotations

from ..i18n import tr

import hashlib
import json
from pathlib import Path
from datetime import datetime
from PySide6.QtGui import QGuiApplication
from ..index import uid
from ..vault import now

from .common import LOG, WEB_CACHE


class ImportedPart:
    # ---- conversations had with an AI on the web, brought in to go on with --------------------------------
    def rpc_import_read(self, url):
        """Read a shared conversation (off the GUI thread); it arrives as an "import" event to look at before bringing it in."""
        from .. import imports, web
        url = str(url or "").strip()
        if not imports.is_share_link(url):
            raise ValueError(tr("现在能导入的是 ChatGPT 的分享链接（chatgpt.com/share/…）。在 ChatGPT 里点对话右上角的「分享」，复制链接贴进来"))
        request = uid()

        def then(result):
            if isinstance(result, Exception):
                return self.announce({"type": "import", "request": request, "error": str(result)[:400]})
            self.imports_read[request] = result
            messages = result["messages"]
            self.announce({"type": "import", "request": request, "title": result["title"], "source": result["source"], "url": url,
                           "created": result["created"], "count": len(messages), "turns": sum(m["role"] == "user" for m in messages),
                           "first": next((m["content"][:300] for m in messages if m["role"] == "user"), "")})
        self.background(lambda: imports.from_share(url, web.page_bytes), then)
        return {"request": request}

    def rpc_import_save(self, request, topic=None):
        """Bring a conversation read with import_read in as one of the tutor's, under the topic being learned, and open
        it there to go on with. Its messages keep their times and the model's thinking; the conversation is saved (a
        summary of it written) so the tutor knows what was said before the part it sees."""
        found = self.imports_read.pop(request, None)
        if not found:
            raise ValueError(tr("这段对话还没读好，或者已经导入过了"))
        l = self.lattice
        topic = l.active_topic() if topic is None else (topic or None)
        meta = {"source": found["source"], "url": found["url"], "at": now(), "count": len(found["messages"])}
        thread = l.thread_new("tutor", topic, found["title"], {"imported": meta, "named": True})["id"]
        for m in found["messages"]:
            extra = {"thinking": m["thinking"], "think_seconds": m.get("think_seconds") or None} if m.get("thinking") else {}
            l.append_message(thread, m["role"], m["content"], {"agent": "tutor", "imported": found["source"], **extra}, m.get("at"))
        l.thread_pick(thread)
        l.focus(topic)
        l.record("imported", {"title": found["title"], "source": found["source"], "url": found["url"], "messages": len(found["messages"])},
                 "me", [thread, *([topic] if topic else [])])
        self.save_later(thread)
        return {"thread": thread, "topic": topic or ""}

    def rpc_web_open(self, url, refresh=False):
        """A web page or PDF for the learner's reader. Pages read once are kept on this computer, so a cited page opens
        at once and the same as before; refresh reads it again. A page not kept yet arrives later as a "web" event."""
        from .. import web
        url = str(url or "").strip()
        if not url.startswith(("http://", "https://")):
            raise ValueError(tr("只能打开 http(s) 网页"))
        cache = WEB_CACHE / (hashlib.sha1(url.encode("utf-8")).hexdigest()[:24] + ".json")
        if not refresh:
            try:
                return {"state": "ready", "page": json.loads(cache.read_text(encoding="utf-8"))}
            except (OSError, ValueError):
                pass

        def then(result):
            if isinstance(result, Exception):
                return self.announce({"type": "web", "url": url, "error": str(result)})
            result.update(asked=url, fetched=datetime.now().astimezone().isoformat(timespec="seconds"))
            try:
                WEB_CACHE.mkdir(parents=True, exist_ok=True)
                cache.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
            except OSError as exc:
                LOG.warning("could not keep web page: %s", exc)
            self.announce({"type": "web", "url": url, "page": result})
        self.background(lambda: web.page(url), then)
        return {"state": "loading"}

    def rpc_web_save(self, url):
        """A page the learner read, kept as a note under notes/网页/ with where it came from."""
        found = self.rpc_web_open(url)
        if found.get("state") != "ready":
            raise ValueError(tr("这个网页还没读完"))
        page, l = found["page"], self.lattice
        body = f"> 来源：[{page['title']}]({page['url']}) · {page.get('fetched', '')[:10]} 存下\n\n" + page["markdown"]
        self.commit_mine()
        rel = l.note_create(page["title"][:120], body[:50000], "网页", ("网页",), "me", l.active_topic())
        l.vault.commit("存下网页：" + page["title"][:60], "me")
        self.changed([rel])
        return {"path": rel}

    def rpc_clipboard_text(self):
        return QGuiApplication.clipboard().text()

    def rpc_clipboard_set(self, text):
        """Copy buttons write the system clipboard from here: the page itself may not (Qt keeps scripts off it)."""
        QGuiApplication.clipboard().setText(str(text))
        return True

    def rpc_project_add(self, path=None):
        return self.lattice.add_project(Path(path).name, path) if path else None

    def rpc_book_open(self, path):
        """What the book window needs to show a book: a one-off way to its bytes, and where the learner got to."""
        target, rel = self.lattice.resolve(path)
        if not Path(target).is_file():
            raise ValueError(tr("找不到这本书：") + str(path))
        token = uid()
        self.book_files[token] = str(target)
        return {"url": f"lattice-app://book/_book/{token}", "name": Path(target).name, "at": self._local_state().get("book_places", {}).get(rel or str(target))}

    def rpc_book_place(self, path, at):
        target, rel = self.lattice.resolve(path)
        places = self._local_state().get("book_places", {})
        key = rel or str(target)
        places.pop(key, None)
        places[key] = str(at)[:400]
        self._local_save("book_places", dict(list(places.items())[-300:]))
        return True
