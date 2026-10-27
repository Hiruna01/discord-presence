const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createBridge } = require('../app/bridge.cjs');

test('local bridge requires pairing and rejects other web origins and invalid payloads', async t => {
  let token = 'a'.repeat(64), paired = false;
  const events = [];
  const bridge = createBridge({ port: 0, getToken: () => token, saveToken: value => { token = value; },
    onVideo: (...args) => events.push(args), getStatus: () => ({ enabled: true }), onPaired: () => { paired = true; } });
  await bridge.start(); t.after(() => bridge.close());
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  const post = (route, body, auth, origin = `chrome-extension://${'a'.repeat(32)}`) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body),
  });
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/status')).status, 401);
  assert.equal((await post('/video', {}, token, 'https://evil.example')).status, 403);
  assert.equal((await post('/pair', { code: '000000' })).status, 403);
  const { code } = bridge.newCode();
  const response = await post('/pair', { code });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.match(result.token, /^[a-f0-9]{64}$/);
  assert.equal(paired, true);
  assert.equal((await post('/pair', { code })).status, 403, 'Pairing codes are single-use');
  assert.equal((await post('/video', { source: 'chrome:4', video: null }, token)).status, 200);
  assert.deepEqual(events, [['chrome:4', null]]);
  assert.equal((await post('/video', {}, 'old-token')).status, 401);
  assert.equal((await post('/video', 'x'.repeat(9000), token)).status, 413);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(base + '/health', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
});
test('pairing guesses are rate limited', async t => {
  const bridge = createBridge({ port: 0, getToken: () => 'x', saveToken() {}, onVideo() {}, getStatus: () => ({}) });
  await bridge.start(); t.after(() => bridge.close());
  for (let i = 0; i < 6; i++) {
    const response = await fetch(`http://127.0.0.1:${bridge.server.address().port}/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '000000' }),
    });
    assert.equal(response.status, i < 5 ? 403 : 429);
  }
});
