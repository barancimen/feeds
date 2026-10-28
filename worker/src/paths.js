// The app lives under /feeds on the public domain (gestaltschaft.com/feeds). On workers.dev it also answers
// at the root, so links and installed userscripts from before the move keep working.

export const BASE = '/feeds';

export function splitBase(pathname) {
  if (pathname === BASE || pathname.startsWith(BASE + '/')) return { base: BASE, path: pathname.slice(BASE.length) || '/' };
  return { base: '', path: pathname };
}

// Pages requested on workers.dev move to the public URL; the API and the userscript keep answering there.
export function canonicalRedirect(url, publicUrl) {
  if (!publicUrl || !url.hostname.endsWith('.workers.dev')) return null;
  const { path } = splitBase(url.pathname);
  const target = publicUrl.replace(/\/+$/, '');
  if (path === '/') return target + url.search;
  if (/^\/f\/[a-z0-9]{10}$/.test(path)) return target + path + url.search;
  return null;
}
