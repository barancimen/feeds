// Backend client. `request(method, path, body, auth)` resolves to {status, data}; it is supplied by
// the host (GM_xmlhttpRequest, the extension background, or plain fetch on the public page).

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `HTTP ${status}`);
    this.status = status;
    this.retryAfter = Number(data?.retry_after) || 0;
  }
}

const enc = encodeURIComponent;

export function createApi(request) {
  const call = async (method, path, body = null, auth = false) => {
    const { status, data } = await request(method, path, body, auth);
    if (status < 200 || status >= 300) throw new ApiError(status, data);
    return data;
  };
  return {
    listFeeds: (limit = 50) => call('GET', `/api/feeds?limit=${limit}`),
    getFeed: (id, kind, before, limit = 30) => call('GET', `/api/feeds/${enc(id)}?limit=${limit}` +
      (kind ? `&kind=${enc(kind)}` : '') + (before ? `&before=${enc(before)}` : '')),
    createFeed: label => call('POST', '/api/feeds', { label }),
    push: (id, body) => call('POST', `/api/feeds/${enc(id)}/items`, body, true),
    rename: (id, label) => call('PATCH', `/api/feeds/${enc(id)}`, { label }, true),
    remove: id => call('DELETE', `/api/feeds/${enc(id)}`, null, true),
  };
}
