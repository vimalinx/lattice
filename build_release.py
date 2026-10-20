"""Reproducible local release; never includes credentials or personal databases."""
from pathlib import Path
import datetime, hashlib, importlib.metadata, json, platform, shutil, sqlite3, subprocess, sys, zipfile
R=Path(__file__).resolve().parent
D=R/'docs';D.mkdir(exist_ok=True)
E=D/'test-evidence';E.mkdir(exist_ok=True)
qa=Path('/tmp/lattice-learning-release-v1');gui=json.loads((qa/'result.json').read_text());assert not gui['errors'] and len(gui['checks'])==13
shutil.copy2(qa/'result.json',E/'gui-result.json')
for image in qa.glob('*.png'):shutil.copy2(image,E/image.name)
for name,cmd in [('unit',[sys.executable,'-m','pytest','-q','tests/test_learning_v1.py','tests/test_store.py']),('runtime',[sys.executable,'tests/runtime_smoke_v1.py'])]:
 proc=subprocess.run(cmd,cwd=R,text=True,capture_output=True,timeout=70)
 (E/(name+'.log')).write_text(proc.stdout+'\n'+proc.stderr)
 print(name.upper(),proc.returncode,proc.stdout[-1100:],flush=True)
 assert proc.returncode==0,name
versions={n:importlib.metadata.version(n) for n in ['PySide6','jupyter_client','ipykernel','httpx','numpy','matplotlib','pytest']}
(R/'requirements.txt').write_text('\n'.join(n+'=='+v for n,v in versions.items() if n!='pytest')+'\n')
(R/'requirements-dev.txt').write_text('-r requirements.txt\npytest=='+versions['pytest']+'\n')
(E/'environment.json').write_text(json.dumps({'python':platform.python_version(),'packages':versions},indent=2))
backup=Path.home()/'.local/share/lattice/backups/before-learning-v1-20261010-111942'
assert (backup/'source.tar.gz').exists() and (backup/'lattice.db').exists()
# Verify that the pre-existing data rows are unchanged; never print their contents.
old=sqlite3.connect('file:'+str(backup/'lattice.db')+'?mode=ro',uri=True)
cur=sqlite3.connect('file:'+str(Path.home()/'.local/share/lattice/lattice.db')+'?mode=ro',uri=True)
preserved={}
for table in ['notes','revisions','projects','experiments','experiment_runs','messages','tasks']:
 before=old.execute('SELECT * FROM '+table).fetchall();after=cur.execute('SELECT * FROM '+table).fetchall()
 preserved[table]={'original_rows':len(before),'current_rows':len(after),'all_original_rows_preserved':all(row in after for row in before)}
old.close();cur.close();assert all(v['all_original_rows_preserved'] for v in preserved.values())
(E/'preservation.json').write_text(json.dumps(preserved,indent=2))
readme=R/'README_LEARNING.md';s=readme.read_text();s=s.replace('python3 main.py','python3 run.py');s+='\n\n## 启动入口与平铺窗口\n应用菜单中搜索「Lattice」，或运行 `lattice-learning`。右上角「快速答疑 / 收起快答」可以调整阅读宽度；小窗口默认先收起快答。深色/浅色主题可以随时切换。\n\n导出 `.ipynb` 时，已经过期的输出会被省略，并在元数据中注明；原始运行记录仍保留在工作台。\n';readme.write_text(s)
report='''# Lattice Learning V1 · 实测报告

测试日期：2026-10-10。测试机器：vimalinxg16（Arch Linux / Wayland）。

## 结果

- 数据层与原有存储回归：20 项 pytest 测试通过。
- 运行层：12 项检查通过。其中 7 项执行真实 Jupyter，5 项使用本地 HTTP/SSE 测试服务，不冒充 DeepSeek 真实响应。
- 原生 Qt WebEngine 界面：13 项操作检查通过，9 张实际窗口截图；不是静态网页效果图。
- 原有笔记、修订、项目、旧实验、消息和任务的数据行均与升级前备份逐行核对，保留完整。详见 test-evidence/preservation.json。

## 覆盖内容

知识卡增改删、学习阶段、证据关联、回顾、带类型的关系、前置环检测、兴趣分支、持久化、上下文共享、建议预览和事务性采纳、非法引用回滚、不覆盖个人理解、API Key 不回传与权限、Notebook 导入导出、不可变运行历史与过期输出。

真实 Python 验证了变量跨格保存、实际 PNG 绘图、异常、批量出错停止、中断死循环、重启丢弃运行变量。快答接口验证了中文 SSE 分块、断流部分结果保留、HTTP 错误脱敏、取消中止等待中的网络读取、模型列表连接测试。

GUI 验证包含快答面板开合、兴趣分支、卡片保存、树与图谱、设置、编辑并实际运行代码。Hyprland 会管理窗口几何，截图以实际窗口为准，不把请求的 resize 数字冒充实际像素尺寸。

## 尚未验证与边界

没有使用用户的 DeepSeek API Key 调用官方服务；需要在模型连接页填入自己的 Base URL、模型名和 Key。连接测试检查 /models，不等同于真实生成测试。

Notebook 是本机 Python 执行，不是操作系统沙箱。关闭工作台会停止由本工作台启动的内核；重启后保留代码、输出和历史，但运行变量需要重新计算。

测试环境会输出 Jupyter TCP 未加密提醒及 Qt 退出时的 profile 清理提醒。上述实测均正常完成并以状态 0 退出；没有把这些警告隐藏或计为新的功能验证。

## 复测

`python3 -m pytest -q tests/test_learning_v1.py tests/test_store.py`

`python3 tests/runtime_smoke_v1.py`

在可用的 Wayland 桌面环境设置 XDG_RUNTIME_DIR、WAYLAND_DISPLAY、DBUS_SESSION_BUS_ADDRESS 后，使用 `QT_QUICK_BACKEND=software QTWEBENGINE_CHROMIUM_FLAGS=--disable-gpu python3 tests/gui_learning_v1.py`。再次测试请指定新的 LATTICE_QA_DIR，避免重复创建测试卡片。
'''
(D/'TEST_REPORT.md').write_text(report)
release=R/'releases';release.mkdir(exist_ok=True)
with zipfile.ZipFile(release/'lattice-learning-v1-source.zip','w',zipfile.ZIP_DEFLATED) as z:
 for p in R.rglob('*'):
  if not p.is_file():continue
  rel=p.relative_to(R)
  if any(x in rel.parts for x in ['node_modules','__pycache__','.git','.pytest_cache','releases','test-evidence']):continue
  if rel.parts[0] not in {'lattice','ui','tests','docs'} and p.name not in {'main.py','run.py','requirements.txt','requirements-dev.txt','README_LEARNING.md','install_upgrade.py','build_release.py'}:continue
  if p.name in {'gui_probe_v1.py'}:continue
  z.write(p,str(rel))
with zipfile.ZipFile(release/'lattice-learning-v1-validation.zip','w',zipfile.ZIP_DEFLATED) as z:
 for p in D.rglob('*'):
  if p.is_file():z.write(p,str(p.relative_to(D)))
launcher=Path.home()/'.local/bin/lattice-learning';launcher.parent.mkdir(parents=True,exist_ok=True)
assert not launcher.exists(),'Do not overwrite an existing launcher'
launcher.write_text('#!/bin/sh\nexec /usr/bin/python3 '+str(R/'run.py')+' "$@"\n');launcher.chmod(0o755)
desktop=Path.home()/'.local/share/applications/lattice-studio.desktop';desktop.parent.mkdir(parents=True,exist_ok=True)
assert not desktop.exists(),'Do not overwrite an existing desktop entry'
desktop.write_text('[Desktop Entry]\nType=Application\nName=Lattice · 双 AI 学习工作台\nComment=兴趣驱动的课程、实验与知识图谱\nExec=/usr/bin/python3 '+str(R/'run.py')+'\nPath='+str(R)+'\nIcon='+str(R/'ui/icon.svg')+'\nTerminal=false\nCategories=Education;Development;\nKeywords=lattice;codex;deepseek;jupyter;learning;\n')
for p in release.glob('*.zip'):print('RELEASE',p,p.stat().st_size,hashlib.sha256(p.read_bytes()).hexdigest(),flush=True)
print('READY_TO_LAUNCH',launcher,flush=True)
