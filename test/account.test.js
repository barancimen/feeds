import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { handleFromDom, legacyFits, migrateSettings, normalizeSettings, uidFromCookie } from '../core/account.js';

test('reads the signed-in account from the twid cookie', () => {
  assert.equal(uidFromCookie('guest_id=v1%3A1; twid=u%3D1234567890; ct0=abc'), '1234567890');
  assert.equal(uidFromCookie('twid="u=42"'), '42');
  assert.equal(uidFromCookie('mytwid=u%3D1; x=1'), null);
  assert.equal(uidFromCookie('guest_id=1'), null);
  assert.equal(uidFromCookie(''), null);
});

test('reads the handle from X\'s navigation', () => {
  const { document } = parseHTML('<nav><a data-testid="AppTabBar_Profile_Link" href="/some_one">Profile</a></nav>');
  assert.equal(handleFromDom(document), 'some_one');
  assert.equal(handleFromDom(parseHTML('<a data-testid="AppTabBar_Profile_Link" href="/a/b">x</a>').document), null);
});

test('keeps only well-formed settings', () => {
  const now = 1000;
  const s = normalizeSettings({
    open: 1, paused: true,
    accounts: {
      '111': { handle: 'alice', paused: 0, feed: { id: 'abcdefghij', label: '@alice', verified: { handle: 'alice', at: 5 } },
        share: { foryou: true }, verify: { code: 'abcd2345', text: 'x', until: 2000 } },
      '222': { handle: '<b>', feed: { id: 'bad' }, verify: { code: 'abcd2345', until: 500 } },
      '__proto__': { handle: 'evil' },
      'abc': { handle: 'x' },
    },
  }, now);
  assert.equal(s.open, true);
  assert.equal(s.paused, true);
  assert.deepEqual(Object.keys(s.accounts), ['111', '222']);
  assert.deepEqual(s.accounts['111'], {
    handle: 'alice', paused: false, feed: { id: 'abcdefghij', label: '@alice', verified: { handle: 'alice', at: 5 } },
    share: { foryou: true, following: false }, verify: { code: 'abcd2345', text: 'x', until: 2000 },
  });
  assert.deepEqual(s.accounts['222'], { handle: null, paused: false, feed: null, share: { foryou: false, following: false }, verify: null });
  assert.deepEqual(normalizeSettings(null), { open: false, paused: false, accounts: {}, legacy: null });
});

test('turns the one-feed-per-browser settings into an unclaimed legacy feed', () => {
  const s = migrateSettings({ feed: { id: 'abcdefghij', label: '@Alice' }, share: { foryou: true, following: false }, open: true });
  assert.deepEqual(s.accounts, {});
  assert.equal(s.open, true);
  assert.deepEqual(s.legacy, { feed: { id: 'abcdefghij', label: '@Alice' }, share: { foryou: true, following: false }, verify: null });
  assert.equal(migrateSettings(null).legacy, null);
  assert.equal(legacyFits(s.legacy, 'alice'), true);   // named after that handle
  assert.equal(legacyFits(s.legacy, 'bob'), false);
  const renamed = { feed: { id: 'abcdefghij', label: 'My feed', verified: { handle: 'Bob', at: 1 } } };
  assert.equal(legacyFits(renamed, 'bob'), true);      // verified as that handle
  assert.equal(legacyFits(renamed, 'alice'), false);
  assert.equal(legacyFits(null, 'alice'), false);
});
