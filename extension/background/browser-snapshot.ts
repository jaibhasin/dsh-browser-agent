import type { JsonValue } from "../../shared/protocol";

const SNAPSHOT_MESSAGE = "dsh-browser-snapshot";
const SCROLL_MESSAGE = "dsh-browser-scroll";
type SnapshotResult = { text: string };
type BrowserScreenshotResult = { data: string; mediaType: "image/png" };
type ScrollDirection = "up" | "down" | "left" | "right";
const CLICK_MESSAGE = "dsh-browser-click";
const TYPE_MESSAGE = "dsh-browser-type";
type ClickResult = { ok: true } | { ok: false; error: string };
type TypeResult = { typed: true } | { typed: false; error: string };
export type BrowserTab = {
  id: number;
  windowId: number;
  title: string;
  url: string;
  active: boolean;
};

function toBrowserTab(tab: chrome.tabs.Tab): BrowserTab {
  if (tab.id === undefined || tab.windowId === undefined) throw new Error("The browser returned a tab without an ID.");
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title ?? "",
    url: tab.url ?? "",
    active: tab.active,
  };
}

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

/** Scroll the active tab and return its new snapshot. */
export async function scrollBrowser(direction: ScrollDirection, value: number): Promise<JsonValue> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) throw new Error("No active browser tab is available.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/snapshot.js"] });
  const result = await chrome.tabs.sendMessage(tab.id, { type: SCROLL_MESSAGE, direction, value }) as unknown;
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof (result as { text?: unknown }).text !== "string") {
    throw new Error("The content script returned an invalid scroll result.");
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

/** Fill a text control from the latest snapshot. */
export async function typeBrowserRef(ref: number, text: string): Promise<JsonValue> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) throw new Error("No active browser tab is available.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/snapshot.js"] });
  const result = await chrome.tabs.sendMessage(tab.id, { type: TYPE_MESSAGE, ref, text }) as unknown;
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof (result as { typed?: unknown }).typed !== "boolean") {
    throw new Error("The content script returned an invalid type result.");
  }
  const typed = result as TypeResult;
  if (!typed.typed) throw new Error(typed.error);
  return { typed: true };
}

/** Navigate the active tab in the focused browser window to an HTTP(S) URL. */
export async function navigateBrowser(url: string): Promise<JsonValue> {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id === undefined) throw new Error("No active browser tab is available.");
  const tab = await chrome.tabs.update(activeTab.id, { url });
  return { tab: toBrowserTab(tab) };
}

/** List every currently open browser tab. */
export async function listBrowserTabs(): Promise<JsonValue> {
  const tabs = await chrome.tabs.query({});
  return { tabs: tabs.filter((tab) => tab.id !== undefined && tab.windowId !== undefined).map(toBrowserTab) };
}

/** Focus the tab's window and make that tab active. */
export async function switchBrowserTab(id: number): Promise<JsonValue> {
  const existing = await chrome.tabs.get(id).catch(() => undefined);
  if (!existing || existing.windowId === undefined) throw new Error(`No browser tab exists with ID ${id}.`);
  await chrome.windows.update(existing.windowId, { focused: true });
  const tab = await chrome.tabs.update(id, { active: true });
  return { tab: toBrowserTab(tab) };
}
