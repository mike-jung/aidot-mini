import fs from 'node:fs/promises';
import {existsSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compile} from './compile.mjs';
let root,projectRoot,cacheDir,rootIdentity;
const aliases=new Set(),memberships=new Map();
function directoryIdentity(p){
  try{const s=statSync(p,{bigint:true});return s.isDirectory()&&s.ino!==0n?s.dev+':'+s.ino:null;}catch{return null;}
}
export function initialize(data){
  ({root,projectRoot,cacheDir}=data);
  rootIdentity=directoryIdentity(root);aliases.clear();aliases.add(root);memberships.clear();
}
const inside=(base,p)=>{const r=path.relative(base,p);return r&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);};
function workspaceFile(filename){
  for(const alias of aliases)if(inside(alias,filename))return true;
  // Android may expose /data/user/0 and /data/data as aliases. Node's resolver
  // and the settings API can choose different names for the same directory.
  const visited=[];let dir=path.dirname(filename),match=false;
  for(;;){
    if(memberships.has(dir)){match=memberships.get(dir);break;}
    if(rootIdentity&&directoryIdentity(dir)===rootIdentity){aliases.add(dir);match=true;break;}
    visited.push(dir);const parent=path.dirname(dir);if(parent===dir)break;dir=parent;
  }
  for(const p of visited)memberships.set(p,match);
  return match;
}
const framework=new Set(['core','database','util','service','config','secure','controller','model','types']);
export async function resolve(specifier,context,nextResolve){
  // Console-generated imports refer to the host framework, even when a moved
  // workspace has a different (or unrelated) ../../src directory beside it.
  const generated=/^(?:\.\.\/)+src\/([^/]+)\/(.+)$/.exec(specifier);
  const m=generated||/^\.\.\/([^/]+)\/(.+)$/.exec(specifier);
  if(m&&framework.has(m[1])&&context.parentURL?.startsWith('file:')){
    const parent=fileURLToPath(context.parentURL);
    if(workspaceFile(parent)){
      const literal=path.resolve(path.dirname(parent),specifier),target=path.resolve(projectRoot,'src',m[1],m[2]);
      if((generated||!existsSync(literal))&&inside(path.join(projectRoot,'src'),target)&&existsSync(target))
        return nextResolve(pathToFileURL(target).href,context);
    }
  }
  return nextResolve(specifier,context);
}
export async function load(url,context,nextLoad){
  if(!url.startsWith('file:'))return nextLoad(url,context);
  const filename=fileURLToPath(url);
  if(!workspaceFile(filename)||filename.split(path.sep).includes('node_modules')||!/\.(?:m?js|mts|ts)$/i.test(filename))return nextLoad(url,context);
  const source=await fs.readFile(filename,'utf8');
  const code=(/\.(?:mts|ts)$/i.test(filename)||source.includes('@'))?await compile(source,filename,cacheDir,path.join(root,'.aidot-cache')):source;
  return {format:'module',source:code,shortCircuit:true};
}
