"""Deterministic persistence, proposal, provenance and configuration acceptance tests."""
import json
from pathlib import Path
import stat
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lattice.store import Store
from lattice.learning import LearningStore
from lattice.providers import ProviderConfig, endpoint, clean_error, DEFAULTS

@pytest.fixture
def model(tmp_path):
    s=Store(tmp_path/'data.db',seed=False)
    s.save_note({'title':'已有笔记','body':'不能丢失'})
    l=LearningStore(s)
    yield l
    s.close()

def topic(l):
    return l.snapshot()['active_topic']

def test_preserves_old_data_and_seed_not_mastery(model):
    assert model.store.list_notes()[0]['body']=='不能丢失'
    assert all(c['stage']=='suggested' for c in model.snapshot()['cards'])
    assert not any(c['evidence'] for c in model.snapshot()['cards'])

def test_topics_and_cycle_prevention(model):
    p=topic(model);child=model.topic_save({'title':'兴趣分支','parent_id':p})
    with pytest.raises(ValueError):model.topic_save({'id':p,'parent_id':child['id']})
    model.focus(child['id']);assert model.snapshot()['active_topic']==child['id']

def test_card_roundtrip_and_duplicate(model):
    c=model.card_save({'title':'Unique A','body':'解释','understanding':'我的话','stage':'explained'})
    assert model.card(c['id'])['understanding']=='我的话'
    with pytest.raises(ValueError):model.card_save({'title':'unique a','body':'重复'})
    model.card_save({**c,'question':'为什么'})
    assert model.card(c['id'])['question']=='为什么'

def test_relations_no_cycle(model):
    a=model.card_save({'title':'Prereq A'});b=model.card_save({'title':'Prereq B'})
    model.relation_add(a['id'],b['id'],'prerequisite','先 A 再 B')
    with pytest.raises(ValueError):model.relation_add(b['id'],a['id'],'prerequisite')
    with pytest.raises(ValueError):model.relation_add(a['id'],a['id'])

def test_review_is_not_mastery(model):
    c=model.card_save({'title':'Review','stage':'seen'})
    model.review(c['id'],'我还不确定',again=True)
    got=model.card(c['id']);assert got['stage']=='seen' and got['review_count']==1 and got['due_at']
    assert got['evidence'][0]['kind']=='review'

def test_real_run_snapshot_stale_and_ipynb(model):
    n=model.notebook_create(topic(model),'测试');c=model.cell_save({'notebook_id':n['id'],'source':'x=2\nx'})
    run=model.run_create(c['id'])
    model.cell_save({**c,'source':'x=3\nx'})
    model.run_finish(run['id'],[{'output_type':'execute_result','data':{'text/plain':'2'},'metadata':{},'execution_count':1}],'completed',1,'epoch')
    cc=model.notebook(n['id'])['cells'][0]
    assert cc['stale'] and cc['run_source']=='x=2\nx'
    assert model.run_history(c['id'])[0]['source']=='x=2\nx'
    nb=model.ipynb(n['id']);assert nb['nbformat']==4 and nb['cells'][0]['execution_count'] is None
    assert nb['cells'][0]['outputs']==[] and nb['cells'][0]['metadata']['lattice']['stale_output_omitted']

def test_import_never_claims_foreign_results(model):
    n=model.ipynb_import(topic(model),{'nbformat':4,'cells':[{'cell_type':'code','source':['2+2'],'execution_count':17,'outputs':[{'output_type':'stream','name':'stdout','text':'FAKE'}]}]})
    c=n['cells'][0];assert c['outputs']==[] and c['execution_count'] is None

def test_evidence_requires_completed_run(model):
    n=model.notebook_create(topic(model));c=model.cell_save({'notebook_id':n['id'],'source':'1'})
    r=model.run_create(c['id']);k=model.card_save({'title':'RunEvidence'})
    with pytest.raises(ValueError):model.evidence_add(k['id'],'experiment','观察',r['id'])
    model.run_finish(r['id'],[],'completed',1,'e')
    model.evidence_add(k['id'],'experiment','观察',r['id'])
    assert model.card(k['id'])['evidence'][0]['run_id']==r['id']

def proposal(l,payload):
    ids=l.proposal_extract(topic(l),'tutor','```lattice\n'+json.dumps(payload,ensure_ascii=False)+'\n```',None)
    return l.snapshot()['proposals'][0]['id']

def test_proposal_is_explicit_atomic_and_idempotent(model):
    n0=len(model.snapshot()['cards'])
    pid=proposal(model,{'version':1,'summary':'可采纳','cards':[{'title':'Proposed card','body':'候选解释'}],'cells':[{'kind':'code','source':'40+2'}]})
    assert len(model.snapshot()['cards'])==n0
    model.proposal_apply(pid);assert len(model.snapshot()['cards'])==n0+1
    model.proposal_apply(pid);assert len(model.snapshot()['cards'])==n0+1
    assert model.db.execute('SELECT COUNT(*) FROM learn_runs').fetchone()[0]==0

def test_proposal_notes_become_experience_notes(model):
    n0=len(model.store.list_notes())
    pid=proposal(model,{'version':1,'summary':'带经验','notes':[{'title':'调参心得','body':'eta 先小后大','folder':'经验'}]})
    model.proposal_apply(pid)
    notes=model.store.list_notes()
    assert len(notes)==n0+1 and any(n['title']=='调参心得' and n['folder']=='经验' for n in notes)

def test_invalid_reference_rolls_back_all(model):
    n0=len(model.snapshot()['cards'])
    pid=proposal(model,{'version':1,'cards':[{'title':'Should rollback'}],'relations':[{'source':'Should rollback','target':'missing!','kind':'prerequisite'}]})
    with pytest.raises(ValueError):model.proposal_apply(pid)
    assert len(model.snapshot()['cards'])==n0 and model.one('learn_proposals',pid)['state']=='pending'

def test_bad_payload_rejected(model):
    with pytest.raises(ValueError):model.validate_payload({'version':999})
    with pytest.raises(ValueError):model.validate_payload({'version':1,'execute':'rm'})
    with pytest.raises(ValueError):model.validate_payload({'version':1,'cards':[{'title':'X','stage':'applied'}]})

def test_existing_understanding_not_overwritten(model):
    c=model.card_save({'title':'Existing','understanding':'只属于我的理解','body':'原文'})
    pid=proposal(model,{'version':1,'cards':[{'title':'Existing','body':'AI新补充'}]})
    model.proposal_apply(pid)
    got=model.card(c['id']);assert got['understanding']=='只属于我的理解' and got['body']=='原文'
    assert any('AI新补充' in e['content'] for e in got['evidence'])

def test_context_shared_not_fake_runtime(model):
    t=topic(model);threads=model.threads(t)
    model.store.append_message(threads['flash_session'],'user','变量到底是什么')
    raw=json.dumps(model.context(t,'tutor'),ensure_ascii=False)
    assert '变量到底是什么' in raw

def test_persistence_reopen(tmp_path):
    s=Store(tmp_path/'db',seed=False);l=LearningStore(s);c=l.card_save({'title':'persistent'})
    s.close();s=Store(tmp_path/'db',seed=False);l=LearningStore(s);assert l.card(c['id'])['title']=='persistent';s.close()

def test_config_private_permissions_masking_and_url(tmp_path,monkeypatch):
    monkeypatch.delenv('COMMANDCODE_API_KEY',raising=False)
    c=ProviderConfig(tmp_path/'providers.json')
    public=c.save({'apis':{'commandcode':{'api_key':'sk-not-a-real-key','base_url':'http://127.0.0.1:1234/v1','extra_body':{}}}})
    assert public['has_key'] and 'sk-not-a-real-key' not in json.dumps(public)
    assert stat.S_IMODE(c.path.stat().st_mode)==0o600
    c.save({'apis':{'commandcode':{'api_key':''}}});assert c.key('commandcode')=='sk-not-a-real-key'
    c.save({'apis':{'commandcode':{'clear_key':True}}});assert not c.key('commandcode')
    with pytest.raises(ValueError):c.save({'apis':{'commandcode':{'base_url':'https://user:pass@evil.example'}}})
    assert endpoint('https://host/v1/chat/completions','models')=='https://host/v1/models'
    assert 'sk-not-a-real-key' not in clean_error('Failure sk-not-a-real-key','sk-not-a-real-key')

def test_messages_window_returns_latest(model):
    s=model.store.new_session('codex')
    for i in range(1520):
        model.store.append_message(s['id'],'user',f'm{i}')
    msgs=model.store.messages(s['id'])
    assert len(msgs)==1500 and msgs[0]['content']=='m20' and msgs[-1]['content']=='m1519'

def test_one_rejects_tables_without_id_column(model):
    for table in ('learn_threads','learn_settings'):
        with pytest.raises(ValueError):model.one(table,'anything')
    with pytest.raises(ValueError):model.one('not_a_table','x')

def test_schema_version_is_stamped(model):
    assert model.db.execute('PRAGMA user_version').fetchone()[0]>=1

def test_topic_delete_reparents_children_and_detaches_cards(model):
    t=topic(model)
    child=model.topic_save({'title':'分支主题','parent_id':t})
    card=model.card_save({'title':'Survives','topic_id':t})
    nb=model.notebook_create(t)
    cell=model.cell_save({'notebook_id':nb['id'],'source':'1'})
    model.run_finish(model.run_create(cell['id'])['id'],[],'completed')
    model.lesson_save({'topic_id':t,'title':'会被删掉'})
    model.topic_delete(t)
    with pytest.raises(ValueError):model.one('learn_topics',t)
    assert model.card(card['id'])['topic_id'] is None
    assert model.one('learn_topics',child['id'])['parent_id'] is None
    assert not model.rows('SELECT * FROM learn_lessons WHERE topic_id=?',(t,))
    assert not model.rows('SELECT * FROM learn_threads WHERE topic_id=?',(t,))
    assert not model.rows('SELECT * FROM learn_notebooks WHERE id=?',(nb['id'],))
    assert not model.rows('SELECT * FROM learn_cells WHERE notebook_id=?',(nb['id'],))
    assert not model.rows('SELECT * FROM learn_runs WHERE notebook_id=?',(nb['id'],))
    assert model.snapshot()['active_topic']!=t

def test_lesson_and_notebook_delete(model):
    t=topic(model)
    l=model.lesson_save({'topic_id':t,'title':'临时课程'})
    model.lesson_delete(l['id'])
    assert not model.rows('SELECT * FROM learn_lessons WHERE id=?',(l['id'],))
    nb=model.notebook_create(t)
    c=model.cell_save({'notebook_id':nb['id'],'source':'1'})
    model.run_finish(model.run_create(c['id'])['id'],[],'completed')
    model.notebook_delete(nb['id'])
    assert not model.rows('SELECT * FROM learn_cells WHERE notebook_id=?',(nb['id'],))
    assert not model.rows('SELECT * FROM learn_runs WHERE notebook_id=?',(nb['id'],))
    with pytest.raises(ValueError):model.one('learn_notebooks',nb['id'])

def test_corrupt_provider_config_falls_back(tmp_path,monkeypatch):
    monkeypatch.delenv('COMMANDCODE_API_KEY',raising=False)
    p=tmp_path/'providers.json';p.write_text('{ broken json',encoding='utf-8')
    c=ProviderConfig(p)
    assert c.read()['flash_model']==DEFAULTS['flash_model']
    public=c.public()
    assert public['has_key'] is False and not any('api_key' in a for a in public['apis'])

def test_markdown_import_is_idempotent(tmp_path):
    from PySide6.QtCore import QCoreApplication
    from lattice.bridge import Bridge
    QCoreApplication.instance() or QCoreApplication([])
    folder=tmp_path/'mds';folder.mkdir()
    (folder/'alpha.md').write_text('# Alpha\n第一版',encoding='utf-8')
    s=Store(tmp_path/'db3',seed=False)
    bridge=Bridge(store=s)
    assert bridge.import_markdown(str(folder))['count']==1
    (folder/'alpha.md').write_text('# Alpha\n第二版',encoding='utf-8')
    bridge.import_markdown(str(folder))
    notes=s.list_notes()
    assert len(notes)==1 and '第二版' in notes[0]['body']
    s.close()
