"""Actual Codex ACP -> course proposal -> acceptance -> Jupyter result."""
import json, os, sys, tempfile, time
from pathlib import Path
qa=Path(tempfile.mkdtemp(prefix='lattice-codex-e2e-'))
os.environ['XDG_DATA_HOME']=str(qa/'data');os.environ['XDG_CONFIG_HOME']=str(qa/'config')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PySide6.QtCore import QCoreApplication
from lattice.learning_bridge import LearningBridge
app=QCoreApplication([]);b=LearningBridge(config_path=qa/'providers.json')
b.providers.save({'codex_effort':'low'})
state=b.learning.snapshot();topic=state['active_topic'];events=[]
b.event.connect(lambda raw:events.append(json.loads(raw)))
def wait_until(predicate,timeout):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        app.processEvents();time.sleep(.015)
        for e in events:
            if e.get('kind')=='permission':
                b.dispatch('agent_permission',{'id':e['session_id'],'request_id':e['request_id']});e['kind']='denied'
        if predicate():return
    raise TimeoutError('Timed out: '+json.dumps(events[-4:],ensure_ascii=False)[:1000])
result={'path':str(qa),'checks':[]}
try:
    b.learning_send(topic,'tutor','这是一次真实端到端验收。不要调用工具，不要阅读文件。用两句话解释 Python 加法，然后严格附加一个 lattice JSON 代码块，包含 version:1, summary、一个 lessons 条目、标题为「ACP验收加法」的 cards 条目、一个 code 单元格 source 为「40 + 2」。不要声称运行过。',task='plan')
    wait_until(lambda:any(e.get('type')=='learning_agent' and e.get('kind')=='finished' for e in events),100)
    done=next(e for e in events if e.get('type')=='learning_agent' and e.get('kind')=='finished')
    assert done.get('stop_reason')=='end_turn',str(done)[:500]
    result['checks'].append('Actual Codex reply through teaching bridge')
    proposals=b.learning.snapshot(topic)['proposals'];assert proposals,'No structured proposal'
    result['checks'].append('Real model structured course/card/cell parsed')
    nb=b.learning.notebook_create(topic,'ACP 真实验收')
    applied=b.learning.proposal_apply(proposals[0]['id'],nb['id'])
    actual=b.learning.notebook(nb['id']);assert actual['cells'];cell=next(c for c in actual['cells'] if c['kind']=='code')
    result['checks'].append('Explicit acceptance persisted proposed material')
    b.run_notebook(nb['id'],cell['id'])
    wait_until(lambda:any(e.get('type')=='notebook' and e.get('kind')=='batch_finished' for e in events),45)
    history=b.learning.run_history(cell['id']);assert history and history[0]['state']=='completed';assert '42' in json.dumps(history[0]['outputs'])
    result['checks'].append('Actual accepted Codex experiment executed to 42')
    result['reply']=done.get('text','')
    print('CODEX_LEARNING_RESULT',json.dumps(result,ensure_ascii=False),flush=True)
    (qa/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
finally:
    b.shutdown()
