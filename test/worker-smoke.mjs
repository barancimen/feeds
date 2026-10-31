// End-to-end check of the Worker against `wrangler dev --local` with a throwaway D1 database.
// Usage: node build.mjs && node test/worker-smoke.mjs

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
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

// Stand-in for publish.x.com/oembed: post ID -> { status, body }; records what the Worker asked for.
const mock = new Map();
const mockAsked = [];
const oembed = (handle, htmlText) => ({ status: 200, body: JSON.stringify({
  url: `https://x.com/${handle}/status/1`, author_name: handle, author_url: `https://x.com/${handle}`,
  html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">${htmlText}</p>&mdash; ${handle} (@${handle}) <a href="#">October 28, 2026</a></blockquote>`,
  type: 'rich', provider_name: 'X', version: '1.0' }) });
const oembedServer = http.createServer((req, res) => {
  const target = new URL(req.url, 'http://x').searchParams.get('url') || '';
  mockAsked.push(target);
  const r = mock.get(target.split('/').pop()) || { status: 404, body: '<html>not found</html>' };
  res.writeHead(r.status, { 'content-type': r.status === 200 ? 'application/json' : 'text/html' });
  res.end(r.body);
});
await new Promise(r => oembedServer.listen(0, '127.0.0.1', r));
const OEMBED = `http://127.0.0.1:${oembedServer.address().port}/oembed`;
const freshId = (ms = Date.now()) => ((BigInt(ms) - 1288834974657n) << 22n).toString();

const dev = spawn(WRANGLER, ['dev', '--local', '--port', String(PORT), '--persist-to', persist, '--test-scheduled',
  '--var', `OEMBED_URL:${OEMBED}`],
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
    assert.match(home.data, /html\{overflow-y:scroll\}/); // scroll bar always shown, so pages don't shift
    assert.match((await call('GET', '/viewer.js')).data, /Shared X Feeds/);
    assert.match((await call('GET', '/x-feed-share.user.js')).data, /==UserScript==/);
    const v = await call('GET', '/feeds/api/version');
    assert.equal(v.data.version, JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version);
    assert.match((await call('GET', '/x-feed-share.user.js')).data, new RegExp(`@version +${v.data.version}\\n`));
  });

  await step('serves the privacy policy', async () => {
    const p = await call('GET', '/feeds/privacy');
    assert.equal(p.status, 200);
    assert.match(p.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(p.data, /<h1>Privacy policy<\/h1>/);
    assert.match(p.data, /href="\/feeds"/); // links back under the same base
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

  await step('everything also works under /feeds (gestaltschaft.com/feeds)', async () => {
    for (const path of ['/feeds', '/feeds/', `/feeds/f/${A.id}`]) {
      const r = await call('GET', path);
      assert.equal(r.status, 200, path);
      assert.match(r.data, /data-base="\/feeds"/);
      assert.match(r.data, /<script src="\/feeds\/viewer\.js">/);
    }
    assert.match((await call('GET', '/')).data, /data-base=""/);
    assert.equal((await call('GET', '/feeds/f/zzzzzzzzzz')).status, 404);
    assert.match((await call('GET', '/feeds/viewer.js')).data, /Install the userscript/);
    assert.match((await call('GET', '/feeds/x-feed-share.user.js')).data, /==UserScript==/);
    assert.ok((await call('GET', '/feeds/api/feeds')).data.feeds);
    assert.equal((await call('GET', `/feeds/api/feeds/${A.id}`)).data.feed.id, A.id);
    assert.equal((await call('GET', '/feedsx')).status, 404);
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

  const searchIds = async (qs, status = 200) => {
    const r = await call('GET', `/api/search?${qs}`);
    assert.equal(r.status, status, `search ${qs}`);
    return r.data;
  };

  await step('full-text search: words, prefixes, people, retweeted text, scoping, hostile input', async () => {
    let d = await searchIds('q=jerry');
    assert.deepEqual(d.results.map(r => r.tweet.id).sort(), ['1', '31', '32']);
    assert.deepEqual(d.results[0].seen.map(s => [s.feed_id, s.kind, s.label]), [[A.id, 'foryou', '@tester feed']]);
    assert.ok((await searchIds('q=JER')).results.some(r => r.tweet.id === '1'));
    assert.deepEqual((await searchIds('q=carol')).results.map(r => r.tweet.id), ['5']);
    assert.deepEqual((await searchIds('q=original%20full')).results.map(r => r.tweet.id), ['5']);
    assert.deepEqual((await searchIds('q=caf%C3%A9')).results, []);
    assert.equal((await searchIds(`q=jerry&feed=${A.id}&kind=foryou`)).results.length, 3);
    assert.deepEqual((await searchIds('q=jerry&feed=zzzzzzzzzz')).results, []);
    assert.deepEqual((await searchIds('q=jerry&kind=following')).results, []);
    assert.equal((await searchIds('q=a%22%20OR%20body%3A%22b')).results.length, 0);
    await searchIds('q=%22*%3A(', 400);
    await searchIds('q=', 400);
    const page1 = await searchIds('q=jerry&limit=2');
    assert.equal(page1.results.length, 2);
    assert.equal(page1.next, 2);
    assert.equal((await searchIds('q=jerry&limit=2&offset=2')).results.length, 1);
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
    assert.equal((await call('POST', `/api/feeds/${B.id}/items`, { kind: 'foryou', tweets: [fake, recs[1]] }, B.token)).status, 200);
    const a = await call('GET', `/api/feeds/${A.id}?kind=foryou&limit=100`);
    assert.equal(a.data.items.find(i => i.tweet.id === recs[0].id).tweet.text, recs[0].text);
    const b = await call('GET', `/api/feeds/${B.id}?kind=foryou`);
    assert.equal(b.data.items[0].tweet.text, 'FAKE TEXT');
  });

  await step('search keeps copies apart: a fake copy is attributed only to its own feed', async () => {
    const fake = (await searchIds('q=fake')).results;
    assert.deepEqual(fake.map(r => [r.tweet.id, r.seen.map(s => s.feed_id)]), [[recs[0].id, [B.id]]]);
    assert.ok((await searchIds('q=jerry')).results.every(r => r.seen.every(s => s.feed_id === A.id)));
    // An identical copy seen by two publishers is one result listing both feeds.
    const same = (await searchIds('q=original')).results;
    assert.equal(same.length, 1);
    assert.deepEqual(same[0].seen.map(s => s.feed_id).sort(), [A.id, B.id].sort());
  });

  await step('lists feeds without secrets, pages, filters by name; names are fixed', async () => {
    const list = await call('GET', '/api/feeds');
    assert.deepEqual(list.data.feeds.map(f => f.id).sort(), [A.id, B.id].sort());
    assert.equal(list.data.next, null);
    assert.ok(!JSON.stringify(list.data).includes('token'));
    const p1 = (await call('GET', '/api/feeds?limit=1')).data;
    const p2 = (await call('GET', `/api/feeds?limit=1&before=${p1.next}`)).data;
    const p3 = (await call('GET', `/api/feeds?limit=1&before=${p2.next}`)).data;
    assert.deepEqual([...p1.feeds, ...p2.feeds].map(f => f.id).sort(), [A.id, B.id].sort());
    assert.deepEqual(p3.feeds, []);
    assert.deepEqual((await call('GET', '/api/feeds?q=MALL')).data.feeds.map(f => f.id), [B.id]);
    assert.deepEqual((await call('GET', '/api/feeds?q=tester%20f')).data.feeds.map(f => f.id), [A.id]);
    assert.deepEqual((await call('GET', '/api/feeds?q=%25')).data.feeds, []);
    assert.deepEqual((await call('GET', '/api/feeds?q=_')).data.feeds, []);
    assert.equal((await call('PATCH', `/api/feeds/${A.id}`, { label: 'renamed' }, A.token)).status, 404);
    assert.equal((await call('GET', `/api/feeds/${A.id}`)).data.feed.label, A.label);
  });

  await step('verification: one-time code, freshness, author from X, one verified feed per account', async () => {
    const post = (path, body, token) => call('POST', `/api/feeds/${path}`, body, token);
    assert.equal((await post(`${A.id}/verify/check`, { tweet_id: freshId() }, A.token)).status, 400); // nothing pending
    assert.equal((await post(`${A.id}/verify`, {}, B.token)).status, 401);
    const start = await post(`${A.id}/verify`, {}, A.token);
    assert.equal(start.status, 200);
    const { code } = start.data;
    assert.match(code, /^[a-z0-9]{8}$/);
    assert.ok(start.data.text.includes(code) && !/https?:/.test(start.data.text));
    assert.ok(!JSON.stringify((await call('GET', `/api/feeds/${A.id}`)).data).includes(code));

    assert.equal((await post(`${A.id}/verify/check`, { tweet_id: '2115036713554981186' }, A.token)).status, 400); // older than the code
    assert.equal((await post(`${A.id}/verify/check`, { tweet_id: 'abc' }, A.token)).status, 400);
    const missing = freshId();
    assert.equal((await post(`${A.id}/verify/check`, { tweet_id: missing }, A.token)).status, 404);
    assert.equal(mockAsked.at(-1), `https://x.com/i/status/${missing}`); // asks by ID only; X names the author
    const other = freshId(Date.now() + 1);
    mock.set(other, oembed('alice', 'just a normal post'));
    const wrong = await post(`${A.id}/verify/check`, { tweet_id: other }, A.token);
    assert.equal(wrong.status, 400);
    assert.equal(wrong.data.handle, 'alice');
    const flaky = freshId(Date.now() + 2);
    mock.set(flaky, { status: 500, body: 'oops' });
    assert.equal((await post(`${A.id}/verify/check`, { tweet_id: flaky }, A.token)).status, 502);

    const good = freshId(Date.now() + 3);
    mock.set(good, oembed('Alice', `it&#39;s me. Code: <a href="https://t.co/x">${code}</a>`));
    const ok = await post(`${A.id}/verify/check`, { tweet_id: good }, A.token);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.verified_handle, 'Alice');
    assert.equal((await call('GET', `/api/feeds/${A.id}`)).data.feed.verified_handle, 'Alice');
    assert.equal((await call('GET', '/api/feeds')).data.feeds.find(f => f.id === A.id).verified_handle, 'Alice');
    assert.ok((await searchIds('q=original')).results[0].seen.some(s => s.feed_id === A.id && s.verified === 'Alice'));
    assert.equal((await post(`${A.id}/verify/check`, { tweet_id: good }, A.token)).status, 400); // single use

    // B proves another account: both feeds stay, each with its own badge. (The same account merges; see below.)
    const codeB = (await post(`${B.id}/verify`, {}, B.token)).data.code;
    const goodB = freshId(Date.now() + 4);
    mock.set(goodB, oembed('bob', `Code: ${codeB}`));
    const okB = await post(`${B.id}/verify/check`, { tweet_id: goodB }, B.token);
    assert.equal(okB.data.verified_handle, 'bob');
    assert.equal(okB.data.merged_into, undefined);
    assert.equal((await call('GET', `/api/feeds/${A.id}`)).data.feed.verified_handle, 'Alice');

    // A code issued to one feed can't verify another.
    const codeA = (await post(`${A.id}/verify`, {}, A.token)).data.code;
    const codeB2 = (await post(`${B.id}/verify`, {}, B.token)).data.code;
    const cross = freshId(Date.now() + 5);
    mock.set(cross, oembed('mallory', `Code: ${codeA}`));
    assert.equal((await post(`${B.id}/verify/check`, { tweet_id: cross }, B.token)).status, 400);
    assert.notEqual(codeA, codeB2);
  });

  await step('rate-limits feed creation: 100 new feeds an hour across the site', async () => {
    const before = sql('SELECT COUNT(*) AS n FROM feeds')[0].n;
    const extra = 100 - before - 1;
    // Fill up to one below the limit with feeds made 10 to 59 minutes ago (made directly, to be quick).
    sql(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${extra})
      INSERT INTO feeds (id, token_hash, label, created_at) SELECT printf('fill%06d', i), 'x', 'fill', ${Date.now() - 59 * 60000} + i * 1000 FROM n`);
    const last = await call('POST', '/api/feeds', { label: 'the 100th' });
    assert.equal(last.status, 201);
    const over = await call('POST', '/api/feeds', { label: 'the 101st' });
    assert.equal(over.status, 429);
    assert.ok(over.data.retry_after > 0 && over.data.retry_after <= 3600, String(over.data.retry_after));
    // An hour later they no longer count.
    sql(`UPDATE feeds SET created_at = created_at - 3600000 WHERE id LIKE 'fill%' OR id = '${last.data.id}'`);
    const again = await call('POST', '/api/feeds', { label: 'later' });
    assert.equal(again.status, 201);
    for (const r of [last, again]) assert.equal((await call('DELETE', `/api/feeds/${r.data.id}`, undefined, r.data.token)).status, 200);
    sql("DELETE FROM feeds WHERE id LIKE 'fill%'");
  });

  await step('cron expires old entries and orphaned tweets', async () => {
    sql(`UPDATE items SET session = session - ${15 * 864e5} WHERE feed_id = '${B.id}'`);
    sql(`UPDATE feeds SET foryou_at = foryou_at - ${15 * 864e5} WHERE id = '${B.id}'`);
    const r = await fetch(`${BASE}/__scheduled?cron=17+3+*+*+*`);
    assert.equal(r.status, 200);
    assert.deepEqual((await call('GET', `/api/feeds/${B.id}?kind=foryou`)).data.items, []);
    assert.equal(sql("SELECT COUNT(*) AS n FROM tweets WHERE data LIKE '%FAKE TEXT%'")[0].n, 0);
    assert.deepEqual((await searchIds('q=fake')).results, []);
    assert.deepEqual((await searchIds('q=original')).results[0].seen.map(s => s.feed_id), [A.id]);
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
    assert.equal(sql('SELECT COUNT(*) AS n FROM tweets_fts')[0].n, 0);
    assert.deepEqual((await searchIds('q=jerry')).results, []);
  });

  await step('a new feed proven by an already verified account is merged into its feed', async () => {
    // Feeds made directly, so the creation rate limit doesn't get in the way.
    const make = (id, handle) => {
      const token = `token-${id}-0123456789abcdef`;
      sql(`INSERT INTO feeds (id, token_hash, label, created_at, verified_handle, verified_at) VALUES
        ('${id}', '${createHash('sha256').update(token).digest('hex')}', '@carol', ${Date.now()}, ${handle ? `'${handle}', 1` : 'NULL, NULL'})`);
      return { id, token };
    };
    const P = make('pppppppppp', 'carol'); // made with the userscript, verified
    const Q = make('qqqqqqqqqq', null);    // made later with the extension
    const push = (f, tweets, kind = 'foryou') => call('POST', `/api/feeds/${f.id}/items`, { kind, tweets }, f.token);
    assert.equal((await push(P, recs.slice(0, 3))).status, 200);
    assert.equal((await push(Q, recs.slice(2, 5))).status, 200); // one post in common
    assert.equal((await push(Q, recs.slice(5, 6), 'following')).status, 200);
    const code = (await call('POST', `/api/feeds/${Q.id}/verify`, {}, Q.token)).data.code;
    const proof = freshId(Date.now() + 10);
    mock.set(proof, oembed('Carol', `Code: ${code}`));
    const ok = await call('POST', `/api/feeds/${Q.id}/verify/check`, { tweet_id: proof }, Q.token);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.merged_into, P.id);

    const p = (await call('GET', `/api/feeds/${P.id}?kind=foryou&limit=100`)).data;
    assert.equal(p.items.length, 5);
    assert.equal(p.feed.verified_handle, 'Carol');
    assert.ok(p.feed.following_at);
    assert.equal(sql(`SELECT COUNT(*) AS n FROM items WHERE feed_id = '${Q.id}'`)[0].n, 0);
    // The extension keeps using Q's ID and token; they lead to P.
    assert.equal((await push(Q, recs.slice(6, 7))).status, 200);
    assert.equal((await call('GET', `/api/feeds/${P.id}?kind=foryou&limit=100`)).data.items.length, 6);
    assert.equal((await call('GET', `/api/feeds/${Q.id}?kind=foryou`)).data.feed.id, P.id);
    const moved = await fetch(`${BASE}/feeds/f/${Q.id}`, { redirect: 'manual' });
    assert.equal(moved.status, 301);
    assert.equal(new URL(moved.headers.get('location')).pathname, `/feeds/f/${P.id}`);
    const listed = (await call('GET', '/api/feeds')).data.feeds.map(f => f.id);
    assert.ok(listed.includes(P.id) && !listed.includes(Q.id));
    const word = recs[6].text.split(/\s+/).find(w => /^[a-z]{4,}$/i.test(w));
    assert.ok((await searchIds(`q=${word}&feed=${Q.id}`)).results.length);
    assert.equal((await call('POST', `/api/feeds/${Q.id}/verify`, {}, Q.token)).status, 200); // verifies P
    assert.equal((await call('POST', `/api/feeds/${P.id}/items`, { kind: 'foryou', tweets: recs.slice(0, 1) }, Q.token)).status, 401);

    // Deleting through either token deletes the merged feed and the old ID.
    assert.equal((await call('DELETE', `/api/feeds/${Q.id}`, undefined, Q.token)).data.deleted, P.id);
    assert.equal(sql(`SELECT COUNT(*) AS n FROM feeds WHERE id IN ('${P.id}', '${Q.id}')`)[0].n, 0);
    assert.equal((await push(P, recs.slice(0, 1))).status, 404);
    assert.equal(sql('SELECT COUNT(*) AS n FROM tweets')[0].n, 0);
  });

  console.log(`\n${steps.length} worker checks passed`);
} catch (e) {
  console.error('\nFAILED:', e);
  console.error('\n--- wrangler log ---\n' + log.slice(-4000));
  process.exitCode = 1;
} finally {
  dev.kill();
  oembedServer.close();
  await fs.rm(persist, { recursive: true, force: true });
}
