import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT } from '../src/config.js';

const { values, positionals } = parseArgs({
  options: { empty: { type: 'boolean' }, example: { type: 'string', default: 'original' } },
  allowPositionals: true,
});
if (positionals.length !== 1 || !['original', 'auth', 'simple', 'product'].includes(values.example)) {
  throw new Error('Usage: npm run workspace:init -- /absolute/path [--empty | --example original|auth|simple|product]');
}
if (values.empty && !['original', 'auth'].includes(values.example)) throw new Error('--empty cannot be combined with --example simple or product');
const target = path.resolve(positionals[0]);
const source = path.join(ROOT, values.example === 'product' ? 'examples/product-workspace' : values.example === 'auth' ? 'examples/note-auth-workspace' : 'workspace');
if (target === source) throw new Error('Choose a separate workspace directory');
if (fs.existsSync(target) && fs.readdirSync(target).length) {
  throw new Error('Destination must be empty; existing files are never overwritten');
}
fs.mkdirSync(target, { recursive: true });
for (const group of (values.example === 'product' ? ['controller', 'service', 'sql'] : ['controller', 'service', 'sql', 'migrations'])) {
  if (!values.empty && fs.existsSync(path.join(source, group))) {
    fs.cpSync(path.join(source, group), path.join(target, group), { recursive: true });
  } else fs.mkdirSync(path.join(target, group), { recursive: true });
}
if (!values.empty && fs.existsSync(path.join(source, '.aidot-cache'))) {
  fs.cpSync(path.join(source, '.aidot-cache'), path.join(target, '.aidot-cache'), { recursive: true });
}
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2) + '\n');
console.log('Workspace ready:', target, values.empty ? '(empty)' : `(${values.example})`);
console.log('Set APP_WORKSPACE to this path, or save it in Console > Settings, and restart.');
if (!values.empty && values.example === 'product') console.log('Set DB_MIGRATIONS_DIR=examples/product-database. Product writes require administrator authentication.');
else if (!values.empty) console.log(values.example === 'auth' ? 'All Note CRUD routes require authentication.' : 'All Note CRUD routes are public. Administrator console access requires ID/password.');
