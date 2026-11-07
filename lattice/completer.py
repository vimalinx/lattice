"""Runs on a learner's Python environment, for as long as Lattice wants completions from it: one request a line on stdin
(the code as it is typed, where the cursor is, the file's path), one answer a line on stdout. jedi is there because
ipykernel brought it; it reads the code, and the packages installed in this environment, without running either.
Standard library and jedi only."""
import json
import sys

# What jedi calls a name, as the editor's completion list shows it.
KINDS = {"module": "namespace", "class": "class", "function": "function", "keyword": "keyword", "property": "property",
         "param": "variable", "instance": "variable", "statement": "variable", "path": "text"}


def answer(req, jedi):
    script = jedi.Script(req["code"], path=req.get("path") or None)
    typed = req.get("typed") or ""
    out = []
    for c in script.complete(req["line"], req["column"]):
        name = c.name
        # Names a module or class keeps to itself only when they are asked for.
        if name.startswith("_") and not typed.startswith("_"):
            continue
        out.append({"label": name, "type": KINDS.get(c.type, "variable")})
        if len(out) >= req.get("limit", 200):
            break
    return {"items": out}


def main():
    try:
        import jedi
    except ImportError:
        jedi = None
    for line in sys.stdin:
        try:
            req = json.loads(line)
            got = answer(req, jedi) if jedi else {"error": "no jedi"}
        except Exception as exc:  # one bad request is answered as such; the next one still gets its answer
            got = {"error": str(exc)[:300]}
        sys.stdout.write(json.dumps(got, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
