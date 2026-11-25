'use strict';
const td = window.tooldock;
const $ = (s) => document.querySelector(s);
const esc = td.escape;

let converters = [];
let current = null;
let options = {};
let settings = {};
let timer = null;
const inputs = {}; // 每個轉換器記住自己的輸入

function load(key, def) { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }

function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const list = $('#list');
  list.querySelectorAll('.g, .c').forEach((n) => n.remove());
  let group = null;
  for (const c of converters) {
    if (q && !`${c.label} ${c.id} ${c.group}`.toLowerCase().includes(q)) continue;
    if (c.group !== group) {
      group = c.group;
      list.insertAdjacentHTML('beforeend', `<div class="g">${esc(group)}</div>`);
    }
    const el = document.createElement('div');
    el.className = `c ${current && current.id === c.id ? 'sel' : ''}`;
    el.textContent = c.label;
    el.title = c.description || c.label;
    el.onclick = () => select(c.id);
    list.append(el);
  }
}

function renderOptions() {
  const box = $('#opts');
  box.innerHTML = '';
  for (const o of current.options || []) {
    const label = document.createElement('label');
    let input;
    if (o.type === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!options[o.key];
      input.onchange = () => { options[o.key] = input.checked; persistOptions(); convert(); };
      label.append(input, o.label);
    } else if (o.type === 'select') {
      input = document.createElement('select');
      for (const [v, t] of o.choices) input.add(new Option(t, v, false, options[o.key] === v));
      input.onchange = () => { options[o.key] = input.value; persistOptions(); convert(); };
      label.append(o.label, input);
    } else {
      input = document.createElement('input');
      input.type = o.type === 'number' ? 'number' : 'text';
      input.value = options[o.key] ?? '';
      input.style.width = o.type === 'number' ? '80px' : '180px';
      input.oninput = () => { options[o.key] = o.type === 'number' ? Number(input.value) : input.value; persistOptions(); schedule(); };
      label.append(o.label, input);
    }
    box.append(label);
  }
}

function persistOptions() {
  save(`opts:${current.id}`, options);
}

function select(id) {
  if (current) inputs[current.id] = $('#in').value;
  current = converters.find((c) => c.id === id) || converters[0];
  save('last', current.id);
  options = Object.fromEntries((current.options || []).map((o) => [o.key, o.default]));
  Object.assign(options, load(`opts:${current.id}`, {}));
  $('#title').textContent = current.label;
  $('#desc').textContent = current.description || '';
  $('#in').value = inputs[current.id] ?? load(`in:${current.id}`, current.sample || '');
  renderList();
  renderOptions();
  convert();
}

async function convert() {
  if (!current) return;
  const input = $('#in').value;
  save(`in:${current.id}`, input.length < 200000 ? input : '');
  const out = $('#out');
  const r = await td.invoke('convert', current.id, input, options);
  if (r.error) {
    out.classList.add('error');
    out.value = r.error;
    $('#foot').textContent = '';
  } else {
    out.classList.remove('error');
    out.value = r.output;
    $('#foot').textContent = `${r.output.length.toLocaleString()} 字元 · ${r.ms.toFixed(2)} ms · 由擴充後端（獨立程序）處理`;
  }
}

function schedule() {
  if (settings['dataConverter.liveConvert'] === false) return;
  clearTimeout(timer);
  timer = setTimeout(convert, 250);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}

$('#in').addEventListener('input', schedule);
$('#search').addEventListener('input', renderList);
$('#run').onclick = convert;
$('#clear').onclick = () => { $('#in').value = ''; convert(); };
$('#sample').onclick = () => { $('#in').value = current.sample || ''; convert(); };
$('#swap').onclick = () => { if (!$('#out').classList.contains('error')) { $('#in').value = $('#out').value; convert(); } };
$('#copy').onclick = async () => { await copyText($('#out').value); td.toast('已複製輸出', 'success'); };
$('#open').onclick = async () => {
  const r = await td.dialog.open({ properties: ['openFile'], filters: [{ name: '文字檔', extensions: ['txt', 'json', 'yaml', 'yml', 'csv', 'tsv', 'log', 'xml', 'md'] }, { name: '全部', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths.length) return;
  try {
    $('#in').value = await td.invoke('readFile', r.filePaths[0]);
    convert();
  } catch (err) { td.toast(err.message, 'error'); }
};
$('#save').onclick = async () => {
  const r = await td.dialog.save({ defaultPath: `output.${current.id.includes('Yaml') ? 'yaml' : current.id.includes('Csv') ? 'csv' : current.id.startsWith('json') || current.id.endsWith('toJson') ? 'json' : 'txt'}` });
  if (r.canceled || !r.filePath) return;
  await td.invoke('writeFile', r.filePath, $('#out').value);
  td.toast(`已儲存 ${r.filePath}`, 'success');
};

td.on('settingsChanged', async () => { settings = await td.invoke('settings'); convert(); });

/* 資料交換：接收 tooldock.text、分享輸出（ToolDock 1.4.0 起） */
const MIME_CONVERTER = { 'application/json': 'json.format', 'text/csv': 'csv.toJson', 'text/yaml': 'yaml.toJson', 'text/x-yaml': 'yaml.toJson' };

async function applyImport() {
  const im = await td.invoke('takeImport');
  if (!im) return;
  const base = im.mime.split(';')[0].trim();
  const target = MIME_CONVERTER[base];
  if (target && converters.some((c) => c.id === target) && (!current || current.id !== target)) select(target);
  $('#in').value = im.text;
  convert();
  td.toast(`已載入「${im.title}」${im.filename ? `（${im.filename}）` : ''}`, 'success');
}

function outputMime(id) {
  if (/toYaml$/.test(id)) return 'text/yaml';
  if (/toCsv$/.test(id)) return 'text/csv';
  if (/^json\.(format|minify)$/.test(id) || /toJson$/.test(id)) return 'application/json';
  return 'text/plain';
}

$('#share').onclick = async () => {
  if ($('#out').classList.contains('error') || !$('#out').value) return td.toast('沒有可分享的輸出', 'warn');
  const mime = outputMime(current.id);
  const ext = { 'text/yaml': 'yaml', 'text/csv': 'csv', 'application/json': 'json' }[mime] || 'txt';
  try {
    const pkg = await td.exchange.create('tooldock.text', { mime, text: $('#out').value, filename: `output.${ext}` }, { title: `${current.label} 的結果` });
    const r = await td.exchange.share(pkg);
    const msg = {
      delivered: `已交給「${r.receiver && r.receiver.name}」`,
      exported: `已存成交換檔 ${r.filePath}`,
      'no-receiver': '目前沒有可接收的工具',
      cancelled: '已取消分享',
      error: `分享失敗：${r.message}`,
    }[r.status];
    td.toast(msg || r.status, r.status === 'error' ? 'error' : r.status === 'delivered' || r.status === 'exported' ? 'success' : 'info');
  } catch (err) {
    td.toast(err.message, 'error');
  }
};
if (td.exchange) {
  $('#share').hidden = false;
  td.on('import', () => applyImport().catch((err) => td.toast(err.message, 'error')));
}

(async () => {
  converters = await td.invoke('list');
  settings = await td.invoke('settings');
  select(load('last', converters[0].id));
  if (td.exchange) await applyImport();
})().catch((err) => { $('#title').textContent = `載入失敗：${err.message}`; });
