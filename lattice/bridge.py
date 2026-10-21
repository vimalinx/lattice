"""Qt 6 bridge: native OS integrations and local persistence for notes and mounted folders."""
from __future__ import annotations

import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re

from PySide6.QtCore import QObject, Signal, Slot, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import QFileDialog

from .store import Store, APP_HOME

LOG = logging.getLogger("lattice")


def compact(items):
    return json.dumps(items,ensure_ascii=False,default=str)


class Bridge(QObject):
    event = Signal(str)

    def __init__(self, parent=None, store=None):
        super().__init__(parent)
        self._init_log()
        self.store = store or Store()

    @staticmethod
    def _init_log():
        if LOG.handlers:
            return
        APP_HOME.mkdir(parents=True, exist_ok=True)
        path = APP_HOME / "lattice.log"
        handler = RotatingFileHandler(path, maxBytes=1_000_000,
                                      backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        LOG.addHandler(handler)
        LOG.setLevel(logging.INFO)
        try:
            path.chmod(0o600)
        except OSError:
            pass

    @staticmethod
    def _scrub(payload):
        # Requests may carry credentials (learn_settings_save); never log them.
        return re.sub(r'"(api_key|key|token|password|secret)"\s*:\s*"[^"]*"',
                      r'"\1":"[REDACTED]"', str(payload))[:400]

    def announce(self, data):
        self.event.emit(compact(data))

    def state(self):
        return {
            "notes":self.store.list_notes(limit=300),
            "projects":self.store.projects(),
            "graph":self.store.graph(),
        }

    def _folder_picker(self, title):
        path=QFileDialog.getExistingDirectory(None,title,str(Path.home()),QFileDialog.Option.ShowDirsOnly)
        return path or None

    @Slot(str,result=str)
    def request(self, payload):
        try:
            req=json.loads(payload)
            method=req.pop("method")
            data=self.dispatch(method,req)
            return compact({"ok":True,"data":data})
        except Exception as e:
            LOG.exception("request failed: %s", self._scrub(payload))
            return compact({"ok":False,"error":str(e)})

    def dispatch(self, method, args):
        d=self.store
        if method=="bootstrap":
            return self.state()
        if method=="note":
            return d.get_note(args["id"])
        if method=="notes":
            return d.list_notes(args.get("query",""),args.get("folder",""))
        if method=="save_note":
            return d.save_note(args["note"], revise=not args.get("draft"))
        if method=="delete_note":
            return d.delete_note(args["id"])
        if method=="revisions":
            return d.revisions(args["id"])
        if method=="restore":
            return d.restore(args["id"],args["revision"])
        if method=="backlinks":
            return d.backlinks(args["id"])
        if method=="graph":
            return d.graph()
        if method=="project_add":
            path=args.get("path") or self._folder_picker("选择本地代码或笔记目录")
            if not path:
                return None
            return d.add_project(args.get("name") or Path(path).name,path)
        if method=="project_remove":
            return d.remove_project(args["id"])
        if method=="project_files":
            return d.project_files(args["id"],args.get("path",""))
        if method=="file_read":
            return d.file_read(args["id"],args["path"])
        if method=="file_write":
            return d.file_write(args["id"],args["path"],args["content"])
        if method=="file_open_external":
            path,_=d._safe_path(args["id"],args["path"])
            return QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))
        if method=="export":
            folder=self._folder_picker("选择 Markdown 导出目录")
            return d.export_markdown(folder) if folder else None
        if method=="import":
            folder=self._folder_picker("从已有 Markdown 笔记目录导入（仅复制，不修改原目录）")
            return self.import_markdown(folder) if folder else None
        if method=="open_folder":
            requested=Path(args.get("path") or str(APP_HOME)).resolve()
            allowed={APP_HOME.resolve()}
            allowed|={Path(p["path"]).resolve() for p in self.store.projects()}
            if requested not in allowed:
                raise ValueError("只能打开应用数据目录或已挂载的项目目录")
            return QDesktopServices.openUrl(QUrl.fromLocalFile(str(requested)))
        if method=="open_url":
            url=QUrl(args["url"])
            if url.scheme() not in ("https","http"):
                raise ValueError("不支持该外部链接")
            return QDesktopServices.openUrl(url)
        raise ValueError("未知操作："+str(method))

    def import_markdown(self, folder):
        root=Path(folder).resolve()
        skip={".git",".obsidian","node_modules",".venv","dist","build","__pycache__"}
        count=0
        for current, dirs, names in os.walk(root):
            dirs[:]=[x for x in dirs if x not in skip and not x.startswith(".")]
            for filename in names:
                if not filename.lower().endswith(".md"):
                    continue
                path=Path(current)/filename
                if path.is_symlink() or path.stat().st_size>1024*1024:
                    continue
                try:
                    content=path.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    continue
                relative=path.relative_to(root)
                parent=relative.parts[0] if len(relative.parts)>1 else "Imported"
                # Re-importing the same folder updates in place instead of
                # duplicating every note.
                note={"title":path.stem,"body":content,"folder":parent,"tags":["导入"]}
                old=self.store.db.execute("SELECT id FROM notes WHERE title=? AND folder=?",
                                          (path.stem,parent)).fetchone()
                if old:
                    note["id"]=old[0]
                self.store.save_note(note)
                count+=1
                if count>=1000:
                    break
            if count>=1000:
                break
        if count:
            self.store.emit("import",f"导入 {count} 篇 Markdown 笔记",str(root))
        return {"count":count}

    def shutdown(self):
        self.store.close()
