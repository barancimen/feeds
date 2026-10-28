import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { extractFeed } from '../core/parse.js';
import { renderTweet } from '../core/render.js';
import { FOR_YOU } from './fixtures/timeline.js';

const { document } = parseHTML('<!doctype html><html><body></body></html>');

const base = (over = {}) => ({
  id: '1', created_at: '2026-10-28T12:00:00.000Z', text: 'hi', lang: 'en', reply_to: null, urls: [], media: [],
  author: { id: '9', handle: 'alice', name: 'Alice', avatar: 'https://pbs.twimg.com/profile_images/9/a_normal.jpg' },
  quoted: null, retweeted: null, ...over,
});
const hrefs = el => [...el.querySelectorAll('a')].map(a => a.getAttribute('href'));
const srcs = el => [...el.querySelectorAll('img')].map(i => i.getAttribute('src'));

test('markup in text stays inert text', () => {
  const card = renderTweet(document, base({ text: '<img src=x onerror=alert(1)><script>alert(2)</script>' }));
  assert.equal(card.querySelectorAll('script').length, 0);
  assert.deepEqual(srcs(card), ['https://pbs.twimg.com/profile_images/9/a_normal.jpg']);
  assert.ok(card.textContent.includes('<img src=x onerror=alert(1)>'));
  assert.ok(!/onerror/.test([...card.querySelectorAll('*')].flatMap(e => e.getAttributeNames()).join(' ')));
});

test('hostile URLs and handles are dropped', () => {
  const card = renderTweet(document, base({
    text: 'javascript:alert(1) and https://ok.example/x',
    urls: [{ url: 'javascript:alert(1)', display: 'click' }],
    media: [
      { type: 'photo', url: 'https://pbs.twimg.com.evil.com/x.jpg' },
      { type: 'photo', url: 'https://pbs.twimg.com@evil.com/x.jpg' },
      { type: 'photo', url: 'https://evil.com/x.jpg' },
      { type: 'photo', url: 'https://pbs.twimg.com/media/OK.jpg' },
    ],
    author: { id: '9', handle: 'alice', name: '<b>Alice</b>', avatar: 'https://evil.com/a.png' },
  }));
  assert.deepEqual(srcs(card), ['https://pbs.twimg.com/media/OK.jpg?name=small']);
  assert.ok(hrefs(card).every(h => h.startsWith('https://')));
  assert.ok(hrefs(card).includes('https://ok.example/x'));
  assert.equal(card.querySelector('.xfs-name').textContent, '<b>Alice</b>');
  assert.equal(renderTweet(document, base({ author: { id: '9', handle: '"><script>', name: 'x' } })), null);
  assert.equal(renderTweet(document, base({ id: '1 OR 1=1' })), null);
});

test('links mentions, hashtags and urls; renders retweets and quotes', () => {
  const recs = Object.fromEntries(extractFeed(FOR_YOU).map(r => [r.id, r]));
  const rt = renderTweet(document, recs['5']);
  assert.ok(rt.querySelector('.xfs-rt').textContent.includes('bob reposted'));
  assert.ok(hrefs(rt).includes('https://x.com/carol/status/5001'));

  const q = renderTweet(document, recs['6']);
  assert.ok(q.querySelector('.xfs-quote'));
  assert.ok(srcs(q).includes('https://pbs.twimg.com/media/PHOTO1.jpg?name=small'));

  const t = renderTweet(document, base({ text: 'hey @bob see #news, mail a@b.com https://example.com/page.',
    urls: [{ url: 'https://example.com/page', display: 'example.com/page' }] }));
  const links = [...t.querySelectorAll('.xfs-text a')].map(a => [a.textContent, a.getAttribute('href')]);
  assert.deepEqual(links, [
    ['@bob', 'https://x.com/bob'],
    ['#news', 'https://x.com/hashtag/news'],
    ['example.com/page', 'https://example.com/page'],
  ]);
  assert.ok(t.querySelector('.xfs-text').textContent.endsWith('example.com/page.'));
});
