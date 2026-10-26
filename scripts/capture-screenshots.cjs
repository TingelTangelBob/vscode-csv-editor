// Capture the actual editor with bundled assets; no external requests are made.
// Pass an existing Playwright module path as the first argument if needed.
const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const media = path.join(root, 'media');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const origin = 'http://csv-editor.local';
const csv = [
  'Company,Region,Quarter,Revenue,Status,Account owner',
  'Northwind Traders,Europe,Q1 2026,184500,Approved,Emma Wilson',
  'Contoso Ltd.,North America,Q1 2026,239800,Review,James Miller',
  'Fabrikam,Asia Pacific,Q1 2026,156200,Approved,Sophia Chen',
  'Adventure Works,Europe,Q2 2026,198400,Approved,Oliver Fischer',
  'Tailspin Toys,North America,Q2 2026,127900,Pending,Charlotte Davis',
  'Wide World Importers,Asia Pacific,Q3 2026,214600,Review,Noah Tanaka',
  'Woodgrove Bank,Europe,Q3 2026,176300,Approved,Amelia Martin',
  'Alpine Outdoor Equipment,North America,Q3 2026,208750,Approved,Liam Thompson',
  'Blue Yonder Airlines,Asia Pacific,Q4 2026,312400,Pending,Isabella Lee',
  'Coho Vineyard,Europe,Q4 2026,94300,Approved,Lucas Bernard',
  'Lucerne Publishing,North America,Q4 2026,168900,Review,Mia Anderson',
  'Proseware,Europe,Q4 2026,225600,Approved,Ethan Clarke',
].join('\n');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1080, height: 450 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route(`${origin}/**`, async (route) => {
        const filename = new URL(route.request().url()).pathname.slice(1) || 'index.html';
        if (!/^[\w.-]+$/.test(filename)) return route.abort();
        const asset = path.join(media, filename);
        if (filename !== 'index.html') return route.fulfill({ path: asset });
        const html = fs.readFileSync(asset, 'utf8')
          .replaceAll('{{CSP_SOURCE}}', origin).replaceAll('{{NONCE}}', 'screenshot')
          .replaceAll('{{VERSION}}', version)
          .replaceAll('{{CODICON_STYLESHEET_URI}}', `${origin}/codicon.css`)
          .replaceAll('{{STYLESHEET_URI}}', `${origin}/editor.css`)
          .replaceAll('{{CSV_SCRIPT_URI}}', `${origin}/csv.js`)
          .replaceAll('{{EXPORT_SCRIPT_URI}}', `${origin}/export.js`)
          .replaceAll('{{SCRIPT_URI}}', `${origin}/editor.js`);
        return route.fulfill({ contentType: 'text/html', body: html });
      });
      await page.addInitScript(({ theme, csv }) => {
        window.acquireVsCodeApi = () => ({
          getState: () => ({ responsiveColumns: false, theme, language: 'en' }),
          setState() {},
          postMessage(message) {
            if (message.type === 'ready') setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
              data: { type: 'load', text: csv, filename: 'Quarterly sales.csv' },
            })), 0);
          },
        });
      }, { theme, csv });
      await page.goto(origin);
      await page.waitForFunction(() => documentLoaded && document.querySelectorAll('.data-cell').length === 72);
      await page.evaluate(async () => { await document.fonts.ready; recalculateColumnWidths(); renderTable(); });
      await page.mouse.move(1070, 440);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('.popover:visible').count(), 0);
      assert.equal(await page.evaluate(() => responsiveColumns), false);
      assert.equal(await page.evaluate(() => columnWidthOverrides.some(Number.isFinite)), false);
      assert.equal(await page.locator('.is-cell-selected, .is-column-selected, tr.is-selected').count(), 0);
      assert.ok(await page.evaluate(() => elements.table.offsetWidth < elements.tableScroll.clientWidth - 100));
      assert.deepEqual(errors, []);
      for (const selector of ['#export-button .codicon', '.column-move-handle .codicon']) {
        assert.ok(await page.locator(selector).first().evaluate((element) =>
          !['none', 'normal', '""'].includes(getComputedStyle(element, '::before').content)));
      }
      const destination = path.join(media, `marketplace-${theme}.png`);
      await page.screenshot({ path: destination });
      console.log(`Created ${destination}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
