"""Seed a rich, disposable demo dataset and optionally launch an isolated
Lattice window against it (bypasses the single-instance lock like the GUI
test does, so your real data keeps running in parallel).

    python tests/seed_demo.py            # just (re)seed /tmp/lattice-demo
    python tests/seed_demo.py --launch   # seed + open the demo window
    python tests/seed_demo.py --dir /path/to/demo-home
"""
import os, sys, shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))

DEMO = Path(sys.argv[sys.argv.index('--dir') + 1]) if '--dir' in sys.argv else Path('/tmp/lattice-demo')
os.environ['XDG_DATA_HOME'] = str(DEMO / 'data')
os.environ['XDG_CONFIG_HOME'] = str(DEMO / 'config')
os.environ['LATTICE_VAULT'] = str(DEMO / 'vault')

from lattice.store import Store
from lattice.learning import LearningStore

for old in ('data', 'vault'):
    if (DEMO / old).exists():
        shutil.rmtree(DEMO / old)

store = Store(DEMO / 'vault')
learn = LearningStore(store)

# ---------- Notes with [[wikilinks]] -> note-link graph ----------
NOTES = [
    ("梯度下降", "沿着 [[损失函数]] 的负梯度方向更新参数。步长由 [[学习率]] 控制，也见 [[SGD与Adam]]。", "Knowledge"),
    ("损失函数", "把预测与目标的差距变成可优化的标量。常用 MSE / 交叉熵，配合 [[梯度下降]] 与 [[反向传播]]。", "Knowledge"),
    ("学习率", "η 太大会 [[过拟合]] 之外先震荡发散，太小收敛慢。和 [[损失函数]] 曲面形状强相关。", "Knowledge"),
    ("反向传播", "链式法则把 [[损失函数]] 的梯度逐层传回，喂给 [[梯度下降]]。", "Knowledge"),
    ("过拟合", "训练误差降、验证误差升。缓解：[[正则化]]、早停、更多数据。", "Knowledge"),
    ("正则化", "L1/L2 抑制权重幅度，对抗 [[过拟合]]。", "Knowledge"),
    ("SGD与Adam", "两种 [[梯度下降]] 变体：SGD 朴素稳定，Adam 自适应 [[学习率]]。", "Knowledge"),
    ("注意力机制草稿", "Q·K 相似度加权 V 的加性读出。详见 [[Transformer笔记]]。", "Knowledge"),
    ("Transformer笔记", "自注意力堆叠 + 位置编码。核心机制见 [[注意力机制草稿]]。", "Knowledge"),
    ("实验·学习率扫描", "在 [[实验笔记]] 里扫了 η ∈ {0.01,0.1,0.5,1.0}：0.1 收敛最稳，1.0 直接起飞。关联 [[学习率]]。", "Experiments"),
    ("今日复盘", "跑通了 [[实验·学习率扫描]]；明天把 [[Transformer笔记]] 整理成卡片。", "Daily"),
    ("阅读清单", "- [[梯度下降]] 经典推导\n- [[注意力机制草稿]] 待补全", "Home"),
]
note_ids = {}
for title, body, folder in NOTES:
    n = store.save_note({"title": title, "body": body, "folder": folder})
    note_ids[title] = n["id"]

# ---------- Topics & lessons ----------
t1 = learn.topic_save({"title": "一个数字怎样学习", "question": "如何让一个数字自己学会逼近答案？"})
t2 = learn.topic_save({"title": "扩散模型为什么能画画", "question": "噪声怎么一步步变成图像？"})
learn.focus(t1["id"])

LESSONS_T1 = [
    ("先看一个会改变的判断", "用一个数字 p 表示对结果的估计。", """先取 `p = 0.5`。

当新的样本结果是 1，估计应上调；看到 0 应下调。问题是：**一次该调多少？**

去实验笔记把 `eta` 从 0.1 改到 1.0，观察曲线是收敛还是起飞。

三个量的关系可以这样看：

```mermaid
graph LR
    A[观察样本 y] --> B[误差 e = y - p]
    B --> C{学习率 eta}
    C -->|小| D[平稳收敛]
    C -->|大| E[过冲震荡]
    D --> F[p 更新]
    E -.-> F
```
"""),
    ("eta 不是步长，是脾气", "理解学习率的直觉含义。", """同样的误差，`eta` 决定回应的激烈程度。

```mermaid
flowchart TB
    subgraph 小学习率
    A1[误差] --> B1[小幅修正] --> C1[慢但稳]
    end
    subgraph 大学习率
    A2[误差] --> B2[大幅修正] --> C2[来回跳过]
    end
```

试着在实验里画出不同 `eta` 下 `p` 的轨迹。""",),
    ("把规则写成代码", "把更新规则沉淀为可复用函数。", "把 `p = p + eta*(y-p)` 封成 `step(p,y,eta)`，然后批量跑 100 个样本看均值轨迹。"),
]
for i, (title, obj, body) in enumerate(LESSONS_T1):
    learn.lesson_save({"topic_id": t1["id"], "title": title, "objective": obj, "body": body,
                       "state": "done" if i == 0 else ("current" if i == 1 else "draft")})

LESSONS_T2 = [
    ("噪声是怎么被组织起来的", "前向过程：把图像逐步加噪。", "每步混入一点高斯噪声，几百步后图像变成纯噪声。这个过程有闭式解，可以直接跳到任意步。"),
    ("学会倒着走", "反向过程：训练网络逐步去噪。", "网络学习预测每一步加入的噪声，采样时从纯噪声出发逐步还原。"),
]
for title, obj, body in LESSONS_T2:
    learn.lesson_save({"topic_id": t2["id"], "title": title, "objective": obj, "body": body})

# ---------- Knowledge cards + relations ----------
CARDS = {
    "学习率": ("explained", "步长旋钮：控制每次沿梯度走多远"),
    "损失函数": ("explained", "把'猜得有多偏'变成一个数"),
    "梯度方向": ("explained", "损失下降最快的方向"),
    "参数更新": ("seen", "p ← p + eta·(y − p)"),
    "随机梯度": ("explained", "用小批样本估计全量梯度"),
    "批量梯度": ("seen", "全量数据算梯度，稳定但慢"),
    "动量": ("suggested", "给更新加惯性，冲出浅坑"),
    "过冲震荡": ("suggested", "步长过大时在谷底两侧来回跳"),
    "验证集": ("seen", "不参与训练的性能考场"),
    "学习曲线": ("explained", "训练/验证误差随步数的变化"),
    "过拟合": ("seen", "背下训练集却没学会规律"),
    "正则化": ("seen", "惩罚复杂度，抑制过拟合"),
    "早停": ("suggested", "验证误差回升时停止训练"),
    "残差": ("suggested", "预测与真实值之差"),
    "归一化输入": ("seen", "让各特征量纲一致，等长等权"),
}
card_ids = {}
for i, (title, (stage, underst)) in enumerate(CARDS.items()):
    c = learn.card_save({"title": title, "body": underst, "understanding": underst,
                         "question": "它是怎么影响收敛的？" if stage == "suggested" else "",
                         "stage": stage, "topic_id": t1["id"], "tags": ["优化", "demo"]})
    card_ids[title] = c["id"]

REL = [
    ("损失函数", "梯度方向", "prerequisite", "先有损失才能定义下降方向"),
    ("梯度方向", "参数更新", "prerequisite", "更新沿负梯度走"),
    ("学习率", "参数更新", "part_of", "eta 是更新公式里的系数"),
    ("随机梯度", "批量梯度", "contrasts", "估计 vs 精确"),
    ("动量", "参数更新", "applies_to", "在更新式上叠加惯性项"),
    ("学习率", "过冲震荡", "related", "eta 过大的典型后果"),
    ("正则化", "过拟合", "applies_to", "抑制过拟合的手段"),
    ("早停", "过拟合", "applies_to", "验证误差回升即停"),
    ("验证集", "早停", "prerequisite", "早停依据验证误差"),
    ("学习曲线", "过拟合", "related", "曲线分叉即过拟合信号"),
    ("残差", "损失函数", "part_of", "损失由残差聚合而成"),
    ("归一化输入", "学习率", "related", "量纲统一后 eta 更好调"),
    ("随机梯度", "动量", "related", "常一起出现"),
    ("参数更新", "学习曲线", "related", "每步更新产生曲线上的一个点"),
]
for a, b, kind, reason in REL:
    learn.relation_add(card_ids[a], card_ids[b], kind, reason)

# ---------- Tutor / flash conversations (mermaid + code block) ----------
threads = learn.threads(t1["id"])
store.append_message(threads["tutor_session"], "user", "学习率和梯度到底啥关系？我老是混。")
store.append_message(threads["tutor_session"], "assistant", """好问题。一句话：**梯度告诉你往哪走，学习率告诉你走多远。**

```mermaid
graph LR
    L[损失函数] -->|求导| G[梯度方向]
    G --> U[参数更新]
    E[学习率 eta] --> U
    U -->|重复| L
```

如果只看一个样本的更新，就是这条规则：

```python
p = 0.5            # 当前的估计
eta = 0.2          # 学习率
for y in [1, 1, 0, 1]:
    p = p + eta * (y - p)
    print(round(p, 3))
```

建议去实验笔记把 `eta` 改成 0.9 再跑一遍——你会看到 `p` 在目标值两侧来回跳，那就是"过冲"。""")

store.append_message(threads["flash_session"], "user", "eta 一般取多大？")
store.append_message(threads["flash_session"], "assistant", "没有通用值，常见起点是 0.01～0.3；在你的单变量实验里 0.1 收敛最快。看一眼学习曲线，震荡就调小、爬不动就调大。")

# ---------- Notebook ----------
nb = learn.notebook_create(t1["id"], "实验 001 · 学习率对比")
learn.cell_save({"notebook_id": nb["id"], "kind": "markdown",
                 "source": "## 观察 → 改变 → 解释\n先逐格执行，再把 `eta` 改成一个离谱的数（比如 1.5）。"})
learn.cell_save({"notebook_id": nb["id"], "kind": "code",
                 "source": "p = 0.5\neta = 0.2\ny = 1\np"})
learn.cell_save({"notebook_id": nb["id"], "kind": "code",
                 "source": "for i in range(8):\n    p = p + eta * (y - p)\n    print(f'step {i+1}: p = {p:.3f}')"})
learn.cell_save({"notebook_id": nb["id"], "kind": "markdown",
                 "source": "## 写下你的观察\n我改变了什么？结果变大了还是变小了？"})

snap = learn.snapshot()
print(f"demo home : {DEMO}")
print(f"notes     : {len(note_ids)} (link graph ready)")
print(f"topics    : {len(snap['topics'])} · lessons: {len(snap['all_lessons'])}")
print(f"cards     : {len(snap['cards'])} · relations: {len(snap['relations'])}")
print(f"notebook  : {len(learn.notebook(nb['id'])['cells'])} cells · messages: {len(snap['tutor_messages'])}+{len(snap['flash_messages'])}")
store.close()

if '--launch' in sys.argv:
    from PySide6.QtCore import Qt, QTimer
    from PySide6.QtWidgets import QApplication
    QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
    from main import MainWindow
    app = QApplication(sys.argv)
    w = MainWindow()
    w.setWindowTitle("Lattice · DEMO 数据")
    w.show()
    sys.exit(app.exec())
