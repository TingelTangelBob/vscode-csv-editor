'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '../media/compare.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../media/compare.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../media/compare.html'), 'utf8');

test('comparison toolbar keeps status left and retains navigation and settings actions', () => {
  const toolbar = html.match(/<header class="compare-toolbar">([\s\S]*?)<\/header>/)?.[1] || '';
  assert.match(toolbar, /<span id="compare-status"/);
  assert.doesNotMatch(toolbar, /CSV comparison|CSV-Vergleich|class="legend"/);
  assert.ok(toolbar.indexOf('id="compare-status"') < toolbar.indexOf('class="compare-actions"'));
  assert.ok(toolbar.indexOf('class="compare-actions"') < toolbar.indexOf('class="change-navigation"'));
  assert.ok(toolbar.indexOf('class="change-navigation"') < toolbar.indexOf('id="settings-button"'));
  assert.doesNotMatch(toolbar, /id="open-before"|id="open-after"/);
  assert.doesNotMatch(js, /open-before|open-after|openTableEditor|Open original in table editor|Open modified in table editor/);
  assert.doesNotMatch(js, /\.compare-title|\.legend/);
});

test('compare renderer assigns red and green classes by side for changed rows and cells', () => {
  assert.match(js, /row\.type === 'change' \? \(side === 'before' \? 'state-change-before' : 'state-change-after'\)/);
  assert.match(css, /tr\.state-change-before td \{ background: var\(--diff-remove-line\); \}/);
  assert.match(css, /tr\.state-change-after td \{ background: var\(--diff-insert-line\); \}/);
  assert.doesNotMatch(css, /td\.cell-change-before[^\n]*background: var\(--diff-remove-cell\)/);
  assert.doesNotMatch(css, /td\.cell-change-after[^\n]*background: var\(--diff-insert-cell\)/);
});

test('missing fields in changed rows get strong side-specific diff colors', () => {
  assert.match(js, /missing\.classList\.add\(side === 'before' \? 'text-change-before' : 'text-change-after'\)/);
  assert.match(css, /tr\.state-change-before td\.cell-missing \{ background: var\(--diff-remove-line\)/);
  assert.match(css, /tr\.state-change-after td\.cell-missing \{ background: var\(--diff-insert-line\)/);
});

test('missing counterpart rows retain the lighter inserted or removed line color', () => {
  assert.match(js, /row\.type === 'insert' \? \(side === 'after' \? 'state-insert' : 'state-insert-gap'\)/);
  assert.match(js, /row\.type === 'delete' \? \(side === 'before' \? 'state-delete' : 'state-delete-gap'\)/);
  assert.match(css, /tr\.state-insert td, tr\.state-insert-gap td \{ background: var\(--diff-insert-line\); \}/);
  assert.match(css, /tr\.state-delete td, tr\.state-delete-gap td \{ background: var\(--diff-remove-line\); \}/);
});

test('diff colors use VS Code theme variables and theme-aware fallbacks', () => {
  assert.match(css, /--vscode-diffEditor-insertedLineBackground/);
  assert.match(css, /--vscode-diffEditor-removedLineBackground/);
  assert.match(css, /--vscode-diffEditor-insertedTextBackground/);
  assert.match(css, /--vscode-diffEditor-removedTextBackground/);
  assert.match(css, /color-mix\(in srgb, #2da44e 42%, var\(--background\)\)/);
  assert.match(css, /color-mix\(in srgb, #cf222e 42%, var\(--background\)\)/);
});

test('changed cell text uses bounded Unicode-aware ranges and safe DOM nodes', () => {
  assert.match(js, /function changedTextRanges\(before, after\)/);
  assert.match(js, /Array\.from\(before\)/);
  assert.match(js, /n \* m > 65536/);
  assert.match(js, /function appendChangedText\(cell, value, ranges, side\)/);
  assert.match(js, /document\.createTextNode/);
  assert.match(js, /mark\.textContent = chars\.slice/);
  assert.match(js, /cell\.before\?\.present && cell\.after\?\.present/);
  assert.match(css, /\.text-change-before \{ background: var\(--diff-remove-cell\)/);
  assert.match(css, /\.text-change-after \{ background: var\(--diff-insert-cell\)/);
  assert.match(js, /text-change-anchor-before/);
  assert.match(js, /text-change-anchor-after/);
  assert.match(js, /if \(textValue === ''\)/);
  assert.match(css, /\.text-change-anchor-before, \.text-change-anchor-after \{ display: inline-block; width: 0;/);
});

test('changed headers use inline text ranges and missing columns have side-specific emphasis', () => {
  assert.match(js, /const pairedChange = Boolean\(column\.changed && column\.before\?\.present && column\.after\?\.present\)/);
  assert.match(js, /appendChangedText\(th, label, changedTextRanges\(String\(column\.before\.value/);
  assert.match(js, /label === ''[\s\S]*?text-change-before/);
  assert.match(js, /if \(!exists\) th\.append\(el\('span', side === 'before' \? 'text-change-before' : 'text-change-after'/);
  assert.match(js, /else if \(column\.changed\) th\.append\(el\('span', side === 'before' \? 'text-change-before' : 'text-change-after'/);
  assert.match(js, /Spaltenüberschriften geändert/);
  assert.match(js, /headers changed/);
});


test('inline text diff identifies inserted prefixes and repeated edits', () => {
  const vm = require('node:vm');
  const start = js.indexOf('function changedTextRanges(');
  const end = js.indexOf('function appendChangedText(', start);
  assert.ok(start >= 0 && end > start);
  const compare = vm.runInNewContext(`${js.slice(start, end)}; changedTextRanges`);
  const inserted = JSON.parse(JSON.stringify(compare('Spedition', 'EP Spedition')));
  assert.deepEqual(inserted.after, [[0, 3]]);
  assert.deepEqual(inserted.before, [[0, 0]]);
  const edited = JSON.parse(JSON.stringify(compare('abXcdYef', 'ab1cd2ef')));
  assert.deepEqual(edited.before, [[2, 3], [5, 6]]);
  assert.deepEqual(edited.after, [[2, 3], [5, 6]]);
  const unicode = JSON.parse(JSON.stringify(compare('A\u{1F600}B', 'A\u{1F600}XB')));
  assert.deepEqual(unicode.after, [[2, 3]]);
  const empty = JSON.parse(JSON.stringify(compare('', '')));
  assert.deepEqual(empty, { before: [], after: [] });
  const longInsertion = JSON.parse(JSON.stringify(compare('', 'X'.repeat(100000))));
  assert.deepEqual(longInsertion, { before: [[0, 0]], after: [[0, 100000]] });
  const longDeletion = JSON.parse(JSON.stringify(compare('X'.repeat(100000), '')));
  assert.deepEqual(longDeletion, { before: [[0, 100000]], after: [[0, 0]] });
});

test('inline diff anchors pure insertions and renders escaped text as text nodes', () => {
  const vm = require('node:vm');
  const start = js.indexOf('function appendChangedText(');
  const end = js.indexOf('function renderPane(', start);
  const source = `${js.slice(start, end)}; appendChangedText`;
  const makeNode = (tag) => ({ tag, className: '', textContent: '', attributes: {}, children: [], setAttribute(name, value) { this.attributes[name] = value; }, append(child) { this.children.push(child); } });
  const context = {
    document: { createElement: makeNode, createTextNode(text) { return { text }; } },
  };
  const appendChangedText = vm.runInNewContext(source, context);
  const cell = makeNode('td');
  appendChangedText(cell, '<img onerror="bad">', { before: [[0, 0]], after: [[0, 5]] }, 'before');
  assert.equal(cell.children[0].className, 'text-change-anchor-before');
  assert.equal(cell.children[1].text, '<img onerror="bad">');
  assert.equal(cell.children.some((node) => node.tag === 'img'), false);
  assert.match(css, /\.text-change-anchor-before, \.text-change-anchor-after \{ display: inline-block; width: 0;/);
});


test('comparison settings uses the same codicon as the regular editor', () => {
  const editorHtml = fs.readFileSync(path.join(__dirname, '../media/index.html'), 'utf8');
  const icon = /<span class="codicon codicon-settings" aria-hidden="true"><\/span>/;
  assert.match(editorHtml, icon);
  assert.match(html, icon);
  assert.match(html, /href="\{\{CODICON_STYLESHEET_URI\}\}"/);
  assert.match(html, /font-src \{\{CSP_SOURCE\}\}/);
});
