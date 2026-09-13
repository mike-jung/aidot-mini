// Map one configured application schema to SQLite's main database.
// Source files, literals, comments and table aliases are left unchanged.
const TOKEN = /--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|\\.|[^'\\])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:\]\]|[^\]])*\]|[A-Za-z_][\w$]*|[^\s]/g;
const RELATION = new Set(['FROM', 'JOIN', 'UPDATE', 'INTO', 'REFERENCES', 'TABLE']);
const END_FROM = new Set(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'RETURNING', 'SET', 'VALUES', 'UNION', 'EXCEPT', 'INTERSECT']);
const identifier = text => /^[A-Za-z_][\w$]*$/.test(text) ? text
  : /^"(?:""|[^"])*"$/.test(text) ? text.slice(1,-1).replaceAll('""','"')
  : /^`(?:``|[^`])*`$/.test(text) ? text.slice(1,-1).replaceAll('``','`')
  : /^\[(?:\]\]|[^\]])*\]$/.test(text) ? text.slice(1,-1).replaceAll(']]',']') : null;

export function mapAppSchema(sql, schema) {
  if (!schema || schema.toLowerCase() === 'main' || !String(sql).toLowerCase().includes(schema.toLowerCase())) return sql;
  const tokens = [...String(sql).matchAll(TOKEN)]
    .filter(t => !t[0].startsWith('--') && !t[0].startsWith('/*'));
  const from = [false], edits = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const text = tokens[i][0], word = text.toUpperCase();
    if (text === '(') { from[++depth] = false; continue; }
    if (text === ')') { depth = Math.max(0, depth-1); continue; }
    if (word === 'FROM') from[depth] = true;
    if (END_FROM.has(word) || text === ';') from[depth] = false;
    if (identifier(text)?.toLowerCase() !== schema.toLowerCase() || tokens[i+1]?.[0] !== '.' || !identifier(tokens[i+2]?.[0] || '')) continue;
    const previous = tokens[i-1]?.[0].toUpperCase();
    const tableIfExists = previous === 'EXISTS' && (
      tokens[i-2]?.[0].toUpperCase() === 'IF' && tokens[i-3]?.[0].toUpperCase() === 'TABLE' ||
      tokens[i-2]?.[0].toUpperCase() === 'NOT' && tokens[i-3]?.[0].toUpperCase() === 'IF' && tokens[i-4]?.[0].toUpperCase() === 'TABLE');
    const threePartColumn = tokens[i+3]?.[0] === '.' && (identifier(tokens[i+4]?.[0] || '') || tokens[i+4]?.[0] === '*');
    if (RELATION.has(previous) || tableIfExists || previous === ',' && from[depth] || threePartColumn) {
      edits.push([tokens[i].index, tokens[i].index + text.length]);
    }
  }
  let out = String(sql);
  for (const [start,end] of edits.reverse()) out = out.slice(0,start) + 'main' + out.slice(end);
  return out;
}
