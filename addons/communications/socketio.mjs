import {Server} from 'socket.io';

async function bounded(task){
  let timer;
  try{return await Promise.race([Promise.resolve().then(task),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Channel callback timed out')),2000);})]);}
  finally{clearTimeout(timer);}
}

/** Optional read-side channel. Mutating orders use the durable robot API/adapter contract. */
export function socketTelemetry({server,origins,authorize,snapshot,maxClients=32}){
  if(!Array.isArray(origins)||!origins.length||typeof authorize!=='function'||typeof snapshot!=='function')throw new Error('Explicit origins, authorization and snapshot are required');
  const allowed=new Set(origins.map(value=>new URL(value).origin));
  const io=new Server(server,{serveClient:false,transports:['websocket'],maxHttpBufferSize:16384,connectTimeout:5000,
    perMessageDeflate:false,allowRequest:(req,done)=>{
      let accepted=false;
      try{const origin=new URL(req.headers.origin);accepted=allowed.has(origin.origin)&&origin.host===req.headers.host;}catch{}
      done(null,accepted&&io.engine.clientsCount<maxClients);
    }});
  io.use(async(socket,next)=>{
    try{const principal=await bounded(()=>authorize(socket.handshake.auth,socket.request));if(!principal?.id)return next(new Error('Authentication required'));socket.data.principal=principal;next();}
    catch{next(new Error('Authentication required'));}
  });
  io.on('connection',socket=>{
    let busy=false;
    socket.on('snapshot',async(reply)=>{
      if(typeof reply!=='function')return;
      if(busy)return reply({error:'Request already pending'});busy=true;
      try{
        const principal=await bounded(()=>authorize(socket.handshake.auth,socket.request));
        if(!principal?.id){socket.disconnect(true);return;}
        const data=await bounded(()=>snapshot(principal));
        if(Buffer.byteLength(JSON.stringify(data))>8192)throw new Error('Snapshot exceeds 8192 bytes');
        reply({data});
      }catch{reply({error:'Snapshot unavailable'});}finally{busy=false;}
    });
  });
  let checking=false,publishing=false;
  const recheck=setInterval(async()=>{
    if(checking)return;checking=true;
    try{
    for(const socket of io.sockets.sockets.values()){
      try{if(!(await bounded(()=>authorize(socket.handshake.auth,socket.request)))?.id)socket.disconnect(true);}catch{socket.disconnect(true);}
    }
    }finally{checking=false;}
  },10000);recheck.unref();
  return {
    io,
    async publish(value){
      if(Buffer.byteLength(JSON.stringify(value))>8192)throw new Error('Telemetry exceeds 8192 bytes');
      if(publishing)return false;publishing=true;
      try{
      for(const socket of io.sockets.sockets.values()){
        try{if((await bounded(()=>authorize(socket.handshake.auth,socket.request)))?.id)socket.volatile.emit('telemetry',value);else socket.disconnect(true);}catch{socket.disconnect(true);}
      }
      return true;
      }finally{publishing=false;}
    },
    close(){clearInterval(recheck);return new Promise(resolve=>io.close(resolve));},
  };
}
