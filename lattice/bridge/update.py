"""The bridge: Lattice's own updates (how they are found and put in place is lattice/update.py)."""
from __future__ import annotations

from ..i18n import tr

import json
import shutil
import time
from PySide6.QtCore import QTimer, QUrl
from PySide6.QtGui import QDesktopServices
from .. import __version__, update
from .common import APP_HOME, LOG

UPDATES = APP_HOME / "updates"
SEEN = APP_HOME / "update.json"
# Once a day is plenty (GitHub answers a computer 60 times an hour).
EVERY = 20 * 3600


class UpdatePart:
    # ---- updates ----------------------------------------------------------------------------------------------
    def _update_init(self):
        """What the last check found; a download left from before is gone (a finished update, or one not applied)."""
        try:
            saved = json.loads(SEEN.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            saved = {}
        self.upd = {"checked": float(saved.get("checked") or 0), "release": saved.get("release"), "told": saved.get("told") or "",
                    "checking": False, "error": "", "phase": "", "got": 0, "total": 0, "file": None, "new": None, "cancel": False}
        shutil.rmtree(UPDATES, ignore_errors=True)
        if update.how() in ("windows-zip", "linux"):
            shutil.rmtree(update.staging(), ignore_errors=True)

    def start_update_checks(self):
        """Called by the program itself (not the tests): a check soon after it starts when the last one is a day old, then
        again whenever a day has gone by."""
        def due():
            if self.config.read()["update_check"] and time.time() - self.upd["checked"] > EVERY:
                self._update_check()
        QTimer.singleShot(15000, due)
        self.update_timer = QTimer(self)
        self.update_timer.timeout.connect(due)
        self.update_timer.start(3600 * 1000)

    def _update_save(self):
        try:
            SEEN.write_text(json.dumps({k: self.upd[k] for k in ("checked", "release", "told")}, ensure_ascii=False), encoding="utf-8")
        except OSError as exc:
            LOG.warning("update state not saved: %s", exc)

    def update_view(self):
        u, release = self.upd, self.upd["release"]
        fresh = bool(release and update.newer(release.get("version")))
        item = update.asset(release) if fresh else None
        return {"current": __version__, "how": update.how(), "auto": self.config.read()["update_check"], "checking": u["checking"],
                "checked": u["checked"] or None, "error": u["error"], "newer": fresh, "phase": u["phase"] if fresh else "",
                "got": u["got"], "total": u["total"], "size": (item or {}).get("size") or 0, "blocked": update.blocked(release) if fresh else "",
                "latest": {k: release.get(k) for k in ("version", "name", "notes", "page", "published")} if release else None,
                "releases": update.RELEASES}

    def _update_tell(self, tell=False):
        self.announce({"type": "update", "update": self.update_view(), "tell": tell})

    def _update_check(self, manual=False):
        if self.upd["checking"]:
            return
        self.upd.update(checking=True, error="")
        self._update_tell()

        def then(result):
            u = self.upd
            u["checking"] = False
            if isinstance(result, Exception):
                u["error"] = str(result)
                LOG.warning("update check failed: %s", result)
            else:
                if (u["release"] or {}).get("version") != result["version"]:
                    u.update(phase="", file=None, new=None)
                u.update(release=result, checked=time.time())
            version = (u["release"] or {}).get("version")
            # Told once of each new version when it is found by itself; asked for, it is shown where it was asked.
            tell = bool(not manual and version and update.newer(version) and u["told"] != version)
            if tell or (manual and version and update.newer(version)):
                u["told"] = version
            self._update_save()
            self._update_tell(tell)
        self.background(update.latest, then)

    def rpc_update_state(self):
        return self.update_view()

    def rpc_update_check(self):
        self._update_check(manual=True)
        return self.update_view()

    def rpc_update_download(self):
        """Fetch the new version and make it ready to put in place; the learner chooses when Lattice restarts for it."""
        u, release = self.upd, self.upd["release"]
        if not release or not update.newer(release.get("version")):
            raise ValueError(tr("已经是最新版本"))
        why = update.blocked(release)
        if why:
            raise ValueError(why)
        if u["phase"] in ("downloading", "preparing", "ready"):
            return self.update_view()
        kind, item = update.how(), update.asset(release)
        u.update(phase="downloading", got=0, total=int(item.get("size") or 0), error="", cancel=False)
        last = [0]

        def progress(got, total):
            u["got"] = got
            if got - last[0] >= max(total // 200, 1 << 20) or got == total:
                last[0] = got
                self._progress.emit({"type": "update_progress", "got": got, "total": total})

        def work():
            file = update.download(item, UPDATES, progress, lambda: u["cancel"])
            u["phase"] = "preparing"
            self._progress.emit({"type": "update_progress", "phase": "preparing"})
            return file, update.prepare(kind, file)

        def then(result):
            if isinstance(result, Exception):
                u.update(phase="" if u["cancel"] else "failed", error="" if u["cancel"] else str(result))
                if not u["cancel"]:
                    LOG.warning("update download failed: %s", result)
            else:
                u.update(phase="ready", file=result[0], new=result[1])
            self._update_tell()
        self.background(work, then)
        return self.update_view()

    def rpc_update_cancel(self):
        self.upd["cancel"] = True
        return True

    def rpc_update_apply(self):
        """Put the downloaded version in place: Lattice closes and the new one starts (on macOS its disk image opens, to
        drag over the old one)."""
        u = self.upd
        if u["phase"] != "ready" or not u["file"]:
            raise ValueError(tr("新版本还没下载好"))
        kind = update.how()
        if kind == "macos":
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(u["file"])))
            return {"closing": False}
        update.hand_over(kind, u["file"], u["new"], UPDATES)
        LOG.info("update to %s handed over (%s)", u["release"]["version"], kind)
        window = self.parent()
        if window is not None:
            # What is being typed in any window is written out first, as when a separate window closes.
            for page in [window.page] + [w.page for w in getattr(window, "windows", {}).values()]:
                page.runJavaScript("window.flushLayout?.();window.flushAll?.()")
            QTimer.singleShot(800, window.close)
        return {"closing": True}
