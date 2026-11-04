---
name: problem-set
title: Graded problem set
description: After a point has been learned and needs consolidating or checking — set a group of problems that go from easy to hard and cover different levels of ability, work through them one at a time, and adjust the difficulty to how the learner does.
category: 练习与评估
agents: [tutor, coach]
tags: [practice, setting problems]
version: 1
---
# When to use
- “Give me a few problems”, “I want some practice”.
- A stop has just been taught, and you need to confirm how well it has been mastered.

# Steps
1. **Set problems by level** (5–8 in a set):
   - Recall and recognition (1, as a warm-up)
   - Understanding: explain why, predict the result (2)
   - Application: use it in a new situation (2)
   - Analysis or synthesis: find the error, compare approaches, combine several concepts (1–2)
   - In fields with code, at least one “read the code and predict the output” and one “write a short piece of code”.
2. **One at a time**: set each problem with `lattice:quiz` (for multiple choice, include wrong options with diagnostic value), wait for the learner's answer before giving feedback, and don't give the answer early.
3. **Feedback**: when they're right, say what makes it right; when they're wrong, first point out which step went wrong and what misconception is behind it, then give the correct method. For code problems, run the learner's answer with run to see the real result.
4. **Adjust as you go**: when they keep answering correctly, skip the remaining problems at that level and move up; when they get two wrong at the same level, explain it another way to fill the gap (you can use worked-examples), then set another problem at the same level.
5. **Wrap up**: summarize how they did at each level. Log judged with record; note points they keep getting wrong as weak spots with insight; save problems and key points worth reviewing as cards with save_knowledge (put the problem in the question field).

# Don't
- Don't throw out all the problems at once.
- Don't pad the set with problems that only test rote memory.
