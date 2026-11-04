---
name: tutorial-production
title: Full tutorial pipeline
description: When the learner wants to make a whole tutorial series or course (to study systematically themselves, or to make for others) — produce it in phases (positioning, tutorial tree, the lesson for each chapter, verified code and examples, exercises, read-through and revision, table of contents), with checkpoints along the way, carried on across several conversations.
category: 复杂生产
agents: [tutor]
tags: [tutorial, course, long-term project]
version: 1
---
# When to use
- “Make me a complete tutorial on X”, “Turn this topic into a course”, “Write a series that goes from zero to one”.
- The output has to be systematic, span several chapters and be reusable, and can't be finished in one conversation.

# Phases
1. **Positioning** ⏸ Checkpoint: who the readers are (what they know, what they don't), what they can do when they finish, the length (how many chapters, how long each), the form (lesson + code + exercises?), and the style. Write these into the progress file's “Goal/Scope/Constraints”.
2. **Tutorial tree** ⏸ Checkpoint: following the tutorial-tree skill, break the material into a chapter tree (main route = chapters, branches = optional chapters), and for each chapter state what you can do after it and how that is checked. Lay it down as a topic and route with create_topic / route (one stop per chapter).
3. **Chapter outlines** ⏸ Checkpoint: for each chapter, list its sections, each section's core concepts, the examples to use, the approaches to use (see feynman, analogy-first, worked-examples, visual-trace), and the design of the chapter's exercises. Write it into the progress file.
4. **Write each chapter** (one round per chapter; each finished chapter is a checkpoint):
   - Write the chapter following lesson-writer's structure;
   - Put every piece of code into `code/<project name>/chapter-N/` with write first, really run it with run, and paste the output into the lesson; if it doesn't run, fix it until it does — code that hasn't been run must not go into the tutorial;
   - Save it as a lesson with save_knowledge's lessons, titled “Chapter N · <chapter name>”; point this stop's ref to it with route;
   - Save the chapter's core points as cards with save_knowledge (to card-distill's standard).
5. **Exercises**: 3–6 graded exercises per chapter (the levels of problem-set), with answers and explanations folded inside `<details>`, appended to the end of the chapter's lesson; design hands-on ones as practices that can be opened with start_practice, and write the practice goal in the lesson.
6. **Read-through and revision** ⏸ Checkpoint: read all the chapters through once with read, and check:
   - whether terms are consistent from start to finish and notation is uniform;
   - whether each chapter uses only concepts taught in earlier chapters (when you find a forward reference, change the order or add a section);
   - whether the difficulty curve is smooth; whether examples repeat;
   - that all code has been run (it's in the progress file's verification log).
   List the problems for the learner, and once they confirm, fix them one by one (edit).
7. **Table of contents**: with save_knowledge's lessons, write “<tutorial name> · Contents”: an introduction, who it's for, how to use it, one sentence + [[link]] per chapter, and a prerequisite diagram (mermaid). Use update_topic to write the tutorial's status into the topic file.

# Progress file (used by all complex production)
Complex production spans several conversations and is carried on through one progress file:
- **At the start**: with save_knowledge's notes (folder “生产/<project name>”), create a note “<project name> · 进度”, written from the attached progress-template.md: the goal, the list of phases (`- [ ]`), the output path of each phase, decisions already made, and questions waiting for the learner to confirm.
- **Each time a phase is done**: tick it with edit, and write down the output's path, the decisions made in this phase, and the verification results.
- **Each time you pick it up again**: first find the progress file with search or list notes and read it, then continue from the first unticked phase; tell the learner “where we got to last time, and what we're doing this time”.
- **Checkpoints**: when a phase marked “⏸ Checkpoint” is done, stop, show the learner the output, and wait for them to approve or change it before going on to the next phase. Don't run through all the phases in one go.

# Don't
- Don't generate all the chapters at once; make each chapter, verify each chapter and show each chapter to the learner, one at a time.
- Don't include code that hasn't been run or facts that haven't been checked; mark what you're unsure of and write it into “To confirm with the learner”.
- Don't let later chapters silently depend on things the earlier chapters haven't taught.
