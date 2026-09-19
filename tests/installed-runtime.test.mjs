import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { configure, configuration, ownedRoot, uninstall, runtimeEnvironment, defaultDataDir, dataRoot } from '../deploy/installed/lifecycle.mjs';
import { parseArguments } from '../deploy/installed/launch.mjs';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launcher = path.join(app, 'deploy/installed/launch.mjs');
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aidot installed 한글 '));
const port = async () => {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
};
function cli(root, command, args = [], options = {}) {
  return spawnSync(process.execPath, [launcher, command, '--data-dir', root, ...args], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 30000, ...options });
}
function start(root, args = [], executable = launcher) {
  const child = spawn(process.execPath, [executable, 'start', '--data-dir', root, ...args], { cwd: os.tmpdir(), env: { ...process.env, DB_FILE: '/invalid/never-write.db', APP_WORKSPACE: '/invalid/workspace', PUBLIC_DIR: '/invalid/public', PORT: '17' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  return {
    child,
    ready: new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Installed startup timed out: ${output}`)), 30000);
      const onExit = code => { clearTimeout(timer); reject(new Error(`Installed server exited ${code}: ${output}`)); };
      child.once('exit', onExit);
      child.stdout.on('data', () => {
        for (const line of output.split('\n')) {
          try { const value = JSON.parse(line); if (value.event === 'ready') { clearTimeout(timer); child.off('exit', onExit); resolve(value); return; } } catch {}
        }
      });
    }),
    output: () => output,
  };
}
async function exit(child) { if (child.exitCode !== null) return; await Promise.race([once(child, 'exit'), new Promise((_, reject) => setTimeout(() => reject(new Error('Supervisor did not exit')), 10000).unref())]); }
function treeHash(root) {
  const result = {};
  function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else result[path.relative(root, file)] = createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } }
  walk(root); return result;
}

test('installed setup validates port, SQLite filenames, TLS host policy and leaves invalid paths untouched', async () => {
  const tmp = temporary(); const root = path.join(tmp, 'state');
  try {
    for (const options of [{ port: 0 }, { port: 65536 }, { database: '../escape.db' }, { database: 'CON.db' }, { database: 'db.sqlite;drop' }, { host: '0.0.0.0' }, { profile: 'missing' }]) await assert.rejects(configure(root, options));
    assert.equal(fs.existsSync(root), false);
    const valid = await configure(root, { port: 9010, database: 'custom.sqlite', validateOnly: true });
    assert.equal(valid.valid, true); assert.equal(fs.existsSync(root), false);
    await configure(root, { port: 9010, database: 'custom.sqlite' });
    assert.equal(configuration(root).port, 9010); assert.equal(configuration(root).databaseFile, path.join(root, 'db/custom.sqlite'));
    const unchanged = await configure(root); assert.equal(unchanged.port, 9010); assert.equal(unchanged.database, 'custom.sqlite');
    await assert.rejects(configure(root, { profile: 'product' }), /database/);
    await configure(root, { profile: 'product', database: 'product.db' });
    assert.ok(fs.existsSync(path.join(root, 'workspaces/product/migrations/sqlite')));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('installed arguments are explicit and per-user defaults isolate environment state', () => {
  assert.equal(defaultDataDir({ XDG_DATA_HOME: '/tmp/xdg' }, 'linux'), '/tmp/xdg/aidot-mini');
  assert.throws(() => defaultDataDir({ XDG_DATA_HOME: 'relative' }, 'linux'), /absolute/);
  assert.throws(() => dataRoot(os.homedir()), /dedicated/);
  assert.throws(() => dataRoot(app), /dedicated/);
  assert.throws(() => parseArguments(['configure', '--port', '9000', '--port', '9001']), /Duplicate/);
  assert.throws(() => parseArguments(['start', '--database', 'other.db']), /Unsupported/);
  assert.throws(() => parseArguments(['configure', '--purge']), /Unsupported/);
  assert.deepEqual(parseArguments(['account', '--stdin', '--reset']).accountArgs, ['--stdin', '--reset']);
});

test('installer setup preserves edited workspace and uploads during reconfiguration', async () => {
  const tmp = temporary(); const root = path.join(tmp, 'state');
  try {
    await configure(root);
    const file = path.join(root, 'workspaces/note/controller/NoteController.js');
    fs.appendFileSync(file, '\n// user edit\n'); fs.writeFileSync(path.join(root, 'public/user-upload.txt'), 'preserve');
    await configure(root, { port: 9901 });
    assert.match(fs.readFileSync(file, 'utf8'), /user edit/);
    assert.equal(fs.readFileSync(path.join(root, 'public/user-upload.txt'), 'utf8'), 'preserve');
    const env = runtimeEnvironment(root);
    assert.equal(env.DB_FILE, path.join(root, 'db/app.db'));
    assert.equal(env.APP_WORKSPACE, path.join(root, 'workspaces/note'));
    assert.equal(env.PUBLIC_DIR, path.join(root, 'public'));
    assert.equal(env.DATA_DIR, path.join(root, 'cache'));
    assert.equal(env.ADMIN_ACCOUNT_FILE, path.join(root, 'accounts/admin-account.json'));
    assert.equal(env.ENV_FILE, path.join(root, 'config/runtime.env'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('purge preserves unowned data and refuses linked or relocated marked directories', async () => {
  const tmp = temporary(); const root = path.join(tmp, 'state'); const outside = path.join(tmp, 'outside');
  fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'keep.txt'), 'safe');
  try {
    await assert.rejects(configure(outside), /nonempty unmarked/);
    await assert.rejects(uninstall(outside, { purge: true }), /marker missing/);
    await configure(root);
    const moved = path.join(tmp, 'moved'); fs.renameSync(root, moved);
    await assert.rejects(uninstall(moved, { purge: true }), /does not match/); fs.renameSync(moved, root);
    const link = path.join(root, 'public/external');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(uninstall(root, { purge: true }), /contains a link/);
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'safe');
    fs.unlinkSync(link);
    const preserve = await uninstall(root); assert.equal(preserve.purged, false); assert.equal(fs.existsSync(root), true);
    const purge = await uninstall(root, { purge: true }); assert.equal(purge.purged, true); assert.equal(fs.existsSync(root), false);
    assert.equal(fs.existsSync(path.join(outside, 'keep.txt')), true);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('purge refuses hardlinks before deleting owned files', async () => {
  const tmp = temporary(); const root = path.join(tmp, 'state');
  try {
    await configure(root); const external = path.join(tmp, 'external.txt'); fs.writeFileSync(external, 'outside');
    fs.linkSync(external, path.join(root, 'public/hardlink'));
    await assert.rejects(uninstall(root, { purge: true }), /hard-linked/);
    assert.equal(fs.existsSync(path.join(root, 'config/installation.json')), true);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('installed CLI runs Note CRUD from a Korean space path, persists SQLite, and safely stops its own process', async () => {
  const tmp = temporary(); const root = path.join(tmp, '사용자 AppData'); let instance;
  try {
    assert.equal(cli(root, 'configure', ['--port', String(await port())]).status, 0);
    const account = cli(root, 'account', ['--stdin'], { input: JSON.stringify({ username: 'installed-admin', password: 'installed-verification-password' }) });
    assert.equal(account.status, 0, account.stderr);
    const token = cli(root, 'token'); assert.equal(token.status, 0, token.stderr); assert.match(token.stdout.trim(), /^\S{32,256}$/);
    instance = start(root); const info = await instance.ready;
    let response = await fetch(`${info.url}/health/ready`); assert.equal(response.status, 200);
    response = await fetch(`${info.url}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'installed persistent', content: '한글 with spaces' }) });
    assert.equal(response.status, 201); const body = await response.json(); const id = body.data.insertId; assert.ok(id);
    const current = cli(root, 'status'); assert.equal(current.status, 0, current.stderr); assert.equal(JSON.parse(current.stdout).running, true);
    const busyConfig = cli(root, 'configure', ['--port', '9801']); assert.notEqual(busyConfig.status, 0); assert.match(busyConfig.stderr, /Stop/);
    const stop = cli(root, 'stop'); assert.equal(stop.status, 0, stop.stderr); await exit(instance.child);
    assert.equal(instance.child.exitCode, 0, instance.output());
    assert.ok(fs.existsSync(path.join(root, 'db/app.db'))); assert.ok(fs.existsSync(path.join(root, 'accounts/admin-account.json')));
    instance = start(root); await instance.ready;
    response = await fetch(`${info.url}/api/notes/${id}`); assert.equal(response.status, 200); assert.equal((await response.json()).data.title, 'installed persistent');
    response = await fetch(`${info.url}/api/notes/${id}`, { method: 'DELETE' }); assert.equal(response.status, 200);
    const remove = cli(root, 'uninstall', ['--purge']); assert.equal(remove.status, 0, remove.stderr); await exit(instance.child);
    assert.equal(fs.existsSync(root), false);
  } finally { if (instance && instance.child.exitCode === null) { cli(root, 'stop'); await exit(instance.child); } fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('an unrelated live PID or forged control endpoint is never terminated', async () => {
  const tmp = temporary(); const root = path.join(tmp, 'state');
  try {
    await configure(root);
    fs.writeFileSync(path.join(root, 'state/supervisor.json'), JSON.stringify({ schema: 1, root, nonce: 'a'.repeat(64), pid: process.pid, port: await port() }));
    const outcome = cli(root, 'stop'); assert.notEqual(outcome.status, 0);
    const purge = cli(root, 'uninstall', ['--purge']); assert.notEqual(purge.status, 0);
    assert.equal(fs.existsSync(path.join(root, 'config/installation.json')), true);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('installed payload remains byte-identical while all runtime writes use the data directory', async () => {
  const tmp = temporary(); const payload = path.join(tmp, '읽기 전용 app'); const root = path.join(tmp, '별도 AppData'); let instance;
  try {
    fs.mkdirSync(payload);
    for (const name of ['src', 'workspace', 'start.js', 'package.json', 'node_modules']) fs.cpSync(path.join(app, name), path.join(payload, name), { recursive: true });
    fs.mkdirSync(path.join(payload, 'scripts'));
    fs.copyFileSync(path.join(app, 'scripts/compile-workspace.mjs'), path.join(payload, 'scripts/compile-workspace.mjs'));
    fs.cpSync(path.join(app, 'deploy/installed'), path.join(payload, 'deploy/installed'), { recursive: true });
    const before = treeHash(payload);
    const executable = path.join(payload, 'deploy/installed/launch.mjs');
    const configured = spawnSync(process.execPath, [executable, 'configure', '--data-dir', root, '--port', String(await port())], { encoding: 'utf8' });
    assert.equal(configured.status, 0, configured.stderr);
    for (const name of Object.keys(before)) fs.chmodSync(path.join(payload, name), 0o444);
    instance = start(root, [], executable); const info = await instance.ready;
    const response = await fetch(`${info.url}/health/ready`); assert.equal(response.status, 200);
    const stopped = cli(root, 'stop'); assert.equal(stopped.status, 0, stopped.stderr); await exit(instance.child);
    assert.deepEqual(treeHash(payload), before);
    assert.equal(fs.existsSync(path.join(payload, 'data')), false);
    assert.equal(fs.existsSync(path.join(payload, 'log')), false);
    assert.equal(fs.existsSync(path.join(payload, '.aidot-cache')), false);
  } finally { if (instance && instance.child.exitCode === null) { cli(root, 'stop'); await exit(instance.child); } fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('installed Product API retains canonical admin contract and isolated migrations', async () => {
  const tmp = temporary(); const root = path.join(tmp, 'product data'); let instance;
  try {
    assert.equal(cli(root, 'configure', ['--profile', 'product', '--database', 'inventory.db', '--port', String(await port())]).status, 0);
    instance = start(root); const info = await instance.ready;
    let response = await fetch(`${info.url}/api/product`); assert.equal(response.status, 200);
    response = await fetch(`${info.url}/api/product`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'installed protected', price: 42 }) });
    assert.equal(response.status, 401);
    const token = fs.readFileSync(path.join(root, 'accounts/admin-token'), 'utf8').trim();
    response = await fetch(`${info.url}/api/product`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'installed protected', price: 42 }) });
    assert.equal(response.status, 201); const created = await response.json(); assert.ok(created.data.insertId);
    assert.equal(fs.existsSync(path.join(root, 'db/inventory.db')), true);
    assert.equal(cli(root, 'uninstall', ['--purge']).status, 0); await exit(instance.child);
  } finally { if (instance && instance.child.exitCode === null) { cli(root, 'stop'); await exit(instance.child); } fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('installed robot mode starts the optional module and shuts it down through the same supervisor', async () => {
  const tmp = temporary(); const root = path.join(tmp, 'robot data'); let instance;
  try {
    assert.equal(cli(root, 'configure', ['--port', String(await port())]).status, 0);
    instance = start(root, ['--robot']); const info = await instance.ready;
    const token = fs.readFileSync(path.join(root, 'accounts/admin-token'), 'utf8').trim();
    let response = await fetch(`${info.url}/admin/features`, { headers: { Authorization: `Bearer ${token}` } }); assert.equal(response.status, 200);
    assert.equal((await response.json()).data.robot, true);
    response = await fetch(`${info.url}/admin/robot/settings`, { headers: { Authorization: `Bearer ${token}` } }); assert.equal(response.status, 200);
    assert.equal(cli(root, 'stop').status, 0); await exit(instance.child);
    assert.equal(instance.child.exitCode, 0);
  } finally { if (instance && instance.child.exitCode === null) { cli(root, 'stop'); await exit(instance.child); } fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('purge waits for an owned child to finish draining after a supervisor crash', async () => {
  const tmp = temporary(); const root = path.join(tmp, 'crash data'); let instance, socket;
  try {
    assert.equal(cli(root, 'configure', ['--port', String(await port())]).status, 0);
    instance = start(root); const info = await instance.ready;
    socket = net.connect({ host: '127.0.0.1', port: info.port }); socket.on('error', () => {});
    await once(socket, 'connect');
    socket.write('POST /api/notes HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 10000\r\n\r\n{');
    await new Promise(resolve => setTimeout(resolve, 100));
    instance.child.kill('SIGKILL'); await exit(instance.child);
    const blocked = cli(root, 'uninstall', ['--purge']);
    assert.notEqual(blocked.status, 0, 'A draining child must prevent data deletion');
    assert.match(blocked.stderr, /child is still shutting down/);
    assert.equal(fs.existsSync(path.join(root, 'db/app.db')), true);
    socket.destroy();
    const deadline = Date.now() + 15000;
    let outcome;
    do {
      await new Promise(resolve => setTimeout(resolve, 100));
      outcome = cli(root, 'uninstall', ['--purge']);
      if (outcome.status === 0) break;
    } while (Date.now() < deadline);
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.equal(fs.existsSync(root), false);
  } finally { socket?.destroy(); if (instance && instance.child.exitCode === null && instance.child.signalCode === null) { cli(root, 'stop'); await exit(instance.child); } fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('Minimal to Full transition adds missing nested public assets and preserves user edits', () => {
  const tmp = temporary(); const payload = path.join(tmp, 'payload'); const root = path.join(tmp, 'user state');
  try {
    fs.mkdirSync(payload);
    fs.cpSync(path.join(app, 'workspace'), path.join(payload, 'workspace'), { recursive: true });
    fs.cpSync(path.join(app, 'deploy/installed'), path.join(payload, 'deploy/installed'), { recursive: true });
    const executable = path.join(payload, 'deploy/installed/launch.mjs');
    const setup = () => spawnSync(process.execPath, [executable, 'configure', '--data-dir', root], { encoding: 'utf8' });
    assert.equal(setup().status, 0);
    const before = fs.readFileSync(path.join(root, 'config/installation.json'), 'utf8');
    // Also support state written by the earlier marker-only seeding implementation.
    fs.writeFileSync(path.join(root, 'config/public-seeded.json'), '{"seededAt":"old minimal"}');
    fs.mkdirSync(path.join(root, 'public/assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public/assets/edited.js'), 'user edit');
    fs.writeFileSync(path.join(root, 'public/upload.txt'), 'user upload');
    fs.mkdirSync(path.join(payload, 'public/assets'), { recursive: true });
    fs.writeFileSync(path.join(payload, 'public/index.html'), 'new Full console');
    fs.writeFileSync(path.join(payload, 'public/assets/edited.js'), 'bundled original');
    fs.writeFileSync(path.join(payload, 'public/assets/added.js'), 'new nested asset');
    const upgraded = setup(); assert.equal(upgraded.status, 0, upgraded.stderr);
    assert.equal(fs.readFileSync(path.join(root, 'public/index.html'), 'utf8'), 'new Full console');
    assert.equal(fs.readFileSync(path.join(root, 'public/assets/added.js'), 'utf8'), 'new nested asset');
    assert.equal(fs.readFileSync(path.join(root, 'public/assets/edited.js'), 'utf8'), 'user edit');
    assert.equal(fs.readFileSync(path.join(root, 'public/upload.txt'), 'utf8'), 'user upload');
    assert.equal(fs.readFileSync(path.join(root, 'config/installation.json'), 'utf8'), before);
    // Going back to Minimal preserves all user state, including the former console.
    fs.rmSync(path.join(payload, 'public'), { recursive: true }); assert.equal(setup().status, 0);
    assert.equal(fs.readFileSync(path.join(root, 'public/index.html'), 'utf8'), 'new Full console');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
