import type { JsonValue } from "../../shared/protocol";

const SNAPSHOT_MESSAGE = "dsh-browser-snapshot";
type SnapshotResult = { text: string };
type TypeResult = { text: string };

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

/** Fill a visible control by snapshot ref. */
export async function typeIntoBrowser(ref: string, text: string): Promise<JsonValue> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) throw new Error("No active browser tab is available.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/snapshot.js"] });
  const result = await chrome.tabs.sendMessage(tab.id, { type: "dsh-browser-type", ref, text }) as unknown;
  if (result && typeof result === "object" && !Array.isArray(result) && typeof (result as { error?: unknown }).error === "string") {
    throw new Error((result as { error: string }).error);
  }
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof (result as { text?: unknown }).text !== "string") {
    throw new Error("The content script returned an invalid typing result.");
  }
  return result as TypeResult;
}
