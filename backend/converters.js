'use strict';
/**
 * 轉換器註冊表：新增轉換器只要在這裡加一筆，畫面會自動出現。
 * { id, group, label, description, sample, options: [{ key, label, type: select|number|boolean|text, choices, default }], run(input, opts, settings) }
 */
const crypto = require('crypto');
const yaml = require('js-yaml');
const csv = require('./csv');

const indentOf = (s) => Number(s['dataConverter.indent']) || 2;
const lines = (input) => String(input).split(/\r?\n/);

function parseJson(input) {
  try {
    return JSON.parse(input);
  } catch (err) {
    throw new Error(`JSON 格式錯誤：${err.message}`);
  }
}

/* ───── 時間 ───── */
const pad = (n, w = 2) => String(n).padStart(w, '0');
function fmtLocal(d, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}:${parts.second}`;
}
function parseTimeInput(s) {
  s = String(s).trim();
  if (!s) return new Date();
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    // 小於 1e11 視為秒（約到 5138 年），否則毫秒
    return new Date(Math.abs(n) < 1e11 ? n * 1000 : n);
  }
  const roc = s.match(/^(?:民國)?\s*(\d{2,3})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?(.*)$/);
  if (roc && Number(roc[1]) < 1000) {
    return new Date(`${Number(roc[1]) + 1911}-${pad(roc[2])}-${pad(roc[3])}${roc[4] ? `T${roc[4].trim()}` : 'T00:00:00'}+08:00`);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`無法解析時間：${s}`);
  return d;
}
function toRoc(d) {
  const local = fmtLocal(d, 'Asia/Taipei');
  const [date, time] = local.split(' ');
  const [y, m, day] = date.split('-').map(Number);
  return `民國 ${y - 1911} 年 ${m} 月 ${day} 日 ${time}`;
}

/* ───── 命名風格 ───── */
function words(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9一-鿿]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const CASES = {
  camel: (w) => w.map((x, i) => (i ? cap(x) : x)).join(''),
  pascal: (w) => w.map(cap).join(''),
  snake: (w) => w.join('_'),
  kebab: (w) => w.join('-'),
  constant: (w) => w.join('_').toUpperCase(),
  title: (w) => w.map(cap).join(' '),
};

/* ───── 全形 / 半形 ───── */
function toHalf(s) {
  return String(s).replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
}
function toFull(s) {
  return String(s).replace(/[\x21-\x7E]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).replace(/ /g, '　');
}

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

module.exports = [
  /* ───────── JSON / 結構化資料 ───────── */
  {
    id: 'json.format', group: 'JSON / 結構化', label: 'JSON 格式化',
    description: '美化 JSON，可選擇排序鍵值',
    sample: '{"name":"ToolDock","tags":["desktop","plugin"],"version":1}',
    options: [{ key: 'sortKeys', label: '鍵值排序', type: 'boolean', default: false }],
    run(input, o, s) {
      let v = parseJson(input);
      if (o.sortKeys) {
        const sort = (x) => (Array.isArray(x) ? x.map(sort) : x && typeof x === 'object'
          ? Object.keys(x).sort().reduce((a, k) => ({ ...a, [k]: sort(x[k]) }), {}) : x);
        v = sort(v);
      }
      return JSON.stringify(v, null, indentOf(s));
    },
  },
  {
    id: 'json.minify', group: 'JSON / 結構化', label: 'JSON 壓縮',
    description: '移除空白成單行',
    sample: '{\n  "a": 1,\n  "b": [1, 2, 3]\n}',
    run: (input) => JSON.stringify(parseJson(input)),
  },
  {
    id: 'json.toYaml', group: 'JSON / 結構化', label: 'JSON → YAML',
    description: '使用擴充自帶的 js-yaml 函式庫',
    sample: '{"server":{"host":"0.0.0.0","port":8080},"features":["export","monitor"]}',
    run: (input, o, s) => yaml.dump(parseJson(input), { indent: indentOf(s), lineWidth: 120 }),
  },
  {
    id: 'yaml.toJson', group: 'JSON / 結構化', label: 'YAML → JSON',
    sample: 'server:\n  host: 0.0.0.0\n  port: 8080\nfeatures:\n  - export\n  - monitor\n',
    run: (input, o, s) => JSON.stringify(yaml.load(input), null, indentOf(s)),
  },
  {
    id: 'json.toCsv', group: 'JSON / 結構化', label: 'JSON → CSV',
    description: '物件陣列轉 CSV，欄位取所有物件鍵值的聯集',
    sample: '[{"id":1,"name":"王小明","dept":"資訊部"},{"id":2,"name":"李小華","dept":"業務部","phone":"0912-345-678"}]',
    options: [{ key: 'delimiter', label: '分隔符號', type: 'select', choices: [[',', '逗號'], ['\t', 'Tab'], [';', '分號']], default: ',' }],
    run(input, o) {
      let data = parseJson(input);
      if (!Array.isArray(data)) data = [data];
      const cols = [...new Set(data.flatMap((r) => (r && typeof r === 'object' ? Object.keys(r) : [])))];
      return csv.stringify([cols, ...data.map((r) => cols.map((c) => r[c]))], o.delimiter || ',');
    },
  },
  {
    id: 'csv.toJson', group: 'JSON / 結構化', label: 'CSV → JSON',
    description: '第一列為標題；自動判斷分隔符號與數字',
    sample: 'id,name,score\n1,王小明,92\n2,"李, 小華",88',
    options: [
      { key: 'header', label: '第一列為標題', type: 'boolean', default: true },
      { key: 'numbers', label: '數字自動轉型', type: 'boolean', default: true },
    ],
    run(input, o, s) {
      const rows = csv.parse(input, 'auto');
      const conv = (v) => (o.numbers !== false && /^-?\d+(\.\d+)?$/.test(v) && v.length < 16 ? Number(v) : v);
      if (o.header === false) return JSON.stringify(rows.map((r) => r.map(conv)), null, indentOf(s));
      const [head, ...body] = rows;
      return JSON.stringify(body.map((r) => Object.fromEntries(head.map((h, i) => [h, conv(r[i] ?? '')]))), null, indentOf(s));
    },
  },
  {
    id: 'json.escape', group: 'JSON / 結構化', label: '字串 → JSON 字串',
    description: '將文字跳脫成可放進 JSON 的字串',
    sample: '第一行\n第二行 "引號" \\ 反斜線',
    run: (input) => JSON.stringify(String(input)),
  },
  {
    id: 'json.unescape', group: 'JSON / 結構化', label: 'JSON 字串 → 字串',
    sample: '"第一行\\n第二行 \\"引號\\""',
    run(input) {
      const t = String(input).trim();
      return JSON.parse(t.startsWith('"') ? t : `"${t}"`);
    },
  },

  /* ───────── 編碼 ───────── */
  {
    id: 'base64.encode', group: '編碼', label: 'Base64 編碼',
    sample: 'Hello ToolDock 你好',
    options: [{ key: 'urlSafe', label: 'URL-safe', type: 'boolean', default: false }],
    run(input, o) {
      const b = Buffer.from(String(input), 'utf8').toString('base64');
      return o.urlSafe ? b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b;
    },
  },
  {
    id: 'base64.decode', group: '編碼', label: 'Base64 解碼',
    sample: 'SGVsbG8gVG9vbERvY2sg5L2g5aW9',
    run: (input) => b64urlDecode(String(input).trim()),
  },
  {
    id: 'url.encode', group: '編碼', label: 'URL 編碼',
    sample: 'https://example.com/搜尋?q=資料 轉換&page=1',
    options: [{ key: 'mode', label: '模式', type: 'select', choices: [['component', '元件 (encodeURIComponent)'], ['uri', '完整網址 (encodeURI)']], default: 'component' }],
    run: (input, o) => (o.mode === 'uri' ? encodeURI(input) : encodeURIComponent(input)),
  },
  {
    id: 'url.decode', group: '編碼', label: 'URL 解碼',
    sample: '%E8%B3%87%E6%96%99%20%E8%BD%89%E6%8F%9B',
    run: (input) => decodeURIComponent(String(input).replace(/\+/g, ' ')),
  },
  {
    id: 'html.escape', group: '編碼', label: 'HTML 跳脫',
    sample: '<a href="x">Tom & Jerry</a>',
    run: (input) => String(input).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  },
  {
    id: 'html.unescape', group: '編碼', label: 'HTML 反跳脫',
    sample: '&lt;b&gt;粗體&lt;/b&gt; &amp; &#x4E2D;&#25991;',
    run: (input) => String(input)
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&(lt|gt|quot|#39|apos|nbsp|amp);/g, (_, n) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', amp: '&' }[n])),
  },
  {
    id: 'unicode.escape', group: '編碼', label: 'Unicode 跳脫 (\\uXXXX)',
    sample: '資料轉換 OK',
    options: [{ key: 'all', label: '連 ASCII 一起跳脫', type: 'boolean', default: false }],
    run: (input, o) => Array.from(String(input)).map((c) => {
      const cp = c.codePointAt(0);
      if (!o.all && cp < 128) return c;
      return cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, '0')}`;
    }).join(''),
  },
  {
    id: 'unicode.unescape', group: '編碼', label: 'Unicode 反跳脫',
    sample: '\\u8cc7\\u6599\\u8f49\\u63db OK',
    run: (input) => String(input)
      .replace(/\\u\{([0-9a-f]+)\}/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))),
  },
  {
    id: 'hex.encode', group: '編碼', label: '文字 → Hex',
    sample: 'ToolDock',
    options: [{ key: 'sep', label: '以空白分隔', type: 'boolean', default: true }],
    run: (input, o) => Buffer.from(String(input), 'utf8').toString('hex').match(/../g)?.join(o.sep ? ' ' : '') || '',
  },
  {
    id: 'hex.decode', group: '編碼', label: 'Hex → 文字',
    sample: '54 6f 6f 6c 44 6f 63 6b',
    run: (input) => Buffer.from(String(input).replace(/[^0-9a-f]/gi, ''), 'hex').toString('utf8'),
  },

  /* ───────── 時間 ───────── */
  {
    id: 'time.convert', group: '時間', label: '時間戳 ⇄ 日期',
    description: '可輸入 Unix 秒 / 毫秒、ISO 日期或民國日期；每行一筆，空白表示現在',
    sample: '1700000000\n2024-02-29T08:30:00+08:00\n民國113年10月10日',
    run(input) {
      const items = String(input).trim() ? lines(input).filter((l) => l.trim()) : [''];
      return items.map((l) => {
        const d = parseTimeInput(l);
        return [
          `輸入        ${l || '(現在)'}`,
          `ISO 8601    ${d.toISOString()}`,
          `台北時間    ${fmtLocal(d, 'Asia/Taipei')}`,
          `民國        ${toRoc(d)}`,
          `Unix 秒     ${Math.floor(d.getTime() / 1000)}`,
          `Unix 毫秒   ${d.getTime()}`,
        ].join('\n');
      }).join('\n\n');
    },
  },
  {
    id: 'roc.convert', group: '時間', label: '民國 ⇄ 西元',
    description: '每行一個日期，自動判斷方向（例：113/05/20、2024-05-20）',
    sample: '113/05/20\n2024-12-31\n民國100年1月1日',
    options: [{ key: 'sep', label: '輸出分隔', type: 'select', choices: [['/', '/'], ['-', '-'], ['.', '.'], ['zh', '年月日']], default: '/' }],
    run(input, o) {
      return lines(input).map((l) => {
        const t = l.trim();
        if (!t) return '';
        const m = t.match(/^(?:民國)?\s*(\d{2,4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?$/);
        if (!m) return `${t}  ⇒  無法辨識`;
        let y = Number(m[1]);
        const isRoc = y < 1000;
        y = isRoc ? y + 1911 : y - 1911;
        if (y <= 0) return `${t}  ⇒  民國前，無法轉換`;
        const fmt = o.sep === 'zh'
          ? `${isRoc ? '' : '民國'}${y}年${Number(m[2])}月${Number(m[3])}日`
          : [isRoc ? y : pad(y, 3), pad(m[2]), pad(m[3])].join(o.sep || '/');
        return `${t}  ⇒  ${fmt}`;
      }).join('\n');
    },
  },

  /* ───────── 雜湊 / 產生器 ───────── */
  {
    id: 'hash', group: '雜湊 / 產生器', label: '雜湊 (MD5 / SHA)',
    sample: 'ToolDock',
    options: [
      { key: 'algo', label: '演算法', type: 'select', choices: [['md5', 'MD5'], ['sha1', 'SHA-1'], ['sha256', 'SHA-256'], ['sha512', 'SHA-512']], default: 'sha256' },
      { key: 'enc', label: '輸出', type: 'select', choices: [['hex', 'Hex'], ['base64', 'Base64']], default: 'hex' },
      { key: 'hmacKey', label: 'HMAC 金鑰（選填）', type: 'text', default: '' },
    ],
    run(input, o) {
      const h = o.hmacKey ? crypto.createHmac(o.algo || 'sha256', o.hmacKey) : crypto.createHash(o.algo || 'sha256');
      return h.update(String(input), 'utf8').digest(o.enc || 'hex');
    },
  },
  {
    id: 'uuid', group: '雜湊 / 產生器', label: 'UUID 產生器',
    description: '不需輸入，依數量產生 UUID v4',
    sample: '',
    options: [
      { key: 'count', label: '數量', type: 'number', default: 5 },
      { key: 'upper', label: '大寫', type: 'boolean', default: false },
    ],
    run(_input, o) {
      const n = Math.min(1000, Math.max(1, Number(o.count) || 1));
      return Array.from({ length: n }, () => (o.upper ? crypto.randomUUID().toUpperCase() : crypto.randomUUID())).join('\n');
    },
  },
  {
    id: 'jwt.decode', group: '雜湊 / 產生器', label: 'JWT 解碼',
    description: '只解碼不驗證簽章',
    sample: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuW8teS4ieS4iSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxOTAwMDAwMDAwfQ.signature',
    run(input, o, s) {
      const parts = String(input).trim().split('.');
      if (parts.length < 2) throw new Error('不是有效的 JWT（需要 header.payload.signature）');
      const header = JSON.parse(b64urlDecode(parts[0]));
      const payload = JSON.parse(b64urlDecode(parts[1]));
      const notes = [];
      for (const k of ['iat', 'nbf', 'exp']) {
        if (typeof payload[k] === 'number') notes.push(`${k}: ${fmtLocal(new Date(payload[k] * 1000), 'Asia/Taipei')}（台北）`);
      }
      if (typeof payload.exp === 'number') notes.push(payload.exp * 1000 < Date.now() ? '⚠ 已過期' : '✓ 尚未過期');
      return `// Header\n${JSON.stringify(header, null, indentOf(s))}\n\n// Payload\n${JSON.stringify(payload, null, indentOf(s))}${notes.length ? `\n\n// 時間\n${notes.join('\n')}` : ''}`;
    },
  },

  /* ───────── 文字 ───────── */
  {
    id: 'case.convert', group: '文字', label: '命名風格轉換',
    description: '每行一個名稱',
    sample: 'userName\nOrderItemId\nhttp_response_code\nmax-retry-count',
    options: [{ key: 'to', label: '轉為', type: 'select', choices: [['camel', 'camelCase'], ['pascal', 'PascalCase'], ['snake', 'snake_case'], ['kebab', 'kebab-case'], ['constant', 'CONSTANT_CASE'], ['title', 'Title Case']], default: 'snake' }],
    run: (input, o) => lines(input).map((l) => (l.trim() ? CASES[o.to || 'snake'](words(l)) : '')).join('\n'),
  },
  {
    id: 'width.toHalf', group: '文字', label: '全形 → 半形',
    sample: 'ＡＢＣ１２３！　（測試）',
    run: (input) => toHalf(input),
  },
  {
    id: 'width.toFull', group: '文字', label: '半形 → 全形',
    sample: 'ABC 123!',
    run: (input) => toFull(input),
  },
  {
    id: 'lines.sort', group: '文字', label: '行排序 / 去重複',
    sample: 'banana\napple\ncherry\napple\n',
    options: [
      { key: 'order', label: '排序', type: 'select', choices: [['asc', '遞增'], ['desc', '遞減'], ['none', '不排序']], default: 'asc' },
      { key: 'unique', label: '去除重複', type: 'boolean', default: true },
      { key: 'trim', label: '移除空白行', type: 'boolean', default: true },
    ],
    run(input, o) {
      let arr = lines(input);
      if (o.trim !== false) arr = arr.map((l) => l.trim()).filter(Boolean);
      if (o.unique !== false) arr = [...new Set(arr)];
      if (o.order === 'asc') arr.sort((a, b) => a.localeCompare(b, 'zh-Hant'));
      if (o.order === 'desc') arr.sort((a, b) => b.localeCompare(a, 'zh-Hant'));
      return arr.join('\n');
    },
  },
];
