import path from 'node:path';
import {pathToFileURL} from 'node:url';
import container from './container.js';
import sqlRegistry from './sqlLoader.js';
import logger from './logger.js';
import {META} from './decorators.js';
import {mergeParams} from './paramParser.js';
import {addStep} from './requestContext.js';
import {workspaceFiles} from './workspaceFiles.js';
import {registerWorkspaceLoader} from '../loader/register.mjs';
import {loadServiceMetadata,loadControllerMetadata} from './workspaceMetadata.js';
let generation=0;
const join=(base,sub)=>('/'+[base,sub].map(s=>String(s||'').replace(/^\/+|\/+$/g,'')).filter(Boolean).join('/'))||'/';
const header=requestCode=>({requestCode:requestCode||null,timestamp:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Seoul',hour12:false}).replace('T',' ')});
export function responseEnvelope(result,params={}){
  const base={code:200,message:'OK',header:header(params.requestCode)};
  if(result===null||typeof result!=='object')return {...base,data:result};
  if(Array.isArray(result.rows)&&result.header&&typeof result.header==='object')
    return {...base,header:{...result.header,requestCode:params.requestCode||null,timestamp:result.header.timestamp||base.header.timestamp},data:result.rows};
  const out={...base,data:result.data?result.data:result.rows?result.rows:result};
  if(result.data!==undefined){
    if(result.mciMessage&&typeof result.mciMessage==='object')out.header.mci=result.mciMessage;
    if(result.meta&&typeof result.meta==='object')out.header.meta=result.meta;
  }
  return out;
}
export class ModuleRegistry{
  constructor({sql=sqlRegistry,log=logger}={}){this.sql=sql;this.log=log;this.services=new Map();this.serviceMetadata=new Map();this.controllers=[];this.generation=++generation;}
  async importFile(file){
    try{return await import(pathToFileURL(file).href+'?aidotMini='+this.generation);}
    catch(error){throw new Error(file+': '+error.message,{cause:error});}
  }
  async loadServices(dir){
    registerWorkspaceLoader(path.dirname(dir));
    container.instances.clear();container.factories.clear();this.services.clear();this.serviceMetadata.clear();
    sqlRegistry.files=this.sql.files;sqlRegistry._reverse=null;
    for(const file of workspaceFiles(dir)){
      const C=(await this.importFile(file)).default;
      if(typeof C!=='function'||!C[META.IS_SERVICE])throw new Error(file+': default class requires @Service()');
      const name=C[META.SERVICE_NAME];
      if(this.services.has(name))throw new Error('Duplicate service: '+name);
      this.services.set(name,C);
      this.serviceMetadata.set(name,loadServiceMetadata(C,file,name));
    }
    for(const C of this.services.values())for(const dep of C.__miniDependencies||[])if(!container.has(dep))throw new Error('Missing service: '+C.name+' requires '+dep);
    for(const name of this.services.keys())this.services.set(name,container.resolve(name));
    return this.services;
  }
  async loadControllers(router,dir){
    registerWorkspaceLoader(path.dirname(dir));this.controllers=[];
    for(const file of workspaceFiles(dir)){
      const C=(await this.importFile(file)).default;
      if(typeof C!=='function'||!C[META.IS_CONTROLLER])throw new Error(file+': default class requires @Controller()');
      for(const dep of C.__miniDependencies||[])if(!container.has(dep))throw new Error('Missing service: '+C.name+' requires '+dep);
      const instance=new C(),basePath=C[META.BASE_PATH]||'',routes=[];
      for(const route of C[META.ROUTES]||[]){
        if(typeof instance[route.handler]!=='function')throw new Error('Missing handler: '+C.name+'.'+route.handler);
        if(C.__sse?.[route.handler])throw new Error(file+': @SseMapping needs the aidot-express SSE hub; use the mini event API outside portable business files');
        const guard=C.__guards?.[route.handler];
        const full=join(basePath,route.path),method=route.method.toUpperCase();
        router.add(method,full,async(req,res)=>{
          let params=mergeParams(req);
          if(guard?.realm&&guard.realm!=='any'&&guard.realm!==(req.user?.realm||'admin'))
            throw Object.assign(new Error('Forbidden'),{status:403});
          const schema=C.__validators?.[route.handler];
          if(schema){
            const parsed=schema.safeParse(params);
            if(!parsed.success)return res.status(400).json({code:400,message:'Validation failed',header:header(params.requestCode),
              errors:parsed.error.issues.map(e=>({field:e.path.join('.'),code:e.code,message:e.message}))});
            params=parsed.data;
          }
          addStep('controller',C.name+'.'+route.handler);
          let delegated=false;
          const next=error=>{if(error)throw error;delegated=true;};
          const result=await instance[route.handler](params,req,res,next);
          if(delegated&&!res.headersSent)throw Object.assign(new Error('Route not found'),{status:404});
          if(!res.headersSent&&result!==undefined)res.json(responseEnvelope(result,params));
        },{controller:C.name,handler:route.handler,auth:guard?.type==='auth',roles:guard?.roles,workspace:true});
        routes.push(method+' '+full);
      }
      const metadata=loadControllerMetadata(C,file,C.name,basePath,C[META.ROUTES]||[]);
      this.controllers.push({name:C.name,basePath,file,routes,metadata});
    }
    return this.controllers;
  }
}
let current=new ModuleRegistry();
export const resetRegistry=options=>(current=new ModuleRegistry(options));
export const loadServices=dir=>current.loadServices(dir);
export const loadControllers=(router,dir)=>current.loadControllers(router,dir);
export const getService=name=>current.services.get(name);
export const listServices=()=>[...current.services.keys()];
export const listControllers=()=>current.controllers;
export const listMetadata=()=>({controllers:current.controllers.map(c=>c.metadata),services:[...current.serviceMetadata.values()]});
export default {loadServices,loadControllers,getService,listServices,listControllers,listMetadata,resetRegistry};
