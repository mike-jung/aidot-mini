// Load/generate metadata through the same module loader used by server startup.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import config from '../src/config.js';
import {SqlRegistry} from '../src/core/sqlLoader.js';
import {ModuleRegistry} from '../src/core/controllerLoader.js';
import {Router} from '../src/core/router.js';
import {workspaceFiles} from '../src/core/workspaceFiles.js';
const sql=new SqlRegistry().loadDir(config.paths.sql),modules=new ModuleRegistry({sql}),router=new Router();
await modules.loadServices(config.paths.services);await modules.loadControllers(router,config.paths.controllers);
function meta(file){
 const p=path.join(path.dirname(file),'meta',path.basename(file).replace(/\.(?:[cm]?js|[cm]?ts)$/i,'')+'.meta.json');
 assert.ok(fs.existsSync(p),'Missing generated metadata: '+p);
 const value=JSON.parse(fs.readFileSync(p,'utf8'));assert.equal(value._version,2,p+': metadata version');return value;
}
const join=(base,sub)=>('/'+[base,sub].map(v=>String(v||'').replace(/^\/+|\/+$/g,'')).filter(Boolean).join('/'))||'/';
for(const c of modules.controllers){
 const m=meta(c.file);assert.equal(m.name,c.name);assert.equal(m.basePath,c.basePath);
 const actual=router.routes.filter(r=>r.meta.controller===c.name);
 assert.equal(m.routes?.length,actual.length,c.name+': route count differs from metadata');
 for(const r of m.routes){
  const live=actual.find(v=>v.method===r.method.toUpperCase()&&v.pattern===join(m.basePath,r.path)&&v.meta.handler===r.handlerName);
  assert.ok(live,c.name+': missing route/handler '+r.handlerName);
  assert.equal(Boolean(r.auth||r.roles?.length),Boolean(live.meta.auth),c.name+': authentication metadata drift');
  assert.deepEqual([...(r.roles||[])].sort(),[...(live.meta.roles||[])].sort(),c.name+': role metadata drift');
 }
 if(m.serviceName)assert.ok(modules.services.has(m.serviceName),'Missing metadata service '+m.serviceName);
}
for(const f of workspaceFiles(config.paths.services)){
 const m=meta(f),service=modules.services.get(m.name);assert.ok(service,'Metadata names an unregistered service '+m.name);
 const names=[...(m.methods||[]).map(x=>typeof x==='string'?x:x.type),...(m.multiSqlMethods||[]).map(x=>x.name)];
 for(const name of names)assert.equal(typeof service[name],'function',m.name+': missing method '+name);
 if(m.sqlFile)sql.getFile(m.sqlFile);
}
console.log(JSON.stringify({workspace:config.paths.workspace,controllers:modules.controllers.length,services:modules.services.size,queries:sql.list().length,metadata:'matches runtime declarations'}));
