'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEmptySheet, parseCsv, planCsvImport, serializeCsv } = require('../media/csv');

test('imports detected delimiters, BOM, quoted multiline fields and escaped quotes', () => {
  for (const delimiter of [',', ';', '\t', '|']) {
    const text = `\ufeffName${delimiter}Note\r\nAlice${delimiter}"Line 1\nSays ""hello"""\r\n`;
    const plan = planCsvImport(createEmptySheet(), text);
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.delimiter, delimiter);
    assert.deepEqual(plan.rows[0].cells, ['Alice', 'Line 1\nSays "hello"']);
    assert.equal(plan.lineEnding, '\r\n');
    assert.equal(plan.tabular, true);
  }
});

test('maps reordered headers by name and preserves target format without mutation', () => {
  const target = parseCsv('\ufeffName;Age\r\nAlice;42\r\n');
  const original = serializeCsv(target);
  const plan = planCsvImport(target, ' age , NAME \n30,Bob', { mode: 'append' });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.warnings[0].code, 'Columns reordered by name');
  assert.deepEqual(plan.rows.map(r => r.cells), [['Alice', '42'], ['Bob', '30']]);
  assert.equal(serializeCsv(plan), '\ufeffName;Age\r\nAlice;42\r\nBob;30\r\n');
  assert.equal(serializeCsv(target), original);
  assert.deepEqual(plan.rows.map(r => r.id), [1, 2]);
});

test('reports missing and unknown names even with matching column counts', () => {
  const plan = planCsvImport(parseCsv('Name,Age\nAlice,42'), 'Name,City\nBob,Berlin', { mode: 'append' });
  assert(plan.errors.some(e => e.code === 'Missing columns' && e.detail === 'Age'));
  assert(plan.errors.some(e => e.code === 'Unknown columns' && e.detail === 'City'));
});

test('rejects duplicate or empty source names and ambiguous target names', () => {
  assert(planCsvImport(createEmptySheet(), 'Name, name \nA,B').errors.some(e => e.code === 'Duplicate column names'));
  assert(planCsvImport(createEmptySheet(), 'Name,\nA,B').errors.some(e => e.code === 'Empty column names'));
  assert(planCsvImport(parseCsv('Name,NAME\nA,B'), 'Name,Age\nC,D', { mode: 'append' }).errors.some(e => e.code === 'Ambiguous target column names'));
});

test('reports short and long records before the normal CSV parser can pad them', () => {
  const plan = planCsvImport(createEmptySheet(), 'A,B\n1\n2,3,4');
  assert.deepEqual(plan.errors.filter(e => e.code === 'Wrong number of columns').map(e => [e.record, e.detail]), [[2, '1 / 2'], [3, '3 / 2']]);
});

test('blocks malformed quoted fields but accepts valid escaped and multiline fields', () => {
  for (const text of ['A,B\n1,"unterminated', 'A,B\n1,"closed"oops', 'A,B\n1,un"quoted']) {
    assert(planCsvImport(createEmptySheet(), text).errors.length > 0, text);
  }
  assert.deepEqual(planCsvImport(createEmptySheet(), 'A,B\n1,""\n2,"""quoted"""').errors, []);
});

test('imports without headers by position and generates names on replacement', () => {
  const target = parseCsv('Name,Age\nAlice,42');
  const plan = planCsvImport(target, 'Bob\t30\nClaire\t31', { mode: 'append', hasHeader: false });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.rows.map(r => r.cells), [['Alice', '42'], ['Bob', '30'], ['Claire', '31']]);
  assert(plan.warnings.some(e => e.code === 'Columns matched by position'));
  const replaced = planCsvImport(target, 'Bob,30', { hasHeader: false });
  assert.deepEqual(replaced.headers, ['Column 1', 'Column 2']);
  assert.equal(replaced.rows.length, 1);
  assert(planCsvImport(target, 'Bob', { mode: 'append', hasHeader: false }).errors.some(e => e.code === 'Wrong number of columns'));
});

test('deduplicates complete rows across existing and incoming data only when selected', () => {
  const target = parseCsv('Name,Age\nAlice,42\nAlice,42');
  const text = 'Age,Name\n42,Alice\n30,Bob\n30,Bob\n31,Bob';
  const keep = planCsvImport(target, text, { mode: 'append' });
  assert.equal(keep.rows.length, 6);
  assert.equal(keep.duplicates, 3);
  const deduped = planCsvImport(target, text, { mode: 'append', dedupe: true });
  assert.deepEqual(deduped.rows.map(r => r.cells), [['Alice', '42'], ['Bob', '30'], ['Bob', '31']]);
  assert.equal(deduped.duplicates, 3);
});

test('keeps exact distinctions in duplicate keys, including separators and whitespace', () => {
  const plan = planCsvImport(createEmptySheet(), 'A,B\n"a,b",c\na,"b,c"\n a,b\na,b', { dedupe: true });
  assert.equal(plan.rows.length, 4);
  assert.equal(plan.duplicates, 0);
});

test('skips empty records before header detection and allows retaining explicit empty rows', () => {
  const text = '\nA,B\n1,2\n,\n';
  const plan = planCsvImport(createEmptySheet(), text);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.skipped, 2);
  assert.deepEqual(plan.headers, ['A', 'B']);
  assert.equal(plan.rows.length, 1);
  const keep = planCsvImport(createEmptySheet(), 'A,B\n,\n', { skipEmpty: false });
  assert.deepEqual(keep.errors, []);
  assert.deepEqual(keep.rows[0].cells, ['', '']);
});

test('respects a manually selected delimiter and rejects empty clipboard content', () => {
  const plan = planCsvImport(createEmptySheet(), 'A;B\n1,2;3,4', { delimiter: ';' });
  assert.equal(plan.delimiter, ';');
  assert.deepEqual(plan.rows[0].cells, ['1,2', '3,4']);
  assert(planCsvImport(createEmptySheet(), ' \n\n').errors.some(e => e.code === 'No data to import'));
  assert.equal(planCsvImport(createEmptySheet(), 'a single phrase').tabular, false);
});
