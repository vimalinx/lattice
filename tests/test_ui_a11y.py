"""The window without a mouse, and what a screen reader is told about it."""
from workbench import KEY


def test_landmarks_and_tabs_have_roles(ui):
    got = ui.js("""await new Promise(r=>requestAnimationFrame(r));return {nav:!!document.querySelector('nav#activity[aria-label]'),main:!!document.querySelector('main#dock-wrap'),
     tablist:!!document.querySelector('.tabs[role=tablist]'),tab:!!document.querySelector('.tab[role=tab]'),panel:!!document.querySelector('.stack-body[role=tabpanel]'),
     states:document.querySelector('.st-tabs')?.getAttribute('role'),selected:document.querySelectorAll('.tab[aria-selected=true]').length>0}""")
    assert all(got.values()), got


def test_every_button_on_show_has_a_name(ui):
    nameless = ui.js("""await new Promise(r=>setTimeout(r,100));return [...document.querySelectorAll('button')].filter(b=>b.offsetParent&&!b.textContent.trim()&&!b.getAttribute('aria-label')).map(b=>b.outerHTML.slice(0,120))""")
    assert nameless == []


def test_a_tab_opens_and_closes_from_the_keyboard(ui):
    path = ui.file("a11y.py")
    got = ui.js(KEY + f"""const pid=openPanel({{type:'file',path:{path!r}}});await tick();
     const tab=document.querySelector('.tab[data-pid="'+pid+'"]');const other=[...tab.parentElement.querySelectorAll('.tab')].find(t=>t!==tab);
     const out=[];tab.focus();key('Enter');await tick();out.push(stackOf(pid).active===pid);
     document.querySelector('.tab[data-pid="'+pid+'"]').focus();key('Delete');await new Promise(r=>setTimeout(r,120));out.push(!!findPanel({{type:'file',path:{path!r}}}));return out""")
    assert got == [True, False]


def test_arrows_walk_the_tabs_and_wrap(ui):
    a, b = ui.file("w1.py"), ui.file("w2.py")
    got = ui.js(KEY + f"""const x=openPanel({{type:'file',path:{a!r}}}),y=openPanel({{type:'file',path:{b!r}}});await tick();
     const tabs=[...document.querySelector('.tab[data-pid="'+y+'"]').parentElement.querySelectorAll('.tab')];tabs[tabs.length-1].focus();
     key('ArrowRight');const wrapped=document.activeElement===tabs[0];key('ArrowLeft');return [wrapped,document.activeElement===tabs[tabs.length-1]]""")
    assert got == [True, True]


def test_f6_goes_round_the_window(ui):
    got = ui.js(KEY + """await tick();document.body.focus();const seen=[];
     for(let i=0;i<8;i++){key('F6');const r=document.activeElement.closest('#activity,#side,.stack,#status');seen.push(r?.id||r?.className.split(' ')[0]);}
     return seen""")
    assert {"activity", "side", "stack", "status"} <= set(got), got


def test_a_divider_moves_from_the_keyboard_and_stays_focused(ui):
    got = ui.js(KEY + """await tick();const g=document.querySelector('.gutter[aria-orientation=vertical]');const s=findSplitOf(g);function findSplitOf(n){return n.dataset.split;}
     const id=g.dataset.split;const size=()=>{let v=null;const walk=n=>{if(!n||n.t==='stack')return;if(n.id===id)v=n.sizes[0];n.kids.forEach(walk);};walk(Dock.layout.root);return v;};
     const before=size();g.focus();key('ArrowRight');await tick();return [size()>before,document.activeElement.classList.contains('gutter')]""")
    assert got == [True, True]


def test_what_dragging_does_is_in_the_tab_menu(ui):
    a, b = ui.file("m1.py"), ui.file("m2.py")
    got = ui.js(KEY + f"""const x=openPanel({{type:'file',path:{a!r}}}),y=openPanel({{type:'file',path:{b!r}}});await tick();
     const before=stackOf(y).id;const tab=document.querySelector('.tab[data-pid="'+y+'"]');tab.focus();key('ContextMenu');await tick();
     const menu=document.querySelector('.menu[role=menu]');const items=[...menu.querySelectorAll('[role=menuitem]')].map(b=>b.textContent.trim());
     menu.querySelector('[data-action=tab-split][data-where=right]').click();await tick();
     return [items.some(t=>t.startsWith('移到「')),stackOf(y).id!==before]""")
    assert got == [True, True]


def test_a_question_keeps_the_focus_and_gives_it_back(ui):
    got = ui.js(KEY + """await tick();const start=document.querySelector('.tab.active');start.focus();
     const answer=ask('删掉吗',{title:'确认'});await tick();await tick();
     const box=document.querySelector('.dialog'),inside=box.contains(document.activeElement);
     const buttons=[...box.querySelectorAll('button')];buttons[buttons.length-1].focus();key('Tab');const wrapped=document.activeElement===buttons[0];
     key('Escape');await answer;await tick();return [inside,wrapped,box.getAttribute('aria-label'),document.activeElement===start]""")
    assert got == [True, True, "确认", True]


def test_a_window_takes_the_focus_and_gives_it_back(ui):
    got = ui.js(KEY + """await tick();const start=document.querySelector('.tab.active');start.focus();
     modal('<h2>看看</h2><button>一</button>');await tick();const inside=document.querySelector('.modal').contains(document.activeElement);
     closeModal();await tick();return [inside,document.activeElement===start]""")
    assert got == [True, True]


def test_something_drawn_as_a_button_answers_the_keyboard(ui):
    got = ui.js(KEY + """const d=document.createElement('div');d.dataset.action='nothing-here';document.body.appendChild(d);await tick();
     let clicks=0;d.addEventListener('click',e=>{clicks++;e.stopPropagation();});d.focus();key('Enter');key(' ');const r=[d.getAttribute('role'),d.getAttribute('tabindex'),clicks];d.remove();return r""")
    assert got == ["button", "0", 2]


def test_a_failed_commit_is_told_once_a_minute(ui):
    seen = []
    ui.bridge.event.connect(seen.append)
    ui.bridge.history_warned = -60.0
    ui.bridge.history_failed(RuntimeError("no"))
    ui.bridge.history_failed(RuntimeError("no"))
    ui.bridge.event.disconnect(seen.append)
    assert sum("写不进去" in s for s in seen) == 1


def test_an_uncaught_error_is_told_to_the_learner(ui):
    ui.spin(.3)  # a notice from the test before may still be on its way
    got = ui.js("window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:Promise.resolve(),reason:new Error('测试用')}));return document.querySelector('#toast').textContent")
    assert "界面出了点问题" in got
