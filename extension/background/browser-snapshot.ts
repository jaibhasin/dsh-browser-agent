import type { JsonValue } from "../../shared/protocol";

const SNAPSHOT_MESSAGE = "dsh-browser-snapshot";
type SnapshotResult = { text: string };
type BrowserScreenshotResult = { data: string; mediaType: "image/png" };

/** Idempotently inject and ask the content script to read the current active page. */
export async function captureBrowserSnapshot(): Promise<JsonValue> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) throw new Error("No active browser tab is available.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/snapshot.js"] });
  const result = await chrome.tabs.sendMessage(tab.id, { type: SNAPSHOT_MESSAGE }) as unknown;
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof (result as { text?: unknown }).text !== "string") {
    throw new Error("The content script returned an invalid snapshot.");
  }
  return result as SnapshotResult;
}

/** Capture the visible portion of the active tab as a PNG data payload. */
export async function captureBrowserScreenshot(): Promise<JsonValue> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.windowId === undefined) throw new Error("No active browser tab is available.");
  const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  if (typeof data !== "string" || !data.startsWith("data:image/png;base64,")) {
    throw new Error("The browser returned an invalid screenshot.");
  }
  return { data: data.slice("data:image/png;base64,".length), mediaType: "image/png" } satisfies BrowserScreenshotResult;
}
