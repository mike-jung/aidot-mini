import mqtt from 'mqtt';
import {randomUUID} from 'node:crypto';

/** Optional telemetry publisher. Broker ACK is never interpreted as robot completion. */
export function mqttTelemetry({url,deviceId,username,password,ca,prefix='aidot/devices'}){
  const target=new URL(url);
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)||!/^\w+(?:\/\w+)*$/.test(prefix))throw new Error('Invalid MQTT topic scope');
  if(!['mqtt:','mqtts:'].includes(target.protocol)||target.username||target.password||target.pathname.length>1||target.search||target.hash)throw new Error('Use a broker origin URL; pass credentials separately');
  if(target.protocol==='mqtt:'&&!['localhost','127.0.0.1','[::1]'].includes(target.hostname))throw new Error('Remote MQTT requires TLS');
  const scope=`${prefix}/${deviceId}`,bootId=randomUUID();let sequence=0,lastError=null,closed=false;
  const client=mqtt.connect(url,{clientId:`aidot-${deviceId}`,protocolVersion:5,clean:true,keepalive:20,reconnectPeriod:2000,connectTimeout:5000,
    username,password,ca,rejectUnauthorized:true,queueQoSZero:false,resubscribe:false,
    properties:{sessionExpiryInterval:0,maximumPacketSize:16384,receiveMaximum:16},
    will:{topic:scope+'/status',payload:JSON.stringify({deviceId,bootId,online:false}),qos:1,retain:true,properties:{messageExpiryInterval:120}}});
  client.on('error',error=>{lastError=error.code||'MQTT_ERROR';});
  const status=online=>{
    if(client.connected)client.publish(scope+'/status',JSON.stringify({deviceId,bootId,online}),{qos:0,retain:true,properties:{messageExpiryInterval:60}});
  };
  client.on('connect',()=>{lastError=null;status(true);});
  const heartbeat=setInterval(()=>status(true),20000);heartbeat.unref();
  return {
    client,
    state:()=>({connected:client.connected&&!closed,error:lastError,bootId}),
    publish(value){
      if(closed||!client.connected)return false; // No unbounded disconnected telemetry queue.
      const message=JSON.stringify({schema:'aidot.telemetry/v1',deviceId,bootId,sequence:++sequence,at:Date.now(),data:value});
      if(Buffer.byteLength(message)>8192)throw new Error('Telemetry exceeds 8192 bytes');
      if(client.stream?.writableLength>32768)return false;
      client.publish(scope+'/telemetry',message,{qos:0,retain:false,properties:{messageExpiryInterval:10}});return true;
    },
    async close(){
      if(closed)return;closed=true;clearInterval(heartbeat);status(false);
      await new Promise(resolve=>{const timer=setTimeout(()=>{client.end(true);resolve();},2000);client.end(false,{},()=>{clearTimeout(timer);resolve();});});
    },
  };
}
