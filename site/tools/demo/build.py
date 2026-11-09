"""Turn a recording of the real Lattice into the data the site's live demo answers from.

    python tools/demo/build.py <calls.jsonl> <demo-home>      -> app/demo/fixture.json

The recording is what tools/demo/record.py logged while setup.js, explore.js and panels.js drove Lattice on the promo
demo home: every rpc call with its arguments and answer, and every event. Each method keeps the first answer for each
distinct set of arguments, which is the demo as it was set up. Paths on this computer become ~/Lattice.
"""
import json, re, sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[2]
calls, home = Path(sys.argv[1]), Path(sys.argv[2]).resolve()
vault = str(home / "vault")
# answered by the demo itself, or just told to the backend; one answer kept for its shape
SHAPE_ONLY = {"window_held", "screen", "topic_here", "states_save", "viewed", "skill_install", "run"}

# demo data that would read oddly on the page
WORDING = {"The learner keeps mixing step size and direction.": "学习者总把步长和方向混在一起，先把两者拆开。"}

def scrub(text):
    for a, b in WORDING.items():
        text = text.replace(a, b)
    text = text.replace(vault, "~/Lattice").replace(str(home), "~/.lattice-demo")
    return re.sub(r"/home/[^/\"]+", "~", text)

out, events, seen = {}, {"run": []}, set()
for line in calls.read_text().splitlines():
    r = json.loads(scrub(line))
    if "evt" in r:
        e = r["evt"]
        if e.get("type") == "run" and len(events["run"]) < 12:
            events["run"].append(e)
        continue
    if "err" in r:
        continue
    m, a, d = r["m"], r["a"], r.get("d")
    key = m + json.dumps(a, sort_keys=True, ensure_ascii=False)
    if key in seen or (m in SHAPE_ONLY and m in out):
        continue
    seen.add(key)
    if m == "bootstrap":
        d = {**d, "busy": [], "status": {}, "problems": [], "migrated": False}
    out.setdefault(m, []).append([a, d])

dest = SITE / "app" / "demo"
dest.mkdir(parents=True, exist_ok=True)
data = json.dumps({"calls": out, "events": events}, ensure_ascii=False, separators=(",", ":"))
(dest / "fixture.json").write_text(data)
print(len(out), "methods,", sum(len(v) for v in out.values()), "answers,", len(data) // 1024, "KB;", len(events["run"]), "run events")
