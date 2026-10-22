"""Skills: a complete way of doing one kind of work, written down so any agent can follow it.

A skill is a folder with a SKILL.md (YAML attributes, then the instructions) and, if it needs them, more files
(templates, checklists, examples) that its instructions point to. The format is that of Anthropic's Agent Skills,
so a skill written for Claude can be imported as it is; Lattice reads a few more optional attributes.

The library ships in lattice/skills/. Installing copies a skill into the vault's skills/ folder, where it is the
learner's to edit, switch off or delete. Agents see only each enabled skill's name and one line on when to use it;
they read the full instructions with the skill tool when a request calls for one, or get them with the message when
the learner picks a skill for it.
"""
from __future__ import annotations

import re
from pathlib import Path

from .vault import join_frontmatter, split_frontmatter

SHIPPED = Path(__file__).with_name("skills")
FOLDER = "skills"
AGENTS = ("tutor", "flash", "coach", "organizer")
CATEGORIES = ("讲解思路", "课程与教程", "练习与评估", "复杂生产", "研究与阅读", "笔记与整理", "其他")
LIMIT_FILES, LIMIT_BYTES = 60, 4 * 1024 * 1024


def slug_of(text):
    s = re.sub(r"[^\w一-鿿-]+", "-", str(text).strip().lower()).strip("-")
    return s[:60] or "skill"


def _parse(folder, where):
    page = folder / "SKILL.md"
    try:
        attrs, body = split_frontmatter(page.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    agents = [a for a in (attrs.get("agents") or AGENTS) if a in AGENTS] or list(AGENTS)
    files = sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file() and p.name != "SKILL.md")[:LIMIT_FILES]
    return {"slug": folder.name, "name": str(attrs.get("name") or folder.name), "title": str(attrs.get("title") or attrs.get("name") or folder.name),
            "description": str(attrs.get("description") or "").strip(), "category": attrs.get("category") if attrs.get("category") in CATEGORIES else "其他",
            "agents": agents, "tags": [str(t) for t in (attrs.get("tags") or [])][:12], "version": int(attrs.get("version") or 1),
            "enabled": attrs.get("enabled", True) is not False, "where": where, "files": files, "body": body.strip()}


def shipped():
    return [s for s in (_parse(d, "shipped") for d in sorted(SHIPPED.iterdir()) if d.is_dir()) if s] if SHIPPED.is_dir() else []


def installed(root):
    base = Path(root) / FOLDER
    return [s for s in (_parse(d, "vault") for d in sorted(base.iterdir()) if d.is_dir()) if s] if base.is_dir() else []


def catalog(root):
    """The store: every shipped skill with whether and how it is installed, then the learner's own."""
    mine = {s["slug"]: s for s in installed(root)}
    out = []
    for s in shipped():
        own = mine.pop(s["slug"], None)
        state = "absent"
        if own:
            state = "update" if own["version"] < s["version"] else "changed" if own["body"] != s["body"] else "installed"
        out.append({**_brief(own or s), "shipped": True, "state": state, "enabled": bool(own and own["enabled"]), "latest": s["version"]})
    out += [{**_brief(s), "shipped": False, "state": "installed", "enabled": s["enabled"]} for s in mine.values()]
    return out


def _brief(s):
    return {k: s[k] for k in ("slug", "name", "title", "description", "category", "agents", "tags", "version", "files")}


def find(root, ref):
    """An installed skill by its folder name, its name or its title."""
    key = str(ref or "").strip().lower()
    for s in installed(root):
        if key in (s["slug"].lower(), s["name"].lower(), s["title"].lower()):
            return s
    raise ValueError("学习库里没有装这个技能：" + str(ref))


def for_agent(root, agent):
    return [s for s in installed(root) if s["enabled"] and agent in s["agents"]]


def prompt_section(root, agent):
    """What an agent knows of the skills each turn: names and when to use them, not the instructions."""
    skills = for_agent(root, agent)
    if not skills:
        return ""
    lines = "\n".join(f"- {s['name']}（{s['title']}）：{s['description']}" for s in skills)
    return ("# 技能\n学习库里装了下面这些技能，每个是做某一类事的完整做法。学习者的请求正好是某个技能管的事时，先用 skill 读它的完整说明，"
            "再照着做（说明里提到的附带文件用 skill 的 file 读）；学习者点名用某个技能时一定要用。不相干时不用，也不要为了用而用。\n" + lines)


def instructions(skill):
    extra = ("\n\n这个技能附带的文件（用 skill 工具的 file 参数读）：" + "、".join(skill["files"])) if skill["files"] else ""
    return f"# 技能：{skill['title']}（{skill['name']}）\n\n{skill['body']}{extra}"


def install(vault, slug):
    source = SHIPPED / slug
    if not (source / "SKILL.md").is_file():
        raise ValueError("商城里没有这个技能：" + str(slug))
    return _copy(vault, source, slug, replace=True)


def _copy(vault, source, slug, replace=False):
    files = [p for p in source.rglob("*") if p.is_file() and not p.name.startswith(".")]
    if len(files) > LIMIT_FILES or sum(p.stat().st_size for p in files) > LIMIT_BYTES:
        raise ValueError(f"一个技能最多 {LIMIT_FILES} 个文件、共 4MB")
    target = f"{FOLDER}/{slug}"
    if vault.path(target).exists():
        if not replace:
            raise ValueError("已经有一个叫「" + slug + "」的技能了")
        vault.remove(target)
    for p in files:
        vault.write_bytes(f"{target}/{p.relative_to(source).as_posix()}", p.read_bytes())
    return target


def import_folder(vault, folder):
    """A skill folder from this computer, Claude's or anyone's: it needs a SKILL.md."""
    source = Path(folder).expanduser()
    if not (source / "SKILL.md").is_file():
        raise ValueError("这个文件夹里没有 SKILL.md，不是一个技能")
    skill = _parse(source, "import")
    return _copy(vault, source, slug_of(skill["name"] if skill else source.name))


def uninstall(vault, slug):
    target = f"{FOLDER}/{Path(str(slug)).name}"
    if not vault.path(target).is_dir():
        raise ValueError("没有装这个技能")
    vault.remove(target)
    return True


def set_enabled(vault, slug, on):
    rel = f"{FOLDER}/{Path(str(slug)).name}/SKILL.md"
    attrs, body = split_frontmatter(vault.read_text(rel))
    attrs["enabled"] = bool(on)
    vault.write_text(rel, join_frontmatter(attrs, body))
    return bool(on)


TEMPLATE = """# 什么时候用
（一两句话：学习者说了什么、在做什么的时候，该照这个技能来做。）

# 做法
1. （第一步做什么，为什么这样做）
2. （……）

# 在 Lattice 里怎么落地
- （用哪些工具：read、list、graph、route、save_knowledge、write、run、start_practice……产出放在哪里）

# 产出
- （做完以后学习库里多了什么、回复里给学习者看什么）

# 不要
- （这个技能里容易犯的错）
"""


def create(vault, title, description="", category="其他", agents=AGENTS, body=""):
    slug = slug_of(title)
    target = f"{FOLDER}/{slug}"
    if vault.path(target).exists():
        raise ValueError("已经有一个叫「" + slug + "」的技能了")
    attrs = {"name": slug, "title": str(title).strip()[:60], "description": str(description).strip()[:400] or "（写一句：什么时候该用它）",
             "category": category if category in CATEGORIES else "其他", "agents": [a for a in agents if a in AGENTS] or list(AGENTS), "version": 1}
    vault.write_text(f"{target}/SKILL.md", join_frontmatter(attrs, (body or TEMPLATE).strip() + "\n"))
    return f"{target}/SKILL.md"


def file_of(root, skill, name):
    folder = (Path(root) / FOLDER / skill["slug"]).resolve()
    path = (folder / str(name)).resolve()
    if not path.is_relative_to(folder) or not path.is_file():
        raise ValueError("这个技能里没有这个文件：" + str(name))
    return path.read_text(encoding="utf-8", errors="replace")[:200_000]
