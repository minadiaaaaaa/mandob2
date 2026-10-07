import mysql from 'mysql2/promise';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = join(ROOT, 'data');
export const STORAGE_DIR = join(DATA_DIR, 'storage');
mkdirSync(STORAGE_DIR, { recursive: true });
const CONFIG_FILE = join(DATA_DIR, 'config.json');

export type DbConfig = { host: string; port: number; user: string; password: string; database: string };

// The setup wizard writes data/config.json; otherwise the DB_* variables from .env are used.
export function dbConfig(): DbConfig | null {
  if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).db;
  const e = process.env;
  if (!e.DB_USER || !e.DB_NAME) return null;
  return { host: e.DB_HOST || '127.0.0.1', port: Number(e.DB_PORT || 3306), user: e.DB_USER, password: e.DB_PASSWORD || '', database: e.DB_NAME };
}

export function saveDbConfig(db: DbConfig) {
  writeFileSync(CONFIG_FILE, JSON.stringify({ db }, null, 2));
  pool?.end().catch(() => {});
  pool = null;
}

const opts = { dateStrings: true, decimalNumbers: true, supportBigNumbers: true, bigNumberStrings: false, charset: 'utf8mb4', timezone: 'Z' } as const;

export async function testConnection(c: DbConfig, createDb = false) {
  const conn = await mysql.createConnection({ host: c.host, port: c.port, user: c.user, password: c.password, ...opts });
  try {
    if (createDb) await conn.query(`CREATE DATABASE IF NOT EXISTS \`${c.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    else await conn.query('SELECT 1');
  } finally {
    await conn.end();
  }
}

let pool: mysql.Pool | null = null;
function getPool() {
  if (pool) return pool;
  const c = dbConfig();
  if (!c) throw Object.assign(new Error('Database is not configured'), { status: 503, setup: true });
  pool = mysql.createPool({ ...c, ...opts, connectionLimit: 10, multipleStatements: true });
  // All DATETIME values are stored in UTC; the client shows them in the organization time zone.
  pool.pool.on('connection', (conn: any) => conn.query("SET time_zone = '+00:00'"));
  return pool;
}

// Queries inside tx() run on the transaction's connection without passing it around.
const txConn = new AsyncLocalStorage<mysql.PoolConnection>();
const runner = () => txConn.getStore() ?? getPool();

export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await runner().query(sql, params);
  return rows as T[];
}
export async function one<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(sql, params))[0];
}
export async function exec(sql: string, params: unknown[] = []) {
  const [res] = await runner().query(sql, params);
  return res as mysql.ResultSetHeader;
}
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (txConn.getStore()) return fn();
  const conn = await getPool().getConnection();
  await conn.beginTransaction();
  try {
    const out = await txConn.run(conn, fn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// Settings are read on almost every request; a short cache keeps that cheap while edits apply "within seconds".
let cache: { at: number; map: Map<string, string | null> } | null = null;
export async function setting(key: string): Promise<string | null> {
  if (!cache || Date.now() - cache.at > 5000) {
    const rows = await q<{ key: string; value: string | null }>('SELECT `key`, value FROM settings');
    cache = { at: Date.now(), map: new Map(rows.map((r) => [r.key, r.value])) };
  }
  return cache.map.get(key) ?? null;
}
export async function settingInt(key: string, fallback: number) {
  const raw = await setting(key);
  const v = Number(raw);
  return raw !== null && raw !== '' && Number.isFinite(v) ? v : fallback;
}
export async function setSetting(key: string, value: string | null) {
  await exec('INSERT INTO settings (`key`, value, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()', [key, value]);
  cache = null;
}
export async function isInstalled() {
  if (!dbConfig()) return false;
  try {
    return (await setting('system.installed')) === '1';
  } catch {
    return false;
  }
}
