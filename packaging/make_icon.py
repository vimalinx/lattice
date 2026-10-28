"""ui/icon.svg as the Windows icon (packaging/build/lattice.ico), drawn by Qt at every size Windows asks for."""
from pathlib import Path
import sys

from PIL import Image
from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication, QImage, QPainter
from PySide6.QtSvg import QSvgRenderer

ROOT = Path(__file__).resolve().parents[1]
out = ROOT / "packaging" / "build"
out.mkdir(parents=True, exist_ok=True)
app = QGuiApplication(sys.argv[:1] + ["-platform", "offscreen"])
image = QImage(256, 256, QImage.Format.Format_ARGB32)
image.fill(Qt.GlobalColor.transparent)
painter = QPainter(image)
QSvgRenderer(str(ROOT / "ui" / "icon.svg")).render(painter)
painter.end()
image.save(str(out / "lattice.png"))
Image.open(out / "lattice.png").save(out / "lattice.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(out / "lattice.ico")
