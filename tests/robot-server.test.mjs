import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aidot-robot-http-'));
Object.assign(process.env,{DATA_DIR:directory,ADMIN_TOKEN:'isolated-admin-key-0123456789-abcdef',HOST:'127.0.0.1',PORT:'0',HTTPS_ENABLED:'false',LOG_TO_FILE:'false',LOG_LEVEL:'error'});
const {main}=await import('../start.js');
const {RobotManager}=await import('../modules/robot-client/manager.mjs');
let server,url,manager,reads=0,heartbeats=0;
const sample={schema:'aidot-ros-bridge/v1',ready:true,navigationAvailable:true,pose:{x:0,y:0,yaw:0},poseAgeMs:0,battery:60,batteryAgeMs:0,frameId:'map',active:null,recoveryRequired:false};
test.before(async()=>{server=await main({signals:false,configure:({router})=>{manager=new RobotManager({directory,env:{},driver:{inspect:async()=>{reads++;return sample;},state:async()=>{heartbeats++;return sample;}}});manager.register(router);}});url='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{await server.stop();fs.rmSync(directory,{recursive:true,force:true});});
async function request(route,{method='GET',body,headers={}}={}){
 const response=await fetch(url+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:response.status,headers:response.headers,body:await response.json()};
}
const bearer={Authorization:'Bearer '+process.env.ADMIN_TOKEN};
test('robot features and diagnostics require administrator authentication',async()=>{
 for(const route of ['/admin/features','/admin/robot','/admin/robot/settings'])assert.equal((await request(route)).status,401);
 const features=await request('/admin/features',{headers:bearer});assert.equal(features.body.data.robot,true);
 const result=await request('/admin/robot',{headers:bearer});assert.equal(result.status,200);assert.equal(result.body.data.phase,'setup');assert.equal(result.body.data.bridge.ready,true);
});
test('diagnostic actions never extend the control heartbeat',async()=>{
 const before=reads;const result=await request('/admin/robot/diagnostics',{method:'POST',body:{},headers:bearer});assert.equal(result.status,200);assert(reads>before);assert.equal(heartbeats,0);
});
test('session settings writes require CSRF and never echo a saved controller key',async()=>{
 const login=await request('/admin/login',{method:'POST',body:{token:process.env.ADMIN_TOKEN},headers:{Origin:url}});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0],headers={Cookie:cookie,Origin:url};
 const payload={revision:'initial',values:{controllerUrl:'https://fleet.example.test',apiToken:'private-controller-test-key',enabled:true}};
 assert.equal((await request('/admin/robot/settings',{method:'PUT',body:payload,headers})).status,403);
 headers['X-CSRF-Token']=login.body.data.csrfToken;
 const saved=await request('/admin/robot/settings',{method:'PUT',body:payload,headers});assert.equal(saved.status,200);assert.equal(saved.body.data.restartRequired,true);assert.equal(saved.body.data.saved.tokenConfigured,true);assert(!JSON.stringify(saved.body).includes(payload.values.apiToken));
 const duplicate=await request('/admin/robot/settings',{method:'PUT',body:payload,headers});assert.equal(duplicate.status,409);assert.equal(duplicate.body.reasonCode,'ROBOT_SETTINGS_CONFLICT');
 await request('/admin/logout',{method:'POST',body:{},headers});assert.equal((await request('/admin/robot',{headers})).status,401);
});
test('a resume action requires explicit stop confirmation and a configured client',async()=>{
 const result=await request('/admin/robot/resume',{method:'POST',body:{},headers:bearer});assert.equal(result.status,400);assert.equal(result.body.reasonCode,'STOP_CONFIRMATION_REQUIRED');
});
