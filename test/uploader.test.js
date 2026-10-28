import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../core/api.js';
import { createUploader } from '../core/uploader.js';

const rec = id => ({ id: String(id) });

function setup({ sharing = { foryou: true, following: true }, push } = {}) {
  let t = 1_000_000;
  const calls = [];
  const lost = [];
  const api = { push: async (id, body) => { calls.push({ id, ...body }); if (push) await push(body, calls.length); } };
  const up = createUploader({
    api, getFeedId: () => 'feed000001', isSharing: k => sharing[k], onAuthLost: e => lost.push(e), now: () => t,
  });
  return { up, calls, lost, sharing, advance: ms => { t += ms; } };
}

test('ignores kinds that are not being shared', async () => {
  const { up, calls } = setup({ sharing: { foryou: false, following: true } });
  up.add('foryou', [rec(1)]);
  up.add('following', [rec(2)]);
  await up.flush();
  assert.deepEqual(calls.map(c => [c.kind, c.tweets.map(x => x.id)]), [['following', ['2']]]);
});

test('dedupes, numbers positions in order, and splits batches at 100 and at session breaks', async () => {
  const { up, calls, advance } = setup();
  up.add('following', Array.from({ length: 120 }, (_, i) => rec(i)));
  up.add('following', [rec(5), rec(119), rec(500)]); // 5 and 119 are dupes
  advance(31 * 60000); // idle gap -> new session
  up.add('following', [rec(600)]);
  await up.flush();
  assert.equal(calls.length, 2); // at most 2 batches per flush
  assert.equal(calls[0].tweets.length, 100);
  assert.equal(calls[0].start, 0);
  assert.equal(calls[1].start, 100);
  assert.deepEqual(calls[1].tweets.map(x => x.id).slice(-1), ['500']);
  assert.equal(calls[0].session, calls[1].session);
  await up.flush();
  assert.equal(calls[2].start, 0);
  assert.ok(calls[2].session > calls[0].session);
  assert.equal(up.stats().following.shared, 122);
  assert.equal(up.stats().following.queued, 0);
});

test('429 pauses until retry_after and keeps the batch; force flush bypasses the pause', async () => {
  const { up, calls, advance } = setup({ push: (_b, n) => { if (n === 1) throw new ApiError(429, { error: 'slow down', retry_after: 60 }); } });
  up.add('foryou', [rec(1), rec(2)]);
  await up.flush();
  assert.equal(up.stats().foryou.queued, 2);
  assert.ok(up.stats().pausedUntil > 0);
  await up.flush();
  assert.equal(calls.length, 1); // still paused
  advance(61000);
  await up.flush();
  assert.equal(calls.length, 2);
  assert.equal(up.stats().foryou.shared, 2);
  assert.equal(up.stats().error, null);

  const b = setup({ push: (_b, n) => { if (n === 1) throw new ApiError(429, { retry_after: 600 }); } });
  b.up.add('foryou', [rec(1)]);
  await b.up.flush();
  await b.up.flush({ force: true }); // "Upload now" button
  assert.equal(b.calls.length, 2);
  assert.equal(b.up.stats().foryou.shared, 1);
});

test('400 drops the bad batch; 401 reports a lost feed', async () => {
  const a = setup({ push: () => { throw new ApiError(400, { error: 'no valid tweets in batch' }); } });
  a.up.add('foryou', [rec(1)]);
  await a.up.flush();
  assert.equal(a.up.stats().foryou.queued, 0);
  assert.equal(a.up.stats().error, 'no valid tweets in batch');

  const b = setup({ push: () => { throw new ApiError(401, { error: 'bad token' }); } });
  b.up.add('foryou', [rec(1)]);
  await b.up.flush();
  assert.equal(b.lost.length, 1);
});

test('network errors back off exponentially', async () => {
  const { up, calls, advance } = setup({ push: () => { throw new Error('network error'); } });
  up.add('foryou', [rec(1)]);
  await up.flush();
  advance(29000);
  await up.flush();
  assert.equal(calls.length, 1);
  advance(2000);
  await up.flush();
  assert.equal(calls.length, 2);
  assert.equal(up.stats().foryou.queued, 1);
});

test('clear() empties the queue and forgets seen ids', async () => {
  const { up, calls } = setup();
  up.add('foryou', [rec(1)]);
  up.clear('foryou');
  up.add('foryou', [rec(1)]);
  await up.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tweets.length, 1);
});
