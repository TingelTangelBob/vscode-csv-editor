'use strict';

// Prepare a reviewable plan; applying it is deliberately a separate operation.
const fs = require('node:fs');
const path = require('node:path');
const { makeReleaseNotes } = require('./release-notes.cjs');
const root = path.resolve(__dirname, '..');

function planBackfill(changelog, releases, repositoryUrl) {
  const repo = repositoryUrl.replace(/\.git$/, '').replace(/\/$/, '');
  const automatic = new RegExp(`^\\*\\*Full Changelog\\*\\*:\\s*${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(?:compare|commits)/[^\\s]+$`);
  const updates = [], skipped = [];
  for (const release of releases) {
    if (release.draft || release.isDraft) continue;
    const tag = release.tag_name || release.tagName;
    const oldBody = release.body || '';
    if (oldBody.trim() && !automatic.test(oldBody.trim())) {
      skipped.push({ tag, reason: 'Existing written release notes are preserved.' });
      continue;
    }
    const body = makeReleaseNotes(changelog, tag, releases, repositoryUrl);
    if (oldBody.trim() !== body.trim()) updates.push({ id: release.id, tag, oldBody, body });
  }
  return { updates, skipped };
}

module.exports = { planBackfill };
if (require.main === module) {
  try {
    const [inputFile, outputFile] = process.argv.slice(2);
    if (!inputFile || !outputFile) throw new Error('Usage: node scripts/plan-release-backfill.cjs <release-list.json> <plan.json>');
    const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const releases = JSON.parse(fs.readFileSync(inputFile, 'utf8').replace(/^\ufeff/, ''));
    const plan = planBackfill(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), releases, metadata.repository.url);
    fs.writeFileSync(outputFile, JSON.stringify(plan, null, 2) + '\n', 'utf8');
    for (const update of plan.updates) console.log(`Update ${update.tag}: ${[...update.body.matchAll(/^## /gm)].length} changelog section(s)`);
    for (const skip of plan.skipped) console.log(`Keep ${skip.tag}: ${skip.reason}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
