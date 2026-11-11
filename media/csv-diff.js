'use strict';

// Table diff helpers shared by the browser and the dependency-free Node tests.
(function (root) {
  const csv = typeof module !== 'undefined' && module.exports
    ? require('./csv') : root.CsvData;

  function toSheet(input, fallbackDelimiter) {
    if (typeof input !== 'string') {
      if (!input || !Array.isArray(input.headers) || !Array.isArray(input.rows)) throw new TypeError('Expected CSV text or a parsed sheet');
      return { headers: input.headers.slice(), rows: input.rows.map(row => row.cells.slice()), delimiter: input.delimiter || fallbackDelimiter || ',' };
    }
    const parsed = csv.parseCsvRecords(input, fallbackDelimiter || ',');
    return { headers: parsed.records[0] || [], rows: parsed.records.slice(1), delimiter: parsed.delimiter };
  }

  const cell = (row, index) => index < row.length
    ? { present: true, value: String(row[index] ?? '') }
    : { present: false, value: null };
  const sameCell = (a, b) => a.present === b.present && (!a.present || a.value === b.value);
  const rowKey = row => JSON.stringify(row.map(value => [true, String(value ?? '')]));

  // Select a longest strictly increasing sequence of right-side indexes from
  // candidates already ordered by their left-side indexes.
  function longestIncreasingAnchors(candidates) {
    const tails = [], tailIndexes = [], previous = new Array(candidates.length).fill(-1);
    for (let i = 0; i < candidates.length; i += 1) {
      const target = candidates[i][1];
      let low = 0, high = tails.length;
      while (low < high) { const mid = (low + high) >>> 1; if (tails[mid] < target) low = mid + 1; else high = mid; }
      tails[low] = target;
      previous[i] = low ? tailIndexes[low - 1] : -1;
      tailIndexes[low] = i;
    }
    const anchors = [];
    let index = tailIndexes[tails.length - 1];
    while (index !== undefined && index >= 0) { anchors.push(candidates[index]); index = previous[index]; }
    return anchors.reverse();
  }

  function alignSegment(left, right, leftOffset, rightOffset, limit) {
    const n = left.length, m = right.length;
    if (n * m > limit) {
      const pairs = [];
      for (let i = 0; i < Math.min(n, m); i += 1) pairs.push([i + leftOffset, i + rightOffset]);
      for (let i = m; i < n; i += 1) pairs.push([i + leftOffset, -1]);
      for (let i = n; i < m; i += 1) pairs.push([-1, i + rightOffset]);
      return pairs;
    }
    const leftKeys = left.map(rowKey), rightKeys = right.map(rowKey);
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1)
      dp[i][j] = leftKeys[i] === rightKeys[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const pairs = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (leftKeys[i] === rightKeys[j]) { pairs.push([i++ + leftOffset, j++ + rightOffset]); continue; }
      if (dp[i + 1][j] >= dp[i][j + 1]) pairs.push([i++ + leftOffset, -1]);
      else pairs.push([-1, j++ + rightOffset]);
    }
    while (i < n) pairs.push([i++ + leftOffset, -1]);
    while (j < m) pairs.push([-1, j++ + rightOffset]);
    // Pair deleted/inserted records within each unmatched span as changed rows.
    const aligned = [];
    for (let k = 0; k < pairs.length;) {
      if (pairs[k][0] >= 0 && pairs[k][1] >= 0) { aligned.push(pairs[k++]); continue; }
      let end = k; const dels = [], adds = [];
      while (end < pairs.length && (pairs[end][0] < 0 || pairs[end][1] < 0)) {
        if (pairs[end][0] >= 0) dels.push(pairs[end][0]);
        if (pairs[end][1] >= 0) adds.push(pairs[end][1]);
        end += 1;
      }
      const count = Math.min(dels.length, adds.length);
      for (let p = 0; p < count; p += 1) aligned.push([dels[p], adds[p]]);
      for (let p = count; p < dels.length; p += 1) aligned.push([dels[p], -1]);
      for (let p = count; p < adds.length; p += 1) aligned.push([-1, adds[p]]);
      k = end;
    }
    return aligned;
  }

  function uniqueFirstColumn(rows) {
    const counts = new Map();
    rows.forEach((row, index) => {
      if (row.length === 0 || String(row[0] ?? '') === '') return;
      const key = String(row[0]);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { index, count: 1 });
    });
    return new Map([...counts].filter(([, entry]) => entry.count === 1).map(([key, entry]) => [key, entry.index]));
  }

  // Patience-style LIS selects an ordered, non-crossing sequence of unique
  // first-column keys that occur exactly once on each side.
  function orderedAnchors(left, right) {
    const leftKeys = uniqueFirstColumn(left), rightKeys = uniqueFirstColumn(right);
    const candidates = [...leftKeys].flatMap(([key, leftIndex]) => rightKeys.has(key)
      ? [[leftIndex, rightKeys.get(key)]] : []).sort((a, b) => a[0] - b[0]);
    return longestIncreasingAnchors(candidates);
  }

  function alignRows(left, right, limit) {
    const anchors = orderedAnchors(left, right);
    const pairs = [];
    let leftStart = 0, rightStart = 0;
    for (const [leftIndex, rightIndex] of anchors) {
      pairs.push(...alignSegment(left.slice(leftStart, leftIndex), right.slice(rightStart, rightIndex), leftStart, rightStart, limit));
      pairs.push([leftIndex, rightIndex]);
      leftStart = leftIndex + 1;
      rightStart = rightIndex + 1;
    }
    pairs.push(...alignSegment(left.slice(leftStart), right.slice(rightStart), leftStart, rightStart, limit));
    return pairs;
  }

  function compareCsv(beforeInput, afterInput, options = {}) {
    const before = toSheet(beforeInput, options.delimiter);
    const after = toSheet(afterInput, options.delimiter || before.delimiter);
    const widest = sheet => sheet.rows.reduce((max, row) => Math.max(max, row.length), sheet.headers.length);
    const beforeWidth = widest(before), afterWidth = widest(after);
    const uniqueHeaders = headers => {
      const counts = new Map();
      headers.forEach((name, index) => {
        const key = String(name ?? '');
        if (key === '') return;
        const entry = counts.get(key);
        if (entry) entry.count += 1; else counts.set(key, { index, count: 1 });
      });
      return new Map([...counts].filter(([, entry]) => entry.count === 1).map(([key, entry]) => [key, entry.index]));
    };
    const oldHeaders = uniqueHeaders(before.headers), newHeaders = uniqueHeaders(after.headers);
    const anchors = [...oldHeaders].flatMap(([name, oldIndex]) => newHeaders.has(name)
      ? [[oldIndex, newHeaders.get(name)]] : []).sort((a, b) => a[0] - b[0]);
    // Select a non-crossing set of header matches; reordered columns remain visible as changes.
    const matched = longestIncreasingAnchors(anchors);
    const columnPairs = []; let oldStart = 0, newStart = 0;
    const addGap = (oldEnd, newEnd) => {
      const count = Math.min(oldEnd - oldStart, newEnd - newStart);
      for (let i = 0; i < count; i += 1) columnPairs.push([oldStart + i, newStart + i]);
      for (let i = oldStart + count; i < oldEnd; i += 1) columnPairs.push([i, -1]);
      for (let i = newStart + count; i < newEnd; i += 1) columnPairs.push([-1, i]);
    };
    for (const [oldIndex, newIndex] of matched) {
      addGap(oldIndex, newIndex); columnPairs.push([oldIndex, newIndex]);
      oldStart = oldIndex + 1; newStart = newIndex + 1;
    }
    addGap(beforeWidth, afterWidth);
    const columns = columnPairs.map(([oldIndex, newIndex], index) => {
      const oldCell = oldIndex < 0 ? { present: false, value: null } : cell(before.headers, oldIndex);
      const newCell = newIndex < 0 ? { present: false, value: null } : cell(after.headers, newIndex);
      return { index, beforeIndex: oldIndex < 0 ? null : oldIndex, afterIndex: newIndex < 0 ? null : newIndex,
        before: oldCell, after: newCell, changed: !sameCell(oldCell, newCell) };
    });
    const comparableColumns = columnPairs.filter(([oldIndex, newIndex]) => oldIndex >= 0 && newIndex >= 0);
    const beforeKeys = before.rows.map(row => comparableColumns.map(([oldIndex]) => cell(row, oldIndex).present ? String(row[oldIndex] ?? '') : null));
    const afterKeys = after.rows.map(row => comparableColumns.map(([, newIndex]) => cell(row, newIndex).present ? String(row[newIndex] ?? '') : null));
    const pairs = alignRows(beforeKeys, afterKeys, options.maxLcsCells ?? 4000000);
    const rows = pairs.map(([leftIndex, rightIndex]) => {
      const left = leftIndex < 0 ? null : before.rows[leftIndex];
      const right = rightIndex < 0 ? null : after.rows[rightIndex];
      const cells = columnPairs.map(([oldIndex, newIndex], index) => {
        const oldCell = left && oldIndex >= 0 ? cell(left, oldIndex) : { present: false, value: null };
        const newCell = right && newIndex >= 0 ? cell(right, newIndex) : { present: false, value: null };
        return { index, before: oldCell, after: newCell, changed: !sameCell(oldCell, newCell) };
      });
      return { type: !left ? 'insert' : !right ? 'delete' : cells.some(c => c.changed) ? 'change' : 'equal',
        beforeIndex: leftIndex < 0 ? null : leftIndex, afterIndex: rightIndex < 0 ? null : rightIndex, cells };
    });
    return { columns, rows, beforeRowCount: before.rows.length, afterRowCount: after.rows.length };
  }

  const api = { compareCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CsvDiff = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
