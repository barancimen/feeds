// Shared validation. The Worker runs every uploaded record through cleanRecord(), and the
// renderer runs it again before drawing, so a bad publisher can't inject markup or URLs.

export const KINDS = ['foryou', 'following'];
export const MAX_TEXT = 10000;
export const MAX_BATCH = 100;

const ID = /^\d{1,20}$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const MEDIA_HOST = /^https:\/\/(pbs|abs)\.twimg\.com\//;
const MEDIA_TYPES = new Set(['photo', 'video', 'animated_gif']);

export const isId = v => typeof v === 'string' && ID.test(v);
export const isHandle = v => typeof v === 'string' && HANDLE.test(v);

function str(v, max) {
  if (typeof v !== 'string') return null;
  // Drop control characters except newline and tab.
  return v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').slice(0, max);
}

export function safeMediaUrl(v) {
  if (typeof v !== 'string' || v.length > 500 || !MEDIA_HOST.test(v)) return null;
  try { return new URL(v).href; } catch { return null; }
}

export function safeHttpUrl(v) {
  if (typeof v !== 'string' || v.length > 2000) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

export function cleanLabel(v) {
  return (str(v, 40) || '').replace(/\s+/g, ' ').trim() || 'anonymous';
}

const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

// depth 0: a feed entry, may carry `retweeted` (depth 1) and `quoted` (depth 2).
// depth 1: a retweeted tweet, may carry `quoted` (depth 2). depth 2: no nesting.
export function cleanRecord(r, depth = 0) {
  if (!r || typeof r !== 'object' || !isId(r.id)) return null;
  const a = r.author;
  if (!a || typeof a !== 'object' || !isId(a.id) || !isHandle(a.handle)) return null;
  const created = typeof r.created_at === 'string' ? Date.parse(r.created_at) : NaN;
  const rt = r.reply_to;
  return {
    id: r.id,
    created_at: Number.isFinite(created) ? new Date(created).toISOString() : null,
    text: str(r.text, MAX_TEXT) ?? '',
    lang: typeof r.lang === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(r.lang) ? r.lang : null,
    reply_to: rt && isId(rt.id) ? { id: rt.id, handle: isHandle(rt.handle) ? rt.handle : null } : null,
    urls: arr(r.urls, 10)
      .map(u => ({ url: safeHttpUrl(u?.url), display: str(u?.display, 100) }))
      .filter(u => u.url),
    media: arr(r.media, 4)
      .map(m => ({ type: MEDIA_TYPES.has(m?.type) ? m.type : 'photo', url: safeMediaUrl(m?.url) }))
      .filter(m => m.url),
    author: { id: a.id, handle: a.handle, name: str(a.name, 50) || a.handle, avatar: safeMediaUrl(a.avatar) },
    quoted: depth < 2 ? cleanRecord(r.quoted, 2) : null,
    retweeted: depth === 0 ? cleanRecord(r.retweeted, 1) : null,
  };
}
