import fs from 'node:fs';
import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import config,{ROOT} from '../src/config.js';
import {workspaceFiles} from '../src/core/workspaceFiles.js';
const fingerprint=()=>{
  const h=createHash('sha256');
  // Product migrations live outside APP_WORKSPACE and must trigger a restart too.
  const files=new Set([config.paths.workspace,config.paths.migrations].flatMap(dir=>workspaceFiles(dir,/\.(?:m?js|mts|ts|sql)$/i)));
  for(const f of [...files].sort()){h.update(f);h.update(fs.readFileSync(f));}
  return h.digest('hex');
};
let child,stopping=false,reloading=false,known=fingerprint();
const start=()=>{child=fork(path.join(ROOT,'start.js'),[],{cwd:ROOT,stdio:['inherit','inherit','inherit','ipc']});child.once('exit',code=>{if(!reloading&&!stopping)console.log('Server exited '+code+'; waiting for a workspace change.');});};
const stopChild=()=>new Promise(resolve=>{
  if(!child||child.exitCode!==null)return resolve();
  const c=child,force=setTimeout(()=>c.kill('SIGTERM'),10000);force.unref();
  c.once('exit',()=>{clearTimeout(force);resolve();});
  if(c.connected)c.send({type:'aidot:shutdown'});else c.kill('SIGTERM');
});
const timer=setInterval(async()=>{
  if(stopping||reloading)return;
  try{
    const next=fingerprint();if(next===known)return;known=next;reloading=true;
    console.log('Workspace changed; restarting the development server.');
    await stopChild();if(!stopping)start();
  }catch(error){console.error('Workspace watch:',error.message);}
  finally{reloading=false;}
},1000);
const shutdown=async()=>{stopping=true;clearInterval(timer);await stopChild();if(process.connected)process.disconnect();};
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
process.on('message',value=>{if(value?.type==='aidot:shutdown')shutdown();});
start();
