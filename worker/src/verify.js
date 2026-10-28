// Account verification: the publisher posts a one-time code from their X account, and we confirm it
// through X's public oEmbed endpoint, which reports a post's real author whatever URL it is asked with.

export const CODE_TTL_MS = 30 * 60000;
export const CLOCK_SLACK_MS = 2 * 60000;
const TWITTER_EPOCH = 1288834974657n;

// Post IDs are snowflakes: the top bits are the creation time in ms since X's epoch.
export const snowflakeMs = id => Number((BigInt(id) >> 22n) + TWITTER_EPOCH);

export function makeCode() {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789'; // no look-alikes (l/1, o/0)
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), b => a[b % a.length]).join('');
}

// No link in it: many accounts posting identical text with the same URL looks like spam to X.
export const verifyText = code => `Verifying that I publish my X Feed Share feed. Code: ${code}`;

export const hasCode = (text, code) => new RegExp(`(^|[^a-z0-9])${code}([^a-z0-9]|$)`).test(text.toLowerCase());

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeHtml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

// oEmbed JSON -> { handle, text } of the post itself (not any quoted post), or null if it doesn't look right.
export function parseOembed(o) {
  const m = typeof o?.author_url === 'string' && o.author_url.match(/^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/);
  const p = typeof o?.html === 'string' && o.html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  if (!m || !p) return null;
  return { handle: m[1], text: decodeHtml(p[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')) };
}
