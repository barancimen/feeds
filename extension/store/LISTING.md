# Chrome Web Store listing for "feeds"

This file gives the text for each field in the developer dashboard:
https://chrome.google.com/webstore/devconsole

To make the package, do this command:
`node build.mjs --api https://gestaltschaft.com/feeds`
The package is `dist/feeds-extension-<version>.zip`. A copy of each released package is in `releases/`.
The images are in this folder.

## Store listing tab

**Name:** feeds (the manifest gives this name.)

**Summary:** The manifest gives this text:
Share your X feed publicly and view feeds shared by others

**Category:** Social & Communication

**Language:** English

**Description:**

```
This extension allows you to share your "For you" and "Following" feeds on X. The shared feeds are served on a public website, viewable and searchable by anyone. 

• The extension does not start uploading data before your approval.
• The extension asks you to approve each X account and remembers the approval states if you rotate between multiple accounts.
• Approvals are revoked when you submit a deletion request by pressing  "Delete my feed," which is processed immediately.
• You can pause and resume sharing feeds per account or for all accounts at once.
• A green button shows that sharing is on. A red button shows that sharing is off.
• The extension does not upload ads and posts from protected accounts.
• The server deletes posts after 14 days.
• You can verify your feed. To do this, you will need to post a code from your X account.

The source code is at https://github.com/barancimen/feeds

This extension is not related to X Corp. X Corp does not approve it.
```

**Graphic assets:**
- Store icon: `../icons/icon128.png`
- Screenshots (1280x800): `screenshot-1-ask.png`, `screenshot-2-browse.png`, `screenshot-3-public.png`
- Small promo tile (440x280): `promo-small-440x280.png`

**Official URL:** https://gestaltschaft.com/feeds

**Support URL:** https://github.com/barancimen/feeds/issues

**Mature content:** No

## Privacy practices tab

**Single purpose:**
```
The extension sends the posts from the user's X Home timeline to a public feed. The user must agree first.
All persons can read the shared feeds.
```

**Permission justifications:**

- **storage:**
  ```
  The extension keeps the choice of the user for each X account: share or do not share, and on or off.
  It also keeps a secret key for each feed. The extension sends this key only to its server, to upload posts.
  ```
- **Host permission (https://gestaltschaft.com/\*):**
  ```
  This is the server of the extension. The extension sends the shared posts to this server.
  The Browse tab gets the shared feeds from this server. The extension does not connect to other servers.
  ```
- **Content scripts on https://x.com/\* and https://twitter.com/\*:**
  ```
  The script shows the buttons and the panel on x.com. It reads the Home timeline data that x.com loads.
  It reads only the For You and Following timelines.
  The script must run in the main world, because the timeline data is not available in the isolated world.
  A second script in the isolated world only sends messages to the background service worker.
  ```

**Remote code:** No. All the code is in the package. The server sends only JSON data.

**Data usage:** Select these two items:
- Personally identifiable information: the X @handle of the user. The extension uses it as the public name of the feed.
- Website content: the posts on the X Home timeline of the user (text, links, image addresses, and authors).

Do not select the other items.

**Certifications:** Select all three. All three are true.
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://gestaltschaft.com/feeds/privacy

## Distribution tab

**Visibility:** Public

**Regions:** All regions

## Test instructions tab

Use this text if the dashboard asks for test instructions:

```
You must have an X account.
1. Open https://x.com/home.
2. Find the "Feeds" button in the top-right corner. Below it, a message asks if you want to share your feeds.
3. Click "Share". The extension does not upload posts before you click "Share".
4. Scroll the Home timeline.
5. Open https://gestaltschaft.com/feeds. Your posts show there in less than one minute.
6. Click the small triangle next to "Feeds" to open the panel. The panel has a Share tab and a Browse tab.
7. Click "Delete my feed" to delete the feed.
You can use the Browse tab without sharing.
```
