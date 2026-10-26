# Development

The extension runs without an npm install. Source files are `extension.js`, `media/editor.js`, `media/editor.css`, and `media/csv.js`; `media/export.js` loads PDF resources on demand.

## Test and package

```powershell
npm test
npm run package
```

The package script builds `csv-simple-editor-<version>.vsix` on Windows. It includes runtime assets and licenses, and uses HTTPS screenshot URLs in the packaged README. Local links to documentation are rewritten to their GitHub pages. Screenshots need an internet connection; the editor and exports do not.

If child processes are restricted, run `node --test --test-isolation=none`.

## Optional browser checks

Install Playwright and its Chromium browser in a development environment, then run `npm run test:ui` or `npm run test:large`. An existing Playwright install can be passed explicitly:

```powershell
npm run test:ui -- D:/path/to/node_modules/playwright
```

`test:large` generates its own 22-column CSV and checks worker parsing, virtual scrolling, and stale-load protection. Only pass a real CSV path explicitly when you intend to load that entire file. For a small inspection, create a separate sample first. `CSV_EDITOR_ROOT` can point to an extracted VSIX's `extension` directory to test packaged assets.

## PDF resources

PDF 1.7 export uses bundled pdf-lib/fontkit and fonts in `media/pdf`, with upstream licenses and SHA-256 checksums. Fonts are stored as gzip and decompressed only when needed. The Latin font embeds a subset; the CJK/Korean fallback embeds intact for reader compatibility.

`npm run test:pdf` checks independent text extraction using PDF.js. An existing module can be passed as its first argument. Run `node scripts/update-pdf-assets.cjs` only when intentionally updating dependencies, then review licenses and checksums.

## Screenshots and documentation

Run `node scripts/capture-screenshots.cjs`, optionally passing a Playwright module path. Captures use the actual editor with a small generated table, bundled fonts and icons, natural widths, and closed menus. Keep both PNGs in `media` and push them before distributing a package that references them.

The editable icon is `media/csv-simple-editor-favicon.svg`; the Marketplace icon is `media/extension-icon.png`. Keep the README focused on installing and using the editor. Detailed usage belongs in the [user guide](GUIDE.md), and technical notes in this file.

`npm run test:readme` is an optional online check using GitHub's Markdown renderer and Playwright. It verifies that both public HTTPS screenshots load under a strict image policy. Pass an existing Playwright module path as for `test:ui`. It opens no user CSV files.
