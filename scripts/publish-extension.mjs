// Builds the extension for gestaltschaft.com/feeds and submits it to the Chrome Web Store (API v2).
// The store item must already exist: the first upload is done by hand in the developer dashboard.
// Usage: node scripts/publish-extension.mjs [--upload-only]
//   --upload-only  upload the package as a draft; submit it for review yourself in the dashboard.
// Env: CWS_PUBLISHER_ID, CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN
// (an OAuth client with the https://www.googleapis.com/auth/chromewebstore scope; see README.clank.md).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';

const API = 'https://gestaltschaft.com/feeds';
const STORE = 'https://chromewebstore.googleapis.com';
const env = Object.fromEntries(['CWS_PUBLISHER_ID', 'CWS_EXTENSION_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN']
  .map(k => [k, process.env[k] || fail(`${k} is not set`)]));
const item = `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`;

function fail(msg) { console.error(msg); process.exit(1); }

async function call(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) fail(`${init.method} ${url.replace(STORE, '')}: ${res.status} ${JSON.stringify(data?.error ?? data)}`);
  return data;
}

execFileSync('node', ['build.mjs', '--api', API], { stdio: 'inherit' });
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'));
const zip = await fs.readFile(`dist/feeds-extension-${version}.zip`);

const { access_token } = await call('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({
    client_id: env.CWS_CLIENT_ID, client_secret: env.CWS_CLIENT_SECRET,
    refresh_token: env.CWS_REFRESH_TOKEN, grant_type: 'refresh_token',
  }),
});
const auth = { Authorization: `Bearer ${access_token}` };

// The store refuses a package whose version isn't higher than the last one: bump package.json first.
let up = await call(`${STORE}/upload/v2/${item}:upload`, {
  method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: zip,
});
let state = up.uploadState;
for (let i = 0; i < 60 && /IN_PROGRESS/.test(state); i++) {
  await new Promise(r => setTimeout(r, 3000));
  state = (await call(`${STORE}/v2/${item}:fetchStatus`, { method: 'GET', headers: auth })).lastAsyncUploadState;
}
if (state !== 'SUCCEEDED') fail(`upload of ${version} ended as ${state}`);
console.log(`uploaded ${version}`);

if (process.argv.includes('--upload-only')) {
  console.log('not submitted: submit it for review in the developer dashboard');
} else {
  const pub = await call(`${STORE}/v2/${item}:publish`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}',
  });
  console.log(`submitted ${version} for review: ${pub.state}`);
  if (pub.warningInfo) console.log(`warnings: ${JSON.stringify(pub.warningInfo)}`);
}
