// One-time migration of the old sample_note table. Stop the server first.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const { values } = parseArgs({
  options: { db: { type: 'string' }, from: { type: 'string', default: 'sample_note' }, help: { type: 'boolean' } },
  allowPositionals: false,
});
if (values.help) {
  console.log('Stop the server, then run: node scripts/upgrade-note-table.mjs --db /path/to/app.db [--from custom_note]');
  process.exit(0);
}
if (!values.db) throw new Error('--db must name the existing SQLite database');
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(values.from) || values.from === 'note') {
  throw new Error('--from must be a different, simple SQL table name');
}
const file = path.resolve(values.db);
if (!fs.statSync(file).isFile()) throw new Error('Database file does not exist');
const db = new DatabaseSync(file);
let backup;
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  if (!tables.includes(values.from)) {
    if (tables.includes('note')) {
      console.log(JSON.stringify({ status: 'already-migrated', table: 'note' }));
      process.exitCode = 0;
    } else throw new Error(`Source table ${values.from} does not exist`);
  } else {
    if (tables.includes('note')) throw new Error('Both source and note tables exist; no data was changed. Choose how to merge them manually.');
    const columns = db.prepare(`PRAGMA table_info("${values.from}")`).all();
    for (const name of ['id', 'title', 'body', 'created_at', 'updated_at']) {
      if (!columns.some(c => c.name === name)) throw new Error(`Not a Note table: missing ${name}`);
    }
    // VACUUM INTO captures committed rows, including any WAL contents.
    backup = file + '.before-note-' + randomUUID() + '.bak';
    db.prepare('VACUUM INTO ?').run(backup);
    fs.chmodSync(backup, 0o600);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`ALTER TABLE "${values.from}" RENAME TO "note"`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    console.log(JSON.stringify({ status: 'migrated', from: values.from, table: 'note', backup }));
  }
} finally {
  db.close();
}
