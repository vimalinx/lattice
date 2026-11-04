"""The quick answer answers two questions at once: each request leaves out the question still being answered, so both
start the same and the service reads that shared start from its cache; the replies are kept question by question."""
import json, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from PySide6.QtCore import QCoreApplication, QEventLoop, QTimer

from lattice.bridge import Bridge

SEEN = []


class Model(BaseHTTPRequestHandler):
    """A model that answers "slow …" slowly and everything else at once, and keeps what each request sent."""
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append(body["messages"])
        last = body["messages"][-1]["content"]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for word in (["答", "一"] if last.startswith("slow") else ["答", "二"]):
            self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": word}}]}, ensure_ascii=False) + "\n\n").encode())
            self.wfile.flush()
            time.sleep(.6 if last.startswith("slow") else .02)
        self.wfile.write(b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
        self.wfile.flush()


@pytest.fixture
def bridge(tmp_path):
    QCoreApplication.instance() or QCoreApplication([])
    server = ThreadingHTTPServer(("127.0.0.1", 0), Model)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    b = Bridge(root=tmp_path / "vault", config_path=tmp_path / "providers.json")
    conn = {"label": "test", "base_url": f"http://127.0.0.1:{server.server_port}", "model": "m", "headers": {}, "extra_body": {},
            "api_key": "sk-test", "max_tokens": 200, "timeout": 30, "temperature": 0.3}
    b.config.agent = lambda *args, **kwargs: dict(conn)
    SEEN.clear()
    yield b
    b.closing = True
    server.shutdown()
    b.lattice.db.close()


def wait(bridge, test, seconds=15):
    end = time.monotonic() + seconds
    while time.monotonic() < end and not test():
        loop = QEventLoop()
        QTimer.singleShot(30, loop.quit)
        loop.exec()
    assert test()


def finished(events):
    return [e for e in map(json.loads, events) if e.get("type") == "agent" and e.get("kind") == "finished"]


def test_two_questions_at_once_each_leave_the_other_out(bridge):
    events = []
    bridge.event.connect(events.append)
    first = bridge.rpc_send("flash", "slow 第一个问题", space="chat")
    wait(bridge, lambda: len(SEEN) == 1)
    second = bridge.rpc_send("flash", "第二个问题", thread=first["thread"])
    assert second["thread"] == first["thread"] and second["run"] != first["run"]
    wait(bridge, lambda: len(finished(events)) == 2)
    one, two = SEEN
    assert not any("第一个问题" in m["content"] for m in two)
    # Everything before the question is the same, so the second request's start is already in the service's cache.
    assert one[:-1] == two[:-1]
    # The quick one finished first; the record reads question by question all the same.
    done = finished(events)
    assert [e["run"] for e in done] == [second["run"], first["run"]]
    said = [(m["role"], m["content"]) for m in bridge.rpc_chat("flash", thread=first["thread"])["messages"]]
    assert said == [("user", "slow 第一个问题"), ("assistant", "答一"), ("user", "第二个问题"), ("assistant", "答二")]
    assert not bridge.busy


def test_the_next_question_sees_both_in_order_and_starts_as_the_first_did(bridge):
    events = []
    bridge.event.connect(events.append)
    first = bridge.rpc_send("flash", "slow 甲", space="chat")
    wait(bridge, lambda: len(SEEN) == 1)
    bridge.rpc_send("flash", "乙", thread=first["thread"])
    wait(bridge, lambda: len(finished(events)) == 2)
    bridge.rpc_send("flash", "丙", thread=first["thread"])
    wait(bridge, lambda: len(finished(events)) == 3)
    third = SEEN[2]
    assert [m["content"] for m in third[1:-1]] == ["slow 甲", "答一", "乙", "答二"]
    assert third[0] == SEEN[0][0] and third[1]["content"] == "slow 甲"


def test_only_the_quick_answer_answers_more_than_one_at_a_time(bridge):
    events = []
    bridge.event.connect(events.append)
    started = bridge.rpc_send("tutor", "slow 一个问题")
    wait(bridge, lambda: len(SEEN) == 1)
    with pytest.raises(ValueError):
        bridge.rpc_send("tutor", "另一个", thread=started["thread"])
    flash = bridge.rpc_send("flash", "slow 1", space="chat")["thread"]
    for text in ("slow 2", "slow 3"):
        bridge.rpc_send("flash", text, thread=flash)
    with pytest.raises(ValueError):
        bridge.rpc_send("flash", "slow 4", thread=flash)
    wait(bridge, lambda: len(finished(events)) == 4, 20)
