"""Drives the real interface: the page Lattice loads, on its real bridge, in an offscreen window."""
import json, time

from PySide6.QtCore import QEventLoop, QTimer

import main

FILES = ["state", "core", "theme", "dock", "spaces", "editor", "blocks", "chat", "imports", "attach", "files", "notes", "reader", "books",
         "marks", "apps", "skillstore", "skillchange", "side", "panels", "popups", "app", "a11y", "i18n"]
NAMES = ["S", "Dock", "Chat", "Files", "openPanel", "closePanel", "activate", "float", "unfloat", "createSpace", "switchSpace", "closeSpace",
         "removeSpace", "sendToSpace", "spaceList", "visibleSpaces", "templateOf", "runUiOps", "restoreUi", "stackOf", "findPanel",
         "eachStack", "panelKey", "sendScreen", "tabList", "flushAll", "loadLayout", "unmountPanel", "renderDock", "panelTitle", "openFile",
         "dockSnapshot", "spaceWindows", "saveLayout", "sideOf", "setSideOpen", "sideOpen", "closeMenus", "rpc", "askAbout", "chatEvent", "renderChat", "ask", "modal", "closeModal", "toast", "splitOut"]


class Page(main.LatticePage):
    """Keeps what the page reports as errors, so a test fails on them."""
    def __init__(self, *args):
        super().__init__(*args)
        self.logged = []

    def javaScriptConsoleMessage(self, level, message, line, source):
        if level == main.QWebEnginePage.JavaScriptConsoleMessageLevel.ErrorMessageLevel:
            self.logged.append(f"{message} @ {source}:{line}")


class Workbench:
    made = 0

    def __init__(self, app):
        self.app = app
        original, main.LatticePage = main.LatticePage, Page
        try:
            self.window = main.MainWindow()
        finally:
            main.LatticePage = original
        self.window.resize(1500, 950)
        self.window.show()
        self.page = self.window.page
        self.bridge = self.window.bridge
        self.until("!!document.querySelector('.stack')", 40)

    def spin(self, seconds):
        loop = QEventLoop()
        QTimer.singleShot(int(seconds * 1000), loop.quit)
        loop.exec()

    def _raw(self, code):
        box, loop = [], QEventLoop()
        self.page.runJavaScript(code, lambda got: (box.append(got), loop.quit()))
        QTimer.singleShot(15000, loop.quit)
        loop.exec()
        if not box:
            raise TimeoutError("the page did not answer: " + code[:120])
        return box[0]

    def until(self, test, seconds=8):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if self._raw(f"!!({test})"):
                return
            self.spin(.04)
        raise TimeoutError("never became true: " + test)

    def js(self, body, seconds=20):
        """Run an async function body with the interface's names in scope; returns what it returns."""
        names = ",".join(NAMES)
        files = json.dumps(["./" + f + ".js" for f in FILES])
        code = """(()=>{window.__done=null;(async()=>{
         const L=Object.assign({},...await Promise.all(%s.map(f=>import(new URL(f,location.href).href))));
         {const {%s}=L;
          return await (async()=>{%s})();}
        })().then(v=>{window.__done=JSON.stringify({value:v===undefined?null:v});},e=>{window.__done=JSON.stringify({error:String(e?.stack||e)});});})()""" % (files, names, body)
        self._raw(code)
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            got = self._raw("window.__done")
            if got:
                result = json.loads(got)
                if "error" in result:
                    raise AssertionError(result["error"])
                return result["value"]
            self.spin(.02)
        raise TimeoutError("no answer: " + body[:200])

    def reset(self):
        self.page.logged.clear()
        self.js("""await flushAll();
         for(const pid of Object.keys(Dock.panels))unmountPanel(pid);
         S.states=[];S.ui.templates=[];S.ui.side={...S.ui.side,shut:false};Dock.spaces={};Dock.panels={};Dock.notice.clear();Dock.space=null;Dock.focus=null;Dock.into=null;
         for(const k of Object.keys(Dock.origin))delete Dock.origin[k];
         Dock.lastStack={ai:null,mine:null};Dock.lastMine=null;Dock.out={};
         loadLayout({});renderDock();""")
        self.spin(.1)

    def errors(self):
        return list(self.page.logged)

    def file(self, name, content="第一行\n第二行\n"):
        """A new file in the vault, by a name unused so far; its path."""
        Workbench.made += 1
        return self.bridge.rpc_file_create("code", f"{Workbench.made}-{name}", content)["path"]

    def close(self):
        self.window.bridge.closing = True
        self.window.close()
        self.spin(.2)


# A key pressed on whatever has the focus.
KEY = "const key=(k,o={})=>{const t=document.activeElement||document.body;t.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...o}));};const tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));"
