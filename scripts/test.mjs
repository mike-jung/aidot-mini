import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'aidot-test-env-'));
const env={...process.env};
for(const key of Object.keys(env))if(/^(APP_|DB_|ADMIN_|LOG_|CONSOLE_|TLS_|HTTPS_|ROBOT_|ROBATON_|TRACE_|AIDOT_)|^(DATA_DIR|SETTINGS_FILE|ENV_FILE|HOST|PORT|MANAGED_ENDPOINT|ALLOWED_HOSTS)$/.test(key))delete env[key];
env.ENV_FILE=path.join(temporary,'empty.env');fs.writeFileSync(env.ENV_FILE,'');
env.APP_WORKSPACE=path.join(root,'examples/note-auth-workspace');
env.DATA_DIR=temporary;env.LOG_TO_FILE='false';env.LOG_LEVEL='error';
const files=fs.readdirSync(path.join(root,'tests')).filter(p=>p.endsWith('.test.mjs')).map(p=>'tests/'+p);
try{
  const r=spawnSync(process.execPath,['--test','--test-concurrency=1',...process.argv.slice(2),...files],{cwd:root,env,stdio:'inherit'});
  process.exitCode=r.status??1;
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
