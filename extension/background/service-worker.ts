import { ExtensionBridge, type BridgeConfiguration } from "./bridge";
import { captureBrowserScreenshot, captureBrowserSnapshot, clickBrowserRef, listBrowserTabs, navigateBrowser, scrollBrowser, typeBrowserRef, waitForBrowserSettled } from "./browser-snapshot";
import { broadcastAgentTabState, cancelAgentTask, ensureAgentTab, getAgentTabState, getAgentTaskTab, pauseAgentTaskForTab, releaseAgentTab, resumeAgentTask, startAgentTask, endAgentTask, switchAgentTab } from "./agent-tab";

const bridge = new ExtensionBridge();
bridge.setChatProgressHandler((progress) => {
  void chrome.runtime.sendMessage({ type: "dsh-chat-progress", progress }).catch(() => undefined);
});
bridge.setRequestHandler(async (request) => {
  const taskTab = request.taskId ? await getAgentTaskTab(request.taskId) : undefined;
  if (request.method === "snapshot") return await captureBrowserSnapshot(taskTab);
  if (request.method === "wait") {
    const timeoutMs = (request.params as { timeoutMs?: unknown })?.timeoutMs;
    if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 10_000) {
      throw new Error("Wait timeout must be an integer from 250 to 10,000 milliseconds.");
    }
    return await waitForBrowserSettled(timeoutMs, taskTab);
  }
  if (request.method === "screenshot") return await captureBrowserScreenshot(taskTab);
  if (request.method === "scroll") {
    const params = request.params;
    if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Scroll parameters are required.");
    const direction = (params as { direction?: unknown }).direction;
    const value = (params as { value?: unknown }).value;
    if (!["up", "down", "left", "right"].includes(direction as string)) throw new Error("Scroll direction must be up, down, left, or right.");
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1_000_000) throw new Error("Scroll value must be an integer from 1 to 1,000,000 pixels.");
    return await scrollBrowser(direction as "up" | "down" | "left" | "right", value, taskTab);
  }
  if (request.method === "click") {
    const ref = (request.params as { ref?: unknown })?.ref;
    if (!Number.isInteger(ref) || (ref as number) < 1) throw new Error("Browser ref must be a positive integer.");
    return await clickBrowserRef(ref as number, taskTab);
  }
  if (request.method === "type") {
    const ref = (request.params as { ref?: unknown })?.ref;
    const text = (request.params as { text?: unknown })?.text;
    if (!Number.isInteger(ref) || (ref as number) < 1 || typeof text !== "string") throw new Error("Browser type requires a positive ref and text.");
    return await typeBrowserRef(ref as number, text, taskTab);
  }
  if (request.method === "navigate") {
    const url = (request.params as { url?: unknown })?.url;
    if (typeof url !== "string") throw new Error("Browser navigate requires a URL.");
    const parsed = parseHttpUrl(url);
    return await navigateBrowser(parsed.href, taskTab);
  }
  if (request.method === "tabs") return await listBrowserTabs();
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
chrome.tabs.onActivated.addListener(({ tabId }) => void handleTabActivated(tabId));
chrome.tabs.onRemoved.addListener(() => void broadcastAgentTabState());
chrome.windows.onFocusChanged.addListener((windowId) => void handleWindowFocusChanged(windowId));

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) return;
  if (message.type === "dsh-bridge-status") { sendResponse({ status: bridge.getStatus() }); return; }
  if (message.type === "dsh-agent-tab-state-request") {
    void getAgentTabState()
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Agent tab state is unavailable." }));
    return true;
  }
  if (message.type === "dsh-agent-switch-tab") {
    const id = (message as { id?: unknown }).id;
    if (!Number.isInteger(id) || (id as number) < 0) { sendResponse({ ok: false, error: "Browser tab ID must be a non-negative integer." }); return; }
    void switchAgentToCurrentTab(id as number)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "The agent tab could not be changed." }));
    return true;
  }
  if (message.type === "dsh-agent-resume-task") {
    void resumeAgentTask()
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "The browser task could not be resumed." }));
    return true;
  }
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
    if (bridge.getStatus() !== "connected") { sendResponse({ ok: false, error: "The DSH browser bridge is not connected." }); return; }
    void ensureAgentTab()
      .then(async (tab) => {
        if (tab.id === undefined) throw new Error("The agent tab is unavailable.");
        await startAgentTask(id, tab.id);
        try {
          return await bridge.chat(id, text.trim());
        } finally {
          await endAgentTask(id);
        }
      })
      .then((reply) => sendResponse({ ok: true, text: reply }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "DSH chat failed." }));
    return true;
  }
  if (message.type === "dsh-new-session") {
    void bridge.newSession()
      .then(() => releaseAgentTab())
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

async function handleTabActivated(tabId: number): Promise<void> {
  await pauseAgentTaskForTab(tabId);
  await broadcastAgentTabState(tabId);
}

async function handleWindowFocusChanged(windowId: number): Promise<void> {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await broadcastAgentTabState();
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.id === undefined) {
    await broadcastAgentTabState();
    return;
  }
  await handleTabActivated(tab.id);
}

async function switchAgentToCurrentTab(id: number): Promise<void> {
  const cancelledTaskId = await cancelAgentTask();
  if (cancelledTaskId) bridge.sendEvent("cancel_task", { id: cancelledTaskId });
  await switchAgentTab(id);
}

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
