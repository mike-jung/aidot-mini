import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {X509Certificate,randomBytes} from 'node:crypto';
import {spawnSync,fork} from 'node:child_process';
import {once} from 'node:events';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function fixture(t,{app=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aidot https-cert-'));
 for(const file of ['scripts/dev-cert.mjs','src/core/atomicFile.js','package.json']){
  fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(dir,file));
 }
 if(app){for(const folder of ['src','workspace','public','node_modules'])fs.cpSync(path.join(root,folder),path.join(dir,folder),{recursive:true});fs.copyFileSync(path.join(root,'start.js'),path.join(dir,'start.js'));}
 const env={...process.env};
 for(const key of Object.keys(env))if(/^(APP_|DB_|ADMIN_|LOG_|CONSOLE_|TLS_|HTTPS_|ROBOT_|ROBATON_|TRACE_|AIDOT_)|^(DATA_DIR|SETTINGS_FILE|ENV_FILE|HOST|PORT|MANAGED_ENDPOINT|ALLOWED_HOSTS)$/.test(key))delete env[key];
 Object.assign(env,{ENV_FILE:path.join(dir,'.env'),DATA_DIR:path.join(dir,'data'),HOST:'127.0.0.1',PORT:'0',LOG_TO_FILE:'false',LOG_LEVEL:'error',ADMIN_TOKEN:randomBytes(32).toString('hex')});
 const state={dir,env,run:(args=[],extra={})=>spawnSync(process.execPath,[path.join(dir,'scripts/dev-cert.mjs'),...args],{cwd:dir,env:{...env,...extra},encoding:'utf8',timeout:30000})};
 t.after(async()=>{if(state.child&&state.child.exitCode===null){state.child.kill('SIGTERM');await once(state.child,'exit');}fs.rmSync(dir,{recursive:true,force:true});});
 return state;
}
function success(result){assert.equal(result.status,0,result.stderr+'\n'+result.stdout);}
function npmCli(){
 const base=path.dirname(process.execPath);
 const candidates=[process.env.npm_execpath,path.join(base,'node_modules/npm/bin/npm-cli.js'),path.resolve(base,'../lib/node_modules/npm/bin/npm-cli.js')];
 const file=candidates.find(p=>p&&fs.existsSync(p));assert(file,'npm CLI is required for the documented command test');return file;
}
test('documented npm command applies SANs and preserved .env, then serves verified HTTPS',async t=>{
 const f=fixture(t,{app:true});
 const original='# Keep this comment\r\nAPP_VALUE="with # hash"\r\nAPP_MULTILINE="first\r\nHTTPS_ENABLED=inside-value\r\nlast"\r\nHTTPS_ENABLED=false\r\nexport TLS_CERT_FILE=old.crt\r\nTLS_CERT_FILE=duplicate.crt\r\nTLS_KEY_FILE=old.key\r\n';
 fs.writeFileSync(f.env.ENV_FILE,original);
 const result=spawnSync(process.execPath,[npmCli(),'run','https:cert','--','--hosts','localhost,127.0.0.1,::1','--apply'],{cwd:f.dir,env:f.env,encoding:'utf8',timeout:30000});success(result);
 const text=fs.readFileSync(f.env.ENV_FILE,'utf8'),settings=parseEnv(text);
 assert.equal(settings.HTTPS_ENABLED,'true');assert.equal(settings.TLS_CERT_FILE,'./certs/server.crt');assert.equal(settings.TLS_KEY_FILE,'./certs/server.key');
 assert.equal(settings.APP_VALUE,parseEnv(original).APP_VALUE);assert.equal(settings.APP_MULTILINE,parseEnv(original).APP_MULTILINE);assert(text.startsWith('# Keep this comment\r\n'));
 assert.equal((text.match(/^TLS_CERT_FILE=/gm)||[]).length,1);
 const backups=fs.readdirSync(f.dir).filter(n=>n.startsWith('.env.bak-'));assert.equal(backups.length,1);assert.equal(fs.readFileSync(path.join(f.dir,backups[0]),'utf8'),original);
 const cert=fs.readFileSync(path.join(f.dir,'certs/server.crt')),x=new X509Certificate(cert);
 assert(x.checkHost('localhost'));assert(x.checkIP('127.0.0.1'));assert(x.checkIP('::1'));assert.equal(x.ca,false);
 if(process.platform!=='win32')assert.equal(fs.statSync(path.join(f.dir,'certs/server.key')).mode&0o777,0o600);
 const child=fork(path.join(f.dir,'start.js'),[],{cwd:f.dir,env:f.env,stdio:['ignore','pipe','pipe','ipc']});let output='';child.stderr.on('data',b=>{output+=b;});
 f.child=child;
 t.diagnostic('Runtime: '+process.platform+' '+process.version+'; '+result.stdout.split(/\r?\n/).find(line=>line.startsWith('OpenSSL:')));
 const ready=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('HTTPS server did not become ready: '+output)),20000);child.once('message',value=>{clearTimeout(timeout);resolve(value);});child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited '+code+': '+output));});});
 assert.equal(ready.protocol,'https');
 const request=(route,ca=cert,servername='localhost')=>new Promise((resolve,reject)=>{const req=https.get({hostname:'127.0.0.1',port:ready.port,path:route,servername,ca,rejectUnauthorized:true,headers:{Authorization:'Bearer '+f.env.ADMIN_TOKEN}},res=>{let body='';const authorized=res.socket.authorized;res.on('data',b=>{body+=b;});res.on('end',()=>resolve({status:res.statusCode,body,authorized}));});req.on('error',reject);});
 const page=await request('/');assert.equal(page.status,200);assert(page.authorized);assert.match(page.body,/<!doctype html/i);
 const status=await request('/admin/status');assert.equal(status.status,200);assert.equal(JSON.parse(status.body).data.protocol,'https');
 await assert.rejects(request('/health/live',null),/self-signed/);
 await assert.rejects(request('/health/live',cert,'unlisted.example'),/altname|does not match/i);
});
test('rerunning --apply reuses the certificate and leaves settings unchanged',t=>{
 const f=fixture(t);success(f.run(['--apply']));const cert=fs.readFileSync(path.join(f.dir,'certs/server.crt'));const env=fs.readFileSync(f.env.ENV_FILE);
 const again=f.run(['--apply'],{OPENSSL_BIN:path.join(f.dir,'missing-openssl')});success(again);assert.match(again.stdout,/Reused certificate/);
 assert.deepEqual(fs.readFileSync(path.join(f.dir,'certs/server.crt')),cert);assert.deepEqual(fs.readFileSync(f.env.ENV_FILE),env);
});
test('renewal validates changed SANs, preserves backups and keeps files on generation failure',t=>{
 const f=fixture(t);success(f.run(['--apply']));const key=fs.readFileSync(path.join(f.dir,'certs/server.key')),cert=fs.readFileSync(path.join(f.dir,'certs/server.crt')),env=fs.readFileSync(f.env.ENV_FILE);
 const mismatch=f.run(['--hosts','localhost,robot.local,192.168.10.20','--apply']);assert.notEqual(mismatch.status,0);assert.match(mismatch.stderr,/--force/);
 const failure=f.run(['--force','--apply'],{OPENSSL_BIN:path.join(f.dir,'missing-openssl')});assert.notEqual(failure.status,0);
 assert.deepEqual(fs.readFileSync(path.join(f.dir,'certs/server.key')),key);assert.deepEqual(fs.readFileSync(path.join(f.dir,'certs/server.crt')),cert);assert.deepEqual(fs.readFileSync(f.env.ENV_FILE),env);
 success(f.run(['--hosts','localhost,robot.local,192.168.10.20','--force','--apply']));
 const x=new X509Certificate(fs.readFileSync(path.join(f.dir,'certs/server.crt')));assert(x.checkHost('robot.local'));assert(x.checkIP('192.168.10.20'));
 const backup=fs.readdirSync(path.join(f.dir,'certs')).find(n=>n.startsWith('backup-'));assert(backup);
 assert.deepEqual(fs.readFileSync(path.join(f.dir,'certs',backup,'server.key')),key);assert.deepEqual(fs.readFileSync(path.join(f.dir,'certs',backup,'server.crt')),cert);
});
test('legacy cert:dev and custom directories work without changing .env',t=>{
 const f=fixture(t),text='HTTPS_ENABLED=false\nAPP_VALUE=untouched\n';fs.writeFileSync(f.env.ENV_FILE,text);
 const result=spawnSync(process.execPath,[npmCli(),'run','cert:dev','--','--dir','cert folder','--days','2'],{cwd:f.dir,env:f.env,encoding:'utf8',timeout:30000});success(result);
 assert.equal(fs.readFileSync(f.env.ENV_FILE,'utf8'),text);assert(fs.existsSync(path.join(f.dir,'cert folder/server.crt')));
 success(f.run(['--dir','cert folder','--apply']));assert.equal(parseEnv(fs.readFileSync(f.env.ENV_FILE,'utf8')).TLS_CERT_FILE,'./cert folder/server.crt');
});
test('invalid flags, host injection, empty hosts and missing OpenSSL do not alter settings',t=>{
 const f=fixture(t),text='HTTPS_ENABLED=false\n';fs.writeFileSync(f.env.ENV_FILE,text);
 for(const args of [['--unknown'],['--hosts',''],['--hosts','localhost,,127.0.0.1'],['--hosts','localhost,https://robot.local:8901'],['--hosts','localhost;echo hacked'],['--days','0']])assert.notEqual(f.run([...args,'--apply']).status,0,JSON.stringify(args));
 const failure=f.run(['--apply'],{OPENSSL_BIN:path.join(f.dir,'missing-openssl')});assert.notEqual(failure.status,0);assert.match(failure.stderr,/OpenSSL was not found/);
 assert.equal(fs.readFileSync(f.env.ENV_FILE,'utf8'),text);assert(!fs.existsSync(path.join(f.dir,'certs')));
});
