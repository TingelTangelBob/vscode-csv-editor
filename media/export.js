'use strict';

// Vector PDF 1.7 with embedded fonts and Unicode text mappings.
// Libraries and fonts are bundled and loaded only when exporting a PDF.
(function () {
  const exportScript = typeof document === 'undefined' ? null : document.currentScript;
  const resourceBase = exportScript?.src ? new URL('pdf/', exportScript.src).href : null;
  const nonce = exportScript?.nonce;
  let resourcesPromise = null;
  let fallbackPromise = null;

  function loadScript(filename, globalName) {
    if (globalThis[globalName]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(filename, resourceBase).href;
      if (nonce) script.nonce = nonce;
      script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error(`Could not load bundled PDF resource: ${filename}`)); };
      document.head.append(script);
    });
  }

  async function loadFont(filename) {
    if (typeof document === 'undefined') {
      const bytes = await require('node:fs').promises.readFile(require('node:path').join(__dirname, 'pdf', `${filename}.gz`));
      return require('node:zlib').gunzipSync(bytes);
    }
    const response = await fetch(new URL(`${filename}.gz`, resourceBase));
    if (!response.ok) throw new Error(`Could not load bundled PDF font: ${filename}`);
    const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function loadResources() {
    if (!resourcesPromise) {
      resourcesPromise = (async () => {
        if (typeof document === 'undefined') return {
          PDFLib: require('./pdf/pdf-lib.min.js'), fontkit: require('./pdf/fontkit.umd.min.js'),
          fontBytes: await loadFont('NotoSans-Regular.ttf'),
        };
        if (!resourceBase) throw new Error('The bundled PDF resource location is missing.');
        const [, , fontBytes] = await Promise.all([
          loadScript('pdf-lib.min.js', 'PDFLib'), loadScript('fontkit.umd.min.js', 'fontkit'), loadFont('NotoSans-Regular.ttf'),
        ]);
        return { PDFLib: globalThis.PDFLib, fontkit: globalThis.fontkit, fontBytes };
      })().catch((error) => { resourcesPromise = null; throw error; });
    }
    return resourcesPromise;
  }

  // Tabs and control characters have no printable glyphs. Preserve line breaks
  // for layout and expand tabs consistently before measuring or drawing text.
  const printable = (value) => String(value ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  function wrapText(context, value, width) {
    const result = [];
    for (const paragraph of printable(value).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/(\s+)/)) {
        if (context.measureText(line + word).width <= width) { line += word; continue; }
        if (line.trim()) { result.push(line.trimEnd()); line = ''; }
        for (const character of word.trimStart()) {
          if (line && context.measureText(line + character).width > width) { result.push(line); line = ''; }
          line += character;
        }
      }
      result.push(line.trimEnd());
    }
    return result;
  }

  async function createTablePdf(headers, rows, title) {
    if (!headers.length) throw new Error('A PDF table needs at least one column.');
    const { PDFLib, fontkit, fontBytes } = await loadResources();
    const pdf = await PDFLib.PDFDocument.create();
    pdf.registerFontkit(fontkit);
    pdf.setTitle(String(title ?? 'CSV'));
    pdf.setSubject('Filtered CSV table');
    pdf.setCreator('CSV Simple Editor');
    pdf.setProducer('CSV Simple Editor / pdf-lib');
    const fontOptions = { subset: true, features: { liga: false, clig: false } };
    const primary = await pdf.embedFont(fontBytes, fontOptions);
    const supported = new Set(primary.getCharacterSet());
    const missing = new Set();
    function inspect(value) {
      for (const character of printable(value)) {
        const code = character.codePointAt(0);
        if (character !== '\n' && !supported.has(code)) missing.add(code);
      }
    }
    inspect(title);
    headers.forEach(inspect);
    rows.forEach((row) => headers.forEach((_, column) => inspect(row.cells[column])));
    let fallback = null;
    if (missing.size) {
      if (!fallbackPromise) fallbackPromise = loadFont('DroidSansFallback.ttf').catch((error) => { fallbackPromise = null; throw error; });
      // This font's subset loses CJK/Korean outlines in some PDF readers even
      // though text extraction works. Embed it intact to preserve visible glyphs.
      fallback = await pdf.embedFont(await fallbackPromise, { ...fontOptions, subset: false });
      const fallbackSupported = new Set(fallback.getCharacterSet());
      const unsupported = [...missing].filter((code) => !fallbackSupported.has(code));
      if (unsupported.length) {
        const codes = unsupported.slice(0, 5).map((code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`).join(', ');
        throw new Error(`The embedded PDF fonts do not contain these characters: ${codes}.`);
      }
    }
    function runs(text) {
      const result = [];
      for (const character of text) {
        const font = supported.has(character.codePointAt(0)) ? primary : fallback;
        const last = result[result.length - 1];
        if (last?.font === font) last.text += character;
        else result.push({ text: character, font });
      }
      return result;
    }
    const measure = (text, size) => runs(text).reduce((total, run) => total + run.font.widthOfTextAtSize(run.text, size), 0);
    const measurements = new Map();
    const fontSize = 9;
    const context = { measureText(text) {
      if (measurements.has(text)) return { width: measurements.get(text) };
      const width = measure(text, fontSize);
      if (measurements.size < 4096) measurements.set(text, width);
      return { width };
    } };
    const lineHeight = 12;
    const margin = 28;
    const padding = 5;
    const natural = headers.map((name) => printable(name).split('\n').reduce((size, line) =>
      Math.max(size, Math.min(250, context.measureText(line).width + padding * 2)), 42));
    for (const row of rows) {
      headers.forEach((_, column) => {
        for (const line of printable(row.cells[column]).split('\n')) {
          natural[column] = Math.max(natural[column], Math.min(250, context.measureText(line).width + padding * 2));
        }
      });
    }
    const landscape = natural.reduce((sum, width) => sum + width, 0) > 595.28 - margin * 2;
    const width = landscape ? 841.89 : 595.28;
    const height = landscape ? 595.28 : 841.89;
    const available = width - margin * 2;
    const maxColumns = Math.floor(available / 42);
    const ink = PDFLib.rgb(0.09, 0.125, 0.165);
    let page;
    let y;
    function text(value, x, baseline, size = fontSize, color = ink) {
      for (const run of runs(value)) {
        if (run.text) page.drawText(run.text, { x, y: height - baseline, size, font: run.font, color });
        x += run.font.widthOfTextAtSize(run.text, size);
      }
    }
    const finishPage = async () => {
      text(String(pdf.getPageCount()), width - margin - 12, height - 15, 8, PDFLib.rgb(0.4, 0.4, 0.4));
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    for (let first = 0; first < headers.length; first += maxColumns) {
      const last = Math.min(headers.length, first + maxColumns);
      const desired = natural.slice(first, last);
      const sum = desired.reduce((total, size) => total + size, 0);
      const extra = desired.reduce((total, size) => total + size - 42, 0);
      const widths = sum <= available ? desired.map((size) => size + (available - sum) / desired.length)
        : desired.map((size) => 42 + (size - 42) * (available - desired.length * 42) / extra);
      const headerLines = headers.slice(first, last).map((name, index) => {
        const lines = wrapText(context, name, widths[index] - padding * 2);
        return lines.length <= 8 ? lines : [...lines.slice(0, 7), '…'];
      });
      const drawRow = (lines, start, count, header = false) => {
        const rowHeight = count * lineHeight + padding * 2;
        let x = margin;
        widths.forEach((size, index) => {
          page.drawRectangle({ x, y: height - y - rowHeight, width: size, height: rowHeight,
            color: header ? PDFLib.rgb(0.93, 0.94, 0.96) : PDFLib.rgb(1, 1, 1),
            borderColor: PDFLib.rgb(0.78, 0.8, 0.83), borderWidth: 0.5 });
          for (let line = 0; line < count; line += 1) text(lines[index][start + line] ?? '', x + padding, y + padding + fontSize + line * lineHeight);
          x += size;
        });
        y += rowHeight;
      };
      const newPage = () => {
        page = pdf.addPage([width, height]);
        const titleContext = { measureText: (value) => ({ width: measure(value, 12) }) };
        text(wrapText(titleContext, title, available)[0], margin, margin + 12, 12);
        y = margin + 28;
        if (headers.length > maxColumns) {
          text(`${first + 1}–${last} / ${headers.length}`, margin, y, 8);
          y += 14;
        }
        drawRow(headerLines, 0, Math.max(1, ...headerLines.map((lines) => lines.length)), true);
      };
      newPage();
      for (const row of rows) {
        const lines = widths.map((size, index) => wrapText(context, row.cells[first + index], size - padding * 2));
        const lineCount = Math.max(1, ...lines.map((value) => value.length));
        let start = 0;
        while (start < lineCount) {
          let room = Math.floor((height - margin - y - padding * 2) / lineHeight);
          if (room < 1 || (start === 0 && lineCount <= 15 && room < lineCount)) {
            await finishPage(); newPage();
            room = Math.floor((height - margin - y - padding * 2) / lineHeight);
          }
          const count = Math.min(room, lineCount - start);
          drawRow(lines, start, count);
          start += count;
        }
      }
      await finishPage();
    }
    return pdf.save({ useObjectStreams: true, objectsPerTick: 50, addDefaultPage: false });
  }

  const api = { createTablePdf, wrapText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.CsvExport = api;
})();
