# Lattice Learning V1 · 实测报告

测试日期：2026-10-10。测试机器：vimalinxg16（Arch Linux / Wayland）。

## 结果

- 数据层、桥接层与原有存储回归：37 项 pytest 测试通过。
- 运行层：12 项检查通过。其中 7 项执行真实 Jupyter，5 项使用本地 HTTP/SSE 测试服务，不冒充 DeepSeek 真实响应。
- 原生 Qt WebEngine 界面：52 项操作断言全部通过，16 张实际窗口截图；不是静态网页效果图。
- Codex：通过本机登录状态和 ACP 完成真实回复；另完成「真实模型生成课程/知识卡/代码 → 结构化解析 → 明确采纳 → Jupyter 执行得到 42」整条链路。
- 原有笔记、修订、项目、旧实验、消息和任务的数据行均与升级前备份逐行核对，保留完整。详见 test-evidence/preservation.json。

## 覆盖内容

知识卡增改删、学习阶段、证据关联、回顾、带类型的关系、前置环检测、兴趣分支、持久化、上下文共享、建议预览和事务性采纳、非法引用回滚、不覆盖个人理解、API Key 不回传与权限、Notebook 导入导出、不可变运行历史与过期输出。

真实 Python 验证了变量跨格保存、实际 PNG 绘图、异常、批量出错停止、中断死循环、重启丢弃运行变量。快答接口验证了中文 SSE 分块、断流部分结果保留、HTTP 错误脱敏、取消中止等待中的网络读取、模型列表连接测试。

GUI 验证包含快答面板开合、兴趣分支、卡片保存、树与图谱、设置、编辑并实际运行代码。Hyprland 会管理窗口几何，截图以实际窗口为准，不把请求的 resize 数字冒充实际像素尺寸。

## 尚未验证与边界

没有使用用户的 DeepSeek API Key 调用官方服务；需要在模型连接页填入自己的 Base URL、模型名和 Key。连接测试检查 /models，不等同于真实生成测试。Codex 接入受本机登录、网络与账户可用额度影响。

Notebook 是本机 Python 执行，不是操作系统沙箱。关闭工作台会停止由本工作台启动的内核；重启后保留代码、输出和历史，但运行变量需要重新计算。

测试环境会输出 Jupyter TCP 未加密提醒及 Qt 退出时的 profile 清理提醒。上述实测均正常完成并以状态 0 退出；没有把这些警告隐藏或计为新的功能验证。

## 复测

`python3 -m pytest -q tests/test_learning_v1.py tests/test_store.py`

`python3 tests/runtime_smoke_v1.py`

在可用的 Wayland 桌面环境设置 XDG_RUNTIME_DIR、WAYLAND_DISPLAY、DBUS_SESSION_BUS_ADDRESS 后，使用 `QT_QUICK_BACKEND=software QTWEBENGINE_CHROMIUM_FLAGS=--disable-gpu python3 tests/gui_learning_v1.py`。脚本每次运行前会清空 QA 数据目录，可直接重复执行；如需隔离可另行指定 LATTICE_QA_DIR。

`python3 tests/learning_codex_smoke.py` 会发起真实 Codex 请求。其结果和所有 GUI 数据均写入隔离的临时目录，不写入个人知识库。
