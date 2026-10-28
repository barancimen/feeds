import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrivilegedRequest, guardedStore, TOKEN_KEY } from '../core/host.js';

function memStore() {
  const m = new Map();
  return { m, get: async k => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); } };
}

test('keeps the token on the privileged side', async () => {
  const store = memStore();
  const seen = [];
  const request = createPrivilegedRequest(async (method, path, body, token) => {
    seen.push({ method, path, token });
    if (path === '/api/feeds' && method === 'POST') return { status: 201, data: { id: 'abcdefghij', token: 'SECRET', label: 'me' } };
    return { status: 200, data: {} };
  }, store);

  const created = await request('POST', '/api/feeds', { label: 'me' }, false);
  assert.deepEqual(created.data, { id: 'abcdefghij', label: 'me' });
  assert.equal(store.m.get(TOKEN_KEY), 'SECRET');

  await request('POST', '/api/feeds/abcdefghij/items', { kind: 'foryou', tweets: [] }, true);
  await request('GET', '/api/feeds?limit=50', null, false);
  await request('POST', '/api/feeds/abcdefghij/verify', {}, true);
  await request('POST', '/api/feeds/abcdefghij/verify/check', { tweet_id: '1' }, true);
  assert.equal(seen[1].token, 'SECRET');
  assert.equal(seen[2].token, null);

  await request('DELETE', '/api/feeds/abcdefghij', null, true);
  assert.equal(store.m.get(TOKEN_KEY), null);
  assert.equal((await request('PATCH', '/api/feeds/abcdefghij', {}, true)).status, 401);
});

test('blocks unexpected requests and the token key', async () => {
  const request = createPrivilegedRequest(async () => ({ status: 200, data: {} }), memStore());
  for (const [m, p] of [['GET', 'https://evil.com/'], ['GET', '//evil.com/api/feeds'], ['PUT', '/api/feeds'],
    ['GET', '/api/feeds/../../x'], ['GET', '/admin'], ['POST', '/api/feeds/abcdefghij/verify/x']]) {
    await assert.rejects(request(m, p, null, true), /blocked request/);
  }
  const g = guardedStore(memStore());
  await assert.rejects(g.get(TOKEN_KEY), /blocked key/);
  await assert.rejects(g.set(TOKEN_KEY, 'x'), /blocked key/);
  await g.set('xfs_settings', { a: 1 });
  assert.deepEqual(await g.get('xfs_settings'), { a: 1 });
});
