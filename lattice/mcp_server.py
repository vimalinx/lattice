"""MCP stdio server that gives an ACP agent (Codex) the Lattice workspace tools.

The agent starts this process; it forwards tools/list and tools/call over a
user-only local socket to the running Lattice window, which executes them with
the same registry the API lanes use. Standard library only, so it runs with
`python3 -I` regardless of the agent's environment.
"""
import json
import os
import socket
import sys

SOCKET, TOKEN, SESSION = (os.environ.get(k, "") for k in ("LATTICE_TOOLS_SOCKET", "LATTICE_TOOLS_TOKEN", "LATTICE_TOOLS_SESSION"))


class Lattice:
    def __init__(self):
        self.sock, self.buffer, self.counter = None, b"", 0

    def ask(self, method, **params):
        if self.sock is None:
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.sock.connect(SOCKET)
        self.counter += 1
        line = json.dumps({"id": self.counter, "token": TOKEN, "session": SESSION, "method": method, **params}, ensure_ascii=False)
        self.sock.sendall(line.encode("utf-8") + b"\n")
        while b"\n" not in self.buffer:
            chunk = self.sock.recv(65536)
            if not chunk:
                self.sock = None
                raise ConnectionError("Lattice 已关闭")
            self.buffer += chunk
        reply, self.buffer = self.buffer.split(b"\n", 1)
        return json.loads(reply)


def send(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    lattice = Lattice()
    for line in sys.stdin:
        if not line.strip():
            continue
        msg = json.loads(line)
        ident, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
        if ident is None:
            continue  # notifications (initialized, cancelled) need no answer
        try:
            if method == "initialize":
                result = {"protocolVersion": params.get("protocolVersion", "2025-06-18"),
                          "capabilities": {"tools": {}}, "serverInfo": {"name": "lattice", "version": "1.0.0"}}
            elif method == "tools/list":
                result = {"tools": lattice.ask("list")["tools"]}
            elif method == "tools/call":
                reply = lattice.ask("call", name=params.get("name"), arguments=params.get("arguments") or {})
                result = {"content": [{"type": "text", "text": reply["content"]}], "isError": bool(reply.get("is_error"))}
            elif method == "ping":
                result = {}
            else:
                send({"jsonrpc": "2.0", "id": ident, "error": {"code": -32601, "message": "unsupported: " + str(method)}})
                continue
            send({"jsonrpc": "2.0", "id": ident, "result": result})
        except Exception as exc:
            send({"jsonrpc": "2.0", "id": ident, "error": {"code": -32000, "message": str(exc)}})


if __name__ == "__main__":
    main()
