// X Feed Share backend: a Cloudflare Worker over D1. Public reads, token-authenticated writes.

import { KINDS, MAX_BATCH, cleanLabel, cleanRecord } from '../../core/safe.js';
import USERSCRIPT from './userscript.gen.js';
import VIEWER_JS from './viewer.gen.js';

const DAY = 864e5;
const RETENTION_MS = 14 * DAY;
const MAX_ITEMS = 1000;          // per feed and kind
const DAILY_QUOTA = 5000;        // tweets per feed per day
const MAX_BODY = 512 * 1024;
const FEED_ID = /^[a-z0-9]{10}$/;
// D1 allows 100 bound parameters per statement.
const TWEET_CHUNK = 33;          // 3 params per row
const ITEM_CHUNK = 16;           // 6 params per row

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...headers },
});

export default {
  async fetch(req, env) {
    try {
      return await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
      console.error(e);
      return json({ error: 'internal error' }, 500);
    }
  },
  async scheduled(_event, env) {
    await gc(env, Date.now());
  },
};

async function route(req, env) {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;
  if (m === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (m === 'GET' || m === 'HEAD') {
    if (p === '/') return page(200);
    if (p.startsWith('/f/')) {
      const id = p.slice(3);
      const found = FEED_ID.test(id) && await env.DB.prepare('SELECT 1 FROM feeds WHERE id = ?').bind(id).first();
      return page(found ? 200 : 404);
    }
    if (p === '/viewer.js') return asset(VIEWER_JS, 'text/javascript');
    if (p === '/x-feed-share.user.js') return asset(USERSCRIPT, 'text/javascript');
    if (p === '/favicon.ico') return new Response(null, { status: 204, headers: { 'cache-control': 'public, max-age=86400' } });
  }
  if (p === '/api/feeds') {
    if (m === 'GET') return listFeeds(env, url);
    if (m === 'POST') return createFeed(req, env);
  }
  const f = p.match(/^\/api\/feeds\/([a-z0-9]{10})(\/items)?$/);
  if (f) {
    const [, id, items] = f;
    if (items && m === 'POST') return pushItems(req, env, id);
    if (!items && m === 'GET') return getFeed(env, id, url);
    if (!items && m === 'PATCH') return renameFeed(req, env, id);
    if (!items && m === 'DELETE') return deleteFeed(req, env, id);
  }
  return json({ error: 'not found' }, 404);
}

// ---------- helpers ----------

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

function randomId() {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), b => a[b % 36]).join('');
}

function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function readJson(req) {
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) throw new HttpError(413, 'body too large');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'body too large');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'invalid JSON'); }
}

async function rateLimit(binding, key) {
  if (!binding) return;
  const { success } = await binding.limit({ key });
  if (!success) throw new HttpError(429, 'too many requests', { retry_after: 60 });
}

async function auth(req, env, id) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const row = await env.DB.prepare('SELECT * FROM feeds WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'feed not found');
  if (!token || token.length > 100 || row.token_hash !== await sha256(token)) throw new HttpError(401, 'bad token');
  return row;
}

const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const int = (v, d) => (Number.isSafeInteger(Number(v)) && v !== null && v !== '' ? Number(v) : d);

function publicFeed(r) {
  return { id: r.id, label: r.label, created_at: r.created_at, last_push_at: r.last_push_at,
    foryou_at: r.foryou_at, following_at: r.following_at };
}

// ---------- handlers ----------

async function createFeed(req, env) {
  await rateLimit(env.CREATE_LIMIT, req.headers.get('cf-connecting-ip') || 'local');
  const body = await readJson(req);
  const id = randomId();
  const token = randomToken();
  const label = cleanLabel(body?.label);
  await env.DB.prepare('INSERT INTO feeds (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, await sha256(token), label, Date.now()).run();
  return json({ id, token, label }, 201);
}

async function pushItems(req, env, id) {
  const feed = await auth(req, env, id);
  await rateLimit(env.PUSH_LIMIT, id);
  const body = await readJson(req);
  if (!KINDS.includes(body?.kind)) throw new HttpError(400, 'kind must be "foryou" or "following"');
  if (!Array.isArray(body.tweets) || !body.tweets.length || body.tweets.length > MAX_BATCH) {
    throw new HttpError(400, `tweets must be an array of 1-${MAX_BATCH} records`);
  }
  const now = Date.now();
  // Sessions are client-supplied ordering hints; keep them within the last day.
  const session = Math.min(Math.max(int(body.session, now), now - DAY), now);
  const start = Math.min(Math.max(int(body.start, 0), 0), 1e7);

  const rows = [];
  const ids = new Set();
  for (let i = 0; i < body.tweets.length; i++) {
    const rec = cleanRecord(body.tweets[i]);
    if (!rec || ids.has(rec.id)) continue;
    ids.add(rec.id);
    const data = JSON.stringify(rec);
    rows.push({ id: rec.id, data, hash: await sha256(data), pos: start + i });
  }
  if (!rows.length) throw new HttpError(400, 'no valid tweets in batch');

  const day = Math.floor(now / DAY);
  const used = (feed.quota_day === day ? feed.quota_used : 0) + rows.length;
  if (used > DAILY_QUOTA) {
    throw new HttpError(429, 'daily upload quota reached', { retry_after: Math.ceil(((day + 1) * DAY - now) / 1000) });
  }

  const db = env.DB;
  const stmts = [];
  for (const c of chunks(rows, TWEET_CHUNK)) {
    stmts.push(db.prepare(`INSERT OR IGNORE INTO tweets (hash, id, data) VALUES ${c.map(() => '(?,?,?)').join(',')}`)
      .bind(...c.flatMap(r => [r.hash, r.id, r.data])));
  }
  for (const c of chunks(rows, ITEM_CHUNK)) {
    stmts.push(db.prepare(`INSERT OR IGNORE INTO items (feed_id, kind, tweet_id, hash, session, pos) VALUES ${c.map(() => '(?,?,?,?,?,?)').join(',')}`)
      .bind(...c.flatMap(r => [id, body.kind, r.id, r.hash, session, r.pos])));
  }
  // body.kind is one of KINDS, so the column name is safe to interpolate.
  stmts.push(db.prepare(`UPDATE feeds SET last_push_at = ?1, ${body.kind}_at = ?1, quota_day = ?2, quota_used = ?3 WHERE id = ?4`)
    .bind(now, day, used, id));
  await db.batch(stmts);
  return json({ accepted: rows.length });
}

async function listFeeds(env, url) {
  const limit = Math.min(Math.max(int(url.searchParams.get('limit'), 50), 1), 100);
  const { results } = await env.DB.prepare(
    'SELECT * FROM feeds WHERE last_push_at > ? ORDER BY last_push_at DESC LIMIT ?',
  ).bind(Date.now() - RETENTION_MS, limit).all();
  return json({ feeds: results.map(publicFeed) }, 200, { 'cache-control': 'public, max-age=30' });
}

async function getFeed(env, id, url) {
  const feed = await env.DB.prepare('SELECT * FROM feeds WHERE id = ?').bind(id).first();
  if (!feed) throw new HttpError(404, 'feed not found');
  let kind = url.searchParams.get('kind');
  if (!KINDS.includes(kind)) kind = (feed.following_at || 0) >= (feed.foryou_at || 0) ? 'following' : 'foryou';
  const limit = Math.min(Math.max(int(url.searchParams.get('limit'), 30), 1), 100);
  const [bs, bp] = (url.searchParams.get('before') || '').split('.');
  const beforeSession = int(bs, Number.MAX_SAFE_INTEGER);
  const afterPos = int(bp, -1);
  const { results } = await env.DB.prepare(
    `SELECT i.session, i.pos, t.data FROM items i JOIN tweets t ON t.hash = i.hash
     WHERE i.feed_id = ?1 AND i.kind = ?2 AND (i.session < ?3 OR (i.session = ?3 AND i.pos > ?4))
     ORDER BY i.session DESC, i.pos ASC LIMIT ?5`,
  ).bind(id, kind, beforeSession, afterPos, limit).all();
  const last = results[results.length - 1];
  return json({
    feed: publicFeed(feed),
    kind,
    items: results.map(r => ({ session: r.session, tweet: JSON.parse(r.data) })),
    next: results.length === limit ? `${last.session}.${last.pos}` : null,
  }, 200, { 'cache-control': 'public, max-age=30' });
}

async function renameFeed(req, env, id) {
  await auth(req, env, id);
  const label = cleanLabel((await readJson(req))?.label);
  await env.DB.prepare('UPDATE feeds SET label = ? WHERE id = ?').bind(label, id).run();
  return json({ id, label });
}

async function deleteFeed(req, env, id) {
  await auth(req, env, id);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM tweets WHERE hash IN (SELECT hash FROM items WHERE feed_id = ?1)
      AND NOT EXISTS (SELECT 1 FROM items i WHERE i.hash = tweets.hash AND i.feed_id != ?1)`).bind(id),
    env.DB.prepare('DELETE FROM items WHERE feed_id = ?').bind(id),
    env.DB.prepare('DELETE FROM feeds WHERE id = ?').bind(id),
  ]);
  return json({ deleted: id });
}

export async function gc(env, now) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM items WHERE session < ?').bind(now - RETENTION_MS),
    env.DB.prepare(`DELETE FROM items WHERE rowid IN (SELECT rowid FROM (SELECT rowid, ROW_NUMBER() OVER
      (PARTITION BY feed_id, kind ORDER BY session DESC, pos ASC) AS rn FROM items) WHERE rn > ?)`).bind(MAX_ITEMS),
    env.DB.prepare('DELETE FROM tweets WHERE NOT EXISTS (SELECT 1 FROM items WHERE items.hash = tweets.hash)'),
    env.DB.prepare('UPDATE feeds SET foryou_at = NULL WHERE foryou_at < ?').bind(now - RETENTION_MS),
    env.DB.prepare('UPDATE feeds SET following_at = NULL WHERE following_at < ?').bind(now - RETENTION_MS),
  ]);
}

// ---------- public page ----------

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Shared X Feeds</title>
</head>
<body>
<div id="app"></div>
<script src="/viewer.js"></script>
</body>
</html>`;

const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; " +
  "img-src https://pbs.twimg.com https://abs.twimg.com; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function page(status) {
  return new Response(PAGE, { status, headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': PAGE_CSP,
    'x-content-type-options': 'nosniff',
    'cache-control': 'public, max-age=60',
  } });
}

function asset(body, type) {
  return new Response(body, { headers: {
    'content-type': `${type}; charset=utf-8`, 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff',
  } });
}
