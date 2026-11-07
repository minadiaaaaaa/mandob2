// Company isolation for the SaaS: every table a subscribed company owns has a tenant_id column, and every
// query is rewritten here before it is sent, so route code never has to remember the filter.
//   SELECT … FROM riders r            → FROM (SELECT * FROM riders WHERE tenant_id = 7) r
//   UPDATE riders SET … WHERE id = 1  → … WHERE (id = 1) AND riders.tenant_id = 7
//   DELETE FROM riders WHERE …        → same as UPDATE
//   INSERT INTO riders SET … / (cols) VALUES (…) → tenant_id = 7 is added to every row
// MySQL 8 and MariaDB merge such derived tables into the outer query, so indexes are still used.
// A query that touches a company table without a company (and outside platform mode) is refused.

export const TENANT_TABLES = new Set([
  'advance_installments', 'advances', 'applicants', 'attachments', 'audit_log', 'billing', 'branches', 'branding_photos', 'companies', 'contracts',
  'cron_runs', 'daily_performance', 'designations', 'email_log', 'fin_accounts', 'fin_assets', 'fin_categories', 'fin_entries', 'fin_obligation_dues', 'fin_obligations', 'fin_stock_items', 'fin_stock_moves', 'fin_suppliers', 'email_templates', 'error_log', 'fines', 'fuel_cards', 'insurance_companies',
  'insurance_policies', 'leaves', 'live_board', 'live_days', 'live_points', 'login_attempts', 'monthly_ratings', 'notification_prefs',
  'notifications', 'oil_changes', 'payroll_lines', 'payroll_sheets', 'oil_schedules', 'operation_card_vehicles', 'operation_cards', 'platform_id_transfers', 'platform_ids', 'rating_cutoffs', 'renewals',
  'rider_absences', 'rider_accounts', 'rider_bank_accounts', 'rider_change_requests', 'rider_codes', 'rider_documents', 'rider_issue_messages', 'rider_issues',
  'rider_login_attempts', 'rider_sessions', 'riders', 'role_permissions', 'roles', 'salary_rules', 'secrets', 'sessions', 'settings',
  'subscription_payments', 'sync_runs', 'sync_sources', 'transport_licenses', 'users', 'vehicle_accident_events', 'vehicle_accidents', 'vehicle_assignments', 'vehicle_insurance', 'vehicle_services',
  'vehicle_registrations', 'vehicles', 'wallet_entries', 'wallet_snapshots',
]);

type Tok = { type: 'ws' | 'str' | 'qid' | 'word' | 'num' | 'punct'; v: string };
function tokenize(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { let j = i; while (j < sql.length && /\s/.test(sql[j])) j++; out.push({ type: 'ws', v: sql.slice(i, j) }); i = j; continue; }
    if (c === '-' && sql[i + 1] === '-') { let j = sql.indexOf('\n', i); if (j < 0) j = sql.length; out.push({ type: 'ws', v: sql.slice(i, j) }); i = j; continue; }
    if (c === '#') { let j = sql.indexOf('\n', i); if (j < 0) j = sql.length; out.push({ type: 'ws', v: sql.slice(i, j) }); i = j; continue; }
    if (c === '/' && sql[i + 1] === '*') { let j = sql.indexOf('*/', i + 2); j = j < 0 ? sql.length : j + 2; out.push({ type: 'ws', v: sql.slice(i, j) }); i = j; continue; }
    if (c === "'" ) {
      let j = i + 1;
      for (; j < sql.length; j++) {
        if (sql[j] === '\\') { j++; continue; }
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j++; continue; } break; }
      }
      out.push({ type: 'str', v: sql.slice(i, j + 1) }); i = j + 1; continue;
    }
    if (c === '`' || c === '"') {
      let j = i + 1;
      for (; j < sql.length; j++) { if (sql[j] === c) { if (sql[j + 1] === c) { j++; continue; } break; } }
      out.push({ type: 'qid', v: sql.slice(i, j + 1) }); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j])) j++; out.push({ type: 'word', v: sql.slice(i, j) }); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < sql.length && /[0-9.eE]/.test(sql[j])) j++; out.push({ type: 'num', v: sql.slice(i, j) }); i = j; continue; }
    out.push({ type: 'punct', v: c }); i++;
  }
  return out;
}

const NOT_ALIAS = new Set(['WHERE', 'ON', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'NATURAL', 'STRAIGHT_JOIN', 'GROUP', 'ORDER',
  'LIMIT', 'HAVING', 'UNION', 'SET', 'USING', 'FOR', 'LOCK', 'WINDOW', 'INTO', 'VALUES', 'VALUE', 'FORCE', 'USE', 'IGNORE', 'SELECT', 'FROM',
  'AND', 'OR', 'PARTITION', 'EXCEPT', 'INTERSECT', 'AS']);
const CLAUSES = new Set(['SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'SET', 'VALUES', 'VALUE', 'ON', 'UNION', 'USING', 'INTO', 'UPDATE']);

const tableName = (t: Tok | undefined) => !t ? null : t.type === 'word' ? t.v.toLowerCase() : t.type === 'qid' ? t.v.slice(1, -1).toLowerCase() : null;
const up = (t: Tok | undefined) => (t && t.type === 'word' ? t.v.toUpperCase() : t?.v ?? '');

export class TenantScopeError extends Error {}

// tenant === null: only report whether the statement touches company tables (used to refuse unscoped access).
export function scopeTenant(sql: string, tenant: number | null): { sql: string; touches: boolean } {
  const toks = tokenize(sql);
  const sig: number[] = [];
  toks.forEach((t, i) => { if (t.type !== 'ws') sig.push(i); });
  if (!sig.length) return { sql, touches: false };
  const first = up(toks[sig[0]]);
  const stmt = first === '(' ? 'SELECT' : first === 'WITH' ? 'SELECT' : first;
  if (!['SELECT', 'INSERT', 'REPLACE', 'UPDATE', 'DELETE'].includes(stmt)) return { sql, touches: false };

  // depth and the clause each significant token sits in
  const depth: number[] = new Array(toks.length).fill(0);
  const clause: string[] = new Array(toks.length).fill('');
  const stack: string[] = [stmt];
  let d = 0;
  for (const i of sig) {
    const t = toks[i];
    if (t.v === '(') { depth[i] = d; clause[i] = stack[d]; d++; stack[d] = ''; continue; }
    if (t.v === ')') { d = Math.max(0, d - 1); depth[i] = d; clause[i] = stack[d]; continue; }
    depth[i] = d;
    const w = up(t);
    if (t.type === 'word' && (CLAUSES.has(w) || w === 'JOIN' || w === 'STRAIGHT_JOIN')) stack[d] = w === 'JOIN' || w === 'STRAIGHT_JOIN' ? 'FROM' : w;
    clause[i] = stack[d];
  }
  const pos = new Map<number, number>(); sig.forEach((ti, k) => pos.set(ti, k));
  const prevSig = (i: number) => { const k = pos.get(i)!; return k > 0 ? sig[k - 1] : -1; };
  const nextSig = (i: number) => { const k = pos.get(i)!; return k + 1 < sig.length ? sig[k + 1] : -1; };

  const before = new Map<number, string>(), after = new Map<number, string>(), replace = new Map<number, string>();
  const addAfter = (i: number, s: string) => after.set(i, (after.get(i) ?? '') + s);
  const addBefore = (i: number, s: string) => before.set(i, s + (before.get(i) ?? ''));
  let touches = false;
  const T = String(tenant);
  let deleteFromSeen = false;
  // A locking read (… FOR UPDATE / LOCK IN SHARE MODE) must see the latest rows, but a derived table is read from the
  // transaction's snapshot. So a locking SELECT on one company table filters that table in its WHERE instead.
  const isSource = (i: number) => {
    const p = prevSig(i), pw = p >= 0 ? up(toks[p]) : '';
    return pw === 'FROM' || pw === 'JOIN' || pw === 'STRAIGHT_JOIN' || (pw === ',' && clause[p] === 'FROM');
  };
  const topSources = stmt === 'SELECT' ? sig.filter((i) => depth[i] === 0 && TENANT_TABLES.has(tableName(toks[i]) ?? '') && toks[nextSig(i)]?.v !== '.' && isSource(i)) : [];
  const locking = sig.some((j, k) => depth[j] === 0 && ((up(toks[j]) === 'FOR' && ['UPDATE', 'SHARE'].includes(up(toks[sig[k + 1]]))) || (up(toks[j]) === 'LOCK' && up(toks[sig[k + 1]]) === 'IN')));
  const filterInWhere = locking && topSources.length === 1 ? topSources[0] : -1;

  for (const i of sig) {
    const name = tableName(toks[i]);
    if (!name || !TENANT_TABLES.has(name)) continue;
    const n = nextSig(i);
    if (n >= 0 && toks[n].v === '.') continue; // riders.id is a column reference
    const p = prevSig(i);
    const pw = p >= 0 ? up(toks[p]) : '';
    let role: 'insert' | 'update' | 'delete' | 'source' | 'locked' | null = null;
    if (i === filterInWhere) role = 'locked';
    else if (pw === 'INTO' && depth[i] === 0 && (stmt === 'INSERT' || stmt === 'REPLACE')) role = 'insert';
    else if (stmt === 'UPDATE' && depth[i] === 0 && pos.get(i) === 1) role = 'update';
    else if (stmt === 'UPDATE' && depth[i] === 0 && ['LOW_PRIORITY', 'IGNORE'].includes(pw) && pos.get(i)! <= 3) role = 'update';
    else if (stmt === 'DELETE' && depth[i] === 0 && pw === 'FROM' && !deleteFromSeen) { role = 'delete'; deleteFromSeen = true; }
    else if (pw === 'FROM' || pw === 'JOIN' || pw === 'STRAIGHT_JOIN' || (pw === ',' && clause[p] === 'FROM')) role = 'source';
    if (!role) continue;
    touches = true;
    if (tenant === null) continue;
    const quoted = '`' + name + '`';
    // the alias the rest of the statement uses for this table
    let alias = quoted;
    if (n >= 0) {
      const nw = up(toks[n]);
      if (nw === 'AS') { const a = nextSig(n); if (a >= 0) alias = toks[a].type === 'qid' ? toks[a].v : toks[a].v; }
      else if ((toks[n].type === 'word' && !NOT_ALIAS.has(nw)) || toks[n].type === 'qid') alias = toks[n].v;
    }
    const hasAlias = alias !== quoted;
    if (role === 'source') {
      replace.set(i, `(SELECT * FROM ${quoted} WHERE ${quoted}.tenant_id = ${T})${hasAlias ? '' : ' AS ' + quoted}`);
    } else if (role === 'update' || role === 'delete' || role === 'locked') {
      const cond = `${alias}.tenant_id = ${T}`;
      let where = -1, stop = -1;
      for (const j of sig) {
        if (j <= i || depth[j] !== 0) continue;
        const w = up(toks[j]);
        if (toks[j].type === 'word' && w === 'WHERE' && where < 0) where = j;
        else if ((toks[j].type === 'word' && ['GROUP', 'HAVING', 'WINDOW', 'ORDER', 'LIMIT', 'FOR', 'LOCK', 'UNION'].includes(w)) || toks[j].v === ';') { stop = j; break; }
      }
      if (where >= 0) {
        addAfter(where, ' (');
        if (stop >= 0) addBefore(stop, `) AND ${cond} `); else addAfter(toks.length - 1, `) AND ${cond}`);
      } else if (stop >= 0) addBefore(stop, ` WHERE ${cond} `);
      else addAfter(toks.length - 1, ` WHERE ${cond}`);
    } else {
      // INSERT INTO t SET … | INSERT INTO t (cols) VALUES (…), (…) | INSERT INTO t (cols) SELECT …
      if (n < 0) throw new TenantScopeError('Incomplete INSERT');
      const nw = up(toks[n]);
      if (nw === 'SET') {
        const mentions = sig.some((j) => j > n && depth[j] === 0 && tableName(toks[j]) === 'tenant_id' && toks[nextSig(j)]?.v === '=');
        if (!mentions) addAfter(n, ` tenant_id = ${T},`);
      } else if (toks[n].v === '(') {
        let close = -1;
        for (const j of sig) if (j > n && toks[j].v === ')' && depth[j] === depth[n]) { close = j; break; }
        if (close < 0) throw new TenantScopeError('Unclosed INSERT column list');
        const listed = sig.some((j) => j > n && j < close && tableName(toks[j]) === 'tenant_id');
        if (!listed) {
          addAfter(n, 'tenant_id, ');
          const kw = nextSig(close);
          const kww = up(toks[kw]);
          if (kww === 'VALUES' || kww === 'VALUE') {
            for (const j of sig) {
              if (j <= kw) continue;
              if (depth[j] === 0 && toks[j].type === 'word' && up(toks[j]) === 'ON') break;
              if (depth[j] === 0 && toks[j].v === '(') addAfter(j, `${T}, `);
            }
          } else if (kww === 'SELECT') {
            const dn = nextSig(kw);
            addAfter(up(toks[dn]) === 'DISTINCT' ? dn : kw, ` ${T},`);
          } else throw new TenantScopeError('Unsupported INSERT form');
        }
      } else throw new TenantScopeError('INSERT into a company table must name its columns');
    }
  }
  if (tenant === null || !touches) return { sql, touches };
  let outSql = '';
  toks.forEach((t, i) => { outSql += (before.get(i) ?? '') + (replace.get(i) ?? t.v) + (after.get(i) ?? ''); });
  return { sql: outSql, touches };
}
