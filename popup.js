const durationInput = document.getElementById("duration");
const durationValue = document.getElementById("duration-value");
const fadeButton = document.getElementById("fade-button");
const statusEl = document.getElementById("status");
const shortcutEl = document.getElementById("shortcut");

let onYouTube = false;

function setDurationLabel(seconds) {
  durationValue.textContent = seconds + (seconds === 1 ? " second" : " seconds");
}

function setStatus(message, ok) {
  statusEl.textContent = message || "";
  statusEl.classList.toggle("error", Boolean(message) && ok === false);
}

function setFading(fading) {
  fadeButton.textContent = fading ? "Stop fade" : "Fade out";
}

async function loadShortcut() {
  const commands = await chrome.commands.getAll();
  const fade = commands.find((command) => command.name === "fade-out");
  shortcutEl.textContent = fade && fade.shortcut ? fade.shortcut : "No shortcut set";
}

async function init() {
  const stored = await chrome.storage.local.get({
    durationSeconds: SYD_DEFAULT_DURATION_SECONDS
  });
  const seconds = sydClampDuration(stored.durationSeconds);
  durationInput.value = String(seconds);
  setDurationLabel(seconds);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  onYouTube = Boolean(tab && tab.id && sydIsYouTubeUrl(tab.url));
  fadeButton.disabled = !onYouTube;
  if (!onYouTube) {
    setStatus("Open a playing YouTube video first.", false);
  } else {
    const response = await sydSendToTab(tab.id, { type: "status" });
    if (response) {
      setFading(Boolean(response.fading));
      if (response.message) setStatus(response.message, response.ok);
    }
  }

  await loadShortcut();
}

durationInput.addEventListener("input", () => {
  const seconds = sydClampDuration(durationInput.value);
  setDurationLabel(seconds);
  chrome.storage.local.set({ durationSeconds: seconds });
});

fadeButton.addEventListener("click", async () => {
  if (!onYouTube) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !sydIsYouTubeUrl(tab.url)) {
    setStatus("Open a playing YouTube video first.", false);
    return;
  }

  const seconds = sydClampDuration(durationInput.value);
  await chrome.storage.local.set({ durationSeconds: seconds });
  fadeButton.disabled = true;

  const response = await sydSendToTab(tab.id, {
    type: "toggle-fade",
    durationSeconds: seconds
  });

  fadeButton.disabled = false;
  setFading(Boolean(response && response.fading));
  setStatus(response && response.message, response ? response.ok : false);
});

init();
