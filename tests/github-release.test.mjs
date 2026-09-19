import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { main } from '../scripts/dist/release-github.mjs';
import { readReleaseEnv, releaseToken, githubCommand } from '../scripts/dist/github-api.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-github-rest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const bytes = Buffer.from('verified binary fixture\0\xff', 'latin1'), file = `aidot-mini-${version}-linux-x64-minimal.tar.gz`;
  fs.writeFileSync(path.join(root, file), bytes);
  fs.writeFileSync(path.join(root, `${file}.release.json`), JSON.stringify({ format: 'aidot-mini-release-artifact/v1',
    file, version, edition: 'public', target: 'linux', arch: 'x64', variant: 'minimal', bytes: bytes.length, sha256: digest(bytes) }));
  const calls = [], outputs = [];
  const hooks = { envRoot: root, env: { GITHUB_TOKEN: 'fixture-release-secret' },
    run() { assert.fail('Token release must work without GitHub CLI'); }, output: value => outputs.push(value),
    async fetchImpl(url, options) {
      const parsed = new URL(url), call = { url, ...options }; calls.push(call);
      if (options.method === 'GET' && parsed.pathname.endsWith('/releases')) return json([]);
      if (options.method === 'GET' && parsed.pathname.includes('/git/ref/')) return json({ ref: `refs/tags/v${version}` });
      if (options.method === 'POST' && parsed.hostname === 'api.github.com') {
        assert.equal(JSON.parse(options.body).draft, true);
        return json({ id: 42, draft: true, tag_name: `v${version}`, upload_url: 'https://uploads.github.com/repos/mike-jung/aidot-mini/releases/42/assets{?name,label}' }, 201);
      }
      if (options.method === 'POST' && parsed.hostname === 'uploads.github.com') {
        const uploaded = Buffer.from(await options.body.arrayBuffer());
        assert.equal(Number(options.headers['Content-Length']), uploaded.length);
        call.uploadedBytes = uploaded;
        return json({ name: parsed.searchParams.get('name'), size: uploaded.length, state: 'uploaded', digest: `sha256:${digest(uploaded)}` }, 201);
      }
      assert.fail('Unexpected GitHub request: ' + url);
    } };
  const readPlan = () => JSON.parse(fs.readFileSync(path.join(root, 'RELEASE_PLAN.json'), 'utf8'));
  return { root, file, bytes, version, calls, outputs, hooks, readPlan,
    run: (flags = [], overrides = {}) => main(['--directory', root, ...flags], { ...hooks, ...overrides }) };
}

test('existing .env token creates a draft and uploads exact assets without gh', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.env'), '\uFEFFGITHUB_TOKEN=fixture-env-token\nGITHUB_REPO=example/private-full\n');
  const plan = await f.run([], { env: {} });
  assert.equal(plan.repository, 'mike-jung/aidot-mini');
  assert.equal(plan.draft, true); assert.equal(plan.uploadPerformed, true); assert.equal(plan.draftCreated, true);
  assert.deepEqual(plan.uploadedAssets, [f.file, 'SHA256SUMS.txt']); assert.deepEqual(f.readPlan(), plan);
  assert.equal(f.calls.length, 5);
  for (const call of f.calls) { assert.equal(call.headers.Authorization, 'Bearer fixture-env-token'); assert.equal(call.redirect, 'error'); }
  assert.deepEqual(f.calls[3].uploadedBytes, f.bytes);
  assert.equal(f.calls[4].uploadedBytes.toString(), `${digest(f.bytes)}  ${f.file}\n`);
  assert.doesNotMatch(JSON.stringify(plan) + f.outputs.join(''), /fixture-env-token/);
});

test('release env matches publishing precedence without changing the process environment', t => {
  const f = fixture(t), inherited = { GITHUB_TOKEN: 'inherited', GH_TOKEN: 'alternative' };
  fs.writeFileSync(path.join(f.root, '.env.publish'), 'GITHUB_TOKEN=legacy\n');
  fs.writeFileSync(path.join(f.root, '.env'), 'GITHUB_TOKEN=primary\n');
  fs.writeFileSync(path.join(f.root, '.env.local'), 'GITHUB_TOKEN=local\n');
  assert.equal(releaseToken(readReleaseEnv(f.root, {})), 'local');
  assert.equal(releaseToken(readReleaseEnv(f.root, inherited)), 'inherited');
  assert.deepEqual(inherited, { GITHUB_TOKEN: 'inherited', GH_TOKEN: 'alternative' });
  assert.equal(releaseToken({ GH_TOKEN: ' alias-token ' }), 'alias-token');
  assert.throws(() => readReleaseEnv(f.root, { GITHUB_TOKEN: 'secret\nsecond-line' }), /single line/);
});

test('dry run ignores credentials and never accesses GitHub', async t => {
  const f = fixture(t);
  const plan = await f.run(['--dry-run'], { env: { GITHUB_TOKEN: 'invalid\nsecret' }, fetchImpl() { assert.fail('Dry run network access'); } });
  assert.equal(plan.uploadPerformed, false); assert.equal(plan.draftCreated, undefined); assert.equal(f.calls.length, 0);
});

test('existing drafts on later release pages cannot be overwritten', async t => {
  const f = fixture(t); let pages = 0;
  await assert.rejects(f.run([], { fetchImpl: async (url, options) => {
    assert.equal(options.method, 'GET'); pages++;
    if (pages === 1) return json(Array.from({ length: 100 }, (_, i) => ({ tag_name: `v0.0.${i}`, draft: false })));
    assert.match(url, /page=2$/); return json([{ tag_name: `v${f.version}`, draft: true }]);
  } }), /already exists/);
  assert.equal(pages, 2); assert.equal(f.readPlan().uploadPerformed, false);
});

test('missing remote tag stops before draft creation', async t => {
  const f = fixture(t);
  await assert.rejects(f.run([], { fetchImpl: async (url, options) => {
    assert.equal(options.method, 'GET'); return url.includes('/git/ref/') ? json({ message: 'Not Found' }, 404) : json([]);
  } }), /tag lookup.*HTTP 404/);
  assert.equal(f.readPlan().uploadPerformed, false); assert.equal(f.readPlan().draftCreated, undefined);
});

test('authentication errors are redacted and do not fall back to another identity', async t => {
  const f = fixture(t);
  for (const status of [401, 403]) {
    await assert.rejects(f.run([], { fetchImpl: async () => json({ message: 'Rejected fixture-release-secret' }, status) }), error => {
      assert.match(error.message, new RegExp('HTTP ' + status)); assert.doesNotMatch(error.message, /fixture-release-secret/); return true;
    });
    assert.equal(f.readPlan().uploadPerformed, false);
  }
});

test('network errors cannot expose tokens', async t => {
  const f = fixture(t);
  await assert.rejects(f.run([], { fetchImpl: async () => { throw new Error('socket error fixture-release-secret'); } }), error => {
    assert.match(error.message, /network/); assert.doesNotMatch(error.message, /fixture-release-secret/); return true;
  });
});

test('partial upload retains the draft and does not claim completion', async t => {
  const f = fixture(t);
  await assert.rejects(f.run([], { fetchImpl: (url, options) => url.includes('name=SHA256SUMS')
    ? Promise.resolve(json({ message: 'upstream upload failure' }, 502)) : f.hooks.fetchImpl(url, options) }), /Draft .*upload is incomplete/);
  const plan = f.readPlan(); assert.equal(plan.draftCreated, true); assert.equal(plan.uploadPerformed, false);
  assert.deepEqual(plan.uploadedAssets, [f.file]); assert.equal(plan.releaseId, 42);
});

test('untrusted upload destinations receive no credentials or files', async t => {
  const f = fixture(t);
  await assert.rejects(f.run([], { fetchImpl: async (url, options) => {
    assert.equal(new URL(url).hostname, 'api.github.com');
    if (options.method === 'POST') return json({ id: 42, draft: true, tag_name: `v${f.version}`, upload_url: 'https://unexpected.invalid/upload' }, 201);
    return f.hooks.fetchImpl(url, options);
  } }), /Unexpected GitHub upload URL/);
  assert.equal(f.readPlan().uploadPerformed, false); assert.deepEqual(f.readPlan().uploadedAssets, []);
});

test('wrong uploaded bytes are not recorded as successful', async t => {
  const f = fixture(t);
  await assert.rejects(f.run([], { fetchImpl: async (url, options) => {
    const response = await f.hooks.fetchImpl(url, options);
    if (!url.startsWith('https://uploads.github.com/')) return response;
    const data = await response.json(); data.digest = 'sha256:wrong'; return json(data, 201);
  } }), /upload verification failed/);
  assert.equal(f.readPlan().uploadPerformed, false); assert.deepEqual(f.readPlan().uploadedAssets, []);
});

test('tampered assets are rejected before REST access', async t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.root, f.file), 'changed');
  await assert.rejects(f.run(), /hash\/size mismatch/); assert.equal(f.calls.length, 0);
});

test('missing gh produces setup instructions and GH_PATH supports paths with spaces', async t => {
  const f = fixture(t);
  await assert.rejects(f.run([], { env: {}, run() { return { error: Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' }), status: null }; } }), error => {
    assert.match(error.message, /GITHUB_TOKEN/); assert.match(error.message, /winget install/); assert.match(error.message, /gh auth login/); return true;
  });
  const executable = 'C:\\Program Files\\GitHub CLI\\gh.exe'; assert.equal(githubCommand({ GH_PATH: executable }), executable);
  const plan = await f.run([], { env: { GH_PATH: executable }, run(command, args) {
    assert.equal(command, executable); return { status: args[1] === 'view' ? 1 : 0, stdout: '', stderr: '' };
  } });
  assert.equal(plan.uploadPerformed, true); assert.equal(plan.draft, true);
});
