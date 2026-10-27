const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { Discord, frame, Decoder, ipcPaths } = require('../app/discord.cjs');

test('IPC decoder handles fragmented and coalesced frames and rejects oversized messages', () => {
  const received = [];
  const decoder = new Decoder((op, data) => received.push([op, data.toString()]));
  const a = frame(1, { evt: 'READY' }), b = frame(3, Buffer.from('ping'));
  const combined = Buffer.concat([a, b]);
  for (const byte of combined) decoder.feed(Buffer.from([byte]));
  assert.deepEqual(received, [[1, '{"evt":"READY"}'], [3, 'ping']]);
  const header = Buffer.alloc(8); header.writeUInt32LE(2 ** 24, 4);
  assert.throws(() => decoder.feed(header), /oversized/);
});
test('discovers all Discord sockets on macOS and Windows', () => {
  const paths = ipcPaths({ TMPDIR: '/private/tmp/frame/' }, 'darwin');
  assert.equal(paths[0], '/private/tmp/frame/discord-ipc-0');
  assert.equal(paths.at(-1), '/tmp/discord-ipc-9');
  assert.equal(ipcPaths({}, 'win32')[0], '\\\\?\\pipe\\discord-ipc-0');
});
test('real socket handshake, ping/pong, SET_ACTIVITY acknowledgements, errors and clearing', async t => {
  const socketPath = path.join(os.tmpdir(), `frame-test-${process.pid}.sock`);
  const seen = [];
  const clients = new Set();
  const server = net.createServer(socket => {
    clients.add(socket); socket.on('close', () => clients.delete(socket));
    const decoder = new Decoder((op, body) => {
      if (op === 4) { seen.push('pong'); return; }
      const payload = JSON.parse(body.toString());
      if (op === 0) {
        assert.equal(payload.client_id, '123456789012345678');
        const ready = frame(1, { evt: 'READY', data: { user: { username: 'test' } } });
        socket.write(ready.subarray(0, 5));
        setTimeout(() => socket.write(Buffer.concat([ready.subarray(5), frame(3, { test: 1 })])), 5);
      } else {
        seen.push(payload.args.activity);
        socket.write(frame(1, payload.args.activity?.details === 'fail'
          ? { nonce: payload.nonce, evt: 'ERROR', data: { message: 'Invalid activity' } }
          : { nonce: payload.nonce, cmd: 'SET_ACTIVITY', data: payload.args.activity }));
      }
    });
    socket.on('data', chunk => decoder.feed(chunk));
  });
  server.listen(socketPath); await once(server, 'listening');
  const discord = new Discord();
  t.after(async () => { discord.disconnect(); for (const socket of clients) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  await discord.dial(socketPath, '123456789012345678', discord.generation);
  assert.equal(discord.ready, true);
  assert.equal(discord.username, 'test');
  await discord.setActivity({ type: 3, details: 'A video' });
  await assert.rejects(discord.setActivity({ details: 'fail' }), /Invalid activity/);
  await discord.setActivity(null);
  assert(seen.includes('pong'));
  assert.equal(seen.at(-1), null);
  discord.disconnect();
  assert.equal(discord.ready, false);
});
