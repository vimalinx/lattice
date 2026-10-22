"""The agents' two web interfaces: search the web, and read one page as text. The learner's reader uses the same
reading, keeping links and emphasis, so a page an agent cites opens inside the program.

The search backend is configuration (DuckDuckGo without a key, a SearXNG
instance, Brave or Tavily); the interface stays the same. Fetching refuses
addresses on this machine or the local network, so a page cannot be used to
reach local services.
"""
from __future__ import annotations

from html import unescape
from html.parser import HTMLParser
import io
import ipaddress
import json
import re
import socket
from urllib.parse import parse_qs, unquote, urljoin, urlsplit

import httpx

LOCAL = [ipaddress.ip_network(n) for n in ("0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")]
AGENT = "Mozilla/5.0 (X11; Linux x86_64) Lattice/1.0 (learning workspace)"


class WebError(RuntimeError):
    pass


def _public(url):
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise WebError("只能读取 http(s) 网页")
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise WebError(f"找不到这个网站：{parts.hostname}") from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0].split("%")[0])
        address = getattr(address, "ipv4_mapped", None) or address
        # Proxies with fake-IP DNS hand out 198.18.0.0/15, so "not global" alone would refuse every site.
        if address.is_loopback or address.is_link_local or address.is_multicast or address.is_unspecified or any(address in net for net in LOCAL):
            raise WebError("不读取本机或局域网里的地址")


def search(config, query, count=8):
    query = str(query).strip()[:300]
    if not query:
        raise WebError("请给出搜索词")
    backend = config.get("search") or "duckduckgo"
    with httpx.Client(timeout=20, headers={"User-Agent": AGENT}, follow_redirects=True) as client:
        if backend == "searxng":
            if not config.get("searxng_url"):
                raise WebError("设置里还没有填 SearXNG 地址")
            data = client.get(config["searxng_url"].rstrip("/") + "/search", params={"q": query, "format": "json"}).raise_for_status().json()
            items = [{"title": r.get("title", ""), "url": r.get("url", ""), "snippet": r.get("content", "")} for r in data.get("results", [])]
        elif backend == "brave":
            if not config.get("brave_key"):
                raise WebError("设置里还没有填 Brave Search 的 Key")
            data = client.get("https://api.search.brave.com/res/v1/web/search", params={"q": query, "count": count},
                              headers={"X-Subscription-Token": config["brave_key"], "Accept": "application/json"}).raise_for_status().json()
            items = [{"title": r.get("title", ""), "url": r.get("url", ""), "snippet": re.sub("<[^>]+>", "", r.get("description", ""))}
                     for r in (data.get("web") or {}).get("results", [])]
        elif backend == "tavily":
            if not config.get("tavily_key"):
                raise WebError("设置里还没有填 Tavily 的 Key")
            data = client.post("https://api.tavily.com/search", json={"api_key": config["tavily_key"], "query": query, "max_results": count}).raise_for_status().json()
            items = [{"title": r.get("title", ""), "url": r.get("url", ""), "snippet": r.get("content", "")} for r in data.get("results", [])]
        else:
            page = client.post("https://html.duckduckgo.com/html/", data={"q": query}).raise_for_status().text
            items = []
            for block in page.split('class="result results_links')[1:]:
                link = re.search(r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
                if not link:
                    continue
                href = unescape(link.group(1))
                if "uddg=" in href:
                    href = unquote(parse_qs(urlsplit(href).query).get("uddg", [href])[0])
                snippet = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', block, re.S)
                items.append({"title": _strip(link.group(2)), "url": href, "snippet": _strip(snippet.group(1)) if snippet else ""})
    items = [i for i in items if i["url"].startswith("http") and "duckduckgo.com/y.js" not in i["url"]]
    return {"query": query, "backend": backend, "results": items[:count]}


def _strip(html):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", "", html))).strip()


class _Text(HTMLParser):
    """HTML to readable text: headings, paragraphs, lists, code; navigation and scripts dropped.

    When the page marks its content with <main> or <article>, only that part is kept. With rich=True (the learner's
    reader) links, emphasis, inline code and table cells stay, as Markdown; base resolves relative links."""
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "aside", "form", "template", "iframe", "button", "select"}
    BLOCK = {"p", "div", "section", "article", "main", "br", "tr", "table", "blockquote", "figure", "figcaption", "dd", "dt"}
    VOID = {"br", "img", "hr", "input", "meta", "link", "source", "wbr", "area", "col", "embed", "param", "track"}
    MARK = {"strong": "**", "b": "**", "em": "*", "i": "*"}

    def __init__(self, rich=False, base=""):
        super().__init__(convert_charrefs=True)
        self.all, self.main, self.skip, self.pre, self.inside, self.title, self.in_title = [], [], 0, 0, 0, "", False
        self.rich, self.base, self.links, self.rows, self.cells = rich, base, [], 0, 0
        self.noise, self.math = None, None

    def _inline(self, tag, attrs, start):
        """Links, emphasis and inline code in the reader's Markdown."""
        if tag == "a":
            href = dict(attrs).get("href") or ""
            if start:
                self.links.append((urljoin(self.base, href) if href and not href.startswith(("#", "javascript:", "mailto:")) else "", len(self.all), len(self.main), self.inside))
                self.put("[")
            elif self.links:
                url, at, at_main, inside = self.links.pop()
                for pieces, i in ((self.all, at), *(((self.main, at_main),) if inside and self.inside else ())):
                    label = re.sub(r"\s+", " ", "".join(pieces[i + 1:])).strip()
                    pieces[i:] = [f"[{label}]({url})" if url and label else label]
        elif tag == "img" and start:
            found = dict(attrs)
            if found.get("alt") and found.get("src"):
                self.put(f" [图片：{found['alt'].strip()}]({urljoin(self.base, found['src'])}) ")
        elif tag in self.MARK and not self.pre:
            self.put(self.MARK[tag])
        elif tag == "code" and not self.pre:
            self.put("`")
        elif tag in ("td", "th"):
            self.put(" " if start else " |")
            self.cells += 0 if start else 1
        elif tag == "tr":
            # Rows as a Markdown table; the first row is its header.
            if start:
                self.put("\n|")
                self.cells = 0
            else:
                if not self.rows and self.cells:
                    self.put("\n|" + " --- |" * self.cells)
                self.rows += 1
        elif tag == "table":
            self.rows = 0
            self.put("\n" if start else "\n\n")

    def put(self, piece):
        self.all.append(piece)
        if self.inside:
            self.main.append(piece)

    # Page furniture marked by class: edit links, navigation boxes, side boxes, things not meant for print.
    NOISE = re.compile(r"\b(mw-editsection|navbox|sidebar|noprint|mw-jump-link|mwe-math-fallback-image\w*)\b")

    def handle_starttag(self, tag, attrs):
        if self.noise:
            self.noise[1] += tag == self.noise[0]
            return
        if self.math is not None:
            if tag == "annotation" and dict(attrs).get("encoding") == "application/x-tex":
                self.math["tex"] = ""
                self.math["in"] = True
            return
        if tag == "math" and not self.skip:
            # A formula keeps only its TeX (pages give MathML, TeX and an image of the same thing).
            self.math = {"block": dict(attrs).get("display") == "block", "tex": None, "in": False}
            return
        if not self.skip and self.NOISE.search(dict(attrs).get("class") or ""):
            if tag not in self.VOID:
                self.noise = [tag, 1]
            return
        if tag in self.SKIP:
            self.skip += 1
        elif self.skip:
            return
        elif tag == "title":
            self.in_title = True
        elif self.rich and tag in ("a", "img", "code", "td", "th", "tr", "table", *self.MARK):
            self._inline(tag, attrs, True)
        elif tag in ("main", "article"):
            self.inside += 1
            self.put("\n")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.put("\n\n" + "#" * int(tag[1]) + " ")
        elif tag == "li":
            self.put("\n- ")
        elif tag == "pre":
            self.pre += 1
            self.put("\n```\n")
        elif tag in self.BLOCK:
            self.put("\n")

    def handle_endtag(self, tag):
        if self.noise:
            self.noise[1] -= tag == self.noise[0]
            if not self.noise[1]:
                self.noise = None
            return
        if self.math is not None:
            if tag == "annotation":
                self.math["in"] = False
            elif tag == "math":
                tex = re.sub(r"^\{\\displaystyle\s*(.*)\}$", r"\1", (self.math["tex"] or "").strip(), flags=re.S).strip()
                if tex:
                    self.put((f"\n\n$${tex}$$\n\n" if self.math["block"] else f"${tex}$") if self.rich else f" {tex} ")
                self.math = None
            return
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
        elif self.skip:
            return
        elif tag == "title":
            self.in_title = False
        elif self.rich and tag in ("a", "code", "td", "th", "tr", "table", *self.MARK):
            self._inline(tag, (), False)
        elif tag in ("main", "article"):
            self.inside = max(0, self.inside - 1)
        elif tag == "pre":
            self.pre = max(0, self.pre - 1)
            self.put("\n```\n")
        elif tag in self.BLOCK or tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.put("\n")

    def handle_data(self, data):
        if self.noise:
            return
        if self.math is not None:
            if self.math["in"]:
                self.math["tex"] += data
            return
        if self.in_title:
            self.title += data
        elif not self.skip:
            self.put(data if self.pre else re.sub(r"\s+", " ", data))

    def text(self):
        main = "".join(self.main)
        source = main if len(main.strip()) > 400 else "".join(self.all)
        lines = [line.rstrip() for line in source.splitlines()]
        # Empty list items and headings are what navigation leaves behind.
        lines = [line for line in lines if not re.fullmatch(r"\s*(-|#+)\s*", line)]
        return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def _download(url):
    """The page at url (redirects followed, each hop checked to be public): final url, content type, bytes."""
    url = str(url).strip()
    with httpx.Client(timeout=25, headers={"User-Agent": AGENT}, follow_redirects=False) as client:
        for _ in range(6):
            _public(url)
            with client.stream("GET", url) as response:
                if response.status_code in (301, 302, 303, 307, 308) and response.headers.get("location"):
                    url = urljoin(url, response.headers["location"])
                    continue
                if response.status_code >= 400:
                    raise WebError(f"网页返回 HTTP {response.status_code}")
                kind = response.headers.get("content-type", "")
                cap = 40_000_000 if "pdf" in kind else 3_000_000
                data = b""
                for chunk in response.iter_bytes():
                    data += chunk
                    if len(data) > cap:
                        break
                return url, kind, data
    raise WebError("重定向次数太多")


def _pdf(data):
    """A PDF's text page by page (pypdf, when installed)."""
    try:
        from pypdf import PdfReader
    except ImportError:
        raise WebError("这是 PDF；装上 pypdf 才能在 Lattice 里读") from None
    try:
        reader = PdfReader(io.BytesIO(data))
        title = str((reader.metadata or {}).get("/Title") or "").strip()
        pages = [f"## 第 {i + 1} 页\n\n" + (page.extract_text() or "").strip() for i, page in enumerate(reader.pages[:400])]
    except Exception as exc:
        raise WebError(f"读不出这个 PDF：{exc}") from exc
    return title, "\n\n".join(pages)


def _read(url, rich):
    url, kind, data = _download(url)
    if "pdf" in kind or data[:5] == b"%PDF-":
        title, body = _pdf(data)
        return url, title, body, "pdf"
    charset = re.search(r"charset=([\w-]+)", kind)
    raw = data.decode(charset.group(1) if charset else "utf-8", "replace")
    if "html" in kind or raw.lstrip()[:15].lower().startswith(("<!doctype", "<html")):
        parser = _Text(rich, url)
        parser.feed(raw)
        return url, parser.title.strip(), parser.text(), "html"
    if "json" in kind:
        return url, "", json.dumps(json.loads(raw), ensure_ascii=False, indent=1) if raw.strip() else "", "json"
    return url, "", raw, "text"


def page(url, limit=400_000):
    """A page for the learner's reader: Markdown with links kept."""
    url, title, body, kind = _read(url, True)
    cut = len(body) > limit
    return {"url": url, "title": title or url, "markdown": body[:limit] + (f"\n\n…（后面还有 {len(body) - limit} 个字符没显示）" if cut else ""), "kind": kind, "truncated": cut}


def fetch(url, limit=20000):
    url, title, body, kind = _read(url, False)
    cut = len(body) > limit
    return {"url": url, "title": title, "text": body[:limit] + (f"\n\n…（还有 {len(body) - limit} 个字符没有返回）" if cut else ""), "truncated": cut}
