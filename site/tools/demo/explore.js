const M=n=>import(new URL('./'+n+'.js',location.href).href);const D=await M('dock'),SPC=await M('spaces'),F=await M('files'),C=await M('core'),ST=await M('state');
const wait=ms=>new Promise(r=>setTimeout(r,ms));const tryr=async(m,a)=>{try{return await C.rpc(m,a);}catch(e){return "ERR "+e.message;}};
const FILES=["AGENTS.md", "envs/default.txt", "code/学习率扫描.py", "notebooks/实验 001 · 学习率对比.ipynb", "insights/过冲震荡.md", "notes/为什么先猜再看答案，反而记得更牢.md", "lessons/学会倒着走.md", "lessons/噪声是怎么被组织起来的.md", "lessons/把规则写成代码.md", "lessons/eta 不是步长，是脾气.md", "lessons/先看一个会改变的判断.md", "cards/学习曲线.md", "cards/参数更新.md", "cards/梯度方向.md", "cards/损失函数.md", "cards/学习率.md", "cards/归一化输入.md", "cards/残差.md", "cards/早停.md", "cards/正则化.md", "cards/过拟合.md", "cards/验证集.md", "cards/过冲震荡.md", "cards/动量.md", "cards/批量梯度.md", "cards/随机梯度.md", "topics/一个数字怎样学习.md", "topics/扩散模型为什么能画画.md", "notes/Home/阅读清单.md", "notes/Daily/今日复盘.md", "notes/Experiments/实验·学习率扫描.md", "notes/Knowledge/Transformer笔记.md", "notes/Knowledge/注意力机制草稿.md", "notes/Knowledge/SGD与Adam.md", "notes/Knowledge/正则化.md", "notes/Knowledge/过拟合.md", "notes/Knowledge/反向传播.md", "notes/Knowledge/学习率.md", "notes/Knowledge/损失函数.md", "notes/Knowledge/梯度下降.md"], THREADS=[["5bc01f9ea4e242a8", "flash"], ["96984593622b4c4e", "flash"], ["989022da19e84a52", "flash"], ["9c707e5986064688", "flash"], ["a5bc3f07e471439a", "tutor"], ["ec9f09dae9254f89", "flash"]];
const log={};
log.install=await tryr("skill_install",{slug:"feynman"});
for(const s of C.S.states){SPC.switchSpace(s.id);await wait(2500);}
SPC.switchSpace("chat");await wait(1500);
for(const path of FILES){await tryr("file_read",{path});await tryr("annotations",{source:"file:"+path});await tryr("file_history",{path});if(path.endsWith(".md")){await tryr("note_links",{path});await tryr("file_mentions",{path});}}
for(const [id,agent] of THREADS){await tryr("chat",{agent,thread:id});await tryr("annotations",{source:"thread:"+id});}
const skills=await tryr("skills",{});
for(const s of skills){await tryr("skill_page",{slug:s.slug});await tryr("skill_read",{slug:s.slug,shipped:s.state==="absent"});await tryr("skill_history",{slug:s.slug});}
await tryr("file_read",{path:"skills/feynman/SKILL.md"});
for(const t of [null,"330c566ac2f6422a"])await tryr("graph",{topic:t});
for(const s of C.S.states)await tryr("sessions",{agent:"tutor",every:true,space:s.id});
await tryr("annotations",{source:null,query:null});
log.states=C.S.states.map(s=>s.id);
return log;
