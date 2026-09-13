import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(process.argv[2]||'.');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
if(process.platform!=='linux'||process.arch!==manifest.arch)throw new Error('This package does not match the host CPU/OS');
for(const [name,expected] of Object.entries(manifest.files)){
  const file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep)||fs.lstatSync(file).isSymbolicLink())throw new Error('Invalid package path');
  const hash=createHash('sha256');
  for await(const chunk of fs.createReadStream(file,{highWaterMark:1024*1024}))hash.update(chunk);
  if(hash.digest('hex')!==expected)throw new Error(`Package checksum mismatch: ${name}`);
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aidot-install-'));
try{
  const db=new DatabaseSync(path.join(dir,'probe.db'));
  try{db.exec('CREATE TABLE probe(value TEXT)');const value=randomBytes(16).toString('hex');db.prepare('INSERT INTO probe VALUES (?)').run(value);if(db.prepare('SELECT value FROM probe').get().value!==value)throw new Error('SQLite probe failed');}finally{db.close();}
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log(JSON.stringify({status:'passed',version:manifest.version,node:process.version,arch:process.arch,glibc:process.report.getReport().header.glibcVersionRuntime,verifiedFiles:Object.keys(manifest.files).length,sqlite:'passed',crypto:'passed'}));
