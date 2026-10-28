// Directory, feed and search views, shared by the on-x.com panel and the public web page.
// `nav` = { home(), openFeed(id, kind?), search(q, feedId?, feedLabel?) } lets each host route its own way.

import { ago, el, isolateKeys, renderTweet, sessionLabel } from './render.js';
import { isHandle } from './safe.js';

const KIND_TABS = [['following', 'Following'], ['foryou', 'For You']];
const KIND_NAME = Object.fromEntries(KIND_TABS);

function errorText(e) {
  if (e.status === 400) return 'Type at least one word to search for.';
  if (e.status === 429) return 'Too many requests. Wait a minute and try again.';
  return e.message;
}

function searchForm(doc, placeholder, value, onSubmit) {
  const form = el(doc, 'form', 'xfs-search');
  const input = el(doc, 'input');
  input.type = 'search';
  input.placeholder = placeholder;
  input.value = value || '';
  input.maxLength = 200;
  input.setAttribute('aria-label', placeholder);
  isolateKeys(input);
  const button = el(doc, 'button', 'xfs-btn', 'Search');
  button.type = 'submit';
  form.append(input, button);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) onSubmit(q);
  });
  return form;
}

const moreButton = doc => el(doc, 'button', 'xfs-btn xfs-more', 'Load more');

// "✓ @handle" for feeds whose publisher proved control of that X account. A link where allowed.
function badge(doc, handle, asLink) {
  if (!isHandle(handle)) return null;
  const b = el(doc, asLink ? 'a' : 'span', 'xfs-badge', `✓ @${handle}`);
  b.title = `Published by @${handle} (account verified)`;
  if (asLink) { b.href = `https://x.com/${handle}`; b.target = '_blank'; b.rel = 'noopener noreferrer'; }
  return b;
}

function feedButton(doc, f, nav) {
  const b = el(doc, 'button', 'xfs-feed');
  const kinds = KIND_TABS.filter(([k]) => f[`${k}_at`]).map(([, name]) => name).join(' · ');
  const name = el(doc, 'div', 'xfs-row');
  name.append(el(doc, 'span', 'xfs-label', f.label));
  const v = badge(doc, f.verified_handle, false);
  if (v) name.append(v);
  b.append(name, el(doc, 'div', 'xfs-muted xfs-small', `${kinds || 'No recent posts'} · active ${ago(f.last_push_at)}`));
  b.onclick = () => nav.openFeed(f.id);
  return b;
}

export async function renderDirectory(doc, mount, api, nav) {
  const list = el(doc, 'div');
  const more = moreButton(doc);
  mount.replaceChildren(searchForm(doc, 'Search posts and feed names', '', q => nav.search(q)), list);
  list.append(el(doc, 'div', 'xfs-note', 'Loading shared feeds…'));
  let next = null;
  async function load(first) {
    more.disabled = true;
    let data;
    try { data = await api.listFeeds({ before: next }); } catch (e) {
      if (first) list.replaceChildren(el(doc, 'div', 'xfs-note', `Could not load feeds: ${errorText(e)}`));
      else { more.disabled = false; more.textContent = 'Retry'; }
      return;
    }
    if (first) list.replaceChildren();
    more.remove();
    if (first && !data.feeds.length) list.append(el(doc, 'div', 'xfs-note', 'No feeds shared in the last 14 days.'));
    for (const f of data.feeds) list.append(feedButton(doc, f, nav));
    next = data.next;
    more.textContent = 'Load more';
    more.disabled = false;
    if (next) list.append(more);
  }
  more.onclick = () => load(false);
  await load(true);
}

// opts: { feed, feedLabel } to search within one feed.
export async function renderSearch(doc, mount, api, q, nav, opts = {}) {
  const { feed, feedLabel } = opts;
  const top = el(doc, 'div', 'xfs-feedhead');
  const back = el(doc, 'button', 'xfs-btn', feed ? '← Back to feed' : '← All feeds');
  back.onclick = () => (feed ? nav.openFeed(feed) : nav.home());
  const row = el(doc, 'div', 'xfs-row');
  row.append(back);
  if (feed) row.append(el(doc, 'span', 'xfs-muted', `Searching in ${feedLabel || 'one feed'}`));
  top.append(row);
  const feedsBox = el(doc, 'div');
  const posts = el(doc, 'div');
  const more = moreButton(doc);
  mount.replaceChildren(searchForm(doc, feed ? 'Search this feed' : 'Search posts and feed names', q,
    nq => nav.search(nq, feed, feedLabel)), top, feedsBox, posts);
  posts.append(el(doc, 'div', 'xfs-note', 'Searching…'));

  if (!feed) {
    api.listFeeds({ q, limit: 10 }).then(data => {
      if (!data.feeds.length) return;
      feedsBox.append(el(doc, 'div', 'xfs-h', 'Feeds'));
      for (const f of data.feeds) feedsBox.append(feedButton(doc, f, nav));
      feedsBox.append(el(doc, 'div', 'xfs-h', 'Posts'));
    }, () => {});
  }

  let offset = 0;
  async function load(first) {
    more.disabled = true;
    let data;
    try { data = await api.search(q, { feed, offset }); } catch (e) {
      if (first) posts.replaceChildren(el(doc, 'div', 'xfs-note', `Search failed: ${errorText(e)}`));
      else { more.disabled = false; more.textContent = 'Retry'; }
      return;
    }
    if (first) posts.replaceChildren();
    more.remove();
    if (first && !data.results.length) {
      posts.append(el(doc, 'div', 'xfs-note', `No posts match “${q}” in the last 14 days.`));
    }
    for (const r of data.results) {
      const card = renderTweet(doc, r.tweet);
      if (!card) continue;
      card.append(seenLine(doc, r.seen, nav, !!feed));
      posts.append(card);
    }
    offset = data.next;
    more.textContent = 'Load more';
    more.disabled = false;
    if (offset != null) posts.append(more);
  }
  more.onclick = () => load(false);
  await load(true);
}

function seenLine(doc, seen, nav, scoped) {
  const line = el(doc, 'div', 'xfs-seen', scoped ? 'Seen ' : 'Seen in ');
  const shown = scoped ? seen.slice(0, 1) : seen.slice(0, 3);
  for (const s of shown) {
    const who = isHandle(s.verified) ? `✓ @${s.verified}` : s.label;
    const text = scoped ? `${KIND_NAME[s.kind] || s.kind} · ${ago(s.session)}` : `${who} · ${KIND_NAME[s.kind] || s.kind} · ${ago(s.session)}`;
    const chip = el(doc, 'button', 'xfs-chip', text);
    chip.onclick = () => nav.openFeed(s.feed_id, s.kind);
    line.append(chip);
  }
  if (!scoped && seen.length > shown.length) line.append(el(doc, 'span', null, `+${seen.length - shown.length} more`));
  return line;
}

// opts: { kind, back(), onKind(kind), shareUrl, onSearch(q, label) }
export async function renderFeed(doc, mount, api, id, opts = {}) {
  let kind = opts.kind || null;
  let next = null;
  let lastSession = null;
  const head = el(doc, 'div', 'xfs-feedhead');
  const list = el(doc, 'div');
  const more = moreButton(doc);
  mount.replaceChildren(el(doc, 'div', 'xfs-note', 'Loading…'));

  function drawHead(feed) {
    const top = el(doc, 'div', 'xfs-row');
    if (opts.back) {
      const b = el(doc, 'button', 'xfs-btn', '← All feeds');
      b.onclick = opts.back;
      top.append(b);
    }
    top.append(el(doc, 'span', 'xfs-label', feed.label));
    const v = badge(doc, feed.verified_handle, true);
    if (v) top.append(v);
    const tabs = el(doc, 'div', 'xfs-row');
    for (const [k, name] of KIND_TABS) {
      const t = el(doc, 'button', 'xfs-btn' + (k === kind ? ' on' : ''), name);
      t.disabled = !feed[`${k}_at`] && k !== kind;
      t.onclick = () => { if (k !== kind) { kind = k; opts.onKind?.(k); load(true); } };
      tabs.append(t);
    }
    if (opts.shareUrl) {
      const a = el(doc, 'a', 'xfs-small', 'Public link ↗');
      a.href = opts.shareUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      tabs.append(a);
    }
    const who = v
      ? `Published by @${feed.verified_handle}, who proved control of that account on ${new Date(feed.verified_at).toLocaleDateString()}.`
      : 'The name is self-described and not verified.';
    head.replaceChildren(top, tabs, el(doc, 'div', 'xfs-muted xfs-small',
      `${who} Posts are shown as the publisher uploaded them; open one on X to check it. Entries expire after 14 days.`));
    if (opts.onSearch) head.append(searchForm(doc, 'Search this feed', '', q => opts.onSearch(q, feed.label)));
  }

  async function load(reset) {
    more.disabled = true;
    let data;
    try {
      data = await api.getFeed(id, kind, reset ? null : next);
    } catch (e) {
      const msg = e.status === 404 ? 'Feed not found. It may have been deleted.' : `Could not load feed: ${e.message}`;
      if (reset) mount.replaceChildren(el(doc, 'div', 'xfs-note', msg));
      else { more.disabled = false; more.textContent = 'Retry'; }
      return;
    }
    if (reset) {
      kind = data.kind;
      drawHead(data.feed);
      list.replaceChildren();
      lastSession = null;
      mount.replaceChildren(head, list);
    }
    more.remove();
    for (const it of data.items) {
      if (it.session !== lastSession) {
        list.append(el(doc, 'div', 'xfs-session', sessionLabel(it.session)));
        lastSession = it.session;
      }
      const card = renderTweet(doc, it.tweet);
      if (card) list.append(card);
    }
    if (reset && !data.items.length) list.append(el(doc, 'div', 'xfs-note', 'Nothing shared here in the last 14 days.'));
    next = data.next;
    more.textContent = 'Load more';
    more.disabled = false;
    if (next) list.append(more);
  }

  more.onclick = () => load(false);
  await load(true);
}
