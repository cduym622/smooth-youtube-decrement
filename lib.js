var SYD_DEFAULT_DURATION_SECONDS = 20;

function sydIsYouTubeUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "www.youtube.com" || host === "youtube.com" || host === "m.youtube.com";
  } catch (err) {
    return false;
  }
}

function sydClampDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return SYD_DEFAULT_DURATION_SECONDS;
  return Math.min(90, Math.max(5, Math.round(value)));
}

// The isolated content script cannot call YouTube's player methods.
// injected.js does that from the page world, and content.js relays messages.
// A tab opened before the extension loaded has neither, so inject both.
async function sydSendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["injected.js"],
        world: "MAIN"
      });
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"]
      });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (inner) {
      return {
        ok: false,
        fading: false,
        message: "Refresh the YouTube tab, then try again."
      };
    }
  }
}
