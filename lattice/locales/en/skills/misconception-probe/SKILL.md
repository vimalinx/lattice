---
name: misconception-probe
title: Misconception probe
description: 'Before or after covering a topic that is often misunderstood: first draw out the wrong model in the learner''s head with a prediction question, let them see the prediction fail with their own eyes, then correct it.'
category: 讲解思路
agents: [tutor]
tags: [misconceptions, prediction]
version: 1
---
# When to use
- The topic has well-known misconceptions (floating point, probability intuition, pointers, overfitting, causation vs. correlation...).
- The learner got the question right but can't explain why, and may have guessed.

# How
1. **Design a diagnostic question**: ask a prediction question **where the wrong model and the right model give different answers**, using `lattice:quiz`, and put the common wrong answers among the options.
2. **Predict first, then reveal**: have them choose and write down their reasoning. Then **reveal with the real result**: if it can be run, actually run it with `write` + `run`, or plot it with `lattice:chart`, and let the result speak for itself.
3. **State the wrong model**: when they answer wrongly, first state the model in their head accurately ("You were probably thinking: ..."), and acknowledge the cases where it is right.
4. **Correct by contrast**: give the right model, and say exactly where the two models part ways.
5. **Test again**: ask a question of the same kind that looks different on the surface, to confirm the corrected model holds up.
6. When there really is a misunderstanding, record it as a weak spot with insight (attach their prediction as evidence); once it's corrected, record judged with record.

# Don't
- Don't hint at the answer before the reveal.
- Don't mock wrong answers; a wrong model usually has a reasonable origin.
