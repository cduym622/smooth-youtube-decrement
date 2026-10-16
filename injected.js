// Runs in the page world so it can call the YouTube player API.
// A content script cannot see setVolume or pauseVideo. Those are added by
// YouTube's own scripts, and extension content scripts live in a separate world.
(function () {
  if (window.__sydPageLoaded) return;
  window.__sydPageLoaded = true;

  const TICK_MS = 16;
  const DEFAULT_DURATION_SECONDS = 20;

  let fade = null;
  let timer = 0;
  let lastAppliedInt = -1;

  function post(message) {
    window.postMessage(Object.assign({ source: "syd-page" }, message), window.location.origin);
  }

  function player() {
    return document.getElementById("movie_player");
  }

  // Only the player that actually contains this video. A paused movie_player
  // can sit on the same page as a different playing video.
  function playerFor(video) {
    const node = player();
    if (!node || !video) return null;
    if (node.contains(video)) return node;
    if (video.classList && video.classList.contains("html5-main-video")) return node;
    return null;
  }

  function videoEl() {
    if (fade && fade.video && fade.video.isConnected) return fade.video;

    const selectors = [
      "#movie_player video.html5-main-video",
      "video.html5-main-video",
      "#shorts-player video",
      "#movie_player video",
      "video"
    ];
    const seen = [];
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((video) => {
        if (seen.indexOf(video) === -1) seen.push(video);
      });
    });
    const playing = seen.find((video) => !video.paused && !video.ended);
    return playing || seen[0] || null;
  }

  function clampPercent(percent) {
    return Math.max(0, Math.min(100, percent));
  }

  function clampDuration(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value)) return DEFAULT_DURATION_SECONDS;
    return Math.min(90, Math.max(5, value));
  }

  // YouTube's slider and saved volume use whole percents. The media element
  // accepts fractions between those marks. Set the slider only when the
  // displayed percent changes, then set the precise gain afterward so the
  // integer update does not wipe the fraction.
  function apply(percent, force, videoOverride) {
    const clamped = clampPercent(percent);
    const rounded = Math.round(clamped);
    const video = videoOverride || videoEl();
    const node = playerFor(video);

    if (node && typeof node.setVolume === "function" && (force || rounded !== lastAppliedInt)) {
      node.setVolume(rounded);
      lastAppliedInt = rounded;
    }
    if (video) video.volume = clamped / 100;
  }

  function forceApply(percent, videoOverride) {
    lastAppliedInt = -1;
    apply(percent, true, videoOverride);
  }

  function readState() {
    const video = videoEl();
    const node = playerFor(video);
    let percent = null;
    let muted = false;
    let playing = false;

    if (node && typeof node.getVolume === "function") {
      const volume = node.getVolume();
      if (typeof volume === "number" && !Number.isNaN(volume)) percent = volume;
    }
    if (node && typeof node.isMuted === "function") muted = Boolean(node.isMuted());

    if (video) {
      if (percent == null) percent = Math.round(video.volume * 100);
      muted = muted || video.muted;
      playing = !video.paused && !video.ended;
    }

    return {
      percent: percent,
      muted: muted,
      playing: playing,
      video: video
    };
  }

  function clearFade() {
    if (timer) window.clearTimeout(timer);
    timer = 0;
    fade = null;
  }

  function stopAtCurrent(quiet) {
    const state = readState();
    clearFade();
    post({
      type: "stopped",
      volume: state.percent == null ? 0 : Math.round(state.percent),
      quiet: Boolean(quiet),
      requestId: null
    });
  }

  // Reach silence, pause, then put the previous volume back.
  // YouTube stores one volume for the account. Leaving it at zero would
  // make the next video start silent. Volume is set to zero before the
  // pause, and the old level is restored only after playback has stopped.
  function finish(originalPercent, wasMuted, video) {
    const node = playerFor(video);

    forceApply(0, video);
    if (video) video.pause();
    if (node && typeof node.pauseVideo === "function") node.pauseVideo();

    forceApply(originalPercent, video);
    if (!wasMuted && node && typeof node.isMuted === "function" && node.isMuted()) {
      if (typeof node.unMute === "function") node.unMute();
    }

    if (video && !video.paused) video.pause();
    if (node && typeof node.getPlayerState === "function" && node.getPlayerState() === 1) {
      if (typeof node.pauseVideo === "function") node.pauseVideo();
    }

    post({
      type: "done",
      volume: Math.round(originalPercent),
      requestId: null
    });
  }

  function tick() {
    timer = 0;
    if (!fade) return;

    if (!fade.video.isConnected) {
      const original = fade.originalPercent;
      clearFade();
      const node = player();
      if (node && typeof node.setVolume === "function") node.setVolume(Math.round(original));
      post({ type: "error", reason: "lost-video", requestId: null });
      return;
    }

    const elapsed = performance.now() - fade.startTime;
    const t = Math.min(1, elapsed / fade.durationMs);
    if (t >= 1) {
      const original = fade.originalPercent;
      const wasMuted = fade.wasMuted;
      const video = fade.video;
      clearFade();
      finish(original, wasMuted, video);
      return;
    }

    apply(fade.originalPercent * (1 - t), false);
    timer = window.setTimeout(tick, TICK_MS);
  }

  function start(durationSeconds, requestId) {
    if (fade) {
      const state = readState();
      clearFade();
      post({
        type: "stopped",
        volume: state.percent == null ? 0 : Math.round(state.percent),
        quiet: false,
        requestId: requestId
      });
      return;
    }

    const state = readState();
    if (!state.video) {
      post({ type: "error", reason: "no-video", requestId: requestId });
      return;
    }
    if (!state.playing) {
      post({ type: "error", reason: "paused", requestId: requestId });
      return;
    }
    if (state.muted) {
      post({ type: "error", reason: "muted", requestId: requestId });
      return;
    }
    if (!state.percent) {
      post({ type: "error", reason: "silent", requestId: requestId });
      return;
    }

    const seconds = clampDuration(durationSeconds);
    fade = {
      video: state.video,
      originalPercent: state.percent,
      wasMuted: state.muted,
      startTime: performance.now(),
      durationMs: seconds * 1000
    };
    lastAppliedInt = Math.round(state.percent);

    post({
      type: "started",
      volume: Math.round(state.percent),
      durationSeconds: seconds,
      requestId: requestId
    });
    timer = window.setTimeout(tick, TICK_MS);
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "syd-content") return;
    if (data.type === "toggle-fade") start(data.durationSeconds, data.requestId || null);
    if (data.type === "status") {
      const state = readState();
      post({
        type: "status",
        fading: Boolean(fade),
        volume: state.percent == null ? null : Math.round(state.percent),
        requestId: data.requestId || null
      });
    }
  });

  // Stop if the listener grabs the volume slider or taps the arrow keys.
  // Modified arrows are left alone so the extension shortcut can toggle the fade.
  document.addEventListener("pointerdown", (event) => {
    if (!fade) return;
    const target = event.target;
    if (!target || !target.closest) return;
    if (target.closest(".ytp-volume-area, .ytp-volume-panel, .ytp-volume-slider")) {
      stopAtCurrent(true);
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (!fade) return;
    if (event.altKey || event.shiftKey || event.metaKey || event.ctrlKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    stopAtCurrent(true);
  }, true);

  document.documentElement.dataset.sydReady = "1";
})();
