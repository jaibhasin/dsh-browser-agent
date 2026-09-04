import { ExtensionBridge, type BridgeConfiguration } from "./bridge";
import { captureBrowserSnapshot, clickBrowserRef } from "./browser-snapshot";

const bridge = new ExtensionBridge();
bridge.setRequestHandler(async (request) => {
  if (request.method === "snapshot") return await captureBrowserSnapshot();
  if (request.method === "click") {
    const ref = (request.params as { ref?: unknown })?.ref;
    if (!Number.isInteger(ref) || (ref as number) < 1) throw new Error("Browser ref must be a positive integer.");
    return await clickBrowserRef(ref as number);
  }
  throw new Error(`Unsupported browser method: ${request.method}`);
});

// MV3 workers can be reloaded without firing onInstalled or onStartup.
// Starting here ensures opening the side panel always reconnects the bridge.
void bridge.start();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void bridge.start();
});

chrome.runtime.onStartup.addListener(() => void bridge.start());

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) return;
  if (message.type === "dsh-bridge-status") { sendResponse({ status: bridge.getStatus() }); return; }
  if (message.type === "dsh-browser-snapshot") {
    void captureBrowserSnapshot()
      .then((snapshot) => sendResponse({ ok: true, snapshot }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Snapshot failed." }));
    return true;
  }
  if (message.type === "dsh-browser-click") {
    const ref = (message as { ref?: unknown }).ref;
    if (!Number.isInteger(ref) || (ref as number) < 1) { sendResponse({ ok: false, error: "Browser ref must be a positive integer." }); return; }
    void clickBrowserRef(ref as number)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Click failed." }));
    return true;
  }
  if (message.type === "dsh-chat") {
    const text = (message as { text?: unknown }).text;
    if (typeof text !== "string" || !text.trim()) { sendResponse({ ok: false, error: "Message is empty." }); return; }
    void bridge.chat(text.trim())
      .then((reply) => sendResponse({ ok: true, text: reply }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "DSH chat failed." }));
    return true;
  }
  if (message.type === "dsh-bridge-configure") {
    const config = (message as { config?: unknown }).config;
    if (!isBridgeConfiguration(config)) { sendResponse({ ok: false, error: "Invalid bridge configuration." }); return; }
    void bridge.configure(config)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Invalid bridge configuration." }));
    return true;
  }
});

function isBridgeConfiguration(value: unknown): value is BridgeConfiguration {
  return typeof value === "object" && value !== null &&
    "url" in value && typeof value.url === "string" &&
    "token" in value && typeof value.token === "string";
}
