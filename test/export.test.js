'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createTablePdf, wrapText } = require('../media/export');
const { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } = require('../media/pdf/pdf-lib.min.js');

test('bundled PDF resource checksums match the downloaded source manifest', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const directory = path.join(__dirname, '../media/pdf');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'sources.json'), 'utf8'));
  for (const [filename, source] of Object.entries(manifest)) {
    const font = filename.endsWith('.ttf');
    const stored = fs.readFileSync(path.join(directory, font ? `${filename}.gz` : filename));
    const bytes = font ? require('node:zlib').gunzipSync(stored) : stored;
    assert.equal(bytes.length, source.bytes, filename);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), source.sha256, filename);
  }
});

test('PDF 1.7 contains real text with embedded Unicode fonts and no page images', async () => {
  const bytes = await createTablePdf(['Name', 'City'], [{ cells: ['Änne office', 'München 東京 한글'] }], 'Überblick');
  assert.ok(Buffer.from(bytes).toString('ascii').startsWith('%PDF-1.7'));
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getTitle(), 'Überblick');
  assert.equal(pdf.getPageCount(), 1);
  const page = pdf.getPage(0);
  assert.equal(page.getWidth(), 595.28);
  const fonts = page.node.Resources().lookup(PDFName.of('Font'), PDFDict);
  assert.ok(fonts.keys().length >= 2);
  const streams = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter((object) => object instanceof PDFRawStream);
  const decoded = streams.filter((stream) => stream.dict.get(PDFName.of('Filter'))?.toString() === '/FlateDecode')
    .map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1'));
  assert.ok(decoded.some((text) => text.includes('BT\n') && text.includes(' Tj')));
  assert.ok(decoded.some((text) => text.includes('beginbfchar') && text.includes('00C4')));
  assert.ok(decoded.some((text) => text.includes('beginbfchar') && text.includes('6771')));
  fonts.values().forEach((reference) => assert.ok(pdf.context.lookup(reference, PDFDict).has(PDFName.of('ToUnicode'))));
  assert.ok(!streams.some((stream) => stream.dict.get(PDFName.of('Subtype'))?.toString() === '/Image'));
  const latin = await createTablePdf(['Name'], [{ cells: ['Änne office'] }], 'Überblick');
  assert.ok(latin.length < 100000, 'Latin-only exports should embed only used glyphs.');
});

test('PDF pagination retains empty filtered views, wide tables, and very long cells', async () => {
  const empty = await PDFDocument.load(await createTablePdf(['Name', 'City'], [], 'Empty'));
  assert.equal(empty.getPageCount(), 1);
  const headers = Array.from({ length: 24 }, (_, index) => `Column ${index}`);
  const bytes = await createTablePdf(headers, [{ cells: headers.map(() => 'Long text '.repeat(250)) }], 'Wide table');
  const wide = await PDFDocument.load(bytes);
  assert.ok(wide.getPageCount() > 3);
  assert.ok(wide.getPage(0).getWidth() > wide.getPage(0).getHeight());
});

test('unsupported glyphs cause a clear error rather than silently dropping data', async () => {
  await assert.rejects(createTablePdf(['Value'], [{ cells: ['\u{10FFFF}'] }], 'Test'), /U\+10FFFF/);
});

test('PDF wrapping preserves multiline values and splits long words without overflow', () => {
  const context = { measureText: (text) => ({ width: Array.from(text).length }) };
  assert.deepEqual(wrapText(context, 'Alpha Beta', 6), ['Alpha', 'Beta']);
  assert.deepEqual(wrapText(context, '123456789', 4), ['1234', '5678', '9']);
  assert.deepEqual(wrapText(context, 'A\r\n\r\nB', 4), ['A', '', 'B']);
  assert.deepEqual(wrapText(context, '😀東京東京', 2), ['😀東', '京東', '京']);
  assert.deepEqual(wrapText(context, '', 4), ['']);
});
