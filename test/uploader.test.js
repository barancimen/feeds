import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../core/api.js';
import { createUploader, DEBOUNCE_MS, MIN_GAP_MS } from '../core/uploader.js';

const rec = id => ({ id: String(id) });

// Fake clock and timers: run() fires the pending timer (advancing the clock to it) and awaits the upload.
function setup({ sharing = { foryou: true, following: true }, push } = {}) {
  let t = 1_000_000;
  const timers = [];
  const calls = [];
  const lost = [];
  const api = { push: async (id, body) => { calls.push({ id, at: t, ...body }); if (push) await push(body, calls.length); } };
  const up = createUploader({
    api, getFeedId: () => 'feed000001', isSharing: k => sharing[k], onAuthLost: e => lost.push(e), now: () => t,
    setTimer: (fn, ms) => { timers.push({ fn, at: t + ms, ms }); return timers.length; },
  });
  const run = async () => {
    const next = timers.shift();
    if (!next) return false;
    t = Math.max(t, next.at);
    await next.fn();
    return true;
  };
  const drain = async (max = 50) => { for (let i = 0; i < max && await run(); i++); };
  return { up, calls, lost, timers, run, drain, sharing, advance: ms => { t += ms; }, now: () => t };
}

test('uploads continuously: shortly after each capture, without waiting for the 30 s timer', async () => {
  const { up, calls, timers, run } = setup();
  up.add('following', [rec(1), rec(2)]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, DEBOUNCE_MS);
  up.add('following', [rec(3)]); // more posts arriving while waiting don't stack timers
  assert.equal(timers.length, 1);
  await run();
  assert.deepEqual(calls.map(c => c.tweets.map(x => x.id)), [['1', '2', '3']]);
  assert.equal(timers.length, 0); // nothing left, nothing scheduled
});

test('keeps uploads at least MIN_GAP_MS apart while scrolling fast', async () => {
  const { up, calls, run, advance } = setup();
  up.add('following', [rec(1)]);
  await run();
  advance(500);
  up.add('following', [rec(2)]); // next page arrives 2 s after the first upload
  await run();
  assert.equal(calls.length, 2);
  assert.ok(calls[1].at - calls[0].at >= MIN_GAP_MS, `gap was ${calls[1].at - calls[0].at}`);
});

test('ignores kinds that are not being shared', async () => {
  const { up, calls, drain } = setup({ sharing: { foryou: false, following: true } });
  up.add('foryou', [rec(1)]);
  up.add('following', [rec(2)]);
  await drain();
  assert.deepEqual(calls.map(c => [c.kind, c.tweets.map(x => x.id)]), [['following', ['2']]]);
});

test('dedupes, numbers positions in order, splits at 100 and at session breaks, drains the backlog', async () => {
  const { up, calls, drain, advance } = setup();
  up.add('following', Array.from({ length: 120 }, (_, i) => rec(i)));
  up.add('following', [rec(5), rec(119), rec(500)]); // 5 and 119 are dupes
  advance(31 * 60000); // idle gap -> new session
  up.add('following', [rec(600)]);
  await drain();
  assert.deepEqual(calls.map(c => [c.tweets.length, c.start]), [[100, 0], [21, 100], [1, 0]]);
  assert.deepEqual(calls[1].tweets.map(x => x.id).slice(-1), ['500']);
  assert.equal(calls[0].session, calls[1].session);
  assert.ok(calls[2].session > calls[0].session);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].at - calls[i - 1].at >= MIN_GAP_MS);
  assert.equal(up.stats().following.shared, 122);
  assert.equal(up.stats().following.queued, 0);
});

test('alternates between Following and For You', async () => {
  const { up, calls, drain } = setup();
  up.add('following', Array.from({ length: 150 }, (_, i) => rec(i)));
  up.add('foryou', Array.from({ length: 150 }, (_, i) => rec(`a${i}`)));
  await drain();
  assert.deepEqual(calls.map(c => [c.kind, c.tweets.length]),
    [['foryou', 100], ['following', 100], ['foryou', 50], ['following', 50]]);
});

test('429 waits for retry_after and keeps the batch; "Upload now" bypasses the pause', async () => {
  const { up, calls, timers, run, now } = setup({ push: (_b, n) => { if (n === 1) throw new ApiError(429, { error: 'slow down', retry_after: 60 }); } });
  up.add('foryou', [rec(1), rec(2)]);
  await run();
  assert.equal(up.stats().foryou.queued, 2);
  assert.ok(up.stats().pausedUntil > 0);
  assert.equal(timers.length, 1);
  assert.ok(timers[0].at - now() >= 59000); // retries on its own when the pause ends
  await run();
  assert.equal(calls.length, 2);
  assert.equal(up.stats().foryou.shared, 2);
  assert.equal(up.stats().error, null);

  const b = setup({ push: (_b, n) => { if (n === 1) throw new ApiError(429, { retry_after: 600 }); } });
  b.up.add('foryou', [rec(1)]);
  await b.run();
  await b.up.flush({ force: true });
  assert.equal(b.calls.length, 2);
  assert.equal(b.up.stats().foryou.shared, 1);
});

test('400 drops the bad batch; 401 reports a lost feed', async () => {
  const a = setup({ push: () => { throw new ApiError(400, { error: 'no valid tweets in batch' }); } });
  a.up.add('foryou', [rec(1)]);
  await a.drain();
  assert.equal(a.up.stats().foryou.queued, 0);
  assert.equal(a.up.stats().error, 'no valid tweets in batch');

  const b = setup({ push: () => { throw new ApiError(401, { error: 'bad token' }); } });
  b.up.add('foryou', [rec(1)]);
  await b.run();
  assert.equal(b.lost.length, 1);
});

test('network errors back off exponentially and retry on their own', async () => {
  const { up, calls, timers, run, now } = setup({ push: () => { throw new Error('network error'); } });
  up.add('foryou', [rec(1)]);
  await run();
  assert.equal(timers[0].at - now(), 30000);
  await run();
  assert.equal(timers[0].at - now(), 60000);
  assert.equal(calls.length, 2);
  assert.equal(up.stats().foryou.queued, 1);
});

test('clear() empties the queue and forgets seen ids', async () => {
  const { up, calls, drain } = setup();
  up.add('foryou', [rec(1)]);
  up.clear('foryou');
  up.add('foryou', [rec(1)]);
  await drain();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tweets.length, 1);
});
