// The on-x.com widget: a pill in the corner that opens a Share / Browse panel (closed Shadow DOM).

import { renderDirectory, renderFeed, renderSearch } from './browse.js';
import { ago, CSS, el, isolateKeys } from './render.js';

const PANEL_CSS = `
.wrap{position:fixed;right:12px;top:12px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:8px;background:none}
.pill{display:flex;gap:6px;align-items:center;font:inherit;font-weight:700;font-size:13px;padding:8px 14px;border-radius:999px;
  border:1px solid var(--edge);background:var(--bg);color:var(--fg);cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.18)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--muted)}
.dot.live{background:var(--danger)}
.box{width:400px;max-width:calc(100vw - 24px);max-height:min(calc(100vh - 72px),720px);display:flex;flex-direction:column;background:var(--bg);
  border:1px solid var(--edge);border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.22);overflow:hidden}
.tabs{display:flex;border-bottom:1px solid var(--line)}
.tab{flex:1;padding:10px;background:none;border:0;border-bottom:2px solid transparent;font:inherit;font-weight:700;color:var(--muted);cursor:pointer}
.tab.on{color:var(--fg);border-bottom-color:var(--accent)}
.body{overflow-y:auto;flex:1;min-height:120px}
.share{padding:12px 14px;display:grid;gap:12px}
.toggle{display:flex;gap:10px;align-items:flex-start;cursor:pointer}
.toggle input{margin-top:3px;accent-color:var(--accent)}
.err{color:var(--danger);font-size:13px;font-weight:600}
.err:empty{display:none}
.notice{font-size:13px;font-weight:600;padding:8px 10px;border-radius:8px;background:var(--hover);border-left:3px solid var(--accent)}
.notice:empty{display:none}
.url{font-size:13px;overflow-wrap:anywhere}
.feedinfo{display:grid;gap:8px}
.pending{display:grid;gap:8px;padding:10px;border:1px solid var(--line);border-radius:12px}
.code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:8px;border-radius:8px;background:var(--hover);overflow-wrap:anywhere;user-select:all}
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
  wrap.append(pill, box); // top-right corner, clear of X's Grok and Messages buttons
  root.append(style, wrap);
  doc.body.append(host);

  // Share tab
  const share = el(doc, 'div', 'share');
  // Built once; render() only updates text and visibility, so an input keeps what the user typed.
  const feedInfo = el(doc, 'div', 'feedinfo');
  const noFeed = el(doc, 'div', 'xfs-muted');
  const feedRow = el(doc, 'div', 'xfs-row');
  const feedLabel = el(doc, 'span', 'xfs-label');
  const renameBtn = el(doc, 'button', 'xfs-btn', 'Rename');
  renameBtn.onclick = () => app.renameFeed();
  feedRow.append(el(doc, 'span', 'xfs-muted', 'Public feed:'), feedLabel, renameBtn);
  const linkRow = el(doc, 'div', 'xfs-row');
  const feedLink = el(doc, 'a', 'url');
  feedLink.target = '_blank';
  feedLink.rel = 'noopener';
  const copyBtn = el(doc, 'button', 'xfs-btn', 'Copy link');
  copyBtn.onclick = () => win.navigator.clipboard.writeText(feedLink.href).then(() => { copyBtn.textContent = 'Copied'; }, () => {});
  linkRow.append(feedLink, copyBtn);

  // Verification
  const verifiedLine = el(doc, 'div', 'xfs-badge');
  const verifyRow = el(doc, 'div', 'xfs-row');
  const verifyBtn = el(doc, 'button', 'xfs-btn');
  verifyBtn.onclick = () => app.startVerify();
  const verifyHint = el(doc, 'span', 'xfs-muted xfs-small');
  verifyRow.append(verifyBtn, verifyHint);
  const pending = el(doc, 'div', 'pending');
  const pendingText = el(doc, 'div', 'code');
  const pendingBtns = el(doc, 'div', 'xfs-row');
  const reopenBtn = el(doc, 'button', 'xfs-btn', 'Open composer again');
  reopenBtn.onclick = () => app.openComposer();
  const cancelBtn = el(doc, 'button', 'xfs-btn', 'Cancel');
  cancelBtn.onclick = () => app.cancelVerify();
  pendingBtns.append(reopenBtn, cancelBtn);
  const pasteForm = el(doc, 'form', 'xfs-search');
  const pasteInput = el(doc, 'input');
  pasteInput.placeholder = 'Posted it elsewhere? Paste the link';
  pasteInput.maxLength = 300;
  isolateKeys(pasteInput);
  const pasteBtn = el(doc, 'button', 'xfs-btn', 'Check');
  pasteBtn.type = 'submit';
  pasteForm.append(pasteInput, pasteBtn);
  pasteForm.addEventListener('submit', e => { e.preventDefault(); app.checkVerifyLink(pasteInput.value); });
  pending.append(el(doc, 'div', 'xfs-small',
    'Post this from your X account. A composer opened in a new tab: check the text and click Post. You can delete the post once verified.'),
  pendingText, pendingBtns, pasteForm);

  feedInfo.append(noFeed, feedRow, linkRow, verifiedLine, verifyRow, pending);
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
  const noticeLine = el(doc, 'div', 'notice');
  const errLine = el(doc, 'div', 'err');
  const btnRow = el(doc, 'div', 'xfs-row');
  const flushBtn = el(doc, 'button', 'xfs-btn', 'Upload now');
  flushBtn.onclick = () => app.flushNow();
  const delBtn = el(doc, 'button', 'xfs-btn', 'Delete my feed');
  delBtn.onclick = () => app.deleteFeed();
  btnRow.append(flushBtn, delBtn);
  share.append(seenLine, noticeLine, errLine, btnRow, el(doc, 'div', 'xfs-muted xfs-small',
    'Both boxes start ticked: the Home posts you scroll past upload as you scroll. Untick a box to stop sharing that feed. ' +
    'Ads and posts from protected accounts are never shared. Shared entries expire after 14 days.'));

  // Browse tab
  const browse = el(doc, 'div');
  const nav = {
    home: () => { body.scrollTop = 0; return renderDirectory(doc, browse, app.api, nav); },
    openFeed: (id, kind) => {
      body.scrollTop = 0;
      return renderFeed(doc, browse, app.api, id,
        { kind, back: nav.home, shareUrl: app.publicUrl(id), onSearch: (q, label) => nav.search(q, id, label) });
    },
    search: (q, feed, feedLabel) => { body.scrollTop = 0; return renderSearch(doc, browse, app.api, q, nav, { feed, feedLabel }); },
  };
  const openDirectory = nav.home;

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

    const f = settings.feed;
    const show = (e, on) => { e.style.display = on ? '' : 'none'; };
    show(noFeed, !f);
    if (!f) {
      noFeed.textContent = app.creating ? 'Creating your public feed…'
        : Object.values(settings.share).some(Boolean) ? 'Sharing starts when your Home timeline loads.'
          : "You aren't sharing. Tick a box to share your feed publicly.";
    }
    show(feedRow, f);
    show(linkRow, f);
    if (f) {
      feedLabel.textContent = f.label;
      const url = app.publicUrl(f.id);
      if (feedLink.textContent !== url) { feedLink.textContent = url; feedLink.href = url; copyBtn.textContent = 'Copy link'; }
    }
    const verified = f?.verified;
    const isPending = !!(f && settings.verify && settings.verify.until > Date.now());
    show(verifiedLine, verified);
    if (verified) verifiedLine.textContent = `✓ Verified as @${verified.handle}`;
    show(verifyRow, f && !isPending);
    verifyBtn.textContent = verified ? 'Verify again' : 'Verify it’s you';
    verifyHint.textContent = verified ? '' : 'Puts a ✓ and your X handle on your feed.';
    show(pending, isPending);
    if (isPending) pendingText.textContent = settings.verify.text;
    for (const [kind] of KIND_ORDER) {
      toggles[kind].input.checked = !!settings.share[kind];
      toggles[kind].stat.textContent = app.sharing(kind)
        ? `${st[kind].shared} shared from this tab · ${st[kind].queued} waiting` : '';
    }
    seenLine.textContent = `Seen in this tab: ${app.seen.following.size} Following · ${app.seen.foryou.size} For You` +
      (live && st.lastOk ? ` · last upload ${ago(st.lastOk)}` : '');
    noticeLine.textContent = app.notice || '';
    errLine.textContent = app.message || (st.error ? `Upload problem: ${st.error}` : '') +
      (st.pausedUntil ? ` (retrying after ${new Date(st.pausedUntil).toLocaleTimeString()})` : '');
    flushBtn.disabled = !live;
    delBtn.style.display = settings.feed ? '' : 'none';
  }

  return { render };
}
