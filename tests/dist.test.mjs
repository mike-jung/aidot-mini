import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findPython } from '../scripts/run-python.mjs';
import { policy, regularFile, verifyBinary, sha256 } from '../scripts/dist/dist.mjs';
import { createPlan, main as releaseCommand } from '../scripts/dist/release-github.mjs';

// User publishing credentials must never affect these simulated CLI tests.
const releaseMain = (args, hooks) => releaseCommand(args, { env: {}, envRoot: args[args.indexOf('--directory') + 1],
  fetchImpl() { assert.fail('CLI fixtures must not access the network'); }, ...hooks });

test('Linux archives restore executable permissions when the build host does not preserve them', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-dist-modes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'payload'), archive = path.join(root, 'payload.tar.gz');
  const files = ['runtime/node', 'bin/aidot-mini', 'ros-src/ros1/src/aidot_mini_ros/scripts/aidot_robot_bridge', 'app/start.js'];
  for (const file of files) {
    const target = path.join(source, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '#!/bin/sh\nprintf "archive executable works"\n'); fs.chmodSync(target, 0o644);
  }
  const python = findPython();
  execFileSync(python, [fileURLToPath(new URL('../scripts/dist/archive.py', import.meta.url)), 'tar', source, archive]);
  const check = `import json,sys,tarfile\nwith tarfile.open(sys.argv[1]) as archive:\n print(json.dumps({item.name:item.mode for item in archive}))\n archive.extractall(sys.argv[2], **({'filter':'data'} if hasattr(tarfile,'data_filter') else {}))\n`;
  const unpacked = path.join(root, 'unpacked');
  const modes = JSON.parse(execFileSync(python, ['-c', check, archive, unpacked], { encoding: 'utf8' }));
  for (const file of files.slice(0, 3)) assert.equal(modes['payload/' + file], 0o755, file);
  assert.equal(modes['payload/app/start.js'], 0o644);
  assert.equal(modes['payload/bin'], 0o755);
  if (process.platform !== 'win32') assert.equal(execFileSync(path.join(unpacked, 'payload/bin/aidot-mini'), { encoding: 'utf8' }), 'archive executable works');
});

test('installed release policy excludes private code and runtime state', () => {
  const files = [...policy.common, ...policy.full, ...policy.robot];
  for (const file of files) assert.doesNotMatch(file, /(^|\/)(?:\.env|enterprise|node_modules|data|log|uploads|\.aidot-cache|publish)(?:\/|$)/);
  assert.ok(policy.common.includes('examples/product-workspace/controller/ProductController.js'));
  assert.ok(policy.common.includes('deploy/installed/lifecycle.mjs'));
  assert.ok(policy.full.includes('public/index.html'));
  assert.equal(policy.common.some(file => file.startsWith('public/')), false);
});

test('release inputs reject traversal and symbolic links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-dist-input-'));
  try {
    fs.writeFileSync(path.join(root, 'safe'), 'okay');
    assert.equal(regularFile(root, 'safe'), path.join(root, 'safe'));
    for (const file of ['../safe', '/safe', 'a/../safe', 'a\\safe']) assert.throws(() => regularFile(root, file));
    if (process.platform !== 'win32') { fs.symlinkSync('safe', path.join(root, 'linked')); assert.throws(() => regularFile(root, 'linked'), /Symlink/); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('binary target validation rejects incorrect architecture', () => {
  const elf = Buffer.alloc(64); Buffer.from('7f454c460201', 'hex').copy(elf); elf.writeUInt16LE(62, 18);
  verifyBinary(elf, 'linux', 'x64');
  assert.throws(() => verifyBinary(elf, 'linux', 'arm64'), /architecture/);
  assert.throws(() => verifyBinary(elf, 'win', 'x64'), /Windows/);
});

test('release plan validates artifact bytes and refuses private or wrong-version packages', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-dist-plan-'));
  try {
    const file = 'aidot-mini-1.0.8-linux-x64-minimal.tar.gz', bytes = Buffer.from('a checked artifact');
    const sidecar = { format: 'aidot-mini-release-artifact/v1', file, version: '1.0.8', edition: 'public', target: 'linux', arch: 'x64', variant: 'minimal', bytes: bytes.length, sha256: sha256(bytes) };
    fs.writeFileSync(path.join(directory, file), bytes);
    const write = () => fs.writeFileSync(path.join(directory, `${file}.release.json`), JSON.stringify(sidecar)); write();
    const plan = createPlan(directory, { version: '1.0.8', repo: 'mike-jung/aidot-mini' });
    assert.equal(plan.uploadPerformed, false); assert.equal(plan.draft, true); assert.equal(plan.assets.length, 1);
    assert.match(fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8'), new RegExp(sidecar.sha256));
    sidecar.edition = 'full'; write(); assert.throws(() => createPlan(directory, { version: '1.0.8' }), /Non-public/);
    sidecar.edition = 'public'; sidecar.version = '1.0.7'; write(); assert.throws(() => createPlan(directory, { version: '1.0.8' }), /wrong-version/);
    sidecar.version = '1.0.8'; write(); fs.appendFileSync(path.join(directory, file), 'tampered'); assert.throws(() => createPlan(directory, { version: '1.0.8' }), /mismatch/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('release plan accepts explicitly labeled Android signing variants and documents their limits', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-android-plan-'));
  try {
    for (const variant of ['debug', 'release-unsigned']) {
      const file = `aidot-mini-1.0.8-android-arm64-v8a-${variant}.apk`, bytes = Buffer.from(`fixture ${variant}`);
      fs.writeFileSync(path.join(directory, file), bytes);
      fs.writeFileSync(path.join(directory, `${file}.release.json`), JSON.stringify({ format: 'aidot-mini-release-artifact/v1', file, version: '1.0.8', edition: 'public', target: 'android', arch: 'arm64-v8a', variant, bytes: bytes.length, sha256: sha256(bytes) }));
    }
    const plan = createPlan(directory, { version: '1.0.8' });
    assert.equal(plan.assets.length, 2);
    assert.match(fs.readFileSync(path.join(directory, 'RELEASE_NOTES.md'), 'utf8'), /production keystore/);
    assert.equal(plan.uploadPerformed, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

function releaseFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-release-command-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const file = `aidot-mini-${version}-linux-x64-minimal.tar.gz`, bytes = Buffer.from('release command fixture');
  fs.writeFileSync(path.join(directory, file), bytes);
  fs.writeFileSync(path.join(directory, `${file}.release.json`), JSON.stringify({ format: 'aidot-mini-release-artifact/v1', file, version, edition: 'public', target: 'linux', arch: 'x64', variant: 'minimal', bytes: bytes.length, sha256: sha256(bytes) }));
  return { directory, file, version, readPlan: () => JSON.parse(fs.readFileSync(path.join(directory, 'RELEASE_PLAN.json'), 'utf8')) };
}

function cliPreflight(args, version, releases = []) {
  assert.equal(args[0], 'api');
  const data = args.at(-1).includes('/releases?') ? releases : { ref: `refs/tags/v${version}`,
    object: { type: 'commit', sha: '0123456789abcdef0123456789abcdef01234567' } };
  return { status: 0, stdout: `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}`, stderr: '' };
}

test('release command defaults to creating a draft in the public repository', async t => {
  const { directory, file, version, readPlan } = releaseFixture(t), calls = [], output = [];
  const plan = await releaseMain(['--directory', directory], {
    run(command, args) {
      assert.equal(command, 'gh'); calls.push(args);
      assert.equal(readPlan().uploadPerformed, false);
      return args[0] === 'api' ? cliPreflight(args, version) : { status: 0, stdout: '', stderr: '' };
    },
    output: text => output.push(JSON.parse(text)),
  });
  assert.match(calls[0].at(-1), /^repos\/mike-jung\/aidot-mini\/releases\?/);
  assert.equal(calls[1].at(-1), `repos/mike-jung/aidot-mini/git/ref/tags/v${version}`);
  assert.deepEqual(calls[2], ['release', 'create', `v${version}`, path.join(directory, file), path.join(directory, 'SHA256SUMS.txt'), '--repo', 'mike-jung/aidot-mini', '--draft', '--verify-tag', '--title', `aidot-mini ${version}`, '--notes-file', path.join(directory, 'RELEASE_NOTES.md')]);
  assert.equal(calls.length, 3);
  assert.equal(plan.repository, 'mike-jung/aidot-mini'); assert.equal(plan.draft, true);
  assert.equal(plan.uploadPerformed, true); assert.deepEqual(readPlan(), plan); assert.deepEqual(output, [plan]);
});

test('release dry run verifies assets and writes a plan without invoking GitHub', async t => {
  const { directory, readPlan } = releaseFixture(t);
  const plan = await releaseMain(['--directory', directory, '--dry-run'], {
    run() { assert.fail('A dry run must not invoke GitHub'); }, output() {},
  });
  assert.equal(plan.repository, 'mike-jung/aidot-mini'); assert.equal(plan.uploadPerformed, false);
  assert.deepEqual(readPlan(), plan);
  for (const file of ['SHA256SUMS.txt', 'RELEASE_NOTES.md']) assert.ok(fs.existsSync(path.join(directory, file)));
});

test('release repository override and legacy publish flag remain supported', async t => {
  const { directory, version } = releaseFixture(t);
  for (const flags of [['--repo', 'example/mini'], ['--publish', '--repo', 'example/mini'], ['--publish']]) {
    const repository = flags.includes('--repo') ? 'example/mini' : 'mike-jung/aidot-mini', calls = [];
    const plan = await releaseMain(['--directory', directory, ...flags], {
      run(command, args) {
        assert.equal(command, 'gh'); calls.push(args);
        if (args[0] === 'api') { assert.ok(args.at(-1).startsWith(`repos/${repository}/`)); return cliPreflight(args, version); }
        assert.equal(args[args.indexOf('--repo') + 1], repository);
        return { status: 0, stdout: '', stderr: '' };
      }, output() {},
    });
    assert.equal(plan.repository, repository); assert.equal(plan.uploadPerformed, true); assert.equal(calls.length, 3);
  }
});

test('an existing release stops creation and preserves the unperformed upload state', async t => {
  const { directory, version, readPlan } = releaseFixture(t), calls = [];
  await assert.rejects(releaseMain(['--directory', directory], {
    run(command, args) { calls.push(args); return cliPreflight(args, version, [{ tag_name: `v${version}` }]); }, output() {},
  }), /already exists/);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'api'); assert.equal(readPlan().uploadPerformed, false);
});

test('GitHub CLI setup failures stop before attempting release creation', async t => {
  const { directory, readPlan } = releaseFixture(t);
  for (const failure of [{ error: new Error('spawn gh ENOENT'), status: null }, { status: 4, stderr: 'Authentication required' }]) {
    let calls = 0;
    await assert.rejects(releaseMain(['--directory', directory], {
      run(command, args) { calls++; assert.equal(args[0], 'api'); return failure; }, output() {},
    }), /GitHub CLI/);
    assert.equal(calls, 1); assert.equal(readPlan().uploadPerformed, false);
  }
});

test('failed release creation is not recorded as a completed upload', async t => {
  const { directory, version, readPlan } = releaseFixture(t);
  await assert.rejects(releaseMain(['--directory', directory], {
    run(command, args) { return args[0] === 'api' ? cliPreflight(args, version) : { status: 1, stdout: '', stderr: 'remote tag does not exist' }; }, output() {},
  }), /remote tag does not exist/);
  assert.equal(readPlan().uploadPerformed, false);
});

test('invalid release assets cannot trigger a GitHub call', async t => {
  const { directory, file } = releaseFixture(t);
  fs.appendFileSync(path.join(directory, file), 'tampered');
  await assert.rejects(releaseMain(['--directory', directory], {
    run() { assert.fail('Invalid artifacts must not reach GitHub'); }, output() {},
  }), /hash\/size mismatch/);
});

test('release help and invalid options do not access GitHub', async () => {
  const output = [], hooks = { run() { assert.fail('Options must be handled locally'); }, output: text => output.push(text) };
  await releaseMain(['--help'], hooks);
  assert.match(output[0], /Default: create a draft in mike-jung\/aidot-mini/);
  assert.match(output[0], /--dry-run writes local plan\/checksums only/);
  await assert.rejects(releaseMain(['--publish', '--dry-run'], hooks), /Choose --publish or --dry-run/);
  await assert.rejects(releaseMain(['--repo', ''], hooks), /Use --repo/);
});
