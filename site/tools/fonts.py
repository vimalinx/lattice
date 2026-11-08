"""Subset the display serif to the characters the site uses, and copy the monospace face, into fonts/.

    python tools/fonts.py

Run it again after the page's words change: a character missing from the subset falls back to the system's serif.
Noto Serif CJK and JetBrains Mono are under the SIL Open Font License.
"""
import re
from pathlib import Path
from fontTools.ttLib import TTCollection
from fontTools import subset

SITE = Path(__file__).resolve().parents[1]
SERIF = "/usr/share/fonts/noto-cjk/NotoSerifCJK-Black.ttc"
MONO = {"400": "/usr/share/fonts/TTF/JetBrainsMono-Regular.ttf", "500": "/usr/share/fonts/TTF/JetBrainsMono-Medium.ttf"}

text = "".join(p.read_text() for p in [SITE / "index.html", SITE / "site.js"])
chars = set(text) | set(map(chr, range(0x20, 0x7f))) | set("，。、；：？！「」『』（）《》“”‘’…—·　")
(SITE / "fonts").mkdir(exist_ok=True)

# the Simplified Chinese face of the collection
coll = TTCollection(SERIF)
face = next(f for f in coll.fonts if "SC" in f["name"].getDebugName(1))
tmp = SITE / "fonts" / ".serif.otf"
face.save(tmp)
opts = subset.Options(); opts.flavor = "woff2"; opts.layout_features = ["*"]; opts.name_IDs = ["*"]
for src, out, keep in [(tmp, "serif-black.woff2", chars)] + [(Path(p), f"mono-{w}.woff2", set(map(chr, range(0x20, 0x7f))) | set("→←−·…✕✓├─└│")) for w, p in MONO.items()]:
    font = subset.load_font(str(src), opts)
    s = subset.Subsetter(opts); s.populate(text="".join(keep)); s.subset(font)
    subset.save_font(font, str(SITE / "fonts" / out), opts)
    print(out, (SITE / "fonts" / out).stat().st_size // 1024, "KB")
tmp.unlink()
