import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { createApi } from '../core/api.js';
import { renderSearch } from '../core/browse.js';
import { createPrivilegedRequest } from '../core/host.js';

const { document, Event } = parseHTML('<!doctype html><html><body><div id="m"></div></body></html>');
const tick = () => new Promise(r => setTimeout(r, 5));

const tweet = (id, text) => ({ id, created_at: '2026-10-28T12:00:00.000Z', text, lang: 'en', reply_to: null, urls: [], media: [],
  author: { id: '9', handle: 'alice', name: 'Alice', avatar: null }, quoted: null, retweeted: null });

test('search queries survive the host path allowlist, whatever the user types', async () => {
  const paths = [];
  const request = createPrivilegedRequest(async (m, path) => { paths.push(path); return { status: 200, data: { results: [], feeds: [] } }; },
    { get: async () => null, set: async () => {} });
  const api = createApi(request);
  await api.search("it's (ok)! ~*naïve* \"quoted\" & more", { feed: 'abcdefghij', kind: 'foryou', offset: 20 });
  await api.listFeeds({ q: '@me + 100% _real_', before: '1730000000000.abcdefghij' });
  assert.equal(paths.length, 2);
  assert.equal(paths[0], '/api/search?q=it%27s%20%28ok%29%21%20%7E%2Ana%C3%AFve%2A%20%22quoted%22%20%26%20more' +
    '&feed=abcdefghij&kind=foryou&offset=20&limit=20');
  assert.equal(paths[1], '/api/feeds?limit=50&q=%40me%20%2B%20100%25%20_real_&before=1730000000000.abcdefghij');
});

test('search view lists feeds and posts, links "seen in" chips to feeds, and keeps keystrokes local', async () => {
  const calls = [];
  const api = {
    listFeeds: async opts => { calls.push(['feeds', opts]); return { feeds: [{ id: 'feedaaaaaa', label: 'jerry fans', last_push_at: Date.now(), foryou_at: 1 }], next: null }; },
    search: async (q, opts) => {
      calls.push(['search', q, opts]);
      return { results: [
        { tweet: tweet('1', 'Tom & Jerry'), seen: [
          { feed_id: 'feedaaaaaa', kind: 'foryou', label: 'jerry fans', session: Date.now() },
          { feed_id: 'feedbbbbbb', kind: 'following', label: 'other', session: Date.now() },
          { feed_id: 'feedcccccc', kind: 'following', label: 'third', session: Date.now() },
          { feed_id: 'feeddddddd', kind: 'following', label: 'fourth', session: Date.now() }] },
        { tweet: { id: 'bad' }, seen: [] },
      ], next: null };
    },
  };
  const opened = [];
  const searched = [];
  const nav = { home() {}, openFeed: (id, kind) => opened.push([id, kind]), search: (q, f) => searched.push([q, f]) };
  const mount = document.getElementById('m');
  await renderSearch(document, mount, api, 'jerry', nav);
  await tick();

  assert.deepEqual(calls[0], ['feeds', { q: 'jerry', limit: 10 }]);
  assert.deepEqual(calls[1], ['search', 'jerry', { feed: undefined, offset: 0 }]);
  assert.equal(mount.querySelectorAll('.xfs-feed').length, 1);
  assert.equal(mount.querySelectorAll('.xfs-card').length, 1); // invalid record skipped
  const chips = [...mount.querySelectorAll('.xfs-chip')];
  assert.equal(chips.length, 3);
  assert.match(chips[0].textContent, /^jerry fans · For You · /);
  assert.match(mount.querySelector('.xfs-seen').textContent, /\+1 more$/);
  chips[1].onclick();
  assert.deepEqual(opened, [['feedbbbbbb', 'following']]);

  let leaked = 0;
  document.addEventListener('keydown', () => leaked++);
  const input = mount.querySelector('.xfs-search input');
  input.dispatchEvent(new Event('keydown', { bubbles: true }));
  mount.dispatchEvent(new Event('keydown', { bubbles: true }));
  assert.equal(leaked, 1); // only the event that didn't start in the search box

  input.value = '  tom  ';
  mount.querySelector('.xfs-search').dispatchEvent(new Event('submit', { cancelable: true }));
  assert.deepEqual(searched, [['tom', undefined]]);
});

test('scoped search skips feed-name results and shows one chip per post', async () => {
  const api = {
    listFeeds: async () => { throw new Error('should not be called'); },
    search: async (q, opts) => ({ results: [{ tweet: tweet('1', 'x'), seen: [
      { feed_id: 'feedaaaaaa', kind: 'foryou', label: 'a', session: Date.now() }] }], next: 20, opts }),
  };
  const mount = document.getElementById('m');
  await renderSearch(document, mount, api, 'x', { home() {}, openFeed() {}, search() {} }, { feed: 'feedaaaaaa', feedLabel: 'a' });
  assert.equal(mount.querySelectorAll('.xfs-feed').length, 0);
  assert.match(mount.querySelector('.xfs-chip').textContent, /^For You · /);
  assert.equal(mount.querySelector('.xfs-more').textContent, 'Load more');
  assert.match(mount.textContent, /Searching in a/);
});
