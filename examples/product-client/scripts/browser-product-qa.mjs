import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : 'playwright'
);
const client = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.env.QA_PROJECT_ROOT || path.join(client, '../..'));
const expressRoot = process.env.EXPRESS_PROJECT_ROOT;
const host = expressRoot ? 'express' : 'mini';
const output = path.resolve(
  process.env.BROWSER_QA_OUTPUT || path.join(client, 'validation', host),
);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-product-browser-'));
const username = 'product-browser-admin';
const password = randomBytes(24).toString('base64url');
const checks = [];
const errors = [];
let child, browser, vite, failure;
function pass(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(temp, 'empty.env'), '');
const workspace = path.join(temp, 'Product workspace');
fs.cpSync(path.join(root, 'examples/product-workspace'), workspace, { recursive: true });
const env = {
  ...process.env,
  ENV_FILE: path.join(temp, 'empty.env'),
  AIDOT_ENV_FILE: path.join(temp, 'empty.env'),
  APP_WORKSPACE: workspace,
  DB_MIGRATIONS_DIR: path.join(root, 'examples/product-database'),
  DATA_DIR: path.join(temp, 'data'),
  DB_TYPE: 'sqlite',
  DB_FILE: path.join(temp, 'data/app.db'),
  DB_APP_SCHEMA: '',
  DB_SAMPLES: 'false',
  DB_SAMPLE_SCHEMA_SEPARATE: 'false',
  SETTINGS_FILE: path.join(temp, 'settings.json'),
  ADMIN_ACCOUNT_FILE: path.join(temp, 'account.json'),
  ADMIN_TOKEN_FILE: path.join(temp, 'token'),
  ADMIN_TOKEN: randomBytes(32).toString('hex'),
  ADMIN_INITIAL_USERNAME: username,
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
  MCI_ENABLED: 'false',
  HA_ENABLED: 'false',
  SECURE_ENABLED: 'false',
  NODE_ENV: 'test',
  UPLOAD_MAX_BYTES: '20971520',
  MULTIPART_LIMIT_BYTES: '20971520',
};
async function startBackend() {
  if (!expressRoot) {
    const account = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/admin-account.mjs'), '--stdin'],
      {
        cwd: root,
        env,
        input: JSON.stringify({ username, password }),
        encoding: 'utf8',
      },
    );
    assert.equal(account.status, 0, account.stderr);
  }
  let script = path.join(root, 'start.js');
  if (expressRoot) {
    script = path.join(temp, 'express.mjs');
    fs.writeFileSync(
      script,
      `import { createServer } from ${JSON.stringify(pathToFileURL(path.join(expressRoot, 'src/server.js')).href)};
const app = await createServer();
const server = app.listen(0, '127.0.0.1', () => process.send({type:'ready',port:server.address().port}));
process.on('message', value => { if (value?.type === 'aidot:shutdown') server.close(() => process.exit(0)); });`,
    );
  }
  const fd = fs.openSync(path.join(output, 'server.log'), 'w');
  child = fork(script, [], {
    cwd: expressRoot || root,
    env,
    execArgv: expressRoot
      ? ['--import', path.join(expressRoot, 'src/loader/register.mjs')]
      : [],
    stdio: ['ignore', fd, fd, 'ipc'],
  });
  fs.closeSync(fd);
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Server startup timeout; inspect server.log')),
      40000,
    );
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited ${code}; inspect server.log`));
    });
    child.on('message', (value) => {
      if (value?.type === 'ready') {
        clearTimeout(timer);
        resolve(value.port);
      }
    });
  });
  return `http://127.0.0.1:${port}`;
}
async function stopBackend() {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.send({ type: 'aidot:shutdown' });
  });
}
try {
  const api = await startBackend();
  process.env.VITE_AUTH_MODE = host;
  process.env.VITE_API_URL = '/api';
  process.env.API_TARGET = api;
  vite = await createServer({
    root: client,
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await vite.listen();
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  let uploads = 0;
  let lists = 0;
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/uploads/multipart') uploads++;
    if (pathname === '/api/product/paged') lists++;
  });
  const waitRows = (count) =>
    page.waitForFunction(
      (n) => document.querySelectorAll('tbody tr').length === n,
      count,
    );
  const waitList = () =>
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/product/paged');
  const waitSave = (method) =>
    page.waitForResponse(
      (r) =>
        /^\/api\/product(?:\/\d+)?$/.test(new URL(r.url()).pathname) &&
        r.request().method() === method,
    );
  await page.goto(`${base}/product`);
  await waitRows(10);
  assert.equal(await page.locator('.count').textContent(), '24');
  assert.equal(await page.locator('.actions-cell').count(), 0);
  pass('Anonymous listing loads 24 seeded products and hides write controls');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('textbox', { name: '아이디', exact: true }).fill(username);
  await page.getByRole('textbox', { name: '비밀번호', exact: true }).fill(password);
  await page
    .locator('.login-card')
    .getByRole('button', { name: '로그인', exact: true })
    .click();
  await page.getByRole('button', { name: '로그아웃', exact: true }).waitFor();
  pass('Real administrator login enables Product write controls');
  let pending = waitList();
  await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
  await pending;
  await page.locator('[aria-label="2 페이지"][aria-current="page"]').waitFor();
  await page.getByRole('textbox', { name: '상품 검색', exact: true }).fill('파우치');
  pending = waitList();
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await pending;
  await page.locator('[aria-label="1 페이지"][aria-current="page"]').waitFor();
  assert.ok((await page.locator('tbody').textContent()).includes('파우치'));
  await page.getByRole('textbox', { name: '상품 검색', exact: true }).fill('');
  pending = waitList();
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await pending;
  pending = waitList();
  await page
    .getByRole('combobox', { name: '페이지 크기', exact: true })
    .selectOption('20');
  await pending;
  await waitRows(20);
  pending = waitList();
  await page
    .getByRole('combobox', { name: '정렬', exact: true })
    .selectOption('priceAsc');
  await pending;
  const prices = await page.locator('tbody .price-cell').allTextContents();
  const numbers = prices.map((s) => Number(s.replace(/[^0-9]/g, '')));
  assert.deepEqual(
    numbers,
    [...numbers].sort((a, b) => a - b),
  );
  pass('Pagination, search reset, page size and price sorting work through real API');
  await page.locator('main').getByRole('link', { name: '상품 등록' }).click();
  await page.locator('#product-name').fill('Browser QA Product');
  await page.locator('#product-price').fill('32100');
  await page.locator('#product-memo').fill('Browser image persistence test');
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const c = canvas.getContext('2d');
    c.fillStyle = '#4f46e5';
    c.fillRect(0, 0, 8, 8);
    return canvas.toDataURL('image/png');
  });
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  await page
    .getByLabel('이미지 파일', { exact: true })
    .setInputFiles({ name: 'qa-image.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(
    () => document.querySelector('.image-preview')?.naturalWidth === 8,
  );
  assert.equal(uploads, 0);
  assert.equal(
    fs.existsSync(path.join(temp, 'public/uploads/images'))
      ? fs.readdirSync(path.join(temp, 'public/uploads/images')).length
      : 0,
    0,
  );
  const preview = await page.locator('.image-preview').getAttribute('src');
  await page.getByLabel('이미지 파일', { exact: true }).setInputFiles({
    name: 'invalid.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('invalid'),
  });
  await page.getByRole('alert').filter({ hasText: 'PNG, JPEG, WebP' }).waitFor();
  assert.equal(await page.locator('.image-preview').getAttribute('src'), preview);
  pass('Image selection is local only; invalid replacement preserves valid preview');
  let failSave = true;
  await page.route('**/api/product', async (route) => {
    if (route.request().method() === 'POST' && failSave) {
      failSave = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 500, message: 'Controlled DB failure' }),
      });
    } else await route.continue();
  });
  await page.locator('button[type="submit"]').click();
  await page.getByRole('alert').filter({ hasText: 'Controlled DB failure' }).waitFor();
  assert.equal(uploads, 1);
  await page.screenshot({ path: path.join(output, 'upload-retry.png'), fullPage: true });
  pending = waitSave('POST');
  await page.locator('button[type="submit"]').click();
  const created = await pending;
  assert.equal(created.status(), 201);
  const id = (await created.json()).data.insertId;
  await page.waitForURL('**/product');
  await page.locator('tbody tr').filter({ hasText: 'Browser QA Product' }).waitFor();
  assert.equal(uploads, 1);
  let product = (await (await page.request.get(`${base}/api/product/${id}`)).json()).data;
  assert.match(product.imagePath, /^\/uploads\/images\/[0-9a-f-]{36}\.png$/);
  const storedImage = product.imagePath;
  await page.waitForFunction(() =>
    [...document.querySelectorAll('tbody img')].some(
      (image) => image.alt === 'Browser QA Product 이미지' && image.naturalWidth === 8,
    ),
  );
  pass(
    'Upload then save works; DB-failure retry reuses URL and sends no duplicate upload',
  );
  await page.reload();
  await page.getByRole('button', { name: '로그아웃', exact: true }).waitFor();
  await page
    .getByRole('button', { name: 'Browser QA Product 수정', exact: true })
    .waitFor();
  pass('Reload restores authenticated session and persisted thumbnail');
  await page
    .getByRole('button', { name: 'Browser QA Product 수정', exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector('#product-name')?.value === 'Browser QA Product',
  );
  await page.locator('#product-name').fill('Browser QA Updated');
  pending = waitSave('PUT');
  await page.locator('button[type="submit"]').click();
  await pending;
  await page.waitForURL('**/product');
  product = (await (await page.request.get(`${base}/api/product/${id}`)).json()).data;
  assert.equal(product.imagePath, storedImage);
  await page
    .getByRole('button', { name: 'Browser QA Updated 수정', exact: true })
    .click();
  await page.getByRole('button', { name: '이미지 제거', exact: true }).click();
  pending = waitSave('PUT');
  await page.locator('button[type="submit"]').click();
  await pending;
  await page.waitForURL('**/product');
  product = (await (await page.request.get(`${base}/api/product/${id}`)).json()).data;
  assert.equal(product.imagePath, null);
  assert.equal((await page.request.get(base + storedImage)).status(), 200);
  pass('Edit retains image path; explicit removal saves null while public file remains');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('main').getByRole('link', { name: '상품 등록' }).click();
  await page.locator('#product-name').waitFor();
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await page.screenshot({
    path: path.join(output, 'mobile-product-form.png'),
    fullPage: true,
  });
  await page.locator('.back-link').click();
  await page
    .getByRole('button', { name: 'Browser QA Updated 삭제', exact: true })
    .waitFor();
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await page.screenshot({
    path: path.join(output, 'mobile-product-list.png'),
    fullPage: true,
  });
  pass('390px mobile list and upload form fit viewport');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole('button', { name: 'Browser QA Updated 삭제', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '취소', exact: true })
    .click();
  assert.equal((await page.request.get(`${base}/api/product/${id}`)).status(), 200);
  pass('Delete cancellation preserves the database row');
  const deletion = deferred();
  const receivedDelete = deferred();
  await page.route(`**/api/product/${id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    const result = await route.fetch();
    receivedDelete.resolve();
    await deletion.promise;
    await route.fulfill({ response: result });
  });
  await page
    .getByRole('button', { name: 'Browser QA Updated 삭제', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await receivedDelete.promise;
  await page.goBack();
  await page.waitForURL('**/product/new');
  const listsAfterExit = lists;
  deletion.resolve();
  await page.waitForResponse((r) => r.request().method() === 'DELETE');
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  assert.equal(lists, listsAfterExit);
  assert.equal((await page.request.get(`${base}/api/product/${id}`)).status(), 404);
  pass(
    'Finishing DELETE after browser Back does not restart list or touch destroyed dialog',
  );
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByRole('button', { name: '로그인', exact: true }).waitFor();
  assert.equal(await page.locator('button[type="submit"]').isDisabled(), true);
  pass('Logout clears write permission');
  assert.deepEqual(errors, []);
  pass('No browser JavaScript exceptions');
} catch (error) {
  failure = error;
  console.error(error.stack);
} finally {
  const version = browser?.version();
  if (browser) await browser.close();
  if (vite) await vite.close();
  await stopBackend();
  fs.writeFileSync(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        host,
        createdAt: new Date().toISOString(),
        browser: version,
        node: process.version,
        passed: checks.length,
        failed: failure ? 1 : 0,
        error: failure?.message,
        checks,
        pageErrors: errors,
      },
      null,
      2,
    ) + '\n',
  );
  fs.rmSync(temp, { recursive: true, force: true });
  process.exitCode = failure ? 1 : 0;
}
