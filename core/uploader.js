// Queues captured records per feed kind and pushes them in ordered batches.
// A "session" is a run of browsing (new one after 30 idle minutes); `pos` is the order within it.

import { KINDS, MAX_BATCH } from './safe.js';

export const FLUSH_MS = 30000;
const MAX_QUEUE = 1000;
const MAX_BATCHES_PER_FLUSH = 2;
const SESSION_GAP_MS = 30 * 60000;

export function createUploader({ api, getFeedId, isSharing, onChange = () => {}, onAuthLost = () => {}, now = Date.now }) {
  const kinds = {};
  for (const k of KINDS) kinds[k] = { queue: [], seen: new Set(), shared: 0, session: 0, pos: 0, lastAdd: 0 };
  const status = { error: null, pausedUntil: 0, backoff: 0, busy: false };

  function add(kind, records) {
    const s = kinds[kind];
    if (!s || !isSharing(kind)) return;
    const t = now();
    if (!s.session || t - s.lastAdd > SESSION_GAP_MS) { s.session = t; s.pos = 0; }
    s.lastAdd = t;
    for (const r of records) {
      if (s.seen.has(r.id)) continue;
      s.seen.add(r.id);
      s.queue.push({ session: s.session, pos: s.pos++, tweet: r });
    }
    if (s.queue.length > MAX_QUEUE) s.queue.splice(0, s.queue.length - MAX_QUEUE);
    onChange();
  }

  // Sharing turned off: forget what was queued, and let tweets be re-shared if it's turned back on.
  function clear(kind) {
    const s = kinds[kind];
    s.queue = [];
    s.seen.clear();
    onChange();
  }

  function takeBatch(s) {
    const session = s.queue[0].session;
    let n = 0;
    while (n < s.queue.length && n < MAX_BATCH && s.queue[n].session === session) n++;
    return s.queue.splice(0, n);
  }

  async function flush({ force = false } = {}) {
    if (status.busy || (!force && now() < status.pausedUntil)) return;
    const id = getFeedId();
    if (!id) return;
    status.busy = true;
    let sent = 0;
    try {
      for (const kind of KINDS) {
        const s = kinds[kind];
        while (s.queue.length && isSharing(kind) && sent < MAX_BATCHES_PER_FLUSH) {
          const batch = takeBatch(s);
          sent++;
          try {
            await api.push(id, { kind, session: batch[0].session, start: batch[0].pos, tweets: batch.map(b => b.tweet) });
            s.shared += batch.length;
            status.error = null;
            status.backoff = 0;
            status.pausedUntil = 0;
          } catch (e) {
            status.error = e.message;
            if (e.status === 400 || e.status === 413) continue; // malformed batch: drop it, keep going
            s.queue.unshift(...batch);
            if (e.status === 401 || e.status === 404) { onAuthLost(e); return; }
            if (e.status === 429) status.pausedUntil = now() + (e.retryAfter || 120) * 1000;
            else {
              status.backoff = Math.min((status.backoff || 15000) * 2, 600000);
              status.pausedUntil = now() + status.backoff;
            }
            return;
          }
        }
      }
    } finally {
      status.busy = false;
      onChange();
    }
  }

  function stats() {
    const out = { error: status.error, pausedUntil: status.pausedUntil > now() ? status.pausedUntil : 0 };
    for (const k of KINDS) out[k] = { shared: kinds[k].shared, queued: kinds[k].queue.length };
    return out;
  }

  return { add, clear, flush, stats };
}
