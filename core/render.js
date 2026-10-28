// Tweet cards, built with the DOM API only. Records come from untrusted publishers and this code
// runs inside x.com's page, so no untrusted string ever reaches innerHTML and every URL is re-checked.

import { cleanRecord, safeHttpUrl } from './safe.js';

export const CSS = `
.xfs{--bg:#fff;--fg:#0f1419;--muted:#536471;--line:#eff3f4;--hover:#f7f9f9;--accent:#1d9bf0;--danger:#f4212e;
  font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg)}
.xfs.dark{--bg:#000;--fg:#e7e9ea;--muted:#71767b;--line:#2f3336;--hover:#16181c}
.xfs *{box-sizing:border-box}
.xfs a{color:var(--accent);text-decoration:none}
.xfs a:hover{text-decoration:underline}
.xfs-card{padding:12px 14px;border-bottom:1px solid var(--line)}
.xfs-rt{color:var(--muted);font-size:13px;margin:0 0 4px 50px}
.xfs-rt a{color:inherit;font-weight:600}
.xfs-tweet{display:grid;grid-template-columns:40px minmax(0,1fr);gap:0 10px}
.xfs-av{width:40px;height:40px;border-radius:50%;background:var(--line);display:block;object-fit:cover}
.xfs-head{display:flex;gap:4px;align-items:baseline;min-width:0;white-space:nowrap;overflow:hidden}
.xfs-head .xfs-av{width:20px;height:20px;align-self:center}
.xfs-name{font-weight:700;color:var(--fg)!important;overflow:hidden;text-overflow:ellipsis}
.xfs-handle,.xfs-time,.xfs-muted{color:var(--muted)!important}
.xfs-handle{overflow:hidden;text-overflow:ellipsis}
.xfs-reply{color:var(--muted);font-size:13px}
.xfs-text{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:2px}
.xfs-media{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin-top:8px;border-radius:12px;overflow:hidden;border:1px solid var(--line)}
.xfs-media.n1{grid-template-columns:1fr}
.xfs-media a{position:relative;display:block;aspect-ratio:16/9;background:var(--line)}
.xfs-media img{width:100%;height:100%;object-fit:cover;display:block}
.xfs-play{position:absolute;inset:0;display:grid;place-items:center;font-size:28px;color:#fff;text-shadow:0 1px 6px #000}
.xfs-quote{border:1px solid var(--line);border-radius:12px;padding:8px 10px;margin-top:8px}
.xfs-session{padding:6px 14px;font-size:12px;color:var(--muted);background:var(--hover);border-bottom:1px solid var(--line)}
.xfs-note{padding:16px 14px;color:var(--muted)}
.xfs-small{font-size:12px}
.xfs-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.xfs-btn{font:inherit;font-size:13px;font-weight:600;padding:5px 12px;border-radius:999px;border:1px solid var(--line);
  background:var(--bg);color:var(--fg);cursor:pointer}
.xfs-btn:hover{background:var(--hover)}
.xfs-btn.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.xfs-btn:disabled{opacity:.5;cursor:default}
.xfs-more{display:block;margin:12px auto}
.xfs-feedhead{padding:12px 14px;border-bottom:1px solid var(--line);display:grid;gap:8px}
.xfs-feed{display:block;width:100%;text-align:left;padding:10px 14px;border:0;border-bottom:1px solid var(--line);
  background:none;color:inherit;font:inherit;cursor:pointer}
.xfs-feed:hover{background:var(--hover)}
.xfs-label{font-weight:700;overflow-wrap:anywhere}
.xfs-search{display:flex;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line)}
.xfs-feedhead .xfs-search{padding:0;border:0}
.xfs-search input{flex:1;min-width:0;font:inherit;padding:6px 12px;border-radius:999px;border:1px solid var(--line);
  background:var(--hover);color:var(--fg);outline:none}
.xfs-search input:focus{border-color:var(--accent);background:var(--bg)}
.xfs-h{padding:12px 14px 4px;font-weight:700;font-size:13px;color:var(--muted);border-bottom:1px solid var(--line)}
.xfs-seen{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 0 50px;font-size:12px;color:var(--muted)}
.xfs-chip{font:inherit;font-size:12px;padding:2px 9px;border-radius:999px;border:1px solid var(--line);background:none;
  color:var(--fg);cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xfs-chip:hover{background:var(--hover)}
.xfs-badge{display:inline-flex;align-items:center;gap:3px;font-size:12px;font-weight:700;color:var(--accent)!important;white-space:nowrap}
`;

// Keep keystrokes in our inputs away from the page: x.com binds single-letter shortcuts on the document.
export function isolateKeys(input) {
  for (const t of ['keydown', 'keyup', 'keypress']) input.addEventListener(t, e => e.stopPropagation());
}

export function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// href must already be a vetted URL.
function link(doc, href, cls, text) {
  const a = el(doc, 'a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function img(doc, src, cls) {
  const i = el(doc, 'img', cls);
  i.src = src;
  i.alt = '';
  i.loading = 'lazy';
  i.referrerPolicy = 'no-referrer';
  return i;
}

const profileUrl = h => `https://x.com/${h}`;
const statusUrl = r => `https://x.com/${r.author.handle}/status/${r.id}`;

export function relTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const d = new Date(t);
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

export function ago(ms, now = Date.now()) {
  if (!ms) return 'never';
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function sessionLabel(ms) {
  return 'Seen ' + new Date(ms).toLocaleString(undefined,
    { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shorten(u) {
  const s = u.replace(/^https?:\/\/(www\.)?/, '');
  return s.length > 32 ? s.slice(0, 31) + '…' : s;
}

const TOKEN = /https?:\/\/[^\s]+|@[A-Za-z0-9_]{1,15}|#[\p{L}\p{N}_]+/gu;

function appendText(doc, parent, text, urls) {
  const display = new Map(urls.map(u => [u.url, u.display]));
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index;
    let tok = m[0];
    let href;
    if (tok[0] === 'h') {
      if (!display.has(tok)) tok = tok.replace(/[.,!?;:)\]'"»…]+$/, '');
      href = safeHttpUrl(tok);
    } else {
      if (i > 0 && /[\p{L}\p{N}_&]/u.test(text[i - 1])) continue; // a@b.com, &#...
      href = tok[0] === '@' ? profileUrl(tok.slice(1)) : `https://x.com/hashtag/${encodeURIComponent(tok.slice(1))}`;
    }
    if (!href) continue;
    if (i > last) parent.append(doc.createTextNode(text.slice(last, i)));
    parent.append(link(doc, href, null, tok[0] === 'h' ? (display.get(tok) || shorten(tok)) : tok));
    last = i + tok.length;
  }
  if (last < text.length) parent.append(doc.createTextNode(text.slice(last)));
}

function media(doc, r) {
  const box = el(doc, 'div', 'xfs-media' + (r.media.length === 1 ? ' n1' : ''));
  for (const m of r.media) {
    const a = link(doc, statusUrl(r));
    const u = new URL(m.url);
    if (!u.search) u.searchParams.set('name', 'small');
    a.append(img(doc, u.href));
    if (m.type !== 'photo') a.append(el(doc, 'span', 'xfs-play', '▶'));
    box.append(a);
  }
  return box;
}

function tweetBody(doc, r, nested) {
  const main = el(doc, 'div');
  const head = el(doc, 'div', 'xfs-head');
  if (nested && r.author.avatar) head.append(img(doc, r.author.avatar, 'xfs-av'));
  head.append(link(doc, profileUrl(r.author.handle), 'xfs-name', r.author.name));
  head.append(link(doc, profileUrl(r.author.handle), 'xfs-handle', '@' + r.author.handle));
  head.append(el(doc, 'span', 'xfs-muted', '·'));
  const time = link(doc, statusUrl(r), 'xfs-time', relTime(r.created_at) || 'open');
  time.title = 'Open on X' + (r.created_at ? ` · ${new Date(r.created_at).toLocaleString()}` : '');
  head.append(time);
  main.append(head);

  if (r.reply_to) {
    const rep = el(doc, 'div', 'xfs-reply', 'Replying to ');
    if (r.reply_to.handle) rep.append(link(doc, profileUrl(r.reply_to.handle), null, '@' + r.reply_to.handle));
    else rep.append(link(doc, `https://x.com/i/status/${r.reply_to.id}`, null, 'a post'));
    main.append(rep);
  }
  if (r.text) {
    const t = el(doc, 'div', 'xfs-text');
    appendText(doc, t, r.text, r.urls);
    main.append(t);
  }
  if (r.media.length) main.append(media(doc, r));
  if (r.quoted) main.append(tweetBody(doc, r.quoted, true));

  if (nested) { main.className = 'xfs-quote'; return main; }
  const wrap = el(doc, 'div', 'xfs-tweet');
  const av = link(doc, profileUrl(r.author.handle));
  av.append(r.author.avatar ? img(doc, r.author.avatar, 'xfs-av') : el(doc, 'span', 'xfs-av'));
  wrap.append(av, main);
  return wrap;
}

// Returns an <article> for a record, or null if the record doesn't validate.
export function renderTweet(doc, raw) {
  const r = cleanRecord(raw);
  if (!r) return null;
  const card = el(doc, 'article', 'xfs-card');
  if (r.retweeted) {
    const rt = el(doc, 'div', 'xfs-rt', '↻ ');
    rt.append(link(doc, profileUrl(r.author.handle), null, r.author.name), doc.createTextNode(' reposted'));
    card.append(rt, tweetBody(doc, r.retweeted, false));
  } else {
    card.append(tweetBody(doc, r, false));
  }
  return card;
}
