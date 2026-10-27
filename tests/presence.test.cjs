const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Presence, normalizeVideo, makeActivity, STALE_MS } = require('../app/presence.cjs');
const video = { id: 'dQw4w9WgXcQ', title: 'A beautiful video', channel: 'A creator', playing: true, position: 60, duration: 300, rate: 1 };

test('normalizes metadata and constructs only canonical YouTube URLs', () => {
  assert.equal(normalizeVideo({ ...video, url: 'javascript:alert(1)' }).url, `https://www.youtube.com/watch?v=${video.id}`);
  assert.equal(normalizeVideo({ ...video, id: '<script>' }), null);
  assert.equal(normalizeVideo({ ...video, title: '' }), null);
  assert.equal(normalizeVideo({ ...video, title: ' x\n\x00y ' }).title, 'xy');
  assert.equal(normalizeVideo({ ...video, position: Infinity }).position, 0);
});
test('builds Watching activity with artwork, button, and playback-rate-aware timing', () => {
  const activity = makeActivity(normalizeVideo({ ...video, rate: 2 }), { enabled: true, showArtwork: true, showButton: true }, 1_000_000);
  assert.equal(activity.type, 3);
  assert.equal(activity.details, video.title);
  assert.equal(activity.state, 'by A creator');
  assert.equal(activity.timestamps.start, 970);
  assert.equal(activity.timestamps.end, 1120);
  assert.equal(activity.buttons[0].label, 'Watch on YouTube');
  assert.match(activity.assets.large_image, /^https:\/\/i\.ytimg\.com\//);
});
test('privacy toggles remove presence, artwork and links; live videos have no countdown', () => {
  const normalized = normalizeVideo(video);
  assert.equal(makeActivity(normalized, { enabled: false }), null);
  assert.equal(makeActivity({ ...normalized, playing: false }, { enabled: true }), null);
  const activity = makeActivity({ ...normalized, live: true }, { enabled: true, showArtwork: false, showButton: false });
  assert.equal(activity.timestamps, undefined);
  assert.equal(activity.assets, undefined);
  assert.equal(activity.buttons, undefined);
});
test('latest playing tab wins; an older heartbeat cannot steal ownership', () => {
  let now = 1_000_000;
  const presence = new Presence({}, () => now);
  presence.accept('one', video);
  now += 1000;
  presence.accept('two', { ...video, id: 'abcdefghijk' });
  now += 1000;
  presence.accept('one', { ...video, position: 62 });
  assert.equal(presence.current().id, 'abcdefghijk');
  presence.accept('two', { ...video, id: 'abcdefghijk', playing: false });
  assert.equal(presence.current().id, video.id);
  presence.accept('one', null);
  assert.equal(presence.current(), null);
});
test('closing, stale tabs and ended videos clear activity; seeking updates timing', () => {
  let now = 1_000_000;
  const presence = new Presence({}, () => now);
  presence.accept('one', video);
  now += 2000;
  assert.equal(presence.current().position, 62);
  presence.accept('one', { ...video, position: 200 });
  assert.equal(presence.activity().timestamps.end, 1102);
  now += STALE_MS + 1;
  assert.equal(presence.activity(), null);
  presence.accept('one', { ...video, position: 299 });
  now += 1500;
  assert.equal(presence.current(), null);
});
