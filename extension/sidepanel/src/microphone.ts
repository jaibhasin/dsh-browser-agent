import "./microphone.css";

const allow = document.querySelector<HTMLButtonElement>("#allow")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const settings = document.querySelector<HTMLButtonElement>("#settings")!;

allow.addEventListener("click", async () => {
  allow.disabled = true;
  status.textContent = "Choose Allow in Chrome's microphone prompt.";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Permission is all this page needs. Never retain or transmit microphone data.
    for (const track of stream.getTracks()) track.stop();
    status.textContent = "Microphone access is allowed. Return to the side panel and click its microphone button. You can close this tab.";
    allow.textContent = "Microphone allowed";
  } catch (error) {
    allow.disabled = false;
    const name = error instanceof DOMException ? error.name : "";
    status.textContent = name === "NotAllowedError"
      ? "Chrome could not grant microphone access. Open microphone settings below and allow it for this extension, then try again. If it is already allowed, check your system's microphone permissions for Chrome."
      : name === "NotFoundError" ? "No microphone was found. Connect one and try again."
        : "The microphone could not be opened. Check your device and try again.";
  }
});

settings.addEventListener("click", () => {
  const origin = chrome.runtime.getURL("");
  void chrome.tabs.create({ url: `chrome://settings/content/siteDetails?site=${encodeURIComponent(origin)}` }).catch(() => {
    status.textContent = "Open Chrome Settings > Privacy and security > Site settings > Microphone to review access.";
  });
});
