'use strict';

// Shared by the webview and the dependency-free Node tests.
(function () {
  const DELIMITERS = [',', ';', '\t', '|'];

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

  function detectDelimiter(text, fallback) {
    let bestDelimiter = fallback;
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

  function parseRecords(text, delimiter, validate = false) {
    const records = [];
    let record = [];
    let field = '';
    let inQuotes = false;
    let recordStarted = false;
    let lineEnding = null;
    const errors = [];
    let quoteClosed = false;
    const reportError = code => {
      if (!validate) return;
      const record = records.length + 1;
      const last = errors[errors.length - 1];
      if (last?.code !== code || last.record !== record) errors.push({ code, record });
    };

    const finishField = () => {
      record.push(field);
      field = '';
      quoteClosed = false;
    };
    const finishRecord = () => {
      finishField();
      records.push(record);
      record = [];
      recordStarted = false;
    };

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === '"') {
        recordStarted = true;
        if (inQuotes && text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (inQuotes) {
          inQuotes = false;
          quoteClosed = true;
        } else if (field.length === 0) {
          inQuotes = true;
        } else {
          reportError('Invalid quotes');
          field += character;
        }
      } else if (!inQuotes && character === delimiter) {
        finishField();
      } else if (!inQuotes && (character === '\n' || character === '\r')) {
        lineEnding ??= character === '\r' && text[index + 1] === '\n' ? '\r\n' : character;
        finishRecord();
        if (character === '\r' && text[index + 1] === '\n') index += 1;
      } else {
        if (quoteClosed && !inQuotes) reportError('Invalid quotes');
        field += character;
      }
    }

    if (inQuotes) reportError('Unclosed quoted field');
    if (recordStarted || field.length > 0 || record.length > 0) finishRecord();
    return { records, lineEnding: lineEnding ?? '\n', errors };
  }

  function parseCsv(rawText, fallbackDelimiter = ',') {
    const bom = rawText.charCodeAt(0) === 0xfeff;
    const text = bom ? rawText.slice(1) : rawText;
    const delimiter = detectDelimiter(text, fallbackDelimiter);
    const { records, lineEnding } = parseRecords(text, delimiter);
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

  function serializeCsv(sheet) {
    const columnCount = sheet.headers.length;
    const records = [sheet.headers, ...sheet.rows.map((row) => row.cells)];
    const text = records
      // A single empty field needs quotes to survive reopening the file.
      .map((record) => columnCount === 1 && !String(record[0] ?? '')
        ? '""'
        : Array.from({ length: columnCount }, (_, index) => escapeCell(record[index] ?? '', sheet.delimiter)).join(sheet.delimiter))
      .join(sheet.lineEnding);
    return `${sheet.bom ? '\ufeff' : ''}${text}${sheet.trailingNewline ? sheet.lineEnding : ''}`;
  }

  function planCsvImport(target, rawText, options = {}) {
    const text = rawText.replace(/^\ufeff/, '');
    const delimiter = DELIMITERS.includes(options.delimiter) ? options.delimiter : detectDelimiter(text, target.delimiter);
    const parsed = parseRecords(text, delimiter, true);
    const errors = parsed.errors.slice();
    const warnings = [];
    const hasHeader = options.hasHeader !== false;
    const append = options.mode === 'append';
    const records = parsed.records.map((cells, index) => ({ cells, record: index + 1 }));
    const kept = options.skipEmpty === false ? records : records.filter(r => r.cells.some(value => value.trim()));
    const skipped = records.length - kept.length;
    if (!kept.length) errors.push({ code: 'No data to import' });
    const width = kept[0]?.cells.length || 1;
    const incomingHeaders = hasHeader ? (kept[0]?.cells || ['']) : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    const incoming = hasHeader ? kept.slice(1) : kept;
    const normalize = name => String(name).trim().toLowerCase();
    const names = incomingHeaders.map(normalize);
    if (hasHeader && names.some(name => !name)) errors.push({ code: 'Empty column names' });
    if (hasHeader && new Set(names).size !== names.length) errors.push({ code: 'Duplicate column names' });
    for (const row of incoming) {
      if (row.cells.length !== width) errors.push({ code: 'Wrong number of columns', record: row.record, detail: `${row.cells.length} / ${width}` });
    }
    let mapping = incomingHeaders.map((_, i) => i);
    if (append) {
      if (hasHeader) {
        const targetNames = target.headers.map(normalize);
        if (new Set(targetNames).size !== targetNames.length || targetNames.some(n => !n)) errors.push({ code: 'Ambiguous target column names' });
        const missing = target.headers.filter(name => !names.includes(normalize(name)));
        const extra = incomingHeaders.filter(name => !targetNames.includes(normalize(name)));
        if (missing.length) errors.push({ code: 'Missing columns', detail: missing.join(', ') });
        if (extra.length) errors.push({ code: 'Unknown columns', detail: extra.join(', ') });
        mapping = targetNames.map(name => names.indexOf(name));
        if (!missing.length && !extra.length && mapping.some((index, i) => index !== i)) warnings.push({ code: 'Columns reordered by name' });
      } else if (width !== target.headers.length) {
        errors.push({ code: 'Wrong number of columns', detail: `${width} / ${target.headers.length}` });
      } else warnings.push({ code: 'Columns matched by position' });
    }
    const headers = append ? target.headers.slice() : incomingHeaders.slice();
    const imported = incoming.map(row => mapping.map(index => row.cells[index] ?? ''));
    const combined = append ? [...target.rows.map(row => row.cells.slice()), ...imported] : imported;
    const seen = new Set();
    let duplicates = 0;
    const cells = combined.filter(row => {
      const key = JSON.stringify(row);
      const duplicate = seen.has(key);
      seen.add(key);
      if (duplicate) duplicates += 1;
      return !options.dedupe || !duplicate;
    });
    return { headers, rows: cells.map((cells, index) => ({ id: index + 1, cells })), preview: imported.slice(0, 5),
      errors, warnings, duplicates, skipped, importedCount: imported.length,
      delimiter: append ? target.delimiter : delimiter, detectedDelimiter: delimiter,
      lineEnding: append ? target.lineEnding : parsed.lineEnding, bom: target.bom,
      trailingNewline: append ? target.trailingNewline : /[\r\n]$/.test(text),
      tabular: width > 1 || kept.length > 1 };
  }

  function isColumnFilterActive(filter) {
    return Boolean(filter && (filter.query?.trim() || filter.values instanceof Set));
  }

  function filterRows(rows, filters, exceptColumn = -1) {
    const active = [];
    filters.forEach((filter, column) => {
      if (column !== exceptColumn && isColumnFilterActive(filter)) {
        active.push({ column, query: (filter.query || '').trim().toLocaleLowerCase(), values: filter.values });
      }
    });
    if (!active.length) return rows;
    return rows.filter(row => active.every(({ column, query, values }) => {
      const value = String(row.cells[column] ?? '');
      return (!query || value.toLocaleLowerCase().includes(query)) && (!(values instanceof Set) || values.has(value));
    }));
  }

  function getColumnFilterValues(rows, filters, column) {
    const counts = new Map();
    for (const row of filterRows(rows, filters, column)) {
      const value = String(row.cells[column] ?? '');
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts].map(([value, count]) => ({ value, count }));
  }

  const api = { createEmptySheet, parseCsv, escapeCell, serializeCsv, planCsvImport,
    isColumnFilterActive, filterRows, getColumnFilterValues };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.CsvData = api;
})();
