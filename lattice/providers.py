"""Machine-local configuration and the OpenAI-compatible API lanes. Credentials never cross WebChannel.

providers.json holds everything that belongs to this machine rather than to the
learning vault: API connections and keys, which model each agent uses, the web
search backend, run timeouts and runner overrides.
"""
from __future__ import annotations

import asyncio
import copy
import json
import os
from pathlib import Path
import re
import queue
import threading
import time
from urllib.parse import urlsplit

import httpx
import logging
from PySide6.QtCore import QThread, Signal

LOG = logging.getLogger("lattice")

# Connections are the learner's own list: each one is an OpenAI-compatible Chat Completions endpoint with its own key,
# started from a preset below or written from scratch. "{session}" in a header value is replaced by the Lattice thread
# id (OpenCode Go routes and caches by x-opencode-session and rejects requests without it). auth says how the key is
# sent: bearer (Authorization: Bearer <key>), header (the key in a named header, e.g. Azure's api-key) or none (local
# servers). chat_path and models_path are joined to the base URL and may carry a query (Azure's api-version).
def _preset(label, base_url, model="", env="", auth="bearer", headers=None, extra_body=None, note="", chat_path="chat/completions",
            models_path="models", auth_header="", group="云服务", key_url=""):
    return {"label": label, "base_url": base_url, "model": model, "env": env, "auth": auth, "auth_header": auth_header, "key_url": key_url,
            "headers": headers or {}, "extra_body": extra_body or {}, "chat_path": chat_path, "models_path": models_path, "note": note, "group": group}


PRESETS = {
    "deepseek": _preset("DeepSeek", "https://api.deepseek.com", "deepseek-chat", "DEEPSEEK_API_KEY", extra_body={"thinking": {"type": "disabled"}}),
    "commandcode": _preset("CommandCode", "https://api.commandcode.ai/provider/v1", "deepseek/deepseek-v4.1-flash", "COMMANDCODE_API_KEY", group="聚合"),
    "opencode": _preset("OpenCode Go", "https://opencode.ai/zen/go/v1", "deepseek-v4.1-flash", "OPENCODE_GO_API_KEY",
                        headers={"x-opencode-session": "{session}"}, group="聚合"),
    "openrouter": _preset("OpenRouter", "https://openrouter.ai/api/v1", "openrouter/auto", "OPENROUTER_API_KEY", group="聚合"),
    "siliconflow": _preset("硅基流动 SiliconFlow", "https://api.siliconflow.cn/v1", "", "SILICONFLOW_API_KEY", group="聚合"),
    "openai": _preset("OpenAI", "https://api.openai.com/v1", "", "OPENAI_API_KEY"),
    "anthropic": _preset("Anthropic Claude", "https://api.anthropic.com/v1", "", "ANTHROPIC_API_KEY", note="走 Anthropic 的 OpenAI 兼容接口"),
    "gemini": _preset("Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "", "GEMINI_API_KEY", note="走 Gemini 的 OpenAI 兼容接口"),
    "xai": _preset("xAI Grok", "https://api.x.ai/v1", "", "XAI_API_KEY"),
    "mistral": _preset("Mistral", "https://api.mistral.ai/v1", "", "MISTRAL_API_KEY"),
    "groq": _preset("Groq", "https://api.groq.com/openai/v1", "", "GROQ_API_KEY"),
    "together": _preset("Together AI", "https://api.together.xyz/v1", "", "TOGETHER_API_KEY", group="聚合"),
    "fireworks": _preset("Fireworks AI", "https://api.fireworks.ai/inference/v1", "", "FIREWORKS_API_KEY", group="聚合"),
    "perplexity": _preset("Perplexity", "https://api.perplexity.ai", "", "PERPLEXITY_API_KEY", models_path=""),
    "moonshot": _preset("月之暗面 Kimi", "https://api.moonshot.cn/v1", "", "MOONSHOT_API_KEY", group="国内"),
    "zhipu": _preset("智谱 GLM", "https://open.bigmodel.cn/api/paas/v4", "", "ZHIPUAI_API_KEY", group="国内"),
    "dashscope": _preset("阿里云百炼 通义千问", "https://dashscope.aliyuncs.com/compatible-mode/v1", "", "DASHSCOPE_API_KEY", group="国内"),
    "ark": _preset("火山方舟 豆包", "https://ark.cn-beijing.volces.com/api/v3", "", "ARK_API_KEY", group="国内", note="模型名填推理接入点 ID 或模型 ID"),
    "minimax": _preset("MiniMax", "https://api.minimaxi.com/v1", "", "MINIMAX_API_KEY", group="国内"),
    "stepfun": _preset("阶跃星辰 StepFun", "https://api.stepfun.com/v1", "", "STEPFUN_API_KEY", group="国内"),
    "azure": _preset("Azure OpenAI", "https://<资源名>.openai.azure.com/openai/deployments/<部署名>", "", "AZURE_OPENAI_API_KEY", auth="header",
                     auth_header="api-key", chat_path="chat/completions?api-version=2024-10-21", models_path="", note="把 Base URL 里的资源名和部署名换成你的"),
    "ollama": _preset("Ollama（本机）", "http://127.0.0.1:11434/v1", "", auth="none", group="本机"),
    "lmstudio": _preset("LM Studio（本机）", "http://127.0.0.1:1234/v1", "", auth="none", group="本机"),
    "vllm": _preset("vLLM / 自建服务", "http://127.0.0.1:8000/v1", "", auth="none", group="本机"),
    "custom": _preset("完全自定义", "", "", group="自定义", note="所有字段自己填"),
}
# Where to get a key, for the providers whose page we know.
KEY_URLS = {"deepseek": "https://platform.deepseek.com/api_keys", "openrouter": "https://openrouter.ai/keys", "siliconflow": "https://cloud.siliconflow.cn/account/ak", "openai": "https://platform.openai.com/api-keys", "anthropic": "https://console.anthropic.com/settings/keys", "gemini": "https://aistudio.google.com/apikey", "xai": "https://console.x.ai", "mistral": "https://console.mistral.ai/api-keys", "groq": "https://console.groq.com/keys", "moonshot": "https://platform.moonshot.cn/console/api-keys"}
for _id, _url in KEY_URLS.items():
    PRESETS[_id]["key_url"] = _url
CONN_FIELDS = {"preset", "label", "base_url", "model", "headers", "extra_body", "auth", "auth_header", "chat_path", "models_path", "key_env", "models"}
AGENT_NAMES = {"tutor": "主会话", "flash": "快答", "coach": "练习教练", "organizer": "整理"}
WEB_BACKENDS = {"duckduckgo": "DuckDuckGo（无需 Key）", "searxng": "SearXNG（自建地址）", "brave": "Brave Search API", "tavily": "Tavily API"}
WEB_SECRETS = {"brave_key", "tavily_key"}
DEFAULTS = {
    "apis": {},
    "agents": {"tutor": {"api": "commandcode", "model": "deepseek/deepseek-v4.1-flash", "max_tokens": 16000},
               "flash": {"api": "commandcode", "model": "deepseek/deepseek-v4.1-flash-fast", "max_tokens": 4000},
               "coach": {"api": "commandcode", "model": "deepseek/deepseek-v4.1-flash", "max_tokens": 16000},
               "organizer": {"api": "commandcode", "model": "deepseek/deepseek-v4.1-flash", "max_tokens": 8000}},
    "timeout": 120, "temperature": 0.35,
    # Seconds a notebook cell, a file run and an agent's shell command may take.
    "kernel_timeout": 120, "run_timeout": 120, "shell_timeout": 60,
    # Agents run code and shell commands in the sandbox, never with the learner's own permissions.
    "agent_auto_run": True,
    # Closing a file the learner just wrote hands it to the organizer.
    "agent_auto_organize": True,
    # A missing Python module is installed into the vault's environment and the run repeated.
    "auto_install": True,
    "web": {"search": "duckduckgo", "searxng_url": "", "brave_key": "", "tavily_key": ""},
    # File extension -> command template overriding lattice.runner.RUNNERS.
    "runners": {},
    # Extra read-only paths visible inside the sandbox (toolchains installed under home).
    "sandbox_paths": [],
    # Where the vault lives when LATTICE_VAULT is not set; empty means ~/Lattice. Takes effect on restart.
    "vault": "",
    # Seconds the learner pauses before their edits are committed.
    "commit_idle": 30,
    # Everything about the interface: appearance, the sidebar, workspaces.
    # zoom: each kind of panel's default size ("chat:tutor", "file", ...); a window can still set its own.
    # spaces: the learner's changes to the built-in workspaces and their own ones; side.closed: workspaces whose sidebar is folded.
    "ui": {"theme": "dark", "thinking": "collapsed", "md_mode": "live", "font_size": 14.5, "code_font_size": 13, "line_height": 1.8, "read_width": 42, "zoom": {"chat:tutor": 1.1},
           "density": "comfortable", "send_key": "enter",
           "selection_popup": True, "activity_plus": False, "side": {"width": 270, "closed": []}, "spaces": []},
}
AGENT_FIELDS = ("api", "model", "max_tokens", "temperature")
# Settings saved by earlier versions under flat names.
LEGACY = {"tutor": "tutor", "flash": "flash", "practice": "coach"}


# ---- LocalRouter: the machine's own gateway, an optional connection ----------------------------------------------------
# Read from its own file (never mixed into providers.json), as every program on this machine does: base_urls are probed
# in order with GET /healthz and the first that answers ok wins; the token comes from token_file (one line, mode 0600) and
# only its path is stored. When the file is missing, switched off or nothing answers, Lattice uses its other connections.
LOCALROUTER = "localrouter"
LOCALROUTER_URLS = ["http://127.0.0.1:8317", "http://127.0.0.1:29317"]


def LOCALROUTER_FILE():
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "lattice/localrouter.toml"


def token_of(path):
    """The token in a LocalRouter token file, or "" when the file is missing, readable by others or not one line."""
    try:
        file = Path(str(path or "")).expanduser()
        if not path or not file.is_file() or file.stat().st_mode & 0o077:
            return ""
        lines = [l for l in file.read_text(encoding="utf-8").splitlines() if l.strip()]
        return lines[0].strip() if len(lines) == 1 else ""
    except OSError:
        return ""


def localrouter():
    """The LocalRouter connection described by localrouter.toml, or None."""
    try:
        import tomllib
        data = tomllib.loads(LOCALROUTER_FILE().read_text(encoding="utf-8"))
    except (OSError, ValueError, ImportError):
        return None
    lr = data.get("localrouter") if isinstance(data.get("localrouter"), dict) else {}
    if not lr or lr.get("enabled") is False:
        return None
    llm = lr.get("llm") if isinstance(lr.get("llm"), dict) else {}
    urls = [str(u).rstrip("/") for u in (lr.get("base_urls") or LOCALROUTER_URLS) if str(u).startswith(("http://", "https://"))]
    return {"preset": LOCALROUTER, "label": "LocalRouter", "base_url": str(llm.get("base_url") or "").rstrip("/"), "base_urls": urls or LOCALROUTER_URLS,
            "token_file": str(lr.get("token_file") or ""), "model": str(llm.get("model") or ""), "headers": {}, "extra_body": {}, "auth": "bearer",
            "auth_header": "", "chat_path": "chat/completions", "models_path": "models", "key_env": "", "models": [], "api_key": "",
            "timeout": int(lr.get("timeout_seconds") or 30)}


_probe = {}


def localrouter_base(conn):
    """The /v1 base to call: llm.base_url when set, else the first base_url whose /healthz answers ok (remembered a minute)."""
    if conn.get("base_url"):
        return conn["base_url"]
    key = tuple(conn.get("base_urls") or LOCALROUTER_URLS)
    hit = _probe.get(key)
    if hit and time.monotonic() - hit[0] < 60:
        return hit[1]
    for base in key:
        try:
            r = httpx.get(base + "/healthz", timeout=1.5)
            if r.status_code == 200 and r.json().get("ok") is True:
                _probe[key] = (time.monotonic(), base + "/v1")
                return base + "/v1"
        except (httpx.HTTPError, ValueError):
            continue
    raise ValueError("LocalRouter 没有响应（试过 " + "、".join(key) + "）")


def _connection(preset, own=None):
    base = PRESETS[preset]
    conn = {"preset": preset, "label": base["label"] if preset != "custom" else "自定义", "key_env": base["env"], "models": [],
            **{k: copy.deepcopy(base[k]) for k in ("base_url", "model", "headers", "extra_body", "auth", "auth_header", "chat_path", "models_path")},
            "api_key": ""}
    conn.update({k: v for k, v in (own or {}).items() if k in CONN_FIELDS | {"api_key"}})
    return conn


def _changed(ident, conn):
    """Only what the learner filled in or changed is written to providers.json; an untouched provider stays a preset."""
    if ident not in PRESETS or ident == "custom":
        return conn
    plain = _connection(ident)
    return {k: v for k, v in conn.items() if k == "preset" or v != plain.get(k)}


def model_label(model):
    """Short display name: the model id without its vendor prefix."""
    return str(model).rsplit("/", 1)[-1] or "未选择模型"


class Config:
    def __init__(self, path=None):
        self.path = Path(path) if path else Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "lattice/providers.json"

    def read(self):
        result = copy.deepcopy(DEFAULTS)
        saved = {}
        try:
            if self.path.exists():
                saved = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
            # A hand-edited or truncated config must not break the whole app state.
            LOG.warning("无法读取 providers.json，回退默认配置: %s", exc)
        saved = saved if isinstance(saved, dict) else {}
        for old, agent in LEGACY.items():
            for field in ("api", "model", "max_tokens"):
                if old + "_" + field in saved:
                    result["agents"][agent][field] = saved[old + "_" + field]
        for key, value in saved.items():
            if key == "ui" and isinstance(value, dict):
                result["ui"].update(value)
            elif key in ("agents", "web") and isinstance(value, dict):
                for name, part in value.items():
                    if key == "agents" and name in result["agents"] and isinstance(part, dict):
                        result["agents"][name].update({k: v for k, v in part.items() if k in AGENT_FIELDS})
                    elif key == "web" and name in result["web"]:
                        result["web"][name] = part
            elif key in DEFAULTS and key not in ("agents", "web", "ui"):
                result[key] = value
        saved_apis = result["apis"] if isinstance(result["apis"], dict) else {}
        result["apis"] = {}
        # Every provider is always listed, filled in or not; then the learner's own custom connections.
        idents = [k for k in PRESETS if k != "custom"] + [k for k, v in saved_apis.items() if (k not in PRESETS or k == "custom") and isinstance(v, dict)
                                                           and (k != "custom" or v.get("base_url") or v.get("api_key"))]
        for ident in idents:
            own = saved_apis.get(ident) if isinstance(saved_apis.get(ident), dict) else {}
            if ident == LOCALROUTER:
                continue
            # A connection saved by an earlier version is keyed by its preset's name.
            preset = own.get("preset") if own.get("preset") in PRESETS else ident if ident in PRESETS else "custom"
            result["apis"][ident] = _connection(preset, own)
        local = localrouter()
        if local:
            result["apis"][LOCALROUTER] = local
        return result

    def key(self, api, config=None):
        config = config or self.read()
        conn = config["apis"].get(api) or {}
        if conn.get("auth") == "none":
            return "-"
        if api == LOCALROUTER:
            return token_of(conn.get("token_file"))
        env = conn.get("key_env")
        return conn.get("api_key") or (os.environ.get(env, "") if env else "")

    def agent(self, name, config=None, use=None):
        """Everything one agent's API lane needs to send a request, key included. `use` swaps in another
        connection and model for one request (a window can pick its own model)."""
        config = config or self.read()
        lane = config["agents"][name]
        if isinstance(use, dict) and use.get("model"):
            lane = {**lane, "model": str(use["model"]).strip()[:200], **({"api": use["api"]} if use.get("api") in config["apis"] else {})}
        api = lane["api"] if lane["api"] in config["apis"] else next(iter(config["apis"]), "")
        if not api:
            raise ValueError("还没有任何模型连接，请先在设置的「模型连接」里添加一个")
        conn, notice = config["apis"][api], ""
        if api == LOCALROUTER:
            try:
                conn = {**conn, "base_url": localrouter_base(conn)}
            except ValueError as exc:
                # LocalRouter is optional: fall back to another connection that has a key, and say so once.
                other = next((k for k in config["apis"] if k != LOCALROUTER and self.key(k, config) and config["apis"][k].get("model")), None)
                if not other:
                    raise
                notice = f"{exc}，这次改用「{config['apis'][other]['label']}」"
                api, conn = other, config["apis"][other]
                lane = {**lane, "model": conn["model"]}
        temperature = lane.get("temperature")
        return {**conn, "api": api, "label": conn["label"], "api_key": self.key(api, config), "model": lane["model"] or conn.get("model", ""),
                "max_tokens": lane["max_tokens"], "timeout": config["timeout"], "notice": notice,
                "temperature": config["temperature"] if temperature in (None, "") else float(temperature)}

    def connection(self, api, config=None):
        """A connection on its own, for testing it before any agent uses it."""
        config = config or self.read()
        if api not in config["apis"]:
            raise ValueError("没有这个连接")
        conn = config["apis"][api]
        if api == LOCALROUTER:
            conn = {**conn, "base_url": localrouter_base(conn)}
        return {**conn, "api": api, "api_key": self.key(api, config), "max_tokens": 16, "timeout": config["timeout"], "temperature": 0}

    def remember_models(self, api, models):
        """The model list a connection reported, kept to offer its names when picking a model."""
        updated = self.read()
        if api in updated["apis"] and api != LOCALROUTER:
            updated["apis"][api]["models"] = sorted({str(m) for m in models if m})[:500]
            self._write(updated)

    def public(self):
        # Only known keys cross the bridge; keys never do.
        raw = self.read()
        result = {k: copy.deepcopy(raw[k]) for k in DEFAULTS if k not in ("apis", "agents", "web")}
        result["apis"] = []
        for ident, conn in raw["apis"].items():
            saved, env = bool(conn.get("api_key")), conn.get("key_env") or ""
            has_env = bool(env and os.environ.get(env))
            if conn.get("auth") == "none":
                source, has = "不需要 Key", True
            elif ident == LOCALROUTER:
                has = bool(token_of(conn.get("token_file")))
                source = ("Token 文件 " + str(conn.get("token_file"))) if has else "Token 文件不可用（运行 lr connect lattice）"
            else:
                has, source = saved or has_env, "本机配置" if saved else ("环境变量 " + env) if has_env else "尚未配置"
            result["apis"].append({"id": ident, **{k: copy.deepcopy(conn.get(k)) for k in CONN_FIELDS}, "default_model": conn.get("model", ""),
                                   "has_key": has, "key_source": source, "note": PRESETS.get(conn.get("preset"), {}).get("note", ""),
                                   "key_url": PRESETS.get(conn.get("preset"), {}).get("key_url", ""), "group": "本机" if ident == LOCALROUTER else PRESETS.get(conn.get("preset"), {}).get("group", "自定义"),
                                   "managed": ident == LOCALROUTER, **({"base_urls": conn.get("base_urls")} if ident == LOCALROUTER else {})})
        result["presets"] = [{"id": k, "label": v["label"], "group": v["group"], "base_url": v["base_url"], "note": v["note"], "auth": v["auth"]} for k, v in PRESETS.items()]
        result["agents"] = {name: {**lane, "title": AGENT_NAMES[name], "label": model_label(lane["model"]), "ready": lane["api"] in raw["apis"] and bool(self.key(lane["api"], raw))}
                            for name, lane in raw["agents"].items()}
        result["web"] = {k: v for k, v in raw["web"].items() if k not in WEB_SECRETS}
        result["web"].update({k: bool(raw["web"].get(k)) for k in WEB_SECRETS})
        result["web_backends"] = WEB_BACKENDS
        result["localrouter"] = {"config": str(LOCALROUTER_FILE()), "found": LOCALROUTER in raw["apis"]}
        return result

    def save(self, changes):
        if not isinstance(changes, dict):
            raise ValueError("配置必须是对象")
        unexpected = set(changes) - set(DEFAULTS)
        if unexpected:
            raise ValueError("未知配置项：" + ", ".join(unexpected))
        updated = self.read()
        for key, val in changes.items():
            if key == "agents":
                if not isinstance(val, dict) or set(val) - set(AGENT_NAMES):
                    raise ValueError("未知的 AI")
                for name, part in val.items():
                    updated["agents"][name].update({k: v for k, v in part.items() if k in AGENT_FIELDS})
            elif key == "web":
                if not isinstance(val, dict) or set(val) - set(DEFAULTS["web"]) - {"clear"}:
                    raise ValueError("联网设置含不支持的字段")
                for k, v in val.items():
                    if k in WEB_SECRETS and not v:
                        continue  # an empty secret field keeps the saved one
                    if k != "clear":
                        updated["web"][k] = str(v).strip()
                for k in val.get("clear") or []:
                    if k in WEB_SECRETS:
                        updated["web"][k] = ""
            elif key != "apis":
                updated[key] = val
        api_changes = changes.get("apis", {})
        if not isinstance(api_changes, dict):
            raise ValueError("模型连接的改动应为对象")
        for ident, change in api_changes.items():
            if ident == LOCALROUTER:
                raise ValueError("LocalRouter 连接由 localrouter.toml 管理，在那里改")
            if not re.fullmatch(r"[\w.-]{1,40}", str(ident)):
                raise ValueError("连接的标识只能用字母、数字、下划线、点和横线")
            if change is None:
                updated["apis"].pop(ident, None)
                continue
            if not isinstance(change, dict) or set(change) - CONN_FIELDS - {"api_key", "clear_key"}:
                raise ValueError("模型连接含不支持的字段")
            if ident not in updated["apis"]:
                preset = change.get("preset") if change.get("preset") in PRESETS else "custom"
                updated["apis"][ident] = _connection(preset, {"label": "自定义连接"} if preset == "custom" else None)
            conn = updated["apis"][ident]
            conn.update({k: v for k, v in change.items() if k in CONN_FIELDS})
            if change.get("clear_key"):
                conn["api_key"] = ""
            elif change.get("api_key"):
                conn["api_key"] = str(change["api_key"]).strip()
        self._check(updated)
        self._write(updated)
        return self.public()

    def save_ui(self, ui):
        """The interface's own preferences, saved as one object (appearance, sidebar, workspaces)."""
        if not isinstance(ui, dict) or len(json.dumps(ui, ensure_ascii=False)) > 4_000_000:
            raise ValueError("界面设置应为不超过 4MB 的对象")
        updated = self.read()
        updated["ui"] = {**DEFAULTS["ui"], **ui}
        self._write(updated)
        return updated["ui"]

    def _write(self, updated):
        # The LocalRouter connection is read from localrouter.toml each time, never copied into providers.json.
        apis = {k: _changed(k, v) for k, v in updated.get("apis", {}).items() if k != LOCALROUTER}
        updated = {**updated, "apis": {k: v for k, v in apis.items() if len(v) > 1 or k not in PRESETS}}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps(updated, ensure_ascii=False, indent=2))
            os.replace(tmp, self.path)
            self.path.chmod(0o600)
        except Exception:
            tmp.unlink(missing_ok=True)
            raise

    @staticmethod
    def _check(updated):
        for ident, api in updated["apis"].items():
            if ident == LOCALROUTER:
                continue
            label = str(api.get("label") or ident).strip()[:60] or ident
            api["label"] = label
            base = str(api["base_url"]).strip()
            url = urlsplit(base)
            if base and (url.scheme not in {"https", "http"} or not url.hostname or url.username or url.password or url.query or url.fragment):
                raise ValueError(label + " 的 Base URL 必须是没有嵌入凭据、查询或片段的 HTTP(S) 地址")
            api["base_url"] = base.rstrip("/")
            if not isinstance(api["extra_body"], dict) or set(api["extra_body"]) & {"messages", "model", "stream", "max_tokens", "temperature", "tools"}:
                raise ValueError(label + " 的附加参数应为 JSON 对象，不能覆盖 messages/model/stream/max_tokens/temperature/tools")
            if not isinstance(api["headers"], dict) or not all(isinstance(v, str) for v in api["headers"].values()) \
                    or {k.casefold() for k in api["headers"]} & {"authorization", "content-type"}:
                raise ValueError(label + " 的请求头应为字符串对象，不能覆盖 Authorization/Content-Type")
            if api.get("auth") not in ("bearer", "header", "none"):
                raise ValueError(label + " 的鉴权方式应为 bearer、header 或 none")
            if api["auth"] == "header" and not re.fullmatch(r"[\w-]{1,60}", str(api.get("auth_header") or "")):
                raise ValueError(label + " 用请求头传 Key 时要写出请求头的名字，例如 api-key")
            for key in ("chat_path", "models_path"):
                value = str(api.get(key) or "").strip().lstrip("/")
                if value.startswith(("http:", "https:")) or ".." in value or len(value) > 200:
                    raise ValueError(label + " 的接口路径应是接在 Base URL 后面的相对路径")
                api[key] = value
            if not api["chat_path"]:
                api["chat_path"] = "chat/completions"
            api["model"] = str(api.get("model") or "").strip()[:200]
            api["key_env"] = str(api.get("key_env") or "").strip()[:80]
            if not isinstance(api.get("models"), list):
                api["models"] = []
        if updated["vault"] and not str(updated["vault"]).startswith(("/", "~")):
            raise ValueError("学习库位置应为绝对路径")
        updated["commit_idle"] = max(5, min(int(updated["commit_idle"]), 3600))
        if not isinstance(updated["ui"], dict):
            raise ValueError("界面设置应为对象")
        for name, lane in updated["agents"].items():
            if lane.get("temperature") not in (None, ""):
                lane["temperature"] = max(0, min(float(lane["temperature"]), 2))
            if lane["api"] not in updated["apis"]:
                raise ValueError(AGENT_NAMES[name] + "用的连接已经不在了，请给它另选一个")
            lane["model"] = str(lane["model"]).strip()
            lane["max_tokens"] = max(256, min(int(lane["max_tokens"]), 64000))
            if lane["api"] != LOCALROUTER and not updated["apis"][lane["api"]]["base_url"]:
                raise ValueError(AGENT_NAMES[name] + "所选连接还没有 Base URL")
            if not lane["model"] and not updated["apis"][lane["api"]].get("model"):
                raise ValueError("请填写" + AGENT_NAMES[name] + "的模型名")
        if updated["web"]["search"] not in WEB_BACKENDS:
            raise ValueError("未知的搜索服务")
        if updated["web"]["searxng_url"] and urlsplit(updated["web"]["searxng_url"]).scheme not in {"http", "https"}:
            raise ValueError("SearXNG 地址应为 HTTP(S)")
        updated["timeout"] = max(5, min(int(updated["timeout"]), 600))
        updated["temperature"] = max(0, min(float(updated["temperature"]), 2))
        for key in ("kernel_timeout", "run_timeout"):
            updated[key] = max(3, min(int(updated[key]), 3600))
        updated["shell_timeout"] = max(3, min(int(updated["shell_timeout"]), 600))
        for key in ("agent_auto_run", "agent_auto_organize", "auto_install"):
            updated[key] = bool(updated[key])
        if not isinstance(updated["runners"], dict) or not all(re.fullmatch(r"\.[\w+-]{1,12}", k) and isinstance(v, str) for k, v in updated["runners"].items()):
            raise ValueError("运行器应为「扩展名 → 命令」的对象，例如 {\".lua\": \"lua {file}\"}")
        if not isinstance(updated["sandbox_paths"], list) or not all(isinstance(p, str) and p.startswith("/") for p in updated["sandbox_paths"]):
            raise ValueError("沙箱额外可见路径应为绝对路径列表")


def endpoint(base, suffix):
    base = base.rstrip("/")
    if base.endswith("/chat/completions"):
        base = base[:-len("/chat/completions")]
    return base + "/" + suffix


def clean_error(message, key=""):
    if isinstance(message, BaseException):
        # httpx transport errors often stringify to nothing; never show a blank error.
        detail = str(message) or type(message).__name__
        if isinstance(message, httpx.TimeoutException):
            detail = "连接 API 超时（" + detail + "），请稍后重试或调大超时时间"
        elif isinstance(message, httpx.TransportError):
            detail = "连接 API 时网络中断（" + detail + "），请重试"
        message = detail
    message = str(message)
    if key:
        message = message.replace(key, "[REDACTED]")
    message = re.sub(r"Bearer\s+[^\s\"']+", "Bearer [REDACTED]", message, flags=re.I)
    return message[:1000]


class ApiWorker(QThread):
    """One streamed chat completion with tool calls for an agent (or a /models connection test)."""
    event = Signal(dict)

    def __init__(self, agent, thread, conn, messages, test=False, tools=None):
        super().__init__()
        self.agent, self.thread = agent, thread
        self.config, self.api_key, self.messages, self.test = conn, conn["api_key"], messages, test
        # Tool calls are executed on the GUI thread (it owns SQLite); results come back here.
        self.tools, self.tool_results, self.partial = tools or [], queue.Queue(), ""
        # What the model thought before each answer or tool round, and for how long; shown folded to the learner.
        self.thoughts, self.think_seconds = [], 0.0
        self.cancelled = threading.Event()
        self.response = None
        self.loop = None
        self.task = None

    def emit(self, kind, **data):
        if kind == "error":
            LOG.warning("API worker %s: %s", self.thread, data.get("message"))
        self.event.emit({"type": "agent", "agent": self.agent, "thread": self.thread, "kind": kind, **data})

    def stop(self):
        self.cancelled.set()
        loop, task = self.loop, self.task
        if loop is not None and task is not None and not loop.is_closed():
            try:
                loop.call_soon_threadsafe(task.cancel)
            except RuntimeError:
                pass

    def tool_result(self, call_id, content):
        self.tool_results.put((call_id, content))

    def run(self):
        asyncio.run(self._run())

    async def _tool(self, call):
        self.emit("tool_call", call_id=call["id"], name=call["function"]["name"], arguments=call["function"]["arguments"])
        while True:
            if self.cancelled.is_set():
                raise asyncio.CancelledError()
            try:
                ident, content = await asyncio.to_thread(self.tool_results.get, True, 0.5)
            except queue.Empty:
                continue
            if ident == call["id"]:
                return content

    async def _stream(self, client, headers, payload, separate):
        """One streamed completion. Returns content, reasoning, tool calls, finish and usage."""
        content, reasoning, calls, finish, usage, thinking, started = "", "", {}, None, None, False, None
        self.partial = ""
        async with client.stream("POST", self.chat_url, headers=headers, json=payload) as response:
            self.response = response
            if response.status_code >= 400:
                detail = (await response.aread()).decode("utf-8", "replace")[:700]
                raise ValueError(f"API HTTP {response.status_code}: {detail}")
            self.emit("status", state="responding")
            if "text/event-stream" not in response.headers.get("content-type", ""):
                data = json.loads(await response.aread())
                choices = data.get("choices") or []
                if not choices:
                    raise ValueError("API 未返回 choices，无法读取回答")
                message = choices[0].get("message") or {}
                content = str(message.get("content") or "")
                if content:
                    self.emit("chunk", text=("\n\n" if separate else "") + content)
                return content, "", message.get("tool_calls") or [], choices[0].get("finish_reason") or "stop", data.get("usage")
            async for line in response.aiter_lines():
                if self.cancelled.is_set():
                    return content, reasoning, [], "cancelled", usage
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if raw == "[DONE]":
                    finish = finish or "stop"
                    break
                if not raw:
                    continue
                data = json.loads(raw)
                if data.get("error"):
                    raise ValueError("API 流返回错误：" + json.dumps(data["error"], ensure_ascii=False))
                usage = data.get("usage") or usage
                for choice in data.get("choices", []):
                    delta = choice.get("delta") or {}
                    thought = delta.get("reasoning_content") or delta.get("reasoning")
                    if isinstance(thought, str) and thought:
                        if not reasoning:
                            started = time.monotonic()
                            if self.thoughts:
                                self.emit("thinking", text="\n\n")
                            self.thoughts.append("")
                        reasoning += thought
                        self.thoughts[-1] = reasoning
                        self.emit("thinking", text=thought)
                        if not thinking and not content:
                            thinking = True
                            self.emit("status", state="thinking")
                    piece = delta.get("content")
                    if (isinstance(piece, str) and piece or delta.get("tool_calls")) and reasoning and started:
                        self.think_seconds += time.monotonic() - started
                        started = None
                    if isinstance(piece, str) and piece:
                        if not content:
                            self.emit("status", state="responding")
                            if separate:
                                piece = "\n\n" + piece
                        content += piece
                        self.partial = content
                        if len(content) > 2_000_000:
                            raise ValueError("API 回答超过安全大小限制；已停止接收")
                        self.emit("chunk", text=piece)
                    for part in delta.get("tool_calls") or []:
                        slot = calls.setdefault(part.get("index", 0), {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                        slot["id"] = part.get("id") or slot["id"]
                        fn = part.get("function") or {}
                        slot["function"]["name"] += fn.get("name") or ""
                        slot["function"]["arguments"] += fn.get("arguments") or ""
                    if choice.get("finish_reason"):
                        finish = choice["finish_reason"]
        if reasoning and started:
            self.think_seconds += time.monotonic() - started
        if finish is None:
            raise ValueError("API 数据流在完成标记前断开；已保留收到的部分回答")
        return content.lstrip("\n") if separate else content, reasoning, [calls[i] for i in sorted(calls)], finish, usage

    async def _run(self):
        self.loop, self.task = asyncio.get_running_loop(), asyncio.current_task()
        body, stop_reason, usage = "", "end_turn", None
        try:
            if self.cancelled.is_set():
                raise asyncio.CancelledError()
            config = self.config
            if not self.api_key:
                raise ValueError(config["label"] + " 尚未配置 API Key。请在设置里填写。")
            if not config.get("base_url"):
                raise ValueError(config["label"] + " 还没有 Base URL。请在设置的「模型连接」里填写。")
            session = self.thread or "lattice-test"
            headers = {**{k: v.replace("{session}", session) for k, v in config["headers"].items()}, "Content-Type": "application/json"}
            # How the key travels: Authorization: Bearer, a named header (Azure's api-key), or not at all (local servers).
            auth = config.get("auth") or "bearer"
            if auth == "bearer":
                headers["Authorization"] = "Bearer " + self.api_key
            elif auth == "header":
                headers[config.get("auth_header") or "api-key"] = self.api_key
            timeout = httpx.Timeout(float(config["timeout"]), connect=12)
            self.chat_url = endpoint(config["base_url"], config.get("chat_path") or "chat/completions")
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                if self.test:
                    api, model = config.get("api"), config.get("model") or ""
                    if config.get("models_path"):
                        response = await client.get(endpoint(config["base_url"], config["models_path"]), headers=headers)
                        if response.status_code >= 400:
                            raise ValueError(f"读取模型列表失败：HTTP {response.status_code} {response.text[:300]}")
                        payload = response.json()
                        rows = payload.get("data", payload.get("models", [])) if isinstance(payload, dict) else payload
                        models = [x.get("id") or x.get("name") for x in rows if isinstance(x, dict)] if isinstance(rows, list) else []
                        self.emit("connection_test", ok=True, api=api, models=models, model_found=model in models,
                                  message=f"连上了，读到 {len(models)} 个模型" + ("" if not model or model in models else f"；「{model}」不在列表里"))
                        return
                    # No model list on this service: one tiny request shows whether key and model work.
                    if not model:
                        raise ValueError("这个服务不提供模型列表，请先填上模型名再测试")
                    response = await client.post(self.chat_url, headers=headers, json={**config["extra_body"], "model": model, "max_tokens": 8,
                                                                                    "messages": [{"role": "user", "content": "ping"}]})
                    if response.status_code >= 400:
                        raise ValueError(f"HTTP {response.status_code} {response.text[:300]}")
                    self.emit("connection_test", ok=True, api=api, models=[], model_found=True, message=f"连上了，「{model}」能用")
                    return
                # A reasoning model occasionally stops after thinking with no answer at all;
                # when nothing reached the learner yet, one silent retry is safe.
                for attempt in range(2):
                    messages, body, stop_reason, thought, rounds = list(self.messages), "", "end_turn", False, 0
                    self.emit("status", state="connecting")
                    while True:
                        payload = {**config["extra_body"], "model": config["model"], "messages": messages, "stream": True,
                                   "max_tokens": config["max_tokens"], "temperature": config["temperature"],
                                   **({"tools": self.tools} if self.tools else {})}
                        content, reasoning, calls, finish, part_usage = await self._stream(client, headers, payload, bool(body))
                        self.partial = ""
                        usage = part_usage or usage
                        thought = thought or bool(reasoning)
                        body += ("\n\n" if body and content else "") + content
                        if finish == "cancelled" or self.cancelled.is_set():
                            stop_reason = "cancelled"
                            break
                        if finish == "length":
                            stop_reason = "max_tokens"
                            break
                        if not calls:
                            break
                        rounds += 1
                        if rounds > 40:
                            raise ValueError("这一轮的工具调用超过 40 次，已停止")
                        # Thinking-mode models need their reasoning replayed alongside the calls they made.
                        messages.append({"role": "assistant", "content": content or None, "tool_calls": calls,
                                         **({"reasoning_content": reasoning} if reasoning else {})})
                        for call in calls:
                            messages.append({"role": "tool", "tool_call_id": call["id"], "content": await self._tool(call)})
                    if not body.strip() and stop_reason == "max_tokens":
                        raise ValueError("模型的思考用完了回复上限，还没开始回答。请在设置里调大回复上限。")
                    if body.strip() or stop_reason != "end_turn" or not thought or rounds or attempt:
                        break
                    LOG.warning("API worker %s: answer was empty after reasoning; retrying once", self.thread)
                if not body.strip() and stop_reason == "end_turn" and not rounds:
                    raise ValueError("模型这次只思考、没有给出回答（已自动重试一次）。请再发一次。" if thought
                                     else "API 返回了空回答，请检查模型与附加参数")
        except asyncio.CancelledError:
            body += self.partial
            stop_reason = "cancelled"
        except Exception as exc:
            # A stream that breaks mid-answer keeps what already reached the learner.
            body += self.partial
            if self.cancelled.is_set():
                stop_reason = "cancelled"
            else:
                stop_reason = "error"
                self.emit("connection_test" if self.test else "error", ok=False, api=self.config.get("api"), message=clean_error(exc, self.api_key))
        finally:
            self.response = None
            self.task, self.loop = None, None
            if not self.test:
                thinking = "\n\n".join(t.strip() for t in self.thoughts if t.strip())
                self.emit("finished", text=body, stop_reason=stop_reason, usage=usage,
                          **({"thinking": thinking[-200_000:], "think_seconds": round(self.think_seconds, 1)} if thinking else {}))
