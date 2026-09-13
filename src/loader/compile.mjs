import {Worker} from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
export const compilerVersion='esbuild-wasm/0.28.2;legacy-decorators;es2022;fields=assign;portable-cache-v2';
let worker,sequence=0,idle;
const pending=new Map();
function start(){
  if(worker)return worker;
  const current=worker=new Worker(new URL('./compiler-worker.mjs',import.meta.url),{execArgv:[]});
  current.on('message',message=>{
    const p=pending.get(message.id);if(!p)return;pending.delete(message.id);
    if(message.error)p.reject(new Error(message.error));else p.resolve(message.code);
    if(!pending.size){idle=setTimeout(()=>{if(worker===current){worker=null;current.terminate();}},500);idle.unref();}
  });
  current.on('error',error=>{for(const p of pending.values())p.reject(error);pending.clear();if(worker===current)worker=null;});
  current.on('exit',code=>{if(worker===current){worker=null;for(const p of pending.values())p.reject(new Error('Compiler worker exited: '+code));pending.clear();}});
  return current;
}
export async function compile(source,filename,cacheDir,preparedDir){
  filename=path.basename(filename);
  const key=createHash('sha256').update(compilerVersion+'\0'+filename+'\0'+source).digest('hex');
  const cache=cacheDir&&path.join(cacheDir,key+'.json');
  for(const candidate of [preparedDir&&path.join(preparedDir,key+'.json'),cache].filter(Boolean))try{
    const hit=JSON.parse(await fs.readFile(candidate,'utf8'));
    if(hit.key===key&&typeof hit.code==='string'&&createHash('sha256').update(hit.code).digest('hex')===hit.sha256)return hit.code;
  }catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code)&&!(error instanceof SyntaxError))throw error;}
  clearTimeout(idle);
  const current=start(),id=++sequence;
  const code=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});current.postMessage({id,source,filename});});
  if(cache){
    await fs.mkdir(cacheDir,{recursive:true,mode:0o700});
    const temp=cache+'.'+randomBytes(6).toString('hex')+'.tmp';
    try{
      await fs.writeFile(temp,JSON.stringify({key,sha256:createHash('sha256').update(code).digest('hex'),code}),{mode:0o600,flag:'wx'});
      await fs.rename(temp,cache);
    }finally{await fs.rm(temp,{force:true});}
  }
  return code;
}
