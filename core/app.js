// Wires capture -> parse -> uploader, keeps settings, and mounts the panel.
// Both the userscript and the extension call startApp(); they differ only in `request` and `store`.

import { createApi } from './api.js';
import { installCapture } from './capture.js';
import { mountPanel } from './panel.js';
import { createdTweet, extractFeed } from './parse.js';
import { isHandle, KINDS } from './safe.js';
import { createUploader, FLUSH_MS } from './uploader.js';

const SETTINGS_KEY = 'xfs_settings';
const RECENT_MAX = 300;
const VERIFY_RETRY_MS = [2000, 4000, 8000, 15000]; // X can take a moment to serve a new post

export function startApp({ win, request, store, apiOrigin }) {
  const doc = win.document;
  const api = createApi(request);
  // feed: { id, label, verified?: { handle, at } }; verify: pending { code, text, until }
  const settings = { feed: null, share: { foryou: false, following: false }, open: false, verify: null };
  const seen = { foryou: new Set(), following: new Set() };
  // What this tab has shown so far (memory only), so ticking a box shares the feed that's on screen.
  const recent = { foryou: [], following: [] };
  let loaded = false;
  let early = [];
  let panel = null;
  const render = () => panel?.render();

  const app = {
    api, settings, seen, message: null,
    sharing: k => !!settings.feed && !!settings.share[k],
    publicUrl: id => `${apiOrigin}/f/${id}`,
  };

  const save = () => store.set(SETTINGS_KEY, JSON.parse(JSON.stringify(settings))).catch(() => {});
  const stopSharing = () => { for (const k of KINDS) { settings.share[k] = false; app.uploader.clear(k); } };

  app.uploader = createUploader({
    api,
    getFeedId: () => settings.feed?.id,
    isSharing: app.sharing,
    onChange: render,
    onAuthLost: () => {
      settings.feed = null;
      stopSharing();
      app.message = 'Your shared feed no longer exists, or this browser lost its publish key. Tick a box to start a new feed.';
      save();
      render();
    },
  });

  installCapture(win, (kind, json) => {
    const recs = extractFeed(json);
    for (const r of recs) {
      if (seen[kind].has(r.id)) continue;
      seen[kind].add(r.id);
      recent[kind].push(r);
    }
    if (recent[kind].length > RECENT_MAX) recent[kind].splice(0, recent[kind].length - RECENT_MAX);
    if (loaded) app.uploader.add(kind, recs); else early.push([kind, recs]);
    render();
  }, json => {
    // The user posted something. Only a post containing the pending code is sent for checking.
    const t = createdTweet(json);
    const v = settings.verify;
    if (t && v && Date.now() < v.until && t.text.toLowerCase().includes(v.code)) app.checkVerify(t.id);
  });

  function applySettings(s) {
    if (!s || typeof s !== 'object') return;
    settings.feed = null;
    if (s.feed && typeof s.feed.id === 'string') {
      settings.feed = { id: s.feed.id, label: String(s.feed.label || '') };
      const v = s.feed.verified;
      if (v && isHandle(v.handle)) settings.feed.verified = { handle: v.handle, at: Number(v.at) || 0 };
    }
    for (const k of KINDS) settings.share[k] = !!s.share?.[k];
    settings.open = !!s.open;
    const p = s.verify;
    settings.verify = p && /^[a-z0-9]{8}$/.test(p.code) && Number(p.until) > Date.now()
      ? { code: p.code, text: String(p.text || ''), until: Number(p.until) } : null;
  }

  // Another tab may have changed settings (verification usually finishes in the tab X's composer opens).
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'visible' || !loaded) return;
    store.get(SETTINGS_KEY).then(s => { applySettings(s); render(); }).catch(() => {});
  });

  store.get(SETTINGS_KEY).then(applySettings).catch(() => {}).finally(() => {
    loaded = true;
    for (const [k, recs] of early) app.uploader.add(k, recs);
    early = [];
    render();
  });

  function guessLabel() {
    const href = doc.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href') || '';
    const m = href.match(/^\/([A-Za-z0-9_]{1,15})$/);
    return m ? '@' + m[1] : '';
  }

  app.toggleShare = async (kind, on) => {
    app.message = null;
    if (on && !settings.feed) {
      const label = win.prompt('Name your public feed. Anyone can see this name, and it is not verified:', guessLabel());
      if (label === null) { render(); return; }
      try {
        const f = await api.createFeed(label);
        settings.feed = { id: f.id, label: f.label };
      } catch (e) {
        app.message = `Could not create a feed: ${e.message}`;
        render();
        return;
      }
    }
    settings.share[kind] = on;
    if (on) app.uploader.add(kind, recent[kind]); else app.uploader.clear(kind);
    await save();
    render();
  };

  app.renameFeed = async () => {
    if (!settings.feed) return;
    const label = win.prompt('New public name for your feed:', settings.feed.label);
    if (label === null) return;
    try {
      const f = await api.rename(settings.feed.id, label);
      settings.feed.label = f.label;
      await save();
    } catch (e) { app.message = `Rename failed: ${e.message}`; }
    render();
  };

  app.deleteFeed = async () => {
    if (!settings.feed) return;
    if (!win.confirm('Delete your shared feed? It disappears for everyone, along with everything uploaded to it.')) return;
    try {
      await api.remove(settings.feed.id);
      settings.feed = null;
      stopSharing();
      app.message = 'Feed deleted.';
      await save();
    } catch (e) { app.message = `Delete failed: ${e.message}`; }
    render();
  };

  // Verification: get a code, let the user post it through X's own composer, then have the server check it.
  app.startVerify = async () => {
    if (!settings.feed) return;
    app.message = null;
    try {
      const v = await api.startVerify(settings.feed.id);
      settings.verify = { code: v.code, text: v.text, until: v.expires_at };
      await save();
      app.openComposer();
    } catch (e) { app.message = `Could not start verification: ${e.message}`; }
    render();
  };

  // X's Web Intent only pre-fills the composer; the user still reviews and clicks Post.
  app.openComposer = () => {
    if (settings.verify) win.open(`https://x.com/intent/post?text=${encodeURIComponent(settings.verify.text)}`, '_blank', 'noopener');
  };

  app.cancelVerify = async () => {
    settings.verify = null;
    app.message = null;
    await save();
    render();
  };

  let checking = false;
  app.checkVerify = async tweetId => {
    if (!settings.feed || !settings.verify || checking) return;
    checking = true;
    app.message = 'Checking your post with X…';
    render();
    for (let i = 0; ; i++) {
      try {
        const r = await api.checkVerify(settings.feed.id, tweetId);
        settings.feed.verified = { handle: r.verified_handle, at: r.verified_at };
        settings.verify = null;
        app.message = `Verified as @${r.verified_handle}. You can delete the verification post now.`;
        break;
      } catch (e) {
        if ([404, 429, 502].includes(e.status) && i < VERIFY_RETRY_MS.length) {
          await new Promise(res => setTimeout(res, e.retryAfter ? e.retryAfter * 1000 : VERIFY_RETRY_MS[i]));
          continue;
        }
        app.message = `Verification failed: ${e.message}`;
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
    if (!m) { app.message = 'Paste the link to your post, like https://x.com/you/status/123…'; render(); return; }
    app.checkVerify(m[1]);
  };

  app.flushNow = () => app.uploader.flush({ force: true });
  app.setOpen = open => { settings.open = open; save(); render(); };

  setInterval(() => app.uploader.flush(), FLUSH_MS);
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') app.uploader.flush(); });

  const mount = () => { panel = mountPanel(doc, win, app); render(); };
  if (doc.body) mount(); else doc.addEventListener('DOMContentLoaded', mount);
  return app;
}
