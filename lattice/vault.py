"""The learning vault: plain files in a git repository are the only source of truth.

Everything else (the SQLite index, the UI) is derived from these files and can
be rebuilt. Markdown carries its attributes as YAML frontmatter, notebooks in
metadata.lattice, conversations and the journal as JSON lines.
"""
from __future__ import annotations

from datetime import datetime
import json
import os
from pathlib import Path
import re
import subprocess

import yaml

VAULT_PATH = Path(os.environ.get("LATTICE_VAULT") or Path.home() / "Lattice")
# Where each kind lives by default. Folders are for people; meaning comes from attributes.
FOLDERS = {"topic": "topics", "card": "cards", "lesson": "lessons", "note": "notes", "insight": "insights",
           "notebook": "notebooks", "thread": "threads", "journal": "journal"}
KIND_OF_FOLDER = {v: k for k, v in FOLDERS.items()}
IGNORED = """.lattice/index.db*
.lattice/settings.json
.lattice/state.json
.lattice/runs/
.lattice/venvs/
"""
# Journal and conversations only ever grow; undoing an agent's change never rewrites them.
APPEND_ONLY = ("journal/", "threads/")


def now():
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def slug(title, limit=60):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", str(title)).strip().strip(".") or "未命名"
    return re.sub(r"\s+", " ", name)[:limit].rstrip()


def split_frontmatter(source):
    if source.startswith("---\n"):
        end = source.find("\n---", 4)
        if end >= 0:
            attrs = yaml.safe_load(source[4:end]) or {}
            if isinstance(attrs, dict):
                return attrs, source[end + 4:].strip("\n")
    return {}, source.rstrip("\n")


def join_frontmatter(attrs, body):
    head = yaml.safe_dump({k: v for k, v in attrs.items() if v not in (None, [], {}, "")},
                          allow_unicode=True, sort_keys=False, width=1000)
    return "---\n" + head + "---\n\n" + (body or "").rstrip() + "\n"


class VaultError(ValueError):
    pass


class Vault:
    def __init__(self, root=VAULT_PATH):
        self.root = Path(root).expanduser()
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / ".lattice").mkdir(exist_ok=True)
        for folder in FOLDERS.values():
            (self.root / folder).mkdir(exist_ok=True)
        ignore = self.root / ".gitignore"
        if not ignore.exists():
            ignore.write_text(IGNORED, encoding="utf-8")
        # What we last wrote or indexed, so a scan only reports outside edits.
        self.known = {}
        self.pending = set()
        if not (self.root / ".git").exists():
            self.git("init", "-q")
            self.commit("建立学习库", "lattice")

    # ---- paths ---------------------------------------------------------------
    def path(self, rel):
        target = (self.root / rel).resolve()
        if not target.is_relative_to(self.root.resolve()):
            raise VaultError("路径不在学习库内：" + str(rel))
        return target

    def rel(self, path):
        return Path(path).resolve().relative_to(self.root.resolve()).as_posix()

    def unique(self, folder, title, ext, current=None):
        """A readable, collision-free path; keeps the current one when the name still fits."""
        base = slug(title)
        for n in range(1, 1000):
            rel = f"{folder}/{base}{'' if n == 1 else f' ({n})'}{ext}"
            if rel == current or not self.path(rel).exists():
                return rel
        raise VaultError("同名文件太多")

    def _stat(self, rel):
        st = self.path(rel).stat()
        return st.st_mtime_ns, st.st_size

    # ---- reading and writing -------------------------------------------------
    def read_text(self, rel):
        return self.path(rel).read_text(encoding="utf-8")

    def write_text(self, rel, content):
        target = self.path(rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name("." + target.name + ".tmp")
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, target)
        self.known[rel] = self._stat(rel)
        self.pending.add(rel)

    def append_line(self, rel, record):
        target = self.path(rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        self.known[rel] = self._stat(rel)
        self.pending.add(rel)

    def remove(self, rel):
        self.path(rel).unlink(missing_ok=True)
        self.known.pop(rel, None)
        self.pending.add(rel)

    def move(self, old, new):
        if old == new:
            return new
        target = self.path(new)
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(self.path(old), target)
        self.known.pop(old, None)
        self.known[new] = self._stat(new)
        self.pending |= {old, new}
        return new

    def read_md(self, rel):
        return split_frontmatter(self.read_text(rel))

    def write_md(self, rel, attrs, body):
        self.write_text(rel, join_frontmatter(attrs, body))

    def read_json(self, rel):
        return json.loads(self.read_text(rel))

    def write_json(self, rel, value):
        self.write_text(rel, json.dumps(value, ensure_ascii=False, indent=1) + "\n")

    def read_lines(self, rel):
        out = []
        for line in self.read_text(rel).splitlines():
            if line.strip():
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return out

    def write_lines(self, rel, records):
        self.write_text(rel, "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records))

    # ---- finding changes ----------------------------------------------------------
    def files(self):
        for folder in FOLDERS.values():
            base = self.root / folder
            for current, dirs, names in os.walk(base):
                dirs[:] = sorted(d for d in dirs if not d.startswith("."))
                for name in sorted(names):
                    if not name.startswith(".") and not name.endswith(".tmp"):
                        yield self.rel(Path(current) / name)

    def scan(self):
        """Files changed, added or removed outside Lattice since we last looked."""
        changed, seen = [], set()
        for rel in self.files():
            seen.add(rel)
            try:
                stat = self._stat(rel)
            except OSError:
                continue
            if self.known.get(rel) != stat:
                self.known[rel] = stat
                changed.append(rel)
        removed = [rel for rel in list(self.known) if rel not in seen]
        for rel in removed:
            self.known.pop(rel, None)
        if changed or removed:
            self.pending |= set(changed) | set(removed)
        return changed, removed

    # ---- history ---------------------------------------------------------------------
    def git(self, *args, check=True):
        cmd = ["git", "-C", str(self.root), "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
               "-c", "core.quotepath=false", *args]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if check and result.returncode != 0:
            raise VaultError((result.stderr or result.stdout).strip()[:400] or "git 失败")
        return result.stdout

    def commit(self, message, actor="me"):
        """Commit everything changed; returns the commit id, or None when nothing changed."""
        self.git("add", "-A")
        if not self.git("status", "--porcelain").strip():
            self.pending.clear()
            return None
        name, email = ("我", "me@lattice.local") if actor == "me" else (f"Lattice · {actor}", f"{actor}@lattice.local")
        self.git("-c", f"user.name={name}", "-c", f"user.email={email}", "commit", "-q", "-m", message)
        self.pending.clear()
        return self.git("rev-parse", "HEAD").strip()

    def _at(self, commit, rel):
        try:
            return self.git("show", f"{commit}:{rel}")
        except VaultError:
            return None  # the file did not exist there

    def revert(self, commit):
        """Undo one commit's content changes, file by file.

        Journal and conversations stay as they are. A file changed again after the
        commit is a conflict: nothing is touched and the learner is told."""
        self.commit("我的编辑", "me")
        names = [line.split("\t")[-1] for line in self.git("show", "--name-status", "--no-renames", "--format=", commit).splitlines() if line]
        touched = [rel for rel in names if not rel.startswith(APPEND_ONLY)]
        before = {}
        for rel in touched:
            target = self.path(rel)
            now_text = target.read_text(encoding="utf-8") if target.exists() else None
            if now_text != self._at(commit, rel):
                raise VaultError("这一步之后这些内容又被改过，没法自动撤销；可以手动改回去")
            before[rel] = self._at(commit + "^", rel)
        for rel, content in before.items():
            if content is None:
                self.remove(rel)
            else:
                self.write_text(rel, content)
        if touched:
            self.commit("撤销：" + self.git("log", "-1", "--format=%s", commit).strip(), "me")
        return touched

    def history(self, ident, folder, limit=200):
        """Committed versions of the file carrying `id: ident`, newest first.

        Follows the id rather than the path: a retitled note moves to a new file and
        git cannot always tell that it is a rename."""
        paths = {line for line in self.git("log", "--format=", "--name-only", "-G", f"^id: {re.escape(ident)}$", "--", folder, check=False).splitlines() if line}
        if not paths:
            return []
        out = self.git("log", f"-{limit}", "--name-only", "--format=\x1e%H\x1f%aI\x1f%an\x1f%s", "--", *sorted(paths), check=False)
        versions = []
        for block in out.split("\x1e")[1:]:
            head, _, names = block.partition("\n")
            commit, at, author, subject = head.split("\x1f")
            for path in (n for n in names.splitlines() if n in paths):
                content = self._at(commit, path)
                if content and f"\nid: {ident}\n" in content:
                    versions.append({"commit": commit, "at": at, "author": author, "subject": subject, "path": path})
                    break
        return versions

    def show(self, commit, rel):
        return self.git("show", f"{commit}:{rel}")
