'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseCsv, isColumnFilterActive, filterRows, getColumnFilterValues } = require('../media/csv');

const rows = parseCsv('Stock,Discontinued,Location\n10,Yes,A\n0,No,A\n10,Yes,B\n2,,B\n0,No,B\n1,Yesterday,C').rows;

test('unfiltered views reuse the original row array and whitespace queries remain inactive', () => {
  assert.equal(filterRows(rows, [null, { query: '  ', values: null }]), rows);
  assert.equal(isColumnFilterActive(null), false);
  assert.equal(isColumnFilterActive({ query: '  ', values: null }), false);
  assert.equal(isColumnFilterActive({ query: '', values: new Set() }), true);
});

test('checkbox selections match exact values and combine across columns', () => {
  const filters = [{ values: new Set(['0', '10']) }, { values: new Set(['Yes']) }];
  assert.deepEqual(filterRows(rows, filters).map(r => r.id), [1, 3]);
  assert.deepEqual(filterRows(rows, [null, { values: new Set(['Yes']) }]).map(r => r.id), [1, 3]);
  assert.equal(filterRows(rows, [{ values: new Set() }]).length, 0);
});

test('blank values are selectable and distinct from whitespace or missing text', () => {
  const values = [{ id: 1, cells: [''] }, { id: 2, cells: [' '] }, { id: 3, cells: [] }];
  assert.deepEqual(filterRows(values, [{ values: new Set(['']) }]).map(r => r.id), [1, 3]);
  assert.deepEqual(getColumnFilterValues(values, [], 0), [{ value: '', count: 2 }, { value: ' ', count: 1 }]);
});

test('search is case insensitive, trims the query and intersects the checkbox selection', () => {
  assert.deepEqual(filterRows(rows, [null, { query: ' YES ' }]).map(r => r.id), [1, 3, 6]);
  assert.deepEqual(filterRows(rows, [null, { query: 'YES', values: new Set(['Yes']) }]).map(r => r.id), [1, 3]);
  assert.equal(filterRows(rows, [null, { query: 'not present' }]).length, 0);
});

test('value lists deduplicate and count values, ignoring only their own active filter', () => {
  const filters = [null, { values: new Set(['No']) }, { values: new Set(['B']) }];
  assert.deepEqual(getColumnFilterValues(rows, filters, 1), [
    { value: 'Yes', count: 1 }, { value: '', count: 1 }, { value: 'No', count: 1 },
  ]);
  assert.deepEqual(getColumnFilterValues(rows, filters, 0), [{ value: '0', count: 1 }]);
  assert.deepEqual(getColumnFilterValues(rows, [{ values: new Set() }], 1), []);
});

test('filtering preserves original rows, identifiers and exact value case', () => {
  const data = [{ id: 4, cells: ['A'] }, { id: 8, cells: ['a'] }];
  const filtered = filterRows(data, [{ values: new Set(['a']) }]);
  assert.equal(filtered[0], data[1]);
  assert.deepEqual(data.map(r => r.id), [4, 8]);
  assert.deepEqual(getColumnFilterValues(data, [], 0), [{ value: 'A', count: 1 }, { value: 'a', count: 1 }]);
});
