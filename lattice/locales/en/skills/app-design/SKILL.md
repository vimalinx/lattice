---
name: app-design
title: App guidelines
description: 'The full guidelines for the App builder when it makes or changes a small app for learning: first decide what this app lets the learner "do and see", then build it with a consistent style, sources of assets and way of writing the code, and really check it with check_app.'
category: 复杂生产
agents: [builder]
tags: [apps, interface, interaction, visualization]
version: 2
---
# What an app is
A hands-on learning tool: the learner changes one thing and immediately sees how another thing changes, and so comes to understand an idea or practice a skill until it's fluent. It isn't a handout, a website's home page or a game shell. Each app does one thing well.

# First decide these three things (have them clear before you write the first sentence of your reply)
1. **The action**: what the learner changes with their hands (drag a parameter, play a key, put things in order, write an answer).
2. **The effect**: what changes when they do, and how; put the change the learner should notice in the most prominent place.
3. **Tie it to the explanation**: which concept the Tutor is currently explaining this effect corresponds to; write it on the interface in a sentence or two (not as a long text).

# How
1. Read the three attached guides: style.md (style and layout), code.md (how to write the code) and assets.md (where libraries and assets come from). When changing an existing app, read it first and use edit to change only what needs changing (in why, write what this version changed); don't rewrite the whole thing, and don't save it as a new file.
2. Start from the attached template.html (follow its structure; don't copy its example content).
3. Choose the libraries and assets you need in the order given in assets.md; save the files the core features depend on into apps/assets/ with fetch_asset, so the app also works offline.
4. Write a complete, working version in one go, with no TODOs or placeholder text. First get the core "action → effect" working and checked, then add the nice-to-have parts; an app is usually done within ten minutes.
5. Check with check_app until everything passes:
   - No errors, no images or scripts that failed to load;
   - The text and numbers on the page are right (check the values by computing them again separately with python in shell);
   - Use probe to operate the main controls (click buttons, change sliders and fire the input event, press keys), read the state back, and confirm the effect really changes with them;
   - Check a narrow window at least once: in probe, set document.body.style.width="360px" and then read scrollWidth; there must be no horizontal overflow (put areas that are wide by nature, such as a canvas or a keyboard, in a horizontally scrollable container).
6. Reply: in two or three sentences, say what it can do, how to use it and what to watch; if you used a library or asset from the web, state its source and license; say honestly what you couldn't do.

# Don't
- Cram several unrelated features into one app.
- Have core features that only work when the network is up (a CDN library not downloaded locally).
- Pop-ups (alert, confirm, prompt), opening new windows, going fullscreen automatically, playing sound automatically.
- Say it's done without having checked it with check_app.
- Take apart a library's internal files, or dig shapes or data out of a library: use a library's public API (following the examples in its README); if it doesn't fit, switch to another library or draw it yourself.
