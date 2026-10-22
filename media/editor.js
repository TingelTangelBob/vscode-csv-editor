'use strict';

const vscode = acquireVsCodeApi();
const DELIMITERS = [',', ';', '\t', '|'];
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const elements = {
  table: document.getElementById('csv-table'),
  tableHead: document.getElementById('table-head'),
  tableBody: document.getElementById('table-body'),
  tableScroll: document.getElementById('table-scroll'),
  tableStatus: document.getElementById('table-status'),
  deleteSelected: document.getElementById('delete-selected'),
  selectionCount: document.getElementById('selection-count'),
  delimiter: document.getElementById('delimiter-select'),
  toolsButton: document.getElementById('tools-menu-button'),
  toolsPopover: document.getElementById('tools-popover'),
  settingsButton: document.getElementById('settings-button'),
  settingsPopover: document.getElementById('settings-popover'),
  colorizeColumns: document.getElementById('colorize-columns'),
  filterPopover: document.getElementById('filter-popover'),
  filterLabel: document.getElementById('filter-label'),
  filterInput: document.getElementById('column-filter-input'),
  contextPopover: document.getElementById('context-popover'),
  contextCaption: document.getElementById('context-caption'),
  columnDialog: document.getElementById('column-dialog'),
  columnForm: document.getElementById('column-form'),
  columnTitle: document.getElementById('column-dialog-title'),
  columnName: document.getElementById('column-name'),
  confirmDialog: document.getElementById('confirm-dialog'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmAction: document.getElementById('confirm-action'),
};

let sheet = createEmptySheet();
let lastSerializedText = '';
let selectedRows = new Set();
let columnFilters = [];
let columnWidths = [];
let columnWidthOverrides = Array.isArray(vscode.getState()?.columnWidthOverrides)
  ? vscode.getState().columnWidthOverrides
  : [];
let colorizeColumns = vscode.getState()?.colorizeColumns === true;
let selectedColumn = -1;
let sortState = null;
let visibleRows = [];
let activeColumn = -1;
let activePopover = null;
let contextTarget = null;
let filterRenderTimer = null;
let resizeState = null;

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

function persistViewState() {
  vscode.setState({
    columnWidthOverrides,
    colorizeColumns,
  });
}

function columnWidthCss(column) {
  const override = columnWidthOverrides[column];
  return Number.isFinite(override) && override > 0
    ? `${override}px`
    : `${columnWidths[column] || 12}ch`;
}

function applyColumnColor(element, column) {
  element.classList.toggle('is-colorized', colorizeColumns);
  if (colorizeColumns) element.style.setProperty('--column-color', COLUMN_COLORS[column % COLUMN_COLORS.length]);
  else element.style.removeProperty('--column-color');
}

function createEmptySheet() {
  return {
    headers: [''],
    rows: [],
    delimiter: ',',
    lineEnding: '\n',
    bom: false,
    trailingNewline: false,
  };
}

function countDelimitersOutsideQuotes(text, delimiter) {
  const counts = [];
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < text.length && counts.length < 24; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') index += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && character === delimiter) {
      count += 1;
    } else if (!inQuotes && (character === '\n' || character === '\r')) {
      counts.push(count);
      count = 0;
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    }
  }

  if (counts.length < 24 && (count > 0 || counts.length === 0)) counts.push(count);
  return counts;
}

function detectDelimiter(text) {
  let bestDelimiter = ',';
  let bestScore = -1;

  for (const delimiter of DELIMITERS) {
    const counts = countDelimitersOutsideQuotes(text, delimiter);
    const maximumCount = Math.max(...counts, 0);
    if (maximumCount === 0) continue;

    const frequencies = new Map();
    for (const count of counts) frequencies.set(count, (frequencies.get(count) || 0) + 1);
    const mostCommonCount = Math.max(...frequencies.values());
    const consistency = mostCommonCount / counts.length;
    const average = counts.reduce((total, count) => total + count, 0) / counts.length;
    const score = (consistency * 100) + (average * 10) + Math.min(maximumCount, 15);
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

function parseRecords(text, delimiter) {
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;

  const finishField = () => {
    record.push(field);
    field = '';
  };
  const finishRecord = () => {
    finishField();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (inQuotes) {
        inQuotes = false;
      } else if (field.length === 0) {
        inQuotes = true;
      } else {
        field += character;
      }
    } else if (!inQuotes && character === delimiter) {
      finishField();
    } else if (!inQuotes && (character === '\n' || character === '\r')) {
      finishRecord();
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      field += character;
    }
  }

  if (field.length > 0 || record.length > 0) finishRecord();
  return records;
}

function parseCsv(rawText) {
  const bom = rawText.charCodeAt(0) === 0xfeff;
  const text = bom ? rawText.slice(1) : rawText;
  const delimiter = detectDelimiter(text);
  const records = parseRecords(text, delimiter);
  const lineEnding = text.includes('\r\n') ? '\r\n' : (text.includes('\r') ? '\r' : '\n');
  const columnCount = records.reduce((maximum, record) => Math.max(maximum, record.length), 1);
  const headers = (records[0] || []).slice();
  while (headers.length < columnCount) headers.push('');

  const rows = records.slice(1).map((values, rowIndex) => {
    const cells = values.slice();
    while (cells.length < columnCount) cells.push('');
    return { id: rowIndex + 1, cells };
  });

  return {
    headers: headers.length ? headers : [''],
    rows,
    delimiter,
    lineEnding,
    bom,
    trailingNewline: /(?:\r\n|\r|\n)$/.test(text),
  };
}

function escapeCell(value, delimiter) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(delimiter) || /[\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function serializeCsv() {
  const columnCount = sheet.headers.length;
  const records = [sheet.headers, ...sheet.rows.map((row) => row.cells)];
  const text = records
    .map((record) => Array.from({ length: columnCount }, (_, index) => escapeCell(record[index] ?? '', sheet.delimiter)).join(sheet.delimiter))
    .join(sheet.lineEnding);
  return `${sheet.bom ? '\ufeff' : ''}${text}${sheet.trailingNewline ? sheet.lineEnding : ''}`;
}

function setDocument(rawText) {
  sheet = parseCsv(rawText);
  columnWidthOverrides = sheet.headers.map((_, column) => {
    const width = columnWidthOverrides[column];
    return Number.isFinite(width) && width >= 72 && width <= 640 ? width : null;
  });
  if (selectedColumn >= sheet.headers.length) selectedColumn = -1;
  elements.colorizeColumns.checked = colorizeColumns;
  lastSerializedText = rawText;
  selectedRows.clear();
  sortState = null;
  columnFilters = Array(sheet.headers.length).fill('');
  recalculateColumnWidths();
  elements.delimiter.value = sheet.delimiter === '\t' ? 'tab' : sheet.delimiter;
  closePopovers();
  renderTable();
}

function sendEdit() {
  const text = serializeCsv();
  if (text === lastSerializedText) return;
  lastSerializedText = text;
  vscode.postMessage({ type: 'edit', text });
}

function getVisibleRows() {
  const activeFilters = [];
  columnFilters.forEach((filter, column) => {
    const query = String(filter || '').trim().toLocaleLowerCase();
    if (query) activeFilters.push({ column, query });
  });

  const filtered = [];
  sheet.rows.forEach((row, index) => {
    for (const { column, query } of activeFilters) {
      if (!String(row.cells[column] ?? '').toLocaleLowerCase().includes(query)) return;
    }
    filtered.push({ row, index });
  });

  if (sortState) {
    const { column, direction } = sortState;
    filtered.sort((left, right) => {
      const result = collator.compare(left.row.cells[column] ?? '', right.row.cells[column] ?? '');
      return (result * direction) || (left.index - right.index);
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
  selectAll.title = 'Select all visible rows';
  selectAll.setAttribute('aria-label', 'Select all visible rows');
  selectAll.disabled = visibleRows.length === 0;
  selectAll.checked = visibleRows.length > 0 && visibleRows.every(({ row }) => selectedRows.has(row.id));
  selectHeader.append(selectAll);
  titleRow.append(selectHeader);

  sheet.headers.forEach((header, column) => {
    const th = createElement('th', 'data-heading');
    th.dataset.column = String(column);
    th.style.setProperty('--column-width', columnWidthCss(column));
    th.classList.toggle('is-column-selected', selectedColumn === column);
    applyColumnColor(th, column);

    const layout = createElement('div', 'heading-content');
    const sortButton = document.createElement('button');
    sortButton.type = 'button';
    sortButton.className = 'sort-button';
    sortButton.dataset.sort = String(column);
    sortButton.title = `Sort by ${header.trim() || `Column ${column + 1}`}`;
    sortButton.setAttribute('aria-label', sortButton.title);
    if (sortState?.column === column) sortButton.classList.add('is-sorted');
    th.setAttribute('aria-sort', sortState?.column === column
      ? (sortState.direction > 0 ? 'ascending' : 'descending')
      : 'none');
    const name = createElement('span', '', header.trim() ? header : `Column ${column + 1}`);
    const direction = createElement('span', 'sort-indicator', sortState?.column === column ? (sortState.direction > 0 ? '↑' : '↓') : '↕');
    sortButton.append(name, direction);

    const filterButton = makeIconButton(
      'header-button filter-button',
      columnFilters[column] ? 'Edit filter' : 'Filter column',
      'filterToggle',
      column,
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6.2 7.1v5.4l-3.6 1.8v-7.2L4 5Z"></path></svg>',
    );
    filterButton.classList.toggle('is-active', Boolean(String(columnFilters[column] || '').trim()));
    filterButton.setAttribute('aria-haspopup', 'true');
    filterButton.setAttribute('aria-expanded', String(activePopover === elements.filterPopover && activeColumn === column));

    layout.append(sortButton, filterButton);
    th.append(layout);
    const resizeHandle = createElement('span', 'column-resize-handle');
    resizeHandle.dataset.resizeColumn = String(column);
    resizeHandle.title = 'Drag to resize column';
    resizeHandle.setAttribute('role', 'separator');
    resizeHandle.setAttribute('aria-orientation', 'vertical');
    resizeHandle.setAttribute('aria-label', `Resize ${header.trim() || `Column ${column + 1}`}`);
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
    const cell = createElement('td', 'empty-state', sheet.rows.length === 0 ? 'No data rows' : 'No matching rows');
    cell.colSpan = sheet.headers.length + 1;
    row.append(cell);
    fragment.append(row);
  } else {
    visibleRows.forEach(({ row }) => {
      const tr = document.createElement('tr');
      tr.classList.toggle('is-selected', selectedRows.has(row.id));

      const rowHeader = createElement('td', 'row-number-cell');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedRows.has(row.id);
      checkbox.dataset.selectRow = String(row.id);
      checkbox.title = `Select row ${row.id}`;
      checkbox.setAttribute('aria-label', `Select row ${row.id}`);
      rowHeader.title = `Original row number ${row.id}`;
      rowHeader.append(checkbox, createElement('span', '', String(row.id)));
      tr.append(rowHeader);

      sheet.headers.forEach((_, column) => {
        const value = row.cells[column] ?? '';
        const td = createElement('td', 'data-cell', value);
        td.dataset.rowId = String(row.id);
        td.dataset.column = String(column);
        td.style.setProperty('--column-width', columnWidthCss(column));
        td.classList.toggle('is-column-selected', selectedColumn === column);
        applyColumnColor(td, column);
        td.tabIndex = 0;
        td.title = value ? `${value}\nDouble-click to edit` : 'Double-click to edit';
        if (!value) td.classList.add('empty-cell');
        tr.append(td);
      });
      fragment.append(tr);
    });
  }
  elements.tableBody.replaceChildren(fragment);
}

function updateToolbar() {
  const filterCount = columnFilters.filter((value) => String(value || '').trim()).length;
  const visibleCount = visibleRows.length;
  const filtered = visibleCount !== sheet.rows.length;
  const rowCount = sheet.rows.length;
  const result = filtered
    ? `${visibleCount.toLocaleString('en-US')} of ${rowCount.toLocaleString('en-US')} ${rowCount === 1 ? 'row' : 'rows'}`
    : `${rowCount.toLocaleString('en-US')} ${rowCount === 1 ? 'row' : 'rows'}`;
  const filterStatus = filterCount ? ` · ${filterCount} ${filterCount === 1 ? 'filter' : 'filters'}` : '';
  const columnCount = sheet.headers.length;
  elements.tableStatus.textContent = `${result} · ${columnCount} ${columnCount === 1 ? 'column' : 'columns'}${filterStatus}`;
  elements.deleteSelected.disabled = selectedRows.size === 0;
  elements.selectionCount.textContent = selectedRows.size.toLocaleString('en-US');
  elements.selectionCount.hidden = selectedRows.size === 0;
}

function renderTable() {
  if (filterRenderTimer !== null) {
    window.clearTimeout(filterRenderTimer);
    filterRenderTimer = null;
  }
  visibleRows = getVisibleRows();
  renderHeader();
  renderBody();
  updateToolbar();
}

function recalculateColumnWidths(columns = null) {
  const columnsToMeasure = columns ?? sheet.headers.map((_, column) => column);
  if (columns === null) columnWidths = Array(sheet.headers.length);

  for (const column of columnsToMeasure) {
    const header = sheet.headers[column] ?? '';
    let longest = Math.max(header.trim() ? header.length : `Column ${column + 1}`.length, 3);
    for (const row of sheet.rows) {
      const value = String(row.cells[column] ?? '');
      for (const line of value.split(/\r?\n/)) longest = Math.max(longest, line.length);
    }
    columnWidths[column] = Math.max(7, Math.min(48, longest + 8));
  }
}

function applyColumnWidth(column, width, updateCells = true) {
  const value = Math.max(72, Math.min(640, width));
  columnWidthOverrides[column] = value;
  const cssWidth = `${value}px`;
  elements.tableHead.querySelector(`th[data-column="${column}"]`)?.style.setProperty('--column-width', cssWidth);
  if (updateCells) {
    elements.tableBody.querySelectorAll(`td[data-column="${column}"]`).forEach((cell) => {
      cell.style.setProperty('--column-width', cssWidth);
    });
  }
}

function resetColumnWidths() {
  columnWidthOverrides = Array(sheet.headers.length).fill(null);
  persistViewState();
  closePopovers();
  renderTable();
}

function focusCell(rowId, column) {
  const cell = elements.tableBody.querySelector(`[data-row-id="${rowId}"][data-column="${column}"]`);
  if (cell) {
    cell.focus();
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function focusNeighbor(rowId, column, direction) {
  const rowIndex = visibleRows.findIndex(({ row }) => row.id === rowId);
  let nextColumn = column + direction;
  let nextRow = rowIndex;
  if (nextColumn >= sheet.headers.length) {
    nextColumn = 0;
    nextRow += 1;
  } else if (nextColumn < 0) {
    nextColumn = sheet.headers.length - 1;
    nextRow -= 1;
  }
  if (nextRow >= 0 && nextRow < visibleRows.length) focusCell(visibleRows[nextRow].row.id, nextColumn);
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
  const finish = (save, moveDirection = 0) => {
    if (finished) return;
    finished = true;
    if (save) {
      row.cells[column] = editor.value;
      recalculateColumnWidths([column]);
      sendEdit();
    }
    renderTable();
    if (moveDirection) focusNeighbor(rowId, column, moveDirection);
    else focusCell(rowId, column);
  };

  editor.addEventListener('keydown', (event) => {
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
  editor.addEventListener('blur', () => finish(true), { once: true });
}

function openColumnDialog(mode, column = -1) {
  elements.columnTitle.textContent = mode === 'rename' ? 'Rename column' : 'Add column';
  elements.columnName.value = mode === 'rename' ? (sheet.headers[column] || '') : '';
  elements.columnName.placeholder = mode === 'rename' ? 'Column name' : 'e.g. Product ID';

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

function closePopovers() {
  for (const popover of [elements.toolsPopover, elements.settingsPopover, elements.filterPopover, elements.contextPopover]) popover.hidden = true;
  document.querySelectorAll('[aria-expanded="true"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  activePopover = null;
  activeColumn = -1;
  contextTarget = null;
}

function openToolsPopover() {
  if (activePopover === elements.toolsPopover) {
    closePopovers();
    return;
  }
  closePopovers();
  activePopover = elements.toolsPopover;
  elements.toolsButton.setAttribute('aria-expanded', 'true');
  positionPopover(elements.toolsPopover, elements.toolsButton);
}

function openSettingsPopover() {
  if (activePopover === elements.settingsPopover) {
    closePopovers();
    return;
  }
  closePopovers();
  activePopover = elements.settingsPopover;
  elements.settingsButton.setAttribute('aria-expanded', 'true');
  positionPopover(elements.settingsPopover, elements.settingsButton);
}

function openFilterPopover(column, anchor) {
  if (activePopover === elements.filterPopover && activeColumn === column) {
    closePopovers();
    return;
  }
  closePopovers();
  activePopover = elements.filterPopover;
  activeColumn = column;
  elements.filterLabel.textContent = `Filter ${sheet.headers[column]?.trim() || `Column ${column + 1}`}`;
  elements.filterInput.value = columnFilters[column] || '';
  positionPopover(elements.filterPopover, anchor);
  anchor.setAttribute('aria-expanded', 'true');
  elements.filterInput.focus();
  elements.filterInput.select();
}

function openContextPopover(column, rowId, kind, clientX, clientY) {
  closePopovers();
  activePopover = elements.contextPopover;
  activeColumn = column;
  contextTarget = { rowId, column, kind };
  const header = column >= 0 ? (sheet.headers[column]?.trim() || `Column ${column + 1}`) : '';
  const row = rowId === null ? null : sheet.rows.find((item) => item.id === rowId);
  const value = row && column >= 0 ? String(row.cells[column] ?? '') : '';
  elements.contextCaption.textContent = kind === 'cell'
    ? header + ': ' + (value || '(empty)')
    : (kind === 'row' ? 'Row ' + rowId : header);
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
  filterValueButton.disabled = !value;
  const deleteButton = elements.contextPopover.querySelector('[data-action="delete-column"]');
  deleteButton.disabled = sheet.headers.length <= 1;
  const selectColumnButton = elements.contextPopover.querySelector('[data-action="select-column"]');
  selectColumnButton.querySelector('span:last-child').textContent = selectedColumn === column ? 'Deselect column' : 'Select column';
  selectColumnButton.setAttribute('aria-pressed', String(selectedColumn === column));
  elements.contextPopover.querySelector('[data-action="copy-row-list"]').disabled = !row;
  elements.contextPopover.hidden = false;
  const rect = elements.contextPopover.getBoundingClientRect();
  const left = Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8));
  let top = clientY;
  if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
  elements.contextPopover.style.left = `${left}px`;
  elements.contextPopover.style.top = `${top}px`;
}

function clearFilters() {
  columnFilters = Array(sheet.headers.length).fill('');
  closePopovers();
  renderTable();
}

function clearSort() {
  sortState = null;
  closePopovers();
  renderTable();
}

function addRow() {
  columnFilters = Array(sheet.headers.length).fill('');
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
  columnFilters.push('');
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
  renderTable();
});

elements.table.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('[data-resize-column]');
  if (!handle || event.button !== 0) return;
  event.preventDefault();
  const column = Number(handle.dataset.resizeColumn);
  const header = elements.tableHead.querySelector('th[data-column="' + column + '"]');
  if (!header) return;
  resizeState = {
    column,
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: header.getBoundingClientRect().width,
  };
  document.body.classList.add('is-resizing-column');
});

document.addEventListener('pointermove', (event) => {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  applyColumnWidth(resizeState.column, resizeState.startWidth + event.clientX - resizeState.startX, false);
});

document.addEventListener('pointerup', (event) => {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  const resizedColumn = resizeState.column;
  resizeState = null;
  document.body.classList.remove('is-resizing-column');
  applyColumnWidth(resizedColumn, columnWidthOverrides[resizedColumn]);
  persistViewState();
});

document.addEventListener('pointercancel', (event) => {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  const resizedColumn = resizeState.column;
  resizeState = null;
  document.body.classList.remove('is-resizing-column');
  applyColumnWidth(resizedColumn, columnWidthOverrides[resizedColumn]);
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
    selectedColumn = column;
    sortState = sortState?.column === column
      ? { column, direction: sortState.direction * -1 }
      : { column, direction: 1 };
    renderTable();
    return;
  }

  const rowCheckbox = event.target.closest('[data-select-row]');
  if (rowCheckbox) {
    const rowId = Number(rowCheckbox.dataset.selectRow);
    if (rowCheckbox.checked) selectedRows.add(rowId);
    else selectedRows.delete(rowId);
    rowCheckbox.closest('tr').classList.toggle('is-selected', rowCheckbox.checked);
    const selectAll = document.getElementById('select-visible-rows');
    if (selectAll) selectAll.checked = visibleRows.length > 0 && visibleRows.every(({ row }) => selectedRows.has(row.id));
    updateToolbar();
    return;
  }

  if (event.target.id === 'select-visible-rows') {
    visibleRows.forEach(({ row }) => {
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
  if (activeColumn < 0) return;
  const column = activeColumn;
  columnFilters[column] = elements.filterInput.value;
  if (filterRenderTimer !== null) window.clearTimeout(filterRenderTimer);
  filterRenderTimer = window.setTimeout(() => {
    filterRenderTimer = null;
    renderTable();
  }, 90);
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
  } else if (action === 'clear-column-filter' && column >= 0) {
    columnFilters[column] = '';
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
    visibleRows.forEach(({ row }) => values.push(String(row.cells[column] ?? '')));
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
    columnFilters[target.column] = String(row.cells[target.column] ?? '');
    closePopovers();
    renderTable();
  } else if ((action === 'sort-ascending' || action === 'sort-descending') && target) {
    sortState = { column: target.column, direction: action === 'sort-ascending' ? 1 : -1 };
    selectedColumn = target.column;
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
}, { passive: true });

window.addEventListener('resize', () => {
  if (activePopover) closePopovers();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activePopover) closePopovers();
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if ((message.type === 'load' || message.type === 'editRejected') && typeof message.text === 'string') setDocument(message.text);
});

vscode.postMessage({ type: 'ready' });
