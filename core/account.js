// Which X account is signed in, and the settings remembered for each account.

import { isHandle, isId, KINDS } from './safe.js';

// X keeps the signed-in user's numeric ID in the `twid` cookie ("u%3D<id>"). Page scripts can read it, and
// it changes the moment the user switches accounts, so it is read as each request starts.
export function uidFromCookie(cookie) {
  const m = String(cookie || '').match(/(?:^|;\s*)twid="?u(?:%3D|=)(\d{1,20})/i);
  return m ? m[1] : null;
}

// The handle shown in X's own navigation. It can lag behind the cookie for a moment after a switch, or for
// good in a tab that was left open while the user switched in another one.
export function handleFromDom(doc) {
  const href = doc.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href') || '';
  const m = href.match(/^\/([A-Za-z0-9_]{1,15})$/);
  return m ? m[1] : null;
}

export const sameHandle = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

function cleanFeed(f) {
  if (!f || typeof f !== 'object' || typeof f.id !== 'string' || !/^[a-z0-9]{10}$/.test(f.id)) return null;
  const feed = { id: f.id, label: String(f.label || '').slice(0, 40) };
  const v = f.verified;
  if (v && isHandle(v.handle)) feed.verified = { handle: v.handle, at: Number(v.at) || 0 };
  return feed;
}

// A pending verification: { code, text, until }.
function cleanVerify(p, now) {
  return p && typeof p.code === 'string' && /^[a-z0-9]{8}$/.test(p.code) && Number(p.until) > now
    ? { code: p.code, text: String(p.text || ''), until: Number(p.until) } : null;
}

const cleanShare = s => Object.fromEntries(KINDS.map(k => [k, !!s?.[k]]));

export const newAccount = handle => ({
  handle: isHandle(handle) ? handle : null, paused: true, feed: null, share: { foryou: true, following: true }, verify: null,
});

// Stored shape: { open, paused (every account), accounts: { [uid]: { handle, paused, feed, share, verify } }, legacy }.
// An account is in `accounts` once the user has answered for it; "don't share" is paused with no feed.
export function normalizeSettings(s, now = Date.now()) {
  const out = { open: false, paused: false, accounts: {}, legacy: null };
  if (!s || typeof s !== 'object') return out;
  out.open = !!s.open;
  out.paused = !!s.paused;
  if (s.accounts && typeof s.accounts === 'object') {
    for (const [uid, a] of Object.entries(s.accounts)) {
      if (!isId(uid) || !a || typeof a !== 'object') continue;
      out.accounts[uid] = {
        handle: isHandle(a.handle) ? a.handle : null,
        paused: !!a.paused,
        feed: cleanFeed(a.feed),
        share: cleanShare(a.share),
        verify: cleanVerify(a.verify, now),
      };
    }
  }
  const feed = cleanFeed(s.legacy?.feed);
  if (feed) out.legacy = { feed, share: cleanShare(s.legacy.share), verify: cleanVerify(s.legacy.verify, now) };
  return out;
}

// Before accounts were told apart there was one feed per browser. It is kept as `legacy` until the account
// it was named after shows up, or the user picks it for an account.
export function migrateSettings(old, now = Date.now()) {
  return normalizeSettings({ open: old?.open, legacy: old?.feed ? { feed: old.feed, share: old.share, verify: old.verify } : null }, now);
}

// The old feed was named after the handle that was signed in when it was made ("@handle"), unless renamed.
export function legacyFits(legacy, handle) {
  if (!legacy || !isHandle(handle)) return false;
  return sameHandle(legacy.feed.verified?.handle, handle) || sameHandle(legacy.feed.label.replace(/^@/, ''), handle);
}
