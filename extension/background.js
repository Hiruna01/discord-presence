const BASE = 'http://127.0.0.1:32145';
async function request(endpoint, { body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${BASE}${endpoint}`, {
      method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3000), cache: 'no-store',
    });
  } catch { throw new Error('Open the Frame app on your Mac to connect.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Frame could not connect.');
  return data;
}
async function credentials() {
  const stored = await chrome.storage.local.get(['token', 'sourceId']);
  if (!stored.sourceId) {
    stored.sourceId = crypto.randomUUID();
    await chrome.storage.local.set({ sourceId: stored.sourceId });
  }
  return stored;
}
function fromYouTube(sender) {
  try {
    const url = new URL(sender.url);
    return sender.tab && Number.isInteger(sender.tab.id) && !sender.tab.incognito
      && url.protocol === 'https:' && ['www.youtube.com', 'youtube.com'].includes(url.hostname);
  } catch { return false; }
}
async function processMessage(message, sender) {
  if (message?.type === 'VIDEO') {
    if (!fromYouTube(sender)) throw new Error('Unsupported page.');
    const { token, sourceId } = await credentials();
    if (!token) return { paired: false };
    await request('/video', { token, body: { source: `${sourceId}:${sender.tab.id}`, video: message.video } });
    return { paired: true };
  }
  // Only our own popup can pair or query the desktop app.
  if (sender.tab || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) throw new Error('Unsupported request.');
  if (message?.type === 'PAIR') {
    const code = String(message.code || '').trim();
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the six-digit code shown in Frame.');
    const result = await request('/pair', { body: { code } });
    await chrome.storage.local.set({ token: result.token });
    // Existing YouTube pages will send their next update within five seconds.
    return { paired: true };
  }
  if (message?.type === 'STATUS') {
    const { token } = await credentials();
    await request('/health');
    if (!token) return { paired: false, appOpen: true };
    try { return { paired: true, appOpen: true, ...await request('/status', { token }) }; }
    catch (error) {
      if (error.message.includes('Pair the extension')) return { paired: false, appOpen: true };
      throw error;
    }
  }
  throw new Error('Unknown request.');
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  processMessage(message, sender).then(data => sendResponse({ ok: true, ...data }))
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(async tabId => {
  try {
    const { token, sourceId } = await credentials();
    if (token) await request('/video', { token, body: { source: `${sourceId}:${tabId}`, video: null } });
  } catch { /* Closing a tab should stay silent when Frame is not running. */ }
});
