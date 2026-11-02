from pathlib import Path
import subprocess
from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication, QImage, QPainter
from PySide6.QtSvg import QSvgRenderer
root=Path(__file__).resolve().parents[2]
folder=root/'packaging/build/Lattice.iconset'
folder.mkdir(parents=True,exist_ok=True)
app=QGuiApplication([])
for size in (16,32,128,256,512):
    for scale in (1,2):
        image=QImage(size*scale,size*scale,QImage.Format.Format_ARGB32)
        image.fill(Qt.GlobalColor.transparent)
        painter=QPainter(image)
        QSvgRenderer(str(root/'ui/icon.svg')).render(painter)
        painter.end()
        image.save(str(folder/f'icon_{size}x{size}{"@2x" if scale==2 else ""}.png'))
from PIL import Image
Image.open(folder/'icon_512x512@2x.png').save(root/'packaging/macos/Lattice.icns', format='ICNS')
