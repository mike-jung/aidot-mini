import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = path.join(root, 'scripts/verify-workspace.mjs');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-generated-fixture-'));
  const workspace = path.join(directory, 'generated workspace');
  const migrations = path.join(directory, 'external schema');
  const files = {
    'controller/HelloController.js': `import { Controller, GetMapping, PostMapping, Autowired, Auth } from '@aidot/core/decorators.js';
@Controller('/api/generated-hello')
export default class HelloController {
  @Autowired('HelloService') service;
  @GetMapping('/') list() { return this.service.list(); }
  @PostMapping('/') @Auth({ realm: 'admin', roles: ['admin'] })
  create(params) { return this.service.create(params); }
}
`,
    'service/HelloService.js': `import { Service, Sql } from '@aidot/core/decorators.js';
import db from '@aidot/database/db.js';
@Service('HelloService')
export default class HelloService {
  @Sql('hello') sql;
  async list() { return (await db.execute(this.sql.get('findAll'))).rows; }
  async create(input) {
    if (typeof input.name !== 'string') throw Object.assign(new Error('name required'), { status: 400 });
    const result = await db.execute(this.sql.get('insert'), { name: input.name });
    return { added: result.rowsAffected };
  }
}
`,
    'sql/hello.sql': '-- @name: findAll\nSELECT id, name FROM generated_hello ORDER BY id;\n-- @name: insert\nINSERT INTO generated_hello(name) VALUES (:name);\n',
  };
  for (const [relative, source] of Object.entries(files)) {
    const filename = path.join(workspace, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, source);
  }
  fs.mkdirSync(path.join(migrations, 'sqlite'), { recursive: true });
  fs.writeFileSync(path.join(migrations, 'sqlite/001_schema.sql'), 'CREATE TABLE generated_hello (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\n');
  const cases = path.join(directory, 'cases.json');
  const run = (rows, extraEnv = {}) => {
    if (rows !== undefined) fs.writeFileSync(cases, JSON.stringify(rows));
    const result = spawnSync(process.execPath, [runner, '--workspace', workspace, '--migrations', migrations, ...(rows === undefined ? [] : ['--cases', cases])], {
      cwd: directory,
      env: { ...process.env, ...extraEnv },
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.ifError(result.error);
    return { ...result, report: JSON.parse(result.stdout) };
  };
  return { directory, workspace, migrations, files, run };
}

test('generic verifier runs generated Controller/Service/SQL cases with isolated state and preserves originals', () => {
  const fixtureValue = fixture();
  const { directory, workspace, files, run } = fixtureValue;
  try {
    fs.mkdirSync(path.join(workspace, 'templates'));
    fs.writeFileSync(path.join(workspace, 'templates/unused.js'), 'unrendered template syntax @@@');
    const existingData = path.join(directory, 'existing-data');
    fs.mkdirSync(existingData);
    const existingDb = path.join(existingData, 'must-not-open.db');
    fs.writeFileSync(existingDb, 'existing application data');
    const existingEnv = path.join(directory, 'existing.env');
    fs.writeFileSync(existingEnv, 'PORT=1234\nAPP_WORKSPACE=not-this-workspace\n');
    const rows = [
      { path: '/api/generated-hello', status: 200, expect: { code: 200, data: [] } },
      { method: 'POST', path: '/api/generated-hello', status: 401, body: { name: 'forbidden' }, expect: { code: 401 } },
      { method: 'POST', path: '/api/generated-hello', status: 200, auth: 'admin', body: { name: '생성한 예제' }, expect: { data: { added: 1 } } },
      { path: '/api/generated-hello', status: 200, expect: { data: [{ id: 1, name: '생성한 예제' }] } },
      { method: 'POST', path: '/api/generated-hello', status: 400, auth: 'admin', body: { name: [] }, expect: { code: 400 } },
    ];
    const result = run(rows, {
      ENV_FILE: existingEnv,
      DB_FILE: existingDb,
      DB_MIGRATIONS_DIR: 'does-not-exist',
      DB_APP_SCHEMA: 'invalid schema',
      APP_WORKSPACE: 'does-not-exist',
      ADMIN_TOKEN: 'invalid-short-token',
      DATA_DIR: existingData,
      PORT: 'invalid',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.report.businessRequests, rows.length);
    assert.equal(result.report.businessAssertions, rows.length);
    assert.equal(result.report.businessVerified, true);
    assert.equal(result.report.startupVerified, true);
    assert.equal(result.report.precompile.completed, true);
    assert.equal(result.report.precompile.exitedBeforeServer, true);
    assert.ok(result.report.precompile.rssMiBAtCompletion > 0);
    assert.deepEqual(result.report.declarations, { controllers: 1, services: 1, routes: 2, queries: 2 });
    assert.ok(result.report.runtimeRssMB > 0);
    assert.equal(result.report.sourceUnchanged, true);
    assert.equal(fs.readFileSync(existingDb, 'utf8'), 'existing application data');
    assert.deepEqual(fs.readdirSync(existingData), ['must-not-open.db']);
    for (const [relative, source] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(workspace, relative), 'utf8'), source);
    assert.equal(fs.existsSync(path.join(workspace, 'controller/meta')), false);
    assert.equal(fs.existsSync(path.join(workspace, '.aidot-cache')), false);
    assert.equal(fs.readFileSync(path.join(workspace, 'templates/unused.js'), 'utf8'), 'unrendered template syntax @@@');
    const second = run([{ path: '/api/generated-hello', status: 200, expect: { data: [] } }]);
    assert.equal(second.status, 0, second.stdout + second.stderr);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('startup-only is explicit and assertion or compilation failures return nonzero', () => {
  const { directory, workspace, run } = fixture();
  try {
    const startup = run();
    assert.equal(startup.status, 0, startup.stdout + startup.stderr);
    assert.equal(startup.report.startupVerified, true);
    assert.equal(startup.report.businessVerified, false);
    assert.equal(startup.report.businessRequests, 0);
    assert.match(startup.report.scope, /business behavior was not verified/);
    const failure = run([{ name: 'intentional failure', path: '/api/generated-hello', status: 200, expect: { data: [{ name: 'absent' }] } }]);
    assert.equal(failure.status, 1);
    assert.equal(failure.report.startupVerified, true);
    assert.equal(failure.report.businessVerified, false);
    assert.equal(failure.report.sourceUnchanged, true);
    assert.match(failure.report.error, /intentional failure.*array length differs/);
    fs.appendFileSync(path.join(workspace, 'controller/HelloController.js'), '\ninvalid syntax @@@\n');
    const compilation = run();
    assert.equal(compilation.status, 1);
    assert.equal(compilation.report.startupVerified, false);
    assert.equal(compilation.report.businessVerified, false);
    assert.match(compilation.report.error, /Precompiler exited before completion/);
    assert.match(compilation.report.serverLog, /Transform failed|Expected|Unexpected/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('case validation rejects external URLs, invalid statuses and symlinked sources before server startup', () => {
  const { directory, workspace, run } = fixture();
  try {
    for (const row of [
      { path: 'https://example.invalid/data', status: 200 },
      { path: '//example.invalid/data', status: 200 },
      { path: '/\\example.invalid/data', status: 200 },
      { path: '/api/generated-hello', status: '200' },
      { path: '/api/generated-hello', status: 199 },
      { path: '/api/generated-hello', status: 600 },
    ]) {
      const result = run([row]);
      assert.equal(result.status, 1);
      assert.equal(result.report.startupVerified, false);
      assert.equal(result.report.businessRequests, 0);
    }
    const target = path.join(directory, 'outside');
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const linked = run();
    assert.equal(linked.status, 1);
    assert.match(linked.report.error, /Symlinks are not supported/);
    assert.equal(linked.report.startupVerified, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
