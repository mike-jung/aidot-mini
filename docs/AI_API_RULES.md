# API authoring guide

This document is for an AI assistant that has no previous knowledge of this
project. Use it with an aidot-mini source project or API Starter. Do not rebuild
the runtime. If the project or a required target is unavailable, state what you
could not execute instead of claiming successful verification.

## Inputs and deliverables

Confirm the API paths, table/fields, validation rules, authentication, error
statuses, workspace location and treatment of existing data. Do not invent
destructive migration or authorization requirements. Deliver Controller,
Service, named SQL, new migrations and executable HTTP checks for the requested
behavior. The server creates metadata; the author does not write it manually.

## Runtime and file rules

Node.js 22.13+ runs ES modules with built-in SQLite. `esbuild-wasm` compiles the
annotation syntax. Business files use `.js`, standard imports and default class
exports. The runtime loads the selected workspace in migration/SQL/Service/
Controller order. Classes are shared instances; do not store per-request users
or payloads on `this`.

| Folder | Role |
|---|---|
| `controller/` | Annotated routes and Service calls |
| `service/` | Reusable business logic and database calls |
| `sql/` | Named queries selected by `@Sql` |
| `migrations/` | Ordered schema/data changes with stored checksums |
| `controller/meta/`, `service/meta/` | Server-generated and loaded declarations |

Select a workspace through `.env` (`APP_WORKSPACE=/absolute/path`) or the console.
The path points to its root, not its Controller folder. Process environment
variables override `.env`, which overrides saved settings. Use `DATA_DIR` for a
separate persistent state location. Restart to apply workspace changes.
`npm run workspace:init -- ./my-workspace --empty` creates a new empty workspace.

Keep `../../src/core/decorators.js`, `../../src/database/db.js` and
`../../src/core/sqlLoader.js` imports exactly as below. The loader maps these
standard host imports for external workspaces. Do not add a new router, service
registry or database connection to an ordinary business API.

## Supported declarations

| Declaration | Meaning |
|---|---|
| `@Controller('/api/notes')` | Controller route prefix |
| `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping` | Method-level HTTP routes |
| `@Service('NoteService')` | Register the Service by name |
| `@Autowired('NoteService') noteService;` | Inject the registered shared Service |
| `@Sql('note') noteSql;` | Inject queries from `sql/note.sql` |
| `@Log log;` | Inject a logger; do not add parentheses |
| `@Auth()` | Require authentication on this method |

Handlers receive `(params, req, res)`. `params` merges query, JSON body and URL
path with **query < body < path** precedence. Query/path values are normally
strings. Validate inputs explicitly; the merge is not validation.
Return a value for the host's `code/message/header/data` envelope. If sending
`res.status(...).json(...)`, do not send or return another response.

`db.execute(sql, values)` returns `rows`, `insertId` and `rowsAffected`.
`this.noteSql.get('findById')` returns query text, not a database result.
Use `:name` placeholders and bound values. Never interpolate untrusted input
into SQL. `fillPlaceholders` supplies null for omitted named fields; it does not
validate a payload or implement PATCH semantics. Map client-selectable column or
sort identifiers to a fixed allowlist rather than treating them as SQL values.

## Complete Note example

These are the actual runnable source files in the project. Existing comments and
message strings are retained. Use the same class and method structure for a new
API, with names, fields and validation appropriate to its requirements.

### workspace/controller/NoteController.js

```javascript
///
/// NoteController
/// My Note API
///

import {
  Controller,
  Log,
  GetMapping,
  PostMapping,
  PutMapping,
  DeleteMapping,
  Autowired,
} from '../../src/core/decorators.js';


@Controller('/api/notes')
export default class NoteController {

  @Autowired('NoteService') noteService;

  @Log log;

  // 1. GET /api/notes/  →  NoteController.list
  @GetMapping('/')
  async list(params) {
    this.log.info(`${this.constructor.name}::list 호출됨`);
    const result = await this.noteService.list();
    return result;
  }

  // 2. GET /api/notes/:id  →  NoteController.get
  @GetMapping('/:id')
  async get(params) {
    this.log.info(`${this.constructor.name}::get 호출됨 -> id=${params.id}`);
    const result = await this.noteService.getById(params.id);
    if (result === null || result === undefined) throw Object.assign(new Error(`id ${params.id} 을(를) 찾을 수 없습니다`), { status: 404 });
    return result;
  }

  // 3. POST /api/notes/  →  NoteController.create
  @PostMapping('/')
  async create(params, req, res) {
    this.log.info(`${this.constructor.name}::create 호출됨 -> params=${JSON.stringify(params)}`);
    const result = await this.noteService.create(params);
    res.status(201).json({
      code: 201, message: 'Created',
      header: {
        requestCode: params.requestCode || null,
        timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false }).replace('T', ' '),
      },
      data: result,
    });
  }

  // 4. PUT /api/notes/:id  →  NoteController.update
  @PutMapping('/:id')
  async update(params) {
    this.log.info(`${this.constructor.name}::update 호출됨 -> id=${params.id}`);
    return this.noteService.update(params);
  }

  // 5. DELETE /api/notes/:id  →  NoteController.remove
  @DeleteMapping('/:id')
  async remove(params) {
    this.log.info(`${this.constructor.name}::remove 호출됨 -> id=${params.id}`);
    return this.noteService.remove(params.id);
  }
}
```

### workspace/service/NoteService.js

```javascript
///
/// NoteService
/// My Note Service
///

import { Service, Sql, Log } from '../../src/core/decorators.js';
import db from '../../src/database/db.js';
import { fillPlaceholders } from '../../src/core/sqlLoader.js';


@Service('NoteService')
export default class NoteService {

  // SQL 파일 주입: src/database/sql/note.sql
  @Sql('note') noteSql;

  @Log log;

  // 전체 조회
  async list() {
    this.log.info(`${this.constructor.name}::list 호출됨`);
    const sql = this.noteSql.get('findAll');
    const res = await db.execute(sql, {});
    return res.rows;
  }

  // 단건 조회
  async getById(id) {
    this.log.debug(`${this.constructor.name}::getById 호출됨 -> id=${id}`);
    const sql = this.noteSql.get('findById');
    const res = await db.execute(sql, { id });
    return res.rows[0] ?? null;
  }

  // 생성
  async create(payload) {
    this.log.info(`${this.constructor.name}::create 호출됨`);
    const sql = this.noteSql.get('insert');
    const res = await db.execute(sql, payload);
    return { insertId: res.insertId, rowsAffected: res.rowsAffected };
  }

  // 수정
  async update(params) {
    this.log.info(`${this.constructor.name}::update 호출됨 -> id=${params?.id}`);
    const sql = this.noteSql.get('update');
    const res = await db.execute(sql, fillPlaceholders(sql, params));
    return { rowsAffected: res.rowsAffected };
  }

  // 삭제
  async remove(id) {
    this.log.info(`${this.constructor.name}::remove 호출됨 -> id=${id}`);
    const sql = this.noteSql.get('deleteById');
    const res = await db.execute(sql, { id });
    return { rowsAffected: res.rowsAffected };
  }
}
```

### workspace/sql/note.sql

```sql
-- note.sql  (auto-generated)
-- My Note
-- 접근 키: 'note:<n>'  (예: 'note:findAll')

-- @name: findAll
SELECT id, title, body, created_at, updated_at FROM note ORDER BY id DESC;

-- @name: findById
SELECT id, title, body, created_at, updated_at FROM note WHERE id = :id;

-- @name: insert
INSERT INTO note (title, body)
VALUES (:title, :body);

-- @name: update
UPDATE note
   SET title = :title, body = :body
 WHERE id = :id;

-- @name: deleteById
DELETE FROM note WHERE id = :id;
```

## Table creation and migrations

Queries do not create their table automatically. Add a new migration when adding
a table to an existing workspace. Do not modify applied migration files or their
checksums. The bundled Note table already exists after its migrations; do not
add another conflicting Note migration to it. For a new empty workspace, an
ordinary SQLite migration can use this table definition:

```sql
-- Target setup for aidot-express with DB_TYPE=sqlite. Not a named-query file.
CREATE TABLE IF NOT EXISTS note (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title VARCHAR(200) NOT NULL,
  body TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL
);
CREATE INDEX IF NOT EXISTS idx_note_created ON note (created_at);
```

Keep schema changes in migrations and named DML in `sql/`. Never put controller
routes or arbitrary JavaScript into a SQL file. Define timestamp updates and
missing-field behavior explicitly when the business needs them.

## Protected API variant

The complete protected Controller is below. Its Service, SQL and migrations are
the same as the public variant. Select `examples/note-auth-workspace` as a whole
workspace; do not load two Controllers for the same route at once.

```javascript
///
/// NoteController
/// My Note API
///

import {
  Controller,
  Log,
  GetMapping,
  Auth,
  PostMapping,
  PutMapping,
  DeleteMapping,
  Autowired,
} from '../../src/core/decorators.js';


@Controller('/api/notes')
export default class NoteController {

  @Autowired('NoteService') noteService;

  @Log log;

  // 1. GET /api/notes/  →  NoteController.list
  @GetMapping('/')
  @Auth()
  async list(params) {
    this.log.info(`${this.constructor.name}::list 호출됨`);
    const result = await this.noteService.list();
    return result;
  }

  // 2. GET /api/notes/:id  →  NoteController.get
  @GetMapping('/:id')
  @Auth()
  async get(params) {
    this.log.info(`${this.constructor.name}::get 호출됨 -> id=${params.id}`);
    const result = await this.noteService.getById(params.id);
    if (result === null || result === undefined) throw Object.assign(new Error(`id ${params.id} 을(를) 찾을 수 없습니다`), { status: 404 });
    return result;
  }

  // 3. POST /api/notes/  →  NoteController.create
  @PostMapping('/')
  @Auth()
  async create(params, req, res) {
    this.log.info(`${this.constructor.name}::create 호출됨 -> params=${JSON.stringify(params)}`);
    const result = await this.noteService.create(params);
    res.status(201).json({
      code: 201, message: 'Created',
      header: {
        requestCode: params.requestCode || null,
        timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false }).replace('T', ' '),
      },
      data: result,
    });
  }

  // 4. PUT /api/notes/:id  →  NoteController.update
  @PutMapping('/:id')
  @Auth()
  async update(params) {
    this.log.info(`${this.constructor.name}::update 호출됨 -> id=${params.id}`);
    return this.noteService.update(params);
  }

  // 5. DELETE /api/notes/:id  →  NoteController.remove
  @DeleteMapping('/:id')
  @Auth()
  async remove(params) {
    this.log.info(`${this.constructor.name}::remove 호출됨 -> id=${params.id}`);
    return this.noteService.remove(params.id);
  }
}
```

Console sessions and administrator API tokens are host credentials. Do not copy
account files or hard-code tokens into business code. Method-level `@Auth()` is
required for protected routes; metadata descriptions do not grant permissions.

## Required response behavior

- List returns an array; a successful read returns one row.
- A missing Note read returns 404.
- Create returns HTTP 201 and `{ insertId, rowsAffected }` in `data`.
- Update/delete return `{ rowsAffected }`, including zero for a missing row.
- Omitted fields passed through `fillPlaceholders` become null.
- A new API must explicitly validate required fields, allowed types and lengths.
- Decide whether update/delete of a missing record returns zero or a 404 for the
  requested API; do not silently change the bundled Note contract.

The sample's database constraint is not a complete production validation layer.
Browser form validation also does not protect direct HTTP calls.

## Verify the actual API

Run from the project root:

```sh
npm run check
npm run contract:check
node scripts/verify-api-example.mjs
node scripts/verify-api-example.mjs --auth
```

`check` uses the annotation compiler; raw `node --check` on a decorated Controller
is not an equivalent check. `contract:check` compares runtime declarations and
metadata, generating missing metadata as needed. Before read-only deployment,
run `npm run workspace:compile`.

The complete HTTP verifier below runs copied workspaces with temporary data,
random ports and a temporary credential. It tests CRUD, authentication when
requested, metadata generation and persistence after restart. It does not change
the original workspace or database. Change its payloads and assertions for a
new API; the Note verifier alone does not test different business requirements.

### scripts/verify-api-example.mjs

```javascript
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    workspace: { type: 'string' },
    'base-path': { type: 'string', default: '/api/notes' },
    auth: { type: 'boolean', default: false },
  },
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(values.workspace || process.env.APP_WORKSPACE ||
  path.join(root, values.auth ? 'examples/note-auth-workspace' : 'workspace'));
const api = values['base-path'].replace(/\/$/, '');
assert.match(api, /^\/api\/[A-Za-z0-9/_-]+$/);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-guide-api-'));
const workspace = path.join(temp, 'workspace');
const token = randomBytes(32).toString('hex');
const cases = [];
let child;
let origin;

async function start() {
  let stderr = '';
  child = fork(path.join(root, 'start.js'), [], {
    cwd: root,
    execArgv: [],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: {
      ...process.env,
      ENV_FILE: path.join(temp, 'empty.env'),
      APP_WORKSPACE: workspace,
      DATA_DIR: path.join(temp, 'data'),
      DB_FILE: path.join(temp, 'data', 'test.db'),
      SETTINGS_FILE: path.join(temp, 'data', 'settings.json'),
      ADMIN_ACCOUNT_FILE: path.join(temp, 'data', 'admin-account.json'),
      ADMIN_TOKEN_FILE: path.join(temp, 'data', 'admin-token'),
      ADMIN_TOKEN: token,
      HOST: '127.0.0.1',
      PORT: '0',
      HTTPS_ENABLED: 'false',
      MANAGED_ENDPOINT: 'false',
      LOG_TO_FILE: 'false',
      LOG_LEVEL: 'error',
    },
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout: ' + stderr)), 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error('Server exited: ' + code + '\n' + stderr));
    });
    child.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(message.port); }
    });
  });
  origin = 'http://127.0.0.1:' + port;
}

async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const target = child;
  await new Promise(resolve => {
    const timer = setTimeout(() => target.kill('SIGKILL'), 5000);
    target.once('exit', () => { clearTimeout(timer); resolve(); });
    if (target.connected) target.send({ type: 'aidot:shutdown' });
    else target.kill('SIGTERM');
  });
}

async function request(name, method, url, body, status = 200, authorized = values.auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (authorized) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(origin + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  assert.equal(response.status, status, name + ': ' + JSON.stringify(result));
  assert.equal(result.code, status, name + ': response code');
  cases.push(name);
  return result;
}

try {
  fs.writeFileSync(path.join(temp, 'empty.env'), '');
  fs.mkdirSync(workspace);
  for (const folder of ['controller', 'service', 'sql', 'migrations']) {
    fs.cpSync(path.join(source, folder), path.join(workspace, folder), {
      recursive: true,
      filter: file => path.basename(file) !== 'meta',
    });
  }
  fs.writeFileSync(path.join(workspace, 'package.json'), '{"type":"module","private":true}\n');
  await start();
  const generated = await request('Metadata generated and loaded', 'GET',
    '/admin/metadata', undefined, 200, true);
  const records = [...generated.data.controllers, ...generated.data.services];
  assert.ok(records.length >= 2);
  const metadataBytes = new Map();
  for (const record of records) {
    assert.equal(record.status, 'generated');
    assert.equal(record.metadata._version, 2);
    assert.ok(record.file.startsWith(workspace + path.sep));
    const bytes = fs.readFileSync(record.file, 'utf8');
    assert.deepEqual(JSON.parse(bytes), record.metadata);
    metadataBytes.set(record.file, bytes);
  }

  if (values.auth) {
    for (const [method, suffix, body] of [
      ['GET', '', undefined], ['GET', '/1', undefined],
      ['POST', '', { title: 'Denied', body: null }],
      ['PUT', '/1', { title: 'Denied', body: null }], ['DELETE', '/1', undefined],
    ]) {
      await request('Anonymous rejected: ' + method + suffix, method, api + suffix, body, 401, false);
    }
  }

  // This payload contract belongs to the Note example. Change both data and assertions for another API.
  let result = await request('List', 'GET', api);
  assert.ok(Array.isArray(result.data));
  const initialCount = result.data.length;
  result = await request('Create', 'POST', api, {
    title: 'AI sample', body: "한국어 and SQL text ':id'", requestCode: 'guide-create',
  }, 201);
  assert.equal(result.message, 'Created');
  assert.equal(result.header.requestCode, 'guide-create');
  assert.equal(result.data.rowsAffected, 1);
  const id = result.data.insertId;
  assert.ok(Number.isSafeInteger(id) && id > 0);
  assert.deepEqual(Object.keys(result.data).sort(), ['insertId', 'rowsAffected']);
  const rowUrl = api + '/' + id;
  result = await request('Read created row', 'GET', rowUrl);
  assert.equal(result.data.title, 'AI sample');
  assert.equal(result.data.body, "한국어 and SQL text ':id'");

  result = await request('Update; path ID wins', 'PUT', rowUrl + '?id=999999', {
    id: 888888, title: 'Changed', body: null,
  });
  assert.deepEqual(result.data, { rowsAffected: 1 });
  result = await request('Read updated row', 'GET', rowUrl);
  assert.equal(result.data.title, 'Changed');
  assert.equal(result.data.body, null);
  result = await request('Omit optional body', 'PUT', rowUrl, { title: 'Persisted' });
  assert.deepEqual(result.data, { rowsAffected: 1 });
  result = await request('Omitted body becomes NULL', 'GET', rowUrl);
  assert.equal(result.data.body, null);

  await stop();
  await start();
  const reloaded = await request('Metadata reloaded without rewriting', 'GET',
    '/admin/metadata', undefined, 200, true);
  for (const record of [...reloaded.data.controllers, ...reloaded.data.services]) {
    assert.equal(record.status, 'loaded');
    assert.equal(fs.readFileSync(record.file, 'utf8'), metadataBytes.get(record.file));
  }
  result = await request('Persisted after restart', 'GET', rowUrl);
  assert.equal(result.data.title, 'Persisted');
  assert.equal(result.data.body, null);
  result = await request('List after create', 'GET', api + '?requestCode=guide-list');
  assert.equal(result.data.length, initialCount + 1);
  assert.equal(result.header.requestCode, 'guide-list');
  assert.equal(result.data[0].id, id);

  result = await request('Delete', 'DELETE', rowUrl);
  assert.deepEqual(result.data, { rowsAffected: 1 });
  await request('Deleted row is 404', 'GET', rowUrl, undefined, 404);
  result = await request('Repeat delete returns zero', 'DELETE', rowUrl);
  assert.deepEqual(result.data, { rowsAffected: 0 });
  result = await request('Update deleted row returns zero', 'PUT', rowUrl, { title: 'Missing', body: null });
  assert.deepEqual(result.data, { rowsAffected: 0 });
  result = await request('List restored', 'GET', api);
  assert.equal(result.data.length, initialCount);
  await request('Admin metadata stays protected', 'GET', '/admin/metadata', undefined, 401, false);
  console.log(JSON.stringify({ passed: cases.length, auth: values.auth, api, cases }, null, 2));
} finally {
  await stop();
  fs.rmSync(temp, { recursive: true, force: true });
}
```

For an API with the same Note payload contract at a new route:

```sh
node scripts/verify-api-example.mjs --workspace ./my-workspace --base-path /api/tasks
```

For any other contract, update the script first. Include invalid input,
unauthenticated access, a missing ID, duplicate/constraint cases relevant to the
API, read-after-write results and persistence. Record actual OS, Node version,
database and executed results. Do not treat syntax checks or a single HTTP 200
as evidence of complete behavior.

## Export and handoff

Update `module.json` with the Controller, Service, SQL and migration names.
Include the metadata generated by a successful server load. Run
`npm run port:export` to produce a workspace module. Deployment state, credentials
and runtime caches are not replacements for source files.

Give the user the business files, new migrations, generated metadata and actual
verification commands/results. State remaining target limitations. A browser
screen is not automatically generated for each new API: Sample API is specific
to `/api/notes`; use an HTTP client or a separate UI for other routes.

## Request template

```text
Use the supplied project and API guide to implement this API.
Workspace: <path>
Routes and methods: <requirements>
Table and fields: <requirements>
Validation and errors: <requirements>
Authentication: <public or protected>
Existing data and migration policy: <requirements>
Write Controller, Service, SQL and new migrations in the selected workspace.
Let the server generate metadata. Run syntax, declaration and real HTTP checks.
Return the changed files and actual results, including any untested target.
```
