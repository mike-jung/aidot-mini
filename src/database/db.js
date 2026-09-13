import fs from 'node:fs';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {DatabaseSync} from 'node:sqlite';
import config from '../config.js';
import {toSqlite,normalizeParams,maskSql} from './dialect.js';
import {addStep} from '../core/requestContext.js';
import sqlRegistry,{fillPlaceholders} from '../core/sqlLoader.js';
import {registerSqliteFunctions,rewriteForSqlite,normalizeSqliteParams} from './sqlite-dialect.js';
import {mapAppSchema} from './app-schema.js';
let connection=null,dbFile=null,depth=0;
const scope=new AsyncLocalStorage(),asyncScope=new AsyncLocalStorage();
let activeTransaction=null,queue=Promise.resolve();
const safeInteger=v=>typeof v==='bigint'?(v<=BigInt(Number.MAX_SAFE_INTEGER)&&v>=BigInt(Number.MIN_SAFE_INTEGER)?Number(v):v.toString()):v;
const plain=r=>r==null?r:Object.fromEntries(Object.entries(r).map(([k,v])=>[k,safeInteger(v)]));
function guard(){if(asyncScope.getStore()?.closed)throw new Error('Database access after transaction completion is forbidden');if(activeTransaction&&asyncScope.getStore()!==activeTransaction)throw Object.assign(new Error('Database transaction is active; use await db.execute()'),{status:503});if(!connection)throw new Error('Database is not open');if(scope.getStore()?.closed)throw new Error('Database access after transaction completion is forbidden');}
export function open(file){
  if(connection)throw new Error('Database already open; close it before opening another');
  dbFile=file===':memory:'?file:path.resolve(file);
  if(file!==':memory:')fs.mkdirSync(path.dirname(dbFile),{recursive:true,mode:0o700});
  try{
    connection=new DatabaseSync(dbFile,{enableForeignKeyConstraints:true,enableDoubleQuotedStringLiterals:false});
    connection.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=${config.db.synchronous}; PRAGMA busy_timeout=${config.db.busyTimeout}; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;`);
    registerSqliteFunctions({function(name,opts,fn){connection.function(name,{deterministic:opts.deterministic,varArgs:opts.varargs||false},fn);}});
    if(file!==':memory:')fs.chmodSync(dbFile,0o600);
    return connection;
  }catch(e){connection?.close();connection=null;throw e;}
}
export const isOpen=()=>connection!==null;
export const file=()=>dbFile;
function prep(sql){
  guard();
  const code=maskSql(String(sql)).text.trim().replace(/;\s*$/,'');
  if(code.includes(';'))throw new Error('Only one statement is allowed in all/get/run');
  const st=connection.prepare(toSqlite(mapAppSchema(sql,config.db.appSchema)));st.setReadBigInts(true);return st;
}
const args=params=>{const p=normalizeParams(params);return p===undefined?[]:Array.isArray(p)?p:[p];};
function perform(kind,sql,params){
  const t=performance.now();let stmt;
  try{
    stmt=prep(sql);const result=stmt[kind](...args(params));
    addStep('sql',sqlRegistry.nameOf(sql)||'unnamed',{ms:Math.round((performance.now()-t)*100)/100,ok:true});
    if(kind==='all')return result.map(plain);
    if(kind==='get')return plain(result);
    return {changes:safeInteger(result.changes),lastInsertRowid:safeInteger(result.lastInsertRowid)};
  }catch(e){addStep('sql',sqlRegistry.nameOf(sql)||'unnamed',{ms:Math.round(performance.now()-t),ok:false});throw e;}
  finally{stmt?.close?.();}
}
export const all=(sql,params)=>perform('all',sql,params);
export const get=(sql,params)=>perform('get',sql,params);
export const run=(sql,params)=>perform('run',sql,params);
export function exec(sql){guard();connection.exec(toSqlite(mapAppSchema(sql,config.db.appSchema)));}
export function transactionSync(fn){
  if(typeof fn!=='function'||fn.constructor.name==='AsyncFunction')throw new TypeError('SQLite transactions require a synchronous callback; do not await inside a transaction');
  return (...values)=>{
    guard();const outer=depth===0,sp=`am_sp_${depth}`,ctx={closed:false};
    connection.exec(outer?'BEGIN IMMEDIATE':`SAVEPOINT ${sp}`);depth++;
    try{
      const result=scope.run(ctx,()=>fn(...values));
      if(result&&typeof result.then==='function'){
        Promise.resolve(result).catch(()=>{});
        throw new TypeError('A transaction callback returned a Promise; use synchronous database operations');
      }
      connection.exec(outer?'COMMIT':`RELEASE SAVEPOINT ${sp}`);return result;
    }catch(e){
      try{connection.exec(outer?'ROLLBACK':`ROLLBACK TO SAVEPOINT ${sp}; RELEASE SAVEPOINT ${sp}`);}catch{}
      throw e;
    }finally{ctx.closed=true;depth--;}
  };
}
export function close(){if(!connection)return;try{connection.exec('PRAGMA wal_checkpoint(TRUNCATE)');}finally{connection.close();connection=null;depth=0;}}

function enqueue(fn){const p=queue.then(fn,fn);queue=p.catch(()=>{});return p;}
function executeDirect(sql,params={}){
  guard();const t=performance.now();let stmt;
  try{
    const normalized=normalizeSqliteParams(params);
    const bind=Array.isArray(normalized)?normalized:fillPlaceholders(sql,normalized);
    const code=rewriteForSqlite(mapAppSchema(String(sql),config.db.appSchema));
    const masked=maskSql(code).text.trim().replace(/;\s*$/,'');
    if(masked.includes(';'))throw new Error('Only one statement is allowed in db.execute');
    stmt=connection.prepare(code);stmt.setReadBigInts(true);
    const a=Array.isArray(bind)?bind:Object.keys(bind).length?[bind]:[];
    let reader;
    if(typeof stmt.columns==='function')reader=stmt.columns().length>0;
    else if(/^\s*EXPLAIN\b/i.test(masked))reader=true;
    else{
      // Node 22.13 lacks columns(). EXPLAIN classifies the statement without executing it.
      const plan=connection.prepare('EXPLAIN '+code);
      try{reader=plan.all(...a).some(row=>row.opcode==='ResultRow');}finally{plan.close?.();}
    }
    if(reader)return {rows:stmt.all(...a).map(plain),rowsAffected:0};
    const info=stmt.run(...a),changes=safeInteger(info.changes),insertId=safeInteger(info.lastInsertRowid);
    return {rows:[],rowsAffected:changes,insertId,meta:{changes,lastInsertRowid:insertId}};
  }finally{stmt?.close?.();addStep('sql',sqlRegistry.nameOf(sql)||'unnamed',{ms:Math.round(performance.now()-t)});}
}
export async function execute(sql,params={}){
  if(asyncScope.getStore()){guard();return executeDirect(sql,params);}
  return enqueue(()=>executeDirect(sql,params));
}
export const query=execute;
export async function transaction(fn){
  if(typeof fn!=='function')throw new TypeError('transaction requires a callback');
  if(asyncScope.getStore())throw new Error('Nested async transactions are not supported');
  return enqueue(async()=>{
    guard();const ctx={closed:false};connection.exec('BEGIN IMMEDIATE');activeTransaction=ctx;
    const tx={execute:(sql,params)=>asyncScope.run(ctx,()=>execute(sql,params))};tx.query=tx.execute;
    try{
      const result=await asyncScope.run(ctx,()=>fn(tx));
      connection.exec('COMMIT');return result;
    }catch(error){try{connection?.exec('ROLLBACK');}catch{}throw error;}
    finally{ctx.closed=true;activeTransaction=null;}
  });
}
export async function executeList(sql,params={},options={}){
  const positive=(value,fallback)=>{const n=Number(value);return Number.isInteger(n)&&n>0?n:fallback;};
  const page=positive(options.page,1),perPage=Math.min(positive(options.perPage,20),positive(options.maxPerPage,500));
  if('__limit' in params||'__offset' in params)throw new Error('executeList reserves __limit and __offset');
  const base=sql.trim().replace(/;+\s*$/,'');
  const job=()=>{
    const total=Number(executeDirect('SELECT COUNT(*) AS total FROM ('+base+') _cnt_',params).rows[0].total);
    const rows=executeDirect(base+' LIMIT :__limit OFFSET :__offset',{...params,__limit:perPage,__offset:(page-1)*perPage}).rows;
    return {rows,header:{total,page,perPage,totalPages:Math.max(1,Math.ceil(total/perPage))}};
  };
  return asyncScope.getStore()?job():enqueue(job);
}
export const initDb=()=>open(config.db.file);
export const currentAdapter=()=>'sqlite';
export const closeDb=async()=>{await queue;close();};
export default {open,close,all,get,run,exec,transactionSync,isOpen,file,initDb,execute,query,executeList,transaction,closeDb,currentAdapter};
