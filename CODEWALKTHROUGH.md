# Code walkthrough

Smooth YouTube Decrement is a Manifest V3 extension for Chrome and Firefox. It lowers a playing YouTube video to silence in small steps, pauses the video, then puts the volume slider back to the level it had before the fade.

YouTube's player methods live on the page. A content script cannot call them. The extension therefore splits the work into three scripts that pass messages:

1. `background.js` or `popup.js` asks the active tab to start or stop a fade.
2. `content.js` receives that request, injects `injected.js` if needed, and forwards the request into the page.
3. `injected.js` talks to the YouTube player, runs the fade, and reports what happened.

`lib.js` holds the helpers that `background.js` and `popup.js` both use.

## How a fade starts

Pressing the shortcut or the popup button both end at the same page function, `start`.

1. The shortcut listener in `background.js`, or the button handler in `popup.js`, reads the saved fade length and calls `sydSendToTab` with `{ type: "toggle-fade", durationSeconds }`.
2. `content.js` hears that message on `chrome.runtime.onMessage`. It injects `injected.js`, waits until the page sets `data-syd-ready="1"`, then posts a `window` message whose `source` is `"syd-content"`.
3. `injected.js` hears that message and calls `start`. If a fade is already running, `start` stops it at the current volume. Otherwise it checks the video and begins the timer.
4. Each tick calls `apply`, which updates YouTube's integer slider only when the displayed percent changes, then sets the media element's volume to the fractional value.
5. When the fade reaches zero, `finish` pauses the video and restores the old slider position.
6. `injected.js` posts a reply whose `source` is `"syd-page"`. `content.js` shows a short note on the page and returns a status object to the popup.

Status checks use the same path with `type: "status"`. The page replies with whether a fade is in progress. It does not start one.

## manifest.json

This file tells the browser what to load.

`manifest_version` is 3. The name, version, description, and icons are the values shown in the browser's extension list.

`action` points the toolbar button at `popup.html` and the icons in `icons/`.

`background` lists both `scripts` and `service_worker`. Chrome loads `background.js` as a service worker and ignores `background.scripts`. Firefox loads `lib.js` and `background.js` as an event page. Firefox event pages do not provide `importScripts`, which is why `lib.js` is listed here and also imported from `background.js` when that function exists.

`permissions` are `storage` and `scripting`. Storage keeps the fade length. Scripting lets `sydSendToTab` inject `content.js` into a tab that was open before the extension loaded.

`host_permissions` and the content script `matches` are `www.youtube.com`, `youtube.com`, and `m.youtube.com`. YouTube Music is outside those hosts.

`commands.fade-out` suggests Alt+Shift+Down. The browser may assign a different shortcut if that one is taken. The popup reads the shortcut that is actually active.

The content script is `content.js`, and it runs at `document_start`, before YouTube finishes building the player. `web_accessible_resources` exposes `injected.js` so the content script can add it as a page script. A content script URL is not visible to the page unless it is listed there.

`browser_specific_settings.gecko` sets the Firefox add-on id to `smooth-youtube-decrement@localhost` and requires Firefox 121 or newer.

## lib.js

Shared by the popup and the background script. The popup loads it with a normal script tag. Chrome's service worker loads it with `importScripts`. Firefox loads it from `background.scripts`.

`SYD_DEFAULT_DURATION_SECONDS` is 20.

`sydIsYouTubeUrl(url)` parses the URL and returns true only for `www.youtube.com`, `youtube.com`, and `m.youtube.com`. A bad URL returns false.

`sydClampDuration(seconds)` turns the value into a number, rounds it, and keeps it between 5 and 90. A non-numeric value becomes 20. The page receives that rounded value. `injected.js` clamps again and leaves a fractional value unchanged.

`sydSendToTab(tabId, message)` sends the message to the content script with `chrome.tabs.sendMessage`. If that fails, it injects `content.js` with `chrome.scripting.executeScript` and sends the message again. A second failure returns `{ ok: false, fading: false, message: "Refresh the YouTube tab, then try again." }`. The helper talks only to the content script. `content.js` refuses to install twice, so a second injection is safe.

## background.js

The keyboard shortcut handler. It does not draw UI.

On Chrome, `importScripts` exists, so the file loads `lib.js` itself. On Firefox, `lib.js` is already loaded and `importScripts` is missing, so the call is skipped.

`chrome.commands.onCommand` listens for `"fade-out"`. It queries the active tab in the last focused window, ignores the command when that tab is not a YouTube URL, reads `durationSeconds` from `chrome.storage.local`, clamps it, and sends `{ type: "toggle-fade", durationSeconds }` through `sydSendToTab`.

The shortcut does not open the popup. The on-page note in `content.js` is what the user sees after using the keys.

## content.js

Runs in the extension's isolated world on each YouTube page. It cannot call `setVolume` or `pauseVideo`. Its job is to install the page script, carry messages across the boundary, and show a note.

The file is wrapped in an IIFE. `globalThis.__sydContentLoaded` stops a second copy from installing listeners. `sydSendToTab` can inject this file into a tab that already ran it.

`serial` numbers each request. `noteTimer` is the timeout that removes the on-page note.

### injectPageScript

Creates a `<script src="...injected.js">` on `document.documentElement`. `chrome.runtime.getURL` builds the extension URL. The script tag is removed in `onload` after the browser has run the file. Removing the tag does not unload the script.

`data-syd-injected="1"` marks that an injection is in progress or has succeeded. `data-syd-ready="1"` means `injected.js` finished its setup. If either flag is set, this function returns. `onerror` clears `data-syd-injected` and removes the tag so a later request can try again.

The function runs once at the bottom of the file, and again whenever a popup or background message arrives.

### waitForReady

Returns a promise that resolves true when `data-syd-ready` is `"1"`. It polls every 20 milliseconds and resolves false after 1500 milliseconds. Callers treat false as "refresh the tab".

### noteText and popupPayload

`noteText` turns a page message into the sentence shown on the video page.

| `data.type` | Note |
| --- | --- |
| `started` | Fading to silence over N seconds. |
| `done` | Paused, and the slider is back at the saved percent. |
| `stopped` | Fade stopped at the current percent. |
| `error` | A reason string, listed below. |

`data.quiet` produces an empty string, so a stop caused by the volume slider or the arrow keys does not show a note.

Error reasons from `injected.js`:

| `reason` | Note |
| --- | --- |
| `no-video` | No YouTube video is on this page. |
| `paused` | The video is paused, so there is no sound to turn down. |
| `muted` | The video is muted. |
| `silent` | Volume is already at zero. |
| `lost-video` | The video changed, the fade stopped, and the previous volume was put back. |
| anything else | Could not fade this video. |

`popupPayload` is the object sent back to `popup.js`. `started` sets `ok` and `fading` to true. `stopped` sets `ok` to true and `fading` to false. `error` sets both to false and uses `noteText` as `message`. A missing reply asks the user to refresh the tab.

### showNote

Builds one `#syd-note-host` element, attaches an open shadow root, and puts the text in a `.box` inside that root. The shadow root keeps YouTube's styles off the note. The host uses `position: fixed`, centered near the top, with the maximum 32-bit z-index. In fullscreen it switches to `position: absolute` and moves into `document.fullscreenElement` or `document.webkitFullscreenElement`, so the note stays on the video. A click removes it. Otherwise it stays for 5 seconds.

### askPage

Posts `{ source: "syd-content", type, durationSeconds, requestId }` to `window`, then waits for a `message` event whose `source` is `"syd-page"` and whose `requestId` matches. The origin and `event.source` must be this window. The wait times out after 1000 milliseconds and resolves null.

### Listeners

The `window` `"message"` listener shows a note for `started`, `done`, `stopped`, and `error`. Those posts come from the page on their own, including the `done` message at the end of a fade, which has no matching popup request.

The `chrome.runtime.onMessage` listener accepts `toggle-fade` and `status`. It returns `true` so `sendResponse` can run later, after `waitForReady` and `askPage`. A status reply is `{ ok, fading, message }`. A toggle reply is `popupPayload`.

## injected.js

Runs as a page script, in the same world as YouTube's player. The file is an IIFE. `window.__sydPageLoaded` stops a second copy. At the end it sets `document.documentElement.dataset.sydReady` to `"1"`, which is the flag `waitForReady` looks for.

`TICK_MS` is 16, so the fade updates about 60 times a second. `DEFAULT_DURATION_SECONDS` is 20. `fade` is the current fade record, or null. `timer` is the pending `setTimeout` id. `lastAppliedInt` is the last whole percent sent to `setVolume`, or -1 when the next call must send one anyway.

### post

Sends `window.postMessage` with `source: "syd-page"` added to the payload. `content.js` is the only listener that acts on that source.

### player, playerFor, and videoEl

`player` returns `#movie_player`, the node YouTube attaches `setVolume`, `getVolume`, `pauseVideo`, and `isMuted` to.

`playerFor(video)` returns that node when it contains the video. It also returns the node when the video has the class `html5-main-video`. Otherwise it returns null. The check exists because a paused `#movie_player` can sit on the same page as a different playing video, and the fade should drive the player that owns the video it found.

`videoEl` returns `fade.video` when a fade is running and that element is still connected. Otherwise it searches, in order:

1. `#movie_player video.html5-main-video`
2. `video.html5-main-video`
3. `#shorts-player video`
4. `#movie_player video`
5. `video`

Duplicates are skipped. A video that is playing and has not ended wins. If none is playing, the first match is returned.

### clampPercent and clampDuration

`clampPercent` keeps a percent between 0 and 100.

`clampDuration` keeps a duration between 5 and 90 seconds. A non-numeric value becomes 20. It does not round, because `lib.js` already stored a whole number.

### apply and forceApply

`apply(percent, force, videoOverride)` is the volume write.

YouTube's slider and saved volume use whole percents. The media element accepts fractions between those marks. Writing the integer on every tick would wipe the fraction. `apply` therefore calls `player.setVolume` only when the rounded percent changed, or when `force` is true, and then sets `video.volume` to `clamped / 100`.

```javascript
if (node && typeof node.setVolume === "function" && (force || rounded !== lastAppliedInt)) {
  node.setVolume(rounded);
  lastAppliedInt = rounded;
}
if (video) video.volume = clamped / 100;
```

`forceApply` sets `lastAppliedInt` to -1 and calls `apply` with `force` true, so the next integer is sent even if it matches the last one.

### readState

Reads the player and the video element. It prefers `player.getVolume()` for the percent, and falls back to `video.volume * 100`. Muted is true if the player reports muted or the element is muted. Playing is true when the element exists, is not paused, and has not ended. The return value is `{ percent, muted, playing, video }`. `percent` may be null when neither source has a number.

### clearFade and stopAtCurrent

`clearFade` cancels the timer and sets `fade` to null.

`stopAtCurrent(quiet)` reads the current percent, clears the fade, and posts `type: "stopped"`. `quiet` true tells `content.js` to skip the on-page note. The popup toggle passes `quiet` false, and that stop shows a note.

### finish

Runs when the fade reaches silence. The order matters. YouTube stores one volume. Leaving the slider at zero would make the next video start silent. The pause has to happen while the sound is already at zero, and the old level is written back only after playback has stopped.

`finish(originalPercent, wasMuted, video)` does this:

1. `forceApply(0, video)`.
2. `video.pause()`, then `player.pauseVideo()` when that method exists.
3. `forceApply(originalPercent, video)`.
4. If the fade did not start muted and the player is now muted, call `unMute`.
5. Pause again if the element is still playing, or if `getPlayerState()` returns 1, which is YouTube's playing state.
6. Post `{ type: "done", volume }` with the restored percent.

The video stays quiet because it is paused. Pressing play uses the restored level.

### tick

The fade loop. If `fade` is null, it returns. If `fade.video` is no longer connected, it clears the fade, writes the original whole percent with `setVolume`, and posts `error` with reason `lost-video`.

Otherwise it computes `t` as elapsed time divided by `fade.durationMs`, capped at 1. At `t >= 1` it clears the fade and calls `finish`. Before that, the volume for this frame is:

```javascript
apply(fade.originalPercent * (1 - t), false);
```

That is a straight line from the starting percent to zero. The next tick is scheduled with `setTimeout(tick, TICK_MS)`.

### start

`start(durationSeconds, requestId)` is the toggle.

If `fade` is already set, it reads the current volume, clears the fade, posts `stopped`, and returns. A second shortcut press or a second button click during a fade takes this path. The volume stays where it is, and the video keeps playing.

If no fade is running, it refuses to start in four cases, each posted as `error` with the matching `requestId`:

| Condition | `reason` |
| --- | --- |
| No video element | `no-video` |
| Video is paused or ended | `paused` |
| Player or element is muted | `muted` |
| Percent is missing or zero | `silent` |

A valid start stores:

```javascript
fade = {
  video: state.video,
  originalPercent: state.percent,
  wasMuted: state.muted,
  startTime: performance.now(),
  durationMs: seconds * 1000
};
```

`lastAppliedInt` is set to the rounded starting percent so the first tick does not rewrite the same integer. It posts `started`, then schedules `tick`.

### Page listeners

The `window` `"message"` listener accepts only events from this window whose `source` is `"syd-content"`. `toggle-fade` calls `start`. `status` posts `{ type: "status", fading, volume }` and does not change playback.

Two capture-phase listeners stop a fade when the user takes the volume back.

`pointerdown` on `.ytp-volume-area`, `.ytp-volume-panel`, or `.ytp-volume-slider` calls `stopAtCurrent(true)`.

`keydown` for ArrowUp or ArrowDown does the same, but only when Alt, Shift, Meta, and Ctrl are all up. Modified arrows are ignored so Alt+Shift+Down can still reach the extension command and toggle the fade.

## popup.html

The toolbar popup. It loads `popup.css`, then `lib.js`, then `popup.js`.

The body contains a short description, a range input `#duration` from 5 to 90 with step 1 and a default of 20, a label `#duration-value`, a button `#fade-button`, a status paragraph `#status`, and a shortcut line `#shortcut`. The hint under the shortcut tells the user that a second press stops the fade, and that the keys are changed in the browser's extension shortcut settings.

## popup.css

Dark popup, 320 pixels wide, 13px system UI. Colors are CSS variables on `:root`: background `#171717`, text `#f2f2f2`, muted `#a3a3a3`, button white on near-black, accent `#e0b15a`, and error text `#e7b3a2`.

The duration row is a flex line. The range grows, and `#duration-value` keeps a fixed width with tabular numbers so the label does not shift as the digits change. The button is full width. `:focus-visible` draws a 2px accent outline. `#status` reserves `min-height: 2.9em` so the popup does not jump when a message appears. `#status.error` uses the danger color. The shortcut uses a monospace font.

## popup.js

Reads the DOM nodes for the slider, the slider label, the button, the status line, and the shortcut line. `onYouTube` records whether the active tab was a YouTube page when the popup opened.

`setDurationLabel` writes "1 second" or "N seconds".

`setStatus(message, ok)` writes the status text and adds the `error` class when there is a message and `ok` is false.

`setFading` switches the button between "Stop fade" and "Fade out".

`loadShortcut` calls `chrome.commands.getAll`, finds the command named `fade-out`, and shows its `shortcut`. An empty shortcut becomes "No shortcut set".

`init` loads `durationSeconds` from `chrome.storage.local`, clamps it, and fills the slider. It then checks the active tab in the current window. Off YouTube, the button is disabled and the status says to open a playing video. On YouTube, it sends `{ type: "status" }` through `sydSendToTab` and updates the button if a fade is already running. It always loads the shortcut last.

The slider's `input` handler clamps the value, updates the label, and writes `durationSeconds` to local storage. The background script reads that same key when the shortcut fires.

The button handler returns immediately when `onYouTube` is false. It re-checks the active tab, saves the duration, disables the button, and sends `toggle-fade`. The response sets the button label and the status text, then the button is enabled again.

`init()` runs as the popup opens.

## Icons and gitignore

`icons/` holds `icon16.png`, `icon32.png`, `icon48.png`, and `icon128.png`. The manifest uses 16, 32, and 48 for the toolbar, and all four for the extension listing.

`.gitignore` ignores `.DS_Store`.
