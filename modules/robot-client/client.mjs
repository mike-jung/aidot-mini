import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicWrite} from '../../src/core/atomicFile.js';
import {performance} from 'node:perf_hooks';
import {endpoint,requestJson,privateToken,RobotError} from './transport.mjs';

function freshMeasurements(state){
  return state&&state.schema==='aidot-ros-bridge/v1'&&state.pose&&
    ['x','y','yaw'].every(key=>Number.isFinite(state.pose[key]))&&
    typeof state.frameId==='string'&&state.frameId.length>0&&
    Number.isFinite(state.poseAgeMs)&&state.poseAgeMs>=0&&state.poseAgeMs<=1500&&
    Number.isFinite(state.battery)&&state.battery>=0&&state.battery<=100&&
    Number.isFinite(state.batteryAgeMs)&&state.batteryAgeMs>=0&&state.batteryAgeMs<=10000&&
    !state.recoveryRequired&&!state.storageFault;
}

export class RosBridgeDriver {
  constructor({url='http://127.0.0.1:8912',tokenFile}){this.url=endpoint(url,{localOnly:true});this.tokenFile=tokenFile;}
  async request(route,body){
    return requestJson(this.url+route,{body,token:privateToken(this.tokenFile)});
  }
  state(){return this.request('/v1/state',{});} // Explicit control heartbeat; GET diagnostics cannot renew it.
  inspect(){return this.request('/v1/state');}
  navigate(goal){return this.request('/v1/navigate',goal);}
  cancel(commandId){return this.request('/v1/cancel',commandId?{commandId}:{});}
}

/** Concrete adapter for ROBATON v0.50's documented two-robot demonstration API. */
export class RobatonDemoClient {
  constructor({url,token,id,driver,file,tickMs=200}){
    this.url=endpoint(url);if(!['amr-a','amr-b'].includes(id))throw new Error('ROBATON v0.50 demo supports amr-a or amr-b only');
    if(typeof token!=='string'||token.length<12)throw new Error('ROBATON API token is required');
    Object.assign(this,{token,id,driver,file,tickMs,stopped:true,phase:'waiting',lastError:null,lastBridge:null,remoteHeld:false,failures:0,bridgeAt:null,controllerAt:null,storageFault:false,queue:Promise.resolve()});
    this.saved=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{schema:'aidot-robaton-demo/v1',registrationId:randomUUID(),session:null,seq:0,order:null,pending:null,hold:null};
    if(this.saved.schema!=='aidot-robaton-demo/v1')throw new Error('Unsupported robot checkpoint');
    const identity={robotId:id,controllerUrl:this.url};
    if(this.saved.identity&&JSON.stringify(this.saved.identity)!==JSON.stringify(identity)){
      if(this.saved.order&&!this.saved.order.completed)throw new RobotError('PROFILE_HAS_UNFINISHED_ORDER',409);
      this.saved={schema:'aidot-robaton-demo/v1',registrationId:randomUUID(),session:null,seq:0,order:null,pending:null,hold:null};
    }
    this.saved.identity=identity;
    this.needsRegistration=true;
    if(this.saved.order&&!this.saved.order.completed)this.saved.hold='Process restarted during an order; reconcile before resume';
    this.save();
  }
  save(){try{atomicWrite(this.file,JSON.stringify(this.saved,null,2)+'\n');}catch{this.storageFault=true;throw new RobotError('CHECKPOINT_UNAVAILABLE');}}
  exclusive(fn){const next=this.queue.then(fn);this.queue=next.catch(()=>{});return next;}
  snapshot(){
    const now=performance.now(),bridgeAge=this.bridgeAt===null?null:Math.max(0,Math.round(now-this.bridgeAt));
    const controllerAge=this.controllerAt===null?null:Math.max(0,Math.round(now-this.controllerAt));
    const age=value=>Number.isFinite(value)&&bridgeAge!==null?value+bridgeAge:null;
    const poseAge=age(this.lastBridge?.poseAgeMs),batteryAge=age(this.lastBridge?.batteryAgeMs);
    return {protocol:'robaton-demo-v050',robotId:this.id,phase:this.phase,hold:this.saved.hold,error:this.lastError,
      storageFault:this.storageFault,remoteHeld:this.remoteHeld,controller:{connected:controllerAge!==null&&controllerAge<=3000,ageMs:controllerAge},
      order:this.saved.order?{id:this.saved.order.id,waypoint:this.saved.order.waypoint,completed:this.saved.order.completed}:null,
      bridge:this.lastBridge?{ready:Boolean(this.lastBridge.ready&&bridgeAge!==null&&bridgeAge<=1500&&poseAge!==null&&poseAge<=1500&&!this.storageFault),connected:bridgeAge!==null&&bridgeAge<=1500,pose:this.lastBridge.pose,poseAgeMs:poseAge,battery:this.lastBridge.battery,batteryAgeMs:batteryAge,active:this.lastBridge.active?.state,recoveryRequired:this.lastBridge.recoveryRequired}:null};
  }
  async api(route,body){
    const value=await requestJson(this.url+'/api/demo'+route,{body,token:this.token,kind:'CONTROLLER'});
    if(!value?.robot||!value.fleet||!Number.isSafeInteger(value.robot.seq)||value.robot.seq<0)throw new RobotError('CONTROLLER_INVALID_RESPONSE');
    this.controllerAt=performance.now();return value;
  }
  async _hold(reason){
    this.phase='held';const changed=this.saved.hold!==reason;this.saved.hold=reason;
    if(changed)try{this.save();}catch{this.lastError='CHECKPOINT_UNAVAILABLE';}
    // Failure to persist must never prevent cancellation of an owned goal.
    if(this.saved.order?.goalId)try{await this.driver.cancel(this.saved.order.goalId);}catch{this.lastError='CANCEL_NOT_CONFIRMED';}
  }
  hold(reason='Operator paused the robot client'){
    this.pauseRequested=true;
    return this.exclusive(async()=>{try{await this._hold(reason);}finally{this.pauseRequested=false;}});
  }
  resume(){return this.exclusive(()=>this._resume());}
  async _resume(){
    const state=await this.driver.state();
    if(this.storageFault||!freshMeasurements(state)||state.ready!==true||state.active||this.remoteHeld||!this.snapshot().controller.connected)throw new RobotError('RESUME_NOT_READY',409);
    const order=this.saved.order;
    if(order?.goalId){
      const result=state.lastCommand?.commandId===order.goalId?state.lastCommand:null;
      if(!result||!['SUCCEEDED','CANCELED','FAILED','TIMED_OUT'].includes(result.state))throw new RobotError('GOAL_RECONCILIATION_REQUIRED',409);
      if(result.state!=='SUCCEEDED'){order.goalId=null;order.attempt++;}
    }
    this.saved.hold=null;this.save();return this.snapshot();
  }
  tick(){return this.exclusive(()=>this._tick());}
  async _tick(){
    if(this.storageFault)throw new RobotError('CHECKPOINT_UNAVAILABLE');
    const bridge=await this.driver.state();this.lastBridge=bridge;this.bridgeAt=performance.now();
    if(!freshMeasurements(bridge))throw new RobotError('FRESH_ROBOT_MEASUREMENTS_REQUIRED');
    let reply;
    if(this.needsRegistration){
      reply=await this.api('/register',{id:this.id,registrationId:this.saved.registrationId});
      // Registration is idempotent and returns the authoritative sequence after restart.
      // High-rate telemetry stays in memory; persist motion transitions, not every sample.
      this.saved.session=reply.session;this.saved.seq=reply.robot.seq;this.saved.pending=null;this.needsRegistration=false;this.save();
      if(Math.hypot(bridge.pose.x-reply.robot.pose.x,bridge.pose.y-reply.robot.pose.y)>0.035){await this._hold('Robot pose does not match the ROBATON demonstration map');return;}
    }else{
      if(!this.saved.pending){
        const order=this.saved.order;
        this.saved.pending={session:this.saved.session,seq:this.saved.seq+1,pose:{x:bridge.pose.x,y:bridge.pose.y},battery:bridge.battery,
          status:bridge.active?'MOVING':this.saved.hold||this.remoteHeld?'HOLD':'IDLE',
          ...(order?.ack?{ackCommandId:order.id,completed:order.completed}: {})};
      }
      // Retain the exact payload across a lost response. Never reuse seq with changed data.
      reply=await this.api(`/robots/${this.id}/telemetry`,this.saved.pending);
      this.saved.seq=reply.robot.seq;this.saved.pending=null;
    }
    this.remoteHeld=Boolean(reply.fleet.paused||reply.fleet.corridor.blocked);
    const command=reply.robot.command;
    if(!command){
      if(this.saved.order&&!this.saved.order.completed){await this._hold('Controller no longer reports the unfinished order');return;}
      if(this.saved.order){this.saved.order=null;this.save();}this.phase=this.saved.hold?'held':'idle';return;
    }
    if(typeof command.id!=='string'||typeof reply.fleet.bootId!=='string'||!Array.isArray(command.waypoints)||command.waypoints.length<2||command.waypoints.length>256||command.waypoints.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new RobotError('CONTROLLER_INVALID_ORDER');
    if(this.saved.order?.id!==command.id){
      if(this.saved.order&&!this.saved.order.completed){await this._hold('ROBATON replaced an unfinished order');return;}
      this.saved.order={id:command.id,bootId:reply.fleet.bootId,waypoint:1,attempt:0,goalId:null,ack:false,completed:false};this.save();
    }
    const order=this.saved.order;
    if(this.remoteHeld||this.saved.hold){
      if(bridge.active&&order.goalId)await this.driver.cancel(order.goalId);
      if(order.goalId&&bridge.lastCommand?.commandId===order.goalId&&['CANCELED','TIMED_OUT','FAILED'].includes(bridge.lastCommand.state)){
        order.goalId=null;order.attempt++;this.save();
      }
      this.phase='held';return;
    }
    if(command.state!=='ACTIVE'){this.phase='queued';return;}
    if(order.goalId){
      const result=bridge.lastCommand?.commandId===order.goalId?bridge.lastCommand:null;
      if(!order.ack&&result&&['EXECUTING','SUCCEEDED'].includes(result.state)){order.ack=true;this.save();}
      if(result?.state==='SUCCEEDED'){
        const target=command.waypoints[order.waypoint];
        if(!target||Math.hypot(bridge.pose.x-target.x,bridge.pose.y-target.y)>0.035){await this._hold('ROS success is outside the ROBATON destination tolerance');return;}
        order.waypoint++;order.goalId=null;order.attempt=0;this.save();
      }else if(result&&['CANCELED','FAILED','TIMED_OUT','UNCERTAIN'].includes(result.state)){await this._hold(`Navigation requires review: ${result.state}`);return;}
      else {this.phase='executing';return;}
    }
    if(order.waypoint>=command.waypoints.length){if(!order.completed){order.completed=true;this.save();}this.phase='reporting-completion';return;}
    if(bridge.ready!==true||bridge.active)throw new RobotError('NAVIGATION_NOT_READY');
    if(this.stopping||this.pauseRequested)return;
    const point=command.waypoints[order.waypoint];
    order.goalId=`${order.bootId}:${order.id}:${order.waypoint}:${order.attempt}`;this.save();
    await this.driver.navigate({commandId:order.goalId,x:point.x,y:point.y,yaw:0,frameId:bridge.frameId,timeoutSec:120});
    this.phase='dispatching';
  }
  start(){
    if(!this.stopped)return this.loop;this.stopped=false;this.stopping=false;
    this.loop=(async()=>{while(!this.stopped){
      try{await this.tick();this.failures=0;this.lastError=null;}
      catch(error){this.failures++;this.lastError=error.code||'ROBOT_STATE_UNAVAILABLE';if(this.saved.order&&!this.saved.order.completed)await this.hold('Communication or ROS state became uncertain');else this.phase=this.storageFault?'fault':'waiting';}
      if(!this.stopped)await new Promise(resolve=>{this.wake=resolve;this.timer=setTimeout(resolve,this.failures?Math.min(5000,500*2**Math.min(this.failures,4)):this.tickMs);});
    }})();return this.loop;
  }
  async stop(){
    this.stopped=true;this.stopping=true;clearTimeout(this.timer);this.wake?.();await this.loop;
    if(this.saved.order&&!this.saved.order.completed)await this.hold('Robot client stopped; reconcile before resume');
  }
}
