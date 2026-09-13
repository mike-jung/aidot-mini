import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ROOT,config} from '../src/config.js';
const selection=JSON.parse(fs.readFileSync(path.join(ROOT,'module.json'),'utf8'));
const version=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version;
const output=path.join(ROOT,'dist',selection.name+'-v'+version);
if(fs.existsSync(output))throw new Error('Export already exists: '+output);
execFileSync(process.execPath,['scripts/check.mjs'],{cwd:ROOT,stdio:'inherit'});
const tests=fs.readdirSync(path.join(ROOT,'tests')).filter(n=>n.endsWith('.test.mjs')).map(n=>'tests/'+n);
execFileSync(process.execPath,['scripts/check-contract.mjs'],{cwd:ROOT,stdio:'inherit'});
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['test'],{cwd:ROOT,stdio:'inherit',shell:process.platform==='win32'});
const items=[];
for(const group of ['controller','service','sql','migrations']){
  for(const name of selection[group]||[]){
    if(typeof name!=='string'||name.includes('\\')||path.isAbsolute(name)||name.split('/').some(p=>!p||p.startsWith('.')))throw new Error('Invalid relative module filename');
    const relative=group+'/'+name;
    let source=config.paths.workspace;
    for(const part of relative.split('/')){source=path.join(source,part);if(fs.lstatSync(source).isSymbolicLink())throw new Error('Symlinks are not allowed in an export');}
    items.push({path:relative,data:fs.readFileSync(source)});
  }
}
for(const item of items){const dest=path.join(output,item.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,item.data);}
const manifest={format:'aidot-workspace/v2',name:selection.name,version,createdAt:new Date().toISOString(),
  contract:'aidot-express generated Note workspace / legacy annotations',workspace:config.paths.workspace,
  databaseSetup:'Included migrations target SQLite; prepare equivalent DDL for the Express target database',
  verification:{miniSyntax:'passed',metadata:'passed',testCommand:JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'))).scripts.test,express:'Not run by export. Full project: scripts/verify-note-express.mjs; test each new API on its actual target.'},
  files:items.map(x=>({path:x.path,sha256:createHash('sha256').update(x.data).digest('hex')}))};
fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(manifest,null,2)+'\n');
fs.copyFileSync(path.join(ROOT,'docs/PORTING.md'),path.join(output,'PORTING.md'));
console.log('Unchanged workspace files exported:',output);
