import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalRedirect, splitBase } from '../worker/src/paths.js';

test('serves under /feeds and at the root', () => {
  assert.deepEqual(splitBase('/feeds'), { base: '/feeds', path: '/' });
  assert.deepEqual(splitBase('/feeds/'), { base: '/feeds', path: '/' });
  assert.deepEqual(splitBase('/feeds/f/abcdefghij'), { base: '/feeds', path: '/f/abcdefghij' });
  assert.deepEqual(splitBase('/feeds/api/feeds'), { base: '/feeds', path: '/api/feeds' });
  assert.deepEqual(splitBase('/feedsx'), { base: '', path: '/feedsx' });
  assert.deepEqual(splitBase('/api/feeds'), { base: '', path: '/api/feeds' });
});

test('moves workers.dev pages to the public URL, but not the API or the userscript', () => {
  const pub = 'https://gestaltschaft.com/feeds';
  const r = u => canonicalRedirect(new URL(u), pub);
  assert.equal(r('https://x-feed-share.a.workers.dev/'), pub);
  assert.equal(r('https://x-feed-share.a.workers.dev/?q=jerry'), `${pub}?q=jerry`);
  assert.equal(r('https://x-feed-share.a.workers.dev/f/abcdefghij?kind=foryou'), `${pub}/f/abcdefghij?kind=foryou`);
  assert.equal(r('https://x-feed-share.a.workers.dev/api/feeds'), null);
  assert.equal(r('https://x-feed-share.a.workers.dev/x-feed-share.user.js'), null);
  assert.equal(r('https://gestaltschaft.com/feeds/'), null);
  assert.equal(r('http://localhost:8787/'), null);
  assert.equal(canonicalRedirect(new URL('https://x.a.workers.dev/'), undefined), null);
});
