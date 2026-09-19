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
const sourceSha = '0123456789abcdef0123456789abcdef01234567';
const cliJson = (data, status = 200) => ({ status: status === 200 ? 0 : 1,
  stdout: `HTTP/2.0 ${status} Test\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}`,
  stderr: status === 200 ? '' : `gh: Request failed (HTTP ${status})` });
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
      if (options.method === 'GET' && parsed.pathname.includes('/git/ref/')) return json({ ref: `refs/tags/v${version}`, object: { type: 'commit', sha: sourceSha } });
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

function missingTag(f, { branch = 'main', source = { name: 'aidot-mini', version: f.version, aidotEdition: 'public' }, privateRepo = false } = {}) {
  const calls = [];
  return { calls, async fetchImpl(url, options) {
    calls.push({ url, ...options });
    const parsed = new URL(url), base = '/repos/mike-jung/aidot-mini';
    if (options.method === 'GET') {
      if (parsed.pathname === `${base}/git/ref/tags/v${f.version}`) return json({ message: 'Not Found' }, 404);
      if (parsed.pathname === base) return json({ full_name: 'mike-jung/aidot-mini', private: privateRepo });
      if (parsed.pathname === `${base}/git/ref/heads/${encodeURIComponent(branch)}`) return json({ ref: `refs/heads/${branch}`, object: { type: 'commit', sha: sourceSha } });
      if (parsed.pathname === `${base}/contents/package.json`) {
        assert.equal(parsed.searchParams.get('ref'), sourceSha, 'read the source at the pinned commit, not the moving branch');
        return json({ type: 'file', path: 'package.json', encoding: 'base64', content: Buffer.from(JSON.stringify(source)).toString('base64') });
      }
    }
    return f.hooks.fetchImpl(url, options);
  } };
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

test('missing remote tag creates a draft from the verified public commit and uploads assets', async t => {
  const f = fixture(t), remote = missingTag(f);
  const plan = await f.run([], remote);
  assert.equal(plan.tagExists, false); assert.equal(plan.sourceBranch, 'main'); assert.equal(plan.targetCommitish, sourceSha);
  assert.equal(plan.draftCreated, true); assert.equal(plan.uploadPerformed, true);
  const mutations = remote.calls.filter(call => call.method !== 'GET');
  assert.equal(mutations.length, 3);
  assert.equal(new URL(mutations[0].url).pathname, '/repos/mike-jung/aidot-mini/releases');
  assert.equal(JSON.parse(mutations[0].body).target_commitish, sourceSha);
  assert.equal(JSON.parse(mutations[0].body).draft, true);
  assert.deepEqual(plan.uploadedAssets, [f.file, 'SHA256SUMS.txt']); assert.deepEqual(f.readPlan(), plan);
});

test('existing lightweight and annotated tags are reused without a branch fallback', async t => {
  const f = fixture(t);
  for (const type of ['commit', 'tag']) {
    const plan = await f.run([], { fetchImpl: async (url, options) => {
      if (url.includes('/git/ref/')) return json({ ref: `refs/tags/v${f.version}`, object: { type, sha: sourceSha } });
      if (options.method === 'POST' && new URL(url).hostname === 'api.github.com') assert.equal(JSON.parse(options.body).target_commitish, undefined);
      return f.hooks.fetchImpl(url, options);
    } });
    assert.equal(plan.tagExists, true); assert.equal(plan.targetCommitish, undefined);
  }
});

test('missing-tag fallback refuses wrong-version, Full, unrelated or empty source packages', async t => {
  const f = fixture(t);
  for (const source of [
    { name: 'aidot-mini', version: '0.0.1', aidotEdition: 'public' },
    { name: 'aidot-mini', version: f.version, aidotEdition: 'full' },
    { name: 'unrelated-app', version: f.version, aidotEdition: 'public' }, null,
  ]) {
    const remote = missingTag(f, { source });
    await assert.rejects(f.run([], remote), /sync:public/);
    assert.ok(remote.calls.every(call => call.method === 'GET'));
    assert.equal(f.readPlan().draftCreated, undefined); assert.equal(f.readPlan().uploadPerformed, false);
  }
});

test('missing-tag fallback rejects a private or mismatched repository', async t => {
  const f = fixture(t);
  for (const repository of [{ private: true, full_name: 'mike-jung/aidot-mini' }, { private: false, full_name: 'other/mini' }]) {
    const remote = missingTag(f);
    await assert.rejects(f.run([], { fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET');
      return url.endsWith('/repos/mike-jung/aidot-mini') ? json(repository) : remote.fetchImpl(url, options);
    } }), /intended public repository/);
  }
});

test('PUBLIC_BRANCH is used and --branch takes precedence, including slash names', async t => {
  const f = fixture(t);
  for (const [flags, branch] of [[[], 'release/stable'], [['--branch', 'release/next'], 'release/next']]) {
    const remote = missingTag(f, { branch });
    const plan = await f.run(flags, { ...remote, env: { GITHUB_TOKEN: 'fixture-token', PUBLIC_BRANCH: 'release/stable' } });
    assert.equal(plan.sourceBranch, branch); assert.equal(plan.targetCommitish, sourceSha);
  }
});

test('missing or malformed public branch cannot create a draft', async t => {
  const f = fixture(t);
  for (const [status, data] of [[404, { message: 'Not Found' }], [200, { ref: 'refs/heads/wrong', object: { type: 'commit', sha: sourceSha } }],
    [200, { ref: 'refs/heads/main', object: { type: 'commit', sha: 'main' } }]]) {
    const remote = missingTag(f);
    await assert.rejects(f.run([], { fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET');
      return url.includes('/git/ref/heads/') ? json(data, status) : remote.fetchImpl(url, options);
    } }), /Public branch.*sync:public/);
  }
});

test('missing, malformed or non-file package.json cannot create a draft', async t => {
  const f = fixture(t);
  for (const [status, data] of [[404, { message: 'Not Found' }], [200, []], [200, { type: 'file', path: 'package.json', encoding: 'base64', content: Buffer.from('{bad json').toString('base64') }]]) {
    const remote = missingTag(f);
    await assert.rejects(f.run([], { fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET');
      return url.includes('/contents/') ? json(data, status) : remote.fetchImpl(url, options);
    } }), /package.json could not be verified/);
  }
});

test('tag authentication, rate limit and server errors never trigger a missing-tag fallback', async t => {
  const f = fixture(t);
  for (const status of [401, 403, 429, 500]) {
    const calls = [];
    await assert.rejects(f.run([], { fetchImpl: async (url, options) => {
      calls.push(url); assert.equal(options.method, 'GET');
      return url.includes('/git/ref/') ? json({ message: 'Rejected' }, status) : json([]);
    } }), new RegExp('tag lookup.*HTTP ' + status));
    assert.equal(calls.length, 2);
  }
});

test('a repository 404 after a missing tag is still fatal', async t => {
  const f = fixture(t), remote = missingTag(f);
  await assert.rejects(f.run([], { fetchImpl: async (url, options) => {
    assert.equal(options.method, 'GET');
    return url.endsWith('/repos/mike-jung/aidot-mini') ? json({ message: 'Not Found' }, 404) : remote.fetchImpl(url, options);
  } }), /repository lookup.*HTTP 404/);
});

test('an unexpected successful tag response does not authorize a fallback', async t => {
  const f = fixture(t);
  for (const data of [null, [], { ref: `refs/tags/v${f.version}` }, { ref: 'refs/tags/wrong', object: { type: 'commit', sha: sourceSha } }]) {
    await assert.rejects(f.run([], { fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET');
      return url.includes('/git/ref/') ? json(data) : json([]);
    } }), /Remote tag.*not confirmed/);
  }
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
    assert.equal(command, executable);
    if (args[0] === 'api') return cliJson(args.at(-1).includes('/releases?') ? [] : { ref: `refs/tags/v${f.version}`, object: { type: 'commit', sha: sourceSha } });
    return { status: 0, stdout: '', stderr: '' };
  } });
  assert.equal(plan.uploadPerformed, true); assert.equal(plan.draft, true);
});

test('GitHub CLI also handles a missing tag using the verified public commit', async t => {
  const f = fixture(t), calls = [];
  const plan = await f.run([], { env: { PUBLIC_BRANCH: 'release/stable' }, run(command, args, options) {
    calls.push(args); assert.equal(options.env.GH_HOST, 'github.com');
    if (args[0] === 'release') {
      assert.equal(args[1], 'create'); assert.ok(args.includes('--draft'));
      assert.ok(!args.includes('--verify-tag')); assert.equal(args[args.indexOf('--target') + 1], sourceSha);
      return { status: 0, stdout: '', stderr: '' };
    }
    const endpoint = args.at(-1);
    if (endpoint.includes('/releases?')) return cliJson([]);
    if (endpoint.includes('/git/ref/tags/')) return cliJson({ message: 'Not Found' }, 404);
    if (endpoint === 'repos/mike-jung/aidot-mini') return cliJson({ full_name: 'mike-jung/aidot-mini', private: false });
    if (endpoint.endsWith('/git/ref/heads/release%2Fstable')) return cliJson({ ref: 'refs/heads/release/stable', object: { type: 'commit', sha: sourceSha } });
    assert.equal(endpoint, `repos/mike-jung/aidot-mini/contents/package.json?ref=${sourceSha}`);
    return cliJson({ type: 'file', path: 'package.json', encoding: 'base64', content: Buffer.from(JSON.stringify({ name: 'aidot-mini', version: f.version, aidotEdition: 'public' })).toString('base64') });
  } });
  assert.equal(calls.length, 6); assert.equal(plan.targetCommitish, sourceSha); assert.equal(plan.uploadPerformed, true);
});

test('GitHub CLI errors and malformed responses are never treated as missing tags', async t => {
  const f = fixture(t);
  for (const failure of [{ status: 1, stdout: '', stderr: 'connection reset' }, cliJson({ message: 'Forbidden' }, 403),
    { status: 0, stdout: 'not an HTTP response', stderr: '' }]) {
    let calls = 0;
    await assert.rejects(f.run([], { env: {}, run(command, args) {
      assert.equal(args[0], 'api'); calls++;
      return args.at(-1).includes('/releases?') ? cliJson([]) : failure;
    } }), /GitHub CLI/);
    assert.equal(calls, 2); assert.equal(f.readPlan().uploadPerformed, false);
  }
});

test('GitHub CLI protects an existing draft found on a later page', async t => {
  const f = fixture(t); let pages = 0;
  await assert.rejects(f.run([], { env: {}, run(command, args) {
    assert.equal(args[0], 'api'); pages++;
    return cliJson(pages === 1 ? Array.from({ length: 100 }, (_, i) => ({ tag_name: `v0.0.${i}` })) : [{ tag_name: `v${f.version}`, draft: true }]);
  } }), /already exists/);
  assert.equal(pages, 2); assert.equal(f.readPlan().uploadPerformed, false);
});
