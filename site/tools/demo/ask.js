const M=n=>import(new URL('./'+n+'.js',location.href).href);const C=await M('core');
const code=(await C.rpc("file_read",{path:"code/学习率扫描.py"}));
const text=code.text||code.content||"";const i=text.indexOf("p += lr * error");
const anchor={source:"file:code/学习率扫描.py",at:{line:9},label:"第 9 行",text:"p += lr * error",before:text.slice(Math.max(0,i-50),i),after:text.slice(i+15,i+65)};
const out=[];
for(const q of ["这一行在干嘛？","lr 为什么大于 2 就停不下来？"]){
 try{out.push(await C.rpc("send",{agent:"flash",message:q,thread:"ec9f09dae9254f89",space:"chat",selection:"p += lr * error",anchor}));}catch(e){out.push("ERR "+e.message);}
 await new Promise(r=>setTimeout(r,5000));
}
return {keys:Object.keys(code),out};
