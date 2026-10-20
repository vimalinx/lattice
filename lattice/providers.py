"""OpenAI-compatible API lanes for quick answers and the tutor. Credentials never cross WebChannel."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import re
import queue
import threading
from urllib.parse import urlsplit

import httpx
import logging
from PySide6.QtCore import QThread, Signal

LOG = logging.getLogger("lattice")

# Fixed set of OpenAI-compatible connections; each keeps its own key. "{session}"
# in a header value is replaced by the Lattice session id (OpenCode Go routes
# and caches by x-opencode-session and rejects requests without it).
APIS = {
    "deepseek": {"label": "DeepSeek", "base_url": "https://api.deepseek.com", "model": "deepseek-chat",
                 "headers": {}, "extra_body": {"thinking": {"type": "disabled"}}, "env": "DEEPSEEK_API_KEY"},
    "commandcode": {"label": "CommandCode", "base_url": "https://api.commandcode.ai/provider/v1",
                    "model": "deepseek/deepseek-v4.1-flash", "headers": {}, "extra_body": {}, "env": "COMMANDCODE_API_KEY"},
    "opencode": {"label": "OpenCode Go", "base_url": "https://opencode.ai/zen/go/v1", "model": "deepseek-v4.1-flash",
                 "headers": {"x-opencode-session": "{session}"}, "extra_body": {}, "env": "OPENCODE_GO_API_KEY"},
    "custom": {"label": "自定义", "base_url": "", "model": "", "headers": {}, "extra_body": {}, "env": ""},
}
API_FIELDS = {"base_url", "headers", "extra_body", "api_key"}
DEFAULTS = {
    "apis": {}, "flash_api": "commandcode", "flash_model": "deepseek/deepseek-v4.1-flash-fast", "flash_max_tokens": 4000,
    "tutor_api": "commandcode", "tutor_model": "deepseek/deepseek-v4.1-flash", "tutor_max_tokens": 16000,
    "practice_api": "commandcode", "practice_model": "deepseek/deepseek-v4.1-flash", "practice_max_tokens": 16000,
    "timeout": 120, "temperature": 0.35,
    "kernel_name": "python3", "kernel_timeout": 120,
    # Agents may run notebook code in the learner's own kernel (not a sandbox).
    "agent_auto_run": True,
}


def model_label(model):
    """Short display name: the model id without its vendor prefix."""
    return str(model).rsplit("/", 1)[-1] or "未选择模型"


class ProviderConfig:
    def __init__(self, path=None):
        self.path = Path(path) if path else Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "lattice/providers.json"

    def read(self):
        result = json.loads(json.dumps(DEFAULTS))
        try:
            if self.path.exists():
                saved = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(saved, dict):
                    result.update({k: v for k, v in saved.items() if k in DEFAULTS})
        except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
            # A hand-edited or truncated config must not break the whole app state.
            LOG.warning("无法读取 providers.json，回退默认配置: %s", exc)
        saved_apis = result["apis"] if isinstance(result["apis"], dict) else {}
        result["apis"] = {}
        for ident, spec in APIS.items():
            own = saved_apis.get(ident) if isinstance(saved_apis.get(ident), dict) else {}
            result["apis"][ident] = {**{k: spec[k] for k in API_FIELDS - {"api_key"}}, "api_key": "",
                                     **{k: v for k, v in own.items() if k in API_FIELDS}}
        return result

    def key(self, api, config=None):
        config = config or self.read()
        env = APIS.get(api, {}).get("env")
        return config["apis"].get(api, {}).get("api_key") or (os.environ.get(env, "") if env else "")

    def lane(self, lane, config=None):
        """Everything one API lane needs to send a request, key included."""
        config = config or self.read()
        api = config[lane + "_api"]
        return {**config["apis"][api], "api": api, "label": APIS[api]["label"], "api_key": self.key(api, config), "model": config[lane + "_model"],
                "max_tokens": config[lane + "_max_tokens"], "timeout": config["timeout"], "temperature": config["temperature"]}

    def label(self, lane, config=None):
        config = config or self.read()
        return model_label(config[lane + "_model"])

    def public(self):
        # Only known keys cross the bridge; keys never do.
        raw = self.read()
        result = {k: raw[k] for k in DEFAULTS if k != "apis"}
        result["apis"] = []
        for ident, spec in APIS.items():
            api = raw["apis"][ident]
            saved, env = bool(api["api_key"]), spec["env"]
            has_env = bool(env and os.environ.get(env))
            result["apis"].append({"id": ident, "label": spec["label"], "default_model": spec["model"],
                                   **{k: api[k] for k in API_FIELDS - {"api_key"}},
                                   "has_key": saved or has_env,
                                   "key_source": "本机配置" if saved else ("环境变量 " + env) if has_env else "尚未配置"})
        result["flash_label"], result["tutor_label"] = self.label("flash", raw), self.label("tutor", raw)
        result["practice_label"] = self.label("practice", raw)
        result["has_key"] = bool(self.key(raw["flash_api"], raw))
        result["practice_ready"] = bool(self.key(raw["practice_api"], raw))
        result["tutor_ready"] = bool(self.key(raw["tutor_api"], raw))
        return result

    def save(self, changes):
        if not isinstance(changes, dict):
            raise ValueError("配置必须是对象")
        unexpected = set(changes) - set(DEFAULTS)
        if unexpected:
            raise ValueError("未知配置项：" + ", ".join(unexpected))
        updated = self.read()
        for key, val in changes.items():
            if key != "apis":
                updated[key] = val
        api_changes = changes.get("apis", {})
        if not isinstance(api_changes, dict) or set(api_changes) - set(APIS):
            raise ValueError("未知的 API 连接")
        for ident, change in api_changes.items():
            if not isinstance(change, dict) or set(change) - API_FIELDS - {"clear_key"}:
                raise ValueError("API 连接含不支持的字段")
            api = updated["apis"][ident]
            api.update({k: v for k, v in change.items() if k in API_FIELDS - {"api_key"}})
            if change.get("clear_key"):
                api["api_key"] = ""
            elif change.get("api_key"):
                api["api_key"] = str(change["api_key"]).strip()
        for ident, api in updated["apis"].items():
            label = APIS[ident]["label"]
            base = str(api["base_url"]).strip()
            url = urlsplit(base)
            if base and (url.scheme not in {"https", "http"} or not url.hostname or url.username or url.password or url.query or url.fragment):
                raise ValueError(label + " 的 Base URL 必须是没有嵌入凭据、查询或片段的 HTTP(S) 地址")
            api["base_url"] = base.rstrip("/")
            if not isinstance(api["extra_body"], dict) or set(api["extra_body"]) & {"messages", "model", "stream", "max_tokens", "temperature"}:
                raise ValueError(label + " 的附加参数应为 JSON 对象，不能覆盖 messages/model/stream/max_tokens/temperature")
            if not isinstance(api["headers"], dict) or not all(isinstance(v, str) for v in api["headers"].values()) \
                    or {k.casefold() for k in api["headers"]} & {"authorization", "content-type"}:
                raise ValueError(label + " 的请求头应为字符串对象，不能覆盖 Authorization/Content-Type")
        names = {"flash": "快答", "tutor": "主讲", "practice": "练习教练"}
        for lane in names:
            if updated[lane + "_api"] not in APIS:
                raise ValueError("未知的 API 连接：" + str(updated[lane + "_api"]))
            updated[lane + "_model"] = str(updated[lane + "_model"]).strip()
            updated[lane + "_max_tokens"] = max(256, min(int(updated[lane + "_max_tokens"]), 64000))
            if not updated["apis"][updated[lane + "_api"]]["base_url"]:
                raise ValueError(names[lane] + "所选连接还没有 Base URL")
            if not updated[lane + "_model"]:
                raise ValueError("请填写" + names[lane] + "的模型名")
        updated["timeout"] = max(5, min(int(updated["timeout"]), 600))
        updated["temperature"] = max(0, min(float(updated["temperature"]), 2))
        updated["kernel_timeout"] = max(3, min(int(updated["kernel_timeout"]), 3600))
        updated["agent_auto_run"] = bool(updated["agent_auto_run"])
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
    """One streamed chat completion for either lane (or a /models connection test)."""
    event = Signal(dict)

    def __init__(self, lane, topic_id, session_id, conn, messages, test=False, tools=None):
        super().__init__()
        self.lane, self.topic_id, self.session_id = lane, topic_id, session_id
        self.config, self.api_key, self.messages, self.test = conn, conn["api_key"], messages, test
        # Tool calls are executed on the GUI thread (it owns SQLite); results come back here.
        self.tools, self.tool_results, self.partial = tools or [], queue.Queue(), ""
        self.cancelled = threading.Event()
        self.response = None
        self.loop = None
        self.task = None

    def emit(self, kind, **data):
        if kind == "error":
            LOG.warning("API worker %s: %s", self.session_id, data.get("message"))
        self.event.emit({"type": "learning_agent", "lane": self.lane, "topic_id": self.topic_id, "session_id": self.session_id, "kind": kind, **data})

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
        content, reasoning, calls, finish, usage, thinking = "", "", {}, None, None, False
        self.partial = ""
        async with client.stream("POST", endpoint(self.config["base_url"], "chat/completions"), headers=headers, json=payload) as response:
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
                        reasoning += thought
                        if not thinking and not content:
                            # Reasoning models think before answering; the text is only replayed to the model.
                            thinking = True
                            self.emit("status", state="thinking")
                    piece = delta.get("content")
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
        if finish is None:
            raise ValueError("API 数据流在完成标记前断开；已保留收到的部分回答")
        return content.lstrip("\n") if separate else content, reasoning, [calls[i] for i in sorted(calls)], finish, usage

    async def _run(self):
        self.loop, self.task = asyncio.get_running_loop(), asyncio.current_task()
        body, stop_reason, usage = "", "end_turn", None
        try:
            if self.cancelled.is_set():
                raise asyncio.CancelledError()
            if not self.api_key:
                raise ValueError(self.config["label"] + " 尚未配置 API Key。请在「模型连接」中填写。")
            config = self.config
            session = self.session_id or "lattice-test"
            headers = {**{k: v.replace("{session}", session) for k, v in config["headers"].items()},
                       "Authorization": "Bearer " + self.api_key, "Content-Type": "application/json"}
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
                        if rounds > 30:
                            raise ValueError("这一轮的工具调用超过 30 次，已停止")
                        # Thinking-mode models need their reasoning replayed alongside the calls they made.
                        messages.append({"role": "assistant", "content": content or None, "tool_calls": calls,
                                         **({"reasoning_content": reasoning} if reasoning else {})})
                        for call in calls:
                            messages.append({"role": "tool", "tool_call_id": call["id"], "content": await self._tool(call)})
                    if not body.strip() and stop_reason == "max_tokens":
                        raise ValueError("模型的思考用完了回复上限，还没开始回答。请在「模型连接」里调大回复上限。")
                    if body.strip() or stop_reason != "end_turn" or not thought or rounds or attempt:
                        break
                    LOG.warning("API worker %s: answer was empty after reasoning; retrying once", self.session_id)
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
                self.emit("connection_test" if self.test else "error", ok=False, message=clean_error(exc, self.api_key))
        finally:
            self.response = None
            self.task, self.loop = None, None
            if not self.test:
                self.emit("finished", text=body, stop_reason=stop_reason, usage=usage)
