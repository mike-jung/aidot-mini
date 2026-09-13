import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    workspace: { type: 'string' },
    'base-path': { type: 'string', default: '/api/notes' },
    auth: { type: 'boolean', default: false },
  },
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(values.workspace || process.env.APP_WORKSPACE ||
  path.join(root, values.auth ? 'examples/note-auth-workspace' : 'workspace'));
const api = values['base-path'].replace(/\/$/, '');
assert.match(api, /^\/api\/[A-Za-z0-9/_-]+$/);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-guide-api-'));
const workspace = path.join(temp, 'workspace');
const token = randomBytes(32).toString('hex');
const cases = [];
let child;
let origin;

async function start() {
  let stderr = '';
  child = fork(path.join(root, 'start.js'), [], {
    cwd: root,
    execArgv: [],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: {
      ...process.env,
      ENV_FILE: path.join(temp, 'empty.env'),
      APP_WORKSPACE: workspace,
      DATA_DIR: path.join(temp, 'data'),
      DB_FILE: path.join(temp, 'data', 'test.db'),
      SETTINGS_FILE: path.join(temp, 'data', 'settings.json'),
      ADMIN_ACCOUNT_FILE: path.join(temp, 'data', 'admin-account.json'),
      ADMIN_TOKEN_FILE: path.join(temp, 'data', 'admin-token'),
      ADMIN_TOKEN: token,
      HOST: '127.0.0.1',
      PORT: '0',
      HTTPS_ENABLED: 'false',
      MANAGED_ENDPOINT: 'false',
      LOG_TO_FILE: 'false',
      LOG_LEVEL: 'error',
    },
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout: ' + stderr)), 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error('Server exited: ' + code + '\n' + stderr));
    });
    child.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(message.port); }
    });
  });
  origin = 'http://127.0.0.1:' + port;
}

async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const target = child;
  await new Promise(resolve => {
    const timer = setTimeout(() => target.kill('SIGKILL'), 5000);
    target.once('exit', () => { clearTimeout(timer); resolve(); });
    if (target.connected) target.send({ type: 'aidot:shutdown' });
    else target.kill('SIGTERM');
  });
}

async function request(name, method, url, body, status = 200, authorized = values.auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (authorized) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(origin + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  assert.equal(response.status, status, name + ': ' + JSON.stringify(result));
  assert.equal(result.code, status, name + ': response code');
  cases.push(name);
  return result;
}

try {
  fs.writeFileSync(path.join(temp, 'empty.env'), '');
  fs.mkdirSync(workspace);
  for (const folder of ['controller', 'service', 'sql', 'migrations']) {
    fs.cpSync(path.join(source, folder), path.join(workspace, folder), {
      recursive: true,
      filter: file => path.basename(file) !== 'meta',
    });
  }
  fs.writeFileSync(path.join(workspace, 'package.json'), '{"type":"module","private":true}\n');
  await start();
  const generated = await request('Metadata generated and loaded', 'GET',
    '/admin/metadata', undefined, 200, true);
  const records = [...generated.data.controllers, ...generated.data.services];
  assert.ok(records.length >= 2);
  const metadataBytes = new Map();
  for (const record of records) {
    assert.equal(record.status, 'generated');
    assert.equal(record.metadata._version, 2);
    assert.ok(record.file.startsWith(workspace + path.sep));
    const bytes = fs.readFileSync(record.file, 'utf8');
    assert.deepEqual(JSON.parse(bytes), record.metadata);
    metadataBytes.set(record.file, bytes);
  }

  if (values.auth) {
    for (const [method, suffix, body] of [
      ['GET', '', undefined], ['GET', '/1', undefined],
      ['POST', '', { title: 'Denied', body: null }],
      ['PUT', '/1', { title: 'Denied', body: null }], ['DELETE', '/1', undefined],
    ]) {
      await request('Anonymous rejected: ' + method + suffix, method, api + suffix, body, 401, false);
    }
  }

  // This payload contract belongs to the Note example. Change both data and assertions for another API.
  let result = await request('List', 'GET', api);
  assert.ok(Array.isArray(result.data));
  const initialCount = result.data.length;
  result = await request('Create', 'POST', api, {
    title: 'AI sample', body: "한국어 and SQL text ':id'", requestCode: 'guide-create',
  }, 201);
  assert.equal(result.message, 'Created');
  assert.equal(result.header.requestCode, 'guide-create');
  assert.equal(result.data.rowsAffected, 1);
  const id = result.data.insertId;
  assert.ok(Number.isSafeInteger(id) && id > 0);
  assert.deepEqual(Object.keys(result.data).sort(), ['insertId', 'rowsAffected']);
  const rowUrl = api + '/' + id;
  result = await request('Read created row', 'GET', rowUrl);
  assert.equal(result.data.title, 'AI sample');
  assert.equal(result.data.body, "한국어 and SQL text ':id'");

  result = await request('Update; path ID wins', 'PUT', rowUrl + '?id=999999', {
    id: 888888, title: 'Changed', body: null,
  });
  assert.deepEqual(result.data, { rowsAffected: 1 });
  result = await request('Read updated row', 'GET', rowUrl);
  assert.equal(result.data.title, 'Changed');
  assert.equal(result.data.body, null);
  result = await request('Omit optional body', 'PUT', rowUrl, { title: 'Persisted' });
  assert.deepEqual(result.data, { rowsAffected: 1 });
  result = await request('Omitted body becomes NULL', 'GET', rowUrl);
  assert.equal(result.data.body, null);

  await stop();
  await start();
  const reloaded = await request('Metadata reloaded without rewriting', 'GET',
    '/admin/metadata', undefined, 200, true);
  for (const record of [...reloaded.data.controllers, ...reloaded.data.services]) {
    assert.equal(record.status, 'loaded');
    assert.equal(fs.readFileSync(record.file, 'utf8'), metadataBytes.get(record.file));
  }
  result = await request('Persisted after restart', 'GET', rowUrl);
  assert.equal(result.data.title, 'Persisted');
  assert.equal(result.data.body, null);
  result = await request('List after create', 'GET', api + '?requestCode=guide-list');
  assert.equal(result.data.length, initialCount + 1);
  assert.equal(result.header.requestCode, 'guide-list');
  assert.equal(result.data[0].id, id);

  result = await request('Delete', 'DELETE', rowUrl);
  assert.deepEqual(result.data, { rowsAffected: 1 });
  await request('Deleted row is 404', 'GET', rowUrl, undefined, 404);
  result = await request('Repeat delete returns zero', 'DELETE', rowUrl);
  assert.deepEqual(result.data, { rowsAffected: 0 });
  result = await request('Update deleted row returns zero', 'PUT', rowUrl, { title: 'Missing', body: null });
  assert.deepEqual(result.data, { rowsAffected: 0 });
  result = await request('List restored', 'GET', api);
  assert.equal(result.data.length, initialCount);
  await request('Admin metadata stays protected', 'GET', '/admin/metadata', undefined, 401, false);
  console.log(JSON.stringify({ passed: cases.length, auth: values.auth, api, cases }, null, 2));
} finally {
  await stop();
  fs.rmSync(temp, { recursive: true, force: true });
}
