import test from 'node:test';
import assert from 'node:assert/strict';
import { formatQuery, identifier } from './sql.js';

test('SET objects become escaped assignments', () => {
  assert.equal(formatQuery('INSERT INTO users SET ?', [{ name: "O'Neil", extra: undefined, n: 2 }]), "INSERT INTO users SET `name` = 'O\\'Neil', `n` = 2");
  assert.equal(formatQuery('INSERT INTO b SET ? ON DUPLICATE KEY UPDATE ?', [{ id: 1, n: 2 }, { n: 2 }]), 'INSERT INTO b SET `id` = 1, `n` = 2 ON DUPLICATE KEY UPDATE `n` = 2');
  assert.equal(formatQuery('INSERT INTO s SET code = ?, ? ON DUPLICATE KEY UPDATE ?', ['hs', { on: 1 }, { on: 1 }]), "INSERT INTO s SET code = 'hs', `on` = 1 ON DUPLICATE KEY UPDATE `on` = 1");
  assert.equal(formatQuery('UPDATE riders SET ?, updated_by = ? WHERE id = ?', [{ city: 'Tabuk' }, 3, 9]), "UPDATE riders SET `city` = 'Tabuk', updated_by = 3 WHERE id = 9");
});

test('arrays expand to lists and rows; empty lists become NULL', () => {
  assert.equal(formatQuery('SELECT * FROM t WHERE id IN (?)', [[1, 2, 3]]), 'SELECT * FROM t WHERE id IN (1, 2, 3)');
  assert.equal(formatQuery('SELECT * FROM t WHERE id IN (?)', [[]]), 'SELECT * FROM t WHERE id IN (NULL)');
  assert.equal(formatQuery('INSERT INTO t (a, b) VALUES ?', [[[1, 'x'], [2, null]]]), "INSERT INTO t (a, b) VALUES (1, 'x'), (2, NULL)");
});

test('objects outside SET and JSON values inside rows are stored as JSON', () => {
  assert.equal(formatQuery('INSERT INTO a (j) VALUES (?)', [{ k: 1 }]), `INSERT INTO a (j) VALUES ('{\\"k\\":1}')`);
  assert.equal(formatQuery('INSERT INTO a (id, j) VALUES ?', [[[1, ['x']]]]), `INSERT INTO a (id, j) VALUES (1, '[\\"x\\"]')`);
});

test('placeholders inside quotes are left alone and counts must match', () => {
  assert.equal(formatQuery("SELECT '?' AS literal, ?", [42]), "SELECT '?' AS literal, 42");
  assert.equal(formatQuery('SELECT `a?` FROM t WHERE x = ?', [true]), 'SELECT `a?` FROM t WHERE x = 1');
  assert.throws(() => formatQuery('SELECT ?', []), /Missing SQL parameter/);
  assert.throws(() => formatQuery('SELECT 1', [1]), /parameter mismatch/);
});

test('dates are written in UTC and identifiers are validated', () => {
  assert.equal(formatQuery('SELECT ?', [new Date('2026-11-05T10:20:30Z')]), "SELECT '2026-11-05 10:20:30.000'");
  assert.equal(identifier('riders'), '`riders`');
  assert.throws(() => identifier('x; DROP TABLE y'), /Invalid SQL identifier/);
});
