'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseCsv, isColumnFilterActive, filterRows, getColumnFilterValues, parseDateTime, isValidDateRange, captureFileView, restoreFileView } = require('../media/csv');

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

test('strict date parsing validates formats, leap years and clock fields', () => {
  assert.equal(parseDateTime('2024-02-29'), Date.UTC(2024, 1, 29));
  assert.equal(parseDateTime('2023-02-29'), null);
  assert.equal(parseDateTime('29.02.2024'), Date.UTC(2024, 1, 29));
  assert.equal(parseDateTime('29.02.2023'), null);
  assert.equal(parseDateTime('13/02/2024'), null);
  assert.equal(parseDateTime('13/02/2024', 'slash-dmy'), Date.UTC(2024, 1, 13));
  assert.equal(parseDateTime('02/13/2024', 'slash-mdy'), Date.UTC(2024, 1, 13));
  assert.equal(parseDateTime('2024-01-01T25:00'), null);
  assert.equal(parseDateTime('2024-01-01T12:00+99:00'), null);
});

test('ISO timezone offsets normalize to UTC', () => {
  assert.equal(parseDateTime('2024-03-01T01:30:00+02:00'), Date.UTC(2024, 1, 29, 23, 30));
  assert.equal(parseDateTime('2024-02-29T23:30:00Z'), Date.UTC(2024, 1, 29, 23, 30));
});

test('date range filters include both selected calendar days and exclude invalid cells', () => {
  const data = [{id:1,cells:['2024-03-01T00:00:00Z']},{id:2,cells:['2024-03-02T23:59:59Z']},{id:3,cells:['2024-03-03T00:00:00Z']},{id:4,cells:['bad']}];
  const f = [{dateRange:{format:'iso',min:'2024-03-01',max:'2024-03-02'}}];
  assert.deepEqual(filterRows(data,f).map(x=>x.id),[1,2]);
  assert.equal(isValidDateRange({format:'iso',min:'2024-03-03',max:'2024-03-02'}),false);
  assert.equal(isColumnFilterActive(f[0]),true);
});

test('date range survives view capture and restore', () => {
  const saved = captureFileView(['Date'],[120],[{query:'',values:null,dateRange:{format:'de',min:'2024-02-01',max:null}}],null);
  const restored = restoreFileView(saved,['Date']);
  assert.deepEqual(restored.filters[0].dateRange,{format:'de',min:'2024-02-01',max:null});
});
test('date range boundaries are strict ISO dates regardless of cell format', () => {
  const data = [{id:1,cells:['01.03.2024 23:59']},{id:2,cells:['02.03.2024 00:00']},{id:3,cells:['bad']}];
  const f=[{dateRange:{format:'de',min:'2024-03-01',max:'2024-03-01'}}];
  assert.deepEqual(filterRows(data,f).map(row=>row.id),[1]);
  assert.equal(isValidDateRange({format:'de',min:'01.03.2024'}),false);
});

test('dates 0001 through 0099 retain their actual UTC year', () => {
  assert.equal(new Date(parseDateTime('0001-01-01','iso')).getUTCFullYear(),1);
  assert.equal(new Date(parseDateTime('0099-12-31','iso')).getUTCFullYear(),99);
});

test('German and explicit slash formats accept times', () => {
  assert.equal(parseDateTime('29.02.2024 12:30','de'),Date.UTC(2024,1,29,12,30));
  assert.equal(parseDateTime('02/29/2024T12:30','slash-mdy'),Date.UTC(2024,1,29,12,30));
});
test('time zones apply equally to German and slash formats', () => {
  assert.equal(parseDateTime('03.04.2025 01:00+02:00', 'de'), parseDateTime('2025-04-02T23:00Z', 'iso'));
  assert.equal(parseDateTime('03/04/2025 01:00+02:00', 'slash-dmy'), parseDateTime('2025-04-02T23:00Z', 'iso'));
  assert.equal(parseDateTime('03.04.2025 01:00+15:00', 'de'), null);
});
