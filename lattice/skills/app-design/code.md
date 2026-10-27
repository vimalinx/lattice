# 程序写法

## 文件
- 一个应用 = `apps/<名字>.html`，自己的 CSS、JS 写在里面；体积大或要复用的库和素材放在 `apps/assets/` 下，用相对路径引用（`assets/lib/...`、`assets/<应用名>/...`）。
- `<head>` 里依次是：`<meta charset="utf-8">`、`<meta name="viewport" content="width=device-width,initial-scale=1">`、`<title>`（应用名）、`<meta name="description" content="一句话">`、样式。脚本放在 `</body>` 前。
- 外部库用 `<script src>` 引本地文件；ES module 写 `<script type="module">`，用 import map 指到本地文件。

## 运行环境（Lattice 的「应用」窗口）
- 每个应用是自己独立的站点（`lattice-app://…`），在沙箱框架里：
  - 能联网（https 的接口、图片、库）；连不了本机和局域网（localhost、192.168.x.x 等会被拦下）。
  - 有自己的 localStorage / IndexedDB，跟着这个文件名走，改名就丢。
  - 不能弹窗（alert/confirm/prompt 无效）、不能开新窗口；链接会在浏览器里打开。
  - 读不到学习库的其他文件，碰不到 Lattice 的界面。
- `lattice.ask(text)`：把一段文字作为引用放进主会话的输入框，学习者补一句问题就能发。用在「带着结果问 AI」按钮上，文字里写清当前设置和结果。不存在时（单独打开文件）要能静默跳过：`window.lattice?.ask(...)`。
- 联网的功能要有失败的样子：请求失败时界面上说「没连上网，用的是内置数据」并照常能用。

## 结构
```js
"use strict";
const state = { /* 全部可变状态放这里 */ };
const $ = s => document.querySelector(s);
function render() { /* 只根据 state 画界面和读数，不改 state */ }
function update(patch) { Object.assign(state, patch); save(); render(); }
// 事件 → update()；动画循环里只推进时间，再 render()
```
- 状态一处，渲染一处；事件处理只改状态。不在各处直接改 DOM 文本。
- 不用 `eval`、`new Function`、`innerHTML` 拼用户输入（用 textContent）。
- 数学和物理公式写成有名字的小函数，旁边注释公式本身；数值稳定性（除零、溢出、NaN）要处理，界面上不出现 NaN 和 Infinity。

## Canvas 和动画
- 按 `devicePixelRatio` 设置画布实际像素，CSS 尺寸跟容器走；用 `ResizeObserver` 重算尺寸后重画。
- 颜色从 CSS 变量取：`getComputedStyle(document.documentElement).getPropertyValue("--c-accent")`，主题变了重新取（Lattice 换主题会重新加载应用，启动时取一次即可）。
- 动画用 `requestAnimationFrame`，用真实时间差推进（`dt`），不按帧数；暂停时停掉循环。
- 坐标轴有刻度和单位；曲线 2px，网格 1px `--c-line-soft`。

## 声音（Web Audio）
- `AudioContext` 在第一次用户操作时创建或 `resume()`。
- 所有声音经过一个总 `GainNode`（音量滑块）再加一个 `DynamicsCompressorNode` 防爆音。
- 每个音有起音和释音包络（几毫秒到几十毫秒），不能硬切出「咔」声；停下时 `stop()` 并断开节点。

## 输入
- 鼠标、触摸用 Pointer Events（`pointerdown/move/up` + `setPointerCapture`），一套代码两用。
- 键盘：主要操作有快捷键，并在界面上标出来；不吞掉 Tab。输入框聚焦时不触发快捷键。

## 保存
- 学习者的设置和进度存 localStorage，键名用 `"app:" + document.title`，读写包在 try/catch 里；提供「恢复默认」。

## 性能
- 首屏 1 秒内可操作；大于 1MB 的数据或库要想清楚是不是真的需要。
- 滑块拖动时的计算要能跟上 60fps：重活放进 `requestAnimationFrame` 合并，或预先算好。

## 用 check_app 检查（probe 示例）
```js
// 改一个滑块，读回读数
const s = document.querySelector("#rate"); s.value = "0.8"; s.dispatchEvent(new Event("input", {bubbles: true}));
await new Promise(r => setTimeout(r, 100));
return { readout: document.querySelector("#result").textContent };
```
```js
// 窄窗口不溢出
document.body.style.width = "360px"; await new Promise(r => setTimeout(r, 100));
return { overflow: document.documentElement.scrollWidth > 380 };
```
