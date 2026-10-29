// ISOLATED-world content script: relays requests from main.js to the background service worker, and
// settings changes made in other tabs back to main.js.

window.addEventListener('message', e => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data;
  if (!d || d.__xfs !== 'req' || typeof d.id !== 'string' || !d.msg || typeof d.msg.op !== 'string') return;
  const reply = r => window.postMessage({ __xfs: 'res', id: d.id, ...r }, location.origin);
  try {
    chrome.runtime.sendMessage(d.msg).then(
      r => reply(r && 'error' in r ? { error: r.error } : { result: r?.result }),
      err => reply({ error: String(err?.message || err) }),
    );
  } catch (err) {
    reply({ error: 'Extension was reloaded; refresh this tab.' });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (!key.startsWith('xfs_token')) window.postMessage({ __xfs: 'chg', key, value: newValue ?? null }, location.origin);
  }
});
