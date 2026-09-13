import {readFileSync as readVersionFile} from 'node:fs';
const currentVersion=JSON.parse(readVersionFile(new URL('../package.json',import.meta.url),'utf8')).version;
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {execFileSync,spawnSync} from 'node:child_process';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aidot-hardening-'));
Object.assign(process.env,{NODE_ENV:'test',PORT:'0',HOST:'127.0.0.1',DATA_DIR:tmp,DB_FILE:path.join(tmp,'app.db'),LOG_TO_FILE:'false',LOG_LEVEL:'error',HTTPS_ENABLED:'false',ADMIN_TOKEN:'test-only-admin-key-0123456789-abcdefghijk'});
const {main,createServer}=await import('../start.js');
const {Router}=await import('../src/core/router.js');
const {getContext}=await import('../src/core/requestContext.js');
const {toSqlite,normalizeParams}=await import('../src/database/dialect.js');
const {parseSqlFile}=await import('../src/core/sqlLoader.js');
const {runMigrations}=await import('../src/database/migrationRunner.js');
const {tlsOptions}=await import('../src/core/transport.js');
const db=(await import('../src/database/db.js')).default;
const config=(await import('../src/config.js')).default;
let server,base,cookie,csrf;
const auth={Authorization:`Bearer ${process.env.ADMIN_TOKEN}`};
const api=(p,options={})=>fetch(base+p,{...options,headers:{...auth,...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
test.before(async()=>{server=await main({signals:false});base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{if(server?.listening)await server.stop();fs.rmSync(tmp,{recursive:true,force:true});});
test('Authentication is enforced for business and administrator APIs',async()=>{
 for(const p of['/api/notes','/admin/status','/admin/settings'])assert.equal((await fetch(base+p)).status,401);
 assert.equal((await fetch(base+'/health/live')).status,200);
 assert.equal((await api('/admin/status')).status,200);
});
test('Login creates HttpOnly cookie and CSRF token without exposing admin key',async()=>{
 const r=await fetch(base+'/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:process.env.ADMIN_TOKEN})});
 assert.equal(r.status,200);const set=r.headers.get('set-cookie');assert.match(set,/HttpOnly/);assert.match(set,/SameSite=Strict/);
 cookie=set.split(';')[0];const text=await r.text();assert.ok(!text.includes(process.env.ADMIN_TOKEN));csrf=JSON.parse(text).data.csrfToken;
 assert.equal((await fetch(base+'/admin/session',{headers:{Cookie:cookie}})).status,200);
});
test('Cookie writes require CSRF and cross-origin writes are refused',async()=>{
 assert.equal((await fetch(base+'/api/notes',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({title:'denied'})})).status,403);
 assert.equal((await api('/api/notes',{method:'POST',headers:{Origin:'https://attacker.invalid'},body:JSON.stringify({title:'denied'})})).status,403);
 assert.equal((await fetch(base+'/api/notes',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json',Origin:base},body:JSON.stringify({title:'cookie write'})})).status,201);
});
test('Forged Host cannot rebind local console',async()=>{
 const status=await new Promise((resolve,reject)=>{const r=http.get(base+'/admin/status',{headers:{...auth,Host:'attacker.invalid'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);});assert.equal(status,403);
});
test('Invalid JSON and oversized bodies return bounded 400/413 responses',async()=>{
 assert.equal((await api('/api/notes',{method:'POST',body:'{'})).status,400);
 const r=await api('/api/notes',{method:'POST',body:JSON.stringify({title:'x',body:'x'.repeat(300000)})});assert.equal(r.status,413);assert.ok((await r.text()).length<500);
 assert.equal((await api('/health/live')).status,200);
});
test('Unsupported media type and compression are rejected',async()=>{
 assert.equal((await api('/api/notes',{method:'POST',headers:{'Content-Type':'text/plain'},body:'abc'})).status,415);
 assert.equal((await api('/api/notes',{method:'POST',headers:{'Content-Encoding':'gzip'},body:'abc'})).status,415);
});
test('Generated Note preserves missing-row and full-field update semantics',async()=>{
 for(const id of ['0','no','9007199254740993'])assert.equal((await api('/api/notes/'+id)).status,404);
 for(const body of [null,[]])assert.equal((await api('/api/notes',{method:'POST',body:JSON.stringify(body)})).status,500);
 const n=(await(await api('/api/notes',{method:'POST',body:JSON.stringify({title:'clear body',body:'before'})})).json()).data;
 const u=(await(await api('/api/notes/'+n.insertId,{method:'PUT',body:JSON.stringify({title:'clear body',body:null})})).json()).data;
 assert.deepEqual(u,{rowsAffected:1});
 const saved=(await(await api('/api/notes/'+n.insertId)).json()).data;assert.equal(saved.body,null);assert.equal(saved.title,'clear body');
 assert.equal((await api('/api/notes/'+n.insertId,{method:'PUT',body:JSON.stringify({body:'missing title'})})).status,500);
 assert.equal((await api('/health/ready')).status,200);
});
test('HEAD and method errors follow HTTP semantics',async()=>{
 const r=await api('/api/notes',{method:'HEAD'});assert.equal(r.status,200);assert.equal(await r.text(),'');
 const m=await api('/api/notes',{method:'PATCH'});assert.equal(m.status,405);assert.match(m.headers.get('allow'),/GET/);
});
test('Malformed percent encoding returns 400 and server survives',async()=>{
 const r=await api('/api/notes/%E0%A4%A');assert.equal(r.status,400);assert.equal((await api('/health/live')).status,200);
});
test('Router ranks literal routes and rejects equivalent duplicate parameters',()=>{
 const r=new Router();r.add('GET','/x/:id',()=>{});r.add('GET','/x/search',()=>{});
 assert.equal(r.match('GET','/x/search').route.pattern,'/x/search');assert.throws(()=>r.add('GET','/x/:name',()=>{}),/Duplicate/);
});
test('Static dotfiles and symlink escape are rejected',async()=>{
 const root=path.join(tmp,'static'),outside=path.join(tmp,'secret.txt');fs.mkdirSync(root);fs.writeFileSync(outside,'secret');fs.writeFileSync(path.join(root,'.env'),'secret');
 try{fs.symlinkSync(outside,path.join(root,'link.txt'));}catch(e){if(process.platform!=='win32')throw e;}
 const router=new Router();router.static_('',root);const srv=await new Promise(r=>{const s=router.listen(0,'127.0.0.1',()=>r(s));});
 try{for(const p of['/link.txt','/.env','/%2eenv'])assert.notEqual((await fetch(`http://127.0.0.1:${srv.address().port}`+p)).status,200);}finally{await new Promise(r=>srv.close(r));}
});
test('Actual HTTP execution retains per-request context across awaits',async()=>{
 const router=new Router();router.add('GET','/trace',async(req,res)=>{await new Promise(r=>setTimeout(r,2));res.json({id:getContext()?.requestId});});
 const srv=await new Promise(r=>{const s=router.listen(0,'127.0.0.1',()=>r(s));});
 try{const seen=await Promise.all(Array.from({length:20},async(_,i)=>{const id='request-'+i;const r=await fetch(`http://127.0.0.1:${srv.address().port}/trace`,{headers:{'X-Request-Id':id}});assert.equal((await r.json()).id,id);return id;}));assert.equal(new Set(seen).size,20);}finally{await new Promise(r=>srv.close(r));}
});
test('SQL shim preserves literals/quoted identifiers and rejects semantic loss',()=>{
 const sql="SELECT 'BIGINT NOW() ENGINE=InnoDB VARCHAR(10)', `BIGINT` FROM t";
 assert.equal(toSqlite(sql),sql);
 assert.throws(()=>toSqlite("CREATE TABLE t (x ENUM('a','b'))"),/Unsupported/);
 assert.throws(()=>toSqlite('CREATE TABLE t (x TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)'),/Unsupported/);
 assert.throws(()=>parseSqlFile('-- @name: q\nSELECT 1;\n-- @name: q\nSELECT 2;'),/Duplicate/);
 assert.throws(()=>parseSqlFile('-- @name: empty\n'),/Empty/);
});
test('Large integers retain exact precision and multiple statements are refused',()=>{
 const n=9007199254740993n;assert.equal(normalizeParams({n}).n,n);assert.equal(db.get('SELECT :n AS n',{n}).n,n.toString());
 assert.throws(()=>db.run('SELECT 1; DELETE FROM note'),/one statement/);
});
test('Async transaction callback cannot commit before completion',async()=>{
 const before=db.get('SELECT COUNT(*) c FROM note').c;
 assert.throws(()=>db.transactionSync(async()=>{db.run("INSERT INTO note(title) VALUES('bad')");}),/synchronous/);
 assert.throws(()=>db.transactionSync(()=>{db.run("INSERT INTO note(title) VALUES('rollback')");return Promise.resolve().then(()=>db.run("INSERT INTO note(title) VALUES('late')"));})(),/Promise/);
 await new Promise(r=>setTimeout(r,5));assert.equal(db.get('SELECT COUNT(*) c FROM note').c,before);
});
test('Nested savepoint rollback does not poison the outer transaction',()=>{
 db.transactionSync(()=>{db.run("INSERT INTO note(title) VALUES('outer')");assert.throws(()=>db.transactionSync(()=>{db.run("INSERT INTO note(title) VALUES('inner')");throw new Error('rollback');})());db.run("INSERT INTO note(title) VALUES('outer2')");})();
 assert.equal(db.get("SELECT COUNT(*) c FROM note WHERE title='inner'").c,0);
 assert.equal(db.get("SELECT COUNT(*) c FROM note WHERE title IN('outer','outer2')").c,2);
});
test('Failed migration is atomic and applied migration drift blocks startup',()=>{
 const dir=path.join(tmp,'migrations');fs.mkdirSync(dir);const p=path.join(dir,'test_atomic.sql');
 fs.writeFileSync(p,'CREATE TABLE should_rollback(id INTEGER); INSERT INTO missing_table VALUES(1);');assert.throws(()=>runMigrations(dir),/Migration failed/);
 assert.equal(db.get("SELECT name FROM sqlite_master WHERE name='should_rollback'"),undefined);
 fs.writeFileSync(p,'CREATE TABLE should_exist(id INTEGER);');runMigrations(dir);fs.appendFileSync(p,'\n-- edited');assert.throws(()=>runMigrations(dir),/Migration drift/);
});
test('Concurrent writes preserve row count, unique IDs, response status and health',async()=>{
 const t=performance.now();const results=await Promise.all(Array.from({length:100},async(_,i)=>{const r=await api('/api/notes',{method:'POST',body:JSON.stringify({title:'concurrent-'+i})});assert.equal(r.status,201);return(await r.json()).data.insertId;}));
 assert.equal(new Set(results).size,100);assert.equal(db.get("SELECT COUNT(*) c FROM note WHERE title LIKE 'concurrent-%'").c,100);assert.equal((await api('/health/ready')).status,200);
 console.log(JSON.stringify({measurement:'100_concurrent_writes',elapsedMs:Math.round(performance.now()-t),rssMB:Math.round(process.memoryUsage().rss/1048576)}));
});
test('Settings persist, live values update and invalid TLS does not overwrite settings',async()=>{
 let r=await api('/admin/settings',{method:'PUT',body:JSON.stringify({language:'en'})});assert.equal(r.status,200);assert.equal((await r.json()).data.effective.language,'en');
 assert.deepEqual((await (await fetch(base+'/admin/preferences')).json()).data,{language:'en',version:currentVersion});
 const p=path.join(tmp,'settings.json'),before=fs.readFileSync(p,'utf8');
 r=await api('/admin/settings',{method:'PUT',body:JSON.stringify({certFile:'/missing/cert',keyFile:'/missing/key',https:true})});assert.equal(r.status,400);assert.equal(fs.readFileSync(p,'utf8'),before);
 assert.equal((await api('/admin/settings',{method:'PUT',body:JSON.stringify({port:0})})).status,400);
});
test('Session logout revokes cookie immediately',async()=>{
 assert.equal((await fetch(base+'/admin/logout',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf}})).status,200);
 assert.equal((await fetch(base+'/admin/session',{headers:{Cookie:cookie}})).status,401);
});
test('Login failures are rate limited',async()=>{
 let r;for(let i=0;i<9;i++)r=await fetch(base+'/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'incorrect'})});
 assert.equal(r.status,429);assert.ok(Number(r.headers.get('retry-after'))>0);
});
test('HTTPS performs a verified handshake and serves the application',async()=>{
 const key=path.join(tmp,'key.pem'),cert=path.join(tmp,'cert.pem');
 execFileSync(process.env.OPENSSL_BIN||'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'pipe'});
 await server.stop();Object.assign(config.server,{https:true,keyFile:key,certFile:cert,port:0});server=await main({signals:false});
 const get=(p,ca)=>new Promise((resolve,reject)=>{https.get({hostname:'127.0.0.1',port:server.address().port,path:p,ca,headers:auth},r=>{let data='';r.on('data',x=>data+=x);r.on('end',()=>resolve({status:r.statusCode,data,version:r.socket?.getProtocol?.()}));}).on('error',reject);});
 const ca=fs.readFileSync(cert);const r=await get('/admin/status',ca);assert.equal(r.status,200);assert.equal(JSON.parse(r.data).data.protocol,'https');
 await assert.rejects(get('/health/live'),/self-signed/);
 assert.equal((await get('/',ca)).status,200);
});
