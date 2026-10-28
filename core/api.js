// Backend client. `request(method, path, body, auth)` resolves to {status, data}; it is supplied by
// the host (GM_xmlhttpRequest, the extension background, or plain fetch on the public page).

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `HTTP ${status}`);
    this.status = status;
    this.retryAfter = Number(data?.retry_after) || 0;
  }
}

// Stricter than encodeURIComponent, so every query string stays within the host's path allowlist.
const enc = s => encodeURIComponent(s).replace(/[!'()*~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const qs = params => Object.entries(params).filter(([, v]) => v != null && v !== '')
  .map(([k, v]) => `${k}=${enc(String(v))}`).join('&');

export function createApi(request) {
  const call = async (method, path, body = null, auth = false) => {
    const { status, data } = await request(method, path, body, auth);
    if (status < 200 || status >= 300) throw new ApiError(status, data);
    return data;
  };
  return {
    listFeeds: ({ q, before, limit = 50 } = {}) => call('GET', `/api/feeds?${qs({ limit, q, before })}`),
    search: (q, { feed, kind, offset, limit = 20 } = {}) => call('GET', `/api/search?${qs({ q, feed, kind, offset, limit })}`),
    getFeed: (id, kind, before, limit = 30) => call('GET', `/api/feeds/${enc(id)}?limit=${limit}` +
      (kind ? `&kind=${enc(kind)}` : '') + (before ? `&before=${enc(before)}` : '')),
    createFeed: label => call('POST', '/api/feeds', { label }),
    push: (id, body) => call('POST', `/api/feeds/${enc(id)}/items`, body, true),
    rename: (id, label) => call('PATCH', `/api/feeds/${enc(id)}`, { label }, true),
    startVerify: id => call('POST', `/api/feeds/${enc(id)}/verify`, {}, true),
    checkVerify: (id, tweetId) => call('POST', `/api/feeds/${enc(id)}/verify/check`, { tweet_id: tweetId }, true),
    remove: id => call('DELETE', `/api/feeds/${enc(id)}`, null, true),
  };
}
