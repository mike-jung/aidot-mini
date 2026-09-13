import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import db from './db.js';
import logger from '../core/logger.js';
import {renderTokens} from '../core/sqlLoader.js';
import {maskSql} from './dialect.js';
export function runMigrations(dir){
  if(!fs.existsSync(dir))return {applied:0,skipped:0,failed:[]};
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (file_name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, elapsed_ms INTEGER, checksum TEXT)');
  if(!db.all('PRAGMA table_info(schema_migrations)').some(c=>c.name==='checksum'))db.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT');
  const done=new Map(db.all('SELECT file_name, checksum FROM schema_migrations').map(r=>[r.file_name,r.checksum]));
  const result={applied:0,skipped:0,failed:[]};
  for(const name of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()){
    const raw=fs.readFileSync(path.join(dir,name),'utf8'),rendered=renderTokens(raw),checksum=createHash('sha256').update(rendered).digest('hex');
    if(done.has(name)){
      if(done.get(name)&&done.get(name)!==checksum)throw new Error(`Migration drift: ${name}; create a new migration instead of editing an applied file`);
      if(!done.get(name)){db.run('UPDATE schema_migrations SET checksum=? WHERE file_name=?',[checksum,name]);logger.warn(`Migration ${name}: legacy checksum baseline adopted`);}
      result.skipped++;continue;
    }
    try{
      const code=maskSql(rendered).text;
      if(/(?:^|;)\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i.test(code))throw new Error('Migration transaction/control statements are not allowed');
      const t=Date.now();
      db.transactionSync(()=>{db.exec(rendered);db.run('INSERT INTO schema_migrations(file_name,elapsed_ms,checksum) VALUES(?,?,?)',[name,Date.now()-t,checksum]);})();
      result.applied++;
    }catch(e){
      if(/^\s*--\s*@migration-options:\s*non-blocking\s*$/m.test(raw)){result.failed.push({file:name,error:e.message});logger.warn(`Optional migration failed: ${name}`);}
      else throw new Error(`Migration failed: ${name}: ${e.message}`,{cause:e});
    }
  }
  return result;
}
export default {runMigrations};
