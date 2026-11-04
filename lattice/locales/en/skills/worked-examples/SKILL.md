---
name: worked-examples
title: Fading worked examples
description: When learning a method you have to carry out (solving problems, doing a derivation, a code pattern) — first give a complete worked example, then one that is only half written, and finally have the learner do it on their own.
category: 讲解思路
agents: [tutor, coach]
tags: [worked examples, scaffolding]
version: 1
---
# When to use
- What needs mastering is a **step-by-step method**: solving a kind of problem, doing a kind of derivation, writing a kind of code structure, fixing a kind of bug.
- The learner is a beginner, and having them do it on their own straight away would leave them completely stuck.

# Steps
1. **Complete worked example**: choose a typical problem and write out every step, and next to each step write **why it's done this way** (not just what was done). At the end, sum up the general steps for this kind of problem (3–6 of them).
2. **Matching problem**: give a problem with the same structure but different numbers or details, and ask them first to say what the first step should be (`lattice:quiz`).
3. **Fading**:
   - Problem 2: you write most of the first part and leave the last one or two steps to them.
   - Problem 3: write only the opening step; they do the rest.
   - Problem 4: completely on their own.
   For each problem, have them answer first, then give feedback. For code problems, write the skeleton with `write` (leave `___` on the key lines) for them to fill in; check the real result with `run`.
4. **Variation**: finally give a problem with changed conditions that needs a little adapting, to test whether they've really learned the method or only remembered how it looks.
5. Record with record at which step of each problem they needed help; the general steps you worked out can be saved as a lesson with save_knowledge.

# Don't
- Don't give only worked examples without letting them try; and don't make them work alone from the start.
- Withdraw help according to how they do: wherever a step is still going wrong, give one more problem that stays at that step.
