---
name: codebase-tour
title: Codebase tour
description: 'When the learner wants to understand an unfamiliar codebase (a project in a mounted folder, an open-source project): work in stages (the big-picture map, the entry point and main flow, the core data structures, a close reading of the key modules one by one, a hands-on change to check understanding) and produce a set of tour notes.'
category: 复杂生产
agents: [tutor]
tags: [code, reading, project]
version: 1
---
# When to use
- "Help me understand this project", "how does this library work?", "I want to contribute code to this project".
- The code is in the vault or in a mounted folder (mounted folders are read-only; look with read, and with rg and ls in shell).

# Stages
1. **The big picture**: use shell (ls, rg, wc, git log) to look at the directory structure, languages, size, dependencies, and the places that changed most recently. Draw a module relation diagram (mermaid), with one sentence for what each module does.
2. **Entry point and main flow** ⏸ checkpoint: find the program's entry point (main, CLI, service startup, test entry point), trace the call chain along the most typical use case, and draw it as a sequenceDiagram; point the learner to the source of key functions with `lattice:excerpt`.
3. **Core data structures**: find the few data structures or classes that run through the whole thing, and explain what each field means, who creates it and who modifies it.
4. **Close reading, one at a time** (one round per key module): explain its responsibility, its interface, the main points of its internal implementation, and its contracts with other modules; ask the learner to predict how some function behaves for some input, then verify with run (if it can run).
5. **Hands-on check** ⏸ checkpoint: design a small change (add a print, change a behavior, write a test); the learner makes it in their own copy and runs it, to confirm their understanding is right. Mounted folders are read-only, so put changes in a copy under `code/<project name>/` or in a notebook.
6. **Tour notes**: with save_knowledge's notes (folder `生产/<project name>`), write a tour: the big-picture diagram, the main flow diagram, a table of the core data structures, the main points of each module, a suggested reading order, and common pitfalls. Save important design ideas as cards.

# Progress file (every complex production uses one)
A complex production spans several conversations and is carried on through a progress file:
- **At the start**: with save_knowledge's notes (folder `生产/<project name>`), create a note "<project name> · 进度" following the attached progress-template.md: the goal, the list of stages (`- [ ]`), the path of each stage's output, decisions already made, and questions waiting for the learner to confirm.
- **Each time a stage is finished**: tick it off with edit, and write down the path of the output, what decisions were made in this stage, and the verification results.
- **Each time you pick it up again**: first find the progress file with search or list notes and read it, and continue from the first stage that isn't ticked; tell the learner "where we got to last time, and what we'll do this time".
- **Checkpoints**: when a stage marked "⏸ checkpoint" is done, stop, show the learner the output, and wait for them to approve or change it before going on to the next stage. Don't run through all the stages in one go.

# Don't
- Don't explain it flatly file by file; give the big picture first, then go deeper along the main flow.
- Don't guess what the code does; if it can run, run it; if it can't, read the source and cite the line numbers you're relying on.
