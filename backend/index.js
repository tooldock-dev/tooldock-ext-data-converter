'use strict';
const fs = require('fs');
const converters = require('./converters');
const csv = require('./csv');

const MAX_FILE = 10 * 1024 * 1024;
let pendingImport = null; // 收到但畫面還沒取走的 tooldock.text

exports.activate = (ctx) => {
  const find = (id) => {
    const c = converters.find((x) => x.id === id);
    if (!c) throw new Error(`找不到轉換器 ${id}`);
    return c;
  };

  // 前端可呼叫的方法：tooldock.invoke('list') / tooldock.invoke('convert', id, input, options)
  ctx.ui.handle('list', () => converters.map(({ run, ...meta }) => meta));

  ctx.ui.handle('convert', (id, input, options) => {
    const t0 = process.hrtime.bigint();
    try {
      const output = find(id).run(input == null ? '' : String(input), options || {}, ctx.settings.all());
      return { output: String(output), ms: Number(process.hrtime.bigint() - t0) / 1e6 };
    } catch (err) {
      return { error: err.message };
    }
  });

  ctx.ui.handle('readFile', (file) => {
    const st = fs.statSync(file);
    if (st.size > MAX_FILE) throw new Error('檔案超過 10MB');
    return fs.readFileSync(file, 'utf8');
  });

  ctx.ui.handle('writeFile', (file, content) => {
    fs.writeFileSync(file, content, 'utf8');
    return true;
  });

  ctx.ui.handle('settings', () => ctx.settings.all());

  // 畫面載入後取走待開啟的交換資料（平台會先開啟畫面再呼叫 handler，畫面可能還沒載入完成）
  ctx.ui.handle('takeImport', () => {
    const x = pendingImport;
    pendingImport = null;
    return x;
  });

  ctx.subscriptions.push(
    ctx.commands.register('dataConverter.open', () => ctx.window.openView('dataConverter.main')),
    ctx.settings.onDidChange((key) => ctx.ui.emit('settingsChanged', { key })),
  );

  ctx.log.info(`資料轉換工具已啟用，共 ${converters.length} 種轉換器`);
};

/**
 * 資料交換：接收 tooldock.text（docs/EXCHANGE.md〈5.5〉），放進輸入區。
 * payload：{ mime: 'text/*' | 'application/json', text, filename? }
 */
exports.importText = (ctx, pkg, info) => {
  const p = pkg.payload || {};
  if (typeof p.mime !== 'string' || !(/^text\/[\w.+-]+/i.test(p.mime) || /^application\/json\b/i.test(p.mime))) {
    return { status: 'rejected', message: 'mime 必須是 text/* 或 application/json' };
  }
  if (typeof p.text !== 'string') return { status: 'rejected', message: 'payload.text 必須是字串' };
  pendingImport = {
    id: pkg.id,
    title: pkg.title,
    mime: p.mime.toLowerCase(),
    text: p.text,
    filename: typeof p.filename === 'string' ? p.filename : null,
    origin: info.origin,
  };
  ctx.ui.emit('import', { id: pkg.id });
  ctx.log.info(`收到文字交換包「${pkg.title}」（${p.mime}，${p.text.length} 字元）`);
  return { status: 'imported', message: `已在資料轉換開啟「${pkg.title}」` };
};

/**
 * 資料交換：接收 tooldock.table（docs/EXCHANGE.md〈5.4〉），轉成 CSV 放進輸入區，畫面切到「CSV → JSON」。
 * payload：{ columns: [{ name, title?, type? }], rows: any[][] }；標題列使用 columns[].name。
 */
exports.importTable = (ctx, pkg, info) => {
  const p = pkg.payload || {};
  const cols = p.columns;
  if (!Array.isArray(cols) || !cols.length || !cols.every((c) => c && typeof c.name === 'string' && c.name)) {
    return { status: 'rejected', message: 'columns 必須是非空陣列，每個欄位都要有 name' };
  }
  if (!Array.isArray(p.rows)) return { status: 'rejected', message: 'rows 必須是陣列' };
  const bad = p.rows.findIndex((r) => !Array.isArray(r) || r.length !== cols.length);
  if (bad >= 0) return { status: 'rejected', message: `第 ${bad + 1} 列的欄位數與 columns（${cols.length} 個）不符` };
  const cell = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const text = csv.stringify([cols.map((c) => c.name), ...p.rows.map((r) => r.map(cell))], ',');
  pendingImport = {
    id: pkg.id,
    title: pkg.title,
    mime: 'text/csv',
    text,
    filename: `${String(pkg.title).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)}.csv`,
    origin: info.origin,
  };
  ctx.ui.emit('import', { id: pkg.id });
  ctx.log.info(`收到表格交換包「${pkg.title}」（${cols.length} 欄、${p.rows.length} 列）`);
  return { status: 'imported', message: `已在資料轉換開啟「${pkg.title}」（${p.rows.length} 列，CSV）` };
};

exports.deactivate = () => { pendingImport = null; };
