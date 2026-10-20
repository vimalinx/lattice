# Lattice Learning 1.0

本地桌面上的双速学习系统：学习对话、课程、Jupyter 实验笔记、知识笔记（含修订历史与双向链接）、知识卡与知识网络。早期的实验室、独立 AI 协作、代码工作区和时间线页面已移除；挂载本地目录的文件浏览并入实验笔记页。

## 启动

```bash
cd ~/Projects/Lattice
python3 run.py
```

桌面依赖：Python 3.11+、PySide6（含 QtWebEngine）、jupyter_client、ipykernel、httpx、numpy、matplotlib。主讲、快答和练习教练都走 OpenAI 兼容 API（流式 SSE + 工具调用）：「设置与数据」里有 DeepSeek、CommandCode、OpenCode Go 和一个自定义连接，每个连接各存一份 Key，三条通道各自选连接和模型（默认 CommandCode：快答 `deepseek/deepseek-v4.1-flash-fast`，主讲和练习教练 `deepseek/deepseek-v4.1-flash`）。思考型模型的思考内容计入回复上限；只思考没回答时会自动重试一次。OpenCode Go 要求 `x-opencode-session` 请求头，默认用会话 ID 填入。附加参数不被网关支持时可改为空对象 `{}`。

## 日常学习

左侧为单层导航：学习对话、课程、实验笔记、知识笔记、知识卡、知识网络和即时答疑，每个入口对应独立页面。导航支持展开和折叠，选中状态始终对应当前页面。课程、笔记和知识卡以卡片平铺，点击原位展开，再次点击收起；不会追加分栏或弹出第二条左栏。页面切换保留当前选中内容与本次会话中的知识卡草稿，笔记和实验代码按现有规则保存。

全局搜索（Ctrl+K 或左栏「全局搜索」）同时检索知识卡、笔记、课程、主题与所有主题下的实验笔记，标题命中优先，正文命中显示匹配片段；↑↓ 选择，Enter 打开。打开其他主题的实验笔记会先切换到该主题。

用兴趣主题管理课程、实验笔记与主讲对话。主讲的规则只给出长期讲解的参照（讲完要能解释为什么、怎么运作、哪里失效，并用到新例子上；每轮接得上前文、为后文铺路；以讲透为准）和策略，不规定固定讲法。

平时直接和主讲聊，不需要任何主题；默认对话不显示名字（在按主题筛选的地方叫「未归入主题」）。界面上没有建主题的按钮，顶栏只在你处于某个主题时显示它的名字。主题怎么组织由主讲判断：某段讨论正在变成一条要跨天深入的学习线时，它会把它建成主题或某条主线的分支，切过去，并把属于它的那几条对话一起带走，别的话题留在原处；一两句闲问不会单独建。你也可以直接让它建、切或回到某个主题。它建了、切了都会在回复里说，并且可以撤销。

主讲、快答和练习教练通过工具直接操作整个工作台（`lattice/tools.py`）。不会自动推送学习状态：每个 AI 只被告知有哪些工具，需要时自己去查，比如主题档案、知识卡、笔记、课程、实验单元格和真实输出、其他通道的对话、最近的改动、薄弱点和挂载目录（只读）。发送消息时只附一行界面附注，说明你在哪一页、看着什么、选中了什么。主讲可以新建主题或分支并切过去（这轮对话随之归到新主题下）、更新主题档案、保存课程、卡片、关系和经验文档、写代码并在本机内核里运行（可在设置里关闭自动运行）、开练习、记录薄弱点；快答只读，必要时转交主讲；练习教练只能写和运行自己那份笔记本。每个写操作在对话里显示为一行记录，可以查看或撤销。理解阶段、「我的理解」、你自己的解释、回顾自评和删除操作只归你。三条通道都用 OpenAI 兼容的工具调用。

「练习」是从主讲讲解分出去的练习分支：在主讲某条回复下点「开始练习」，练习教练（默认 CommandCode 的 `deepseek/deepseek-v4.1-flash`，在设置里可换）会在左边一步步带你写，右边是这次练习专属的实验笔记。教练每轮都能看到右侧代码的真实输出；代码块上的「放到右侧」只插入单元格，不自动运行。点「结束练习并复盘」后，整段练习记录（依据的讲解、全部对话、最终代码与输出）交给主讲复盘：主讲只按记录里的证据写出做到了什么、薄弱点和接下来的讲解重点，并直接讲下一步。复盘里的薄弱点自动记入学习画像，主讲、快答和练习教练之后每一轮都会参考；你可以在「练习」页把已克服的标记掉。每个主题同时只有一个进行中的练习。

当前主题可以开兴趣分支并返回主线。课程支持自己编写，或由主讲给出结构化建议后预览、显式采纳。主讲只为已经讲过、你也回应过的内容提建议。「即时答疑」不占用主讲通道；选中文字/代码后可直接询问。双方的下一轮问题会带上共享主题、相关卡片、真实实验输出与另一个通道的最近讨论。

实验笔记是真实 Jupyter Python 内核，不是模拟输出。每份 Notebook 独立保持变量，支持 Markdown/Python 格、自动保存、单格/全部执行、中断、重启、图片/表格/错误输出、运行源码快照与标准 `.ipynb` 导入导出。按 Shift+Enter 运行当前格，Tab 插入四空格；Ctrl+S 保存。代码在你的用户权限下运行，**不是操作系统安全沙箱**。导入 Notebook 不执行代码，也不把外部输出标成已验证；需本机重跑。

「知识卡」提供卡片和依赖树两种视图。关系有类型和理由，前置依赖禁止同类循环。「知识网络」把笔记和知识卡放在同一张图里：卡片之间是带类型的关系，笔记或卡片里写 `[[标题]]` 会连到同名笔记（优先）或同名知识卡；可按全部 / 只看笔记 / 只看知识卡筛选，拖动、缩放、点击节点打开，拖动后的位置在本次运行中保留。记录自己的解释、反例、疑问和实际实验；理解阶段由自己确认，不因 AI 输出或运行成功自动标为掌握。回顾由用户自评，按 1/3/7/14/30 天递增；不是经验证的记忆能力评分。

## 接口

浏览器界面只通过 Qt WebChannel `backend.request(JSON.stringify({method,...}))` 访问本机后端；返回 `{ok,data}` 或 `{ok:false,error}`。没有向局域网开放 HTTP 代码执行服务。事件从 `backend.event` 传输。

模型接口：`learn_settings[_save]`、`learn_connect`、`learn_new_tutor`、`learn_send`、`learn_cancel`、`learn_test_api`。练习：`learn_practice_start/send/end/get`、`learn_insight_resolve`。课程：`learn_topic_save`、`learn_focus`、`learn_lesson_save`、`learn_context`。卡片：`learn_card_save/delete`、`learn_evidence`、`learn_completed_runs`、`learn_relation/delete`、`learn_review`。候选：`learn_proposal_apply/dismiss`。Notebook：`nb_create/get`、`nb_cell_save/delete/move`、`nb_run`、`nb_interrupt/restart`、`nb_history/import/export`。整体快照 `learn_snapshot`，档案导出 `learn_export`。

主讲的课程建议使用 fenced `lattice` JSON（version=1），允许 lessons/cards/relations/cells。模型没有直写数据库工具，未知字段和不合法关系会拒绝；采纳为事务操作，可重复点击而不重复插入；不会自动执行 AI 生成的 Python。

## 数据、凭据和备份

默认数据：`~/.local/share/lattice/lattice.db`（支持 XDG_DATA_HOME）；学习实验工作目录在同目录 `learning/`。模型配置：`~/.config/lattice/providers.json`（支持 XDG_CONFIG_HOME），权限 0600；界面只知道是否有 Key，不接收已保存密钥；Key 也可以用环境变量 `DEEPSEEK_API_KEY`、`COMMANDCODE_API_KEY`、`OPENCODE_GO_API_KEY` 提供。导出 ZIP 包含数据库、知识结构 JSON、知识卡 Markdown 与 `.ipynb`，不包含凭据配置。实际使用模型时，所需学习上下文会发给你配置的模型服务，不能理解为“数据永不出网”。

恢复档案前退出所有 Lattice 窗口，备份整个数据目录，再把 ZIP 中的 lattice.db 放入新的空白 Lattice 数据目录。建议先用独立 XDG_DATA_HOME 启动验证，而非覆盖正在使用的 SQLite/WAL 文件。

## 验收

```bash
python3 -m pytest tests/ -q
python3 tests/runtime_smoke_v1.py
QT_QPA_PLATFORM=offscreen python3 tests/gui_probe_v1.py
```

旧版分栏 GUI 验收脚本 `tests/gui_learning_v1.py` 针对已移除的分栏交互，不能作为新版导航的验收入口。新版导航的 Qt 实际渲染与交互记录见 `docs/navigation-review/REPORT.md`。其他历史执行结果见 `docs/TEST_REPORT.md`。缺少真实 DeepSeek Key 时仅做本地 HTTP/SSE 协议联调，不能据此声称该账户已在线验证。Jupyter 做真实内核测试。


## 启动入口与平铺窗口
应用菜单中搜索「Lattice」，或运行 `lattice-learning`。点击左栏「折叠导航」可以腾出阅读空间，再次点击图标展开。Ctrl+J 打开「即时答疑」。深色/浅色主题可以随时切换。

导出 `.ipynb` 时，已经过期的输出会被省略，并在元数据中注明；原始运行记录仍保留在工作台。
