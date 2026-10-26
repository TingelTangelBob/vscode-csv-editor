'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEmptySheet, parseCsv, escapeCell, serializeCsv } = require('../media/csv');

function values(sheet) {
  return [sheet.headers, ...sheet.rows.map((row) => row.cells)];
}

for (const delimiter of [',', ';', '\t', '|']) {
  test(`detects and round-trips delimiter ${JSON.stringify(delimiter)}`, () => {
    const text = ['Name', 'Amount'].join(delimiter) + '\n' + ['Alice', '42'].join(delimiter) + '\n';
    const sheet = parseCsv(text);
    assert.equal(sheet.delimiter, delimiter);
    assert.equal(serializeCsv(sheet), text);
  });
}

test('preserves BOM, CRLF, trailing newline, and embedded quotes', () => {
  const text = '\ufeffName;Note\r\nAlice;"Says ""hello"""\r\n';
  assert.equal(serializeCsv(parseCsv(text)), text);
});

test('ignores quoted delimiters and handles multiline values', () => {
  const text = 'Name;Note\nAlice;"one,two,three\nfour,five,six"';
  const sheet = parseCsv(text);
  assert.equal(sheet.delimiter, ';');
  assert.equal(sheet.rows[0].cells[1], 'one,two,three\nfour,five,six');
  assert.equal(serializeCsv(sheet), text);
});

test('detects consistent semicolon columns despite comma-heavy values and blank lines', () => {
  const headers = Array.from({ length: 22 }, (_, index) => `Column ${index}`);
  const rows = Array.from({ length: 30 }, (_, row) => {
    const cells = headers.map((_, column) => `${row}/${column}`);
    cells[5] = Array.from({ length: 20 + row * 17 }, (_, index) => `item${index}`).join(',');
    cells[9] = Array.from({ length: row % 5 }, () => 'a|b').join(',');
    return cells;
  });
  const text = headers.join(';') + '\r\n' + rows.map(row => row.join(';')).join('\r\n\r\n') + '\r\n';
  const parsed = parseCsv(text);
  assert.equal(parsed.delimiter, ';');
  assert.deepEqual(parsed.headers, headers);
  assert.equal(parsed.rows.length, 59);
  assert.deepEqual(parsed.rows[0].cells, rows[0]);
  assert.deepEqual(parsed.rows.at(-1).cells, rows.at(-1));
  assert.ok(parsed.rows.every(row => row.cells.length === 22));
});

test('uses record line endings instead of line breaks inside quoted cells', () => {
  const text = 'Name,Note\nAlice,"first\r\nsecond"\nBob,last\n';
  const sheet = parseCsv(text);
  assert.equal(sheet.lineEnding, '\n');
  assert.equal(serializeCsv(sheet), text);
});

test('retains a final quoted empty record without a trailing newline', () => {
  const sheet = parseCsv('Name\n""');
  assert.deepEqual(values(sheet), [['Name'], ['']]);
  assert.equal(serializeCsv(sheet), 'Name\n""');
});

test('retains newly added empty single-column rows after reopening', () => {
  const sheet = parseCsv('Name\nAlice');
  sheet.rows.push({ id: 2, cells: [''] });
  assert.deepEqual(values(parseCsv(serializeCsv(sheet))), [['Name'], ['Alice'], ['']]);
});

test('preserves empty rows and trailing empty fields', () => {
  const text = 'A,B\n1,\n,\n';
  assert.deepEqual(values(parseCsv(serializeCsv(parseCsv(text)))) , [['A', 'B'], ['1', ''], ['', '']]);
});

test('pads short rows without discarding extra columns', () => {
  const sheet = parseCsv('A,B\n1\n2,3,4');
  assert.deepEqual(values(sheet), [['A', 'B', ''], ['1', '', ''], ['2', '3', '4']]);
});

test('uses a TSV fallback for single-column documents', () => {
  const sheet = parseCsv('Name\nAlice', '\t');
  sheet.headers.push('Amount');
  sheet.rows[0].cells.push('42');
  assert.equal(serializeCsv(sheet), 'Name\tAmount\nAlice\t42');
});

test('handles an empty document and an explicitly empty header', () => {
  assert.deepEqual(parseCsv(''), createEmptySheet());
  assert.deepEqual(values(parseCsv('""')), [['']]);
  assert.equal(serializeCsv(parseCsv('""')), '""');
});

test('quotes whitespace, delimiters, newlines and double quotes', () => {
  assert.equal(escapeCell(' a ', ','), '" a "');
  assert.equal(escapeCell('a,b', ','), '"a,b"');
  assert.equal(escapeCell('a\nb', ','), '"a\nb"');
  assert.equal(escapeCell('a"b', ','), '"a""b"');
  assert.equal(escapeCell('42', ','), '42');
});

test('serializes original row order independently of a sorted display', () => {
  const sheet = parseCsv('Name\nZoe\nAlice');
  const display = [...sheet.rows].sort((a, b) => a.cells[0].localeCompare(b.cells[0]));
  assert.equal(display[0].cells[0], 'Alice');
  assert.equal(serializeCsv(sheet), 'Name\nZoe\nAlice');
});
