// Phase 5: the IBAN check used for riders' bank accounts (domain/employees.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIban, validIban } from './domain/employees.js';

test('IBANs are kept without spaces, upper-case, and must pass the mod 97 check', () => {
  assert.equal(normalizeIban(' sa03 8000 0000 6080-1016 7519 '), 'SA0380000000608010167519');
  assert.ok(validIban('SA0380000000608010167519'), 'the Saudi example IBAN');
  assert.ok(validIban('GB82WEST12345698765432'), 'a UK IBAN');
  assert.ok(validIban('AE070331234567890123456'), 'a UAE IBAN');
  assert.ok(!validIban('SA0380000000608010167518'), 'one wrong digit fails the check');
  assert.ok(!validIban('SA038000000060801016751'), 'a Saudi IBAN is SA + 22 digits');
  assert.ok(!validIban('SA03800000006080101675AB'), 'only digits after SA');
  assert.ok(!validIban('1234'), 'not an IBAN');
  assert.ok(!validIban(''), 'empty');
});
