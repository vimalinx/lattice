"""The bridge: separate windows and the tabs agents look into."""
from __future__ import annotations

from ..i18n import tr

import time
from PySide6.QtCore import QTimer
from .. import tools
from ..index import uid
from ..providers import AGENT_NAMES
from .. import host


class WindowsPart:
    # ---- panels in windows of their own -------------------------------------------------------------
    def rpc_window_open(self, params=None, title="", origin=None, state=None):
        """Take a panel out into a window of its own (to make it big, or put it on another screen), or a whole working
        state (state: its id). It works there as it did, agents still see it, and closing the window puts it back."""
        opened = self.lattice.setting("separate_windows") or {}
        if state:
            # A state is in one window at a time; asked again, that window comes to the front.
            for ident, entry in opened.items():
                if isinstance(entry, dict) and entry.get("state") == state and ident in self.parent().windows:
                    self.parent().raise_window(ident)
                    return {"window": ident}
            entry = {"state": str(state), "title": str(title or "")[:120]}
        elif isinstance(params, dict) and params.get("type"):
            entry = {"params": params, "title": str(title or "")[:120], "origin": origin if isinstance(origin, dict) else {}}
        else:
            raise ValueError(tr("没有要放进单独窗口的面板"))
        ident = uid()
        opened[ident] = entry
        self.lattice.set_setting("separate_windows", opened)
        self.parent().open_window(ident, str(title or "Lattice")[:120])
        return {"window": ident}

    def rpc_window_params(self, window):
        """What a separate window shows: a panel's parameters, or for a working state, the state as last saved."""
        entry = (self.lattice.setting("separate_windows") or {}).get(window) or {}
        if entry.get("state"):
            return {"state": entry["state"], "unit": self.saved_state(entry["state"])}
        return entry.get("params")

    def rpc_window_raise(self, window):
        self.parent().raise_window(window)
        return True

    def rpc_window_return(self, window):
        """Close a separate window: its panel goes back where it was in the main window."""
        self.parent().close_window(window)
        return True

    def rpc_window_title(self, window, title):
        self.parent().title_window(window, str(title or "")[:120])
        return True

    def rpc_open_in_main(self, params):
        """Something opened from a separate window opens in the main one."""
        self.announce({"type": "open_panel", "params": params})
        return True

    def window_closed(self, ident):
        opened = self.lattice.setting("separate_windows") or {}
        entry = opened.pop(ident, None)
        self.lattice.set_setting("separate_windows", opened)
        self.window_screens.pop(ident, None)
        self.thread_windows = {k: v for k, v in self.thread_windows.items() if v != ident}
        if entry and entry.get("state"):
            # The state goes back to the main window as that window last saved it.
            self.announce({"type": "window_closed", "window": ident, "state": entry["state"], "unit": self.saved_state(entry["state"])})
        elif entry:
            self.announce({"type": "window_closed", "window": ident, "params": entry["params"], "origin": entry.get("origin") or {}})

    def rpc_typing(self, path):
        self.edits[path] = self.last_write = time.monotonic()
        return True

    def typing(self, rel):
        files = [f for state in (self.screen, *self.window_screens.values()) for f in (state.get("mine") or {}).get("files") or []]
        return time.monotonic() - self.edits.get(rel, -99) < 10 or any(f.get("path") == rel and f.get("dirty") for f in files)

    # ---- every tab in the interface, for the agents to look into ----------------------------------------
    TAB_KINDS = {"file": tr("文件"), "book": tr("书"), "web": tr("网页"), "app": tr("应用"), "home": tr("开始页"), "map": tr("知识图"), "journal": tr("学习轨迹"), "review": tr("回顾"),
                 "library": tr("卡片库"), "memory": tr("记忆"), "noteinfo": tr("大纲与链接"), "skills": tr("技能商城"), "settings": tr("设置"),
                 "skillchange": tr("改技能"), "compare": tr("技能两版对比")}

    def tab_list(self, own=None):
        """Every tab open in the main window (in any workspace) and in the separate windows, each with the id that tab
        reads it by; `own` is the asking conversation's thread, whose own panel is left out."""
        out = []
        for window, state in ((None, self.screen), *self.window_screens.items()):
            for t in state.get("tabs") or []:
                if t.get("type") == "chat" and own and t.get("thread") == own:
                    continue
                kind = AGENT_NAMES.get(t.get("agent"), tr("对话")) if t.get("type") == "chat" else self.TAB_KINDS.get(t.get("type"), t.get("type"))
                out.append({**t, "id": f"{window}/{t['id']}" if window else t["id"], "kind": kind,
                            **({"window": (state.get("layout") or {}).get("title") or tr("单独窗口")} if window else {})})
        return out

    def tab_directory(self, own=None):
        """The tabs in brief, one line each, sent with every message to the quick answer."""
        tabs = self.tab_list(own)
        if not tabs:
            return tr("界面上的标签：（界面还没报告）")
        lines = []
        for t in tabs[:50]:
            ref = t.get("path") or t.get("url") or ""
            flags = [x for x in (tr("学习者正在用") if t.get("focused") else "", tr("在前台") if t.get("showing") and not t.get("focused") else "",
                                 tr("有没保存的修改") if t.get("dirty") else "", tr("在单独窗口「{0}」", t['window']) if t.get("window") else "",
                                 tr("在「{0}」工作状态", t['space']) if t.get("space") else "") if x]
            lines.append(f"- {t['id']} {t['kind']}「{t.get('title') or ''}」" + (f" {ref}" if ref and ref not in (t.get("title") or "") else "")
                         + (f"（{'，'.join(flags)}）" if flags else ""))
        more = tr("\n- 还有 {0} 个，用 tabs 看全部", len(tabs) - 50) if len(tabs) > 50 else ""
        return tr("界面上开着的标签（要看哪个的内容，用 tab 按 id 读；选中的文字已经附在上面）：\n") + str("\n".join(lines)) + str(more)

    def tab_find(self, ident, own=None):
        """A tab by its id, or else by its title or path."""
        ident = str(ident or "").strip()
        tabs = self.tab_list(own)
        found = next((t for t in tabs if t["id"] == ident), None) or \
            next((t for t in tabs if ident and ident in (t.get("title") or "", t.get("path") or "", t.get("url") or "")), None)
        if not found:
            raise ValueError(tr("界面上没有「{0}」这个标签；用 tabs 看现在开着哪些", ident))
        window, _, panel = found["id"].rpartition("/")
        return window or None, panel, found

    def ui_ask(self, event, done, wait=8000):
        """Ask the interface (the window `event["window"]` names, or the main one) for something only it has; done()
        gets its answer."""
        ident = uid()
        self.ui_waiters[ident] = done
        self.announce({**event, "request": ident})
        QTimer.singleShot(wait, lambda: self.ui_waiters.pop(ident, None) and done({"error": tr("界面没有响应")}))

    def screen_state(self):
        l = self.lattice
        topic = l.active_topic()
        # A panel the learner took out into a window of its own is on show too, often big, on a screen of its own.
        separate = [{"window_title": (state.get("layout") or {}).get("title"), "showing": (state.get("mine") or {}).get("files", []) +
                     (state.get("mine") or {}).get("other", []) + (state.get("ai") or {}).get("panels", [])} for state in self.window_screens.values()]
        return {**self.screen, **({"separate_windows": separate} if separate else {}),
                "conversation_topic": l.topic(topic)["title"] if topic else tr("默认对话（不属于任何主题）"),
                "running": [{"file": v["path"], "by": v["by"]} for v in self.runs.values()],
                "kernels": {k: v.get("state") for k, v in self.kernel_states.items()},
                "recent_runs": [{"at": e["at"][:16], "by": e["actor"], **{k: e["data"].get(k) for k in ("file", "cell", "state", "summary")}}
                                for e in l.journal("ran", limit=4)],
                "active_practices": [p for p in l.practices() if p["state"] == "active"],
                "agent_may_run_code": bool(self.config.read()["agent_auto_run"]), "sandbox": self.sandbox.available(), "today": tools.today(),
                # Facts about where things run, so an agent does not have to guess why something failed.
                "where_things_run": {"system": host.SYSTEM, "shell": host.shell_name(),
                                     "sandbox": tr("有：bubblewrap 隔离") if self.sandbox.isolated else tr("没有：AI 的命令和运行用学习者的权限直接运行"),
                                     "sandbox_network": (tr("能上互联网（经过 Lattice 的代理），连不了这台电脑和局域网") if self.config.read()["agent_network"]
                                                         else tr("学习者在设置里关掉了沙箱联网")) if self.sandbox.isolated else tr("能联网（没有沙箱）"),
                                     "install_network": True,
                                     "gpu": (tr("能用：shell 或 run 带 gpu=true") if self.gpu_ready() else tr("学习者在设置里关掉了显卡")
                                             if self.accel()["preferred"] != "cpu" else tr("这台电脑上没有能用来计算的显卡，只能用 CPU")),
                                     "accelerator": self.accel_brief(),
                                     "gpu_kernels": [state.get("path") for state in self.kernel_states.values() if state.get("gpu")]}}
