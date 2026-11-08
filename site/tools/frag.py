"""Turn DOM dumps of the running app into fragments the site shows as the real interface.

    python tools/frag.py <dump-dir> [name ...]      -> ui/<name>.htm

They are .htm rather than .html: pieces of a page, so a host that lists or checks its pages leaves them alone.
A dump is what capture/prelude.js dumpDom() returns in the Lattice-promo capture driver: the app's #app as it was on
screen. Ids become data-id (several copies of the app share the page; ui/lattice-ui.css is style.css scoped to .lt by
Lattice-promo's scope_css.py and selects [data-id=…]). Scripts and handlers go; the blank relations canvas goes, the
site draws that graph itself; the map's graph stays as the picture it was dumped as.
"""
import json, re, sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
# Demo data that would read oddly on the page.
WORDING = {"The learner keeps mixing step size and direction.": "学习者总把步长和方向混在一起，先把两者拆开。"}


def clean(h):
    h = re.sub(r"<script\b.*?</script>", "", h, flags=re.S)
    h = re.sub(r'\son[a-z]+="[^"]*"', "", h)
    h = re.sub(r'\sid="([^"]+)"', r' data-id="\1"', h)
    h = re.sub(r'(<div class="rel-canvas"[^>]*>)<img [^>]*>', r"\1", h)
    for a, b in WORDING.items():
        h = h.replace(a, b)
    return h


def build(path):
    d = json.loads(Path(path).read_text())
    name = Path(path).stem
    overlays = "".join(clean(o) for o in d.get("overlays", []) if "drop-mark" not in o[:60])
    out = (f'<div class="lt {d.get("theme") or "light"} app-frame" data-density="comfortable" '
           f'style="--font-size:14.5px;--code-size:13px;--line-height:1.8;--read-width:640px" data-frag="{name}">'
           + clean(d["html"]) + (f'<div class="app-overlays">{overlays}</div>' if overlays else "") + "</div>")
    (SITE / "ui").mkdir(exist_ok=True)
    (SITE / "ui" / f"{name}.htm").write_text(out)
    print(name, len(out))


src = Path(sys.argv[1])
for p in sorted(src.glob("*.json")):
    if len(sys.argv) < 3 or p.stem in sys.argv[2:]:
        build(p)
