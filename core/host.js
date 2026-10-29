// Runs on the privileged side (userscript sandbox or extension background) and owns the publish tokens:
// it stores each feed's token from "create feed", attaches it to that feed's calls, and never hands it back.

// One token per feed (each X account has its own feed): xfs_token_<feed id>. Before that there was a single
// token under xfs_token; it is still used for a feed that has none of its own, and moved once it works.
export const TOKEN_KEY = 'xfs_token';
export const tokenKey = id => `${TOKEN_KEY}_${id}`;

const METHODS = new Set(['GET', 'POST', 'DELETE']);
const PATH_RE = /^\/api\/(feeds(\/[a-z0-9]{10}(\/items|\/verify(\/check)?)?)?|search|version)(\?[A-Za-z0-9=&._%-]*)?$/;
const FEED_PATH = /^\/api\/feeds\/([a-z0-9]{10})(\/|\?|$)/;
const FEED_ID = /^[a-z0-9]{10}$/;

// doFetch(method, path, body, token) -> {status, data}; store: {get(key), set(key, value)} (async)
export function createPrivilegedRequest(doFetch, store) {
  return async function request(method, path, body, auth) {
    if (!METHODS.has(method) || typeof path !== 'string' || !PATH_RE.test(path)) throw new Error('blocked request');
    const id = path.match(FEED_PATH)?.[1] || null;
    let token = null;
    let legacy = false;
    if (auth) {
      if (!id) throw new Error('blocked request');
      token = await store.get(tokenKey(id));
      if (!token) { token = await store.get(TOKEN_KEY); legacy = !!token; }
      if (!token) return { status: 401, data: { error: 'no publish token on this browser' } };
    }
    const res = await doFetch(method, path, body ?? null, token);
    const ok = res.status >= 200 && res.status < 300;
    if (method === 'POST' && path === '/api/feeds' && res.data?.token) {
      if (res.status === 201 && FEED_ID.test(res.data.id)) await store.set(tokenKey(res.data.id), res.data.token);
      const { token: _, ...rest } = res.data;
      return { status: res.status, data: rest };
    }
    if (method === 'DELETE' && id && (ok || res.status === 404)) {
      await store.set(tokenKey(id), null);
      if (legacy && ok) await store.set(TOKEN_KEY, null);
    } else if (legacy && ok) {
      // The old single token belongs to this feed.
      await store.set(tokenKey(id), token);
      await store.set(TOKEN_KEY, null);
    }
    return res;
  };
}

// Settings storage exposed to page-context code: everything except the tokens.
export function guardedStore(store) {
  const check = k => { if (typeof k !== 'string' || k.startsWith(TOKEN_KEY)) throw new Error('blocked key'); };
  const out = {
    get: async k => { check(k); return store.get(k); },
    set: async (k, v) => { check(k); return store.set(k, v); },
  };
  if (store.watch) out.watch = (k, cb) => { check(k); return store.watch(k, cb); };
  return out;
}
