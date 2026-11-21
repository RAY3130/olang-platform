'use strict';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((cells) => cells.some((value) => String(value).trim() !== '')).map((cells) => {
    const object = {};
    headers.forEach((header, index) => { object[header] = cells[index] == null ? '' : cells[index]; });
    return object;
  });
}

function csvEscape(value) {
  let text = value == null ? '' : String(value);
  // Prevent spreadsheet formula injection when an export is opened in Excel or
  // Sheets. The leading apostrophe is a text marker, not part of the source data.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(rows, columns) {
  const header = columns.map((column) => csvEscape(column.label)).join(',');
  const body = rows.map((row) => columns.map((column) => csvEscape(typeof column.value === 'function' ? column.value(row) : row[column.key])).join(','));
  return `\uFEFF${[header, ...body].join('\r\n')}`;
}

module.exports = { parseCsv, buildCsv, csvEscape };
