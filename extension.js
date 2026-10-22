'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'tingeltangelbob.csv-simple-editor.csvGrid';
const EXTENSION_ID = 'tingeltangelbob.csv-simple-editor';

function isCsvDocument(uri) {
  return ['.csv', '.tsv'].includes(path.extname(uri.path).toLowerCase());
}

function createNonce() {
  return crypto.randomBytes(18).toString('base64');
}

function renderWebview(webview, extensionUri) {
  const mediaUri = vscode.Uri.joinPath(extensionUri, 'media');
  const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'editor.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'editor.js'));
  const nonce = createNonce();
  const template = fs.readFileSync(path.join(extensionUri.fsPath, 'media', 'index.html'), 'utf8');

  return template
    .replaceAll('{{CSP_SOURCE}}', webview.cspSource)
    .replace('{{NONCE}}', nonce)
    .replace('{{STYLESHEET_URI}}', stylesheetUri.toString())
    .replace('{{SCRIPT_URI}}', scriptUri.toString());
}

function activate(context) {
  const panelsByDocument = new Map();
  const applyingFromGrid = new Set();

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
      panel.onDidDispose(removePanel, null, context.subscriptions);

      panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.type === 'ready') {
          broadcastDocument(document);
          return;
        }

        if (message?.type === 'openAsText') {
          await vscode.commands.executeCommand('reopenActiveEditorWith', 'default');
          return;
        }

        if (message?.type === 'copyToClipboard' && typeof message.text === 'string') {
          try {
            await vscode.env.clipboard.writeText(message.text);
            void panel.webview.postMessage({ type: 'clipboardCopied' });
          } catch (error) {
            void vscode.window.showErrorMessage(`Kopieren fehlgeschlagen: ${error.message}`);
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
                void vscode.window.showErrorMessage('Die CSV-Änderung konnte nicht übernommen werden.');
                return;
              }
            } finally {
              applyingFromGrid.delete(key);
            }
          }

          void panel.webview.postMessage({ type: 'editApplied', dirty: document.isDirty });
        }).catch((error) => {
          void vscode.window.showErrorMessage(`CSV-Änderung fehlgeschlagen: ${error.message}`);
        });
      }, null, context.subscriptions);
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
    vscode.commands.registerCommand(`${EXTENSION_ID}.open`, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isCsvDocument(editor.document.uri)) {
        void vscode.window.showInformationMessage('Öffne eine CSV- oder TSV-Datei, um die Tabellenansicht zu starten.');
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
