import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'aidot-account-'));
Object.assign(process.env,{DATA_DIR:temporary,ENV_FILE:path.join(temporary,'unused.env'),HOST:'127.0.0.1',PORT:'0',HTTPS_ENABLED:'false',LOG_TO_FILE:'false',LOG_LEVEL:'error',ADMIN_REMEMBER_DAYS:'7'});
for(const key of ['ADMIN_TOKEN','ADMIN_TOKEN_FILE','ADMIN_ACCOUNT_FILE','DB_FILE'])delete process.env[key];
const {main}=await import('../start.js');
const config=(await import('../src/config.js')).default;
const {AdminAccount}=await import('../src/core/adminAccount.js');
const {createSecurity}=await import('../src/core/security.js');
const {Router}=await import('../src/core/router.js');
let server,base,credentials={username:'admin',password:'first test password'},remembered,ordinary;
const accountFile=path.join(temporary,'admin-account.json');
async function start(){config.server.port=0;server=await main({signals:false});base=`http://127.0.0.1:${server.address().port}`;}
async function request(url,{method='GET',body,session,headers={}}={}){
  const response=await fetch(base+url,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const data=await response.json();return {status:response.status,body:data,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0],csrf:data.data?.csrfToken};
}
const login=(remember=false)=>request('/admin/login',{method:'POST',body:{...credentials,remember}});
test.before(start);
test.after(async()=>{if(server?.listening)await server.stop();fs.rmSync(temporary,{recursive:true,force:true});});

test('Fresh install offers local one-time ID/password setup without an administrator key',async()=>{
  const auth=await request('/admin/auth');assert.deepEqual(auth.body.data,{configured:false,localSetup:true,rememberDays:7,sessionMinutes:60});
  assert.equal((await request('/api/notes')).status,401);
  assert.equal((await request('/admin/setup',{method:'POST',body:credentials})).status,403);
  assert.equal((await request('/admin/setup',{method:'POST',body:credentials,headers:{Origin:'https://foreign.invalid'}})).status,403);
  const r=await request('/admin/setup',{method:'POST',body:credentials,headers:{Origin:base}});assert.equal(r.status,200);ordinary=r;
  assert.equal(r.body.data.username,'admin');assert.equal(r.body.data.loginMethod,'password');
  assert.equal((await request('/admin/setup',{method:'POST',body:credentials,headers:{Origin:base}})).status,409);
  const record=fs.readFileSync(accountFile,'utf8');assert(!record.includes(credentials.password));assert(!record.includes(r.cookie.slice(14)));
  const saved=JSON.parse(record);assert.equal(saved.localSetup,false);assert.equal(saved.account.password.algorithm,'scrypt');assert.equal(saved.account.password.p,5);
  if(process.platform!=='win32')assert.equal(fs.statSync(accountFile).mode&0o777,0o600);
});
test('ID/password login rejects wrong credentials and creates a bounded cookie session',async()=>{
  assert.equal((await request('/admin/login',{method:'POST',body:{username:'nobody',password:credentials.password}})).status,401);
  assert.equal((await request('/admin/login',{method:'POST',body:{...credentials,password:'incorrect'}})).status,401);
  const r=await login();ordinary=r;assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert(!r.headers.get('set-cookie').includes('Max-Age'));
  assert.equal((await request('/admin/session',{session:r})).body.data.username,'admin');
  assert.equal((await request('/api/notes',{method:'POST',body:{title:'missing csrf'},headers:{Cookie:r.cookie}})).status,403);
  assert.equal((await request('/api/notes',{method:'POST',body:{title:'account-authenticated note'},session:r})).status,201);
});
test('Remembered session stores only a session digest and survives an actual restart',async()=>{
  remembered=await login(true);assert.equal(remembered.status,200);assert.match(remembered.headers.get('set-cookie'),/Max-Age=604800/);
  const raw=fs.readFileSync(accountFile,'utf8');assert(!raw.includes(remembered.cookie.slice(14)));assert(!raw.includes(credentials.password));
  await server.stop();await start();
  assert.equal((await request('/admin/session',{session:ordinary})).status,401);
  assert.equal((await request('/admin/session',{session:remembered})).status,200);
  assert.equal((await request('/admin/auth')).body.data.localSetup,false);
});
test('Password change requires current password, rotates session and revokes all older sessions',async()=>{
  const other=await login(true);
  const newCredentials={username:'operator',password:'updated test password'};
  const before=fs.readFileSync(accountFile,'utf8');
  assert.equal((await request('/admin/account',{method:'PUT',session:remembered,body:{...newCredentials,currentPassword:'wrong'}})).status,401);
  assert.equal(fs.readFileSync(accountFile,'utf8'),before);
  const changed=await request('/admin/account',{method:'PUT',session:remembered,body:{...newCredentials,currentPassword:credentials.password}});assert.equal(changed.status,200);
  assert.notEqual(changed.cookie,remembered.cookie);
  assert.equal((await request('/admin/session',{session:remembered})).status,401);
  assert.equal((await request('/admin/session',{session:other})).status,401);
  assert.equal((await login()).status,401);
  credentials=newCredentials;remembered=changed;
  assert.equal((await login()).status,200);
  await server.stop();await start();
  assert.equal((await request('/admin/session',{session:other})).status,401);
  assert.equal((await request('/admin/session',{session:remembered})).status,200);
});
test('Logout removes remembered authentication from disk as well as memory',async()=>{
  assert.equal((await request('/admin/logout',{method:'POST',session:remembered,body:{}})).status,200);
  await server.stop();await start();assert.equal((await request('/admin/session',{session:remembered})).status,401);
});
test('Existing API key still authenticates integrations and can recover the console account',async()=>{
  const key=fs.readFileSync(path.join(temporary,'admin-token'),'utf8').trim();
  assert.equal((await request('/admin/status',{headers:{Authorization:`Bearer ${key}`}})).status,200);
  const r=await request('/admin/login',{method:'POST',body:{token:key}});assert.equal(r.status,200);assert.equal(r.body.data.loginMethod,'key');
  credentials={username:'recovered',password:'recovered test password'};
  const recovered=await request('/admin/account',{method:'PUT',session:r,body:credentials});assert.equal(recovered.status,200);
  assert.equal((await login()).status,200);assert.equal((await request('/admin/status',{headers:{Authorization:`Bearer ${key}`}})).status,200);
});
test('Local account command creates and resets credentials without printing the password',async()=>{
  const dir=path.join(temporary,'cli');const value={username:'local-admin',password:'private CLI password'};
  const env={...process.env,DATA_DIR:dir};
  const run=(args=[])=>spawnSync(process.execPath,['scripts/admin-account.mjs','--stdin',...args],{cwd:process.cwd(),env,input:JSON.stringify(value),encoding:'utf8'});
  let r=run();assert.equal(r.status,0,r.stderr);assert(!r.stdout.includes(value.password));
  const malformed=spawnSync(process.execPath,['scripts/admin-account.mjs','--stdin','--reset'],{cwd:process.cwd(),env,input:'{"password":"'+value.password,encoding:'utf8'});
  assert.equal(malformed.status,1);assert(!malformed.stderr.includes(value.password));
  r=run();assert.equal(r.status,1);assert.match(r.stderr,/already exists/);
  r=run(['--reset']);assert.equal(r.status,0,r.stderr);
  const file=path.join(dir,'admin-account.json');assert(!fs.readFileSync(file,'utf8').includes(value.password));
  fs.writeFileSync(file,'{corrupt');r=run(['--reset']);assert.equal(r.status,0,r.stderr);assert(fs.readdirSync(dir).some(name=>name.includes('.recovery-')));
});
test('Existing pre-account installations never expose anonymous setup',async()=>{
  await server.stop();const legacy=path.join(temporary,'legacy-account.json');config.admin.accountFile=legacy;await start();
  assert.equal((await request('/admin/auth')).body.data.localSetup,false);
  assert.equal((await request('/admin/setup',{method:'POST',body:credentials,headers:{Origin:base}})).status,403);
  const key=fs.readFileSync(path.join(temporary,'admin-token'),'utf8').trim();
  const old=await request('/admin/login',{method:'POST',body:{token:key}});assert.equal(old.status,200);
  assert.equal((await request('/admin/account',{method:'PUT',session:old,body:credentials})).status,200);
  assert.equal((await login()).status,200);
});
test('Local bootstrap ignores forged forwarding headers and is disabled on LAN bindings',async()=>{
  const previous=config.admin.accountFile;config.admin.accountFile=path.join(temporary,'bootstrap-check.json');
  const account=new AdminAccount({allowLocalSetup:true}),security=createSecurity('x'.repeat(32),account),router=new Router();security.register(router);
  const route=router.match('GET','/admin/auth').route;
  const req={headers:{host:'localhost:8901','x-forwarded-for':'127.0.0.1'},socket:{remoteAddress:'192.0.2.1'}};let value;
  route.handler(req,{json:body=>value=body});assert.equal(value.data.localSetup,false);
  req.socket.remoteAddress='127.0.0.1';config.server.host='0.0.0.0';route.handler(req,{json:body=>value=body});assert.equal(value.data.localSetup,false);
  config.server.host='127.0.0.1';security.close();config.admin.accountFile=previous;
});
test('Concurrent password calculations are bounded while HTTP health remains available',async()=>{
  const results=await Promise.all([request('/health/live'),...Array.from({length:8},()=>login())]);
  assert.equal(results[0].status,200);assert(results.slice(1).some(r=>r.status===200));assert(results.slice(1).some(r=>r.status===503));
});
test('Expired remembered sessions and rotated API keys are discarded durably',async()=>{
  let active=await login(true);assert.equal(active.status,200);await server.stop();
  const file=config.admin.accountFile,record=JSON.parse(fs.readFileSync(file,'utf8'));for(const row of record.remembered)row.expires=Date.now()-1;
  fs.writeFileSync(file,JSON.stringify(record));await start();assert.equal((await request('/admin/session',{session:active})).status,401);
  active=await login(true);assert.equal(active.status,200);await server.stop();process.env.ADMIN_TOKEN='rotated-test-only-key-0123456789-abcdefgh';
  await start();assert.equal((await request('/admin/session',{session:active})).status,401);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).remembered.length,0);
  await server.stop();delete process.env.ADMIN_TOKEN;await start();assert.equal((await request('/admin/session',{session:active})).status,401);
});
test('Failed passwords are rate limited while health remains responsive',async()=>{
  let r;for(let i=0;i<9;i++)r=await request('/admin/login',{method:'POST',body:{username:'recovered',password:'wrong'}});
  assert.equal(r.status,429);assert(Number(r.headers.get('retry-after'))>0);
  assert.equal((await request('/health/live')).status,200);
});
