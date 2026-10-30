"""Agents are configuration: a policy, a tool set and how much history each one sees.

Each agent ships as lattice/agents/<name>.md (YAML attributes, then the policy).
A file with the same name in the vault's agents/ folder replaces it, so the
learner can rewrite how an agent works without touching Lattice. The shipped
text it was made from is kept beside it (agents/.shipped/<name>.md), so a newer
Lattice's rules reach it with the learner's changes still in them. Every turn
starts with the vault's AGENTS.md, so all agents follow the same rules, and
what they have noted about the learner in me.md.
"""
from __future__ import annotations

from difflib import SequenceMatcher
from pathlib import Path

from . import skills
from .vault import ME, join_frontmatter, split_frontmatter

HERE = Path(__file__).with_name("agents")
NAMES = ("tutor", "flash", "coach", "organizer", "builder")

# Buttons that ask the tutor to work a certain way this turn: the learner's words, and how to work.
TASKS = {
    "capture": ("把我们讨论过的内容整理成知识卡。",
                "把我们实际讨论过、而且我已经接触到的知识用 save_knowledge 存成知识卡和关系；情境相关的经验存成经验文档。不要补写没讨论过的内容，也不要替我写理解。"),
    "practice_review": ("我刚结束了一次练习，请复盘并决定接下来怎么讲。",
                        "请依次：\n"
                        "1. 我实际做到了什么。只依据记录里的证据（练习文件的最终内容、运行记录、对话），没运行过的不算。\n"
                        "2. 我的薄弱点：具体到概念或技能，每一条都说明证据，例如哪一步卡住、错在哪里、要了几次提示。没有就说没有，不要硬凑。\n"
                        "3. 据此决定接下来怎么讲：先补什么、哪里换一种讲法，然后直接开始讲下一步。\n"
                        "复盘的结论用 finish_practice_review 记下（这一步必须做；这里记的薄弱点不要再用 insight 重复记），顺手更新主题档案。"),
}
PRACTICE_TASKS = {
    "start": "开始练习。",
    "check": "我写好了，帮我看看我的代码和运行结果。",
    "hint": "我卡住了，给我一点提示，先别直接给答案。",
}


def load(vault_root, name):
    return parse(name, source(vault_root, name))


def source(vault_root, name):
    """The rules file an agent works by now: the learner's version in the vault, or else the shipped one."""
    if name not in NAMES:
        raise ValueError("未知的 AI：" + str(name))
    own = Path(vault_root) / "agents" / f"{name}.md"
    return (own if own.is_file() else HERE / f"{name}.md").read_text(encoding="utf-8")


def shipped(name):
    return source(Path("/nonexistent"), name)


def parse(name, text):
    """An agent's definition from the text of a rules file; a file whose attributes cannot be read is refused."""
    try:
        attrs, policy = split_frontmatter(text)
    except ValueError as exc:
        raise ValueError("规则文件开头的属性写坏了：" + str(exc)) from None
    if not isinstance(attrs.get("tools", []), list):
        raise ValueError("规则文件开头的 tools 要是一个列表")
    # blocks: true (every kind of block), brief (only what a short answer uses) or false.
    blocks = attrs.get("blocks", True)
    return {"name": name, "title": attrs.get("title", name), "history": int(attrs.get("history", 12)), "blocks": blocks if blocks == "brief" else bool(blocks),
            "tools": list(attrs.get("tools") or []), "policy": policy.strip()}


def system_prompt(vault_root, agent, extra=""):
    rules, me = Path(vault_root) / "AGENTS.md", Path(vault_root) / ME
    known = [line for line in me.read_text(encoding="utf-8").splitlines() if line.startswith("- ")] if me.is_file() else []
    parts = [rules.read_text(encoding="utf-8").strip() if rules.is_file() else "",
             ("# 关于学习者\n\n记下的、换个主题也成立的事（me.md，用 remember 增改）：\n" + "\n".join(known)) if known else "", agent["policy"]]
    if agent["blocks"]:
        parts.append((HERE / ("blocks-brief.md" if agent["blocks"] == "brief" else "blocks.md")).read_text(encoding="utf-8").strip())
    if "skill" in agent["tools"]:
        parts.append(skills.prompt_section(vault_root, agent["name"], "skill_edit" in agent["tools"]))
    if extra:
        parts.append(extra.strip())
    return "\n\n---\n\n".join(p for p in parts if p)


def task_prompt(message, task):
    """The learner's words plus, for a task button, how to work this turn."""
    return message + ("\n\n（本次工作方式：" + TASKS[task][1] + "）" if task in TASKS else "")


def save(vault, name, history, tools, policy, blocks=True):
    """The learner's own version of an agent: agents/<name>.md in the vault replaces the shipped one."""
    base = load(vault.root, name)
    # The settings only say on or off: a brief set of blocks stays brief while it is on.
    blocks = base["blocks"] if bool(base["blocks"]) == bool(blocks) else bool(blocks)
    attrs = {"title": base["title"], "history": max(0, min(int(history), 200)), "blocks": blocks, "tools": [str(t) for t in tools]}
    vault.write_md(f"agents/{name}.md", attrs, str(policy).strip())
    keep_shipped(vault, name)
    return f"agents/{name}.md"


def reset(vault, name):
    load(vault.root, name)
    rel = f"agents/{name}.md"
    if vault.path(rel).exists():
        vault.remove(rel)
    if vault.path(_kept(name)).exists():
        vault.remove(_kept(name))
    return rel


def overridden(vault_root, name):
    return (Path(vault_root) / "agents" / f"{name}.md").is_file()


def _kept(name):
    return f"agents/.shipped/{name}.md"


def keep_shipped(vault, name):
    """Note the shipped rules a learner's version now stands on."""
    vault.write_text(_kept(name), shipped(name))


def _merged_policy(base, own, now):
    """The learner's changes to `base`, made again on `now`. What no longer has a place there goes at the end."""
    old_lines, own_lines, out, left = base.split("\n"), own.split("\n"), now.split("\n"), []
    def at(lines):
        return next((i for i in range(len(out) - len(lines) + 1) if out[i:i + len(lines)] == lines), None)
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, old_lines, own_lines, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        old, new = old_lines[i1:i2], own_lines[j1:j2]
        if new and at(new) is not None:
            continue    # the shipped rules say this now too
        found = at(old) if old else (0 if i1 == 0 else at(old_lines[i1 - 1:i1]))
        if found is None:
            left += new
        elif old:
            out[found:found + len(old)] = new
        else:
            out[found + (1 if i1 else 0):found + (1 if i1 else 0)] = new
    return "\n".join(out + [line for line in left if line.strip() and line not in out]).strip()


def merged(base, own, now):
    """A learner's rules on newer shipped ones: what they changed from `base` stays, the rest becomes `now`."""
    base_attrs, base_policy = split_frontmatter(base)
    own_attrs, own_policy = split_frontmatter(own)
    attrs, policy = split_frontmatter(now)
    for key, value in own_attrs.items():
        if key != "tools" and value != base_attrs.get(key):
            attrs[key] = value
    was, mine = base_attrs.get("tools") or [], own_attrs.get("tools", base_attrs.get("tools")) or []
    attrs["tools"] = [t for t in attrs.get("tools") or [] if t in mine or t not in was] + [t for t in mine if t not in was and t not in (attrs.get("tools") or [])]
    return join_frontmatter(attrs, _merged_policy(base_policy, own_policy, policy))


def follow_shipped(vault, first_before):
    """Bring each rewritten agent up to the shipped rules. first_before(rel) is the file before its first approved change,
    for a version made before the shipped text was kept beside it; without one it counts from the rules as they are now."""
    changed = []
    for name in NAMES:
        rel = f"agents/{name}.md"
        if not vault.path(rel).is_file():
            continue
        now, kept = shipped(name), vault.path(_kept(name)).is_file()
        base = vault.read_text(_kept(name)) if kept else first_before(rel) or now
        if base != now:
            vault.write_text(rel, merged(base, vault.read_text(rel), now))
            changed.append(rel)
        if base != now or not kept:
            keep_shipped(vault, name)
    return changed
