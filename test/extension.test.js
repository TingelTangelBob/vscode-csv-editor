'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const viewType = 'tingeltangelbob.csv-simple-editor.csvGrid';
const patterns = ['*.csv', '*.CSV', '*.tsv', '*.TSV'];
const tick = () => new Promise((resolve) => setImmediate(resolve));

function activate({ globalAssociations = {}, workspaceAssociations = {}, enabled = true, applyEdit, tablePreferences = {} } = {}) {
  const updates = [];
  const errors = [];
  const openedUrls = [];
  const storedState = new Map([['tablePreferences', tablePreferences]]);
  let provider;
  const disposable = { dispose() {} };
  const uri = (fsPath) => ({ fsPath, path: fsPath, toString: () => fsPath.replaceAll('\\', '/') });
  const vscode = {
    ConfigurationTarget: { Global: 1 },
    Uri: {
      joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)),
      parse: (value) => ({ toString: () => value }),
    },
    env: {
      openExternal: async (uri) => { openedUrls.push(uri.toString()); return true; },
      clipboard: { readText: async () => 'Name,Age\nAlice,42' },
    },
    Range: class {},
    WorkspaceEdit: class { replace() {} },
    commands: { registerCommand: () => disposable },
    window: {
      registerCustomEditorProvider(type, value) { provider = value; return disposable; },
      showErrorMessage: (message) => errors.push(message),
    },
    workspace: {
      getConfiguration: (section) => section === 'workbench' ? {
        get: () => ({ ...globalAssociations, ...workspaceAssociations }),
        inspect: () => ({ globalValue: globalAssociations, workspaceValue: workspaceAssociations }),
        update: async (key, value, target) => { updates.push({ key, value, target }); },
      } : {
        get: () => enabled,
        inspect: () => ({ globalValue: enabled }),
      },
      onDidChangeTextDocument: () => disposable,
      onDidSaveTextDocument: () => disposable,
      onDidChangeConfiguration: () => disposable,
      applyEdit: applyEdit ?? (async () => true),
    },
  };
  const context = {
    module: { exports: {} },
    require: (name) => name === 'vscode' ? vscode : require(name),
    globalState: {
      get: (key, fallback) => storedState.has(key) ? storedState.get(key) : fallback,
      update: async (key, value) => { storedState.set(key, value); },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, 'extension.js'), 'utf8'), context);
  context.module.exports.activate({ extensionUri: uri(projectRoot), subscriptions: [], globalState: context.globalState });
  return { updates, errors, openedUrls, provider, uri, storedState };
}

test('changes global CSV associations without copying workspace settings', async () => {
  const { updates } = activate({ globalAssociations: { '*.md': 'markdown.preview' }, workspaceAssociations: { '*.json': 'workspace.editor' } });
  await tick();
  assert.equal(updates.length, 1);
  const { value, target } = updates[0];
  assert.equal(target, 1);
  assert.equal(value['*.md'], 'markdown.preview');
  assert.equal(value['*.json'], undefined);
  for (const pattern of patterns) assert.equal(value[pattern], viewType);
});

test('supports legacy associations and preserves unrelated entries', async () => {
  const { updates } = activate({ globalAssociations: [
    { filenamePattern: '*.md', viewType: 'markdown.preview' },
    { filenamePattern: '*.csv', viewType: 'old.editor' },
  ], enabled: false });
  await tick();
  const associations = updates[0].value;
  assert.equal(associations.length, 5);
  assert.equal(associations[0].viewType, 'markdown.preview');
  for (const pattern of patterns) assert.equal(associations.find((entry) => entry.filenamePattern === pattern).viewType, 'default');
});

test('does not rewrite matching editor associations', async () => {
  const { updates } = activate({ globalAssociations: Object.fromEntries(patterns.map((pattern) => [pattern, viewType])) });
  await tick();
  assert.equal(updates.length, 0);
});

test('handles webview assets and actions, recovers rejected edits and disposes panel listeners', async () => {
  const fixture = activate({
    applyEdit: async () => { throw new Error('Document is read-only'); },
    tablePreferences: { colorizeColumns: true, showGridlines: false, language: 'de', responsiveColumns: false, theme: 'dark' },
  });
  const messages = [];
  let receive;
  let dispose;
  let listenerDisposed = false;
  const panel = {
    webview: {
      cspSource: 'https://webview.example',
      asWebviewUri: (uri) => uri,
      postMessage: async (message) => { messages.push(message); },
      onDidReceiveMessage(handler) { receive = handler; return { dispose() { listenerDisposed = true; } }; },
    },
    onDidDispose(handler) { dispose = handler; },
  };
  const document = { uri: fixture.uri('example.csv'), getText: () => 'Name\nAlice', positionAt: () => ({}), isClosed: false };
  await fixture.provider.resolveCustomTextEditor(document, panel);
  assert.ok(!panel.webview.html.includes('{{'));
  assert.match(panel.webview.html, /href=".*codicon\.css"/);
  assert.match(panel.webview.html, /font-src https:\/\/webview\.example/);
  assert.match(panel.webview.html, /connect-src https:\/\/webview\.example; worker-src blob:/);
  assert.match(panel.webview.html, /data-csv-worker-src=".*media.*csv\.js"/);
  assert.doesNotMatch(panel.webview.html, /\{\{[^}]+\}\}/);
  assert.ok(fs.statSync(path.join(projectRoot, 'media', 'codicon.ttf')).size > 0);
  const nonces = [...panel.webview.html.matchAll(/nonce="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(nonces.length, 2);
  assert.equal(nonces[0], nonces[1]);
  assert.ok(panel.webview.html.includes(`'nonce-${nonces[0]}'`));
  assert.match(panel.webview.html, /codicon-github/);
  assert.match(panel.webview.html, /codicon-link-external/);
  const codiconCss = fs.readFileSync(path.join(projectRoot, 'media', 'codicon.css'), 'utf8');
  assert.match(codiconCss, /codicon-triangle-down::before \{ content: '\\eb6e'; \}/);
  assert.match(codiconCss, /codicon-triangle-up::before \{ content: '\\eb71'; \}/);
  const html = panel.webview.html.replaceAll('\r\n', '\n');
  const settingsStart = html.indexOf('<div class="popover settings-popover"');
  const settingsEnd = html.indexOf('<div class="popover filter-popover"', settingsStart);
  const projectLink = html.indexOf('data-action="open-project"');
  assert.ok(projectLink > settingsStart && projectLink < settingsEnd);
  assert.doesNotMatch(html.slice(html.indexOf('<div class="popover tools-popover"'), settingsStart), /data-action="open-project"/);
  assert.match(html.slice(settingsStart, settingsEnd), /data-i18n="Open CSVs as tables"/);
  await receive({ type: 'ready' });
  const loadIndex = messages.findIndex((message) => message.type === 'load');
  const preferencesIndex = messages.findIndex((message) => message.type === 'tablePreferences');
  assert.ok(preferencesIndex >= 0 && preferencesIndex < loadIndex);
  assert.equal(messages.filter((message) => message.type === 'load').length, 1);
  assert.ok(messages.some((message) => message.type === 'tablePreferences'
    && message.preferences.language === 'de' && message.preferences.colorizeColumns));
  assert.ok(messages.some(message => message.type === 'tablePreferences'
    && message.preferences.theme === 'dark' && message.preferences.responsiveColumns === false));
  await receive({ type: 'saveTablePreferences', preferences: { colorizeColumns: false, showGridlines: true, language: 'fr', responsiveColumns: true, theme: 'light' } });
  assert.equal(fixture.storedState.get('tablePreferences').colorizeColumns, false);
  assert.equal(fixture.storedState.get('tablePreferences').showGridlines, true);
  assert.equal(fixture.storedState.get('tablePreferences').language, 'fr');
  assert.equal(fixture.storedState.get('tablePreferences').responsiveColumns, true);
  assert.equal(fixture.storedState.get('tablePreferences').theme, 'light');
  assert.ok(messages.some((message) => message.type === 'tablePreferences'
    && message.preferences.language === 'fr' && message.preferences.showGridlines));
  await receive({ type: 'saveTablePreferences', preferences: { theme: 'invalid', responsiveColumns: 'false' } });
  assert.equal(fixture.storedState.get('tablePreferences').theme, 'system');
  assert.equal(fixture.storedState.get('tablePreferences').responsiveColumns, true);
  await receive({ type: 'openProject' });
  assert.deepEqual(fixture.openedUrls, ['https://github.com/TingelTangelBob/vscode-csv-editor']);
  await receive({ type: 'readClipboard', requestId: 7 });
  const clipboard = messages.find(message => message.type === 'clipboardText');
  assert.equal(clipboard.text, 'Name,Age\nAlice,42');
  assert.equal(clipboard.requestId, 7);
  await receive({ type: 'edit', text: 'Name\nBob' });
  await tick();
  assert.equal(messages.at(-1).type, 'editRejected');
  assert.equal(messages.at(-1).text, 'Name\nAlice');
  assert.match(fixture.errors.at(-1), /read-only/);
  dispose();
  assert.equal(listenerDisposed, true);
});
