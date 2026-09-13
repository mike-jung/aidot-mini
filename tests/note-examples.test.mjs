import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { exerciseNote } from './helpers/note-api.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aidot-note-examples-'));
const key='test-note-examples-only-01234567890123456789';
async function start(workspace,data){
  const child=fork(path.join(root,'start.js'),[],{cwd:root,env:{...process.env,APP_WORKSPACE:workspace,DATA_DIR:data,DB_FILE:path.join(data,'app.db'),ENV_FILE:path.join(temp,'empty.env'),PORT:'0',HOST:'127.0.0.1',HTTPS_ENABLED:'false',ADMIN_TOKEN:key,LOG_LEVEL:'error',LOG_TO_FILE:'false'},execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
  let errors='';child.stderr.on('data',x=>{errors+=x;});
  const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(errors||'startup timeout')),30000);child.once('exit',c=>{clearTimeout(timer);reject(new Error('exit '+c+' '+errors));});child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve(m.port);}});});
  return {base:`http://127.0.0.1:${port}`,stop:()=>new Promise(resolve=>{child.once('exit',resolve);child.send({type:'aidot:shutdown'});})};
}
fs.writeFileSync(path.join(temp,'empty.env'),'');
test.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
test('The generated Note example loads from an external workspace and supports public CRUD',async()=>{
  const target=path.join(temp,'public workspace');
  const init=spawnSync(process.execPath,['scripts/init-workspace.mjs',target,'--example','simple'],{cwd:root,encoding:'utf8'});
  assert.equal(init.status,0,init.stderr);
  const app=await start(target,path.join(temp,'public-data'));
  try{
    const list=await fetch(app.base+'/api/notes');assert.equal(list.status,200);
    const rows=(await list.json()).data;assert.equal(rows[0].title,'First note');
    assert.equal((await fetch(app.base+'/api/notes/'+rows[0].id)).status,200);
    const evidence=await exerciseNote(async(method,url,body)=>{const r=await fetch(app.base+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};});
    assert.equal(evidence.length,15);
    assert.equal((await fetch(app.base+'/admin/status')).status,401);
    const features=(await(await fetch(app.base+'/admin/features',{headers:{Authorization:'Bearer '+key}})).json()).data;
    assert.equal(features.notes,true);assert.equal(features.noteUpdate,true);assert.equal(features.noteCreate,true);assert.equal(features.noteDelete,true);
  }finally{await app.stop();}
});
test('The authenticated example keeps anonymous access denied and exposes console write capabilities',async()=>{
  const app=await start(path.join(root,'examples/note-auth-workspace'),path.join(temp,'auth-data'));
  try{
    assert.equal((await fetch(app.base+'/api/notes')).status,401);
    const f=(await(await fetch(app.base+'/admin/features',{headers:{Authorization:'Bearer '+key}})).json()).data;
    assert.equal(f.notes,true);assert.equal(f.noteCreate,true);assert.equal(f.noteDelete,true);
  }finally{await app.stop();}
});
test('A legacy database is backed up and renamed without losing IDs, bodies or migration history',async()=>{
  const data=path.join(temp,'upgrade-data');fs.mkdirSync(data);const file=path.join(data,'app.db');
  let db=new DatabaseSync(file);
  db.exec("CREATE TABLE sample_note(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,body TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT); INSERT INTO sample_note(id,title,body) VALUES(42,'before upgrade','original data'); CREATE TABLE schema_migrations(file_name TEXT PRIMARY KEY,applied_at TEXT DEFAULT CURRENT_TIMESTAMP,elapsed_ms INTEGER,checksum TEXT); INSERT INTO schema_migrations(file_name,checksum) VALUES('001_init_note.sql','unchanged legacy checksum');");db.close();
  const run=()=>spawnSync(process.execPath,['scripts/upgrade-note-table.mjs','--db',file],{cwd:root,encoding:'utf8'});
  const r=run();assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.ok(fs.existsSync(result.backup));
  const backup=new DatabaseSync(result.backup,{readOnly:true});assert.equal(backup.prepare('SELECT body FROM sample_note WHERE id=42').get().body,'original data');backup.close();
  assert.equal(JSON.parse(run().stdout).status,'already-migrated');
  const app=await start(path.join(root,'examples/note-auth-workspace'),data);
  try{
    const r=await fetch(app.base+'/api/notes/42',{headers:{Authorization:'Bearer '+key}});assert.equal(r.status,200);assert.equal((await r.json()).data.body,'original data');
  }finally{await app.stop();}
  db=new DatabaseSync(file);assert.equal(db.prepare("SELECT checksum FROM schema_migrations WHERE file_name='001_init_note.sql'").get().checksum,'unchanged legacy checksum');assert.equal(db.prepare('SELECT COUNT(*) n FROM note').get().n,1);db.close();
});
test('Ambiguous table migrations and non-empty workspace initialization refuse to overwrite data',()=>{
  const file=path.join(temp,'conflict.db'),db=new DatabaseSync(file);db.exec('CREATE TABLE sample_note(id); CREATE TABLE note(id);');db.close();
  const r=spawnSync(process.execPath,['scripts/upgrade-note-table.mjs','--db',file],{cwd:root,encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/Both source and note tables/);
  const existing=path.join(temp,'existing');fs.mkdirSync(existing);fs.writeFileSync(path.join(existing,'keep.txt'),'keep');
  const init=spawnSync(process.execPath,['scripts/init-workspace.mjs',existing,'--example','simple'],{cwd:root,encoding:'utf8'});assert.notEqual(init.status,0);assert.equal(fs.readFileSync(path.join(existing,'keep.txt'),'utf8'),'keep');
});
