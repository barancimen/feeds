import assert from 'node:assert/strict';
import test from 'node:test';
import { createUpdateChecker, isNewer, UPDATE_KEY } from '../core/update.js';

test('compares versions numerically', () => {
  assert.equal(isNewer('0.2.0', '0.1.9'), true);
  assert.equal(isNewer('0.10.0', '0.9.0'), true);
  assert.equal(isNewer('1.0', '1.0.0'), false);
  assert.equal(isNewer('0.1.2', '0.1.2'), false);
  assert.equal(isNewer('0.1.1', '0.1.2'), false);
});

test('checks at most every 6 hours and snoozes the notice for a day', async () => {
  let t = 1e12;
  let calls = 0;
  let latest = '0.3.0';
  const m = new Map();
  const store = { get: async k => m.get(k) ?? null, set: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); } };
  const api = { version: async () => { calls++; return { version: latest }; } };
  const make = () => createUpdateChecker({ api, store, version: '0.2.0', now: () => t });

  const u = make();
  await u.check();
  assert.equal(u.available(), '0.3.0');
  assert.equal(calls, 1);
  const other = make(); // another tab or page load: uses the stored answer
  await other.check();
  assert.equal(calls, 1);
  assert.equal(other.available(), '0.3.0');

  await u.snooze();
  assert.equal(u.available(), null);
  t += 25 * 3600e3;
  latest = '0.3.1';
  await u.check();
  assert.equal(calls, 2);
  assert.equal(u.available(), '0.3.1');
  assert.equal(m.get(UPDATE_KEY).latest, '0.3.1');

  latest = '<script>';
  t += 7 * 3600e3;
  await u.check();
  assert.equal(u.available(), '0.3.1'); // junk from the server is ignored
  assert.equal(createUpdateChecker({ api, store, version: '0.4.0', now: () => t }).available(), null);
});
