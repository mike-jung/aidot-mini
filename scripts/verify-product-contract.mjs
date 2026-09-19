import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The same suite runs against mini or an independently installed, patched Express.
// Only three business files are copied; imports, decorators and SQL are never rewritten.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expressRoot = process.env.EXPRESS_PROJECT_ROOT
  ? path.resolve(process.env.EXPRESS_PROJECT_ROOT)
  : null;
const host = expressRoot ? 'aidot-express' : 'aidot-mini';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-product-contract-'));
const workspace = path.join(temp, 'external workspace');
const migrations = path.join(temp, 'external migrations');
const files = [
  'controller/ProductController.js',
  'service/ProductService.js',
  'sql/product.sql',
];
const password = randomBytes(24).toString('base64url');
const token = randomBytes(32).toString('hex');
const env = {
  ...process.env,
  ENV_FILE: path.join(temp, 'empty.env'),
  AIDOT_ENV_FILE: path.join(temp, 'empty.env'),
  APP_WORKSPACE: workspace,
  DB_MIGRATIONS_DIR: migrations,
  DATA_DIR: path.join(temp, 'data'),
  DB_TYPE: 'sqlite',
  DB_FILE: path.join(temp, 'data/contract.db'),
  DB_APP_SCHEMA: '',
  DB_SAMPLES: 'false',
  DB_SAMPLE_SCHEMA_SEPARATE: 'false',
  SETTINGS_FILE: path.join(temp, 'settings.json'),
  ADMIN_ACCOUNT_FILE: path.join(temp, 'account.json'),
  ADMIN_TOKEN_FILE: path.join(temp, 'token'),
  ADMIN_TOKEN: token,
  ADMIN_INITIAL_USERNAME: 'contract-admin',
  ADMIN_INITIAL_PASSWORD: password,
  AUTH_ACCESS_SECRET: randomBytes(48).toString('hex'),
  AUTH_COOKIE_SECURE: 'false',
  PUBLIC_DIR: path.join(temp, 'public'),
  HOST: '127.0.0.1',
  PORT: '0',
  HTTPS_ENABLED: 'false',
  MANAGED_ENDPOINT: 'false',
  LOG_TO_FILE: 'false',
  LOG_LEVEL: 'error',
  NODE_ENV: 'test',
};
let child;
let origin;
let authToken = token;
let requests = 0;
let checks = 0;
let startupLog = '';
const failures = [];
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceHashes = Object.fromEntries(
  files.map((file) => [file, sha256(path.join(root, 'examples/product-workspace', file))]),
);

async function check(name, action) {
  try {
    await action();
    checks++;
  } catch (error) {
    failures.push({ name, message: error.message });
    console.error(`[${host}] FAIL ${name}: ${error.message}`);
  }
}

async function request(url, { method = 'GET', body, status = 200, auth = false, bearer } = {}) {
  const headers = {};
  if (auth || bearer) headers.Authorization = `Bearer ${bearer || authToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(origin + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  requests++;
  assert.equal(response.status, status, `${method} ${url}: ${text.slice(0, 600)}`);
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    assert.fail(`${method} ${url} returned non-JSON: ${text.slice(0, 300)}`);
  }
  assert.equal(result.code, status, `${method} ${url} envelope code`);
  return result;
}

async function start() {
  startupLog = '';
  const script = expressRoot ? path.join(temp, 'express.mjs') : path.join(root, 'start.js');
  if (expressRoot) {
    fs.writeFileSync(script, `import { createServer } from ${JSON.stringify(pathToFileURL(path.join(expressRoot, 'src/server.js')).href)};
const app = await createServer();
const server = app.listen(0, '127.0.0.1', () => process.send({ type: 'ready', port: server.address().port }));
process.on('message', value => { if (value?.type === 'aidot:shutdown') server.close(() => process.exit(0)); });
`);
  }
  child = fork(script, [], {
    cwd: expressRoot || root,
    env,
    execArgv: expressRoot ? ['--import', path.join(expressRoot, 'src/loader/register.mjs')] : [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (bytes) => { startupLog = (startupLog + bytes).slice(-16000); });
  }
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Startup timeout\n${startupLog}`)), 40000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Startup exited ${code}\n${startupLog}`));
    });
    child.on('message', (message) => {
      if (message?.type === 'ready') {
        clearTimeout(timer);
        resolve(message.port);
      }
    });
  });
  origin = `http://127.0.0.1:${port}`;
  if (expressRoot) {
    const login = await request('/api/admin/auth/login', {
      method: 'POST',
      body: { username: 'contract-admin', password },
    });
    authToken = login.data.accessToken;
    assert.ok(authToken);
  }
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.send({ type: 'aidot:shutdown' });
  });
}

function database(action) {
  const db = new DatabaseSync(env.DB_FILE);
  try { return action(db); } finally { db.close(); }
}

function unchangedSources() {
  for (const file of files) {
    assert.equal(sha256(path.join(workspace, file)), sourceHashes[file], `${file} was rewritten`);
    assert.equal(sha256(path.join(root, 'examples/product-workspace', file)), sourceHashes[file]);
  }
}

try {
  fs.writeFileSync(env.ENV_FILE, '');
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  for (const file of files) {
    const destination = path.join(workspace, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, 'examples/product-workspace', file), destination);
  }
  fs.cpSync(path.join(root, 'examples/product-database'), migrations, { recursive: true });
  fs.writeFileSync(path.join(migrations, 'sqlite/999_contract_marker.sql'),
    "CREATE TABLE contract_migration_marker (applied INTEGER NOT NULL);\nINSERT INTO contract_migration_marker VALUES (1);\n");

  await start();
  await check('external migrations are selected', () => database((db) => {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM demo_product').get().n, 24);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contract_migration_marker').get().n, 1);
  }));
  await check('startup preserves the three business file hashes', unchangedSources);

  const marker = 'contract-ties-한글-!%_';
  const ids = [];
  for (let index = 0; index < 7; index++) {
    const created = await request('/api/product?requestCode=query-code&name=ignored-query-name', {
      method: 'POST', auth: true, status: 201,
      body: { name: '동일 상품', price: 31415, memo: marker, requestCode: 'body-code' },
    });
    assert.equal(created.header.requestCode, 'body-code');
    assert.equal(created.data.rowsAffected, 1);
    ids.push(created.data.insertId);
  }

  for (const [sort, expected] of [
    ['name', ids], ['priceAsc', ids], ['priceDesc', [...ids].reverse()], ['newest', [...ids].reverse()],
  ]) {
    await check(`stable ${sort} ties across page boundaries`, async () => {
      const actual = [];
      for (let page = 1; page <= 4; page++) {
        const result = await request(`/api/product/paged?q=${encodeURIComponent(marker)}&sort=${sort}&perPage=2&page=${page}`);
        assert.equal(result.header.total, 7);
        assert.equal(result.header.totalPages, 4);
        actual.push(...result.data.map((row) => row.id));
      }
      assert.deepEqual(actual, expected);
    });
  }

  // Both hosts deliberately collapse repeated scalar query keys to the last value.
  for (const query of ['page=1&page=2', 'perPage=2&perPage=3', 'q=a&q=b', 'sort=newest&sort=name']) {
    await check(`repeated scalar query uses its last value: ${query}`, async () => {
      const repeated = await request(`/api/product/paged?${query}`);
      const scalar = await request(`/api/product/paged?${query.split('&').at(-1)}`);
      assert.deepEqual(repeated.data, scalar.data);
      for (const key of ['page', 'perPage', 'total', 'totalPages']) {
        assert.equal(repeated.header[key], scalar.header[key]);
      }
    });
  }

  const [target, decoy, other] = ids;
  await check('GET path id wins over query id', async () => {
    assert.equal((await request(`/api/product/${target}?id=${decoy}`)).data.id, target);
  });
  await check('PUT path id wins; body values win over query values', async () => {
    await request(`/api/product/${target}?id=${decoy}&name=query&price=1`, {
      method: 'PUT', auth: true,
      body: { id: other, name: 'body-wins', price: 2718, memo: marker },
    });
    const actual = (await request(`/api/product/${target}`)).data;
    assert.equal(actual.name, 'body-wins');
    assert.equal(actual.price, 2718);
    for (const id of [decoy, other]) assert.equal((await request(`/api/product/${id}`)).data.name, '동일 상품');
  });

  for (const invalidId of ['0', '-1', '01', '1.0', '1e0', '+1', ' 1', '1 ', 'null', 'abc', '9007199254740992']) {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      await check(`${method} rejects id ${JSON.stringify(invalidId)} even with a valid query id`, () =>
        request(`/api/product/${encodeURIComponent(invalidId)}?id=${target}`, {
          method, auth: method !== 'GET', status: 400,
          ...(method === 'PUT' ? { body: { id: target, name: 'must-not-write', price: 1 } } : {}),
        }));
    }
  }

  for (const body of [null, [], [{}], 'text', 7, true,
    { name: null, price: 1 }, { name: ['name'], price: 1 },
    { name: 'name', price: '1' }, { name: 'name', price: null },
    { name: 'name', price: 1.5 }, { name: 'name', price: 1000001 },
    { name: 'name', price: 1, memo: [] }, { name: 'name', price: 1, memo: 'x'.repeat(501) },
    { name: 'name', price: 1, imagePath: [] },
  ]) {
    for (const method of ['POST', 'PUT']) {
      await check(`${method} rejects payload ${JSON.stringify(body).slice(0, 80)}`, () =>
        request(`/api/product${method === 'PUT' ? `/${target}` : ''}`, { method, auth: true, body, status: 400 }));
    }
  }

  for (const method of ['POST', 'PUT', 'DELETE']) {
    const url = `/api/product${method === 'POST' ? '' : `/${target}`}`;
    for (const bearer of [undefined, 'invalid-contract-token']) {
      await check(`${method} rejects ${bearer ? 'invalid' : 'missing'} administrator credentials`, () =>
        request(url, { method, bearer, body: { name: 'must-not-write', price: 1 }, status: 401 }));
    }
  }

  if (expressRoot) {
    // A console account can have realm=admin without role=admin. Exercise real login
    // and current-account verification rather than manufacturing a signed JWT.
    database((db) => db.prepare(`INSERT INTO admin_users
      (name, username, email, password_hash, role, status, token_version, must_change_password)
      SELECT name, 'limited-contract', 'limited-contract@example.invalid', password_hash, 'user', 'active', 0, 0
      FROM admin_users WHERE username = 'contract-admin'`).run());
    const login = await request('/api/admin/auth/login', {
      method: 'POST', body: { username: 'limited-contract', password },
    });
    assert.equal(login.data.user.role, 'user');
    for (const method of ['POST', 'PUT', 'DELETE']) {
      await check(`${method} denies admin-realm account without admin role`, () =>
        request(`/api/product${method === 'POST' ? '' : `/${ids[6]}`}`, {
          method, bearer: login.data.accessToken, status: 403,
          body: { name: 'must-not-write', price: 1 },
        }));
    }
  }

  await check('DELETE path id wins over body and query ids', async () => {
    await request(`/api/product/${target}?id=${decoy}`, { method: 'DELETE', auth: true, body: { id: other } });
    await request(`/api/product/${target}`, { status: 404 });
    for (const id of [decoy, other]) assert.equal((await request(`/api/product/${id}`)).data.id, id);
  });

  const beforeRestart = (await request('/api/product/paged?perPage=100')).data;
  await stop();
  // Sidecars are derived data. Removing them must not remove routes or weaken auth.
  for (const directory of ['controller/meta', 'service/meta']) {
    fs.rmSync(path.join(workspace, directory), { recursive: true, force: true });
  }
  await start();
  await check('restart preserves rows and does not replay external migration', async () => {
    assert.deepEqual((await request('/api/product/paged?perPage=100')).data, beforeRestart);
    database((db) => assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contract_migration_marker').get().n, 1));
  });
  await check('restart preserves exact Controller, Service and SQL bytes', unchangedSources);
  await check('decorator authentication survives missing metadata', () =>
    request(`/api/product/${decoy}`, { method: 'DELETE', status: 401 }));
  if (!expressRoot) {
    await check('mini regenerates metadata from code after restart', () => {
      const metadata = JSON.parse(fs.readFileSync(path.join(workspace, 'controller/meta/ProductController.meta.json'), 'utf8'));
      assert.equal(metadata.basePath, '/api/product');
      for (const method of ['post', 'put', 'delete']) {
        assert.equal(metadata.routes.find((route) => route.method === method)?.auth, true);
      }
      const service = JSON.parse(fs.readFileSync(path.join(workspace, 'service/meta/ProductService.meta.json'), 'utf8'));
      assert.equal(service.sqlFile, 'product');
    });
  }

  console.log(JSON.stringify({
    host, database: 'SQLite', result: failures.length ? 'FAIL' : 'PASS',
    checks, requests, failures, sourceHashes,
    externalWorkspace: true, externalMigrations: true, sourceRewrites: false,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
} catch (error) {
  console.error(error.stack);
  if (startupLog) console.error(startupLog);
  process.exitCode = 1;
} finally {
  await stop();
  fs.rmSync(temp, { recursive: true, force: true });
}
