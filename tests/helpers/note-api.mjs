import assert from 'node:assert/strict';

// One HTTP contract is shared by the installed starter and the real Express comparator.
// The fixture starts with the seed note; generated write responses return counts/IDs.
export async function exerciseNote(request) {
  const evidence=[];
  async function call(name,method,url,body,status=200){
    const r=await request(method,url,body);
    assert.equal(r.status,status,name+': '+JSON.stringify(r.body));
    evidence.push({name,...r});
    return r.body;
  }
  let r=await call('List seeded rows','GET','/api/notes');
  assert.equal(r.data.length,1);assert.equal(r.data[0].title,'First note');
  r=await call('Create with generated 201 envelope','POST','/api/notes',{title:'메모 ✓',body:"literal ':id' and <script> stays text",requestCode:'create-note'},201);
  assert.equal(r.code,201);assert.equal(r.message,'Created');assert.equal(r.header.requestCode,'create-note');
  assert.deepEqual(Object.keys(r.data).sort(),['insertId','rowsAffected']);assert.equal(r.data.rowsAffected,1);
  const id=r.data.insertId;assert.ok(Number.isSafeInteger(id));
  r=await call('Read inserted row','GET',`/api/notes/${id}`);assert.equal(r.data.title,'메모 ✓');assert.match(r.data.body,/<script>/);
  r=await call('Full update with path precedence','PUT',`/api/notes/${id}?id=999`,{id:888,title:'수정된 메모',body:null});assert.deepEqual(r.data,{rowsAffected:1});
  r=await call('Read modified row and cleared body','GET',`/api/notes/${id}`);assert.equal(r.data.title,'수정된 메모');assert.equal(r.data.body,null);
  r=await call('fillPlaceholders supplies missing body','PUT',`/api/notes/${id}`,{title:'body 생략'});assert.equal(r.data.rowsAffected,1);
  r=await call('Omitted body becomes SQL NULL','GET',`/api/notes/${id}`);assert.equal(r.data.body,null);
  r=await call('Create with missing optional body','POST','/api/notes',{title:'두 번째'},201);assert.equal(r.data.rowsAffected,1);
  const other=r.data.insertId;
  r=await call('Descending list','GET','/api/notes?requestCode=list-note');assert.equal(r.data[0].id,other);assert.equal(r.header.requestCode,'list-note');
  await call('Missing row is 404','GET','/api/notes/999999',undefined,404);
  r=await call('Missing update returns zero','PUT','/api/notes/999999',{title:'missing',body:null});assert.deepEqual(r.data,{rowsAffected:0});
  r=await call('Delete returns affected count','DELETE',`/api/notes/${other}`);assert.deepEqual(r.data,{rowsAffected:1});
  r=await call('Repeated delete returns zero','DELETE',`/api/notes/${other}`);assert.deepEqual(r.data,{rowsAffected:0});
  await call('Deleted row is 404','GET',`/api/notes/${other}`,undefined,404);
  r=await call('Remaining rows after CRUD','GET','/api/notes');assert.equal(r.data.length,2);assert.equal(r.data[0].title,'body 생략');
  return evidence;
}
