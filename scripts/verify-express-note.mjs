import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const miniRoot = process.env.MINI_PROJECT_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expressRoot = process.env.EXPRESS_PROJECT_ROOT;
if (!expressRoot) throw new Error('Set EXPRESS_PROJECT_ROOT to the supplied aidot-express 1.45.8 directory.');
const files = ['controller/NoteController.js', 'service/NoteService.js', 'sql/note.sql'];
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const results = [];

for (const authenticated of [false, true]) {
  const source = path.join(miniRoot, authenticated ? 'examples/note-auth-workspace' : 'workspace');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-express-note-'));
  const workspace = path.join(temp, 'external workspace');
  const migrations = path.join(temp, 'external migrations');
  const password = randomBytes(24).toString('base64url');
  const hashes = Object.fromEntries(files.map(file => [file, digest(path.join(source, file))]));
  let child, origin, token, requests = 0, output = '';
  fs.mkdirSync(migrations, { recursive: true });
  fs.copyFileSync(path.join(miniRoot, 'docs/note-sqlite.sql'), path.join(migrations, '901_note_contract.sql'));
  for (const file of files) {
    const target = path.join(workspace, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, file), target);
  }
  const envFile = path.join(temp, '.env');
  // Deliberately configure workspace only through .env, exercising the loader boundary.
  fs.writeFileSync(envFile, `APP_WORKSPACE=${workspace}\n`);
  const env = {
    ...process.env, AIDOT_ENV_FILE: envFile, DB_MIGRATIONS_DIR: migrations,
    DB_TYPE: 'sqlite', DB_FILE: path.join(temp, 'data/test.db'),
    DB_APP_SCHEMA: '', DB_SAMPLES: 'false', DB_SAMPLE_SCHEMA_SEPARATE: 'false',
    PUBLIC_DIR: path.join(temp, 'public'), LOG_DIR: path.join(temp, 'log'),
    ADMIN_INITIAL_USERNAME: 'note-tester', ADMIN_INITIAL_PASSWORD: password,
    AUTH_ACCESS_SECRET: randomBytes(48).toString('hex'), AUTH_COOKIE_SECURE: 'false',
    HOST: '127.0.0.1', PORT: '0', HTTPS_ENABLED: 'false', LOG_LEVEL: 'error',
    NODE_ENV: 'test', MCI_ENABLED: 'false', HA_ENABLED: 'false', SECURE_ENABLED: 'false',
  };
  delete env.APP_WORKSPACE;
  const entry = path.join(temp, 'server.mjs');
  fs.writeFileSync(entry, `import {createServer} from ${JSON.stringify(pathToFileURL(path.join(expressRoot, 'src/server.js')).href)};
const app = await createServer();
const server = app.listen(0, '127.0.0.1', () => process.send({type:'ready',port:server.address().port}));
process.on('message', message => { if(message?.type === 'aidot:shutdown') server.close(() => process.exit(0)); });`);
  async function start() {
    child = fork(entry, [], { cwd: expressRoot, env,
      execArgv: ['--import', path.join(expressRoot, 'src/loader/register.mjs')],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-12000); });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timeout\n' + output)), 30000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Exit ${code}\n${output}`)); });
      child.on('message', message => { if (message.type === 'ready') { clearTimeout(timer); resolve(message.port); } });
    });
    origin = `http://127.0.0.1:${port}`;
    const login = await request('POST', '/api/admin/auth/login', { username: 'note-tester', password }, 200, false);
    token = login.data.accessToken;
    assert.ok(token);
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const target = child;
    await new Promise(resolve => {
      const timer = setTimeout(() => target.kill('SIGKILL'), 5000);
      target.once('exit', () => { clearTimeout(timer); resolve(); });
      target.send({ type: 'aidot:shutdown' });
    });
  }
  async function request(method, route, body, status = 200, auth = authenticated) {
    const response = await fetch(origin + route, {
      method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(result)}`);
    assert.equal(result.code, status);
    requests++;
    return result;
  }
  try {
    await start();
    if (authenticated) {
      for (const [method, suffix, body] of [
        ['GET', '', undefined], ['GET', '/1', undefined], ['POST', '', { title: 'Denied' }],
        ['PUT', '/1', { title: 'Denied' }], ['DELETE', '/1', undefined],
      ]) await request(method, '/api/notes' + suffix, body, 401, false);
    }
    const initial = (await request('GET', '/api/notes')).data.length;
    const created = await request('POST', '/api/notes', { title: 'Portable Note', body: "한글 ':id'", requestCode: 'note-copy' }, 201);
    assert.equal(created.header.requestCode, 'note-copy');
    assert.equal(created.data.rowsAffected, 1);
    const id = created.data.insertId;
    const url = '/api/notes/' + id;
    assert.equal((await request('GET', url)).data.body, "한글 ':id'");
    assert.deepEqual((await request('PUT', url + '?id=99999', { id: 99998, title: 'Changed', body: null })).data, { rowsAffected: 1 });
    assert.equal((await request('GET', url)).data.title, 'Changed');
    assert.deepEqual((await request('PUT', url, { title: 'Persisted' })).data, { rowsAffected: 1 });
    assert.equal((await request('GET', url)).data.body, null);
    await stop();
    await start();
    assert.equal((await request('GET', url)).data.title, 'Persisted');
    assert.equal((await request('GET', '/api/notes')).data.length, initial + 1);
    assert.deepEqual((await request('DELETE', url)).data, { rowsAffected: 1 });
    await request('GET', url, undefined, 404);
    assert.deepEqual((await request('PUT', url, { title: 'Missing', body: null })).data, { rowsAffected: 0 });
    assert.deepEqual((await request('DELETE', url)).data, { rowsAffected: 0 });
    assert.equal((await request('GET', '/api/notes')).data.length, initial);
    for (const file of files) {
      assert.equal(digest(path.join(source, file)), hashes[file]);
      assert.equal(digest(path.join(workspace, file)), hashes[file]);
    }
    results.push({ authenticated, requests, result: 'PASS', sourceHashes: hashes });
  } finally {
    await stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ host: 'aidot-express', version: '1.45.8', database: 'SQLite', externalWorkspace: true, dotenvOnlyWorkspace: true, sourceRewrites: false, results }, null, 2));
