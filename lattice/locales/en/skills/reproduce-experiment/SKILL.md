---
name: reproduce-experiment
title: Reproduce an experiment
description: When you need to reproduce the experimental results of a paper, a blog post or a tutorial — work in phases (understand the claim, set up a minimal environment, reproduce a minimal version first, align the details, compare the results, write a reproduction report), with every conclusion coming from real runs.
category: 复杂生产
agents: [tutor, coach]
tags: [experiment, reproduction, code]
version: 2
---
# When to use
- “Reproduce Table 2 of this paper”, “Follow this tutorial and get the same results”, “Check whether this claim is right”.

# Phases
1. **What the claim is** ⏸ Checkpoint: in a sentence or two, write down the result the original claims (down to the numbers, figures and conditions), how closely it is to be reproduced (same trend / close numbers / exact match), and the limits on compute and time. When there is no GPU and only the CPU can be used, say up front how far the reproduction can go.
2. **Minimal environment**: set up the environment in a notebook (write_cell) or in `code/<project name>/`; install missing packages with install. First run the simplest smoke test (it imports, it runs one step).
3. **Minimal version**: first reproduce a scaled-down version (small data, few steps, a small model), and confirm that the pipeline works and the results point the right way. Get real output with run at every step; don't rely on imagination.
4. **Align the details**: list every detail in the original that could affect the result (data processing, hyperparameters, random seeds, evaluation method) and align them one by one; for what the original doesn't say, write down your choice and the reason.
5. **Compare** ⏸ Checkpoint: put the reproduced results side by side with the original's (a table or `lattice:chart`), and say which match, which don't, and the possible reasons. Don't force a mismatch into a match by tuning; write out the analysis of the reasons clearly.
6. **Reproduction report**: with save_knowledge's notes (folder “生产/<project name>”), write a reproduction report: the claim, environment, method, comparison of results, analysis of deviations, conclusion, and reproduction steps (that someone else could follow and run). Save the methods and pitfalls learned as cards.

# Progress file (used by all complex production)
Complex production spans several conversations and is carried on through one progress file:
- **At the start**: with save_knowledge's notes (folder “生产/<project name>”), create a note “<project name> · 进度”, written from the attached progress-template.md: the goal, the list of phases (`- [ ]`), the output path of each phase, decisions already made, and questions waiting for the learner to confirm.
- **Each time a phase is done**: tick it with edit, and write down the output's path, the decisions made in this phase, and the verification results.
- **Each time you pick it up again**: first find the progress file with search or list notes and read it, then continue from the first unticked phase; tell the learner “where we got to last time, and what we're doing this time”.
- **Checkpoints**: when a phase marked “⏸ Checkpoint” is done, stop, show the learner the output, and wait for them to approve or change it before going on to the next phase. Don't run through all the phases in one go.

# Don't
- Don't report results that haven't really been run.
- Don't pick seeds or quietly change the evaluation method to make the reproduction “succeed”; if you changed something, write it down.
- For tasks that would run too long, scale down first; don't start with the full-size run.
