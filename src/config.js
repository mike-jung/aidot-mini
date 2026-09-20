import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = process.env.ENV_FILE ? path.resolve(process.env.ENV_FILE) : path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(envPath, 'utf8')))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
const resolve = v => path.resolve(ROOT, v);
export const DATA_DIR = resolve(process.env.DATA_DIR || 'data');
export const SETTINGS_FILE = resolve(process.env.SETTINGS_FILE || path.join(DATA_DIR, 'settings.json'));
export function readSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  const value = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid settings file');
  return value;
}
export function integer(value, name, fallback, min, max) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return n;
}
export function boolean(value, name, fallback) {
  if (value === undefined) return fallback;
  if (/^(1|true|yes|on)$/i.test(String(value))) return true;
  if (/^(0|false|no|off)$/i.test(String(value))) return false;
  throw new Error(`${name} must be true or false`);
}
const saved = readSettings();
const setting = (key, env, fallback) => process.env[env] ?? saved[key] ?? fallback;
export const settingEnv = { workspace:'APP_WORKSPACE', host:'HOST', port:'PORT', https:'HTTPS_ENABLED', certFile:'TLS_CERT_FILE', keyFile:'TLS_KEY_FILE', language:'CONSOLE_LANGUAGE', logLevel:'LOG_LEVEL', consoleAccess:'CONSOLE_ACCESS' };
export function validateSettings(s) {
  const allowed = new Set(Object.keys(settingEnv));
  for (const key of Object.keys(s)) if (!allowed.has(key)) throw new Error(`Unknown setting: ${key}`);
  const out = { ...s };
  if ('port' in s) out.port = integer(s.port, 'PORT', 8901, 1, 65535);
  if ('https' in s && typeof s.https !== 'boolean') throw new Error('https must be a boolean');
  if ('host' in s && (typeof s.host !== 'string' || !/^[a-zA-Z0-9.:[\]-]{1,253}$/.test(s.host))) throw new Error('Invalid host');
  for (const key of ['certFile','keyFile','workspace']) if (key in s && (typeof s[key] !== 'string' || s[key].length > 4096 || /[\0\r\n]/.test(s[key]))) throw new Error(`Invalid ${key}`);
  if ('workspace' in s && !s.workspace.trim()) throw new Error('Workspace path must not be empty');
  if ('language' in s && !['ko','en'].includes(s.language)) throw new Error('Language must be ko or en');
  if ('logLevel' in s && !['error','warn','info','debug'].includes(s.logLevel)) throw new Error('Invalid log level');
  // 'all'  : 관리 콘솔을 어디서나 연다 (기존 동작, 기본값)
  // 'local': 이 기기에서 연 요청에만 콘솔을 연다. 업무 API 는 영향받지 않는다.
  if ('consoleAccess' in s && !['all','local'].includes(s.consoleAccess)) throw new Error('consoleAccess must be all or local');
  return out;
}
validateSettings(saved);
export const config = {
  env: process.env.NODE_ENV || 'development',
  server: {
    host: setting('host','HOST','127.0.0.1'),
    port: integer(setting('port','PORT',8901),'PORT',8901,0,65535),
    https: boolean(setting('https','HTTPS_ENABLED',false),'HTTPS_ENABLED',false),
    certFile: setting('certFile','TLS_CERT_FILE',''),
    keyFile: setting('keyFile','TLS_KEY_FILE',''),
    bodyLimit: integer(process.env.BODY_LIMIT_BYTES,'BODY_LIMIT_BYTES',262144,1024,2097152),
    multipartBodyLimit: integer(process.env.MULTIPART_LIMIT_BYTES,'MULTIPART_LIMIT_BYTES',20971520,1024,33554432),
    requestTimeout: integer(process.env.REQUEST_TIMEOUT_MS,'REQUEST_TIMEOUT_MS',15000,1000,120000),
    allowedHosts: (process.env.ALLOWED_HOSTS || '').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),
    managed: boolean(process.env.MANAGED_ENDPOINT,'MANAGED_ENDPOINT',false),
  },
  admin: {
    tokenFile: resolve(process.env.ADMIN_TOKEN_FILE || path.join(DATA_DIR,'admin-token')),
    accountFile: resolve(process.env.ADMIN_ACCOUNT_FILE || path.join(DATA_DIR,'admin-account.json')),
    sessionMinutes: integer(process.env.ADMIN_SESSION_MINUTES,'ADMIN_SESSION_MINUTES',60,1,1440),
    rememberDays: integer(process.env.ADMIN_REMEMBER_DAYS,'ADMIN_REMEMBER_DAYS',7,1,30),
  },
  console: {
    language: setting('language','CONSOLE_LANGUAGE','en'),
    // 관리 콘솔을 누구에게 열지. 'all'(기본) 또는 'local'.
    access: setting('consoleAccess','CONSOLE_ACCESS','all'),
  },
  db: {
    appSchema: (process.env.DB_APP_SCHEMA ?? 'aidot_app').trim(),
    file: process.env.DB_FILE === ':memory:' ? ':memory:' : resolve(process.env.DB_FILE || path.join(DATA_DIR,'app.db')),
    samplePrefix: process.env.DB_SAMPLE_PREFIX ?? 'sample_',
    synchronous: (process.env.DB_SYNCHRONOUS || 'FULL').toUpperCase(),
    busyTimeout: integer(process.env.DB_BUSY_TIMEOUT_MS,'DB_BUSY_TIMEOUT_MS',250,0,5000),
  },
  log: {
    level: setting('logLevel','LOG_LEVEL','info'),
    dir: resolve(process.env.LOG_DIR || 'log'),
    toFile: boolean(process.env.LOG_TO_FILE,'LOG_TO_FILE',true),
    maxBytes: integer(process.env.LOG_MAX_BYTES,'LOG_MAX_BYTES',1048576,4096,16777216),
    keepFiles: integer(process.env.LOG_KEEP_FILES,'LOG_KEEP_FILES',5,1,20),
  },
  trace: { enabled: boolean(process.env.TRACE_ENABLED,'TRACE_ENABLED',true), slowMs:integer(process.env.TRACE_SLOW_MS,'TRACE_SLOW_MS',500,1,60000) },
  paths: Object.fromEntries([['controllers','controller'],['services','service'],['sql','sql'],['migrations','migrations']].map(([k,v])=>[k,path.join(resolve(setting('workspace','APP_WORKSPACE','workspace')),v)]).concat([['workspace',resolve(setting('workspace','APP_WORKSPACE','workspace'))],['public',resolve(process.env.PUBLIC_DIR || 'public')]])),
};
const migrationRoot = process.env.DB_MIGRATIONS_DIR
  ? resolve(process.env.DB_MIGRATIONS_DIR)
  : config.paths.workspace === resolve('examples/product-workspace')
    ? resolve('examples/product-database')
    : config.paths.migrations;
config.paths.migrations = fs.existsSync(path.join(migrationRoot, 'sqlite'))
  ? path.join(migrationRoot, 'sqlite') : migrationRoot;
if (!['NORMAL','FULL'].includes(config.db.synchronous)) throw new Error('DB_SYNCHRONOUS must be FULL or NORMAL');
if (config.db.appSchema && (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.db.appSchema) || config.db.appSchema.toLowerCase() === 'temp')) throw new Error('DB_APP_SCHEMA must be one application schema name, or empty');
validateSettings({host:config.server.host,https:config.server.https,language:config.console.language,logLevel:config.log.level});
export default config;
