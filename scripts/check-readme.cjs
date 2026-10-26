// Optional online presentation check; never opens user CSV files.
const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { prepareReadme } = require('./prepare-readme.cjs');
const root = path.resolve(__dirname, '..');
const metadata = require('../package.json');

(async () => {
  const markdown = prepareReadme(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), {
    root, repositoryUrl: metadata.repository.url, version: metadata.version,
  });
  // GitHub's own GFM renderer checks tables, local-document rewrites, and images.
  const response = await fetch('https://api.github.com/markdown', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'csv-simple-editor-doc-check' },
    body: JSON.stringify({ text: markdown, mode: 'gfm' }),
  });
  if (!response.ok) throw new Error(`GitHub Markdown rendering failed: ${response.status}`);
  const html = await response.text();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'nonce-preview';">
      <style nonce="preview">body{font:14px/1.6 system-ui;max-width:820px;margin:24px auto;padding:0 16px;color:#24292f}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{padding:6px 12px;border:1px solid #d0d7de}a{color:#0969da}</style>${html}`);
    assert.equal(await page.locator('img').count(), 2);
    for (const image of await page.locator('img').all()) {
      const dimensions = await image.evaluate(async element => {
        await element.decode();
        return { width: element.naturalWidth, height: element.naturalHeight, protocol: new URL(element.src).protocol };
      });
      assert.equal(dimensions.protocol, 'https:');
      assert.ok(dimensions.width >= 1000 && dimensions.height >= 400, 'Screenshot did not load correctly.');
    }
    assert.equal(await page.locator('table').count(), 1);
    assert.equal(await page.locator('h2').count(), 4);
    if (process.env.CSV_EDITOR_README_ARTIFACT) await page.screenshot({ path: process.env.CSV_EDITOR_README_ARTIFACT, fullPage: true });
    console.log('README presentation passed: GFM rendered, both HTTPS screenshots decoded under a strict CSP, shortcuts table and sections present.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
