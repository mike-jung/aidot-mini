import {readFileSync as readVersionFile} from 'node:fs';
const currentVersion=JSON.parse(readVersionFile(new URL('../package.json',import.meta.url),'utf8')).version;
/**
 * server.test.mjs — aidot-mini 통합 시험.
 *   npm test
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  ⚠ 왜 `await import()` 로 불러오는가 — 이건 실수가 아니다
 * ══════════════════════════════════════════════════════════════════════════
 *  ESM 은 **import 문을 모듈 본문보다 먼저 평가**한다. 그래서
 *
 *      import config from '../src/config.js';       // ← 여기서 env 를 이미 읽는다
 *      process.env.PORT = '19000';                  // ← 너무 늦다. 무시된다
 *
 *  처럼 쓰면 설정이 조용히 무시된다. aidot-safetalk 의 테스트 하네스가 정확히
 *  이 함정에 빠져 있었다 — 테스트는 13100 포트로 요청하는데 서버는 .env 의 3240 에 떠서
 *  전 케이스가 `fetch failed` 로 실패했고, 지웠다고 생각한 DB 에 이전 데이터가 남아
 *  PRIMARY KEY 중복까지 났다. 원인이 코드가 아니라 **로딩 순서**라 추적이 매우 어려웠다.
 *
 *  그래서 여기서는 env 를 먼저 세우고 `await import()` 로 나중에 불러온다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ── ① env 를 먼저 세운다 (정적 import 보다 앞) ─────────────────────────── */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-mini-test-'));
const PORT = 0;

process.env.NODE_ENV = 'test';
process.env.ADMIN_TOKEN = 'test-only-key-0123456789-abcdefghijk';
process.env.DATA_DIR = TMP;
process.env.HTTPS_ENABLED = 'false';
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.DB_FILE = path.join(TMP, 'test.db');
process.env.LOG_LEVEL = 'error';
process.env.LOG_TO_FILE = 'false';
process.env.DB_SAMPLE_PREFIX = 'sample_';

/* ── ② 그다음에 불러온다 ────────────────────────────────────────────────── */
const { main } = await import('../start.js');
const { toSqlite, normalizeParams } = await import('../src/database/dialect.js');
const { parseSqlFile, renderTokens, samplePrefix } = await import('../src/core/sqlLoader.js');
const { createContext, runWith, currentRequestId, addStep, outboundHeaders } =
  await import('../src/core/requestContext.js');

let BASE;
let server;

test.before(async () => { server = await main({signals:false}); BASE = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => {
  if (server) await server.stop();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const api = async (method, p, body) => {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Authorization': `Bearer ${process.env.ADMIN_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, headers: r.headers, body: text ? JSON.parse(text) : null };
};

test('SSE 라우트는 인증을 적용하고 실제 서버에서 상태를 보낸다', async()=>{
  assert.equal((await fetch(BASE+'/admin/events')).status,401);
  const response=await fetch(BASE+'/admin/events',{headers:{Authorization:`Bearer ${process.env.ADMIN_TOKEN}`}});
  assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const reader=response.body.getReader();
  const frame=new TextDecoder().decode((await reader.read()).value);
  assert.match(frame,/event: status/);assert.match(frame,new RegExp('"version":"'+currentVersion.replaceAll('.','\\.')+'"'));
  await reader.cancel();
  const head=await fetch(BASE+'/admin/events',{method:'HEAD',headers:{Authorization:`Bearer ${process.env.ADMIN_TOKEN}`}});
  assert.equal(head.status,200);assert.equal(await head.text(),'');
});

/* ══════════════════════════ 방언 변환 ══════════════════════════ */

test('MariaDB AUTO_INCREMENT 를 SQLite 형태로 바꾼다', () => {
  const out = toSqlite('CREATE TABLE t (id BIGINT NOT NULL AUTO_INCREMENT, n VARCHAR(50), PRIMARY KEY (id)) ENGINE=InnoDB');
  assert.match(out, /id INTEGER PRIMARY KEY AUTOINCREMENT/);
  assert.equal(/PRIMARY KEY \(id\)/.test(out), false, '중복 PK 절이 남으면 오류가 난다');
  assert.equal(/ENGINE/.test(out), false);
});

test('DELETE ... ORDER BY ... LIMIT 을 rowid 부분질의로 바꾼다', () => {
  // SQLite 기본 빌드는 이 구문을 못 받는다 (near "ORDER": syntax error)
  const out = toSqlite('DELETE FROM logs ORDER BY ts ASC LIMIT 10');
  assert.match(out, /DELETE FROM logs WHERE rowid IN \(SELECT rowid FROM logs ORDER BY ts ASC LIMIT 10\)/);
  // WHERE 절이 있어도 보존해야 한다
  assert.match(toSqlite('DELETE FROM t WHERE k = :k ORDER BY ts ASC LIMIT 5'), /WHERE k = :k ORDER BY/);
  // 평범한 DELETE 는 건드리지 않는다
  assert.equal(toSqlite('DELETE FROM t WHERE id = :id'), 'DELETE FROM t WHERE id = :id');
});

test('파라미터를 SQLite 가 받는 형태로 정규화한다', () => {
  const p = normalizeParams({ a: undefined, b: true, c: false, d: new Date('2026-08-25T01:02:03Z') });
  assert.equal(p.a, null, 'undefined 는 바인딩할 수 없다');
  assert.equal(p.b, 1); assert.equal(p.c, 0);
  assert.equal(p.d, '2026-08-25 01:02:03');
});

/* ══════════════════════════ SQL 로더 ══════════════════════════ */

test('-- @name: 마커로 SQL 을 잘라 낸다', () => {
  const s = parseSqlFile(`
-- @name: findAll
SELECT * FROM t;

-- @name: insert
INSERT INTO t (a) VALUES (:a);
`);
  assert.deepEqual(Object.keys(s), ['findAll', 'insert']);
  assert.equal(s.findAll, 'SELECT * FROM t', '끝의 세미콜론은 떼어 낸다');
});

test('{{sample}} 토큰이 접두사로 치환된다', () => {
  const p = samplePrefix();
  assert.equal(renderTokens('SELECT * FROM {{sample}}note'), `SELECT * FROM ${p}note`);
  // 토큰이 없는 SQL 은 건드리지 않는다 — 프레임워크 테이블 보호
  assert.equal(renderTokens('SELECT * FROM schema_migrations'), 'SELECT * FROM schema_migrations');
});

/* ══════════════════════════ 요청 컨텍스트 ══════════════════════════ */

test('requestId 는 짧고 traceId 는 W3C 32자리다', () => {
  const c = createContext({ method: 'GET', url: '/', headers: {} });
  assert.match(c.requestId, /^[0-9a-f]{8}$/);
  assert.match(c.traceId, /^[0-9a-f]{32}$/);
});

test('앞단의 traceparent 를 이어받는다', () => {
  const t = 'a'.repeat(32);
  const c = createContext({ headers: { traceparent: `00-${t}-${'b'.repeat(16)}-01` } });
  assert.equal(c.traceId, t);
  // 전부 0 인 traceId 는 규격상 무효 — 새로 만들어야 한다
  const z = createContext({ headers: { traceparent: `00-${'0'.repeat(32)}-${'1'.repeat(16)}-01` } });
  assert.notEqual(z.traceId, '0'.repeat(32));
});

test('컨텍스트 밖에서는 던지지 않고 null 을 돌려준다', () => {
  assert.equal(currentRequestId(), null, '부팅·스케줄러 로그가 여기서 깨지면 안 된다');
  assert.doesNotThrow(() => addStep('sql', 'x'));
  assert.deepEqual(outboundHeaders(), {});
});

test('동시에 흐르는 두 요청이 섞이지 않는다', async () => {
  const a = createContext({ headers: {} });
  const b = createContext({ headers: {} });
  const seen = await Promise.all([
    runWith(a, async () => { await new Promise((r) => setTimeout(r, 5)); return currentRequestId(); }),
    runWith(b, async () => { await new Promise((r) => setTimeout(r, 1)); return currentRequestId(); }),
  ]);
  assert.deepEqual(seen, [a.requestId, b.requestId]);
});

/* ══════════════════════════ 헬스체크 ══════════════════════════ */

test('liveness 는 DB 를 보지 않는다', async () => {
  const r = await api('GET', '/health/live');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'alive');
  assert.equal('db' in r.body, false, 'DB 가 흔들릴 때 프로세스가 재시작되면 상황이 악화된다');
});

test('readiness 는 모든 항목을 "정상이면 true" 로 보고한다', async () => {
  const r = await api('GET', '/health/ready');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.checks, { accepting: true, db: true, migration: true });
});

/* ══════════════════════════ 라우팅 · CRUD ══════════════════════════ */

test('마이그레이션 시드가 들어가 있다', async () => {
  const r = await api('GET', '/api/notes');
  assert.equal(r.status, 200);
  assert.ok(r.body.data.length >= 1);
  assert.equal(r.body.data[0].title, 'First note');
});

test('CRUD 한 바퀴가 돈다', async () => {
  const c = await api('POST', '/api/notes', { title: '시험', body: '내용' });
  assert.equal(c.status, 201);
  const id = c.body.data.insertId;

  const g = await api('GET', `/api/notes/${id}`);
  assert.equal(g.body.data.title, '시험');

  const u = await api('PUT', `/api/notes/${id}`, { title: '고침', body: '수정 내용' });
  assert.deepEqual(u.body.data, { rowsAffected: 1 });
  const saved = await api('GET', `/api/notes/${id}`);
  assert.equal(saved.body.data.title, '고침');
  assert.equal(saved.body.data.body, '수정 내용');

  const d = await api('DELETE', `/api/notes/${id}`);
  assert.equal(d.body.data.rowsAffected, 1);

  assert.equal((await api('GET', `/api/notes/${id}`)).status, 404);
});

test('생성형 Note의 필수 SQL 값 누락은 내부 내용을 숨긴 DB 오류로 응답한다', async () => {
  const r = await api('POST', '/api/notes', {});
  assert.equal(r.status, 500);
  assert.equal(r.body.message, 'Internal Server Error');
  assert.equal((await api('GET', '/health/ready')).status, 200);
});

test('없는 경로는 404 이고 메서드/경로를 알려 준다', async () => {
  const r = await api('GET', '/nope');
  assert.equal(r.status, 404);
  assert.match(r.body.message, /GET \/nope/);
});

test('모든 응답에 X-Request-Id 와 traceparent 가 붙는다', async () => {
  const r = await api('GET', '/health');
  assert.match(r.headers.get('x-request-id'), /^[0-9a-zA-Z_-]{4,64}$/);
  assert.match(r.headers.get('traceparent'), /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});

test('클라이언트가 준 X-Request-Id 를 존중하되 형식을 검사한다', async () => {
  const good = await fetch(BASE + '/health', { headers: { 'X-Request-Id': 'my-trace-1' } });
  assert.equal(good.headers.get('x-request-id'), 'my-trace-1');
  const bad = await fetch(BASE + '/health', { headers: { 'X-Request-Id': 'a; DROP TABLE x--' } });
  assert.match(bad.headers.get('x-request-id'), /^[0-9a-f]{8}$/, '이상한 값은 버리고 새로 만든다');
});

test('본문이 JSON 이 아니면 400 으로 거절한다', async () => {
  const r = await fetch(BASE + '/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.ADMIN_TOKEN}` }, body: '{깨진',
  });
  assert.equal(r.status, 400);
});

/* ══════════════════════════ 안전성 ══════════════════════════ */

test('정적 서빙이 상위 경로로 탈출하지 못한다', async () => {
  const r = await fetch(BASE + '/../../start.js');
  assert.notEqual(r.status, 200, '경로 탈출이 허용되면 소스가 그대로 노출된다');
});

test('트랜잭션이 중간 실패에 롤백된다', async () => {
  const db = (await import('../src/database/db.js')).default;
  const before = db.get('SELECT COUNT(*) c FROM note').c;
  assert.throws(() => db.transactionSync(() => {
    db.run('INSERT INTO note (title) VALUES (?)', ['롤백대상']);
    throw new Error('의도적 실패');
  })());
  assert.equal(db.get('SELECT COUNT(*) c FROM note').c, before);
});

test('WAL 저널이 켜져 있다 — 급사해도 다음 기동에 복구된다', async () => {
  const db = (await import('../src/database/db.js')).default;
  assert.equal(String(db.get('PRAGMA journal_mode').journal_mode).toLowerCase(), 'wal');
});

// Prefix substitution must never alter user data or migration comments.
test('테이블 접두사 치환은 SQL 문자열과 주석을 보존한다', () => {
  assert.equal(renderTokens("SELECT '{{sample}}literal' FROM {{sample}}note -- {{sample}}comment"), "SELECT '{{sample}}literal' FROM " + samplePrefix() + "note -- {{sample}}comment");
});
