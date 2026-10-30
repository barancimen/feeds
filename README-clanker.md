# feeds

Share your X home feed (For You and/or Following) publicly, and browse feeds other people share — in a
panel on x.com, or on a public web page that needs nothing installed.

- **Widget**: one core, shipped as a userscript (Tampermonkey / Violentmonkey) and a Chrome MV3 extension.
- **Backend**: one Cloudflare Worker + D1. Public reads, token-authenticated writes, 14-day retention.

**Live:** https://gestaltschaft.com/feeds. Install the userscript from
[`/feeds/x-feed-share.user.js`](https://gestaltschaft.com/feeds/x-feed-share.user.js).
Redeploy with `npm run deploy`, which builds against the live URL.

The Worker owns only `gestaltschaft.com/feeds` and `/feeds/*` (two routes); the rest of gestaltschaft.com is a
different Worker on a Custom Domain, and the path routes take precedence on their paths. The old
`x-feed-share.barancimen321321.workers.dev` address redirects its pages to the new URL but still answers the API
and the userscript, so copies installed before the move keep working and update themselves.

## How it works

1. The widget wraps `fetch`/`XMLHttpRequest` in the page and reads the `HomeTimeline` (For You) and
   `HomeLatestTimeline` (Following) GraphQL responses that x.com already loads. It never makes its own
   requests to X; only posts you scroll past are seen.
2. **Every X account is asked first.** The widget tells accounts apart by X's `twid` cookie (the signed-in
   user's ID), read as each timeline request starts, so a response is credited to the account that loaded it even
   if the user switches accounts meanwhile. The first time an account shows up, "Share @handle's feeds?" pops up
   under the Feeds button; nothing from that account is uploaded unless the answer is yes. On yes, the widget creates
   a public feed named after that @handle (names can't be changed) with its own secret publish token, kept on the
   privileged side (GM storage / the extension's background worker). Answers are remembered per account, so
   switching back and forth never asks again or mixes feeds. A tab left open while switching accounts in another
   tab keeps crediting posts by cookie; a brand-new account there asks for a reload first, because the page still
   shows the old account's handle.
3. **Pausing.** Clicking "Feeds" pauses or resumes every account; the "@handle" button next to it switches just
   the signed-in account, and the global switch leaves each account's own switch as it is. Both are remembered,
   apply to every open tab at once, and posts seen while paused are never uploaded later. Each switch has a thin
   glowing outline, green when on and red when paused (the account's is also red until it is set up). A green
   dot on Feeds means posts are being shared right now; it only turns invisible, so nothing moves. The small ▾
   on Feeds opens the panel. "Share my Following feed" and "Share my For You feed" start ticked; unticking one
   stops that feed. Deleting a feed switches its account off and deletes its publish key; switching the account
   back on asks again and makes a new feed.
   Posts upload continuously as you scroll: about 1.5 s after each page of posts arrives, at most one upload
   every 4 s per feed (the server allows 20 a minute), in feed order. Records are small (text, author
   handle/name/avatar, media thumbnails, quoted/retweeted post). Ads and posts by protected accounts are never captured.
   **Duplicates:** each tab queues a post once per feed kind; the server keeps one entry per feed, kind and post
   ID (first sighting wins, so a post that resurfaces later isn't repeated) and stores identical content once.
   The same post can legitimately appear in both Following and For You.
   **Upgrading from 0.1.x:** the old single feed is given to the account it was named after (or verified as);
   another account can claim it from its "Share?" prompt instead.
4. **Updates.** The userscript checks `GET /api/version` at most every 6 hours and, when a newer version is out,
   shows "Update available" under the Feeds button; "Update now" opens the userscript URL so Tampermonkey or
   Violentmonkey can install it, "Later" hides it for a day.
5. Anyone can browse: the panel's **Browse** tab, or `https://gestaltschaft.com/feeds` and `…/feeds/f/<feed-id>`.
6. Anyone can search: posts across every shared feed (text, retweeted/quoted text, author names and
   handles) or within one feed, and feeds by name (`…/feeds/?q=…`). The UI always says whether a search covers all feeds or one. Each result says which
   feeds it was seen in. Results are per stored copy, so an altered copy is only ever attributed to the
   feed that uploaded it.

## Verifying who publishes a feed

Publishers can prove they control an X account, which puts "✓ @handle" on their feed:

1. **Verify it's you** asks the Worker for a one-time code (valid 30 min) and opens X's own composer through
   a Web Intent (`x.com/intent/post?text=…`) with "Verifying that I publish my X Feed Share feed. Code: …"
   filled in. The user reviews it and clicks Post. Nothing is posted for them.
2. The widget sees the response x.com already received for that post (the same passive hook as feed capture)
   and sends only the post ID. If the post was made elsewhere, the user can paste its link instead.
3. The Worker makes one request to X's public oEmbed endpoint (`publish.x.com/oembed`), asking for the post by
   ID only. X reports the real author. The Worker checks that the code is in the post's text and that the post
   is newer than the code (post IDs encode their creation time).

The user's X session is never used to make requests, so there's nothing for X's automation checks to see.
The text has no link, because many accounts posting identical text with one URL looks like spam. One verified
feed per account: verifying another feed moves the badge. Verification proves who publishes a feed, not that
its posts are really their timeline. Posts from protected accounts can't be checked through oEmbed.

## API

| Route | |
|---|---|
| `GET /api/feeds?q=&before=&limit=` | Recently active feeds, newest first; `q` filters by name, `before` is the `next` cursor |
| `GET /api/feeds/:id?kind=&before=&limit=` | One feed's entries, newest session first |
| `GET /api/search?q=&feed=&kind=&offset=&limit=` | Full-text post search (words AND-ed, last word is a prefix) |
| `POST /api/feeds` · `POST /api/feeds/:id/items` · `DELETE /api/feeds/:id` | Create, upload (Bearer token), delete |
| `POST /api/feeds/:id/verify` · `POST /api/feeds/:id/verify/check {tweet_id}` | Get a one-time code; check the post containing it (Bearer token) |
| `GET /api/version` | Version of the published userscript (for the update notice) |
| `GET /privacy` | Privacy policy (linked from the Chrome Web Store listing) |

## Deploy

```sh
npm install
cd worker
npx wrangler d1 create xfeeds                   # paste the database_id into wrangler.toml
npx wrangler d1 execute xfeeds --remote --file schema.sql
cd ..
npm run deploy                                   # = node build.mjs --api https://gestaltschaft.com/feeds && wrangler deploy
```

The API base URL (which may include a path, like `/feeds`) is baked into the builds (`@connect`/`@updateURL` in the userscript, `host_permissions` in the
manifest), so rebuild with `--api` before deploying.

## Install

- **Userscript**: open `https://gestaltschaft.com/feeds/x-feed-share.user.js` with Tampermonkey or Violentmonkey installed
  (or install `dist/x-feed-share.user.js`). It must run in the page context: in Violentmonkey keep
  "inject-into page" (set in the header); Tampermonkey on Chrome needs "Allow User Scripts" enabled.
- **Chrome extension**: `chrome://extensions` → Developer mode → Load unpacked → `dist/extension`.

## Chrome Web Store

The extension is listed as **feeds** (the userscript keeps its own name). Listing text, dashboard answers
and images are in `extension/store/` (`LISTING.md`); the privacy policy is served at
`gestaltschaft.com/feeds/privacy` from `worker/src/privacy.js`, so keep it in step with the code.

- `node build.mjs --api https://gestaltschaft.com/feeds` also writes `dist/feeds-extension-<version>.zip`.
  Build with that `--api`: the default is localhost.
  Copy each zip you submit to `releases/` and commit it (`dist/` is not in git).
- First release: register at the developer dashboard ($5 once), create the item by uploading the zip, fill in
  the listing from `LISTING.md`, and submit. Note the item ID and the publisher ID (Publisher → Settings).
- Later releases: bump `package.json`'s version (the store refuses an equal or lower one), then
  `node scripts/publish-extension.mjs` builds, uploads and submits for review (`--upload-only` leaves a draft).
  It needs `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and
  `CWS_REFRESH_TOKEN`: create an OAuth client (Desktop app) in a Google Cloud project with the Chrome Web
  Store API enabled, then get a refresh token for the `https://www.googleapis.com/auth/chromewebstore` scope
  with the account that owns the item (e.g. via the OAuth 2.0 Playground with your own client credentials).
  That account needs 2-step verification. Installed copies update themselves within hours of approval.

## Develop and test

```sh
npm test                    # unit tests: parsing, capture hooks, uploader, rendering/XSS, token handling
node build.mjs && npm run test:worker   # Worker end-to-end against wrangler dev --local and a throwaway D1
npm run dev:worker          # local backend on http://localhost:8787 (the default build target)
```

For local dev, apply the schema once with `cd worker && npx wrangler d1 execute xfeeds --local --file schema.sql`.

## Layout

```
core/        shared by both widgets (and render/browse by the public page)
  capture.js   fetch/XHR hooks          parse.js   GraphQL -> records (ads/protected skipped)
  account.js   signed-in account, per-account settings     update.js  update notice
  safe.js      validation + URL allowlist, used by client, renderer and Worker
  uploader.js  ordered, batched, retrying uploads     api.js / host.js   backend client / token owner
  render.js    tweet cards (DOM API only)             browse.js  directory + feed views
  panel.js     the on-x.com panel                     app.js     wires it all together
userscript/  GM_xmlhttpRequest wrapper
extension/   MV3: MAIN-world main.js <-> bridge.js <-> background.js; icons/, store/ (Web Store listing)
scripts/     publish-extension.mjs (Chrome Web Store upload + submit)
worker/      src/index.js (API, public page, cron GC), schema.sql, viewer/ (public page script)
build.mjs    esbuild -> dist/x-feed-share.user.js, dist/extension/ (+ zip), worker/src/*.gen.js
```

## Trust model and limits

- Feed names are self-described unless the feed carries a ✓ @handle (see above); content is shown as the publisher uploaded it. Every post
  links to the original on X. Tweets are stored per content hash, so a publisher can only affect their own
  copy of a post, never what another feed shows.
- Everything from the server is re-validated before rendering and built with `textContent`; images load only
  from `pbs.twimg.com`/`abs.twimg.com`. The public page sends a strict CSP.
- Limits: 2 feed creations/min per IP, 30 searches/min per IP, 20 uploads/min and 5,000 posts/day per feed,
  100 posts per upload, newest 1,000 entries per feed and kind, 14-day expiry (daily cron). A search looks
  at the 2,000 newest matching copies, which bounds its cost.
- Not yet: an opt-out list for authors, list timelines.
  If feed creation gets abused, put Turnstile in front of `POST /api/feeds`.
