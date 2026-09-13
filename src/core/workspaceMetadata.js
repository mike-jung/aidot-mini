// Metadata describes loaded business code. It never registers routes or grants access.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

function description(file, name) {
  const lines=fs.readFileSync(file,'utf8').split(/\r?\n/,12)
    .filter(line=>/^\s*\/\/\//.test(line)).map(line=>line.replace(/^\s*\/\/\/\s?/, '').trim()).filter(Boolean);
  return lines[0]===name && lines.length>1 ? lines.slice(1).join('\n') : name;
}
function object(value, label) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(label+': metadata must be a JSON object');
  return value;
}
function load(file, build) {
  const directory=path.join(path.dirname(file),'meta');
  const destination=path.join(directory,path.basename(file).replace(/\.(?:[cm]?js|[cm]?ts)$/i,'.meta.json'));
  if(fs.existsSync(directory)&&(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink()))throw new Error('Metadata directory must be a real directory: '+directory);
  let previous=null;
  if(fs.existsSync(destination)) {
    if(!fs.lstatSync(destination).isFile()||fs.lstatSync(destination).isSymbolicLink())throw new Error('Metadata must be a regular file: '+destination);
    try {previous=object(JSON.parse(fs.readFileSync(destination,'utf8')),destination);}
    catch(error){throw new Error('Cannot read metadata '+destination+': '+error.message,{cause:error});}
    if(previous._version!==undefined&&previous._version!==2)throw new Error('Unsupported metadata version: '+destination);
  }
  const metadata=build(previous||{});
  const unchanged=previous && JSON.stringify(metadata)===JSON.stringify(previous);
  const status=unchanged?'loaded':previous?'updated':'generated';
  if(!unchanged) {
    metadata._generatedAt=new Date().toISOString();
    const temporary=path.join(directory,'.'+path.basename(destination)+'.'+randomBytes(8).toString('hex')+'.tmp');
    try {
      fs.mkdirSync(directory,{recursive:true,mode:0o755});
      const mode=previous ? fs.statSync(destination).mode&0o777 : 0o644;
      fs.writeFileSync(temporary,JSON.stringify(metadata,null,2)+'\n',{flag:'wx',mode});
      fs.renameSync(temporary,destination);
    } catch(error) {
      throw new Error('Cannot save generated metadata '+destination+'; use a writable workspace or prepare metadata before deploying read-only code: '+error.message,{cause:error});
    } finally {try{fs.rmSync(temporary,{force:true});}catch{}}
  }
  return {name:metadata.name,file:destination,status,metadata};
}
function methods(C) {
  const names=new Set();
  for(let prototype=C.prototype;prototype&&prototype!==Object.prototype;prototype=Object.getPrototypeOf(prototype)) {
    for(const [name,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(prototype))) {
      if(name!=='constructor'&&typeof descriptor.value==='function')names.add(name);
    }
  }
  return [...names];
}
export function loadServiceMetadata(C,file,name) {
  const sqlFiles=[...new Set(Object.values(C.__miniSqlBindings||{}))];
  return load(file,old=> {
    const prior=new Map((Array.isArray(old.methods)?old.methods:[]).map(entry=>[typeof entry==='string'?entry:entry?.type,entry]));
    const multi=Array.isArray(old.multiSqlMethods)?old.multiSqlMethods:[];
    const names=methods(C),multiNames=new Set(multi.map(entry=>entry.name));
    return {...old,name,sqlFile:sqlFiles.length===1?sqlFiles[0]:(sqlFiles.includes(old.sqlFile)?old.sqlFile:''),
      description:old.description??description(file,name),
      methods:names.filter(method=>!multiNames.has(method)).map(method=>prior.get(method)??method),
      multiSqlMethods:multi.filter(entry=>names.includes(entry.name)),
      _generatedAt:old._generatedAt||'',_version:2};
  });
}
function routeType(route) {
  const method=route.method.toLowerCase(),local=('/'+route.path.replace(/^\/+|\/+$/g,''));
  return {'get /':'list','get /:id':'getById','post /':'create','put /:id':'update','delete /:id':'remove'}[method+' '+local];
}
export function loadControllerMetadata(C,file,name,basePath,definitions) {
  return load(file,old=> {
    const dependencies=[...new Set(C.__miniDependencies||[])];
    const serviceName=dependencies.length===1?dependencies[0]:(dependencies.includes(old.serviceName)?old.serviceName:'');
    const prior=Array.isArray(old.routes)?old.routes:[];
    const routes=definitions.map(route=> {
      const guard=C.__guards?.[route.handler],roles=[...(guard?.roles||[])];
      const existing=prior.find(item=>item.handlerName===route.handler)||{};
      const type=routeType(route)||existing.type;
      return {...existing,...(type?{type}:{}),method:route.method.toLowerCase(),path:route.path,
        handlerName:route.handler,auth:guard?.type==='auth'||roles.length>0,roles};
    });
    const auth=routes.length>0&&routes.every(route=>route.auth);
    // Top-level roles describe the common policy only; each route retains its real policy.
    const roles=auth&&routes.every(route=>JSON.stringify(route.roles)===JSON.stringify(routes[0].roles))?routes[0].roles:[];
    return {...old,name,basePath,controllerType:old.controllerType??(serviceName?'DB':''),serviceName,
      description:old.description??description(file,name),auth,roles,routes,
      realtime:old.realtime??{enabled:false,channel:''},_generatedAt:old._generatedAt||'',_version:2};
  });
}
