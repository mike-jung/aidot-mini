import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { createServer } from 'vite';
import { createPinia, setActivePinia } from 'pinia';

// Vite loads the same modules and environment as the browser, without a DOM emulator.
globalThis.window = { location: { origin: 'http://localhost:5173' } };
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const { default: api } = await vite.ssrLoadModule('/src/api/axios.js');
const { useProductStore } = await vite.ssrLoadModule('/src/stores/records_product.js');
const { useAuthStore } = await vite.ssrLoadModule('/src/stores/auth.js');
const { useUploadStore } = await vite.ssrLoadModule('/src/stores/uploads.js');
after(() => vite.close());
beforeEach(() => setActivePinia(createPinia()));

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function response(config, data) {
  return { config, data, status: 200, statusText: 'OK', headers: {} };
}
function page(name, page = 1, total = 1) {
  return {
    data: [{ id: page, name }],
    header: { page, perPage: 10, total, totalPages: Math.ceil(total / 10) },
  };
}
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('only the newest list request updates the store', async () => {
  const first = deferred();
  api.defaults.adapter = async (config) => {
    if (config.params.q === 'first') return response(config, await first.promise);
    return response(config, page('second'));
  };
  const store = useProductStore();
  const oldSearch = store.search({ query: 'first', sort: 'newest' });
  await nextTurn();
  await store.search({ query: 'second', sort: 'newest' });
  first.resolve(page('first'));
  await oldSearch;
  assert.equal(store.items[0].name, 'second');
  assert.equal(store.loading, false);
});

test('a deletion completing after screen exit does not restart a list request', async () => {
  const deletion = deferred();
  let lists = 0;
  api.defaults.adapter = async (config) => {
    if (config.method === 'delete') return response(config, await deletion.promise);
    lists++;
    return response(config, page('remaining'));
  };
  const store = useProductStore();
  const pending = store.removeProduct(1);
  await nextTurn();
  store.cancel();
  deletion.resolve({ data: { rowsAffected: 1 } });
  await pending;
  assert.equal(lists, 0);
  assert.equal(store.saving, false);
});

test('deleting the last row fetches the last valid page', async () => {
  const pages = [];
  api.defaults.adapter = async (config) => {
    if (config.method === 'delete')
      return response(config, { data: { rowsAffected: 1 } });
    pages.push(config.params.page);
    const body = page('remaining', config.params.page, 10);
    if (config.params.page === 2) body.data = [];
    return response(config, body);
  };
  const store = useProductStore();
  store.page = 2;
  await store.removeProduct(11);
  assert.deepEqual(pages, [2, 1]);
  assert.equal(store.page, 1);
  assert.equal(store.items[0].name, 'remaining');
});

test('login waits for session restoration so an older refresh cookie cannot overwrite login', async () => {
  const restore = deferred();
  const calls = [];
  api.defaults.adapter = async (config) => {
    calls.push(config.url);
    if (config.url.endsWith('/session') || config.url.endsWith('/refresh')) {
      return response(config, await restore.promise);
    }
    return response(config, {
      data: { user: { username: 'new-admin' }, accessToken: 'new-token' },
    });
  };
  const store = useAuthStore();
  const restoring = store.restore();
  await nextTurn();
  const loggingIn = store.login('new-admin', 'test-only');
  await nextTurn();
  assert.equal(calls.length, 1);
  restore.resolve({
    data: { user: { username: 'old-admin' }, accessToken: 'old-token' },
  });
  await Promise.all([restoring, loggingIn]);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].endsWith('/login'));
  assert.equal(store.user.username, 'new-admin');
});

test('logout waits for session restoration and leaves local credentials cleared', async () => {
  const restore = deferred();
  const calls = [];
  api.defaults.adapter = async (config) => {
    calls.push(config.url);
    if (config.url.endsWith('/session') || config.url.endsWith('/refresh')) {
      return response(config, await restore.promise);
    }
    return response(config, { data: null });
  };
  const store = useAuthStore();
  const restoring = store.restore();
  await nextTurn();
  const loggingOut = store.logout();
  await nextTurn();
  assert.equal(calls.length, 1);
  restore.resolve({
    data: { user: { username: 'old-admin' }, accessToken: 'old-token' },
  });
  await Promise.all([restoring, loggingOut]);
  assert.ok(calls[1].endsWith('/logout'));
  assert.equal(store.user, null);
});

test('cancelled uploads leave progress and busy state reset', async () => {
  const uploaded = deferred();
  api.defaults.adapter = async (config) => response(config, await uploaded.promise);
  const store = useUploadStore();
  const pending = store.upload(new File(['test'], 'test.png', { type: 'image/png' }));
  await nextTurn();
  store.cancel();
  uploaded.resolve({
    data: { url: '/uploads/images/00000000-0000-4000-8000-000000000000.png' },
  });
  await assert.rejects(pending, (error) => error.code === 'ERR_CANCELED');
  assert.equal(store.uploading, false);
  assert.equal(store.progress, 0);
});

test('write controls require the admin role in Express mode', () => {
  const store = useAuthStore();
  assert.equal(store.isAdmin, false);
  store.user = { username: 'viewer', role: 'viewer' };
  assert.equal(store.isAdmin, process.env.VITE_AUTH_MODE !== 'express');
  store.user = { username: 'admin', role: 'admin' };
  assert.equal(store.isAdmin, true);
});
