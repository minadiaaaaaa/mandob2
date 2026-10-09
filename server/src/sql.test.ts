import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { compileQuery, identifier } from './sql.js';

test('PostgreSQL templates preserve bound data and reject unsafe identifiers', () => {
  const payload = "x'); DROP TABLE users; --";
  const query = compileQuery('INSERT INTO users SET ?', [{ name: payload, extra: { note: 'safe' } }]);
  assert.equal(query.text, 'INSERT INTO users ("name", "extra") VALUES ($1, $2)');
  assert.deepEqual(query.values, [payload, '{"note":"safe"}']);
  assert.throws(() => identifier('users; DROP TABLE roles'));
  assert.throws(() => compileQuery('SELECT ?', []));
  assert.throws(() => compileQuery('SELECT 1', ['unused']));
  assert.equal(compileQuery("SELECT '?' AS literal, ?", [42]).text, "SELECT '?' AS literal, $1");
});

test('legacy query forms execute on PostgreSQL with matching application behavior', async () => {
  const db = new PGlite();
  const run = async (text: string, params: unknown[] = []) => {
    const query = compileQuery(text, params);
    return db.query<any>(query.text, query.values);
  };
  try {
    await db.exec(`CREATE TABLE live_board(rider_id bigint PRIMARY KEY, status text); CREATE TABLE blocked_ips(ip text PRIMARY KEY, reason text); CREATE TABLE items(id bigint PRIMARY KEY, name text, active smallint, last_change date, interval_days int)`);
    await run('INSERT INTO items(id,name,active,last_change,interval_days) VALUES ?', [[[1,'One',1,'2026-01-10',90],[2,'Two',0,'2026-01-10',30]]]);
    await run('INSERT IGNORE INTO items SET ?', [{id:1,name:'Ignored',active:0}]);
    await run('INSERT INTO live_board SET ? ON DUPLICATE KEY UPDATE ?', [{rider_id:1,status:'idle'},{status:'busy'}]);
    await run('INSERT INTO live_board SET ? ON DUPLICATE KEY UPDATE ?', [{rider_id:1,status:'idle'},{status:'busy'}]);
    assert.equal((await run('SELECT status FROM live_board')).rows[0].status, 'busy');
    await run('INSERT INTO blocked_ips(ip,reason) VALUES (?,?) ON DUPLICATE KEY UPDATE reason=VALUES(reason)', ['127.0.0.1','first']);
    await run('INSERT INTO blocked_ips(ip,reason) VALUES (?,?) ON DUPLICATE KEY UPDATE reason=VALUES(reason)', ['127.0.0.1','second']);
    assert.equal((await run('SELECT reason FROM blocked_ips')).rows[0].reason, 'second');
    const [row] = (await run(`SELECT SUM(active=1) n, GROUP_CONCAT(name ORDER BY name SEPARATOR ' · ') names FROM items WHERE id IN (?)`, [[1,2]])).rows;
    assert.equal(Number(row.n), 1); assert.equal(row.names, 'One · Two');
    assert.equal(new Date((await run("SELECT DATE_ADD(last_change, INTERVAL interval_days DAY) d FROM items WHERE id=1")).rows[0].d).toISOString().slice(0,10), '2026-04-10');
    assert.equal(Number((await run("SELECT DATEDIFF(DATE_ADD('2026-01-10', INTERVAL ? DAY), '2026-01-10') d", [90])).rows[0].d),90);
    assert.equal(Number((await run("SELECT TIMESTAMPDIFF(MINUTE, '2026-01-01 00:00:00', '2026-01-01 00:30:00') d")).rows[0].d),30);
    assert.equal((await run("SELECT DATE_FORMAT(last_change, '%Y-%m') m FROM items LIMIT 1")).rows[0].m,'2026-01');
    assert.equal((await run('SELECT NULL::text <=> ? AS equal', [null])).rows[0].equal,true);
    await run('DELETE FROM items WHERE active=0 LIMIT 10000');
    assert.equal((await run('SELECT id FROM items')).rows.length,1);
  } finally { await db.close(); }
});
