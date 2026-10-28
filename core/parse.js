// Turns X's HomeTimeline / HomeLatestTimeline GraphQL responses into small, shareable records.
// The walk is generic (adapted from x-feed.js) so small layout changes on X's side don't break it.

import { cleanRecord } from './safe.js';

export const FEED_RE = /\/graphql\/[^/]+\/(HomeTimeline|HomeLatestTimeline)(\?|$)/;
export const kindOf = op => (op === 'HomeLatestTimeline' ? 'following' : 'foryou');

function unwrap(r) {
  if (r && r.__typename === 'TweetWithVisibilityResults') r = r.tweet;
  return r && r.legacy && r.rest_id ? r : null; // tombstones and unavailable tweets have no legacy
}

function userOf(r) {
  const u = r.core?.user_results?.result;
  if (!u || !u.rest_id) return null;
  return {
    id: u.rest_id,
    handle: u.core?.screen_name ?? u.legacy?.screen_name ?? null,
    name: u.core?.name ?? u.legacy?.name ?? null,
    avatar: u.avatar?.image_url ?? u.legacy?.profile_image_url_https ?? null,
    protected: !!(u.privacy?.protected ?? u.legacy?.protected),
  };
}

function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Returns null for tweets that must not be shared (protected author, tombstone, missing author).
function toRecord(r, depth) {
  const L = r.legacy;
  const author = userOf(r);
  if (!author || author.protected) return null;
  const note = r.note_tweet?.note_tweet_results?.result;
  const media = L.extended_entities?.media ?? L.entities?.media ?? [];
  const urls = note?.entity_set?.urls ?? L.entities?.urls ?? [];

  let text = note?.text ?? decodeEntities(L.full_text ?? '');
  for (const m of media) if (m.url) text = text.split(m.url).join('');
  for (const u of urls) if (u.url && u.expanded_url) text = text.split(u.url).join(u.expanded_url);

  const rec = {
    id: r.rest_id,
    created_at: L.created_at ? new Date(L.created_at).toISOString() : null,
    text: text.trim(),
    lang: L.lang ?? null,
    reply_to: L.in_reply_to_status_id_str
      ? { id: L.in_reply_to_status_id_str, handle: L.in_reply_to_screen_name ?? null } : null,
    urls: urls.filter(u => u.expanded_url).map(u => ({ url: u.expanded_url, display: u.display_url ?? null })),
    media: media.map(m => ({ type: m.type, url: m.media_url_https })),
    author: { id: author.id, handle: author.handle, name: author.name, avatar: author.avatar },
    quoted: null,
    retweeted: null,
  };
  if (depth < 2) {
    const q = unwrap(r.quoted_status_result?.result);
    if (q) rec.quoted = toRecord(q, 2);
  }
  if (depth === 0) {
    const rt = unwrap(L.retweeted_status_result?.result);
    if (rt) {
      rec.retweeted = toRecord(rt, 1);
      if (!rec.retweeted) return null; // retweet of something we can't share
    }
  }
  return rec;
}

// The post the user just made, from a CreateTweet / CreateNoteTweet response: { id, text } or null.
export function createdTweet(json) {
  const d = json?.data;
  const r = unwrap(d?.create_tweet?.tweet_results?.result ?? d?.notetweet_create?.tweet_results?.result);
  if (!r) return null;
  return { id: r.rest_id, text: r.note_tweet?.note_tweet_results?.result?.text ?? decodeEntities(r.legacy.full_text ?? '') };
}

// Walks a response in order, returning cleaned records for the entries a user would see.
// Ads (promotedMetadata, or an entryId starting with "promoted-") are skipped.
export function extractFeed(json) {
  const out = [];
  const seen = new Set();
  (function walk(node, promoted) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, promoted); return; }
    const p = promoted || !!node.promotedMetadata ||
      (typeof node.entryId === 'string' && node.entryId.startsWith('promoted-'));
    const t = node.tweet_results ? unwrap(node.tweet_results.result) : null;
    if (t && !p && !seen.has(t.rest_id)) {
      seen.add(t.rest_id);
      const rec = cleanRecord(toRecord(t, 0));
      if (rec) out.push(rec);
    }
    for (const k in node) if (k !== 'tweet_results') walk(node[k], p);
  })(json?.data, false);
  return out;
}
