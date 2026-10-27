"""Agents are configuration: a policy, a tool set and how much history each one sees.

Each agent ships as lattice/agents/<name>.md (YAML attributes, then the policy).
A file with the same name in the vault's agents/ folder replaces it, so the
learner can rewrite how an agent works without touching Lattice. Every turn
starts with the vault's AGENTS.md, so all agents follow the same rules, and
what they have noted about the learner in me.md.
"""
from __future__ import annotations

from pathlib import Path

from . import skills
from .vault import ME, split_frontmatter

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
    tools = list(attrs.get("tools") or [])
    # Every agent can read the skills it is given, and propose changes to them and to the agents' rules, whatever its
    # own tool list says.
    return {"name": name, "title": attrs.get("title", name), "history": int(attrs.get("history", 12)),
            "blocks": bool(attrs.get("blocks", True)), "tools": tools + [t for t in ("skill", "skill_edit", "rules_edit") if t not in tools], "policy": policy.strip()}


def system_prompt(vault_root, agent, extra=""):
    rules, me = Path(vault_root) / "AGENTS.md", Path(vault_root) / ME
    known = [line for line in me.read_text(encoding="utf-8").splitlines() if line.startswith("- ")] if me.is_file() else []
    parts = [rules.read_text(encoding="utf-8").strip() if rules.is_file() else "",
             ("# 关于学习者\n\n记下的、换个主题也成立的事（me.md，用 remember 增改）：\n" + "\n".join(known)) if known else "", agent["policy"]]
    if agent["blocks"]:
        parts.append((HERE / "blocks.md").read_text(encoding="utf-8").strip())
    parts.append(skills.prompt_section(vault_root, agent["name"]))
    if extra:
        parts.append(extra.strip())
    return "\n\n---\n\n".join(p for p in parts if p)


def task_prompt(message, task):
    """The learner's words plus, for a task button, how to work this turn."""
    return message + ("\n\n（本次工作方式：" + TASKS[task][1] + "）" if task in TASKS else "")


def save(vault, name, history, tools, policy, blocks=True):
    """The learner's own version of an agent: agents/<name>.md in the vault replaces the shipped one."""
    base = load(vault.root, name)
    attrs = {"title": base["title"], "history": max(0, min(int(history), 200)), "blocks": bool(blocks), "tools": [str(t) for t in tools]}
    vault.write_md(f"agents/{name}.md", attrs, str(policy).strip())
    return f"agents/{name}.md"


def reset(vault, name):
    load(vault.root, name)
    rel = f"agents/{name}.md"
    if vault.path(rel).exists():
        vault.remove(rel)
    return rel


def overridden(vault_root, name):
    return (Path(vault_root) / "agents" / f"{name}.md").is_file()
