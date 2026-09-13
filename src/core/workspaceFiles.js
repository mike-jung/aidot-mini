import fs from 'node:fs';
import path from 'node:path';
export function workspaceFiles(dir, pattern=/\.(?:m?js|mts|ts)$/i) {
  const out=[];
  if(!fs.existsSync(dir))return out;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    if(entry.name.startsWith('.')||['meta','node_modules'].includes(entry.name))continue;
    const full=path.join(dir,entry.name);
    if(entry.isSymbolicLink())throw new Error('Workspace symlinks are not loaded: '+full);
    if(entry.isDirectory())out.push(...workspaceFiles(full,pattern));
    else if(entry.isFile()&&pattern.test(entry.name))out.push(full);
  }
  return out;
}
