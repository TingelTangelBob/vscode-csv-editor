// Browser checks for the side-by-side CSV comparison webview.
// Use a locally installed Playwright, or pass a module path as argv[2].
const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.CSV_EDITOR_ROOT || path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 440 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const html = fs.readFileSync(path.join(root, 'media/compare.html'), 'utf8')
      .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
      .replace(/<link[^>]*>/g, '');
    await page.setContent(html);
    await page.evaluate(() => {
      window.messages = [];
      window.acquireVsCodeApi = () => ({ getState: () => ({}), setState() {}, postMessage: message => messages.push(message) });
    });
    await page.addStyleTag({ path: path.join(root, 'media/compare.css') });
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'media/codicon.css'), 'utf8')
      .replace('./codicon.ttf', `data:font/ttf;base64,${fs.readFileSync(path.join(root, 'media/codicon.ttf')).toString('base64')}`) });
    await page.addScriptTag({ path: path.join(root, 'media/csv.js') });
    await page.addScriptTag({ path: path.join(root, 'media/csv-diff.js') });
    await page.addScriptTag({ path: path.join(root, 'media/compare.js') });

    const send = message => page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), message);
    const original = Array.from({ length: 36 }, (_, i) => `${i},old-${i}`).join('\n');
    const modified = Array.from({ length: 36 }, (_, i) => `${i},${[15, 24, 31].includes(i) ? `new-${i}` : `old-${i}`}`).join('\n');
    await send({ type: 'compare', originalText: `id,value\n${original}`, modifiedText: `id,value\n${modified}`,
      originalName: 'before.csv', modifiedName: 'after.csv', preferences: { language: 'en', theme: 'system', rowHeight: 'normal' } });

    assert.match(await page.locator('#compare-status').textContent(), /3 changed/);
    const normalRowHeight = await page.locator('#before-table tbody td').first().evaluate(node => node.getBoundingClientRect().height);
    assert.equal(await page.locator('#next-change').isDisabled(), false);
    await page.locator('#next-change').click();
    assert.match(await page.locator('#change-navigation-status').textContent(), /1 of 3/);
    await page.locator('#next-change').click();
    assert.match(await page.locator('#change-navigation-status').textContent(), /2 of 3/);
    const beforeTop = await page.locator('#before-scroll').evaluate(node => node.scrollTop);
    const afterTop = await page.locator('#after-scroll').evaluate(node => node.scrollTop);
    assert.ok(beforeTop > 0 && afterTop > 0, 'both panes should follow changed-row navigation');
    assert.ok(Math.abs(beforeTop - afterTop) < 2, 'panes should remain vertically synchronized');
    await page.locator('#previous-change').click();
    assert.match(await page.locator('#change-navigation-status').textContent(), /1 of 3/);

    await page.locator('#settings-button').click();
    assert.equal(await page.locator('#settings-popover').isVisible(), true);
    await page.locator('#row-height').selectOption('compact');
    await page.locator('#show-gridlines').check();
    await page.locator('#theme-select').selectOption('dark');
    await page.locator('#language-select').selectOption('de');
    const saved = await page.evaluate(() => messages.filter(message => message.type === 'saveTablePreferences').at(-1).preferences);
    assert.deepEqual(saved, { language: 'de', theme: 'dark', rowHeight: 'compact', showGridlines: true });
    assert.equal(await page.locator('#settings-button').getAttribute('aria-label'), 'Tabelleneinstellungen');
    assert.match(await page.locator('#compare-status').textContent(), /ursprüngliche Zeilen/);
    assert.match(await page.locator('#change-navigation-status').textContent(), /1 von 3/);
    const compactRowHeight = await page.locator('#before-table tbody td').first().evaluate(node => node.getBoundingClientRect().height);
    assert.ok(compactRowHeight < normalRowHeight, `compact rows should be shorter (${compactRowHeight} !< ${normalRowHeight})`);
    assert.equal(await page.locator('body').evaluate(node => node.dataset.theme), 'dark');
    assert.equal(await page.locator('body').evaluate(node => node.classList.contains('has-gridlines')), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#settings-popover').isVisible(), false);
    assert.equal(await page.locator('#settings-button').evaluate(node => node === document.activeElement), true,
      'Escape should return focus to the settings button');

    const beforeScrollBeforePreferenceUpdate = await page.locator('#before-scroll').evaluate(node => node.scrollTop);
    await send({ type: 'tablePreferences', preferences: { language: 'en', theme: 'light', rowHeight: 'normal', showGridlines: false } });
    assert.equal(await page.locator('#language-select').inputValue(), 'en');
    assert.equal(await page.locator('#settings-button').getAttribute('aria-label'), 'Table settings');
    assert.equal(await page.locator('body').evaluate(node => node.dataset.theme), 'light');
    assert.equal(await page.locator('body').evaluate(node => node.classList.contains('has-gridlines')), false);
    assert.ok(Math.abs(await page.locator('#before-scroll').evaluate(node => node.scrollTop) - beforeScrollBeforePreferenceUpdate) < 2,
      'preference updates should preserve vertical position');
    assert.ok(Math.abs(await page.locator('#before-scroll').evaluate(node => node.scrollTop) - await page.locator('#after-scroll').evaluate(node => node.scrollTop)) < 2,
      'preference updates should keep panes synchronized');

    const beforeScrollBeforeContentUpdate = await page.locator('#before-scroll').evaluate(node => node.scrollTop);
    const refreshed = modified.replace('new-24', 'updated-24');
    await send({ type: 'compare', originalText: `id,value\n${original}`, modifiedText: `id,value\n${refreshed}`,
      originalName: 'before-v2.csv', modifiedName: 'after-v2.csv', preferences: { language: 'en' } });
    assert.equal(await page.locator('#after-name').textContent(), 'after-v2.csv');
    assert.equal(await page.locator('#after-table tbody tr.state-change-after').count(), 3);
    assert.equal(await page.locator('#change-navigation-status').textContent(), '');
    assert.ok(Math.abs(await page.locator('#before-scroll').evaluate(node => node.scrollTop) - beforeScrollBeforeContentUpdate) < 2,
      'content updates should preserve vertical position');

    await send({ type: 'compare', originalText: 'id,value\n1,short', modifiedText: 'id,value\n1,"line 1\nline 2\nline 3\nline 4"',
      originalName: 'before.csv', modifiedName: 'after.csv', preferences: { language: 'en', rowHeight: 'normal' } });
    const beforeChangedRow = page.locator('#before-table tbody tr.state-change-before');
    const afterChangedRow = page.locator('#after-table tbody tr.state-change-after');
    // Alignment runs in animation frames after rendering the new table.
    await page.waitForFunction(() => {
      const before = document.querySelector('#before-table tbody tr.state-change-before');
      const after = document.querySelector('#after-table tbody tr.state-change-after');
      return before && after && Math.abs(before.getBoundingClientRect().height - after.getBoundingClientRect().height) < 1;
    });
    const [beforeHeight, afterHeight] = await Promise.all([
      beforeChangedRow.evaluate(node => node.getBoundingClientRect().height),
      afterChangedRow.evaluate(node => node.getBoundingClientRect().height),
    ]);
    assert.ok(afterHeight > normalRowHeight, `multiline content should increase row height (${afterHeight} !> ${normalRowHeight})`);
    assert.equal(Math.round(afterHeight), Math.round(beforeHeight), 'paired rows should align to their tallest wrapped content');

    await send({ type: 'compare', originalText: 'id,value\n1,same', modifiedText: 'id,value\n1,same',
      originalName: 'same-a.csv', modifiedName: 'same-b.csv', preferences: { language: 'en' } });
    assert.equal(await page.locator('#previous-change').isDisabled(), true);
    assert.equal(await page.locator('#next-change').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('Compare browser checks passed: changed-row navigation, settings, language/preferences updates, and refreshed comparison data.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
