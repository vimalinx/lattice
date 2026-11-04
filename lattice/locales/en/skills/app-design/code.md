# How to write the code

## Files
- One app = `apps/<name>.html`, with its own CSS and JS inside it; large or reusable libraries and assets go under `apps/assets/`, referenced by relative path (`assets/lib/...`, `assets/<app name>/...`).
- In `<head>`, in this order: `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width,initial-scale=1">`, `<title>` (the app's name), `<meta name="description" content="one sentence">`, the styles. Scripts go before `</body>`.
- Reference external libraries as local files with `<script src>`; for ES modules write `<script type="module">` and point an import map at the local files.

## The runtime (Lattice's "Apps" window)
- Each app is its own separate site (`lattice-app://…`), inside a sandboxed frame:
  - It can reach the internet (https APIs, images, libraries); it can't reach this machine or the local network (localhost, 192.168.x.x and so on are blocked).
  - It has its own localStorage / IndexedDB, tied to the file name; rename the file and it's lost.
  - It can't show pop-ups (alert/confirm/prompt do nothing) or open new windows; links open in the browser.
  - It can't read other files in the vault, and can't touch Lattice's interface.
- `lattice.ask(text)`: puts a piece of text into the Tutor's input box as a quote, so the learner can add a question and send it. Use it for an "Ask the AI about this result" button, with the current settings and results stated in the text. When it doesn't exist (the file opened on its own), skip it silently: `window.lattice?.ask(...)`.
- Features that use the network need a failure state: when a request fails, the interface says "Couldn't connect, using built-in data" and still works as usual.

## Structure
```js
"use strict";
const state = { /* all mutable state goes here */ };
const $ = s => document.querySelector(s);
function render() { /* draws the interface and readouts from state only; doesn't change state */ }
function update(patch) { Object.assign(state, patch); save(); render(); }
// events → update(); the animation loop only advances time, then render()
```
- State in one place, rendering in one place; event handlers only change state. Don't change DOM text directly all over the place.
- No `eval`, `new Function`, or building `innerHTML` from user input (use textContent).
- Write math and physics formulas as small named functions, with the formula itself in a comment beside them; handle numerical stability (division by zero, overflow, NaN), and never show NaN or Infinity on the interface.

## Canvas and animation
- Set the canvas's actual pixels from `devicePixelRatio`, with its CSS size following its container; use `ResizeObserver` to recompute the size and redraw.
- Take colors from CSS variables: `getComputedStyle(document.documentElement).getPropertyValue("--c-accent")`, and take them again when the theme changes (Lattice reloads apps when the theme changes, so taking them once at startup is enough).
- Animate with `requestAnimationFrame`, advancing by the real time difference (`dt`), not by frame count; stop the loop when paused.
- Axes have ticks and units; curves 2px, grids 1px `--c-line-soft`.

## Sound (Web Audio)
- Create the `AudioContext`, or `resume()` it, on the first user action.
- Route all sound through one master `GainNode` (the volume slider) and then a `DynamicsCompressorNode` to prevent clipping.
- Every note has an attack and release envelope (a few milliseconds to a few tens of milliseconds), so it never cuts off hard with a "click"; when stopping, `stop()` it and disconnect the nodes.

## Input
- Use Pointer Events for mouse and touch (`pointerdown/move/up` + `setPointerCapture`), one set of code for both.
- Keyboard: main actions have shortcuts, shown on the interface; don't swallow Tab. Don't fire shortcuts while an input field has focus.

## Saving
- Save the learner's settings and progress to localStorage, with the key `"app:" + document.title`, and wrap reads and writes in try/catch; provide a "Reset to defaults".

## Performance
- Usable within 1 second of first load; think hard about whether data or libraries larger than 1MB are really needed.
- Calculations while a slider is dragged must keep up with 60fps: batch heavy work into `requestAnimationFrame`, or compute it in advance.

## Checking with check_app (probe examples)
```js
// Change a slider, read the readout back
const s = document.querySelector("#rate"); s.value = "0.8"; s.dispatchEvent(new Event("input", {bubbles: true}));
await new Promise(r => setTimeout(r, 100));
return { readout: document.querySelector("#result").textContent };
```
```js
// No overflow in a narrow window
document.body.style.width = "360px"; await new Promise(r => setTimeout(r, 100));
return { overflow: document.documentElement.scrollWidth > 380 };
```
