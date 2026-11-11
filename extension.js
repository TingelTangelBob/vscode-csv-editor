'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { normalizeFileView } = require('./media/csv');

const VIEW_TYPE = 'tingeltangelbob.csv-simple-editor.csvGrid';
const EXTENSION_ID = 'tingeltangelbob.csv-simple-editor';
const DEFAULT_EDITOR_SETTING = 'csvSimpleEditor.openByDefault';
const DEFAULT_EDITOR_PATTERNS = ['*.csv', '*.CSV', '*.tsv', '*.TSV'];
const TABLE_PREFERENCES_KEY = 'tablePreferences';
const SUPPORTED_LANGUAGES = ['en', 'de', 'fr', 'es', 'ja', 'zh-cn', 'pt-br', 'ru', 'ko', 'it'];
const PROJECT_URL = 'https://github.com/TingelTangelBob/vscode-csv-editor';
const FEATURE_REQUEST_URL = `${PROJECT_URL}/issues/new`;

function getTablePreferences(context) {
  const stored = context.globalState.get(TABLE_PREFERENCES_KEY, {});
  const saved = stored && typeof stored === 'object' ? stored : {};
  return {
    colorizeColumns: saved.colorizeColumns === true,
    showGridlines: saved.showGridlines === true,
    responsiveColumns: saved.responsiveColumns !== false,
    rowHeight: saved.rowHeight === 'normal' ? 'normal' : 'compact',
    theme: ['system', 'light', 'dark'].includes(saved.theme) ? saved.theme : 'system',
    language: SUPPORTED_LANGUAGES.includes(saved.language) ? saved.language : null,
  };
}

function isCsvDocument(uri) {
  return ['.csv', '.tsv'].includes(path.extname(uri.path).toLowerCase());
}

function createNonce() {
  return crypto.randomBytes(18).toString('base64');
}

function renderWebview(webview, extensionUri) {
  const mediaUri = vscode.Uri.joinPath(extensionUri, 'media');
  const codiconStylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'codicon.css'));
  const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'editor.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'editor.js'));
  const csvScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'csv.js'));
  const exportScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'export.js'));
  const nonce = createNonce();
  const version = JSON.parse(fs.readFileSync(path.join(extensionUri.fsPath, 'package.json'), 'utf8')).version;
  const template = fs.readFileSync(path.join(extensionUri.fsPath, 'media', 'index.html'), 'utf8');

  return template
    .replaceAll('{{CSP_SOURCE}}', webview.cspSource)
    .replaceAll('{{NONCE}}', nonce)
    .replace('{{CODICON_STYLESHEET_URI}}', codiconStylesheetUri.toString())
    .replace('{{STYLESHEET_URI}}', stylesheetUri.toString())
    .replace('{{SCRIPT_URI}}', scriptUri.toString())
    .replace('{{EXPORT_SCRIPT_URI}}', exportScriptUri.toString())
    .replace('{{VERSION}}', version)
    .replaceAll('{{CSV_SCRIPT_URI}}', csvScriptUri.toString());
}

function getDefaultEditorPreference() {
  return vscode.workspace.getConfiguration('csvSimpleEditor').get('openByDefault', true);
}

async function applyDefaultEditorPreference(enabled) {
  const workbench = vscode.workspace.getConfiguration('workbench');
  // Only update user associations; workspace settings must stay in their scope.
  const current = workbench.inspect('editorAssociations')?.globalValue ?? {};
  const targetViewType = enabled ? VIEW_TYPE : 'default';

  if (Array.isArray(current)) {
    const patterns = new Set(DEFAULT_EDITOR_PATTERNS);
    const next = current.filter((entry) => !patterns.has(entry?.filenamePattern));
    for (const filenamePattern of DEFAULT_EDITOR_PATTERNS) {
      next.push({ viewType: targetViewType, filenamePattern });
    }
    const unchanged = DEFAULT_EDITOR_PATTERNS.every((filenamePattern) =>
      current.some((entry) => entry?.filenamePattern === filenamePattern && entry.viewType === targetViewType),
    ) && next.length === current.length;
    if (unchanged) return;
    await workbench.update('editorAssociations', next, vscode.ConfigurationTarget.Global);
    return;
  }

  const next = current && typeof current === 'object' ? { ...current } : {};
  let changed = false;
  for (const filenamePattern of DEFAULT_EDITOR_PATTERNS) {
    if (next[filenamePattern] === targetViewType) continue;
    next[filenamePattern] = targetViewType;
    changed = true;
  }
  if (changed) await workbench.update('editorAssociations', next, vscode.ConfigurationTarget.Global);
}

function activate(context) {
  const panelsByDocument = new Map();
  const applyingFromGrid = new Set();
  const fileViewWrites = new Map();
  const comparisonPanels = new Set();
  const comparedDiffs = new Set();
  const closedDiffsUntilLeave = new Set();
  const textDiffs = new Set();
  let activeComparison = null;
  let panelRegistrationOrder = 0;
  let saveFlushRequestId = 0;

  context.subscriptions.push(vscode.workspace.onWillSaveTextDocument((event) => {
    const entries = panelsByDocument.get(event.document.uri.toString());
    if (!entries?.size) return;

    const flushes = [...entries].map((entry) => new Promise((resolve) => {
      const requestId = ++saveFlushRequestId;
      const timeout = setTimeout(() => {
        entry.pendingSaveFlushes.delete(requestId);
        resolve();
      }, 1000);
      entry.pendingSaveFlushes.set(requestId, () => {
        clearTimeout(timeout);
        entry.pendingSaveFlushes.delete(requestId);
        resolve();
      });
      void entry.panel.webview.postMessage({ type: 'flushBeforeSave', requestId }).then((sent) => {
        if (!sent) entry.pendingSaveFlushes.get(requestId)?.();
      }, () => entry.pendingSaveFlushes.get(requestId)?.());
    }));

    event.waitUntil(Promise.all(flushes).then(async () => {
      await Promise.all([...entries].map((entry) => entry.editQueue));
      return [];
    }));
  }));

  const notifyTablePreferences = () => {
    const message = { type: 'tablePreferences', preferences: getTablePreferences(context) };
    for (const panel of comparisonPanels) void panel.webview.postMessage(message);
    for (const panels of panelsByDocument.values()) {
      for (const entry of panels) void entry.panel.webview.postMessage(message);
    }
  };

  const saveTablePreferences = async (source, input) => {
    const previous = getTablePreferences(context);
    const next = {
      colorizeColumns: input.colorizeColumns === true,
      showGridlines: input.showGridlines === true,
      responsiveColumns: input.responsiveColumns !== false,
      rowHeight: ['compact', 'normal'].includes(input.rowHeight) ? input.rowHeight : previous.rowHeight,
      theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system',
      language: input.language === null ? null : SUPPORTED_LANGUAGES.includes(input.language) ? input.language : 'en',
    };
    try {
      await context.globalState.update(TABLE_PREFERENCES_KEY, next);
      notifyTablePreferences();
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not save CSV table preferences: ${error.message}`);
      void source.webview.postMessage({ type: 'tablePreferences', preferences: getTablePreferences(context) });
    }
  };

  const notifyDefaultEditorPreference = () => {
    const enabled = getDefaultEditorPreference();
    for (const panels of panelsByDocument.values()) {
      for (const entry of panels) {
        void entry.panel.webview.postMessage({ type: 'defaultEditorPreference', enabled });
      }
    }
  };

  const configuredPreference = vscode.workspace.getConfiguration('csvSimpleEditor').inspect('openByDefault');
  if (configuredPreference?.globalValue !== undefined) {
    void applyDefaultEditorPreference(configuredPreference.globalValue !== false).catch((error) => {
      void vscode.window.showErrorMessage(`Could not update the default CSV editor: ${error.message}`);
    });
  }

  const broadcastDocument = (document, messageType = 'load') => {
    const key = document.uri.toString();
    const panels = panelsByDocument.get(key);
    if (!panels) return;

    for (const entry of panels) {
      void entry.panel.webview.postMessage({
        type: messageType,
        text: document.getText(),
        filename: path.basename(document.uri.path),
        dirty: document.isDirty,
      });
    }
  };

  async function openTableComparison(originalUri, modifiedUri) {
    try {
      const [original, modified] = await Promise.all([
        vscode.workspace.openTextDocument(originalUri), vscode.workspace.openTextDocument(modifiedUri),
      ]);
      const panel = vscode.window.createWebviewPanel(`${EXTENSION_ID}.compare`, 'CSV: Compare Tables',
        vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] });
      comparisonPanels.add(panel);
      const comparison = { panel, originalUri, modifiedUri };
      activeComparison = comparison;
      const media = vscode.Uri.joinPath(context.extensionUri, 'media');
      const asset = name => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, name)).toString();
      const nonce = createNonce();
      panel.webview.html = fs.readFileSync(path.join(context.extensionUri.fsPath, 'media', 'compare.html'), 'utf8')
        .replaceAll('{{CSP_SOURCE}}', panel.webview.cspSource).replaceAll('{{NONCE}}', nonce)
        .replaceAll('{{CODICON_STYLESHEET_URI}}', asset('codicon.css'))
        .replaceAll('{{CSV_SCRIPT_URI}}', asset('csv.js')).replaceAll('{{DIFF_SCRIPT_URI}}', asset('csv-diff.js'))
        .replaceAll('{{SCRIPT_URI}}', asset('compare.js')).replaceAll('{{STYLESHEET_URI}}', asset('compare.css'));
      const displayName = uri => uri.scheme === 'file' && uri.fsPath
        ? uri.fsPath.replace(/^[a-z](?=:)/, letter => letter.toUpperCase()) : uri.toString();
      const send = () => panel.webview.postMessage({ type: 'compare', originalText: original.getText(),
        modifiedText: modified.getText(), originalName: displayName(original.uri), modifiedName: displayName(modified.uri),
        preferences: getTablePreferences(context) });
      let changeBroadcastTimer = null;
      const scheduleChangeBroadcast = () => {
        if (changeBroadcastTimer !== null) clearTimeout(changeBroadcastTimer);
        changeBroadcastTimer = setTimeout(() => {
          changeBroadcastTimer = null;
          void send();
        }, 150);
      };
      const receiver = panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.type === 'ready') {
          if (changeBroadcastTimer !== null) clearTimeout(changeBroadcastTimer);
          changeBroadcastTimer = null;
          void send();
          return;
        }
        if (message?.type === 'saveTablePreferences' && message.preferences && typeof message.preferences === 'object') {
          await saveTablePreferences(panel, message.preferences); return;
        }
      });
      const listener = vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document === original || event.document === modified) scheduleChangeBroadcast();
      });
      panel.onDidDispose(() => {
        if (changeBroadcastTimer !== null) clearTimeout(changeBroadcastTimer);
        changeBroadcastTimer = null;
        comparisonPanels.delete(panel);
        if (activeComparison === comparison) activeComparison = null;
        receiver.dispose(); listener.dispose();
      });
      panel.onDidChangeViewState?.(() => { if (panel.active) activeComparison = comparison; });
      return panel;
    } catch (error) {
      void vscode.window.showErrorMessage(`CSV comparison failed: ${error.message}`);
    }
  }

  const visibleCsvPanelsInGroup = (group) => {
    if (group?.viewColumn === undefined) return [];
    return [...panelsByDocument.values()]
      .flatMap((panels) => [...panels])
      .filter((entry) => entry.panel.visible === true && entry.panel.viewColumn === group.viewColumn)
      .sort((left, right) => left.registrationOrder - right.registrationOrder);
  };

  const getActiveCsvDiff = () => {
    const activeGroup = vscode.window.tabGroups.activeTabGroup;
    const activeTab = activeGroup?.activeTab;
    if (!activeTab) return null;
    const input = activeTab.input;
    if (input?.original && input?.modified) {
      if (!isCsvDocument(input.original) || !isCsvDocument(input.modified)) return null;
      return { original: input.original, modified: input.modified };
    }

    // Custom editor diffs are surfaced as UnknownInput by VS Code. Recover their
    // sides only when exactly two visible CSV editor panels occupy the active group.
    // Known text/custom/webview inputs (and tabs without an input) must never guess.
    if (input !== undefined) return null;
    const visiblePanels = visibleCsvPanelsInGroup(activeGroup);
    if (visiblePanels.length !== 2 || visiblePanels[0].uri.toString() === visiblePanels[1].uri.toString()) return null;
    return { original: visiblePanels[0].uri, modified: visiblePanels[1].uri };
  };

  const diffKey = ({ original, modified }) => `${original.toString()}\n${modified.toString()}`;

  const hasVisibleCsvEditorFor = (uri) => {
    const entries = panelsByDocument.get(uri.toString());
    return !!entries && [...entries].some((entry) => entry.panel.visible === true);
  };

  const tryOpenActiveCsvDiff = () => {
    const activeGroup = vscode.window.tabGroups.activeTabGroup;
    const activeTab = activeGroup?.activeTab;
    const diff = getActiveCsvDiff();
    if (!diff || !hasVisibleCsvEditorFor(diff.original) || !hasVisibleCsvEditorFor(diff.modified)) return;
    const input = activeTab?.input;
    const isKnownDiffTab = input?.original?.toString() === diff.original.toString() &&
      input?.modified?.toString() === diff.modified.toString();
    const visiblePanelsInGroup = visibleCsvPanelsInGroup(activeGroup);
    const isUnknownDiffTab = input === undefined && activeGroup?.viewColumn !== undefined &&
      visiblePanelsInGroup.length === 2 &&
      visiblePanelsInGroup[0].uri.toString() === diff.original.toString() &&
      visiblePanelsInGroup[1].uri.toString() === diff.modified.toString();
    const key = diffKey(diff);
    if (comparedDiffs.has(key) || closedDiffsUntilLeave.has(key) || textDiffs.has(key)) return;
    comparedDiffs.add(key);
    void openTableComparison(diff.original, diff.modified).then((panel) => {
      if (!panel) {
        comparedDiffs.delete(key);
        return;
      }
      // Only the automatic handoff from a real VS Code split-diff may close its
      // source tab. Manual comparisons and unsaved source tabs stay intact.
      if (panel && (isKnownDiffTab || isUnknownDiffTab) && !activeTab.isDirty) {
        try { void Promise.resolve(vscode.window.tabGroups.close(activeTab)).catch(() => {}); } catch { /* Keep the comparison open if the diff tab cannot close. */ }
      }
      panel?.onDidDispose(() => {
        comparedDiffs.delete(key);
        closedDiffsUntilLeave.add(key);
      });
    });
  };

  const onDidChangeTabs = () => {
    const active = getActiveCsvDiff();
    const activeKey = active ? diffKey(active) : null;
    for (const key of textDiffs) if (key !== activeKey) textDiffs.delete(key);
    for (const key of closedDiffsUntilLeave) {
      if (key !== activeKey) closedDiffsUntilLeave.delete(key);
    }
    tryOpenActiveCsvDiff();
  };

  const provider = {
    async resolveCustomTextEditor(document, panel) {
      panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      };
      panel.webview.html = renderWebview(panel.webview, context.extensionUri);

      const key = document.uri.toString();
      const fileViewKey = `fileView:${crypto.createHash('sha256').update(key).digest('hex')}`;
      const canRememberFileView = document.uri.scheme !== 'untitled';
      const entry = { panel, uri: document.uri, registrationOrder: panelRegistrationOrder++, editQueue: Promise.resolve(), pendingSaveFlushes: new Map() };
      const panels = panelsByDocument.get(key) ?? new Set();
      panels.add(entry);
      panelsByDocument.set(key, panels);
      tryOpenActiveCsvDiff();
      const viewStateListener = panel.onDidChangeViewState?.(() => tryOpenActiveCsvDiff());

      const removePanel = () => {
        panels.delete(entry);
        if (panels.size === 0) panelsByDocument.delete(key);
      };
      const messageListener = panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.type === 'saveFlushComplete' && Number.isInteger(message.requestId)) {
          entry.pendingSaveFlushes.get(message.requestId)?.();
          return;
        }

        if (message?.type === 'ready') {
          await fileViewWrites.get(fileViewKey);
          void panel.webview.postMessage({ type: 'tablePreferences', preferences: getTablePreferences(context) });
          void panel.webview.postMessage({ type: 'defaultEditorPreference', enabled: getDefaultEditorPreference() });
          void panel.webview.postMessage({
            type: 'load',
            text: document.getText(),
            filename: path.basename(document.uri.path),
            dirty: document.isDirty,
            fileView: canRememberFileView ? normalizeFileView(context.globalState.get(fileViewKey)) : null,
            canRememberFileView,
          });
          return;
        }

        if (message?.type === 'saveFileView' && typeof message.enabled === 'boolean') {
          const previous = fileViewWrites.get(fileViewKey) || Promise.resolve();
          const operation = previous.catch(() => {}).then(async () => {
            try {
              if (!canRememberFileView) throw new Error('Save this file before remembering its view.');
              const view = message.enabled ? normalizeFileView(message.view) : undefined;
              if (message.enabled && !view) throw new Error('The view settings are invalid.');
              await context.globalState.update(fileViewKey, view);
              void panel.webview.postMessage({ type: 'fileViewSaved', requestId: message.requestId, enabled: Boolean(view) });
            } catch (error) {
              void vscode.window.showErrorMessage(`Could not save this file's view: ${error.message}`);
              void panel.webview.postMessage({ type: 'fileViewSaved', requestId: message.requestId,
                enabled: Boolean(normalizeFileView(context.globalState.get(fileViewKey))), error: true });
            }
          });
          fileViewWrites.set(fileViewKey, operation);
          await operation;
          if (fileViewWrites.get(fileViewKey) === operation) fileViewWrites.delete(fileViewKey);
          return;
        }

        if (message?.type === 'saveTablePreferences' && message.preferences && typeof message.preferences === 'object') {
          await saveTablePreferences(panel, message.preferences);
          return;
        }

        if (message?.type === 'setDefaultEditorPreference' && typeof message.enabled === 'boolean') {
          const previousValue = getDefaultEditorPreference();
          try {
            // Apply the editor association first so the UI never reports a saved option
            // when VS Code rejected the association update.
            await applyDefaultEditorPreference(message.enabled);
            await vscode.workspace.getConfiguration('csvSimpleEditor').update(
              'openByDefault',
              message.enabled,
              vscode.ConfigurationTarget.Global,
            );
            notifyDefaultEditorPreference();
          } catch (error) {
            try {
              await applyDefaultEditorPreference(previousValue);
              await vscode.workspace.getConfiguration('csvSimpleEditor').update(
                'openByDefault',
                previousValue,
                vscode.ConfigurationTarget.Global,
              );
            } catch (rollbackError) {
              void vscode.window.showErrorMessage(`Could not restore the default CSV editor setting: ${rollbackError.message}`);
            }
            void vscode.window.showErrorMessage(`Could not update the default CSV editor: ${error.message}`);
            notifyDefaultEditorPreference();
          }
          return;
        }

        if (message?.type === 'openAsText') {
          await vscode.commands.executeCommand('reopenActiveEditorWith', 'default');
          return;
        }

        if (message?.type === 'openProject') {
          try {
            await vscode.env.openExternal(vscode.Uri.parse(PROJECT_URL));
          } catch (error) {
            void vscode.window.showErrorMessage(`Could not open the project on GitHub: ${error.message}`);
          }
          return;
        }

        if (message?.type === 'openFeatureRequest') {
          try {
            await vscode.env.openExternal(vscode.Uri.parse(FEATURE_REQUEST_URL));
          } catch (error) {
            void vscode.window.showErrorMessage(`Could not open the feature request page: ${error.message}`);
          }
          return;
        }

        if (message?.type === 'readClipboard') {
          try {
            const text = await vscode.env.clipboard.readText();
            void panel.webview.postMessage({ type: 'clipboardText', text, requestId: message.requestId });
          } catch (error) {
            void panel.webview.postMessage({ type: 'clipboardText', text: '', requestId: message.requestId });
            void vscode.window.showErrorMessage(`Paste failed: ${error.message}`);
          }
          return;
        }

        if (message?.type === 'copyToClipboard' && typeof message.text === 'string') {
          try {
            await vscode.env.clipboard.writeText(message.text);
            void panel.webview.postMessage({ type: 'clipboardCopied' });
          } catch (error) {
            void vscode.window.showErrorMessage(`Copy failed: ${error.message}`);
          }
          return;
        }

        if (message?.type === 'showExportError' && typeof message.message === 'string') {
          void vscode.window.showErrorMessage(`Export failed: ${message.message}`);
          return;
        }

        if (message?.type === 'exportTable' && ['csv', 'pdf'].includes(message.format)) {
          try {
            let bytes;
            if (message.format === 'csv' && typeof message.text === 'string') bytes = Buffer.from(message.text, 'utf8');
            else if (message.format === 'pdf' && typeof message.base64 === 'string') {
              bytes = Buffer.from(message.base64, 'base64');
              if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF data.');
            } else throw new Error('Invalid export data.');
            const filename = path.basename(document.uri.path, path.extname(document.uri.path));
            const destination = await vscode.window.showSaveDialog({
              defaultUri: document.uri.scheme === 'untitled' ? undefined
                : vscode.Uri.joinPath(document.uri, '..', `${filename}-filtered.${message.format}`),
              filters: message.format === 'pdf' ? { PDF: ['pdf'] } : { CSV: ['csv', 'tsv'] },
              saveLabel: message.format === 'pdf' ? 'Export PDF' : 'Export CSV',
            });
            if (destination) await vscode.workspace.fs.writeFile(destination, bytes);
          } catch (error) {
            void vscode.window.showErrorMessage(`Export failed: ${error.message}`);
          } finally {
            void panel.webview.postMessage({ type: 'exportFinished' });
          }
          return;
        }

        if (message?.type === 'saveDocument') {
          void entry.editQueue.then(async () => {
            if (!document.isClosed) await document.save();
          }).catch((error) => {
            void vscode.window.showErrorMessage(`Could not save CSV: ${error.message}`);
          });
          return;
        }

        if (message?.type !== 'edit' || typeof message.text !== 'string') return;

        entry.editQueue = entry.editQueue.then(async () => {
          if (document.isClosed) return;

          const currentText = document.getText();
          if (currentText !== message.text) {
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.replace(
              document.uri,
              new vscode.Range(document.positionAt(0), document.positionAt(currentText.length)),
              message.text,
            );

            applyingFromGrid.add(key);
            try {
              const applied = await vscode.workspace.applyEdit(workspaceEdit);
              if (!applied) {
                void panel.webview.postMessage({
                  type: 'editRejected',
                  text: document.getText(),
                  filename: path.basename(document.uri.path),
                  dirty: document.isDirty,
                });
                void vscode.window.showErrorMessage('Could not apply the CSV changes.');
                return;
              }
            } finally {
              applyingFromGrid.delete(key);
            }
          }

          void panel.webview.postMessage({ type: 'editApplied', dirty: document.isDirty });
        }).catch((error) => {
          void panel.webview.postMessage({ type: 'editRejected', text: document.getText() });
          void vscode.window.showErrorMessage(`CSV edit failed: ${error.message}`);
        });
      });
      panel.onDidDispose(() => {
        for (const resolve of entry.pendingSaveFlushes.values()) resolve();
        removePanel();
        viewStateListener?.dispose();
        messageListener.dispose();
      });
    },
  };

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { enableFindWidget: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!isCsvDocument(event.document.uri)) return;
      const key = event.document.uri.toString();
      if (applyingFromGrid.has(key)) return;
      broadcastDocument(event.document);
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isCsvDocument(document.uri)) broadcastDocument(document, 'saved');
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(DEFAULT_EDITOR_SETTING)) return;
      const enabled = getDefaultEditorPreference();
      void applyDefaultEditorPreference(enabled).then(notifyDefaultEditorPreference).catch((error) => {
        void vscode.window.showErrorMessage(`Could not update the default CSV editor: ${error.message}`);
      });
    }),
    vscode.window.tabGroups.onDidChangeTabs(onDidChangeTabs),
    vscode.commands.registerCommand(`${EXTENSION_ID}.compare`, async (uri, selected) => {
      let originals = Array.isArray(selected) ? selected.filter(isCsvDocument) : [];
      let activeDiff = getActiveCsvDiff();
      if (originals.length < 2 && activeDiff) {
        originals = [activeDiff.original, activeDiff.modified];
      }
      if (originals.length < 2 && uri && isCsvDocument(uri)) originals = [uri];
      if (!originals.length) {
        const active = [...panelsByDocument.values()].flatMap(panels => [...panels]).find(entry => entry.panel.active);
        if (active) originals = [active.uri];
      }
      if (originals.length < 2) {
        const chosen = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: originals.length ? 'Select comparison file' : 'Select original CSV',
          filters: { 'CSV / TSV': ['csv', 'tsv'] } });
        if (!chosen?.length) return;
        originals.push(chosen[0]);
      }
      if (originals.length < 2) {
        const chosen = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Select comparison file', filters: { 'CSV / TSV': ['csv', 'tsv'] } });
        if (!chosen?.length) return;
        originals.push(chosen[0]);
      }
      activeDiff = getActiveCsvDiff();
      if (activeDiff && activeDiff.original.toString() === originals[0].toString() &&
          activeDiff.modified.toString() === originals[1].toString()) {
        const key = diffKey(activeDiff);
        comparedDiffs.add(key);
        closedDiffsUntilLeave.delete(key);
        const panel = await openTableComparison(originals[0], originals[1]);
        if (!panel) {
          comparedDiffs.delete(key);
          return;
        }
        panel?.onDidDispose(() => {
          comparedDiffs.delete(key);
          closedDiffsUntilLeave.add(key);
        });
        return;
      }
      await openTableComparison(originals[0], originals[1]);
    }),
    vscode.commands.registerCommand(`${EXTENSION_ID}.open`, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isCsvDocument(editor.document.uri)) {
        void vscode.window.showInformationMessage('Open a CSV or TSV file to start the table view.');
        return;
      }

      await vscode.commands.executeCommand('reopenActiveEditorWith', VIEW_TYPE);
    }),
    vscode.commands.registerCommand(`${EXTENSION_ID}.openAsText`, async () => {
      if (activeComparison?.panel.active) {
        const { originalUri, modifiedUri } = activeComparison;
        const diff = { original: originalUri, modified: modifiedUri };
        textDiffs.add(diffKey(diff));
        await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri,
          `${path.basename(originalUri.path)} ↔ ${path.basename(modifiedUri.path)}`);
        await vscode.commands.executeCommand('reopenActiveEditorWith', 'default');
        return;
      }
      const visiblePanel = [...panelsByDocument.values()]
        .flatMap((panels) => [...panels])
        .find((entry) => entry.panel.active);
      if (visiblePanel) {
        await vscode.commands.executeCommand('reopenActiveEditorWith', 'default');
        return;
      }

      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && isCsvDocument(activeEditor.document.uri)) await vscode.commands.executeCommand('reopenActiveEditorWith', 'default');
    }),
  );
  // Cover a diff tab that was already active when the extension finished activating.
  onDidChangeTabs();
}

function deactivate() {}

module.exports = { activate, deactivate };
