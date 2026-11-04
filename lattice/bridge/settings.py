"""The bridge: settings."""
from __future__ import annotations

from ..i18n import tr

import os
from pathlib import Path
import zipfile
from PySide6.QtCore import QTimer
from .. import agents, tools
from ..index import uid
from ..providers import AGENT_NAMES, ApiWorker


class SettingsPart:
    # ---- settings ---------------------------------------------------------------------------------------------
    def rpc_settings(self):
        from ..runner import RUNNERS
        return {**self.config.public(), "vault_path": str(self.root), "env_vault": bool(os.environ.get("LATTICE_VAULT")),
                "default_runners": RUNNERS, "agent_names": AGENT_NAMES}

    def rpc_settings_save(self, config):
        return self.config.save(config)

    def rpc_test_api(self, agent="tutor", api=None):
        """Check a connection (or the one an agent uses): its model list, or one tiny request when it has none."""
        self.tests = [w for w in self.tests if w.isRunning()]
        conn = self.config.connection(api) if api else self.config.agent(agent)
        worker = ApiWorker(agent, "", conn, [], test=True)
        self.tests.append(worker)
        worker.event.connect(self.api_event)
        worker.start()
        return {"state": "testing"}

    def rpc_ui_save(self, ui, keep=None):
        """keep: settings a separate window does not own (the working states), left as the main window saved them."""
        if keep and isinstance(ui, dict):
            current = self.config.read()["ui"]
            ui = {**ui, **{k: current[k] for k in keep if k in current}}
        saved = self.config.save_ui(ui)
        # Every window shows these: the others hear of the change too.
        if getattr(self.parent(), "windows", None):
            self.announce({"type": "ui_saved", "ui": saved})
        return saved

    def set_ui(self, key, value):
        """A setting changed from here (an agent, told to by the learner). The interface saves its whole copy of these, so it
        has to hear of the change or the next save would put the old value back."""
        self.config.save_ui({**self.config.read()["ui"], key: value})
        self.announce({"type": "ui_setting", "key": key, "value": value})

    def ui_request(self, agent, thread, ops, done):
        """Ask the interface to carry out an agent's UI operations; done() gets what actually happened."""
        ident = uid()
        self.ui_waiters[ident] = done
        self.announce({"type": "ui", "request": ident, "ops": ops, "agent": agent, "thread": thread})
        QTimer.singleShot(20000, lambda: self.ui_waiters.pop(ident, None) and done({"error": tr("界面没有响应")}))

    def rpc_ui_done(self, request, result):
        waiter = self.ui_waiters.pop(request, None)
        if waiter:
            waiter(result)
        return bool(waiter)

    def rpc_agent_definition(self, name):
        shipped = agents.load(Path("/nonexistent"), name)
        return {"definition": agents.load(self.root, name), "shipped": shipped, "overridden": agents.overridden(self.root, name),
                "source": agents.source(self.root, name),
                "tools": [{"name": n, "description": t["description"]} for n, t in tools.TOOLS.items()]}

    def rpc_agent_save(self, name, history, tools, policy, blocks=True):
        self.commit_mine()
        rel = agents.save(self.lattice.vault, name, history, tools, policy, blocks)
        self.lattice.index.reindex(rel)
        self.lattice.vault.commit(f"改写了{AGENT_NAMES[name]}的规则", "me")
        return self.rpc_agent_definition(name)

    def rpc_agent_reset(self, name):
        self.commit_mine()
        rel = agents.reset(self.lattice.vault, name)
        self.lattice.index.unindex(rel)
        self.lattice.vault.commit(f"{AGENT_NAMES[name]}的规则恢复默认", "me")
        return self.rpc_agent_definition(name)

    def rpc_rules(self):
        from ..model import RULES
        return {"text": self.lattice.vault.read_text("AGENTS.md") if self.lattice.vault.path("AGENTS.md").exists() else "",
                "shipped": RULES.read_text(encoding="utf-8")}

    def rpc_rules_save(self, text):
        self.commit_mine()
        self.lattice.vault.write_text("AGENTS.md", text)
        self.lattice.vault.commit("改写了学习库的规矩", "me")
        return True

    def rpc_env_save(self, name, text):
        """The learner edits an environment's definition; the environment follows it on its next use."""
        rel = self.envs.definition_rel(name)
        self.commit_mine()
        self.lattice.vault.write_text(rel, text if text.endswith("\n") else text + "\n")
        self.lattice.index.reindex(rel)
        self.lattice.vault.commit(f"改了环境「{name}」的定义", "me")
        return self.rpc_env_info(name)

    def rpc_export(self, path=None):
        """The vault is the archive: every file as it is, without the index, git or machine-local state."""
        if not path:
            return None
        self.commit_mine()
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            for rel in self.lattice.vault.files():
                archive.write(self.lattice.vault.path(rel), rel)
        return str(path)

    def rpc_import_markdown(self, folder=None):
        """Copy a folder of Markdown notes into notes/<folder name>/; the original stays untouched."""
        if not folder:
            return None
        source = Path(folder).resolve()
        count = 0
        for path in sorted(source.rglob("*.md")):
            if any(p.startswith(".") or p in {"node_modules", ".git"} for p in path.relative_to(source).parts) or path.is_symlink() or path.stat().st_size > 1024 * 1024:
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            rel = f"notes/{source.name}/" + path.relative_to(source).as_posix()
            self.lattice.vault.write_text(rel, content)
            self.lattice.index.reindex(rel)
            count += 1
            if count >= 2000:
                break
        self.lattice.vault.commit(f"导入 {count} 篇 Markdown 笔记", "me")
        return {"count": count}
