import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {fork,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {exerciseNote} from './helpers/note-api.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const relative=['controller/NoteController.js','service/NoteService.js','sql/note.sql'];
function fixture(profile='workspace') {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aidot-auto-meta-')),ws=path.join(temp,'한글 workspace');
 fs.cpSync(path.join(root,profile),ws,{recursive:true});fs.writeFileSync(path.join(temp,'empty.env'),'');
 const key=randomBytes(32).toString('hex');
 const env={...process.env,APP_WORKSPACE:ws,DATA_DIR:path.join(temp,'data'),DB_FILE:path.join(temp,'data/app.db'),SETTINGS_FILE:path.join(temp,'data/settings.json'),ADMIN_ACCOUNT_FILE:path.join(temp,'data/account.json'),ADMIN_TOKEN:key,ENV_FILE:path.join(temp,'empty.env'),PORT:'0',HOST:'127.0.0.1',HTTPS_ENABLED:'false',LOG_TO_FILE:'false',LOG_LEVEL:'error'};
 return {temp,ws,key,env,clean:()=>fs.rmSync(temp,{recursive:true,force:true}),gate:()=>spawnSync(process.execPath,['scripts/check-contract.mjs'],{cwd:root,env,encoding:'utf8'})};
}
async function server(f) {
 const child=fork(path.join(root,'start.js'),[],{cwd:root,env:f.env,execArgv:[],stdio:['ignore','ignore','pipe','ipc']});let errors='';
 child.stderr.on('data',chunk=>{errors+=chunk;});
 const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('startup timeout '+errors));},30000);child.once('exit',code=>{clearTimeout(timer);reject(new Error('exit '+code+': '+errors));});child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve(m.port);}});});
 const request=async(method,url,body,auth=true)=>{const r=await fetch('http://127.0.0.1:'+port+url,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+f.key}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 return {request,stop:()=>new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.send({type:'aidot:shutdown'});})};
}
for(const auth of [false,true])test('Startup creates and loads missing '+(auth?'Auth':'public')+' metadata without changing business source',async()=>{
 const f=fixture(auth?'examples/note-auth-workspace':'workspace');let app;
 try {
  const expected=['controller','service'].map(group=>JSON.parse(fs.readFileSync(path.join(f.ws,group,'meta','Note'+(group==='controller'?'Controller':'Service')+'.meta.json'))));
  for(const group of ['controller','service'])fs.rmSync(path.join(f.ws,group,'meta'),{recursive:true});
  const before=relative.map(p=>hash(path.join(f.ws,p)));
  app=await server(f);
  assert.equal((await app.request('GET','/admin/metadata',undefined,false)).status,401);
  const result=await app.request('GET','/admin/metadata');assert.equal(result.status,200);
  const entries=[...result.body.data.controllers,...result.body.data.services];assert.equal(entries.length,2);
  for(let i=0;i<entries.length;i++) {
   assert.equal(entries[i].status,'generated');const a={...entries[i].metadata},e={...expected[i]};
   delete a._generatedAt;delete e._generatedAt;assert.deepEqual(a,e);
   assert.deepEqual(JSON.parse(fs.readFileSync(entries[i].file)),entries[i].metadata);
  }
  assert.equal((await app.request('GET','/api/notes',undefined,false)).status,auth?401:200);
  const evidence=await exerciseNote((method,url,body)=>app.request(method,url,body,auth));assert.equal(evidence.length,15);
  const snapshots=entries.map(e=>({file:e.file,hash:hash(e.file),mtime:fs.statSync(e.file).mtimeMs}));
  await app.stop();app=await server(f);
  const restarted=(await app.request('GET','/admin/metadata')).body.data;
  assert.ok([...restarted.controllers,...restarted.services].every(entry=>entry.status==='loaded'));
  for(const e of snapshots){assert.equal(hash(e.file),e.hash);assert.equal(fs.statSync(e.file).mtimeMs,e.mtime);}
  assert.deepEqual(relative.map(p=>hash(path.join(f.ws,p))),before);
 }finally{if(app)await app.stop();f.clean();}
});
test('Code changes synchronize metadata while preserving descriptions and extension fields',()=>{
 const f=fixture();try {
  const controller=path.join(f.ws,'controller/NoteController.js'),service=path.join(f.ws,'service/NoteService.js');
  const file=path.join(f.ws,'controller/meta/NoteController.meta.json');const m=JSON.parse(fs.readFileSync(file));
  m.description='Keep this description';m.vendorExtension={owner:'robot-team'};m.routes[0].summary='Keep route text';fs.writeFileSync(file,JSON.stringify(m));
  let code=fs.readFileSync(controller,'utf8').replace("'/api/notes'","'/api/journal'").replace('  GetMapping,','  GetMapping,\n  Auth,').replace("  @GetMapping('/')\n  async list", "  @GetMapping('/')\n  @Auth()\n  async list");
  fs.writeFileSync(controller,code);
  fs.writeFileSync(service,fs.readFileSync(service,'utf8').replace("@Sql('note')","@Sql('journal')"));fs.renameSync(path.join(f.ws,'sql/note.sql'),path.join(f.ws,'sql/journal.sql'));
  const r=f.gate();assert.equal(r.status,0,r.stderr);
  const updated=JSON.parse(fs.readFileSync(file));assert.equal(updated.basePath,'/api/journal');assert.equal(updated.routes[0].auth,true);
  assert.equal(updated.auth,false);assert.equal(updated.description,m.description);assert.deepEqual(updated.vendorExtension,m.vendorExtension);assert.equal(updated.routes[0].summary,'Keep route text');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.ws,'service/meta/NoteService.meta.json'))).sqlFile,'journal');
  const before=hash(file),mtime=fs.statSync(file).mtimeMs;assert.equal(f.gate().status,0);assert.equal(hash(file),before);assert.equal(fs.statSync(file).mtimeMs,mtime);
 }finally{f.clean();}
});
test('Invalid JSON and linked metadata fail with file context and never overwrite the source',()=>{
 const f=fixture();try {
  const file=path.join(f.ws,'controller/meta/NoteController.meta.json');fs.writeFileSync(file,'{broken');
  let r=f.gate();assert.notEqual(r.status,0);assert.match(r.stderr,/Cannot read metadata.*NoteController.meta.json/);assert.equal(fs.readFileSync(file,'utf8'),'{broken');
  fs.unlinkSync(file);const outside=path.join(f.temp,'outside.json');fs.writeFileSync(outside,'{}');fs.symlinkSync(outside,file);
  r=f.gate();assert.notEqual(r.status,0);assert.match(r.stderr,/Metadata must be a regular file/);assert.equal(fs.readFileSync(outside,'utf8'),'{}');
 }finally{f.clean();}
});
