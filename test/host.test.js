import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrivilegedRequest, guardedStore, TOKEN_KEY, tokenKey } from '../core/host.js';

function memStore() {
  const m = new Map();
  return { m, get: async k => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); } };
}

test('keeps one token per feed on the privileged side', async () => {
  const store = memStore();
  const seen = [];
  let n = 0;
  const request = createPrivilegedRequest(async (method, path, body, token) => {
    seen.push({ method, path, token });
    if (path === '/api/feeds' && method === 'POST') {
      n++;
      return { status: 201, data: { id: n === 1 ? 'aaaaaaaaaa' : 'bbbbbbbbbb', token: `SECRET${n}`, label: 'me' } };
    }
    return { status: 200, data: {} };
  }, store);

  const a = await request('POST', '/api/feeds', { label: '@a' }, false);
  assert.deepEqual(a.data, { id: 'aaaaaaaaaa', label: 'me' });
  await request('POST', '/api/feeds', { label: '@b' }, false);
  assert.equal(store.m.get(tokenKey('aaaaaaaaaa')), 'SECRET1');
  assert.equal(store.m.get(tokenKey('bbbbbbbbbb')), 'SECRET2');

  await request('POST', '/api/feeds/aaaaaaaaaa/items', { kind: 'foryou', tweets: [] }, true);
  await request('POST', '/api/feeds/bbbbbbbbbb/items', { kind: 'foryou', tweets: [] }, true);
  await request('GET', '/api/feeds?limit=50', null, false);
  await request('POST', '/api/feeds/bbbbbbbbbb/verify/check', { tweet_id: '1' }, true);
  assert.deepEqual(seen.slice(2).map(s => s.token), ['SECRET1', 'SECRET2', null, 'SECRET2']);

  await request('DELETE', '/api/feeds/aaaaaaaaaa', null, true);
  assert.equal(store.m.get(tokenKey('aaaaaaaaaa')), null);
  assert.equal(store.m.get(tokenKey('bbbbbbbbbb')), 'SECRET2');
  assert.equal((await request('POST', '/api/feeds/aaaaaaaaaa/verify', {}, true)).status, 401);
  await assert.rejects(request('POST', '/api/feeds', {}, true), /blocked request/); // auth needs a feed
});

test('moves the single token from before per-account feeds to the feed it works for', async () => {
  const store = memStore();
  store.m.set(TOKEN_KEY, 'OLD');
  const request = createPrivilegedRequest(async (method, path, body, token) =>
    ({ status: path.includes('oooooooooo') && token === 'OLD' ? 200 : 401, data: {} }), store);
  assert.equal((await request('POST', '/api/feeds/xxxxxxxxxx/items', {}, true)).status, 401);
  assert.equal(store.m.get(TOKEN_KEY), 'OLD'); // not that feed's token: left alone
  assert.equal((await request('POST', '/api/feeds/oooooooooo/items', {}, true)).status, 200);
  assert.equal(store.m.get(tokenKey('oooooooooo')), 'OLD');
  assert.equal(store.m.get(TOKEN_KEY), null);
});

test('blocks unexpected requests and the token keys', async () => {
  const request = createPrivilegedRequest(async () => ({ status: 200, data: {} }), memStore());
  for (const [m, p] of [['GET', 'https://evil.com/'], ['GET', '//evil.com/api/feeds'], ['PUT', '/api/feeds'],
    ['GET', '/api/feeds/../../x'], ['GET', '/admin'], ['POST', '/api/feeds/abcdefghij/verify/x'], ['GET', '/api/versions'], ['PATCH', '/api/feeds/abcdefghij']]) {
    await assert.rejects(request(m, p, null, true), /blocked request/);
  }
  assert.equal((await request('GET', '/api/version', null, false)).status, 200);
  const g = guardedStore(memStore());
  for (const k of [TOKEN_KEY, tokenKey('abcdefghij')]) {
    await assert.rejects(g.get(k), /blocked key/);
    await assert.rejects(g.set(k, 'x'), /blocked key/);
  }
  await g.set('xfs_settings_v2', { a: 1 });
  assert.deepEqual(await g.get('xfs_settings_v2'), { a: 1 });
});
