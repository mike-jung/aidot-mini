import path from 'node:path';
import fs from 'node:fs';
import {parseArgs} from 'node:util';
import config from '../src/config.js';
import db from '../src/database/db.js';
import {runMigrations} from '../src/database/migrationRunner.js';
const {values}=parseArgs({options:{dir:{type:'string'}},allowPositionals:false});
const dir=path.resolve(values.dir||config.paths.migrations);
if(!fs.existsSync(dir)||!fs.statSync(dir).isDirectory())throw new Error('Migration directory not found: '+dir);
try {
  db.initDb();
  console.log(JSON.stringify({database:db.file(),migrations:dir,...runMigrations(dir)}));
} finally {await db.closeDb();}
