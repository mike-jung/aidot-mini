import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { installPayload, validateInstallPaths, main } from '../deploy/windows/setup-helper.mjs';

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-windows-setup-test-'));
  const payload = path.join(root, 'payload');
  const install = path.join(root, 'program');
  const state = path.join(root, 'state');
  const write = (name, content = name) => {
    const target = path.join(payload, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  write('runtime/node.exe');
  write('app/deploy/installed/launch.mjs');
  return { root, payload, install, state, write, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
};
const options = { port: 19801, database: 'test.db', profile: 'note' };

test('installer transaction preserves user workspace and unrelated files across upgrade', async () => {
  const f = fixture();
  try {
    f.write('app/retired.mjs', 'old');
    await installPayload(f.install, f.state, options, f.payload);
    fs.writeFileSync(path.join(f.install, 'keep.txt'), 'unrelated');
    const workspace = path.join(f.state, 'workspaces/note/keep.txt');
    fs.writeFileSync(workspace, 'user source');
    fs.rmSync(path.join(f.payload, 'app/retired.mjs'));
    f.write('app/current.mjs', 'new');
    await installPayload(f.install, f.state, { ...options, port: 19802 }, f.payload);
    assert.equal(fs.existsSync(path.join(f.install, 'app/retired.mjs')), false);
    assert.equal(fs.readFileSync(path.join(f.install, 'keep.txt'), 'utf8'), 'unrelated');
    assert.equal(fs.readFileSync(workspace, 'utf8'), 'user source');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.state, 'config/installation.json'))).port, 19802);
  } finally { f.clean(); }
});

test('installer restores prior files and settings after a copy failure', async () => {
  const f = fixture();
  const originalCopy = fs.copyFileSync;
  try {
    f.write('app/first.mjs', 'original');
    await installPayload(f.install, f.state, options, f.payload);
    const config = fs.readFileSync(path.join(f.state, 'config/installation.json'));
    f.write('app/first.mjs', 'changed');
    f.write('app/failure.mjs', 'fail here');
    let injected = false;
    fs.copyFileSync = function (source, target, ...rest) {
      if (!injected && String(source) === path.join(f.payload, 'app/failure.mjs')) {
        injected = true;
        throw Object.assign(new Error('simulated disk failure'), { code: 'EIO' });
      }
      return originalCopy.call(fs, source, target, ...rest);
    };
    await assert.rejects(installPayload(f.install, f.state, { ...options, port: 19803 }, f.payload), /restored/);
    assert.equal(fs.readFileSync(path.join(f.install, 'app/first.mjs'), 'utf8'), 'original');
    assert.equal(fs.existsSync(path.join(f.install, 'app/failure.mjs')), false);
    assert.deepEqual(fs.readFileSync(path.join(f.state, 'config/installation.json')), config);
  } finally { fs.copyFileSync = originalCopy; f.clean(); }
});

test('unsafe roots, nonempty unowned folders and junctions are rejected', async () => {
  const f = fixture();
  try {
    assert.throws(() => validateInstallPaths(f.install, path.join(f.install, 'data')), /separate/);
    assert.throws(() => validateInstallPaths(path.parse(f.root).root, f.state), /separate/);
    fs.mkdirSync(f.install);
    fs.writeFileSync(path.join(f.install, 'unrelated.txt'), 'keep');
    await assert.rejects(installPayload(f.install, f.state, options, f.payload), /inventory/);
    const linked = path.join(f.root, 'linked');
    fs.symlinkSync(f.install, linked, 'junction');
    assert.throws(() => validateInstallPaths(linked, f.state), /links|junctions/);
    assert.equal(fs.existsSync(f.state), false);
  } finally { f.clean(); }
});

test('setup INI reflects current runtime settings and does not overwrite an output file', async () => {
  const f = fixture();
  try {
    await installPayload(f.install, f.state, { ...options, database: 'custom.sqlite' }, f.payload);
    const output = path.join(f.root, 'settings.ini');
    await main(['config-ini', '--data-dir', f.state, '--output', output]);
    assert.equal(fs.readFileSync(output, 'utf8'), '[aidot-mini]\r\nport=19801\r\ndatabase=custom.sqlite\r\nprofile=note\r\n');
    await assert.rejects(main(['config-ini', '--data-dir', f.state, '--output', output]), /exist/i);
  } finally { f.clean(); }
});

test('uninstall generator lists exact files, escapes dollar signs and never recursively removes a folder', () => {
  const f = fixture();
  try {
    f.write('app/dollar$name.mjs');
    const output = path.join(f.root, 'uninstall.nsh');
    const result = spawnSync('python3', ['deploy/windows/create-uninstall-manifest.py', f.payload, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const source = fs.readFileSync(output, 'utf8');
    assert.match(source, /Delete "\$INSTDIR\\app\\dollar\$\$name\.mjs"/);
    assert.doesNotMatch(source, /RMDir\s+\/r/i);
    fs.symlinkSync(path.join(f.payload, 'runtime/node.exe'), path.join(f.payload, 'link'));
    const bad = spawnSync('python3', ['deploy/windows/create-uninstall-manifest.py', f.payload, output], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
  } finally { f.clean(); }
});
