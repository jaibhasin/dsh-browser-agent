import { ExtensionBridge, type BridgeConfiguration } from "./bridge";
import { captureBrowserScreenshot, captureBrowserSnapshot, clickBrowserRef, listBrowserTabs, navigateBrowser, scrollBrowser, switchBrowserTab, typeBrowserRef } from "./browser-snapshot";

const bridge = new ExtensionBridge();
bridge.setChatProgressHandler((progress) => {
  void chrome.runtime.sendMessage({ type: "dsh-chat-progress", progress }).catch(() => undefined);
});
bridge.setRequestHandler(async (request) => {
  if (request.method === "snapshot") return await captureBrowserSnapshot();
  if (request.method === "screenshot") return await captureBrowserScreenshot();
  if (request.method === "scroll") {
    const params = request.params;
    if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Scroll parameters are required.");
    const direction = (params as { direction?: unknown }).direction;
    const value = (params as { value?: unknown }).value;
    if (!["up", "down", "left", "right"].includes(direction as string)) throw new Error("Scroll direction must be up, down, left, or right.");
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1_000_000) throw new Error("Scroll value must be an integer from 1 to 1,000,000 pixels.");
    return await scrollBrowser(direction as "up" | "down" | "left" | "right", value);
  }
  if (request.method === "click") {
    const ref = (request.params as { ref?: unknown })?.ref;
    if (!Number.isInteger(ref) || (ref as number) < 1) throw new Error("Browser ref must be a positive integer.");
    return await clickBrowserRef(ref as number);
  }
  if (request.method === "type") {
    const ref = (request.params as { ref?: unknown })?.ref;
    const text = (request.params as { text?: unknown })?.text;
    if (!Number.isInteger(ref) || (ref as number) < 1 || typeof text !== "string") throw new Error("Browser type requires a positive ref and text.");
    return await typeBrowserRef(ref as number, text);
  }
  if (request.method === "navigate") {
    const url = (request.params as { url?: unknown })?.url;
    if (typeof url !== "string") throw new Error("Browser navigate requires a URL.");
    const parsed = parseHttpUrl(url);
    return await navigateBrowser(parsed.href);
  }
  if (request.method === "tabs") return await listBrowserTabs();
  if (request.method === "switch_tab") {
    const id = (request.params as { id?: unknown })?.id;
    if (!Number.isInteger(id) || (id as number) < 0) throw new Error("Browser tab ID must be a non-negative integer.");
    return await switchBrowserTab(id as number);
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
  if (message.type === "dsh-browser-type") {
    const ref = (message as { ref?: unknown }).ref;
    const text = (message as { text?: unknown }).text;
    if (!Number.isInteger(ref) || (ref as number) < 1 || typeof text !== "string") { sendResponse({ ok: false, error: "Browser type requires a positive ref and text." }); return; }
    void typeBrowserRef(ref as number, text)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Type failed." }));
    return true;
  }
  if (message.type === "dsh-chat") {
    const text = (message as { text?: unknown }).text;
    const id = (message as { id?: unknown }).id;
    if (typeof text !== "string" || !text.trim()) { sendResponse({ ok: false, error: "Message is empty." }); return; }
    if (typeof id !== "string" || !id) { sendResponse({ ok: false, error: "Chat request ID is invalid." }); return; }
    void bridge.chat(id, text.trim())
      .then((reply) => sendResponse({ ok: true, text: reply }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "DSH chat failed." }));
    return true;
  }
  if (message.type === "dsh-new-session") {
    void bridge.newSession()
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "New session failed." }));
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

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Browser navigate requires an absolute HTTP or HTTPS URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Browser navigate supports only HTTP and HTTPS URLs.");
  }
  return url;
}
