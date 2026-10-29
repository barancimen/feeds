// Notices when a newer userscript has been published. Checks at most every 6 hours (remembered across
// pages and tabs); "Later" hides the notice for a day.

export const UPDATE_KEY = 'xfs_update';
const CHECK_MS = 6 * 3600e3;
const SNOOZE_MS = 24 * 3600e3;
const VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/;

export const isVersion = v => typeof v === 'string' && VERSION_RE.test(v);

export function isNewer(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

export function createUpdateChecker({ api, store, version, onChange = () => {}, now = Date.now }) {
  let state = { checkedAt: 0, latest: null, snoozed: null };

  async function load() {
    const s = await store.get(UPDATE_KEY).catch(() => null);
    if (!s || typeof s !== 'object') return;
    state = {
      checkedAt: Number(s.checkedAt) || 0,
      latest: isVersion(s.latest) ? s.latest : null,
      snoozed: s.snoozed && isVersion(s.snoozed.version) ? { version: s.snoozed.version, until: Number(s.snoozed.until) || 0 } : null,
    };
  }

  async function check() {
    if (!isVersion(version)) return;
    await load();
    if (now() - state.checkedAt >= CHECK_MS) {
      try {
        const r = await api.version();
        if (isVersion(r?.version)) state.latest = r.version;
        state.checkedAt = now();
        await store.set(UPDATE_KEY, state);
      } catch (_) { /* offline or server trouble: try again at the next check */ }
    }
    onChange();
  }

  // The newer version to offer, or null.
  function available() {
    const v = state.latest;
    if (!v || !isVersion(version) || !isNewer(v, version)) return null;
    if (state.snoozed?.version === v && state.snoozed.until > now()) return null;
    return v;
  }

  async function snooze() {
    state.snoozed = { version: state.latest, until: now() + SNOOZE_MS };
    onChange();
    await store.set(UPDATE_KEY, state).catch(() => {});
  }

  return { check, available, snooze };
}
