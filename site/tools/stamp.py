"""Put each stylesheet's and script's content hash on its link in index.html, so a browser holding an old copy fetches
the new one.

    python tools/stamp.py

Run it after changing site.css, site.js or ui/lattice-ui.css.
"""
import hashlib, re
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
page = SITE / "index.html"
html = page.read_text()
for name in ("ui/lattice-ui.css", "site.css", "site.js"):
    v = hashlib.sha1((SITE / name).read_bytes()).hexdigest()[:8]
    html = re.sub(rf'(["\']){re.escape(name)}(\?v=\w+)?\1', rf"\g<1>{name}?v={v}\g<1>", html)
page.write_text(html)
