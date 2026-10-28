// Read-only network hooks: they only look at responses to requests the page already made.
// Must be installed in the page's own JS world at document-start (adapted from x-feed.js).

import { FEED_RE, kindOf } from './parse.js';

const CREATE_RE = /\/graphql\/[^/]+\/(CreateTweet|CreateNoteTweet)(\?|$)/;

// onFeed(kind, json) for home timeline pages; onCreate(json) when the user posts (used for verification).
export function installCapture(win, onFeed, onCreate = () => {}) {
  const handlerFor = url => {
    const m = url.match(FEED_RE);
    if (m) return json => onFeed(kindOf(m[1]), json);
    return CREATE_RE.test(url) ? onCreate : null;
  };
  const emit = (handler, status, getJson) => {
    if (status !== 200) return;
    Promise.resolve().then(getJson).then(handler).catch(() => {});
  };

  const origFetch = win.fetch;
  if (typeof origFetch === 'function') {
    win.fetch = async function (...args) {
      const res = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        const h = url && handlerFor(String(url));
        if (h) emit(h, res.status, () => res.clone().json());
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
        this.addEventListener('load', () => {
          emit(h, this.status, () =>
            this.responseType === 'json' ? this.response : JSON.parse(this.responseText));
        });
      }
      return origSend.apply(this, args);
    };
  }
}
