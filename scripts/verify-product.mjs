import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { PassThrough } from 'node:stream';
import { readRawBody } from '../src/core/uploads.js';

// Set EXPRESS_PROJECT_ROOT to test the same portable files on aidot-express.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expressRoot = process.env.EXPRESS_PROJECT_ROOT;
const host = expressRoot ? 'aidot-express' : 'aidot-mini';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-product-'));
const token = randomBytes(32).toString('hex');
const password = randomBytes(24).toString('base64url');
const workspace = path.join(temp, 'workspace');
let child,
  origin,
  authToken = token;
let passed = 0;
const env = {
  ...process.env,
  ENV_FILE: path.join(temp, 'empty.env'),
  AIDOT_ENV_FILE: path.join(temp, 'empty.env'),
  APP_WORKSPACE: workspace,
  DB_MIGRATIONS_DIR: path.join(root, 'examples/product-database'),
  DATA_DIR: path.join(temp, 'data'),
  DB_TYPE: 'sqlite',
  DB_FILE: path.join(temp, 'data/test.db'),
  DB_APP_SCHEMA: '',
  DB_SAMPLES: 'false',
  DB_SAMPLE_SCHEMA_SEPARATE: 'false',
  SETTINGS_FILE: path.join(temp, 'settings.json'),
  ADMIN_ACCOUNT_FILE: path.join(temp, 'account.json'),
  ADMIN_TOKEN_FILE: path.join(temp, 'token'),
  ADMIN_TOKEN: token,
  ADMIN_INITIAL_USERNAME: 'product-tester',
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
  UPLOAD_MAX_BYTES: '20971520',
  MULTIPART_LIMIT_BYTES: '20971520',
};
async function start() {
  let output = '';
  const script = expressRoot
    ? path.join(temp, 'express.mjs')
    : path.join(root, 'start.js');
  if (expressRoot) {
    fs.writeFileSync(
      script,
      `import { createServer } from ${JSON.stringify(pathToFileURL(path.join(expressRoot, 'src/server.js')).href)};
const app = await createServer();
const server = app.listen(0, '127.0.0.1', () => process.send({type:'ready',port:server.address().port}));
process.on('message', value => { if (value?.type === 'aidot:shutdown') server.close(() => process.exit(0)); });`,
    );
  }
  child = fork(script, [], {
    cwd: expressRoot || root,
    env,
    execArgv: expressRoot
      ? ['--import', path.join(expressRoot, 'src/loader/register.mjs')]
      : [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (bytes) => {
      output = (output + bytes).slice(-14000);
    });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(output + '\nServer startup timeout')),
      40000,
    );
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited ${code}\n${output}`));
    });
    child.on('message', (value) => {
      if (value.type === 'ready') {
        clearTimeout(timeout);
        resolve(value.port);
      }
    });
  });
  origin = `http://127.0.0.1:${port}`;
  if (expressRoot) {
    const { data } = await request('/api/admin/auth/login', {
      method: 'POST',
      body: { username: 'product-tester', password },
    });
    authToken = data.accessToken;
    assert.ok(authToken);
  }
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.send({ type: 'aidot:shutdown' });
  });
}
async function request(
  url,
  { method = 'GET', body, status = 200, auth = false, headers = {} } = {},
) {
  if (auth) headers.Authorization = `Bearer ${authToken}`;
  if (body !== undefined && !(body instanceof FormData) && !Buffer.isBuffer(body)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(origin + url, {
    method,
    body,
    headers,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  assert.equal(response.status, status, `${method} ${url}: ${JSON.stringify(result)}`);
  assert.equal(result.code, status);
  passed++;
  return result;
}
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE9sAAAAASUVORK5CYII=',
  'base64',
);
const form = (bytes = png, mime = 'image/png', field = 'file', name = '상품.png') => {
  const value = new FormData();
  value.append(field, new Blob([bytes], { type: mime }), name);
  return value;
};
const upload = '/api/uploads/multipart?profile=image';
try {
  // Exercise Express loader workers before config reads .env when requested.
  const dotenvWorkspace = Boolean(expressRoot && process.env.EXPRESS_WORKSPACE_FROM_ENV_FILE === '1');
  fs.writeFileSync(env.ENV_FILE, dotenvWorkspace ? `APP_WORKSPACE=${workspace}\n` : '');
  if (dotenvWorkspace) delete env.APP_WORKSPACE;
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  fs.cpSync(path.join(root, 'examples/product-workspace'), workspace, {
    recursive: true,
    filter: (p) => !['meta', '.aidot-cache'].includes(path.basename(p)),
  });
  // A separate Product table must leave an existing Snack lesson's data untouched.
  const legacy = new DatabaseSync(env.DB_FILE);
  legacy.exec(
    "CREATE TABLE snack(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO snack VALUES(1,'preserve-existing');",
  );
  legacy.close();
  await start();
  const first = await request('/api/product/paged?page=1&perPage=10&requestCode=lesson');
  assert.equal(first.header.total, 24);
  assert.equal(first.header.totalPages, 3);
  assert.equal(first.header.page, 1);
  assert.equal(first.header.perPage, 10);
  assert.equal(first.header.requestCode, 'lesson');
  assert.equal(first.data.length, 10);
  const second = await request('/api/product/paged?page=2&perPage=10');
  assert.ok(
    second.data.every((item) => !first.data.some((previous) => previous.id === item.id)),
  );
  assert.equal((await request('/api/product/paged?page=3&perPage=10')).data.length, 4);
  const search = await request('/api/product/paged?q=' + encodeURIComponent('파우치'));
  assert.equal(search.header.total, 2);
  const empty = await request('/api/product/paged?q=missing-product-xyz');
  assert.equal(empty.header.total, 0);
  assert.deepEqual(empty.data, []);
  for (const query of [
    'page=0',
    'page=-1',
    'page=1.5',
    'perPage=101',
    'perPage=',
    'sort=__proto__',
    'sort=evil',
    'q=' + 'a'.repeat(101),
  ]) {
    await request('/api/product/paged?' + query, { status: 400 });
  }
  for (const q of ["' OR 1=1 --", '%', '_'])
    assert.equal(
      (await request('/api/product/paged?q=' + encodeURIComponent(q))).header.total,
      0,
    );
  const sorted = await request('/api/product/paged?sort=priceAsc&perPage=100');
  assert.ok(
    sorted.data.every((row, index, rows) => !index || rows[index - 1].price <= row.price),
  );
  await request('/api/product', { method: 'POST', body: {}, status: 401 });
  await request('/api/product', {
    method: 'POST',
    body: { name: '', price: -1 },
    auth: true,
    status: 400,
  });
  await request(upload, { method: 'POST', body: form(), status: 401 });
  await request(upload, {
    method: 'POST',
    body: form(Buffer.from('<svg/>'), 'image/svg+xml'),
    auth: true,
    status: 415,
  });
  await request(upload, {
    method: 'POST',
    body: form(png, 'image/jpeg'),
    auth: true,
    status: 415,
  });
  await request(upload, {
    method: 'POST',
    body: form(png, 'image/png', 'wrong'),
    auth: true,
    status: 400,
  });
  await request(upload, {
    method: 'POST',
    body: form(Buffer.alloc(0)),
    auth: true,
    status: 400,
  });
  await request(upload, {
    method: 'POST',
    body: form(Buffer.alloc(5 * 1024 * 1024 + 1)),
    auth: true,
    status: 413,
  });
  await request(upload, {
    method: 'POST',
    body: form(Buffer.alloc(6 * 1024 * 1024 + 1)),
    auth: true,
    status: 413,
  });
  const multi = form();
  multi.append('file', new Blob([png], { type: 'image/png' }), 'second.png');
  await request(upload, {
    method: 'POST',
    body: multi,
    auth: true,
    status: 400,
  });
  await request('/api/uploads/multipart?profile=unknown', {
    method: 'POST',
    body: form(),
    auth: true,
    status: 400,
  });
  await request(upload, {
    method: 'POST',
    body: Buffer.from('broken'),
    headers: { 'Content-Type': 'multipart/form-data; boundary=abc' },
    auth: true,
    status: 400,
  });
  const image = (await request(upload, { method: 'POST', body: form(), auth: true }))
    .data;
  assert.match(image.url, /^\/uploads\/images\/[0-9a-f-]{36}\.png$/);
  assert.equal(image.size, png.length);
  const publicImage = await fetch(origin + image.url);
  assert.equal(publicImage.status, 200);
  assert.equal(publicImage.headers.get('content-disposition'), 'inline');
  assert.match(publicImage.headers.get('content-type'), /^image\/png/);
  assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), png);
  passed++;
  const id = (
    await request('/api/product', {
      method: 'POST',
      auth: true,
      status: 201,
      body: {
        name: '100%_Product',
        price: 8000,
        memo: 'image roundtrip',
        imagePath: image.url,
      },
    })
  ).data.insertId;
  assert.equal((await request('/api/product/' + id)).data.imagePath, image.url);
  const list = await request('/api/product/paged?q=' + encodeURIComponent('%_'));
  assert.equal(list.header.total, 1);
  assert.equal(list.data[0].imagePath, image.url);
  await request('/api/product/' + id, {
    method: 'PUT',
    auth: true,
    body: { name: 'Updated', price: 9000 },
  });
  assert.equal((await request('/api/product/' + id)).data.imagePath, image.url);
  for (const imagePath of [
    'https://example.org/x.png',
    '/uploads/images/../../x.png',
    '/uploads/images/00000000-0000-4000-8000-000000000000.png',
  ]) {
    await request('/api/product/' + id, {
      method: 'PUT',
      auth: true,
      status: 400,
      body: { name: 'Bad', price: 1, imagePath },
    });
  }
  // Existing general upload and base64 contracts still work and remain attachments.
  const generic = (
    await request('/api/uploads/multipart', {
      method: 'POST',
      auth: true,
      body: form(Buffer.from('report'), 'text/plain', 'document', 'report.txt'),
    })
  ).data;
  const download = await fetch(origin + generic.url);
  assert.equal(download.headers.get('content-disposition'), 'attachment');
  assert.equal(await download.text(), 'report');
  passed++;
  const base64 = (
    await request('/api/uploads', {
      method: 'POST',
      auth: true,
      body: {
        fileName: 'report.txt',
        fileBase64: Buffer.from('second').toString('base64'),
      },
    })
  ).data;
  assert.notEqual(base64.url, generic.url);
  const concurrent = await Promise.all(
    [1, 2, 3].map(() =>
      request('/api/uploads', {
        method: 'POST',
        auth: true,
        body: { fileName: 'same.txt', fileBase64: 'aGVsbG8=' },
      }),
    ),
  );
  assert.equal(new Set(concurrent.map((x) => x.data.url)).size, 3);
  const generalMulti = form(Buffer.from('first'), 'text/plain', 'file', 'first.txt');
  generalMulti.append('file', new Blob(['last']), 'last.txt');
  assert.equal(
    (
      await request('/api/uploads/multipart', {
        method: 'POST',
        auth: true,
        body: generalMulti,
      })
    ).data.files.length,
    2,
  );
  assert.ok(
    (await request('/api/uploads', { auth: true })).data.some(
      (item) => item.url === image.url,
    ),
  );
  await stop();
  await start();
  assert.equal((await request('/api/product/' + id)).data.imagePath, image.url);
  assert.equal((await request('/api/product/paged')).header.total, 25);
  const persisted = new DatabaseSync(env.DB_FILE);
  assert.equal(
    persisted.prepare('SELECT image_path FROM demo_product WHERE id=?').get(id)
      .image_path,
    image.url,
  );
  assert.equal(
    persisted.prepare('SELECT name FROM snack WHERE id=1').get().name,
    'preserve-existing',
  );
  persisted.close();
  passed++;
  await request('/api/product/' + id, {
    method: 'PUT',
    auth: true,
    body: { name: 'Unlinked', price: 1, imagePath: null },
  });
  assert.equal((await request('/api/product/' + id)).data.imagePath, null);
  await request('/api/product/' + id, { method: 'DELETE', auth: true });
  await request('/api/product/' + id, { status: 404 });
  assert.equal((await fetch(origin + image.url)).status, 200);
  // Both buffered and streaming requests must apply the same byte limit.
  await assert.rejects(async () => readRawBody({ body: Buffer.alloc(5) }, 4), {
    status: 413,
  });
  passed++;
  const stream = new PassThrough();
  stream.headers = {};
  const pending = readRawBody(stream, 4);
  stream.end(Buffer.alloc(5));
  await assert.rejects(pending, { status: 413 });
  passed++;
  console.log(
    JSON.stringify({
      host,
      database: 'SQLite',
      checks: passed,
      result: 'PASS',
      workspace: 'same Controller/Service/SQL files',
    }),
  );
} finally {
  await stop();
  fs.rmSync(temp, { recursive: true, force: true });
}
