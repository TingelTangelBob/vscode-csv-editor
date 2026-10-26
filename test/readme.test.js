const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { prepareReadme } = require('../scripts/prepare-readme.cjs');
const root = path.resolve(__dirname, '..');
const metadata = require('../package.json');
const options = { root, repositoryUrl: metadata.repository.url, version: metadata.version };

test('packaged README uses HTTPS screenshots and working GitHub document paths', () => {
  const result = prepareReadme(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), options);
  const images = [...result.matchAll(/!\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]);
  assert.deepEqual(images, ['light', 'dark'].map(theme =>
    `https://raw.githubusercontent.com/TingelTangelBob/vscode-csv-editor/main/media/marketplace-${theme}.png?v=${metadata.version}`));
  for (const file of ['docs/GUIDE.md', 'docs/DEVELOPMENT.md', 'SUPPORT.md', 'CHANGELOG.md']) {
    assert.ok(result.includes(`https://github.com/TingelTangelBob/vscode-csv-editor/blob/main/${file}`));
  }
  assert.doesNotMatch(result, /data:image|\]\((?:media|docs)\//);
});

test('README preparation rejects image sources stripped by VS Code and missing local assets', () => {
  assert.throws(() => prepareReadme('![example](data:image/png;base64,AA==)', options), /HTTPS/);
  assert.throws(() => prepareReadme('![example](http://example.com/a.png)', options), /HTTPS/);
  assert.throws(() => prepareReadme('![example](media/missing.png)', options));
});
