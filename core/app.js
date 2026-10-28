// Wires capture -> parse -> uploader, keeps settings, and mounts the panel.
// Both the userscript and the extension call startApp(); they differ only in `request` and `store`.

import { createApi } from './api.js';
import { installCapture } from './capture.js';
import { mountPanel } from './panel.js';
import { extractFeed } from './parse.js';
import { KINDS } from './safe.js';
import { createUploader, FLUSH_MS } from './uploader.js';

const SETTINGS_KEY = 'xfs_settings';
const RECENT_MAX = 300;

export function startApp({ win, request, store, apiOrigin }) {
  const doc = win.document;
  const api = createApi(request);
  const settings = { feed: null, share: { foryou: false, following: false }, open: false };
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
  });

  store.get(SETTINGS_KEY).then(s => {
    if (!s || typeof s !== 'object') return;
    if (s.feed && typeof s.feed.id === 'string') settings.feed = { id: s.feed.id, label: String(s.feed.label || '') };
    for (const k of KINDS) settings.share[k] = !!s.share?.[k];
    settings.open = !!s.open;
  }).catch(() => {}).finally(() => {
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

  app.flushNow = () => app.uploader.flush({ force: true });
  app.setOpen = open => { settings.open = open; save(); render(); };

  setInterval(() => app.uploader.flush(), FLUSH_MS);
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') app.uploader.flush(); });

  const mount = () => { panel = mountPanel(doc, win, app); render(); };
  if (doc.body) mount(); else doc.addEventListener('DOMContentLoaded', mount);
  return app;
}
