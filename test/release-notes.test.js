'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeReleaseNotes, previousRelease, compareVersions } = require('../scripts/release-notes.cjs');
const { planBackfill } = require('../scripts/plan-release-backfill.cjs');
const repo = 'https://github.com/example/project.git';
const changelog = '# Changelog\n\n## 1.4.0\n\n- Newest\n\n## 1.3.0\n\n- Intermediate\n\n## 1.2.0\n\n- Previous\n\n## 1.1.0\n\n- Older\n';

test('release notes include all changes since the previous published release', () => {
  const releases = [{ tagName: 'v1.1.0' }, { tagName: 'v1.2.0' }, { tagName: 'v1.3.0', isDraft: true }, { tagName: 'v1.5.0' }];
  const notes = makeReleaseNotes(changelog, '1.4.0', releases, repo);
  assert.match(notes, /## 1\.4\.0\n\n- Newest/);
  assert.match(notes, /## 1\.3\.0\n\n- Intermediate/);
  assert.doesNotMatch(notes, /## 1\.2\.0|## 1\.1\.0/);
  assert.match(notes, /https:\/\/github.com\/example\/project\/compare\/v1\.2\.0\.\.\.v1\.4\.0/);
});

test('first release includes available history and a commits link', () => {
  const notes = makeReleaseNotes(changelog, '1.2.0', [], repo);
  assert.match(notes, /## 1\.2\.0/);
  assert.match(notes, /## 1\.1\.0/);
  assert.match(notes, /\/commits\/v1\.2\.0/);
});

test('missing, empty, duplicated or out-of-order version sections stop the release', () => {
  assert.throws(() => makeReleaseNotes(changelog, '1.9.0', [], repo), /exactly one/);
  assert.throws(() => makeReleaseNotes('## 1.4.0\n\n## 1.2.0\n- Previous', '1.4.0', [{tagName:'v1.2.0'}], repo), /empty/);
  assert.throws(() => makeReleaseNotes('## 1.4.0\n- a\n## 1.4.0\n- b', '1.4.0', [], repo), /exactly one/);
  assert.throws(() => makeReleaseNotes(changelog, '1.4.0', [{tagName:'v1.2.5'}], repo), /missing or out of order/);
});

test('selects versions numerically and respects prereleases', () => {
  assert.ok(compareVersions('v1.10.0', 'v1.9.9') > 0);
  assert.ok(compareVersions('v2.0.0-rc.2', 'v2.0.0-rc.10') < 0);
  assert.ok(compareVersions('v2.0.0-rc.1', 'v2.0.0') < 0);
  assert.equal(previousRelease('2.0.0', [{tagName:'v1.9.0'}, {tag_name:'v2.0.0-rc.2'}, {tagName:'v1.10.0'}]), 'v2.0.0-rc.2');
});

test('backfill only replaces empty or generated notes and preserves hand-written releases', () => {
  const releases = [
    {id: 4, tag_name:'v1.4.0', body:'**Full Changelog**: https://github.com/example/project/compare/v1.2.0...v1.4.0'},
    {id: 2, tag_name:'v1.2.0', body:'## My own notes\n\nKeep this.'},
    {id: 1, tag_name:'v1.1.0', body:''},
  ];
  const plan = planBackfill(changelog, releases, repo);
  assert.deepEqual(plan.updates.map(update => update.tag), ['v1.4.0', 'v1.1.0']);
  assert.deepEqual(plan.skipped.map(skip => skip.tag), ['v1.2.0']);
  assert.match(plan.updates[0].body, /## 1\.3\.0/);
  assert.doesNotMatch(plan.updates[0].body, /## 1\.2\.0/);
  assert.equal(releases[1].body, '## My own notes\n\nKeep this.');
});
