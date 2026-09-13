import fs from 'node:fs';
import path from 'node:path';
import config from '../src/config.js';
import {compile,compilerVersion} from '../src/loader/compile.mjs';
import {workspaceFiles} from '../src/core/workspaceFiles.js';
import {SqlRegistry} from '../src/core/sqlLoader.js';
import {ModuleRegistry} from '../src/core/controllerLoader.js';
import {Router} from '../src/core/router.js';
const workspace=path.resolve(process.argv[2]||config.paths.workspace),cache=path.join(workspace,'.aidot-cache');
let count=0;
for(const file of workspaceFiles(workspace)){
  const source=fs.readFileSync(file,'utf8');
  if(!source.includes('@')&&!/\.(?:mts|ts)$/i.test(file))continue;
  await compile(source,file,cache);count++;
}
const sql=new SqlRegistry().loadDir(path.join(workspace,'sql'));
const modules=new ModuleRegistry({sql});
await modules.loadServices(path.join(workspace,'service'));
await modules.loadControllers(new Router(),path.join(workspace,'controller'));
const metadata=[...modules.serviceMetadata.values(),...modules.controllers.map(c=>c.metadata)].map(({name,status})=>({name,status}));
console.log(JSON.stringify({workspace,compiler:compilerVersion,compiled:count,cache,metadata}));
