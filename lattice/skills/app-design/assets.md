# 库和素材从哪来

按这个顺序选，能用前面的就不用后面的：

## 1. 自己画、自己合成（首选）
- 图形、图表、动画：Canvas 或 SVG 自己画。几十行能画好的图不引库。
- 声音：Web Audio 合成（振荡器、噪声、包络、简单的泛音叠加）。
- 图标：自己写细线条 SVG（24×24 视框，1.8px 描边，`stroke="currentColor"`，圆角端点）。

## 2. Lattice 自带的库（离线可用，不用下载）
同一个站点下的绝对路径：
| 库 | 路径 | 用途 |
|---|---|---|
| KaTeX | `/_lattice/vendor/katex/katex.min.js`、`/_lattice/vendor/katex/katex.min.css` | 公式 |
| Cytoscape | `/_lattice/vendor/cytoscape.umd.js` | 节点和连线的图（网络、依赖、状态机） |
| Mermaid | `/_lattice/vendor/mermaid.min.js` | 流程图、时序图 |
| marked | `/_lattice/vendor/marked.umd.js` | 把 Markdown 文本渲染出来 |
| DOMPurify | `/_lattice/vendor/purify.min.js` | 显示外来 HTML 前清洗 |

## 3. 下载到 apps/assets/ 的库和素材
需要专门的库时，从 npm 上的包取固定版本，用 fetch_asset 下到 `apps/assets/lib/<包名>@<版本>/` 再相对引用。
- 先查当前版本：web_fetch `https://data.jsdelivr.com/v1/packages/npm/<包名>/resolved`，记下 version，选一个发布至少两周的。
- 文件地址：`https://cdn.jsdelivr.net/npm/<包名>@<版本>/<文件>`（看包的 README 或 `https://data.jsdelivr.com/v1/packages/npm/<包名>@<版本>` 的文件列表找到打包好的那个，如 `dist/xxx.min.js`）。
- 用库公开的 API，照它 README 里的例子写；先确认要用的那个文件（UMD 的 `*.min.js`，或 ES module）真的提供了你要的函数。
- 常用的：
  - 音乐：`abcjs`（写一行 ABC 记谱，`ABCJS.renderAbc(元素, "X:1\nK:C\n[CE]")` 就画出五线谱，还能播放；文件 `dist/abcjs-basic-min.js`）、`tone`（合成、节拍、采样）、`vexflow`（精细排版五线谱）、`tonal`（乐理计算：音程、和弦、音阶）。
  - 数据和图：`d3`、`chart.js`。
  - 物理和几何：`matter-js`（2D 物理）、`three`（3D，用 module 版）。
  - 创意编程：`p5`。
- 素材（图片、音频样本、字体、数据集）：只用许可清楚、允许复用的来源，例如 Wikimedia Commons（看每个文件的许可）、Google Fonts（OFL）、Lucide 图标（ISC，`lucide-static` 包里有单个 SVG）。下载后在回复里写上来源和许可；需要署名的，在应用里角落放一行小字。
- 存放：`apps/assets/<应用名>/` 放这个应用专用的；`apps/assets/lib/` 放库，多个应用共用。

## 4. 运行时从网上取（只用于非核心、实时的东西）
例如查一个实时的数据接口、加载一张示意图。必须有失败时的退路（内置数据或说明文字），不能让应用因为断网就打不开。

## 不要
- 用来路不明、许可不清的图片和音频。
- 不固定版本（`@latest`、不写版本）。
- 为了一个小功能引一个大库。
