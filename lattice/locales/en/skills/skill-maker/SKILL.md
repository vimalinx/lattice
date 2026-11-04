---
name: skill-maker
title: Write and revise skills
description: When you need to create or change a skill, or to sort out how several skills divide the work — the learner says “save this approach as a skill”, “do it this way from now on”, “this skill doesn't work well”, “it's unclear which of these skills does what”, or you followed a skill and found that its approach went wrong in this conversation. First see clearly how all the skills divide the work, then decide which one to change and how; propose it with skill_edit, and it takes effect only after the learner has reviewed it.
category: 其他
agents: [tutor, flash]
tags: [skill, meta-skill]
version: 2
---
# First decide where it belongs
When the learner says “always do it this way”, first work out where the request should land:
- About the learner themselves, and true on any other topic too (what they know, how they learn best) → note it with remember; don't write it as a skill.
- A way of working that one AI must keep to every turn (how long replies are, conclusion first and then detail) → change that AI's rules with rules_edit.
- The complete method for a kind of task (how to introduce a new concept, how to read a paper, how to draw up a plan) → a skill.

# Before you start: see how the work is divided
1. List all skills with list (kind=skills), pick out the few whose description touches on this matter, and read them in full with skill.
2. Decide whether to change or to create:
   - An existing skill covers this → change it; don't create a new one.
   - Two skills both claim the same situation → change their descriptions, and settle which goes first and when the other takes over; keep a repeated method in one place only, and in the other place write “follow ‘X’”.
   - Truly no skill covers it → create one.
3. Check the division: think of two or three things the learner would really say, and for each one ask “which skill would this make the AI choose?” Each one should make exactly one skill be chosen first.

# Writing a skill well
- **The description is the trigger.** The AI decides whether to use the skill from this one sentence alone, so write concrete situations and the words the learner would actually say; where it's easy to confuse with a neighboring skill, add a line “When …, don't use this; use ‘X’”. Don't write how good it is.
  Example (a pair with a clear division): paper-reading's says “When the learner wants to understand a paper…”; research-survey's says “When you need a picture of an unfamiliar field as a whole…”. A request to read just one paper will only choose the first.
- **Body structure**: When to use (and when not to) → What to achieve (results that can be checked) → Steps (numbered, each saying which tool to use and where the output goes) → How it pairs with other skills (names only, without copying their methods) → Don't (mistakes that really happened).
- **Short.** Keep the body under about 1,000 words; the shorter the better. Put long templates, checklists and examples in attached files, and write “follow the attached xx.md” in the body.
- **One complete small example beats ten rules.** Wherever the AI can be made to choose from a few options, don't leave it to improvise.
- In agents, keep only the AIs that will really use it (tutor is the Tutor, flash is Quick answer, coach is the Practice coach, organizer is the Organizer); choose category from these fixed values, written exactly as shown: 讲解思路 (explanation approaches) / 课程与教程 (courses and tutorials) / 练习与评估 (practice and assessment) / 复杂生产 (complex production) / 研究与阅读 (research and reading) / 笔记与整理 (notes and organizing) / 其他 (other).
- Don't write one-off specifics (the route of a particular topic, the details of a particular conversation); a skill is a method used again and again.

# Changing a skill
- **Change only with evidence.** Say which conversation, which step, and what went wrong (find it with conversation and journal), and state it in one sentence in why. Don't change anything on a feeling alone.
- **Change from the current full text.** First read its current full text with skill: the version in the vault may carry changes the learner has approved, so don't overwrite it with the original from the skill store, and don't rewrite parts that had no problem while you're at it. For small changes, use edits.
- **Look at the attached files too.** Change the templates and checklists the body cites along with it, and remove references that are no longer used.
- **Don't touch version.** The skill store uses it to show “a new version is available”; changing a skill in the vault doesn't need it changed.

# Proposing
- Propose with skill_edit, not with write or edit. When creating, new is true and content is the complete SKILL.md; the properties at the top must include name (a short English name), title, description, category and agents.
- In questions, give two or three things the learner would really say, chosen so that the versions before and after the change answer them differently; the learner clicks one to compare the two versions.
- In your reply, say clearly which skill you changed and why, and how its division of work with which other skills has changed.

# Don't
- Don't create another skill for something an existing skill covers.
- Don't let two skills' descriptions both match the same sentence without saying which goes first.
- Don't copy another skill's method into this one; write its name, and let the AI read it.
