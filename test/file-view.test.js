'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { captureFileView, restoreFileView, normalizeFileView, filterRows } = require('../media/csv');

test('restores widths, filters and sort by unambiguous column name after reordering', () => {
  const view = captureFileView(['Name', 'City', 'Age'], [140, null, 80],
    [{ query: 'ann', values: new Set(['Anna', 'Anne']) }, null, { query: '', values: new Set() }],
    { column: 1, direction: -1 });
  const restored = restoreFileView(JSON.parse(JSON.stringify(view)), ['Age', 'Name', 'New', 'City']);
  assert.deepEqual(restored.widths, [80, 140, null, null]);
  assert.deepEqual(restored.sort, { column: 3, direction: -1 });
  assert.deepEqual([...restored.filters[1].values], ['Anna', 'Anne']);
  assert.equal(restored.filters[1].query, 'ann');
  assert.equal(restored.filters[0].values.size, 0);
  assert.equal(filterRows([{ cells: ['20', 'Anna', '', 'Bonn'] }], restored.filters).length, 0);
});

test('ignores missing, renamed and ambiguous duplicate columns and invalid stored values', () => {
  const view = captureFileView(['A', 'B', 'B'], [100, 120, 130], [null, null, null], { column: 1, direction: 1 });
  assert.deepEqual(restoreFileView(view, ['B', 'A', 'B', 'C']), {
    widths: [null, 100, null, null], filters: [null, null, null, null], sort: null,
  });
  assert.deepEqual(restoreFileView(view, ['Renamed', 'C']), { widths: [null, null], filters: [null, null], sort: null });
  assert.equal(normalizeFileView({ version: 2, columns: [] }), null);
  assert.equal(normalizeFileView({ version: 1, columns: [{ name: 'A', width: -3 }] }).columns[0].width, null);
});
