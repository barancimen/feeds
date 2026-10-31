// Wires capture -> parse -> uploader, keeps settings, and mounts the panel.
// Both the userscript and the extension call startApp(); they differ only in `request` and `store`.
// Everything is per X account: each post is credited to the account that loaded it, every account is asked
// before its first upload, and each has its own feed and pause switch, so switching accounts never mixes feeds.

import { handleFromDom, legacyFits, migrateSettings, newAccount, normalizeSettings, sameHandle, uidFromCookie } from './account.js';
import { createApi } from './api.js';
import { installCapture } from './capture.js';
import { mountPanel } from './panel.js';
import { createdTweet, extractFeed } from './parse.js';
import { KINDS } from './safe.js';
import { createUpdateChecker } from './update.js';
import { createUploader, FLUSH_MS } from './uploader.js';

const SETTINGS_KEY = 'xfs_settings_v2';
const OLD_SETTINGS_KEY = 'xfs_settings'; // one feed per browser; read once to migrate
const RECENT_MAX = 300;
const VERIFY_RETRY_MS = [2000, 4000, 8000, 15000]; // X can take a moment to serve a new post
const HANDLE_WAIT_MS = 5000; // X's navigation (where the handle comes from) renders a moment after load

export function startApp({ win, request, store, apiOrigin, version = null, updateUrl = null }) {
  const doc = win.document;
  const api = createApi(request);
  const settings = normalizeSettings(null);
  const pageUid = uidFromCookie(doc.cookie); // the account this tab was loaded with
  const handles = {};                        // uid -> handle seen in this tab's navigation
  const tabs = {};                           // uid -> what this tab has seen (memory only)
  const uploaders = new Map();
  const creating = new Map();                // uid -> feed creation in progress
  let createFailedAt = 0;
  let uidSince = Date.now();
  let lastUid = pageUid;
  let loaded = false;
  let early = [];
  let panel = null;
  const render = () => panel?.render();

  const current = () => uidFromCookie(doc.cookie);
  const acct = uid => (uid && settings.accounts[uid]) || null;
  const handleOf = uid => handles[uid] || acct(uid)?.handle || null;

  const app = {
    api, settings, message: null, notice: null, asking: null, updateStarted: false, ready: false,
    sharing: (uid, k) => { const a = acct(uid); return !settings.paused && !!a && !a.paused && !!a.feed && !!a.share[k]; },
    publicUrl: id => `${apiOrigin}/f/${id}`,
  };

  // Writes are signed with this tab's ID, so store.watch can tell them from other tabs' changes.
  const tabId = Math.random().toString(36).slice(2);
  const save = () => store.set(SETTINGS_KEY, { ...JSON.parse(JSON.stringify(settings)), by: tabId }).catch(() => {});
  const applySettings = raw => Object.assign(settings, normalizeSettings(raw), { open: settings.open });

  function tabFor(uid) {
    if (!tabs[uid]) {
      tabs[uid] = { seen: {}, recent: {} };
      for (const k of KINDS) { tabs[uid].seen[k] = new Set(); tabs[uid].recent[k] = []; }
    }
    return tabs[uid];
  }

  function uploaderFor(uid) {
    if (!uploaders.has(uid)) {
      uploaders.set(uid, createUploader({
        api,
        getFeedId: () => acct(uid)?.feed?.id,
        isSharing: k => app.sharing(uid, k),
        onChange: render,
        onAuthLost: () => authLost(uid),
      }));
    }
    return uploaders.get(uid);
  }

  // Paused: drop what is queued or was seen so far, so none of it is shared on resume.
  function forget(uid) {
    const t = tabs[uid];
    if (t) for (const k of KINDS) t.recent[k] = [];
    const u = uploaders.get(uid);
    if (u) for (const k of KINDS) u.clear(k);
  }

  // The feed is gone: drop the uploads waiting for it, but keep what this page showed, so a new feed shares it
  // once the user says yes again.
  function dropQueue(uid) {
    const u = uploaders.get(uid);
    if (u) for (const k of KINDS) u.clear(k);
  }

  function shareRecent(uid) {
    for (const k of KINDS) uploaderFor(uid).add(k, tabFor(uid).recent[k]);
  }

  // Settings changed in another tab (a pause, a new feed, a finished verification).
  function reconcile() {
    for (const uid of new Set([...Object.keys(tabs), ...uploaders.keys()])) {
      if (settings.paused || (acct(uid)?.paused && acct(uid).feed)) forget(uid);
      else uploaders.get(uid)?.flush();
    }
  }

  function take(uid, kind, recs) {
    const t = tabFor(uid);
    const fresh = recs.filter(r => !t.seen[kind].has(r.id));
    for (const r of fresh) t.seen[kind].add(r.id);
    // Posts seen while a feed is paused are never shared later. Posts seen while an account has no feed (new,
    // declined or deleted) are, if the user then says yes on this page.
    const a = acct(uid);
    if (!settings.paused && !(a?.paused && a.feed)) {
      t.recent[kind].push(...fresh);
      if (t.recent[kind].length > RECENT_MAX) t.recent[kind].splice(0, t.recent[kind].length - RECENT_MAX);
    }
    if (wantsFeed(uid)) ensureFeed(uid);
    uploaderFor(uid).add(kind, recs);
  }

  installCapture(win, (kind, json, uid) => {
    if (!uid) return; // signed out
    const recs = extractFeed(json);
    if (loaded) { take(uid, kind, recs); learnHandle(); } else early.push([uid, kind, recs]);
    render();
  }, json => {
    // The user posted something. Only a post containing a pending code is sent for checking.
    const t = createdTweet(json);
    if (!t) return;
    const text = t.text.toLowerCase();
    for (const [uid, a] of Object.entries(settings.accounts)) {
      if (a.feed && a.verify && Date.now() < a.verify.until && text.includes(a.verify.code)) { app.checkVerify(uid, t.id); return; }
    }
  }, current);

  // Learns the signed-in account's handle from X's navigation. Right after a switch (or in a tab left open
  // while switching in another one) the page can still show the previous account, so a handle already
  // known to belong to another account is never given to this one.
  function learnHandle() {
    const uid = current();
    const h = handleFromDom(doc);
    if (!uid || !h || handles[uid] === h) return;
    const taken = [...Object.entries(settings.accounts).map(([id, a]) => [id, a.handle]), ...Object.entries(handles)]
      .some(([id, x]) => id !== uid && sameHandle(x, h));
    if (taken) return;
    handles[uid] = h;
    const a = acct(uid);
    if (a && a.handle !== h) { a.handle = h; save(); }
    if (!a && legacyFits(settings.legacy, h)) {
      const label = settings.legacy.feed.label;
      useLegacy(uid);
      app.notice = `Your feed “${label}” now belongs to @${h}. Other X accounts will ask before they share anything.`;
    }
    render();
  }

  // The feed from before accounts were told apart becomes this account's feed.
  function useLegacy(uid) {
    const L = settings.legacy;
    if (!L || acct(uid)) return;
    settings.accounts[uid] = { ...newAccount(handleOf(uid)), paused: false, feed: L.feed, share: L.share, verify: L.verify };
    settings.legacy = null;
    save();
    shareRecent(uid);
  }

  const wantsFeed = uid => {
    const a = acct(uid);
    return !settings.paused && !!a && !a.paused && !a.feed && KINDS.some(k => a.share[k]);
  };

  // Creates the account's public feed, named after its @handle, once the user has said yes.
  function ensureFeed(uid, force = false) {
    if (creating.has(uid)) return creating.get(uid);
    if (!wantsFeed(uid) || (!force && Date.now() - createFailedAt < 60000)) return null;
    const p = (async () => {
      const saved = await store.get(SETTINGS_KEY).catch(() => null);
      if (normalizeSettings(saved).accounts[uid]?.feed) applySettings(saved); // another tab just made one
      if (wantsFeed(uid)) {
        const h = acct(uid).handle;
        const f = await api.createFeed(h ? '@' + h : 'anonymous');
        const a = acct(uid);
        if (a) a.feed = { id: f.id, label: f.label };
        app.message = null;
        app.notice = `Sharing is on: ${h ? '@' + h + '’s' : 'this account’s'} Following and For You feeds are public as “${f.label}”.`;
        await save();
      }
      shareRecent(uid);
    })().catch(e => {
      createFailedAt = Date.now();
      app.notice = null; app.message = `Could not create your public feed: ${e.message}`;
    }).finally(() => {
      creating.delete(uid);
      render();
    });
    creating.set(uid, p);
    render();
    return p;
  }

  async function authLost(uid) {
    // Another tab may have replaced the feed (e.g. two tabs on first setup): adopt it and carry on.
    const saved = await store.get(SETTINGS_KEY).catch(() => null);
    const theirs = normalizeSettings(saved).accounts[uid]?.feed?.id;
    if (theirs && theirs !== acct(uid)?.feed?.id) {
      applySettings(saved);
      uploaderFor(uid).flush();
      render();
      return;
    }
    const a = acct(uid);
    if (a) Object.assign(a, { feed: null, paused: true, verify: null });
    dropQueue(uid);
    app.notice = null;
    app.message = `${a?.handle ? '@' + a.handle + '’s' : 'This account’s'} shared feed no longer exists, or this browser lost its publish key. ` +
      `Click “${a?.handle ? '@' + a.handle : 'Account'}” next to Feeds to start a new one.`;
    save();
    render();
  }

  // What the bar and the panel show for the account that is signed in now.
  app.view = () => {
    const uid = current();
    const a = acct(uid);
    const handle = handleOf(uid);
    const waited = Date.now() - uidSince >= HANDLE_WAIT_MS;
    let status;
    if (!uid) status = 'signed-out';
    else if (settings.paused) status = 'paused-all';
    else if (!a) status = handle || (waited && uid === pageUid) ? 'new' : waited ? 'stale' : 'loading';
    else if (a.paused) status = a.feed ? 'paused' : 'off';
    else if (!a.feed) status = 'creating';
    else status = KINDS.some(k => a.share[k]) ? 'active' : 'none';
    const st = uploaders.get(uid)?.stats() || { error: null, pausedUntil: 0, lastOk: 0, foryou: { shared: 0, queued: 0 }, following: { shared: 0, queued: 0 } };
    const t = uid ? tabFor(uid) : null;
    return {
      uid, acct: a, handle, status, stats: st, creating: creating.has(uid),
      seen: { foryou: t?.seen.foryou.size || 0, following: t?.seen.following.size || 0 },
      prompt: uid && status !== 'stale' && status !== 'loading' && (status === 'new' || app.asking === uid)
        ? { again: !!a, legacy: !a && settings.legacy ? settings.legacy.feed.label : null } : null,
      others: Object.entries(settings.accounts).filter(([id]) => id !== uid).map(([, o]) => ({
        handle: o.handle, state: o.paused ? (o.feed ? 'paused' : 'not shared') : o.feed ? 'sharing' : 'not shared',
      })),
    };
  };

  // The answer to "share this account's feeds?" (also asked again before a declined account starts sharing).
  app.decide = async yes => {
    const uid = current();
    if (!uid) return;
    app.asking = null;
    app.message = null;
    app.notice = null;
    if (!acct(uid)) settings.accounts[uid] = newAccount(handleOf(uid));
    const a = acct(uid);
    a.paused = !yes;
    if (yes && !KINDS.some(k => a.share[k])) a.share = { foryou: true, following: true };
    if (!yes) app.notice = `Nothing from ${a.handle ? '@' + a.handle : 'this account'} will be shared. Click “${a.handle ? '@' + a.handle : 'Account'}” next to Feeds if you change your mind.`;
    await save();
    if (yes) await ensureFeed(uid, true);
    render();
  };

  app.useLegacy = () => {
    const uid = current();
    if (!uid) return;
    app.asking = null;
    app.notice = `Your existing feed is now ${handleOf(uid) ? '@' + handleOf(uid) + '’s' : 'this account’s'}.`;
    useLegacy(uid);
    render();
  };

  app.dismissPrompt = () => { app.asking = null; render(); };

  // The account's pause switch. An account without a feed asks first, since resuming creates a public feed.
  app.togglePauseAccount = async () => {
    const uid = current();
    const a = acct(uid);
    if (!uid) return;
    if (!a || (a.paused && !a.feed)) { app.asking = uid; render(); return; }
    a.paused = !a.paused;
    app.message = null;
    app.notice = null;
    if (a.paused) forget(uid);
    await save();
    if (!a.paused) { if (wantsFeed(uid)) ensureFeed(uid, true); uploaderFor(uid).flush(); }
    render();
  };

  // Pauses every account without touching their own switches.
  app.togglePauseAll = async () => {
    settings.paused = !settings.paused;
    app.message = null;
    app.notice = null;
    if (settings.paused) for (const uid of new Set([...Object.keys(tabs), ...uploaders.keys()])) forget(uid);
    await save();
    if (!settings.paused) {
      const uid = current();
      if (wantsFeed(uid)) ensureFeed(uid, true);
      for (const u of uploaders.values()) u.flush();
    }
    render();
  };

  app.toggleShare = async (kind, on) => {
    const uid = current();
    const a = acct(uid);
    if (!a) return;
    app.message = null;
    app.notice = null;
    a.share[kind] = on;
    if (!on) uploaderFor(uid).clear(kind);
    await save();
    if (on && a.feed) uploaderFor(uid).add(kind, tabFor(uid).recent[kind]);
    if (on && !a.feed && !a.paused) await ensureFeed(uid, true);
    render();
  };

  app.deleteFeed = async () => {
    const uid = current();
    const a = acct(uid);
    if (!a?.feed) return;
    if (!win.confirm('Delete your shared feed? It disappears for everyone, along with everything uploaded to it.')) return;
    try {
      await api.remove(a.feed.id);
      Object.assign(a, { feed: null, paused: true, verify: null });
      dropQueue(uid);
      app.message = null;
      app.notice = `Feed deleted, and ${a.handle ? '@' + a.handle : 'this account'} is switched off. Click “${a.handle ? '@' + a.handle : 'Account'}” next to Feeds to share it again (you’ll be asked first).`;
      await save();
    } catch (e) { app.notice = null; app.message = `Delete failed: ${e.message}`; }
    render();
  };

  // Verification: get a code, let the user post it through X's own composer, then have the server check it.
  app.startVerify = async () => {
    const a = acct(current());
    if (!a?.feed) return;
    app.message = null;
    app.notice = null;
    try {
      const v = await api.startVerify(a.feed.id);
      a.verify = { code: v.code, text: v.text, until: v.expires_at };
      await save();
      app.openComposer();
    } catch (e) { app.notice = null; app.message = `Could not start verification: ${e.message}`; }
    render();
  };

  // X's Web Intent only pre-fills the composer; the user still reviews and clicks Post.
  app.openComposer = () => {
    const v = acct(current())?.verify;
    if (v) win.open(`https://x.com/intent/post?text=${encodeURIComponent(v.text)}`, '_blank', 'noopener');
  };

  app.cancelVerify = async () => {
    const a = acct(current());
    if (a) a.verify = null;
    app.message = null;
    app.notice = null;
    await save();
    render();
  };

  let checking = false;
  app.checkVerify = async (uid, tweetId) => {
    if (!acct(uid)?.feed || !acct(uid).verify || checking) return;
    checking = true;
    app.message = null;
    app.notice = 'Checking your post with X…';
    render();
    for (let i = 0; ; i++) {
      try {
        const r = await api.checkVerify(acct(uid).feed.id, tweetId);
        const a = acct(uid);
        if (a?.feed) { a.feed.verified = { handle: r.verified_handle, at: r.verified_at }; a.verify = null; }
        app.message = null;
        app.notice = `Verified as @${r.verified_handle}. You can delete the verification post now.`;
        break;
      } catch (e) {
        if ([404, 429, 502].includes(e.status) && i < VERIFY_RETRY_MS.length) {
          await new Promise(res => setTimeout(res, e.retryAfter ? e.retryAfter * 1000 : VERIFY_RETRY_MS[i]));
          continue;
        }
        app.notice = null; app.message = `Verification failed: ${e.message}`;
        break;
      }
    }
    checking = false;
    await save();
    render();
  };

  // Fallback when the post was made somewhere the widget can't see (phone app, another browser).
  app.checkVerifyLink = text => {
    const s = String(text).trim();
    const m = s.match(/\/status(?:es)?\/(\d{1,20})/) || s.match(/^(\d{1,20})$/);
    if (!m) { app.notice = null; app.message = 'Paste the link to your post, like https://x.com/you/status/123…'; render(); return; }
    app.checkVerify(current(), m[1]);
  };

  app.flushNow = () => uploaders.get(current())?.flush({ force: true });
  app.setOpen = open => { settings.open = open; save(); render(); };

  // Updates (userscript only: the extension has no update URL).
  app.updates = updateUrl ? createUpdateChecker({ api, store, version, onChange: render }) : null;
  app.update = () => app.updates?.available() || null;
  app.version = version;
  app.startUpdate = () => { app.updateStarted = true; win.open(updateUrl, '_blank', 'noopener'); render(); };
  app.snoozeUpdate = () => { app.updateStarted = false; app.updates?.snooze(); };
  app.reload = () => win.location.reload();

  async function load() {
    let raw = await store.get(SETTINGS_KEY).catch(() => null);
    if (!raw) {
      const old = await store.get(OLD_SETTINGS_KEY).catch(() => null);
      raw = migrateSettings(old);
      Object.assign(settings, raw);
      if (old) await save();
    } else Object.assign(settings, normalizeSettings(raw));
  }

  load().catch(() => {}).finally(() => {
    loaded = true;
    app.ready = true;
    for (const [uid, kind, recs] of early) take(uid, kind, recs);
    early = [];
    learnHandle();
    render();
    app.updates?.check();
  });

  // Keep every tab in step: a pause in one tab stops uploads in all of them.
  store.watch?.(SETTINGS_KEY, v => {
    if (!loaded || v?.by === tabId) return;
    applySettings(v);
    reconcile();
    render();
  });
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') { for (const u of uploaders.values()) u.flush(); return; }
    if (!loaded) return;
    store.get(SETTINGS_KEY).then(s => { if (s) { applySettings(s); reconcile(); } render(); }).catch(() => {});
  });

  // Notice account switches and the handle appearing in X's navigation.
  setInterval(() => {
    const uid = current();
    if (uid !== lastUid) { lastUid = uid; uidSince = Date.now(); app.asking = null; render(); }
    if (loaded) learnHandle();
    if (!handleOf(uid) && Date.now() - uidSince < HANDLE_WAIT_MS + 1500) render();
  }, 1000);
  setInterval(() => { for (const u of uploaders.values()) u.flush(); }, FLUSH_MS);
  setInterval(() => app.updates?.check(), 3600e3);

  const mount = () => { panel = mountPanel(doc, win, app); render(); };
  if (doc.body) mount(); else doc.addEventListener('DOMContentLoaded', mount);
  return app;
}
