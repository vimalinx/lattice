"""Configurable OpenAI-compatible Flash API. Credentials never cross WebChannel."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import re
import threading
from urllib.parse import urlsplit

import httpx
import logging
from PySide6.QtCore import QThread, Signal

from .acp import AGENTS, agent_options, agent_command, command_available

LOG = logging.getLogger("lattice")

ROOT = Path(__file__).resolve().parents[1]
DEFAULTS = {
    "base_url": "https://api.deepseek.com", "model": "deepseek-flash",
    "api_key": "", "max_tokens": 1400, "timeout": 60, "temperature": 0.35,
    "extra_body": {"thinking": {"type": "disabled"}},
    "tutor_agent": "codex",
    "codex_command": str(ROOT / "runtime/node_modules/.bin/codex-acp"),
    "codex_args": [], "codex_model": "", "codex_effort": "high",
    "devin_command": str(Path.home() / ".local/bin/devin"),
    "devin_model": "swe-2-high",
    "custom_command": "", "custom_args": [],
    "kernel_name": "python3", "kernel_timeout": 120,
}


class ProviderConfig:
    def __init__(self, path=None):
        self.path = Path(path) if path else Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "lattice/providers.json"

    def read(self):
        result = {**DEFAULTS, "extra_body": dict(DEFAULTS["extra_body"])}
        try:
            if self.path.exists():
                saved = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(saved, dict):
                    result.update(saved)
        except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
            # A hand-edited or truncated config must not break the whole app state.
            LOG.warning("无法读取 providers.json，回退默认配置: %s", exc)
        return result

    def key(self, config=None):
        config = config or self.read()
        return config.get("api_key") or os.environ.get("DEEPSEEK_API_KEY", "")

    def public(self):
        # Only known keys cross the bridge; a hand-edited providers.json must
        # not echo arbitrary fields into the frontend.
        raw = self.read()
        result = {k: raw[k] for k in DEFAULTS if k in raw}
        has_saved = bool(result.pop("api_key", ""))
        result["has_key"] = has_saved or bool(os.environ.get("DEEPSEEK_API_KEY"))
        result["key_source"] = "本机配置" if has_saved else "环境变量" if result["has_key"] else "尚未配置"
        result["codex_installed"] = command_available(agent_command("codex", result)[0])
        result["acp_agents"] = agent_options(result)
        return result

    def save(self, changes):
        if not isinstance(changes, dict):
            raise ValueError("配置必须是对象")
        unexpected = set(changes) - set(DEFAULTS) - {"clear_key"}
        if unexpected:
            raise ValueError("未知配置项：" + ", ".join(unexpected))
        updated = self.read()
        for key, val in changes.items():
            if key not in {"api_key", "clear_key"}:
                updated[key] = val
        if changes.get("clear_key"):
            updated["api_key"] = ""
        elif changes.get("api_key"):
            updated["api_key"] = str(changes["api_key"]).strip()
        url = urlsplit(str(updated["base_url"]).strip())
        if url.scheme not in {"https", "http"} or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError("Base URL 必须是没有嵌入凭据、查询或片段的 HTTP(S) 地址")
        updated["base_url"] = str(updated["base_url"]).strip().rstrip("/")
        if not str(updated["model"]).strip():
            raise ValueError("请填写 API 模型名")
        updated["max_tokens"] = max(64, min(int(updated["max_tokens"]), 16000))
        updated["timeout"] = max(5, min(int(updated["timeout"]), 300))
        updated["temperature"] = max(0, min(float(updated["temperature"]), 2))
        updated["kernel_timeout"] = max(3, min(int(updated["kernel_timeout"]), 3600))
        if not isinstance(updated["extra_body"], dict) or set(updated["extra_body"]) & {"messages", "model", "stream", "max_tokens", "temperature"}:
            raise ValueError("附加 API 参数应为 JSON 对象，不能覆盖 messages/model/stream/max_tokens/temperature")
        if not isinstance(updated["codex_args"], list) or not all(isinstance(x, str) for x in updated["codex_args"]):
            raise ValueError("ACP 参数必须是字符串数组")
        if updated["codex_effort"] not in {"", "low", "medium", "high", "xhigh"}:
            raise ValueError("推理强度配置无效")
        updated["codex_command"] = str(Path(str(updated["codex_command"])).expanduser())
        if updated["tutor_agent"] not in AGENTS:
            raise ValueError("未知的主讲适配器：" + str(updated["tutor_agent"]))
        updated["devin_model"] = str(updated["devin_model"]).strip()
        for key in ("devin_command", "custom_command"):
            value = str(updated[key]).strip()
            updated[key] = str(Path(value).expanduser()) if value else ""
        if not isinstance(updated["custom_args"], list) or not all(isinstance(x, str) for x in updated["custom_args"]):
            raise ValueError("自定义 ACP 参数必须是字符串数组")
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
        return self.public()


def endpoint(base, suffix):
    base = base.rstrip("/")
    if base.endswith("/chat/completions"):
        base = base[:-len("/chat/completions")]
    return base + "/" + suffix


def clean_error(message, key=""):
    message = str(message)
    if key:
        message = message.replace(key, "[REDACTED]")
    message = re.sub(r"Bearer\s+[^\s\"']+", "Bearer [REDACTED]", message, flags=re.I)
    return message[:1000]


class FlashWorker(QThread):
    event = Signal(dict)

    def __init__(self, topic_id, session_id, config, api_key, messages, test=False):
        super().__init__()
        self.topic_id, self.session_id = topic_id, session_id
        self.config, self.api_key, self.messages, self.test = config, api_key, messages, test
        self.cancelled = threading.Event()
        self.response = None
        self.loop = None
        self.task = None

    def emit(self, kind, **data):
        if kind == "error":
            LOG.warning("Flash worker %s: %s", self.session_id, data.get("message"))
        self.event.emit({"type": "learning_agent", "lane": "flash", "topic_id": self.topic_id, "session_id": self.session_id, "kind": kind, **data})

    def stop(self):
        self.cancelled.set()
        loop, task = self.loop, self.task
        if loop is not None and task is not None and not loop.is_closed():
            try:
                loop.call_soon_threadsafe(task.cancel)
            except RuntimeError:
                pass

    def run(self):
        asyncio.run(self._run())

    async def _run(self):
        self.loop, self.task = asyncio.get_running_loop(), asyncio.current_task()
        body, usage, stop_reason = "", None, "end_turn"
        try:
            if self.cancelled.is_set():
                raise asyncio.CancelledError()
            if not self.api_key:
                raise ValueError("DeepSeek 尚未配置 API Key。请在「模型连接」中填写，或设置 DEEPSEEK_API_KEY。")
            config = self.config
            headers = {"Authorization": "Bearer " + self.api_key, "Content-Type": "application/json"}
            timeout = httpx.Timeout(float(config["timeout"]), connect=12)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                if self.test:
                    response = await client.get(endpoint(config["base_url"], "models"), headers=headers)
                    response.raise_for_status()
                    payload = response.json()
                    models = [x.get("id") for x in payload.get("data", []) if isinstance(x, dict)]
                    self.emit("connection_test", ok=True, models=models, model_found=config["model"] in models,
                              message="API 鉴权与模型列表读取成功" + ("" if config["model"] in models else "；填写的模型名未出现在返回列表中"))
                    return
                payload = {**config["extra_body"], "model": config["model"], "messages": self.messages, "stream": True,
                           "max_tokens": config["max_tokens"], "temperature": config["temperature"]}
                self.emit("status", state="connecting")
                async with client.stream("POST", endpoint(config["base_url"], "chat/completions"), headers=headers, json=payload) as response:
                    self.response = response
                    if response.status_code >= 400:
                        detail = (await response.aread()).decode("utf-8", "replace")[:700]
                        raise ValueError(f"API HTTP {response.status_code}: {detail}")
                    response.raise_for_status()
                    self.emit("status", state="responding")
                    if "text/event-stream" not in response.headers.get("content-type", ""):
                        data = json.loads(await response.aread())
                        choices = data.get("choices") or []
                        if not choices:
                            raise ValueError("API 未返回 choices，无法读取回答")
                        body = str((choices[0].get("message") or {}).get("content") or "")
                        usage = data.get("usage")
                        self.emit("chunk", text=body)
                    else:
                        saw_end = False
                        async for line in response.aiter_lines():
                            if self.cancelled.is_set():
                                stop_reason = "cancelled"
                                break
                            if not line.startswith("data:"):
                                continue
                            raw = line[5:].strip()
                            if raw == "[DONE]":
                                saw_end = True
                                break
                            if not raw:
                                continue
                            data = json.loads(raw)
                            if data.get("error"):
                                raise ValueError("API 流返回错误：" + json.dumps(data["error"], ensure_ascii=False))
                            if data.get("usage"):
                                usage = data["usage"]
                            for choice in data.get("choices", []):
                                content = (choice.get("delta") or {}).get("content")
                                if isinstance(content, str):
                                    body += content
                                    if len(body) > 2_000_000:
                                        raise ValueError("API 回答超过安全大小限制；已停止接收")
                                    self.emit("chunk", text=content)
                                if choice.get("finish_reason"):
                                    saw_end = True
                                    if choice["finish_reason"] == "length":
                                        stop_reason = "max_tokens"
                        if not saw_end and not self.cancelled.is_set():
                            raise ValueError("API 数据流在完成标记前断开；已保留收到的部分回答")
                if self.cancelled.is_set():
                    stop_reason = "cancelled"
                if not body.strip() and stop_reason == "end_turn":
                    raise ValueError("API 返回了空回答，请检查模型与附加参数")
        except asyncio.CancelledError:
            stop_reason = "cancelled"
        except Exception as exc:
            if self.cancelled.is_set():
                stop_reason = "cancelled"
            else:
                stop_reason = "error"
                self.emit("connection_test" if self.test else "error", ok=False, message=clean_error(exc, self.api_key))
        finally:
            self.response = None
            self.task, self.loop = None, None
            if not self.test:
                self.emit("finished", text=body, stop_reason=stop_reason, usage=usage)
