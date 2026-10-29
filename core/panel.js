// The on-x.com widget (closed Shadow DOM), top-right: a pause switch for the signed-in account, one for
// every account, and the Feeds button (green while sharing, red otherwise) that opens the Share / Browse
// panel. Questions and the update notice pop up under the button.

import { renderDirectory, renderFeed, renderSearch } from './browse.js';
import { ago, CSS, el, isolateKeys } from './render.js';

const PANEL_CSS = `
.wrap{position:fixed;right:12px;top:12px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:10px;background:none;
  --ok:#0a7d43;--off:#c0111f}
.bar{display:flex;gap:6px;align-items:center}
.pill{font:inherit;font-weight:700;font-size:13px;padding:8px 14px;border-radius:999px;border:0;background:var(--off);color:#fff;
  cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.18)}
.pill.on{background:var(--ok)}
.mini{display:flex;gap:5px;align-items:center;max-width:130px;font:inherit;font-size:12px;font-weight:700;height:30px;padding:0 10px;
  border-radius:999px;border:1px solid var(--edge);background:var(--bg);color:var(--fg);cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.14)}
.mini:hover{background:var(--hover)}
.mini[aria-pressed=true]{background:var(--off);border-color:var(--off);color:#fff}
.mini span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mini svg{flex:none;width:9px;height:10px;fill:currentColor}
.callout{position:relative;width:320px;max-width:calc(100vw - 24px);display:grid;gap:8px;padding:12px 14px;border-radius:14px;
  border:2px solid var(--accent);background:var(--bg);color:var(--fg);box-shadow:0 6px 28px rgba(0,0,0,.28);animation:xfs-pop .25s ease-out}
.callout::before{content:"";position:absolute;top:-9px;right:26px;border:8px solid transparent;border-top:0;border-bottom:9px solid var(--accent)}
.callout-title{font-weight:800;font-size:15px}
.callout .xfs-row{margin-top:2px}
.callout.update{background:var(--accent);color:var(--bg);animation:xfs-pop .25s ease-out,xfs-ring 1.4s ease-out .3s 3}
.callout.update .xfs-btn{background:none;color:var(--bg);border-color:var(--bg)}
.callout.update .xfs-btn.primary{background:var(--bg);color:var(--accent)}
.xfs-btn.primary{background:var(--accent);border-color:var(--accent);color:var(--bg)}
.xfs-btn.primary:hover{filter:brightness(1.1)}
@keyframes xfs-pop{from{opacity:0;transform:translateY(-6px) scale(.97)}}
@keyframes xfs-ring{from{box-shadow:0 0 0 0 var(--accent),0 6px 28px rgba(0,0,0,.28)}to{box-shadow:0 0 0 16px transparent,0 6px 28px rgba(0,0,0,.28)}}
@media (prefers-reduced-motion:reduce){.callout{animation:none!important}}
.box{width:400px;max-width:calc(100vw - 24px);max-height:min(calc(100vh - 72px),720px);display:flex;flex-direction:column;background:var(--bg);
  border:1px solid var(--edge);border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.22);overflow:hidden}
.tabs{display:flex;border-bottom:1px solid var(--line)}
.tab{flex:1;padding:10px;background:none;border:0;border-bottom:2px solid transparent;font:inherit;font-weight:700;color:var(--muted);cursor:pointer}
.tab.on{color:var(--fg);border-bottom-color:var(--accent)}
.body{overflow-y:auto;flex:1;min-height:120px}
.share{padding:12px 14px;display:grid;gap:12px}
.status{font-weight:600}
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
const PAUSE = 'M0 0h3.4v10H0zM5.6 0H9v10H5.6z';
const PLAY = 'M0 0l9 5-9 5z';

function isDark(win, doc) {
  const m = (win.getComputedStyle(doc.body).backgroundColor || '').match(/\d+(\.\d+)?/g);
  if (!m) return false;
  const [r, g, b] = m.map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

function miniButton(doc) {
  const NS = 'http://www.w3.org/2000/svg';
  const b = el(doc, 'button', 'mini');
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 9 10');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(NS, 'path');
  svg.append(path);
  const text = el(doc, 'span');
  b.append(svg, text);
  return {
    b,
    set(label, pressed, paused, title) {
      text.textContent = label;
      path.setAttribute('d', paused ? PLAY : PAUSE);
      b.setAttribute('aria-pressed', String(pressed));
      b.title = title;
      b.setAttribute('aria-label', title);
    },
  };
}

// Short status for the Feeds button's tooltip and the Share tab.
function describe(v) {
  const who = v.handle ? '@' + v.handle : 'this account';
  return {
    'signed-out': 'Sign in to X to share your feed.',
    loading: 'Checking which X account is signed in…',
    stale: 'This tab still shows the X account you had before switching. Reload the page.',
    'paused-all': 'All uploads are paused, for every account. Press ▶ All to resume.',
    new: `${who} isn’t set up yet. Choose in the box under the Feeds button.`,
    off: `${who} isn’t shared. Press ▶ next to the Feeds button to share it.`,
    paused: `Uploads for ${who} are paused. Press ▶ ${v.handle ? who : 'Account'} to resume.`,
    creating: v.creating ? 'Creating your public feed…' : `${who}’s public feed isn’t created yet.`,
    none: `Both boxes are unticked, so nothing from ${who} is shared.`,
    active: `Sharing ${who}: Home posts upload as you scroll.`,
  }[v.status];
}

export function mountPanel(doc, win, app) {
  const host = doc.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  const style = el(doc, 'style');
  style.textContent = CSS + PANEL_CSS;
  const wrap = el(doc, 'div', 'xfs wrap');
  const box = el(doc, 'div', 'box');
  const pill = el(doc, 'button', 'pill', 'Feeds');
  const acctBtn = miniButton(doc);
  acctBtn.b.onclick = () => app.togglePauseAccount();
  const allBtn = miniButton(doc);
  allBtn.b.onclick = () => app.togglePauseAll();
  const bar = el(doc, 'div', 'bar');
  bar.append(acctBtn.b, allBtn.b, pill); // top-right corner, clear of X's Grok and Messages buttons

  // "Share this account?" (also used to say a tab is showing an old account)
  const ask = el(doc, 'div', 'callout');
  const askTitle = el(doc, 'div', 'callout-title');
  const askText = el(doc, 'div', 'xfs-small');
  const askRow = el(doc, 'div', 'xfs-row');
  const yesBtn = el(doc, 'button', 'xfs-btn primary');
  yesBtn.onclick = () => app.decide(true);
  const noBtn = el(doc, 'button', 'xfs-btn');
  noBtn.onclick = () => (app.view().prompt?.again ? app.dismissPrompt() : app.decide(false));
  const reloadBtn = el(doc, 'button', 'xfs-btn primary', 'Reload page');
  reloadBtn.onclick = () => app.reload();
  askRow.append(yesBtn, noBtn, reloadBtn);
  const legacyRow = el(doc, 'div', 'xfs-row xfs-small');
  const legacyText = el(doc, 'span');
  const legacyBtn = el(doc, 'button', 'xfs-btn');
  legacyBtn.onclick = () => app.useLegacy();
  legacyRow.append(legacyText, legacyBtn);
  ask.append(askTitle, askText, askRow, legacyRow);

  // Update notice
  const upd = el(doc, 'div', 'callout update');
  upd.setAttribute('role', 'status');
  const updText = el(doc, 'div', 'xfs-small');
  const updRow = el(doc, 'div', 'xfs-row');
  const updBtn = el(doc, 'button', 'xfs-btn primary');
  updBtn.onclick = () => (app.updateStarted ? app.reload() : app.startUpdate());
  const laterBtn = el(doc, 'button', 'xfs-btn', 'Later');
  laterBtn.onclick = () => app.snoozeUpdate();
  updRow.append(updBtn, laterBtn);
  upd.append(el(doc, 'div', 'callout-title', 'Update available'), updText, updRow);

  const tabShare = el(doc, 'button', 'tab', 'Share');
  const tabBrowse = el(doc, 'button', 'tab', 'Browse');
  const tabs = el(doc, 'div', 'tabs');
  tabs.append(tabShare, tabBrowse);
  const body = el(doc, 'div', 'body');
  box.append(tabs, body);
  wrap.append(bar, ask, upd, box);
  root.append(style, wrap);
  doc.body.append(host);

  // Share tab
  const share = el(doc, 'div', 'share');
  const statusLine = el(doc, 'div', 'status');
  // Built once; render() only updates text and visibility, so an input keeps what the user typed.
  const feedInfo = el(doc, 'div', 'feedinfo');
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

  feedInfo.append(feedRow, linkRow, verifiedLine, verifyRow, pending);
  const toggles = {};
  share.append(statusLine, feedInfo);
  for (const [kind, text] of KIND_ORDER) {
    const label = el(doc, 'label', 'toggle');
    const input = el(doc, 'input');
    input.type = 'checkbox';
    input.onchange = () => app.toggleShare(kind, input.checked);
    const desc = el(doc, 'div');
    const stat = el(doc, 'div', 'xfs-muted xfs-small');
    desc.append(el(doc, 'div', 'xfs-label', text), stat);
    label.append(input, desc);
    toggles[kind] = { label, input, stat };
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
  const othersLine = el(doc, 'div', 'xfs-muted xfs-small');
  share.append(seenLine, noticeLine, errLine, btnRow, othersLine, el(doc, 'div', 'xfs-muted xfs-small',
    'Every X account asks before its first upload, and has its own feed. The ⏸ buttons next to Feeds pause the signed-in ' +
    'account, or all accounts; both stay paused until you press ▶. Ads and posts from protected accounts are never shared. ' +
    'Shared entries expire after 14 days.'));

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
    const v = app.view();
    const a = v.acct;
    const st = v.stats;
    const who = v.handle ? '@' + v.handle : 'this account';
    const show = (e, on) => { e.style.display = on ? '' : 'none'; };
    wrap.classList.toggle('dark', isDark(win, doc));
    wrap.style.visibility = app.ready ? '' : 'hidden'; // no red flash before the settings have loaded

    // Bar
    const status = describe(v);
    pill.classList.toggle('on', v.status === 'active');
    pill.title = status;
    pill.setAttribute('aria-label', `Feeds: ${status}`);
    show(acctBtn.b, v.uid);
    const acctPaused = !a || a.paused;
    acctBtn.set(v.handle ? '@' + v.handle : 'Account', !!a?.paused, acctPaused,
      !a ? `Set up sharing for ${who}` : a.paused ? `Resume uploads for ${who}` : `Pause uploads for ${who} (remembered for this account)`);
    allBtn.set('All', settings.paused, settings.paused, settings.paused
      ? 'Resume uploads (accounts you paused yourself stay paused)'
      : 'Pause uploads for every account (each account keeps its own setting)');

    // Callouts under the button
    const p = v.prompt;
    const stale = v.status === 'stale';
    show(ask, p || stale);
    if (stale) {
      askTitle.textContent = 'You switched X accounts';
      askText.textContent = 'This tab still shows the account you had before. Reload it before sharing anything from the new one.';
    } else if (p) {
      askTitle.textContent = `Share ${who}’s feeds?`;
      askText.textContent = `The Home posts you scroll past (Following and For You) upload to a public feed named “${v.handle ? who : 'anonymous'}”. ` +
        'Each X account is asked once, and your answer is remembered.';
      yesBtn.textContent = `Share ${v.handle ? who : 'this account'}`;
      noBtn.textContent = p.again ? 'Not now' : 'Don’t share';
      legacyText.textContent = `Or keep using your existing feed “${p.legacy}”:`;
      legacyBtn.textContent = `Use it for ${who}`;
    }
    show(yesBtn, !stale);
    show(noBtn, !stale);
    show(reloadBtn, stale);
    show(legacyRow, !stale && p?.legacy);

    const newer = app.update();
    show(upd, newer);
    if (newer) {
      updText.textContent = app.updateStarted
        ? 'Click Install (or Update) in the tab that opened, then reload this page to use the new version.'
        : `Version ${newer} of X Feed Share is out. You have ${app.version}.`;
      updBtn.textContent = app.updateStarted ? 'Reload page' : 'Update now';
    }

    // Panel
    box.style.display = settings.open ? '' : 'none';
    if (!settings.open) return;
    statusLine.textContent = status;
    const f = a?.feed;
    show(feedInfo, f);
    if (f) {
      feedLabel.textContent = f.label;
      const url = app.publicUrl(f.id);
      if (feedLink.textContent !== url) { feedLink.textContent = url; feedLink.href = url; copyBtn.textContent = 'Copy link'; }
      const verified = f.verified;
      const isPending = !!(a.verify && a.verify.until > Date.now());
      show(verifiedLine, verified);
      if (verified) verifiedLine.textContent = `✓ Verified as @${verified.handle}`;
      show(verifyRow, !isPending);
      verifyBtn.textContent = verified ? 'Verify again' : 'Verify it’s you';
      verifyHint.textContent = verified ? '' : 'Puts a ✓ and your X handle on your feed.';
      show(pending, isPending);
      if (isPending) pendingText.textContent = a.verify.text;
    }
    for (const [kind] of KIND_ORDER) {
      show(toggles[kind].label, a);
      toggles[kind].input.checked = !!a?.share[kind];
      toggles[kind].stat.textContent = app.sharing(v.uid, kind)
        ? `${st[kind].shared} shared from this tab · ${st[kind].queued} waiting` : '';
    }
    const live = v.status === 'active';
    seenLine.textContent = v.uid ? `Seen in this tab: ${v.seen.following} Following · ${v.seen.foryou} For You` +
      (live && st.lastOk ? ` · last upload ${ago(st.lastOk)}` : '') : '';
    noticeLine.textContent = app.notice || '';
    errLine.textContent = app.message || (st.error ? `Upload problem: ${st.error}` : '') +
      (st.pausedUntil ? ` (retrying after ${new Date(st.pausedUntil).toLocaleTimeString()})` : '');
    show(flushBtn, live);
    show(delBtn, f);
    show(btnRow, live || f);
    othersLine.textContent = v.others.length
      ? 'Other accounts on this browser: ' + v.others.map(o => `${o.handle ? '@' + o.handle : 'unnamed'} (${o.state})`).join(' · ') : '';
  }

  return { render };
}
