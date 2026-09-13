import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {EventStream} from '../src/core/events.js';

test('SSE resumes bounded history, resets unknown cursor and rechecks revocation',async()=>{
  let authorized=true;
  const stream=new EventStream({authorized:()=>authorized,snapshot:()=>({ready:true}),historySize:2,heartbeatMs:40});
  const server=http.createServer((req,res)=>{try{stream.open(req,res);}catch(e){res.writeHead(e.status);res.end();}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
  try{
    const id=stream.publish('status',{n:1});stream.publish('status',{n:2});
    const response=await fetch(url,{headers:{'Last-Event-ID':id}});const reader=response.body.getReader();
    let data=new TextDecoder().decode((await reader.read()).value);assert.match(data,/"n":2/);assert.doesNotMatch(data,/"n":1/);
    authorized=false;const next=await reader.read();assert.equal(next.done,true);
    authorized=true;stream.publish('status',{n:3});
    const reset=await fetch(url,{headers:{'Last-Event-ID':id}});const resetReader=reset.body.getReader();
    assert.match(new TextDecoder().decode((await resetReader.read()).value),/event: reset/);await resetReader.cancel();
    const invalid=await fetch(url,{headers:{'Last-Event-ID':'invalid'}});assert.equal(invalid.status,400);
    assert.throws(()=>stream.publish('status',{text:'a'.repeat(5000)}));
  }finally{stream.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('SSE drops slow clients and handles close without writing again',()=>{
  const stream=new EventStream({authorized:()=>true,snapshot:()=>({})});let writes=0;
  const response={writableLength:0,write(){writes++;return false;},destroy(){this.destroyed=true;}};
  const client={req:{},res:response};assert.equal(stream.send(client,'frame'),false);assert.equal(response.destroyed,true);
  assert.equal(stream.send(client,'frame'),false);assert.equal(writes,1);
  assert.throws(()=>stream.publish('bad\nevent',{}));assert.throws(()=>stream.publish('status',undefined));stream.close();
});

test('SSE connection limits reject excess clients before headers',async()=>{
  const stream=new EventStream({authorized:()=>true,snapshot:()=>({}),maxPerAddress:1});
  const server=http.createServer((req,res)=>{try{stream.open(req,res);}catch(e){res.writeHead(e.status);res.end();}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
  try{
    const first=await fetch(url);assert.equal(first.status,200);
    const second=await fetch(url);assert.equal(second.status,429);await first.body.cancel();
  }finally{stream.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
