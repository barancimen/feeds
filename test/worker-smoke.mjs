// End-to-end check of the Worker against `wrangler dev --local` with a throwaway D1 database.
// Usage: node build.mjs && node test/worker-smoke.mjs

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractFeed } from '../core/parse.js';
import { FOR_YOU } from './fixtures/timeline.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORKER = path.join(ROOT, 'worker');
const WRANGLER = path.join(ROOT, 'node_modules/.bin/wrangler');
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const persist = await fs.mkdtemp(path.join(os.tmpdir(), 'xfs-d1-'));
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };

const sql = command => JSON.parse(execFileSync(WRANGLER,
  ['d1', 'execute', 'xfeeds', '--local', '--persist-to', persist, '--json', '--command', command],
  { cwd: WORKER, env, encoding: 'utf8' }))[0].results;

execFileSync(WRANGLER, ['d1', 'execute', 'xfeeds', '--local', '--persist-to', persist, '--file', 'schema.sql'],
  { cwd: WORKER, env, stdio: 'ignore' });

const dev = spawn(WRANGLER, ['dev', '--local', '--port', String(PORT), '--persist-to', persist, '--test-scheduled'],
  { cwd: WORKER, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
dev.stdout.on('data', d => { log += d; });
dev.stderr.on('data', d => { log += d; });

async function call(method, p, body, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

const steps = [];
const step = async (name, fn) => { await fn(); steps.push(name); console.log('ok -', name); };

try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(BASE + '/')).ok) break; } catch { /* not up yet */ }
    if (i > 120) throw new Error('wrangler dev did not start:\n' + log);
    await new Promise(r => setTimeout(r, 500));
  }

  await step('serves the public page, viewer and userscript', async () => {
    const home = await call('GET', '/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match((await call('GET', '/viewer.js')).data, /Shared X Feeds/);
    assert.match((await call('GET', '/x-feed-share.user.js')).data, /==UserScript==/);
  });

  let A;
  await step('creates a feed and returns the token once', async () => {
    const r = await call('POST', '/api/feeds', { label: '   @tester \n\n  feed  ' });
    assert.equal(r.status, 201);
    assert.match(r.data.id, /^[a-z0-9]{10}$/);
    assert.equal(r.data.label, '@tester feed');
    assert.ok(r.data.token.length >= 40);
    A = r.data;
    assert.equal((await call('GET', `/f/${A.id}`)).status, 200);
    assert.equal((await call('GET', '/f/zzzzzzzzzz')).status, 404);
  });

  const recs = extractFeed(FOR_YOU);
  const items = `/api/feeds/${A.id}/items`;

  await step('rejects bad auth and bad payloads', async () => {
    const body = { kind: 'foryou', tweets: recs.slice(0, 1) };
    assert.equal((await call('POST', items, body)).status, 401);
    assert.equal((await call('POST', items, body, 'wrong')).status, 401);
    assert.equal((await call('POST', '/api/feeds/zzzzzzzzzz/items', body, A.token)).status, 404);
    assert.equal((await call('POST', items, { ...body, kind: 'search' }, A.token)).status, 400);
    assert.equal((await call('POST', items, { kind: 'foryou', tweets: [] }, A.token)).status, 400);
    assert.equal((await call('POST', items, { kind: 'foryou', tweets: Array(101).fill(recs[0]) }, A.token)).status, 400);
    assert.equal((await call('POST', items, { kind: 'foryou', tweets: [{ id: 'x' }, { id: '1', author: { id: '1', handle: 'a b' } }] }, A.token)).status, 400);
  });

  const t0 = Date.now();
  await step('accepts batches, cleaning hostile fields', async () => {
    const hostile = { ...recs[0], id: '999', text: '<script>x</script>', urls: [{ url: 'javascript:alert(1)' }],
      author: { ...recs[0].author, avatar: 'https://evil.com/a.png' }, extra: 'dropped' };
    let r = await call('POST', items, { kind: 'foryou', session: t0 - 60000, start: 0, tweets: [...recs, hostile] }, A.token);
    assert.equal(r.status, 200);
    assert.equal(r.data.accepted, recs.length + 1);
    r = await call('POST', items, { kind: 'foryou', session: t0, start: 0, tweets: [
      { ...recs[0], id: '31' }, { ...recs[0], id: '32' }, recs[1] /* already in feed */] }, A.token);
    assert.equal(r.data.accepted, 3);
    const stored = JSON.parse(sql("SELECT data FROM tweets WHERE id = '999'")[0].data);
    assert.deepEqual(stored.urls, []);
    assert.equal(stored.author.avatar, null);
    assert.equal(stored.extra, undefined);
  });

  await step('pages newest session first, in feed order, without duplicates', async () => {
    const ids = [];
    let next = null;
    let pages = 0;
    do {
      const r = await call('GET', `/api/feeds/${A.id}?kind=foryou&limit=4${next ? `&before=${next}` : ''}`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('access-control-allow-origin'), '*');
      ids.push(...r.data.items.map(i => i.tweet.id));
      next = r.data.next;
      pages++;
    } while (next);
    assert.deepEqual(ids, ['31', '32', ...recs.map(r => r.id), '999']);
    assert.equal(pages, 4);
    const empty = await call('GET', `/api/feeds/${A.id}?kind=following`);
    assert.deepEqual(empty.data.items, []);
    assert.equal(empty.data.feed.following_at, null);
    assert.ok(empty.data.feed.foryou_at >= t0);
  });

  let B;
  await step("one publisher can't rewrite tweets shown in another feed", async () => {
    B = (await call('POST', '/api/feeds', { label: 'mallory' })).data;
    const fake = { ...recs[0], text: 'FAKE TEXT' };
    assert.equal((await call('POST', `/api/feeds/${B.id}/items`, { kind: 'foryou', tweets: [fake] }, B.token)).status, 200);
    const a = await call('GET', `/api/feeds/${A.id}?kind=foryou&limit=100`);
    assert.equal(a.data.items.find(i => i.tweet.id === recs[0].id).tweet.text, recs[0].text);
    const b = await call('GET', `/api/feeds/${B.id}?kind=foryou`);
    assert.equal(b.data.items[0].tweet.text, 'FAKE TEXT');
  });

  await step('lists feeds without secrets; rename needs the token', async () => {
    const list = await call('GET', '/api/feeds');
    assert.deepEqual(list.data.feeds.map(f => f.id).sort(), [A.id, B.id].sort());
    assert.ok(!JSON.stringify(list.data).includes('token'));
    assert.equal((await call('PATCH', `/api/feeds/${A.id}`, { label: 'renamed' }, B.token)).status, 401);
    assert.equal((await call('PATCH', `/api/feeds/${A.id}`, { label: 'renamed' }, A.token)).data.label, 'renamed');
  });

  await step('rate-limits feed creation', async () => {
    const r = await call('POST', '/api/feeds', { label: 'third' });
    assert.equal(r.status, 429);
    assert.equal(r.data.retry_after, 60);
  });

  await step('cron expires old entries and orphaned tweets', async () => {
    sql(`UPDATE items SET session = session - ${15 * 864e5} WHERE feed_id = '${B.id}'`);
    sql(`UPDATE feeds SET foryou_at = foryou_at - ${15 * 864e5} WHERE id = '${B.id}'`);
    const r = await fetch(`${BASE}/__scheduled?cron=17+3+*+*+*`);
    assert.equal(r.status, 200);
    assert.deepEqual((await call('GET', `/api/feeds/${B.id}?kind=foryou`)).data.items, []);
    assert.equal(sql("SELECT COUNT(*) AS n FROM tweets WHERE data LIKE '%FAKE TEXT%'")[0].n, 0);
    assert.equal((await call('GET', `/api/feeds/${A.id}?kind=foryou&limit=100`)).data.items.length, recs.length + 3);
  });

  await step('delete wipes the feed, its items and its tweets', async () => {
    assert.equal((await call('DELETE', `/api/feeds/${A.id}`, undefined, B.token)).status, 401);
    assert.equal((await call('DELETE', `/api/feeds/${A.id}`, undefined, A.token)).status, 200);
    assert.equal((await call('GET', `/api/feeds/${A.id}`)).status, 404);
    assert.equal((await call('GET', `/f/${A.id}`)).status, 404);
    assert.equal((await call('POST', items, { kind: 'foryou', tweets: recs.slice(0, 1) }, A.token)).status, 404);
    assert.equal(sql(`SELECT COUNT(*) AS n FROM items WHERE feed_id = '${A.id}'`)[0].n, 0);
    assert.equal(sql('SELECT COUNT(*) AS n FROM tweets')[0].n, 0);
  });

  console.log(`\n${steps.length} worker checks passed`);
} catch (e) {
  console.error('\nFAILED:', e);
  console.error('\n--- wrangler log ---\n' + log.slice(-4000));
  process.exitCode = 1;
} finally {
  dev.kill();
  await fs.rm(persist, { recursive: true, force: true });
}
