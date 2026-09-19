#!/usr/bin/env node
// Runs a native release payload with isolated state; does not touch an existing installation.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { sha256 } from './dist.mjs';

const { values } = parseArgs({ options: { payload: { type: 'string' }, output: { type: 'string' } } });
if (!values.payload) throw new Error('Usage: node scripts/dist/verify-runtime.mjs --payload EXTRACTED_DIRECTORY [--output report.json]');
const payload = path.resolve(values.payload), manifest = JSON.parse(fs.readFileSync(path.join(payload, 'manifest.json')));
assert.equal(manifest.platform, process.platform === 'win32' ? 'win' : process.platform, 'Use a native target OS to validate this payload');
assert.equal(manifest.arch, process.arch, 'Use a native target architecture to validate this payload');
function integrity() {
  for (const [file, hash] of Object.entries(manifest.files)) assert.equal(sha256(fs.readFileSync(path.join(payload, file))), hash, `Payload changed: ${file}`);
}
integrity();
const binary = path.join(payload, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const launcher = path.join(payload, 'app/deploy/installed/launch.mjs');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-release-qa-')), data = path.join(temporary, 'state');
const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
const evidence = { platform: process.platform, arch: process.arch, version: manifest.version, node: '', variant: manifest.variant, checks: [], passed: false };
const record = value => evidence.checks.push(value);
let server, output = '';
function command(args) {
  const result = spawnSync(binary, [launcher, ...args, '--data-dir', data], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}
async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { ...options, signal: AbortSignal.timeout(3000) });
  const text = await response.text();
  return { status: response.status, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
}
try {
  evidence.node = spawnSync(binary, ['--version'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(evidence.node, `v${manifest.nodeVersion}`); record('Bundled Node version and all payload SHA-256 values');
  command(['configure', '--port', String(port), '--database', 'release-qa.db', '--profile', 'product']);
  record('First-run Product profile and SQLite settings');
  server = spawn(binary, [launcher, 'start', '--data-dir', data], { stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => { output += chunk; }); server.stderr.on('data', chunk => { output += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (server.exitCode !== null) throw new Error(`Installed server exited early: ${output}`);
    try { if ((await request('/health/ready')).status === 200) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Health not ready: ${output}`); record('Native installed server health ready');
  const rows = await request('/api/product/'); assert.equal(rows.status, 200); record('Copied Product controller/service/sql execute against SQLite');
  const unauthorized = await request('/api/product/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'release QA', price: 123 }) });
  assert.equal(unauthorized.status, 401); record('Anonymous write rejected');
  const token = fs.readFileSync(path.join(data, 'accounts/admin-token'), 'utf8').trim();
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const created = await request('/api/product/', { method: 'POST', headers, body: JSON.stringify({ name: 'release QA', price: 123, memo: 'temporary QA' }) });
  assert.equal(created.status, 201); assert.ok(created.body.data.insertId); record('Authenticated Product create');
  const updated = await request(`/api/product/${created.body.data.insertId}`, { method: 'PUT', headers, body: JSON.stringify({ name: 'release QA updated', price: 456 }) });
  assert.equal(updated.status, 200);
  const removed = await request(`/api/product/${created.body.data.insertId}`, { method: 'DELETE', headers }); assert.equal(removed.status, 200); record('Authenticated Product update/delete');
  if (manifest.variant === 'full') { assert.equal((await request('/')).status, 200); record('Built-in console served from writable user state'); }
  const status = JSON.parse(command(['status'])); assert.equal(status.active, true); record('Authenticated instance ownership/status');
  command(['stop']);
  await new Promise((resolve, reject) => {
    if (server.exitCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error('Supervisor did not stop')), 10000); server.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  record('Graceful supervisor stop');
  assert.ok(fs.existsSync(path.join(data, 'db/release-qa.db'))); command(['uninstall']);
  assert.ok(fs.existsSync(path.join(data, 'db/release-qa.db'))); record('Uninstall keep-data option retains SQLite');
  command(['uninstall', '--purge']); assert.equal(fs.existsSync(data), false); record('Uninstall purge clears owned state tree');
  integrity(); record('Installed application files remain byte-identical'); evidence.passed = true;
} finally {
  if (server && server.exitCode === null) { try { command(['stop']); } catch {} server.kill(); }
  fs.rmSync(temporary, { recursive: true, force: true });
  if (values.output) fs.writeFileSync(path.resolve(values.output), JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify(evidence, null, 2));
