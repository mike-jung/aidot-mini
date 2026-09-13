/**
 * src/database/sqlite-dialect.js
 *
 * MariaDB 문법으로 작성된 런타임 SQL(src/database/sql, lib/admin/database/sql)을 SQLite 에서도 그대로
 * 실행할 수 있게 해 주는 호환 계층. SQL 파일을 DB 별로 포크하지 않기 위한 단일 지점.
 *
 *  (1) 사용자 정의 함수(UDF) 등록 — SQLite 에 없는 MariaDB 함수
 *      NOW(), CURRENT_TIMESTAMP() , DATE_FORMAT(ts, fmt), TIMESTAMPDIFF(unit, a, b), UNIX_TIMESTAMP([ts]),
 *      IFNULL/COALESCE 는 SQLite 에 이미 있음.
 *  (2) 문법 재작성 — SQLite 파서가 아예 받아들이지 못하는 구문
 *      DATE_ADD(x, INTERVAL n UNIT) / DATE_SUB(...)   → datetime(x, '+n unit')
 *      INSERT ... ON DUPLICATE KEY UPDATE a = VALUES(a) → INSERT ... ON CONFLICT DO UPDATE SET a = excluded.a
 *      `backtick` 식별자                               → "double-quote" 식별자 (SQLite 도 backtick 을 허용하지만 통일)
 *
 *  지원 범위는 이 프로젝트의 SQL 파일에서 실제로 쓰이는 구문으로 한정한다. 새 구문이 필요하면 여기에 추가.
 */

const UNIT_TO_SQLITE = {
  SECOND: 'seconds', MINUTE: 'minutes', HOUR: 'hours', DAY: 'days', WEEK: 'days', MONTH: 'months', YEAR: 'years',
};

/** 'YYYY-MM-DD HH:MM:SS' 로컬 시간 (MariaDB NOW() 와 동일 포맷) */
function nowLocal() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** SQLite 가 저장한 다양한 날짜 표현을 Date 로. 실패 시 null */
function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v);
  const s = String(v).trim();
  if (!s) return null;
  // 'YYYY-MM-DD HH:MM:SS(.fff)' 는 로컬 시각으로 해석 (MariaDB DATETIME 과 동일 의미)
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(s);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +(m[7] || 0));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** MariaDB DATE_FORMAT 의 주요 지정자 구현 */
function dateFormat(v, fmt) {
  const d = toDate(v);
  if (!d || fmt == null) return null;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return String(fmt).replace(/%([a-zA-Z%])/g, (_, c) => {
    switch (c) {
      case 'Y': return String(d.getFullYear());
      case 'y': return p(d.getFullYear() % 100);
      case 'm': return p(d.getMonth() + 1);
      case 'c': return String(d.getMonth() + 1);
      case 'd': return p(d.getDate());
      case 'e': return String(d.getDate());
      case 'H': return p(h24);
      case 'k': return String(h24);
      case 'h': case 'I': return p(h12);
      case 'l': return String(h12);
      case 'i': return p(d.getMinutes());
      case 's': case 'S': return p(d.getSeconds());
      case 'f': return p(d.getMilliseconds(), 3) + '000';   // 마이크로초 6자리
      case 'p': return h24 < 12 ? 'AM' : 'PM';
      case 'j': { const start = new Date(d.getFullYear(), 0, 0); return p(Math.floor((d - start) / 86400000), 3); }
      case 'w': return String(d.getDay());
      case 'T': return `${p(h24)}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      case '%': return '%';
      default: return '%' + c;
    }
  });
}

function timestampDiff(unit, a, b) {
  const da = toDate(a); const dbb = toDate(b);
  if (!da || !dbb) return null;
  const ms = dbb - da;
  switch (String(unit).toUpperCase()) {
    case 'MICROSECOND': return Math.trunc(ms * 1000);
    case 'SECOND': return Math.trunc(ms / 1000);
    case 'MINUTE': return Math.trunc(ms / 60000);
    case 'HOUR': return Math.trunc(ms / 3600000);
    case 'DAY': return Math.trunc(ms / 86400000);
    case 'WEEK': return Math.trunc(ms / (7 * 86400000));
    case 'MONTH': return (dbb.getFullYear() - da.getFullYear()) * 12 + (dbb.getMonth() - da.getMonth());
    case 'YEAR': return dbb.getFullYear() - da.getFullYear();
    default: return null;
  }
}

/** better-sqlite3 Database 인스턴스에 UDF 등록 */
export function registerSqliteFunctions(db) {
  const opt = { deterministic: false };
  db.function('NOW', opt, () => nowLocal());
  db.function('SYSDATE', opt, () => nowLocal());
  db.function('CURDATE', opt, () => nowLocal().slice(0, 10));
  db.function('DATE_FORMAT', { deterministic: true }, (v, fmt) => dateFormat(v, fmt));
  db.function('TIMESTAMPDIFF', { deterministic: true }, (unit, a, b) => timestampDiff(unit, a, b));
  db.function('UNIX_TIMESTAMP', { deterministic: false, varargs: true }, (...args) => {
    const d = args.length ? toDate(args[0]) : new Date();
    return d ? Math.floor(d.getTime() / 1000) : null;
  });
  // TIMESTAMPDIFF 에서 쓰이는 단위 토큰(SECOND 등)은 식별자로 파싱되므로, 동명 컬럼이 없으면 SQLite 가 오류를 낸다.
  // → rewriteForSqlite 가 단위를 문자열 리터럴로 감싼다 ('SECOND').
}

const INTERVAL_RE = /\bDATE_(ADD|SUB)\s*\(\s*((?:[^()]|\([^()]*\))+?)\s*,\s*INTERVAL\s+(:?[A-Za-z0-9_]+)\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)\s*\)/gi;
const TSDIFF_RE = /\bTIMESTAMPDIFF\s*\(\s*(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR|MICROSECOND)\s*,/gi;
const ON_DUP_RE = /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i;
const VALUES_FN_RE = /\bVALUES\s*\(\s*`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\)/g;

/** MariaDB 전용 구문 → SQLite 구문. 해당 구문이 없으면 원문을 그대로 돌려준다(비용 최소). */
/**
 * `DELETE FROM t [WHERE ...] ORDER BY ... LIMIT n`
 *   MariaDB/MySQL 전용 구문이다. SQLite 는 SQLITE_ENABLE_UPDATE_DELETE_LIMIT 로 빌드했을 때만
 *   지원하는데 better-sqlite3 / node:sqlite 의 기본 빌드에는 꺼져 있어 `near "ORDER": syntax error` 가 난다.
 *   → rowid 부분질의로 바꾼다. (이 프로젝트의 SQLite 테이블은 id INTEGER PRIMARY KEY = rowid 별칭)
 */
const DELETE_ORDER_LIMIT_RE =
  /^\s*DELETE\s+FROM\s+([`"]?\w+[`"]?)\s*((?:WHERE\s+[\s\S]*?)?)ORDER\s+BY\s+([\s\S]+?)\s+LIMIT\s+([\s\S]+?)\s*$/i;

export function rewriteForSqlite(sql) {
  if (typeof sql !== 'string') return sql;
  let out = sql;

  // Trace batches use INSERT IGNORE; keep their shared SQL unchanged.
  out = out.replace(/^(\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*)INSERT\s+IGNORE\s+INTO\b/i, '$1INSERT OR IGNORE INTO');

  if (/\bDATE_(ADD|SUB)\s*\(/i.test(out)) {
    out = out.replace(INTERVAL_RE, (_m, op, expr, amt, unit) => {
      const sign = op.toUpperCase() === 'ADD' ? '+' : '-';
      const u = unit.toUpperCase();
      const sqUnit = UNIT_TO_SQLITE[u];
      const mult = u === 'WEEK' ? 7 : 1;
      if (amt.startsWith(':')) {
        const amtExpr = mult === 1 ? amt : `(${amt} * ${mult})`;
        return `datetime(${expr}, ('${sign}' || CAST(${amtExpr} AS TEXT) || ' ${sqUnit}'))`;
      }
      return `datetime(${expr}, '${sign}${Number(amt) * mult} ${sqUnit}')`;
    });
  }
  if (/\bTIMESTAMPDIFF\s*\(/i.test(out)) {
    out = out.replace(TSDIFF_RE, (_m, unit) => `TIMESTAMPDIFF('${unit.toUpperCase()}',`);
  }
  if (ON_DUP_RE.test(out)) {
    out = out.replace(ON_DUP_RE, 'ON CONFLICT DO UPDATE SET');
    out = out.replace(VALUES_FN_RE, (_m, col) => `excluded.${col}`);
  }
  if (/^\s*DELETE\s/i.test(out) && /\bORDER\s+BY\b/i.test(out) && /\bLIMIT\b/i.test(out)) {
    const m = out.match(DELETE_ORDER_LIMIT_RE);
    if (m) {
      const [, table, where, order, limit] = m;
      const w = where.trim() ? ` ${where.trim()}` : '';
      out = `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table}${w} ORDER BY ${order} LIMIT ${limit})`;
    }
  }
  if (out.includes('`')) out = out.replace(/`([^`]+)`/g, '"$1"');
  // CURRENT_TIMESTAMP 는 SQLite 내장 (UTC 기준) — MariaDB 와 시간대 의미가 다르므로 DML 에서는 로컬 NOW() 로 통일.
  //   DDL(CREATE/ALTER) 의 DEFAULT CURRENT_TIMESTAMP 는 상수여야 하므로 건드리지 않는다.
  if (!/^\s*(CREATE|ALTER)\b/i.test(out)) out = out.replace(/\bCURRENT_TIMESTAMP\b(?!\s*\()/gi, 'NOW()');
  return out;
}

/**
 * better-sqlite3 는 number/string/bigint/Buffer/null 만 바인딩할 수 있다.
 * 서비스 코드가 넘기는 Date / boolean / undefined / 객체를 SQLite 친화 값으로 변환.
 */
export function normalizeSqliteParams(params) {
  if (!params || typeof params !== 'object') return params;
  let changed = false;
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    let nv = v;
    if (v instanceof Date) nv = dateFormat(v, '%Y-%m-%d %H:%i:%s');
    else if (typeof v === 'boolean') nv = v ? 1 : 0;
    else if (v === undefined) nv = null;
    else if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v)) nv = JSON.stringify(v);
    if (nv !== v) changed = true;
    out[k] = nv;
  }
  return changed ? out : params;
}
