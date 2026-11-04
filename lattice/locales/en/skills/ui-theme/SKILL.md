---
name: ui-theme
title: Design an interface theme
description: When the learner wants to change the interface's colors or style (“switch to warm tones”, “make an easy-on-the-eyes theme”, “like such-and-such app”, “rounder corners”) — first get clear on the feel, then design a whole coordinated set of colors and style, apply it with the ui tool's theme, and check the contrast.
category: 其他
agents: [tutor, flash]
tags: [interface, color scheme, theme]
version: 1
---
# When to use
The learner wants to change the interface's colors, fonts or style. For a single setting such as font size or line spacing, use ui's set, not this skill.

# What to achieve
- A coordinated whole: the background, panels, cards, borders, three levels of text, accent color, AI color and code highlighting are one family, not just one or two colors swapped.
- Easy to read: body text against the background and panels has a contrast of at least 4.5, secondary text at least 3; text on the accent color needs enough contrast too. The warnings the ui tool returns are reminding you of exactly this; adjust until there are none.
- Clear layers: bg, panel, panel-hi and surface differ visibly but not glaringly; line is a little darker than surface (light themes) or a little lighter (dark themes).
- The accent color and the AI color are easy to tell apart: one means “your actions”, the other “the AI's things”.
- Code highlighting still reads well on the new background, with keywords, strings, functions and comments clearly distinct from each other.

# Steps
1. When it isn't clear what feel they want, ask one question (cool / warm, dark / light, lively / calm, or modeled on some app); if they've already said it clearly, just do it.
2. First set two or three base colors (the background and one main hue), and derive the other colors from them: vary lightness within the same hue for the layers, and take the accent color as a contrasting color or a more saturated step of the same family.
3. Apply the whole set at once with the ui tool: `{"do": "theme", "name": "<give it a name>", "base": "dark or light", "vars": {...}, "note": "one sentence explaining it"}`. Write style (corner radius, shadows, spacing) in css, with specific selectors (such as `.btn`, `.modal`, `.skill-card`); don't use catch-all forms like `[class*=...]`; write shadow as a complete box-shadow.
4. Look at the returned warnings; if there are any, adjust until there are none.
5. In your reply, say in a sentence or two the idea behind the theme and its main colors, and tell the learner that if they don't like it they can click “Restore layout”, or say what to change.

# Don't
- Don't stop after changing only one or two colors; the interface ends up half new and half old.
- Don't use url(), @import or external fonts.
- Don't change the interface on your own initiative while the learner is concentrating on studying.
