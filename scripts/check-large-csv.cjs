// Exercise a 22-column webview fixture or an optional local CSV of the same shape.
// File contents are never logged. CSV_EDITOR_ROOT can point to an extracted VSIX.
const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.CSV_EDITOR_ROOT || path.resolve(__dirname, '..');
const origin = 'http://csv-editor.local';
const text = process.argv[3] ? fs.readFileSync(process.argv[3], 'utf8') :
  Array.from({ length: 17001 }, (_, row) => Array.from({ length: 22 }, (_, column) =>
    row ? (column === 5 ? `path/${row}/` + 'long-directory,'.repeat(row % 23) : `${row}/${column}`) : `Column ${column}`).join(';')).join('\n');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1240, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('crash', () => errors.push('Webview crashed'));
    await page.route(`${origin}/**`, async route => {
      const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
      if (!/^[\w.-]+$/.test(name)) return route.abort();
      if (name !== 'index.html') return route.fulfill({ path: path.join(root, 'media', name) });
      const html = fs.readFileSync(path.join(root, 'media/index.html'), 'utf8')
        .replaceAll('{{CSP_SOURCE}}', origin).replaceAll('{{NONCE}}', 'benchmark')
        .replaceAll('{{VERSION}}', 'test')
        .replaceAll('{{CODICON_STYLESHEET_URI}}', `${origin}/codicon.css`)
        .replaceAll('{{STYLESHEET_URI}}', `${origin}/editor.css`)
        .replaceAll('{{CSV_SCRIPT_URI}}', `${origin}/csv.js`)
        .replaceAll('{{EXPORT_SCRIPT_URI}}', `${origin}/export.js`)
        .replaceAll('{{SCRIPT_URI}}', `${origin}/editor.js`);
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.addInitScript(() => {
      window.acquireVsCodeApi = () => ({ getState: () => ({}), setState() {}, postMessage() {} });
      window.longTasks = [];
      new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)))
        .observe({ type: 'longtask', buffered: true });
    });
    await page.goto(origin);
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.evaluate(text => {
      window.timings = {};
      for (const name of ['recalculateColumnWidths', 'renderTable']) {
        const original = window[name];
        window[name] = (...args) => {
          const started = performance.now();
          try { return original(...args); }
          finally { timings[name] = (timings[name] || 0) + performance.now() - started; }
        };
      }
      window.loadStarted = performance.now();
      setDocument(text, 'large.csv');
    }, text);
    await page.waitForFunction(() => documentLoaded && !isLoadingDocument && sheet.rows.length > 0, { timeout: 30000 });
    const metrics = await page.evaluate(() => ({
      loadMs: Math.round(performance.now() - loadStarted), ...timings,
      rows: sheet.rows.length, columns: sheet.headers.length,
      delimiter: sheet.delimiter, workerUsed: csvWorker !== null,
      tableWidth: elements.table.offsetWidth, maxColumnWidth: Math.max(...displayColumnWidths),
      renderedCells: document.querySelectorAll('.data-cell').length,
      longestTaskMs: Math.max(0, ...longTasks),
    }));
    console.log(JSON.stringify(metrics, null, 2));
    assert.equal(metrics.columns, 22);
    assert.equal(metrics.delimiter, ';');
    assert.equal(metrics.workerUsed, true, 'Large CSVs must parse in a functioning worker, without blocking fallback.');
    assert.ok(metrics.renderedCells < 2000, 'Only viewport rows should be rendered.');
    assert.deepEqual(errors, []);
    const bottom = await page.evaluate(() => {
      elements.tableScroll.scrollTop = elements.tableScroll.scrollHeight;
      return sheet.rows.at(-1).id;
    });
    await page.waitForFunction(id => document.querySelector(`.data-cell[data-row-id="${id}"]`), bottom);
    // A later document must win even if a previous large parse is still pending.
    await page.evaluate(text => {
      setDocument(text, 'old.csv');
      setDocument('Name;Value\nLatest;42', 'new.csv');
    }, text);
    await page.waitForFunction(() => pendingParseRequests.size === 0);
    assert.deepEqual(await page.evaluate(() => ({ headers: sheet.headers, cells: sheet.rows[0].cells })),
      { headers: ['Name', 'Value'], cells: ['Latest', '42'] });
    console.log('Large CSV checks passed: correct delimiter, worker parsing, virtual scrolling and stale-load protection.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
