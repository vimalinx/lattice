"""Agents are configuration: a policy, a tool set and how much history each one sees.

Each agent ships as lattice/agents/<name>.md (YAML attributes, then the policy).
A file with the same name in the vault's agents/ folder replaces it, so the
learner can rewrite how an agent works without touching Lattice. Every turn
starts with the vault's AGENTS.md, so all agents follow the same rules.
"""
from __future__ import annotations

from pathlib import Path

from .vault import split_frontmatter

HERE = Path(__file__).with_name("agents")
NAMES = ("tutor", "flash", "coach", "organizer")

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
    if name not in NAMES:
        raise ValueError("未知的 AI：" + str(name))
    own = Path(vault_root) / "agents" / f"{name}.md"
    source = (own if own.is_file() else HERE / f"{name}.md").read_text(encoding="utf-8")
    attrs, policy = split_frontmatter(source)
    return {"name": name, "title": attrs.get("title", name), "history": int(attrs.get("history", 12)),
            "blocks": bool(attrs.get("blocks", True)), "tools": list(attrs.get("tools") or []), "policy": policy.strip()}


def system_prompt(vault_root, agent, extra=""):
    rules = Path(vault_root) / "AGENTS.md"
    parts = [rules.read_text(encoding="utf-8").strip() if rules.is_file() else "", agent["policy"]]
    if agent["blocks"]:
        parts.append((HERE / "blocks.md").read_text(encoding="utf-8").strip())
    if extra:
        parts.append(extra.strip())
    return "\n\n---\n\n".join(p for p in parts if p)


def task_prompt(message, task):
    """The learner's words plus, for a task button, how to work this turn."""
    return message + ("\n\n（本次工作方式：" + TASKS[task][1] + "）" if task in TASKS else "")
