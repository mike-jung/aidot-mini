// Exercise the real aidot-mini HTTP server and JavaScript driver against a live ROS bridge.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aidot-mini-live-ros-'));
Object.assign(process.env,{DATA_DIR:directory,ENV_FILE:path.join(directory,'unused.env'),ADMIN_TOKEN:randomBytes(32).toString('hex'),HOST:'127.0.0.1',PORT:'0',HTTPS_ENABLED:'false',LOG_TO_FILE:'false',LOG_LEVEL:'error'});
const {RosBridgeDriver}=await import('../../modules/robot-client/client.mjs');
const {RobotManager}=await import('../../modules/robot-client/manager.mjs');
const {main}=await import('../../start.js');
const driver=new RosBridgeDriver({url:process.env.BRIDGE_URL,tokenFile:process.env.BRIDGE_TOKEN_FILE});
let server,manager;
const tests=[];
function check(name,condition){assert.ok(condition,name);tests.push(name);console.log('PASS '+name);}
async function until(predicate,{heartbeat=true,seconds=12}={}){
 const deadline=performance.now()+seconds*1000;let state;
 while(performance.now()<deadline){state=await(heartbeat?driver.state():driver.inspect());if(predicate(state))return state;await delay(80);}
 throw new Error('Timed out: '+JSON.stringify(state));
}
try {
 server=await main({signals:false,configure:({router,logger})=>{manager=new RobotManager({directory,env:{},driver,logger});manager.register(router);}});
 const base='http://127.0.0.1:'+server.address().port;
 const auth={Authorization:'Bearer '+process.env.ADMIN_TOKEN};
 async function request(route,{body,authenticated=true}={}){
  const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(authenticated?auth:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
 }
 check('real mini server rejects unauthenticated robot diagnostics',(await request('/admin/robot',{authenticated:false})).status===401);
 const status=await request('/admin/status');
 check('annotation workspace loads in real Linux mini server',status.status===200&&status.body.data.version==='0.5.0'&&status.body.data.controllers.some(c=>c.basePath==='/api/notes'));
 const ready=await until(s=>s.ready&&s.battery!==null);
 const diagnostic=await request('/admin/robot/diagnostics',{body:{}});
 check('admin diagnostics expose real ROS pose, battery and distribution',diagnostic.status===200&&diagnostic.body.data.bridge.ready&&diagnostic.body.data.bridge.runtime.family===process.env.AIDOT_TEST_ROS_FAMILY&&Math.abs(diagnostic.body.data.bridge.battery-75)<.01);
 const goal={commandId:'mini-live-success',x:ready.pose.x+.21,y:ready.pose.y,frameId:'map',timeoutSec:10};
 await driver.navigate(goal);
 const complete=await until(s=>s.lastCommand?.commandId===goal.commandId&&s.lastCommand.state==='SUCCEEDED');
 check('JavaScript driver completes actual ROS action at measured destination',Math.abs(complete.pose.x-goal.x)<.03);
 await driver.navigate({commandId:'mini-live-cancel',x:complete.pose.x+3,y:complete.pose.y,timeoutSec:20});
 await until(s=>s.active?.state==='EXECUTING');
 const active=await request('/admin/robot/diagnostics',{body:{}});
 check('mini HTTP diagnostics report active ROS execution',active.body.data.bridge.active==='EXECUTING');
 await driver.cancel('mini-live-cancel');
 const canceled=await until(s=>s.lastCommand?.commandId==='mini-live-cancel'&&s.lastCommand.state==='CANCELED');
 check('JavaScript cancellation receives actual ROS canceled result',canceled.active===null);
 await driver.navigate({commandId:'mini-live-readonly',x:canceled.pose.x+3,y:canceled.pose.y,timeoutSec:20});
 for(let i=0;i<32;i++){await request('/admin/robot/diagnostics',{body:{}});await delay(100);}
 const expired=await until(s=>s.lastCommand?.commandId==='mini-live-readonly'&&s.lastCommand.state==='CANCELED',{heartbeat:false});
 check('HTTP console diagnostics do not hide a lost control heartbeat',expired.active===null);
 const stopped=await request('/admin/robot/diagnostics',{body:{}});
 check('mini HTTP diagnostics show settled ROS state',stopped.body.data.bridge.active===null&&stopped.body.data.bridge.ready);
 console.log(JSON.stringify({passed:tests.length,tests,node:process.version,rosFamily:process.env.AIDOT_TEST_ROS_FAMILY,transport:'real mini HTTP + JavaScript driver + installed ROS adapter + simulated navigation'}));
} finally {
 if(server)await server.stop();
 fs.rmSync(directory,{recursive:true,force:true});
}
