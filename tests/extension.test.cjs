const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createBridge } = require('../app/bridge.cjs');

test('Chrome worker pairs, relays video metadata, clears closed tabs and rejects other pages', async t => {
  let token = 'a'.repeat(64), listener, removed;
  const events = [], stored = {};
  const bridge = createBridge({ port: 0, getToken: () => token, saveToken: value => { token = value; },
    onVideo: (...args) => events.push(args), getStatus: () => ({ enabled: true, discord: true }) });
  await bridge.start(); t.after(() => bridge.close());
  const extensionId = 'a'.repeat(32), url = `chrome-extension://${extensionId}/popup.html`;
  const code = fs.readFileSync('extension/background.js', 'utf8');
  vm.runInNewContext(code, {
    URL, AbortSignal, crypto: require('node:crypto').webcrypto,
    fetch: (input, init) => fetch(input.replace('127.0.0.1:32145', `127.0.0.1:${bridge.server.address().port}`), {
      ...init, headers: { ...init.headers, Origin: `chrome-extension://${extensionId}` },
    }),
    chrome: {
      storage: { local: { get: async () => ({ ...stored }), set: async data => Object.assign(stored, data) } },
      runtime: { id: extensionId, getURL: name => `chrome-extension://${extensionId}/${name}`, onMessage: { addListener: fn => { listener = fn; } } },
      tabs: { onRemoved: { addListener: fn => { removed = fn; } } },
    },
  });
  const message = (payload, sender = { id: extensionId, url }) => new Promise(resolve => listener(payload, sender, resolve));
  assert.equal((await message({ type: 'STATUS' })).paired, false);
  assert.equal((await message({ type: 'PAIR', code: bridge.newCode().code })).paired, true);
  assert.equal((await message({ type: 'STATUS' })).discord, true);
  const sender = { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', tab: { id: 7, incognito: false } };
  const video = { id: 'dQw4w9WgXcQ', title: 'A video', playing: true };
  assert.equal((await message({ type: 'VIDEO', video }, sender)).ok, true);
  assert.equal(events[0][1].id, video.id);
  assert.equal((await message({ type: 'PAIR', code: '123456' }, sender)).ok, false);
  assert.equal((await message({ type: 'VIDEO', video }, { ...sender, tab: { id: 7, incognito: true } })).ok, false);
  assert.equal((await message({ type: 'VIDEO', video }, { ...sender, url: 'https://example.com' })).ok, false);
  await removed(7);
  assert.equal(events.at(-1)[0], events[0][0]);
  assert.equal(events.at(-1)[1], null);
});

test('YouTube reader handles playback, ads, pause, seeking, SPA navigation and Shorts', async () => {
  const messages = [], handlers = {};
  let interval, ad = false, isLive = false, short = false;
  const player = { readyState: 4, paused: false, ended: false, currentTime: 10, duration: 200, playbackRate: 1 };
  const location = { href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' };
  const source = fs.readFileSync('extension/content.js', 'utf8');
  vm.runInNewContext(source, {
    URL, location, clearTimeout() {}, setTimeout: fn => { fn(); return 1; }, setInterval: fn => { interval = fn; },
    chrome: { runtime: { sendMessage: async data => { messages.push(JSON.parse(JSON.stringify(data))); } } },
    window: { addEventListener: (type, handler) => { handlers[type] = handler; } },
    document: {
      title: 'Fallback title - YouTube',
      addEventListener: (type, handler) => { handlers[type] = handler; },
      querySelector: selector => {
        if (selector.includes('ad-showing')) return ad ? {} : null;
        if (selector.includes('ytp-live-badge')) return isLive ? {} : null;
        if (selector.includes('video.html5-main-video') || (short && selector.includes('[is-active] video'))) return player;
        if (selector.includes('h1') || selector.includes('[is-active] h2')) return { textContent: 'The video title' };
        if (selector.includes('channel-name')) return { textContent: 'The creator' };
        return null;
      },
    },
  });
  const latest = () => messages.at(-1).video;
  assert.equal(latest().title, 'The video title');
  assert.equal(latest().playing, true);
  player.paused = true; handlers.pause();
  assert.equal(latest().playing, false);
  player.paused = false; player.currentTime = 100; player.playbackRate = 2; handlers.seeked();
  assert.equal(latest().position, 100); assert.equal(latest().rate, 2);
  ad = true; interval(); assert.equal(latest(), null);
  ad = false; isLive = true; interval(); assert.equal(latest().live, true);
  handlers['yt-navigate-start'](); assert.equal(latest(), null);
  location.href = 'https://www.youtube.com/'; handlers['yt-navigate-finish'](); assert.equal(latest(), null);
  short = true; location.href = 'https://www.youtube.com/shorts/abcdefghijk'; handlers['yt-navigate-finish']();
  assert.equal(latest().id, 'abcdefghijk');
  handlers.pagehide(); assert.equal(latest(), null);
});
