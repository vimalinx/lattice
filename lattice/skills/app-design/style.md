# 风格和布局

应用住在 Lattice 的窗口里，要看起来像 Lattice 的一部分：安静、清楚、内容优先。

## 颜色：只用 Lattice 给的变量
Lattice 在加载应用时把它此刻的配色写进 `:root`（学习者换主题、自定义主题都会跟着变），并在 `<html>` 上标 `data-theme="dark"` 或 `"light"`。直接用这些变量，不自己定一套颜色：

| 变量 | 用途 |
|---|---|
| `--bg` | 页面背景 |
| `--panel` / `--panel-hi` | 卡片、面板背景；悬停或强调时用 hi |
| `--surface` / `--surface-hover` | 控件底色（按钮、输入框、滑轨）及其悬停 |
| `--line` / `--line-soft` | 边框、分隔线、坐标网格（网格用 soft） |
| `--text` / `--muted` / `--subtle` | 正文 / 说明 / 次要标注 |
| `--accent` / `--accent-ink` / `--accent-glow` | 主操作按钮（字用 accent-ink）、选中态、要学习者注意的那条曲线；glow 做淡背景 |
| `--ai` / `--ai-glow` | 第二条数据系列、「AI 相关」的东西 |
| `--amber` / `--red` / `--green` | 提示 / 错误或「不对」/ 正确或「对」 |
| `--code-bg` / `--code-text` | 代码和公式块 |
| `--sans` / `--mono` | 字体：正文 / 代码和数字读数 |
| `--shadow` | 浮起的元素（少用） |

每个变量都要写后备值，单独打开文件时也能看：`color: var(--text, #e7edf2)`。在模板里统一用 `--c-*` 别名接一层（见 template.html），后备值只写一次。
数据可视化需要更多颜色时，依次用 accent、ai、amber、red、green；超过五种说明该拆图了。不用纯黑纯白，不用渐变和霓虹色。

## 字和间距
- 字号：正文 14px，说明 12.5px，标题 17px，读数 20～28px 用 `--mono` 并加 `font-variant-numeric: tabular-nums`（数字跳动时不抖）。
- 行高 1.6；中文和英文、数字之间不手动加空格。
- 间距只用 4 的倍数：4 / 8 / 12 / 16 / 24 / 32。圆角：控件 8px，卡片 10px，小标签 999px。
- 边框 1px `--c-line`；阴影只给浮层。

## 布局
从上到下：
1. **标题行**：应用名（17px，600 字重）+ 一句话说在看什么（`--c-muted`）。不放 logo、横幅、页脚。
2. **主区**：画布、键盘、图……占大部分面积，是学习者的视线中心。
3. **控件区**：滑块、按钮、选择，放主区上方或左侧；每个控件有中文标签和当前值。
4. **读数和说明**：几个关键数值，加一两句「注意看……」。

- 宽窗口（≥ 720px）控件可放左栏（240～280px），主区在右；窄窗口（360px 起）全部单列。用 CSS Grid + `@media` 或 container query，不写死像素宽度。
- 内容可滚动；不要让整个页面固定在 100vh 而把东西挤没。

## 控件
- 按钮：底色 `--c-surface`，悬停 `--c-surface-hover`；主操作只有一个，底色 `--c-accent`、字 `--c-accent-ink`。按下有 1px 下沉，禁用时 45% 不透明。
- 滑块：`accent-color: var(--c-accent)`，标签在上、当前值在右（mono）。
- 选择题、开关：原生 input 加 `accent-color`，别自己画一套。
- 焦点：`:focus-visible { outline: 2px solid var(--c-accent); outline-offset: 2px }`。
- 图标用细线条 SVG（1.6～2px 描边，`currentColor`），见 assets.md；不用 emoji 当图标。

## 动效和声音
- 过渡 120～200ms，`ease-out`；只给状态变化（选中、出现）加，不做装饰性动画。动画演示要能暂停、单步、调速度。
- 尊重 `prefers-reduced-motion: reduce`：关掉过渡，演示改为单步。
- 声音只在学习者操作之后响；有总音量和静音。

## 文字
- 全部中文，口语、具体：「拖动学习率，看曲线是靠近还是来回摆」，而不是「参数调节面板」。
- 单位写全；数值保留到能看出差别的位数，不多不少。
