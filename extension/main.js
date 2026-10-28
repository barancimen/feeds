/* global __API__ */
// MAIN-world content script: capture, parse, panel and uploader. It has no extension APIs, so backend
// requests and storage go through bridge.js -> background.js, which also keeps the publish token.

import { startApp } from '../core/app.js';

const pending = new Map();
let seq = 0;

window.addEventListener('message', e => {
  if (e.source !== window || e.data?.__xfs !== 'res') return;
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
});

function call(msg) {
  return new Promise((resolve, reject) => {
    const id = `${++seq}:${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('extension did not answer; refresh this tab')); }, 25000);
    pending.set(id, {
      resolve: v => { clearTimeout(timer); resolve(v); },
      reject: e => { clearTimeout(timer); reject(e); },
    });
    window.postMessage({ __xfs: 'req', id, msg }, location.origin);
  });
}

startApp({
  win: window,
  apiOrigin: __API__,
  request: (method, path, body, auth) => call({ op: 'request', method, path, body, auth }),
  store: {
    get: key => call({ op: 'get', key }),
    set: (key, value) => call({ op: 'set', key, value }),
  },
});
