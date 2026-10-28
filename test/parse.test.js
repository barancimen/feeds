import assert from 'node:assert/strict';
import test from 'node:test';
import { extractFeed, FEED_RE, kindOf } from '../core/parse.js';
import { FOLLOWING, FOR_YOU } from './fixtures/timeline.js';

const byId = recs => Object.fromEntries(recs.map(r => [r.id, r]));

test('keeps feed order and skips ads, protected authors, tombstones and duplicates', () => {
  const recs = extractFeed(FOR_YOU);
  assert.deepEqual(recs.map(r => r.id), ['1', '5', '6', '7', '8', '10', '11', '12', '13', '14']);
});

test('decodes entities, expands t.co links and keeps url display text', () => {
  const r = byId(extractFeed(FOR_YOU))['1'];
  assert.equal(r.text, 'Tom & Jerry <3 https://example.com/page');
  assert.deepEqual(r.urls, [{ url: 'https://example.com/page', display: 'example.com/page' }]);
  assert.deepEqual(r.author, { id: '101', handle: 'alice', name: 'Alice A.',
    avatar: 'https://pbs.twimg.com/profile_images/101/a_normal.jpg' });
  assert.equal(r.created_at, '2026-10-28T12:00:00.000Z');
});

test('embeds retweeted and quoted tweets; drops a protected quote but keeps the quoting tweet', () => {
  const recs = byId(extractFeed(FOR_YOU));
  assert.equal(recs['5'].author.handle, 'bob');
  assert.equal(recs['5'].retweeted.id, '5001');
  assert.equal(recs['5'].retweeted.text, 'original text in full');
  assert.equal(recs['6'].quoted.id, '6001');
  assert.equal(recs['6'].quoted.text, 'a photo');
  assert.deepEqual(recs['6'].quoted.media, [{ type: 'photo', url: 'https://pbs.twimg.com/media/PHOTO1.jpg' }]);
  assert.equal(recs['6'].quoted.quoted, null);
  assert.equal(recs['7'].quoted, null);
});

test('handles visibility wrappers, conversation modules, note tweets, video and legacy user shape', () => {
  const recs = byId(extractFeed(FOR_YOU));
  assert.equal(recs['8'].text, 'limited visibility');
  assert.deepEqual(recs['11'].reply_to, { id: '10', handle: 'frank' });
  assert.equal(recs['12'].text, 'This is the full long text of a note tweet. See https://example.org/long');
  assert.equal(recs['13'].text, 'watch');
  assert.equal(recs['13'].media[0].type, 'video');
  assert.equal(recs['14'].author.handle, 'oldshape');
});

test('following feed and URL matching', () => {
  assert.deepEqual(extractFeed(FOLLOWING).map(r => r.id), ['21', '22']);
  const m = 'https://x.com/i/api/graphql/aBc-123_/HomeLatestTimeline?variables=%7B%7D'.match(FEED_RE);
  assert.equal(kindOf(m[1]), 'following');
  assert.equal(kindOf('https://x.com/i/api/graphql/x/HomeTimeline'.match(FEED_RE)[1]), 'foryou');
  assert.equal('https://x.com/i/api/graphql/x/HomeTimelineFoo'.match(FEED_RE), null);
  assert.equal('https://x.com/i/api/graphql/x/UserTweets?v=1'.match(FEED_RE), null);
});

test('tolerates junk input', () => {
  assert.deepEqual(extractFeed(null), []);
  assert.deepEqual(extractFeed({ data: { weird: [1, 'a', null, { tweet_results: { result: { rest_id: 'x' } } }] } }), []);
});
