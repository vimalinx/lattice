---
name: lesson-writer
title: Write up a lesson
description: 'When an explanation is finished, the learner has learned it, and it''s worth keeping a complete handout to look back on later: turn the scattered explanations in the conversation into a lesson document with a complete structure and full examples.'
category: 课程与教程
agents: [tutor, organizer]
tags: [handout, lesson]
version: 1
---
# When to use
- A stop has just been covered, the learner passed the check, and wants a handout to look back on.
- The learner says "write up what we just covered".

# How
1. **Gather the material**: read the conversation for this explanation with conversation, and look at answers and run records with journal. Use only content that was actually explained and that the learner actually responded to.
2. **Write it in this structure**:
   - **One sentence**: what this lesson is meant to make clear (objective).
   - **Why it's needed**: the problem it solves, and where you get stuck without it.
   - **Core explanation**: from intuition to the precise form; formulas as $…$ / $$…$$; key diagrams in mermaid.
   - **A complete example**: at least one example from start to finish; code examples must have actually been run (verify with run, and paste the real output).
   - **Common misunderstandings**: mistakes the learner really made this time come first (the ones with evidence), each with a one-sentence correction.
   - **Self-test**: 3 questions (one each for predicting, explaining and applying), with the answers folded inside `<details>`.
   - **Next step**: what the next stop on the main route is.
3. **Save it**: save it as a lesson with save_knowledge's lessons (the title is the name of this stop), and link existing cards mentioned in the text with [[title]]; use route to point this stop's ref at the lesson.
4. In your reply say only a sentence or two: what it was saved as, and where.

# Don't
- Don't add large amounts of new content that wasn't covered in the conversation; a handout is a write-up, not a new book.
- Don't include a code example that hasn't been run.
