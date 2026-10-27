const $ = selector => document.querySelector(selector);
let current, latestState, settingsOpen = false, setupForced = false, toastTimer;
let artworkVideoId = null, thumbnailIndex = 0;
const thumbnailSizes = ['maxresdefault', 'mqdefault'];
function loadThumbnail(video) {
  const id = video?.id || null;
  if (id === artworkVideoId) return;
  artworkVideoId = id;
  thumbnailIndex = 0;
  $('#video-artwork').hidden = true;
  $('#empty-artwork').hidden = false;
  if (!id) { $('#video-artwork').removeAttribute('src'); return; }
  $('#video-artwork').alt = `Thumbnail for ${video.title}`;
  $('#video-artwork').src = `https://i.ytimg.com/vi/${id}/${thumbnailSizes[0]}.jpg`;
}
function fallbackThumbnail() {
  if (!artworkVideoId) return;
  $('#video-artwork').hidden = true;
  $('#empty-artwork').hidden = false;
  if (++thumbnailIndex < thumbnailSizes.length) {
    $('#video-artwork').src = `https://i.ytimg.com/vi/${artworkVideoId}/${thumbnailSizes[thumbnailIndex]}.jpg`;
  }
}
const time = seconds => {
  const value = Math.max(0, Math.floor(seconds));
  return value >= 3600 ? `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
async function action(callback) { try { return await callback(); } catch (error) { toast(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } }
function setToggle(id, value) { $(id).setAttribute('aria-checked', String(value)); }
function showSettings(open) {
  settingsOpen = open;
  $('#home-view').hidden = open; $('#settings-view').hidden = !open;
  $('#settings-button').setAttribute('aria-expanded', String(open));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function render(state) {
  latestState = state; current = state;
  const { settings, video, discord, chrome, sharing } = state;
  setToggle('#sharing-toggle', settings.enabled);
  setToggle('#artwork-toggle', settings.showArtwork);
  setToggle('#button-toggle', settings.showButton);
  setToggle('#login-toggle', settings.launchAtLogin);
  $('#sharing-description').textContent = !settings.enabled ? 'Your presence is hidden' : sharing ? 'A little of you, now on Discord' : 'Only while a video is playing';
  $('#presence-dot').classList.toggle('active', sharing);
  $('#presence-label').textContent = !settings.enabled ? 'SHARING IS OFF' : sharing ? 'LIVE ON YOUR PROFILE' : video ? 'YOUR DISCORD PREVIEW' : 'YOUR DISCORD PRESENCE';
  document.body.classList.toggle('has-video', !!video);
  loadThumbnail(video);
  $('#video-badge').hidden = !video;
  $('#video-badge').textContent = !settings.enabled ? 'PRIVATE PREVIEW' : video?.live ? 'LIVE VIDEO' : 'WATCHING';
  $('#video-title').textContent = video?.title || 'Good videos. Good company.';
  $('#video-channel').textContent = video ? `by ${video.channel}` : 'Play something you love. We’ll take it from here.';
  $('#playback').hidden = !video || video.live || !video.duration;
  if (video?.duration) {
    $('#track-fill').style.width = `${Math.max(0, Math.min(100, video.position / video.duration * 100))}%`;
    $('#elapsed').textContent = time(video.position);
    $('#remaining').textContent = `${time((video.duration - video.position) / video.rate)} remaining`;
  }
  $('#watch-button').hidden = !video || !settings.showButton;
  const complete = !!settings.clientId && chrome.paired;
  document.body.classList.toggle('onboarding', !complete);
  $('#setup').hidden = complete && !setupForced;
  $('#ready-hint').hidden = !complete || setupForced;
  $('#setup-progress').textContent = `${Number(!!settings.clientId) + Number(chrome.paired)} / 2`;
  $('#discord-step-number').textContent = settings.clientId ? '✓' : '1';
  $('#discord-step-number').classList.toggle('done', !!settings.clientId);
  $('#chrome-step-number').textContent = chrome.paired ? '✓' : '2';
  $('#chrome-step-number').classList.toggle('done', chrome.paired);
  $('#discord-step-note').textContent = discord.connected ? 'Connected and ready' : settings.clientId ? 'ID saved · open Discord desktop' : 'Add your Application ID';
  $('#chrome-step-note').textContent = chrome.paired ? 'Paired with Chrome' : 'Link the lightweight extension';
  if (document.activeElement !== $('#client-id') && !$('#client-id').value) $('#client-id').value = settings.clientId;
  if (settings.clientId && !chrome.paired && !setupForced) { $('#discord-step').open = false; $('#chrome-step').open = true; }
  if (state.pairing) {
    $('#pair-code').textContent = state.pairing.code;
    $('#pair-code').classList.add('has-code');
    $('#pair-code').title = 'Click to copy code';
  } else {
    $('#pair-code').textContent = chrome.paired ? 'Pair again' : 'Get pairing code';
    $('#pair-code').classList.remove('has-code');
  }
  $('#discord-dot').className = `status-dot ${discord.connected ? 'active' : settings.clientId ? 'waiting' : ''}`;
  $('#chrome-dot').className = `status-dot ${chrome.active ? 'active' : chrome.paired ? 'waiting' : ''}`;
  $('#discord-status').textContent = discord.connected ? 'Discord connected' : settings.clientId ? 'Open Discord' : 'Discord';
  $('#discord-status').title = discord.message;
  $('#chrome-status').textContent = chrome.active ? 'Chrome connected' : chrome.paired ? 'Chrome paired' : 'Chrome';
  $('#error').textContent = state.error;
  $('#error').hidden = !state.error;
  $('#version').textContent = state.version;
}
$('#video-artwork').addEventListener('error', fallbackThumbnail);
$('#video-artwork').addEventListener('load', () => {
  if (!artworkVideoId) return;
  // YouTube can return a small placeholder instead of a missing-image error.
  if ($('#video-artwork').naturalWidth < 320) { fallbackThumbnail(); return; }
  $('#video-artwork').hidden = false;
  $('#empty-artwork').hidden = true;
});
$('#settings-button').addEventListener('click', () => showSettings(!settingsOpen));
$('#back-button').addEventListener('click', () => showSettings(false));
$('#sharing-toggle').addEventListener('click', () => action(async () => render(await window.frame.saveSettings({ enabled: !current.settings.enabled }))));
for (const [id, key] of [['#artwork-toggle', 'showArtwork'], ['#button-toggle', 'showButton'], ['#login-toggle', 'launchAtLogin']]) {
  $(id).addEventListener('click', () => action(async () => render(await window.frame.saveSettings({ [key]: !current.settings[key] }))));
}
$('#client-form').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    $('#save-client').disabled = true;
    try { render(await window.frame.saveSettings({ clientId: $('#client-id').value })); toast('Application ID saved. Open Discord desktop to connect.'); }
    finally { $('#save-client').disabled = false; }
  });
});
$('#portal-link').addEventListener('click', () => action(() => window.frame.openPortal()));
$('#extension-folder').addEventListener('click', () => action(() => window.frame.extensionFolder()));
$('#copy-extensions').addEventListener('click', () => action(async () => { await window.frame.copy('chrome://extensions'); toast('Address copied. Paste it into Chrome.'); }));
$('#pair-code').addEventListener('click', () => action(async () => {
  if (current.pairing) { await window.frame.copy(current.pairing.code); toast('Pairing code copied.'); }
  else { await window.frame.pairCode(); }
}));
$('#watch-button').addEventListener('click', () => action(() => window.frame.openVideo()));
$('#open-youtube').addEventListener('click', () => action(() => window.frame.openYouTube()));
$('#setup-again').addEventListener('click', () => { setupForced = true; showSettings(false); render(latestState); $('#discord-step').open = true; });
window.frame.onState(render);
action(async () => render(await window.frame.getState()));
