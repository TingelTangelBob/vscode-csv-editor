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

  function parseRecords(text, delimiter) {
    const records = [];
    let record = [];
    let field = '';
    let inQuotes = false;
    let recordStarted = false;
    let lineEnding = null;

    const finishField = () => {
      record.push(field);
      field = '';
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
        } else if (field.length === 0) {
          inQuotes = true;
        } else {
          field += character;
        }
      } else if (!inQuotes && character === delimiter) {
        finishField();
      } else if (!inQuotes && (character === '\n' || character === '\r')) {
        lineEnding ??= character === '\r' && text[index + 1] === '\n' ? '\r\n' : character;
        finishRecord();
        if (character === '\r' && text[index + 1] === '\n') index += 1;
      } else {
        field += character;
      }
    }

    if (recordStarted || field.length > 0 || record.length > 0) finishRecord();
    return { records, lineEnding: lineEnding ?? '\n' };
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

  const api = { createEmptySheet, parseCsv, escapeCell, serializeCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.CsvData = api;
})();
