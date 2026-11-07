import mysql from 'mysql2/promise';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatQuery } from './sql.js';
import { scopeTenant } from './tenancy.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.APP_DATA_DIR || join(ROOT, 'data');
export const STORAGE_DIR = join(DATA_DIR, 'storage');
mkdirSync(STORAGE_DIR, { recursive: true });
const CONFIG_FILE = join(DATA_DIR, 'config.json');
export type DbConfig = { host: string; port: number; user: string; password: string; database: string; ssl?: boolean };

// DATABASE_URL (mysql://user:pass@host:3306/db), then DB_* variables, then the setup wizard's data/config.json.
export function dbConfig(): DbConfig | null {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    if (!['mysql:', 'mariadb:'].includes(url.protocol)) throw new Error('DATABASE_URL must be mysql://user:password@host:3306/database');
    return { host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), ssl: url.searchParams.get('ssl') === '1' };
  }
  if (process.env.DB_USER && process.env.DB_NAME) return { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME, ssl: process.env.DB_SSL === '1' };
  if (existsSync(CONFIG_FILE)) {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    if (config.driver === 'mysql') return config.db;
  }
  return null;
}

// Dates come back as 'YYYY-MM-DD HH:MM:SS' strings in UTC; DECIMAL and COUNT(*) as numbers.
// ANSI_QUOTES lets "double quoted" names work as identifiers alongside `backticks`.
const SQL_MODE = 'ANSI_QUOTES,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
function options(config: DbConfig, withDatabase = true): mysql.PoolOptions {
  // The CA as a file, or as the PEM text itself (hosts such as Render only take environment values).
  const ca = process.env.DB_SSL_CA_FILE ? readFileSync(process.env.DB_SSL_CA_FILE, 'utf8') : process.env.DB_SSL_CA?.replace(/\\n/g, '\n') || undefined;
  return {
    host: config.host, port: config.port, user: config.user, password: config.password,
    ...(withDatabase ? { database: config.database } : {}),
    ssl: config.ssl ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : undefined,
    charset: 'utf8mb4_unicode_ci', timezone: 'Z', dateStrings: true, decimalNumbers: true, supportBigNumbers: true, bigNumberStrings: false,
    multipleStatements: true, connectTimeout: 10000, typeCast,
  };
}
// MySQL 8 reports JSON columns and mysql2 parses them; MariaDB (common on shared hosting) stores JSON as
// LONGTEXT, so the same columns are parsed here and the code sees the same objects on both servers.
const JSON_COLUMNS = new Set(['audit_log.before_json', 'audit_log.after_json', 'notifications.params', 'rider_change_requests.payload',
  'rider_change_requests.snapshot', 'branding_photos.measurements', 'cron_runs.details']);
const typeCast: mysql.TypeCast = (field, next) => {
  if (field.type === 'BLOB' && JSON_COLUMNS.has(`${(field as any).orgTable ?? field.table}.${(field as any).orgName ?? field.name}`)) {
    const text = field.string('utf8');
    if (text === null) return null;
    try { return JSON.parse(text); } catch { return text; }
  }
  return next();
};
const prepare =(conn: { query: (sql: string) => any }) => conn.query(`SET time_zone = '+00:00', sql_mode = '${SQL_MODE}', group_concat_max_len = 1048576`);


let pool: mysql.Pool | null = null;
function getPool() {
  if (pool) return pool;
  const config = dbConfig();
  if (!config) throw Object.assign(new Error('MySQL is not configured'), { status: 503, setup: true });
  pool = mysql.createPool({ ...options(config), connectionLimit: Number(process.env.DB_POOL_SIZE || 10), waitForConnections: true });
  // every new connection gets UTC and the SQL mode before its first query
  (pool as any).pool.on('connection', (conn: any) => prepare(conn));
  return pool;
}

const txConn = new AsyncLocalStorage<mysql.PoolConnection | undefined>();
type Actor = { kind: 'staff' | 'rider'; id: number };
const actorContext = new AsyncLocalStorage<Actor | undefined>();
// Express checks permissions on every route; the actor is kept so code can tell who is calling.
export function withActor<T>(actor: Actor, fn: () => T): T { if (!Number.isSafeInteger(actor.id) || actor.id <= 0 || !['staff','rider'].includes(actor.kind)) throw new Error('Invalid authenticated actor'); return actorContext.run(actor, fn); }
// Bounded internal operations (audit, mail, notifications) run outside the caller's transaction.
export function asSystem<T>(fn: () => T): T { return actorContext.run(undefined, () => txConn.run(undefined, fn)); }
const runner = () => txConn.getStore() ?? getPool();

// ---------- the subscribed company a request works for (see tenancy.ts) ----------
// { tenant: n } scopes every query to company n (0 is the platform itself); { platform: true } is for the few
// cross-company operations (sign-in lookup, the owner dashboard, the scheduler) and sees every company.
type Scope = { tenant: number } | { platform: true };
const scopeContext = new AsyncLocalStorage<Scope>();
export function withTenant<T>(tenant: number, fn: () => T): T {
  if (!Number.isSafeInteger(tenant) || tenant < 0) throw new Error('Invalid company');
  return scopeContext.run({ tenant }, fn);
}
export function asPlatform<T>(fn: () => T): T { return scopeContext.run({ platform: true }, fn); }
// For command-line test scripts only: the rest of the script works inside one company.
export function enterTenantForScript(tenant: number) { scopeContext.enterWith({ tenant }); }
export function currentTenant(): number | null { const s = scopeContext.getStore(); return s && 'tenant' in s ? s.tenant : null; }
function compile(sql: string, parameters: unknown[]) {
  const text = formatQuery(sql, parameters);
  const scope = scopeContext.getStore();
  if (scope && 'platform' in scope) return text;
  if (scope) return scopeTenant(text, scope.tenant).sql;
  if (scopeTenant(text, null).touches) throw new Error('A query on company data ran without a company: ' + text.slice(0, 120));
  return text;
}

// See sql.ts: placeholders are expanded and escaped before the query is sent.
export async function q<T = any>(sql: string, parameters: unknown[] = []): Promise<T[]> {
  const [rows] = await runner().query(compile(sql, parameters));
  return (Array.isArray(rows) ? rows : []) as T[];
}
export async function one<T = any>(sql: string, parameters: unknown[] = []): Promise<T | undefined> { return (await q<T>(sql, parameters))[0]; }
// Plan limits: every new counted record (rider, vehicle, staff account, platform, contract, branch, designation…) is
// checked here, whichever screen, import or sync adds it. quotas.ts hands over the check together with the counted
// tables of domain/plans.ts QUOTAS, so a new quota cannot be left out; only inserts into those tables are wrapped in
// a transaction for the check.
type InsertGuard = (table: string, parameters: unknown[]) => Promise<void>;
let insertGuard: { check: InsertGuard; tables: Set<string> } | null = null;
export function setInsertGuard(check: InsertGuard, tables: string[]) { insertGuard = { check, tables: new Set(tables) }; }
const INSERT_INTO = /^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?[\s(]/i;
export const inTransaction = () => !!txConn.getStore();
export async function exec(sql: string, parameters: unknown[] = []): Promise<{ affectedRows: number; insertId: number }> {
  const table = insertGuard && currentTenant() ? INSERT_INTO.exec(sql)?.[1].toLowerCase() : undefined;
  if (table && insertGuard!.tables.has(table)) {
    // the check and the insert share one transaction, so the company stays locked until the row is written
    if (!inTransaction()) return tx(() => exec(sql, parameters));
    await insertGuard!.check(table, parameters);
  }
  const [result] = await runner().query(compile(sql, parameters));
  const header = result as mysql.ResultSetHeader;
  return { affectedRows: header.affectedRows ?? 0, insertId: Number(header.insertId ?? 0) };
}
export async function executeScript(sql: string) { await runner().query(sql); }
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (txConn.getStore()) return fn();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await txConn.run(conn, fn);
    await conn.commit();
    return result;
  } catch (error) { await conn.rollback().catch(() => {}); throw error; }
  finally { conn.release(); }
}
// Runs fn in a transaction while holding a named MySQL lock; the lock is released only after the commit,
// so two requests can never read the same "next number" (replaces PostgreSQL advisory locks).
export async function lockedTx<T>(lockName: string, fn: () => Promise<T>): Promise<T> {
  if (txConn.getStore()) return fn();
  return withNamedLock(`mandoob:${currentTenant() ?? 'p'}:${lockName}`, () => tx(fn));
}
// A MySQL named lock belongs to one connection, so it is taken and released on a dedicated one while fn runs
// on the pool as usual.
export async function withNamedLock<T>(name: string, fn: () => Promise<T>, waitSeconds = 15): Promise<T> {
  const key = name.slice(0, 64);
  const holder = await getPool().getConnection();
  try {
    const [rows] = await holder.query(formatQuery('SELECT GET_LOCK(?, ?) ok', [key, waitSeconds]));
    if ((rows as any)[0]?.ok !== 1) throw Object.assign(new Error('Could not obtain lock ' + name), { status: 503 });
    try { return await fn(); }
    finally { await holder.query(formatQuery('SELECT RELEASE_LOCK(?)', [key])).catch(() => {}); }
  } finally { holder.release(); }
}
export async function closeDb() { await pool?.end(); pool = null; }
// Settings belong to each company; outside a company (platform scope) the platform's own settings (company 0) apply.
const cache = new Map<number, { at: number; map: Map<string, string | null> }>();
const settingsTenant = () => currentTenant() ?? 0;
export async function setting(key: string): Promise<string | null> {
  const t = settingsTenant();
  let c = cache.get(t);
  if (!c || Date.now() - c.at > 5000) {
    const rows = await withTenant(t, () => asSystem(() => q<{ key: string; value: string | null }>('SELECT `key`, value FROM settings')));
    c = { at: Date.now(), map: new Map(rows.map(row => [row.key, row.value])) };
    cache.set(t, c);
  }
  return c.map.get(key) ?? null;
}
export async function settingInt(key: string, fallback: number) {
  const raw = await setting(key), value = Number(raw);
  return raw !== null && raw !== '' && Number.isFinite(value) ? value : fallback;
}
export async function setSetting(key: string, value: string | null) {
  const t = settingsTenant();
  await withTenant(t, () => exec('INSERT INTO settings (`key`, value, updated_at) VALUES (?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = UTC_TIMESTAMP()', [key, value]));
  cache.delete(t);
}
export async function isInstalled() {
  if (!dbConfig()) return false;
  try { return (await withTenant(0, () => setting('system.installed'))) === '1'; } catch { return false; }
}
