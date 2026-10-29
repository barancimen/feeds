// The on-x.com widget (closed Shadow DOM), top-right: a switch for the signed-in account, and the Feeds
// button, which is the switch for every account plus a ▾ that opens the Share / Browse panel. Outlines are
// green when on and red when paused; Feeds shows a green dot while posts are being shared. Questions and the
// update notice pop up under the button.

import { renderDirectory, renderFeed, renderSearch } from './browse.js';
import { ago, CSS, el, isolateKeys } from './render.js';

const PANEL_CSS = `
.wrap{position:fixed;right:12px;top:12px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:10px;background:none;
  --on:#00a63e;--on-glow:rgba(0,166,62,.5);--off:#e8131b;--off-glow:rgba(232,19,27,.45)}
.wrap.dark{--on:#2bd968;--on-glow:rgba(43,217,104,.55);--off:#ff4545;--off-glow:rgba(255,69,69,.5);--hover:rgba(255,255,255,.08)}
.bar{display:flex;gap:6px;align-items:center}
/* Same border width in every state, and the dot only turns invisible, so nothing moves when states change. */
.split,.mini{display:flex;align-items:center;height:34px;border-radius:999px;border:1.5px solid var(--off);background:var(--bg);
  box-shadow:0 0 10px 1px var(--off-glow),0 2px 10px rgba(0,0,0,.12)}
.split.on,.mini.on{border-color:var(--on);box-shadow:0 0 10px 1px var(--on-glow),0 2px 10px rgba(0,0,0,.12)}
.split{overflow:hidden}
.split button,.mini{font:inherit;font-weight:700;color:var(--fg);cursor:pointer}
.split button{height:100%;background:none;border:0}
.mini{max-width:130px;font-size:12px;padding:0 11px}
.mini span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.split button:hover,.mini:hover{background:var(--hover)}
.split .main{display:flex;align-items:center;gap:7px;font-size:13px;padding:0 9px 0 11px}
.caret{display:grid;place-items:center;width:26px;padding:0 4px 0 0}
.caret i{width:0;height:0;border-left:4.5px solid transparent;border-right:4.5px solid transparent;border-top:5.5px solid currentColor;
  transition:transform .15s}
.caret[aria-expanded=true] i{transform:rotate(180deg)}
.dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--on);box-shadow:0 0 6px 2px var(--on-glow);visibility:hidden}
.split.live .dot{visibility:visible}
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

// X's theme, from the page background: Default (white), Dim (dark blue) or Lights out (black).
function pageTheme(win, doc) {
  const bg = win.getComputedStyle(doc.body).backgroundColor || '';
  const [r, g, b, a = 1] = (bg.match(/\d+(\.\d+)?/g) || []).map(Number);
  if (r === undefined || a === 0) return { dark: false, bg: null };
  return { dark: 0.2126 * r + 0.7152 * g + 0.0722 * b < 128, bg };
}

// A switch next to Feeds: green outline when on, red when paused.
function miniButton(doc) {
  const b = el(doc, 'button', 'mini');
  const text = el(doc, 'span');
  b.append(text);
  return {
    b,
    set(label, on, pressed, title) {
      text.textContent = label;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(pressed));
      b.title = title;
      b.setAttribute('aria-label', title);
    },
  };
}

// Short status for the Feeds button's tooltip.
function describe(v) {
  const who = v.handle ? '@' + v.handle : 'this account';
  const btn = `“${v.handle ? who : 'Account'}”`;
  return {
    'signed-out': 'Sign in to X to share your feed.',
    loading: 'Checking which X account is signed in…',
    stale: 'This tab still shows the X account you had before switching. Reload the page.',
    'paused-all': 'All uploads are paused, for every account.',
    new: `${who} isn’t set up yet. Choose in the box under the Feeds button.`,
    off: `${who} isn’t shared. Click ${btn} next to Feeds to share it.`,
    paused: `Uploads for ${who} are paused. Click ${btn} next to Feeds to resume.`,
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
  // Feeds: the switch for every account, and ▾ for the menu
  const split = el(doc, 'div', 'split');
  const main = el(doc, 'button', 'main');
  main.append(el(doc, 'span', 'dot'), doc.createTextNode('Feeds'));
  main.onclick = () => app.togglePauseAll();
  const caret = el(doc, 'button', 'caret');
  caret.append(el(doc, 'i'));
  caret.title = 'Menu';
  caret.setAttribute('aria-label', 'Feeds menu');
  caret.onclick = () => app.setOpen(!app.settings.open);
  split.append(main, caret);
  const acctBtn = miniButton(doc);
  acctBtn.b.onclick = () => app.togglePauseAccount();
  const bar = el(doc, 'div', 'bar');
  bar.append(acctBtn.b, split); // top-right corner, clear of X's Grok and Messages buttons

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
    'Every X account asks before its first upload, and has its own feed. Ads and posts from protected accounts are never ' +
    'shared. Shared entries expire after 14 days.'));

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
  showTab('share');

  function render() {
    const { settings } = app;
    const v = app.view();
    const a = v.acct;
    const st = v.stats;
    const who = v.handle ? '@' + v.handle : 'this account';
    const show = (e, on) => { e.style.display = on ? '' : 'none'; };
    const theme = pageTheme(win, doc);
    wrap.classList.toggle('dark', theme.dark);
    if (theme.dark) wrap.style.setProperty('--bg', theme.bg); // match Dim's blue as well as Lights out's black
    else wrap.style.removeProperty('--bg');
    wrap.style.visibility = app.ready ? '' : 'hidden'; // no red flash before the settings have loaded

    // Bar
    const status = describe(v);
    split.classList.toggle('on', !settings.paused);
    split.classList.toggle('live', v.status === 'active');
    const mainTitle = `${status} ${settings.paused
      ? 'Click to resume (accounts you paused yourself stay paused).'
      : 'Click to pause uploads for every account (each account keeps its own switch).'}`;
    main.title = mainTitle;
    main.setAttribute('aria-label', `Feeds: ${mainTitle}`);
    main.setAttribute('aria-pressed', String(settings.paused));
    caret.setAttribute('aria-expanded', String(!!settings.open));
    show(acctBtn.b, v.uid);
    acctBtn.set(v.handle ? '@' + v.handle : 'Account', !!a && !a.paused, !!a?.paused,
      !a ? `${who} isn’t set up. Click to choose whether to share it.`
        : a.paused ? `${who} is paused. Click to resume its uploads.`
          : `${who} is on. Click to pause its uploads (remembered for this account).`);

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
