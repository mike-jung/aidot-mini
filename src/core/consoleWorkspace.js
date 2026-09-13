// Copyright 2026 Aidot Link Co., Ltd. SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import config from '../config.js';
import {compile} from '../loader/compile.mjs';
import {parseSqlFile} from './sqlLoader.js';
import logger from './logger.js';

export const FILE_LIMIT = 65536;
const LIST_LIMIT = 2000;
const LOG_LIMIT = 131072;
const admin = {auth: true, roles: ['admin']};
const fail = (status, message) => Object.assign(new Error(message), {status});
const hash = value => createHash('sha256').update(value).digest('hex');

function partsOf(name) {
  if (typeof name !== 'string' || name.length > 1024 || /[\\\x00-\x1f:]/.test(name)) throw fail(400, 'Invalid relative path');
  const parts = name.split('/');
  if (parts.some(p => !p || p.startsWith('.'))) throw fail(400, 'Invalid relative path');
  return parts;
}
function kindOf(name) {
  const parts = partsOf(name);
  const kind = parts[0];
  if (!['controller', 'service', 'sql', 'migrations'].includes(kind)) throw fail(403, 'Outside editable workspace folders');
  if (parts.length < 2 || parts.length > 10) throw fail(400, 'Invalid file path');
  const meta = parts.includes('meta');
  if (meta ? !name.endsWith('.meta.json') : !(/\.(?:js|mjs|ts|mts)$/.test(name) && ['controller', 'service'].includes(kind) || name.endsWith('.sql') && ['sql', 'migrations'].includes(kind))) throw fail(403, 'Unsupported file type');
  return {kind, writable: !meta && kind !== 'migrations'};
}
// Never follow a link below the selected root, even when it points back inside it.
function fileAt(root, name) {
  const base = fs.realpathSync(root);
  let file = base;
  const parts = partsOf(name);
  for (let i = 0; i < parts.length; i++) {
    file = path.join(file, parts[i]);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw fail(403, 'Links and special files are not allowed');
    if (i === parts.length - 1 && stat.nlink !== 1) throw fail(403, 'Hard links are not allowed');
  }
  return file;
}
function canWrite(file) {
  try { fs.accessSync(file, fs.constants.W_OK); fs.accessSync(path.dirname(file), fs.constants.W_OK); return true; } catch { return false; }
}
function readFile(root, name, limit) {
  const file = fileAt(root, name);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw fail(403, 'Regular files only');
    if (stat.size > limit) throw fail(413, 'File is too large for the console editor (64 KiB)');
    const bytes = Buffer.alloc(stat.size + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (count > limit) throw fail(413, 'File grew beyond the editor limit');
    const content = new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, count));
    if (content.includes('\0')) throw fail(415, 'UTF-8 text files only');
    return {file, content, mode: stat.mode, bytes: count, revision: hash(content)};
  } finally { fs.closeSync(fd); }
}
function route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw fail(404, 'File no longer exists. Refresh the list.');
      if (['EACCES', 'EPERM', 'EROFS', 'ELOOP'].includes(error.code)) throw fail(403, 'File is unavailable or read-only');
      if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') throw fail(415, 'UTF-8 text files only');
      throw error;
    }
  };
}
export function registerConsoleWorkspace(router) {
  const root = config.paths.workspace;
  const workspaceId = hash(fs.realpathSync(root));
  let restartRequired = false, saving = false;
  router.add('GET', '/admin/workspace/files', route((req, res) => {
    const files = [];
    let visited = 0, truncated = false;
    function walk(dir, prefix, depth = 0) {
      if (depth > 8 || visited >= LIST_LIMIT) { truncated = true; return; }
      if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) return;
      // opendir avoids allocating the complete listing of a large folder.
      const handle = fs.opendirSync(dir);
      try {
        let entry;
        while ((entry = handle.readSync())) {
          if (++visited > LIST_LIMIT) { truncated = true; break; }
          if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
          const name = prefix + '/' + entry.name;
          if (entry.isDirectory()) walk(path.join(dir, entry.name), name, depth + 1);
          else if (entry.isFile()) {
            try {
              const kind = kindOf(name), stat = fs.lstatSync(path.join(dir, entry.name));
              if (stat.nlink === 1) files.push({path: name, ...kind, writable: kind.writable && canWrite(path.join(dir, entry.name)), bytes: stat.size, tooLarge: stat.size > FILE_LIMIT});
            } catch (error) { if (error.status !== 403) throw error; }
          }
        }
      } finally { handle.closeSync(); }
    }
    for (const kind of ['controller', 'service', 'sql', 'migrations']) walk(path.join(root, kind), kind);
    const order = {controller: 0, service: 1, sql: 2, migrations: 3};
    files.sort((a, b) => order[a.kind] - order[b.kind] || Number(b.writable) - Number(a.writable) || a.path.localeCompare(b.path));
    res.json({code: 200, data: {workspaceId, files, truncated, maxBytes: FILE_LIMIT, restartRequired: restartRequired}});
  }), admin);
  router.add('GET', '/admin/workspace/file', route((req, res) => {
    const name = req.query.path, kind = kindOf(name), value = readFile(root, name, FILE_LIMIT);
    res.json({code: 200, data: {path: name, ...kind, writable: kind.writable && canWrite(value.file), content: value.content, revision: value.revision, bytes: value.bytes, workspaceId}});
  }), admin);
  router.add('PUT', '/admin/workspace/file', route(async (req, res) => {
    const body = req.body;
    if (!body || Array.isArray(body) || typeof body !== 'object' || typeof body.content !== 'string') throw fail(400, 'Path, UTF-8 content and revision are required');
    const {path: name, content, revision} = body;
    if (!kindOf(name).writable) throw fail(403, 'Metadata is generated automatically; migrations preserve their applied checksums');
    if (body.workspaceId !== workspaceId) throw fail(409, 'Workspace changed. Reload before saving.');
    if (Buffer.byteLength(content) > FILE_LIMIT) throw fail(413, 'File exceeds 64 KiB');
    if (content.includes('\0')) throw fail(415, 'UTF-8 text files only');
    if (saving) throw fail(409, 'Another save is running. Reload before saving.');
    saving = true;
    let temporary;
    try {
      const before = readFile(root, name, FILE_LIMIT);
      if (revision !== before.revision) throw fail(409, 'File changed since it was opened. Reload and merge your changes.');
      if (content === before.content) return res.json({code: 200, data: {path: name, revision, workspaceId, unchanged: true, restartRequired: restartRequired}});
      try {
        if (name.endsWith('.sql')) {
          if (!Object.keys(parseSqlFile(content)).length) throw new Error('At least one -- @name: statement is required');
        } else await compile(content, name); // Syntax only; never execute an edited module during save.
      } catch (error) { throw fail(422, 'Validation failed: ' + error.message.slice(0, 1600)); }
      const current = readFile(root, name, FILE_LIMIT);
      if (current.file !== before.file || current.revision !== revision) throw fail(409, 'File changed while validating. Reload before saving.');
      temporary = before.file + '.' + randomBytes(8).toString('hex') + '.tmp';
      const fd = fs.openSync(temporary, 'wx', before.mode & 0o777);
      try { fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (fileAt(root, name) !== before.file || readFile(root, name, FILE_LIMIT).revision !== revision) throw fail(409, 'File changed before saving');
      fs.renameSync(temporary, before.file);
      restartRequired = true;
      logger.info('Console workspace file saved: %s (restart to apply)', name);
      res.json({code: 200, data: {path: name, revision: hash(content), workspaceId, restartRequired: true}});
    } finally { saving = false; if (temporary) fs.rmSync(temporary, {force: true}); }
  }), admin);

  router.add('GET', '/admin/logs/files', route((req, res) => {
    const files = [];
    if (fs.existsSync(config.log.dir)) {
      for (const name of ['server.log', ...Array.from({length: 19}, (_, i) => 'server.log.' + (i + 1))]) {
        try { const file = fileAt(config.log.dir, name), stat = fs.statSync(file); files.push({name, bytes: stat.size, modified: stat.mtime.toISOString()}); }
        catch (error) { if (error.status !== 403 && !['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
      }
    }
    res.json({code: 200, data: {files, enabled: config.log.toFile, maxReadBytes: LOG_LIMIT}});
  }), admin);
  router.add('GET', '/admin/logs/tail', route((req, res) => {
    const name = req.query.file || 'server.log';
    if (!/^server\.log(?:\.(?:[1-9]|1[0-9]))?$/.test(name)) throw fail(400, 'Choose a listed log file');
    const level = req.query.level || 'all', search = req.query.search || '', count = Number(req.query.lines || 200);
    if (!['all', 'error', 'warn', 'info', 'debug'].includes(level) || search.length > 128 || !Number.isInteger(count) || count < 1 || count > 500) throw fail(400, 'Invalid log filter');
    const file = fileAt(config.log.dir, name), fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) throw fail(403, 'Regular log files only');
      const start = Math.max(0, stat.size - LOG_LIMIT), buffer = Buffer.alloc(Math.min(stat.size, LOG_LIMIT));
      const read = fs.readSync(fd, buffer, 0, buffer.length, start);
      let text = buffer.subarray(0, read).toString('utf8');
      if (start) text = text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : '';
      const filtered = text.split(/\r?\n/).filter(line => line && (level === 'all' || /^(?:\S+\s+)?\[(ERROR|WARN|INFO|DEBUG)\]/.exec(line)?.[1] === level.toUpperCase()) && line.toLowerCase().includes(search.toLowerCase()));
      res.json({code: 200, data: {file: name, lines: filtered.slice(-count), bytesRead: read, totalBytes: stat.size, truncated: start > 0 || filtered.length > count, searchScope: 'recent-window'}});
    } finally { fs.closeSync(fd); }
  }), admin);
}
