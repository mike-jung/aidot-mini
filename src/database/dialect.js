// A deliberately limited compatibility shim, not a general MariaDB transpiler.
// Literal/identifier masking prevents rewrites from changing stored text.
export function maskSql(sql){
  let prefix='__am_mask_';while(sql.includes(prefix))prefix+='x';
  const values=[];
  const masked=String(sql).replace(/'(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"|`(?:``|[^`])*`|--[^\r\n]*|\/\*[\s\S]*?\*\//g,value=>{
    if(value.startsWith('--')||value.startsWith('/*'))return value.replace(/[^\r\n]/g,' ');
    const key=prefix+values.length+'__';values.push(value);return key;
  });
  return {text:masked,restore:text=>text.replace(new RegExp(prefix+'(\\d+)__','g'),(_,i)=>values[Number(i)])};
}
export function toSqlite(sql){
  const masked=maskSql(String(sql));let out=masked.text;
  if(/\b(ENUM\s*\(|ON\s+UPDATE\s+CURRENT_TIMESTAMP|ON\s+DUPLICATE\s+KEY|UNSIGNED\b|CHARACTER\s+SET|COLLATE\b)/i.test(out))throw new Error('Unsupported MariaDB semantics; add an explicit SQLite dialect file');
  const auto=/(\w+)\s+(?:BIG|SMALL|MEDIUM|TINY)?INT(?:EGER)?(?:\(\d+\))?(?:\s+NOT\s+NULL)?\s+AUTO_INCREMENT/ig;
  const cols=[];out=out.replace(auto,(_,col)=>{cols.push(col);return `${col} INTEGER PRIMARY KEY AUTOINCREMENT`;});
  for(const col of cols)out=out.replace(new RegExp(',\\s*PRIMARY\\s+KEY\\s*\\(\\s*'+col+'\\s*\\)','i'),'');
  if(/\bAUTO_INCREMENT\b/i.test(out))throw new Error('Unsupported AUTO_INCREMENT declaration');
  if(/^\s*DELETE\s/i.test(out)&&/\bORDER\s+BY\b/i.test(out)&&/\bLIMIT\b/i.test(out)){
    const m=/^\s*DELETE\s+FROM\s+(\w+)\s*((?:WHERE\s+[\s\S]*?)?)ORDER\s+BY\s+([\s\S]+?)\s+LIMIT\s+([^;]+?)\s*;?\s*$/i.exec(out);
    if(!m||/\bSELECT\b/i.test(out))throw new Error('Complex DELETE LIMIT requires an explicit SQLite query');
    const[,table,where,order,limit]=m;
    out=`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table}${where.trim()?' '+where.trim():''} ORDER BY ${order} LIMIT ${limit})`;
  }
  out=out.replace(/\bENGINE\s*=\s*\w+/gi,'').replace(/\bDEFAULT\s+CHARSET\s*=\s*\w+/gi,'')
    .replace(/\bTINYINT\(\d+\)/gi,'INTEGER').replace(/\b(?:TINY|SMALL|MEDIUM|BIG)INT\b/gi,'INTEGER')
    .replace(/\bDOUBLE\b/gi,'REAL').replace(/\bVARCHAR\(\d+\)/gi,'TEXT').replace(/\bDATETIME\b/gi,'TEXT')
    .replace(/\bNOW\(\)/gi,"datetime('now')").replace(/\bCURDATE\(\)/gi,"date('now')");
  return masked.restore(out);
}
export function normalizeParams(params){
  if(params==null)return undefined;
  const one=v=>{
    if(v===undefined)return null;
    if(v instanceof Date){if(!Number.isFinite(v.getTime()))throw new TypeError('Invalid date parameter');return v.toISOString().slice(0,19).replace('T',' ');}
    if(typeof v==='boolean')return v?1:0;
    if(v===null||typeof v==='string'||typeof v==='bigint'||v instanceof Uint8Array)return v;
    if(typeof v==='number'&&Number.isFinite(v))return v;
    throw new TypeError('SQL parameters must be finite numbers, strings, booleans, bigint, dates, bytes or null');
  };
  if(Array.isArray(params))return params.map(one);
  if(typeof params!=='object')throw new TypeError('Use an array or named parameter object');
  return Object.fromEntries(Object.entries(params).map(([k,v])=>[k,one(v)]));
}
export default {toSqlite,normalizeParams};
