/* global GM_xmlhttpRequest, GM_getValue, GM_setValue, unsafeWindow, __API__ */
// Userscript wrapper. Runs in the page's JS world (@sandbox JavaScript / @inject-into page) so the
// network hooks see X's own requests; talks to the backend with GM_xmlhttpRequest because x.com's
// CSP blocks page-context requests to other origins.

import { startApp } from '../core/app.js';
import { createPrivilegedRequest, guardedStore } from '../core/host.js';

const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
const store = {
  get: async k => GM_getValue(k, null),
  set: async (k, v) => GM_setValue(k, v),
};

function gmFetch(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    GM_xmlhttpRequest({
      method,
      url: __API__ + path,
      headers,
      data: body ? JSON.stringify(body) : undefined,
      timeout: 20000,
      onload: r => {
        let data = null;
        try { data = JSON.parse(r.responseText); } catch (_) { /* non-JSON error page */ }
        resolve({ status: r.status, data });
      },
      onerror: () => reject(new Error('network error')),
      ontimeout: () => reject(new Error('request timed out')),
    });
  });
}

startApp({ win, apiOrigin: __API__, request: createPrivilegedRequest(gmFetch, store), store: guardedStore(store) });

setTimeout(() => {
  if (!win.webpackChunk_twitter_responsive_web) {
    console.warn('[x-feed-share] Not running in the page context, so feeds will not be captured. ' +
      'In Violentmonkey, set "inject-into" to "page"; in Tampermonkey, use the default (JavaScript) sandbox.');
  }
}, 5000);
