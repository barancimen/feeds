// Read-only network hooks: they only look at feed responses the page already requested.
// Must be installed in the page's own JS world at document-start (adapted from x-feed.js).

import { FEED_RE, kindOf } from './parse.js';

export function installCapture(win, onFeed) {
  const emit = (op, status, getJson) => {
    if (status !== 200) return;
    Promise.resolve().then(getJson).then(json => onFeed(kindOf(op), json)).catch(() => {});
  };

  const origFetch = win.fetch;
  if (typeof origFetch === 'function') {
    win.fetch = async function (...args) {
      const res = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        const m = url && String(url).match(FEED_RE);
        if (m) emit(m[1], res.status, () => res.clone().json());
      } catch (_) { /* never break the page */ }
      return res;
    };
  }

  const XHR = win.XMLHttpRequest?.prototype;
  if (XHR) {
    const origOpen = XHR.open;
    const origSend = XHR.send;
    XHR.open = function (method, url, ...rest) {
      this.__xfsUrl = String(url);
      return origOpen.call(this, method, url, ...rest);
    };
    XHR.send = function (...args) {
      const m = this.__xfsUrl && this.__xfsUrl.match(FEED_RE);
      if (m) {
        this.addEventListener('load', () => {
          emit(m[1], this.status, () =>
            this.responseType === 'json' ? this.response : JSON.parse(this.responseText));
        });
      }
      return origSend.apply(this, args);
    };
  }
}
