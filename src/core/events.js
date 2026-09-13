import {randomBytes} from 'node:crypto';

/** Short reconnect history, not a durable business event log. */
export class EventStream {
  constructor({authorized,snapshot,maxClients=32,maxPerAddress=4,historySize=64,heartbeatMs=10000}){
    Object.assign(this,{authorized,snapshot,maxClients,maxPerAddress,historySize,heartbeatMs});
    this.clients=new Set();this.history=[];this.epoch=randomBytes(8).toString('hex');this.sequence=0;this.closed=false;
  }
  frame(event,value,id){
    if(!/^[a-z][a-z0-9_.-]{0,63}$/.test(event))throw new Error('Invalid event name');
    const data=JSON.stringify(value);if(data===undefined||Buffer.byteLength(data)>4096)throw new Error('Event must contain JSON of at most 4096 bytes');
    return `${id?'id: '+id+'\n':''}event: ${event}\ndata: ${data}\n\n`;
  }
  send(client,frame){
    if(client.res.destroyed||client.res.writableEnded)return false;
    if(!this.authorized(client.req)||client.res.writableLength>65536){client.res.end();return false;}
    if(!client.res.write(frame)){client.res.destroy();return false;}
    return true;
  }
  publish(event,value){
    if(this.closed)return;
    const id=`${this.epoch}:${this.sequence+1}`,frame=this.frame(event,value,id);this.sequence++;
    this.history.push({id,frame});if(this.history.length>this.historySize)this.history.shift();
    for(const client of this.clients)this.send(client,frame);
    return id;
  }
  open(req,res){
    const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
    if(this.closed)fail(503,'Event stream is stopping');
    const address=req.socket.remoteAddress;
    if(this.clients.size>=this.maxClients||[...this.clients].filter(c=>c.address===address).length>=this.maxPerAddress)fail(429,'Too many event streams');
    const cursor=req.headers['last-event-id'];
    if(cursor&&(!/^[a-f0-9]{16}:[1-9][0-9]{0,15}$/.test(cursor)))fail(400,'Invalid event cursor');
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'});
    if(req.method==='HEAD'){res.end();return;}
    res.setTimeout(0);res.flushHeaders();
    const client={req,res,address};this.clients.add(client);
    const close=()=>{clearInterval(client.timer);this.clients.delete(client);};res.once('close',close);res.on('error',close);
    this.send(client,'retry: 3000\n\n');
    if(cursor){
      const found=this.history.findIndex(row=>row.id===cursor);
      if(found<0)this.send(client,this.frame('reset',{reason:'history-unavailable',refresh:'/admin/status'}));
      else for(const row of this.history.slice(found+1))if(!this.send(client,row.frame))break;
    }
    this.send(client,this.frame('status',this.snapshot()));
    if(!res.destroyed&&!res.writableEnded){client.timer=setInterval(()=>{this.send(client,': heartbeat\n\n');},this.heartbeatMs);client.timer.unref();}
  }
  close(){this.closed=true;for(const client of this.clients){clearInterval(client.timer);client.res.end();}this.clients.clear();this.history=[];}
}
