"""The learning vault: plain files in a git repository are the only source of truth.

Everything else (the SQLite index, the UI) is derived from these files and can
be rebuilt. Markdown carries its attributes as YAML frontmatter, notebooks in
metadata.lattice, conversations and the journal as JSON lines. Any other file
(code, data) is kept exactly as it is and referred to by its path.
"""
from __future__ import annotations

from .i18n import tr

from datetime import datetime
import json
import os
from pathlib import Path
import re
import subprocess

import yaml

from . import host

VAULT_PATH = Path(os.environ.get("LATTICE_VAULT") or Path.home() / "Lattice")
# Markdown kinds take their meaning from the folder they sit in; everything else is a plain file.
MD_KINDS = {"topics": "topic", "cards": "card", "lessons": "lesson", "notes": "note", "insights": "insight"}
# The working states, a file each (states.py).
STATES = "states"
FOLDERS = (*MD_KINDS, "notebooks", "code", "data", "envs", "threads", "journal", "annotations", STATES)
SKIP_DIRS = {".git", ".lattice", "__pycache__", "node_modules", ".venv", "venv", "target", ".ipynb_checkpoints"}
IGNORED = """.lattice/index.db*
.lattice/cache/
.lattice/settings.json
.lattice/state.json
.lattice/runs/
.lattice/venvs/
.lattice/kernels/
.lattice/scratch/
__pycache__/
*.pyc
node_modules/
target/
.venv/
.ipynb_checkpoints/
"""
# Journal and conversations only ever grow; undoing an agent's change never rewrites them.
APPEND_ONLY = ("journal/", "threads/")
# What the learner is like, as the agents keep it (they add to it only through Lattice, one line at a time).
ME = "me.md"
# Files at the vault's root kept by Lattice and the learner: the rules every agent reads, and what it is told about them.
KEPT = ("AGENTS.md", ME)
TEXT_LIMIT = 4 * 1024 * 1024


def now():
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def slug(title, limit=60):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", str(title)).strip().strip(".") or "未命名"
    return re.sub(r"\s+", " ", name)[:limit].rstrip()


def kind_of(rel):
    top = rel.split("/", 1)[0]
    if rel.endswith(".jsonl") and top in ("threads", "journal"):
        return "thread" if top == "threads" else "journal"
    if rel.endswith(".ipynb"):
        return "notebook"
    if top == "annotations" and rel.endswith(".json"):
        return "annotation"
    if rel.endswith(".md") and top in MD_KINDS:
        return MD_KINDS[top]
    return "file"


def split_frontmatter(source):
    if source.startswith("---\n"):
        end = source.find("\n---", 4)
        if end >= 0:
            try:
                attrs = yaml.safe_load(source[4:end]) or {}
            except yaml.YAMLError:
                attrs = None
            if isinstance(attrs, dict):
                return attrs, source[end + 4:].strip("\n")
    return {}, source.rstrip("\n")


def join_frontmatter(attrs, body):
    head = yaml.safe_dump({k: v for k, v in attrs.items() if v not in (None, [], {}, "")},
                          allow_unicode=True, sort_keys=False, width=1000)
    return "---\n" + head + "---\n\n" + (body or "").rstrip() + "\n"


class VaultError(ValueError):
    pass


LARGE = 50_000_000   # bytes; new files bigger than this are not committed


class Vault:
    def __init__(self, root=VAULT_PATH):
        self.root = Path(root).expanduser()
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / ".lattice").mkdir(exist_ok=True)
        for folder in FOLDERS:
            (self.root / folder).mkdir(exist_ok=True)
        ignore = self.root / ".gitignore"
        lines = ignore.read_text(encoding="utf-8").splitlines() if ignore.exists() else []
        missing = [line for line in IGNORED.splitlines() if line not in lines]
        if missing:
            ignore.write_text("\n".join(lines + missing) + "\n", encoding="utf-8")
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
            raise VaultError(tr("路径不在学习库内：") + str(rel))
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
        raise VaultError(tr("同名文件太多"))

    def _stat(self, rel):
        st = self.path(rel).stat()
        return st.st_mtime_ns, st.st_size

    def ours(self, rel):
        """Whether a file is as Lattice itself last wrote or saw it."""
        try:
            return self.known.get(rel) == self._stat(rel)
        except OSError:
            return False

    def mtime(self, rel):
        """A file's version stamp, as a string: nanoseconds do not survive a JavaScript number."""
        try:
            return str(self.path(rel).stat().st_mtime_ns)
        except OSError:
            return None

    # ---- reading and writing -------------------------------------------------
    def read_text(self, rel):
        return self.path(rel).read_text(encoding="utf-8")

    def write_text(self, rel, content):
        self.write_bytes(rel, content.encode("utf-8"))

    def write_bytes(self, rel, data):
        target = self.path(rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name("." + target.name + ".tmp")
        tmp.write_bytes(data)
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
        target = self.path(rel)
        if target.is_dir():
            for sub in sorted(target.rglob("*"), reverse=True):
                sub.rmdir() if sub.is_dir() else sub.unlink()
            target.rmdir()
        else:
            target.unlink(missing_ok=True)
        self.known = {k: v for k, v in self.known.items() if k != rel and not k.startswith(rel + "/")}
        self.pending.add(rel)

    def move(self, old, new):
        if old == new:
            return new
        target = self.path(new)
        if target.exists():
            raise VaultError(tr("目标已存在：") + str(new))
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(self.path(old), target)
        self.known.pop(old, None)
        if target.is_file():
            self.known[new] = self._stat(new)
        else:
            for k in [k for k in self.known if k.startswith(old + "/")]:
                self.known[new + k[len(old):]] = self.known.pop(k)
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
    def _entries(self, base, prefix):
        """Each file under a folder as its path in the vault and its directory entry. This runs every two seconds on the
        GUI thread, so it keeps to strings, and to the stat the listing already did."""
        try:
            with os.scandir(base) as listing:
                entries = sorted(listing, key=lambda e: e.name)
        except OSError:
            return
        folders = []
        for entry in entries:
            name = entry.name
            if entry.is_dir():
                if not name.startswith(".") and name not in SKIP_DIRS and not entry.is_symlink():
                    folders.append(entry)
            elif not name.startswith(".") and not name.endswith(".tmp") and not entry.is_symlink():
                yield prefix + name, entry
        for entry in folders:
            yield from self._entries(entry.path, prefix + entry.name + "/")

    def files(self, folder=""):
        for rel, _ in self._entries(self.path(folder) if folder else self.root, folder.rstrip("/") + "/" if folder else ""):
            yield rel

    def scan(self):
        """Files changed, added or removed outside Lattice since we last looked."""
        changed, seen = [], set()
        for rel, entry in self._entries(self.root, ""):
            seen.add(rel)
            try:
                found = entry.stat()
            except OSError:
                continue
            stat = found.st_mtime_ns, found.st_size
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
        # No hooks (an empty folder of them), no signing, paths as they are (not escaped), and files as they are: line endings
        # are never converted, so what an agent edits is what is committed.
        hooks = self.root / ".lattice" / "no-hooks"
        hooks.mkdir(parents=True, exist_ok=True)
        cmd = [host.tool("git") or "git", "-C", str(self.root), "-c", f"core.hooksPath={hooks}", "-c", "commit.gpgsign=false",
               "-c", "core.quotepath=false", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", *args]
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60, **host.QUIET)
        if check and result.returncode != 0:
            raise VaultError((result.stderr or result.stdout).strip()[:400] or tr("git 失败"))
        return result.stdout

    def changes(self):
        """Uncommitted paths as (status, path), renames split into a delete and an add."""
        self.git("add", "-A")
        out = []
        for line in self.git("diff", "--cached", "--name-status", "--no-renames").splitlines():
            status, _, rel = line.partition("\t")
            if rel:
                out.append((status[0], rel))
        return out

    def commit(self, message, actor="me"):
        """Commit everything changed; returns the commit id, or None when nothing changed. A new file over 50MB (a
        downloaded dataset, a model's weights) stays in the vault but out of its history."""
        large = [rel for rel in self.git("ls-files", "--others", "--exclude-standard", "-z").split("\0")
                 if rel and (self.root / rel).is_file() and (self.root / rel).stat().st_size > LARGE]
        if large:
            exclude = self.root / ".git" / "info" / "exclude"
            exclude.parent.mkdir(parents=True, exist_ok=True)
            with exclude.open("a", encoding="utf-8") as f:
                f.write("".join("/" + rel.replace("\\", "\\\\").replace("*", "\\*").replace("?", "\\?").replace("[", "\\[") + "\n" for rel in large))
        # How the working states are arranged is never part of an edit or an agent's step (undoing one must not move the
        # windows): it goes into the history on its own.
        self.commit_only(STATES, "工作状态")
        self.git("add", "-A")
        if not self.git("status", "--porcelain").strip():
            self.pending.clear()
            return None
        name, email = ("我", "me@lattice.local") if actor == "me" else (f"Lattice · {actor}", f"{actor}@lattice.local")
        self.git("-c", f"user.name={name}", "-c", f"user.email={email}", "commit", "-q", "-m", message)
        self.pending.clear()
        return self.git("rev-parse", "HEAD").strip()

    def commit_only(self, folder, message, actor="me"):
        """Commit one folder (or several) and nothing else: what an agent is in the middle of stays out of it, and what is
        committed here cannot be swept into an agent's step, where undoing that step would take it too."""
        folders = (folder,) if isinstance(folder, str) else tuple(folder)
        self.git("add", "-A", "--", *folders, check=False)
        names = self.git("diff", "--cached", "--name-only", "--", *folders).splitlines()
        if not names:
            return None
        name, email = ("我", "me@lattice.local") if actor == "me" else (f"Lattice · {actor}", f"{actor}@lattice.local")
        self.git("-c", f"user.name={name}", "-c", f"user.email={email}", "commit", "-q", "-m", message, "--", *names)
        return self.git("rev-parse", "HEAD").strip()

    def head(self):
        return self.git("rev-parse", "HEAD", check=False).strip() or None

    def at(self, commit, rel):
        try:
            return self.git("show", f"{commit}:{rel}")
        except VaultError:
            return None  # the file did not exist there

    def touched(self, commit):
        return [line.split("\t")[-1] for line in self.git("show", "--name-status", "--no-renames", "--format=", commit).splitlines() if line]

    def revert(self, commit):
        """Undo one commit's content changes, file by file.

        Journal and conversations stay as they are. A file changed again after the
        commit is a conflict: nothing is touched and the learner is told."""
        self.commit("我的编辑", "me")
        touched = [rel for rel in self.touched(commit) if not rel.startswith(APPEND_ONLY)]
        before = {}
        for rel in touched:
            target = self.path(rel)
            now_text = target.read_text(encoding="utf-8", errors="replace") if target.exists() else None
            if now_text != self.at(commit, rel):
                raise VaultError(tr("这一步之后这些内容又被改过，没法自动撤销；可以手动改回去"))
            before[rel] = self.at(commit + "^", rel)
        for rel, content in before.items():
            if content is None:
                self.remove(rel)
            else:
                self.write_text(rel, content)
        if touched:
            self.commit("撤销：" + self.git("log", "-1", "--format=%s", commit).strip(), "me")
        return touched

    def _log(self, args, paths, keep):
        out = self.git("log", "-200", "--name-only", "--format=\x1e%H\x1f%aI\x1f%an\x1f%s", *args, "--", *paths, check=False)
        versions = []
        for block in out.split("\x1e")[1:]:
            head, _, names = block.partition("\n")
            commit, at, author, subject = head.split("\x1f")
            for path in (n for n in names.splitlines() if n):
                if keep(commit, path):
                    versions.append({"commit": commit, "at": at, "author": author, "subject": subject, "path": path})
                    break
        return versions

    def history(self, rel, ident=None):
        """Committed versions of a file, newest first.

        A file with an id is followed by that id: a retitled note moves to a new
        path and git cannot always tell that it is a rename."""
        if not ident:
            return self._log(["--follow"], [rel], lambda c, p: True)
        folder = rel.split("/", 1)[0]
        paths = {line for line in self.git("log", "--format=", "--name-only", "-G", f"^id: {re.escape(ident)}$", "--", folder, check=False).splitlines() if line}
        if not paths:
            return []
        return self._log([], sorted(paths), lambda c, p: p in paths and f"\nid: {ident}\n" in (self.at(c, p) or ""))
