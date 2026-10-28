// The on-x.com widget: a pill in the corner that opens a Share / Browse panel (closed Shadow DOM).

import { renderDirectory, renderFeed } from './browse.js';
import { CSS, el } from './render.js';

const PANEL_CSS = `
.wrap{position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:8px;background:none}
.pill{display:flex;gap:6px;align-items:center;font:inherit;font-weight:700;font-size:13px;padding:8px 14px;border-radius:999px;
  border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.18)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--muted)}
.dot.live{background:var(--danger)}
.box{width:380px;max-width:calc(100vw - 24px);max-height:min(75vh,720px);display:flex;flex-direction:column;background:var(--bg);
  border:1px solid var(--line);border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.22);overflow:hidden}
.tabs{display:flex;border-bottom:1px solid var(--line)}
.tab{flex:1;padding:10px;background:none;border:0;border-bottom:2px solid transparent;font:inherit;font-weight:700;color:var(--muted);cursor:pointer}
.tab.on{color:var(--fg);border-bottom-color:var(--accent)}
.body{overflow-y:auto;flex:1;min-height:120px}
.share{padding:12px 14px;display:grid;gap:12px}
.toggle{display:flex;gap:10px;align-items:flex-start;cursor:pointer}
.toggle input{margin-top:3px;accent-color:var(--accent)}
.err{color:var(--danger);font-size:12px}
.err:empty{display:none}
.url{font-size:12px;overflow-wrap:anywhere}
`;

const KIND_ORDER = [['following', 'Share my Following feed'], ['foryou', 'Share my For You feed']];

function isDark(win, doc) {
  const m = (win.getComputedStyle(doc.body).backgroundColor || '').match(/\d+(\.\d+)?/g);
  if (!m) return false;
  const [r, g, b] = m.map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

export function mountPanel(doc, win, app) {
  const host = doc.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  const style = el(doc, 'style');
  style.textContent = CSS + PANEL_CSS;
  const wrap = el(doc, 'div', 'xfs wrap');
  const box = el(doc, 'div', 'box');
  const pill = el(doc, 'button', 'pill');
  const dot = el(doc, 'span', 'dot');
  const pillText = doc.createTextNode('Feeds');
  pill.append(dot, pillText);
  const tabShare = el(doc, 'button', 'tab', 'Share');
  const tabBrowse = el(doc, 'button', 'tab', 'Browse');
  const tabs = el(doc, 'div', 'tabs');
  tabs.append(tabShare, tabBrowse);
  const body = el(doc, 'div', 'body');
  box.append(tabs, body);
  wrap.append(box, pill);
  root.append(style, wrap);
  doc.body.append(host);

  // Share tab
  const share = el(doc, 'div', 'share');
  const feedInfo = el(doc, 'div');
  const toggles = {};
  share.append(feedInfo);
  for (const [kind, text] of KIND_ORDER) {
    const label = el(doc, 'label', 'toggle');
    const input = el(doc, 'input');
    input.type = 'checkbox';
    input.onchange = () => app.toggleShare(kind, input.checked);
    const desc = el(doc, 'div');
    const stat = el(doc, 'div', 'xfs-muted xfs-small');
    desc.append(el(doc, 'div', 'xfs-label', text), stat);
    label.append(input, desc);
    toggles[kind] = { input, stat };
    share.append(label);
  }
  const seenLine = el(doc, 'div', 'xfs-muted xfs-small');
  const errLine = el(doc, 'div', 'err');
  const btnRow = el(doc, 'div', 'xfs-row');
  const flushBtn = el(doc, 'button', 'xfs-btn', 'Upload now');
  flushBtn.onclick = () => app.flushNow();
  const delBtn = el(doc, 'button', 'xfs-btn', 'Delete my feed');
  delBtn.onclick = () => app.deleteFeed();
  btnRow.append(flushBtn, delBtn);
  share.append(seenLine, errLine, btnRow, el(doc, 'div', 'xfs-muted xfs-small',
    'Nothing is uploaded unless a box is ticked, and only posts you scroll past are shared. ' +
    'Ads and posts from protected accounts are never shared. Shared entries expire after 14 days.'));

  // Browse tab
  const browse = el(doc, 'div');
  const openDirectory = () => renderDirectory(doc, browse, app.api, openFeed);
  const openFeed = id => renderFeed(doc, browse, app.api, id, { back: openDirectory, shareUrl: app.publicUrl(id) });

  let tab = 'share';
  function showTab(t) {
    const again = t === tab;
    tab = t;
    tabShare.classList.toggle('on', t === 'share');
    tabBrowse.classList.toggle('on', t === 'browse');
    body.replaceChildren(t === 'share' ? share : browse);
    if (t === 'browse' && (again || !browse.childNodes.length)) openDirectory();
  }
  tabShare.onclick = () => showTab('share');
  tabBrowse.onclick = () => showTab('browse');
  pill.onclick = () => app.setOpen(!app.settings.open);
  showTab('share');

  function render() {
    const { settings } = app;
    const st = app.uploader.stats();
    const live = Object.keys(toggles).some(app.sharing);
    dot.classList.toggle('live', live);
    pillText.textContent = live ? 'Sharing' : 'Feeds';
    pill.title = live ? 'Your feed is being shared' : 'Not sharing';
    box.style.display = settings.open ? '' : 'none';
    if (settings.open) wrap.classList.toggle('dark', isDark(win, doc));

    feedInfo.replaceChildren();
    if (settings.feed) {
      const url = app.publicUrl(settings.feed.id);
      const top = el(doc, 'div', 'xfs-row');
      const rename = el(doc, 'button', 'xfs-btn', 'Rename');
      rename.onclick = () => app.renameFeed();
      top.append(el(doc, 'span', 'xfs-muted', 'Public feed:'), el(doc, 'span', 'xfs-label', settings.feed.label), rename);
      const linkRow = el(doc, 'div', 'xfs-row');
      const a = el(doc, 'a', 'url', url);
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      const copy = el(doc, 'button', 'xfs-btn', 'Copy link');
      copy.onclick = () => win.navigator.clipboard.writeText(url).then(() => { copy.textContent = 'Copied'; }, () => {});
      linkRow.append(a, copy);
      feedInfo.append(top, linkRow);
    } else {
      feedInfo.append(el(doc, 'div', 'xfs-muted', "You aren't sharing. Tick a box to create a public feed."));
    }
    for (const [kind] of KIND_ORDER) {
      toggles[kind].input.checked = app.sharing(kind);
      toggles[kind].stat.textContent = app.sharing(kind)
        ? `${st[kind].shared} shared from this tab · ${st[kind].queued} waiting` : '';
    }
    seenLine.textContent = `Seen in this tab: ${app.seen.following.size} Following · ${app.seen.foryou.size} For You`;
    errLine.textContent = app.message || (st.error ? `Upload problem: ${st.error}` : '') +
      (st.pausedUntil ? ` (retrying after ${new Date(st.pausedUntil).toLocaleTimeString()})` : '');
    flushBtn.disabled = !live;
    delBtn.style.display = settings.feed ? '' : 'none';
  }

  return { render };
}
