(() => {
  let scheduled, navigating = false;
  const text = selectors => {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.textContent?.trim();
      if (value) return value;
    }
    return '';
  };
  function snapshot() {
    const url = new URL(location.href);
    const short = /^\/shorts\//.test(url.pathname);
    const id = short ? url.pathname.split('/')[2] : url.pathname === '/watch' ? url.searchParams.get('v') : null;
    if (navigating || !/^[\w-]{11}$/.test(id || '')) return null;
    const video = short
      ? document.querySelector('ytd-reel-video-renderer[is-active] video') || document.querySelector('ytd-reel-video-renderer[active] video')
      : document.querySelector('#movie_player video.html5-main-video') || document.querySelector('video.html5-main-video');
    if (!video || video.readyState < 2 || document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting')) return null;
    const title = (short
      ? text(['ytd-reel-video-renderer[is-active] h2', 'ytd-reel-video-renderer[is-active] #video-title', 'ytd-reel-video-renderer[active] h2'])
      : text(['ytd-watch-metadata h1 yt-formatted-string', 'ytd-watch-metadata h1', '#info-contents h1']))
      || document.title.replace(/(?:\s*[-–|]\s*YouTube)$/, '').replace(/^\(\d+\)\s*/, '').trim();
    const channel = short
      ? text(['ytd-reel-video-renderer[is-active] ytd-channel-name', 'ytd-reel-video-renderer[is-active] .ytReelChannelBarViewModelChannelName', 'ytd-reel-video-renderer[active] ytd-channel-name'])
      : text(['ytd-watch-metadata #owner #channel-name a', 'ytd-video-owner-renderer #channel-name a', '#owner ytd-channel-name']);
    return {
      id, title, channel, playing: !video.paused && !video.ended,
      position: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0,
      rate: video.playbackRate,
      live: !Number.isFinite(video.duration) || !!document.querySelector('.ytp-live-badge:not([disabled])'),
    };
  }
  function send() {
    clearTimeout(scheduled);
    try { chrome.runtime.sendMessage({ type: 'VIDEO', video: snapshot() }).catch(() => {}); }
    catch { /* Extension updates invalidate old content-script contexts. */ }
  }
  function schedule() { clearTimeout(scheduled); scheduled = setTimeout(send, 200); }
  for (const event of ['play', 'pause', 'ended', 'seeked', 'ratechange', 'loadedmetadata', 'emptied']) document.addEventListener(event, schedule, true);
  document.addEventListener('yt-navigate-start', () => { navigating = true; send(); });
  document.addEventListener('yt-navigate-finish', () => { navigating = false; schedule(); });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pagehide', () => {
    try { chrome.runtime.sendMessage({ type: 'VIDEO', video: null }).catch(() => {}); } catch { /* Page is going away. */ }
  });
  setInterval(send, 5000);
  send();
})();
