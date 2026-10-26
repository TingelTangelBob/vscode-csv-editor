// Independent text extraction with PDF.js. Pass its module entry path if it is
// installed in another workspace; optionally pass a generated PDF to inspect.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createTablePdf } = require('../media/export.js');

(async () => {
  const parser = process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : 'pdfjs-dist/legacy/build/pdf.mjs';
  const { getDocument } = await import(parser);
  async function extract(bytes, verifyGlyphs = []) {
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
    try {
      const doc = await task.promise;
      const pages = [];
      for (let index = 1; index <= doc.numPages; index += 1) {
        const page = await doc.getPage(index);
        const content = await page.getTextContent();
        const glyphItems = content.items.filter((item) => verifyGlyphs.some((value) => item.str.includes(value)));
        if (glyphItems.length) {
          const { createCanvas } = require('@napi-rs/canvas');
          const viewport = page.getViewport({ scale: 2 });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const context = canvas.getContext('2d');
          await page.render({ canvasContext: context, viewport }).promise;
          for (const item of glyphItems) {
            const x = Math.floor(item.transform[4] * 2);
            const y = Math.floor(viewport.height - item.transform[5] * 2 - item.height * 2);
            const pixels = context.getImageData(x, y, Math.ceil(item.width * 2), Math.ceil(item.height * 2 + 4)).data;
            let painted = false;
            for (let index = 0; index < pixels.length; index += 4) {
              if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100) { painted = true; break; }
            }
            assert.ok(painted, `Text extracts but does not render: ${item.str}`);
          }
        }
        pages.push(content.items.map((item) => item.str).join(' '));
      }
      return { pages, metadata: await doc.getMetadata() };
    } finally { await task.destroy(); }
  }
  const samples = ['Änne Müller', 'München', 'Büro – 1.234,56 €', '東京', '日本', 'office affinity Straße', '한글', '한국', 'Привет мир', 'Crème brûlée', 'Paris', 'Καλημέρα'];
  const rows = Array.from({ length: 4 }, (_, index) => ({ cells: samples.slice(index * 3, index * 3 + 3) }));
  const bytes = await createTablePdf(['Name', 'City', 'Notes'], rows, 'Übersicht');
  const result = await extract(bytes, ['東京', '日本', '한글', '한국']);
  const text = result.pages.join('\n');
  for (const sample of samples) assert.ok(text.includes(sample), `Missing extracted text: ${sample}\n${text}`);
  assert.equal(result.metadata.info.PDFFormatVersion, '1.7');
  assert.ok(text.includes('Übersicht') && text.includes('Name'));
  if (process.env.CSV_EDITOR_PDF_SAMPLE) fs.writeFileSync(process.env.CSV_EDITOR_PDF_SAMPLE, bytes);
  const longText = Array.from({ length: 2000 }, (_, index) => `word${index}`).join(' ');
  const long = await extract(await createTablePdf(['Details'], [{ cells: [longText] }], 'Long cell'));
  assert.ok(long.pages.length > 1);
  for (let index = 0; index < 2000; index += 1) assert.ok(long.pages.join(' ').includes(`word${index}`));
  assert.ok(long.pages.every((page) => page.includes('Details')));
  if (process.argv[3]) {
    const wide = await extract(fs.readFileSync(process.argv[3]));
    const wideText = wide.pages.join(' ');
    const cells = new Set([...wideText.matchAll(/(?:^|\s)(\d+\/\d+)(?=\s|$)/g)].map((match) => match[1]));
    assert.ok(wide.pages.length > 3);
    for (let row = 0; row < 60; row += 1) {
      for (let column = 0; column < 24; column += 1) assert.ok(cells.has(`${row}/${column}`), `Missing cell ${row}/${column}`);
    }
    assert.ok(wideText.includes('東京') && wideText.includes('ÄÖÜ'));
    console.log(`Browser PDF: all 1,440 cells extractable across ${wide.pages.length} pages.`);
  }
  console.log('PDF 1.7 text extraction passed: accents, currency, ligatures, Cyrillic, Greek, CJK, Korean, headings and long-cell continuations.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
