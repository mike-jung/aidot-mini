import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = `Usage: node scripts/verify-workspace.mjs --workspace DIR [--migrations DIR] [--cases FILE]

Runs a temporary copy with a fresh SQLite database; original files are not changed.
Precompilation runs in a separate process that exits before the HTTP server starts.
Cases are a JSON array of {name?, method?, path, status, auth?: "admin", body?, expect?}.
Object expectations are subsets; array expectations require the exact length and order.
Without --cases, only startup, declarations and metadata are checked.
This is temporary application state, not an operating-system security sandbox.`;
const skipped = new Set(['.git', '.aidot-cache', 'meta', 'node_modules']);
const hashes = new Map();
const interrupted = new AbortController();
let temp;
let child;
let origin;
let token;
let output = '';
let signalCode;
const report = {
  result: 'FAIL',
  startupVerified: false,
  businessVerified: false,
  businessRequests: 0,
  businessAssertions: 0,
  completedCases: 0,
  cases: [],
  sourceUnchanged: false,
};

function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--workspace', '--migrations', '--cases'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    if (Object.hasOwn(result, flag)) throw new Error(`Duplicate option: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    result[flag] = path.resolve(value);
  }
  if (!result['--workspace']) throw new Error('--workspace is required');
  return result;
}

function readCases(file) {
  if (!file) return [];
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(Array.isArray(rows), 'Cases file must contain a JSON array');
  return rows.map((row, index) => {
    const label = `Case ${index + 1}`;
    assert.ok(row && typeof row === 'object' && !Array.isArray(row), `${label} must be an object`);
    for (const key of Object.keys(row)) {
      assert.ok(['name', 'method', 'path', 'body', 'status', 'auth', 'expect'].includes(key), `${label}: unknown field ${key}`);
    }
    const method = row.method ?? 'GET';
    assert.ok(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method), `${label}: unsupported method`);
    assert.ok(typeof row.path === 'string' && /^\/(?!\/)/.test(row.path) && !/[\\\s\x00-\x1f\x7f#]/.test(row.path), `${label}: path must be a local absolute HTTP route`);
    const parsed = new URL(row.path, 'http://workspace.invalid');
    assert.equal(parsed.origin, 'http://workspace.invalid', `${label}: external URLs are not allowed`);
    assert.ok(Number.isInteger(row.status) && row.status >= 200 && row.status <= 599, `${label}: status must be an integer from 200 to 599`);
    assert.ok(row.auth === undefined || row.auth === 'admin', `${label}: auth must be "admin" or omitted`);
    assert.ok(row.name === undefined || typeof row.name === 'string', `${label}: name must be a string`);
    assert.ok(!['GET', 'HEAD'].includes(method) || !Object.hasOwn(row, 'body'), `${label}: ${method} cannot have a body`);
    return { ...row, method, name: row.name || label };
  });
}

const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function copyTree(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Symlinks are not supported: ${source}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source).sort()) {
      if (!skipped.has(entry)) copyTree(path.join(source, entry), path.join(destination, entry));
    }
  } else if (stat.isFile()) {
    const digest = hash(source);
    fs.copyFileSync(source, destination);
    hashes.set(source, { digest, destination });
    assert.equal(hash(destination), digest, `Copy changed ${source}`);
  } else {
    throw new Error(`Only regular workspace files and directories are supported: ${source}`);
  }
}

function unchanged() {
  for (const [source, { digest, destination }] of hashes) {
    assert.equal(hash(source), digest, `Original file changed: ${source}`);
    assert.equal(hash(destination), digest, `Runtime changed copied source: ${source}`);
  }
  report.sourceUnchanged = true;
  report.sourceFiles = hashes.size;
}

function subset(actual, expected, location = 'response') {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${location}: expected an array`);
    assert.equal(actual.length, expected.length, `${location}: array length differs`);
    expected.forEach((value, index) => subset(actual[index], value, `${location}[${index}]`));
  } else if (expected !== null && typeof expected === 'object') {
    assert.ok(actual !== null && typeof actual === 'object' && !Array.isArray(actual), `${location}: expected an object`);
    for (const [key, value] of Object.entries(expected)) {
      assert.ok(Object.hasOwn(actual, key), `${location}: missing ${key}`);
      subset(actual[key], value, `${location}.${key}`);
    }
  } else {
    assert.deepEqual(actual, expected, `${location}: unexpected value`);
  }
}

async function request(row) {
  const headers = {};
  if (row.auth === 'admin') headers.Authorization = `Bearer ${token}`;
  if (Object.hasOwn(row, 'body')) headers['Content-Type'] = 'application/json';
  const response = await fetch(origin + row.path, {
    method: row.method || 'GET',
    headers,
    ...(Object.hasOwn(row, 'body') ? { body: JSON.stringify(row.body) } : {}),
    redirect: 'manual',
    signal: AbortSignal.any([interrupted.signal, AbortSignal.timeout(15000)]),
  });
  const text = await response.text();
  assert.equal(response.status, row.status, `${row.method || 'GET'} ${row.path}: unexpected HTTP status; ${text.slice(0, 800)}`);
  if (!text) return undefined;
  try { return JSON.parse(text); }
  catch { throw new Error(`${row.method || 'GET'} ${row.path}: response must be JSON (or empty)`); }
}

function environment(workspace, migrations) {
  const env = { ...process.env };
  // Do not inherit an existing application's database, administrator or workspace.
  for (const key of Object.keys(env)) {
    if (/^(APP_|DB_|ADMIN_|AUTH_|LOG_|CONSOLE_|TLS_|HTTPS_|ROBOT_|ROBATON_|TRACE_|AIDOT_)|^(NODE_OPTIONS|DATA_DIR|SETTINGS_FILE|ENV_FILE|HOST|PORT|MANAGED_ENDPOINT|ALLOWED_HOSTS|PUBLIC_DIR|UPLOAD_MAX_BYTES|MULTIPART_LIMIT_BYTES|BODY_LIMIT_BYTES|REQUEST_TIMEOUT_MS)$/.test(key)) delete env[key];
  }
  const empty = path.join(temp, 'empty.env');
  fs.writeFileSync(empty, '');
  token = randomBytes(32).toString('hex');
  Object.assign(env, {
    ENV_FILE: empty,
    AIDOT_ENV_FILE: empty,
    APP_WORKSPACE: workspace,
    DB_MIGRATIONS_DIR: migrations || path.join(workspace, 'migrations'),
    DB_FILE: path.join(temp, 'data/workspace.db'),
    DB_TYPE: 'sqlite',
    DB_APP_SCHEMA: '',
    DATA_DIR: path.join(temp, 'data'),
    SETTINGS_FILE: path.join(temp, 'settings.json'),
    ADMIN_TOKEN: token,
    ADMIN_TOKEN_FILE: path.join(temp, 'admin-token'),
    ADMIN_ACCOUNT_FILE: path.join(temp, 'admin-account.json'),
    PUBLIC_DIR: path.join(temp, 'public'),
    HOST: '127.0.0.1',
    PORT: '0',
    HTTPS_ENABLED: 'false',
    MANAGED_ENDPOINT: 'false',
    LOG_TO_FILE: 'false',
    LOG_LEVEL: 'error',
    NODE_ENV: 'test',
  });
  return env;
}

async function start(env) {
  interrupted.signal.throwIfAborted();
  child = fork(path.join(root, 'start.js'), [], {
    cwd: temp,
    env,
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (bytes) => { output = (output + bytes).slice(-12000); });
  }
  const port = await new Promise((resolve, reject) => {
    const finish = (error, value) => {
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      child.off('message', onMessage);
      interrupted.signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(value);
    };
    const onError = (error) => finish(error);
    const onExit = (code) => finish(new Error(`Server exited before ready (code ${code})`));
    const onAbort = () => finish(interrupted.signal.reason);
    const onMessage = (message) => {
      if (message?.type === 'ready') finish(null, message.port);
    };
    const timer = setTimeout(() => finish(new Error('Server startup timed out after 40 seconds')), 40000);
    child.once('error', onError);
    child.once('exit', onExit);
    child.on('message', onMessage);
    interrupted.signal.addEventListener('abort', onAbort, { once: true });
  });
  origin = `http://127.0.0.1:${port}`;
}

async function precompile(env, workspace) {
  interrupted.signal.throwIfAborted();
  const started = performance.now();
  // Scan only the trees the runtime loads as declarations. An unrelated test or
  // template in the workspace must not become a new startup requirement.
  const directories = [path.join(workspace, 'controller'), path.join(workspace, 'service'), path.join(root, 'src/controller')];
  const cache = path.join(env.DATA_DIR, 'compile-cache');
  const code = `import fs from 'node:fs';
import { compile, compilerVersion } from ${JSON.stringify(pathToFileURL(path.join(root, 'src/loader/compile.mjs')).href)};
import { workspaceFiles } from ${JSON.stringify(pathToFileURL(path.join(root, 'src/core/workspaceFiles.js')).href)};
process.on('message', value => { if (value?.type === 'aidot:shutdown') process.exit(0); });
let files = 0;
for (const directory of ${JSON.stringify(directories)}) {
  for (const file of workspaceFiles(directory)) {
    const source = fs.readFileSync(file, 'utf8');
    if (source.includes('@') || /\\.(?:mts|ts)$/i.test(file)) {
      await compile(source, file, ${JSON.stringify(cache)});
      files++;
    }
  }
}
process.send({ type: 'compiled', files, compilerVersion,
  rssMiBAtCompletion: Math.round(process.memoryUsage().rss / 1048576),
  processMaxRssKiB: process.resourceUsage().maxRSS }, () => process.exit(0));
`;
  child = spawn(process.execPath, ['--input-type=module', '--eval', code], {
    cwd: temp,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (bytes) => { output = (output + bytes).slice(-12000); });
  }
  const summary = await new Promise((resolve, reject) => {
    let compiled;
    const finish = (error) => {
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      child.off('message', onMessage);
      interrupted.signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(compiled);
    };
    const onError = (error) => finish(error);
    const onExit = (status) => finish(status !== 0 ? new Error(`Precompiler exited before completion (code ${status})`) : !compiled ? new Error('Precompiler exited without a completion report') : null);
    const onMessage = (message) => { if (message?.type === 'compiled') compiled = message; };
    const onAbort = () => finish(interrupted.signal.reason);
    const timer = setTimeout(() => finish(new Error('Precompilation timed out after 40 seconds')), 40000);
    child.once('error', onError);
    child.once('exit', onExit);
    child.on('message', onMessage);
    interrupted.signal.addEventListener('abort', onAbort, { once: true });
  });
  // Waiting for exit, not merely the completion message, releases the WASM
  // process before the server is forked. Imported helpers can still use the
  // runtime's normal compiler fallback if they were outside these trees.
  const { type, ...metrics } = summary;
  report.precompile = { completed: true, exitedBeforeServer: true, ...metrics, elapsedMs: Math.round(performance.now() - started) };
}

async function stop() {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    if (child.connected) child.send({ type: 'aidot:shutdown' }, () => {});
    else child.kill('SIGTERM');
  });
}

const onInterrupt = () => { signalCode = 130; interrupted.abort(new Error('Interrupted by SIGINT')); };
const onTerminate = () => { signalCode = 143; interrupted.abort(new Error('Interrupted by SIGTERM')); };

if (process.argv.slice(2).length === 1 && ['--help', '-h'].includes(process.argv[2])) {
  console.log(usage);
} else {
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    const args = options(process.argv.slice(2));
    const cases = readCases(args['--cases']);
    for (const flag of ['--workspace', '--migrations']) {
      if (args[flag]) assert.ok(fs.lstatSync(args[flag]).isDirectory() && !fs.lstatSync(args[flag]).isSymbolicLink(), `${flag} must be a regular directory`);
    }
    report.workspace = args['--workspace'];
    report.providedCases = cases.length;
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-workspace-verify-'));
    const workspace = path.join(temp, 'workspace');
    const migrations = args['--migrations'] ? path.join(temp, 'migrations') : undefined;
    copyTree(args['--workspace'], workspace);
    if (migrations) copyTree(args['--migrations'], migrations);
    const env = environment(workspace, migrations);
    await precompile(env, workspace);
    const serverStarted = performance.now();
    await start(env);
    report.serverStartupMs = Math.round(performance.now() - serverStarted);
    const health = await request({ path: '/health/ready', status: 200 });
    subset(health, { ok: true, checks: { accepting: true, db: true, migration: true } });
    const status = await request({ path: '/admin/status', status: 200, auth: 'admin' });
    const metadata = await request({ path: '/admin/metadata', status: 200, auth: 'admin' });
    subset(status, { code: 200, data: { db: true, migration: true, workspace } });
    assert.equal(metadata.code, 200);
    for (const kind of ['controllers', 'services']) {
      assert.ok(Array.isArray(status.data[kind]) && Array.isArray(metadata.data[kind]), `Missing ${kind} declarations`);
      assert.equal(status.data[kind].length, metadata.data[kind].length, `${kind} metadata count differs`);
    }
    report.declarations = {
      controllers: status.data.controllers.length,
      services: status.data.services.length,
      routes: status.data.controllers.reduce((count, controller) => count + controller.routes.length, 0),
      queries: status.data.queries.length,
    };
    report.runtimeRssMB = status.data.rssMB;
    report.memoryScope = 'Compiler and server RSS are separate process measurements, not a whole-run peak or a memory limit. Imported helpers may trigger runtime compilation.';
    report.startupVerified = true;
    for (const row of cases) {
      report.businessRequests++;
      try {
        const actual = await request(row);
        if (Object.hasOwn(row, 'expect')) {
          subset(actual, row.expect);
          report.businessAssertions++;
        }
        report.completedCases++;
        report.cases.push({ name: row.name, result: 'PASS' });
      } catch (error) {
        report.cases.push({ name: row.name, result: 'FAIL' });
        throw new Error(`${row.name}: ${error.message}`, { cause: error });
      }
    }
    report.businessVerified = cases.length > 0;
    report.scope = cases.length ? 'Only the supplied HTTP cases were verified.' : 'Startup and metadata only; business behavior was not verified. Add --cases or run application tests.';
    report.result = 'PASS';
  } catch (error) {
    report.error = error.message;
    if (output) report.serverLog = output;
  } finally {
    await stop();
    if (temp) {
      try { unchanged(); }
      catch (error) { report.result = 'FAIL'; report.sourceUnchanged = false; report.error = report.error ? `${report.error}; ${error.message}` : error.message; }
      fs.rmSync(temp, { recursive: true, force: true });
    }
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    if (signalCode) { report.result = 'FAIL'; report.error ||= interrupted.signal.reason.message; }
    if (report.result !== 'PASS') report.businessVerified = false;
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = signalCode || (report.result === 'PASS' ? 0 : 1);
  }
}
