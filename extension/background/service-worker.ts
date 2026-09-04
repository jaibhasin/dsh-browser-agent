import { ExtensionBridge, type BridgeConfiguration } from "./bridge";

const bridge = new ExtensionBridge();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void bridge.start();
});

chrome.runtime.onStartup.addListener(() => void bridge.start());

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) return;
  if (message.type === "dsh-bridge-status") { sendResponse({ status: bridge.getStatus() }); return; }
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
