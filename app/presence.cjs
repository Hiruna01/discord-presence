const { EventEmitter } = require('node:events');

const STALE_MS = 35_000;
const defaults = { clientId: '', enabled: true, showButton: true, showArtwork: true, launchAtLogin: false };
const cleanText = (value, max = 128) => typeof value === 'string'
  ? [...value.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, max).join('') : '';

function normalizeVideo(input) {
  if (!input || typeof input !== 'object' || !/^[\w-]{11}$/.test(input.id || '')) return null;
  const title = cleanText(input.title);
  if (!title) return null;
  return {
    id: input.id, title, channel: cleanText(input.channel) || 'YouTube',
    playing: input.playing === true,
    position: Number.isFinite(input.position) ? Math.max(0, input.position) : 0,
    duration: Number.isFinite(input.duration) && input.duration > 0 ? input.duration : 0,
    rate: Number.isFinite(input.rate) ? Math.min(16, Math.max(0.0625, input.rate)) : 1,
    live: input.live === true,
    url: `https://www.youtube.com/watch?v=${input.id}`,
    thumbnail: `https://i.ytimg.com/vi/${input.id}/hqdefault.jpg`,
  };
}

function makeActivity(video, settings, now = Date.now()) {
  if (!video || !video.playing || !settings.enabled) return null;
  const activity = {
    type: 3,
    details: video.title.length < 2 ? `${video.title} ` : video.title,
    state: cleanText(`by ${video.channel}`),
  };
  if (settings.showArtwork) activity.assets = { large_image: video.thumbnail, large_text: video.channel };
  if (settings.showButton) activity.buttons = [{ label: 'Watch on YouTube', url: video.url }];
  if (!video.live && video.duration > video.position) {
    activity.timestamps = {
      start: Math.floor(now / 1000 - video.position / video.rate),
      end: Math.floor(now / 1000 + (video.duration - video.position) / video.rate),
    };
  }
  return activity;
}

// A recent play action wins; a background tab's heartbeat cannot steal ownership.
class Presence extends EventEmitter {
  constructor(settings = {}, now = Date.now) {
    super();
    this.settings = { ...defaults, ...settings };
    this.now = now;
    this.sources = new Map();
    this.lastExtensionSeen = 0;
  }
  accept(source, input) {
    if (typeof source !== 'string' || source.length > 100) throw new Error('Invalid video source.');
    const now = this.now();
    this.lastExtensionSeen = now;
    const video = normalizeVideo(input);
    if (!video) this.sources.delete(source);
    else {
      const previous = this.sources.get(source);
      const started = video.playing && (!previous?.video.playing || previous.video.id !== video.id);
      this.sources.set(source, { video, seenAt: now, startedAt: started ? now : previous?.startedAt || now });
    }
    this.emit('change');
  }
  update(settings) { this.settings = { ...this.settings, ...settings }; this.emit('change'); }
  current() {
    const now = this.now();
    for (const [source, entry] of this.sources) if (now - entry.seenAt > STALE_MS) this.sources.delete(source);
    const active = [...this.sources.values()].filter(entry => entry.video.playing)
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    if (!active) return null;
    const video = { ...active.video };
    if (!video.live) video.position = Math.min(video.duration || Infinity,
      video.position + (now - active.seenAt) / 1000 * video.rate);
    if (!video.live && video.duration && video.position >= video.duration) return null;
    return video;
  }
  activity() { return makeActivity(this.current(), this.settings, this.now()); }
}

module.exports = { Presence, makeActivity, normalizeVideo, defaults, STALE_MS };
