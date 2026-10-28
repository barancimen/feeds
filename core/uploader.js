// Queues captured records per feed kind and uploads them continuously, in order, as the user scrolls.
// A "session" is a run of browsing (new one after 30 idle minutes); `pos` is the order within it.

import { KINDS, MAX_BATCH } from './safe.js';

export const FLUSH_MS = 30000;          // safety net only; uploads normally start right after each capture
export const DEBOUNCE_MS = 1500;        // let a page of posts finish arriving before uploading
export const MIN_GAP_MS = 4000;         // at most 15 uploads a minute (the server allows 20)
const MAX_QUEUE = 1000;
const SESSION_GAP_MS = 30 * 60000;

export function createUploader({
  api, getFeedId, isSharing, onChange = () => {}, onAuthLost = () => {}, now = Date.now, setTimer = setTimeout,
}) {
  const kinds = {};
  for (const k of KINDS) kinds[k] = { queue: [], seen: new Set(), shared: 0, session: 0, pos: 0, lastAdd: 0 };
  const status = { error: null, pausedUntil: 0, backoff: 0, busy: false, lastPush: 0, lastOk: 0 };
  let timer = null;
  let next = 0; // round-robin between kinds

  const pending = () => KINDS.some(k => kinds[k].queue.length && isSharing(k));

  // Upload soon, but never sooner than MIN_GAP_MS after the last upload or before a pause ends.
  function schedule(delay = DEBOUNCE_MS) {
    if (timer || !pending()) return;
    const t = now();
    const wait = Math.max(delay, status.lastPush + MIN_GAP_MS - t, status.pausedUntil - t, 0);
    timer = setTimer(() => { timer = null; return flush(); }, wait);
  }

  function add(kind, records) {
    const s = kinds[kind];
    if (!s || !isSharing(kind)) return;
    const t = now();
    if (!s.session || t - s.lastAdd > SESSION_GAP_MS) { s.session = t; s.pos = 0; }
    s.lastAdd = t;
    for (const r of records) {
      if (s.seen.has(r.id)) continue; // already queued or uploaded from this tab
      s.seen.add(r.id);
      s.queue.push({ session: s.session, pos: s.pos++, tweet: r });
    }
    if (s.queue.length > MAX_QUEUE) s.queue.splice(0, s.queue.length - MAX_QUEUE);
    onChange();
    schedule();
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

  // Sends one batch (the server rate-limits per request), then schedules the next if more is waiting.
  async function flush({ force = false } = {}) {
    if (status.busy) return;
    if (!force && now() < status.pausedUntil) { schedule(0); return; }
    const id = getFeedId();
    const kind = KINDS.map((_, i) => KINDS[(next + i) % KINDS.length]).find(k => kinds[k].queue.length && isSharing(k));
    if (!id || !kind) return;
    next = (KINDS.indexOf(kind) + 1) % KINDS.length;
    const s = kinds[kind];
    const batch = takeBatch(s);
    status.busy = true;
    status.lastPush = now();
    try {
      await api.push(id, { kind, session: batch[0].session, start: batch[0].pos, tweets: batch.map(b => b.tweet) });
      s.shared += batch.length;
      Object.assign(status, { error: null, backoff: 0, pausedUntil: 0, lastOk: now() });
    } catch (e) {
      status.error = e.message;
      if (e.status === 400 || e.status === 413) {
        // malformed batch: drop it and move on
      } else if (e.status === 401 || e.status === 404) {
        s.queue.unshift(...batch);
        status.busy = false;
        onAuthLost(e);
        return;
      } else {
        s.queue.unshift(...batch);
        if (e.status === 429) status.pausedUntil = now() + (e.retryAfter || 120) * 1000;
        else {
          status.backoff = Math.min((status.backoff || 15000) * 2, 600000);
          status.pausedUntil = now() + status.backoff;
        }
      }
    } finally {
      status.busy = false;
      onChange();
    }
    schedule(0);
  }

  function stats() {
    const out = { error: status.error, pausedUntil: status.pausedUntil > now() ? status.pausedUntil : 0, lastOk: status.lastOk };
    for (const k of KINDS) out[k] = { shared: kinds[k].shared, queued: kinds[k].queue.length };
    return out;
  }

  return { add, clear, flush, stats };
}
