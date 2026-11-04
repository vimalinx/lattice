# Where libraries and assets come from

Choose in this order; if an earlier option works, don't use a later one:

## 1. Draw it and synthesize it yourself (first choice)
- Shapes, charts, animation: draw them yourself with Canvas or SVG. Don't pull in a library for a diagram you can draw in a few dozen lines.
- Sound: synthesize it with Web Audio (oscillators, noise, envelopes, simple stacked overtones).
- Icons: write thin-line SVG yourself (24×24 viewBox, 1.8px stroke, `stroke="currentColor"`, round line caps).

## 2. Libraries that ship with Lattice (work offline, no download needed)
Absolute paths on the same site:
| Library | Path | Use |
|---|---|---|
| KaTeX | `/_lattice/vendor/katex/katex.min.js`, `/_lattice/vendor/katex/katex.min.css` | Formulas |
| Cytoscape | `/_lattice/vendor/cytoscape.umd.js` | Graphs of nodes and edges (networks, dependencies, state machines) |
| Mermaid | `/_lattice/vendor/mermaid.min.js` | Flowcharts, sequence diagrams |
| marked | `/_lattice/vendor/marked.umd.js` | Rendering Markdown text |
| DOMPurify | `/_lattice/vendor/purify.min.js` | Sanitizing outside HTML before showing it |

## 3. Libraries and assets downloaded into apps/assets/
When you need a specific library, take a fixed version of the package from npm, download it with fetch_asset into `apps/assets/lib/<package>@<version>/`, and reference it relatively.
- First look up the current version: web_fetch `https://data.jsdelivr.com/v1/packages/npm/<package>/resolved`, note the version, and pick one that has been released for at least two weeks.
- File address: `https://cdn.jsdelivr.net/npm/<package>@<version>/<file>` (find the bundled one, such as `dist/xxx.min.js`, from the package's README or the file list at `https://data.jsdelivr.com/v1/packages/npm/<package>@<version>`).
- Use the library's public API, writing it the way the examples in its README do; first confirm that the file you're going to use (the UMD `*.min.js`, or the ES module) really provides the functions you need.
- Common ones:
  - Music: `abcjs` (write one line of ABC notation, and `ABCJS.renderAbc(element, "X:1\nK:C\n[CE]")` draws the staff, and can play it too; file `dist/abcjs-basic-min.js`), `tone` (synthesis, rhythm, samples), `vexflow` (finely engraved staff notation), `tonal` (music theory calculations: intervals, chords, scales).
  - Data and charts: `d3`, `chart.js`.
  - Physics and geometry: `matter-js` (2D physics), `three` (3D, use the module build).
  - Creative coding: `p5`.
- Assets (images, audio samples, fonts, datasets): only from sources with clear licenses that allow reuse, such as Wikimedia Commons (check each file's license), Google Fonts (OFL), Lucide icons (ISC, individual SVGs in the `lucide-static` package). After downloading, state the source and license in your reply; for those that require attribution, put a line of small text in a corner of the app.
- Where to store them: `apps/assets/<app name>/` for files only this app uses; `apps/assets/lib/` for libraries, shared by several apps.

## 4. Fetched from the web at run time (only for non-core, live things)
For example, querying a live data API, or loading an illustrative image. There must be a fallback for when it fails (built-in data or explanatory text); the app must not fail to open because the network is down.

## Don't
- Use images and audio of unknown origin or unclear license.
- Leave versions unpinned (`@latest`, or no version).
- Pull in a big library for one small feature.
