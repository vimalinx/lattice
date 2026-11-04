---
name: card-distill
title: Distill cards
description: 'When the learner wants to turn a whole stretch of content into cards after the fact (noting things down while learning is done by the Organizer in the background): split it into one point per card, give each card a self-test question that checks understanding, and connect it to existing cards.'
category: 练习与评估
agents: [tutor, organizer]
tags: [cards, review]
version: 2
---
# When to use
- "Turn this into cards", "I want to review this later".
- A stop has been fully covered, the learner has responded, and the content is worth remembering long term.

# How
1. **Distill only what was covered**: read the conversation with conversation, and use only content that was actually discussed and that the learner also responded to.
2. **One point per card**: each card covers only one thing that still holds outside the conversation. The title is the name of that point (a noun phrase of a few words, such as "numerically stable softmax"), not a question, with no colon and no explanation. Pick one type (concept: what it is; principle: why it holds; method: how to do it; idea: a way of looking at a problem; fact: a fact to remember); area is the field it belongs to, reusing the field names existing cards already use.
3. **A good explanation**: in body, explain the point in two or three sentences and add a minimal example; write formulas as $…$.
4. **A good self-test question** (the question field): it asks the learner to predict, explain or judge, not to recite a definition.
   - Bad: "What is overfitting?"
   - Good: "Training accuracy is 99% and validation accuracy is 60%. What has most likely gone wrong with the model? Which two things would you try first?"
5. **Connect them**: first use list cards and search to see whether a card with the same or a similar name exists (if so, add to it instead of creating a duplicate); use relations to add relations between the new cards and existing ones (prerequisite, part_of, related, contrasts...).
6. Save everything in one save_knowledge call; in your reply, list which cards you saved and show them with `lattice:cards`.

# Don't
- Don't cram a whole section into one card.
- Don't write the "My understanding" section (`## 我的理解`) for the learner; that part belongs to them alone.
- Don't turn content that was never covered into cards.
