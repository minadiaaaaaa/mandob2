import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileQuery, identifier } from './sql.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.APP_DATA_DIR || join(ROOT, 'data');
export const STORAGE_DIR = join(DATA_DIR, 'storage');
mkdirSync(STORAGE_DIR, { recursive: true });
const CONFIG_FILE = join(DATA_DIR, 'config.json');
export type DbConfig = { host: string; port: number; user: string; password: string; database: string; ssl?: boolean };
export const DB_SCHEMA = process.env.DB_SCHEMA || 'public';
identifier(DB_SCHEMA);
export function dbConfig(): DbConfig | null {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must be PostgreSQL');
    return { host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1) || 'postgres'), ssl: !['localhost','127.0.0.1','::1'].includes(url.hostname) };
  }
  if (process.env.DB_USER && process.env.DB_NAME) return { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME, ssl: process.env.DB_SSL !== '0' };
  if (existsSync(CONFIG_FILE)) {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    if (config.driver === 'postgres') return config.db;
  }
  return null;
}
export function saveDbConfig(db: DbConfig) {
  if (process.env.DATABASE_URL) return;
  writeFileSync(CONFIG_FILE, JSON.stringify({ driver: 'postgres', db }, null, 2));
  void pool?.end().catch(() => {});
  pool = null;
  cache = null;
}
pg.types.setTypeParser(20, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds JavaScript safe range');
  return number;
});
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(1082, value => value);
pg.types.setTypeParser(1114, value => value);
pg.types.setTypeParser(1184, value => new Date(value).toISOString().replace('T', ' ').replace(/\.000Z$/, '').replace(/Z$/, ''));
function options(config: DbConfig): pg.PoolConfig {
  const ca = process.env.DB_SSL_CA_FILE ? readFileSync(process.env.DB_SSL_CA_FILE, 'utf8') : undefined;
  return { ...config, ssl: config.ssl === false ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) }, max: Number(process.env.DB_POOL_SIZE || 5), connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, options: `-c timezone=UTC -c search_path=${DB_SCHEMA},public`, application_name: 'mandoob' };
}
export async function testConnection(config: DbConfig, _createDatabase = false) {
  const client = new pg.Client(options(config));
  try { await client.connect(); await client.query('SELECT 1'); }
  finally { await client.end(); }
}
let pool: pg.Pool | null = null;
let requestPool: pg.Pool | null = null;
function getPool() {
  if (pool) return pool;
  const config = dbConfig();
  if (!config) throw Object.assign(new Error('PostgreSQL is not configured'), { status: 503, setup: true });
  pool = new pg.Pool(options(config));
  pool.on('error', error => console.error('PostgreSQL idle connection error:', error.message));
  return pool;
}
function getRequestPool() {
  if (requestPool) return requestPool;
  if (!process.env.DATABASE_APP_URL) throw new Error('Restricted application database connection is not configured');
  const url = new URL(process.env.DATABASE_APP_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_APP_URL must be PostgreSQL');
  const config: DbConfig = { host:url.hostname,port:Number(url.port||5432),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:decodeURIComponent(url.pathname.slice(1)||'postgres'),ssl:!['localhost','127.0.0.1','::1'].includes(url.hostname) };
  requestPool = new pg.Pool(options(config));
  requestPool.on('error',error=>console.error('Application database idle connection error:',error.message));
  return requestPool;
}
const txConn = new AsyncLocalStorage<pg.PoolClient | undefined>();
type Actor = { kind: 'staff' | 'rider'; id: number };
const actorContext = new AsyncLocalStorage<Actor | undefined>();
export function withActor<T>(actor: Actor, fn: () => T): T { if (!Number.isSafeInteger(actor.id) || actor.id <= 0 || !['staff','rider'].includes(actor.kind)) throw new Error('Invalid authenticated actor'); return actorContext.run(actor, fn); }
// Bounded internal operations only; never exposed as a request option.
export function asSystem<T>(fn: () => T): T { return actorContext.run(undefined, () => txConn.run(undefined, fn)); }
async function queryScoped(text: string, values?: any[]) {
  if (actorContext.getStore() && !txConn.getStore()) return tx(() => runner().query(text, values));
  return runner().query(text, values);
}
const runner = () => txConn.getStore() ?? getPool();
export async function q<T = any>(sql: string, parameters: unknown[] = []): Promise<T[]> {
  const query = compileQuery(sql, parameters);
  return (await queryScoped(query.text, query.values)).rows as T[];
}
export async function one<T = any>(sql: string, parameters: unknown[] = []): Promise<T | undefined> { return (await q<T>(sql, parameters))[0]; }
export async function exec(sql: string, parameters: unknown[] = []) {
  const query = compileQuery(sql, parameters);
  if (/^\s*INSERT\b/i.test(query.text) && !/\bRETURNING\b/i.test(query.text)) query.text = query.text.replace(/;\s*$/, '') + ' RETURNING *';
  const result = await queryScoped(query.text, query.values);
  return { affectedRows: result.rowCount ?? 0, insertId: Number(result.rows[0]?.id ?? 0) };
}
export async function executeScript(sql: string) { await queryScoped(sql); }
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (txConn.getStore()) return fn();
  const client = await (actorContext.getStore() ? getRequestPool() : getPool()).connect();
  try {
    const actor = actorContext.getStore();
    // Actor values are validated server identities, never request fields; user query data stays bound.
    await client.query(actor
      ? `BEGIN; SET LOCAL ROLE mandoob_request; SET LOCAL app.actor_kind = '${actor.kind}'; SET LOCAL app.actor_id = '${actor.id}'`
      : 'BEGIN');
    const result = await txConn.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function closeDb() { await Promise.all([pool?.end(), requestPool?.end()]); pool = null; requestPool = null; }
let cache: { at: number; map: Map<string, string | null> } | null = null;
export async function setting(key: string): Promise<string | null> {
  if (!cache || Date.now() - cache.at > 5000) {
    const rows = await asSystem(() => q<{ key: string; value: string | null }>('SELECT "key", value FROM settings'));
    cache = { at: Date.now(), map: new Map(rows.map(row => [row.key, row.value])) };
  }
  return cache.map.get(key) ?? null;
}
export async function settingInt(key: string, fallback: number) {
  const raw = await setting(key), value = Number(raw);
  return raw !== null && raw !== '' && Number.isFinite(value) ? value : fallback;
}
export async function setSetting(key: string, value: string | null) {
  await exec('INSERT INTO settings ("key", value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP', [key, value]);
  cache = null;
}
export async function isInstalled() {
  if (!dbConfig()) return false;
  try { return (await setting('system.installed')) === '1'; } catch { return false; }
}
