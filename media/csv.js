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
    let hasContent = false;

    for (let index = 0; index < text.length && counts.length < 24; index += 1) {
      const character = text[index];
      if (character !== '\n' && character !== '\r' && (character.trim() || character === delimiter)) hasContent = true;
      if (character === '"') {
        if (inQuotes && text[index + 1] === '"') index += 1;
        else inQuotes = !inQuotes;
      } else if (!inQuotes && character === delimiter) {
        count += 1;
      } else if (!inQuotes && (character === '\n' || character === '\r')) {
        if (hasContent) counts.push(count);
        count = 0;
        hasContent = false;
        if (character === '\r' && text[index + 1] === '\n') index += 1;
      }
    }

    if (counts.length < 24 && (hasContent || counts.length === 0)) counts.push(count);
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
      // A consistent record shape matters more than delimiter frequency. Long
      // free-text fields can contain hundreds of commas in a semicolon CSV.
      // Empty separator lines must not reduce the correct delimiter's score.
      let mode = 0;
      let frequency = 0;
      for (const [count, occurrences] of frequencies) {
        if (count > 0 && occurrences > frequency) { mode = count; frequency = occurrences; }
      }
      const consistency = frequency / counts.length;
      const score = consistency * 1000 + (counts[0] === mode ? 1 : 0) + Math.min(mode, 15) / 100;
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
    // Slice complete segments instead of allocating a string node for every
    // character. Only quoted fields with escapes need multiple segments.
    let fieldStart = 0;
    let fieldLength = 0;
    let fieldParts = null;
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

    const appendFieldPart = end => {
      fieldParts ??= [];
      fieldParts.push(text.slice(fieldStart, end));
    };
    const finishField = end => {
      const tail = text.slice(fieldStart, end);
      record.push(fieldParts ? fieldParts.join('') + tail : tail);
      fieldStart = end + 1;
      fieldLength = 0;
      fieldParts = null;
      quoteClosed = false;
    };
    const finishRecord = end => {
      finishField(end);
      records.push(record);
      record = [];
      recordStarted = false;
    };

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === '"') {
        recordStarted = true;
        if (inQuotes && text[index + 1] === '"') {
          appendFieldPart(index + 1);
          index += 1;
          fieldStart = index + 1;
          fieldLength += 1;
        } else if (inQuotes) {
          appendFieldPart(index);
          fieldStart = index + 1;
          inQuotes = false;
          quoteClosed = true;
        } else if (fieldLength === 0) {
          inQuotes = true;
          fieldStart = index + 1;
        } else {
          reportError('Invalid quotes');
          fieldLength += 1;
        }
      } else if (!inQuotes && character === delimiter) {
        finishField(index);
      } else if (!inQuotes && (character === '\n' || character === '\r')) {
        lineEnding ??= character === '\r' && text[index + 1] === '\n' ? '\r\n' : character;
        finishRecord(index);
        if (character === '\r' && text[index + 1] === '\n') { index += 1; fieldStart = index + 1; }
      } else {
        if (quoteClosed && !inQuotes) reportError('Invalid quotes');
        fieldLength += 1;
      }
    }

    if (inQuotes) reportError('Unclosed quoted field');
    if (recordStarted || fieldLength > 0 || record.length > 0) finishRecord(text.length);
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
      const cells = values;
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
    return Boolean(filter && (filter.query?.trim() || filter.values instanceof Set || filter.dateRange));
  }

  function filterRows(rows, filters, exceptColumn = -1) {
    const active = [];
    filters.forEach((filter, column) => {
      if (column === exceptColumn || !isColumnFilterActive(filter)) return;
      const range = filter.dateRange;
      const format = range?.format || 'auto';
      const min = range?.min ? parseDateTime(String(range.min), 'iso') : null;
      const max = range?.max ? parseDateTime(String(range.max), 'iso') : null;
      active.push({ column, query: (filter.query || '').trim().toLocaleLowerCase(), values: filter.values,
        dateRange: range ? { valid: isValidDateRange(range), format, min, max } : null });
    });
    if (!active.length) return rows;
    return rows.filter(row => active.every(({ column, query, values, dateRange }) => {
      const value = String(row.cells[column] ?? '');
      if (query && !value.toLocaleLowerCase().includes(query)) return false;
      if (values instanceof Set && !values.has(value)) return false;
      if (dateRange) {
        if (!dateRange.valid) return false;
        const time = parseDateTime(value, dateRange.format);
        if (time === null || (dateRange.min !== null && time < dateRange.min) ||
          (dateRange.max !== null && time >= dateRange.max + 86400000)) return false;
      }
      return true;
    }));
  }

  const dateTimeSuffix = String.raw`(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?`;
  const datePatterns = {
    iso: new RegExp(String.raw`^(\d{4})-(\d{2})-(\d{2})${dateTimeSuffix}$`),
    de: new RegExp(String.raw`^(\d{2})\.(\d{2})\.(\d{4})${dateTimeSuffix}$`),
    slash: new RegExp(String.raw`^(\d{1,2})/(\d{1,2})/(\d{4})${dateTimeSuffix}$`),
  };

  function parseDateTime(value, format = 'auto') {
    if (typeof value !== 'string') return null;
    const text=value.trim(); let year,month,day,hour=0,minute=0,second=0,ms=0,offset=0,match;
    if(format==='auto'||format==='iso'){
      match=datePatterns.iso.exec(text);
      if(match){year=+match[1];month=+match[2];day=+match[3];hour=+(match[4]||0);minute=+(match[5]||0);second=+(match[6]||0);ms=+(match[7]||'').padEnd(3,'0');
      } else if(format==='iso') return null;
    }
    if(!match&&(format==='auto'||format==='de')){match=datePatterns.de.exec(text);if(match){day=+match[1];month=+match[2];year=+match[3];hour=+(match[4]||0);minute=+(match[5]||0);second=+(match[6]||0);ms=+(match[7]||'').padEnd(3,'0');}else if(format==='de')return null;}
    if(!match&&(format==='slash-dmy'||format==='slash-mdy')){match=datePatterns.slash.exec(text);if(match){if(format==='slash-dmy'){day=+match[1];month=+match[2];}else{month=+match[1];day=+match[2];}year=+match[3];hour=+(match[4]||0);minute=+(match[5]||0);second=+(match[6]||0);ms=+(match[7]||'').padEnd(3,'0');}}
    if (match?.[8] && match[8] !== 'Z') {
      const sign = match[8][0] === '+' ? 1 : -1;
      const hours = +match[8].slice(1, 3), minutes = +match[8].slice(4, 6);
      if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
      offset = sign * (hours * 60 + minutes);
    }
    const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    if(!match||year<1||month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59)return null;
    const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,ms);return date.getTime()-offset*60000;
  }
  function isValidDateRange(range){
    if(!range||typeof range!=='object'||!['auto','iso','de','slash-dmy','slash-mdy'].includes(range.format||'auto'))return false;
    const min=range.min?parseDateTime(String(range.min),'iso'):null,max=range.max?parseDateTime(String(range.max),'iso'):null;
    const valid=value=>!value||(/^\d{4}-\d{2}-\d{2}$/.test(String(value))&&parseDateTime(String(value),'iso')!==null);
    return valid(range.min)&&valid(range.max)&&(min===null||max===null||min<=max);
  }
  function getColumnFilterValues(rows, filters, column) {
    const counts = new Map();
    for (const row of filterRows(rows, filters, column)) {
      const value = String(row.cells[column] ?? '');
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts].map(([value, count]) => ({ value, count }));
  }

  // Persist only view metadata. Column names are used as stable identifiers;
  // ambiguous duplicate names are deliberately skipped when restoring.
  function normalizeFileView(view) {
    if (!view || view.version !== 1 || !Array.isArray(view.columns)) return null;
    const columns = view.columns.map(column => {
      if (!column || typeof column.name !== 'string') return null;
      const width = Number.isFinite(column.width) && column.width >= 40 && column.width <= 1000000 ? column.width : null;
      const filter = column.filter && typeof column.filter === 'object' ? {
        query: typeof column.filter.query === 'string' ? column.filter.query : '',
        values: Array.isArray(column.filter.values) ? [...new Set(column.filter.values.filter(value => typeof value === 'string'))] : null,
        ...(isValidDateRange(column.filter.dateRange) ? { dateRange: { format: column.filter.dateRange.format || 'auto', min: column.filter.dateRange.min || null, max: column.filter.dateRange.max || null } } : {}),
      } : null;
      return { name: column.name, width, filter };
    });
    if (columns.some(column => !column)) return null;
    const sort = view.sort && typeof view.sort.name === 'string' && [1, -1].includes(view.sort.direction)
      ? { name: view.sort.name, direction: view.sort.direction } : null;
    return { version: 1, columns, sort };
  }

  function captureFileView(headers, widths, filters, sortState) {
    return normalizeFileView({
      version: 1,
      columns: headers.map((name, index) => ({
        name, width: widths[index],
        filter: filters[index] ? { query: filters[index].query || '',
          values: filters[index].values instanceof Set ? [...filters[index].values] : null, ...(filters[index].dateRange ? { dateRange: filters[index].dateRange } : {}) } : null,
      })),
      sort: sortState && headers[sortState.column] !== undefined
        ? { name: headers[sortState.column], direction: sortState.direction } : null,
    });
  }

  function restoreFileView(view, headers) {
    const saved = normalizeFileView(view);
    const widths = headers.map(() => null);
    const filters = headers.map(() => null);
    if (!saved) return { widths, filters, sort: null };
    const countNames = names => names.reduce((counts, name) => counts.set(name, (counts.get(name) || 0) + 1), new Map());
    const currentCounts = countNames(headers);
    const savedCounts = countNames(saved.columns.map(column => column.name));
    const savedByName = new Map(saved.columns.map(column => [column.name, column]));
    headers.forEach((name, index) => {
      if (currentCounts.get(name) !== 1 || savedCounts.get(name) !== 1) return;
      const column = savedByName.get(name);
      widths[index] = column.width;
      if (column.filter) filters[index] = { query: column.filter.query,
        values: column.filter.values === null ? null : new Set(column.filter.values), ...(column.filter.dateRange ? { dateRange: column.filter.dateRange } : {}) };
    });
    const sortColumn = saved.sort ? headers.indexOf(saved.sort.name) : -1;
    const sort = sortColumn >= 0 && currentCounts.get(saved.sort.name) === 1 && savedCounts.get(saved.sort.name) === 1
      ? { column: sortColumn, direction: saved.sort.direction } : null;
    return { widths, filters, sort };
  }

  const api = { createEmptySheet, parseCsv, escapeCell, serializeCsv, planCsvImport,
    isColumnFilterActive, filterRows, getColumnFilterValues, parseDateTime, isValidDateRange, normalizeFileView, captureFileView, restoreFileView };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.CsvData = api;
})();
