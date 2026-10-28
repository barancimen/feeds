# X Feed Share

Share your X home feed (For You and/or Following) publicly, and browse feeds other people share — in a
panel on x.com, or on a public web page that needs nothing installed.

- **Widget**: one core, shipped as a userscript (Tampermonkey / Violentmonkey) and a Chrome MV3 extension.
- **Backend**: one Cloudflare Worker + D1. Public reads, token-authenticated writes, 14-day retention.

## How it works

1. The widget wraps `fetch`/`XMLHttpRequest` in the page and reads the `HomeTimeline` (For You) and
   `HomeLatestTimeline` (Following) GraphQL responses that x.com already loads. It never makes its own
   requests to X; only posts you scroll past are seen.
2. Nothing is uploaded until you tick "Share my Following/For You feed". The first tick creates a feed and a
   secret publish token, which stays on the privileged side (GM storage / the extension's background worker).
3. Posts are uploaded in order every 30 s as small records (text, author handle/name/avatar, media
   thumbnails, quoted/retweeted post). Ads and posts by protected accounts are never captured.
4. Anyone can browse: the panel's **Browse** tab, or `https://<worker>/` and `https://<worker>/f/<feed-id>`.
5. Anyone can search: posts across every shared feed (text, retweeted/quoted text, author names and
   handles) or within one feed, and feeds by name (`https://<worker>/?q=…`). Each result says which
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
| `POST /api/feeds` · `POST /api/feeds/:id/items` · `PATCH`/`DELETE /api/feeds/:id` | Create, upload (Bearer token), rename, delete |
| `POST /api/feeds/:id/verify` · `POST /api/feeds/:id/verify/check {tweet_id}` | Get a one-time code; check the post containing it (Bearer token) |

## Deploy

```sh
npm install
cd worker
npx wrangler d1 create xfeeds                   # paste the database_id into wrangler.toml
npx wrangler d1 execute xfeeds --remote --file schema.sql
cd ..
node build.mjs --api https://x-feed-share.<your-subdomain>.workers.dev
cd worker && npx wrangler deploy
```

The API origin is baked into the builds (`@connect`/`@updateURL` in the userscript, `host_permissions` in the
manifest), so rebuild with `--api` before deploying.

## Install

- **Userscript**: open `https://<worker>/x-feed-share.user.js` with Tampermonkey or Violentmonkey installed
  (or install `dist/x-feed-share.user.js`). It must run in the page context: in Violentmonkey keep
  "inject-into page" (set in the header); Tampermonkey on Chrome needs "Allow User Scripts" enabled.
- **Chrome extension**: `chrome://extensions` → Developer mode → Load unpacked → `dist/extension`.

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
  safe.js      validation + URL allowlist, used by client, renderer and Worker
  uploader.js  ordered, batched, retrying uploads     api.js / host.js   backend client / token owner
  render.js    tweet cards (DOM API only)             browse.js  directory + feed views
  panel.js     the on-x.com panel                     app.js     wires it all together
userscript/  GM_xmlhttpRequest wrapper
extension/   MV3: MAIN-world main.js <-> bridge.js <-> background.js
worker/      src/index.js (API, public page, cron GC), schema.sql, viewer/ (public page script)
build.mjs    esbuild -> dist/x-feed-share.user.js, dist/extension/, worker/src/*.gen.js
```

## Trust model and limits

- Feed names are self-described unless the feed carries a ✓ @handle (see above); content is shown as the publisher uploaded it. Every post
  links to the original on X. Tweets are stored per content hash, so a publisher can only affect their own
  copy of a post, never what another feed shows.
- Everything from the server is re-validated before rendering and built with `textContent`; images load only
  from `pbs.twimg.com`/`abs.twimg.com`. The public page sends a strict CSP.
- Limits: 2 feed creations/min per IP, 30 searches/min per IP, 10 uploads/min and 5,000 posts/day per feed,
  100 posts per upload, newest 1,000 entries per feed and kind, 14-day expiry (daily cron). A search looks
  at the 2,000 newest matching copies, which bounds its cost.
- Not yet: an opt-out list for authors, list timelines.
  If feed creation gets abused, put Turnstile in front of `POST /api/feeds`.
