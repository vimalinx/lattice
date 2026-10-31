# 学习库的规矩

这个文件夹是一个人的学习库。Lattice 里的每个 AI 每一轮都会先读这份规矩；学习者可以直接改它，改了就按改后的来。

## 目录

- `topics/` 主题，`cards/` 知识卡，`lessons/` 课程，`notes/` 笔记（子文件夹随意），`insights/` 薄弱点和做得好的地方：都是 Markdown，属性写在开头的 YAML 里。
- `apps/` 小应用：应用助手做的 .html 文件，在「应用」窗口的沙箱里运行（能联网，连不了本机和局域网，读不到学习库）；它们用的库和素材在 `apps/assets/`。
- `notebooks/` 实验笔记：标准 `.ipynb`，属性在 `metadata.lattice`。
- `code/` 代码，`data/` 数据，`books/` 电子书：原样保存，用路径引用。
- `envs/<名字>.txt`：Python 环境的定义，一行一个包。某个目录里放一个 `.lattice-env` 文件（内容是环境名），这个目录下的文件就用那个环境；默认用 `default`。
- `threads/` 对话，`journal/` 学习轨迹：JSON lines，只追加。
- `annotations/` 高亮和批注：一个被批注的东西一个 JSON 文件，`source` 是它（文档 id、`file:<路径>`、`thread:<id>` 或 `web:<网址>`），`items` 是一条条批注，每条的 `anchor` 记着位置（`at`）和原文（`text`、`before`、`after`），文件改过以后靠原文找回。别处用 `ann:<id>` 指向一条批注。
- `agents/<名字>.md`：可选。放一份同名文件就能改写那个 AI 的工作方式。
- `.lattice/`：索引和本机状态，删了能重建。

## 属性

- 每个 Markdown 文档都有 `id`、`kind`、`title`、`by`（`me` 或哪个 AI）、`created`、`updated`；按需有 `topic`（所属主题的 id）和 `links`。
- `links` 是一列关系 `{id, to, as, why}`。`to` 是另一个文档的 id，或 `file:<路径>`；`as` 是 `prerequisite`（前置）、`part_of`（组成部分）、`related`、`applies_to`（应用于）、`contrasts`（对比）、`explains`（这段内容解释了 `to` 的什么）。
- 主题：`question`（想弄懂的问题）、`parent`（上级主题）、`state`（`active` / `parked` / `completed`）、`route`（主干路线，一串 `{title, ref?, why?}`）；正文是主题档案。
- 知识卡：`stage`（`suggested` 待探索 / `seen` 接触过 / `explained` 能解释 / `applied` 能应用）、`question`（自测题）、`tags`、`due`、`reviews`；正文是解释，`## 我的理解` 一节是学习者自己写的。
- 引用一律用 id；文件夹只是给人看的默认摆放，不承载含义。

## 谁能改什么

- 知识图、路线、轨迹、薄弱点、主题档案这类结构化状态，用 Lattice 命令改，不直接编辑这些属性。
- 普通内容（笔记正文、代码、数据）可以用命令行直接改。
- 知识卡的 `stage`、`due`、`reviews` 和 `## 我的理解`，轨迹里学习者那一侧的记录，回顾自评：只归学习者。AI 能读不能改；命令行改了会被自动退回。
- 删除只由学习者做。
- `threads/`、`journal/`、`annotations/`、`AGENTS.md`、`agents/`、`.lattice/` 只由 Lattice 和学习者维护；AI 用 `annotate` 留批注。
- AI 的每个动作都单独提交一次 git，学习者可以撤销。
