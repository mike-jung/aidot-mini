// Installed runtime state belongs to the current user, never to the application payload.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const markerName = '.aidot-mini-owned.json';
const configName = 'config/installation.json';
const recordName = 'state/supervisor.json';
const privateNames = ['config', 'db', 'workspaces', 'public', 'logs', 'cache', 'accounts', 'tls', 'state'];
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const present = file => { try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const within = (root, file) => { const relative = path.relative(root, file); return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

export function defaultDataDir(env = process.env, platform = process.platform) {
  if (env.AIDOT_MINI_HOME) {
    if (!path.isAbsolute(env.AIDOT_MINI_HOME)) throw new Error('AIDOT_MINI_HOME must be absolute');
    return path.resolve(env.AIDOT_MINI_HOME);
  }
  if (platform === 'win32') {
    if (!env.LOCALAPPDATA || !path.isAbsolute(env.LOCALAPPDATA)) throw new Error('LOCALAPPDATA must be an absolute per-user directory');
    return path.join(env.LOCALAPPDATA, 'aidot-mini');
  }
  const base = env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  if (!path.isAbsolute(base)) throw new Error('XDG_DATA_HOME must be absolute');
  return path.join(base, 'aidot-mini');
}

export function noLinks(file) {
  let current = path.resolve(file);
  for (;;) {
    const stat = present(current);
    if (stat?.isSymbolicLink()) throw new Error(`Symbolic links and junctions are not allowed: ${current}`);
    if (current === path.dirname(current)) return;
    current = path.dirname(current);
  }
}

export function dataRoot(value = defaultDataDir()) {
  if (!path.isAbsolute(value)) throw new Error('Data directory must be absolute');
  const root = path.resolve(value);
  if (root === path.parse(root).root || root === os.homedir() || root === APP_ROOT || within(root, APP_ROOT) || within(APP_ROOT, root))
    throw new Error('Data directory must be a dedicated folder outside the installed application');
  noLinks(root);
  return root;
}

function regular(file) {
  noLinks(file);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Expected a private regular file: ${file}`);
  return stat;
}
function json(file) {
  if (regular(file).size > 65536) throw new Error(`Configuration is too large: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function write(file, value, exclusive = false) {
  noLinks(file);
  if (present(file)) regular(file);
  if (exclusive) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return; }
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

export function ownedRoot(value, { create = false } = {}) {
  const root = dataRoot(value);
  const marker = path.join(root, markerName);
  if (!present(marker)) {
    if (!create) throw new Error('Unrecognized application data directory: ownership marker missing');
    if (present(root) && fs.readdirSync(root).length) throw new Error('Refusing to adopt a nonempty unmarked data directory');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    write(marker, { application: 'aidot-mini', schema: 1, root, installationId: randomBytes(24).toString('hex') }, true);
  }
  const value_ = json(marker);
  if (value_.application !== 'aidot-mini' || value_.schema !== 1 || value_.root !== root || !/^[a-f0-9]{48}$/.test(value_.installationId))
    throw new Error('Application ownership marker does not match this data directory');
  return { root, marker: value_ };
}

function settings(input) {
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error('Port must be an integer from 1 to 65535');
  if (!['127.0.0.1', '::1', '0.0.0.0', '::'].includes(input.host)) throw new Error('Host must be 127.0.0.1, ::1, 0.0.0.0 or ::');
  if (!['note', 'product'].includes(input.profile)) throw new Error('Profile must be note or product');
  if (typeof input.database !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:db|sqlite|sqlite3)$/.test(input.database) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(input.database))
    throw new Error('Database must be a simple SQLite filename ending in .db, .sqlite or .sqlite3');
  if (typeof input.https !== 'boolean') throw new Error('HTTPS setting must be boolean');
  if (!['127.0.0.1', '::1'].includes(input.host) && !input.https) throw new Error('LAN listening requires a TLS certificate and key; loopback HTTP is the default');
  return input;
}

function copyTree(source, destination) {
  noLinks(source); noLinks(destination);
  const stat = fs.lstatSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(source)) if (!['.aidot-cache', 'node_modules', '.git'].includes(name)) copyTree(path.join(source, name), path.join(destination, name));
  } else if (stat.isFile() && stat.nlink === 1) {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o600);
  } else throw new Error(`Unsupported source entry: ${source}`);
}
// A minimal installation can later gain Full assets. Merge only missing files;
// an earlier seeding marker never hides newly available assets or user edits.
function seedMissing(source, destination) {
  noLinks(source); noLinks(destination);
  const from = fs.lstatSync(source), to = present(destination);
  if (from.isDirectory()) {
    if (to && !to.isDirectory()) return;
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(source)) seedMissing(path.join(source, name), path.join(destination, name));
  } else if (from.isFile() && from.nlink === 1) {
    if (!to) { fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL); fs.chmodSync(destination, 0o600); }
  } else throw new Error(`Unsupported public asset: ${source}`);
}

function sources(profile) {
  const workspace = profile === 'product' ? path.join(APP_ROOT, 'examples/product-workspace') : path.join(APP_ROOT, 'workspace');
  if (!present(workspace)?.isDirectory()) throw new Error(`The ${profile} profile is not included in this distribution`);
  return { workspace, migrations: profile === 'product' ? path.join(APP_ROOT, 'examples/product-database') : null };
}

export function readConfiguration(value) {
  const { root, marker } = ownedRoot(value);
  const config = json(path.join(root, configName));
  if (config.schema !== 1 || config.installationId !== marker.installationId) throw new Error('Installation configuration does not match ownership marker');
  settings(config);
  return { root, marker, config };
}

export async function configure(value, options = {}) {
  const root = dataRoot(value);
  let existing;
  if (present(path.join(root, markerName))) {
    ownedRoot(root);
    if (present(path.join(root, configName))) existing = readConfiguration(root).config;
    const running = await status(root);
    if (running.active && !options.validateOnly) throw new Error('Stop the installed server before changing configuration');
  }
  const next = { schema: 1, port: 8901, host: '127.0.0.1', database: options.profile === 'product' ? 'product.db' : 'app.db', profile: 'note', https: false, ...existing };
  for (const key of ['port', 'host', 'database', 'profile']) if (options[key] !== undefined) next[key] = options[key];
  if (existing && next.profile !== existing.profile && options.database === undefined) throw new Error('Changing profile also requires an explicit --database filename');
  const suppliedTLS = options.tlsCert !== undefined || options.tlsKey !== undefined;
  let cert, key;
  if (suppliedTLS) {
    if (!options.tlsCert || !options.tlsKey) throw new Error('Both --tls-cert and --tls-key are required');
    regular(path.resolve(options.tlsCert)); regular(path.resolve(options.tlsKey));
    cert = fs.readFileSync(options.tlsCert); key = fs.readFileSync(options.tlsKey);
    tls.createSecureContext({ cert, key });
    const certificate = new X509Certificate(cert);
    if (Date.parse(certificate.validTo) <= Date.now() || Date.parse(certificate.validFrom) > Date.now()) throw new Error('TLS certificate is expired or not yet valid');
    next.https = true;
  }
  settings(next);
  const source = sources(next.profile);
  if (options.validateOnly) {
    if (!present(path.join(root, markerName)) && present(root) && fs.readdirSync(root).length) throw new Error('Refusing to adopt a nonempty unmarked data directory');
    let parent = root;
    while (!present(parent)) parent = path.dirname(parent);
    fs.accessSync(parent, fs.constants.W_OK);
    return { valid: true, ...describe(root, next) };
  }
  const { marker } = ownedRoot(root, { create: true });
  for (const name of privateNames) {
    const directory = path.join(root, name); noLinks(directory);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const workspace = path.join(root, 'workspaces', next.profile);
  if (!present(workspace)) {
    const staging = `${workspace}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      copyTree(source.workspace, staging);
      if (source.migrations) copyTree(source.migrations, path.join(staging, 'migrations'));
      fs.renameSync(staging, workspace);
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  } else noLinks(workspace);
  // Seed newly available assets after Minimal -> Full upgrades, preserving
  // all existing public content, including uploads and edited console files.
  const publicSource = path.join(APP_ROOT, 'public');
  if (present(publicSource)) {
    seedMissing(publicSource, path.join(root, 'public'));
    write(path.join(root, 'config/public-seeded.json'), { seededAt: new Date().toISOString() });
  }
  if (suppliedTLS) {
    for (const [name, content] of [['server.crt', cert], ['server.key', key]]) {
      const target = path.join(root, 'tls', name); noLinks(target);
      if (present(target)) regular(target);
      fs.writeFileSync(target, content, { mode: 0o600 });
    }
  }
  next.installationId = marker.installationId;
  write(path.join(root, configName), next);
  return describe(root, next);
}

function describe(root, config) {
  return { dataDir: root, configuration: path.join(root, configName), ...config,
    databaseFile: path.join(root, 'db', config.database), workspace: path.join(root, 'workspaces', config.profile),
    publicDirectory: path.join(root, 'public'), logs: path.join(root, 'logs'),
    url: `${config.https ? 'https' : 'http'}://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}` };
}
export function configuration(value) { const { root, config } = readConfiguration(value); return describe(root, config); }

export function runtimeEnvironment(value) {
  const { root, config } = readConfiguration(value);
  for (const name of privateNames) noLinks(path.join(root, name));
  for (const file of ['config/settings.json', 'config/runtime.env', 'tls/server.crt', 'tls/server.key', 'accounts/admin-token', 'accounts/admin-account.json', `db/${config.database}`]) {
    const target = path.join(root, file);
    if (present(target)) regular(target);
  }
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(APP_|DB_|ADMIN_|LOG_|CONSOLE_|TLS_|HTTPS_|ROS_|ROBOT_|ROBATON_|TRACE_|AIDOT_)|^(DATA_DIR|SETTINGS_FILE|ENV_FILE|HOST|PORT|MANAGED_ENDPOINT|ALLOWED_HOSTS|PUBLIC_DIR|UPLOAD_MAX_BYTES|MULTIPART_LIMIT_BYTES|BODY_LIMIT_BYTES|REQUEST_TIMEOUT_MS|NODE_OPTIONS|NODE_PATH|NODE_COMPILE_CACHE)$/.test(key)) delete env[key];
  const workspace = path.join(root, 'workspaces', config.profile);
  const emptyEnv = path.join(root, 'config/runtime.env');
  noLinks(emptyEnv);
  // An empty explicit file prevents importing a developer .env from the payload.
  fs.writeFileSync(emptyEnv, '', { mode: 0o600 });
  return { ...env, NODE_ENV: 'production', ENV_FILE: emptyEnv, APP_WORKSPACE: workspace,
    DB_MIGRATIONS_DIR: path.join(workspace, 'migrations'), DB_FILE: path.join(root, 'db', config.database),
    DATA_DIR: path.join(root, 'cache'), SETTINGS_FILE: path.join(root, 'config/settings.json'),
    HOST: config.host, PORT: String(config.port), HTTPS_ENABLED: String(config.https), MANAGED_ENDPOINT: 'true',
    TLS_CERT_FILE: config.https ? path.join(root, 'tls/server.crt') : '', TLS_KEY_FILE: config.https ? path.join(root, 'tls/server.key') : '',
    PUBLIC_DIR: path.join(root, 'public'), LOG_DIR: path.join(root, 'logs'), LOG_TO_FILE: 'true',
    ADMIN_TOKEN_FILE: path.join(root, 'accounts/admin-token'), ADMIN_ACCOUNT_FILE: path.join(root, 'accounts/admin-account.json'),
    TMPDIR: path.join(root, 'cache'), TMP: path.join(root, 'cache'), TEMP: path.join(root, 'cache') };
}

function record(root) {
  const file = path.join(root, recordName);
  if (!present(file)) return null;
  const value = json(file);
  if (value.schema !== 1 || value.root !== root || !/^[a-f0-9]{64}$/.test(value.nonce) || !Number.isInteger(value.pid) || value.pid <= 0 || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || (value.childPid !== undefined && (!Number.isInteger(value.childPid) || value.childPid <= 0)))
    throw new Error('Invalid supervisor record; no process was signalled');
  return value;
}
function request(value, command) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: value.port });
    let buffer = '';
    const finish = (error, result) => { socket.destroy(); error ? reject(error) : resolve(result); };
    socket.setTimeout(2500, () => finish(new Error('Supervisor did not respond')));
    socket.once('error', error => finish(error));
    socket.on('connect', () => socket.write(JSON.stringify({ command, nonce: value.nonce, root: value.root }) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 65536) return finish(new Error('Invalid supervisor response'));
      if (!buffer.includes('\n')) return;
      try {
        const response = JSON.parse(buffer.split('\n')[0]);
        if (!equal(response.nonce, value.nonce) || response.pid !== value.pid || response.root !== value.root) throw new Error('Supervisor identity mismatch; no process was signalled');
        finish(null, response);
      } catch (error) { finish(error); }
    });
    socket.once('end', () => { if (!buffer.includes('\n')) finish(new Error('Supervisor closed without identity verification')); });
  });
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; return true; } }
export async function status(value) {
  const { root } = ownedRoot(value);
  const current = record(root);
  if (!current) return { running: false, dataDir: root };
  try { const response = await request(current, 'status'); return { running: response.running, active: true, dataDir: root, pid: response.pid, childPid: response.childPid, url: response.url }; }
  catch (error) {
    if (!alive(current.pid)) return { running: false, active: Boolean(current.childPid && alive(current.childPid)), orphaned: Boolean(current.childPid && alive(current.childPid)), stale: true, dataDir: root };
    throw new Error(`Recorded process is alive but ownership could not be verified: ${error.message}`);
  }
}
export async function stop(value) {
  const { root } = ownedRoot(value);
  const current = record(root);
  if (!current) return { stopped: true, wasRunning: false };
  try {
    await request(current, 'stop');
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const now = record(root);
      if (!now || now.nonce !== current.nonce) return { stopped: true, wasRunning: true };
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Owned server did not exit within 20 seconds; data was preserved');
  } catch (error) {
    if (!alive(current.pid)) {
      if (current.childPid && alive(current.childPid)) throw new Error('An owned child is still shutting down after its supervisor exited; retry after it exits. Data was preserved.');
      const now = record(root);
      if (now?.nonce === current.nonce) fs.unlinkSync(path.join(root, recordName));
      return { stopped: true, wasRunning: false, stale: true };
    }
    throw error;
  }
}

export async function start(value, { robot = false } = {}) {
  const root = dataRoot(value);
  if (!present(path.join(root, configName))) await configure(root);
  const info = configuration(root);
  if (robot && !present(path.join(APP_ROOT, 'modules/robot-client/manager.mjs'))) throw new Error('Robot module is not included in this distribution');
  const previous = record(root);
  if (previous) {
    const state = await status(root);
    if (state.running) throw new Error('This installation is already running');
    if (state.orphaned) throw new Error('An owned child is still shutting down; retry after it exits');
    if (!state.stale) throw new Error('An installation is starting or stopping');
    if (record(root)?.nonce === previous.nonce) fs.unlinkSync(path.join(root, recordName));
  }
  const env = runtimeEnvironment(root);
  const nonce = randomBytes(32).toString('hex');
  let child, shutting = false, ready = false, finish;
  const completed = new Promise(resolve => { finish = resolve; });
  const value_ = { schema: 1, root, nonce, pid: process.pid, port: 0 };
  const shutdown = () => {
    if (shutting) return;
    shutting = true;
    if (child?.connected) child.send({ type: 'aidot:shutdown' });
    else if (!child) finish();
  };
  const controller = net.createServer(socket => {
    let buffer = '';
    socket.setTimeout(3000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 4096) return socket.destroy();
      if (!buffer.includes('\n')) return;
      try {
        const message = JSON.parse(buffer.split('\n')[0]);
        if (!equal(message.nonce, nonce) || message.root !== root || !['status', 'stop'].includes(message.command)) return socket.destroy();
        socket.end(JSON.stringify({ nonce, root, pid: process.pid, childPid: child?.pid, running: ready && !shutting, url: info.url }) + '\n');
        if (message.command === 'stop') shutdown();
      } catch { socket.destroy(); }
    });
  });
  await new Promise((resolve, reject) => { controller.once('error', reject); controller.listen(0, '127.0.0.1', resolve); });
  value_.port = controller.address().port;
  try { write(path.join(root, recordName), value_, true); }
  catch (error) { controller.close(); throw error; }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  try {
    // Release the WASM compiler process before starting the long-lived API server.
    await new Promise((resolve, reject) => {
      child = fork(path.join(APP_ROOT, 'deploy/installed/server.mjs'), ['--compile'], { env, cwd: root, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: [] });
      if (child.pid) { value_.childPid = child.pid; write(path.join(root, recordName), value_); child.send({ type: 'aidot:begin' }); }
      child.once('error', reject);
      child.once('exit', code => { child = null; code === 0 ? resolve() : reject(new Error(`Workspace compilation failed (${code})`)); });
    });
    if (shutting) return;
    child = fork(path.join(APP_ROOT, 'deploy/installed/server.mjs'), robot ? ['--robot'] : [], { env, cwd: root, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: [] });
    if (child.pid) { value_.childPid = child.pid; write(path.join(root, recordName), value_); child.send({ type: 'aidot:begin' }); }
    child.once('error', error => { console.error(error.message); process.exitCode = 1; finish(); });
    child.on('message', message => {
      if (message?.type === 'ready') {
        ready = true;
        console.log(JSON.stringify({ event: 'ready', ...info, pid: process.pid, childPid: child.pid }));
        if (process.send) process.send({ type: 'ready', ...info });
        if (shutting) child.send({ type: 'aidot:shutdown' });
      }
    });
    child.once('exit', (code, signal) => { if (!shutting && (code || signal)) process.exitCode = code || 1; child = null; finish(); });
    await completed;
  } finally {
    process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown);
    controller.close();
    const now = record(root);
    if (now?.nonce === nonce) fs.unlinkSync(path.join(root, recordName));
  }
}

function validateTree(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error(`Purge refused because the data tree contains a link: ${target}`);
    if (stat.isDirectory()) validateTree(target);
    else if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Purge refused because the data tree contains a special or hard-linked file: ${target}`);
  }
}
export async function uninstall(value, { purge = false } = {}) {
  const { root } = ownedRoot(value);
  await stop(root);
  if (!purge) return { purged: false, preserved: root };
  // Validate all entries before deleting anything. Never traverse links out of the owned tree.
  ownedRoot(root); validateTree(root);
  fs.rmSync(root, { recursive: true, force: false });
  return { purged: true, removed: root };
}

export async function administration(value, command, args = []) {
  const root = dataRoot(value);
  if (!present(path.join(root, configName))) await configure(root);
  if (command === 'account' && (await status(root)).active) throw new Error('Stop the installed server before changing the administrator account');
  const file = command === 'account' ? 'admin-account.mjs' : 'admin-token.mjs';
  const env = runtimeEnvironment(root);
  return new Promise((resolve, reject) => {
    const child = fork(path.join(APP_ROOT, 'scripts', file), args, { env, cwd: root, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], execArgv: [] });
    child.once('error', reject);
    child.once('exit', code => { if (code) reject(new Error(`${command} command failed (${code})`)); else resolve(); });
  });
}
