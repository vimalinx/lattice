"""Send JavaScript (or @file) to a running record.py and print what it returned: send.py <cmd-dir> <js|@file> [wait-ms] [shot]"""
import json, sys, time
from pathlib import Path
cmd = Path(sys.argv[1]); body = sys.argv[2]
if body.startswith("@"): body = Path(body[1:]).read_text()
n = max([int(p.stem) for p in cmd.glob("*.*") if p.stem.isdigit()] or [0]) + 1
spec = {"quit": True} if body == "QUIT" else {"js": body, "wait": int(sys.argv[3]) if len(sys.argv) > 3 else 300}
if len(sys.argv) > 4: spec["shot"] = sys.argv[4]
(cmd / f"{n}.tmp").write_text(json.dumps(spec)); (cmd / f"{n}.tmp").rename(cmd / f"{n}.json")
for _ in range(1200):
    out = cmd / f"{n}.out"
    if out.exists(): print(out.read_text()[:6000]); sys.exit(0)
    time.sleep(0.1)
print("TIMEOUT")
