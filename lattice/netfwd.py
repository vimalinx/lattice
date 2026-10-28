"""Runs inside the sandbox, ahead of the command: it listens on 127.0.0.1 there and hands every connection, over the
unix socket bound in, to Lattice's proxy outside (netproxy.py); then it runs the command and exits as it does.
Standard library only: it runs on the system's Python, before any environment."""
import os
import socket
import subprocess
import sys
import threading


def pipe(a, b):
    try:
        while data := a.recv(65536):
            b.sendall(data)
    except OSError:
        pass
    finally:
        try:
            b.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def serve(server, path):
    while True:
        client, _ = server.accept()
        try:
            out = socket.socket(socket.AF_UNIX)
            out.connect(path)
        except OSError:
            client.close()
            continue
        threading.Thread(target=pipe, args=(client, out), daemon=True).start()
        threading.Thread(target=pipe, args=(out, client), daemon=True).start()


def main():
    path, port, command = sys.argv[1], int(sys.argv[2]), sys.argv[4:]
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", port))
    server.listen(128)
    threading.Thread(target=serve, args=(server, path), daemon=True).start()
    code = subprocess.call(command)
    sys.stdout.flush()
    os._exit(128 - code if code < 0 else code)


if __name__ == "__main__":
    main()
