"""Real Qt WebEngine integration: visible controls, notebook results, typed graph."""
import os, sys, tempfile, json, time
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
import shutil
qa=Path(os.environ.get('LATTICE_QA_DIR','/tmp/lattice-learning-v1-qa'))
# Hermetic run: a stale DB + WebEngine profile makes a second run fail on
# invariants that assume a fresh library (topic count, UNIQUE card titles).
for stale in (qa/'data',qa/'config'):
    shutil.rmtree(stale,ignore_errors=True)
qa.mkdir(parents=True,exist_ok=True)
os.environ['XDG_DATA_HOME']=str(qa/'data');os.environ['XDG_CONFIG_HOME']=str(qa/'config')
from PySide6.QtCore import QTimer, Qt
from PySide6.QtWidgets import QApplication
QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
from main import MainWindow
app=QApplication([]);app.setApplicationName('Lattice Learning V1 QA')
w=MainWindow();w.resize(1550,970);w.show()
# WebEngine innerWidth is CSS pixels; on HiDPI (dpr>1) a 1550px window is ~775 CSS px,
# which legitimately triggers the narrow fallback. Probe dpr and size for a wide layout.
dpr=[1.0]
def _set_dpr(v):
    try:dpr[0]=float(v)
    except Exception:pass
w.page.runJavaScript("window.devicePixelRatio",_set_dpr)
checks=[];errors=[];screens=[];deadline=time.monotonic()+130
oldconsole=w.page.javaScriptConsoleMessage
# Main GUI exercise, using the same actions as clicks, and actual kernel outputs.
script=r'''(async()=>{
 window.QA={checks:[],errors:[],done:false};
 const check=(ok,name)=>{if(!ok)throw new Error(name);QA.checks.push(name);};
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 const closeSlot=i=>action(el('.ws-slot[data-ws-i="'+i+'"] [data-action="l-pane-close"]'));
 await go('learning');check(!!el('.ws-slot .tutor-dialogue'),'dialogue is a workspace pane');check(!el('#learn-input-flash'),'fast-answer hidden by default');
 check(all('.nav-link[data-view]').length===2&&!!el('[data-action="l-kb-toggle"]'),'sidebar: learning, kb toggle, graph');
 await action(el('[data-action="l-kb-toggle"]'));check(S.kbOpen&&!!el('.kb-panel')&&all('.kb-sec').length===4,'kb toggle opens the knowledge rail');
 const kbLesson=el('.kb-panel [data-action="l-kb-lesson"]');if(kbLesson){await action(kbLesson);check(!!el('.lesson-pane-body .lesson-reading'),'kb lesson opens a lesson pane');await closeSlot(wsIndex('lesson',kbLesson.dataset.id));}
 const kbCard=el('.kb-panel [data-action="l-card-open"]');if(kbCard){await action(kbCard);check(!!el('.ws-slot .card-page'),'kb card opens a card pane');await closeSlot(wsIndex('card',kbCard.dataset.id));}
 await action(el('.kb-panel [data-action="l-kb-graph"]'));check(L.cardView==='graph'&&wsIndex('knowledge')>=0,'kb graph link opens the knowledge pane');
 const kbNote=el('.kb-panel [data-action="l-kb-note"]');if(kbNote){await action(kbNote);check(!!el('.ws-slot .note-page-body'),'kb note opens a note pane');await closeSlot(wsIndex('note',kbNote.dataset.id));}
 await go('settings');check(!el('.kb-panel'),'kb rail is exclusive to the learning workspace');await go('learning');check(S.kbOpen&&!!el('.kb-panel'),'kb rail returns with the workspace');
 await action(el('[data-action="l-kb-close"]'));check(!el('.kb-panel'),'kb rail collapses');
 await openPane('notebook');L.filesOpen=true;await loadTree();render();check(!!el('.nb-file-pane')&&!!el('#project-select'),'notebook hosts the code workspace pane');L.filesOpen=false;
 if(window.innerWidth>=WS_NARROW)check(all('.ws-slot').length>=2&&!!el('.ws-divider'),'two panes tile side by side with a divider');
 else check(!!el('.ws-narrow-bar')&&all('.ws-slot').length===1,'narrow viewport shows one focused pane');
 await action(el('[data-action="l-pane-collapse"][data-ws-i="'+wsIndex('notebook')+'"]'));check(!!el('.ws-rail'),'pane collapses to a rail');
 await action(el('.ws-rail'));check(!el('.ws-rail'),'rail expands back to a pane');
 // Singleton-state kinds refuse to duplicate (they share S.note / L.notebookId /
 // #cell-* ids); card panes are slot-scoped via data-f so they may twin.
 await action(el('[data-action="l-pane-dup"][data-ws-i="'+wsIndex('notebook')+'"]'));check(wsLayout().slots.filter(s=>s.kind==='notebook').length===1,'singleton panes refuse to duplicate');
 const cid=(ld().cards[0]||{}).id;await openPane('card',cid);
 await action(el('[data-action="l-pane-dup"][data-ws-i="'+wsIndex('card',cid)+'"]'));check(wsLayout().slots.filter(s=>s.kind==='card').length===2,'card pane duplicates');
 await closePane(wsLayout().slots.length-1);await reopenPane();check(wsLayout().slots.filter(s=>s.kind==='card').length===2,'reopen restores the closed pane');
 await closePane(wsIndex('card',cid));check(wsLayout().slots.filter(s=>s.kind==='card').length===1,'closing one duplicate keeps the other');
 await closePane(wsIndex('card',cid));
 check(JSON.parse(localStorage.getItem('lattice.ws.v1')).slots.length===wsLayout().slots.length,'layout persists to localStorage');
 ld().tutor_messages=Array.from({length:80},(_,i)=>({id:'qa'+i,role:i%3?'assistant':'user',content:'第 '+i+' 条消息\n\n```python\nprint('+i+')\n```',created_at:new Date().toISOString(),meta:'{}'}));await openPane('dialogue');
 const chatBox=el('#learn-chat-tutor'),cmp=el('.tutor-dialogue .learn-composer').getBoundingClientRect();
 check(chatBox.scrollHeight>chatBox.clientHeight+50,'long dialogue scrolls inside its own area');
 check(cmp.bottom<=window.innerHeight+1&&cmp.top>0,'composer stays pinned inside the viewport');
 check(!!el('.code-block [data-action="l-code-run"]'),'code blocks expose copy and run');
 ld().tutor_messages=[];await openPane('dialogue');
 await openPane('classroom');check(!!el('.classroom-layout .lesson-reading'),'classroom renders in its pane');
 const hadFlash=wsIndex('flash')>=0;await action(el('[data-action="l-pane-toggle"][data-kind="flash"]'));check((wsIndex('flash')>=0)!==hadFlash,'fast-answer toggles as a pane');check(!!el('.ws-slot .flash-panel')&&!!el('#learn-input-flash'),'flash pane exposes its composer');await action(el('[data-action="l-pane-toggle"][data-kind="flash"]'));check(wsIndex('flash')<0,'flash pane closes');
 await action(el('.classroom-layout [data-action="l-toc"]'));check(!!el('.toc-drawer'),'toc opens inside the classroom pane');await action(el('.toc-scrim'));check(!el('.toc-drawer'),'toc scrim closes the drawer');
 await action(el('[data-action="l-topic-branch"]'));el('#topic-title').value='GUI验收 · 概率';el('#topic-question').value='概率如何改变';await action(el('[data-action="l-topic-confirm"]'));
 check(lt().title==='GUI验收 · 概率'&&!!lt().parent_id,'interest branch navigation');
 const branchId=lt().id,seedT=(ld().topics||[]).find(t=>t.id!==branchId);
 await rpc('learn_lesson_save',{lesson:{topic_id:branchId,title:'本主题验收课节',body:'本主题正文'}});
 const xl=await rpc('learn_lesson_save',{lesson:{topic_id:seedT.id,title:'跨主题验收课节',body:'跨主题正文'}});
 await learnRefresh();S.kbOpen=true;await openPane('knowledge');
 check(all('.kb-panel .kb-subsec').length===2,'kb courses group lessons under each topic');
 check(all('.kb-panel [data-action="l-kb-lesson"]').length>=3,'kb panel lists lessons from all topics');
 const xlBtn=all('.kb-panel [data-action="l-kb-lesson"]').find(b=>b.dataset.id===xl.id);
 check(!!xlBtn,'foreign-topic lesson appears in the panel');await action(xlBtn);
 check(!!el('.lesson-pane-body .lesson-reading'),'cross-topic lesson opens a lesson pane');
 check(!el('.lesson-pane-body .lesson-reading-footer'),'cross-topic lesson stays read-only');
 await action(el('[data-action="l-kb-classroom"]'));
 check(lt().id===seedT.id&&String(L.lessonId)===String(xl.id)&&wsIndex('classroom')>=0,'open in classroom switches to the owning topic');
 await focusTopic(branchId);
 await openPane('knowledge');await action(el('[data-action="l-card-new"]'));
 const cf='.ws-slot.focus ';el(cf+'[data-f="title"]').value='GUI概念卡';el(cf+'[data-f="body"]').value='实际点击创建';el(cf+'[data-f="understanding"]').value='我自己的解释';el(cf+'[data-f="stage"]').value='explained';await action(el(cf+'[data-action="l-card-save"]'));
 check(ld().cards.some(c=>c.title==='GUI概念卡'&&c.understanding==='我自己的解释'),'knowledge card CRUD');check(!!el('.ws-slot .card-page'),'saved card stays open in its pane');
 await closeSlot(wsIndex('card',ld().cards.find(c=>c.title==='GUI概念卡').id));
 await action(el('[data-action="search"]'));el('#palette-query').value='GUI概念';paletteFilter('GUI概念');
 const cardRow=el('[data-action="go-learning"][data-lkind="card"]');check(!!cardRow,'global search indexes learning cards');await action(cardRow);
 check(!!el('.ws-slot .card-page')&&S.view==='learning','search result opens a card pane');await closeSlot(wsIndex('card'));
 await action(el('[data-action="search"]'));paletteFilter('主讲');check(!all('[data-action="open-session"]').some(b=>b.textContent.includes('主讲')),'learning sessions stay out of agent results');closeModal();
 {const m=document.createElement('div');m.style.cssText='position:fixed;left:-9999px;top:0;width:600px';m.innerHTML=markdown('```mermaid\ngraph LR; A[误差] --> B[步长];\n```');document.body.appendChild(m);await delay(1200);check(!!m.querySelector('.mermaid svg'),'mermaid code block renders a diagram');m.remove();}
 await openPane('knowledge');L.cardView='tree';render();check(!!el('.knowledge-tree-row'),'typed knowledge tree');L.cardView='graph';render();check(!!el('.knowledge-cy canvas')&&(el('.knowledge-cy').__cy?.nodes().length||0)>=5,'graph shows real card nodes');
 await go('settings');check(!!el('#cfg-codex')&&!!el('#cfg-flash-model'),'ACP and API settings live in settings');
 const cfg=await rpc('learn_settings');check(!('api_key' in cfg),'saved key never returned to frontend');
 await focusTopic(lt().parent_id);await openPane('notebook');check(all('[data-cell-editor]').length>=4,'notebook cell editor');
 const nb=activeNotebook(),cell=nb.cells.find(c=>c.kind==='code');
 const textarea=el('[data-cell-editor="'+cell.id+'"]');textarea.value='v=40\nv+2';textarea.dispatchEvent(new Event('input',{bubbles:true}));await flushCells();
 check((await rpc('nb_get',{id:nb.id})).cells.find(c=>c.id===cell.id).source==='v=40\nv+2','editor persists code');
 await action(el('[data-action="nb-run"][data-id="'+cell.id+'"]'));
 let runs=[];for(let i=0;i<350;i++){await delay(100);runs=await rpc('nb_history',{cell_id:cell.id});if(runs.some(r=>r.state==='completed'))break;}
 check(runs.some(r=>r.state==='completed'&&JSON.stringify(r.outputs).includes('42')),'real Python result through UI');
 await learnRefresh();await openPane('notebook');check(el('#cell-output-'+cell.id).textContent.includes('42'),'actual output visible');
 await go('graph');if((S.data.graph?.nodes||[]).length)check(!!el('.main-cy canvas')&&(el('.main-cy').__cy?.nodes().length||0)>0,'note link graph renders in cytoscape');
 window.QA.done=true;
})().catch(e=>{window.QA??={checks:[],errors:[]};QA.errors.push(e.stack);QA.done=true;});'''
views=[('learning','dialogue',None),('learning','classroom',None),('learning','notebook',None),('learning','notebook-files',None),('learning',None,'multi'),('learning',None,'flash'),('learning',None,'kb'),('learning',None,'note'),('learning',None,'card'),('learning',None,'lesson'),('learning',None,'cards'),('learning',None,'tree'),('learning',None,'graph'),('settings',None,None),('graph',None,None)]
started=False

def js_shot(view,tab,mode):
    if view!='learning':return "(async()=>{await go("+json.dumps(view)+");})()"
    if tab=='notebook-files':return "(async()=>{await go('learning');S.layout={slots:[{kind:'dialogue',ref:null}],focus:0,widths:[1],closedStack:[]};await openPane('notebook');L.filesOpen=true;await loadTree();render();})()"
    pre="await go('learning');S.layout={slots:[{kind:'dialogue',ref:null}],focus:0,widths:[1],closedStack:[]};S.kbOpen=false;"
    if tab:return "(async()=>{"+pre+"await openPane("+json.dumps(tab)+");})()"
    m={'kb':"S.kbOpen=true;await openPane('knowledge');",
       'note':"S.kbOpen=true;await openPane('note',S.data.notes[0].id);",
       'card':"S.kbOpen=true;await openPane('card',ld().cards[0].id);",
       'lesson':"S.kbOpen=true;await openPane('lesson',ld().lessons[0].id);",
       'flash':"await openPane('flash');",
       'multi':"await openPane('notebook');await openPane('classroom');",
       'cards':"await openPane('knowledge');L.cardView='cards';render();",
       'tree':"await openPane('knowledge');L.cardView='tree';render();",
       'graph':"await openPane('knowledge');L.cardView='graph';render();"}[mode]
    return "(async()=>{"+pre+m+"})()"

def screenshot_next():
    if not views:
        w.resize(940,760)
        w.page.runJavaScript("(async()=>{await go('learning');S.layout={slots:[{kind:'dialogue',ref:null},{kind:'notebook',ref:null}],focus:0,widths:[1,1],closedStack:[]};render();})()")
        QTimer.singleShot(900,finish_small);return
    view,tab,mode=views.pop(0)
    w.page.runJavaScript(js_shot(view,tab,mode))
    name=view+'-'+(tab or mode or 'main')
    def capture():
        path=qa/(name+'.png');w.view.grab().save(str(path));screens.append(str(path));print('SCREEN',name,str(path),flush=True);screenshot_next()
    QTimer.singleShot(650,capture)

def finish_small():
    p=qa/'learning-small.png';w.view.grab().save(str(p));screens.append(str(p))
    result={'checks':checks,'errors':errors,'screenshots':screens}
    (qa/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print('GUI_RESULT',json.dumps(result,ensure_ascii=False),flush=True)
    w.close();app.quit()

def poll():
    global started
    if time.monotonic()>deadline:
        errors.append('GUI test timeout');finish_small();return
    def result(q):
        global started
        if isinstance(q,str): q=json.loads(q) if q else {}
        if not started or (q.get("qa") or {}).get("done"): print("GUI_POLL",q,flush=True)
        if not started:
            if q.get('ready'):
                d=dpr[0] if dpr[0] else 1.0
                w.resize(int(1560*d)+80,1000)
                started=True
                QTimer.singleShot(600,lambda:w.page.runJavaScript(script))
            QTimer.singleShot(200,poll);return
        qaresult=q.get('qa') or {}
        if qaresult.get('done'):
            checks.extend(qaresult.get('checks',[]));errors.extend(qaresult.get('errors',[]));screenshot_next()
        else:QTimer.singleShot(200,poll)
    w.page.runJavaScript("JSON.stringify({ready:typeof S!=='undefined'&&!!S.data,qa:window.QA||null})",result)
QTimer.singleShot(1000,poll)
QTimer.singleShot(135000,lambda:(errors.append("Independent GUI watchdog expired"),finish_small()))
app.exec()
if errors:sys.exit(1)
