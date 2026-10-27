const net = require('node:net');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');

function frame(op, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

class Decoder {
  constructor(onFrame) { this.buffer = Buffer.alloc(0); this.onFrame = onFrame; }
  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const length = this.buffer.readUInt32LE(4);
      if (length > 1024 * 1024) throw new Error('Discord sent an oversized message.');
      if (this.buffer.length < length + 8) return;
      const op = this.buffer.readUInt32LE(0);
      const body = this.buffer.subarray(8, length + 8);
      this.buffer = this.buffer.subarray(length + 8);
      this.onFrame(op, body);
    }
  }
}

function ipcPaths(env = process.env, platform = process.platform) {
  if (platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const roots = [...new Set([env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, '/tmp'].filter(Boolean))];
  return roots.flatMap(root => Array.from({ length: 10 }, (_, i) => path.join(root, `discord-ipc-${i}`)));
}

class Discord extends EventEmitter {
  constructor() {
    super();
    this.ready = false;
    this.socket = null;
    this.pending = new Map();
    this.generation = 0;
    this.connecting = false;
    this.clientId = '';
    this.message = 'Add your Discord Application ID to connect.';
  }
  status(message) { this.message = message; this.emit('status'); }
  disconnect() {
    this.generation++;
    this.ready = false;
    this.connecting = false;
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Discord disconnected.')); }
    this.pending.clear();
  }
  async connect(clientId) {
    if (this.clientId !== clientId) { this.disconnect(); this.clientId = clientId; }
    if (!/^\d{17,22}$/.test(clientId)) { this.status('Add your Discord Application ID to connect.'); return; }
    if (this.ready || this.connecting) return;
    this.connecting = true;
    const generation = this.generation;
    for (const socketPath of ipcPaths()) {
      if (generation !== this.generation) return;
      try {
        await this.dial(socketPath, clientId, generation);
        if (generation === this.generation) this.connecting = false;
        return;
      } catch { /* Discord may use any of its ten local sockets. */ }
    }
    if (generation === this.generation) {
      this.connecting = false;
      this.status('Waiting for Discord. Open the desktop app.');
    }
  }
  dial(socketPath, clientId, generation) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      this.socket = socket;
      let accepted = false;
      const timer = setTimeout(() => socket.destroy(new Error('Discord connection timed out.')), 1800);
      const decoder = new Decoder((op, body) => {
        if (generation !== this.generation) return;
        if (op === 3) { socket.write(frame(4, body)); return; }
        if (op === 2) {
          let message = 'Discord closed the connection.';
          try { message = JSON.parse(body).message || message; } catch { /* No JSON in close frame. */ }
          this.status(message);
          socket.destroy();
          return;
        }
        if (op !== 1) return;
        const payload = JSON.parse(body.toString('utf8'));
        if (payload.evt === 'READY') {
          accepted = true;
          clearTimeout(timer);
          this.ready = true;
          this.username = payload.data?.user?.global_name || payload.data?.user?.username || '';
          this.status('Connected to Discord');
          resolve();
        }
        const request = this.pending.get(payload.nonce);
        if (request) {
          clearTimeout(request.timer);
          this.pending.delete(payload.nonce);
          if (payload.evt === 'ERROR') request.reject(new Error(payload.data?.message || 'Discord rejected the activity.'));
          else request.resolve(payload.data);
        }
      });
      socket.once('connect', () => socket.write(frame(0, { v: 1, client_id: clientId })));
      socket.on('data', chunk => { try { decoder.feed(chunk); } catch (error) { socket.destroy(error); } });
      socket.on('error', error => { if (!accepted) reject(error); });
      socket.once('close', () => {
        clearTimeout(timer);
        if (!accepted) reject(new Error('Discord connection closed.'));
        if (this.socket !== socket) return;
        this.socket = null;
        this.ready = false;
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Discord disconnected.')); }
        this.pending.clear();
        if (accepted) this.status('Waiting for Discord. Open the desktop app.');
      });
    });
  }
  setActivity(activity) {
    if (!this.ready || !this.socket) return Promise.reject(new Error('Discord is not connected.'));
    const nonce = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(nonce); reject(new Error('Discord did not confirm the activity.')); }, 7000);
      this.pending.set(nonce, { resolve, reject, timer });
      this.socket.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce }));
    });
  }
}

module.exports = { Discord, Decoder, frame, ipcPaths };
