import fs from 'node:fs';
import path from 'node:path';
import config,{readSettings,validateSettings,settingEnv,SETTINGS_FILE,ROOT} from '../config.js';
import {atomicWrite} from './atomicFile.js';
import {tlsOptions} from './transport.js';
import {isLoopback,isLocalRequest} from './security.js';
import logger from './logger.js';
export function effectiveSettings(){return {workspace:config.paths.workspace,host:config.server.host,port:config.server.port,https:config.server.https,certFile:config.server.certFile,keyFile:config.server.keyFile,language:config.console.language,logLevel:config.log.level,consoleAccess:config.console.access};}
export function registerSettings(router){
  const locks=()=>Object.keys(settingEnv).filter(k=>process.env[settingEnv[k]]!==undefined||(config.server.managed&&['host','port','https','certFile','keyFile'].includes(k)));
  const view=()=>({effective:effectiveSettings(),saved:readSettings(),locked:locks(),restartRequired:['workspace','host','port','https','certFile','keyFile'].some(k=>readSettings()[k]!==undefined&&!locks().includes(k)&&readSettings()[k]!==effectiveSettings()[k])});
  router.add('GET','/admin/settings',(req,res)=>res.json({code:200,data:view()}),{auth:true,roles:['admin']});
  router.add('PUT','/admin/settings',(req,res)=>{
    try{
      if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw new Error('Settings must be a JSON object');
      const update=validateSettings(req.body);
      for(const key of locks())if(key in update&&update[key]!==effectiveSettings()[key])throw new Error(`${key} is managed by the environment`);
      for(const key of locks())delete update[key];
      const saved={...readSettings(),...update};
      const next={...effectiveSettings(),...saved};for(const key of locks())next[key]=effectiveSettings()[key];
      if(!isLoopback(next.host)&&!next.https)throw new Error('LAN access requires HTTPS');
      // 원격에서 로컬 전용으로 바꾸면 저장하는 순간 스스로 잠겨 되돌릴 수 없다.
      if(next.consoleAccess==='local'&&!isLocalRequest(req))
        throw new Error('Switch the console to local-only from the server itself; doing it remotely would lock you out');
      tlsOptions(next);
      if(!fs.statSync(path.resolve(ROOT,next.workspace)).isDirectory())throw new Error('Workspace must be an existing directory');
      atomicWrite(SETTINGS_FILE,JSON.stringify(saved,null,2)+'\n');
      config.console.language=next.language;config.log.level=next.logLevel;logger.setLevel(next.logLevel);
      config.console.access=next.consoleAccess;   // 재시작 없이 즉시 적용된다
      if(next.consoleAccess==='local')logger.warn('Console access is now local-only');
      res.json({code:200,data:view()});
    }catch(e){e.status=400;throw e;}
  },{auth:true,roles:['admin']});
}
