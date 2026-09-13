import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicWrite} from '../../src/core/atomicFile.js';
import {endpoint,RobotError} from './transport.mjs';

const defaults={enabled:false,protocol:'robaton-demo-v050',robotId:'amr-a',controllerUrl:'',bridgeUrl:'http://127.0.0.1:8912'};
const envKeys={enabled:'ROBOT_ENABLED',protocol:'ROBOT_PROTOCOL',robotId:'ROBOT_ID',controllerUrl:'ROBATON_URL',bridgeUrl:'ROS_BRIDGE_URL',apiToken:'ROBATON_API_TOKEN'};
export function validateRobotSettings(values){
  if(!values||typeof values!=='object'||Array.isArray(values))throw new RobotError('INVALID_ROBOT_SETTINGS',400);
  const result={};
  for(const [key,value] of Object.entries(values)){
    if(!Object.hasOwn(envKeys,key))throw new RobotError('UNKNOWN_ROBOT_SETTING',400);
    if(key==='enabled'){if(typeof value!=='boolean')throw new RobotError('INVALID_ROBOT_SETTINGS',400);result[key]=value;}
    else if(key==='protocol'){if(value!=='robaton-demo-v050')throw new RobotError('UNSUPPORTED_ROBOT_PROTOCOL',400);result[key]=value;}
    else if(key==='robotId'){if(!['amr-a','amr-b'].includes(value))throw new RobotError('INVALID_ROBOT_ID',400);result[key]=value;}
    else if(key==='apiToken'){
      if(typeof value!=='string'||!/^[\x21-\x7e]{12,256}$/.test(value))throw new RobotError('INVALID_CONTROLLER_TOKEN',400);
      result[key]=value;
    }else{
      if(typeof value!=='string'||value.length>512)throw new RobotError('INVALID_URL',400);
      result[key]=key==='controllerUrl'&&value===''?'':endpoint(value,{localOnly:key==='bridgeUrl'});
    }
  }
  return result;
}
const publicValues=values=>{const {apiToken,...safe}=values;return {...safe,tokenConfigured:Boolean(apiToken)};};
export class RobotSettings {
  constructor(directory,{env=process.env}={}){
    this.file=path.join(directory,'robot-settings.json');this.env=env;
    this.active=this.effective();
  }
  read(){
    if(!fs.existsSync(this.file))return {revision:'initial',values:{}};
    const stat=fs.lstatSync(this.file);
    if(!stat.isFile()||stat.size>8192||(process.platform!=='win32'&&(stat.mode&0o077)))throw new RobotError('ROBOT_SETTINGS_UNAVAILABLE');
    try{
      const data=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(data.schema!=='aidot-robot-settings/v1'||typeof data.revision!=='string')throw new Error();
      return {revision:data.revision,values:validateRobotSettings(data.values)};
    }catch{throw new RobotError('ROBOT_SETTINGS_UNAVAILABLE');}
  }
  overrides(){
    const values={};
    for(const [key,name] of Object.entries(envKeys))if(this.env[name]!==undefined){
      if(key==='enabled'){
        if(!['true','false'].includes(this.env[name]))throw new RobotError('INVALID_ROBOT_ENVIRONMENT');
        values[key]=this.env[name]==='true';
      }else values[key]=this.env[name];
    }
    return validateRobotSettings(values);
  }
  effective(){
    const saved=this.read().values,overrides=this.overrides();
    // Preserve the 0.3 CLI behavior when a complete environment profile was supplied.
    const legacyEnabled=this.env.ROBOT_ENABLED===undefined&&this.env.ROBOT_PROTOCOL&&this.env.ROBATON_URL&&this.env.ROBOT_ID&&this.env.ROBATON_API_TOKEN;
    const result={...defaults,...(legacyEnabled?{enabled:true}:{}),...saved,...overrides};
    return result;
  }
  view(){
    const saved=this.read(),next=this.effective();
    return {revision:saved.revision,effective:publicValues(this.active),saved:publicValues(next),locked:Object.keys(this.overrides()),restartRequired:JSON.stringify(this.active)!==JSON.stringify(next)};
  }
  update(body){
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['revision','values'].includes(k)))throw new RobotError('INVALID_ROBOT_SETTINGS',400);
    const old=this.read();if(body.revision!==old.revision)throw new RobotError('ROBOT_SETTINGS_CONFLICT',409);
    const update=validateRobotSettings(body.values),locked=this.overrides();
    for(const key of Object.keys(locked)){
      if(Object.hasOwn(update,key)&&update[key]!==locked[key])throw new RobotError('ROBOT_SETTING_MANAGED',409);
      delete update[key];
    }
    const values={...old.values,...update},next={...defaults,...values,...locked};
    if(next.enabled&&(!next.controllerUrl||!next.apiToken))throw new RobotError('ROBOT_SETUP_INCOMPLETE',400);
    atomicWrite(this.file,JSON.stringify({schema:'aidot-robot-settings/v1',revision:randomUUID(),values},null,2)+'\n');
    return this.view();
  }
}
