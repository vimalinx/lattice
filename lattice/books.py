"""Books as text, for the agents: a PDF's pages, the chapters of an EPUB, MOBI, AZW3 or FB2. The learner reads a book in
the book window, which draws it as it is (see ui/book/); what an agent reads comes from here, so it can read and search a
book that is not even open. Extracted text is kept under .lattice/cache/, as a long PDF takes a while to go through."""
from __future__ import annotations

from collections import OrderedDict
import hashlib
import io
import json
from pathlib import Path
import posixpath
import re
import struct
from urllib.parse import unquote
from xml.etree import ElementTree
import zipfile

from .web import _Text

FORMATS = {".pdf": "PDF", ".epub": "EPUB", ".mobi": "MOBI", ".azw": "AZW", ".azw3": "AZW3", ".prc": "MOBI", ".fb2": "FB2", ".cbz": "CBZ"}
CHUNK = 20000   # a book that does not say where its chapters start is cut into stretches of about this many characters


class BookError(ValueError):
    pass


def is_book(name):
    name = str(name).lower()
    return name.endswith(".fb2.zip") or Path(name).suffix in FORMATS


def _html_text(html):
    parser = _Text(False, "")
    parser.feed(html)
    return parser.title.strip(), parser.text().strip()


def _heading(html):
    found = re.search(r"<h[1-3][^>]*>(.*?)</h[1-3]>", html, re.I | re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", found.group(1))).strip()[:120] if found else ""


# ---- PDF ----------------------------------------------------------------------------------------------------------
def _wide(text):
    """Chinese in a PDF that names a standard two-byte encoding instead of saying what its codes mean comes out of pypdf
    as the raw bytes of UTF-16, one character each. Such a line is put back together."""
    def line(raw):
        if not re.search(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]", raw) or any(ord(c) > 255 for c in raw) or len(raw) % 2:
            return raw
        try:
            back = raw.encode("latin-1").decode("utf-16-be")
        except UnicodeError:
            return raw
        return back if len(re.findall(r"[\u3000-\u9fff\uff00-\uffef]", back)) * 2 >= len(back) else raw
    return "\n".join(line(raw) for raw in text.split("\n"))


def _pdf(data):
    from pypdf import PdfReader
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise BookError("这个 PDF 有密码")
        info = reader.metadata or {}
        pages = [{"title": f"第 {i + 1} 页", "text": _wide(page.extract_text() or "").strip()} for i, page in enumerate(reader.pages)]
        toc = []

        def walk(items):
            for item in items:
                if isinstance(item, list):
                    walk(item)
                else:
                    try:
                        toc.append({"title": str(item.title), "section": reader.get_destination_page_number(item) + 1})
                    except Exception:   # an entry pointing nowhere is left out, the rest of the outline still counts
                        pass
        walk(reader.outline)
    except BookError:
        raise
    except Exception as exc:
        raise BookError(f"读不出这个 PDF：{exc}") from exc
    empty = sum(len(p["text"]) for p in pages) < 30 * len(pages)
    return {"title": str(info.get("/Title") or "").strip(), "author": str(info.get("/Author") or "").strip(), "unit": "页", "sections": pages, "toc": toc,
            **({"note": "这个 PDF 基本没有文字层（多半是扫描版）：学习者能看，但这里读不出文字"} if empty else {})}


# ---- EPUB ---------------------------------------------------------------------------------------------------------
def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _epub(data):
    try:
        book = zipfile.ZipFile(io.BytesIO(data))
        names = set(book.namelist())
        if "META-INF/rights.xml" in names or b"ns.adobe.com/adept" in (book.read("META-INF/encryption.xml") if "META-INF/encryption.xml" in names else b""):
            raise BookError("这本书有 DRM 保护，打不开")
        opf_path = next(e.get("full-path") for e in ElementTree.fromstring(book.read("META-INF/container.xml")).iter() if _local(e.tag) == "rootfile")
        opf = ElementTree.fromstring(book.read(opf_path))
        base = posixpath.dirname(opf_path)
        where = lambda href: posixpath.normpath(posixpath.join(base, unquote(href.split("#")[0])))
        items, spine, meta = {}, [], {}
        for e in opf.iter():
            tag = _local(e.tag)
            if tag == "item":
                items[e.get("id")] = e
            elif tag == "itemref":
                spine.append(e.get("idref"))
            elif tag in ("title", "creator") and tag not in meta and (e.text or "").strip():
                meta[tag] = e.text.strip()
        # Titles of the chapters, from the table of contents (EPUB 2's NCX or EPUB 3's nav).
        titles = {}
        for item in items.values():
            props, kind = item.get("properties") or "", item.get("media-type") or ""
            if "nav" not in props.split() and kind != "application/x-dtbncx+xml":
                continue
            folder = posixpath.dirname(where(item.get("href")))
            toc = ElementTree.fromstring(book.read(where(item.get("href"))))
            if kind == "application/x-dtbncx+xml":
                for point in (e for e in toc.iter() if _local(e.tag) == "navPoint"):
                    label = next((" ".join(x.text.split()) for x in point.iter() if _local(x.tag) == "text" and x.text), "")
                    src = next((x.get("src") for x in point.iter() if _local(x.tag) == "content"), "")
                    if label and src:
                        titles.setdefault(posixpath.normpath(posixpath.join(folder, unquote(src.split("#")[0]))), label)
            else:
                for link in (e for e in toc.iter() if _local(e.tag) == "a" and e.get("href")):
                    label = " ".join("".join(link.itertext()).split())
                    if label:
                        titles.setdefault(posixpath.normpath(posixpath.join(folder, unquote(link.get("href").split("#")[0]))), label)
        sections = []
        for ident in spine:
            item = items.get(ident)
            if item is None or "html" not in (item.get("media-type") or ""):
                continue
            rel = where(item.get("href"))
            html = book.read(rel).decode("utf-8", "replace")
            head, body = _html_text(html)
            if body:
                sections.append({"title": titles.get(rel) or _heading(html) or head or f"第 {len(sections) + 1} 部分", "text": body})
    except BookError:
        raise
    except (zipfile.BadZipFile, KeyError, StopIteration, ElementTree.ParseError) as exc:
        raise BookError(f"读不出这个 EPUB：{exc}") from exc
    return {"title": meta.get("title", ""), "author": meta.get("creator", ""), "unit": "章", "sections": sections}


# ---- MOBI, AZW3 ---------------------------------------------------------------------------------------------------
def _palmdoc(data):
    """Palm's LZ77: a literal run, a literal byte, a space and a letter, or a copy from what came before."""
    out, i = bytearray(), 0
    while i < len(data):
        c = data[i]
        i += 1
        if 1 <= c <= 8:
            out += data[i:i + c]
            i += c
        elif c < 0x80:
            out.append(c)
        elif c >= 0xC0:
            out += bytes((32, c ^ 0x80))
        else:
            pair = (c << 8) | data[i]
            i += 1
            back, length = (pair & 0x3FFF) >> 3, (pair & 7) + 3
            for _ in range(length):
                out.append(out[-back])
    return bytes(out)


class _Huffman:
    """Kindle's HUFF/CDIC compression: Huffman codes into a dictionary of phrases, which can themselves be compressed."""

    def __init__(self, tables):
        huff = tables[0]
        if huff[:4] != b"HUFF":
            raise BookError("这本书的压缩数据不对")
        first, second = struct.unpack(">LL", huff[8:16])
        self.quick = []
        for value in struct.unpack(">256L", huff[first:first + 1024]):
            length, end, top = value & 0x1F, value & 0x80, value >> 8
            self.quick.append((length, end, ((top + 1) << (32 - length)) - 1))
        limits = struct.unpack(">64L", huff[second:second + 256])
        self.lows = [0] + [limits[2 * n] << (31 - n) for n in range(32)]
        self.tops = [0] + [((limits[2 * n + 1] + 1) << (31 - n)) - 1 for n in range(32)]
        self.phrases = []
        for table in tables[1:]:
            if table[:4] != b"CDIC":
                break
            count, bits = struct.unpack(">LL", table[8:16])
            for n in range(min(1 << bits, count - len(self.phrases))):
                at = struct.unpack(">H", table[16 + 2 * n:18 + 2 * n])[0]
                size = struct.unpack(">H", table[16 + at:18 + at])[0]
                self.phrases.append((table[18 + at:18 + at + (size & 0x7FFF)], bool(size & 0x8000)))

    def unpack(self, data):
        left, data, at, out = len(data) * 8, data + b"\0" * 8, 0, bytearray()
        window, room = struct.unpack(">Q", data[:8])[0], 32
        while True:
            if room <= 0:
                at += 4
                window = struct.unpack(">Q", data[at:at + 8])[0]
                room += 32
            code = (window >> room) & 0xFFFFFFFF
            length, end, top = self.quick[code >> 24]
            if not end:
                while code < self.lows[length]:
                    length += 1
                top = self.tops[length]
            room -= length
            left -= length
            if left < 0:
                return bytes(out)
            index = (top - code) >> (32 - length)
            phrase, done = self.phrases[index]
            if not done:
                # Phrases are compressed too; each is unpacked the first time it is used.
                self.phrases[index] = (b"", True)
                phrase = self.unpack(phrase)
                self.phrases[index] = (phrase, True)
            out += phrase


def _trailing(record, flags):
    """Without the data some records carry after their text."""
    size = len(record)
    def extra(end):
        value, shift = 0, 0
        for byte in reversed(record[max(0, end - 4):end]):
            value |= (byte & 0x7F) << shift
            shift += 7
            if byte & 0x80:
                break
        return value
    for bit in range(1, 16):
        if flags & (1 << bit):
            size -= extra(size)
    if flags & 1 and size > 0:
        size -= (record[size - 1] & 3) + 1
    return record[:max(0, size)]


def _mobi(data):
    if len(data) < 80 or data[60:68] not in (b"BOOKMOBI", b"TEXtREAd"):
        raise BookError("这不是 MOBI 文件")
    count = struct.unpack(">H", data[76:78])[0]
    starts = [struct.unpack(">L", data[78 + 8 * i:82 + 8 * i])[0] for i in range(count)] + [len(data)]
    record = lambda i: data[starts[i]:starts[i + 1]]
    head = record(0)
    compression, _, _, texts, _, encryption = struct.unpack(">HHLHHH", head[:14])
    if encryption:
        raise BookError("这本书有 DRM 保护，打不开")
    encoding, flags, title, huff, author = "cp1252", 0, "", None, ""
    if head[16:20] == b"MOBI":
        length, _, code = struct.unpack(">LLL", head[20:32])
        encoding = "utf-8" if code == 65001 else "cp1252"
        name_at, name_size = struct.unpack(">LL", head[84:92])
        title = head[name_at:name_at + name_size].decode(encoding, "replace")
        huff = struct.unpack(">LL", head[112:120])
        if length >= 0xE4:
            flags = struct.unpack(">H", head[242:244])[0]
        if struct.unpack(">L", head[128:132])[0] & 0x40 and head[16 + length:20 + length] == b"EXTH":
            n, at = struct.unpack(">L", head[24 + length:28 + length])[0], 28 + length
            for _ in range(n):
                kind, size = struct.unpack(">LL", head[at:at + 8])
                if kind == 100 and not author:
                    author = head[at + 8:at + size].decode(encoding, "replace")
                at += size
    if compression == 1:
        unpack = bytes
    elif compression == 2:
        unpack = _palmdoc
    elif compression == 17480 and huff:
        unpack = _Huffman([record(i) for i in range(huff[0], huff[0] + huff[1])]).unpack
    else:
        raise BookError("这本书的压缩方式不认识")
    html = b"".join(unpack(_trailing(record(i), flags)) for i in range(1, texts + 1)).decode(encoding, "replace")
    # KF8 keeps each part's own <html>; older books mark page breaks.
    parts = [p for p in re.split(r"(?=<html\b)|<mbp:pagebreak\s*/?>", html, flags=re.I) if p.strip()]
    sections = []
    for part in parts:
        _, body = _html_text(part)
        if not body:
            continue
        if sections and len(sections[-1]["text"]) < 300:
            sections[-1]["text"] += "\n\n" + body
        else:
            sections.append({"title": _heading(part), "text": body})
    return {"title": title, "author": author, "unit": "章", "sections": _named(sections)}


def _named(sections):
    """Long stretches cut up, and each with a name."""
    out = []
    for s in sections:
        text = s["text"]
        for i in range(0, len(text), CHUNK):
            out.append({"title": s["title"] + (f"（{i // CHUNK + 1}）" if i and s["title"] else ""), "text": text[i:i + CHUNK]})
    for i, s in enumerate(out):
        s["title"] = s["title"] or f"第 {i + 1} 部分"
    return out


# ---- FB2 ----------------------------------------------------------------------------------------------------------
def _fb2(data):
    if data[:2] == b"PK":
        book = zipfile.ZipFile(io.BytesIO(data))
        data = book.read(next(n for n in book.namelist() if n.lower().endswith(".fb2")))
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError as exc:
        raise BookError(f"读不出这个 FB2：{exc}") from exc
    words = lambda e: " ".join(" ".join(e.itertext()).split())
    info = next((e for e in root.iter() if _local(e.tag) == "title-info"), None)
    title = next((words(e) for e in (info if info is not None else ()) if _local(e.tag) == "book-title"), "")
    author = next((words(e) for e in (info if info is not None else ()) if _local(e.tag) == "author"), "")
    sections = []
    for body in (e for e in root if _local(e.tag) == "body"):
        for section in (e for e in body if _local(e.tag) == "section"):
            head = next((words(e) for e in section if _local(e.tag) == "title"), "")
            text = "\n\n".join(words(e) for e in section.iter() if _local(e.tag) in ("p", "v", "subtitle") and words(e))
            if text:
                sections.append({"title": head, "text": text})
    return {"title": title, "author": author, "unit": "章", "sections": _named(sections)}


def _cbz(data):
    book = zipfile.ZipFile(io.BytesIO(data))
    pages = [n for n in book.namelist() if n.lower().endswith((".jpg", ".jpeg", ".png", ".gif", ".webp"))]
    return {"title": "", "author": "", "unit": "页", "sections": [], "note": f"这是漫画，共 {len(pages)} 页，都是图片，这里读不出文字"}


# ---- reading ------------------------------------------------------------------------------------------------------
def _extract(path):
    name, data = Path(path).name.lower(), Path(path).read_bytes()
    if data[:5] == b"%PDF-":
        return _pdf(data)
    if data[60:68] in (b"BOOKMOBI", b"TEXtREAd"):
        return _mobi(data)
    if name.endswith(".cbz"):
        return _cbz(data)
    if name.endswith((".fb2", ".fb2.zip")):
        return _fb2(data)
    if name.endswith(".epub"):
        return _epub(data)
    raise BookError("这个格式还读不了")


_recent = OrderedDict()


def load(path, cache=None):
    """A book's text: {title, author, unit, sections: [{title, text}], toc, format}."""
    path = Path(path)
    stat = path.stat()
    key = hashlib.sha1(f"{path}|{stat.st_mtime_ns}|{stat.st_size}".encode()).hexdigest()[:24]
    if key in _recent:
        _recent.move_to_end(key)
        return _recent[key]
    kept = Path(cache) / f"{key}.json" if cache else None
    try:
        book = json.loads(kept.read_text(encoding="utf-8"))
    except (AttributeError, OSError, ValueError):
        book = {**_extract(path), "format": FORMATS.get(path.suffix.lower(), "FB2")}
        book["title"] = book["title"] or path.stem
        if kept:
            kept.parent.mkdir(parents=True, exist_ok=True)
            kept.write_text(json.dumps(book, ensure_ascii=False), encoding="utf-8")
    _recent[key] = book
    while len(_recent) > 4:
        _recent.popitem(last=False)
    return book


def contents(book):
    """The table of contents: the book's own, or (a book of chapters) the chapters."""
    return book.get("toc") or [{"title": s["title"], "section": i + 1} for i, s in enumerate(book["sections"])] if book["unit"] == "章" or book.get("toc") else []


def place(book, progress):
    """Which page or chapter is that far through the book."""
    sections = book["sections"]
    if book["unit"] == "页":
        return max(1, round(progress * len(sections)))
    left = progress * sum(len(s["text"]) for s in sections)
    for i, s in enumerate(sections):
        left -= len(s["text"])
        if left <= 0:
            return i + 1
    return max(1, len(sections))


def excerpt(book, start=None, end=None, cap=30000):
    """Some of a book's pages or chapters, numbered from 1, up to about `cap` characters."""
    sections, total = book["sections"], len(book["sections"])
    head = {"title": book["title"], "author": book["author"], "format": book["format"], "unit": book["unit"], "sections": total, **({"note": book["note"]} if book.get("note") else {})}
    if not total:
        return head
    first = max(1, min(int(start or 1), total))
    last = max(first, min(int(end or total), total))
    parts, size, shown = [], 0, first - 1
    for i in range(first - 1, last):
        text = sections[i]["text"]
        if parts and size + len(text) > cap:
            break
        parts.append(f"## {sections[i]['title']}\n\n" + text[:cap])
        size += len(text)
        shown = i + 1
    return {**head, "from": first, "to": shown, "content": "\n\n".join(parts), **({"more": f"到第 {shown} {book['unit']}，全书 {total} {book['unit']}；用 from/to 读后面的"} if shown < total else {})}


def find(book, words, limit=30):
    """Where a book says something: each page or chapter that does, with the words around the first place."""
    words, found = str(words).strip(), []
    pattern = re.compile(re.escape(words), re.I)
    for i, s in enumerate(book["sections"]):
        hits = list(pattern.finditer(s["text"]))
        if hits:
            at = hits[0].start()
            found.append({"section": i + 1, "title": s["title"], "hits": len(hits), "text": re.sub(r"\s+", " ", s["text"][max(0, at - 80):at + 160])})
            if len(found) >= limit:
                break
    return found
