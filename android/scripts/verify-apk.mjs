import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Fresh install and uninstall are restricted to this disposable AVD.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const apk = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.statSync(apk).isFile()) throw new Error('Usage: node android/scripts/verify-apk.mjs /path/to/x86_64-debug.apk');
const adbPath = process.env.ADB_PATH || 'adb';
const serial = process.env.ADB_SERIAL || 'emulator-5590';
const app = 'com.aidot.mini';
const adb = (args, options = {}) => execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, ...options }).trim();
assert.equal(adb(['emu', 'avd', 'name']).split(/[\r\n]+/)[0].trim(), 'aidot_mini_108_verify', 'This destructive test only runs on the dedicated aidot_mini_108_verify AVD');
const output = process.env.AIDOT_ANDROID_VERIFICATION_DIR || path.join(root, 'dist/android-verification');
fs.mkdirSync(output, { recursive: true });
const report = { version, apk: path.basename(apk), apkSha256: createHash('sha256').update(fs.readFileSync(apk)).digest('hex'), api: adb(['shell', 'getprop', 'ro.build.version.sdk']), abi: adb(['shell', 'getprop', 'ro.product.cpu.abi']), avd: 'aidot_mini_108_verify', checks: [], passed: 0, failed: 0 };
const pass = label => { report.checks.push(label); console.log('PASS ' + label); };
let forward;
async function until(fn, label, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const result = await fn(); if (result) return result; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(label);
}
try {
  // Our dedicated AVD owns all com.aidot.mini state used in this test.
  try { adb(['uninstall', app]); } catch {}
  assert.match(adb(['install', '-g', apk]), /Success/); pass('Debug APK installation');
  assert.match(adb(['shell', 'dumpsys', 'package', app]), new RegExp('versionName=' + version.replaceAll('.', '\\.'))); pass('Installed package version matches package.json');
  forward = adb(['forward', 'tcp:0', 'tcp:8901']);
  const base = 'http://127.0.0.1:' + forward;
  const call = async (method, url, body) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    return { status: response.status, body: await response.json() };
  };
  const ready = () => until(async () => (await call('GET', '/health/ready')).status === 200, 'Android server readiness timeout');
  adb(['shell', 'am', 'start', '-n', app + '/.MainActivity']); await ready(); pass('Foreground service starts embedded Node and SQLite migrations');
  const health = await call('GET', '/health'); assert.equal(health.body.version, version); report.node = health.body.node; pass('Running server version matches installed package');
  report.businessSourceHashes = {};
  for (const file of ['controller/NoteController.js', 'service/NoteService.js', 'sql/note.sql']) {
    const installed = execFileSync(adbPath, ['-s', serial, 'exec-out', 'run-as', app, 'cat', 'files/server/workspace/' + file], {timeout: 15000});
    const source = fs.readFileSync(path.join(root, 'workspace', file));
    assert.deepEqual(installed, source);
    report.businessSourceHashes[file] = createHash('sha256').update(source).digest('hex');
    pass('Identical packaged business source: ' + file);
  }
  assert.equal((await call('GET', '/admin/status')).status, 401); pass('Unauthenticated administration is denied');
  const created = await call('POST', '/api/notes', { title: 'Android ' + version + ' 설치 검증', body: 'SQLite persistence', requestCode: 'android-install' });
  assert.equal(created.status, 201); assert.equal(created.body.header.requestCode, 'android-install');
  const noteId = created.body.data.insertId; assert.ok(Number.isInteger(noteId)); pass('Unchanged controller/service/sql creates SQLite record');
  const read = await call('GET', '/api/notes/' + noteId); assert.equal(read.body.data.body, 'SQLite persistence'); pass('HTTP read returns created record');
  const probe = "import {Controller,GetMapping} from '@aidot/core/decorators.js';\nimport {DatabaseSync} from 'node:sqlite';\nimport {createHash} from 'node:crypto';\n@Controller('/api/android-probe')\nexport default class AndroidProbe { @GetMapping('/') probe(){const db=new DatabaseSync(':memory:');const row=db.prepare('SELECT 42 as value').get();db.close();return {platform:process.platform,node:process.version,sqlite:row.value,crypto:createHash('sha256').update('android').digest('hex')};}}\n";
  const script = 'echo ' + Buffer.from(probe).toString('base64') + ' | base64 -d > files/server/workspace/controller/AndroidProbe.js\n';
  adb(['shell', '-T', 'run-as', app, 'sh'], { input: script });
  adb(['shell', 'am', 'force-stop', app]); adb(['shell', 'am', 'start', '-n', app + '/.MainActivity']); await ready();
  const proof = await call('GET', '/api/android-probe'); assert.equal(proof.status, 200); assert.equal(proof.body.data.platform, 'android'); assert.equal(proof.body.data.sqlite, 42); assert.equal(proof.body.data.crypto, createHash('sha256').update('android').digest('hex')); report.runtimeProof = proof.body.data;
  pass('Android Bionic Node runs newly added canonical @aidot controller, WASM compiler, node:sqlite and node:crypto');
  assert.equal((await call('GET', '/api/notes/' + noteId)).body.data.body, 'SQLite persistence'); pass('Database survives force-stop and restart');
  const data = adb(['shell', 'run-as', app, 'ls', 'files/data']); assert.match(data, /app\.db/); assert.match(data, /admin-token/); pass('Database and admin state are stored in Android private app data');
  const tokenHash = createHash('sha256').update(adb(['exec-out', 'run-as', app, 'cat', 'files/data/admin-token'])).digest('hex');
  assert.match(adb(['install', '-r', '-g', apk]), /Success/); adb(['shell', 'am', 'start', '-n', app + '/.MainActivity']); await ready();
  assert.equal((await call('GET', '/api/notes/' + noteId)).body.data.body, 'SQLite persistence'); pass('APK reinstall with -r preserves private database');
  const updated = await call('PUT', '/api/notes/' + noteId, { title: 'Android updated', body: null }); assert.equal(updated.body.data.rowsAffected, 1);
  assert.equal((await call('GET', '/api/notes/' + noteId)).body.data.body, null); pass('HTTP update persists null semantics');
  const deleted = await call('DELETE', '/api/notes/' + noteId); assert.equal(deleted.body.data.rowsAffected, 1); assert.equal((await call('GET', '/api/notes/' + noteId)).status, 404); pass('HTTP deletion returns affected count and subsequent 404');
  await until(() => {
    adb(['shell', 'uiautomator', 'dump', '/data/local/tmp/aidot-mini-ui.xml']);
    const xml = adb(['shell', 'cat', '/data/local/tmp/aidot-mini-ui.xml']);
    if (!xml.includes('Local server is ready') || !xml.includes('DEVICE CONSOLE')) return false;
    fs.writeFileSync(path.join(output, 'android-ui.xml'), xml);
    return true;
  }, 'Native readiness and rendered WebView timeout', 30000);
  pass('Native ready indicator and actual WebView device console are rendered');
  const screen = execFileSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 }); fs.writeFileSync(path.join(output, 'android-installed.png'), screen);
  fs.writeFileSync(path.join(output, 'android-logcat.txt'), adb(['logcat', '-d', '-s', 'aidot-mini:I', 'AndroidRuntime:E', '*:S']));
  assert.match(adb(['uninstall', app]), /Success/); assert.equal(adb(['shell', 'pm', 'list', 'packages', app]), ''); pass('Uninstall removes package registration');
  assert.match(adb(['install', '-g', apk]), /Success/); adb(['shell', 'am', 'start', '-n', app + '/.MainActivity']); await ready();
  assert.equal((await call('GET', '/api/android-probe')).status, 404);
  assert.notEqual(createHash('sha256').update(adb(['exec-out', 'run-as', app, 'cat', 'files/data/admin-token'])).digest('hex'), tokenHash);
  pass('Fresh install after uninstall has no previous workspace file and creates new admin credentials');
  assert.match(adb(['uninstall', app]), /Success/);
  report.passed = report.checks.length;
} catch (error) {
  report.passed = report.checks.length; report.failed = 1; report.error = error.stack; process.exitCode = 1; console.error(error.stack);
  try { fs.writeFileSync(path.join(output, 'android-logcat.txt'), adb(['logcat', '-d', '-s', 'aidot-mini:I', 'AndroidRuntime:E', '*:S'])); } catch {}
} finally {
  try { adb(['shell', 'rm', '-f', '/data/local/tmp/aidot-mini-ui.xml']); } catch {}
  if (forward) try { adb(['forward', '--remove', 'tcp:' + forward]); } catch {}
  fs.writeFileSync(path.join(output, 'android-runtime-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, output }));
}
