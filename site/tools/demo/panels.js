// Run the code once in 动手 (its output events), search a few words, and open every kind of panel — in a working state
// made for this and removed after, so the demo's own states stay as they were set up.
const M=n=>import(new URL('./'+n+'.js',location.href).href);const D=await M('dock'),SPC=await M('spaces'),F=await M('files'),C=await M('core');
const wait=ms=>new Promise(r=>setTimeout(r,ms));const tryr=async(m,a)=>{try{return await C.rpc(m,a);}catch(e){return "ERR "+e.message;}};
const work=C.S.states.find(s=>s.name==="动手").id;
SPC.switchSpace(work);await wait(1500);await F.runPath("code/学习率扫描.py");await wait(5000);
for(const q of ["学习率","梯度","p","过冲"])await tryr("search",{query:q});
const id=SPC.createSpace({name:"录制",icon:"pin",spec:{tabs:[],keep:true}});await wait(1000);
for(const t of ["settings","journal","home","marks","memory","review","library","noteinfo","map","skills"]){try{D.openPanel({type:t});}catch(e){}await wait(1500);}
await SPC.removeSpace(id);await wait(800);SPC.switchSpace("chat");await wait(1500);
return C.S.states.map(s=>s.name);
