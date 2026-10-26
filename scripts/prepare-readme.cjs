const fs = require('node:fs');
const path = require('node:path');

function prepareReadme(markdown, { root, repositoryUrl, branch = 'main', version }) {
  const repository = repositoryUrl.replace(/\.git$/, '').replace(/\/$/, '');
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repository)) throw new Error('A public HTTPS GitHub repository is required for documentation links.');
  const rawBase = repository.replace('https://github.com/', 'https://raw.githubusercontent.com/') + `/${branch}/`;
  const contentBase = `${repository}/blob/${branch}/`;
  return markdown.replace(/(!?)\[([^\]]+)\]\(([^)]+)\)/g, (match, image, label, target) => {
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) {
      if (image && !target.startsWith('https://')) throw new Error(`README images require HTTPS: ${target.slice(0, 80)}`);
      return match;
    }
    if (target.startsWith('#')) return match;
    const [filename, anchor] = target.split('#', 2);
    const localPath = path.resolve(root, filename);
    if (!localPath.startsWith(path.resolve(root) + path.sep) || !fs.statSync(localPath).isFile()) throw new Error(`README target is missing or outside the project: ${target}`);
    const encoded = filename.replace(/^\.\//, '').split('/').map(encodeURIComponent).join('/');
    const cacheKey = image && version ? `?v=${encodeURIComponent(version)}` : '';
    return `${image}[${label}](${image ? rawBase : contentBase}${encoded}${cacheKey}${anchor ? `#${anchor}` : ''})`;
  });
}

module.exports = { prepareReadme };
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const markdown = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const result = prepareReadme(markdown, { root, repositoryUrl: metadata.repository.url, version: metadata.version });
  fs.writeFileSync(process.argv[2], result, 'utf8');
}
