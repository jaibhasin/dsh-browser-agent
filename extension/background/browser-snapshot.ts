import type { JsonValue } from "../../shared/protocol";

const SNAPSHOT_MESSAGE = "dsh-browser-snapshot";
const CLICK_MESSAGE = "dsh-browser-click";
type SnapshotResult = { text: string };
type ClickResult = { ok: true } | { ok: false; error: string };

/** Read the active tab's snapshot. */
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

/** Click a ref from the latest snapshot. */
export async function clickBrowserRef(ref: number): Promise<JsonValue> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) throw new Error("No active browser tab is available.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/snapshot.js"] });
  const result = await chrome.tabs.sendMessage(tab.id, { type: CLICK_MESSAGE, ref }) as unknown;
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof (result as { ok?: unknown }).ok !== "boolean") {
    throw new Error("The content script returned an invalid click result.");
  }
  const click = result as ClickResult;
  if (!click.ok) throw new Error(click.error);
  return { clicked: true };
}
