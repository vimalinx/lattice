# 打包在 `ui/vendor/` 里的第三方组件

界面不联网：下面这些库原样（或打包后）放在这里，各自遵循自己的许可证。

| 文件 | 组件 | 版本 | 许可证 |
|---|---|---|---|
| `codemirror.js` | [CodeMirror 6](https://codemirror.net/)（state、view、commands、language、autocomplete、search、merge、lang-markdown、language-data 等，用 esbuild 打成一个文件，全局名 `CM`）及 [Lezer](https://lezer.codemirror.net/) | codemirror 6.0.2、@codemirror/view 6.43.15、@codemirror/state 6.7.6、@codemirror/merge 6.12.2 | MIT |
| `katex/` | [KaTeX](https://katex.org/) | 0.19.0 | MIT（见 `katex/LICENSE`） |
| `marked.umd.js` | [marked](https://github.com/markedjs/marked) | 18.1.0 | MIT |
| `purify.min.js` | [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.16 | Apache-2.0 或 MPL-2.0 |
| `cytoscape.umd.js` | [Cytoscape.js](https://js.cytoscape.org/) | 3.34.3 | MIT |
| `mermaid.min.js` | [Mermaid](https://mermaid.js.org/) | 10.9.4 | MIT |
| `pdfjs/` | [PDF.js](https://mozilla.github.io/pdf.js/)（pdfjs-dist 的 legacy 构建，含 cmaps、标准字体和 wasm 解码器） | 6.4.299 | Apache-2.0（见 `pdfjs/LICENSE`） |
| `foliate/` | [foliate-js](https://github.com/johnfactotum/foliate-js)（EPUB、MOBI、AZW3、FB2、CBZ 的解析和排版，`vendor/` 里带 zip.js 和 fflate） | 78914ae | MIT（见 `foliate/LICENSE`） |
