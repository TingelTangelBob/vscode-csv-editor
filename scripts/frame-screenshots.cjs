// Present supplied screenshots without regenerating or changing their contents.
const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const media = path.resolve(__dirname, '../media');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const theme of ['light', 'dark']) {
      const source = path.join(media, 'screenshots', `${theme}.png`);
      const bytes = fs.readFileSync(source);
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      const page = await browser.newPage({ viewport: { width: width + 66, height: height + 66 }, deviceScaleFactor: 1 });
      await page.route('http://screenshot.local/image.png', route => route.fulfill({ path: source, contentType: 'image/png' }));
      await page.setContent(`<style>
        *{box-sizing:border-box}body{margin:0;padding:32px;background:${theme === 'light' ? '#f0f3f1' : '#151c18'}}
        .frame{width:${width + 2}px;overflow:hidden;border-radius:12px;border:1px solid ${theme === 'light' ? '#d9e1dc' : '#405047'};box-shadow:0 12px 28px ${theme === 'light' ? '#183e2929' : '#00000066'}}
        img{display:block;width:${width}px;height:${height}px}
        </style><div class="frame"><img src="http://screenshot.local/image.png" alt="CSV Simple Editor ${theme}"></div>`);
      await page.locator('img').evaluate(image => image.decode());
      const destination = path.join(media, `marketplace-${theme}.png`);
      await page.screenshot({ path: destination });
      console.log(`Framed supplied ${theme} screenshot: ${width} × ${height}`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
