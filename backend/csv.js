'use strict';
/** RFC 4180 CSV 解析 / 輸出（支援引號、換行、自動判斷分隔符號） */

function detectDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  const cands = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = 0;
  for (const d of cands) {
    const n = head.split(d).length;
    if (n > bestCount) { best = d; bestCount = n; }
  }
  return best;
}

function parse(text, delimiter) {
  text = String(text).replace(/^﻿/, '');
  const d = delimiter && delimiter !== 'auto' ? delimiter : detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function escapeField(v, d) {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s;
}

function stringify(rows, d = ',') {
  return rows.map((r) => r.map((v) => escapeField(v, d)).join(d)).join('\n');
}

module.exports = { parse, stringify, detectDelimiter };
