const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, clipboard, dialog, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomBytes } = require('node:crypto');
const { execFile } = require('node:child_process');
const { Presence, defaults } = require('./presence.cjs');
const { Discord } = require('./discord.cjs');
const { createBridge } = require('./bridge.cjs');

const smoke = process.argv.includes('--smoke-test');
if (smoke) app.setPath('userData', path.join(app.getPath('temp'), `frame-smoke-${process.pid}`));
app.setName('Frame');
let window, tray, bridge, store, presence, discord, timer;
let quitting = false, writing = false, lastActivity, lastSent = 0, confirmedVideo = null, publishError = '', bridgeError = '';
let lastConnection = false;
const uiPath = path.join(__dirname, 'ui', 'index.html');
const storePath = () => path.join(app.getPath('userData'), 'settings.json');
function openChrome(url) {
  if (process.platform !== 'darwin') return shell.openExternal(url);
  return new Promise((resolve, reject) => execFile('/usr/bin/open', ['-a', 'Google Chrome', url], error => error ? reject(new Error('Could not open Google Chrome. Make sure it is installed.')) : resolve()));
}

function persist() {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(`${storePath()}.tmp`, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(`${storePath()}.tmp`, storePath());
}
function state() {
  const video = presence.current();
  return {
    settings: presence.settings,
    video,
    discord: { connected: discord.ready, message: discord.message, username: discord.username || '' },
    chrome: { paired: store.paired === true, active: Date.now() - presence.lastExtensionSeen < 35_000 },
    pairing: bridge?.getCode(),
    sharing: !!(presence.settings.enabled && video && discord.ready && confirmedVideo === video.id && !publishError),
    error: bridgeError || publishError,
    version: app.getVersion(),
  };
}
function broadcast() {
  if (window && !window.isDestroyed()) window.webContents.send('frame:state', state());
}
function equivalent(a, b) {
  if (a === undefined) return false;
  const stripTime = value => value && { ...value, timestamps: undefined };
  return JSON.stringify(stripTime(a)) === JSON.stringify(stripTime(b))
    && Math.abs((a?.timestamps?.end || 0) - (b?.timestamps?.end || 0)) <= 3;
}
async function publish() {
  if (smoke || writing || !discord.ready) return;
  const activity = presence.activity();
  if (equivalent(lastActivity, activity)) return;
  // Clearing is immediate; normal updates are coalesced to protect Discord's RPC.
  if (activity && Date.now() - lastSent < 5000) return;
  writing = true;
  lastSent = Date.now();
  const videoId = activity ? presence.current()?.id || null : null;
  try {
    await discord.setActivity(activity);
    lastActivity = activity;
    confirmedVideo = videoId;
    publishError = '';
  } catch (error) {
    confirmedVideo = null;
    publishError = error.message;
  } finally {
    writing = false;
    broadcast();
    if (!equivalent(lastActivity, presence.activity())) setTimeout(() => void publish(), 50).unref();
  }
}
function showWindow() {
  if (!window || window.isDestroyed()) createWindow();
  window.show(); window.focus(); app.dock?.show();
}
function createWindow() {
  window = new BrowserWindow({
    width: 460, height: 800, minWidth: 420, minHeight: 650,
    title: 'Frame', backgroundColor: '#101113', show: false,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 20 },
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.loadFile(uiPath);
  window.once('ready-to-show', () => window.show());
  window.on('close', event => {
    if (!quitting && !smoke) { event.preventDefault(); window.hide(); app.dock?.hide(); }
  });
}

function setupIpc() {
  const handle = (name, callback) => ipcMain.handle(`frame:${name}`, (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame.url !== pathToFileURL(uiPath).href) throw new Error('Untrusted app window.');
    return callback(...args);
  });
  handle('get-state', state);
  handle('save-settings', async input => {
    if (!input || typeof input !== 'object') throw new Error('Invalid settings.');
    const next = { ...presence.settings };
    for (const key of ['enabled', 'showButton', 'showArtwork', 'launchAtLogin']) if (typeof input[key] === 'boolean') next[key] = input[key];
    if ('clientId' in input) {
      const id = String(input.clientId).trim();
      if (id && !/^\d{17,22}$/.test(id)) throw new Error('Enter the 17–22 digit Application ID from Discord.');
      next.clientId = id;
    }
    const changedId = next.clientId !== presence.settings.clientId;
    store.settings = next;
    persist();
    presence.update(next);
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
    if (changedId) { discord.disconnect(); lastActivity = undefined; confirmedVideo = null; publishError = ''; }
    if (!smoke) void discord.connect(next.clientId);
    updateTray(); broadcast(); void publish();
    return state();
  });
  handle('pair-code', () => { const code = bridge.newCode(); broadcast(); return code; });
  handle('copy', text => {
    if (!['chrome://extensions', bridge.getCode()?.code].includes(text)) throw new Error('Cannot copy that value.');
    clipboard.writeText(text);
  });
  handle('open-portal', () => openChrome('https://discord.com/developers/applications'));
  handle('open-youtube', () => openChrome('https://www.youtube.com'));
  handle('open-video', () => { const video = presence.current(); if (video) return openChrome(video.url); });
  handle('extension-folder', async () => {
    const extension = path.join(app.getAppPath(), 'extension');
    if (!app.isPackaged) { await shell.openPath(extension); return extension; }
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose where to save the Chrome extension', buttonLabel: 'Save extension here',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled) return null;
    const destination = path.join(result.filePaths[0], 'Frame Chrome Extension');
    await fs.promises.cp(extension, destination, { recursive: true });
    await shell.openPath(destination);
    return destination;
  });
}
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Frame', click: showWindow },
    { type: 'separator' },
    { label: 'Share activity', type: 'checkbox', checked: presence.settings.enabled, click: item => {
      store.settings.enabled = item.checked; persist(); presence.update({ enabled: item.checked }); updateTray();
    } },
    { type: 'separator' },
    { label: 'Quit Frame', click: () => app.quit() },
  ]));
}

if (!app.requestSingleInstanceLock() && !smoke) app.quit();
else app.whenReady().then(async () => {
  try { store = JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch { store = {}; }
  store.settings = { ...defaults, ...store.settings };
  store.token = typeof store.token === 'string' && /^[a-f0-9]{64}$/.test(store.token) ? store.token : randomBytes(32).toString('hex');
  presence = new Presence(store.settings);
  discord = new Discord();
  bridge = createBridge({
    port: smoke ? 0 : undefined,
    getToken: () => store.token,
    saveToken: token => { store.token = token; store.paired = true; persist(); },
    onVideo: (source, video) => presence.accept(source, video),
    getStatus: () => ({ enabled: presence.settings.enabled, discord: discord.ready }),
    onPaired: broadcast,
  });
  try { await bridge.start(); }
  catch (error) { bridgeError = error.code === 'EADDRINUSE' ? 'Another app is using Frame’s local port (32145). Close it and restart Frame.' : `Chrome connection unavailable: ${error.message}`; }
  setupIpc();
  if (smoke) session.defaultSession.protocol.handle('https', () => new Response(
    fs.readFileSync(path.join(__dirname, '../tests/artwork.svg')), { headers: { 'Content-Type': 'image/svg+xml' } }
  ));
  createWindow();
  if (!smoke) {
    const image = nativeImage.createFromPath(path.join(__dirname, '../assets/tray.png'));
    image.setTemplateImage(true);
    tray = new Tray(image);
    tray.setToolTip('Frame · YouTube on Discord');
    tray.on('click', showWindow);
    updateTray();
  }
  presence.on('change', () => { broadcast(); void publish(); });
  discord.on('status', () => {
    if (discord.ready !== lastConnection) { lastConnection = discord.ready; lastActivity = undefined; confirmedVideo = null; publishError = ''; }
    broadcast(); void publish();
  });
  timer = setInterval(() => {
    if (!smoke) void discord.connect(presence.settings.clientId);
    broadcast(); void publish();
  }, 1000);
  if (!smoke) void discord.connect(presence.settings.clientId);
  else await smokeTest();
}).catch(error => { console.error(error); app.exit(1); });

app.on('second-instance', showWindow);
app.on('activate', () => { if (presence) showWindow(); });
app.on('window-all-closed', () => { /* Keep the menu-bar connection alive. */ });
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  clearInterval(timer);
  const stop = async () => {
    try { if (discord?.ready) await discord.setActivity(null); } catch { /* Socket closure also clears activity. */ }
    discord?.disconnect();
    if (bridge?.server.listening) await bridge.close();
    app.quit();
  };
  void stop();
  setTimeout(() => app.exit(0), 1800).unref();
});

async function smokeTest() {
  const output = path.join(app.getAppPath(), '.test-output');
  fs.mkdirSync(output, { recursive: true });
  const errors = [];
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  await new Promise(resolve => { if (!window.webContents.isLoading()) resolve(); else window.webContents.once('did-finish-load', resolve); });
  const wait = () => new Promise(resolve => setTimeout(resolve, 450));
  await wait();
  fs.writeFileSync(path.join(output, 'setup.png'), (await window.webContents.capturePage()).toPNG());
  const initial = await window.webContents.executeJavaScript(`({ title: document.title, bridge: typeof window.frame?.getState, text: document.body.innerText })`);
  if (initial.bridge !== 'function' || !initial.text.includes('Connect Discord')) throw new Error('Setup did not render.');
  const validation = await window.webContents.executeJavaScript(`window.frame.saveSettings({ clientId: 'invalid' }).then(() => false, () => true)`);
  if (!validation) throw new Error('Application ID validation failed.');
  presence.update({ clientId: '123456789012345678', enabled: true });
  store.paired = true;
  presence.accept('smoke:1', { id: 'dQw4w9WgXcQ', title: 'A little space to make something great', channel: 'The Creative Process', playing: true, position: 126, duration: 908, rate: 1 });
  discord.ready = true; discord.username = 'You'; confirmedVideo = 'dQw4w9WgXcQ';
  broadcast(); await wait();

  for (const width of [420, 600, 460]) {
    window.setSize(width, 800);
    await wait();
    const thumbnail = await window.webContents.executeJavaScript(`(() => {
      const image = document.querySelector('#video-artwork');
      const rect = document.querySelector('#artwork').getBoundingClientRect();
      return { ratio: rect.width / rect.height, fit: getComputedStyle(image).objectFit, visible: !image.hidden };
    })()`);
    if (Math.abs(thumbnail.ratio - 16 / 9) > 0.01 || thumbnail.fit !== 'contain' || !thumbnail.visible) {
      throw new Error('Thumbnail must remain fully visible in a 16:9 frame: ' + JSON.stringify(thumbnail));
    }
  }
  fs.writeFileSync(path.join(output, 'presence.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.querySelector('#sharing-toggle').click()`);
  await wait();
  if (presence.settings.enabled) throw new Error('Sharing toggle did not save.');
  await window.webContents.executeJavaScript(`document.querySelector('#sharing-toggle').click()`);
  await wait();
  await window.webContents.executeJavaScript(`document.querySelector('#settings-button').click()`);
  await wait();
  fs.writeFileSync(path.join(output, 'settings.png'), (await window.webContents.capturePage()).toPNG());
  const overflow = await window.webContents.executeJavaScript(`document.documentElement.scrollWidth > innerWidth`);
  const layout = await window.webContents.executeJavaScript(`({ artwork: document.querySelector('#video-artwork').naturalWidth, footer: document.querySelector('footer').getBoundingClientRect().bottom })`);
  if (overflow || errors.length || !layout.artwork || layout.footer > 800) throw new Error(`UI errors: ${JSON.stringify({ overflow, errors, layout })}`);
  console.log('Smoke test passed: setup, live presence, settings, preload bridge, and layout.');
  discord.ready = false;
  app.quit();
}
