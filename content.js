// Bridges the extension popup and the page-world fade script.
// Also shows a short note on the page, because the keyboard shortcut
// does not open the popup.
(function () {
  if (globalThis.__sydContentLoaded) return;
  globalThis.__sydContentLoaded = true;

  let serial = 0;
  let noteTimer = 0;

  function injectPageScript() {
    const parent = document.documentElement;
    if (!parent || parent.dataset.sydReady === "1" || parent.dataset.sydInjected === "1") return;
    parent.dataset.sydInjected = "1";
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected.js");
    script.onload = function () {
      script.remove();
    };
    script.onerror = function () {
      delete parent.dataset.sydInjected;
      script.remove();
    };
    parent.appendChild(script);
  }

  function waitForReady() {
    return new Promise((resolve) => {
      if (document.documentElement && document.documentElement.dataset.sydReady === "1") {
        resolve(true);
        return;
      }
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (document.documentElement && document.documentElement.dataset.sydReady === "1") {
          window.clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - started > 1500) {
          window.clearInterval(timer);
          resolve(false);
        }
      }, 20);
    });
  }

  function noteText(data) {
    if (!data || data.quiet) return "";
    if (data.type === "started") {
      return "Fading to silence over " + data.durationSeconds + " seconds.";
    }
    if (data.type === "done") {
      return "Paused. The slider is back at " + data.volume + "% so the next play uses that volume.";
    }
    if (data.type === "stopped") {
      return "Fade stopped at " + data.volume + "%.";
    }
    if (data.type === "error") {
      if (data.reason === "no-video") return "No YouTube video is on this page.";
      if (data.reason === "paused") return "The video is paused, so there is no sound to turn down.";
      if (data.reason === "muted") return "The video is muted.";
      if (data.reason === "silent") return "Volume is already at zero.";
      if (data.reason === "lost-video") return "The video changed, so the fade stopped and the previous volume was put back.";
      return "Could not fade this video.";
    }
    return "";
  }

  function popupPayload(data) {
    if (!data) {
      return {
        ok: false,
        fading: false,
        message: "Refresh the YouTube tab, then try again."
      };
    }
    if (data.type === "started") {
      return {
        ok: true,
        fading: true,
        message: "Fading to silence over " + data.durationSeconds + " seconds."
      };
    }
    if (data.type === "stopped") {
      return {
        ok: true,
        fading: false,
        message: "Fade stopped at " + data.volume + "%."
      };
    }
    if (data.type === "error") {
      return {
        ok: false,
        fading: false,
        message: noteText(data) || "Could not fade this video."
      };
    }
    return { ok: false, fading: false, message: "Could not fade this video." };
  }

  function noteParent() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.documentElement;
  }

  function showNote(text) {
    if (!text || !document.documentElement) return;
    const parent = noteParent();
    let host = document.getElementById("syd-note-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "syd-note-host";
      host.setAttribute("role", "status");
      host.style.top = "16px";
      host.style.left = "50%";
      host.style.transform = "translateX(-50%)";
      host.style.zIndex = "2147483647";
      host.style.cursor = "pointer";
      const shadow = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = [
        ".box {",
        "  background: #1f1f1f;",
        "  color: #f3f3f3;",
        "  font: 13px/1.45 system-ui, sans-serif;",
        "  padding: 10px 14px;",
        "  border-radius: 8px;",
        "  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);",
        "  max-width: 380px;",
        "}"
      ].join("\n");
      const box = document.createElement("div");
      box.className = "box";
      shadow.append(style, box);
      host.addEventListener("click", () => {
        window.clearTimeout(noteTimer);
        host.remove();
      });
      parent.appendChild(host);
    }

    const fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    host.style.position = fullscreen ? "absolute" : "fixed";
    if (host.parentNode !== parent) parent.appendChild(host);

    const box = host.shadowRoot.querySelector(".box");
    box.textContent = text;
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => {
      const current = document.getElementById("syd-note-host");
      if (current) current.remove();
    }, 5000);
  }

  function askPage(type, durationSeconds) {
    const requestId = String(++serial);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        window.removeEventListener("message", onReply);
        resolve(null);
      }, 1000);

      function onReply(event) {
        if (event.origin !== window.location.origin) return;
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== "syd-page" || data.requestId !== requestId) return;
        window.clearTimeout(timer);
        window.removeEventListener("message", onReply);
        resolve(data);
      }

      window.addEventListener("message", onReply);
      window.postMessage({
        source: "syd-content",
        type: type,
        durationSeconds: durationSeconds,
        requestId: requestId
      }, window.location.origin);
    });
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "syd-page") return;
    if (data.type !== "started" && data.type !== "done" && data.type !== "stopped" && data.type !== "error") return;
    showNote(noteText(data));
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || (message.type !== "toggle-fade" && message.type !== "status")) return false;

    injectPageScript();
    waitForReady().then((ready) => {
      if (!ready) {
        sendResponse({
          ok: false,
          fading: false,
          message: "Refresh the YouTube tab, then try again."
        });
        return;
      }
      const pageType = message.type === "status" ? "status" : "toggle-fade";
      return askPage(pageType, message.durationSeconds).then((data) => {
        if (pageType === "status") {
          sendResponse({
            ok: Boolean(data),
            fading: Boolean(data && data.fading),
            message: data ? "" : "Refresh the YouTube tab, then try again."
          });
          return;
        }
        sendResponse(popupPayload(data));
      });
    });
    return true;
  });

  injectPageScript();
})();
