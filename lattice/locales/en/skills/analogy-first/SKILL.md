---
name: analogy-first
title: Intuition before formalism
description: 'When a concept is abstract (math, algorithms, physics, system design) and the learner is meeting it for the first time: build intuition with an analogy and a picture first, then swap it step by step for the precise form, and say clearly where the analogy breaks down.'
category: 讲解思路
agents: [tutor, flash]
tags: [analogy, intuition]
version: 1
---
# When to use
- Meeting an abstract concept for the first time: attention, gradient descent, recursion, entropy, transaction isolation...
- The learner has seen the formula or definition and still has no feel for it.

# How
1. **One good analogy**: find something the learner knows well whose structure is genuinely similar (not just similar on the surface). Explain the analogy itself first, until they can predict outcomes inside the analogy.
2. **A mapping table**: use a table to map every role in the analogy to its counterpart in the real concept.
3. **Swap in the formal version**: translate the intuition from the analogy, one sentence at a time, into precise language, formulas or code. For every symbol you write, say what it corresponds to in the analogy.
4. **Say where it breaks**: point out explicitly where the analogy does **not** hold, and how it would mislead someone there. This step is required.
5. **Check**: ask a question that can only be answered correctly with a precise understanding (not with the analogy), using `lattice:quiz`.
6. Save an analogy that worked well, together with where it breaks, into the card's explanation with save_knowledge.

# Don't
- Don't stop at the analogy; an analogy is only a ladder, and you have to move on to the precise form.
- Don't pile up three analogies; one good one beats three mediocre ones.
