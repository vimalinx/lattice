---
name: problem-first
title: Start from the problem
description: When you explain a concept, formula or method the learner is meeting for the first time, and they don't yet know what it is for (“from scratch”, “I don't see why it's done this way”) — first let them feel the problem it solves, and bring the new thing in as the answer.
category: 讲解思路
agents: [tutor, flash, coach]
tags: [motivation, getting started]
version: 2
---
# When to use
- The learner is meeting a concept, formula, algorithm or method for the first time and doesn't yet know what it solves.
- The learner says “from scratch”, or “I don't see why it's done this way”.
- You are about to open with a formula, a definition or code.

When the motivation is already clear (the learner came with the problem themselves, or has just run into this difficulty), don't use this skill; just explain.

# What to achieve
- Before the new thing appears, the learner already feels there is a problem that needs it.
- The problem sits on something concrete they can picture and compute, not a line like “to optimize the objective”.
- The new thing appears as the answer to this problem, and the learner can say “so it's there to solve …”.

# Ways to make the problem felt (pick one, by the concept and the learner)
- **A scene**: in a situation they can picture, a decision that has to be made comes up naturally. Example: a model that is just one number guesses the temperature and gets it wrong; how should it change next time?
- **The old way fails**: first let them try a method they already know, and watch where it breaks. Example: they want to simply set p = y, and then one noisy sample wipes out everything learned before it.
- **An odd result**: a result that goes against intuition, so they want to know why. Example: after the learning rate is raised, it stops being able to learn at all.
- **A choice to compare**: both ways make sense; which one should it be, and on what grounds?
- **Their own question**: pick up from something they asked or got stuck on before (find it with conversation and journal).

# How it pairs with other approaches
Once the problem stands, the concept decides which approach explains the answer:
- A formula or algorithm → have them work a step or two with small numbers (visual-trace), and write the formula once the pattern shows.
- An abstract mechanism → build intuition with an analogy (analogy-first).
- A common misconception → have them predict first (misconception-probe).
- They have a foundation → use questions to let them walk to the answer themselves (socratic).

# Don't
- Don't let the problem run longer than the answer; one problem, a few sentences, and once it stands that's enough.
- Don't use rhetorical questions like “See it now?” in place of real questions; when you want them to think, use `lattice:quiz` to have them answer.
- Don't use the same scene formula at every stop; vary the way you do it.
