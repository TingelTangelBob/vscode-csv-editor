'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

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

  const notifyTablePreferences = () => {
    const message = { type: 'tablePreferences', preferences: getTablePreferences(context) };
    for (const panels of panelsByDocument.values()) {
      for (const entry of panels) void entry.panel.webview.postMessage(message);
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

  const provider = {
    async resolveCustomTextEditor(document, panel) {
      panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      };
      panel.webview.html = renderWebview(panel.webview, context.extensionUri);

      const key = document.uri.toString();
      const entry = { panel, uri: document.uri, editQueue: Promise.resolve() };
      const panels = panelsByDocument.get(key) ?? new Set();
      panels.add(entry);
      panelsByDocument.set(key, panels);

      const removePanel = () => {
        panels.delete(entry);
        if (panels.size === 0) panelsByDocument.delete(key);
      };
      const messageListener = panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.type === 'ready') {
          void panel.webview.postMessage({ type: 'tablePreferences', preferences: getTablePreferences(context) });
          void panel.webview.postMessage({ type: 'defaultEditorPreference', enabled: getDefaultEditorPreference() });
          void panel.webview.postMessage({
            type: 'load',
            text: document.getText(),
            filename: path.basename(document.uri.path),
            dirty: document.isDirty,
          });
          return;
        }

        if (message?.type === 'saveTablePreferences' && message.preferences && typeof message.preferences === 'object') {
          const preferences = {
            colorizeColumns: message.preferences.colorizeColumns === true,
            showGridlines: message.preferences.showGridlines === true,
            responsiveColumns: message.preferences.responsiveColumns !== false,
            theme: ['system', 'light', 'dark'].includes(message.preferences.theme) ? message.preferences.theme : 'system',
            language: SUPPORTED_LANGUAGES.includes(message.preferences.language) ? message.preferences.language : 'en',
          };
          try {
            await context.globalState.update(TABLE_PREFERENCES_KEY, preferences);
            notifyTablePreferences();
          } catch (error) {
            void vscode.window.showErrorMessage(`Could not save CSV table preferences: ${error.message}`);
            void panel.webview.postMessage({ type: 'tablePreferences', preferences: getTablePreferences(context) });
          }
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
        removePanel();
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
    vscode.commands.registerCommand(`${EXTENSION_ID}.open`, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isCsvDocument(editor.document.uri)) {
        void vscode.window.showInformationMessage('Open a CSV or TSV file to start the table view.');
        return;
      }

      await vscode.commands.executeCommand('reopenActiveEditorWith', VIEW_TYPE);
    }),
    vscode.commands.registerCommand(`${EXTENSION_ID}.openAsText`, async () => {
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
}

function deactivate() {}

module.exports = { activate, deactivate };
