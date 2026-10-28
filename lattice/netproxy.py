"""The way out to the internet for what runs in the sandbox. The sandbox has no network of its own; a small forwarder
inside it (netfwd.py) hands each connection over a unix socket to this proxy, which lets through only addresses on
the internet: never this machine (LocalRouter, kernels, other local services) or the local network, whatever a name
resolves to. It speaks plain HTTP proxying (CONNECT, and absolute-form requests), which pip, requests, urllib, curl,
git, npm and the rest use when HTTP(S)_PROXY is set. What was reached, and what was refused, is kept for a while so a
command's result can say where it went."""
from __future__ import annotations

import asyncio
from collections import deque
import logging
from pathlib import Path
import socket
import threading
import time
from urllib.parse import urlsplit

from .web import local_address

LOG = logging.getLogger("lattice")
PORT = 3128   # where the forwarder listens inside the sandbox


class NetProxy:
    def __init__(self, path):
        self.path = Path(path)
        self.visits = deque(maxlen=4000)   # (monotonic time, host, allowed)
        self.loop = None
        self._lock = threading.Lock()

    def start(self):
        """Started on first use, on a thread of its own; returns the socket's path."""
        with self._lock:
            if self.loop is None:
                ready = threading.Event()
                threading.Thread(target=self._run, args=(ready,), daemon=True, name="lattice-netproxy").start()
                if not ready.wait(10):
                    raise RuntimeError("沙箱的联网代理没有启动")
        return self.path

    def _run(self, ready):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.unlink(missing_ok=True)
        self.loop.run_until_complete(asyncio.start_unix_server(self._serve, path=str(self.path)))
        self.path.chmod(0o600)
        ready.set()
        self.loop.run_forever()
        # Stopped: the connections still open are ended in an orderly way before the loop goes.
        pending = asyncio.all_tasks(self.loop)
        for task in pending:
            task.cancel()
        self.loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        self.loop.close()

    def stop(self):
        if self.loop is not None and not self.loop.is_closed():
            self.loop.call_soon_threadsafe(self.loop.stop)
        self.path.unlink(missing_ok=True)

    def since(self, started):
        """Hosts reached and refused since a moment (time.monotonic())."""
        reached, refused = [], []
        for at, host, allowed in list(self.visits):
            if at >= started:
                target = reached if allowed else refused
                if host not in target:
                    target.append(host)
        return reached, refused

    async def _addresses(self, host, port):
        """Host's addresses, IPv4 first; none when any of them is local (a name that resolves to this machine or the
        local network is refused, however it is spelled)."""
        try:
            infos = await self.loop.getaddrinfo(host.strip("[]"), port, type=socket.SOCK_STREAM)
        except OSError:
            return []
        addresses = list(dict.fromkeys(info[4][0] for info in sorted(infos, key=lambda i: i[0] != socket.AF_INET)))
        return [] if any(local_address(a) for a in addresses) else addresses

    async def _connect(self, addresses, port):
        """The first of the addresses that answers (the checked address itself, so a name cannot change in between)."""
        last = None
        for address in addresses[:6]:
            try:
                return await asyncio.wait_for(asyncio.open_connection(address, port), 10)
            except (OSError, asyncio.TimeoutError) as exc:
                last = exc
        raise last or OSError("no address")

    async def _serve(self, reader, writer):
        upstream = None
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 30)
            lines = head.decode("latin-1").split("\r\n")
            method, target, version = (lines[0].split(" ") + ["", "", ""])[:3]
            if method == "CONNECT":
                host, _, port = target.rpartition(":")
                port = int(port) if port.isdigit() else 443
                rest = b""
            else:
                url = urlsplit(target)
                if url.scheme != "http" or not url.hostname:
                    return await self._refuse(writer, 400, "只代理 http(s) 请求")
                host, port = url.hostname, url.port or 80
                # Passed on as an ordinary request to that server, without the proxy's own headers.
                kept = [h for h in lines[1:] if h and not h.lower().startswith(("proxy-", "connection:", "keep-alive:"))]
                path = (url.path or "/") + (f"?{url.query}" if url.query else "")
                rest = (f"{method} {path} {version}\r\n" + "\r\n".join(kept + ["Connection: close"]) + "\r\n\r\n").encode("latin-1")
            addresses = await self._addresses(host, port)
            self.visits.append((time.monotonic(), host, bool(addresses)))
            if not addresses:
                return await self._refuse(writer, 403, f"沙箱只能访问互联网，不能连这台电脑或局域网里的地址（{host}），或者找不到这个网站")
            try:
                up_reader, upstream = await self._connect(addresses, port)
            except (OSError, asyncio.TimeoutError) as exc:
                return await self._refuse(writer, 502, f"连不上 {host}:{port}（{type(exc).__name__}）")
            if method == "CONNECT":
                writer.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
                await writer.drain()
            else:
                upstream.write(rest)
            await asyncio.gather(self._pipe(reader, upstream), self._pipe(up_reader, writer))
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError, OSError):
            pass
        except Exception:
            LOG.exception("net proxy")
        finally:
            for w in (writer, upstream):
                if w is not None:
                    w.close()

    @staticmethod
    async def _pipe(reader, writer):
        try:
            while data := await reader.read(65536):
                writer.write(data)
                await writer.drain()
        except (ConnectionError, OSError):
            pass
        finally:
            try:
                writer.write_eof()
            except (OSError, RuntimeError):
                pass

    @staticmethod
    async def _refuse(writer, code, why):
        body = why.encode()
        writer.write(f"HTTP/1.1 {code} Lattice\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body)
        await writer.drain()
