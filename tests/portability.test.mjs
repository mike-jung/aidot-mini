import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aidot-annotations-')),workspace=path.join(tmp,'사용자 workspace');
fs.cpSync(new URL('../examples/note-auth-workspace',import.meta.url),workspace,{recursive:true});
const put=(p,text)=>{const f=path.join(workspace,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,text);};
put('sql/nested/probe.sql',"-- @name: echo\nSELECT :value AS value, ':literal' AS literal;\n");
put('controller/nested/ProbeController.js',`
import {Controller,Autowired,Sql,Log,RequestMapping,GetMapping,PostMapping,Auth,Roles,Validate} from '../core/decorators.js';
@Controller('/compat')
export default class ProbeController {
  @Autowired('NoteService') notes;
  @Sql('nested/probe') sql;
  @Log log;
  @PostMapping('/merge/:id') @Auth() @Roles('admin')
  merge(params,req){return {...params,role:req.user.role,header:req.get('x-probe')};}
  @GetMapping('/primitive') primitive(){return false;}
  @GetMapping('/null') empty(){return null;}
  @GetMapping('/sql') sqlText(){return this.sql.get('echo');}
  @GetMapping('/explicit') explicit(params,req,res){return res.status(202).json({direct:true});}
  @GetMapping('/error') error(params,req,res,next){next(Object.assign(new Error('expected'),{status:409}));}
  @RequestMapping({path:'/validated',method:'post'})
  @Validate({safeParse(p){return /^\\d+$/.test(String(p.n))?{success:true,data:{n:Number(p.n)}}:{success:false,error:{issues:[{path:['n'],code:'invalid',message:'number required'}]}};}})
  validated(params){return params;}
}
`);
const snapshots=new Map(['controller/NoteController.js','service/NoteService.js','sql/note.sql'].map(p=>[p,createHash('sha256').update(fs.readFileSync(path.join(workspace,p))).digest('hex')]));
Object.assign(process.env,{APP_WORKSPACE:workspace,DATA_DIR:path.join(tmp,'data'),PORT:'0',HOST:'127.0.0.1',HTTPS_ENABLED:'false',LOG_TO_FILE:'false',LOG_LEVEL:'error',ADMIN_TOKEN:'test-annotations-only-01234567890123456789'});
const {main}=await import('../start.js'),db=(await import('../src/database/db.js')).default;
const {bindParams,sqlRegistry}=await import('../src/core/sqlLoader.js');
let server,base;
const api=async(p,body,authenticated=true)=>{
  const r=await fetch(base+p,{method:body===undefined?'GET':'POST',headers:{...(authenticated?{Authorization:'Bearer '+process.env.ADMIN_TOKEN}:{}),'Content-Type':'application/json','x-probe':'present'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
};
test.before(async()=>{server=await main({signals:false});base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{if(server)await server.stop();fs.rmSync(tmp,{recursive:true,force:true});});
test('External Unicode workspace recursively loads annotation classes and named SQL',async()=>{
  const status=await api('/admin/status');assert.equal(status.body.data.workspace,workspace);
  assert.equal((await api('/api/notes')).status,200);
  assert.match((await api('/compat/sql')).body.data,/:value/);
  assert.ok(sqlRegistry.getFile('nested/probe').has('echo'));
});
test('Express parameter order is query, body, then path; request is the second argument',async()=>{
  const r=await api('/compat/merge/path?id=query&x=query',{id:'body',x:'body',requestCode:'merge'});
  assert.equal(r.status,200);assert.deepEqual(r.body.data,{id:'path',x:'body',requestCode:'merge',role:'admin',header:'present'});assert.equal(r.body.header.requestCode,'merge');
  assert.equal((await api('/compat/merge/path',{},false)).status,401);
});
test('Automatic envelopes preserve false/null and explicit responses are sent once',async()=>{
  assert.equal((await api('/compat/primitive')).body.data,false);
  assert.equal((await api('/compat/null')).body.data,null);
  assert.deepEqual(await api('/compat/explicit'),{status:202,body:{direct:true}});
  assert.equal((await api('/compat/error')).status,409);
});
test('Validate passes parsed data and reports validation issues before the handler',async()=>{
  assert.deepEqual((await api('/compat/validated',{n:'7',extra:true})).body.data,{n:7});
  const r=await api('/compat/validated',{n:'bad'});assert.equal(r.status,400);assert.equal(r.body.errors[0].field,'n');
});
test('SQL binding ignores quoted literals and fills only required execute placeholders',async()=>{
  assert.equal(bindParams("SELECT ':ignore', :id, :id",{id:3},'qmark').text,"SELECT ':ignore', ?, ?");
  assert.deepEqual(bindParams('SELECT :id, :id',{id:3},'pg').values,[3,3]);
  assert.throws(()=>bindParams('SELECT :missing',{}),/Missing/);
  const r=await db.execute("SELECT :missing AS missing, :flag AS flag, ':literal' AS literal",{flag:true,extra:'ignored'});
  assert.deepEqual(r.rows[0],{missing:null,flag:1,literal:':literal'});
});
test('execute supports writes, RETURNING, MySQL date functions and executeList',async()=>{
  const write=await db.execute("INSERT INTO note(title) VALUES(:title)",{title:'execute'});
  assert.equal(write.rowsAffected,1);assert.ok(write.insertId>0);
  const row=await db.execute("INSERT INTO note(title) VALUES('returning') RETURNING id");
  assert.ok(row.rows[0].id>0);
  const date=await db.execute("SELECT DATE_FORMAT('2026-09-11 12:34:56','%Y-%m-%d') AS d");
  assert.equal(date.rows[0].d,'2026-09-11');
  const page=await db.executeList('SELECT id FROM note ORDER BY id',{}, {page:1,perPage:1});
  assert.equal(page.rows.length,1);assert.ok(page.header.total>=3);assert.equal(page.header.perPage,1);
});
test('Async transactions hold the connection across awaits and queue unrelated writes',async()=>{
  let release,entered;const gate=new Promise(r=>release=r),opened=new Promise(r=>entered=r);let late;
  const tx=db.transaction(async t=>{late=t;await t.execute("INSERT INTO note(title) VALUES('tx-one')");entered();await gate;await t.query("INSERT INTO note(title) VALUES('tx-two')");});
  await opened;let outsideDone=false;
  const outside=db.execute("INSERT INTO note(title) VALUES('outside')").then(()=>outsideDone=true);
  await new Promise(r=>setTimeout(r,15));assert.equal(outsideDone,false);
  release();await tx;await outside;
  await assert.rejects(late.execute('SELECT 1'),/completion/);
  const before=(await db.execute('SELECT COUNT(*) c FROM note')).rows[0].c;
  await assert.rejects(db.transaction(async t=>{await t.execute("INSERT INTO note(title) VALUES('rollback')");await Promise.resolve();throw new Error('rollback-test');}),/rollback-test/);
  assert.equal((await db.execute('SELECT COUNT(*) c FROM note')).rows[0].c,before);
});
test('The loader never rewrites user Controller, Service or SQL files',()=>{
  for(const [p,hash]of snapshots)assert.equal(createHash('sha256').update(fs.readFileSync(path.join(workspace,p))).digest('hex'),hash);
});
