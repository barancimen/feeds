// Builders for HomeTimeline-shaped GraphQL responses (structure as of Oct 2026: users carry
// core/avatar/privacy; User.legacy was dropped in July 2026 but older shapes are still handled).

export function user(id, handle, { name, prot = false, legacyOnly = false } = {}) {
  const avatar = `https://pbs.twimg.com/profile_images/${id}/a_normal.jpg`;
  if (legacyOnly) {
    return { __typename: 'User', rest_id: id,
      legacy: { screen_name: handle, name: name ?? handle, profile_image_url_https: avatar, protected: prot } };
  }
  return { __typename: 'User', id: `VXNlcjo${id}`, rest_id: id, is_blue_verified: false, avatar: { image_url: avatar },
    core: { created_at: 'Mon Jan 01 00:00:00 +0000 2020', name: name ?? handle, screen_name: handle },
    privacy: { protected: prot } };
}

export function tweet(id, u, text, { legacy = {}, top = {} } = {}) {
  return {
    __typename: 'Tweet', rest_id: id, core: { user_results: { result: u } }, views: { state: 'Enabled' },
    legacy: { created_at: 'Tue Oct 28 12:00:00 +0000 2026', conversation_id_str: id, full_text: text, lang: 'en',
      display_text_range: [0, text.length], entities: { urls: [], user_mentions: [], hashtags: [], symbols: [] },
      favorite_count: 1, retweet_count: 0, user_id_str: u.rest_id, id_str: id, ...legacy },
    ...top,
  };
}

let sort = 1900000000000000000n;
export function item(entryId, result, extra = {}) {
  return { entryId, sortIndex: String(sort--), content: { entryType: 'TimelineTimelineItem', __typename: 'TimelineTimelineItem',
    itemContent: { itemType: 'TimelineTweet', __typename: 'TimelineTweet', tweet_results: { result }, tweetDisplayType: 'Tweet', ...extra } } };
}

export function conversation(entryId, results) {
  return { entryId, sortIndex: String(sort--), content: { entryType: 'TimelineTimelineModule', __typename: 'TimelineTimelineModule',
    displayType: 'VerticalConversation',
    items: results.map(r => ({ entryId: `${entryId}-tweet-${r.rest_id}`,
      item: { itemContent: { itemType: 'TimelineTweet', __typename: 'TimelineTweet', tweet_results: { result: r } } } })) } };
}

export const cursor = dir => ({ entryId: `cursor-${dir}-1`, sortIndex: String(sort--),
  content: { entryType: 'TimelineTimelineCursor', __typename: 'TimelineTimelineCursor', value: 'DAABCgABG', cursorType: dir } });

export const response = entries => ({ data: { home: { home_timeline_urt: {
  instructions: [{ type: 'TimelineAddEntries', entries }, { type: 'TimelineShowAlert' }], metadata: {} } } } });

const alice = user('101', 'alice', { name: 'Alice A.' });
const bob = user('102', 'bob');
const carol = user('103', 'carol');
const dave = user('104', 'dave');
const erin = user('105', 'erin');
const locked = user('106', 'locked', { prot: true });
const frank = user('107', 'frank');
const gina = user('108', 'gina');
const old = user('109', 'oldshape', { legacyOnly: true });
const adco = user('110', 'adco');

const photo = { display_url: 'pic.x.com/p1', expanded_url: 'https://x.com/erin/status/6001/photo/1', id_str: '1',
  indices: [0, 0], media_url_https: 'https://pbs.twimg.com/media/PHOTO1.jpg', type: 'photo', url: 'https://t.co/media1' };
const video = { display_url: 'pic.x.com/v1', expanded_url: 'https://x.com/alice/status/13/video/1', id_str: '2',
  indices: [0, 0], media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/2/pu/img/VID.jpg', type: 'video', url: 'https://t.co/media2' };

export const FOR_YOU = response([
  item('tweet-1', tweet('1', alice, 'Tom &amp; Jerry &lt;3 https://t.co/abc', { legacy: { entities: { urls: [
    { url: 'https://t.co/abc', expanded_url: 'https://example.com/page', display_url: 'example.com/page' }] } } })),
  item('promoted-tweet-2-abc', tweet('2', adco, 'Buy now'), { promotedMetadata: { advertiser_results: {} } }),
  item('tweet-3', tweet('3', adco, 'Also an ad'), { promotedMetadata: { advertiser_results: {} } }),
  item('tweet-4', tweet('4', locked, 'protected post')),
  item('tweet-5', tweet('5', bob, 'RT @carol: original text…', { legacy: {
    retweeted_status_result: { result: tweet('5001', carol, 'original text in full') } } })),
  item('tweet-6', tweet('6', dave, 'look at this', { legacy: { is_quote_status: true, quoted_status_id_str: '6001' },
    top: { quoted_status_result: { result: tweet('6001', erin, 'a photo https://t.co/media1', {
      legacy: { entities: { media: [photo], urls: [] }, extended_entities: { media: [photo] } } }) } } })),
  item('tweet-7', tweet('7', dave, 'quoting a locked account', {
    top: { quoted_status_result: { result: tweet('7001', locked, 'secret') } } })),
  item('tweet-8', { __typename: 'TweetWithVisibilityResults', tweet: tweet('8', alice, 'limited visibility'), limitedActionResults: {} }),
  item('tweet-9', { __typename: 'TweetTombstone', tombstone: { __typename: 'TextTombstone', text: { text: 'This Post is unavailable.' } } }),
  conversation('home-conversation-10', [
    tweet('10', frank, 'thread start'),
    tweet('11', gina, '@frank nice', { legacy: { in_reply_to_status_id_str: '10', in_reply_to_screen_name: 'frank',
      in_reply_to_user_id_str: '107', conversation_id_str: '10' } }),
  ]),
  item('tweet-12', tweet('12', alice, 'This is the truncated version… https://t.co/note', { top: { note_tweet: {
    is_expandable: true, note_tweet_results: { result: { id: 'Tm90ZVR3ZWV0OjEy', text: 'This is the full long text of a note tweet. See https://t.co/n1',
      entity_set: { urls: [{ url: 'https://t.co/n1', expanded_url: 'https://example.org/long', display_url: 'example.org/long' }],
        user_mentions: [], hashtags: [], symbols: [] } } } } } })),
  item('tweet-13', tweet('13', alice, 'watch https://t.co/media2', { legacy: { entities: { media: [video], urls: [] },
    extended_entities: { media: [video] } } })),
  item('tweet-14', tweet('14', old, 'old user shape')),
  item('tweet-1-dup', tweet('1', alice, 'Tom &amp; Jerry &lt;3 https://t.co/abc')),
  cursor('Top'),
  cursor('Bottom'),
]);

export const FOLLOWING = response([
  item('tweet-21', tweet('21', bob, 'first in following')),
  item('tweet-22', tweet('22', carol, 'second in following')),
  cursor('Bottom'),
]);
