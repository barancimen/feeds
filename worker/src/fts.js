// Turns free text into a safe FTS5 query: each term quoted (no operators), AND-ed, last term as a prefix.
export function ftsQuery(q) {
  const terms = String(q || '').normalize('NFKC').split(/\s+/)
    .map(t => t.replace(/["]/g, '').slice(0, 50))
    .filter(t => /[\p{L}\p{N}]/u.test(t))
    .slice(0, 8);
  return terms.length ? terms.map((t, i) => `"${t}"${i === terms.length - 1 ? '*' : ''}`).join(' ') : null;
}
