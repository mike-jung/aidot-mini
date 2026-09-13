import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {RosBridgeDriver,RobatonDemoClient} from '../modules/robot-client/client.mjs';
import {RobotSettings} from '../modules/robot-client/settings.mjs';
import {RobotManager} from '../modules/robot-client/manager.mjs';
import {requestJson} from '../modules/robot-client/transport.mjs';

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aidot-robot-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const value={schema:'aidot-ros-bridge/v1',ready:true,navigationAvailable:true,pose:{x:0,y:0,yaw:0,frameId:'map'},frameId:'map',poseAgeMs:0,battery:75,batteryAgeMs:0,active:null,lastCommand:null,recoveryRequired:false,storageFault:false};
  const driver={reads:0,heartbeats:0,cancels:[],goals:[],state:async()=>{driver.heartbeats++;return structuredClone(value);},inspect:async()=>{driver.reads++;return structuredClone(value);},navigate:async goal=>driver.goals.push(goal),cancel:async id=>driver.cancels.push(id)};
  const create=extra=>new RobatonDemoClient({url:'http://127.0.0.1:9800',token:'isolated-test-token',id:'amr-a',driver,file:path.join(dir,'client.json'),...extra});
  return {dir,value,driver,create};
}
test('cached robot status expires without another successful response',t=>{
  const f=fixture(t),client=f.create();client.lastBridge=f.value;client.bridgeAt=performance.now()-4000;client.controllerAt=performance.now()-4000;
  const s=client.snapshot();assert.equal(s.bridge.ready,false);assert.equal(s.bridge.connected,false);assert.equal(s.controller.connected,false);assert(s.bridge.poseAgeMs>=4000);
});
test('missing or invalid measurement ages cannot enable navigation or resume',async t=>{
  const f=fixture(t),client=f.create();client.controllerAt=performance.now();client.saved.hold='review';
  for(const bad of [undefined,null,-1,NaN,Infinity,1501]){
    f.value.poseAgeMs=bad;
    await assert.rejects(client.tick(),{code:'FRESH_ROBOT_MEASUREMENTS_REQUIRED'});
    await assert.rejects(client.resume(),{code:'RESUME_NOT_READY'});
  }
  f.value.poseAgeMs=0;f.value.pose.x=NaN;
  await assert.rejects(client.tick(),{code:'FRESH_ROBOT_MEASUREMENTS_REQUIRED'});
  assert.equal(f.driver.goals.length,0);assert.equal(client.saved.hold,'review');
});
test('resume retries a ROS-confirmed canceled waypoint with a new attempt',async t=>{
  const f=fixture(t),client=f.create();client.controllerAt=performance.now();client.saved.hold='paused';client.saved.order={id:'order-1',goalId:'goal-1',attempt:0,waypoint:1,completed:false};
  f.value.lastCommand={commandId:'goal-1',state:'CANCELED'};await client.resume();
  assert.equal(client.saved.order.goalId,null);assert.equal(client.saved.order.attempt,1);assert.equal(client.saved.order.waypoint,1);assert.equal(client.saved.hold,null);
});
test('resume preserves success and rejects missing results or stale controller state',async t=>{
  const f=fixture(t),client=f.create();client.controllerAt=performance.now();client.saved.hold='paused';client.saved.order={id:'order-1',goalId:'goal-1',attempt:0,completed:false};
  await assert.rejects(client.resume(),{code:'GOAL_RECONCILIATION_REQUIRED'});
  f.value.lastCommand={commandId:'goal-1',state:'SUCCEEDED'};await client.resume();assert.equal(client.saved.order.goalId,'goal-1');
  client.controllerAt=performance.now()-4000;await assert.rejects(client.resume(),{code:'RESUME_NOT_READY'});
});
test('checkpoint failure still requests cancellation and prevents new dispatch',async t=>{
  const f=fixture(t),client=f.create();client.saved.order={goalId:'owned-goal',completed:false};client.file=f.dir;
  await client.hold();assert.deepEqual(f.driver.cancels,['owned-goal']);assert(client.storageFault);
  await assert.rejects(client.tick(),{code:'CHECKPOINT_UNAVAILABLE'});assert.equal(f.driver.goals.length,0);
});
test('holding an idle client does not cancel an unrelated navigation goal',async t=>{
  const f=fixture(t),client=f.create();await client.hold();assert.deepEqual(f.driver.cancels,[]);
});
test('a pause requested during a pending poll prevents the next goal dispatch',async t=>{
  const f=fixture(t),client=f.create();client.needsRegistration=false;
  let release,entered;const ready=new Promise(resolve=>entered=resolve);
  client.api=async()=>{entered();await new Promise(resolve=>release=resolve);return {robot:{seq:1,command:{id:'o-1',state:'ACTIVE',waypoints:[{x:0,y:0},{x:1,y:0}]}},fleet:{bootId:'boot',paused:false,corridor:{blocked:false}}};};
  const tick=client.tick();await ready;const paused=client.hold();release();await tick;await paused;
  assert.equal(f.driver.goals.length,0);assert(client.saved.hold);
});
test('an unfinished order disappearing from the controller remains held',async t=>{
  const f=fixture(t),client=f.create();client.needsRegistration=false;client.saved.order={id:'lost-order',completed:false,goalId:null};
  client.api=async()=>({robot:{seq:1,command:null},fleet:{paused:false,corridor:{blocked:false}}});await client.tick();assert.equal(client.saved.order.id,'lost-order');assert(client.saved.hold);
});
test('a profile change cannot discard an unfinished order checkpoint',t=>{
  const f=fixture(t),client=f.create();client.saved.order={id:'o-1',completed:false};client.save();
  assert.throws(()=>f.create({id:'amr-b'}),{code:'PROFILE_HAS_UNFINISHED_ORDER'});
});
test('settings persist with private permissions and never return the access key',t=>{
  const f=fixture(t),settings=new RobotSettings(f.dir,{env:{}}),token='private-test-token-for-controller';
  const result=settings.update({revision:'initial',values:{enabled:true,controllerUrl:'https://fleet.example.test',apiToken:token}});
  assert.equal(result.restartRequired,true);assert.equal(result.saved.tokenConfigured,true);assert(!JSON.stringify(result).includes(token));
  if(process.platform!=='win32')assert.equal(fs.statSync(settings.file).mode&0o077,0);assert.equal(settings.active.enabled,false);
  const restarted=new RobotSettings(f.dir,{env:{}});assert.equal(restarted.active.enabled,true);assert.equal(restarted.active.apiToken,token);
});
test('settings reject concurrent overwrite, remote plaintext, secret URL and unmanaged fields',t=>{
  const f=fixture(t),s=new RobotSettings(f.dir,{env:{}});s.update({revision:'initial',values:{robotId:'amr-b'}});
  assert.throws(()=>s.update({revision:'initial',values:{robotId:'amr-a'}}),{code:'ROBOT_SETTINGS_CONFLICT'});
  const revision=s.view().revision;
  for(const values of [{controllerUrl:'http://fleet.example.test'},{controllerUrl:'https://name:secret@fleet.example.test'},{bridgeUrl:'https://another-device.test'},{shell:'touch /tmp/nope'}])assert.throws(()=>s.update({revision,values}));
});
test('environment values stay locked and credentials remain hidden',t=>{
  const f=fixture(t),s=new RobotSettings(f.dir,{env:{ROBOT_ID:'amr-a',ROBATON_API_TOKEN:'locked-private-token'}});
  assert(s.view().locked.includes('apiToken'));assert(!JSON.stringify(s.view()).includes('locked-private-token'));
  assert.throws(()=>s.update({revision:'initial',values:{robotId:'amr-b'}}),{code:'ROBOT_SETTING_MANAGED'});
});
test('repeated diagnostics coalesce requests and do not send control heartbeats',async t=>{
  const f=fixture(t),manager=new RobotManager({directory:f.dir,env:{},driver:f.driver});
  const states=await Promise.all(Array.from({length:12},()=>manager.snapshot()));assert.equal(f.driver.reads,1);assert.equal(f.driver.heartbeats,0);assert(states.every(s=>s.bridge.ready));
  assert.equal(states[0].configured,false);assert.equal(states[0].controller.connected,false);
});
test('settings cannot change while the bridge reports active navigation',async t=>{
  const f=fixture(t),manager=new RobotManager({directory:f.dir,env:{},driver:f.driver});f.value.active={state:'EXECUTING'};
  await assert.rejects(manager.update({revision:'initial',values:{robotId:'amr-b'}}),{code:'SETTINGS_BLOCKED_BY_MOTION'});
  assert.equal(fs.existsSync(manager.settings.file),false);
});
test('real HTTP driver separates diagnostic GET from heartbeat POST',async t=>{
  const f=fixture(t),requests=[],server=http.createServer(async(req,res)=>{for await(const unused of req){}requests.push([req.method,req.url]);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(f.value));});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const file=path.join(f.dir,'token');fs.writeFileSync(file,'private-bridge-token-0123456789-abc',{mode:0o600});const driver=new RosBridgeDriver({url:`http://127.0.0.1:${server.address().port}`,tokenFile:file});await driver.inspect();await driver.state();
  assert.deepEqual(requests,[['GET','/v1/state'],['POST','/v1/state']]);
});
test('bounded HTTP JSON rejects oversized data and does not echo remote error text',async t=>{
  const server=http.createServer((req,res)=>{res.writeHead(req.url==='/secret'?401:200,{'Content-Type':'application/json'});if(req.url==='/secret')res.end('{"error":"secret-was-reflected-here"}');else{res.write('"');res.write('x'.repeat(5000));res.end('"');}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});const url=`http://127.0.0.1:${server.address().port}`;
  await assert.rejects(requestJson(url,{limit:1024}),{code:'BRIDGE_RESPONSE_TOO_LARGE'});
  await assert.rejects(requestJson(url+'/secret'),error=>error.code==='BRIDGE_AUTH_FAILED'&&!error.message.includes('secret-was-reflected'));
});
