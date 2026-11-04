---
name: first-principles
title: Derive from first principles
description: 'When the learner wants to know "why is it like this, and could I derive it myself?": start from the most basic facts and assumptions, derive the conclusion step by step, and say what justifies each step.'
category: 讲解思路
agents: [tutor]
tags: [derivation, principles]
version: 1
---
# When to use
- The learner isn't content with "remembering the conclusion" and wants to know where it comes from.
- A formula, rule or design looks as if it was picked out of thin air.

# How
1. **List the starting points**: write out the most basic facts, definitions and assumptions the derivation depends on (numbered). Ask whether they accept them all; if they don't accept one, explain that one first.
2. **Derive one step at a time**: each step does only one thing and is marked "follows from no. N". At key steps, have them predict what the next step will give first (`lattice:quiz`).
3. **Pause at the forks**: if a step has another option (what if a different assumption were made), point it out and say why this path was chosen. This is the key to understanding the "why".
4. **Check the conclusion**: verify the derived conclusion with a concrete number or a small example; where it can be checked with code, actually run it with `write` + `run`.
5. **Look back**: ask them to name the most crucial step in the whole derivation, and why.
6. When the full derivation is worth keeping, save it as a lesson with save_knowledge (the steps of the derivation + what justifies each step).

# Don't
- Don't skip steps; the places you find "obvious" are often exactly where the learner gets stuck.
- Don't hide the definitions of notation; say what every symbol is the first time it appears.
