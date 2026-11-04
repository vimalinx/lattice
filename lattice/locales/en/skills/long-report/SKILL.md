---
name: long-report
title: Long-form writing and technical reports
description: 'When you need to write a substantial long piece (a technical report, research report, design document, survey, long blog post): work in stages (pin down the question, gather material, outline, draft section by section, check consistency and facts, finalize), each stage checkable, writing on across several conversations.'
category: 复杂生产
agents: [tutor, organizer]
tags: [writing, report, long-term project]
version: 1
---
# When to use
- "Help me write a technical report / design document / research report on X".
- More than two or three thousand words, needs argument and evidence, and can't be finished in one conversation.

# Stages
1. **Question and readers** ⏸ checkpoint: the one core question this piece answers, who the readers are, what judgment they should be able to make after reading, and the length and format requirements.
2. **Material**:
   - From the vault: use search, list and read to find related notes, cards, lessons and experiment records;
   - External: web_search / web_fetch (if needed), recording the source of every item;
   - Experimental data: use only results that were actually run (read the run records, or rerun with run).
   Write the material list (source + a one-sentence key point + reliability) into `notes/生产/<project name>/材料.md` (with write).
3. **Outline** ⏸ checkpoint: an outline of claims: for each section, one sentence stating what the section must prove, with the material supporting it listed underneath. Mark any claim that has no material supporting it.
4. **Draft section by section**: write one or two sections at a time into `notes/生产/<project name>/正文.md` (create it the first time with write, then use edit to append or rewrite a section). Every factual claim must match an item in the material list; data and charts use real results (you can show them to the learner first with `lattice:chart`).
5. **Check** ⏸ checkpoint: read the whole text through and check:
   - whether every claim has a source; whether the numbers match the sources;
   - whether there are contradictions, repetitions or skipped steps between sections;
   - whether terms are used consistently throughout; whether the conclusions go beyond the evidence.
   List the problems for the learner, and revise once they've confirmed.
6. **Finalize**: write the abstract (three to five sentences stating the question, method and conclusions) and tidy the references; if needed, export a version and save it separately. Record the path of the final draft in the progress file.

# Progress file (every complex production uses one)
A complex production spans several conversations and is carried on through a progress file:
- **At the start**: with save_knowledge's notes (folder `生产/<project name>`), create a note "<project name> · 进度" following the attached progress-template.md: the goal, the list of stages (`- [ ]`), the path of each stage's output, decisions already made, and questions waiting for the learner to confirm.
- **Each time a stage is finished**: tick it off with edit, and write down the path of the output, what decisions were made in this stage, and the verification results.
- **Each time you pick it up again**: first find the progress file with search or list notes and read it, and continue from the first stage that isn't ticked; tell the learner "where we got to last time, and what we'll do this time".
- **Checkpoints**: when a stage marked "⏸ checkpoint" is done, stop, show the learner the output, and wait for them to approve or change it before going on to the next stage. Don't run through all the stages in one go.

# Don't
- Don't make up data, citations or sources; if you can't find one, write "no reliable source found".
- Don't write the whole text in one go before showing it to the learner.
- Don't change the learner's views into yours; write out the disagreement and let them decide.
