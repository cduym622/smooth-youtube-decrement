# Smooth YouTube Decrement

Browser extension for Chrome and Firefox. It turns a playing YouTube video down to silence in small steps, then pauses the video.

This is for listening with noise-cancelling headphones, when a hard pause is harsher than a slow drop in volume.

## Install in Firefox
This extension has been approved by Mozilla and can be installed through the Firefox add-on manager, through the link below.
https://addons.mozilla.org/en-US/firefox/addon/smooth-youtube-sound-decrement/

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked.
4. Select this folder.

Then refresh any YouTube tab that was already open.

## Use

Open a YouTube video and start playback. Click the toolbar button and choose Fade out, or press Alt+Shift+Down.

The fade length defaults to 20 seconds. The popup slider runs from 5 seconds to 90 seconds. The sound moves about 60 times a second. YouTube's on-screen slider still ticks in steps of 1%, which is the smallest mark that slider has.

When the fade finishes, the video pauses. The slider then returns to the volume from before the fade. The video stays quiet because it is paused. Press play and the sound returns at that same level.

YouTube keeps a single saved volume. Leaving the slider at zero would make the next video start silent. The pause happens while the sound is already at zero, and only then does the slider move back.

Press the shortcut again during a fade to stop early. The volume stays where it is, and the video keeps playing. Dragging the volume slider, or pressing the plain up or down arrow, also stops the fade.

If something else already uses Alt+Shift+Down, pick another shortcut on the browser's extension shortcut page. The popup shows the shortcut that is actually active.

The extension runs on youtube.com. It does not run on YouTube Music.

For a more detailed rundown of the code, see `CODEWALKTHROUGH.md`.
