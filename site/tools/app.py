"""Copy Lattice's interface (../ui) into app/, as the site's live demo runs it: its backend is app/demo (backend.js
answering from fixture.json) in place of Qt's web channel.

    python tools/app.py

Run it after changing anything in ui/, then tools/stamp.py. app/demo is the demo's own and is left alone. pdf.js stays
out (the demo vault has no PDF, and it is most of the weight), and so does the e-book reader: no books there either.
"""
import shutil
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
UI, APP = SITE.parent / "ui", SITE / "app"
SKIP = {"pdfjs", "book", "__pycache__", "icon-source.txt"}

for p in APP.iterdir() if APP.exists() else []:
    if p.name != "demo":
        shutil.rmtree(p) if p.is_dir() else p.unlink()
APP.mkdir(exist_ok=True)
for p in UI.iterdir():
    if p.name in SKIP:
        continue
    if p.is_dir():
        shutil.copytree(p, APP / p.name, ignore=shutil.ignore_patterns(*SKIP))
    else:
        shutil.copy2(p, APP / p.name)

page = APP / "index.html"
html = page.read_text()
qt = '<script src="qrc:///qtwebchannel/qwebchannel.js"></script>'
assert qt in html, "ui/index.html no longer loads qwebchannel.js the way this expects"
html = html.replace(qt, '<script src="demo/bridge.js"></script>')
html = html.replace(" qrc:", "")
# pages of the demo, not of the site: kept out of search
noindex = '<meta name="robots" content="noindex"/>\n'
html = html.replace("<title>", noindex + "  <title>", 1)
page.write_text(html)
for sub in ("widget/index.html",):
    p = APP / sub
    if p.exists():
        t = p.read_text()
        if 'name="robots"' not in t:
            p.write_text(t.replace("<title>", '<meta name="robots" content="noindex">\n<title>', 1))
print("app/ from ui/:", sum(1 for _ in APP.rglob("*") if _.is_file()), "files")
