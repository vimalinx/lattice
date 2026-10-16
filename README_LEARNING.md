# Lattice Learning 1.0

在既有 Lattice 桌面工作台之上的双速学习系统。保持原有笔记、修订、项目文件、传统实验与 Agent 对话功能。

## 启动

```bash
cd ~/Projects/Lattice
python3 run.py
```

桌面依赖：Python 3.11+、PySide6（含 QtWebEngine）、jupyter_client、ipykernel、httpx、numpy、matplotlib。ACP 适配器在 `runtime` 中，通过 `npm ci --prefix runtime` 安装已锁定依赖；应用读取现有本机 Codex 登录，教学连接默认 read-only。程序运行后，打开「设置与数据」设置 DeepSeek 的 Base URL / 模型 ID / API Key，可接自己的 OpenAI 兼容网关。附加参数不被网关支持时可改为空对象 `{}`。

## 日常学习

左侧为单层导航：学习对话、课程、实验笔记、知识笔记、知识卡、知识网络和即时答疑，每个入口对应独立页面。导航支持展开和折叠，选中状态始终对应当前页面。课程、笔记和知识卡以卡片平铺，点击原位展开，再次点击收起；不会追加分栏或弹出第二条左栏。页面切换保留当前选中内容与本次会话中的知识卡草稿，笔记和实验代码按现有规则保存。

用兴趣主题管理课程、实验笔记与主讲对话。当前主题可以开兴趣分支并返回主线。课程支持自己编写，或由 Codex 给出结构化建议后预览、显式采纳。「即时答疑」不占用主讲通道；选中文字/代码后可直接询问。双方的下一轮问题会带上共享主题、相关卡片、真实实验输出与另一个通道的最近讨论。

实验笔记是真实 Jupyter Python 内核，不是模拟输出。每份 Notebook 独立保持变量，支持 Markdown/Python 格、自动保存、单格/全部执行、中断、重启、图片/表格/错误输出、运行源码快照与标准 `.ipynb` 导入导出。按 Shift+Enter 运行当前格，Tab 插入四空格；Ctrl+S 保存。代码在你的用户权限下运行，**不是操作系统安全沙箱**。导入 Notebook 不执行代码，也不把外部输出标成已验证；需本机重跑。

「知识卡与图谱」提供同一份数据的卡片、依赖树和关系图三种视图。关系有类型和理由，前置依赖禁止同类循环。图谱可拖动平移、滚轮缩放、点击节点。记录自己的解释、反例、疑问和实际实验；理解阶段由自己确认，不因 AI 输出或运行成功自动标为掌握。回顾由用户自评，按 1/3/7/14/30 天递增；不是经验证的记忆能力评分。

## 接口

浏览器界面只通过 Qt WebChannel `backend.request(JSON.stringify({method,...}))` 访问本机后端；返回 `{ok,data}` 或 `{ok:false,error}`。没有向局域网开放 HTTP 代码执行服务。事件从 `backend.event` 传输。

模型接口：`learn_settings[_save]`、`learn_connect`、`learn_new_tutor`、`learn_send`、`learn_cancel`、`learn_test_flash`。课程：`learn_topic_save`、`learn_focus`、`learn_lesson_save`、`learn_context`。卡片：`learn_card_save/delete`、`learn_evidence`、`learn_completed_runs`、`learn_relation/delete`、`learn_review`。候选：`learn_proposal_apply/dismiss`。Notebook：`nb_create/get`、`nb_cell_save/delete/move`、`nb_run`、`nb_interrupt/restart`、`nb_history/import/export`。整体快照 `learn_snapshot`，档案导出 `learn_export`。

Codex 的课程建议使用 fenced `lattice` JSON（version=1），允许 lessons/cards/relations/cells。模型没有直写数据库工具，未知字段和不合法关系会拒绝；采纳为事务操作，可重复点击而不重复插入；不会自动执行 AI 生成的 Python。

## 数据、凭据和备份

默认数据：`~/.local/share/lattice/lattice.db`（支持 XDG_DATA_HOME）；学习实验工作目录在同目录 `learning/`。模型配置：`~/.config/lattice/providers.json`（支持 XDG_CONFIG_HOME），权限 0600；界面只知道是否有 Key，不接收已保存密钥；环境变量 `DEEPSEEK_API_KEY` 也可用。导出 ZIP 包含数据库、知识结构 JSON、知识卡 Markdown 与 `.ipynb`，不包含凭据配置或 Codex 登录文件。实际使用模型时，所需学习上下文会发给你配置的模型服务，不能理解为“数据永不出网”。

恢复档案前退出所有 Lattice 窗口，备份整个数据目录，再把 ZIP 中的 lattice.db 放入新的空白 Lattice 数据目录。建议先用独立 XDG_DATA_HOME 启动验证，而非覆盖正在使用的 SQLite/WAL 文件。

## 验收

```bash
python3 -m pytest tests/ -q
python3 tests/runtime_smoke_v1.py
QT_QPA_PLATFORM=offscreen python3 tests/gui_probe_v1.py
```

旧版分栏 GUI 验收脚本 `tests/gui_learning_v1.py` 针对已移除的分栏交互，不能作为新版导航的验收入口。新版导航的 Qt 实际渲染与交互记录见 `docs/navigation-review/REPORT.md`。其他历史执行结果见 `docs/TEST_REPORT.md`。缺少真实 DeepSeek Key 时仅做本地 HTTP/SSE 协议联调，不能据此声称该账户已在线验证。ACP 和 Jupyter 则分别做实际适配器与真实内核测试。


## 启动入口与平铺窗口
应用菜单中搜索「Lattice」，或运行 `lattice-learning`。点击左栏「折叠导航」可以腾出阅读空间，再次点击图标展开。Ctrl+J 打开「即时答疑」。深色/浅色主题可以随时切换。

导出 `.ipynb` 时，已经过期的输出会被省略，并在元数据中注明；原始运行记录仍保留在工作台。
