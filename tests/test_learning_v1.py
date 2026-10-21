"""Deterministic persistence, ownership and configuration acceptance tests."""
import json
from pathlib import Path
import stat
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lattice.model import Lattice
from lattice.providers import Config, endpoint, clean_error, DEFAULTS

@pytest.fixture
def model(tmp_path):
    l=Lattice(tmp_path/'vault')
    l.note_create('已有笔记','不能丢失','Knowledge')
    yield l
    l.db.close()

def test_files_are_the_truth_and_the_index_rebuilds(model):
    note=model.docs('note')[0]
    assert model.vault.read_md(note['path'])[1]=='不能丢失'
    (model.root/'.lattice'/'index.db').unlink()
    model.db.close()
    again=Lattice(model.root)
    assert again.docs('note')[0]['body']=='不能丢失'
    again.db.close()

def test_topics_and_cycle_prevention(model):
    p=model.topic_save({'title':'主线'});child=model.topic_save({'title':'兴趣分支','parent':p['id']})
    with pytest.raises(ValueError):model.topic_save({'id':p['id'],'parent':child['id']})
    model.focus(child['id']);assert model.active_topic()==child['id']

def test_card_roundtrip_and_duplicate(model):
    c=model.card_save({'title':'Unique A','body':'解释','mine':'我的话','stage':'explained'})
    assert model.card(c['id'])['mine']=='我的话' and model.card(c['id'])['stage']=='explained'
    with pytest.raises(ValueError):model.card_save({'id':model.card_save({'title':'Other'})['id'],'title':'unique a'})
    model.card_save({'id':c['id'],'title':'Unique A','question':'为什么'})
    assert model.card(c['id'])['question']=='为什么' and model.card(c['id'])['mine']=='我的话'

def test_relations_no_cycle(model):
    a=model.card_save({'title':'Prereq A'});b=model.card_save({'title':'Prereq B'})
    model.link(a['id'],b['id'],'prerequisite','先 A 再 B')
    with pytest.raises(ValueError):model.link(b['id'],a['id'],'prerequisite')
    with pytest.raises(ValueError):model.link(a['id'],a['id'],'related')
    with pytest.raises(ValueError):model.link(a['id'],b['id'],'owns')

def test_review_is_not_mastery(model):
    c=model.card_save({'title':'Review','stage':'seen'})
    model.card_review(c['id'],'again')
    got=model.card(c['id']);assert got['stage']=='seen' and got['reviews']==0 and got['due']
    model.card_review(c['id'],'good')
    got=model.card(c['id']);assert got['stage']=='seen' and got['reviews']==1
    assert [e['type'] for e in got['evidence']]==['reviewed','reviewed']

def test_stale_output_and_real_run_record(model):
    nb=model.notebook_create('测试');cell=model.cell_save(nb,'x=2\nx')
    model.cell_result(nb,cell,[{'output_type':'execute_result','data':{'text/plain':'2'},'metadata':{},'execution_count':1}],1,'x=2\nx')
    model.cell_save(nb,'x=3\nx','code',cell)
    got=model.notebook(nb)['cells'][0]
    assert got['stale'] and got['run_source']=='x=2\nx' and got['outputs'][0]['data']['text/plain']=='2'
    assert json.loads(model.vault.read_text(nb))['nbformat']==4

def test_agents_never_change_learner_owned_parts(model):
    c=model.card_save({'title':'Existing','mine':'只属于我的理解','body':'原文'})
    model.card_save({'title':'Existing','body':'AI新补充','stage':'applied'},'tutor')
    got=model.card(c['id'])
    assert got['mine']=='只属于我的理解' and got['body'].startswith('原文') and 'AI新补充' in got['body'] and got['stage']=='suggested'
    with pytest.raises(ValueError):model.card_save({'title':'Fresh','stage':'applied'},'tutor')
    # A shell edit to the owned parts is put back after the command.
    model.vault.commit('before')
    text=model.vault.read_text(got['path']).replace('stage: suggested','stage: applied').replace('只属于我的理解','改掉')
    Path(model.vault.path(got['path'])).write_text(text,encoding='utf-8')
    assert model.police()
    assert model.vault.read_md(got['path'])[0]['stage']=='suggested' and '只属于我的理解' in model.vault.read_text(got['path'])

def test_undo_reverts_one_agent_step(model):
    model.vault.commit('before')
    card=model.card_save({'title':'AI 的卡','body':'讲过的'},'tutor')
    commit=model.vault.commit('tutor：保存了 1 张卡','tutor')
    action=model.action('tutor','保存了 1 张卡','card:'+card['id'],commit)
    model.action_undo(action)
    assert not model.docs('card') and action in model.undone()
    with pytest.raises(ValueError):model.action_undo(action)

def test_persistence_reopen(tmp_path):
    l=Lattice(tmp_path/'v');c=l.card_save({'title':'persistent'});l.db.close()
    l=Lattice(tmp_path/'v');assert l.card(c['id'])['title']=='persistent';l.db.close()

def test_config_private_permissions_masking_and_url(tmp_path,monkeypatch):
    monkeypatch.delenv('COMMANDCODE_API_KEY',raising=False)
    c=Config(tmp_path/'providers.json')
    public=c.save({'apis':{'commandcode':{'api_key':'sk-not-a-real-key','base_url':'http://127.0.0.1:1234/v1','extra_body':{}}}})
    assert public['agents']['tutor']['ready'] and 'sk-not-a-real-key' not in json.dumps(public)
    assert stat.S_IMODE(c.path.stat().st_mode)==0o600
    c.save({'apis':{'commandcode':{'api_key':''}}});assert c.key('commandcode')=='sk-not-a-real-key'
    c.save({'apis':{'commandcode':{'clear_key':True}}});assert not c.key('commandcode')
    with pytest.raises(ValueError):c.save({'apis':{'commandcode':{'base_url':'https://user:pass@evil.example'}}})
    assert endpoint('https://host/v1/chat/completions','models')=='https://host/v1/models'
    assert 'sk-not-a-real-key' not in clean_error('Failure sk-not-a-real-key','sk-not-a-real-key')

def test_old_flat_settings_still_apply(tmp_path):
    p=tmp_path/'providers.json';p.write_text(json.dumps({'tutor_model':'old-tutor','practice_max_tokens':999}),encoding='utf-8')
    got=Config(p).read()['agents'];assert got['tutor']['model']=='old-tutor' and got['coach']['max_tokens']==999

def test_messages_window_returns_latest(model):
    t=model.thread_new('tutor')
    for i in range(60):
        model.append_message(t['id'],'user',f'm{i}')
    msgs=model.messages(t['id'],50)
    assert len(msgs)==50 and msgs[0]['content']=='m10' and msgs[-1]['content']=='m59'

def test_topic_delete_reparents_children_and_detaches_contents(model):
    t=model.topic_save({'title':'要删的主题'})['id'];model.focus(t)
    child=model.topic_save({'title':'分支主题','parent':t})
    card=model.card_save({'title':'Survives','topic':t})
    lesson=model.lesson_save({'topic':t,'title':'会留下'})
    model.topic_delete(t)
    with pytest.raises(ValueError):model.doc(t,'topic')
    assert model.card(card['id'])['topic'] is None and model.doc(lesson['id'])['topic'] is None
    assert model.topic(child['id'])['parent'] is None and model.active_topic() is None

def test_corrupt_provider_config_falls_back(tmp_path,monkeypatch):
    monkeypatch.delenv('COMMANDCODE_API_KEY',raising=False)
    p=tmp_path/'providers.json';p.write_text('{ broken json',encoding='utf-8')
    c=Config(p)
    assert c.read()['agents']['flash']['model']==DEFAULTS['agents']['flash']['model']
    public=c.public()
    assert not public['agents']['flash']['ready'] and not any('api_key' in a for a in public['apis'])

def test_markdown_import_is_idempotent(tmp_path):
    from PySide6.QtCore import QCoreApplication
    from lattice.bridge import Bridge
    QCoreApplication.instance() or QCoreApplication([])
    folder=tmp_path/'mds';folder.mkdir()
    (folder/'alpha.md').write_text('# Alpha\n第一版',encoding='utf-8')
    bridge=Bridge(root=tmp_path/'vault3',config_path=tmp_path/'providers.json')
    assert bridge.rpc_import_markdown(str(folder))['count']==1
    (folder/'alpha.md').write_text('# Alpha\n第二版',encoding='utf-8')
    bridge.rpc_import_markdown(str(folder))
    notes=bridge.lattice.docs('note')
    assert len(notes)==1 and '第二版' in notes[0]['body']
    bridge.closing=True;bridge.lattice.db.close()
