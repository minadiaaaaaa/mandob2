import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scopeTenant, TENANT_TABLES } from './tenancy.js';

const s = (sql: string, t: number | null = 7) => scopeTenant(sql, t).sql.replace(/\s+/g, ' ').trim();
const F = (t: string, a?: string) => `(SELECT * FROM \`${t}\` WHERE \`${t}\`.tenant_id = 7)${a === undefined ? ` AS \`${t}\`` : ''}`;

test('sources become company-filtered derived tables, keeping aliases', () => {
  assert.equal(s('SELECT * FROM riders WHERE id = 1'), `SELECT * FROM ${F('riders')} WHERE id = 1`);
  assert.equal(s('SELECT r.id FROM riders r LEFT JOIN contracts k ON k.id = r.contract_id'), `SELECT r.id FROM ${F('riders', '')} r LEFT JOIN ${F('contracts', '')} k ON k.id = r.contract_id`);
  assert.equal(s('SELECT 1 FROM `users` AS u'), `SELECT 1 FROM ${F('users', '')} AS u`);
  assert.equal(s('SELECT a.x FROM riders a, vehicles v WHERE a.id = v.rider_id'), `SELECT a.x FROM ${F('riders', '')} a, ${F('vehicles', '')} v WHERE a.id = v.rider_id`);
  assert.equal(s('SELECT (SELECT COUNT(*) FROM leaves WHERE rider_id = r.id) n FROM riders r'), `SELECT (SELECT COUNT(*) FROM ${F('leaves')} WHERE rider_id = r.id) n FROM ${F('riders', '')} r`);
});

test('columns and qualified names that look like table names are left alone', () => {
  assert.equal(s('SELECT riders.id, billing FROM cities WHERE settings = 1'), 'SELECT riders.id, billing FROM cities WHERE settings = 1');
  assert.equal(s("SELECT 'FROM riders' x FROM cities"), "SELECT 'FROM riders' x FROM cities");
});

test('UPDATE and DELETE targets get the company condition', () => {
  assert.equal(s('UPDATE riders SET city_id = 2 WHERE id = 5'), 'UPDATE riders SET city_id = 2 WHERE ( id = 5) AND `riders`.tenant_id = 7');
  assert.equal(s('UPDATE users SET x = 1'), 'UPDATE users SET x = 1 WHERE `users`.tenant_id = 7');
  assert.equal(s('DELETE FROM notifications WHERE id = 3 LIMIT 1'), 'DELETE FROM notifications WHERE ( id = 3 ) AND `notifications`.tenant_id = 7 LIMIT 1');
  assert.equal(s('UPDATE oil_schedules s JOIN (SELECT vehicle_id, MAX(d) m FROM oil_changes GROUP BY vehicle_id) h ON h.vehicle_id = s.vehicle_id SET s.x = h.m WHERE s.x <> h.m'),
    `UPDATE oil_schedules s JOIN (SELECT vehicle_id, MAX(d) m FROM ${F('oil_changes')} GROUP BY vehicle_id) h ON h.vehicle_id = s.vehicle_id SET s.x = h.m WHERE ( s.x <> h.m) AND s.tenant_id = 7`);
  assert.equal(s('UPDATE riders SET n = (SELECT COUNT(*) FROM leaves WHERE rider_id = riders.id) WHERE id IN (1, 2)'),
    `UPDATE riders SET n = (SELECT COUNT(*) FROM ${F('leaves')} WHERE rider_id = riders.id) WHERE ( id IN (1, 2)) AND \`riders\`.tenant_id = 7`);
});

test('INSERT rows carry the company', () => {
  assert.equal(s("INSERT INTO riders SET `id` = 1, `full_name` = 'A'"), "INSERT INTO riders SET tenant_id = 7, `id` = 1, `full_name` = 'A'");
  assert.equal(s("INSERT IGNORE INTO roles (name, description) VALUES ('a', 'b'), ('c', 'd')"), "INSERT IGNORE INTO roles (tenant_id, name, description) VALUES (7, 'a', 'b'), (7, 'c', 'd')");
  assert.equal(s("INSERT INTO settings (`key`, value) VALUES ('k', 'v') ON DUPLICATE KEY UPDATE value = VALUES(value)"),
    "INSERT INTO settings (tenant_id, `key`, value) VALUES (7, 'k', 'v') ON DUPLICATE KEY UPDATE value = VALUES(value)");
  assert.equal(s('INSERT INTO live_board SET `rider_id` = 1 ON DUPLICATE KEY UPDATE `name` = 2'), 'INSERT INTO live_board SET tenant_id = 7, `rider_id` = 1 ON DUPLICATE KEY UPDATE `name` = 2');
  assert.equal(s('INSERT INTO notifications (user_id, title) SELECT id, 1 FROM users WHERE status = 1'),
    `INSERT INTO notifications (tenant_id, user_id, title) SELECT 7, id, 1 FROM ${F('users')} WHERE status = 1`);
  // rows that already name their company (restore) are kept as they are
  assert.equal(s('INSERT INTO riders (tenant_id, id) VALUES (3, 1)'), 'INSERT INTO riders (tenant_id, id) VALUES (3, 1)');
});

test('platform tables and non-data statements pass through', () => {
  assert.equal(s('SELECT * FROM tenants WHERE id = 1'), 'SELECT * FROM tenants WHERE id = 1');
  assert.equal(s('SET FOREIGN_KEY_CHECKS = 0'), 'SET FOREIGN_KEY_CHECKS = 0');
  assert.equal(scopeTenant('INSERT INTO login_challenges (id) VALUES (1)', null).touches, false);
});

test('without a company, touching company data is detected', () => {
  assert.equal(scopeTenant('SELECT * FROM riders', null).touches, true);
  assert.equal(scopeTenant('UPDATE users SET a = 1', null).touches, true);
  assert.equal(scopeTenant('SELECT * FROM cities', null).touches, false);
});

// a table with a company column that is missing from TENANT_TABLES would be read across companies
test('every table with tenant_id in schema.sql is scoped, and only those', () => {
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  const withTenant = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS `?(\w+)`?\s*\(([\s\S]*?)\n\);/g)].filter((m) => /\btenant_id\b/.test(m[2])).map((m) => m[1]);
  assert.ok(withTenant.includes('branches') && withTenant.includes('designations'));
  assert.deepEqual([...withTenant].sort(), [...TENANT_TABLES].sort());
});

// a derived table is read from the transaction's snapshot; a locking read must see the latest rows
test('a locking SELECT on one company table filters it in the WHERE, not in a derived table', () => {
  assert.equal(s('SELECT COUNT(*) n FROM riders WHERE status <> 1 LOCK IN SHARE MODE'), 'SELECT COUNT(*) n FROM riders WHERE ( status <> 1 ) AND `riders`.tenant_id = 7 LOCK IN SHARE MODE');
  assert.equal(s('SELECT is_active FROM branches b WHERE id = 3 FOR UPDATE'), 'SELECT is_active FROM branches b WHERE ( id = 3 ) AND b.tenant_id = 7 FOR UPDATE');
  assert.equal(s('SELECT id FROM tenants WHERE id = 7 FOR UPDATE'), 'SELECT id FROM tenants WHERE id = 7 FOR UPDATE');
  // two company tables (a join): both stay derived tables
  assert.ok(s('SELECT r.id FROM riders r JOIN branches b ON b.id = r.branch_id FOR UPDATE').includes('(SELECT * FROM `branches`'));
});
