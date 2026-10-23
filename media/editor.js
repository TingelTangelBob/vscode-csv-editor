'use strict';

const vscode = acquireVsCodeApi();
const { createEmptySheet, parseCsv, escapeCell, serializeCsv, planCsvImport,
  isColumnFilterActive, filterRows, getColumnFilterValues } = CsvData;
const csvWorkerSourceUri = document.currentScript?.dataset.csvWorkerSrc;
const WORKER_PARSE_THRESHOLD = 256 * 1024;
let csvWorkerPromise = null;
let csvWorker = null;
let nextParseRequestId = 1;
const pendingParseRequests = new Map();
let collator = new Intl.Collator(navigator.language, { numeric: true, sensitivity: 'base' });
const TRANSLATIONS = {
  en: {},
  de: {
    'Fit columns to available width':'Spalten an Fensterbreite anpassen',
    'Appearance':'Darstellung','VS Code theme':'VS-Code-Design','Light':'Hell','Dark':'Dunkel',
    'Search values…':'Werte suchen …','Select all matches':'Alle Suchtreffer auswählen',
    'Select all values':'Alle Werte auswählen','(Blanks)':'(Leere)',
    'No matching values':'Keine passenden Werte','Show more values':'Weitere Werte anzeigen',
    'Values selected':'Werte ausgewählt','Column values':'Spaltenwerte',
    'Paste table':'Tabelle einfügen','CSV or tab-separated data':'CSV- oder tabulatorgetrennte Daten',
    'Insert mode':'Einfügeart','Append rows':'Daten unten anfügen','Replace table':'Tabelle ersetzen',
    'Detect automatically':'Automatisch erkennen','First row contains column names':'Erste Zeile enthält Spaltennamen',
    'Remove duplicate rows from the resulting table':'Doppelte Zeilen aus der resultierenden Tabelle entfernen',
    'Skip empty rows':'Leere Zeilen überspringen','Preview: first 5 incoming rows':'Vorschau: erste 5 einzufügende Zeilen',
    'All existing rows and column names will be replaced.':'Alle vorhandenen Zeilen und Spaltennamen werden ersetzt.',
    'Incoming rows':'Einzufügende Zeilen','Result rows':'Ergebniszeilen','Duplicate rows':'Doppelte Zeilen',
    'Empty rows skipped':'Übersprungene Leerzeilen','Record':'Datensatz','Further issues':'Weitere Probleme',
    'Invalid quotes':'Ungültige Anführungszeichen','Unclosed quoted field':'Nicht geschlossenes Anführungszeichen',
    'No data to import':'Keine Daten zum Einfügen','Empty column names':'Leere Spaltennamen',
    'Duplicate column names':'Doppelte Spaltennamen','Wrong number of columns':'Falsche Spaltenanzahl (vorhanden / erwartet)',
    'Ambiguous target column names':'Vorhandene Spaltennamen sind nicht eindeutig',
    'Missing columns':'Fehlende Spalten','Unknown columns':'Unbekannte Spalten',
    'Columns reordered by name':'Vertauschte Spalten werden anhand ihrer Namen zugeordnet',
    'Columns matched by position':'Spalten werden anhand ihrer Position zugeordnet',
    'Add row':'Zeile hinzufügen','Add column':'Spalte hinzufügen','Delete selected rows':'Ausgewählte Zeilen löschen',
    'Table settings':'Tabelleneinstellungen','More tools':'Weitere Optionen','Delimiter':'Trennzeichen','CSV delimiter':'CSV-Trennzeichen',
    'Comma ,':'Komma ,','Semicolon ;':'Semikolon ;','Tab':'Tabulator','Pipe |':'Pipe |','Clear filters':'Filter zurücksetzen',
    'Clear sorting':'Sortierung zurücksetzen','Open as text':'Als Text öffnen','Buy me a coffee':'Unterstütze das Projekt',
    'Language':'Sprache','Colorize columns':'Spaltenfarben anzeigen','Show table gridlines':'Tabellenlinien anzeigen',
    'Open CSVs as tables':'CSV als Tabelle öffnen','Reset column widths':'Spaltenbreiten zurücksetzen',
    'Filter column':'Spalte filtern','Contains…':'Enthält …','Clear filter':'Filter löschen','Copy cell':'Zelle kopieren',
    'Copy row':'Zeile kopieren','Copy row as list':'Zeile als Liste kopieren','Open column filter':'Spaltenfilter öffnen',
    'Filter by this value':'Nach diesem Wert filtern','Sort ascending':'Aufsteigend sortieren','Sort descending':'Absteigend sortieren',
    'Select column':'Spalte auswählen','Deselect column':'Spalte abwählen','Copy visible column as list (with header)':'Sichtbare Spalte samt Kopfzeile kopieren',
    'Rename column':'Spalte umbenennen','Delete column':'Spalte löschen','Add column':'Spalte hinzufügen','Column name':'Spaltenname',
    'e.g. Product ID':'z. B. Produktnummer','Apply':'Übernehmen','Cancel':'Abbrechen',
    'Confirm deletion':'Löschen bestätigen','Delete':'Löschen','No data rows yet. Add a row to get started.':'Noch keine Datenzeilen. Füge eine Zeile hinzu, um zu beginnen.',
    'No matching rows. Clear or adjust your column filters.':'Keine passenden Zeilen. Setze die Spaltenfilter zurück oder passe sie an.',
    'Select all visible rows':'Alle sichtbaren Zeilen auswählen','Drag to resize column':'Ziehen, um die Spalte zu verbreitern',
    'Double-click to edit':'Doppelklicken zum Bearbeiten','Edit filter':'Filter bearbeiten','Sort by':'Sortieren nach',
    'Resize':'Breite ändern','row':'Zeile','rows':'Zeilen','column':'Spalte','columns':'Spalten','of':'von','filter':'Filter','filters':'Filter',
    'Column':'Spalte','Select row':'Zeile auswählen','Original row number':'Ursprüngliche Zeilennummer',
  },
  fr: {
    'Fit columns to available width':'Adapter les colonnes à la largeur disponible',
    'Appearance':'Apparence','VS Code theme':'Thème VS Code','Light':'Clair','Dark':'Sombre',
    'Search values…':'Rechercher des valeurs…','Select all matches':'Sélectionner tous les résultats',
    'Select all values':'Sélectionner toutes les valeurs','(Blanks)':'(Vides)',
    'No matching values':'Aucune valeur correspondante','Show more values':'Afficher plus de valeurs',
    'Values selected':'Valeurs sélectionnées','Column values':'Valeurs de la colonne',
    'Paste table':'Coller un tableau','CSV or tab-separated data':'Données CSV ou séparées par tabulations',
    'Insert mode':'Mode d’insertion','Append rows':'Ajouter les lignes à la fin','Replace table':'Remplacer le tableau',
    'Detect automatically':'Détecter automatiquement','First row contains column names':'La première ligne contient les noms de colonnes',
    'Remove duplicate rows from the resulting table':'Supprimer les lignes en double du tableau résultant',
    'Skip empty rows':'Ignorer les lignes vides','Preview: first 5 incoming rows':'Aperçu : 5 premières lignes à insérer',
    'All existing rows and column names will be replaced.':'Toutes les lignes et tous les noms de colonnes existants seront remplacés.',
    'Incoming rows':'Lignes à insérer','Result rows':'Lignes résultantes','Duplicate rows':'Lignes en double',
    'Empty rows skipped':'Lignes vides ignorées','Record':'Enregistrement','Further issues':'Autres problèmes',
    'Invalid quotes':'Guillemets invalides','Unclosed quoted field':'Champ entre guillemets non fermé',
    'No data to import':'Aucune donnée à insérer','Empty column names':'Noms de colonnes vides',
    'Duplicate column names':'Noms de colonnes en double','Wrong number of columns':'Nombre de colonnes incorrect (reçu / attendu)',
    'Ambiguous target column names':'Noms de colonnes existants ambigus',
    'Missing columns':'Colonnes manquantes','Unknown columns':'Colonnes inconnues',
    'Columns reordered by name':'Colonnes réordonnées selon leur nom',
    'Columns matched by position':'Colonnes associées selon leur position',
    'Add row':'Ajouter une ligne','Add column':'Ajouter une colonne','Delete selected rows':'Supprimer les lignes sélectionnées',
    'Table settings':'Paramètres du tableau','More tools':'Plus d’outils','Delimiter':'Séparateur','CSV delimiter':'Séparateur CSV',
    'Comma ,':'Virgule ,','Semicolon ;':'Point-virgule ;','Tab':'Tabulation','Pipe |':'Barre verticale |','Clear filters':'Effacer les filtres',
    'Clear sorting':'Effacer le tri','Open as text':'Ouvrir en texte','Buy me a coffee':'Soutenir le projet',
    'Language':'Langue','Colorize columns':'Colorer les colonnes','Show table gridlines':'Afficher le quadrillage',
    'Open CSVs as tables':'Ouvrir les CSV en tableau','Reset column widths':'Réinitialiser la largeur des colonnes',
    'Filter column':'Filtrer la colonne','Contains…':'Contient…','Clear filter':'Effacer le filtre','Copy cell':'Copier la cellule',
    'Copy row':'Copier la ligne','Copy row as list':'Copier la ligne sous forme de liste','Open column filter':'Ouvrir le filtre de colonne',
    'Filter by this value':'Filtrer par cette valeur','Sort ascending':'Trier par ordre croissant','Sort descending':'Trier par ordre décroissant',
    'Select column':'Sélectionner la colonne','Deselect column':'Désélectionner la colonne','Copy visible column as list (with header)':'Copier la colonne visible avec son en-tête',
    'Rename column':'Renommer la colonne','Delete column':'Supprimer la colonne','Column name':'Nom de la colonne',
    'e.g. Product ID':'p. ex. ID produit','Apply':'Appliquer','Cancel':'Annuler','Confirm deletion':'Confirmer la suppression',
    'Delete':'Supprimer','No data rows yet. Add a row to get started.':'Aucune ligne pour le moment. Ajoutez une ligne pour commencer.',
    'No matching rows. Clear or adjust your column filters.':'Aucun résultat. Effacez ou ajustez vos filtres.',
    'Select all visible rows':'Sélectionner toutes les lignes visibles','Drag to resize column':'Faites glisser pour redimensionner la colonne',
    'Double-click to edit':'Double-cliquez pour modifier','Edit filter':'Modifier le filtre','Sort by':'Trier par',
    'Resize':'Redimensionner','row':'ligne','rows':'lignes','column':'colonne','columns':'colonnes','of':'sur','filter':'filtre','filters':'filtres',
    'Column':'Colonne','Select row':'Sélectionner la ligne','Original row number':'Numéro de ligne d’origine',
  },
};
const LOCALES = { en: 'en-US', de: 'de-DE', fr: 'fr-FR' };
const savedState = vscode.getState() ?? {};
const systemLanguage = navigator.language.slice(0, 2).toLowerCase();
let language = savedState.language in TRANSLATIONS ? savedState.language : (systemLanguage in TRANSLATIONS ? systemLanguage : 'en');

function t(key) {
  if (key === 'Loading CSV…') return ({ en: 'Loading CSV…', de: 'CSV wird geladen…', fr: 'Chargement du CSV…' })[language];
  return TRANSLATIONS[language][key] ?? key;
}

function applyTranslations() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
    element.setAttribute('aria-label', element.title);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
}

const elements = {
  toolbar: document.querySelector('.toolbar'),
  toolbarActions: document.querySelector('.toolbar-actions'),
  table: document.getElementById('csv-table'),
  tableColumns: document.getElementById('table-columns'),
  tableHead: document.getElementById('table-head'),
  tableBody: document.getElementById('table-body'),
  tableScroll: document.getElementById('table-scroll'),
  tableStatus: document.getElementById('table-status'),
  addRow: document.getElementById('add-row'),
  addColumn: document.getElementById('add-column'),
  deleteSelected: document.getElementById('delete-selected'),
  selectionCount: document.getElementById('selection-count'),
  delimiter: document.getElementById('delimiter-select'),
  toolsButton: document.getElementById('tools-menu-button'),
  toolsPopover: document.getElementById('tools-popover'),
  settingsButton: document.getElementById('settings-button'),
  settingsPopover: document.getElementById('settings-popover'),
  colorizeColumns: document.getElementById('colorize-columns'),
  showGridlines: document.getElementById('show-gridlines'),
  responsiveColumns: document.getElementById('responsive-columns'),
  appearanceSwitcher: document.getElementById('appearance-switcher'),
  openByDefault: document.getElementById('open-by-default'),
  language: document.getElementById('language-select'),
  filterPopover: document.getElementById('filter-popover'),
  filterLabel: document.getElementById('filter-label'),
  filterInput: document.getElementById('column-filter-input'),
  filterSelectAll: document.getElementById('filter-select-all'),
  filterSelectAllLabel: document.getElementById('filter-select-all-label'),
  filterValues: document.getElementById('filter-values'),
  filterMore: document.getElementById('filter-more'),
  filterSelectionStatus: document.getElementById('filter-selection-status'),
  contextPopover: document.getElementById('context-popover'),
  contextCaption: document.getElementById('context-caption'),
  columnDialog: document.getElementById('column-dialog'),
  columnForm: document.getElementById('column-form'),
  columnTitle: document.getElementById('column-dialog-title'),
  columnName: document.getElementById('column-name'),
  confirmDialog: document.getElementById('confirm-dialog'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmAction: document.getElementById('confirm-action'),
  pasteTable: document.getElementById('paste-table'),
  importDialog: document.getElementById('import-dialog'),
  importForm: document.getElementById('import-form'),
  importText: document.getElementById('import-text'),
  importMode: document.getElementById('import-mode'),
  importDelimiter: document.getElementById('import-delimiter'),
  importHeader: document.getElementById('import-header'),
  importDedupe: document.getElementById('import-dedupe'),
  importSkipEmpty: document.getElementById('import-skip-empty'),
  importSummary: document.getElementById('import-summary'),
  importIssues: document.getElementById('import-issues'),
  importPreview: document.getElementById('import-preview'),
  importReplaceNote: document.getElementById('import-replace-note'),
  importApply: document.getElementById('import-apply'),
};

let sheet = createEmptySheet();
let lastSerializedText = '';
let documentLoaded = false;
let isLoadingDocument = false;
let documentLoadSequence = 0;
let selectedRows = new Set();
let columnFilters = [];
let columnWidths = [];
let displayColumnWidths = [];
let columnWidthOverrides = Array.isArray(vscode.getState()?.columnWidthOverrides)
  ? vscode.getState().columnWidthOverrides
  : [];
let colorizeColumns = vscode.getState()?.colorizeColumns === true;
let showGridlines = vscode.getState()?.showGridlines === true;
let responsiveColumns = vscode.getState()?.responsiveColumns !== false;
let theme = ['system', 'light', 'dark'].includes(vscode.getState()?.theme) ? vscode.getState().theme : 'system';
let lastFilename = '';
let selectedColumn = -1;
let sortState = null;
let visibleRows = [];
let activeColumn = -1;
let activePopover = null;
let contextTarget = null;
let filterDraft = null;
let filterOptions = [];
let filterMatches = [];
let filterGlobalValues = new Set();
let filterShownCount = 0;
const FILTER_VALUES_PAGE_SIZE = 100;
let virtualRenderFrame = null;
let renderedRowStart = -1;
let renderedRowEnd = -1;
let resizeState = null;
let pointerIsDown = false;
let pendingCellRender = false;
let popoverAnchor = null;
let clipboardRequestId = 0;
let pendingClipboardRequest = null;
let importPreviewTimer = null;

const COLUMN_COLORS = [
  'var(--vscode-charts-blue, #2678c8)',
  'var(--vscode-charts-orange, #c77b18)',
  'var(--vscode-charts-green, #3b8d5a)',
  'var(--vscode-charts-purple, #8957b2)',
  'var(--vscode-charts-red, #c84949)',
  'var(--vscode-charts-yellow, #9a7c12)',
  'var(--vscode-charts-blue, #2678c8)',
  'var(--vscode-charts-foreground, #777)',
];
const VIRTUALIZE_AFTER_ROWS = 300;
const TABLE_ROW_HEIGHT = 30;
const VIRTUAL_ROW_OVERSCAN = 12;

function persistViewState() {
  vscode.setState({
    columnWidthOverrides,
    colorizeColumns,
    showGridlines,
    responsiveColumns,
    theme,
    language,
  });
}

function persistTablePreferences() {
  vscode.postMessage({
    type: 'saveTablePreferences',
    preferences: { colorizeColumns, showGridlines, responsiveColumns, theme, language },
  });
}

function updateAppearanceSwitcher() {
  elements.appearanceSwitcher.querySelectorAll('[data-theme]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  });
}

function applyTablePreferences(preferences) {
  if (!preferences || typeof preferences !== 'object') return;
  const changed = colorizeColumns !== (preferences.colorizeColumns === true)
    || showGridlines !== (preferences.showGridlines === true)
    || responsiveColumns !== (preferences.responsiveColumns !== false)
    || theme !== (['system', 'light', 'dark'].includes(preferences.theme) ? preferences.theme : 'system')
    || (preferences.language in TRANSLATIONS && language !== preferences.language);
  colorizeColumns = preferences.colorizeColumns === true;
  showGridlines = preferences.showGridlines === true;
  responsiveColumns = preferences.responsiveColumns !== false;
  theme = ['system', 'light', 'dark'].includes(preferences.theme) ? preferences.theme : 'system';
  if (preferences.language in TRANSLATIONS) language = preferences.language;
  collator = new Intl.Collator(LOCALES[language] || LOCALES.en, { numeric: true, sensitivity: 'base' });
  elements.colorizeColumns.checked = colorizeColumns;
  elements.showGridlines.checked = showGridlines;
  elements.responsiveColumns.checked = responsiveColumns;
  document.body.dataset.theme = theme;
  updateAppearanceSwitcher();
  elements.language.value = language;
  persistViewState();
  applyTranslations();
  if (documentLoaded && changed) renderTable();
}

function columnWidthCss(column) {
  return `${displayColumnWidths[column] ?? columnWidthOverrides[column] ?? columnWidths[column] ?? 80}px`;
}

function applyColumnColor(element, column) {
  element.classList.toggle('is-colorized', colorizeColumns);
  if (colorizeColumns) element.style.setProperty('--column-color', COLUMN_COLORS[column % COLUMN_COLORS.length]);
  else element.style.removeProperty('--column-color');
}

function setDocument(rawText, filename = lastFilename) {
  elements.importDialog.close();
  pendingClipboardRequest = null;
  elements.pasteTable.disabled = false;
  documentLoaded = true;
  lastFilename = filename || lastFilename;
  const loadSequence = ++documentLoadSequence;
  const fallbackDelimiter = /\.tsv$/i.test(lastFilename) ? '\t' : ',';
  const commit = (parsedSheet) => {
    if (loadSequence !== documentLoadSequence) return;
    sheet = parsedSheet;
    isLoadingDocument = false;
    columnWidthOverrides = sheet.headers.map((_, column) => {
      const width = columnWidthOverrides[column];
      return Number.isFinite(width) && width >= 40 ? width : null;
    });
    if (selectedColumn >= sheet.headers.length) selectedColumn = -1;
    elements.colorizeColumns.checked = colorizeColumns;
    elements.showGridlines.checked = showGridlines;
    lastSerializedText = rawText;
    selectedRows.clear();
    sortState = null;
    columnFilters = Array(sheet.headers.length).fill(null);
    recalculateColumnWidths();
    elements.delimiter.value = sheet.delimiter === '\t' ? 'tab' : sheet.delimiter;
    closePopovers();
    renderTable();
  };

  if (rawText.length < WORKER_PARSE_THRESHOLD || typeof Worker === 'undefined' || typeof fetch !== 'function' || !csvWorkerSourceUri) {
    isLoadingDocument = false;
    commit(parseCsv(rawText, fallbackDelimiter));
    return;
  }

  isLoadingDocument = true;
  sheet = createEmptySheet();
  renderTable();
  parseCsvInWorker(rawText, fallbackDelimiter)
    .then(commit)
    .catch(() => {
      if (loadSequence !== documentLoadSequence) return;
      try {
        commit(parseCsv(rawText, fallbackDelimiter));
      } catch (error) {
        isLoadingDocument = false;
        elements.tableStatus.textContent = error.message || 'Could not parse CSV';
        renderTable();
      }
    });
}

function parseCsvInWorker(rawText, fallbackDelimiter) {
  return ensureCsvWorker().then((worker) => new Promise((resolve, reject) => {
    const requestId = nextParseRequestId++;
    pendingParseRequests.set(requestId, { resolve, reject });
    try {
      worker.postMessage({ requestId, text: rawText, fallbackDelimiter });
    } catch (error) {
      pendingParseRequests.delete(requestId);
      reject(error);
    }
  }));
}

function ensureCsvWorker() {
  if (csvWorker) return Promise.resolve(csvWorker);
  if (csvWorkerPromise) return csvWorkerPromise;
  csvWorkerPromise = fetch(csvWorkerSourceUri)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load CSV parser (${response.status})`);
      return response.text();
    })
    .then((source) => {
      const workerBootstrap = `${source}\nself.addEventListener('message', (event) => {\n  const { requestId, text, fallbackDelimiter } = event.data;\n  try { self.postMessage({ requestId, sheet: globalThis.CsvData.parseCsv(text, fallbackDelimiter) }); }\n  catch (error) { self.postMessage({ requestId, error: error && error.message ? error.message : String(error) }); }\n});`;
      const blobUrl = URL.createObjectURL(new Blob([workerBootstrap], { type: 'text/javascript' }));
      try {
        csvWorker = new Worker(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
      csvWorker.addEventListener('message', (event) => {
        const request = pendingParseRequests.get(event.data?.requestId);
        if (!request) return;
        pendingParseRequests.delete(event.data.requestId);
        if (event.data.error) request.reject(new Error(event.data.error));
        else request.resolve(event.data.sheet);
      });
      csvWorker.addEventListener('error', (event) => {
        const error = new Error(event.message || 'CSV parser worker failed');
        csvWorker?.terminate();
        csvWorker = null;
        csvWorkerPromise = null;
        for (const request of pendingParseRequests.values()) request.reject(error);
        pendingParseRequests.clear();
      });
      return csvWorker;
    })
    .catch((error) => {
      csvWorkerPromise = null;
      throw error;
    });
  return csvWorkerPromise;
}

function sendEdit() {
  const text = serializeCsv(sheet);
  if (text === lastSerializedText) return;
  lastSerializedText = text;
  vscode.postMessage({ type: 'edit', text });
}

function isEmptyDocument() {
  return !lastSerializedText.replace(/^\ufeff/, '').trim() && sheet.rows.length === 0 && sheet.headers.every(name => !name.trim());
}

function importOptions() {
  return {
    mode: elements.importMode.value,
    delimiter: elements.importDelimiter.value === 'tab' ? '\t' : elements.importDelimiter.value,
    hasHeader: elements.importHeader.checked,
    dedupe: elements.importDedupe.checked,
    skipEmpty: elements.importSkipEmpty.checked,
  };
}

function updateImportPreview() {
  if (importPreviewTimer !== null) window.clearTimeout(importPreviewTimer);
  importPreviewTimer = null;
  const plan = planCsvImport(sheet, elements.importText.value, importOptions());
  const delimiterName = { ',': 'Comma ,', ';': 'Semicolon ;', '\t': 'Tab', '|': 'Pipe |' }[plan.detectedDelimiter];
  elements.importSummary.textContent = `${t('Incoming rows')}: ${plan.importedCount} · ${t('Result rows')}: ${plan.rows.length} · ${t('Duplicate rows')}: ${plan.duplicates} · ${t('Empty rows skipped')}: ${plan.skipped} · ${t('Delimiter')}: ${t(delimiterName)}`;
  const issues = [...plan.errors.map(issue => ({ ...issue, error: true })), ...plan.warnings];
  elements.importIssues.replaceChildren(...issues.slice(0, 30).map(issue => createElement('li', issue.error ? 'import-error' : '',
    `${t(issue.code)}${issue.record ? ` (${t('Record')} ${issue.record})` : ''}${issue.detail ? `: ${issue.detail}` : ''}`)));
  if (issues.length > 30) elements.importIssues.append(createElement('li', '', `${t('Further issues')}: ${issues.length - 30}`));
  const preview = document.createElement('table');
  const head = document.createElement('thead');
  const heading = document.createElement('tr');
  plan.headers.forEach(name => heading.append(createElement('th', '', name)));
  head.append(heading);
  const body = document.createElement('tbody');
  plan.preview.forEach(cells => {
    const row = document.createElement('tr');
    cells.forEach(value => { const cell = createElement('td', '', value); cell.title = value; row.append(cell); });
    body.append(row);
  });
  preview.append(head, body);
  elements.importPreview.replaceChildren(preview);
  elements.importApply.disabled = plan.errors.length > 0 || isLoadingDocument;
  elements.importReplaceNote.hidden = elements.importMode.value !== 'replace' || isEmptyDocument();
  return plan;
}

function applyImportedTable(plan, append) {
  // Commit once so VS Code can undo the complete import in one step.
  sheet = { headers: plan.headers, rows: plan.rows, delimiter: plan.delimiter, lineEnding: plan.lineEnding,
    bom: plan.bom, trailingNewline: plan.trailingNewline };
  if (!append) columnWidthOverrides = [];
  selectedRows.clear();
  selectedColumn = -1;
  sortState = null;
  columnFilters = Array(sheet.headers.length).fill(null);
  elements.delimiter.value = sheet.delimiter === '\t' ? 'tab' : sheet.delimiter;
  recalculateColumnWidths();
  persistViewState();
  elements.tableScroll.scrollTop = 0;
  renderTable();
  sendEdit();
}

function pasteTable(text, allowDirect = true) {
  if (!documentLoaded || isLoadingDocument || elements.importDialog.open) return;
  closePopovers();
  const empty = isEmptyDocument();
  const plan = planCsvImport(sheet, text, { mode: 'replace' });
  if (empty && allowDirect && plan.tabular && plan.errors.length === 0) {
    applyImportedTable(plan, false);
    return;
  }
  elements.importText.value = text;
  elements.importMode.value = empty ? 'replace' : 'append';
  elements.importMode.querySelector('[value="append"]').disabled = empty;
  elements.importDelimiter.value = 'auto';
  elements.importHeader.checked = true;
  elements.importDedupe.checked = false;
  elements.importSkipEmpty.checked = true;
  updateImportPreview();
  elements.importDialog.showModal();
}

function requestTablePaste() {
  if (!documentLoaded || isLoadingDocument || elements.importDialog.open || pendingClipboardRequest !== null) return;
  pendingClipboardRequest = ++clipboardRequestId;
  elements.pasteTable.disabled = true;
  vscode.postMessage({ type: 'readClipboard', requestId: pendingClipboardRequest });
}
elements.pasteTable.addEventListener('click', requestTablePaste);

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'v') return;
  if (event.target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
  event.preventDefault();
  requestTablePaste();
});

document.addEventListener('paste', event => {
  if (event.defaultPrevented || event.target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
  const text = event.clipboardData?.getData('text/plain');
  if (!text || !documentLoaded || isLoadingDocument) return;
  event.preventDefault();
  pasteTable(text);
});

elements.importForm.addEventListener('input', event => {
  if (importPreviewTimer !== null) window.clearTimeout(importPreviewTimer);
  if (event.target === elements.importText) importPreviewTimer = window.setTimeout(updateImportPreview, 150);
  else updateImportPreview();
});
elements.importForm.addEventListener('submit', event => {
  event.preventDefault();
  const plan = updateImportPreview();
  if (plan.errors.length || isLoadingDocument) return;
  applyImportedTable(plan, elements.importMode.value === 'append');
  elements.importDialog.close();
});
document.getElementById('import-cancel').addEventListener('click', () => elements.importDialog.close());
elements.importDialog.addEventListener('close', () => {
  // A queued close event may arrive after the next paste has reopened the dialog.
  if (elements.importDialog.open) return;
  if (importPreviewTimer !== null) window.clearTimeout(importPreviewTimer);
  importPreviewTimer = null;
  elements.importText.value = '';
  elements.importPreview.replaceChildren();
});

function getVisibleRows() {
  let filtered = filterRows(sheet.rows, columnFilters);

  if (sortState) {
    if (filtered === sheet.rows) filtered = filtered.slice();
    const { column, direction } = sortState;
    filtered.sort((left, right) => {
      const result = collator.compare(left.cells[column] ?? '', right.cells[column] ?? '');
      return (result * direction) || (left.id - right.id);
    });
  }
  return filtered;
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function makeIconButton(className, label, datasetKey, datasetValue, iconMarkup) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = label;
  button.setAttribute('aria-label', label);
  if (datasetKey) button.dataset[datasetKey] = String(datasetValue);
  button.innerHTML = iconMarkup;
  return button;
}

function renderHeader() {
  const titleRow = document.createElement('tr');
  const selectHeader = createElement('th', 'row-number-head');
  const selectAll = document.createElement('input');
  selectAll.type = 'checkbox';
  selectAll.id = 'select-visible-rows';
  selectAll.title = t('Select all visible rows');
  selectAll.setAttribute('aria-label', selectAll.title);
  selectAll.disabled = visibleRows.length === 0;
  updateSelectAll(selectAll);
  selectHeader.append(selectAll);
  titleRow.append(selectHeader);

  sheet.headers.forEach((header, column) => {
    const th = createElement('th', 'data-heading');
    th.dataset.column = String(column);
    th.classList.toggle('is-column-selected', selectedColumn === column);
    applyColumnColor(th, column);

    const layout = createElement('div', 'heading-content');
    const sortButton = document.createElement('button');
    sortButton.type = 'button';
    sortButton.className = 'sort-button';
    sortButton.dataset.sort = String(column);
    sortButton.title = `${t('Sort by')} ${header.trim() || `${t('Column')} ${column + 1}`}`;
    sortButton.setAttribute('aria-label', sortButton.title);
    if (sortState?.column === column) sortButton.classList.add('is-sorted');
    th.setAttribute('aria-sort', sortState?.column === column
      ? (sortState.direction > 0 ? 'ascending' : 'descending')
      : 'none');
    const name = createElement('span', '', header.trim() ? header : `${t('Column')} ${column + 1}`);
    sortButton.append(name);
    const indicators = createElement('span', 'sort-indicators');
    for (const direction of [1, -1]) {
      const directionButton = createElement('button', 'sort-direction');
      directionButton.type = 'button';
      directionButton.dataset.sort = String(column);
      directionButton.dataset.sortDirection = String(direction);
      const isActiveSortDirection = sortState?.column === column && sortState.direction === direction;
      const arrowIcon = createElement('span', `material-arrow-icon material-arrow-small-${direction > 0 ? 'up' : 'down'}`);
      arrowIcon.setAttribute('aria-hidden', 'true');
      directionButton.append(arrowIcon);
      directionButton.title = t(direction > 0 ? 'Sort ascending' : 'Sort descending');
      directionButton.setAttribute('aria-label', directionButton.title);
      directionButton.setAttribute('aria-pressed', String(isActiveSortDirection));
      indicators.append(directionButton);
    }

    const hasColumnFilter = isColumnFilterActive(columnFilters[column]);
    const filterButton = makeIconButton(
      'header-button filter-button',
      hasColumnFilter ? t('Edit filter') : t('Filter column'),
      'filterToggle',
      column,
      `<span class="codicon codicon-${hasColumnFilter ? 'filter-filled' : 'filter'}" aria-hidden="true"></span>`,
    );
    filterButton.classList.toggle('is-active', hasColumnFilter);
    filterButton.setAttribute('aria-haspopup', 'true');
    filterButton.setAttribute('aria-expanded', String(activePopover === elements.filterPopover && activeColumn === column));

    layout.append(sortButton, indicators, filterButton);
    th.append(layout);
    const resizeHandle = createElement('span', 'column-resize-handle');
    resizeHandle.dataset.resizeColumn = String(column);
    resizeHandle.title = t('Drag to resize column');
    resizeHandle.setAttribute('role', 'separator');
    resizeHandle.setAttribute('aria-orientation', 'vertical');
    resizeHandle.setAttribute('aria-label', `${t('Resize')} ${header.trim() || `${t('Column')} ${column + 1}`}`);
    resizeHandle.tabIndex = 0;
    th.append(resizeHandle);
    titleRow.append(th);
  });
  elements.tableHead.replaceChildren(titleRow);
}

function renderBody() {
  const fragment = document.createDocumentFragment();

  if (visibleRows.length === 0) {
    const row = document.createElement('tr');
    const cell = createElement('td', 'empty-state', isLoadingDocument ? t('Loading CSV…') : t(sheet.rows.length === 0
      ? 'No data rows yet. Add a row to get started.'
      : 'No matching rows. Clear or adjust your column filters.'));
    cell.colSpan = sheet.headers.length + 1;
    row.append(cell);
    fragment.append(row);
    renderedRowStart = 0;
    renderedRowEnd = 0;
  } else {
    const { start, end } = getRenderedRowRange();
    appendVirtualSpacer(fragment, start * TABLE_ROW_HEIGHT);
    for (let index = start; index < end; index += 1) {
      const row = visibleRows[index];
      const tr = document.createElement('tr');
      tr.classList.toggle('is-selected', selectedRows.has(row.id));
      tr.classList.toggle('is-striped', index % 2 === 1);

      const rowHeader = createElement('td', 'row-number-cell');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedRows.has(row.id);
      checkbox.dataset.selectRow = String(row.id);
      checkbox.title = `${t('Select row')} ${row.id}`;
      checkbox.setAttribute('aria-label', checkbox.title);
      rowHeader.title = `${t('Original row number')} ${row.id}`;
      rowHeader.append(checkbox, createElement('span', '', String(row.id)));
      tr.append(rowHeader);

      sheet.headers.forEach((_, column) => {
        const value = row.cells[column] ?? '';
        const td = createElement('td', 'data-cell', value);
        td.dataset.rowId = String(row.id);
        td.dataset.column = String(column);
        td.classList.toggle('is-column-selected', selectedColumn === column);
        applyColumnColor(td, column);
        td.tabIndex = 0;
        td.title = value ? `${value}\nDouble-click to edit` : 'Double-click to edit';
        if (!value) td.classList.add('empty-cell');
        tr.append(td);
      });
      fragment.append(tr);
    }
    appendVirtualSpacer(fragment, (visibleRows.length - end) * TABLE_ROW_HEIGHT);
    renderedRowStart = start;
    renderedRowEnd = end;
  }
  elements.tableBody.replaceChildren(fragment);
}

function getRenderedRowRange() {
  const count = visibleRows.length;
  if (count <= VIRTUALIZE_AFTER_ROWS) return { start: 0, end: count };
  const viewportHeight = elements.tableScroll.clientHeight || 600;
  const firstVisible = Math.floor(elements.tableScroll.scrollTop / TABLE_ROW_HEIGHT);
  const start = Math.max(0, firstVisible - VIRTUAL_ROW_OVERSCAN);
  const end = Math.min(count, Math.max(start + 1,
    Math.ceil((elements.tableScroll.scrollTop + viewportHeight) / TABLE_ROW_HEIGHT) + VIRTUAL_ROW_OVERSCAN));
  return { start, end };
}

function appendVirtualSpacer(fragment, height) {
  if (height <= 0) return;
  const row = document.createElement('tr');
  row.className = 'virtual-spacer';
  row.setAttribute('aria-hidden', 'true');
  const cell = document.createElement('td');
  cell.colSpan = sheet.headers.length + 1;
  cell.style.height = `${height}px`;
  row.append(cell);
  fragment.append(row);
}

function scheduleVirtualRowRender() {
  if (virtualRenderFrame !== null) return;
  virtualRenderFrame = window.requestAnimationFrame(() => {
    virtualRenderFrame = null;
    if (visibleRows.length <= VIRTUALIZE_AFTER_ROWS) return;
    const { start, end } = getRenderedRowRange();
    if (start === renderedRowStart && end === renderedRowEnd) return;
    renderBody();
  });
}

function updateToolbar() {
  const locale = LOCALES[language] || LOCALES.en;
  const number = (value) => value.toLocaleString(locale);
  const filterCount = columnFilters.filter(isColumnFilterActive).length;
  const visibleCount = visibleRows.length;
  const filtered = visibleCount !== sheet.rows.length;
  const rowCount = sheet.rows.length;
  const result = filtered
    ? `${number(visibleCount)} ${t('of')} ${number(rowCount)} ${t(rowCount === 1 ? 'row' : 'rows')}`
    : `${number(rowCount)} ${t(rowCount === 1 ? 'row' : 'rows')}`;
  const filterStatus = filterCount ? ` · ${number(filterCount)} ${t(filterCount === 1 ? 'filter' : 'filters')}` : '';
  const columnCount = sheet.headers.length;
  elements.tableStatus.textContent = `${result} · ${number(columnCount)} ${t(columnCount === 1 ? 'column' : 'columns')}${filterStatus}`;
  elements.tableStatus.title = elements.tableStatus.textContent;
  elements.addRow.disabled = isLoadingDocument;
  elements.addColumn.disabled = isLoadingDocument;
  elements.pasteTable.disabled = isLoadingDocument || pendingClipboardRequest !== null;
  elements.deleteSelected.disabled = isLoadingDocument || selectedRows.size === 0;
  elements.selectionCount.textContent = selectedRows.size.toLocaleString(locale);
  elements.selectionCount.hidden = selectedRows.size === 0;
}

function updateSelectAll(checkbox = document.getElementById('select-visible-rows')) {
  if (!checkbox) return;
  if (selectedRows.size === 0) {
    checkbox.checked = false;
    checkbox.indeterminate = false;
    return;
  }
  const count = visibleRows.reduce((total, row) => total + Number(selectedRows.has(row.id)), 0);
  checkbox.checked = count > 0 && count === visibleRows.length;
  checkbox.indeterminate = count > 0 && count < visibleRows.length;
}

function renderTable() {
  pendingCellRender = false;
  visibleRows = getVisibleRows();
  elements.table.classList.toggle('has-gridlines', showGridlines);
  const numberColumn = document.createElement('col');
  numberColumn.style.width = 'var(--row-number-width)';
  elements.tableColumns.replaceChildren(numberColumn, ...sheet.headers.map((_, column) => {
    const col = document.createElement('col');
    col.style.width = columnWidthCss(column);
    return col;
  }));
  updateTableWidth();
  renderHeader();
  renderBody();
  updateToolbar();
}

function recalculateColumnWidths(columns = null) {
  const columnsToMeasure = columns ?? sheet.headers.map((_, column) => column);
  if (columns === null) columnWidths = Array(sheet.headers.length);
  // Measure the actual UI fonts instead of estimating character counts. Inspect
  // every row so late values and wide glyphs also fit when automatic sizing is used.
  const probe = document.createElement('table');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;top:0;left:0;';
  const th = probe.createTHead().insertRow().appendChild(document.createElement('th'));
  const button = createElement('button', 'sort-button');
  th.append(button);
  const td = probe.createTBody().insertRow().insertCell();
  td.className = 'data-cell';
  document.body.append(probe);
  const headerStyle = getComputedStyle(button);
  const headingStyle = getComputedStyle(th);
  const cellStyle = getComputedStyle(td);
  const font = style => `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const headerFont = font(headerStyle);
  const cellFont = font(cellStyle);
  const padding = style => parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  // Include a gridline even when gridlines are currently hidden.
  const headerPadding = padding(headerStyle) + padding(headingStyle) + 1;
  const cellPadding = padding(cellStyle) + 1;
  probe.remove();
  const context = document.createElement('canvas').getContext('2d');
  const widths = new Map();
  const measure = value => {
    const text = String(value ?? '').replace(/[ \t\r\n\f]+/g, ' ').trim();
    if (widths.has(text)) return widths.get(text);
    const width = context.measureText(text).width;
    if (widths.size < 4096) widths.set(text, width);
    return width;
  };
  context.font = headerFont;
  for (const column of columnsToMeasure) {
    const header = sheet.headers[column] ?? '';
    columnWidths[column] = Math.max(40, Math.ceil(measure(header.trim() ? header : `${t('Column')} ${column + 1}`) + headerPadding));
  }
  context.font = cellFont;
  widths.clear();
  for (const row of sheet.rows) {
    for (const column of columnsToMeasure) {
      columnWidths[column] = Math.max(columnWidths[column], Math.ceil(measure(row.cells[column]) + cellPadding));
    }
  }
}

function updateTableWidth() {
  const widths = sheet.headers.map((_, column) => columnWidthOverrides[column] ?? columnWidths[column] ?? 80);
  const flexible = sheet.headers.map((_, column) => column).filter(column => !Number.isFinite(columnWidthOverrides[column]));
  const numberWidth = parseFloat(getComputedStyle(elements.table).getPropertyValue('--row-number-width')) || 43;
  const minimumWidth = widths.reduce((sum, width) => sum + width, numberWidth);
  const spare = responsiveColumns ? Math.max(0, elements.tableScroll.clientWidth - minimumWidth) : 0;
  const flexibleWidth = flexible.reduce((sum, column) => sum + widths[column], 0);
  if (spare > 0 && flexibleWidth > 0) {
    for (const column of flexible) widths[column] += spare * widths[column] / flexibleWidth;
  }
  displayColumnWidths = widths;
  sheet.headers.forEach((_, column) => {
    const col = elements.tableColumns.children[column + 1];
    if (col) col.style.width = columnWidthCss(column);
  });
  elements.table.style.width = `calc(var(--row-number-width) + ${sheet.headers.map((_, column) => columnWidthCss(column)).join(' + ')})`;
}

function applyColumnWidth(column, width) {
  const value = Math.max(40, width);
  columnWidthOverrides[column] = value;
  elements.tableColumns.children[column + 1].style.width = `${value}px`;
  updateTableWidth();
  return value;
}

function resetColumnWidths() {
  columnWidthOverrides = Array(sheet.headers.length).fill(null);
  persistViewState();
  closePopovers();
  renderTable();
}

function focusCell(rowId, column) {
  let cell = elements.tableBody.querySelector(`[data-row-id="${rowId}"][data-column="${column}"]`);
  if (!cell && visibleRows.length > VIRTUALIZE_AFTER_ROWS) {
    const rowIndex = visibleRows.findIndex((row) => row.id === rowId);
    if (rowIndex >= 0) {
      elements.tableScroll.scrollTop = elements.tableHead.offsetHeight + (rowIndex * TABLE_ROW_HEIGHT);
      renderBody();
      cell = elements.tableBody.querySelector(`[data-row-id="${rowId}"][data-column="${column}"]`);
    }
  }
  if (cell) {
    cell.focus();
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function focusNeighbor(rowId, column, direction) {
  const rowIndex = visibleRows.findIndex((row) => row.id === rowId);
  let nextColumn = column + direction;
  let nextRow = rowIndex;
  if (nextColumn >= sheet.headers.length) {
    nextColumn = 0;
    nextRow += 1;
  } else if (nextColumn < 0) {
    nextColumn = sheet.headers.length - 1;
    nextRow -= 1;
  }
  if (nextRow >= 0 && nextRow < visibleRows.length) focusCell(visibleRows[nextRow].id, nextColumn);
}

function beginCellEdit(cell) {
  if (!cell || cell.querySelector('textarea')) return;
  const rowId = Number(cell.dataset.rowId);
  const column = Number(cell.dataset.column);
  const row = sheet.rows.find((item) => item.id === rowId);
  if (!row) return;

  const originalValue = row.cells[column] ?? '';
  const editor = document.createElement('textarea');
  editor.className = 'cell-editor';
  editor.rows = Math.min(4, Math.max(1, originalValue.split('\n').length));
  editor.value = originalValue;
  editor.setAttribute('aria-label', `Edit ${sheet.headers[column] || `Column ${column + 1}`}`);
  cell.replaceChildren(editor);
  editor.focus();
  editor.select();

  let finished = false;
  const finish = (save, moveDirection = 0, fromBlur = false) => {
    if (finished) return;
    finished = true;
    if (save) {
      row.cells[column] = editor.value;
      recalculateColumnWidths([column]);
      sendEdit();
    }
    // Keep the pointer's target alive until its click has been dispatched.
    // Rebuilding here would swallow clicks on other cells and column headers.
    if (fromBlur && pointerIsDown) {
      cell.textContent = row.cells[column] ?? '';
      cell.classList.toggle('empty-cell', !row.cells[column]);
      pendingCellRender = true;
      return;
    }
    renderTable();
    if (moveDirection) focusNeighbor(rowId, column, moveDirection);
    else if (!fromBlur) focusCell(rowId, column);
  };

  editor.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      finish(true, event.shiftKey ? -1 : 1);
    }
  });
  editor.addEventListener('blur', () => finish(true, 0, true), { once: true });
}

function flushCellRender() {
  if (!pendingCellRender) return;
  const focused = document.activeElement;
  const rowId = focused?.dataset.rowId;
  const column = focused?.dataset.column;
  renderTable();
  if (rowId !== undefined && column !== undefined) focusCell(Number(rowId), Number(column));
}

document.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
const finishPointerInteraction = () => {
  pointerIsDown = false;
  if (pendingCellRender) window.setTimeout(flushCellRender, 0);
};
document.addEventListener('pointerup', finishPointerInteraction, true);
document.addEventListener('pointercancel', finishPointerInteraction, true);
window.addEventListener('blur', () => {
  pointerIsDown = false;
  flushCellRender();
});

function openColumnDialog(mode, column = -1) {
  elements.columnTitle.textContent = t(mode === 'rename' ? 'Rename column' : 'Add column');
  elements.columnName.value = mode === 'rename' ? (sheet.headers[column] || '') : '';
  elements.columnName.placeholder = t(mode === 'rename' ? 'Column name' : 'e.g. Product ID');

  return new Promise((resolve) => {
    elements.columnDialog.addEventListener('close', () => {
      const result = elements.columnDialog.returnValue === 'save' ? elements.columnName.value.trim() : '';
      resolve(result);
    }, { once: true });
    elements.columnDialog.showModal();
    window.setTimeout(() => elements.columnName.focus(), 0);
  });
}

function confirmAction(message) {
  elements.confirmMessage.textContent = message;
  document.getElementById('confirm-title').textContent = t('Confirm deletion');
  return new Promise((resolve) => {
    elements.confirmDialog.addEventListener('close', () => {
      resolve(elements.confirmDialog.returnValue === 'confirm');
    }, { once: true });
    elements.confirmDialog.showModal();
  });
}

function positionPopover(popover, anchor) {
  popover.hidden = false;
  const anchorRect = anchor.getBoundingClientRect();
  const rect = popover.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - rect.width - 8));
  let top = anchorRect.bottom + 5;
  if (top + rect.height > window.innerHeight - 8) top = Math.max(8, anchorRect.top - rect.height - 5);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function closePopovers(restoreFocus = false) {
  const anchor = popoverAnchor;
  for (const popover of [elements.toolsPopover, elements.settingsPopover, elements.filterPopover, elements.contextPopover]) popover.hidden = true;
  document.querySelectorAll('[aria-expanded="true"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  activePopover = null;
  activeColumn = -1;
  contextTarget = null;
  popoverAnchor = null;
  filterDraft = null;
  filterOptions = [];
  filterMatches = [];
  filterGlobalValues = new Set();
  elements.filterValues.replaceChildren();
  if (restoreFocus && anchor) {
    const currentAnchor = anchor.isConnected ? anchor
      : elements.tableHead.querySelector(`[data-filter-toggle="${anchor.dataset.filterToggle}"]`);
    currentAnchor?.focus();
  }
}

function openToolsPopover() {
  if (activePopover === elements.toolsPopover) {
    closePopovers();
    return;
  }
  closePopovers();
  activePopover = elements.toolsPopover;
  popoverAnchor = elements.toolsButton;
  elements.toolsButton.setAttribute('aria-expanded', 'true');
  positionPopover(elements.toolsPopover, elements.toolsButton);
  elements.toolsPopover.focus({ preventScroll: true });
}

function openSettingsPopover() {
  if (activePopover === elements.settingsPopover) {
    closePopovers();
    return;
  }
  closePopovers();
  activePopover = elements.settingsPopover;
  popoverAnchor = elements.settingsButton;
  elements.settingsButton.setAttribute('aria-expanded', 'true');
  positionPopover(elements.settingsPopover, elements.settingsButton);
  elements.settingsPopover.focus({ preventScroll: true });
}

function openFilterPopover(column, anchor) {
  if (activePopover === elements.filterPopover && activeColumn === column) {
    closePopovers();
    return;
  }
  closePopovers();
  activePopover = elements.filterPopover;
  activeColumn = column;
  popoverAnchor = anchor;
  elements.filterLabel.textContent = `${t('Filter column')}: ${sheet.headers[column]?.trim() || `${t('Column')} ${column + 1}`}`;
  const current = columnFilters[column];
  elements.filterInput.value = current?.query || '';
  filterGlobalValues = new Set(sheet.rows.map(row => String(row.cells[column] ?? '')));
  filterDraft = new Set(current?.values instanceof Set ? current.values : filterGlobalValues);
  filterOptions = getColumnFilterValues(sheet.rows, columnFilters, column)
    .sort((a, b) => (a.value === '' ? -1 : b.value === '' ? 1 : collator.compare(a.value, b.value)));
  elements.filterPopover.querySelector('[data-action="clear-column-filter"]').disabled = !isColumnFilterActive(current);
  renderFilterValues();
  positionPopover(elements.filterPopover, anchor);
  anchor.setAttribute('aria-expanded', 'true');
  elements.filterInput.focus();
  elements.filterInput.select();
}

function updateFilterSelection() {
  const selected = filterMatches.reduce((count, item) => count + Number(filterDraft.has(item.value)), 0);
  elements.filterSelectAll.checked = filterMatches.length > 0 && selected === filterMatches.length;
  elements.filterSelectAll.indeterminate = selected > 0 && selected < filterMatches.length;
  elements.filterSelectAll.disabled = !filterMatches.length;
  elements.filterSelectAllLabel.textContent = t(elements.filterInput.value.trim() ? 'Select all matches' : 'Select all values');
  elements.filterSelectionStatus.textContent = `${selected}/${filterMatches.length}`;
}

function appendFilterValues() {
  const fragment = document.createDocumentFragment();
  const end = Math.min(filterShownCount + FILTER_VALUES_PAGE_SIZE, filterMatches.length);
  for (let index = filterShownCount; index < end; index += 1) {
    const { value, count } = filterMatches[index];
    const label = createElement('label', 'filter-value');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = filterDraft.has(value);
    checkbox.dataset.filterValueIndex = String(index);
    const text = createElement('span', 'filter-value-text', value === '' ? t('(Blanks)') : value);
    text.title = value === '' ? t('(Blanks)') : value;
    label.append(checkbox, text, createElement('span', 'filter-value-count', String(count)));
    fragment.append(label);
  }
  elements.filterValues.append(fragment);
  filterShownCount = end;
  elements.filterMore.hidden = end >= filterMatches.length;
}

function renderFilterValues() {
  const query = elements.filterInput.value.trim().toLocaleLowerCase();
  filterMatches = filterOptions.filter(item => !query || item.value.toLocaleLowerCase().includes(query));
  filterShownCount = 0;
  elements.filterValues.replaceChildren();
  elements.filterValues.scrollTop = 0;
  appendFilterValues();
  if (!filterMatches.length) elements.filterValues.append(createElement('div', 'filter-selection-status', t('No matching values')));
  updateFilterSelection();
}

elements.filterValues.addEventListener('change', event => {
  const index = event.target.dataset.filterValueIndex;
  if (!filterDraft || index === undefined) return;
  const value = filterMatches[Number(index)].value;
  if (event.target.checked) filterDraft.add(value);
  else filterDraft.delete(value);
  updateFilterSelection();
});
elements.filterSelectAll.addEventListener('change', () => {
  if (!filterDraft) return;
  for (const { value } of filterMatches) {
    if (elements.filterSelectAll.checked) filterDraft.add(value);
    else filterDraft.delete(value);
  }
  elements.filterValues.querySelectorAll('input').forEach(input => {
    input.checked = filterDraft.has(filterMatches[Number(input.dataset.filterValueIndex)].value);
  });
  updateFilterSelection();
});
elements.filterMore.addEventListener('click', appendFilterValues);
document.getElementById('filter-cancel').addEventListener('click', () => closePopovers(true));
document.getElementById('column-filter-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!filterDraft || activeColumn < 0) return;
  const query = elements.filterInput.value.trim();
  const allSelected = [...filterGlobalValues].every(value => filterDraft.has(value));
  const filter = { query, values: allSelected ? null : new Set(filterDraft) };
  const column = activeColumn;
  columnFilters[column] = isColumnFilterActive(filter) ? filter : null;
  closePopovers();
  renderTable();
  elements.tableHead.querySelector(`[data-filter-toggle="${column}"]`)?.focus();
});

function openContextPopover(column, rowId, kind, clientX, clientY) {
  closePopovers();
  activePopover = elements.contextPopover;
  activeColumn = column;
  contextTarget = { rowId, column, kind };
  popoverAnchor = document.activeElement;
  const header = column >= 0 ? (sheet.headers[column]?.trim() || `${t('Column')} ${column + 1}`) : '';
  const row = rowId === null ? null : sheet.rows.find((item) => item.id === rowId);
  const value = row && column >= 0 ? String(row.cells[column] ?? '') : '';
  elements.contextCaption.textContent = kind === 'cell'
    ? header + ': ' + (value || '(empty)')
    : (kind === 'row' ? `${t('row')} ${rowId}` : header);
  elements.contextPopover.querySelectorAll('.context-cell-action').forEach((item) => {
    item.hidden = kind !== 'cell';
  });
  elements.contextPopover.querySelectorAll('.context-column-action').forEach((item) => {
    item.hidden = kind !== 'column' && kind !== 'cell';
  });
  elements.contextPopover.querySelectorAll('.context-row-or-cell-action').forEach((item) => {
    item.hidden = kind !== 'row' && kind !== 'cell';
  });
  const filterValueButton = elements.contextPopover.querySelector('[data-action="filter-value"]');
  filterValueButton.disabled = !row;
  const deleteButton = elements.contextPopover.querySelector('[data-action="delete-column"]');
  deleteButton.disabled = sheet.headers.length <= 1;
  const selectColumnButton = elements.contextPopover.querySelector('[data-action="select-column"]');
  const selectColumnLabel = selectColumnButton.querySelector('[data-i18n]');
  selectColumnLabel.dataset.i18n = selectedColumn === column ? 'Deselect column' : 'Select column';
  selectColumnLabel.textContent = t(selectColumnLabel.dataset.i18n);
  selectColumnButton.setAttribute('aria-pressed', String(selectedColumn === column));
  elements.contextPopover.querySelector('[data-action="copy-row-list"]').disabled = !row;
  elements.contextPopover.hidden = false;
  const rect = elements.contextPopover.getBoundingClientRect();
  const left = Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8));
  let top = clientY;
  if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
  elements.contextPopover.style.left = `${left}px`;
  elements.contextPopover.style.top = `${top}px`;
  elements.contextPopover.querySelector('button:not([hidden]):not(:disabled)')?.focus();
}

function clearFilters() {
  columnFilters = Array(sheet.headers.length).fill(null);
  closePopovers();
  renderTable();
}

function clearSort() {
  sortState = null;
  closePopovers();
  renderTable();
}

function addRow() {
  columnFilters = Array(sheet.headers.length).fill(null);
  selectedRows.clear();
  const row = {
    id: sheet.rows.reduce((maximum, item) => Math.max(maximum, item.id), 0) + 1,
    cells: Array(sheet.headers.length).fill(''),
  };
  sheet.rows.push(row);
  renderTable();
  sendEdit();
  focusCell(row.id, 0);
}

async function addColumn() {
  const name = await openColumnDialog('add');
  if (!name) return;
  sheet.headers.push(name);
  sheet.rows.forEach((row) => row.cells.push(''));
  columnFilters.push(null);
  columnWidthOverrides.push(null);
  persistViewState();
  recalculateColumnWidths([sheet.headers.length - 1]);
  renderTable();
  sendEdit();
}

async function renameColumn(column) {
  closePopovers();
  const name = await openColumnDialog('rename', column);
  if (!name) return;
  sheet.headers[column] = name;
  recalculateColumnWidths([column]);
  renderTable();
  sendEdit();
}

async function deleteColumn(column) {
  if (sheet.headers.length <= 1) return;
  const columnName = sheet.headers[column]?.trim() || `Column ${column + 1}`;
  closePopovers();
  const confirmed = await confirmAction(`Delete “${columnName}” and all values in this column?`);
  if (!confirmed) return;

  sheet.headers.splice(column, 1);
  sheet.rows.forEach((row) => row.cells.splice(column, 1));
  columnFilters.splice(column, 1);
  columnWidths.splice(column, 1);
  columnWidthOverrides.splice(column, 1);
  persistViewState();
  if (selectedColumn === column) selectedColumn = -1;
  else if (selectedColumn > column) selectedColumn -= 1;
  if (sortState) {
    if (sortState.column === column) sortState = null;
    else if (sortState.column > column) sortState.column -= 1;
  }
  renderTable();
  sendEdit();
}

async function deleteSelectedRows() {
  if (selectedRows.size === 0) return;
  const selectedCount = selectedRows.size;
  const confirmed = await confirmAction(`Delete ${selectedCount.toLocaleString('en-US')} selected ${selectedCount === 1 ? 'row' : 'rows'}?`);
  if (!confirmed) return;

  sheet.rows = sheet.rows.filter((row) => !selectedRows.has(row.id));
  selectedRows.clear();
  recalculateColumnWidths();
  renderTable();
  sendEdit();
}

elements.columnForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!elements.columnName.value.trim()) {
    elements.columnName.focus();
    return;
  }
  elements.columnDialog.close('save');
});

document.querySelector('[data-column-cancel]').addEventListener('click', () => elements.columnDialog.close('cancel'));
document.getElementById('add-row').addEventListener('click', addRow);
document.getElementById('add-column').addEventListener('click', () => void addColumn());
elements.deleteSelected.addEventListener('click', () => void deleteSelectedRows());
elements.toolsButton.addEventListener('click', openToolsPopover);
elements.settingsButton.addEventListener('click', openSettingsPopover);
elements.colorizeColumns.addEventListener('change', () => {
  colorizeColumns = elements.colorizeColumns.checked;
  persistViewState();
  persistTablePreferences();
  renderTable();
});
elements.showGridlines.addEventListener('change', () => {
  showGridlines = elements.showGridlines.checked;
  persistViewState();
  persistTablePreferences();
  renderTable();
});

elements.responsiveColumns.checked = responsiveColumns;
document.body.dataset.theme = theme;
updateAppearanceSwitcher();
elements.responsiveColumns.addEventListener('change', () => {
  responsiveColumns = elements.responsiveColumns.checked;
  updateTableWidth();
  persistViewState();
  persistTablePreferences();
});
elements.appearanceSwitcher.addEventListener('click', (event) => {
  const button = event.target.closest('[data-theme]');
  if (!button || !elements.appearanceSwitcher.contains(button)) return;
  theme = button.dataset.theme;
  document.body.dataset.theme = theme;
  updateAppearanceSwitcher();
  persistViewState();
  persistTablePreferences();
});
elements.language.value = language;
applyTranslations();
elements.language.addEventListener('change', () => {
  language = elements.language.value in TRANSLATIONS ? elements.language.value : 'en';
  collator = new Intl.Collator(LOCALES[language] || LOCALES.en, { numeric: true, sensitivity: 'base' });
  persistViewState();
  persistTablePreferences();
  applyTranslations();
  renderTable();
  if (activePopover === elements.settingsPopover) positionPopover(elements.settingsPopover, elements.settingsButton);
});
elements.openByDefault.addEventListener('change', () => {
  elements.openByDefault.disabled = true;
  vscode.postMessage({ type: 'setDefaultEditorPreference', enabled: elements.openByDefault.checked });
});

elements.table.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('[data-resize-column]');
  if (!handle || event.button !== 0) return;
  event.preventDefault();
  const column = Number(handle.dataset.resizeColumn);
  const header = elements.tableHead.querySelector('th[data-column="' + column + '"]');
  if (!header) return;
  closePopovers();
  handle.setPointerCapture(event.pointerId);
  handle.classList.add('is-dragging');
  resizeState = {
    handle,
    column,
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: header.getBoundingClientRect().width,
  };
  document.body.classList.add('is-resizing-column');
});

document.addEventListener('pointermove', (event) => {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  resizeState.currentWidth = applyColumnWidth(resizeState.column, resizeState.startWidth + event.clientX - resizeState.startX);
});

document.addEventListener('pointerup', (event) => {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  const resizedColumn = resizeState.column;
  const finalWidth = resizeState.currentWidth ?? resizeState.startWidth;
  resizeState.handle.classList.remove('is-dragging');
  resizeState = null;
  document.body.classList.remove('is-resizing-column');
  applyColumnWidth(resizedColumn, finalWidth);
  persistViewState();
});

document.addEventListener('pointercancel', (event) => {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  const resizedColumn = resizeState.column;
  const finalWidth = resizeState.currentWidth ?? resizeState.startWidth;
  resizeState.handle.classList.remove('is-dragging');
  resizeState = null;
  document.body.classList.remove('is-resizing-column');
  applyColumnWidth(resizedColumn, finalWidth);
  persistViewState();
});

elements.table.addEventListener('click', (event) => {
  const filterButton = event.target.closest('[data-filter-toggle]');
  if (filterButton) {
    openFilterPopover(Number(filterButton.dataset.filterToggle), filterButton);
    return;
  }

  const sortButton = event.target.closest('[data-sort]');
  if (sortButton) {
    const column = Number(sortButton.dataset.sort);
    const direction = Number(sortButton.dataset.sortDirection);
    sortState = Number.isFinite(direction) && direction !== 0
      ? { column, direction }
      : (sortState?.column === column ? { column, direction: sortState.direction * -1 } : { column, direction: 1 });
    renderTable();
    return;
  }

  const rowCheckbox = event.target.closest('[data-select-row]');
  if (rowCheckbox) {
    const rowId = Number(rowCheckbox.dataset.selectRow);
    if (rowCheckbox.checked) selectedRows.add(rowId);
    else selectedRows.delete(rowId);
    rowCheckbox.closest('tr').classList.toggle('is-selected', rowCheckbox.checked);
    updateSelectAll();
    updateToolbar();
    return;
  }

  if (event.target.id === 'select-visible-rows') {
    visibleRows.forEach((row) => {
      if (event.target.checked) selectedRows.add(row.id);
      else selectedRows.delete(row.id);
    });
    renderTable();
    return;
  }

  const heading = event.target.closest('th[data-column]');
  if (heading && !event.target.closest('button, [data-resize-column]')) {
    const column = Number(heading.dataset.column);
    selectedColumn = selectedColumn === column ? -1 : column;
    renderTable();
  }
});

elements.table.addEventListener('contextmenu', (event) => {
  const cell = event.target.closest('[data-row-id][data-column]');
  const heading = event.target.closest('th[data-column]');
  const rowHeading = event.target.closest('.row-number-cell');
  const target = cell || heading || rowHeading;
  if (!target) return;
  event.preventDefault();
  const column = target.dataset.column === undefined ? -1 : Number(target.dataset.column);
  const rowId = cell ? Number(cell.dataset.rowId) : null;
  const rowHeaderId = rowHeading ? Number(rowHeading.querySelector('[data-select-row]')?.dataset.selectRow || rowHeading.textContent.trim()) : null;
  openContextPopover(column, rowId ?? rowHeaderId, cell ? 'cell' : (rowHeading ? 'row' : 'column'), event.clientX, event.clientY);
});

elements.table.addEventListener('dblclick', (event) => {
  const resizeHandle = event.target.closest('[data-resize-column]');
  if (resizeHandle) {
    const column = Number(resizeHandle.dataset.resizeColumn);
    columnWidthOverrides[column] = null;
    persistViewState();
    renderTable();
    return;
  }
  const cell = event.target.closest('[data-row-id][data-column]');
  if (cell) beginCellEdit(cell);
});

elements.table.addEventListener('keydown', (event) => {
  const resizeHandle = event.target.closest('[data-resize-column]');
  if (resizeHandle && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const column = Number(resizeHandle.dataset.resizeColumn);
    const header = elements.tableHead.querySelector('th[data-column="' + column + '"]');
    const currentWidth = header?.getBoundingClientRect().width || 120;
    applyColumnWidth(column, currentWidth + (event.key === 'ArrowRight' ? 12 : -12));
    persistViewState();
    return;
  }
  const cell = event.target.closest('[data-row-id][data-column]');
  if (cell && event.target === cell && !event.altKey && !event.ctrlKey && !event.metaKey) {
    const rowId = Number(cell.dataset.rowId);
    const column = Number(cell.dataset.column);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      focusNeighbor(rowId, column, event.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const rowIndex = visibleRows.findIndex((row) => row.id === rowId);
      const neighbor = visibleRows[rowIndex + (event.key === 'ArrowDown' ? 1 : -1)];
      if (neighbor) focusCell(neighbor.id, column);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusCell(rowId, event.key === 'Home' ? 0 : sheet.headers.length - 1);
      return;
    }
  }
  if (cell && event.target === cell && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    const row = sheet.rows.find((item) => item.id === Number(cell.dataset.rowId));
    const column = Number(cell.dataset.column);
    if (row) vscode.postMessage({ type: 'copyToClipboard', text: row.cells[column] ?? '' });
    return;
  }
  if (cell && event.target === cell && (event.key === 'Enter' || event.key === 'F2')) {
    event.preventDefault();
    beginCellEdit(cell);
  }
});

elements.filterInput.addEventListener('input', () => {
  if (filterDraft) renderFilterValues();
});

elements.delimiter.addEventListener('change', () => {
  sheet.delimiter = elements.delimiter.value === 'tab' ? '\t' : elements.delimiter.value;
  closePopovers();
  sendEdit();
});

document.addEventListener('click', (event) => {
  if (event.target.closest('.popover, #tools-menu-button, #settings-button, [data-filter-toggle]')) return;
  if (activePopover) closePopovers();
});

document.addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  const column = activeColumn;
  const target = contextTarget;

  if (action === 'reset-column-widths') resetColumnWidths();
  else if (action === 'clear-filters') clearFilters();
  else if (action === 'clear-sort') clearSort();
  else if (action === 'open-text') {
    closePopovers();
    vscode.postMessage({ type: 'openAsText' });
  } else if (action === 'open-project') {
    closePopovers(true);
    vscode.postMessage({ type: 'openProject' });
  } else if (action === 'clear-column-filter' && column >= 0) {
    columnFilters[column] = null;
    closePopovers();
    renderTable();
  } else if ((action === 'copy-cell' || action === 'copy-row') && target?.kind === 'cell') {
    const row = sheet.rows.find((item) => item.id === target.rowId);
    if (!row) return;
    const copiedText = action === 'copy-cell'
      ? (row.cells[target.column] ?? '')
      : row.cells.map((value) => escapeCell(value, '\t')).join('\t');
    closePopovers();
    vscode.postMessage({ type: 'copyToClipboard', text: copiedText });
  } else if (action === 'copy-row-list' && (target?.kind === 'row' || target?.kind === 'cell')) {
    const row = sheet.rows.find((item) => item.id === target.rowId);
    if (!row) return;
    closePopovers();
    vscode.postMessage({ type: 'copyToClipboard', text: row.cells.map((value) => String(value ?? '')).join('\n') });
  } else if (action === 'copy-column-list' && column >= 0) {
    const values = [sheet.headers[column] || 'Column ' + (column + 1)];
    visibleRows.forEach((row) => values.push(String(row.cells[column] ?? '')));
    closePopovers();
    vscode.postMessage({ type: 'copyToClipboard', text: values.join('\n') });
  } else if (action === 'select-column' && column >= 0) {
    selectedColumn = selectedColumn === column ? -1 : column;
    closePopovers();
    renderTable();
  } else if (action === 'filter-column' && column >= 0) {
    const filterButton = elements.tableHead.querySelector(`th[data-column="${column}"] [data-filter-toggle]`);
    closePopovers();
    if (filterButton) openFilterPopover(column, filterButton);
  } else if (action === 'filter-value' && target?.kind === 'cell') {
    const row = sheet.rows.find((item) => item.id === target.rowId);
    if (!row) return;
    columnFilters[target.column] = { query: '', values: new Set([String(row.cells[target.column] ?? '')]) };
    closePopovers();
    renderTable();
  } else if ((action === 'sort-ascending' || action === 'sort-descending') && target) {
    sortState = { column: target.column, direction: action === 'sort-ascending' ? 1 : -1 };
    closePopovers();
    renderTable();
  } else if (action === 'rename-column' && column >= 0) {
    void renameColumn(column);
  } else if (action === 'delete-column' && column >= 0) {
    void deleteColumn(column);
  }
});

elements.tableScroll.addEventListener('scroll', () => {
  if (activePopover === elements.filterPopover || activePopover === elements.contextPopover || activePopover === elements.settingsPopover) closePopovers();
  scheduleVirtualRowRender();
}, { passive: true });

window.addEventListener('resize', () => {
  updateTableWidth();
  scheduleVirtualRowRender();
  if (activePopover) closePopovers();
});

new ResizeObserver(() => {
  if (documentLoaded) updateTableWidth();
}).observe(elements.tableScroll);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activePopover) {
    event.preventDefault();
    closePopovers(true);
  }
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'clipboardText' && message.requestId === pendingClipboardRequest && typeof message.text === 'string') {
    pendingClipboardRequest = null;
    elements.pasteTable.disabled = false;
    pasteTable(message.text);
  }
  if ((message.type === 'load' || message.type === 'editRejected') && typeof message.text === 'string') setDocument(message.text, message.filename);
  if (message.type === 'tablePreferences') applyTablePreferences(message.preferences);
  if (message.type === 'defaultEditorPreference' && typeof message.enabled === 'boolean') {
    elements.openByDefault.checked = message.enabled;
    elements.openByDefault.disabled = false;
  }
});

vscode.postMessage({ type: 'ready' });
