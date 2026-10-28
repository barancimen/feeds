import assert from 'node:assert/strict';
import test from 'node:test';
import { installCapture } from '../core/capture.js';
import { FOLLOWING } from './fixtures/timeline.js';

const tick = () => new Promise(r => setTimeout(r, 5));
const BASE = 'https://x.com/i/api/graphql/Q1w2/';

class FakeXHR {
  constructor() { this.listeners = {}; this.status = 0; this.responseType = ''; this.responseText = ''; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  open(method, url) { this.url = url; }
  send() {
    setTimeout(() => {
      this.status = 200;
      this.responseText = JSON.stringify(FOLLOWING);
      for (const f of this.listeners.load || []) f();
    }, 1);
  }
}

test('fetch hook reports feed responses with the right kind and leaves the response intact', async () => {
  const got = [];
  const win = {
    fetch: async (input) => new Response(JSON.stringify(FOLLOWING), { status: String(input).includes('429') ? 429 : 200 }),
    XMLHttpRequest: FakeXHR,
  };
  installCapture(win, (kind, json) => got.push([kind, json]));
  const res = await win.fetch(BASE + 'HomeLatestTimeline?variables=%7B%7D');
  assert.deepEqual(await res.json(), FOLLOWING); // page still gets its body
  await win.fetch(new Request(BASE + 'HomeTimeline'));
  await win.fetch(BASE + 'UserTweets');
  await win.fetch(BASE + 'HomeTimeline?x=429');
  await tick();
  assert.deepEqual(got.map(g => g[0]), ['following', 'foryou']);
  assert.deepEqual(got[0][1], FOLLOWING);
});

test('XHR hook reports feed responses', async () => {
  const got = [];
  const win = { XMLHttpRequest: FakeXHR };
  installCapture(win, kind => got.push(kind));
  const x = new win.XMLHttpRequest();
  x.open('GET', BASE + 'HomeTimeline?variables=1');
  x.send();
  const y = new win.XMLHttpRequest();
  y.open('GET', BASE + 'TweetDetail');
  y.send();
  await tick();
  assert.deepEqual(got, ['foryou']);
});

test('reports the user\'s own CreateTweet responses separately from feeds', async () => {
  const feeds = [];
  const created = [];
  const body = { data: { create_tweet: { tweet_results: { result: { rest_id: '1' } } } } };
  const win = { fetch: async () => new Response(JSON.stringify(body), { status: 200 }) };
  installCapture(win, k => feeds.push(k), json => created.push(json));
  await win.fetch(BASE + 'CreateTweet', { method: 'POST' });
  await win.fetch(BASE + 'CreateNoteTweet', { method: 'POST' });
  await win.fetch(BASE + 'CreateTweetDraft', { method: 'POST' });
  await tick();
  assert.equal(feeds.length, 0);
  assert.deepEqual(created, [body, body]);
});
