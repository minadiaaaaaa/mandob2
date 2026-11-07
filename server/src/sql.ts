import mysql from 'mysql2';

// Query templates use `?` placeholders. Every value is escaped by the MySQL driver:
// - after SET (or a comma inside SET), a plain object becomes `col` = value pairs;
// - anywhere else a plain object is stored as JSON text;
// - an array becomes a list (1, 2, 3); an array of arrays becomes VALUES rows; an empty array becomes NULL.
export const identifier = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error('Invalid SQL identifier');
  return '`' + name + '`';
};
export function splitSql(input: string, separator = ','): string[] {
  const result: string[] = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote && input[i + 1] === quote) { i++; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === separator && depth === 0) { result.push(input.slice(start, i).trim()); start = i + 1; }
  }
  result.push(input.slice(start).trim());
  return result;
}
const plainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !Buffer.isBuffer(v);
const escape = (v: unknown): string => {
  if (v === undefined || v === null) return 'NULL';
  // inside a VALUES row, objects and arrays (JSON columns) are stored as JSON text
  if (plainObject(v) || Array.isArray(v)) return mysql.escape(JSON.stringify(v));
  if (typeof v === 'boolean') return v ? '1' : '0';
  return mysql.escape(v as any, true, 'Z');
};
export function formatQuery(template: string, parameters: unknown[] = []): string {
  let index = 0, quote = '', text = '';
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (quote) {
      text += c;
      if (c === '\\' && quote !== '`') { text += template[++i] ?? ''; continue; }
      if (c === quote && template[i + 1] === quote) { text += template[++i]; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; text += c; continue; }
    if (c !== '?') { text += c; continue; }
    if (index >= parameters.length) throw new Error('Missing SQL parameter');
    const value = parameters[index++];
    const assignments = (/\bSET\b/i.test(text) && /(?:\bSET|,)\s*$/i.test(text)) || /\bDUPLICATE\s+KEY\s+UPDATE\s*$/i.test(text);
    if (assignments && plainObject(value)) {
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      if (!entries.length) throw new Error('Empty SQL assignment');
      text += entries.map(([key, v]) => `${identifier(key)} = ${escape(v)}`).join(', ');
    } else if (Array.isArray(value)) {
      text += value.length ? value.map(item => Array.isArray(item) ? `(${item.map(escape).join(', ')})` : escape(item)).join(', ') : 'NULL';
    } else text += escape(value);
  }
  if (index !== parameters.length) throw new Error(`SQL parameter mismatch: expected ${index}, received ${parameters.length}`);
  return text;
}
