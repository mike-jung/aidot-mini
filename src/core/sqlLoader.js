/**
 * sqlLoader.js — `-- @name:` 마커로 이름 붙인 SQL 을 읽어 레지스트리에 담는다.
 *   aidot-express 와 **같은 규약**이라 SQL 파일을 그대로 옮겨 쓸 수 있다.
 *
 *   src/sql/note.sql
 *     -- @name: findAll
 *     SELECT * FROM {{sample}}note ORDER BY id DESC;
 *
 *   서비스에서:  this.sql.get('findAll')          (같은 파일 안)
 *               registry.get('note:findAll')     (파일 지정)
 *
 *  `{{sample}}` 토큰은 샘플 테이블 접두사로 치환된다 — 남의 DB 에 붙였을 때
 *  `note` 같은 흔한 이름이 부딪히는 사고를 막는다 (aidot-express v1.7.3 에서 실제로 겪었다).
 */
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import {workspaceFiles} from './workspaceFiles.js';
import {maskSql} from '../database/dialect.js';

const NAME_RE = /^\s*--\s*@name\s*:\s*([A-Za-z_]\w*)\s*$/;
const SAFE_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function samplePrefix() {
  const raw = config.db.samplePrefix;
  if (raw == null) return 'sample_';
  const v = String(raw).trim();
  if (v === '') return '';
  if (!SAFE_PREFIX.test(v)) throw new Error(`DB_SAMPLE_PREFIX='${v}' 는 쓸 수 없습니다 (영문/숫자/밑줄).`);
  return v;
}

/** Expand table-prefix placeholders only in SQL code, never data literals or comments. */
export function renderTokens(text) {
  if (text == null || !String(text).includes('{{')) return text;
  return String(text).replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|--[^\r\n]*|\/\*[\s\S]*?\*\/|\{\{\s*sample\s*\}\}/g,
    token => token.startsWith('{{') ? samplePrefix() : token);
}

/** 한 파일의 본문을 { 이름: SQL } 로 자른다 */
export function parseSqlFile(content) {
  const out = Object.create(null);
  let name = null, buf = [];
  const flush = () => {
    if (!name) return;
    const body = buf.join('\n').trim().replace(/;\s*$/, '');
    if (!body) throw new Error(`Empty SQL statement: ${name}`);
    if (Object.hasOwn(out, name)) throw new Error(`Duplicate SQL name: ${name}`);
    out[name] = body;
    buf = [];
  };
  for (const line of String(content).split(/\r?\n/)) {
    const m = NAME_RE.exec(line);
    if (m) { flush(); name = m[1]; continue; }
    if (name) buf.push(line);
  }
  flush();
  return out;
}

export class SqlFile {
  constructor(file, statements) { this.file = file; this.fileName=file; this.statements = statements; }
  has(n) { return Object.hasOwn(this.statements, n); }
  get(n) {
    if(!this.has(n)){const alias=n==='update'?'updateName':n==='updateName'?'update':null;if(alias&&this.has(alias))n=alias;}
    const s = this.statements[n];
    if (!Object.hasOwn(this.statements, n)) {
      throw new Error(`SQL 문을 찾을 수 없습니다: ${this.file}:${n}\n`
        + `  이 파일에 있는 것: ${Object.keys(this.statements).join(', ') || '(없음)'}`);
    }
    return s;
  }
  list() { return Object.keys(this.statements); }
  bind(name,params={},style='oracle'){return bindParams(this.get(name),params,style);}
}

export class SqlRegistry {
  constructor() { this.files = new Map(); this._reverse = null; }

  loadDir(dir) {
    this.files.clear(); this._reverse = null;
    if (!fs.existsSync(dir)) return this;
    for (const f of workspaceFiles(dir,/\.sql$/i)) {
      const key = path.relative(dir,f).replace(/\\/g,'/').replace(/\.sql$/i,'');
      const stmts = parseSqlFile(renderTokens(fs.readFileSync(f, 'utf8')));
      this.files.set(key, new SqlFile(key, stmts));
    }
    this._reverse = null;
    return this;
  }

  getFile(name){return this.file(name);}
  bind(key,params={},style='oracle'){return bindParams(this.get(key),params,style);}
  listFiles(){return [...this.files].map(([name,f])=>({name,queries:f.list()}));}
  registerFile(name,content){const statements=parseSqlFile(renderTokens(content));this.files.set(name,new SqlFile(name,statements));this._reverse=null;return {fileName:name,count:Object.keys(statements).length};}
  unregisterFile(name){this._reverse=null;return this.files.delete(name);}
  file(name) {
    const f = this.files.get(name);
    if (!f) throw new Error(`SQL 파일을 찾을 수 없습니다: ${name} (있는 것: ${[...this.files.keys()].join(', ')})`);
    return f;
  }

  /** 'note:findAll' */
  get(key) {
    const [f, n] = String(key).split(':');
    return this.file(f).get(n);
  }

  list() {
    const out = [];
    for (const [f, sf] of this.files) for (const n of sf.list()) out.push(`${f}:${n}`);
    return out;
  }

  /**
   * SQL 본문 → 'file:name' 역인덱스.
   *  요청 추적에서 익명 SQL 문자열 대신 이름을 남기기 위한 것이다.
   *  본문에 주석을 심는 방법도 있지만, 어댑터가 첫 단어로 문장 종류를 판정하므로
   *  앞에 주석이 붙으면 실행 경로가 틀어진다 — 그래서 SQL 은 손대지 않는다.
   */
  nameOf(text) {
    if (typeof text !== 'string') return null;
    if (!this._reverse) {
      this._reverse = new Map();
      for (const [f, sf] of this.files) {
        for (const [n, t] of Object.entries(sf.statements)) {
          if (!this._reverse.has(t)) this._reverse.set(t, `${f}:${n}`);
        }
      }
    }
    return this._reverse.get(text) ?? null;
  }
}

export const sqlRegistry = new SqlRegistry();
export default sqlRegistry;
export function bindParams(sql,params={},style='oracle'){
  const masked=maskSql(String(sql)),values=[],names=[];
  const text=masked.text.replace(/(?<!:):([A-Za-z_]\w*)/g,(match,name)=>{
    if(!Object.hasOwn(params,name))throw new Error('Missing SQL parameter: :'+name);
    names.push(name);values.push(params[name]);
    return style==='qmark'?'?':['pg','postgres'].includes(style)?'$'+values.length:match;
  });
  return {text:masked.restore(text),values,names};
}
export function fillPlaceholders(sql,params={}){
  const out=Object.create(null);
  for(const match of maskSql(String(sql)).text.matchAll(/(?<!:):([A-Za-z_]\w*)/g))out[match[1]]=params?.[match[1]]??null;
  return out;
}
