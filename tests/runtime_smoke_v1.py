"""Real Jupyter + local HTTP/SSE integration checks. No external API key needed."""
import json, tempfile, time, threading, sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QCoreApplication
from lattice.notebook import NotebookWorker
from lattice.providers import FlashWorker, DEFAULTS
app=QCoreApplication.instance() or QCoreApplication([])
results=[]
def spin(test,seconds=40):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        app.processEvents();time.sleep(.015)
        if test():return
    raise AssertionError('等待事件超时')
def check(name,ok):
    assert ok,name
    results.append(name);print('PASS',name,flush=True)
def run_code(w,events,code,rid):
    events.clear();w.submit([{'id':rid,'cell_id':rid,'source':code}]);spin(lambda:any(e['kind']=='batch_finished' for e in events))
    return next(e for e in events if e['kind']=='run_finished')
with tempfile.TemporaryDirectory() as tmp:
    events=[];w=NotebookWorker('test-notebook',tmp,timeout=12);w.event.connect(events.append);w.start()
    try:
        spin(lambda:any(e.get('state')=='ready' for e in events))
        r=run_code(w,events,'x=40\nx','one');check('real Jupyter execute_result',r['state']=='completed' and '40' in json.dumps(r['outputs']))
        r=run_code(w,events,'x+2','two');check('persistent variables across cells','42' in json.dumps(r['outputs']) and r['execution_count']==2)
        r=run_code(w,events,'import matplotlib.pyplot as plt\nplt.plot([1,2,3],[1,4,9])\nplt.show()','plot');check('actual inline PNG figure','image/png' in json.dumps(r['outputs']))
        r=run_code(w,events,'1/0','err');check('real Python exception',r['state']=='error' and 'ZeroDivisionError' in json.dumps(r['outputs']))
        events.clear();w.submit([{'id':'bad','cell_id':'bad','source':'1/0'},{'id':'skip','cell_id':'skip','source':'print("must not run")'}]);spin(lambda:any(e['kind']=='batch_finished' for e in events));check('run-all stops after error',any(e.get('run_id')=='skip' and e.get('state')=='skipped' for e in events))
        events.clear();w.submit([{'id':'cancel','cell_id':'cancel','source':'import time\nwhile True: time.sleep(.1)'}]);spin(lambda:any(e['kind']=='run_started' for e in events));time.sleep(.4);w.interrupt();spin(lambda:any(e['kind']=='batch_finished' for e in events));check('interrupt infinite loop',any(e.get('state')=='cancelled' for e in events))
        events.clear();w.restart();spin(lambda:any(e.get('restarted') for e in events));r=run_code(w,events,'x','new-epoch');check('restart clears live variables',r['state']=='error' and 'NameError' in json.dumps(r['outputs']))
    finally:
        w.stop();w.wait(35000);app.processEvents()

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"data":[{"id":"test-flash"}]}')
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert body['stream'] and body['model']=='test-flash'
        if self.path.startswith('/error'):
            self.send_response(401);self.end_headers();self.wfile.write(b'invalid sk-test-secret');return
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
        try:
            for text in ['变量','像一个','有名字的盒子。']:
                self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':text}}]},ensure_ascii=False)+'\n\n').encode());self.wfile.flush();time.sleep(.03)
            if self.path.startswith('/truncated'):return
            if self.path.startswith('/slow'):time.sleep(8)
            self.wfile.write(b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    for mode in ['ok','truncated','error','slow']:
        events=[];cfg={**DEFAULTS,'base_url':f'http://127.0.0.1:{server.server_port}/{mode}','model':'test-flash','extra_body':{}}
        f=FlashWorker('topic','session',cfg,'sk-test-secret',[{'role':'user','content':'变量是什么'}]);f.event.connect(events.append);f.start()
        try:
            if mode=='slow':spin(lambda:any(e['kind']=='chunk' for e in events));t=time.monotonic();f.stop()
            spin(lambda:any(e['kind']=='finished' for e in events),15)
            end=next(e for e in events if e['kind']=='finished')
            if mode=='ok':check('Flash Unicode SSE assembly',end['text']=='变量像一个有名字的盒子。' and end['stop_reason']=='end_turn')
            if mode=='truncated':check('truncated SSE preserves partial, reports error',end['text'] and end['stop_reason']=='error')
            if mode=='error':check('HTTP errors redact credentials',end['stop_reason']=='error' and 'sk-test-secret' not in json.dumps(events))
            if mode=='slow':check('Flash cancellation interrupts pending network read',end['stop_reason']=='cancelled' and time.monotonic()-t<3)
        finally:f.stop();f.wait(5000);app.processEvents()
    events=[];f=FlashWorker('','',cfg,'sk-test-secret',[],test=True);f.event.connect(events.append);f.start();spin(lambda:any(e['kind']=='connection_test' for e in events));f.wait(5000)
    check('API settings connection test reads /models',any(e.get('ok') and e.get('model_found') for e in events))
finally:server.shutdown()
print('RUNTIME_RESULT',json.dumps({'passed':len(results),'checks':results},ensure_ascii=False),flush=True)
