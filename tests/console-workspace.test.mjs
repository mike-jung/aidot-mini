import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('Console editor, log bounds, authentication and restart application', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-console-'));
  const workspace = path.join(temp, 'workspace'), log = path.join(temp, 'log');
  fs.cpSync(path.join(root, 'workspace'), workspace, {recursive: true});
  fs.writeFileSync(path.join(temp, 'empty.env'), '');
  fs.mkdirSync(log);
  const key = randomBytes(32).toString('hex');
  const env = {...process.env, ENV_FILE: path.join(temp, 'empty.env'), APP_WORKSPACE: workspace, DATA_DIR: path.join(temp, 'data'), DB_FILE: path.join(temp, 'app.db'), ADMIN_TOKEN: key, PORT: '0', HOST: '127.0.0.1', HTTPS_ENABLED: 'false', LOG_DIR: log, LOG_TO_FILE: 'false', CONSOLE_LANGUAGE: 'en'};
  let child, base;
  async function start() {
    child = fork(path.join(root, 'start.js'), [], {env, execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
    let stderr = ''; child.stderr.on('data', value => stderr += value);
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(stderr || 'startup timeout')); }, 30000);
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Exit ' + code + ': ' + stderr)); });
      child.on('message', value => { if (value.type === 'ready') { clearTimeout(timer); resolve(value.port); } });
    }); base = 'http://127.0.0.1:' + port;
  }
  async function stop() { if (!child || child.exitCode !== null) return; await new Promise(resolve => { const timer = setTimeout(() => child.kill('SIGKILL'), 5000); child.once('exit', () => {clearTimeout(timer);resolve();}); child.send({type: 'aidot:shutdown'}); }); }
  async function request(url, method = 'GET', body, headers = {Authorization: 'Bearer ' + key}) {
    const response = await fetch(base + url, {method, headers: {'Content-Type': 'application/json', ...headers}, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: response.status, body: await response.json()};
  }
  try {
    await start();
    const url = '/admin/workspace/file?path=controller%2FNoteController.js';
    for (const endpoint of [url, '/admin/workspace/files', '/admin/logs/files', '/admin/logs/tail']) assert.equal((await request(endpoint, 'GET', undefined, {})).status, 401);
    const listing = (await request('/admin/workspace/files')).body.data;
    assert.equal(listing.files.find(f => f.path === 'controller/meta/NoteController.meta.json').writable, false);
    assert.equal(listing.files.find(f => f.path === 'migrations/002_create_note.sql').writable, false);
    let opened = (await request(url)).body.data;
    const payload = {path: opened.path, revision: opened.revision, workspaceId: opened.workspaceId, content: opened.content};
    assert.equal((await request('/admin/workspace/file', 'PUT', {...payload, content: '@Controller('})).status, 422);
    assert.equal((await request(url)).body.data.revision, payload.revision);
    assert.equal((await request('/admin/workspace/file', 'PUT', {...payload, workspaceId: 'changed'})).status, 409);
    assert.equal((await request('/admin/workspace/file', 'PUT', {...payload, content: 'x'.repeat(65537)})).status, 413);
    for (const name of ['../package.json', 'controller/../../package.json', '/etc/passwd', 'controller\\NoteController.js', 'controller/meta/../../../package.json']) assert.ok((await request('/admin/workspace/file?path=' + encodeURIComponent(name))).status >= 400);
    for (const name of ['controller/meta/NoteController.meta.json', 'migrations/002_create_note.sql']) assert.equal((await request('/admin/workspace/file', 'PUT', {...payload, path: name})).status, 403);
    const outside = path.join(temp, 'outside.js'); fs.writeFileSync(outside, 'private fixture');
    const linked = path.join(workspace, 'controller/Linked.js');
    fs.symlinkSync(outside, linked);
    assert.equal((await request('/admin/workspace/file?path=controller/Linked.js')).status, 403);
    assert.equal((await request('/admin/workspace/file', 'PUT', {...payload, path: 'controller/Linked.js'})).status, 403);
    fs.unlinkSync(linked);
    const modified = payload.content.replace("'/api/notes'", "'/api/journal'");
    const saved = await request('/admin/workspace/file', 'PUT', {...payload, content: modified});
    assert.equal(saved.status, 200); assert.equal(saved.body.data.restartRequired, true);
    assert.equal(fs.readFileSync(path.join(workspace, opened.path), 'utf8'), modified);
    assert.equal((await request('/admin/workspace/file', 'PUT', payload)).status, 409);
    // ID/password sessions must send CSRF on writes, even after successful authentication.
    const login = await fetch(base + '/admin/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token: key})});
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/admin/workspace/file', 'PUT', {...payload, revision: saved.body.data.revision}, {Cookie: cookie})).status, 403);
    assert.equal((await request('/api/notes')).status, 200); // active routes do not change during save
    fs.writeFileSync(path.join(log, 'server.log'), '[INFO] old\n'.repeat(30000) + '[ERROR] console-target <script>alert(1)</script>\n');
    const tail = (await request('/admin/logs/tail?level=error&search=console-target')).body.data;
    assert.ok(tail.bytesRead <= 131072); assert.equal(tail.truncated, true); assert.equal(tail.lines.length, 1);
    assert.match(tail.lines[0], /<script>/);
    assert.equal((await request('/admin/logs/tail?file=../outside.js')).status, 400);
    await stop(); await start();
    assert.equal((await request('/api/notes')).status, 404); assert.equal((await request('/api/journal')).status, 200);
    assert.equal((await request('/api/journal')).body.data[0].title, 'First note');
    assert.equal((await request('/admin/workspace/files')).body.data.restartRequired, false);
  } finally { await stop(); fs.rmSync(temp, {recursive: true, force: true}); }
});
