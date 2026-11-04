"""The interface's own rules, on the real page: windows, working states, the AI's hands on them, what it sees."""

SHOWN = "const shown=()=>{const o=[];eachStack(s=>{if(s.active)o.push(s.active);});return o;};"


def test_starts_with_the_three_first_states_and_no_errors(ui):
    assert ui.js("return visibleSpaces().map(x=>x.name)") == ["学习", "写作", "复习"]
    assert ui.js("return Dock.space") == "chat"


def test_opening_what_is_open_brings_it_forward_instead_of_a_second_panel(ui):
    path = ui.file("a.py")
    one, two, count = ui.js(f"const a=openPanel({{type:'file',path:{path!r}}}),b=openPanel({{type:'file',path:{path!r}}});return [a,b,Object.values(Dock.panels).filter(p=>p.path==={path!r}).length]")
    assert one == two and count == 1


def test_a_new_tab_never_covers_a_conversation_on_show(ui):
    path = ui.file("b.py")
    covered = ui.js(f"""
     for(const pid of Object.keys(Dock.panels))if(Dock.panels[pid].type!=='chat')await closePanel(pid);
     const pid=openPanel({{type:'file',path:{path!r}}});
     let hidden=false;eachStack(s=>{{if(s.tabs.includes(pid)&&s.tabs.some(x=>Dock.panels[x].type==='chat')&&s.active===pid)hidden=true;}});
     return hidden""")
    assert covered is False


def test_the_group_asked_for_wins_over_every_other_rule(ui):
    path = ui.file("c.py")
    landed = ui.js(f"""const chat=Object.keys(Dock.panels).find(p=>Dock.panels[p].agent==='tutor'),s=stackOf(chat);
     Dock.into={{stack:s.id,until:Date.now()+15000}};const pid=openPanel({{type:'file',path:{path!r}}});return stackOf(pid).id===s.id""")
    assert landed is True


def test_a_template_reuses_the_tutor_but_gets_a_quick_answer_of_its_own(ui):
    got = ui.js("""const tutor=Object.keys(Dock.panels).filter(p=>Dock.panels[p].agent==='tutor');
     const flash=Object.keys(Dock.panels).filter(p=>Dock.panels[p].agent==='flash');
     const t=templateOf('work');createSpace({name:'动手',icon:t.icon,spec:t.spec,from:t.id});
     const mine=spaceWindows(Dock.space).filter(p=>Dock.panels[p].agent==='flash');
     return [tutor.length,Object.keys(Dock.panels).filter(p=>Dock.panels[p].agent==='tutor').length,mine.length,flash.includes(mine[0]),Dock.panels[mine[0]].space===Dock.space]""")
    assert got == [1, 1, 1, False, True]


def test_each_state_has_its_own_quick_answer_conversation(ui):
    got = ui.js("""const one=spaceWindows('chat').find(p=>Dock.panels[p].agent==='flash');
     switchSpace('cards');const two=spaceWindows('cards').find(p=>Dock.panels[p].agent==='flash');
     for(let i=0;i<80&&!(Chat[one]?.thread&&Chat[two]?.thread);i++)await new Promise(r=>setTimeout(r,50));
     return [one!==two,!!Chat[one]?.thread,Chat[one]?.thread!==Chat[two]?.thread]""")
    assert got == [True, True, True]


def test_a_copied_state_gets_a_quick_answer_of_its_own(ui):
    got = ui.js("""const one=spaceWindows('chat').find(p=>Dock.panels[p].agent==='flash');
     const id=createSpace({name:'学习副本',icon:'bot',spec:null});
     const two=spaceWindows(id).find(p=>Dock.panels[p].agent==='flash');return [!!two,one!==two]""")
    assert got == [True, True]


def test_ctrl_j_and_a_new_quick_answer_stay_in_this_state(ui):
    got = ui.js("""switchSpace('cards');const here=spaceWindows('cards').find(p=>Dock.panels[p].agent==='flash');
     document.dispatchEvent(new KeyboardEvent('keydown',{key:'j',ctrlKey:true,bubbles:true}));await new Promise(r=>setTimeout(r,80));
     const opened=openPanel({type:'chat',agent:'flash'});return [Dock.focus===here,opened===here]""")
    assert got == [True, True]


def test_asking_about_a_selection_uses_this_states_quick_answer(ui):
    got = ui.js("""const flashes=id=>spaceWindows(id).filter(p=>Dock.panels[p].agent==='flash');
     const learning=flashes('chat')[0];
     switchSpace('write');askAbout('flash','一段话',null);await new Promise(r=>setTimeout(r,120));
     const writing=flashes('write');
     switchSpace('cards');const own=flashes('cards')[0];askAbout('flash','另一段',null);await new Promise(r=>setTimeout(r,120));
     return [writing.length,writing[0]!==learning,Dock.panels[writing[0]].space,flashes('cards').length,flashes('cards')[0]===own,flashes('chat').length]""")
    assert got == [1, True, "write", 1, True, 1]


def test_an_old_shared_quick_answer_is_split_between_states(ui):
    got = ui.js("""const p={type:'chat',agent:'flash'},t={type:'chat',agent:'tutor'};
     const stack=tabs=>({t:'stack',id:'s'+Math.random().toString(36).slice(2,7),tabs,active:tabs[0]});
     for(const pid of Object.keys(Dock.panels))unmountPanel(pid);
     loadLayout({space:'chat',panels:{pf:{...p},pt:{...t}},spaces:{chat:{root:stack(['pt','pf']),floats:[]},cards:{root:stack(['pf']),floats:[]}}});
     const a=spaceWindows('chat').find(x=>Dock.panels[x].agent==='flash'),b=spaceWindows('cards').find(x=>Dock.panels[x].agent==='flash');
     return [a,a!==b,Dock.panels[a].space,Dock.panels[b].space,spaceWindows('cards').includes('pt')]""")
    assert got == ["pf", True, "chat", "cards", False]


def test_a_state_comes_back_as_it_was_left(ui):
    path = ui.file("d.py")
    same = ui.js(f"""const pid=openPanel({{type:'file',path:{path!r}}});const before=JSON.stringify(Dock.layout.root);
     switchSpace('write');switchSpace('chat');return [JSON.stringify(Dock.layout.root)===before,!!Dock.els[pid]]""")
    assert same == [True, True]


def test_closing_a_tab_takes_it_out_of_one_state_only(ui):
    path = ui.file("e.py")
    state = ui.js(f"""const pid=openPanel({{type:'file',path:{path!r}}});sendToSpace(pid,'chat','cards',true);
     await closePanel(pid);const after=[!!Dock.panels[pid],spaceWindows('cards').includes(pid),spaceWindows('chat').includes(pid)];
     switchSpace('cards');await closePanel(pid);return [...after,!!Dock.panels[pid]]""")
    assert state == [True, True, False, False]


def test_moving_a_window_between_states(ui):
    path = ui.file("f.py")
    assert ui.js(f"""const pid=openPanel({{type:'file',path:{path!r}}});sendToSpace(pid,'chat','cards',false);
     return [spaceWindows('chat').includes(pid),spaceWindows('cards').includes(pid)]""") == [False, True]


def test_closing_a_state_keeps_its_arrangement(ui):
    path = ui.file("g.py")
    kept = ui.js(f"""switchSpace('write');const pid=openPanel({{type:'file',path:{path!r}}});switchSpace('chat');closeSpace('write');
     const hidden=visibleSpaces().every(x=>x.id!=='write');return [hidden,spaceWindows('write').includes(pid)]""")
    assert kept == [True, True]


def test_the_last_state_cannot_be_closed(ui):
    assert ui.js("closeSpace('write');closeSpace('cards');closeSpace('chat');return visibleSpaces().length") == 1


def test_a_float_goes_back_where_it_came_from(ui):
    path = ui.file("h.py")
    assert ui.js(f"""const pid=openPanel({{type:'file',path:{path!r}}}),s=stackOf(pid).id,at=stackOf(pid).tabs.indexOf(pid);
     float(pid);const floating=Dock.layout.floats.length;unfloat(pid);return [floating,stackOf(pid).id===s,stackOf(pid).tabs.indexOf(pid)===at,Dock.layout.floats.length]""") == [1, True, True, 0]


def test_a_broken_op_is_reported_and_the_others_still_run(ui):
    path = ui.file("i.py")
    results = ui.js(f"return (await runUiOps([{{do:'nonsense'}},{{do:'open',panel:'file',path:{path!r}}}],'t')).results")
    assert results[0]["ok"] is False and results[1]["ok"] is True


def test_the_ui_op_places_a_panel_beside_another(ui):
    path = ui.file("j.py")
    shape = ui.js(f"""const r=await runUiOps([{{do:'open',panel:'file',path:{path!r},where:'right',to:'快答'}}],'t');
     const pid=r.results[0].panel,flash=Object.keys(Dock.panels).find(p=>Dock.panels[p].agent==='flash');return stackOf(pid).id!==stackOf(flash).id""")
    assert shape is True


def test_restoring_undoes_what_the_ai_did_to_the_windows(ui):
    path = ui.file("k.py")
    same = ui.js(f"""const before=JSON.stringify(Dock.layout.root);
     const r=await runUiOps([{{do:'open',panel:'file',path:{path!r},where:'float'}},{{do:'set',key:'density',value:'compact'}}],'t');
     const changed=JSON.stringify(Dock.layout.root)!==before||Dock.layout.floats.length>0;
     await restoreUi(r.snapshot);return [changed,Dock.layout.floats.length,JSON.stringify(Dock.layout.root)===before,S.ui.density==='compact',!!findPanel({{type:'file',path:{path!r}}})]""")
    assert same == [True, 0, True, False, False]


def test_what_an_ai_does_stays_in_the_state_it_was_asked_from(ui):
    path = ui.file("l.py")
    got = ui.js(f"""Dock.origin.t='chat';switchSpace('write');const before=JSON.stringify(Dock.layout.root);
     const r=await runUiOps([{{do:'open',panel:'file',path:{path!r}}}],'t');
     return [Dock.space,JSON.stringify(Dock.layout.root)===before,spaceWindows('chat').includes(r.results[0].panel),Dock.notice.has('chat')]""")
    assert got == ["write", True, True, True]


def test_an_ai_cannot_switch_a_learner_who_has_left(ui):
    got = ui.js("""Dock.origin.t='chat';switchSpace('write');const r=await runUiOps([{do:'workspace',name:'复习'}],'t');return [Dock.space,r.results[0].ok]""")
    assert got == ["write", False]


def test_screen_reports_what_is_on_show(ui):
    path = ui.file("m.py", "一\n二\n三\n")
    ui.js(f"openPanel({{type:'file',path:{path!r}}});")
    ui.until("document.querySelector('.cm-host.editor')", 8)
    ui.js("await sendScreen();")
    ui.spin(.2)
    state = ui.bridge.screen_state()
    assert state["workspace"]["now"] == "学习"
    assert path in [f["path"] for f in state["mine"]["files"]]
    assert {w["type"] for w in state["layout"]["windows"]} >= {"chat", "file"}


def test_the_tab_directory_lists_every_state_and_says_where(ui):
    path = ui.file("n.py")
    ui.js(f"switchSpace('cards');const pid=openPanel({{type:'file',path:{path!r}}});switchSpace('chat');await sendScreen();")
    ui.spin(.2)
    listing = ui.bridge.tab_directory()
    assert "在「复习」工作状态" in listing and path.rsplit("/", 1)[-1] in listing


def test_the_layout_survives_a_restart(ui):
    path = ui.file("o.py")
    pid = ui.js(f"const pid=openPanel({{type:'file',path:{path!r}}});await new Promise(r=>setTimeout(r,800));return pid")
    saved = ui.bridge.rpc_bootstrap()["layout"]
    assert saved["panels"][pid]["path"] == path and saved["space"] == "chat"


def test_two_replies_at_once_each_grow_under_their_own_question(ui):
    got = ui.js("""const pid=spaceWindows('chat').find(p=>Dock.panels[p].agent==='flash');
     for(let i=0;i<80&&!Chat[pid]?.data;i++)await new Promise(r=>setTimeout(r,50));
     const st=Chat[pid],thread=st.thread;
     st.data.messages.push({id:9001,role:'user',content:'第一问',meta:{},at:new Date().toISOString()},{id:9002,role:'user',content:'第二问',meta:{},at:new Date().toISOString()});
     const ev=(kind,run,question,more={})=>chatEvent({type:'agent',agent:'flash',kind,thread,run,question,...more});
     ev('chunk',thread,9001,{text:'答一'});ev('chunk',thread+'~b',9002,{text:'答二'});
     renderChat(pid);await new Promise(r=>setTimeout(r,250));
     const node=Dock.els[pid],slot=run=>node.querySelector('.live-slot[data-run="'+CSS.escape(run)+'"]');
     const under=run=>slot(run)?.previousElementSibling?.dataset.mid;
     const before=[under(thread),under(thread+'~b'),slot(thread)?.textContent.includes('答一'),slot(thread+'~b')?.textContent.includes('答二')];
     delete st.runs[thread+'~b'];renderChat(pid);
     return [...before,!!slot(thread),!slot(thread+'~b')]""")
    assert got == ["9001", "9002", True, True, True, True]
