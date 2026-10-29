// Read-only network hooks: they only look at responses to requests the page already made.
// Must be installed in the page's own JS world at document-start (adapted from x-feed.js).

import { FEED_RE, kindOf } from './parse.js';

const CREATE_RE = /\/graphql\/[^/]+\/(CreateTweet|CreateNoteTweet)(\?|$)/;

// onFeed(kind, json, tag) for home timeline pages; onCreate(json, tag) when the user posts (used for
// verification). `tag()` runs as each of those requests starts; the app uses it to note which X account
// made the request, so a response that arrives after an account switch still goes to the right feed.
export function installCapture(win, onFeed, onCreate = () => {}, tag = () => null) {
  const handlerFor = url => {
    const m = url.match(FEED_RE);
    if (m) return (json, t) => onFeed(kindOf(m[1]), json, t);
    return CREATE_RE.test(url) ? onCreate : null;
  };
  const tagNow = () => { try { return tag(); } catch (_) { return null; } };
  const emit = (handler, t, status, getJson) => {
    if (status !== 200) return;
    Promise.resolve().then(getJson).then(json => handler(json, t)).catch(() => {});
  };

  const origFetch = win.fetch;
  if (typeof origFetch === 'function') {
    win.fetch = async function (...args) {
      let h = null;
      let t = null;
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : input?.url ?? input?.href;
        h = url ? handlerFor(String(url)) : null;
        if (h) t = tagNow();
      } catch (_) { h = null; /* never break the page */ }
      const res = await origFetch.apply(this, args);
      try {
        if (h) emit(h, t, res.status, () => res.clone().json());
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
      const h = this.__xfsUrl && handlerFor(this.__xfsUrl);
      if (h) {
        const t = tagNow();
        this.addEventListener('load', () => {
          emit(h, t, this.status, () =>
            this.responseType === 'json' ? this.response : JSON.parse(this.responseText));
        });
      }
      return origSend.apply(this, args);
    };
  }
}
