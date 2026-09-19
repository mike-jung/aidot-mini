import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureBuildDependencies, ROOT } from '../scripts/prepare-dependencies.mjs';
import { findPython } from '../scripts/run-python.mjs';
import { findMakensis, androidToolchain } from '../scripts/dist/build-tools.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot 빌드 & spaces-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(ROOT, name), path.join(root, name));
  return root;
}
function compiler(root, version = '0.28.2') {
  const base = path.join(root, 'node_modules/esbuild-wasm');
  fs.mkdirSync(path.join(base, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(base, 'LICENSE.md'), 'fixture');
  fs.writeFileSync(path.join(base, 'lib/browser.js'), 'export {};');
  fs.writeFileSync(path.join(base, 'esbuild.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
}

test('a complete pinned compiler does not reinstall or contact npm', t => {
  const root = fixture(t); compiler(root);
  assert.equal(ensureBuildDependencies({ root, run() { assert.fail('Unexpected npm call'); } }), path.join(root, 'node_modules/esbuild-wasm'));
});

test('a fresh source installs dependencies through Node with spaces in the npm path', t => {
  const root = fixture(t), cli = path.join(root, 'npm cli & fixture.cjs');
  fs.writeFileSync(cli, `const fs=require('node:fs'),path=require('node:path');
    const root=process.cwd(); fs.writeFileSync('npm-arguments.json',JSON.stringify(process.argv.slice(2)));
    (${compiler.toString()})(root);`);
  ensureBuildDependencies({ root, env: { ...process.env, npm_execpath: cli }, log() {} });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'npm-arguments.json'))), ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/esbuild-wasm/package.json'))).version, '0.28.2');
});

test('an incomplete or wrong-version compiler is repaired before packaging', t => {
  const root = fixture(t); compiler(root, '0.0.1');
  let calls = 0;
  const env = { ...process.env, npm_execpath: path.join(ROOT, 'scripts/prepare-dependencies.mjs') };
  const run = (command, args, options) => { calls++; assert.equal(options.shell, false); compiler(root); return { status: 0 }; };
  ensureBuildDependencies({ root, env, run, log() {} });
  fs.rmSync(path.join(root, 'node_modules/esbuild-wasm/esbuild.wasm'));
  ensureBuildDependencies({ root, env, run, log() {} });
  assert.equal(calls, 2);
});

test('offline dependency failure gives recovery steps and never retries online', t => {
  const root = fixture(t); let calls = 0;
  assert.throws(() => ensureBuildDependencies({ root, offline: true,
    env: { npm_execpath: path.join(ROOT, 'scripts/prepare-dependencies.mjs') }, log() {},
    run(command, args) { calls++; assert.ok(args.includes('--offline')); return { status: 1 }; },
  }), /local npm cache.*online/);
  assert.equal(calls, 1);
});

test('unreviewed dependencies fail before any installation', t => {
  const root = fixture(t), file = path.join(root, 'package.json'), pkg = JSON.parse(fs.readFileSync(file));
  pkg.dependencies.extra = '1.0.0'; fs.writeFileSync(file, JSON.stringify(pkg));
  assert.throws(() => ensureBuildDependencies({ root, run() { assert.fail(); } }), /Unreviewed/);
});

test('Python discovery handles Windows names and explicit paths without a shell', () => {
  const calls = [];
  assert.equal(findPython({ platform: 'win32', env: {}, run(command, args, options) {
    calls.push(command); assert.equal(options.shell, false);
    return command === 'py' ? { status: 0, stderr: 'Python 3.12.0' } : { status: 1 };
  } }), 'py');
  assert.deepEqual(calls, ['python', 'python3', 'py']);
  assert.throws(() => findPython({ env: { AIDOT_PYTHON: 'missing' }, run() { return { error: new Error('missing') }; } }), /Python 3 was not found/);
});

test('NSIS discovery finds Program Files and preserves an explicit executable', () => {
  const expected = 'C:\\Program Files (x86)\\NSIS\\makensis.exe';
  assert.equal(findMakensis({ platform: 'win32', env: {}, run(command) {
    return command === expected ? { status: 0, stdout: 'v3.12' } : { status: 1 };
  } }), expected);
  assert.throws(() => findMakensis({ explicit: 'missing', run(command) { assert.equal(command, 'missing'); return { status: 1 }; } }), /NSIS 3 is required/);
});

test('Android preflight distinguishes a missing JDK from a missing SDK', t => {
  const root = fixture(t);
  assert.throws(() => androidToolchain(root, { env: {}, run() { return { status: 1 }; } }), /JDK 17/);
  const run = command => ({ status: 0, stdout: command.endsWith('javac') ? 'javac 17.0.20' : 'openjdk version "17.0.20"' });
  assert.throws(() => androidToolchain(root, { env: {}, run }), /SDK platform 36/);
  const sdk = path.join(root, 'SDK with spaces'); fs.mkdirSync(path.join(sdk, 'platforms/android-36'), { recursive: true });
  fs.writeFileSync(path.join(sdk, 'platforms/android-36/android.jar'), 'fixture');
  assert.equal(androidToolchain(root, { env: { ANDROID_HOME: sdk }, run }).sdk, sdk);
});
