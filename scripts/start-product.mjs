import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = process.env.ENV_FILE
  ? path.resolve(process.env.ENV_FILE)
  : path.join(root, '.env');
// Load overrides before importing config; config is cached by the module loader.
if (fs.existsSync(envFile)) {
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(envFile, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
process.env.APP_WORKSPACE ??= path.join(root, 'examples/product-workspace');
process.env.DB_MIGRATIONS_DIR ??= path.join(root, 'examples/product-database');
process.env.DATA_DIR ??= path.join(root, 'data/product-demo');

if (process.argv.includes('--account')) {
  process.argv = [process.argv[0], path.join(root, 'scripts', 'admin-account.mjs'), ...process.argv.slice(2).filter(x => x !== '--account')];
  await import('./admin-account.mjs');
} else {
  const { main } = await import('../start.js');
  await main();
}
