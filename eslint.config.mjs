// A name nothing declares fails only when that line runs, so it is checked here instead. The interface's modules import
// everything they use; the names below are the vendored scripts index.html loads, and the browser's own.
const vendor = ["CM", "marked", "DOMPurify", "katex", "cytoscape", "mermaid", "QWebChannel", "qt"];
const browser = ["window", "document", "location", "navigator", "console", "innerWidth", "innerHeight", "addEventListener", "getSelection",
  "getComputedStyle", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "CSS",
  "Event", "Node", "NodeFilter", "Highlight", "FileReader", "URL", "URLSearchParams", "ResizeObserver", "MutationObserver"];

export default [{
  files: ["ui/*.js"],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: Object.fromEntries([...vendor, ...browser].map((name) => [name, "readonly"])),
  },
  rules: {"no-undef": "error", "no-dupe-keys": "error", "no-unreachable": "error", "no-import-assign": "error"},
}];
