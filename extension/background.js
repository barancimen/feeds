/* global __API__ */
// Service worker: the only place that talks to the backend and the only holder of the publish token.

import { createPrivilegedRequest, guardedStore } from '../core/host.js';

const store = {
  get: async k => (await chrome.storage.local.get(k))[k] ?? null,
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};
const settings = guardedStore(store);

async function doFetch(method, path, body, token) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(__API__ + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* non-JSON error page */ }
  return { status: res.status, data };
}

const request = createPrivilegedRequest(doFetch, store);

async function handle(m) {
  if (m.op === 'request') return request(m.method, m.path, m.body, !!m.auth);
  if (m.op === 'get') return settings.get(m.key);
  if (m.op === 'set') return settings.set(m.key, m.value);
  throw new Error('unknown op');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.op !== 'string') return false;
  handle(msg).then(result => sendResponse({ result }), e => sendResponse({ error: String(e?.message || e) }));
  return true;
});
