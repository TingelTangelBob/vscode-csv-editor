'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { compareCsv } = require('../media/csv-diff');

test('aligns inserted and deleted rows around unchanged records', () => {
  const diff = compareCsv('id,name\n1,A\n2,B\n3,C', 'id,name\n0,Z\n1,A\n3,C');
  assert.deepEqual(diff.rows.map(row => row.type), ['insert', 'equal', 'delete', 'equal']);
  assert.equal(diff.rows[0].afterIndex, 0);
  assert.equal(diff.rows[2].beforeIndex, 1);
});

test('pairs replacement rows and reports cell changes', () => {
  const diff = compareCsv('A,B\nold,2', 'A,B\nnew,3');
  assert.equal(diff.rows[0].type, 'change');
  assert.deepEqual(diff.rows[0].cells.map(cell => cell.changed), [true, true]);
});

test('uses unique first-column keys to align changed rows across an insertion', () => {
  const diff = compareCsv(
    'id,name\n1,old one\n2,old two\n3,old three',
    'id,name\n1,new one\n9,inserted\n2,new two\n3,new three',
  );
  assert.deepEqual(diff.rows.map(row => row.type), ['change', 'insert', 'change', 'change']);
  assert.deepEqual(diff.rows.filter(row => row.type === 'change').map(row => [row.beforeIndex, row.afterIndex]), [[0, 0], [1, 2], [2, 3]]);
});

test('does not use duplicated or missing first-column keys as anchors', () => {
  const diff = compareCsv('id,value\n,old blank\nx,old x\nx,old duplicate', 'id,value\n,new blank\nx,new x\nx,new duplicate');
  assert.equal(diff.rows.length, 3);
  assert.ok(diff.rows.every(row => row.type === 'change'));
});

test('distinguishes missing fields from explicit empty fields in raw CSV', () => {
  const diff = compareCsv('A,B\n1', 'A,B\n1,');
  assert.equal(diff.rows[0].type, 'change');
  assert.deepEqual(diff.rows[0].cells[1].before, { present: false, value: null });
  assert.deepEqual(diff.rows[0].cells[1].after, { present: true, value: '' });
});

test('compares the project CSV as realistic A/B files with changed and missing fields', () => {
  const original = fs.readFileSync(path.join(__dirname, '../quarterly-sales.csv'), 'utf8');
  const originalRecord = 'Northwind Traders,Europe,Q1 2026,184500,Approved,Emma Wilson';
  assert.ok(original.includes(originalRecord), 'expected the Northwind sample record in quarterly-sales.csv');
  const modified = original.replace(originalRecord, 'Northwind Traders,Europe,Q1 2026,184500,Review');

  const diff = compareCsv(original, modified);
  const changedRecord = diff.rows[0];
  assert.equal(changedRecord.type, 'change');
  assert.deepEqual(changedRecord.cells.map(cell => cell.changed), [false, false, false, false, true, true]);
  assert.deepEqual(changedRecord.cells[5].before, { present: true, value: 'Emma Wilson' });
  assert.deepEqual(changedRecord.cells[5].after, { present: false, value: null });
});

test('preserves missing fields on object sheets and compares headers', () => {
  const diff = compareCsv(
    { headers: ['A'], rows: [{ cells: ['x'] }] },
    { headers: ['A', ''], rows: [{ cells: ['x', ''] }] },
  );
  assert.equal(diff.columns[1].before.present, false);
  assert.equal(diff.columns[1].after.present, true);
  assert.equal(diff.rows[0].type, 'change');
});

test('aligns columns by unique headers when a whole column is inserted', () => {
  const diff = compareCsv(
    'id,name\n1,Ada\n2,Lin',
    'id,extra,name\n1,x,Ada\n2,y,Lin',
  );
  assert.deepEqual(diff.columns.map(column => [column.beforeIndex, column.afterIndex]), [[0, 0], [null, 1], [1, 2]]);
  assert.deepEqual(diff.rows.map(row => row.type), ['change', 'change']);
  assert.deepEqual(diff.rows[0].cells.map(cell => cell.changed), [false, true, false]);
});

test('pairs renamed columns positionally between matched unique headers', () => {
  const diff = compareCsv(
    'id,old,value\n1,A,10',
    'id,new,value\n1,B,10',
  );
  assert.deepEqual(diff.columns.map(column => [column.beforeIndex, column.afterIndex]), [[0, 0], [1, 1], [2, 2]]);
  assert.deepEqual(diff.rows[0].cells.map(cell => cell.changed), [false, true, false]);
});

test('keeps reordered unique columns visible using a non-crossing header sequence', () => {
  const diff = compareCsv('A,B,C\na,b,c', 'C,A,B\nc,a,b');
  assert.deepEqual(diff.columns.map(column => [column.beforeIndex, column.afterIndex]), [
    [null, 0], [0, 1], [1, 2], [2, null],
  ]);
  assert.deepEqual(diff.rows[0].cells.map(cell => cell.changed), [true, false, false, true]);
});

test('does not use duplicate headers as column anchors', () => {
  const diff = compareCsv('id,x,x,value\n1,a,b,v', 'id,value,x,x\n1,v,a,b');
  assert.deepEqual(diff.columns.map(column => [column.beforeIndex, column.afterIndex]), [
    [0, 0], [1, null], [2, null], [3, 1], [null, 2], [null, 3],
  ]);
  assert.deepEqual(diff.rows[0].cells.map(cell => cell.changed), [false, true, true, false, true, true]);
});

test('parses quoted delimiters and embedded newlines before alignment', () => {
  const diff = compareCsv('A;B\n1;"x;y\nz"', 'A;B\n1;"x;y\nz"');
  assert.equal(diff.rows[0].type, 'equal');
});

test('uses the shared CSV parser for quotes inside unquoted fields', () => {
  const text = 'A,B\nab"cd,1\nx,y';
  const diff = compareCsv(text, text);
  assert.equal(diff.beforeRowCount, 2);
  assert.equal(diff.afterRowCount, 2);
  assert.deepEqual(diff.rows.map(row => row.cells.slice(0, 2).map(cell => cell.before.value)), [
    ['ab"cd', '1'], ['x', 'y'],
  ]);
});

test('keeps valid quoted values and missing fields distinct, including empty input', () => {
  const diff = compareCsv('A,B\n1,"a,""b"""\n2', 'A,B\n1,"a,""b"""\n2,');
  assert.equal(diff.rows.length, 2);
  assert.equal(diff.rows[0].cells[1].before.value, 'a,"b"');
  assert.deepEqual(diff.rows[1].cells[1].before, { present: false, value: null });
  assert.deepEqual(diff.rows[1].cells[1].after, { present: true, value: '' });
  assert.equal(compareCsv('', '').rows.length, 0);
});

