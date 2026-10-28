// Directory and feed views, shared by the on-x.com panel and the public web page.

import { ago, el, renderTweet, sessionLabel } from './render.js';

const KIND_TABS = [['following', 'Following'], ['foryou', 'For You']];

export async function renderDirectory(doc, mount, api, open) {
  mount.replaceChildren(el(doc, 'div', 'xfs-note', 'Loading shared feeds…'));
  let data;
  try { data = await api.listFeeds(); } catch (e) {
    mount.replaceChildren(el(doc, 'div', 'xfs-note', `Could not load feeds: ${e.message}`));
    return;
  }
  mount.replaceChildren();
  if (!data.feeds.length) { mount.append(el(doc, 'div', 'xfs-note', 'No feeds shared in the last 14 days.')); return; }
  for (const f of data.feeds) {
    const b = el(doc, 'button', 'xfs-feed');
    const kinds = KIND_TABS.filter(([k]) => f[`${k}_at`]).map(([, name]) => name).join(' · ');
    b.append(el(doc, 'div', 'xfs-label', f.label), el(doc, 'div', 'xfs-muted xfs-small', `${kinds} · active ${ago(f.last_push_at)}`));
    b.onclick = () => open(f.id);
    mount.append(b);
  }
}

// opts: { kind, back(), onKind(kind), shareUrl }
export async function renderFeed(doc, mount, api, id, opts = {}) {
  let kind = opts.kind || null;
  let next = null;
  let lastSession = null;
  const head = el(doc, 'div', 'xfs-feedhead');
  const list = el(doc, 'div');
  const more = el(doc, 'button', 'xfs-btn xfs-more', 'Load more');
  mount.replaceChildren(el(doc, 'div', 'xfs-note', 'Loading…'));

  function drawHead(feed) {
    const top = el(doc, 'div', 'xfs-row');
    if (opts.back) {
      const b = el(doc, 'button', 'xfs-btn', '← All feeds');
      b.onclick = opts.back;
      top.append(b);
    }
    top.append(el(doc, 'span', 'xfs-label', feed.label));
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
    head.replaceChildren(top, tabs, el(doc, 'div', 'xfs-muted xfs-small',
      'The name is self-described. Posts are shown as the publisher uploaded them; open one on X to verify it. Entries expire after 14 days.'));
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
