"""What the parts of the bridge share: where things live, file kinds, small helpers."""
from __future__ import annotations

import difflib
import json
import logging
from pathlib import Path
import re
from .. import host

LOG = logging.getLogger("lattice")
DATA_HOME = host.data_home()
APP_HOME = DATA_HOME / "lattice"
LEGACY_DB = APP_HOME / "lattice.db"
USAGE_LOG = APP_HOME / "usage.jsonl"
WEB_CACHE = APP_HOME / "web-cache"
TEXT_EXT = {".md", ".txt", ".py", ".js", ".mjs", ".ts", ".c", ".h", ".cpp", ".cc", ".hpp", ".rs", ".go", ".sh", ".json", ".yaml", ".yml",
            ".toml", ".csv", ".tsv", ".html", ".css", ".rb", ".lua", ".jl", ".r", ".R", ".java", ".pl", ".php", ".ini", ".cfg", ".tex", ".sql", ".jsonl"}
IMAGE_EXT = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp"}
CODE_EXT = {"python": ".py", "py": ".py", "c": ".c", "cpp": ".cpp", "c++": ".cpp", "rust": ".rs", "rs": ".rs", "go": ".go",
            "javascript": ".js", "js": ".js", "typescript": ".ts", "ts": ".ts", "bash": ".sh", "sh": ".sh", "shell": ".sh", "ruby": ".rb",
            "lua": ".lua", "julia": ".jl", "r": ".r", "java": ".java"}
def _places():
    """The usual folders (the XDG user folders, under whatever names they have here) for the file picker's side."""
    home, out = Path.home(), [{"name": "家目录", "path": str(Path.home())}]
    names = {"DESKTOP": ("桌面", "Desktop"), "DOWNLOAD": ("下载", "Downloads"), "DOCUMENTS": ("文档", "Documents"),
             "PROJECTS": ("项目", "Projects"), "PICTURES": ("图片", "Pictures")}
    found = {}
    try:
        for line in (host.config_home() / "user-dirs.dirs").read_text(encoding="utf-8").splitlines():
            m = re.match(r'XDG_(\w+)_DIR="(.*)"', line.strip())
            if m and m.group(1) in names:
                found[m.group(1)] = Path(m.group(2).replace("$HOME", str(home)))
    except OSError:
        pass
    for key, (name, usual) in names.items():
        folder = found.get(key, home / usual)
        if folder.is_dir() and folder != home:
            out.append({"name": name, "path": str(folder)})
    return out

def compact(items):
    return json.dumps(items, ensure_ascii=False, default=str)

def notebook_sources(raw):
    """A notebook as its cells' sources, one after another, for comparing versions."""
    try:
        cells = json.loads(raw).get("cells") or [] if raw else []
    except ValueError:
        return raw
    return "\n".join(f"# ── 第 {i} 格（{'代码' if c.get('cell_type') == 'code' else '文字'}）\n" + "".join(c.get("source") or "")
                     for i, c in enumerate(cells, 1))

def line_diff(before, after, context=3, limit=3000):
    """Two texts compared line by line: the changed lines with `context` unchanged ones around them, and how many lines
    were added and removed. Each line carries its number in the old (o) or new (n) text."""
    a, b = before.splitlines(), after.splitlines()
    lines, added, removed = [], 0, 0
    for group in difflib.SequenceMatcher(None, a, b, autojunk=False).get_grouped_opcodes(context):
        first = group[0]
        if first[1] > 0 or lines:
            lines.append({"t": "skip", "n": first[3] + 1})
        for tag, i1, i2, j1, j2 in group:
            if tag == "equal":
                lines += [{"t": "ctx", "o": i + 1, "n": j + 1, "s": b[j]} for i, j in zip(range(i1, i2), range(j1, j2))]
                continue
            lines += [{"t": "del", "o": i + 1, "s": a[i]} for i in range(i1, i2)]
            lines += [{"t": "add", "n": j + 1, "s": b[j]} for j in range(j1, j2)]
            removed, added = removed + i2 - i1, added + j2 - j1
    return {"lines": lines[:limit], "cut": len(lines) > limit, "added": added, "removed": removed, "same": not added and not removed}

def app_meta(head, fallback):
    """An app's name and one-line description, from its <title> and <meta name="description">."""
    title = re.search(r"<title[^>]*>(.*?)</title>", head, re.S | re.I)
    about = re.search(r"<meta\s+name=[\"']description[\"']\s+content=[\"'](.*?)[\"']", head, re.S | re.I)
    clean = lambda x: re.sub(r"\s+", " ", x).strip()
    return {"title": clean(title.group(1))[:80] if title and clean(title.group(1)) else fallback, "about": clean(about.group(1))[:200] if about else ""}

