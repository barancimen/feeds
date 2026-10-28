// Public read-only viewer served by the Worker at / and /f/<id>.

import { createApi } from '../../core/api.js';
import { renderDirectory, renderFeed } from '../../core/browse.js';
import { CSS, el } from '../../core/render.js';

const api = createApi(async (method, path, body) => {
  const res = await fetch(path, {
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
.top{padding:16px 14px;border-bottom:1px solid var(--line)}
.top h1{font-size:20px;margin:0 0 4px}
.top h1 a{color:var(--fg)}
`;
document.head.append(style);

const dark = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.body.classList.toggle('dark', dark.matches);
document.body.classList.add('xfs');
applyTheme();
dark.addEventListener('change', applyTheme);

const page = el(document, 'div', 'page');
const top = el(document, 'header', 'top');
const h1 = el(document, 'h1');
const home = el(document, 'a', null, 'Shared X Feeds');
home.href = '/';
h1.append(home);
const intro = el(document, 'div', 'xfs-muted xfs-small',
  "What other people's For You and Following timelines look like, shared by them. To share yours, install ");
const install = el(document, 'a', null, 'the userscript');
install.href = '/x-feed-share.user.js';
intro.append(install, document.createTextNode(' (Tampermonkey or Violentmonkey) or the Chrome extension.'));
top.append(h1, intro);
const mount = el(document, 'main');
page.append(top, mount);
document.getElementById('app').replaceWith(page);

function go(path) {
  history.pushState(null, '', path);
  route();
}

home.onclick = e => { e.preventDefault(); go('/'); };

function route() {
  const m = location.pathname.match(/^\/f\/([a-z0-9]{10})$/);
  if (!m) {
    document.title = 'Shared X Feeds';
    renderDirectory(document, mount, api, id => go(`/f/${id}`));
    return;
  }
  const kind = new URLSearchParams(location.search).get('kind');
  renderFeed(document, mount, api, m[1], {
    kind,
    back: () => go('/'),
    onKind: k => history.replaceState(null, '', `/f/${m[1]}?kind=${k}`),
  });
}

addEventListener('popstate', route);
route();
