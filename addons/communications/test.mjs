import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import mqtt from 'mqtt';
import {io as connectSocket} from 'socket.io-client';
import {mqttTelemetry} from './mqtt.mjs';
import {socketTelemetry} from './socketio.mjs';

async function waitFor(predicate,ms=6000){const end=Date.now()+ms;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw new Error('Condition timed out');}
async function freePort(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));return port;}

test('MQTT 5 real Mosquitto: telemetry, bounded offline behavior, retained LWT, reconnect', {timeout:20000}, async()=>{
  if(!process.env.MOSQUITTO_BIN)throw new Error('Set MOSQUITTO_BIN to a real Mosquitto executable');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aidot-mqtt-')),port=await freePort();
  fs.writeFileSync(path.join(tmp,'mosquitto.conf'),`listener ${port} 127.0.0.1\nallow_anonymous true\npersistence false\n${process.getuid?.()===0?'user root\n':''}`);
  const broker=spawn(process.env.MOSQUITTO_BIN,['-c',path.join(tmp,'mosquitto.conf')]);let logs='';broker.stderr.on('data',b=>{logs+=b;});
  const url=`mqtt://127.0.0.1:${port}`;let subscriber,publisher;
  try{
    await waitFor(()=>logs.includes('running')||broker.exitCode!==null);assert.equal(broker.exitCode,null,logs);
    subscriber=mqtt.connect(url,{protocolVersion:5,reconnectPeriod:0});subscriber.on('error',()=>{});await once(subscriber,'connect');
    const messages=[];subscriber.on('message',(topic,body,packet)=>messages.push({topic,body:JSON.parse(body),packet}));
    await subscriber.subscribeAsync('aidot/devices/testbot/#',{qos:1});
    publisher=mqttTelemetry({url,deviceId:'testbot'});assert.equal(publisher.publish({pose:{x:0}}),false);
    await once(publisher.client,'connect');await waitFor(()=>messages.some(m=>m.body.online===true));
    assert.equal(publisher.publish({battery:75}),true);
    await waitFor(()=>messages.some(m=>m.body.data?.battery===75));
    const telemetry=messages.find(m=>m.body.data?.battery===75);assert.equal(telemetry.packet.qos,0);assert.equal(telemetry.packet.retain,false);assert.equal(telemetry.packet.properties.messageExpiryInterval,10);
    assert.throws(()=>publisher.publish('x'.repeat(9000)));
    const closed=once(publisher.client,'close');publisher.client.stream.destroy();await closed;
    assert.equal(publisher.publish({stale:true}),false);await waitFor(()=>messages.some(m=>m.body.online===false));
    await waitFor(()=>publisher.state().connected);await publisher.close();
    await waitFor(()=>messages.filter(m=>m.body.online===false).length>=2);
    assert.throws(()=>mqttTelemetry({url:'mqtt://example.com',deviceId:'testbot'}),/TLS/);
    assert.throws(()=>mqttTelemetry({url,deviceId:'robot/#'}),/scope/);
  }finally{
    await publisher?.close();await subscriber?.endAsync(true);broker.kill('SIGTERM');if(broker.exitCode===null)await once(broker,'exit');fs.rmSync(tmp,{recursive:true,force:true});
  }
});

test('Socket.IO actual WebSocket: authorization, same-origin, snapshot, revocation', {timeout:10000},async()=>{
  const server=http.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
  let valid=true;const sockets=[];
  const channel=socketTelemetry({server,origins:[url],authorize:auth=>valid&&auth.token==='test-token'?{id:'operator'}:null,snapshot:()=>({battery:75})});
  const connect=(token,origin=url)=>{const socket=connectSocket(url,{transports:['websocket'],reconnection:false,forceNew:true,auth:{token},extraHeaders:{Origin:origin}});sockets.push(socket);return socket;};
  try{
    const unauthorized=connect('wrong');const [error]=await once(unauthorized,'connect_error');assert.match(error.message,/Authentication/);
    const crossOrigin=connect('test-token','https://untrusted.example');await once(crossOrigin,'connect_error');
    const socket=connect('test-token');await once(socket,'connect');
    const snapshot=await new Promise((resolve,reject)=>socket.timeout(2000).emit('snapshot',(error,value)=>error?reject(error):resolve(value)));assert.equal(snapshot.data.battery,75);
    const incoming=once(socket,'telemetry');await channel.publish({battery:74});assert.deepEqual((await incoming)[0],{battery:74});
    await assert.rejects(channel.publish('x'.repeat(9000)),/8192/);
    valid=false;const disconnected=once(socket,'disconnect');await channel.publish({battery:73});await disconnected;assert.equal(socket.connected,false);
  }finally{for(const socket of sockets)socket.disconnect();await channel.close();}
});
