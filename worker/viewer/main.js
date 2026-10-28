// Public read-only viewer served by the Worker at <base>/, <base>/?q=<search> and <base>/f/<id>,
// where <base> is /feeds on gestaltschaft.com (from the page's data-base attribute).

import { createApi } from '../../core/api.js';
import { renderDirectory, renderFeed, renderSearch } from '../../core/browse.js';
import { CSS, el } from '../../core/render.js';

const app = document.getElementById('app');
const BASE = app.dataset.base === '/feeds' ? '/feeds' : '';
const HOME = BASE || '/';

const api = createApi(async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* non-JSON error */ }
  return { status: res.status, data };
});

const style = el(document, 'style');
style.textContent = CSS + `
html,body{margin:0}
body.xfs{min-height:100vh}
.page{max-width:600px;margin:0 auto;border-left:1px solid var(--line);border-right:1px solid var(--line);min-height:100vh}
.top{padding:16px 14px;border-bottom:1px solid var(--line);display:grid;gap:12px}
.top h1{font-size:22px;margin:0}
.top h1 a{color:var(--fg)}
.install{display:grid;gap:10px;padding:14px;border:2px solid var(--accent);border-radius:14px;background:var(--hover)}
.install-title{font-size:17px;font-weight:800}
.install .xfs-btn.primary{justify-self:start;font-size:16px;padding:9px 18px;background:var(--accent);border-color:var(--accent);color:var(--bg)}
.install .xfs-btn.primary:hover{text-decoration:none;filter:brightness(1.1)}
.install ol{margin:0;padding-left:20px;display:grid;gap:4px;font-size:14px}
.install summary{cursor:pointer;font-weight:600;font-size:14px}
`;
document.head.append(style);

const dark = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.body.classList.toggle('dark', dark.matches);
document.body.classList.add('xfs');
applyTheme();
dark.addEventListener('change', applyTheme);

function ext(href, text) {
  const a = el(document, 'a', null, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

const page = el(document, 'div', 'page');
const top = el(document, 'header', 'top');
const h1 = el(document, 'h1');
const home = el(document, 'a', null, 'Shared X Feeds');
home.href = HOME;
h1.append(home);
const intro = el(document, 'div', 'xfs-muted',
  "What other people's For You and Following timelines on X look like, shared by them.");

// Make installing the obvious next step.
const install = el(document, 'section', 'install');
const installBtn = el(document, 'a', 'xfs-btn primary', 'Install the userscript');
installBtn.href = `${BASE}/x-feed-share.user.js`;
const steps = el(document, 'ol');
const s1 = el(document, 'li', null, 'Install ');
s1.append(ext('https://www.tampermonkey.net/', 'Tampermonkey'), document.createTextNode(' or '),
  ext('https://violentmonkey.github.io/', 'Violentmonkey'), document.createTextNode(' in your browser.'));
const s2 = el(document, 'li', null, 'Click “Install the userscript” above, then Install in the dialog that opens.');
const s3 = el(document, 'li', null,
  'Chrome only: open Tampermonkey’s extension details (chrome://extensions) and turn on “Allow User Scripts”.');
const s4 = el(document, 'li', null, 'Open x.com/home and click “Feeds” in the top-right corner.');
steps.append(s1, s2, s3, s4);
const how = el(document, 'details');
how.append(el(document, 'summary', null, 'How to install (about 2 minutes)'), steps);
install.append(el(document, 'div', 'install-title', 'Share your own feed'),
  el(document, 'div', null, 'A small script for x.com. Once installed, it shares the Home posts you scroll past (Following and For You). ' +
    'Untick either one in its panel to stop, or delete your feed at any time.'),
  installBtn, how);

top.append(h1, intro, install);
const mount = el(document, 'main');
page.append(top, mount);
app.replaceWith(page);

function go(path, state = null) {
  history.pushState(state, '', path);
  route();
}

const nav = {
  home: () => go(HOME),
  openFeed: (id, kind) => go(`${BASE}/f/${id}${kind ? `?kind=${kind}` : ''}`),
  search: (q, feed, feedLabel) => go(`${BASE}/?${new URLSearchParams(feed ? { q, feed } : { q })}`, { feedLabel }),
};

home.onclick = e => { e.preventDefault(); nav.home(); };

function route() {
  scrollTo(0, 0);
  const params = new URLSearchParams(location.search);
  const path = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) || '/' : location.pathname;
  const m = path.match(/^\/f\/([a-z0-9]{10})$/);
  const q = params.get('q');
  document.title = q ? `“${q}” · Shared X Feeds` : 'Shared X Feeds';
  if (m) {
    renderFeed(document, mount, api, m[1], {
      kind: params.get('kind'),
      back: nav.home,
      onKind: k => history.replaceState(null, '', `${BASE}/f/${m[1]}?kind=${k}`),
      onSearch: (sq, label) => nav.search(sq, m[1], label),
    });
  } else if (q) {
    const feed = params.get('feed');
    renderSearch(document, mount, api, q, nav,
      { feed: /^[a-z0-9]{10}$/.test(feed || '') ? feed : null, feedLabel: history.state?.feedLabel });
  } else {
    renderDirectory(document, mount, api, nav);
  }
}

addEventListener('popstate', route);
route();
