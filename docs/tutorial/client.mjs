// Exercises only the note it creates. Existing user rows are left intact.
import assert from 'node:assert/strict';
const base=process.env.TUTORIAL_BASE_URL||'http://127.0.0.1:8901';
async function call(method,url,body){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(process.env.TUTORIAL_TOKEN?{Authorization:'Bearer '+process.env.TUTORIAL_TOKEN}:{})},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw new Error(JSON.stringify(value));return value;}
const created=await call('POST','/api/notes',{title:'Tutorial note',body:'Created through the API'});
const id=created.data.insertId;assert.ok(id>0);
try{
 assert.equal((await call('GET','/api/notes/'+id)).data.title,'Tutorial note');
 assert.deepEqual((await call('PUT','/api/notes/'+id,{title:'Updated tutorial',body:null})).data,{rowsAffected:1});
 const saved=(await call('GET','/api/notes/'+id)).data;assert.equal(saved.title,'Updated tutorial');assert.equal(saved.body,null);
 console.log('Note create/read/update passed, id='+id);
}finally{assert.equal((await call('DELETE','/api/notes/'+id)).data.rowsAffected,1);console.log('Created tutorial note deleted.');}
