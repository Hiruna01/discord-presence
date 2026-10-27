const http = require('node:http');
const { randomBytes, randomInt, timingSafeEqual } = require('node:crypto');

const PORT = 32145;
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function createBridge({ getToken, saveToken, onVideo, getStatus, onPaired, port = PORT }) {
  let pairing = null;
  let attempts = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (req.headers.host !== `127.0.0.1:${server.address().port}`
      || (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))) {
      res.writeHead(403).end(); return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    if (req.url === '/health' && req.method === 'GET') { reply(200, { app: 'Frame', version: '1.0.0' }); return; }
    if (req.url !== '/pair' && !safeEqual(req.headers.authorization, `Bearer ${getToken()}`)) {
      reply(401, { error: 'Pair the extension with Frame first.' }); return;
    }
    if (req.url === '/status' && req.method === 'GET') { reply(200, getStatus()); return; }
    if (req.method !== 'POST' || !['/pair', '/video'].includes(req.url)) { reply(404, { error: 'Not found.' }); return; }
    if (req.headers['content-type'] !== 'application/json') { reply(415, { error: 'Expected JSON.' }); return; }
    let body;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) { reply(413, { error: 'Message too large.' }); return; }
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object') throw new Error('Invalid payload');
    } catch { reply(400, { error: 'Invalid message.' }); return; }
    if (req.url === '/pair') {
      attempts = attempts.filter(time => Date.now() - time < 60_000);
      if (attempts.length >= 5) { reply(429, { error: 'Too many attempts. Try again in a minute.' }); return; }
      attempts.push(Date.now());
      if (!pairing || pairing.expires < Date.now() || !safeEqual(String(body.code), pairing.code)) {
        reply(403, { error: 'That code is incorrect or expired. Get a fresh code in Frame.' }); return;
      }
      const token = randomBytes(32).toString('hex');
      try { saveToken(token); } catch { reply(500, { error: 'Could not save pairing. Please try again.' }); return; }
      pairing = null;
      attempts = [];
      onPaired?.();
      reply(200, { token });
      return;
    }
    try { onVideo(body.source, body.video); reply(200, { ok: true }); }
    catch { reply(400, { error: 'Invalid video source.' }); }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return {
    server,
    start: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }),
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
    newCode: () => { pairing = { code: String(randomInt(100000, 1000000)), expires: Date.now() + 600_000 }; return pairing; },
    getCode: () => pairing && pairing.expires > Date.now() ? pairing : null,
  };
}
module.exports = { createBridge, PORT };
