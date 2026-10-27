# Frame

A tiny Mac menu-bar app that shares your current **YouTube video on Discord**, with a thumbnail, creator name, playback timing, and a **Watch on YouTube** button. Built for **Google Chrome** and Discord desktop.

## Start here

1. Open **Frame.app** in `dist/Frame-darwin-arm64` (or `Frame-darwin-x64` on an Intel Mac). You can move the app into Applications.
2. Keep **Discord desktop** open and signed in.
3. Follow the two setup steps in Frame below. This is only needed once.

### 1. Connect Discord

- Open the [Discord Developer Portal](https://discord.com/developers/applications), sign in, and choose **New Application**.
- Name it **YouTube**. Discord uses this application name in the presence heading.
- Under **General Information**, copy the **Application ID** and paste it into Frame. Click **Connect**.
- In Discord, open **User Settings → Activity Privacy** and enable sharing your activity. Discord may also offer activity sharing controls per server.

You do **not** need a bot, account token, client secret, OAuth redirect, or paid Discord plan. Frame uses Discord’s local Rich Presence connection.

### 2. Add the Chrome extension

- Open **chrome://extensions** in Google Chrome.
- Turn on **Developer mode** in the top-right corner.
- Click **Load unpacked** and choose **Frame Chrome Extension** from `dist`. Keep that folder in a permanent location; Chrome reads the extension from there. Alternatively use **Open extension folder** in Frame (the packaged app can save a copy wherever you choose).
- Open Chrome’s extensions menu (the puzzle icon), find **Frame**, and pin it.
- In Frame, expand **Add to Chrome** and click **Get pairing code**.
- Click Frame’s icon in Chrome, enter the six-digit code, and click **Pair**.
- Refresh any YouTube tabs that were already open, then play a video.

The code lasts ten minutes and works once. Re-pairing replaces the old connection.

## Everyday use

- Watch videos on **youtube.com** in Chrome as usual. Regular videos and YouTube Shorts are supported; YouTube Music is outside this version’s scope.
- The latest tab that starts playing takes priority. If it stops, another playing YouTube tab can take over.
- Presence clears when playback pauses, ends, switches to an ad, or the tab closes. If Chrome disappears unexpectedly, the connection expires after about 35 seconds.
- Playback timing accounts for seeking and speed changes. Live videos have no countdown.
- Use **Share activity** in Frame or its menu-bar menu to hide your presence immediately.
- Close the window to keep Frame running in the menu bar. Choose **Quit Frame** from its menu to stop it.
- Open Settings to hide artwork or the watch button, or enable **Start with your Mac** in the packaged app.

## How the presence looks

Frame supplies Discord with a **Watching** activity, video title, creator, thumbnail, playback timestamps, and a video link. Discord controls the final layout and may display playback time differently between clients. The Frame window is a styled preview of those details, rather than a pixel-perfect copy of Discord. Your own Discord profile may not show the link button; check from a friend’s account if needed. External thumbnail rendering also depends on Discord’s client support.

## Privacy

The extension reads video details only on YouTube in regular Chrome windows. Private browsing is disabled for this extension. No viewing history or video titles are written to disk. No analytics or cloud server is used. Video details are sent to the Discord client for your public presence; Discord and Frame may request the public thumbnail from YouTube.

The extension pairs with a local-only listener at `127.0.0.1:32145`. Requests require the pairing token, except health checks and code pairing. Web-page origins are rejected, pairing guesses are rate-limited, and the bridge accepts only small JSON messages. The app stores preferences and the local pairing credential under `~/Library/Application Support/Frame/`, and Chrome stores its copy in extension storage.

## If something needs a nudge

- **Open Discord:** use the desktop app, not the browser version. Frame reconnects automatically.
- **No activity on your profile:** check Discord’s Activity Privacy settings and the Share activity toggle in Frame. Allow a few seconds for updates. Verify the Application ID belongs to the application you created.
- **Chrome says to open Frame:** launch Frame, then click **Try connecting again** in the extension.
- **No video detected:** refresh the YouTube tab after installing/reloading the extension. Pause and resume the video. Chrome’s YouTube site access must be allowed for Frame.
- **Pairing error:** request a new code in Frame and try again. Too many incorrect guesses cause a one-minute wait.
- **Port in use:** close another copy of Frame or the app using port 32145, then restart.

## Develop

Requires Node.js 22.12+ and npm. Electron supplies the desktop runtime. The app’s connection logic uses Node’s standard library; the extension needs no build step.

```sh
npm install
npm start
```

Load `extension/` directly in Chrome during development. Make a Discord application as described above.

```sh
npm run check    # Syntax, JSON, extension assets
npm test         # Presence, local bridge, extension relay, and Discord socket tests
npm run smoke    # Isolated desktop UI smoke test; never publishes to Discord
npm run build    # Package for this Mac, plus a standalone extension folder
```

The smoke test uses a temporary settings directory, a random local port, and synthetic playback. It does not connect to Discord or read Chrome. Screenshots are saved to `.test-output/`. `npm run assets` recreates the code-drawn icons using Python 3 and macOS’s built-in icon tools.

The build is a local, unsigned Mac application. Signing and notarization are needed before distributing it broadly.

## References

- [Discord RPC over IPC](https://discord.com/developers/docs/topics/rpc)
- [Discord Rich Presence without authentication](https://discord.com/developers/docs/discord-social-sdk/development-guides/setting-rich-presence)
- [Chrome extension cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

## License

MIT. Frame is an independent personal project, unaffiliated with YouTube or Discord.
