// PDF assets are bundled for offline use and loaded only when exporting a PDF.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.resolve(__dirname, '../media/pdf');
const assets = {
  'pdf-lib.min.js': 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'fontkit.umd.min.js': 'https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
  'PDF-LIB-LICENSE.txt': 'https://unpkg.com/pdf-lib@1.17.1/LICENSE.md',
  'FONTKIT-UPSTREAM-README.txt': 'https://raw.githubusercontent.com/foliojs/fontkit/master/README.md',
  'NotoSans-Regular.ttf': 'https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf',
  'NOTO-LICENSE.txt': 'https://raw.githubusercontent.com/notofonts/noto-fonts/main/LICENSE',
  'DroidSansFallback.ttf': 'https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android-14.0.0_r1/data/fonts/DroidSansFallback.ttf',
  'DROID-NOTICE.txt': 'https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android-14.0.0_r1/data/fonts/NOTICE',
};
(async () => {
  await fs.mkdir(directory, { recursive: true });
  const manifest = {};
  for (const [filename, url] of Object.entries(assets)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(path.join(directory, filename), bytes);
    manifest[filename] = { url, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    console.log(filename, bytes.length);
  }
  const mit = (await fs.readFile(path.join(directory, 'PDF-LIB-LICENSE.txt'), 'utf8'))
    .replace('Copyright (c) 2019 Andrew Dillon', 'Fontkit: Copyright (c) Devon Govett and contributors\n@pdf-lib/fontkit fork: Copyright (c) Andrew Dillon and contributors');
  await fs.writeFile(path.join(directory, 'FONTKIT-LICENSE.txt'), mit);
  await fs.writeFile(path.join(directory, 'sources.json'), JSON.stringify(manifest, null, 2) + '\n');
})().catch((error) => { console.error(error); process.exitCode = 1; });
