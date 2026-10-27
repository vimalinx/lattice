#!/usr/bin/env python3
"""Lattice Studio: local AI + cognition workspace for Arch / Wayland."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

from PySide6.QtCore import Qt, QTimer, QUrl
from PySide6.QtGui import QDesktopServices, QIcon, QPixmap
from PySide6.QtNetwork import QLocalServer, QLocalSocket
from PySide6.QtWidgets import QApplication, QMainWindow
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView

from lattice.bridge import APP_HOME, Bridge
from lattice import appscheme

ROOT=Path(__file__).resolve().parent
# Apps get a scheme of their own; it has to be known before the application object exists.
appscheme.register()


class LatticePage(QWebEnginePage):
    def acceptNavigationRequest(self,url,kind,is_main_frame):
        if url.scheme() in ("http","https"):
            # A frame an app embeds (a video, a map) loads in place; a link followed goes to the browser.
            if not is_main_frame and kind!=QWebEnginePage.NavigationType.NavigationTypeLinkClicked:
                return True
            QDesktopServices.openUrl(url)
            return False
        if url.scheme()=="file":
            local=Path(url.toLocalFile()).resolve()
            return local.is_relative_to((ROOT/"ui").resolve())
        return super().acceptNavigationRequest(url,kind,is_main_frame)

    def javaScriptConsoleMessage(self,level,message,line,source):
        if level==QWebEnginePage.JavaScriptConsoleMessageLevel.ErrorMessageLevel:
            print(f"[Lattice JS] {message} @ {source}:{line}",file=sys.stderr)


class MainWindow(QMainWindow):
    def __init__(self,screenshot=None):
        super().__init__()
        self.setWindowTitle("Lattice — 理解、创造、持续生长")
        self.resize(1550,970)
        # Small floor lets the single-pane narrow layout engage on tiled screens.
        self.setMinimumSize(640,660)
        self.setStyleSheet("QMainWindow{background:#10141a}")
        icon=QIcon(str(ROOT/"ui"/"icon.svg"))
        self.setWindowIcon(icon)

        if screenshot:
            self.profile=QWebEngineProfile(self)
        else:
            self.profile=QWebEngineProfile("Lattice",self)
            self.profile.setPersistentStoragePath(str(APP_HOME/"web-profile"))
            self.profile.setCachePath(str(APP_HOME/"web-cache"))
        self.page=LatticePage(self.profile,self)
        self.view=QWebEngineView(self)
        self.view.setPage(self.page)
        self.setCentralWidget(self.view)
        self.bridge=Bridge(self)
        self.apps=appscheme.AppScheme(self.bridge,self)
        self.profile.installUrlSchemeHandler(appscheme.SCHEME,self.apps)
        self.app_guard=appscheme.AppGuard(self)
        self.profile.setUrlRequestInterceptor(self.app_guard)
        self.channel=QWebChannel(self.page)
        self.channel.registerObject("backend",self.bridge)
        self.page.setWebChannel(self.channel)
        # Remote access is on for local content because the apps (lattice-app://, a local scheme so this page may frame
        # them) use the network; this page itself stays off it through the CSP in index.html (default-src 'self'), and
        # the apps stay off this computer and the local network through appscheme.AppGuard.
        self.page.settings().setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls,True)
        # File-URL access must stay on: under Qt's per-file origin model the app's
        # own sibling file:// scripts count as other local URLs, and disabling this
        # flag stops index.html from loading them at all. Exfiltration is instead
        # blocked by the CSP connect-src allowlist in index.html, and kernel HTML
        # output is DOMPurify-sanitized before insertion.
        self.page.settings().setAttribute(QWebEngineSettings.WebAttribute.JavascriptCanOpenWindows,False)
        self.view.load(QUrl.fromLocalFile(str(ROOT/"ui"/"index.html")))
        if screenshot:
            self.view.loadFinished.connect(lambda ok:QTimer.singleShot(3500,lambda:self.save_screenshot(screenshot)))

    def save_screenshot(self,path):
        self.view.grab().save(str(path))
        print("LATTICE_SCREENSHOT",path,flush=True)
        QApplication.instance().quit()

    def closeEvent(self,event):
        self.bridge.shutdown()
        super().closeEvent(event)


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--screenshot",help="Capture the actual Qt window for visual verification")
    # parse_known_args: Qt's own flags (-platform offscreen, -style …) pass through.
    args,_=p.parse_known_args()
    QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
    app=QApplication(sys.argv)
    app.setApplicationName("Lattice Studio")
    app.setDesktopFileName("lattice-studio")
    # Single instance: a second launch asks the running window to raise itself
    # instead of splitting UI state across two processes (one store, one set
    # of API/Jupyter workers). --screenshot bypasses this for QA captures.
    server=None
    if not args.screenshot:
        probe=QLocalSocket()
        probe.connectToServer("lattice-studio")
        if probe.waitForConnected(400):
            probe.write(b"raise");probe.flush();probe.waitForBytesWritten(300)
            print("Lattice 已在运行：聚焦现有窗口。")
            sys.exit(0)
        # A refused connection means an abandoned socket, not a live instance.
        # Timeouts must never remove a potentially healthy server's socket.
        if probe.error() in (
            QLocalSocket.LocalSocketError.ServerNotFoundError,
            QLocalSocket.LocalSocketError.ConnectionRefusedError,
        ):
            QLocalServer.removeServer("lattice-studio")
        server=QLocalServer(app)
        if not server.listen("lattice-studio"):
            print("实例锁创建失败："+server.errorString(),file=sys.stderr)
            sys.exit(1)
    window=MainWindow(screenshot=args.screenshot)
    if server:
        def _raise():
            conn=server.nextPendingConnection()
            if conn:conn.readyRead.connect(lambda c=conn:(c.readAll(),window.showNormal(),window.raise_(),window.activateWindow()))
        server.newConnection.connect(_raise)
    window.show()
    sys.exit(app.exec())


if __name__=="__main__":
    main()
