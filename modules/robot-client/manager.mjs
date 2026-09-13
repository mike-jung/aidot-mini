import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {RobotSettings} from './settings.mjs';
import {RosBridgeDriver,RobatonDemoClient} from './client.mjs';
import {RobotError} from './transport.mjs';

export class RobotManager {
  constructor({directory,env=process.env,logger,driver,clientFactory=values=>new RobatonDemoClient(values)}){
    this.logger=logger;this.settings=new RobotSettings(directory,{env});this.profile=this.settings.active;
    this.driver=driver||new RosBridgeDriver({url:this.profile.bridgeUrl,tokenFile:env.ROS_BRIDGE_TOKEN_FILE||path.join(directory,'robot','bridge-token')});
    this.client=null;this.setupError=null;this.probe=null;this.probeAt=null;this.pendingProbe=null;
    if(this.profile.enabled){
      if(!this.profile.controllerUrl||!this.profile.apiToken)this.setupError='ROBOT_SETUP_INCOMPLETE';
      else try{this.client=clientFactory({url:this.profile.controllerUrl,token:this.profile.apiToken,id:this.profile.robotId,driver:this.driver,file:path.join(directory,'robot-client.json')});}
      catch(error){this.setupError=error.code||'ROBOT_CHECKPOINT_UNAVAILABLE';}
    }
  }
  start(){this.client?.start();}
  async inspect({force=false}={}){
    if(this.pendingProbe)return this.pendingProbe;
    if(!force&&this.probeAt!==null&&performance.now()-this.probeAt<250)return this.probe;
    this.pendingProbe=(async()=>{
      try{
        const value=await this.driver.inspect();
        if(value?.schema!=='aidot-ros-bridge/v1')throw new RobotError('BRIDGE_INVALID_RESPONSE');
        this.probe={connected:true,value,error:null};
      }catch(error){this.probe={connected:false,value:null,error:error.code||'BRIDGE_UNREACHABLE'};}
      this.probeAt=performance.now();return this.probe;
    })();
    try{return await this.pendingProbe;}finally{this.pendingProbe=null;}
  }
  async snapshot(){
    const probe=await this.inspect(),value=probe.value,elapsed=Math.max(0,performance.now()-(this.probeAt??performance.now()));
    const age=n=>Number.isFinite(n)?Math.round(n+elapsed):null;
    const poseAge=age(value?.poseAgeMs),batteryAge=age(value?.batteryAgeMs);
    const client=this.client?.snapshot()||null;
    const checks=[
      {id:'bridge',ok:probe.connected,code:probe.error||'OK'},
      {id:'navigation',ok:value?.navigationAvailable??Boolean(value?.ready),code:'NAVIGATION_SERVER'},
      {id:'pose',ok:Boolean(value?.pose)&&poseAge!==null&&poseAge<=1500,code:'LOCALIZATION',ageMs:poseAge},
      {id:'battery',ok:Number.isFinite(value?.battery)&&batteryAge!==null&&batteryAge<=10000,code:'BATTERY',ageMs:batteryAge},
      {id:'recovery',ok:Boolean(value)&&!value.recoveryRequired&&!value.storageFault&&!client?.storageFault,code:'RECOVERY'},
    ];
    return {schema:'aidot-robot-console/v1',configured:Boolean(this.client),enabled:this.profile.enabled,setupError:this.setupError,robotId:this.profile.robotId,protocol:this.profile.protocol,
      phase:client?.phase||(this.setupError?'fault':'setup'),controller:client?.controller||{connected:false,ageMs:null},
      hold:client?.hold||null,remoteHeld:client?.remoteHeld||false,error:client?.error||null,order:client?.order||null,
      bridge:{connected:probe.connected,ready:checks.every(c=>c.ok),pose:value?.pose||null,poseAgeMs:poseAge,battery:Number.isFinite(value?.battery)?value.battery:null,batteryAgeMs:batteryAge,frameId:value?.frameId||null,runtime:value?.runtime||null,active:value?.active?.state||null,recoveryRequired:Boolean(value?.recoveryRequired),storageFault:Boolean(value?.storageFault||client?.storageFault)},checks,
      canResume:Boolean(client?.hold&&client.controller.connected&&!client.remoteHeld&&checks.every(c=>c.ok)&&!value?.active),
      settingsEditable:!client?.order||client.order.completed};
  }
  async update(body){
    const perform=async()=>{
      if(this.client?.saved.order&&!this.client.saved.order.completed)throw new RobotError('SETTINGS_BLOCKED_BY_ORDER',409);
      const probe=await this.inspect({force:true});
      if(probe.value?.active)throw new RobotError('SETTINGS_BLOCKED_BY_MOTION',409);
      const result=this.settings.update(body);this.logger?.info('Robot settings saved; restart required');return result;
    };
    return this.client?this.client.exclusive(perform):perform();
  }
  async pause(){if(!this.client)throw new RobotError('ROBOT_SETUP_INCOMPLETE',409);await this.client.hold();this.probeAt=null;return this.snapshot();}
  async resume(body){
    if(!this.client||body?.confirmStopped!==true||Object.keys(body).some(k=>k!=='confirmStopped'))throw new RobotError('STOP_CONFIRMATION_REQUIRED',400);
    await this.client.resume();this.probeAt=null;return this.snapshot();
  }
  async stop(){await this.client?.stop();}
  register(router){
    router.features={...router.features,robot:true};
    const options={auth:true,roles:['admin']};
    const add=(method,url,fn)=>router.add(method,url,async(req,res)=>{
      try{res.json({code:200,data:await fn(req.body)});}catch(error){
        if(error instanceof RobotError){res.json(error.status,{code:error.status,message:'Robot request could not be completed',reasonCode:error.code});return;}
        throw error;
      }
    },options);
    add('GET','/admin/robot',()=>this.snapshot());
    add('GET','/admin/robot/settings',()=>this.settings.view());
    add('PUT','/admin/robot/settings',body=>this.update(body));
    add('POST','/admin/robot/diagnostics',async()=>{await this.inspect({force:true});return this.snapshot();});
    add('POST','/admin/robot/pause',()=>this.pause());
    add('POST','/admin/robot/resume',body=>this.resume(body));
    const previous=router.beforeClose;router.beforeClose=async()=>{await this.stop();await previous?.();};
  }
}
