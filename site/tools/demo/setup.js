const M=n=>import(new URL('./'+n+'.js',location.href).href);const D=await M('dock'),SP=await M('spaces'),F=await M('files'),C=await M('core');const ST=await M('state');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const TUTOR={type:"chat",agent:"tutor"},FLASH={type:"chat",agent:"flash"};
const CODE={type:"file",path:"code/学习率扫描.py"},NOTE={type:"file",path:"notes/为什么先猜再看答案，反而记得更牢.md"};
const specs={
 chat:{split:"h",sizes:[.6,.4],parts:[{tabs:[TUTOR,CODE,NOTE]},{split:"v",sizes:[.62,.38],parts:[{tabs:[FLASH]},{tabs:[{type:"library"},{type:"memory"}],keep:true}]}]},
 write:{split:"h",sizes:[.78,.22],parts:[{tabs:[NOTE],keep:true},{tabs:[{type:"noteinfo"}]}]},
 cards:{split:"h",sizes:[.38,.62],parts:[{tabs:[{type:"library"}]},{split:"v",sizes:[.7,.3],parts:[{tabs:[{type:"review"},{type:"memory"}],keep:true},{tabs:[FLASH]}]}]},
};
const made={
 work:{name:"动手",icon:"terminal",spec:{split:"h",sizes:[.58,.42],parts:[{split:"v",sizes:[.5,.5],parts:[{tabs:[CODE],keep:true},{tabs:[{type:"run",path:CODE.path}]}]},{tabs:[FLASH]}]}},
 notes:{name:"阅读",icon:"eye",spec:{split:"h",sizes:[.7,.3],parts:[{tabs:[NOTE],keep:true},{split:"v",sizes:[.56,.44],parts:[{tabs:[{type:"noteinfo"}]},{tabs:[FLASH]}]}]}},
 map:{name:"梳理",icon:"network",spec:{split:"h",sizes:[.5,.3,.2],parts:[{tabs:[TUTOR]},{tabs:[{type:"map"}]},{tabs:[{type:"file",path:"cards/学习率.md"}],keep:true}]}},
 skills:{name:"定制",icon:"tag",spec:{split:"h",sizes:[.5,.25,.25],parts:[{tabs:[TUTOR]},{tabs:[{type:"skills"}]},{tabs:[{type:"file",path:"skills/feynman/SKILL.md"}],keep:true}]}},
};
const log=[];
for(const id of ["chat","write","cards"]){SP.switchSpace(id);await wait(600);ST.Dock.spaces[id]=SP.layoutFromSpec(specs[id],id);SP.switchSpace(id==="chat"?"write":"chat");await wait(300);SP.switchSpace(id);await wait(1200);log.push(id);}
const ids={};
for(const [from,m] of Object.entries(made)){ids[from]=SP.createSpace({name:m.name,icon:m.icon,spec:m.spec,from});await wait(1500);log.push(from+":"+ids[from]);}
// a run, so the run panel has its output
SP.switchSpace(ids.work);await wait(800);await F.runPath(CODE.path);await wait(4000);
SP.switchSpace("chat");await wait(1500);
D.flushLayout&&D.flushLayout();await wait(800);
return {log,ids,states:(C.S.states||[]).map(s=>s.id+":"+s.name),space:ST.Dock.space};
