import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {exerciseNote} from '../tests/helpers/note-api.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aidot-note-smoke-'));
fs.writeFileSync(path.join(temp,'empty.env'),'');
let child;
try{
 const env={...process.env,ENV_FILE:path.join(temp,'empty.env'),APP_WORKSPACE:path.join(root,'workspace'),DATA_DIR:temp,DB_FILE:path.join(temp,'qa.db'),PORT:'0',HOST:'127.0.0.1',HTTPS_ENABLED:'false',LOG_TO_FILE:'false',LOG_LEVEL:'error'};
 child=fork(path.join(root,'start.js'),[],{cwd:root,env,execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
 let stderr='';child.stderr.on('data',v=>{stderr+=v;});
 const port=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('startup timeout '+stderr)),30000);child.once('exit',code=>{clearTimeout(t);reject(new Error('exit '+code+' '+stderr));});child.on('message',m=>{if(m.type==='ready'){clearTimeout(t);resolve(m.port);}});});
 const base='http://127.0.0.1:'+port;
 const evidence=await exerciseNote(async(method,url,body)=>{const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};});
 assert.equal((await fetch(base+'/admin/status')).status,401);
 console.log(JSON.stringify({passed:evidence.length,administratorAccess:'anonymous denied',workspace:env.APP_WORKSPACE}));
}finally{
 if(child&&child.exitCode===null)await new Promise(resolve=>{const t=setTimeout(()=>child.kill('SIGTERM'),5000);child.once('exit',()=>{clearTimeout(t);resolve();});if(child.connected)child.send({type:'aidot:shutdown'});else child.kill('SIGTERM');});
 fs.rmSync(temp,{recursive:true,force:true});
}
