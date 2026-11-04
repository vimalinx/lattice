---
name: visual-trace
title: Diagrams and step-by-step traces
description: When a process, structure or data flow is hard to put clearly in words (an algorithm running, recursive calls, propagation through a network, a state machine…) — draw diagrams, make tables, and trace how the state changes at every step.
category: 讲解思路
agents: [tutor, flash, coach]
tags: [diagrams, tracing]
version: 1
---
# When to use
- What needs understanding is a **process**: each step of an algorithm, the call stack of a recursion, how data flows through a system.
- The structural relationships are complex: between classes, between modules, between concepts.

# Steps
1. **Pick the right diagram**:
   - Flows, call relationships, state machines → ```mermaid (flowchart / sequenceDiagram / stateDiagram).
   - The state of the variables at each step → a table, one row per step, with the key variables as columns.
   - Values changing with a parameter → `lattice:chart`.
2. **Trace a small input step by step**: choose an input small enough to work by hand, and in the table write out all the key state after each step. At a key step, stop and have them predict the next row (`lattice:quiz`).
3. **Check against code**: where code can be written, use `write` to write a small program that prints the state at each step, `run` it to get the real trace, and compare it with the hand-worked table.
4. **From the specific to the general**: after the trace, ask them to state the pattern of the process (loop invariant, recursive structure, direction of data flow).
5. Good diagrams and trace tables can be saved into lessons (save_knowledge's lessons) to look back at later.

# Don't
- Don't make a diagram too big; one diagram covers one thing, and once it passes 12 nodes, split it.
- Don't give a diagram without explaining it; under each diagram, say in a sentence or two what to look at.
