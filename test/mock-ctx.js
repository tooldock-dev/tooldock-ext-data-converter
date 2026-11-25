'use strict';
/**
 * 測試用的假 ctx：只實作這個擴充用到的平台 API，記錄 ui.emit、log、toast、通知等呼叫。
 * 設定值以 manifest 的 contributes.configuration 預設值為基礎，可用 settings 參數覆寫。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const pkg = require('../package.json');

function createCtx({ settings = {}, storage = {}, notify } = {}) {
  const schema = (pkg.tooldock.contributes && pkg.tooldock.contributes.configuration) || {};
  const values = { ...Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, v.default])), ...settings };
  const store = new Map(Object.entries(storage));
  const handlers = new Map();
  const commands = new Map();
  const phases = new Map();
  const changeListeners = new Set();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), `${pkg.tooldock.id}-test-`));
  const calls = { emit: [], log: [], toast: [], status: [], notify: [], openView: [], share: [] };
  const ctx = {
    extension: { id: pkg.tooldock.id, version: pkg.version, manifest: pkg.tooldock, path: path.join(__dirname, '..') },
    paths: { extension: path.join(__dirname, '..'), data, temp: data },
    subscriptions: [],
    log: {
      info: (...a) => calls.log.push(['info', a.join(' ')]),
      warn: (...a) => calls.log.push(['warn', a.join(' ')]),
      error: (...a) => calls.log.push(['error', a.join(' ')]),
    },
    ui: {
      handle: (name, fn) => { handlers.set(name, fn); return { dispose() { handlers.delete(name); } }; },
      emit: (event, payload) => { calls.emit.push([event, payload]); },
    },
    commands: {
      register: (id, fn) => { commands.set(id, fn); return { dispose() { commands.delete(id); } }; },
    },
    settings: {
      get: (key, def) => (values[key] === undefined ? def : values[key]),
      all: () => ({ ...values }),
      onDidChange: (fn) => { changeListeners.add(fn); return { dispose() { changeListeners.delete(fn); } }; },
    },
    storage: {
      get: (key, def) => (store.has(key) ? JSON.parse(JSON.stringify(store.get(key))) : def),
      set: (key, value) => { store.set(key, JSON.parse(JSON.stringify(value))); return true; },
    },
    lifecycle: {
      on: (phase, fn) => { phases.set(phase, fn); return { dispose() { phases.delete(phase); } }; },
    },
    window: {
      openView: async (viewId) => { calls.openView.push(viewId); return true; },
      toast: async (message, type) => { calls.toast.push([message, type]); return true; },
      notify: async (title, body) => { calls.notify.push({ title, body }); return true; },
      setStatus: async (item) => { calls.status.push(item); return true; },
    },
    notify: {
      send: async (n) => { calls.notify.push(n); return notify ? notify(n) : { status: 'sent' }; },
    },
    exchange: {
      create: (type, payload, meta) => ({ id: `pkg-${calls.share.length + 1}`, type, typeVersion: 1, payload, title: meta && meta.title, meta }),
      share: async (p, options) => { calls.share.push({ pkg: p, options }); return { status: 'delivered', receiver: { extId: 'test-receiver' }, result: { status: 'imported' } }; },
    },
  };
  return {
    ctx,
    calls,
    store,
    /** 呼叫 ctx.ui.handle 註冊的方法（等同畫面的 tooldock.invoke） */
    invoke: async (name, ...args) => {
      const fn = handlers.get(name);
      if (!fn) throw new Error(`沒有註冊 ${name}`);
      return fn(...args);
    },
    command: (id, ...args) => commands.get(id)(...args),
    phase: (id, payload) => phases.get(id)(payload),
    setSetting: (key, value) => { values[key] = value; for (const fn of changeListeners) fn(key, value); },
    cleanup: () => {
      for (const s of ctx.subscriptions) if (s && s.dispose) s.dispose();
      fs.rmSync(data, { recursive: true, force: true });
    },
  };
}

module.exports = { createCtx };
