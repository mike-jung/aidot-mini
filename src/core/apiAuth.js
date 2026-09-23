/**
 * apiAuth.js — realm='user' API 계정과 만료되는 토큰.
 *
 * 왜 필요한가
 *   aidot-mini 의 기존 인증은 관리자 토큰(ADMIN_TOKEN) 하나뿐이고, 그 토큰은
 *   언제나 realm='admin' / role='admin' 이다. 업체 연동용 API 를 만들 때 이 토큰을
 *   내주면 관리 콘솔 권한까지 함께 넘어가고, 만료도 없다.
 *
 *   aidot-express 는 users(realm='user') 와 admin_users(realm='admin') 를 나눠
 *   이 문제를 이미 풀어 두었다. 이 파일은 같은 모양을 aidot-mini 에 최소한으로
 *   옮겨, 워크스페이스가 두 런타임에서 똑같이 동작하게 한다:
 *
 *       @Auth({ realm: 'user', roles: ['vendor'] })
 *
 * 의존성
 *   aidot-mini 는 런타임 의존성이 없다(esbuild-wasm 제외). 그래서 JWT(HS256)와
 *   비밀번호 해시(scrypt)를 node:crypto 만으로 구현한다. 토큰 형식은 표준
 *   JWT 라 aidot-express 로 옮겨가도 클라이언트 코드는 그대로 쓸 수 있다.
 */
import {createHmac, timingSafeEqual, randomBytes, scryptSync, createHash} from 'node:crypto';
import db from '../database/db.js';
import config from '../config.js';

const err = (status, message, code) => Object.assign(new Error(message), {status, code});

/*
 * 토큰 수명은 aidot-express 와 같은 duration 문자열로 다룬다('15m', '14d' 등).
 * 응답의 accessExpiresIn 이 그 문자열 그대로 나가야 업체 코드가 두 런타임에서
 * 같은 값을 받는다. 초 단위로만 주던 예전 환경변수도 계속 받는다.
 */
export function parseDuration(value, fallbackSeconds) {
  if (value === undefined || value === null || value === '') return fallbackSeconds;
  const text = String(value).trim();
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(text);
  if (!m) return fallbackSeconds;
  const n = Number(m[1]);
  switch ((m[2] || 's').toLowerCase()) {
    case 'ms': return Math.max(1, Math.round(n / 1000));
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default: return n;
  }
}

const ACCESS_TTL  = process.env.API_ACCESS_TTL
  || (process.env.API_ACCESS_TTL_SECONDS ? process.env.API_ACCESS_TTL_SECONDS + 's' : '15m');
const REFRESH_TTL = process.env.API_REFRESH_TTL
  || (process.env.API_REFRESH_TTL_SECONDS ? process.env.API_REFRESH_TTL_SECONDS + 's' : '14d');

const ACCESS_TTL_SECONDS  = parseDuration(ACCESS_TTL, 900);
const REFRESH_TTL_SECONDS = parseDuration(REFRESH_TTL, 60 * 60 * 24 * 14);

/** aidot-express 와 같은 쿠키 이름·경로. */
export const REFRESH_COOKIE_NAME = 'rt';
const COOKIE_PATH = '/api/auth';

const localStamp = (date = new Date()) => {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} `
       + `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
};

const sha256 = value => createHash('sha256').update(String(value)).digest('hex');

/* ---------------------------------------------------------------- 스키마 */

let ready = false;
export function ensureSchema() {
  if (ready) return;
  db.exec(`CREATE TABLE IF NOT EXISTS api_user (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'vendor',
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now','localtime'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS api_refresh_token (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now','localtime'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_api_refresh_user ON api_refresh_token (user_id)');
  ready = true;
}
export const resetSchemaCache = () => { ready = false; };

/* ------------------------------------------------------------ 비밀번호 */

export function hashPassword(password) {
  const salt = randomBytes(16);
  return 'scrypt$' + salt.toString('hex') + '$' + scryptSync(String(password), salt, 64).toString('hex');
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* ----------------------------------------------------------------- JWT */

/** 설치마다 고정된 서명 키. 관리자 토큰에서 파생하되 그 값을 그대로 쓰지는 않는다. */
function secret() {
  if (process.env.API_TOKEN_SECRET) return process.env.API_TOKEN_SECRET;
  const base = process.env.ADMIN_TOKEN || config.admin.tokenFile;
  return sha256('aidot-mini/api-token/' + base);
}

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

export function signAccessToken({id, username, role}) {
  const now = Math.floor(Date.now() / 1000);
  const head = encode({alg: 'HS256', typ: 'JWT'});
  const body = encode({
    sub: String(id), username, role,
    realm: 'user',                 // ★ 관리자 realm 과 구분되는 지점
    iat: now, exp: now + ACCESS_TTL_SECONDS,
  });
  const data = `${head}.${body}`;
  return `${data}.${createHmac('sha256', secret()).update(data).digest('base64url')}`;
}

/** 서명·만료를 확인하고 payload 를 돌려준다. 실패하면 null (호출 측에서 401 처리). */
export function verifyAccessToken(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', secret()).update(data).digest();
  let actual;
  try { actual = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
  if (payload?.realm !== 'user') return null;
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/* ------------------------------------------------------------- 사용자 */

export function createUser({username, password, role = 'vendor'}) {
  ensureSchema();
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(String(username || '')))
    throw err(400, '사용자 이름은 영문·숫자·. _ - 3~50자여야 합니다');
  if (String(password || '').length < 12)
    throw err(400, '비밀번호는 12자 이상이어야 합니다');
  if (db.get('SELECT id FROM api_user WHERE username = ?', [username]))
    throw err(409, '이미 있는 사용자 이름입니다');
  const info = db.run('INSERT INTO api_user (username, password_hash, role) VALUES (?, ?, ?)',
    [username, hashPassword(password), role]);
  return {id: Number(info.lastInsertRowid), username, role, status: 'active'};
}

export const findUser = username =>
  (ensureSchema(), db.get('SELECT * FROM api_user WHERE username = ?', [username]) || null);

export const listUsers = () =>
  (ensureSchema(), db.all('SELECT id, username, role, status, created_at FROM api_user ORDER BY id'));

export function setStatus(username, status) {
  ensureSchema();
  const info = db.run('UPDATE api_user SET status = ? WHERE username = ?', [status, username]);
  if (status !== 'active') revokeAllForUsername(username);
  return info.changes > 0;
}

/* --------------------------------------------------------------- 토큰 */

export function issueTokens(user) {
  ensureSchema();
  const refresh = randomBytes(32).toString('base64url');
  db.run('INSERT INTO api_refresh_token (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [user.id, sha256(refresh), localStamp(new Date(Date.now() + REFRESH_TTL_SECONDS * 1000))]);
  return {
    accessToken: signAccessToken(user),
    // aidot-express 와 같은 이름·형식. 초가 아니라 '15m' 같은 duration 문자열이다.
    accessExpiresIn: ACCESS_TTL,
    refreshToken: refresh,                  // 쿠키로 내보낸다. 본문에는 싣지 않는다.
    user: {id: user.id, username: user.username, role: user.role},
  };
}

export function login(username, password) {
  ensureSchema();
  const user = findUser(username);
  // 존재하지 않는 계정과 틀린 비밀번호를 구분해 알려주지 않는다.
  if (!user || !verifyPassword(password, user.password_hash)) throw err(401, '아이디 또는 비밀번호가 올바르지 않습니다');
  if (user.status !== 'active') throw err(403, '사용이 정지된 계정입니다');
  return issueTokens(user);
}

/** 리프레시 토큰을 1회용으로 회전시킨다 — 쓴 토큰은 즉시 폐기된다. */
export function refresh(rawToken) {
  ensureSchema();
  const row = db.get('SELECT * FROM api_refresh_token WHERE token_hash = ?', [sha256(rawToken || '')]);
  if (!row || row.revoked_at) throw err(401, '리프레시 토큰이 유효하지 않습니다');
  if (row.expires_at <= localStamp()) throw err(401, '리프레시 토큰이 만료되었습니다');
  const user = db.get('SELECT * FROM api_user WHERE id = ?', [row.user_id]);
  if (!user || user.status !== 'active') throw err(403, '사용이 정지된 계정입니다');
  db.run('UPDATE api_refresh_token SET revoked_at = ? WHERE id = ?', [localStamp(), row.id]);
  return issueTokens(user);
}

export function revokeRefresh(rawToken) {
  ensureSchema();
  return db.run('UPDATE api_refresh_token SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [localStamp(), sha256(rawToken || '')]).changes > 0;
}

export function revokeAllForUsername(username) {
  ensureSchema();
  const user = findUser(username);
  if (!user) return 0;
  return db.run('UPDATE api_refresh_token SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    [localStamp(), user.id]).changes;
}

/* --------------------------------------------------------------- 라우트 */

/**
 * /api/auth/* — aidot-express 와 같은 경로·응답 모양.
 * 업체 클라이언트가 두 런타임에서 코드 수정 없이 돌아가게 하려는 것이다.
 */
/** 요청 헤더에서 쿠키 한 개를 꺼낸다. */
const cookieValue = (req, name) =>
  String(req.headers.cookie || '').split(';').map(v => v.trim())
    .find(v => v.startsWith(name + '='))?.slice(name.length + 1);

/**
 * 리프레시 토큰은 본문이 아니라 httpOnly 쿠키로 오간다 — aidot-express 와 같다.
 * 이미 붙은 Set-Cookie 가 있으면 지우지 않고 덧붙인다.
 */
function setRefreshCookie(req, res, value, maxAgeSeconds) {
  const secure = req.socket?.encrypted ? '; Secure' : '';
  const cookie = `${REFRESH_COOKIE_NAME}=${value}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict`
    + `${secure}; Max-Age=${maxAgeSeconds}`;
  const existing = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : cookie);
}

const stamp = () =>
  new Date().toLocaleString('sv-SE', {timeZone: 'Asia/Seoul', hour12: false}).replace('T', ' ');

/** aidot-express 의 makeHeader 와 같은 봉투. */
const envelope = (params, data) => ({
  code: 200, message: 'OK',
  header: {requestCode: params?.requestCode ?? null, timestamp: stamp()},
  ...(data ? {data} : {}),
});

/**
 * /api/auth/* — aidot-express 1.45.8 과 같은 요청·응답 규격.
 *
 *   login    본문에 requestCode(3자 이상)·username·password. 응답 data 는
 *            {accessToken, accessExpiresIn, user} 이고 리프레시 토큰은 rt 쿠키로 나간다.
 *   refresh  rt 쿠키를 읽는다. 없으면 401. 쓴 토큰은 회전되어 새 쿠키가 나간다.
 *   logout   rt 쿠키를 폐기하고 지운다.
 *
 * 규격을 express 에 맞춘 이유는 업체 코드가 개발(mini)과 운영(express)에서
 * 한 글자도 다르지 않게 돌아가야 하기 때문이다.
 */
export function registerApiAuth(router) {
  const body = req => (req.body && typeof req.body === 'object') ? req.body : {};

  router.add('POST', '/api/auth/login', (req, res) => {
    const b = body(req);
    // express 의 loginSchema 와 같은 필수 조건. 자격 검사보다 먼저 본다.
    if (typeof b.requestCode !== 'string' || b.requestCode.trim().length < 3)
      throw err(400, 'requestCode is required (3 characters or more)');
    const issued = login(b.username, b.password);
    setRefreshCookie(req, res, issued.refreshToken, REFRESH_TTL_SECONDS);
    res.json(envelope(b, {
      accessToken: issued.accessToken, accessExpiresIn: issued.accessExpiresIn, user: issued.user,
    }));
  }, {auth: false, realm: 'user'});

  router.add('POST', '/api/auth/refresh', (req, res) => {
    const raw = cookieValue(req, REFRESH_COOKIE_NAME);
    if (!raw) throw err(401, 'Missing refresh token');
    const issued = refresh(raw);
    setRefreshCookie(req, res, issued.refreshToken, REFRESH_TTL_SECONDS);
    res.json(envelope(body(req), {
      accessToken: issued.accessToken, accessExpiresIn: issued.accessExpiresIn, user: issued.user,
    }));
  }, {auth: false, realm: 'user'});

  router.add('POST', '/api/auth/logout', (req, res) => {
    const raw = cookieValue(req, REFRESH_COOKIE_NAME);
    if (raw) revokeRefresh(raw);
    setRefreshCookie(req, res, '', 0);
    res.json(envelope(body(req)));
  }, {auth: false, realm: 'user'});
}

export default {
  ensureSchema, resetSchemaCache, createUser, findUser, listUsers, setStatus,
  login, refresh, issueTokens, revokeRefresh, revokeAllForUsername,
  signAccessToken, verifyAccessToken, hashPassword, verifyPassword, registerApiAuth,
};
