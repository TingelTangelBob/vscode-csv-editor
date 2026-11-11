'use strict';

const vscode = acquireVsCodeApi();
const status = document.getElementById('compare-status');
const settingsButton = document.getElementById('settings-button');
const previousChangeButton = document.getElementById('previous-change');
const nextChangeButton = document.getElementById('next-change');
const changeNavigationStatus = document.getElementById('change-navigation-status');
const settingsPopover = document.getElementById('settings-popover');
const rowHeightSelect = document.getElementById('row-height');
const gridlinesToggle = document.getElementById('show-gridlines');
const themeSelect = document.getElementById('theme-select');
const languageSelect = document.getElementById('language-select');
const panes = {
  before: { scroll: document.getElementById('before-scroll'), table: document.getElementById('before-table'), name: document.getElementById('before-name') },
  after: { scroll: document.getElementById('after-scroll'), table: document.getElementById('after-table'), name: document.getElementById('after-name') },
};
let layoutFrame = 0;
let lastComparison = null;
let lastResult = null;
let preferences = {};
let changedRowIndices = [];
let activeChangeIndex = -1;
const german = { 'CSV comparison': 'CSV-Vergleich', Changed: 'Geändert', Added: 'Hinzugefügt', Removed: 'Entfernt', 'Missing field': 'Fehlendes Feld', 'Missing column': 'Fehlende Spalte', 'Empty header': 'Leere Überschrift', 'This column does not exist in this file': 'Diese Spalte fehlt in dieser Datei', '(empty header)': '(leere Überschrift)', '(empty)': '(leer)', Value: 'Wert', 'Field missing in this record': 'Feld fehlt in dieser Zeile', 'Row added in modified file': 'Zeile in der neuen Datei hinzugefügt', 'Row removed from original file': 'Zeile aus der ursprünglichen Datei entfernt', 'Original file': 'Ursprüngliche Datei', 'Modified file': 'Neue Datei', 'Comparison data is incomplete.': 'Vergleichsdaten sind unvollständig.', 'Could not compare files': 'Dateien konnten nicht verglichen werden' };
const germanSettings = { Display: 'Anzeige', 'Row height': 'Zeilenhöhe', Compact: 'Kompakt', Normal: 'Normal', 'Show table gridlines': 'Tabellengitternetzlinien anzeigen', Appearance: 'Erscheinungsbild', System: 'System', Light: 'Hell', Dark: 'Dunkel', Language: 'Sprache', 'Table settings': 'Tabelleneinstellungen' };
function comparisonLanguage() { return preferences.language || navigator.language.toLowerCase().split('-')[0]; }
function localize(text) { return comparisonLanguage() === 'de' ? (german[text] || germanSettings[text] || text) : text; }
Object.assign(germanSettings, { 'Previous changed row': 'Vorherige ge\u00e4nderte Zeile', 'Next changed row': 'N\u00e4chste ge\u00e4nderte Zeile' });
function applyPreferences(next) {
  preferences = next || {};
  document.documentElement.lang = comparisonLanguage() === 'de' ? 'de' : 'en';
  document.body.dataset.theme = preferences.theme || 'system';
  document.body.classList.toggle('has-gridlines', preferences.showGridlines === true);
  document.body.dataset.rowHeight = preferences.rowHeight === 'compact' ? 'compact' : 'normal';
  gridlinesToggle.checked = preferences.showGridlines === true;
  rowHeightSelect.value = document.body.dataset.rowHeight;
  themeSelect.value = ['system', 'light', 'dark'].includes(preferences.theme) ? preferences.theme : 'system';
  const browserLanguage = navigator.language.toLowerCase().split('-')[0];
  const selectedLanguage = preferences.language || browserLanguage;
  languageSelect.value = [...languageSelect.options].some((option) => option.value === selectedLanguage) ? selectedLanguage : 'en';
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = localize(node.dataset.i18n); });
  settingsButton.title = localize('Table settings');
  settingsButton.setAttribute('aria-label', localize('Table settings'));
  for (const [button, label] of [[previousChangeButton, 'Previous changed row'], [nextChangeButton, 'Next changed row']]) {
    button.title = localize(label);
    button.setAttribute('aria-label', localize(label));
  }
}

function savePreference(changes) {
  updateComparisonPreferences({ ...preferences, ...changes });
  vscode.postMessage({ type: 'saveTablePreferences', preferences });
}

function updateComparisonPreferences(next) {
  const previousLanguage = preferences.language;
  applyPreferences(next);
  if (lastComparison && lastResult) {
    lastComparison = { ...lastComparison, preferences };
    if (previousLanguage !== preferences.language) {
      const positions = Object.values(panes).map(pane => [pane.scroll.scrollLeft, pane.scroll.scrollTop]);
      renderPane('before', lastResult.columns, lastResult.rows, lastComparison.originalName, 'Original file');
      renderPane('after', lastResult.columns, lastResult.rows, lastComparison.modifiedName, 'Modified file');
      Object.values(panes).forEach((pane, index) => {
        [pane.scroll.scrollLeft, pane.scroll.scrollTop] = positions[index];
      });
    }
    updateComparisonStatus(lastResult);
    updateChangeNavigationStatus();
  }
  scheduleAlignment();
}

function openSettings() {
  const opening = settingsPopover.hidden;
  settingsPopover.hidden = !opening;
  settingsButton.setAttribute('aria-expanded', String(opening));
  if (!opening) return;
  const anchor = settingsButton.getBoundingClientRect();
  settingsPopover.style.top = `${Math.max(8, Math.min(anchor.bottom + 5, window.innerHeight - settingsPopover.offsetHeight - 8))}px`;
  settingsPopover.style.left = `${Math.max(8, Math.min(anchor.right - settingsPopover.offsetWidth, window.innerWidth - settingsPopover.offsetWidth - 8))}px`;
  rowHeightSelect.focus({ preventScroll: true });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setName(node, name, fallback) {
  node.textContent = typeof name === 'string' && name ? name : localize(fallback);
  node.title = node.textContent;
}

// Diff Unicode code points (rather than UTF-16 halves). Keep the quadratic
// path bounded; very long values use a common-prefix/suffix fallback.
function changedTextRanges(before, after) {
  const left = Array.from(before);
  const right = Array.from(after);
  const n = left.length, m = right.length;
  if (!n || !m) return n === m ? { before: [], after: [] } : { before: [[0, n]], after: [[0, m]] };
  if (n * m > 65536) {
    let start = 0;
    while (start < n && start < m && left[start] === right[start]) start += 1;
    let endLeft = n, endRight = m;
    while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) { endLeft -= 1; endRight -= 1; }
    return { before: [[start, endLeft]], after: [[start, endRight]] };
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1)
    dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const changed = { before: [], after: [] };
  let i = 0, j = 0, runLeft = -1, runRight = -1;
  const flush = () => {
    if (runLeft >= 0) { changed.before.push([runLeft, i]); changed.after.push([runRight, j]); runLeft = -1; runRight = -1; }
  };
  while (i < n || j < m) {
    if (i < n && j < m && left[i] === right[j]) { flush(); i += 1; j += 1; }
    else {
      if (runLeft < 0) { runLeft = i; runRight = j; }
      if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) i += 1; else j += 1;
    }
  }
  flush();
  return changed;
}

function appendChangedText(cell, value, ranges, side) {
  const chars = Array.from(value);
  const marks = ranges[side];
  let cursor = 0;
  for (const [start, end] of marks) {
    if (start > cursor) cell.append(document.createTextNode(chars.slice(cursor, start).join('')));
    if (end > start) {
      const mark = document.createElement('span');
      mark.className = side === 'before' ? 'text-change-before' : 'text-change-after';
      mark.textContent = chars.slice(start, end).join('');
      cell.append(mark);
    } else {
      const anchor = document.createElement('span');
      anchor.className = side === 'before' ? 'text-change-anchor-before' : 'text-change-anchor-after';
      anchor.setAttribute('aria-label', side === 'before' ? 'Text deleted here' : 'Text inserted here');
      cell.append(anchor);
    }
    cursor = end;
  }
  if (cursor < chars.length) cell.append(document.createTextNode(chars.slice(cursor).join('')));
}

function renderPane(side, columns, rows, name, sideName) {
  const pane = panes[side];
  setName(pane.name, name, sideName);
  const thead = pane.table.tHead || pane.table.createTHead();
  const tbody = pane.table.tBodies[0] || pane.table.createTBody();
  const headRow = document.createElement('tr');
  headRow.append(el('th', 'row-number', '#'));
  for (const column of columns) {
    const header = column[side];
    const exists = Boolean(header && header.present);
    const label = exists ? String(header.value ?? '') : null;
    const pairedChange = Boolean(column.changed && column.before?.present && column.after?.present);
    const th = el('th', exists ? '' : 'column-missing');
    if (!exists) th.append(el('span', side === 'before' ? 'text-change-before' : 'text-change-after', localize('Missing column')));
    else if (pairedChange) {
      if (label === '') th.append(el('span', side === 'before' ? 'text-change-before' : 'text-change-after', localize('(empty header)')));
      else appendChangedText(th, label, changedTextRanges(String(column.before.value ?? ''), String(column.after.value ?? '')), side);
    } else if (column.changed) th.append(el('span', side === 'before' ? 'text-change-before' : 'text-change-after', label || localize('(empty header)')));
    else th.textContent = label || localize('(empty header)');
    th.title = exists ? (label || localize('Empty header')) : localize('This column does not exist in this file');
    headRow.append(th);
  }
  thead.replaceChildren(headRow);

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const isSidePresent = side === 'before' ? row.beforeIndex !== null && row.beforeIndex !== undefined : row.afterIndex !== null && row.afterIndex !== undefined;
    const rowIndex = side === 'before' ? row.beforeIndex : row.afterIndex;
    const tr = document.createElement('tr');
    tr.className = row.type === 'insert' ? (side === 'after' ? 'state-insert' : 'state-insert-gap')
      : row.type === 'delete' ? (side === 'before' ? 'state-delete' : 'state-delete-gap')
        : row.type === 'change' ? (side === 'before' ? 'state-change-before' : 'state-change-after') : '';
    const rowNumber = isSidePresent ? String(rowIndex + 1) : '—';
    tr.append(el('td', 'row-number', rowNumber));
    for (const cell of row.cells) {
      const value = cell[side];
      const present = Boolean(value && value.present);
      const td = document.createElement('td');
      if (!present) {
        td.className = 'cell-missing';
        const missing = el('span', 'placeholder', localize('Missing field'));
        if (row.type === 'change' && cell.changed) missing.classList.add(side === 'before' ? 'text-change-before' : 'text-change-after');
        td.append(missing);
      } else {
        const textValue = String(value.value ?? '');
        if (row.type === 'change' && cell.changed && cell.before?.present && cell.after?.present) {
          if (textValue === '') {
            const empty = el('span', `text-change-${side}`, localize('(empty)'));
            td.append(empty);
          } else appendChangedText(td, textValue, changedTextRanges(String(cell.before.value ?? ''), String(cell.after.value ?? '')), side);
        } else td.textContent = textValue === '' ? localize('(empty)') : textValue;
        if (value.value === '') td.classList.add('placeholder');
      }
      td.title = present ? `${localize('Value')}: ${String(value.value ?? '')}` : localize('Field missing in this record');
      tr.append(td);
    }
    if (!isSidePresent) {
      tr.classList.add('counterpart-absent');
      tr.title = side === 'before' ? localize('Row added in modified file') : localize('Row removed from original file');
    }
    fragment.append(tr);
  }
  tbody.replaceChildren(fragment);
}

function alignColumns() {
  const tables = [panes.before.table, panes.after.table];
  // Measure natural content widths, not widths previously assigned by this function.
  for (const table of tables) {
    table.querySelector('colgroup')?.remove();
    table.style.removeProperty('width');
    table.style.removeProperty('min-width');
  }
  const rows = tables.map((table) => Array.from(table.rows));
  const columnCount = Math.max(0, ...rows.map((tableRows) => tableRows[0]?.cells.length || 0));
  const widths = Array(columnCount).fill(43);
  for (const tableRows of rows) {
    for (const row of tableRows) {
      for (let index = 0; index < row.cells.length; index += 1) {
        const cell = row.cells[index];
        if (index > 0) widths[index] = Math.max(widths[index], Math.min(360, Math.max(110, cell.scrollWidth + 18)));
      }
    }
  }
  for (const table of tables) {
    let colgroup = table.querySelector('colgroup');
    if (!colgroup) {
      colgroup = document.createElement('colgroup');
      table.prepend(colgroup);
    }
    colgroup.replaceChildren(...widths.map((width) => {
      const col = document.createElement('col');
      col.style.width = `${width}px`;
      return col;
    }));
    table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
    table.style.minWidth = table.style.width;
  }
}

function alignRowHeights() {
  const beforeRows = panes.before.table.tBodies[0]?.rows || [];
  const afterRows = panes.after.table.tBodies[0]?.rows || [];
  const rowCount = Math.min(beforeRows.length, afterRows.length);
  for (let index = 0; index < rowCount; index += 1) {
    beforeRows[index].style.height = '';
    afterRows[index].style.height = '';
    for (const cell of beforeRows[index].cells) cell.style.height = '';
    for (const cell of afterRows[index].cells) cell.style.height = '';
  }
  // Read all natural heights after clearing previous alignment, then apply the
  // largest height to every cell in the paired row. Table rows treat height as
  // a minimum and may otherwise grow independently when cell contents wrap.
  const heights = Array.from({ length: rowCount }, (_, index) => Math.max(
    beforeRows[index].getBoundingClientRect().height,
    afterRows[index].getBoundingClientRect().height,
  ));
  for (let index = 0; index < rowCount; index += 1) {
    const height = `${heights[index]}px`;
    beforeRows[index].style.height = height;
    afterRows[index].style.height = height;
    for (const cell of beforeRows[index].cells) cell.style.height = height;
    for (const cell of afterRows[index].cells) cell.style.height = height;
  }
}

function synchronizeScroll(source, target) {
  const sourceMaxX = Math.max(0, source.scrollWidth - source.clientWidth);
  const sourceMaxY = Math.max(0, source.scrollHeight - source.clientHeight);
  const targetMaxX = Math.max(0, target.scrollWidth - target.clientWidth);
  const targetMaxY = Math.max(0, target.scrollHeight - target.clientHeight);
  target.scrollLeft = sourceMaxX ? source.scrollLeft / sourceMaxX * targetMaxX : 0;
  target.scrollTop = sourceMaxY ? source.scrollTop / sourceMaxY * targetMaxY : 0;
}

function navigateChangedRow(direction) {
  if (!changedRowIndices.length) return;
  activeChangeIndex = activeChangeIndex < 0
    ? (direction > 0 ? 0 : changedRowIndices.length - 1)
    : (activeChangeIndex + direction + changedRowIndices.length) % changedRowIndices.length;
  const rowIndex = changedRowIndices[activeChangeIndex];
  for (const pane of Object.values(panes)) {
    const row = pane.table.tBodies[0]?.rows[rowIndex];
    if (!row) continue;
    const rowRect = row.getBoundingClientRect();
    const scrollRect = pane.scroll.getBoundingClientRect();
    const targetTop = pane.scroll.scrollTop + rowRect.top - scrollRect.top - (pane.scroll.clientHeight - rowRect.height) / 2;
    pane.scroll.scrollTop = Math.max(0, Math.min(targetTop, pane.scroll.scrollHeight - pane.scroll.clientHeight));
  }
  updateChangeNavigationStatus();
}

function updateChangeNavigationStatus() {
  if (activeChangeIndex < 0) {
    changeNavigationStatus.textContent = '';
    return;
  }
  changeNavigationStatus.textContent = comparisonLanguage() === 'de'
    ? `${activeChangeIndex + 1} von ${changedRowIndices.length}: ${localize('Changed')}`
    : `${activeChangeIndex + 1} of ${changedRowIndices.length}: ${localize('Changed')}`;
}

function scheduleAlignment() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => {
    alignColumns();
    alignRowHeights();
    requestAnimationFrame(alignRowHeights);
  });
}

function renderComparison(message) {
  if (typeof message.originalText !== 'string' || typeof message.modifiedText !== 'string') {
    status.textContent = localize('Comparison data is incomplete.');
    return;
  }
  const positions = Object.values(panes).map(pane => [pane.scroll.scrollLeft, pane.scroll.scrollTop]);
  lastComparison = message;
  applyPreferences(message.preferences);
  const result = CsvDiff.compareCsv(message.originalText, message.modifiedText);
  lastResult = result;
  changedRowIndices = result.rows.flatMap((row, index) => row.type === 'equal' ? [] : [index]);
  activeChangeIndex = -1;
  previousChangeButton.disabled = changedRowIndices.length === 0;
  nextChangeButton.disabled = changedRowIndices.length === 0;
  changeNavigationStatus.textContent = '';
  renderPane('before', result.columns, result.rows, message.originalName, 'Original file');
  renderPane('after', result.columns, result.rows, message.modifiedName, 'Modified file');
  scheduleAlignment();
  updateComparisonStatus(result);
  Object.values(panes).forEach((pane, index) => {
    [pane.scroll.scrollLeft, pane.scroll.scrollTop] = positions[index];
  });
}

function updateComparisonStatus(result) {
  const counts = { change: 0, insert: 0, delete: 0 };
  for (const row of result.rows) if (row.type in counts) counts[row.type] += 1;
  const changedHeaders = result.columns.filter((column) => column.changed).length;
  const headerStatus = changedHeaders
    ? (comparisonLanguage() === 'de'
      ? ` · ${changedHeaders} Spaltenüberschriften geändert`
      : ` · ${changedHeaders} headers changed`)
    : '';
  status.textContent = comparisonLanguage() === 'de'
    ? `${result.beforeRowCount} ursprüngliche Zeilen · ${result.afterRowCount} neue Zeilen · ${counts.change} geändert · ${counts.insert} hinzugefügt · ${counts.delete} entfernt${headerStatus}`
    : `${result.beforeRowCount} original rows · ${result.afterRowCount} modified rows · ${counts.change} changed · ${counts.insert} added · ${counts.delete} removed${headerStatus}`;
}

panes.before.scroll.addEventListener('scroll', () => synchronizeScroll(panes.before.scroll, panes.after.scroll), { passive: true });
panes.after.scroll.addEventListener('scroll', () => synchronizeScroll(panes.after.scroll, panes.before.scroll), { passive: true });
window.addEventListener('resize', scheduleAlignment);
settingsButton.addEventListener('click', openSettings);
previousChangeButton.addEventListener('click', () => navigateChangedRow(-1));
nextChangeButton.addEventListener('click', () => navigateChangedRow(1));
rowHeightSelect.addEventListener('change', () => savePreference({ rowHeight: rowHeightSelect.value }));
gridlinesToggle.addEventListener('change', () => savePreference({ showGridlines: gridlinesToggle.checked }));
themeSelect.addEventListener('change', () => savePreference({ theme: themeSelect.value }));
languageSelect.addEventListener('change', () => savePreference({ language: languageSelect.value }));
document.addEventListener('pointerdown', (event) => {
  if (!settingsPopover.hidden && !settingsPopover.contains(event.target) && !settingsButton.contains(event.target)) {
    settingsPopover.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settingsPopover.hidden) {
    settingsPopover.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
    settingsButton.focus();
  }
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;
  if (message.type === 'tablePreferences' && lastComparison) {
    updateComparisonPreferences(message.preferences);
    return;
  }
  if (message.type !== 'compare') return;
  try { renderComparison(message); }
  catch (error) { status.textContent = `${localize('Could not compare files')}: ${error?.message || String(error)}`; }
});

vscode.postMessage({ type: 'ready' });
