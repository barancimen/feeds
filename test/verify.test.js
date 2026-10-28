import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeHtml, hasCode, makeCode, parseOembed, snowflakeMs, verifyText } from '../worker/src/verify.js';

// Real publish.x.com/oembed response, fetched 2026-10-28 for x.com/i/status/2115036713554981186.
const REAL = {
  url: 'https://x.com/worlddestroyar/status/2115036713554981186', author_name: 'world destroyar',
  author_url: 'https://x.com/worlddestroyar',
  html: '<blockquote class="twitter-tweet" data-dnt="true"><p lang="en" dir="ltr">As mathematicians and other deep thinkers scramble to figure out what it is that they can can do but computers still can&#39;t, they also pave the way for its computerization. Everything must be revealed. Everything made explicit, encoded into the stream of ones and zeros.</p>&mdash; world destroyar (@worlddestroyar) <a href="https://x.com/worlddestroyar/status/2115036713554981186?ref_src=twsrc%5Etfw">October 27, 2026</a></blockquote>\n\n',
  width: 550, height: null, type: 'rich', cache_age: '3153600000', provider_name: 'X', provider_url: 'https://x.com', version: '1.0',
};

test('reads the author and the post text from a real oEmbed response', () => {
  const p = parseOembed(REAL);
  assert.equal(p.handle, 'worlddestroyar');
  assert.match(p.text, /^As mathematicians .* computers still can't, they also/);
  assert.ok(!p.text.includes('October 27')); // the byline is outside <p>
});

test('post IDs carry their creation time', () => {
  assert.equal(new Date(snowflakeMs('2115036713554981186')).toISOString(), '2026-10-27T11:03:42.650Z');
  assert.equal(new Date(snowflakeMs('20')).getUTCFullYear(), 2010); // pre-snowflake IDs decode to the epoch
});

test('rejects oEmbed answers that do not look like a single post by an account', () => {
  for (const bad of [null, {}, { ...REAL, author_url: 'https://evil.com/worlddestroyar' },
    { ...REAL, author_url: 'https://x.com/worlddestroyar/status/1' }, { ...REAL, author_url: 'https://x.com/bad handle' },
    { ...REAL, html: '<blockquote>no paragraph</blockquote>' }]) {
    assert.equal(parseOembed(bad), null);
  }
});

test('codes: format, whole-word match, HTML decoding', () => {
  const code = makeCode();
  assert.match(code, /^[a-hj-km-np-z2-9]{8}$/);
  assert.ok(hasCode(verifyText(code), code));
  assert.ok(hasCode(`code:${code}!`, code));
  assert.ok(hasCode(`CODE ${code.toUpperCase()}`, code));
  assert.ok(!hasCode(`x${code}`, code));
  assert.ok(!hasCode(`${code}9`, code));
  assert.equal(decodeHtml('a &amp; b &lt;3 &#39;q&#x27; &quot;z&quot; &bogus; &#0;'), 'a & b <3 \'q\' "z" &bogus; &#0;');
  const p = parseOembed({ ...REAL, html: `<blockquote><p>it&#39;s me<br>Code: <a href="#">${code}</a></p></blockquote>` });
  assert.equal(p.text, `it's me\nCode: ${code}`);
  assert.ok(hasCode(p.text, code));
});
