// Parameterized PostgreSQL templates: objects expand assignments, arrays expand lists/rows.
// All values are sent separately through node-postgres.
export const identifier = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error('Invalid SQL identifier');
  return `"${name}"`;
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
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === separator && depth === 0) { result.push(input.slice(start, i).trim()); start = i + 1; }
  }
  result.push(input.slice(start).trim());
  return result;
}
export function compileQuery(template: string, parameters: unknown[] = []) {
  template = postgresSql(template);
  const values: unknown[] = [];
  let index = 0, quote = '', text = '';
  const scalar = (value: unknown): string => {
    values.push(value === undefined ? null : typeof value === 'object' && value !== null && !(value instanceof Date) && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
    return `$${values.length}`;
  };
  const bind = (value: unknown): string => {
    if (Array.isArray(value)) {
      if (!value.length) return 'NULL';
      return value.map(item => Array.isArray(item) ? `(${item.map(scalar).join(', ')})` : scalar(item)).join(', ');
    }
    return scalar(value);
  };
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (quote) {
      text += c;
      if (c === quote && template[i + 1] === quote) { text += template[++i]; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"') { quote = c; text += c; continue; }
    if (c !== '?') { text += c; continue; }
    if (index >= parameters.length) throw new Error('Missing SQL parameter');
    const value = parameters[index++];
    const assignments = /\bSET\b/i.test(text) && /(?:\bSET|,)\s*$/i.test(text);
    if (assignments && value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !Buffer.isBuffer(value)) {
      const entries = Object.entries(value).filter(([,v]) => v !== undefined);
      if (!entries.length) throw new Error('Empty SQL assignment');
      text += entries.map(([key, v]) => `${identifier(key)} = ${scalar(v)}`).join(', ');
    } else text += bind(value);
  }
  if (index !== parameters.length) throw new Error(`SQL parameter mismatch: expected ${index}, received ${parameters.length}`);
  const insert = /^(INSERT INTO [\w".]+)\s+SET\s+([\s\S]+?)(\s+ON CONFLICT[\s\S]*)?;?$/i.exec(text.trim());
  if (insert) {
    const entries = splitSql(insert[2]).map(entry => {
      const match = /^([\w"]+)\s*=\s*([\s\S]+)$/.exec(entry);
      if (!match) throw new Error('Invalid insert assignment');
      return [match[1], match[2]];
    });
    text = `${insert[1]} (${entries.map(e => e[0]).join(', ')}) VALUES (${entries.map(e => e[1]).join(', ')})${insert[3] ?? ''}`;
  }
  return { text, values };
}

// Convert the application's legacy query templates before binding parameters.
// This keeps one parameterized query boundary while the storage engine is PostgreSQL.
export function postgresSql(sql: string): string {
  sql = sql.replace(/`([^`]+)`/g, '"$1"').replace(/<=>/g, 'IS NOT DISTINCT FROM')
    .replace(/\b(?:UTC_TIMESTAMP|NOW)\((\d*)\)/gi, (_m,precision) => precision ? `CURRENT_TIMESTAMP(${precision})` : 'CURRENT_TIMESTAMP').replace(/\bCURDATE\(\)/gi, 'CURRENT_DATE')
    .replace(/\bAS CHAR\b/gi, 'AS TEXT').replace(/\bLIKE\b/gi, 'ILIKE').replace(/\bFROM_UNIXTIME\(/gi,'to_timestamp(');
  const rewrite = (names: string, convert: (name: string, body: string) => string) => {
    const regex = new RegExp(`\\b(${names})\\s*\\(`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(sql))) {
      const start = regex.lastIndex;
      let depth = 1, quote = '', end = start;
      for (; end < sql.length; end++) {
        const c = sql[end];
        if (quote) { if (c === quote && sql[end + 1] === quote) end++; else if (c === quote) quote = ''; continue; }
        if (c === "'" || c === '"') { quote = c; continue; }
        if (c === '(') depth++; else if (c === ')' && --depth === 0) break;
      }
      if (depth) break;
      const body = postgresSql(sql.slice(start, end));
      const replacement = convert(match[1].toUpperCase(), body);
      sql = sql.slice(0, match.index) + replacement + sql.slice(end + 1);
      regex.lastIndex = match.index + replacement.length;
    }
  };
  rewrite('DATE_ADD|DATE_SUB|DATEDIFF|TIMESTAMPDIFF|DATE_FORMAT|YEAR|GROUP_CONCAT|SUM', (name, body) => {
    const args = splitSql(body);
    if (name === 'DATE_ADD' || name === 'DATE_SUB') {
      const interval = /^INTERVAL\s+(.+)\s+(SECOND|MINUTE|HOUR|DAY|MONTH|YEAR)$/i.exec(args[1]);
      if (!interval) throw new Error('Unsupported date interval');
      const result = `((${args[0]})::timestamptz ${name === 'DATE_ADD' ? '+' : '-'} (${interval[1]})::double precision * INTERVAL '1 ${interval[2].toLowerCase()}')`;
      return /\blast_change\b/.test(args[0]) ? `${result}::date` : result;
    }
    if (name === 'DATEDIFF') return `((${args[0]})::date - (${args[1]})::date)`;
    if (name === 'TIMESTAMPDIFF') return `TRUNC(EXTRACT(EPOCH FROM ((${args[2]})::timestamptz - (${args[1]})::timestamptz)) / ${{SECOND:1,MINUTE:60,HOUR:3600,DAY:86400}[args[0].toUpperCase()] ?? 1})`;
    if (name === 'DATE_FORMAT') return `to_char((${args[0]})::timestamptz, ${args[1].replace(/%Y/g,'YYYY').replace(/%m/g,'MM').replace(/%d/g,'DD')})`;
    if (name === 'YEAR') return `EXTRACT(YEAR FROM (${body})::date)`;
    if (name === 'GROUP_CONCAT') {
      const m = /^(.*?)(?:\s+ORDER BY\s+(.*?))?(?:\s+SEPARATOR\s+('(?:[^']|'')*'))?$/is.exec(body)!;
      const distinct = /^DISTINCT\s+/i.test(m[1]);
      return `STRING_AGG(${distinct ? 'DISTINCT ' : ''}(${m[1].replace(/^DISTINCT\s+/i,'')})::text, ${m[3] ?? "','"}${m[2] ? ` ORDER BY ${m[2]}` : ''})`;
    }
    return /(?:[=<>]|\bIS\b|\bBETWEEN\b|\bIN\s*\(|^official$)/i.test(body) && !/^CASE\b/i.test(body) ? `SUM((${body})::int)` : `SUM(${body})`;
  });
  const table = /\bINSERT(?: IGNORE)? INTO\s+([a-z_]+)/i.exec(sql)?.[1];
  if (/ON DUPLICATE KEY UPDATE/i.test(sql)) {
    const keys: Record<string,string> = {settings:'"key"',blocked_ips:'ip',secrets:'name',sync_sources:'code',operation_card_vehicles:'card_id, vehicle_id',notification_prefs:'user_id, category',rider_accounts:'rider_id',live_board:'rider_id',live_days:'rider_id, work_day',translation_overrides:'lang, tkey'};
    if (!table || !keys[table]) throw new Error('Missing PostgreSQL conflict key');
    sql = sql.replace(/ON DUPLICATE KEY UPDATE/i, `ON CONFLICT (${keys[table]}) DO UPDATE SET`).replace(/\bVALUES\((\w+)\)/gi, 'EXCLUDED.$1');
    sql = sql.replace(/COALESCE\(EXCLUDED\.(\w+), (\w+)\)/g, `COALESCE(EXCLUDED.$1, ${table}.$2)`);
    if (table === 'operation_card_vehicles') sql = sql.replace(/DO UPDATE SET card_id = card_id/i,'DO NOTHING');
  }
  if (/\bINSERT IGNORE\b/i.test(sql)) sql = sql.replace(/\bINSERT IGNORE\b/i,'INSERT') + ' ON CONFLICT DO NOTHING';
  sql = sql.replace(/COALESCE\(v.year,''\)/g,"COALESCE(v.year::text,'')").replace(/\b(entity_id\s*=\s*)([a-z_]\w*\.id)\b/gi,'$1$2::text')
    .replace(/([\w.)]+)\s+(day|month|hour|year)(?=\s*(?:,|FROM))/gi, (match, expression, label) => /^(SELECT|DISTINCT|AS)$/i.test(expression) ? match : `${expression} AS "${label}"`)
    .replace(/\bWHERE 1\b/g,'WHERE TRUE').replace(/\bHAVING n > 0\b/g,'HAVING COUNT(*) > 0')
    .replace(/is_current = \(id = (\?)\)/g,'is_current = (id = $1)::int');
  sql = sql.replace(/^(DELETE FROM (\w+) WHERE [\s\S]+) LIMIT (\d+)$/i, (_m, statement, table, limit) => `DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${statement.split(/ WHERE /i).slice(1).join(' WHERE ')} LIMIT ${limit})`);
  return sql;
}
