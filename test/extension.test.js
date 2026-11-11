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
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function activate({ globalAssociations = {}, workspaceAssociations = {}, enabled = true, applyEdit, tablePreferences = {}, saveDestination = null, writeError = null, fileViewError = null, fileViewDelay = 0, compareError = null, closeError = null } = {}) {
  const updates = [];
  const errors = [];
  const openedUrls = [];
  const exports = [];
  const saveDialogs = [];
  const storedState = new Map([['tablePreferences', tablePreferences]]);
  let provider;
  let activeTab;
  let activeViewColumn = 1;
  let tabsChangeListener;
  const commands = new Map();
  const executedCommands = [];
  const comparisons = [];
  const closedTabs = [];
  const documents = new Map();
  const documentChangeListeners = new Set();
  const willSaveListeners = [];
  let comparisonFailure = compareError;
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
    TabInputTextDiff: class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } },
    ViewColumn: { Active: -1 },
    commands: { registerCommand: (name, handler) => { commands.set(name, handler); return disposable; }, executeCommand: async (...args) => { executedCommands.push(args); } },
    window: {
      showSaveDialog: async (options) => { saveDialogs.push(options); return saveDestination; },
      registerCustomEditorProvider(type, value) { provider = value; return disposable; },
      createWebviewPanel: (viewType, title) => {
        if (comparisonFailure) throw comparisonFailure;
        let receive;
        const panel = { viewType, title, visible: true, active: true, webview: {
          cspSource: 'https://webview.example',
          asWebviewUri: value => value,
          postMessage: async message => { panel.messages.push(message); return true; },
          onDidReceiveMessage: handler => { receive = handler; return disposable; },
        }, messages: [], ready: message => receive?.(message), onDidDispose: handler => { panel.dispose = handler; return disposable; }, onDidChangeViewState: handler => { panel.viewState = handler; return disposable; } };
        comparisons.push(panel);
        return panel;
      },
      tabGroups: {
        get activeTabGroup() { return { activeTab, viewColumn: activeViewColumn }; },
        onDidChangeTabs: handler => { tabsChangeListener = handler; return disposable; },
        close: async tab => { closedTabs.push(tab); if (closeError) throw closeError; },
      },
      showErrorMessage: (message) => errors.push(message),
    },
    workspace: {
      fs: { writeFile: async (destination, bytes) => {
        if (writeError) throw writeError;
        exports.push({ destination, bytes });
      } },
      getConfiguration: (section) => section === 'workbench' ? {
        get: () => ({ ...globalAssociations, ...workspaceAssociations }),
        inspect: () => ({ globalValue: globalAssociations, workspaceValue: workspaceAssociations }),
        update: async (key, value, target) => { updates.push({ key, value, target }); },
      } : {
        get: () => enabled,
        inspect: () => ({ globalValue: enabled }),
      },
      onDidChangeTextDocument: handler => {
        documentChangeListeners.add(handler);
        return { dispose: () => documentChangeListeners.delete(handler) };
      },
      onDidSaveTextDocument: () => disposable,
      onWillSaveTextDocument: (handler) => { willSaveListeners.push(handler); return disposable; },
      onDidChangeConfiguration: () => disposable,
      openTextDocument: async value => documents.get(value.toString()) ?? { uri: value, getText: () => `data:${value.toString()}` },
      applyEdit: applyEdit ?? (async () => true),
    },
  };
  const context = {
    Buffer,
    setTimeout,
    clearTimeout,
    module: { exports: {} },
    require: (name) => name === 'vscode' ? vscode : name === './media/csv' ? require('../media/csv') : require(name),
    globalState: {
      get: (key, fallback) => storedState.has(key) ? storedState.get(key) : fallback,
      update: async (key, value) => { if (key.startsWith('fileView:') && fileViewError) throw fileViewError; if (key.startsWith('fileView:') && fileViewDelay) await new Promise(resolve => setTimeout(resolve, fileViewDelay)); storedState.set(key, value); },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, 'extension.js'), 'utf8'), context);
  context.module.exports.activate({ extensionUri: uri(projectRoot), subscriptions: [], globalState: context.globalState });
  return {
    updates, errors, openedUrls, provider, uri, storedState, exports, saveDialogs, willSaveListeners, comparisons, closedTabs, executedCommands,
    setActiveTab(input, fire = true, isDirty = false) { activeTab = { input, isDirty }; if (fire) tabsChangeListener?.({ changed: [activeTab], opened: [], closed: [] }); return activeTab; },
    setActiveViewColumn(value) { activeViewColumn = value; },
    setCompareError(error) { comparisonFailure = error; },
    async runCommand(name, ...args) { return commands.get(name)(...args); },
    tabInputDiff(original, modified) { return new vscode.TabInputTextDiff(original, modified); },
    addDocument(uri, text) {
      const document = { uri, text, getText() { return this.text; } };
      documents.set(uri.toString(), document);
      return document;
    },
    changeDocument(uri, text) {
      const document = documents.get(uri.toString());
      assert.ok(document, `expected registered document ${uri.toString()}`);
      document.text = text;
      for (const listener of documentChangeListeners) listener({ document });
    },
  };
}

async function openGridPanel(fixture, filename, viewColumn = 1) {
  const uri = fixture.uri(filename);
  let viewStateListener;
  const panel = { visible: true, viewColumn, webview: {
    cspSource: 'https://webview.example', asWebviewUri: value => value,
    postMessage: async () => true, onDidReceiveMessage: () => ({ dispose() {} }),
  }, onDidDispose: () => ({ dispose() {} }),
  onDidChangeViewState: handler => { viewStateListener = handler; return { dispose() {} }; },
  fireViewStateChange: () => viewStateListener?.() };
  await fixture.provider.resolveCustomTextEditor({ uri, getText: () => `data:${filename}` }, panel);
  fixture.addDocument(uri, `data:${filename}`);
  return { uri, panel };
}

test('compare command starts the table comparison from the active CSV diff exactly once', async () => {
  const fixture = activate();
  const original = await openGridPanel(fixture, 'original.csv');
  const modified = await openGridPanel(fixture, 'modified.tsv');
  const diff = fixture.tabInputDiff(original.uri, modified.uri);
  fixture.setActiveTab(diff, false);

  await fixture.runCommand('tingeltangelbob.csv-simple-editor.compare');
  assert.equal(fixture.comparisons.length, 1, fixture.errors.join('; '));
  assert.equal(fixture.closedTabs.length, 0);
  await fixture.comparisons[0].ready({ type: 'ready' });
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.comparisons[0].messages[0])), {
    type: 'compare', originalText: 'data:original.csv', modifiedText: 'data:modified.tsv',
    originalName: original.uri.toString(), modifiedName: modified.uri.toString(),
    preferences: { colorizeColumns: false, showGridlines: false, responsiveColumns: true, rowHeight: 'compact', theme: 'system', language: null },
  });
  fixture.setActiveTab(diff);
  assert.equal(fixture.comparisons.length, 1, fixture.errors.join('; '));
});

test('compare title action opens the same sources as a text diff without auto-redirecting', async () => {
  const fixture = activate();
  const original = fixture.uri('before.csv');
  const modified = fixture.uri('after.tsv');
  await fixture.runCommand('tingeltangelbob.csv-simple-editor.compare', undefined, [original, modified]);
  assert.equal(fixture.comparisons.length, 1);

  await fixture.runCommand('tingeltangelbob.csv-simple-editor.openAsText');
  assert.equal(fixture.executedCommands.length, 2);
  assert.equal(fixture.executedCommands[0][0], 'vscode.diff');
  assert.equal(fixture.executedCommands[0][1], original);
  assert.equal(fixture.executedCommands[0][2], modified);
  assert.deepEqual(fixture.executedCommands[1], ['reopenActiveEditorWith', 'default']);

  fixture.setActiveTab(fixture.tabInputDiff(original, modified));
  assert.equal(fixture.comparisons.length, 1);
});

test('compare webview saves preferences persistently and broadcasts the saved row height', async () => {
  const fixture = activate({ tablePreferences: { rowHeight: 'compact' } });
  const original = fixture.uri('preferences-before.csv');
  const modified = fixture.uri('preferences-after.csv');
  await fixture.runCommand('tingeltangelbob.csv-simple-editor.compare', undefined, [original, modified]);
  const panel = fixture.comparisons[0];

  await panel.ready({ type: 'ready' });
  await panel.ready({ type: 'saveTablePreferences', preferences: {
    colorizeColumns: true, showGridlines: true, responsiveColumns: false,
    rowHeight: 'normal', theme: 'dark', language: 'de',
  } });

  assert.equal(fixture.storedState.get('tablePreferences').rowHeight, 'normal');
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.storedState.get('tablePreferences'))), {
    colorizeColumns: true, showGridlines: true, responsiveColumns: false,
    rowHeight: 'normal', theme: 'dark', language: 'de',
  });
  assert.ok(panel.messages.some(message => message.type === 'tablePreferences'
    && message.preferences.rowHeight === 'normal' && message.preferences.language === 'de'));
});

test('compare command uses visible CSV editor panels when the active diff input is unknown', async () => {
  const fixture = activate();
  const original = await openGridPanel(fixture, 'unknown-command-before.csv');
  const modified = await openGridPanel(fixture, 'unknown-command-after.csv');
  fixture.setActiveTab(undefined, false);

  await fixture.runCommand('tingeltangelbob.csv-simple-editor.compare');
  assert.equal(fixture.comparisons.length, 1, fixture.errors.join('; '));
  await fixture.comparisons[0].ready({ type: 'ready' });
  const message = JSON.parse(JSON.stringify(fixture.comparisons[0].messages[0]));
  assert.equal(message.originalName, original.uri.toString());
  assert.equal(message.modifiedName, modified.uri.toString());
  assert.deepEqual(message.preferences, { colorizeColumns: false, showGridlines: false, responsiveColumns: true, rowHeight: 'compact', theme: 'system', language: null });
  fixture.setActiveTab(undefined);
  await tick();
  assert.equal(fixture.comparisons.length, 1);
});

test('opens one table comparison when an active CSV diff uses visible CSV editor panels', async () => {
  const fixture = activate();
  const original = await openGridPanel(fixture, 'before.csv');
  const modified = await openGridPanel(fixture, 'after.csv');
  const diff = fixture.tabInputDiff(original.uri, modified.uri);

  fixture.setActiveTab(diff);
  await tick();
  assert.equal(fixture.comparisons.length, 1, fixture.errors.join('; '));
  assert.equal(fixture.closedTabs.length, 1);
  assert.equal(fixture.closedTabs[0].input, diff);
  fixture.comparisons[0].dispose();
  fixture.setActiveTab(diff);
  await tick();
  assert.equal(fixture.comparisons.length, 1, fixture.errors.join('; '));
  fixture.setActiveTab({ uri: original.uri });
  fixture.setActiveTab(diff);
  await tick();
  assert.equal(fixture.comparisons.length, 2);
});

test('does not close a dirty split-diff tab during automatic comparison', async () => {
  const fixture = activate();
  const original = await openGridPanel(fixture, 'dirty-before.csv');
  const modified = await openGridPanel(fixture, 'dirty-after.csv');
  fixture.setActiveTab(fixture.tabInputDiff(original.uri, modified.uri), true, true);
  await tick();
  assert.equal(fixture.comparisons.length, 1);
  assert.equal(fixture.closedTabs.length, 0);
});

test('closes the matching clean UnknownInput diff tab after automatic comparison', async () => {
  const fixture = activate();
  const original = await openGridPanel(fixture, 'unknown-close-before.csv');
  const modified = await openGridPanel(fixture, 'unknown-close-after.csv');
  const diffTab = fixture.setActiveTab(undefined);
  await tick();
  assert.equal(fixture.comparisons.length, 1);
  assert.equal(fixture.closedTabs.length, 1);
  assert.equal(fixture.closedTabs[0], diffTab);
  assert.equal(fixture.closedTabs[0].input, undefined);
  assert.equal(original.panel.visible, true);
  assert.equal(modified.panel.visible, true);
});

test('does not close a dirty UnknownInput diff tab after automatic comparison', async () => {
  const fixture = activate();
  await openGridPanel(fixture, 'unknown-dirty-before.csv');
  await openGridPanel(fixture, 'unknown-dirty-after.csv');
  fixture.setActiveTab(undefined, true, true);
  await tick();
  assert.equal(fixture.comparisons.length, 1);
  assert.equal(fixture.closedTabs.length, 0);
});

test('keeps the split-diff tab open if comparison creation fails', async () => {
  const fixture = activate({ compareError: new Error('panel unavailable') });
  const original = await openGridPanel(fixture, 'fail-before.csv');
  const modified = await openGridPanel(fixture, 'fail-after.csv');
  fixture.setActiveTab(fixture.tabInputDiff(original.uri, modified.uri));
  await tick();
  assert.equal(fixture.comparisons.length, 0);
  assert.equal(fixture.closedTabs.length, 0);
  assert.match(fixture.errors.join('; '), /CSV comparison failed/);
});

test('retries automatic comparison after a failed creation', async () => {
  const fixture = activate({ compareError: new Error('panel unavailable') });
  const original = await openGridPanel(fixture, 'retry-before.csv');
  const modified = await openGridPanel(fixture, 'retry-after.csv');
  const diff = fixture.tabInputDiff(original.uri, modified.uri);
  fixture.setActiveTab(diff);
  await tick();
  assert.equal(fixture.comparisons.length, 0);

  fixture.setCompareError(undefined);
  fixture.setActiveTab(diff);
  await tick();
  assert.equal(fixture.comparisons.length, 1, fixture.errors.join('; '));
});

test('a failed manual comparison does not block later automatic opening', async () => {
  const fixture = activate({ compareError: new Error('panel unavailable') });
  const original = await openGridPanel(fixture, 'manual-retry-before.csv');
  const modified = await openGridPanel(fixture, 'manual-retry-after.csv');
  const diff = fixture.tabInputDiff(original.uri, modified.uri);
  fixture.setActiveTab(diff, false);
  await fixture.runCommand('tingeltangelbob.csv-simple-editor.compare');
  assert.equal(fixture.comparisons.length, 0);

  fixture.setCompareError(undefined);
  fixture.setActiveTab(diff);
  await tick();
  assert.equal(fixture.comparisons.length, 1, fixture.errors.join('; '));
});

test('debounces compare document broadcasts and sends the latest text', async () => {
  const fixture = activate();
  const original = fixture.uri('debounce-before.csv');
  const modified = fixture.uri('debounce-after.csv');
  fixture.addDocument(original, 'before-0');
  fixture.addDocument(modified, 'after-0');
  await fixture.runCommand('tingeltangelbob.csv-simple-editor.compare', undefined, [original, modified]);
  const panel = fixture.comparisons[0];
  await panel.ready({ type: 'ready' });
  assert.equal(panel.messages.filter(message => message.type === 'compare').length, 1);

  fixture.changeDocument(original, 'before-1');
  fixture.changeDocument(original, 'before-2');
  fixture.changeDocument(modified, 'after-1');
  await pause(200);
  const messages = panel.messages.filter(message => message.type === 'compare');
  assert.equal(messages.length, 2);
  assert.equal(messages[1].originalText, 'before-2');
  assert.equal(messages[1].modifiedText, 'after-1');
});

test('ready sends immediately and cancels a queued compare broadcast', async () => {
  const fixture = activate();
  const original = fixture.uri('ready-before.csv');
  const modified = fixture.uri('ready-after.csv');
  fixture.addDocument(original, 'before-0');
  fixture.addDocument(modified, 'after-0');
  await fixture.runCommand('tingeltangelbob.csv-simple-editor.compare', undefined, [original, modified]);
  const panel = fixture.comparisons[0];
  fixture.changeDocument(original, 'before-latest');
  await panel.ready({ type: 'ready' });
  const messages = panel.messages.filter(message => message.type === 'compare');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].originalText, 'before-latest');

  await pause(200);
  assert.equal(panel.messages.filter(message => message.type === 'compare').length, 1);
});

test('disposing a comparison cancels its pending document broadcast', async () => {
  const fixture = activate();
  const original = fixture.uri('dispose-before.csv');
  const modified = fixture.uri('dispose-after.csv');
  fixture.addDocument(original, 'before-0');
  fixture.addDocument(modified, 'after-0');
  await fixture.runCommand('tingeltangelbob.csv-simple-editor.compare', undefined, [original, modified]);
  const panel = fixture.comparisons[0];
  await panel.ready({ type: 'ready' });
  fixture.changeDocument(original, 'before-pending');
  panel.dispose();
  await pause(200);
  assert.equal(panel.messages.filter(message => message.type === 'compare').length, 1);
});

test('a failed close does not invalidate the automatically opened comparison', async () => {
  const fixture = activate({ closeError: new Error('tab could not close') });
  const original = await openGridPanel(fixture, 'close-before.csv');
  const modified = await openGridPanel(fixture, 'close-after.csv');
  fixture.setActiveTab(fixture.tabInputDiff(original.uri, modified.uri));
  await tick();
  assert.equal(fixture.comparisons.length, 1);
  assert.equal(fixture.closedTabs.length, 1);
  assert.equal(fixture.errors.length, 0);
});

test('waits for CSV editor panels to become visible before auto-comparing a diff', async () => {
  const fixture = activate();
  const original = await openGridPanel(fixture, 'late-before.csv');
  const modified = await openGridPanel(fixture, 'late-after.csv');
  original.panel.visible = false;
  modified.panel.visible = false;
  fixture.setActiveTab(fixture.tabInputDiff(original.uri, modified.uri));
  assert.equal(fixture.comparisons.length, 0);

  original.panel.visible = true;
  original.panel.fireViewStateChange();
  assert.equal(fixture.comparisons.length, 0);
  modified.panel.visible = true;
  modified.panel.fireViewStateChange();
  await tick();
  assert.equal(fixture.comparisons.length, 1);
});

test('recovers unknown custom-editor diffs from exactly two visible panels in the active group', async () => {
  const fixture = activate();
  const original = await openGridPanel(fixture, 'unknown-before.csv');
  const modified = await openGridPanel(fixture, 'unknown-after.tsv');
  fixture.setActiveTab(undefined);
  await tick();
  assert.equal(fixture.comparisons.length, 1);
  await fixture.comparisons[0].ready({ type: 'ready' });
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.comparisons[0].messages[0])), {
    type: 'compare', originalText: 'data:unknown-before.csv', modifiedText: 'data:unknown-after.tsv',
    originalName: original.uri.toString(), modifiedName: modified.uri.toString(),
    preferences: { colorizeColumns: false, showGridlines: false, responsiveColumns: true, rowHeight: 'compact', theme: 'system', language: null },
  });
  assert.equal(fixture.closedTabs.length, 1);
});

test('does not pair visible CSV panels across groups or when more than two are visible', async () => {
  const acrossGroups = activate();
  await openGridPanel(acrossGroups, 'group-one.csv', 1);
  await openGridPanel(acrossGroups, 'group-two.csv', 2);
  acrossGroups.setActiveTab(undefined);
  await tick();
  assert.equal(acrossGroups.comparisons.length, 0);

  const extraPanel = activate();
  await openGridPanel(extraPanel, 'one.csv');
  await openGridPanel(extraPanel, 'two.csv');
  await openGridPanel(extraPanel, 'three.csv');
  extraPanel.setActiveTab(undefined);
  await tick();
  assert.equal(extraPanel.comparisons.length, 0);

  const knownInput = activate();
  const first = await openGridPanel(knownInput, 'known-one.csv');
  await openGridPanel(knownInput, 'known-two.csv');
  knownInput.setActiveTab({ uri: first.uri, viewType });
  await tick();
  assert.equal(knownInput.comparisons.length, 0);
});

test('does not auto-open for ordinary text diffs without visible CSV editor panels', async () => {
  const fixture = activate();
  fixture.setActiveTab(fixture.tabInputDiff(fixture.uri('plain-before.csv'), fixture.uri('plain-after.csv')));
  assert.equal(fixture.comparisons.length, 0);

  const original = await openGridPanel(fixture, 'hidden-before.csv');
  const modified = await openGridPanel(fixture, 'hidden-after.csv');
  original.panel.visible = false;
  modified.panel.visible = false;
  fixture.setActiveTab(fixture.tabInputDiff(original.uri, modified.uri));
  assert.equal(fixture.comparisons.length, 0);
});

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

test('stores remembered views separately per file, restores them and removes them on request', async () => {
  const fixture = activate({ fileViewDelay: 5 });
  async function open(filename, scheme = 'file') {
    const messages = [];
    let receive;
    const panel = { webview: { cspSource: 'https://webview.example', asWebviewUri: uri => uri,
      postMessage: async message => { messages.push(message); },
      onDidReceiveMessage: handler => { receive = handler; return { dispose() {} }; } },
      onDidDispose: () => ({ dispose() {} }) };
    const uri = fixture.uri(filename);
    uri.scheme = scheme;
    await fixture.provider.resolveCustomTextEditor({ uri, getText: () => 'Name,City\nAda,Bonn', isDirty: false }, panel);
    await receive({ type: 'ready' });
    return { receive, messages };
  }
  const first = await open('a.csv');
  const second = await open('b.csv');
  const view = { version: 1, columns: [{ name: 'Name', width: 140, filter: { query: 'Ada', values: ['Ada'] } }], sort: { name: 'Name', direction: 1 } };
  await first.receive({ type: 'saveFileView', requestId: 1, enabled: true, view });
  assert.equal(first.messages.at(-1).enabled, true);
  assert.equal(second.messages.find(message => message.type === 'load').fileView, null);
  const reopened = await open('a.csv');
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.messages.find(message => message.type === 'load').fileView)), view);
  await reopened.receive({ type: 'saveFileView', requestId: 2, enabled: false });
  assert.equal((await open('a.csv')).messages.find(message => message.type === 'load').fileView, null);
  const saving = first.receive({ type: 'saveFileView', requestId: 4, enabled: true, view });
  const clearing = first.receive({ type: 'saveFileView', requestId: 5, enabled: false });
  const reopening = open('a.csv');
  await Promise.all([saving, clearing]);
  assert.equal((await reopening).messages.find(message => message.type === 'load').fileView, null);
  const unsaved = await open('Untitled-1', 'untitled');
  assert.equal(unsaved.messages.find(message => message.type === 'load').canRememberFileView, false);
  await unsaved.receive({ type: 'saveFileView', requestId: 3, enabled: true, view });
  assert.equal(unsaved.messages.at(-1).error, true);
});

test('reports storage failures instead of claiming the file view was saved', async () => {
  const fixture = activate({ fileViewError: new Error('Storage unavailable') });
  const messages = [];
  let receive;
  const panel = { webview: { cspSource: 'https://webview.example', asWebviewUri: uri => uri,
    postMessage: async message => { messages.push(message); },
    onDidReceiveMessage: handler => { receive = handler; return { dispose() {} }; } },
    onDidDispose: () => ({ dispose() {} }) };
  await fixture.provider.resolveCustomTextEditor({ uri: fixture.uri('a.csv'), getText: () => 'Name\nAda' }, panel);
  await receive({ type: 'saveFileView', requestId: 1, enabled: true, view: { version: 1, columns: [], sort: null } });
  assert.equal(messages.at(-1).error, true);
  assert.equal(messages.at(-1).enabled, false);
  assert.ok(fixture.errors.some(message => message.includes('Storage unavailable')));
});

test('waits for the active grid cell and queued edits before saving a document', async () => {
  let editCount = 0;
  const fixture = activate({ applyEdit: async () => { editCount += 1; return true; } });
  const messages = [];
  let receive;
  const panel = { webview: {
    cspSource: 'https://webview.example', asWebviewUri: (uri) => uri,
    postMessage: async (message) => { messages.push(message); return true; },
    onDidReceiveMessage: (handler) => { receive = handler; return { dispose() {} }; },
  }, onDidDispose() {} };
  const document = { uri: fixture.uri('autosave.csv'), getText: () => 'Name\nAlice', positionAt: () => ({}), isClosed: false };
  await fixture.provider.resolveCustomTextEditor(document, panel);

  const saveWaits = [];
  fixture.willSaveListeners[0]({ document, waitUntil: (promise) => saveWaits.push(promise) });
  const flushRequest = messages.find((message) => message.type === 'flushBeforeSave');
  assert.ok(flushRequest);
  await receive({ type: 'edit', text: 'Name\nLatest value' });
  await receive({ type: 'saveFlushComplete', requestId: flushRequest.requestId });
  await Promise.all(saveWaits);
  assert.equal(editCount, 1);
});

test('handles webview assets and actions, recovers rejected edits and disposes panel listeners', async () => {
  const fixture = activate({
    applyEdit: async () => { throw new Error('Document is read-only'); },
    tablePreferences: { colorizeColumns: true, showGridlines: false, language: 'de', responsiveColumns: false, rowHeight: 'normal', theme: 'dark' },
  });
  const messages = [];
  let receive;
  let dispose;
  let saveCalls = 0;
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
  const document = { uri: fixture.uri('example.csv'), getText: () => 'Name\nAlice', positionAt: () => ({}), isClosed: false,
    save: async () => { saveCalls += 1; return true; } };
  await fixture.provider.resolveCustomTextEditor(document, panel);
  assert.ok(!panel.webview.html.includes('{{'));
  assert.match(panel.webview.html, /href=".*codicon\.css"/);
  assert.match(panel.webview.html, /font-src https:\/\/webview\.example/);
  assert.match(panel.webview.html, /connect-src https:\/\/webview\.example; worker-src blob:/);
  assert.match(panel.webview.html, /data-csv-worker-src=".*media.*csv\.js"/);
  assert.doesNotMatch(panel.webview.html, /\{\{[^}]+\}\}/);
  assert.ok(fs.statSync(path.join(projectRoot, 'media', 'codicon.ttf')).size > 0);
  const nonces = [...panel.webview.html.matchAll(/nonce="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(nonces.length, 3);
  assert.equal(nonces[0], nonces[1]);
  assert.equal(nonces[0], nonces[2]);
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
  assert.equal(fixture.storedState.get('tablePreferences').rowHeight, 'normal');
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
  await receive({ type: 'saveDocument' });
  await tick();
  assert.equal(saveCalls, 1);
  dispose();
  assert.equal(listenerDisposed, true);
});

async function exportFixture(options = {}) {
  const fixture = activate(options);
  const messages = [];
  let receive;
  const panel = { webview: {
    cspSource: 'https://webview.example', asWebviewUri: (uri) => uri,
    postMessage: async (message) => messages.push(message),
    onDidReceiveMessage: (handler) => { receive = handler; return { dispose() {} }; },
  }, onDidDispose() {} };
  await fixture.provider.resolveCustomTextEditor({ uri: fixture.uri('example.csv') }, panel);
  return { ...fixture, receive, messages };
}

test('exports CSV bytes to the selected destination without applying a document edit', async () => {
  const fixture = await exportFixture({ saveDestination: 'filtered.csv' });
  const text = '\ufeffName;City\r\nÄnne;Köln\r\n';
  await fixture.receive({ type: 'exportTable', format: 'csv', text });
  assert.equal(fixture.exports.length, 1);
  assert.equal(fixture.exports[0].destination, 'filtered.csv');
  assert.equal(fixture.exports[0].bytes.toString('utf8'), text);
  assert.match(fixture.saveDialogs[0].defaultUri.path, /example-filtered\.csv$/);
  assert.equal(fixture.messages.at(-1).type, 'exportFinished');
  assert.deepEqual(fixture.errors, []);
});

test('exports PDF binary data and rejects malformed PDF payloads', async () => {
  const fixture = await exportFixture({ saveDestination: 'filtered.pdf' });
  const data = Buffer.from('%PDF-1.4\n\x00\xff\n%%EOF', 'latin1');
  await fixture.receive({ type: 'exportTable', format: 'pdf', base64: data.toString('base64') });
  assert.deepEqual(fixture.exports[0].bytes, data);
  assert.match(fixture.saveDialogs[0].defaultUri.path, /example-filtered\.pdf$/);
  await fixture.receive({ type: 'exportTable', format: 'pdf', base64: 'invalid' });
  assert.equal(fixture.exports.length, 1);
  assert.match(fixture.errors.at(-1), /Invalid PDF/);
  assert.equal(fixture.messages.at(-1).type, 'exportFinished');
});

test('cancelling export writes nothing and write failures release the export controls', async () => {
  const cancelled = await exportFixture();
  await cancelled.receive({ type: 'exportTable', format: 'csv', text: 'Name\nA' });
  assert.deepEqual(cancelled.exports, []);
  assert.deepEqual(cancelled.errors, []);
  assert.equal(cancelled.messages.at(-1).type, 'exportFinished');
  const failed = await exportFixture({ saveDestination: 'filtered.csv', writeError: new Error('Read-only directory') });
  await failed.receive({ type: 'exportTable', format: 'csv', text: 'Name\nA' });
  assert.match(failed.errors[0], /Read-only directory/);
  assert.equal(failed.messages.at(-1).type, 'exportFinished');
});
