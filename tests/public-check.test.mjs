import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkPublic, specifiers} from '../scripts/check-public.mjs';

const checker = fileURLToPath(new URL('../scripts/check-public.mjs', import.meta.url));
function fixture(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot 공개 check '));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const write = (name, content) => {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    fs.writeFileSync(filename, typeof content === 'string' ? content : JSON.stringify(content));
  };
  write('package.json', {type: 'module', version: '1.0.13', main: 'start.js', scripts: {start: 'node start.js'}});
  write('start.js', 'export {};');
  for (const [name, content] of Object.entries(files)) write(name, content);
  return {root, write};
}

test('Full-only files cannot satisfy the Public graph; private npm scripts are filtered', t => {
  const {root, write} = fixture(t, {
    'package.json': {main: 'start.js', scripts: {start: 'node start.js', push: 'node private.mjs'}},
    'start.js': "import './src/core/security.js';",
    'src/core/security.js': "import apiAuth from './apiAuth.js';",
    'src/core/apiAuth.js': 'export default {};',
  });
  const policy = {files: ['package.json', 'start.js', 'src/core/security.js'], publicScripts: ['start']};
  write('scripts/publish/public-files.json', policy);
  const missing = checkPublic({root});
  assert.equal(missing.total, 1);
  assert.equal(missing.problems.imports[0].expected, 'src/core/apiAuth.js');
  policy.files.push('src/core/apiAuth.js'); write('scripts/publish/public-files.json', policy);
  assert.equal(checkPublic({root}).ok, true);
});

test('workspace aliases are informational and follow loader precedence', t => {
  const {root} = fixture(t, {
    'workspace/controller/Demo.ts': "import '@aidot/core/decorators.js'; import '../core/decorators.js'; import '../../src/core/decorators.js';",
    'src/core/decorators.js': 'export {};',
  });
  const result = checkPublic({root});
  assert.equal(result.ok, true);
  assert.equal(result.aliases.length, 2);
});

test('framework aliases do not hide a broken relative import outside a workspace', t => {
  const {root} = fixture(t, {
    'start.js': "import './scripts/tool.mjs';",
    'scripts/tool.mjs': "import '../core/decorators.js';",
    'src/core/decorators.js': 'export {};',
  });
  assert.equal(checkPublic({root}).problems.imports[0].expected, 'core/decorators.js');
});

test('entry checks include missing main/bin and quoted Node scripts after flags', t => {
  const {root} = fixture(t, {
    'package.json': {main: 'absent.js', bin: {mini: 'bin/mini.mjs'}, scripts: {qa: 'node --test --test-concurrency=1 "tests/missing file.mjs"', android: 'node scripts/run-python.mjs android/build.py'}},
    'scripts/run-python.mjs': 'export {};',
  });
  const result = checkPublic({root});
  assert.deepEqual(result.problems.entries.map(p => p.file).sort(), ['absent.js', 'bin/mini.mjs', 'tests/missing file.mjs', 'android/build.py'].sort());
});

test('literal loader and worker URLs and import attributes are traversed', t => {
  const {root} = fixture(t, {
    'start.js': "new URL('./hooks.mjs', import.meta.url); import('./config.json', {with: {type: 'json'}});",
    'hooks.mjs': "new URL('./worker.mjs', import.meta.url);",
    'config.json': '{}',
  });
  assert.equal(checkPublic({root}).problems.imports[0].expected, 'worker.mjs');
});

test('lexical scanning ignores comments, strings and regex examples', () => {
  const code = [
    '// import "comment.js"',
    '/* require("comment.cjs") */',
    'const example = "import \'example.js\'";',
    "const regex = /import 'regex.js'/;",
    "import './real.js'; export {x} from './other.js';",
    "const third = import('./dynamic.js'); const fourth = require('./require.cjs');",
    "import.meta.resolve('compiler/module.wasm');",
    "import('./computed-' + name); require('./computed-' + name);",
  ].join('\n');
  assert.deepEqual(specifiers(code).map(p => p.spec), ['./real.js', './other.js', './dynamic.js', './require.cjs', 'compiler/module.wasm']);
});

test('ESM paths are exact while require may use a supported extension', t => {
  const {root, write} = fixture(t, {'start.js': "import './dependency';", 'dependency.js': 'export {};'});
  assert.equal(checkPublic({root}).ok, false);
  write('start.js', "require('./dependency');");
  assert.equal(checkPublic({root}).ok, true);
});

test('only shipped package declarations satisfy dependencies', t => {
  const {root, write} = fixture(t, {
    'start.js': "import './addons/tool.mjs';",
    'addons/tool.mjs': "import 'optional-addon';",
    'addons/package.json': {dependencies: {'optional-addon': '1.0.0'}},
  });
  const files = ['package.json', 'start.js', 'addons/tool.mjs'];
  write('PUBLIC_MANIFEST.json', {edition: 'public', files});
  assert.equal(checkPublic({root}).problems.packages[0].name, 'optional-addon');
  files.push('addons/package.json'); write('PUBLIC_MANIFEST.json', {edition: 'public', files});
  assert.equal(checkPublic({root}).ok, true);
});

test('manifest validation rejects missing files, tampering, duplicates and unsafe paths', t => {
  const {root, write} = fixture(t);
  const sha256 = createHash('sha256').update('export {};').digest('hex');
  write('PUBLIC_MANIFEST.json', {edition: 'public', version: '1.0.13', files: ['package.json', {path: 'start.js', sha256}]});
  assert.equal(checkPublic({root}).ok, true);
  write('start.js', 'export const changed = true;');
  assert.match(checkPublic({root}).problems.manifest[0].why, /SHA-256/);
  write('PUBLIC_MANIFEST.json', {files: ['package.json', 'start.js', 'missing.js', 'start.js', '../outside.js']});
  assert.equal(checkPublic({root}).problems.manifest.length, 3);
});

test('explicit missing manifests fail instead of silently scanning the Full tree', t => {
  const {root} = fixture(t);
  const result = spawnSync(process.execPath, [checker, '--root', root, '--manifest', path.join(root, 'missing.json'), '--quiet'], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/);
});

test('a --files selection detects a listed-but-absent file even without hashes', t => {
  const {root, write} = fixture(t);
  write('list.txt', '# reviewed\npackage.json\nstart.js\nmissing.js\n');
  assert.equal(checkPublic({root, files: path.join(root, 'list.txt')}).problems.manifest[0].file, 'missing.js');
});

test('standalone Public CLI works without private publishing tools', t => {
  const {root, write} = fixture(t);
  write('scripts/check-public.mjs', fs.readFileSync(checker, 'utf8'));
  write('package.json', {main: 'start.js', scripts: {'check:public': 'node scripts/check-public.mjs'}});
  write('PUBLIC_MANIFEST.json', {edition: 'public', files: ['package.json', 'start.js', 'scripts/check-public.mjs']});
  const result = spawnSync(process.execPath, ['scripts/check-public.mjs', '--quiet'], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
