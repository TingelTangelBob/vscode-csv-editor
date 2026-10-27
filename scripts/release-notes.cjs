'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function parseVersion(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(value || '');
  if (!match) return null;
  return { core: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') ?? null };
}

function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) throw new Error('Release versions must use semantic versioning.');
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  if (!a.prerelease || !b.prerelease) return a.prerelease ? -1 : b.prerelease ? 1 : 0;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i], y = b.prerelease[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function previousRelease(version, releases) {
  if (!parseVersion(version)) throw new Error(`Invalid release version: ${version}`);
  return releases.filter(release => !release.isDraft && !release.draft)
    .map(release => release.tagName || release.tag_name)
    .filter(tag => parseVersion(tag) && compareVersions(tag, version) < 0)
    .sort((a, b) => compareVersions(b, a))[0] ?? null;
}

function makeReleaseNotes(changelog, version, releases, repositoryUrl) {
  const normalized = changelog.replace(/\r\n?/g, '\n');
  const headings = [...normalized.matchAll(/^##[ \t]+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:[ \t]+[^\n]*)?[ \t]*$/gm)];
  const sections = headings.map((heading, index) => ({
    version: heading[1], text: normalized.slice(heading.index, headings[index + 1]?.index ?? normalized.length).trim(),
  }));
  const current = version.replace(/^v/, '');
  const matches = sections.map((section, index) => section.version === current ? index : -1).filter(index => index >= 0);
  if (matches.length !== 1) throw new Error(`Expected exactly one CHANGELOG.md section for ${current}.`);
  const start = matches[0];
  const previous = previousRelease(current, releases);
  const previousVersion = previous?.replace(/^v/, '');
  const stop = previous ? sections.findIndex(section => section.version === previousVersion) : sections.length;
  if (previous && (stop <= start || sections.filter(section => section.version === previousVersion).length !== 1)) {
    throw new Error(`Previous release ${previous} is missing or out of order in CHANGELOG.md.`);
  }
  const included = sections.slice(start, stop);
  for (const section of included) {
    if (!section.text.replace(/^##[^\n]*\n?/, '').trim()) throw new Error(`CHANGELOG.md section ${section.version} is empty.`);
  }
  const repo = repositoryUrl.replace(/\.git$/, '').replace(/\/$/, '');
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repo)) throw new Error('A GitHub HTTPS repository URL is required.');
  const tag = `v${current}`;
  const link = previous ? `${repo}/compare/${previous}...${tag}` : `${repo}/commits/${tag}`;
  return `${included.map(section => section.text).join('\n\n')}\n\n**Full Changelog**: ${link}\n`;
}

module.exports = { compareVersions, previousRelease, makeReleaseNotes };

if (require.main === module) {
  try {
    const [version, releaseListFile, outputFile] = process.argv.slice(2);
    if (!version || !releaseListFile || !outputFile) throw new Error('Usage: node scripts/release-notes.cjs <version> <release-list.json> <output.md>');
    const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const releases = JSON.parse(fs.readFileSync(releaseListFile, 'utf8').replace(/^\ufeff/, ''));
    if (!Array.isArray(releases)) throw new Error('The release list must be a JSON array.');
    const notes = makeReleaseNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version, releases, metadata.repository.url);
    fs.writeFileSync(outputFile, notes, 'utf8');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
