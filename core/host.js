// Runs on the privileged side (userscript sandbox or extension background) and owns the publish token:
// it stores the token from "create feed", attaches it to authenticated calls, and never hands it back.

export const TOKEN_KEY = 'xfs_token';

const METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
const PATH_RE = /^\/api\/(feeds(\/[a-z0-9]{10}(\/items|\/verify(\/check)?)?)?|search)(\?[A-Za-z0-9=&._%-]*)?$/;

// doFetch(method, path, body, token) -> {status, data}; store: {get(key), set(key, value)} (async)
export function createPrivilegedRequest(doFetch, store) {
  return async function request(method, path, body, auth) {
    if (!METHODS.has(method) || typeof path !== 'string' || !PATH_RE.test(path)) throw new Error('blocked request');
    const token = auth ? await store.get(TOKEN_KEY) : null;
    if (auth && !token) return { status: 401, data: { error: 'no publish token on this browser' } };
    const res = await doFetch(method, path, body ?? null, token);
    if (method === 'POST' && path === '/api/feeds' && res.status === 201 && res.data?.token) {
      await store.set(TOKEN_KEY, res.data.token);
      const { token: _, ...rest } = res.data;
      return { status: res.status, data: rest };
    }
    if (method === 'DELETE' && (res.status === 200 || res.status === 404)) await store.set(TOKEN_KEY, null);
    return res;
  };
}

// Settings storage exposed to page-context code: everything except the token.
export function guardedStore(store) {
  const check = k => { if (typeof k !== 'string' || k === TOKEN_KEY) throw new Error('blocked key'); };
  return {
    get: async k => { check(k); return store.get(k); },
    set: async (k, v) => { check(k); return store.set(k, v); },
  };
}
