# Style and layout

An app lives inside a Lattice window, and should look like part of Lattice: quiet, clear, content first.

## Colors: use only the variables Lattice provides
When Lattice loads an app, it writes its current colors into `:root` (they follow when the learner switches theme or customizes one), and marks `<html>` with `data-theme="dark"` or `"light"`. Use these variables directly; don't define a color set of your own:

| Variable | Use |
|---|---|
| `--bg` | Page background |
| `--panel` / `--panel-hi` | Card and panel backgrounds; hi for hover or emphasis |
| `--surface` / `--surface-hover` | Control base color (buttons, input fields, slider tracks) and its hover |
| `--line` / `--line-soft` | Borders, dividers, coordinate grids (soft for grids) |
| `--text` / `--muted` / `--subtle` | Body text / descriptions / secondary labels |
| `--accent` / `--accent-ink` / `--accent-glow` | The primary action button (text in accent-ink), selected states, the curve the learner should notice; glow for faint backgrounds |
| `--ai` / `--ai-glow` | A second data series, things that are "AI-related" |
| `--amber` / `--red` / `--green` | Hints / errors or "wrong" / correct or "right" |
| `--code-bg` / `--code-text` | Code and formula blocks |
| `--sans` / `--mono` | Fonts: body text / code and numeric readouts |
| `--shadow` | Floating elements (use sparingly) |

Every variable needs a fallback value, so the file can still be viewed when opened on its own: `color: var(--text, #e7edf2)`. In the template, take them through one layer of `--c-*` aliases (see template.html), so the fallbacks are written only once.
When a data visualization needs more colors, use accent, ai, amber, red, green in that order; needing more than five means the chart should be split. No pure black or pure white, no gradients or neon colors.

## Type and spacing
- Font sizes: body 14px, descriptions 12.5px, title 17px, readouts 20 to 28px in `--mono` with `font-variant-numeric: tabular-nums` (so digits don't jitter when they change).
- Line height 1.6; don't add spaces by hand between Chinese and English or numbers.
- Spacing only in multiples of 4: 4 / 8 / 12 / 16 / 24 / 32. Corner radius: controls 8px, cards 10px, small labels 999px.
- Borders 1px `--c-line`; shadows only for floating layers.

## Layout
From top to bottom:
1. **Title row**: the app's name (17px, weight 600) + one sentence saying what is being looked at (`--c-muted`). No logo, banner or footer.
2. **Main area**: the canvas, keyboard, diagram... takes up most of the space and is where the learner's eyes go.
3. **Controls area**: sliders, buttons, selects, placed above or to the left of the main area; every control has an English label and its current value.
4. **Readouts and notes**: a few key values, plus a sentence or two of "Watch...".

- In a wide window (≥ 720px) the controls can go in a left column (240 to 280px) with the main area on the right; in a narrow window (from 360px) everything is a single column. Use CSS Grid + `@media` or container queries; don't hard-code pixel widths.
- Content can scroll; don't fix the whole page at 100vh and squeeze things out of view.

## Controls
- Buttons: base color `--c-surface`, hover `--c-surface-hover`; there is only one primary action, with base color `--c-accent` and text `--c-accent-ink`. Pressed, it sinks by 1px; disabled, it is 45% opaque.
- Sliders: `accent-color: var(--c-accent)`, label above, current value on the right (mono).
- Multiple choice and toggles: native inputs with `accent-color`; don't draw your own.
- Focus: `:focus-visible { outline: 2px solid var(--c-accent); outline-offset: 2px }`.
- Icons are thin-line SVG (1.6 to 2px stroke, `currentColor`), see assets.md; don't use emoji as icons.

## Motion and sound
- Transitions 120 to 200ms, `ease-out`; only for state changes (selected, appearing), no decorative animation. Animated demonstrations must be able to pause, step and change speed.
- Respect `prefers-reduced-motion: reduce`: turn off transitions, and make demonstrations step by step.
- Sound plays only after the learner does something; there is a master volume and mute.

## Text
- All in English, conversational and concrete: "Drag the learning rate and see whether the curve closes in or swings back and forth", not "Parameter adjustment panel".
- Write units in full; give values to as many digits as it takes to see the difference, no more and no fewer.
