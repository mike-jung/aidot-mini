#!/usr/bin/env node
// Copyright 2026 Aidot Link Co., Ltd. SPDX-License-Identifier: Apache-2.0
// Based on the supplied aidot-mini-public-check patch. No npm dependency is needed.
// Check the selected public files, not all files available in the Full checkout.
import fs from 'node:fs';
import path from 'node:path';
import {builtinModules} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const FRAMEWORK_NS = new Set(['core', 'database', 'util', 'service', 'config', 'secure', 'controller', 'model', 'types']);
const CODE = /\.(?:m?js|cjs|mts|ts)$/i;
const SKIP_DIR = new Set(['node_modules', '.git', '.aidot-cache', 'dist', 'data', 'certs', '__pycache__']);
const DEFAULT_SCAN = ['src', 'scripts', 'deploy', 'addons', 'modules', 'tests', 'workspace', 'examples', 'start.js'];
const EXCLUDE = /(?:^|\/)(?:public|assets|vendor|node_modules)\/|\.min\.|\.bundle\./i;
const BUILTIN = new Set([...builtinModules, ...builtinModules.map(m => `node:${m}`)]);
const packageName = spec => spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
const norm = name => path.posix.normalize(name).replace(/^\.\//, '');
const safeName = name => typeof name === 'string' && !!name && !/[\\\x00-\x1f:]/.test(name)
  && !name.split('/').some(part => !part || part === '.' || part === '..') && !path.posix.isAbsolute(name);
const readPkg = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (SKIP_DIR.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

// A small lexical scanner, not a JavaScript/TypeScript parser. Quoted example
// code and comments must not create imports; preserve line numbers for errors.
function tokens(code) {
  const out = [];
  let i = 0, line = 1;
  const advance = end => { line += (code.slice(i, end).match(/\n/g) || []).length; i = end; };
  while (i < code.length) {
    if (/\s/.test(code[i])) { if (code[i++] === '\n') line++; continue; }
    if (code.startsWith('//', i)) { const end = code.indexOf('\n', i); advance(end < 0 ? code.length : end); continue; }
    if (code.startsWith('/*', i)) { const end = code.indexOf('*/', i + 2); advance(end < 0 ? code.length : end + 2); continue; }
    const startLine = line, c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      let end = i + 1, value = '', dynamic = false;
      while (end < code.length && code[end] !== c) {
        if (code[end] === '\\') {
          const escape = code[++end];
          if (escape === '\n') { end++; continue; }
          if (escape === 'u' || escape === 'x') {
            const length = escape === 'u' ? 4 : 2, hex = code.slice(end + 1, end + 1 + length);
            if (new RegExp(`^[0-9a-f]{${length}}$`, 'i').test(hex)) { value += String.fromCharCode(parseInt(hex, 16)); end += length + 1; continue; }
          }
          value += ({n: '\n', r: '\r', t: '\t'}[escape] ?? escape ?? ''); end++; continue;
        }
        if (c === '`' && code.startsWith('${', end)) dynamic = true;
        value += code[end++];
      }
      out.push({type: dynamic ? 'template' : 'string', value, line: startLine});
      advance(Math.min(end + 1, code.length)); continue;
    }
    // Skip regex literals in expression positions, including their character classes.
    const previous = out.at(-1)?.value;
    if (c === '/' && (!previous || /^(?:[=(:,;!&|?{\[>]|return|throw|case|yield)$/.test(previous))) {
      let end = i + 1, bracket = false;
      for (; end < code.length && code[end] !== '\n'; end++) {
        if (code[end] === '\\') { end++; continue; }
        if (code[end] === '[') bracket = true;
        if (code[end] === ']') bracket = false;
        if (code[end] === '/' && !bracket) { end++; while (/[a-z]/i.test(code[end] || '') && end < code.length) end++; break; }
      }
      out.push({type: 'regex', value: '/', line: startLine}); advance(end); continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(code.slice(i));
    if (word) { out.push({type: 'word', value: word[0], line}); i += word[0].length; }
    else { out.push({type: 'punct', value: c, line}); i++; }
  }
  return out;
}

export function specifiers(code) {
  const list = tokens(code), out = [];
  const add = (token, kind = 'import') => { if (token?.type === 'string') out.push({spec: token.value, line: token.line, kind}); };
  const sequence = (i, values) => values.every((value, j) => list[i + j]?.value === value);
  for (let i = 0; i < list.length; i++) {
    const token = list[i];
    if (token.type !== 'word' || list[i - 1]?.value === '.') continue;
    if (token.value === 'import' || token.value === 'export') {
      if (token.value === 'import' && sequence(i + 1, ['.', 'meta', '.', 'resolve', '('])) { add(list[i + 6], 'resolve'); continue; }
      if (list[i + 1]?.value === '.') continue;
      if (list[i + 1]?.value === '(') {
        if ([')', ','].includes(list[i + 3]?.value)) add(list[i + 2]);
        continue;
      }
      if (list[i + 1]?.type === 'string') { add(list[i + 1]); continue; }
      if (token.value === 'export' && !['*', '{', 'type'].includes(list[i + 1]?.value)) continue;
      for (let j = i + 1; j < list.length && ![';', 'import', 'export'].includes(list[j].value); j++) {
        if (list[j].value === 'from') { add(list[j + 1]); break; }
      }
    } else if (token.value === 'require' && list[i + 1]?.value === '(' && list[i + 3]?.value === ')') add(list[i + 2], 'require');
    else if (token.value === 'new' && sequence(i + 1, ['URL', '(']) && sequence(i + 4, [',', 'import', '.', 'meta', '.', 'url', ')'])) {
      add(list[i + 3], 'url');
    }
  }
  return out;
}

// npm invokes these commands through a shell. Only literal Node entry paths
// are checked; inline code, shell expansion and computed paths need runtime QA.
function scriptFiles(command) {
  const words = String(command).match(/"[^"]*"|'[^']*'|[^\s&|;]+|[&|;]+/g) || [], out = [];
  for (let i = 0; i < words.length; i++) {
    if (!/^(?:node|node\.exe)$/.test(words[i])) continue;
    let entry = false, tests = false, python = false;
    for (let j = i + 1; j < words.length && !/^[&|;]+$/.test(words[j]); j++) {
      const word = words[j].replace(/^(['"])(.*)\1$/, '$2');
      if (['-e', '--eval', '-p', '--print'].includes(word)) break;
      if (word === '--test') tests = true;
      if (word.startsWith('-')) continue;
      if ((!entry || tests) && CODE.test(word)) { out.push(norm(word)); entry = true; python = /(?:^|\/)run-python\.mjs$/.test(word); }
      else if (python && /\.py$/.test(word)) out.push(norm(word));
    }
  }
  return out;
}

export function checkPublic({root = process.cwd(), manifest: manifestPath, files: fileList, scan = DEFAULT_SCAN} = {}) {
  root = path.resolve(root);
  const problems = {imports: [], packages: [], entries: [], manifest: []}, aliases = [];
  let records, source, manifest = null, policy = null;
  const defaultManifest = path.join(root, 'PUBLIC_MANIFEST.json');
  if (fileList) {
    records = fs.readFileSync(path.resolve(fileList), 'utf8').split(/\r?\n/).map(s => s.trim())
      .filter(s => s && !s.startsWith('#')).map(s => s.replace(/^\.\//, '').replace(/\\/g, '/'));
    source = 'File list: ' + path.basename(fileList);
  } else if (manifestPath || fs.existsSync(defaultManifest)) {
    manifest = readPkg(manifestPath ? path.resolve(manifestPath) : defaultManifest);
    if (!Array.isArray(manifest.files)) throw new Error('Manifest must contain a files array');
    records = manifest.files;
    source = `Manifest (${manifest.edition ?? '?'}, v${manifest.version ?? '?'})`;
  } else if (fs.existsSync(path.join(root, 'scripts/publish/public-files.json'))) {
    policy = readPkg(path.join(root, 'scripts/publish/public-files.json'));
    if (!Array.isArray(policy.files) || !Array.isArray(policy.publicScripts)) throw new Error('Invalid Public policy');
    records = policy.files;
    source = 'Full source / Public policy';
  } else {
    records = walk(root);
    source = 'Source tree (no manifest)';
  }
  const shipped = new Set(), readable = new Set();
  for (const record of records) {
    const name = typeof record === 'string' ? record : record?.path;
    if (!safeName(name)) { problems.manifest.push({file: String(name), why: 'Unsafe file path'}); continue; }
    if (shipped.has(name)) { problems.manifest.push({file: name, why: 'Duplicate file path'}); continue; }
    shipped.add(name);
    try {
      let filename = root;
      for (const part of name.split('/')) {
        filename = path.join(filename, part);
        if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Symbolic link in selected path');
      }
      if (!fs.statSync(filename).isFile()) throw new Error('Not a regular file');
      readable.add(name);
      if (record.sha256 && createHash('sha256').update(fs.readFileSync(filename)).digest('hex') !== record.sha256) throw new Error('SHA-256 mismatch');
    } catch (error) { problems.manifest.push({file: name, why: error.code === 'ENOENT' ? 'Selected file is missing' : error.message}); }
  }
  // Do not consult an unshipped package.json in the Full tree.
  const pkgCache = new Map();
  const pkgFor = name => {
    if (!pkgCache.has(name)) pkgCache.set(name, readable.has(name) ? readPkg(path.join(root, name)) : null);
    return pkgCache.get(name);
  };
  const rootPkg = pkgFor('package.json');
  if (!rootPkg) problems.entries.push({entry: 'package.json', file: 'package.json'});
  if (manifest?.version && rootPkg && manifest.version !== rootPkg.version) problems.manifest.push({file: 'package.json', why: 'Manifest version differs from package version'});
  const scripts = Object.fromEntries(Object.entries(rootPkg?.scripts || {}).filter(([name]) => !policy || policy.publicScripts.includes(name)));
  function declaredFor(rel) {
    const names = new Set();
    for (let dir = path.posix.dirname(rel); ; dir = path.posix.dirname(dir)) {
      const pkg = pkgFor(dir === '.' ? 'package.json' : `${dir}/package.json`);
      for (const field of ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies']) for (const name of Object.keys(pkg?.[field] || {})) names.add(name);
      if (dir === '.') break;
    }
    return names;
  }
  const seeds = new Set();
  const addEntry = (file, entry) => {
    file = norm(String(file));
    if (!shipped.has(file)) problems.entries.push({entry, file});
    else if (CODE.test(file)) seeds.add(file);
  };
  if (rootPkg?.main) addEntry(rootPkg.main, 'package.main');
  for (const [name, file] of Object.entries(typeof rootPkg?.bin === 'string' ? {bin: rootPkg.bin} : rootPkg?.bin || {})) addEntry(file, 'package.bin ' + name);
  for (const [name, command] of Object.entries(scripts)) for (const file of scriptFiles(command)) addEntry(file, 'npm run ' + name);
  for (const name of ['start.js', 'server.js', 'index.js']) if (shipped.has(name)) seeds.add(name);
  const inScope = name => !EXCLUDE.test(name) && scan.some(r => name === r || name.startsWith(r + '/'));
  // Directory-loaded controllers and services, including .ts, are independent seeds.
  for (const name of shipped) if (CODE.test(name) && /(?:^|\/)(?:controller|service)\//.test(name) && inScope(name)) seeds.add(name);
  if (!seeds.size) problems.entries.push({entry: 'No Node entry point found', file: 'package.json'});
  const workspaceFile = name => /^(?:workspace(?:-[^/]+)?|examples\/[^/]*workspace|tests\/fixtures\/[^/]*workspace)\//.test(name);
  function resolve(spec, from, kind) {
    const explicit = /^@aidot\/([^/]+)\/(.+)$/.exec(spec);
    const generated = /^(?:\.\.\/)+src\/([^/]+)\/(.+)$/.exec(spec);
    const loose = /^\.\.\/([^/]+)\/(.+)$/.exec(spec);
    const alias = explicit || generated || loose;
    const relative = spec.startsWith('./') || spec.startsWith('../');
    const literal = relative ? norm(path.posix.join(path.posix.dirname(from), spec)) : null;
    let target = literal;
    if (workspaceFile(from) && alias && FRAMEWORK_NS.has(alias[1]) && (explicit || generated || !readable.has(literal))) {
      target = norm(`src/${alias[1]}/${alias[2]}`);
      if (!target.startsWith('src/')) return {target, hit: null};
      if (target !== literal) aliases.push({file: from, spec, resolved: target});
    }
    if (target === null) return null;
    // ESM imports and loader aliases need exact paths. Only require adds extensions.
    const candidates = kind === 'require' ? [target, ...['.js', '.json', '.node', '/index.js', '/index.json', '/index.node'].map(s => target + s)] : [target];
    return {target, hit: candidates.find(name => readable.has(name))};
  }
  const seen = new Set(), queue = [...seeds];
  let edges = 0;
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i];
    if (seen.has(file) || !readable.has(file) || !CODE.test(file)) continue;
    seen.add(file);
    for (const {spec, line, kind} of specifiers(fs.readFileSync(path.join(root, file), 'utf8'))) {
      edges++;
      if (BUILTIN.has(spec)) continue;
      if (kind === 'url' && !spec.startsWith('./') && !spec.startsWith('../')) continue;
      const result = resolve(spec, file, kind);
      if (result === null) {
        const name = packageName(spec);
        if (!declaredFor(file).has(name)) problems.packages.push({file, line, spec, name});
      } else if (!result.hit) problems.imports.push({file, line, spec, expected: result.target});
      else if (CODE.test(result.hit)) queue.push(result.hit);
    }
  }
  const total = Object.values(problems).reduce((n, list) => n + list.length, 0);
  return {ok: total === 0, source, files: shipped.size, seeds: seeds.size, scanned: seen.size, edges, aliases, problems, total};
}

export function formatPublicCheck(result) {
  const lines = [`Public completeness: ${result.source}`, `  ${result.files} files; ${result.seeds} entry points; ${result.scanned} code files; ${result.edges} references`];
  for (const p of result.problems.imports) lines.push(`Missing import: ${p.file}:${p.line} -> ${p.spec} (expected ${p.expected})`);
  for (const p of result.problems.packages) lines.push(`Undeclared package: ${p.file}:${p.line} -> ${p.spec}`);
  for (const p of result.problems.entries) lines.push(`Missing entry: ${p.entry} -> ${p.file}`);
  for (const p of result.problems.manifest) lines.push(`Manifest mismatch: ${p.file} (${p.why})`);
  if (result.aliases.length) lines.push(`  ${result.aliases.length} workspace aliases resolved (informational)`);
  lines.push(result.ok ? 'Public completeness passed.' : `Public completeness failed: ${result.total} problem(s). Review the file policy before publishing.`);
  return lines.join('\n');
}

export function assertPublicComplete(options) {
  const result = checkPublic(options);
  if (!result.ok) throw new Error(formatPublicCheck(result));
  return result;
}

export function main(args = process.argv.slice(2)) {
  const options = {};
  let quiet = false;
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--quiet') { quiet = true; continue; }
    if (!['--root', '--manifest', '--files', '--scan'].includes(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node scripts/check-public.mjs [--root dir] [--manifest file | --files list.txt] [--scan a,b] [--quiet]');
    const value = args[++i];
    options[name.slice(2)] = name === '--scan' ? value.split(',').map(s => s.trim()).filter(Boolean) : value;
  }
  if (options.manifest && options.files) throw new Error('Choose --manifest or --files, not both');
  const result = checkPublic(options);
  if (!quiet || !result.ok) (result.ok ? console.log : console.error)(formatPublicCheck(result));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
