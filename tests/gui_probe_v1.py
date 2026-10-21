import os,sys,tempfile,json
from pathlib import Path
qa=Path(tempfile.mkdtemp(prefix='lattice-render-probe-'))
os.environ['XDG_DATA_HOME']=str(qa/'data');os.environ['XDG_CONFIG_HOME']=str(qa/'config');os.environ['LATTICE_VAULT']=str(qa/'vault')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QTimer,Qt
from PySide6.QtWidgets import QApplication
QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
from main import MainWindow
app=QApplication([]);w=MainWindow();w.show();print('WINDOW',qa,flush=True)
w.view.loadStarted.connect(lambda:print('LOAD_STARTED',flush=True))
w.view.loadFinished.connect(lambda ok:print('LOAD_FINISHED',ok,flush=True))
w.view.loadProgress.connect(lambda n:print('LOAD_PROGRESS',n,flush=True))
w.page.renderProcessTerminated.connect(lambda *x:print('RENDER_TERMINATED',x,flush=True))
def probe():
    print('PROBE_URL',w.page.url().toString(),'PID',w.page.renderProcessPid(),flush=True)
    w.view.grab().save(str(qa/'probe.png'))
    w.page.runJavaScript('JSON.stringify({title:document.title,body:document.body.innerText.slice(0,1500),ready:typeof S!=="undefined"&&!!S.data})',lambda x:print('JS_RESULT',x,flush=True))
def end():
    print('PROBE_DONE',flush=True);w.close();app.quit()
QTimer.singleShot(6000,probe);QTimer.singleShot(17000,end)
app.exec()
