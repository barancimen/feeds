// Public read-only viewer served by the Worker at <base>/, <base>/?q=<search> and <base>/f/<id>,
// where <base> is /feeds on gestaltschaft.com (from the page's data-base attribute).

import { createApi } from '../../core/api.js';
import { renderDirectory, renderFeed, renderSearch } from '../../core/browse.js';
import { CSS, el } from '../../core/render.js';

const app = document.getElementById('app');
const BASE = app.dataset.base === '/feeds' ? '/feeds' : '';
const HOME = BASE || '/';
const REPO = 'https://github.com/barancimen/feeds';
// GitHub's mark (Octicons mark-github, 16x16).
const GITHUB_MARK = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 ' +
  '0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82' +
  '-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 ' +
  '2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38' +
  '.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 ' +
  '3.58-8 8-8Z';

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
.install summary{cursor:pointer;font-size:13px;color:var(--muted)}
.install details[open]{display:grid;gap:8px}
.page{padding-bottom:64px}
a.gh{position:fixed;right:16px;bottom:16px;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;
  background:var(--bg);color:var(--muted)}
a.gh:hover{color:var(--fg)}
a.gh svg{width:24px;height:24px;fill:currentColor}
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
const intro = el(document, 'div', 'xfs-muted', 'Share your X feed publicly and view feeds shared by others');

// The Chrome extension is the main way to share; the userscript is the alternative, folded away.
const STORE = 'https://chromewebstore.google.com/detail/feeds/fcgmiifgidlkfggblfbabibjmdkamlmi';
const install = el(document, 'section', 'install');
const storeBtn = ext(STORE, 'Get the Chrome extension');
storeBtn.className = 'xfs-btn primary';
const scriptLink = el(document, 'a', null, 'Install the userscript');
scriptLink.href = `${BASE}/x-feed-share.user.js`;
const steps = el(document, 'ol');
const s1 = el(document, 'li', null, 'Install ');
s1.append(ext('https://www.tampermonkey.net/', 'Tampermonkey'), document.createTextNode(' or '),
  ext('https://violentmonkey.github.io/', 'Violentmonkey'), document.createTextNode(' in your browser.'));
const s2 = el(document, 'li');
s2.append(scriptLink, document.createTextNode(', then click Install in the dialog that opens.'));
const s3 = el(document, 'li', null,
  'Chrome only: open Tampermonkey’s extension details (chrome://extensions) and turn on “Allow User Scripts”.');
const s4 = el(document, 'li', null, 'Open x.com/home. Under the “Feeds” button in the top-right corner, choose whether to share that account.');
steps.append(s1, s2, s3, s4);
const how = el(document, 'details', 'alt');
how.append(el(document, 'summary', null, 'Not on Chrome? Use the userscript instead'), steps,
  el(document, 'div', 'xfs-muted xfs-small', 'Use the extension or the userscript, not both.'));
install.append(el(document, 'div', 'install-title', 'Share your own feed'), storeBtn, how);

top.append(h1, intro, install);
const mount = el(document, 'main');
page.append(top, mount);
app.replaceWith(page);

// The source code, in the bottom-right corner of every page.
const gh = el(document, 'a', 'gh');
gh.href = REPO;
gh.target = '_blank';
gh.rel = 'noopener noreferrer';
gh.title = 'Source code on GitHub';
gh.setAttribute('aria-label', 'Source code on GitHub');
const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svg.setAttribute('viewBox', '0 0 16 16');
svg.setAttribute('aria-hidden', 'true');
const mark = document.createElementNS('http://www.w3.org/2000/svg', 'path');
mark.setAttribute('d', GITHUB_MARK);
svg.append(mark);
gh.append(svg);
document.body.append(gh);

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
