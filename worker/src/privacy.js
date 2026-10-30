// The privacy policy at <base>/privacy, linked from the Chrome Web Store listing. Static apart from `base`
// ('' or '/feeds', never user input). Keep it in step with what the code does.

const UPDATED = '29 October 2026';
const REPO = 'https://github.com/barancimen/feeds';
// GitHub's mark (Octicons mark-github, 16x16), as on the other pages.
const GITHUB_MARK = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 ' +
  '0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82' +
  '-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 ' +
  '2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38' +
  '.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 ' +
  '3.58-8 8-8Z';

export const privacyHtml = base => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>feeds privacy policy</title>
<style>
:root{--bg:#fff;--fg:#0f1419;--muted:#536471;--line:#eff3f4;--accent:#1d9bf0}
@media (prefers-color-scheme: dark){:root{--bg:#000;--fg:#e7e9ea;--muted:#71767b;--line:#2f3336;--accent:#1d9bf0}}
html{overflow-y:scroll}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:600px;margin:0 auto;padding:16px 16px 72px;border-left:1px solid var(--line);border-right:1px solid var(--line);min-height:100vh;box-sizing:border-box}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:17px;margin:24px 0 6px}
p,ul{margin:0 0 10px}
ul{padding-left:20px}
li{margin:3px 0}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.muted{color:var(--muted);font-size:14px}
a.gh{position:fixed;right:16px;bottom:16px;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--bg);color:var(--muted)}
a.gh:hover{color:var(--fg)}
a.gh svg{width:24px;height:24px;fill:currentColor}
</style>
</head>
<body>
<main>
<p><a href="${base || '/'}">← Shared X feeds</a></p>
<h1>Privacy policy</h1>
<p class="muted">For the feeds browser extension, the X Feed Share userscript and this website. Last updated ${UPDATED}.</p>

<p>The point of feeds is to make the posts you see on your X home timeline public, so other people can see what
X shows you. Nothing is shared until you say yes for an X account, and you can stop or delete it at any time.
This page explains exactly what that involves.</p>

<h2>What is collected and published</h2>
<p>Only after you choose “Share” for an X account, and only while sharing is switched on for it:</p>
<ul>
<li><b>Posts from your X home timeline</b> (For You and Following, whichever you turn on) as you scroll past them:
the post’s text, links, image and video thumbnail addresses, time, and the author’s name, @handle and profile
picture address, plus quoted or reposted posts. The order you saw them in is kept.</li>
<li><b>Your @handle</b>, as the name of your feed.</li>
<li><b>If you verify your feed</b>: the post you made with the verification code, which is checked once through
X’s public embed service, and then your verified @handle on the feed.</li>
</ul>
<p>All of this is <b>published</b> at gestaltschaft.com/feeds for anyone to read and search. That is what the
extension is for.</p>
<p>Never collected: ads, posts from protected accounts, your messages, notifications, likes, searches on X,
other pages you visit, your password or your X login. The extension reads the timeline data x.com already
loads in the tab, plus which account is signed in, and nothing else.</p>

<h2>What stays on your computer</h2>
<p>Your choices for each X account (shared or not, paused or not, which feeds), and the account’s numeric X ID
and @handle so it can tell your accounts apart. Each feed also has a secret key that lets only your browser add
to it or delete it. These are kept in the extension’s own storage (or the userscript manager’s) and are not
sent anywhere, except that the secret key is sent to gestaltschaft.com to prove an upload is yours.</p>

<h2>How long it is kept</h2>
<ul>
<li>Each shared post is removed after 14 days, and a feed keeps at most its newest 1000 posts per timeline.</li>
<li>“Delete my feed” removes the feed and its posts at once. You can also uninstall the extension; anything
already shared then expires within 14 days.</li>
<li>Pausing an account stops uploads straight away. Posts seen while paused are never uploaded later.</li>
</ul>

<h2>Who else is involved</h2>
<ul>
<li>The website and its database run on <b>Cloudflare</b>. Cloudflare handles your IP address to deliver the
site; feeds uses it only to rate-limit new feeds and searches, and does not store it. Pages on gestaltschaft.com
may include Cloudflare Web Analytics, which counts visits without cookies.</li>
<li>Pictures in feeds are loaded straight from <b>X</b>’s image servers, so X can see that your browser
loaded them.</li>
</ul>
<p>The data is not sold, not used for advertising or credit decisions, not shared with anyone else, and not
used for anything except showing the feeds.</p>

<h2>The posts of other people</h2>
<p>Shared feeds contain other people’s public posts, as they appeared on X. Protected accounts are never
included. If a post of yours appears in a feed and you want it removed, open an issue on
<a href="${REPO}/issues" rel="noopener noreferrer">GitHub</a>; it will also expire on its own within 14 days.</p>

<h2>Contact and changes</h2>
<p>The code is open source at <a href="${REPO}" rel="noopener noreferrer">github.com/barancimen/feeds</a>.
Questions or requests go to its <a href="${REPO}/issues" rel="noopener noreferrer">issues page</a>.
Changes to this policy are published here, with a new date at the top.</p>
</main>
<a class="gh" href="${REPO}" rel="noopener noreferrer" aria-label="Source code on GitHub"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="${GITHUB_MARK}"/></svg></a>
</body>
</html>`;
