'use strict';
// 從 ToolDock 平台自我測試移過來的功能測試（1.9.x 以前資料轉換是內建擴充）
const test = require('node:test');
const assert = require('node:assert/strict');
const ext = require('../backend/index');
const { createCtx } = require('./mock-ctx');

function setup(opts) {
  const t = createCtx(opts);
  ext.activate(t.ctx);
  return t;
}

test('JSON → YAML（使用自帶的 js-yaml）', async (tt) => {
  const t = setup(); tt.after(() => { ext.deactivate(); t.cleanup(); });
  const r = await t.invoke('convert', 'json.toYaml', '{"a":1,"b":["x","y"]}', {});
  assert.ok(!r.error && r.output.includes('a: 1') && r.output.includes('- x'), JSON.stringify(r));
});

test('民國 ⇄ 西元', async (tt) => {
  const t = setup(); tt.after(() => { ext.deactivate(); t.cleanup(); });
  const r = await t.invoke('convert', 'roc.convert', '113/05/20\n2024-12-31', { sep: '/' });
  assert.ok(r.output.includes('2024/05/20') && r.output.includes('113/12/31'), r.output);
});

test('全部轉換器以範例執行皆無錯誤', async (tt) => {
  const t = setup(); tt.after(() => { ext.deactivate(); t.cleanup(); });
  const list = await t.invoke('list');
  assert.ok(list.length > 10, `${list.length} 個轉換器`);
  const bad = [];
  for (const c of list) {
    const opts = Object.fromEntries((c.options || []).map((o) => [o.key, o.default]));
    const r = await t.invoke('convert', c.id, c.sample || '', opts);
    if (r.error) bad.push(`${c.id}: ${r.error}`);
  }
  assert.deepEqual(bad, []);
});

test('設定 dataConverter.indent 即時生效', async (tt) => {
  const t = setup(); tt.after(() => { ext.deactivate(); t.cleanup(); });
  t.setSetting('dataConverter.indent', 4);
  const r = await t.invoke('convert', 'json.format', '{"a":1}', {});
  assert.ok(r.output.includes('    "a"'), r.output);
  assert.ok(t.calls.emit.some(([e, p]) => e === 'settingsChanged' && p.key === 'dataConverter.indent'), '沒有通知畫面設定變更');
});

test('找不到轉換器時回傳錯誤，不丟出例外', async (tt) => {
  const t = setup(); tt.after(() => { ext.deactivate(); t.cleanup(); });
  const r = await t.invoke('convert', 'nope', 'x', {});
  assert.match(r.error, /找不到轉換器/);
});

test('資料交換 tooldock.text：放進輸入區；mime 不符被拒絕', async (tt) => {
  const t = setup(); tt.after(() => { ext.deactivate(); t.cleanup(); });
  const csv = 'name,qty\n蘋果,3';
  const r = ext.importText(t.ctx, { id: 'p1', title: '水果清單', payload: { mime: 'text/csv', text: csv, filename: 'fruit.csv' } }, { origin: 'test' });
  assert.equal(r.status, 'imported');
  const got = await t.invoke('takeImport');
  assert.equal(got.text, csv);
  assert.equal(got.mime, 'text/csv');
  assert.equal(await t.invoke('takeImport'), null, '取走後應清空');
  assert.equal(ext.importText(t.ctx, { id: 'p2', title: 'x', payload: { mime: 'image/png', text: '' } }, {}).status, 'rejected');
});

test('資料交換 tooldock.table：轉成 CSV（null 為空白、含逗號加引號）；列長度不符被拒絕', async (tt) => {
  const t = setup(); tt.after(() => { ext.deactivate(); t.cleanup(); });
  const payload = {
    columns: [{ name: 'EMP_NO' }, { name: 'NAME' }, { name: 'HOURS' }, { name: 'NOTE' }],
    rows: [['A001', '王小明', 12.5, '含, 逗號'], ['A002', '李小華', null, null]],
  };
  const r = ext.importTable(t.ctx, { id: 'p3', title: '查詢結果', payload }, { origin: 'test' });
  assert.equal(r.status, 'imported');
  const got = await t.invoke('takeImport');
  assert.equal(got.text, 'EMP_NO,NAME,HOURS,NOTE\nA001,王小明,12.5,"含, 逗號"\nA002,李小華,,');
  const bad = ext.importTable(t.ctx, { id: 'p4', title: 'x', payload: { columns: [{ name: 'a' }], rows: [[1, 2]] } }, {});
  assert.equal(bad.status, 'rejected');
  assert.match(bad.message, /欄位數/);
});
