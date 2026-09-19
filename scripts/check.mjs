import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT,config,DATA_DIR} from '../src/config.js';
import {compile} from '../src/loader/compile.mjs';
import {SqlRegistry} from '../src/core/sqlLoader.js';
import {ModuleRegistry} from '../src/core/controllerLoader.js';
import {Router} from '../src/core/router.js';
const errors=[],files=[];
function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(entry.name.startsWith('.')||['node_modules','data','log','dist','runtime-cache','build','android','validation'].includes(entry.name))continue;
    const p=path.join(dir,entry.name);
    if(p===path.join(ROOT,'examples','product-client','public'))continue;
    if(entry.isDirectory())walk(p);else if(/\.(?:[cm]?js|mts|ts)$/.test(entry.name))files.push(p);
  }
}
walk(ROOT);if(!config.paths.workspace.startsWith(ROOT+path.sep))walk(config.paths.workspace);
let count=0;
for(const file of files){
  try{
    const source=fs.readFileSync(file,'utf8');
    const code=(/\.(?:mts|ts)$/.test(file)||source.includes('@'))?await compile(source,file,path.join(DATA_DIR,'compile-cache')):source;
    execFileSync(process.execPath,['--check','--input-type='+(/\.cjs$/.test(file)?'commonjs':'module')],{input:code,stdio:'pipe'});count++;
  }catch(error){errors.push(path.relative(ROOT,file)+': '+(error.stderr?.toString()||error.message).slice(0,1600));}
}
try{
  const sql=new SqlRegistry().loadDir(config.paths.sql),modules=new ModuleRegistry({sql}),router=new Router();
  await modules.loadServices(config.paths.services);await modules.loadControllers(router,config.paths.controllers);
  console.log('Declarations:',modules.services.size,'services,',modules.controllers.length,'controllers,',router.routes.length,'routes,',sql.list().length,'queries');
}catch(error){errors.push(error.stack);}
console.log('Syntax:',count+'/'+files.length,'; runtime compiler: esbuild-wasm 0.28.2');
for(const error of errors)console.error('FAIL',error);
console.log('Validation errors:',errors.length);process.exitCode=errors.length?1:0;
