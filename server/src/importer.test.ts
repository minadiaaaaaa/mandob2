import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSheet } from './importer.js';

// Arabic text in a CSV import must arrive intact whatever Excel saved it as.
test('CSV files are read as UTF-8, with or without a BOM, or as Windows-1256', () => {
  const utf8 = Buffer.from('Branch,Name\nجدة,علي\n', 'utf8');
  assert.deepEqual(readSheet(utf8).rows, [{ Branch: 'جدة', Name: 'علي' }]);
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8]);
  assert.deepEqual(readSheet(bom).headers, ['Branch', 'Name']);
  // "جدة" in Windows-1256 (Excel's plain CSV on an Arabic Windows)
  const cp1256 = Buffer.concat([Buffer.from('Branch\n'), Buffer.from([0xcc, 0xcf, 0xc9]), Buffer.from('\n')]);
  assert.deepEqual(readSheet(cp1256).rows, [{ Branch: 'جدة' }]);
});
