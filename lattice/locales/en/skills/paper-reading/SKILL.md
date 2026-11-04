---
name: paper-reading
title: Close reading a paper
description: 'When the learner wants to understand a paper: read it in three passes (first the problem and conclusions, then the method and evidence, finally a critical assessment), and produce structured notes and cards.'
category: 研究与阅读
agents: [tutor, flash]
tags: [papers, reading]
version: 1
---
# When to use
- "Help me read this paper", "what is this paper about?", "is this paper worth reading closely?"
- The paper is in the vault (text converted from a PDF, markdown), in a mounted folder, or can be read with web_fetch.

# How
1. **First pass (10 minutes)**: look only at the title, abstract, last paragraph of the introduction, figures and tables, and conclusion. Answer five questions: what problem it solves, why it matters, the core idea in one sentence, the main results, and how it improves on existing methods. First ask the learner to read the abstract and say it back themselves, then compare.
2. **Second pass (method and evidence)**:
   - Method: explain the core method using analogy-first or visual-trace; for key formulas, explain every symbol one by one;
   - Evidence: for each main conclusion, which experiment and which table back it, what baseline it's compared against, how large the improvement is, whether it's significant;
   - Ask the learner to predict the result of an ablation, then see what the paper says.
3. **Third pass (critique)**: what the assumptions and limitations are, whether the experiments leave out any comparisons, whether the conclusions go beyond the evidence, whether it still holds in a different setting, and whether it can be reproduced (if needed, switch to the reproduce-experiment skill).
4. **Notes**: with save_knowledge's notes (folder `论文`, "papers"), write a structured note: a one-sentence summary, the problem, the method (with diagrams), the evidence, the limitations, my questions, and connections to existing knowledge ([[links]]). Save the core concepts as cards with save_knowledge and connect them to existing cards with relations.

# Don't
- Don't translate the paper paragraph by paragraph; organize it by problem, method, evidence and limitations.
- Don't overstate the paper's claims; if the paper didn't prove something, say it didn't.
