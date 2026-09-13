import test from 'node:test';
import assert from 'node:assert/strict';
import {mapAppSchema} from '../src/database/app-schema.js';
import {DatabaseSync} from 'node:sqlite';

test('Configured schema mapping preserves literals, comments and column aliases',()=>{
  const sql="SELECT aidot_app.name, 'aidot_app.snack', 'FROM aidot_app.snack' FROM `aidot_app`.`snack` AS aidot_app -- aidot_app.snack\n WHERE memo = :memo";
  assert.equal(mapAppSchema(sql,'aidot_app'),sql.replace('FROM `aidot_app`.`snack`','FROM main.`snack`'));
  assert.equal(mapAppSchema('SELECT * FROM other.snack','aidot_app'),'SELECT * FROM other.snack');
  assert.equal(mapAppSchema('SELECT * FROM aidot_app.snack',''),'SELECT * FROM aidot_app.snack');
});

test('Schema mapping executes CRUD, joins, nested queries and three-part columns in one SQLite database',()=>{
  const db=new DatabaseSync(':memory:');
  const run=sql=>db.exec(mapAppSchema(sql,'aidot_app'));
  const get=sql=>db.prepare(mapAppSchema(sql,'aidot_app')).get();
  try {
    run('CREATE TABLE IF NOT EXISTS aidot_app.snack(id INTEGER PRIMARY KEY, name TEXT, memo TEXT); CREATE TABLE aidot_app.extra(id INTEGER PRIMARY KEY);');
    run("INSERT INTO aidot_app.snack VALUES(1,'before',NULL); INSERT INTO aidot_app.extra VALUES(1);");
    run("UPDATE aidot_app.snack SET name='after' WHERE id=1;");
    assert.equal(get('SELECT aidot_app.snack.name FROM aidot_app.snack').name,'after');
    assert.equal(get('SELECT s.name FROM aidot_app.snack s JOIN aidot_app.extra e ON s.id=e.id').name,'after');
    assert.equal(get('SELECT s.name FROM aidot_app.snack s, aidot_app.extra e WHERE s.id=e.id').name,'after');
    assert.equal(get('SELECT name FROM (SELECT * FROM aidot_app.snack) q').name,'after');
    assert.equal(get('SELECT name FROM "AIDOT_APP" . "snack"').name,'after');
    assert.equal(db.prepare('PRAGMA database_list').all().length,1);
    assert.throws(()=>get('SELECT * FROM other.snack'),/no such table/);
    run('DELETE FROM aidot_app.snack; DROP TABLE IF EXISTS aidot_app.extra;');
    assert.equal(get('SELECT COUNT(*) n FROM aidot_app.snack').n,0);
  } finally {db.close();}
});
