// Chrome loads this file as a service worker and ignores background.scripts.
// Firefox loads lib.js and this file as an event page, where importScripts
// does not exist.
if (typeof importScripts === "function") {
  importScripts("lib.js");
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "fade-out") return;

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.id || !sydIsYouTubeUrl(tab.url)) return;

  const stored = await chrome.storage.local.get({
    durationSeconds: SYD_DEFAULT_DURATION_SECONDS
  });

  await sydSendToTab(tab.id, {
    type: "toggle-fade",
    durationSeconds: sydClampDuration(stored.durationSeconds)
  });
});
