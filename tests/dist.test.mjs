import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { policy, regularFile, verifyBinary, sha256 } from '../scripts/dist/dist.mjs';
import { createPlan } from '../scripts/dist/release-github.mjs';

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
