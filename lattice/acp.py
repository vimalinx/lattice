"""ACP v1 client for Codex and Devin; nonblocking QThread, explicit permissions.

Both command paths are local. The client does not handle API keys or network auth.
"""
from __future__ import annotations
import json
import logging
import os
from pathlib import Path
import queue
import re
import select
import shutil
import signal
import subprocess
import time

from PySide6.QtCore import QThread, Signal

LOG = logging.getLogger("lattice")

ROOT = Path(__file__).resolve().parents[1]
CODEX = ROOT / "runtime/node_modules/.bin/codex-acp"
DEVIN = Path.home() / ".local/bin/devin"


def _codex_command(config):
    binary = str(config.get("codex_command") or CODEX).strip() or str(CODEX)
    return [str(Path(binary).expanduser()), *[str(a) for a in config.get("codex_args") or []]]


def _codex_env(config):
    env = {"INITIAL_AGENT_MODE": "read-only"}
    overrides = {}
    model = str(config.get("codex_model") or "").strip()
    if model:
        overrides["model"] = model
    effort = str(config.get("codex_effort") or "").strip()
    if effort:
        overrides["model_reasoning_effort"] = effort
    if overrides:
        env["CODEX_CONFIG"] = json.dumps(overrides, ensure_ascii=False)
    return env


def _devin_command(config):
    binary = str(config.get("devin_command") or DEVIN).strip() or str(DEVIN)
    command = [str(Path(binary).expanduser()), "acp"]
    model = str(config.get("devin_model") or "swe-2-high").strip()
    if model:
        command += ["--model", model]
    return command


def _custom_command(config):
    binary = str(config.get("custom_command") or "").strip()
    if not binary:
        return []
    return [str(Path(binary).expanduser()), *[str(a) for a in config.get("custom_args") or []]]


# Each adapter knows how to build its argv and the extra env the tutor lane
# needs. Everything speaks the same ACP stdio protocol; differences live here.
AGENTS = {
    "codex": {"label": "Codex CLI", "command": _codex_command, "env": _codex_env},
    "devin": {"label": "Devin CLI", "command": _devin_command, "env": lambda config: {}},
    "custom": {"label": "自定义 ACP", "command": _custom_command, "env": lambda config: {}},
}


def agent_command(agent, config=None):
    """Resolve an adapter id to (argv, env). Empty argv means unconfigured."""
    spec = AGENTS.get(agent)
    if not spec:
        return [], {}
    config = config or {}
    return spec["command"](config), spec["env"](config)


def command_available(command):
    """argv is usable when the binary is a real path or resolvable through PATH."""
    if not command:
        return False
    exe = str(command[0])
    return Path(exe).is_file() or shutil.which(exe) is not None


def agent_options(config):
    options = []
    for agent, spec in AGENTS.items():
        command = spec["command"](config or {})
        options.append({"id": agent, "label": spec["label"],
                        "installed": command_available(command)})
    return options


class AgentWorker(QThread):
    event = Signal(dict)

    def __init__(self, session_id: str, agent: str, cwd: str, restore_id: str | None = None):
        super().__init__()
        self.local_id = session_id
        self.agent = agent
        self.cwd = str(Path(cwd).expanduser().resolve())
        self.restore_id = restore_id
        self.commands = queue.Queue()
        self.proc = None
        self.counter = 0
        self.pending = {}
        self.session = None
        self.init_done = False
        self.init_caps = {}
        self.busy = False
        self.assistant_text = ""
        self.pending_prompts = []
        self.running = True
        self.protocol = 1
        self.command = None
        self.extra_env = {}
        self.agent_config = {}
        self.mcp_servers = []
        self.auto_permissions = False
        self.permissions = {}
        self.handshake_started = None

    def post(self, kind, **params):
        self.commands.put({"kind":kind,**params})

    def emit(self, kind, **data):
        if kind == "error":
            LOG.warning("ACP worker %s: %s", self.local_id, data.get("message"))
        self.event.emit({"session_id":self.local_id,"kind":kind,**data})

    def _send(self, message):
        if self.proc is None or self.proc.poll() is not None:
            raise RuntimeError("Agent 进程已退出")
        data=(json.dumps(message,ensure_ascii=False,separators=(",",":"))+"\n").encode("utf-8")
        fd = self.proc.stdin.fileno()
        # Non-blocking writes + writable-select: a stalled agent that stops
        # draining stdin must not wedge this worker (or the app shutdown).
        os.set_blocking(fd, False)
        view = memoryview(data)
        deadline = time.monotonic() + 20
        while view:
            try:
                sent = os.write(fd, view)
            except BlockingIOError:
                sent = 0
            if sent > 0:
                view = view[sent:]
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([], [fd], [], min(remaining, 1.0))[1]:
                raise TimeoutError("ACP stdin 写入超时，Agent 已停止读取")
            if self.proc.poll() is not None:
                raise BrokenPipeError("ACP 管道已关闭")

    def call(self, method, params):
        self.counter += 1
        req_id=self.counter
        self.pending[req_id]=method
        self._send({"jsonrpc":"2.0","id":req_id,"method":method,"params":params})
        return req_id

    def respond(self, ident, result=None, error=None):
        msg={"jsonrpc":"2.0","id":ident}
        if error:
            msg["error"]={"code":-32601,"message":str(error)}
        else:
            msg["result"]=result if result is not None else {}
        self._send(msg)

    def _start_new(self):
        self.call("session/new",{"cwd":self.cwd,"mcpServers":self.mcp_servers})

    def _activate(self):
        if self.pending_prompts and not self.busy and self.session:
            prompt=self.pending_prompts.pop(0)
            self.busy=True
            self.assistant_text=""
            self.emit("status",state="thinking")
            self.call("session/prompt",{
                "sessionId":self.session,
                "prompt":[{"type":"text","text":prompt}],
            })

    def _reply(self, msg):
        ident=msg.get("id")
        method=self.pending.pop(ident,None)
        if not method:
            return
        if "error" in msg:
            error=msg["error"]
            self.emit("error",message=f"{method}: {error.get('message',error)}")
            if method=="session/load":
                self._start_new()
            elif method in ("initialize","session/new"):
                # Without a session the loop would only wait out the handshake timeout.
                self.running=False
                return
            if method=="session/prompt":
                self.busy=False
                self.emit("finished",text=self.assistant_text,stop_reason="error")
                self._activate()
            return
        result=msg.get("result") or {}
        if method=="initialize":
            self.init_done=True
            self.protocol=result.get("protocolVersion",1)
            self.init_caps=result.get("agentCapabilities") or result.get("capabilities") or {}
            self.emit("status",state="initialised")
            if self.restore_id and self.init_caps.get("loadSession"):
                self.call("session/load",{
                    "sessionId":self.restore_id,"cwd":self.cwd,"mcpServers":self.mcp_servers
                })
            else:
                self._start_new()
        elif method in ("session/new","session/load"):
            self.session=result.get("sessionId",self.restore_id)
            if not self.session:
                self.emit("error",message="Agent 返回的 sessionId 为空")
                return
            self.emit("ready",remote_id=self.session)
            self._activate()
        elif method=="session/prompt":
            self.busy=False
            self.emit("finished",text=self.assistant_text,stop_reason=result.get("stopReason","end_turn"))
            self._activate()

    def _handle_request(self,msg):
        method=msg.get("method","")
        params=msg.get("params") or {}
        ident=msg.get("id")
        if method=="session/update":
            update=params.get("update",{})
            kind=update.get("sessionUpdate","")
            if kind in ("agent_message_chunk","agent_message"):
                if not self.busy:  # session/load may replay persisted messages.
                    return
                content=update.get("content") or {}
                if isinstance(content,dict) and content.get("type")=="text":
                    text=content.get("text","")
                    if kind=="agent_message" and self.assistant_text:
                        # Some agents send cumulative full messages instead of
                        # chunks, or repeat the full message after streaming.
                        if text.startswith(self.assistant_text):
                            text=text[len(self.assistant_text):]
                        elif self.assistant_text.endswith(text):
                            text=""
                    if text:
                        self.assistant_text+=text
                        self.emit("chunk",text=text)
            elif kind in ("agent_thought_chunk","agent_thought"):
                content=update.get("content") or {}
                if isinstance(content,dict) and content.get("type")=="text":
                    self.emit("thought",text=content.get("text",""))
            elif kind in ("tool_call","tool_call_update"):
                title=update.get("title") or update.get("toolCallId") or "工具调用"
                self.emit("tool",title=title,status=update.get("status","running"))
            elif kind=="current_mode_update":
                self.emit("status",state="mode: "+str(update.get("currentModeId","")))
            return
        if ident is None:
            return
        if method=="session/request_permission":
            options=params.get("options") or []
            if self.auto_permissions:
                # The learner is never asked: Lattice's own tools are allowed for the
                # session (their writes are undoable); the agent's shell and file
                # tools are refused, so it works through Lattice instead.
                ours=(params.get("_meta") or {}).get("is_mcp_tool_approval") and "lattice" in json.dumps(params,ensure_ascii=False)
                pick=next((o for o in options if "session" in str(o.get("optionId"))),None) or next((o for o in options if o.get("kind")=="allow_once"),None)
                if ours and pick:
                    self.respond(ident,{"outcome":{"outcome":"selected","optionId":pick["optionId"]}})
                else:
                    self.respond(ident,{"outcome":{"outcome":"cancelled"}})
                    self.emit("diagnostic",message="已自动拒绝 Agent 的 "+str((params.get("toolCall") or {}).get("kind") or "操作")+" 请求")
                return
            self.permissions[ident] = {o.get("optionId") for o in options}
            self.emit("permission",request_id=ident,title=(params.get("title") or "Agent 请求操作权限"),
                      options=options,tool=params.get("toolCall") or params.get("subject") or {})
            # Decision is sent only after an explicit click in the GUI.
            return
        if method=="fs/read_text_file":
            try:
                base=Path(self.cwd).resolve()
                raw=Path(params.get("path",""))
                # Relative paths are anchored at the agent workspace, not this
                # process's own working directory.
                path=(raw if raw.is_absolute() else base/raw).resolve()
                if not path.is_relative_to(base):
                    raise PermissionError("Agent 只能读取当前工作区的文件")
                if path.stat().st_size>2*1024*1024:
                    raise ValueError("文件过大")
                if path.name.startswith(".env") or path.name in {"auth.json", "providers.json"}:
                    raise PermissionError("不通过文件工具读取凭据")
                contents=path.read_text(encoding="utf-8")
                if "line" in params or "limit" in params:
                    start=max(0,int(params.get("line",1))-1)
                    limit=max(0,min(int(params.get("limit",1000)),10000))
                    contents="".join(contents.splitlines(True)[start:start+limit])
                self.respond(ident,{"content":contents})
            except Exception as e:
                self.respond(ident,error=str(e))
            return
        if method=="fs/write_text_file":
            self.respond(ident,error="请让 Agent 通过自身的受控工具修改文件")
            return
        self.respond(ident,error=f"不支持的方法: {method}")

    def _process_command(self, command):
        kind=command["kind"]
        if kind=="prompt":
            self.pending_prompts.append(command.get("text",""))
            self._activate()
        elif kind=="cancel":
            had_pending=bool(self.pending_prompts)
            self.pending_prompts.clear()
            for ident in list(self.permissions):
                self.respond(ident,{"outcome":{"outcome":"cancelled"}})
            self.permissions.clear()
            if had_pending and not self.busy:
                self.emit("finished",text="",stop_reason="cancelled")
            if self.session:
                self._send({"jsonrpc":"2.0","method":"session/cancel",
                            "params":{"sessionId":self.session}})
                self.emit("status",state="cancelling")
        elif kind=="permission":
            ident=command.get("request_id")
            choice=command.get("option_id")
            allowed=self.permissions.pop(ident,None)
            if allowed is None:
                return
            if choice and choice not in allowed:
                choice=None
            if choice:
                self.respond(ident,{"outcome":{"outcome":"selected","optionId":choice}})
            else:
                self.respond(ident,{"outcome":{"outcome":"cancelled"}})
        elif kind=="stop":
            self.running=False

    def run(self):
        if self.command:
            cmd=list(self.command)
        else:
            # Legacy sessions only carry an agent name; the adapter registry
            # supplies argv. Adapter env stays opt-in (tutor lane sets it).
            cmd,_=agent_command(self.agent,self.agent_config)
        if not cmd:
            self.emit("error",message="未知或未配置的 ACP 适配器: "+self.agent)
            return
        # Resolve the executable once so validation and spawn agree: bare names
        # go through PATH, relative paths anchor at the agent workspace.
        raw = cmd[0]
        candidate = raw if (os.path.isabs(raw) or os.sep not in raw) else str(Path(self.cwd) / raw)
        exe = shutil.which(candidate)
        if not exe:
            self.emit("error",message="Agent 未安装: "+raw)
            return
        cmd[0] = exe
        if not Path(self.cwd).is_dir():
            self.emit("error",message="工作目录不存在: "+self.cwd)
            return
        try:
            self.proc=subprocess.Popen(
                cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                cwd=self.cwd,bufsize=0,start_new_session=True,env={**os.environ,**self.extra_env}
            )
            self.handshake_started=time.monotonic()
            self.emit("status",state="connecting")
            self.call("initialize",{
                "protocolVersion":1,
                "clientCapabilities":{"fs":{"readTextFile":True,"writeTextFile":False}},
                "clientInfo":{"name":"lattice","title":"Lattice Studio","version":"1.0.0"}
            })
            fd=self.proc.stdout.fileno()
            err_fd=self.proc.stderr.fileno()
            buffers={fd:b"",err_fd:b""}
            open_fds={fd,err_fd}
            while self.running and self.proc.poll() is None:
                if not self.session and time.monotonic()-self.handshake_started > 65:
                    self.emit("error",message="ACP 会话建立超时，请检查 Codex 登录和网络后重试")
                    break
                while True:
                    try:
                        command=self.commands.get_nowait()
                    except queue.Empty:
                        break
                    self._process_command(command)
                if not open_fds:
                    time.sleep(0.16)
                    continue
                readable,_,_=select.select(list(open_fds),[],[],0.16)
                for readable_fd in readable:
                    fragment=os.read(readable_fd,65536)
                    if not fragment:
                        # EOF: stop selecting this fd or it stays readable forever.
                        open_fds.discard(readable_fd)
                        continue
                    buffers[readable_fd]+=fragment
                    if len(buffers[readable_fd]) > 16_000_000:
                        raise ValueError("ACP 消息超过 16 MB 限制")
                    while b"\n" in buffers[readable_fd]:
                        line,buffers[readable_fd]=buffers[readable_fd].split(b"\n",1)
                        if readable_fd==err_fd:
                            # stderr is diagnostic only; strip anything that
                            # looks like a credential before surfacing it.
                            if b"error" in line.lower():
                                msg=line.decode("utf-8","replace")[:220]
                                msg=re.sub(r"(sk-[A-Za-z0-9_\-]{6,}|Bearer\s+\S+|[A-Za-z_]*(?:key|token|secret)[=:]\s*\S+)",
                                           "[已隐藏]",msg,flags=re.I)
                                self.emit("diagnostic",message=msg)
                            continue
                        try:
                            message=json.loads(line.decode("utf-8"))
                            if "method" in message:
                                self._handle_request(message)
                            else:
                                self._reply(message)
                        except Exception as exc:
                            self.emit("diagnostic",message=f"协议消息错误: {str(exc)[:150]}")
            if self.running:
                self.emit("error",message=f"Agent 进程退出（退出码 {self.proc.poll()}）")
        except Exception as exc:
            self.emit("error",message=f"无法启动 Agent: {exc}")
        finally:
            if self.busy or self.pending_prompts:
                self.busy=False
                self.pending_prompts.clear()
                self.emit("finished",text=self.assistant_text,stop_reason="error" if self.running else "cancelled")
            if self.proc and self.proc.poll() is None:
                try:
                    os.killpg(self.proc.pid,signal.SIGTERM)
                    self.proc.wait(timeout=2)
                except Exception:
                    try:
                        os.killpg(self.proc.pid,signal.SIGKILL)
                    except Exception:
                        pass
            self.emit("status",state="offline")
