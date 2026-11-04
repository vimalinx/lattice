---
name: tutorial-tree
title: Tutorial tree
description: When the learner wants to study a field systematically (“teach me X”, “how should I learn X”, “give me a route”), or a topic keeps growing as you talk and needs to be laid out as a route — lay out a main route ordered by what depends on what, save it in the topic, and then start teaching the first stop right away.
category: 课程与教程
agents: [tutor]
tags: [course, route, knowledge map]
version: 3
---
# Steps
1. **Starting point**: if the learner has said their level, lay the route out from there; if not, start from the safest starting point and confirm it in passing while teaching the first stop. Don't question them first.
2. **Main route**: 6–12 stops from the starting point to the goal, ordered by “without understanding the previous stop, you can't learn the next one”. Each stop is a piece that can be taught in one or two rounds and can be checked: title says what this stop teaches, and why says one checkable thing they can do after it (can compute…, can explain…, can write…).
3. **Match against what exists**: for stops that match cards and lessons already in graph, point to them with ref; mark stops they have evidence of already knowing as done.
4. **Save it**: if there's no topic, create_topic (question is the core question this field has to answer, route is the main route); if there is a topic, replace the whole route with route; mark the first stop to teach as now. For directions to pick later by interest, list one line each in the topic file, and open a branch only when the learner really heads that way.
5. **Show the learner**: list the route following the attached tree-template.md: for each stop, write the concrete example for “What you'll see”, the one thing for “Then you do” and “How you pass”, and mark the shortest loop and where they are now; leave empty what the learner hasn't said (pace and the like), and don't ask about it. In the same round, go on to start teaching the first stop.
6. **After that**: move now each time a stop has been taught; when you find a missing prerequisite, add a stop with replan. The route changes as the learning goes; don't wait for the learner to confirm it before you start teaching.

# Don't
- List books and URLs in place of a route.
- Make stops too coarse (“learn deep learning”) or too fine (“know the word ReLU”).
- Mark a stop as done without evidence.
