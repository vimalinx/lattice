"""Working states, one file each in the vault's states/ folder, named for the state: everything a state is, as a program
of its own would be. What it is called and where it sits on the status bar, the windows open in it and how they are
arranged, its left column, and the topic learned in it (its conversations follow from that: each state has its own).

A file copied in from another vault is a state here too; one whose id is taken already gets an id of its own."""
from __future__ import annotations

import json
import re

from .index import uid
from .vault import STATES as FOLDER

# What the status bar shows of a state; the rest of the file is what is in it.
META = ("name", "icon", "from", "hidden", "order")


def file_for(name, taken=()):
    """states/<name>.json, made safe as a file name, and not one of `taken`."""
    base = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "-", str(name or "")).strip(" .")[:60] or "state"
    rel, n = f"{FOLDER}/{base}.json", 2
    while rel in taken:
        rel, n = f"{FOLDER}/{base} {n}.json", n + 1
    return rel


def read_all(vault):
    """Every state by its id, each with the file it is in (`rel`), in the order of the status bar."""
    folder = vault.path(FOLDER)
    found = []
    for path in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(data, dict) and isinstance(data.get("layout"), dict):
            found.append({**data, "rel": f"{FOLDER}/{path.name}"})
    out = {}
    for data in sorted(found, key=lambda d: (d.get("order") if isinstance(d.get("order"), (int, float)) else 1e9, d["rel"])):
        if not data.get("id") or data["id"] in out:
            data["id"] = "w" + uid()[:6]
            write(vault, data)
        out[str(data["id"])] = data
    return out


def write(vault, data):
    """Write a state to its file, only if it changed, so the history holds the changes and nothing else."""
    rel = data["rel"]
    # What it is first, then what is in it.
    first = ("id", *META, "topic", "side")
    ordered = {**{k: data[k] for k in first if k in data}, **{k: v for k, v in data.items() if k not in first and k != "rel"}}
    text = json.dumps(ordered, ensure_ascii=False, indent=1) + "\n"
    path = vault.path(rel)
    try:
        if path.read_text(encoding="utf-8") == text:
            return False
    except OSError:
        pass
    vault.write_text(rel, text)
    return True


def meta(data):
    return {"id": data["id"], **{k: data[k] for k in META if data.get(k) is not None}}


def unit(data):
    """A state as the interface holds it: its arrangement (with its left column and topic in it) and its panels."""
    layout = {**data.get("layout", {}), **({"side": data["side"]} if data.get("side") else {}), **({"topic": data["topic"]} if "topic" in data else {})}
    return {"layout": layout, "panels": data.get("panels") or {}}


def merged(data, given):
    """A state's file with what the interface saved of it: the topic and the left column are set out at the top."""
    layout = dict(given.get("layout") or {})
    side, out = layout.pop("side", None), {**data, "layout": layout, "panels": given.get("panels") or {}}
    if "topic" in layout:
        out["topic"] = layout.pop("topic")
    if side:
        out["side"] = side
    return out
